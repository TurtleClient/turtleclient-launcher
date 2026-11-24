use crate::i18n::Key;
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use reqwest::Client;
use semver::Version;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tempfile::TempDir;
use url::Url;

pub const ENDPOINT: &str =
    "https://github.com/TurtleClient/turtleclient-launcher/releases/latest/download/latest.json";
const MAX_INSTALLER: u64 = 256 * 1024 * 1024;
const MAX_MANIFEST: u64 = 64 * 1024;

#[derive(Clone, Debug)]
pub enum Event {
    Checking,
    Downloading {
        version: String,
        received: u64,
        total: Option<u64>,
    },
    Verifying,
    Installing,
    Done {
        version: String,
        reboot: bool,
    },
    Failed(Key),
}

#[derive(Deserialize)]
struct Manifest {
    version: String,
    platforms: HashMap<String, Platform>,
}
#[derive(Deserialize)]
struct Platform {
    url: String,
    signature: String,
}

pub struct Release {
    pub version: Version,
    url: Url,
    signature: String,
}
pub struct VerifiedInstaller {
    _directory: TempDir,
    path: PathBuf,
    pub version: Version,
    pub sha256: String,
}

fn trusted_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && matches!(
            url.host_str(),
            Some(
                "github.com"
                    | "release-assets.githubusercontent.com"
                    | "objects.githubusercontent.com"
            )
        )
}

pub fn client() -> Result<Client, Key> {
    Client::builder()
        .https_only(true)
        .user_agent("TurtleClient-Setup/1.0")
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 6 || !trusted_url(attempt.url()) {
                attempt.error("Untrusted release redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| Key::NetworkError)
}

pub fn parse_release(bytes: &[u8]) -> Result<Release, Key> {
    let manifest: Manifest = serde_json::from_slice(bytes).map_err(|_| Key::ManifestError)?;
    let version = Version::parse(&manifest.version).map_err(|_| Key::ManifestError)?;
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Err(Key::ManifestError);
    }
    let platform = manifest
        .platforms
        .get("windows-x86_64-nsis")
        .or_else(|| manifest.platforms.get("windows-x86_64"))
        .ok_or(Key::ManifestError)?;
    let url = Url::parse(&platform.url).map_err(|_| Key::ManifestError)?;
    let prefix = format!("/TurtleClient/turtleclient-launcher/releases/download/v{version}/");
    if !trusted_url(&url)
        || url.host_str() != Some("github.com")
        || !url.path().starts_with(&prefix)
        || !url.path().ends_with(".exe")
        || url.path()[prefix.len()..].contains('/')
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Key::ManifestError);
    }
    decode_signature(&platform.signature)?;
    Ok(Release {
        version,
        url,
        signature: platform.signature.clone(),
    })
}

fn decode_signature(encoded: &str) -> Result<Signature, Key> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|_| Key::SignatureError)?;
    let text = std::str::from_utf8(&bytes).map_err(|_| Key::SignatureError)?;
    Signature::decode(text.trim()).map_err(|_| Key::SignatureError)
}

fn public_key() -> Result<PublicKey, Key> {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../../src-tauri/tauri.conf.json"))
            .map_err(|_| Key::SignatureError)?;
    let encoded = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or(Key::SignatureError)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| Key::SignatureError)?;
    let key = std::str::from_utf8(&bytes).map_err(|_| Key::SignatureError)?;
    PublicKey::decode(key.trim()).map_err(|_| Key::SignatureError)
}

pub fn verify(file: &Path, signature: &str) -> Result<(), Key> {
    let metadata = fs::symlink_metadata(file).map_err(|_| Key::DiskError)?;
    if !metadata.is_file() || metadata.len() > MAX_INSTALLER {
        return Err(Key::SignatureError);
    }
    let bytes = fs::read(file).map_err(|_| Key::DiskError)?;
    if !bytes.starts_with(b"MZ") {
        return Err(Key::SignatureError);
    }
    verify_bytes(&bytes, signature, &public_key()?)
}

fn verify_bytes(bytes: &[u8], signature: &str, key: &PublicKey) -> Result<(), Key> {
    key.verify(bytes, &decode_signature(signature)?, true)
        .map_err(|_| Key::SignatureError)
}

pub fn stage(cancel: &AtomicBool, report: &impl Fn(Event)) -> Result<VerifiedInstaller, Key> {
    tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|_| Key::NetworkError)?.block_on(async {
        let download = stage_async(cancel, report);
        tokio::pin!(download);
        let mut poll = tokio::time::interval(Duration::from_millis(100));
        loop {
            tokio::select! {
                result = &mut download => return result,
                _ = poll.tick() => if cancel.load(Ordering::Relaxed) { return Err(Key::Cancelled); },
            }
        }
    })
}

async fn stage_async(
    cancel: &AtomicBool,
    report: &impl Fn(Event),
) -> Result<VerifiedInstaller, Key> {
    let client = client()?;
    report(Event::Checking);
    let mut response = client
        .get(ENDPOINT)
        .timeout(Duration::from_secs(25))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| Key::NetworkError)?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Key::NetworkError)? {
        if bytes.len() as u64 + chunk.len() as u64 > MAX_MANIFEST {
            return Err(Key::ManifestError);
        }
        bytes.extend_from_slice(&chunk);
    }
    let release = parse_release(&bytes)?;
    if cancel.load(Ordering::Relaxed) {
        return Err(Key::Cancelled);
    }
    let directory = tempfile::Builder::new()
        .prefix("turtle-setup-")
        .tempdir()
        .map_err(|_| Key::DiskError)?;
    let path = directory.path().join("launcher-setup.exe");
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|_| Key::DiskError)?;
    let mut response = client
        .get(release.url.clone())
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| Key::NetworkError)?;
    let total = response.content_length();
    if total.is_some_and(|n| n > MAX_INSTALLER || n == 0) {
        return Err(Key::ManifestError);
    }
    let mut received = 0u64;
    let mut hash = Sha256::new();
    let mut last = Instant::now() - Duration::from_secs(1);
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(Key::Cancelled);
        }
        let Some(chunk) = response.chunk().await.map_err(|_| Key::NetworkError)? else {
            break;
        };
        received += chunk.len() as u64;
        if received > MAX_INSTALLER {
            return Err(Key::ManifestError);
        }
        output.write_all(&chunk).map_err(|_| Key::DiskError)?;
        hash.update(&chunk);
        if last.elapsed() >= Duration::from_millis(80) {
            report(Event::Downloading {
                version: release.version.to_string(),
                received,
                total,
            });
            last = Instant::now();
        }
    }
    output.sync_all().map_err(|_| Key::DiskError)?;
    drop(output);
    if received == 0 || total.is_some_and(|n| n != received) {
        return Err(Key::NetworkError);
    }
    if cancel.load(Ordering::Relaxed) {
        return Err(Key::Cancelled);
    }
    report(Event::Verifying);
    verify(&path, &release.signature)?;
    Ok(VerifiedInstaller {
        _directory: directory,
        path,
        version: release.version,
        sha256: format!("{:x}", hash.finalize()),
    })
}

pub fn validate_target(path: &Path) -> Result<(), Key> {
    let text = path.to_string_lossy();
    if !path.is_absolute()
        || path.parent().is_none()
        || text.len() > 220
        || text.chars().any(|c| c < ' ' || c == '"')
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(Key::PathError);
    }
    if path.file_name().is_none() {
        return Err(Key::PathError);
    }
    Ok(())
}

pub fn install_verified(
    installer: &VerifiedInstaller,
    target: &Path,
    shortcuts: bool,
) -> Result<bool, Key> {
    validate_target(target)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new(&installer.path);
        command.arg("/S");
        if !shortcuts {
            command.arg("/NS");
        }
        // NSIS requires /D to be last and unquoted, even when the directory has spaces.
        command.raw_arg(format!("/D={}", target.display()));
        let status = command.status().map_err(|_| Key::InstallError)?;
        match status.code() {
            Some(0) => Ok(false),
            Some(3010) => Ok(true),
            _ => Err(Key::InstallError),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (installer, shortcuts);
        Err(Key::InstallError)
    }
}

pub fn launch(target: &Path) -> Result<(), Key> {
    let executable = target.join("turtleclient-launcher.exe");
    if !executable.is_file() {
        return Err(Key::InstallError);
    }
    Command::new(executable)
        .current_dir(target)
        .spawn()
        .map_err(|_| Key::InstallError)?;
    Ok(())
}

pub fn installed() -> Option<(PathBuf, Option<Version>)> {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let root = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall")
            .ok()?;
        for entry in root.enum_keys().take(5000).flatten() {
            let Ok(key) = root.open_subkey(entry) else {
                continue;
            };
            if key.get_value::<String, _>("DisplayName").ok().as_deref()
                != Some("TurtleClient Launcher")
            {
                continue;
            }
            if let Ok(path) = key.get_value::<String, _>("InstallLocation") {
                let target = PathBuf::from(path);
                if target.join("turtleclient-launcher.exe").is_file()
                    && validate_target(&target).is_ok()
                {
                    return Some((
                        target,
                        key.get_value::<String, _>("DisplayVersion")
                            .ok()
                            .and_then(|v| Version::parse(&v).ok()),
                    ));
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_valid_signature_verifies_but_tampering_and_another_trust_root_fail() {
        // Public prehashed test vector from minisign-verify (MIT, Frank Denis).
        // Only public material is included; this test never generates or loads a secret key.
        let key =
            PublicKey::from_base64("RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3")
                .unwrap();
        let signature = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==";
        let encoded = base64::engine::general_purpose::STANDARD.encode(signature);
        assert_eq!(verify_bytes(b"test", &encoded, &key), Ok(()));
        assert_eq!(
            verify_bytes(b"Test", &encoded, &key),
            Err(Key::SignatureError)
        );
        assert_eq!(
            verify_bytes(b"test", &encoded, &public_key().unwrap()),
            Err(Key::SignatureError)
        );
        let bytes = serde_json::to_vec(&serde_json::json!({"version":"2.3.10","platforms":{"windows-x86_64-nsis":{"url":"https://github.com/TurtleClient/turtleclient-launcher/releases/download/v2.3.10/setup.exe","signature":encoded}}})).unwrap();
        assert_eq!(
            parse_release(&bytes).unwrap().version,
            Version::new(2, 3, 10)
        );
    }
    fn manifest(url: &str, version: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"version":version,"platforms":{"windows-x86_64":{"url":url,"signature":"invalid"}}})).unwrap()
    }
    #[test]
    fn other_hosts_repositories_versions_and_active_urls_are_rejected() {
        for url in ["http://github.com/TurtleClient/turtleclient-launcher/releases/download/v2.3.10/setup.exe", "https://evil.example/setup.exe", "https://github.com/other/project/releases/download/v2.3.10/setup.exe", "https://github.com/TurtleClient/turtleclient-launcher/releases/download/v2.3.9/setup.exe", "https://github.com/TurtleClient/turtleclient-launcher/releases/download/v2.3.10/setup.exe?redirect=evil", "https://github.com/TurtleClient/turtleclient-launcher/releases/download/v2.3.10/setup.exe#evil", "https://github.com@evil.example/TurtleClient/turtleclient-launcher/releases/download/v2.3.10/setup.exe"] {
            assert!(matches!(parse_release(&manifest(url,"2.3.10")),Err(Key::ManifestError)),"{url}");
        }
    }
    #[test]
    fn invalid_signature_cannot_become_a_release() {
        assert!(matches!(parse_release(&manifest("https://github.com/TurtleClient/turtleclient-launcher/releases/download/v2.3.10/setup.exe","2.3.10")),Err(Key::SignatureError)));
    }
    #[test]
    fn the_configured_production_key_parses() {
        assert!(public_key().is_ok());
    }
    #[test]
    fn a_download_needs_a_real_pe_and_a_valid_signature() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("setup.exe");
        fs::write(&file, b"not an executable").unwrap();
        assert_eq!(verify(&file, "bad"), Err(Key::SignatureError));
        fs::write(&file, b"MZ untrusted executable").unwrap();
        assert_eq!(verify(&file, "bad"), Err(Key::SignatureError));
    }
    #[test]
    fn invalid_targets_are_rejected_before_installation() {
        assert_eq!(validate_target(Path::new("relative")), Err(Key::PathError));
        assert_eq!(validate_target(Path::new("C:\\")), Err(Key::PathError));
        assert_eq!(
            validate_target(Path::new("C:\\Games\\..\\Windows")),
            Err(Key::PathError)
        );
        assert_eq!(
            validate_target(Path::new("C:\\Games\\Turtle\"bad")),
            Err(Key::PathError)
        );
        assert!(validate_target(Path::new("C:\\Games\\Turtle Client")).is_ok());
    }
}
