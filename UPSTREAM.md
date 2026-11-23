# Upstream and fork changes

- Upstream: https://github.com/millida/launcher
- Base commit: `a9cec042ad1515a495a4f7c550e71f7423b65812`
- Fork: https://github.com/TurtleClient/turtleclient-launcher
- Modified: 2026-11-06 by TurtleClient contributors with Codex assistance.
- License: GPL-3.0-only; original copyright, NOTICE, THIRD-PARTY and trademark notices retained.

The first fork change replaces product identity, logos and installation icons and opens the
game-account step independently of Millida login. Upstream account/service requests and updater
configuration are disabled; no Millida Microsoft application ID or signing key is used.
Discord uses TurtleClient application `1568214525138968586` without image assets.
Internal IPC/type names are retained for compatibility; they do not imply affiliation.
Upstream publishing workflows are archived under `.github/upstream-workflows/`.

Before a binary release: finish reviewing/replacing remaining upstream design artwork and service
screens, configure TurtleClient's own Microsoft application and signed update pipeline, and implement
native TurtleClient launch support. The current baseline is a Java Minecraft launcher fork.

Windows authentication uses the bundled, unmodified Horizon account provider from the MIT-licensed
`launcher@0.2.50` release (commit `1fe21fb861002308bbdb055dddc1a3edbd21218e`). Its archive and
executable digests are pinned; no Horizon installation is required. The original MIT notice is
included. The provider's OAuth application ID is not copied. TurtleClient's direct registration
remains selectable through `TURTLECLIENT_AUTH_PROVIDER=microsoft`.
