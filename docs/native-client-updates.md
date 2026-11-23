# Native TurtleClient updates

The launcher checks `https://45.133.9.162/turtleclient/client/latest.json` on every
launcher start and again before starting the native game. A new client is downloaded
and installed automatically. The existing Play button displays checking, download
progress and installation states. Settings → Game also offers a manual check.

This channel updates the **game client**, independently of the launcher's own updater.
The channel serves Windows x64 / Minecraft 26.3 independently of the launcher version.

## Preparing and publishing a native release

Build and validate the complete game update first. Use
`python scripts/publish-native-client.py --prepare-only --client-repo PATH` to package
only the native executable and license notices. This writes `client.zip` and
`manifest-payload.json` without requiring a local signing key.

Stage the verified archive with `services/client-updates/deploy.py --stage-only`.
Staging exposes its immutable, digest-addressed download but never changes the live
`latest.json`. Copy the payload to `native-client-release.json` and push the dedicated
`codex/latest-client-and-website-download` branch. `sign-native-client.yml` verifies
the archive and executable hashes, then signs the manifest inside GitHub Actions
using the existing repository signing secret. It does not publish a release.

Download `signed-native-manifest`, verify its signature against the public key
compiled into the released launcher, and publish it with the same deployment tool
without `--stage-only`. The final manifest switch is atomic. Never replace it with
an unsigned payload, and keep its sequence monotonically increasing. Before every
Start the launcher checks this channel; an intact installed client remains usable
when the network is unavailable.

## Installation and integrity

The manifest contains a base64 payload and a Minisign signature. Verification uses
the public update key compiled into the launcher. The signed payload fixes the
platform, Minecraft version, increasing release sequence, archive URL, byte count,
archive SHA-256 and executable SHA-256. URLs are restricted to this server's release
directory. Redirects, unsigned or modified manifests and release rollback are rejected.

The archive is downloaded to a staging directory and checked before extraction.
Only `TurtleClient.exe`, the base-version metadata and license notices are accepted.
Absolute paths, directory traversal, symlinks, unexpected binaries and Minecraft
asset/jar files cannot be installed. A failed update leaves the current install usable.

Each release gets a separate directory under the launcher's data directory:
`turtleclient/runtime/versions/`. `current.json` points to the current checked release.
Running executables are not overwritten. Previous releases remain on disk. Game
directories, saves, options and accounts are separate and are not replaced.

If the server is unavailable, an intact previously managed install can still start.
On the first installation, a successful download is required. Minecraft resources
are **not** distributed: retain/select the player's own prepared Minecraft 26.3
resource directory in Settings → Game. Existing configured resources and game paths
are preserved. Developers can explicitly set `TURTLE_CLIENT_NO_UPDATE=1` to use a
manually built client without installing managed releases.

## Publishing the next client

Build the client in the separate TurtleClient-Mod repository first. From this
launcher repository, run:

```powershell
python scripts/publish-native-client.py --publish
```

The defaults use the sibling repository, its `target/fast/turtle-client.exe` and
`turtleclient-base.json`. Use `--binary` and `--client-repo` for another checkout.
The signing key remains outside both repositories under
`%LOCALAPPDATA%/TurtleClient/ReleaseKeys/launcher-updater/updater.key` (override with
`--key-file`). It is never uploaded to the VPS. Without `--publish`, the script only
prepares the signed release in the client's ignored `.local/client-releases/`.

The package explicitly includes the native executable and its MIT/third-party
notices. It never walks a game installation or copies prepared Minecraft resources.
The upload script installs its own static nginx locations, validates nginx, reloads
nginx and atomically switches `latest.json` after the artifact exists. Ocean and
Friends are not restarted. Configurations are backed up under
`/var/backups/turtleclient/client-updates-<timestamp>`.

The server files are `/var/lib/turtleclient/client/latest.json` and
`/var/lib/turtleclient/client/releases/<archive-sha256>/client.zip`.

## Verification

`cargo test --manifest-path src-tauri/Cargo.toml --locked --lib turtleclient::update::tests`
checks the signature fixture, tampering, archive restrictions and damaged installs
in isolated temporary directories. The ignored
`public_release_installs_in_an_isolated_directory` test additionally downloads,
verifies and extracts the actual public release, without running the game or touching
real player data.
