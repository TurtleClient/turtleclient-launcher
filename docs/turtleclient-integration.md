# Native client and TurtleClient services

The original launcher layout is retained. With no Java build explicitly selected,
the existing lobby Play button starts the native TurtleClient. Picking a Java build
in the catalog continues to use the original Java launch path.

The native client is now installed and updated automatically on launcher start;
see [native-client-updates.md](native-client-updates.md). In Settings → Game,
select the prepared Minecraft 26.3 resources and a game directory.
Use **Select in lobby** there to return to TurtleClient after selecting a Java build.
The launcher detects already prepared resources from installed Horizon
versions. It never redistributes Mojang assets. Paths are stored in
`turtleclient.json` under the launcher data directory. `TURTLE_CLIENT` and
`TURTLE_RESOURCES` provide initial path overrides.

Microsoft accounts are refreshed through the configured provider, then their
profile is verified against Minecraft Services. A private stdin pipe hands the
session to the game using `--session-stdin`; tokens never enter the command line,
webview, logs or a temporary session file. Offline accounts explicitly launch
with `--name`. Native launch never silently downgrades an online account to offline.
The game runs in its configured directory; logs are in `.turtleclient/launcher-game.log`.
An already running native client cannot be launched twice.

## Friends

The launcher automatically connects its active Microsoft Minecraft account to
TurtleClient's friends service on startup and keeps it alive across screen changes.
Connecting sends its
Minecraft access token over HTTPS to the TurtleClient service once, where
`GET https://api.minecraftservices.com/minecraft/profile` verifies ownership.
The service neither logs nor persists that token. It returns an opaque one-hour
session, kept only in the launcher's Rust process. UUIDs or nicknames supplied by
the webview cannot authenticate an account. Session identifiers are also absent
from frontend storage and responses.

Both players must start the launcher once before a request can be addressed by Minecraft
name. Requests, acceptance, rejection, cancellation and removal persist across
service restarts. Acceptance must come from the recipient. Online means the
launcher has polled within the last 75 seconds. A central heartbeat runs every
20 seconds, renews expired sessions and reconnects after network failures/server
restarts. Switching accounts clears the previous view and stops its heartbeat;
logging out or selecting an offline account stops polling. This release does not promise
in-game presence, direct messages, calls or server invitations.

The independent Rust service lives in `services/friends`, listens only on
`127.0.0.1:3001`, and uses `/var/lib/turtleclient/friends/friends.json` on the VPS.
Public routes are under `https://45.133.9.162/turtleclient/social/`:

| Route | Authentication | Operation |
| --- | --- | --- |
| `POST session` | Minecraft bearer token | Verify account and issue service session |
| `GET friends` | Service bearer | Own friends and requests; presence heartbeat |
| `POST friends/request` | Service bearer | `{name}` |
| `POST friends/decision` | Service bearer | `{uuid, accept}` |
| `DELETE friends/<uuid>` | Service bearer | Remove friendship or own pending request |
| `GET healthz` | None | Health check |

Requests are capped at 1 KiB. Names, UUIDs, session expiry and collection sizes
are checked. nginx limits login and API requests. Sessions and online presence
expire in memory; the database contains only Minecraft IDs/names, friendships
and pending requests. Back up the friends directory with the Ocean data.

Run `cargo test --manifest-path services/friends/Cargo.toml --locked` for state
and HTTP integration tests using isolated identities. `deploy.py` takes a prebuilt
Linux binary plus its expected SHA-256, backs up its configuration, validates nginx
and installs only `turtleclient-friends.service`. Ocean and other services are not
restarted. Its nginx configuration is in separate `turtleclient-friends.conf` files.

Deployment on 2026-11-06: Linux binary SHA-256
`fa57632ce5f448c368f320dd5486e78c780966570782145a378221f177fc52d5`;
configuration backup `/var/backups/turtleclient/friends-20261106T175116Z`.
Public health/catalog checks returned 200 and unauthenticated friend/session
requests returned 401. No real account sign-in or friendship was used for these checks.

## Cosmetics and shop

The launcher reads Ocean's live catalog and authenticated wardrobe state. Equipped
models, original capes and animated name tags appear on the lobby and wardrobe
character. Existing wardrobe tabs and type chips remain; only its duplicate Shop
tab is removed. The separate shop remains available.

See [wardrobe.md](wardrobe.md) for server categories, item types, prices and
entitlements. The existing Ocean beta write routes remain public. Those legacy
routes must be secured before selling paid cosmetics; the new launcher API alone
does not protect them.

### Shells shop

The shop screen uses Ocean's own Shells shop, the same one the native client and
the website use. The launcher signs in exactly like the native client: Ocean's
`POST /api/social/auth/start` issues a challenge, the launcher confirms it through
the Minecraft session service (`session/minecraft/join`) with the active Microsoft
account, and `POST /api/social/auth/finish` returns Ocean's six-hour token. That
token stays in the launcher's Rust process; the webview never sees it. The
Minecraft token is sent only to Mojang, not to Ocean.

| Launcher action | Ocean route | Notes |
| --- | --- | --- |
| Balance, owned items, prices | `GET /api/social/shop/inventory` | `balance` is the Shells wallet |
| Buy one product | `POST /api/social/shop/buy` | `{kind,id,hash,owner}`; bundles as `promo_bundle` |
| Daily reward | `POST /api/social/shop/buy` | `kind: daily_reward` |
| Gift price | `POST /api/social/exchange/quote` | friends only |
| Send gift | `POST /api/social/exchange` | `offer.kind: gift`, confirmed `agreed` price |
| Open gifts, accept, decline, withdraw | `GET /api/social/exchange`, `POST /api/social/exchange/<id>` | a declined or withdrawn gift refunds the sender |

Ocean decides every price and charges the wallet; the launcher only shows its
answers. The cart is kept per account in local storage without prices and is
checked out item by item, because Ocean charges per product. Gifts use the price
the player confirmed; Ocean refuses a changed price (HTTP 409) instead of charging
more. Not enough Shells is HTTP 402. Bundles and trails cannot be gifted. Buying
Shells with money is not part of the launcher.

Shop and wardrobe use the client's catalogue categories in its order: Head, Back,
Torso, Shoulder, Capes, Name tag, Auras, Trails, Pets, Emotes (the shop adds
Bundles).

### Wardrobe, Home and previews

Ocean's inventory is the single source for what the player owns and wears. The
wardrobe lists only owned items. Models, aura, trail and the team cape are worn
through `POST /api/social/shop/equip` (`{slot,hash,equipped}`; up to three models
per body slot, one aura, trail and name tag). MiniMe uses `POST /api/social/pet`.
Bought capes keep the existing cape route. Home and the wardrobe figure show
Ocean's `equipped` list, including shop items, aura and trail.

The emote wheel is the client's own `emote_favorites` in
`<game folder>/config/turtleclient.json`. The launcher reads it and writes only
that key, and only while the client is closed, so the game cannot overwrite the
new order when it saves its settings.

Previews in the shop, wardrobe tiles and Home follow the Turtle website's
renderer: the launcher's Turtle model geometry on a bendy figure wearing the
player's own skin, capes from `/api/shop/asset/<hash>` and emote or pet clips. The
clips are the website's preview files, served read-only by nginx on the IP host
as `/turtleclient/previews/<id>.json` (`[a-z0-9_]` names only). One shared WebGL
renderer draws every visible preview and builds a tile's scene only when it
scrolls into view.

Auras and trails are a port of the client's `turtle_auras.rs` and
`turtle_trails.rs` (horizon-client-render) with the client's own sprite atlases in
`public/turtle/`, so their patterns, colours and timing match the game. Clicking a
shop item opens a large preview; a bundle shows everything together and each of
its parts (contents as in `turtle_catalog::BUNDLES`). Shop requests send
`x-turtle-dj: 1`, so Ocean reports Mythic instead of folding it into Legendary.

### Gifts with a message

A gift can carry a message of up to 140 characters. Ocean stores the gift itself;
the Turtle service keeps the note under the gift's id (`POST /social/gift-note`,
friends only, `GET /social/gift-notes`) together with which item it is, in
`gift-notes.json` beside `friends.json` for 30 days. When a friend's gift
arrives, the launcher shows a full-screen present with the message; opening it
accepts the gift in Ocean and reveals the item on the player's own skin. While
gifts are waiting, Home shows a gift button. Gifts are checked every 45 seconds.

### Playtime

TurtleClient playtime is kept by the Turtle service, not by the launcher. While
the native client runs, the launcher's Rust process sends
`POST /social/playtime {"playing":true}` with the player's service session once a
minute and `{"playing":false}` after the client exits. Each beat credits the real
time since the previous beat, at most 90 seconds, so the total cannot exceed
wall-clock time. Totals are stored in `playtime.json` beside `friends.json`
(`TURTLE_PLAYTIME_FILE` overrides it); `friends.json`, which Ocean also reads,
is not touched. `GET /social/playtime` returns `{seconds, playing}`; Home shows it
under Play. Time played while the launcher is closed is not counted.
