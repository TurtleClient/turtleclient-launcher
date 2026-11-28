//! Serialized field updates and recoverable, atomic native-runtime settings.
use super::Settings;
use std::{path::Path, sync::Mutex};

static LOCK: Mutex<()> = Mutex::new(());

fn decode(bytes: &[u8], defaults: &Settings) -> Option<Settings> {
    let mut value: Settings = serde_json::from_slice(bytes).ok()?;
    if value.executable.is_empty() {
        value.executable.clone_from(&defaults.executable);
    }
    if value.game_dir.is_empty() {
        value.game_dir.clone_from(&defaults.game_dir);
    }
    Some(value)
}

fn read(path: &Path, defaults: &Settings) -> Result<Settings, String> {
    match std::fs::read(path) {
        Ok(bytes) => decode(&bytes, defaults)
            .or_else(|| {
                std::fs::read(path.with_extension("json.bak"))
                    .ok()
                    .and_then(|b| decode(&b, defaults))
            })
            .ok_or_else(|| "turtle_settings_corrupt".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(std::fs::read(path.with_extension("json.bak"))
                .ok()
                .and_then(|b| decode(&b, defaults))
                .unwrap_or_else(|| defaults.clone()))
        }
        Err(_) => Err("turtle_settings_failed".into()),
    }
}

pub(super) fn load(path: &Path, defaults: &Settings) -> Result<Settings, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    read(path, defaults)
}

pub(super) fn update(
    path: &Path,
    defaults: &Settings,
    edit: impl FnOnce(&mut Settings) -> Result<(), String>,
) -> Result<Settings, String> {
    edit_locked(path, defaults, edit, false)
}

/// Only an explicit settings save may replace unrecoverable legacy JSON.
/// Keep that original file for recovery rather than silently discarding it.
pub(super) fn configure(
    path: &Path,
    defaults: &Settings,
    edit: impl FnOnce(&mut Settings) -> Result<(), String>,
) -> Result<Settings, String> {
    edit_locked(path, defaults, edit, true)
}

fn edit_locked(
    path: &Path,
    defaults: &Settings,
    edit: impl FnOnce(&mut Settings) -> Result<(), String>,
    repair: bool,
) -> Result<Settings, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut current = match read(path, defaults) {
        Ok(current) => current,
        Err(error) if repair && error == "turtle_settings_corrupt" => defaults.clone(),
        Err(error) => return Err(error),
    };
    let old = serde_json::to_vec(&current).map_err(|_| "turtle_settings_failed")?;
    edit(&mut current)?;
    let new = serde_json::to_vec(&current).map_err(|_| "turtle_settings_failed")?;
    let primary_valid = std::fs::read(path)
        .ok()
        .and_then(|bytes| decode(&bytes, defaults))
        .is_some();
    if old != new || !primary_valid {
        if !primary_valid && path.exists() {
            let original = std::fs::read(path).map_err(|_| "turtle_settings_failed")?;
            crate::engine::write_bytes_atomic(&path.with_extension("json.corrupt"), &original)
                .map_err(|_| "turtle_settings_failed")?;
        }
        let previous = if path.exists() { &old } else { &new };
        crate::engine::write_bytes_atomic(&path.with_extension("json.bak"), previous)
            .map_err(|_| "turtle_settings_failed")?;
        crate::engine::write_bytes_atomic(path, &new).map_err(|_| "turtle_settings_failed")?;
    }
    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn defaults() -> Settings {
        Settings {
            executable: "managed-client".into(),
            game_dir: "custom-worlds".into(),
            ..Default::default()
        }
    }
    fn scratch() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "turtle-settings-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        root
    }
    #[test]
    fn partial_and_future_fields_survive_independent_updates() {
        let root = scratch();
        let path = root.join("config.json");
        std::fs::write(
            &path,
            br#"{"game_dir":"my-worlds","future":{"enabled":true}}"#,
        )
        .unwrap();
        update(&path, &defaults(), |s| {
            s.executable = "new-client".into();
            Ok(())
        })
        .unwrap();
        update(&path, &defaults(), |s| {
            s.resources = "prepared".into();
            Ok(())
        })
        .unwrap();
        let loaded = load(&path, &defaults()).unwrap();
        assert_eq!(loaded.game_dir, "my-worlds");
        assert_eq!(loaded.executable, "new-client");
        assert_eq!(loaded.resources, "prepared");
        assert_eq!(loaded.extra["future"]["enabled"], true);
    }
    #[test]
    fn interrupted_json_recovers_without_replacing_custom_paths_with_defaults() {
        let root = scratch();
        let path = root.join("config.json");
        update(&path, &defaults(), |s| {
            s.game_dir = "keep-my-worlds".into();
            Ok(())
        })
        .unwrap();
        std::fs::write(&path, b"{\"game_dir\":").unwrap();
        assert_eq!(load(&path, &defaults()).unwrap().game_dir, "keep-my-worlds");
        update(&path, &defaults(), |_| Ok(())).unwrap();
        assert!(serde_json::from_slice::<Settings>(&std::fs::read(&path).unwrap()).is_ok());
        assert_eq!(load(&path, &defaults()).unwrap().game_dir, "keep-my-worlds");
    }
    #[test]
    fn concurrent_writers_keep_each_others_changes() {
        let root = scratch();
        let path = root.join("config.json");
        let jobs: Vec<_> = (0..12)
            .map(|i| {
                let p = path.clone();
                std::thread::spawn(move || {
                    update(&p, &defaults(), |s| {
                        s.extra.insert(format!("field-{i}"), i.into());
                        Ok(())
                    })
                    .unwrap();
                })
            })
            .collect();
        for job in jobs {
            job.join().unwrap();
        }
        assert_eq!(load(&path, &defaults()).unwrap().extra.len(), 12);
    }
    #[test]
    fn invalid_legacy_file_is_preserved_and_only_an_explicit_save_repairs_it() {
        let root = scratch();
        let path = root.join("config.json");
        std::fs::write(&path, b"broken legacy file").unwrap();
        assert!(update(&path, &defaults(), |_| Ok(())).is_err());
        configure(&path, &defaults(), |s| {
            s.game_dir = "chosen-worlds".into();
            Ok(())
        })
        .unwrap();
        assert_eq!(load(&path, &defaults()).unwrap().game_dir, "chosen-worlds");
        assert_eq!(
            std::fs::read(path.with_extension("json.corrupt")).unwrap(),
            b"broken legacy file"
        );
    }
}
