//! Gift notes: the message a player writes to a friend with a shop gift, and which item it
//! is, so the recipient's launcher can show the message and reveal the item. Ocean keeps
//! the gift itself; this only stores the note, keyed by the gift's id (the sender's nonce).
use super::{authenticated, lock, Shared};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const KEEP: u64 = 30 * 86_400;
const MAX_TEXT: usize = 140;
const PER_SENDER: usize = 64;
const TOTAL: usize = 20_000;

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
pub(crate) struct Item {
    kind: String,
    id: String,
    hash: String,
    slot: String,
    name: String,
    rarity: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Note {
    from: Uuid,
    to: Uuid,
    text: String,
    item: Item,
    at: u64,
}
#[derive(Default, Serialize, Deserialize)]
struct Store {
    notes: BTreeMap<Uuid, Note>,
}
pub(crate) struct Notes {
    store: Store,
    file: PathBuf,
}
impl Notes {
    pub(crate) fn load(file: PathBuf) -> std::io::Result<Self> {
        let store = match std::fs::read(&file) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(std::io::Error::other)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Store::default(),
            Err(e) => return Err(e),
        };
        Ok(Self { store, file })
    }
    fn save(&self) -> Result<(), StatusCode> {
        let bytes = serde_json::to_vec(&self.store).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let tmp = self.file.with_extension("tmp");
        std::fs::write(&tmp, bytes)
            .and_then(|_| std::fs::rename(tmp, &self.file))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    }
}
fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
/// Trimmed, single-line, at most 140 characters, no control characters.
pub(crate) fn clean_text(text: &str) -> Option<String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (text.chars().count() <= MAX_TEXT && !text.chars().any(char::is_control)).then_some(text)
}
pub(crate) fn valid_item(item: &Item) -> bool {
    let token = |s: &str, max: usize| !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
    matches!(item.kind.as_str(), "model" | "cape" | "aura" | "trail" | "emote" | "pet")
        && (token(&item.id, 96) || (item.kind == "cape" && item.id.len() == 64 && item.id.bytes().all(|b| b.is_ascii_hexdigit())))
        && (item.hash.is_empty() || (item.hash.len() == 64 && item.hash.bytes().all(|b| b.is_ascii_hexdigit())))
        && (item.slot.is_empty() || token(&item.slot, 16))
        && !item.name.trim().is_empty()
        && item.name.chars().count() <= 48
        && !item.name.chars().any(char::is_control)
        && matches!(item.rarity.as_str(), "common" | "rare" | "epic" | "legendary" | "mythic")
}

#[derive(Clone)]
struct GiftNotes {
    auth: Shared,
    notes: Arc<Mutex<Notes>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Send {
    id: Uuid,
    to: Uuid,
    text: String,
    item: Item,
}
async fn send(State(state): State<GiftNotes>, headers: HeaderMap, Json(body): Json<Send>) -> Result<StatusCode, StatusCode> {
    let me = {
        let mut auth = lock(&state.auth)?;
        let me = authenticated(&mut auth, &headers)?;
        // Only friends can leave each other a note, as only friends can send each other gifts.
        if me == body.to || !auth.database.users.get(&me).is_some_and(|u| u.friends.contains(&body.to)) {
            return Err(StatusCode::FORBIDDEN);
        }
        me
    };
    let text = clean_text(&body.text).ok_or(StatusCode::BAD_REQUEST)?;
    if !valid_item(&body.item) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut notes = state.notes.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let at = now();
    notes.store.notes.retain(|_, note| at.saturating_sub(note.at) < KEEP);
    if let Some(old) = notes.store.notes.get(&body.id) {
        if old.from != me || old.to != body.to {
            return Err(StatusCode::CONFLICT);
        }
    } else if notes.store.notes.len() >= TOTAL || notes.store.notes.values().filter(|n| n.from == me).count() >= PER_SENDER {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    notes.store.notes.insert(body.id, Note { from: me, to: body.to, text, item: body.item, at });
    notes.save()?;
    Ok(StatusCode::NO_CONTENT)
}
async fn list(State(state): State<GiftNotes>, headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
    let me = {
        let mut auth = lock(&state.auth)?;
        authenticated(&mut auth, &headers)?
    };
    let notes = state.notes.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let at = now();
    let rows: Vec<Value> = notes
        .store
        .notes
        .iter()
        .filter(|(_, n)| (n.to == me || n.from == me) && at.saturating_sub(n.at) < KEEP)
        .map(|(id, n)| json!({"id":id,"from":n.from,"to":n.to,"text":n.text,"item":n.item,"at":n.at}))
        .collect();
    Ok(Json(json!({"notes":rows})))
}
pub(crate) fn router(auth: Shared, notes: Notes) -> Router {
    Router::new()
        .route("/gift-note", post(send))
        .route("/gift-notes", get(list))
        .layer(DefaultBodyLimit::max(1024))
        .with_state(GiftNotes { auth, notes: Arc::new(Mutex::new(notes)) })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notes_are_short_single_line_and_items_are_validated() {
        assert_eq!(clean_text("  Happy\n birthday!  ").as_deref(), Some("Happy birthday!"));
        assert!(clean_text(&"x".repeat(141)).is_none());
        assert_eq!(clean_text("").as_deref(), Some(""));
        let mut item = Item { kind: "aura".into(), id: "demon_aura".into(), hash: "a".repeat(64), slot: "aura".into(), name: "Infernal Aura".into(), rarity: "epic".into() };
        assert!(valid_item(&item));
        item.kind = "promo_bundle".into();
        assert!(!valid_item(&item));
        item.kind = "model".into();
        item.id = "../x".into();
        assert!(!valid_item(&item));
    }
}
