//! Client ranks of the player and their friends, read-only from Ocean's own files: the team
//! roster (`data/turtle-team.json`, Admin, Mod, Creator) and the Shells shop state
//! (`data/turtle-shop/state.json`, Turtle Plus until). Nothing here writes to Ocean.
//! Creator is shown as Partner; Plus is Premium. Unknown roles are skipped one by one, so
//! a new role in the roster never hides the others.
use super::{authenticated, lock, Shared};
use axum::{extract::State, http::{HeaderMap, StatusCode}, routing::get, Json, Router};
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

/// Files are read again at most this often.
const FRESH: Duration = Duration::from_secs(30);

#[derive(Default)]
pub(crate) struct Ranks {
    team_file: PathBuf,
    shop_file: PathBuf,
    team: HashMap<Uuid, &'static str>,
    plus: HashMap<Uuid, u64>,
    read: Option<Instant>,
}
impl Ranks {
    pub(crate) fn new(team_file: PathBuf, shop_file: PathBuf) -> Self {
        Self { team_file, shop_file, ..Self::default() }
    }
    fn refresh(&mut self, now: Instant) {
        if self.read.is_some_and(|at| now.duration_since(at) < FRESH) {
            return;
        }
        self.read = Some(now);
        self.team = std::fs::read(&self.team_file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Map<String, Value>>(&bytes).ok())
            .map(|roster| {
                roster
                    .iter()
                    .filter_map(|(id, member)| Some((Uuid::parse_str(id).ok()?, team_rank(member["role"].as_str()?)?)))
                    .collect()
            })
            .unwrap_or_default();
        self.plus = std::fs::read(&self.shop_file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|state| state["wallets"].as_object().cloned())
            .map(|wallets| {
                wallets
                    .iter()
                    .filter_map(|(id, wallet)| Some((Uuid::parse_str(id).ok()?, wallet["plus_until"].as_u64()?)))
                    .collect()
            })
            .unwrap_or_default();
    }
    /// The one rank a player shows: the team role first, then Premium while Plus runs.
    pub(crate) fn rank(&self, player: Uuid, unix: u64) -> Option<&'static str> {
        self.team
            .get(&player)
            .copied()
            .or_else(|| self.plus.get(&player).is_some_and(|until| *until > unix).then_some("premium"))
    }
}
fn team_rank(role: &str) -> Option<&'static str> {
    match role {
        "admin" => Some("admin"),
        "mod" => Some("mod"),
        "creator" | "partner" => Some("partner"),
        "translator" => Some("translator"),
        _ => None,
    }
}
fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Clone)]
struct RankState {
    auth: Shared,
    ranks: Arc<Mutex<Ranks>>,
}
/// The player's own rank and those of their friends (players without a rank are left out).
async fn show(State(state): State<RankState>, headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
    let (me, friends) = {
        let mut auth = lock(&state.auth)?;
        let me = authenticated(&mut auth, &headers)?;
        let friends = auth.database.users.get(&me).map(|u| u.friends.clone()).unwrap_or_default();
        (me, friends)
    };
    let mut ranks = state.ranks.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    ranks.refresh(Instant::now());
    let unix = unix_now();
    let of_friends: Map<String, Value> = friends
        .into_iter()
        .filter_map(|f| Some((f.to_string(), Value::from(ranks.rank(f, unix)?))))
        .collect();
    Ok(Json(json!({"me":ranks.rank(me, unix),"friends":of_friends})))
}
pub(crate) fn router(auth: Shared, ranks: Ranks) -> Router {
    Router::new()
        .route("/ranks", get(show))
        .with_state(RankState { auth, ranks: Arc::new(Mutex::new(ranks)) })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn team_roles_win_over_plus_and_unknown_roles_are_skipped() {
        let dir = std::env::temp_dir().join(format!("turtle-ranks-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (admin, creator, plus, expired, other) = (Uuid::from_u128(1), Uuid::from_u128(2), Uuid::from_u128(3), Uuid::from_u128(4), Uuid::from_u128(5));
        std::fs::write(
            dir.join("team.json"),
            json!({admin.to_string():{"name":"A","role":"admin"},creator.to_string():{"name":"C","role":"creator"},other.to_string():{"name":"X","role":"wizard"}}).to_string(),
        )
        .unwrap();
        std::fs::write(
            dir.join("state.json"),
            json!({"wallets":{admin.to_string():{"plus_until":2000},plus.to_string():{"plus_until":2000},expired.to_string():{"plus_until":500}}}).to_string(),
        )
        .unwrap();
        let mut ranks = Ranks::new(dir.join("team.json"), dir.join("state.json"));
        ranks.refresh(Instant::now());
        assert_eq!(ranks.rank(admin, 1000), Some("admin"));
        assert_eq!(ranks.rank(creator, 1000), Some("partner"));
        assert_eq!(ranks.rank(plus, 1000), Some("premium"));
        assert_eq!(ranks.rank(expired, 1000), None);
        assert_eq!(ranks.rank(other, 1000), None);
        // Missing files mean no ranks, never an error.
        let mut empty = Ranks::new(dir.join("missing.json"), dir.join("missing2.json"));
        empty.refresh(Instant::now());
        assert_eq!(empty.rank(admin, 1000), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
