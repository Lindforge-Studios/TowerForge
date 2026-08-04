# ADR 0063: R22 Project Splash Playlists

- Status: Candidate
- Date: 2026-08-04

## Context

Officially generated TowerForge games already show one immutable, inline `Made with TowerForge`
system splash before project or menu presentation. Authors also need a bounded place for a studio,
publisher or game logo. Making that surface part of HUD data would let an authored screen cover or
reorder the engine credit, while putting it in the simulation would change content/checkpoint
domains for presentation-only data. Loading an external page, video or arbitrary markup would also
break offline packaging and the imported-project trust boundary.

R22 therefore adds a build-target-selected static-image playlist after the system splash. It keeps
the system surface locked, reuses validated project-local visual assets and does not change engine,
gameplay, replay or HUD contracts.

## Decision

### Activation and storage

R22 adds optional `content/splashes.json` with root `SplashCatalogV1` (`schemaVersion: 1`). A catalog
contains at most 16 reusable playlists. `SplashPlaylistV1` owns a label and one to eight ordered
items with stable IDs. BuildTargets v2 receives optional `splashPlaylistId`; the selected target,
not the project globally, activates one playlist. Project schema remains v5 and visuals remains v4.

An active binding requires a valid catalog entry and valid standalone project-local PNG, JPEG or
WebP sprites from `content/visuals.json`. Missing or future active data blocks validation/build.
When the selected target has no binding, the loader does not parse or ship the optional catalog and
the generated player retains the previous engine-splash bytes and timing path. An unbound malformed
or future catalog therefore cannot break or enlarge that target. Disabling a playlist removes only
the target binding; reusable catalog records and assets remain.

Each item contains only `id`, `spriteId`, `accessibleLabel`, optional plain-text `caption`, six-digit
`backgroundColor`, `fit: contain | cover`, `transition: cut | fade | fade_scale`, and bounded integer
timings. Defaults are 1,800 ms display, 600 ms mandatory minimum, 220 ms transition, `contain` and
`fade_scale`. Display is limited to 700–10,000 ms, minimum to 300–2,000 ms, transition to 0–600 ms,
and total authored playback (display plus transitions) to 30 seconds per playlist. Catalog validation accepts only closed,
prototype-neutral own data and never invokes accessors.

### Boot lifecycle

The generated DOM has two system-owned presentation layers with a fixed order:

1. immutable inline TowerForge engine splash;
2. zero or one selected project playlist;
3. authored title/menu or built-in player shell.

Runtime boot and all project-image preload/decode operations start while the TowerForge layer is
visible. The first successfully decoded image may replace it only after the engine splash minimum.
A failed image is skipped; a bounded preload timeout prevents an image decoder from holding boot
forever. If no image succeeds, TowerForge remains until runtime readiness and then yields directly
to the menu.

Runtime readiness and presentation completion are independent barriers. A ready runtime waits for
every authored item; a completed playlist retains its last valid frame with a loading indicator
until runtime is ready. `BootOk` becomes true only after runtime readiness and both splash layers are
fully hidden. A boot error or unhandled rejection before `BootOk` closes both layers immediately and
shows the built-in recovery overlay.

Pointer/touch, Space or Enter advances exactly one item only after its `minimumMs`. Escape and the
accessible skip control end only the project sequence. Splash input is captured and cannot reach
gameplay. `prefers-reduced-motion` removes authored transitions but does not shorten mandatory
display time.

### Authoring and package boundaries

- `packages/player-runtime` owns pure closed validation and detached playlist-plan compilation. It
  has no DOM, Node, renderer or engine dependency.
- `packages/cli` owns active-only loading, cross-file validation, safe asset/signature checks,
  conditional web/single-file/mobile/desktop packaging and the four-source guarded transaction.
- The generated browser boot adapter owns timers, preload/decode, accessibility input and the two
  readiness barriers. Canvas and Phaser receive the same DOM lifecycle and do not implement it.
- `packages/studio` exposes a Splash Studio over CLI transactions. The locked first slot is UI-only
  evidence of the immutable engine surface; it is never serialized into `splashes.json`.
- `packages/mcp` exposes `get_splash_playlists`, `get_splash_playlist_recipe`,
  `preview_splash_playlist` and Act-only `apply_splash_playlist`. Asset upload/generation continues
  through the existing staged asset pipeline; no broad writer or external URL is introduced.
- `packages/engine`, renderer projection, HUD runtime, GameCommand, checkpoint, journal, profile,
  campaign and multiplayer contracts are unchanged.

The authoring revision hashes exact bytes of `project.json`, `build-targets.json`, optional
`content/splashes.json` and `content/visuals.json`. Apply rechecks the revision, validates the complete
candidate, writes confined backups and rolls back all owned files on failure. First enable promotes
legacy project/build metadata to project v5 and BuildTargets v2; it does not auto-create a placeholder
for starter or legacy projects. Studio may show one unsaved draft item, but save remains blocked until
that item references a valid image.

### Version domains

- project manifest: v5, unchanged;
- BuildTargets: v2 plus optional `splashPlaylistId`;
- `SplashCatalogV1` and `SplashPlaylistV1`: schema v1;
- visuals: v4 maximum, unchanged; items store sprite IDs only;
- engine, capability set, GameCommand/journal v8, checkpoint, replay, HUD, profile, campaign and
  multiplayer: unchanged.

## TDD delivery slices

1. **R22.1 — schema.** RED first for closed own-data validation, budgets, future versions, safe
   sprite references, optional-file transport and BuildTargets binding; then pure runtime and loader
   GREEN.
2. **R22.2 — boot.** RED first for fixed order, parallel preload/runtime, failed and stalled decode,
   last-frame hold, input minimum/skip, reduced motion and recovery; then one shared generated-player
   lifecycle for Canvas and Phaser.
3. **R22.3 — Studio and MCP.** RED first for the four-source revision, recipes, preview/apply,
   rollback, authoring lifecycle and Ask/Plan/Act policy; then CLI-owned transactions and Studio/MCP
   adapters.
4. **R22.4 — packages.** RED first for active-only bytes and offline assets in PWA, single-file, web,
   mobile and generated desktop carriers; then packaging parity without a new engine/runtime domain.

The exact candidate runs all affected gates and receives independent Code Verifier and Constructor
Integration Verifier sign-off. Any source change invalidates both.

## Consequences

- Games may present studio, publisher and title identities without weakening the mandatory engine
  credit or importing executable project data.
- Each target can select a different reusable sequence, while unbound targets pay no custom-runtime
  byte or delay cost.
- Static, local and bounded assets keep single-file/PWA/native output reproducible and offline-safe.
- Boot code gains a second presentation barrier, so timeout, input capture, recovery and exact
  `BootOk` ordering are contract tests rather than renderer convention.

## Rejected alternatives

- Replacing or authoring the TowerForge slot: removes engine provenance and lets project data cover a
  system-owned recovery boundary.
- Storing project splashes in HUD: couples boot to an optional shell that is not yet safe to execute.
- Video, audio, SVG, remote URLs or arbitrary HTML/CSS/JavaScript: widens codecs, networking and
  executable-content risk beyond R22.
- Waiting to start runtime until the playlist finishes: adds unnecessary boot latency.
- Activating any catalog globally: changes unrelated targets and violates opt-in packaging.
