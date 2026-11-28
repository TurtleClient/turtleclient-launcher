//! Private preparation from the player's installed game, including Modrinth's shared cache.
use super::{engine, Settings};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const FAILED: &str = "turtle_resources_prepare_failed";
#[derive(Deserialize)]
struct Pin {
    minecraft: String,
    schema: u64,
    output_version: u64,
    sha256: String,
    exe_sha256: String,
}
fn pin() -> Pin {
    serde_json::from_str(include_str!("../../resources-preparer.json")).expect("pinned preparer")
}
fn phase() -> &'static Mutex<&'static str> {
    static PHASE: OnceLock<Mutex<&'static str>> = OnceLock::new();
    PHASE.get_or_init(|| Mutex::new("idle"))
}
pub(super) fn status() -> Value {
    json!({"phase":*phase().lock().unwrap_or_else(|e|e.into_inner())})
}
fn manifest(path: &Path) -> Option<Value> {
    if std::fs::metadata(path).ok()?.len() > 2 * 1024 * 1024 {
        return None;
    }
    let data = std::fs::read(path).ok()?;
    (data.len() < 2 * 1024 * 1024)
        .then(|| serde_json::from_slice(&data).ok())
        .flatten()
}
pub(super) fn ready(path: &Path) -> bool {
    if !path.is_absolute() {
        return false;
    }
    let p = pin();
    let Some(m) = manifest(&path.join("horizon-resources.json")) else {
        return false;
    };
    m["minecraft"] == p.minecraft
        && m["schema"].as_u64() == Some(p.schema)
        && manifest(&path.join("horizon-prepare.json"))
            .is_some_and(|s| s["output_version"].as_u64() == Some(p.output_version))
        && [
            "facts.json",
            "items.json",
            "cached-collision.nbt",
            "render-definitions.json",
        ]
        .iter()
        .all(|name| path.join(name).is_file())
}
fn sources_at(data: &Path, home: &Path) -> Vec<PathBuf> {
    [
        data.join("ModrinthApp"),
        data.join("com.modrinth.theseus"),
        data.join(".minecraft"),
        home.join(".minecraft"),
    ]
    .into_iter()
    .filter(|p| p.is_dir())
    .collect()
}
pub(super) fn default_source() -> String {
    dirs::data_dir()
        .zip(dirs::home_dir())
        .and_then(|(data, home)| sources_at(&data, &home).into_iter().next())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}
fn tag() -> String {
    format!("turtleclient-26.3-{}", &pin().sha256[..16])
}
pub(super) fn discover() -> Option<String> {
    let mut candidates = vec![engine::data_dir()
        .join("horizon-auth/launcher/versions")
        .join(tag())];
    if let Some(config) = dirs::config_dir() {
        if let Ok(entries) = std::fs::read_dir(config.join("horizon-launcher/versions")) {
            let mut entries: Vec<_> = entries.filter_map(Result::ok).map(|e| e.path()).collect();
            entries.sort();
            entries.reverse();
            candidates.extend(entries);
        }
    }
    candidates
        .into_iter()
        .map(|p| p.join(".local/horizon-client/26.3"))
        .find(|p| ready(p))
        .map(|p| p.to_string_lossy().into_owned())
}
fn bundle_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| FAILED)?;
    let file = exe.parent().ok_or(FAILED)?.join("resources-preparer.zip");
    #[cfg(debug_assertions)]
    let file = if file.is_file() {
        file
    } else {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources-preparer.zip")
    };
    if engine::sha256_file(&file).is_ok_and(|h| h == pin().sha256) {
        Ok(file)
    } else {
        Err(FAILED.into())
    }
}
fn unpack(bytes: &[u8], root: &Path) -> Result<(), String> {
    (|| -> Result<(), Box<dyn std::error::Error>> {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))?;
        let mut total = 0u64;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i)?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.enclosed_name().ok_or("path")?;
            if entry.name().contains(['\\', ':'])
                || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
            {
                return Err("path".into());
            }
            total = total.checked_add(entry.size()).ok_or("size")?;
            if total > 64 * 1024 * 1024 {
                return Err("size".into());
            }
            let target = root.join(name);
            std::fs::create_dir_all(target.parent().ok_or("path")?)?;
            let mut file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(target)?;
            let copied = std::io::copy(
                &mut Read::by_ref(&mut entry).take(64 * 1024 * 1024 + 1),
                &mut file,
            )?;
            if copied != entry.size() {
                return Err("size".into());
            }
        }
        Ok(())
    })()
    .map_err(|_| FAILED.into())
}
fn install(root: &Path) -> Result<(), String> {
    let p = pin();
    if root.join(".installed").is_file()
        && engine::sha256_file(&root.join("horizon-prepare.exe")).is_ok_and(|h| h == p.exe_sha256)
    {
        return Ok(());
    }
    let bytes = std::fs::read(bundle_path()?).map_err(|_| FAILED)?;
    let parent = root.parent().ok_or(FAILED)?;
    std::fs::create_dir_all(parent).map_err(|_| FAILED)?;
    let stage = parent.join(format!(
        ".turtle-preparer-{}-{}",
        std::process::id(),
        uuid_nonce()
    ));
    std::fs::create_dir(&stage).map_err(|_| FAILED)?;
    let result = (|| {
        unpack(&bytes, &stage)?;
        if !engine::sha256_file(&stage.join("horizon-prepare.exe")).is_ok_and(|h| h == p.exe_sha256)
        {
            return Err(FAILED.into());
        }
        std::fs::write(stage.join(".installed"), b"").map_err(|_| FAILED)?;
        std::fs::rename(&stage, root).map_err(|_| FAILED.to_string())
    })();
    // This exact fresh child contains only our failed unpack; never delete a player's folder.
    if stage.parent() == Some(parent)
        && stage
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with(".turtle-preparer-"))
    {
        let _ = std::fs::remove_dir_all(stage);
    }
    result
}
fn uuid_nonce() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}
fn prepare(config: &Settings) -> Result<String, String> {
    let source = (!config.minecraft_source.is_empty()).then(|| Path::new(&config.minecraft_source));
    let (root, mut cmd) = engine::turtle_prepare_command(&tag(), source)?;
    install(&root)?;
    cmd.current_dir(&root);
    let started = Instant::now();
    match engine::output_unless_stopped(&mut cmd, || {
        crate::exiting() || started.elapsed() > Duration::from_secs(1800)
    }) {
        Ok(engine::Ran::Done(out)) if out.status.success() => (),
        _ => return Err(FAILED.into()),
    }
    let output = root.join(".local/horizon-client/26.3");
    if !ready(&output) {
        return Err(FAILED.into());
    }
    Ok(output.to_string_lossy().into_owned())
}
pub(super) async fn ensure(mut config: Settings) -> Result<Settings, String> {
    if ready(Path::new(&config.resources)) {
        return Ok(config);
    }
    if let Some(found) = discover() {
        config.resources = found;
        return Ok(config);
    }
    static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = LOCK.try_lock().map_err(|_| "turtle_resources_busy")?;
    *phase().lock().unwrap_or_else(|e| e.into_inner()) = "preparing_resources";
    let result = crate::commands::blocking(move || {
        config.resources = prepare(&config)?;
        super::config_store::update(&super::settings_file(), &super::defaults(), |current| {
            current.resources = config.resources;
            Ok(())
        })
    })
    .await
    .and_then(|v| v);
    *phase().lock().unwrap_or_else(|e| e.into_inner()) =
        if result.is_ok() { "ready" } else { "error" };
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn modrinth_is_discovered_without_an_official_minecraft_folder() {
        let root = std::env::temp_dir().join(format!("turtle-resource-discovery-{}", uuid_nonce()));
        std::fs::create_dir_all(root.join("data/ModrinthApp")).unwrap();
        std::fs::create_dir_all(root.join("data/com.modrinth.theseus")).unwrap();
        assert_eq!(
            sources_at(&root.join("data"), &root.join("home")),
            vec![
                root.join("data/ModrinthApp"),
                root.join("data/com.modrinth.theseus")
            ]
        );
        assert!(!ready(&root));
        let write = |name: &str, value: Value| {
            std::fs::write(root.join(name), serde_json::to_vec(&value).unwrap()).unwrap()
        };
        write(
            "horizon-resources.json",
            json!({"minecraft":"26.3","schema":7}),
        );
        write("horizon-prepare.json", json!({"output_version":3}));
        assert!(
            !ready(&root),
            "A manifest alone is not usable game resources"
        );
        for file in [
            "facts.json",
            "items.json",
            "cached-collision.nbt",
            "render-definitions.json",
        ] {
            std::fs::write(root.join(file), b"{}").unwrap();
        }
        assert!(ready(&root));
        write(
            "horizon-resources.json",
            json!({"minecraft":"1.21.1","schema":7}),
        );
        assert!(!ready(&root));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn preparation_bundle_rejects_escape_paths() {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file("../outside", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"bad").unwrap();
        let bytes = zip.finish().unwrap().into_inner();
        let root = std::env::temp_dir().join(format!("turtle-resource-unpack-{}", uuid_nonce()));
        std::fs::create_dir(&root).unwrap();
        assert!(unpack(&bytes, &root).is_err());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        std::fs::remove_dir(root).unwrap();
    }
}
