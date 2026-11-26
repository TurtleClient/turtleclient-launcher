//! TurtleClient's native runtime and its own services; independent of Millida APIs.
use crate::engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const BASE: &str = "https://45.133.9.162/turtleclient";
pub(crate) mod update;
mod resources;
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Settings {
    executable: String,
    resources: String,
    game_dir: String,
    #[serde(default)]
    minecraft_source: String,
}
fn settings_file() -> PathBuf {
    engine::data_dir().join("turtleclient.json")
}
fn existing(path: PathBuf) -> Option<String> {
    path.exists().then(|| path.to_string_lossy().into_owned())
}
fn defaults() -> Settings {
    let mut roots = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    let executable = std::env::var("TURTLE_CLIENT")
        .ok()
        .or_else(|| {
            roots.iter().find_map(|root| {
                [
                    root.join("TurtleClient.exe"),
                    root.join("TurtleClient/TurtleClient.exe"),
                    root.join("TurtleClient-Mod/target/fast/horizon-client.exe"),
                    root.join("../TurtleClient-Mod/target/fast/horizon-client.exe"),
                ]
                .into_iter()
                .find_map(existing)
            })
        })
        .unwrap_or_default();
    let resources = std::env::var("TURTLE_RESOURCES").ok().or_else(resources::discover).unwrap_or_default();
    Settings {
        executable,
        resources,
        minecraft_source: resources::default_source(),
        game_dir: engine::data_dir()
            .join("turtleclient/game")
            .to_string_lossy()
            .into_owned(),
    }
}
fn settings() -> Settings {
    let mut config: Settings = std::fs::read(settings_file())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(defaults);
    if config.resources.is_empty() {config.resources=resources::discover().unwrap_or_default();}
    if config.minecraft_source.is_empty() {config.minecraft_source=resources::default_source();}
    config
}
#[tauri::command]
pub async fn turtle_pick_path(field: String) -> Result<Option<String>, String> {
    let path = match field.as_str() {
        "executable" => engine::pick_file(engine::dialog()).await,
        "resources" | "game_dir" | "minecraft_source" => engine::pick_folder(engine::dialog()).await,
        _ => return Err("turtle_action_invalid".into()),
    };
    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}
fn runtime() -> &'static Mutex<Option<Child>> {
    static CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
    CHILD.get_or_init(|| Mutex::new(None))
}
fn running() -> bool {
    let mut slot = runtime().lock().unwrap_or_else(|e| e.into_inner());
    match slot.as_mut().map(Child::try_wait) {
        Some(Ok(None)) => true,
        _ => {
            *slot = None;
            false
        }
    }
}
#[tauri::command]
pub async fn turtle_status() -> Result<Value, String> {
    crate::commands::blocking(|| json!({"settings":settings(),"running":running(),"update":update::status(),"preparation":resources::status()})).await
}
#[tauri::command]
pub async fn turtle_configure(settings: Settings) -> Result<(), String> {
    crate::commands::blocking(move || {
        validate(&settings)?;
        save_settings(&settings)
    })
    .await?
}
fn save_settings(settings: &Settings) -> Result<(),String> {
    std::fs::create_dir_all(engine::data_dir()).map_err(|_|"turtle_settings_failed")?;
    std::fs::write(settings_file(),serde_json::to_vec(settings).map_err(|_|"turtle_settings_failed")?)
        .map_err(|_|"turtle_settings_failed".into())
}
fn validate(settings: &Settings) -> Result<(), String> {
    let exe = Path::new(&settings.executable);
    if !exe.is_absolute() || !exe.is_file() {
        return Err("turtle_executable_missing".into());
    }
    if !matches!(
        exe.file_name().and_then(|s| s.to_str()),
        Some("TurtleClient.exe" | "turtle-client.exe" | "horizon-client.exe" | "TurtleClient" | "horizon-client")
    ) {
        return Err("turtle_executable_invalid".into());
    }
    if !settings.resources.is_empty() && !resources::ready(Path::new(&settings.resources)) {
        return Err("turtle_resources_missing".into());
    }
    if !settings.minecraft_source.is_empty() && (!Path::new(&settings.minecraft_source).is_absolute() || !Path::new(&settings.minecraft_source).is_dir()) {
        return Err("turtle_resources_source_invalid".into());
    }
    if !Path::new(&settings.game_dir).is_absolute() {
        return Err("turtle_game_dir_invalid".into());
    }
    Ok(())
}
async fn profile(account: &str) -> Result<(Value, String), String> {
    if engine::ms_session_refresh(account).await?["status"] != "ok" {
        return Err("turtle_login_required".into());
    }
    let token = engine::mc_token(account).ok_or("turtle_login_required")?;
    let response = engine::client()
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&token)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "turtle_profile_unavailable")?;
    if !response.status().is_success() {
        return Err("turtle_login_required".into());
    }
    let profile: Value = response
        .json()
        .await
        .map_err(|_| "turtle_profile_unavailable")?;
    let uuid = profile["id"].as_str().unwrap_or_default();
    let name = profile["name"].as_str().unwrap_or_default();
    if uuid.len() != 32
        || !uuid.bytes().all(|b| b.is_ascii_hexdigit())
        || name.is_empty()
        || name.len() > 16
    {
        return Err("turtle_profile_unavailable".into());
    }
    Ok((profile, token))
}
#[tauri::command]
pub async fn turtle_launch(account_id: Option<String>, nick: String, join: Option<String>) -> Result<(), String> {
    if join.as_deref().is_some_and(|code| !invite_code_valid(code)) {
        return Err("turtle_action_invalid".into());
    }
    update::before_launch().await?;
    let id = account_id.ok_or("turtle_login_required")?;
    let (p, t) = profile(&id).await?;
    let config = resources::ensure(settings()).await?;
    validate(&config)?;
    let identity = Some(json!({"name":p["name"],"uuid":p["id"],"access_token":t,"user_type":"msa"}));
    if nick.is_empty()
        || nick.len() > 16
        || !nick.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err("turtle_nickname_invalid".into());
    }
    crate::commands::blocking(move || spawn(&config, &nick, identity, join.as_deref())).await??;
    track_playtime(id);
    Ok(())
}
/// A friend's world invite code (horizon-friends): base32 groups joined by dashes.
fn invite_code_valid(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 1024
        && !code.starts_with('-')
        && code.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
/// Closes the native client like its window's close button, so the world is saved; a
/// client that has not exited after 20 seconds is ended.
#[tauri::command]
pub async fn turtle_stop() -> Result<Value, String> {
    let pid = {
        let mut slot = runtime().lock().unwrap_or_else(|e| e.into_inner());
        match slot.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(None) => child.id(),
                _ => return Ok(json!({"running":false})),
            },
            None => return Ok(json!({"running":false})),
        }
    };
    let mut close = if cfg!(windows) { Command::new("taskkill") } else { Command::new("kill") };
    if cfg!(windows) {
        close.args(["/PID", &pid.to_string()]);
    } else {
        close.args(["-TERM", &pid.to_string()]);
    }
    close.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        close.creation_flags(0x08000000);
    }
    let _ = crate::commands::blocking(move || close.status().map(|_| ()).map_err(|e| e.to_string())).await;
    for _ in 0..80 {
        if !running() {
            playtime_wake().notify_one();
            return Ok(json!({"running":false}));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    {
        let mut slot = runtime().lock().unwrap_or_else(|e| e.into_inner());
        if let Some(child) = slot.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *slot = None;
    }
    playtime_wake().notify_one();
    Ok(json!({"running":false}))
}
/// Wakes the playtime tracker early, so a stopped client ends its session at once.
fn playtime_wake() -> &'static tokio::sync::Notify {
    static WAKE: OnceLock<tokio::sync::Notify> = OnceLock::new();
    WAKE.get_or_init(tokio::sync::Notify::new)
}
/// Chat text as Ocean accepts it: 1 to 1000 characters, no control characters but line breaks.
fn chat_text(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()
        && text.chars().count() <= 1000
        && text.len() <= 4000
        && !text.chars().any(|c| c.is_control() && c != '\n'))
    .then(|| text.to_string())
}
/// Friends chat and world invites through Ocean, exactly as the native client uses them.
/// The webview passes only ids it got from Ocean; every path is rebuilt from checked parts.
#[tauri::command]
pub async fn turtle_social(
    account_id: String,
    action: String,
    peer: Option<String>,
    text: Option<String>,
    nonce: Option<String>,
    id: Option<String>,
) -> Result<Value, String> {
    use reqwest::Method;
    if engine::mc_token(&account_id).is_none() {
        return Err("turtle_login_required".into());
    }
    let peer = || peer.clone().filter(|p| valid_uuid(p)).ok_or_else(|| "turtle_action_invalid".to_string());
    match action.as_str() {
        "sync" => ocean(&account_id, Method::GET, "/api/social/sync", None).await,
        "thread" => ocean(&account_id, Method::GET, &format!("/api/social/thread/{}", peer()?), None).await,
        "send" => {
            let text = text.as_deref().and_then(chat_text).ok_or("turtle_action_invalid")?;
            let nonce = nonce.filter(|n| valid_uuid(n)).ok_or("turtle_action_invalid")?;
            ocean(&account_id, Method::POST, &format!("/api/social/thread/{}", peer()?), Some(json!({"text":text,"nonce":nonce}))).await
        }
        "read" => ocean(&account_id, Method::POST, "/api/social/action", Some(json!({"kind":"read","target":peer()?}))).await,
        "image" => {
            use base64::Engine as _;
            let id = id.filter(|i| valid_uuid(i)).ok_or("turtle_action_invalid")?;
            let mut retried = false;
            loop {
                let token = ocean_token(&account_id).await?;
                let mut response = engine::client()
                    .get(format!("{BASE}/api/social/image/{id}"))
                    .bearer_auth(&token)
                    .timeout(Duration::from_secs(20))
                    .send()
                    .await
                    .map_err(|_| "turtle_service_unavailable")?;
                if response.status() == reqwest::StatusCode::UNAUTHORIZED && !retried {
                    ocean_sessions().lock().unwrap_or_else(|e| e.into_inner()).remove(&account_id);
                    retried = true;
                    continue;
                }
                if !response.status().is_success() {
                    return Err(format!("turtle_http_{}", response.status().as_u16()));
                }
                let mut bytes = Vec::new();
                while let Some(chunk) = response.chunk().await.map_err(|_| "turtle_service_unavailable")? {
                    if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                        return Err("turtle_response_invalid".into());
                    }
                    bytes.extend_from_slice(&chunk);
                }
                let kind = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                    "image/png"
                } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
                    "image/gif"
                } else {
                    return Err("turtle_response_invalid".into());
                };
                return Ok(json!({"image":format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes))}));
            }
        }
        _ => Err("turtle_action_invalid".into()),
    }
}

/// A call to the Turtle service with the account's friends session (renewed once on 401).
async fn friends_call(account_id: &str, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    let mut retried = false;
    loop {
        turtle_friends_connect(account_id.to_string()).await?;
        let token = sessions()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(account_id)
            .map(|s| s.token.clone())
            .ok_or("turtle_friends_connect_required")?;
        let result = request(method.clone(), path, body.clone(), Some(&token)).await;
        if result.as_ref().err().is_some_and(|e| e == "turtle_http_401") && !retried {
            sessions().lock().unwrap_or_else(|e| e.into_inner()).remove(account_id);
            retried = true;
            continue;
        }
        return result;
    }
}
/// One playtime heartbeat to the Turtle service with the account's friends session.
async fn playtime_request(account_id: &str, playing: Option<bool>) -> Result<Value, String> {
    match playing {
        Some(playing) => friends_call(account_id, reqwest::Method::POST, "/social/playtime", Some(json!({"playing":playing}))).await,
        None => friends_call(account_id, reqwest::Method::GET, "/social/playtime", None).await,
    }
}
/// Rebuilds a gift note from webview input: the message and which item the gift is.
fn gift_note(note: Value) -> Result<Value, String> {
    let text = |key: &str| note[key].as_str().unwrap_or_default().to_string();
    let item = &note["item"];
    let field = |key: &str| item[key].as_str().unwrap_or_default().to_string();
    let message = text("text");
    if !valid_uuid(&text("id"))
        || !valid_uuid(&text("to"))
        || message.chars().count() > 140
        || field("name").chars().count() > 48
        || !(field("hash").is_empty() || hex(&field("hash"), 64))
    {
        return Err("turtle_action_invalid".into());
    }
    Ok(json!({"id":text("id"),"to":text("to"),"text":message,"item":{"kind":field("kind"),"id":field("id"),"hash":field("hash"),"slot":field("slot"),"name":field("name"),"rarity":field("rarity")}}))
}
/// Gift notes: send one with a gift, or list the notes for and from this player.
#[tauri::command]
pub async fn turtle_gift_notes(account_id: String, note: Option<Value>) -> Result<Value, String> {
    if engine::mc_token(&account_id).is_none() {
        return Err("turtle_login_required".into());
    }
    match note {
        Some(note) => friends_call(&account_id, reqwest::Method::POST, "/social/gift-note", Some(gift_note(note)?)).await,
        None => friends_call(&account_id, reqwest::Method::GET, "/social/gift-notes", None).await,
    }
}
/// While the native client runs, the server credits the time between beats (one a minute);
/// the beat after it exits closes the session. One tracker per launcher process.
fn track_playtime(account_id: String) {
    static TRACKING: OnceLock<Mutex<bool>> = OnceLock::new();
    {
        let mut busy = TRACKING.get_or_init(|| Mutex::new(false)).lock().unwrap_or_else(|e| e.into_inner());
        if *busy {
            return;
        }
        *busy = true;
    }
    tauri::async_runtime::spawn(async move {
        let _ = playtime_request(&account_id, Some(true)).await;
        loop {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(60)) => {}
                _ = playtime_wake().notified() => {}
            }
            let playing = running();
            let _ = playtime_request(&account_id, Some(playing)).await;
            if !playing {
                break;
            }
        }
        *TRACKING.get_or_init(|| Mutex::new(false)).lock().unwrap_or_else(|e| e.into_inner()) = false;
    });
}
/// The player's TurtleClient playtime as the server keeps it, or which friends are playing now.
#[tauri::command]
pub async fn turtle_playtime(account_id: String, friends: Option<bool>) -> Result<Value, String> {
    if engine::mc_token(&account_id).is_none() {
        return Err("turtle_login_required".into());
    }
    if friends == Some(true) {
        return friends_call(&account_id, reqwest::Method::GET, "/social/playtime/friends", None).await;
    }
    playtime_request(&account_id, None).await
}
fn spawn(config: &Settings, nick: &str, identity: Option<Value>, join: Option<&str>) -> Result<(), String> {
    use std::io::Write;
    let mut slot = runtime().lock().unwrap_or_else(|e| e.into_inner());
    if slot
        .as_mut()
        .is_some_and(|c| matches!(c.try_wait(), Ok(None)))
    {
        return Err("turtle_already_running".into());
    }
    let game = PathBuf::from(&config.game_dir);
    std::fs::create_dir_all(&game).map_err(|_| "turtle_game_dir_invalid")?;
    let home = game.join(".turtleclient");
    std::fs::create_dir_all(&home).map_err(|_| "turtle_game_dir_invalid")?;
    let mut command = Command::new(&config.executable);
    command.current_dir(&game).args([
        "--resources",
        &config.resources,
        "--game-dir",
        &config.game_dir,
    ]);
    if let Some(code) = join {
        // The client joins the friend's world at start (Launch API: --quickPlayMultiplayer).
        command.args(["--quickPlayMultiplayer", &format!("friend:{code}")]);
    }
    if identity.is_some() {
        command.arg("--session-stdin").stdin(Stdio::piped());
    } else {
        command.args(["--name", nick]).stdin(Stdio::null());
    }
    command.env("HORIZON_HOME", &home);
    // Never put credentials in the process command line or launcher logs.
    let log =
        std::fs::File::create(home.join("launcher-game.log")).map_err(|_| "turtle_log_failed")?;
    command
        .stdout(log.try_clone().map_err(|_| "turtle_log_failed")?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "turtle_start_failed")?;
    if let Some(identity) = identity {
        let bytes = serde_json::to_vec(&identity).map_err(|_| "turtle_session_failed")?;
        if !child
            .stdin
            .take()
            .is_some_and(|mut pipe| pipe.write_all(&bytes).is_ok())
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err("turtle_session_failed".into());
        }
    }
    *slot = Some(child);
    Ok(())
}
async fn request(
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
    token: Option<&str>,
) -> Result<Value, String> {
    let mut req = engine::client()
        .request(method, format!("{BASE}{path}"))
        .timeout(Duration::from_secs(20));
    if path.starts_with("/api/social/") {
        // Ocean folds Mythic into Legendary for older clients unless asked for the full rarity.
        req = req.header("x-turtle-dj", "1");
    }
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    if let Some(body) = body {
        req = req.json(&body);
    }
    let response = req.send().await.map_err(|_| "turtle_service_unavailable")?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("turtle_http_{}", status.as_u16()));
    }
    if status == reqwest::StatusCode::NO_CONTENT {
        return Ok(Value::Null);
    }
    if response
        .content_length()
        .is_some_and(|n| n > 2 * 1024 * 1024)
    {
        return Err("turtle_response_invalid".into());
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "turtle_service_unavailable")?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("turtle_response_invalid".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "turtle_response_invalid".into())
}
#[tauri::command]
pub async fn turtle_catalog() -> Result<Value, String> {
    let (models, capes) = tokio::try_join!(
        request(reqwest::Method::GET, "/api/cosmetics/catalog", None, None),
        request(reqwest::Method::GET, "/api/cosmetics/capes", None, None)
    )?;
    let categories = request(
        reqwest::Method::GET,
        "/social/wardrobe/categories",
        None,
        None,
    )
    .await?;
    Ok(json!({"models":models["items"],"capes":capes["items"],"free":true,"categories":categories}))
}
#[tauri::command]
pub async fn turtle_wardrobe(
    account_id: String,
    slot: Option<String>,
    item: Option<String>,
) -> Result<Value, String> {
    turtle_friends_connect(account_id.clone()).await?;
    let token = {
        sessions()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&account_id)
            .map(|s| s.token.clone())
            .ok_or("turtle_friends_connect_required")?
    };
    let result = if let Some(slot) = slot {
        request(
            reqwest::Method::POST,
            "/social/wardrobe",
            Some(json!({"slot":slot,"item":item})),
            Some(&token),
        )
        .await
    } else {
        request(reqwest::Method::GET, "/social/wardrobe", None, Some(&token)).await
    };
    if result
        .as_ref()
        .err()
        .is_some_and(|e| e == "turtle_http_401")
    {
        sessions()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&account_id);
    }
    result
}
#[tauri::command]
pub async fn turtle_model(id: String, hash: String) -> Result<Value, String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        || hash.len() != 64
        || !hash.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("turtle_response_invalid".into());
    }
    request(
        reqwest::Method::GET,
        &format!("/api/cosmetics/item/{id}?hash={hash}"),
        None,
        None,
    )
    .await
}
#[tauri::command]
pub async fn turtle_cape(uuid: String) -> Result<Option<String>, String> {
    use base64::Engine as _;
    let hex = uuid.replace('-', "");
    if hex.len() != 32 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("turtle_response_invalid".into());
    }
    let canonical = format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    );
    let mut response = engine::client()
        .get(format!("{BASE}/api/cape/{canonical}"))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "turtle_service_unavailable")?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err("turtle_service_unavailable".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "turtle_service_unavailable")?
    {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err("turtle_response_invalid".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else {
        return Err("turtle_response_invalid".into());
    };
    Ok(Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    )))
}
struct FriendSession {
    token: String,
    expires: Instant,
}
fn sessions() -> &'static Mutex<HashMap<String, FriendSession>> {
    static S: OnceLock<Mutex<HashMap<String, FriendSession>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}
#[tauri::command]
pub async fn turtle_friends_connect(account_id: String) -> Result<Value, String> {
    if engine::mc_token(&account_id).is_none() {
        return Err("turtle_login_required".into());
    }
    if sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&account_id)
        .is_some_and(|s| s.expires > Instant::now())
    {
        return Ok(json!({"connected":true}));
    }
    let (_, minecraft_token) = profile(&account_id).await?;
    let answer = request(
        reqwest::Method::POST,
        "/social/session",
        None,
        Some(&minecraft_token),
    )
    .await?;
    let token = answer["session"]
        .as_str()
        .filter(|t| t.len() == 64 && t.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("turtle_response_invalid")?
        .to_string();
    sessions().lock().unwrap_or_else(|e| e.into_inner()).insert(
        account_id,
        FriendSession {
            token,
            expires: Instant::now() + Duration::from_secs(3500),
        },
    );
    Ok(json!({"connected":true}))
}
#[tauri::command]
pub async fn turtle_friends(
    account_id: String,
    action: String,
    name: Option<String>,
    uuid: Option<String>,
) -> Result<Value, String> {
    if engine::mc_token(&account_id).is_none() {
        return Err("turtle_login_required".into());
    }
    let token = {
        let mut sessions = sessions().lock().unwrap_or_else(|e| e.into_inner());
        sessions.retain(|_, s| s.expires > Instant::now());
        sessions
            .get(&account_id)
            .map(|s| s.token.clone())
            .ok_or("turtle_friends_connect_required")?
    };
    let uuid = uuid.unwrap_or_default();
    if matches!(action.as_str(), "accept" | "reject" | "remove")
        && (uuid.len() != 36 || !uuid.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'))
    {
        return Err("turtle_response_invalid".into());
    }
    let result = match action.as_str() {
        "list" => request(reqwest::Method::GET, "/social/friends", None, Some(&token)).await,
        "request" => {
            request(
                reqwest::Method::POST,
                "/social/friends/request",
                Some(json!({"name":name.unwrap_or_default()})),
                Some(&token),
            )
            .await
        }
        "accept" | "reject" => {
            request(
                reqwest::Method::POST,
                "/social/friends/decision",
                Some(json!({"uuid":uuid,"accept":action=="accept"})),
                Some(&token),
            )
            .await
        }
        "remove" => {
            request(
                reqwest::Method::DELETE,
                &format!("/social/friends/{uuid}"),
                None,
                Some(&token),
            )
            .await
        }
        _ => Err("turtle_action_invalid".into()),
    };
    if result
        .as_ref()
        .err()
        .is_some_and(|e| e == "turtle_http_401")
    {
        sessions()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&account_id);
    }
    result
}

/// Ocean shop session. Same sign-in as the native client: Ocean issues a challenge,
/// the Minecraft session service confirms the join and Ocean returns its own token.
/// The token stays in this process; the webview never sees it.
struct OceanSession {
    token: String,
    expires: Instant,
}
fn ocean_sessions() -> &'static Mutex<HashMap<String, OceanSession>> {
    static S: OnceLock<Mutex<HashMap<String, OceanSession>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}
fn ocean_cached(account_id: &str) -> Option<String> {
    let mut sessions = ocean_sessions().lock().unwrap_or_else(|e| e.into_inner());
    sessions.retain(|_, s| s.expires > Instant::now());
    sessions.get(account_id).map(|s| s.token.clone())
}
fn hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| b.is_ascii_hexdigit())
}
fn valid_uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
async fn ocean_token(account_id: &str) -> Result<String, String> {
    if let Some(token) = ocean_cached(account_id) {
        return Ok(token);
    }
    // One sign-in at a time: Ocean allows only a few open challenges per name.
    static LOGIN: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    let _guard = LOGIN.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
    if let Some(token) = ocean_cached(account_id) {
        return Ok(token);
    }
    let (profile, minecraft_token) = profile(account_id).await?;
    let name = profile["name"].as_str().unwrap_or_default().to_string();
    let uuid = profile["id"].as_str().unwrap_or_default().to_string();
    let start = request(
        reqwest::Method::POST,
        "/api/social/auth/start",
        Some(json!({"name":name})),
        None,
    )
    .await?;
    let server_id = start["server_id"]
        .as_str()
        .filter(|s| hex(s, 32))
        .ok_or("turtle_response_invalid")?
        .to_string();
    let joined = engine::client()
        .post("https://sessionserver.mojang.com/session/minecraft/join")
        .json(&json!({"accessToken":minecraft_token,"selectedProfile":uuid,"serverId":server_id}))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "turtle_service_unavailable")?;
    if !joined.status().is_success() {
        return Err("turtle_shop_session_denied".into());
    }
    let finish = request(
        reqwest::Method::POST,
        "/api/social/auth/finish",
        Some(json!({"name":name,"server_id":server_id})),
        None,
    )
    .await
    .map_err(|e| if e == "turtle_http_401" { "turtle_shop_session_denied".into() } else { e })?;
    let token = finish["token"]
        .as_str()
        .filter(|t| hex(t, 64))
        .ok_or("turtle_response_invalid")?
        .to_string();
    ocean_sessions().lock().unwrap_or_else(|e| e.into_inner()).insert(
        account_id.to_string(),
        OceanSession {
            token: token.clone(),
            // Ocean keeps sessions for six hours; renew a little earlier.
            expires: Instant::now() + Duration::from_secs(5 * 3600 + 1800),
        },
    );
    Ok(token)
}
async fn ocean(
    account_id: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let mut retried = false;
    loop {
        let token = ocean_token(account_id).await?;
        let result = request(method.clone(), path, body.clone(), Some(&token)).await;
        if result.as_ref().err().is_some_and(|e| e == "turtle_http_401") {
            ocean_sessions()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(account_id);
            if !retried {
                retried = true;
                continue;
            }
        }
        return result;
    }
}
/// Rebuilds a purchasable product from untrusted webview input.
fn shop_product(value: Option<Value>) -> Result<Value, String> {
    let value = value.ok_or("turtle_action_invalid")?;
    let field = |key: &str| value[key].as_str().unwrap_or_default().to_string();
    let (kind, id, hash, owner) = (field("kind"), field("id"), field("hash"), field("owner"));
    let id_ok = !id.is_empty()
        && id.len() <= 96
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !matches!(
        kind.as_str(),
        "model" | "cape" | "aura" | "trail" | "emote" | "pet" | "promo_bundle"
    ) || !id_ok
        || !(hash.is_empty() || hex(&hash, 64))
        || !(owner.is_empty() || owner == "turtle" || valid_uuid(&owner))
    {
        return Err("turtle_action_invalid".into());
    }
    Ok(json!({"kind":kind,"id":id,"hash":hash,"owner":owner}))
}
/// Ocean's wardrobe change: up to three models per body slot, one aura, trail and name tag.
fn shop_equip(slot: Option<String>, hash: Option<String>, equipped: Option<bool>) -> Result<Value, String> {
    let slot = slot.unwrap_or_default();
    if !matches!(
        slot.as_str(),
        "head" | "back" | "torso" | "shoulder" | "name_tag" | "aura" | "trail" | "team_cape"
    ) || hash.as_deref().is_some_and(|h| !hex(h, 64))
        || (equipped.is_some() && hash.is_none())
        || (slot == "team_cape" && equipped.is_none())
    {
        return Err("turtle_action_invalid".into());
    }
    Ok(json!({"slot":slot,"hash":hash,"equipped":equipped}))
}
/// MiniMe: `null` puts it away; otherwise the player it copies, its mode and personality.
fn shop_pet(pet: Option<Value>) -> Result<Value, String> {
    let Some(pet) = pet.filter(|p| !p.is_null()) else {
        return Ok(Value::Null);
    };
    let uuid = pet["uuid"].as_str().unwrap_or_default();
    let name = pet["name"].as_str().unwrap_or_default();
    let mode = pet["mode"].as_u64().unwrap_or(0);
    let personality = pet["personality"].as_u64().unwrap_or(0);
    if !valid_uuid(uuid)
        || !(3..=16).contains(&name.len())
        || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        || mode > 2
        || personality > 3
    {
        return Err("turtle_action_invalid".into());
    }
    Ok(json!({"uuid":uuid,"name":name,"mode":mode,"personality":personality}))
}
/// Preview data for every cosmetic kind: an emote or pet clip, or a published shop asset
/// (a Turtle model or a custom emote as JSON, a cape as an image data URL).
#[tauri::command]
pub async fn turtle_preview_data(clip: Option<String>, asset: Option<String>) -> Result<Value, String> {
    if let Some(clip) = clip {
        if clip.is_empty()
            || clip.len() > 64
            || !clip
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        {
            return Err("turtle_action_invalid".into());
        }
        return request(reqwest::Method::GET, &format!("/previews/{clip}.json"), None, None).await;
    }
    use base64::Engine as _;
    let hash = asset.filter(|h| hex(h, 64)).ok_or("turtle_action_invalid")?;
    let mut response = engine::client()
        .get(format!("{BASE}/api/shop/asset/{hash}"))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "turtle_service_unavailable")?;
    if !response.status().is_success() {
        return Err(format!("turtle_http_{}", response.status().as_u16()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "turtle_service_unavailable")?
    {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err("turtle_response_invalid".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let image = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else {
        None
    };
    if let Some(mime) = image {
        return Ok(json!({"image": format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes))}));
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "turtle_response_invalid")?;
    Ok(json!({"json": value}))
}
fn valid_favorites(list: &[String]) -> bool {
    list.len() <= 64
        && list.iter().enumerate().all(|(i, id)| {
            !id.is_empty()
                && id.len() <= 64
                && id
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
                && !list[..i].contains(id)
        })
}
/// The emote wheel lives in the client's own `config/turtleclient.json` (`emote_favorites`).
/// The launcher reads it, and writes only that key while the client is closed, so a running
/// game cannot overwrite the change when it saves its settings.
#[tauri::command]
pub async fn turtle_emote_wheel(favorites: Option<Vec<String>>) -> Result<Value, String> {
    crate::commands::blocking(move || {
        let file = PathBuf::from(settings().game_dir).join("config").join("turtleclient.json");
        let mut config: Value = match std::fs::read(&file) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "turtle_client_config_invalid")?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err("turtle_client_config_missing".to_string())
            }
            Err(_) => return Err("turtle_client_config_invalid".into()),
        };
        if !config.is_object() {
            return Err("turtle_client_config_invalid".into());
        }
        if let Some(list) = favorites {
            if !valid_favorites(&list) {
                return Err("turtle_action_invalid".into());
            }
            if running() {
                return Err("turtle_already_running".into());
            }
            config["emote_favorites"] = json!(list);
            let bytes = serde_json::to_vec_pretty(&config).map_err(|_| "turtle_client_config_invalid")?;
            let tmp = file.with_extension("json.launcher");
            std::fs::write(&tmp, bytes)
                .and_then(|_| std::fs::rename(&tmp, &file))
                .map_err(|_| "turtle_client_config_invalid")?;
        }
        let favorites = config["emote_favorites"]
            .as_array()
            .map(|rows| rows.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect::<Vec<_>>())
            .unwrap_or_default();
        Ok(json!({"favorites":favorites,"running":running()}))
    })
    .await?
}
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn turtle_shop(
    account_id: String,
    action: String,
    product: Option<Value>,
    peer: Option<String>,
    id: Option<String>,
    name: Option<String>,
    accept: Option<bool>,
    agreed: Option<u32>,
    slot: Option<String>,
    hash: Option<String>,
    equipped: Option<bool>,
    pet: Option<Value>,
) -> Result<Value, String> {
    if engine::mc_token(&account_id).is_none() {
        return Err("turtle_login_required".into());
    }
    if action == "equip" {
        let body = shop_equip(slot, hash, equipped)?;
        return ocean(&account_id, reqwest::Method::POST, "/api/social/shop/equip", Some(body)).await;
    }
    if action == "pet" {
        let body = shop_pet(pet)?;
        return ocean(&account_id, reqwest::Method::POST, "/api/social/pet", Some(body)).await;
    }
    let peer = peer.unwrap_or_default();
    let id = id.unwrap_or_default();
    let needs_peer = matches!(action.as_str(), "quote" | "gift");
    let needs_id = matches!(action.as_str(), "gift" | "answer");
    if (needs_peer && !valid_uuid(&peer)) || (needs_id && !valid_uuid(&id)) {
        return Err("turtle_action_invalid".into());
    }
    use reqwest::Method;
    match action.as_str() {
        "inventory" => ocean(&account_id, Method::GET, "/api/social/shop/inventory", None).await,
        "buy" => {
            let product = shop_product(product)?;
            ocean(&account_id, Method::POST, "/api/social/shop/buy", Some(product)).await
        }
        "daily" => {
            ocean(
                &account_id,
                Method::POST,
                "/api/social/shop/buy",
                Some(json!({"kind":"daily_reward","id":"daily_reward","hash":"","owner":""})),
            )
            .await
        }
        "quote" => {
            let product = shop_product(product)?;
            ocean(
                &account_id,
                Method::POST,
                "/api/social/exchange/quote",
                Some(json!({"peer":peer,"product":product})),
            )
            .await
        }
        "gift" => {
            let product = shop_product(product)?;
            let label = name.unwrap_or_default();
            if label.is_empty()
                || label.trim() != label
                || label.chars().count() > 48
                || label.chars().any(char::is_control)
            {
                return Err("turtle_action_invalid".into());
            }
            let agreed = agreed.ok_or("turtle_action_invalid")?;
            ocean(
                &account_id,
                Method::POST,
                "/api/social/exchange",
                Some(json!({"peer":peer,"nonce":id,"offer":{"kind":"gift","name":label,"product":product},"agreed":agreed})),
            )
            .await
        }
        "gifts" => {
            let all = ocean(&account_id, Method::GET, "/api/social/exchange", None).await?;
            // Workshop deliveries share this route; the shop only shows gifts.
            let gifts: Vec<Value> = all["inbox"]
                .as_array()
                .map(|rows| rows.iter().filter(|r| r["kind"] == "gift").cloned().collect())
                .unwrap_or_default();
            Ok(json!({"me":all["me"],"gifts":gifts}))
        }
        "answer" => {
            ocean(
                &account_id,
                Method::POST,
                &format!("/api/social/exchange/{id}"),
                Some(json!({"accept":accept.unwrap_or(false)})),
            )
            .await
        }
        _ => Err("turtle_action_invalid".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_process_receives_session_privately_and_refuses_duplicate_launch() {
        use aes_gcm::aead::{rand_core::RngCore, OsRng};
        let mut bytes = [0u8; 12];
        OsRng.fill_bytes(&mut bytes);
        let suffix: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let home = std::env::temp_dir().join(format!("turtle-native-{suffix}"));
        std::fs::create_dir_all(home.join("resources")).unwrap();
        for file in ["facts.json", "items.json", "cached-collision.nbt", "render-definitions.json"] {
            std::fs::write(home.join("resources").join(file), b"{}").unwrap();
        }
        std::fs::write(home.join("resources/horizon-resources.json"), br#"{"minecraft":"26.3","schema":7}"#).unwrap();
        std::fs::write(home.join("resources/horizon-prepare.json"), br#"{"output_version":3}"#).unwrap();
        let exe = home.join(if cfg!(windows) {
            "TurtleClient.exe"
        } else {
            "TurtleClient"
        });
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/turtle_native.rs");
        assert!(Command::new("rustc")
            .arg(source)
            .arg("-o")
            .arg(&exe)
            .status()
            .unwrap()
            .success());
        let config = Settings {
            minecraft_source: String::new(),
            executable: exe.to_string_lossy().into_owned(),
            resources: home.join("resources").to_string_lossy().into_owned(),
            game_dir: home.join("game").to_string_lossy().into_owned(),
        };
        validate(&config).unwrap();
        let session = json!({"name":"FixturePlayer","uuid":"00000000000000000000000000000001","access_token":"fixture-private-token","user_type":"msa"});
        spawn(&config, "FixturePlayer", Some(session), None).unwrap();
        let marker = home.join("game/.turtleclient/fixture-ready");
        let deadline = Instant::now() + Duration::from_secs(10);
        while !marker.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let received = marker.exists();
        let duplicate = spawn(&config, "FixturePlayer", None, None);
        // Always reap our fixture, even when an assertion will report a failure.
        {
            let mut slot = runtime().lock().unwrap();
            if let Some(child) = slot.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *slot = None;
        }
        std::fs::remove_dir_all(home).unwrap();
        assert!(
            received,
            "the native executable never received the account session"
        );
        assert_eq!(duplicate, Err("turtle_already_running".into()));
    }
    #[test]
    fn shop_products_are_rebuilt_from_known_fields_only() {
        assert!(invite_code_valid("K7QM3-XPD2A"));
        for bad in ["", "-x", "a b", "a;b", "friend:K7QM"] {
            assert!(!invite_code_valid(bad), "{bad}");
        }
        assert!(!invite_code_valid(&"A".repeat(1025)));
        assert_eq!(chat_text("  hi\nthere ").as_deref(), Some("hi\nthere"));
        assert!(chat_text("   ").is_none());
        assert!(chat_text("a\u{7}b").is_none());
        assert!(chat_text(&"x".repeat(1001)).is_none());
        let hash = "a".repeat(64);
        let clean = shop_product(Some(json!({"kind":"model","id":"angel_halo","hash":hash,"owner":"turtle","extra":"dropped"}))).unwrap();
        assert_eq!(clean, json!({"kind":"model","id":"angel_halo","hash":hash,"owner":"turtle"}));
        let bundle = shop_product(Some(json!({"kind":"promo_bundle","id":"angel_bundle"}))).unwrap();
        assert_eq!(bundle["hash"], "");
        for bad in [
            json!({"kind":"test_shells","id":"x","hash":"","owner":""}),
            json!({"kind":"daily_reward","id":"daily_reward","hash":"","owner":""}),
            json!({"kind":"model","id":"../x","hash":"","owner":""}),
            json!({"kind":"model","id":"x","hash":"zz","owner":""}),
            json!({"kind":"cape","id":"x","hash":hash,"owner":"not-a-uuid"}),
        ] {
            assert_eq!(shop_product(Some(bad)), Err("turtle_action_invalid".into()));
        }
        let hash = "b".repeat(64);
        assert_eq!(shop_equip(Some("back".into()), Some(hash.clone()), Some(true)).unwrap(), json!({"slot":"back","hash":hash,"equipped":true}));
        assert_eq!(shop_equip(Some("aura".into()), None, None).unwrap()["hash"], Value::Null);
        assert!(shop_equip(Some("emote".into()), Some(hash.clone()), Some(true)).is_err());
        assert!(shop_equip(Some("head".into()), None, Some(true)).is_err());
        assert!(shop_equip(Some("team_cape".into()), Some(hash.clone()), None).is_err());
        assert_eq!(shop_pet(None).unwrap(), Value::Null);
        assert_eq!(shop_pet(Some(json!({"uuid":"00000000-0000-0000-0000-000000000001","name":"Turtle_1","mode":1,"personality":2,"x":1}))).unwrap(), json!({"uuid":"00000000-0000-0000-0000-000000000001","name":"Turtle_1","mode":1,"personality":2}));
        assert!(shop_pet(Some(json!({"uuid":"00000000-0000-0000-0000-000000000001","name":"no spaces","mode":0,"personality":0}))).is_err());
        assert!(shop_pet(Some(json!({"uuid":"00000000-0000-0000-0000-000000000001","name":"Turtle","mode":3,"personality":0}))).is_err());
        let note = json!({"id":"00000000-0000-4000-8000-000000000001","to":"00000000-0000-0000-0000-000000000002","text":"Viel Spaß!","item":{"kind":"aura","id":"demon_aura","hash":"","slot":"aura","name":"Infernal Aura","rarity":"epic","extra":1},"x":1});
        let clean = gift_note(note.clone()).unwrap();
        assert_eq!(clean["item"].as_object().unwrap().len(), 6);
        assert!(clean.get("x").is_none());
        let mut long = note.clone();
        long["text"] = json!("x".repeat(141));
        assert!(gift_note(long).is_err());
        let mut stranger = note;
        stranger["to"] = json!("someone");
        assert!(gift_note(stranger).is_err());
        assert!(valid_favorites(&["wave".into(), "spooky_dance".into()]));
        assert!(!valid_favorites(&["wave".into(), "wave".into()]));
        assert!(!valid_favorites(&["../x".into()]));
        assert!(valid_uuid("00000000-0000-0000-0000-000000000001"));
        assert!(!valid_uuid("000000000000000000000000000000001"));
        assert!(!valid_uuid("00000000-0000-0000-0000-00000000000g"));
    }
}
