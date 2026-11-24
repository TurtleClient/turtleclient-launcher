# Turtle bootstrap installer

`TurtleClient-Setup.exe` is the recommended Windows x64 download for a first
installation. It is a small native Rust application with Turtle artwork,
German/English UI, folder selection and download progress. Its UI does not need
WebView2. The launcher payload installs WebView2 when it is missing.

The bootstrap always reads the official launcher's `latest.json`, downloads the
Windows NSIS package, verifies its Minisign signature using the same pinned public
key as the installed launcher, and installs it for the current Windows user.
The selected destination is passed directly to NSIS, including paths with spaces.
There is no shell command interpolation. Downloads are staged in a unique temporary
directory and cleaned up on completion or cancellation. A newer installed version
is never replaced with an older release.

The installer offers shortcut creation and opening the launcher after installation.
It detects an existing per-user installation and uses its folder by default.
It does not remove accounts or game folders. A download can be cancelled; once
NSIS is writing the installation, closing the bootstrap waits for completion.

## Later updates

The bootstrap is only needed for first installation or repair. The installed
launcher's existing boot update check and background updater install subsequent
signed releases. Players do not need to download or run Setup again for each
update. Failed network checks leave the installed launcher usable.

`latest.json` must keep pointing at the versioned **NSIS** package, not the
bootstrap. Its signature belongs to that package. The release workflow adds the
bootstrap, its separate `.sig`, and its SHA-256 file to the same draft release
before publishing the complete release. Windows certificate/Authenticode signing
is separate from this update signature.

## Build and verification (Windows)

The installer is a separate Cargo workspace to avoid pulling the full launcher
and WebView stack into its executable. From the repository root:

```powershell
cargo fmt --manifest-path installer/bootstrap/Cargo.toml --check
cargo clippy --manifest-path installer/bootstrap/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path installer/bootstrap/Cargo.toml --locked
cargo build --manifest-path installer/bootstrap/Cargo.toml --locked --release
```

The binary provides non-installing verification commands. These do not open a
launcher, change the registry, create shortcuts or install a game:

```powershell
# Download and verify the currently published NSIS package; never execute it.
installer/bootstrap/target/release/turtleclient-setup.exe --verify-latest
# Verify a signed Windows executable with the pinned production key.
installer/bootstrap/target/release/turtleclient-setup.exe --verify-file payload.exe payload.exe.sig
# Render the exact native UI without opening a window or using the network.
installer/bootstrap/target/release/turtleclient-setup.exe --render-preview welcome.png welcome
```

Preview states: `welcome`, `downloading`, `installing`, `done`, `error`.
The Windows GUI subsystem may return immediately from interactive PowerShell;
use `Start-Process -Wait -PassThru -WindowStyle Hidden` when checking exit codes,
and redirect standard output when collecting the verification JSON.

Tests cover valid and altered signatures, a foreign trust root, release URL and
version restrictions, invalid destinations, visible control hit areas, and native
rendering in both languages. Fonts retain their bundled OFL notices. The public
signature test vector retains the upstream Minisign verification library's MIT
notice. Production private keys remain in the existing GitHub Actions secret.
