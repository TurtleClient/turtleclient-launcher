//! Server-side TurtleClient playtime. While the native client runs, the launcher sends a
//! heartbeat with the player's service session; each beat credits the real time since the
//! previous beat, at most `MAX_STEP`, so the total can never exceed wall-clock time.
//! Totals live in their own file next to `friends.json`, which Ocean also reads.
use super::{authenticated, lock, Shared};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use uuid::Uuid;

/// Longest gap one beat may credit. The launcher beats every 60 seconds.
pub(crate) const MAX_STEP: Duration = Duration::from_secs(90);
/// Disk writes at most this often per player while playing; stopping always saves.
const SAVE_EVERY: Duration = Duration::from_secs(30);

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Totals {
    players: BTreeMap<Uuid, u64>,
}
pub(crate) struct Clock {
    totals: Totals,
    beats: HashMap<Uuid, Instant>,
    saved: HashMap<Uuid, Instant>,
    file: PathBuf,
}
impl Clock {
    pub(crate) fn load(file: PathBuf) -> std::io::Result<Self> {
        let totals = match std::fs::read(&file) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(std::io::Error::other)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Totals::default(),
            Err(e) => return Err(e),
        };
        Ok(Self { totals, beats: HashMap::new(), saved: HashMap::new(), file })
    }
    fn save(&self) -> Result<(), StatusCode> {
        let bytes = serde_json::to_vec(&self.totals).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let tmp = self.file.with_extension("tmp");
        std::fs::write(&tmp, bytes)
            .and_then(|_| std::fs::rename(tmp, &self.file))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    }
    pub(crate) fn seconds(&self, player: Uuid) -> u64 {
        self.totals.players.get(&player).copied().unwrap_or(0)
    }
    pub(crate) fn playing(&self, player: Uuid, now: Instant) -> bool {
        self.beats.get(&player).is_some_and(|last| now.duration_since(*last) <= MAX_STEP)
    }
    /// Credits the time since the previous beat (capped) and records or ends the session.
    pub(crate) fn beat(&mut self, player: Uuid, playing: bool, now: Instant) -> Result<u64, StatusCode> {
        if !self.totals.players.contains_key(&player) && self.totals.players.len() >= 20_000 {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        let credit = self
            .beats
            .get(&player)
            .map(|last| now.saturating_duration_since(*last).min(MAX_STEP).as_secs())
            .unwrap_or(0);
        if playing {
            self.beats.insert(player, now);
        } else {
            self.beats.remove(&player);
        }
        let total = self.totals.players.entry(player).or_default();
        *total = total.saturating_add(credit);
        let total = *total;
        let due = !playing || self.saved.get(&player).is_none_or(|at| now.duration_since(*at) >= SAVE_EVERY);
        if credit > 0 && due {
            self.save()?;
            self.saved.insert(player, now);
        }
        Ok(total)
    }
}

#[derive(Clone)]
struct Playtime {
    auth: Shared,
    clock: Arc<Mutex<Clock>>,
}
fn player(state: &Playtime, headers: &HeaderMap) -> Result<Uuid, StatusCode> {
    let mut auth = lock(&state.auth)?;
    authenticated(&mut auth, headers)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Beat {
    playing: bool,
}
async fn show(State(state): State<Playtime>, headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
    let me = player(&state, &headers)?;
    let clock = state.clock.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({"seconds":clock.seconds(me),"playing":clock.playing(me, Instant::now())})))
}
async fn beat(State(state): State<Playtime>, headers: HeaderMap, Json(body): Json<Beat>) -> Result<Json<Value>, StatusCode> {
    let me = player(&state, &headers)?;
    let mut clock = state.clock.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let seconds = clock.beat(me, body.playing, Instant::now())?;
    Ok(Json(json!({"seconds":seconds,"playing":body.playing})))
}
pub(crate) fn router(auth: Shared, clock: Clock) -> Router {
    Router::new()
        .route("/playtime", get(show).post(beat))
        .layer(DefaultBodyLimit::max(1024))
        .with_state(Playtime { auth, clock: Arc::new(Mutex::new(clock)) })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn clock() -> (Clock, PathBuf) {
        let dir = std::env::temp_dir().join(format!("turtle-playtime-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("playtime.json");
        (Clock::load(file.clone()).unwrap(), dir)
    }
    #[test]
    fn beats_credit_real_time_capped_and_survive_reload() {
        let (mut clock, dir) = clock();
        let me = Uuid::from_u128(7);
        let start = Instant::now();
        assert_eq!(clock.beat(me, true, start).unwrap(), 0);
        assert_eq!(clock.beat(me, true, start + Duration::from_secs(60)).unwrap(), 60);
        // A long silence (sleep, crash) credits at most one step.
        assert_eq!(clock.beat(me, true, start + Duration::from_secs(3600)).unwrap(), 150);
        // Rapid beats add only the time that really passed.
        assert_eq!(clock.beat(me, true, start + Duration::from_secs(3601)).unwrap(), 151);
        assert_eq!(clock.beat(me, false, start + Duration::from_secs(3631)).unwrap(), 181);
        assert!(!clock.playing(me, start + Duration::from_secs(3632)));
        // After stopping, the next start credits nothing for the pause.
        assert_eq!(clock.beat(me, true, start + Duration::from_secs(9000)).unwrap(), 181);
        let reloaded = Clock::load(dir.join("playtime.json")).unwrap();
        assert_eq!(reloaded.seconds(me), 181);
        assert_eq!(reloaded.seconds(Uuid::from_u128(8)), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
