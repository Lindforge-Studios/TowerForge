# ADR 0016: Player profile rules and browser persistence use separate runtimes

- Status: Accepted
- Date: 2026-07-24

R4.0A promotes the canonical schema from v2 to v3 without adding fields; see [ADR 0028](0028-player-profile-v3-migration.md). The v2 names below describe the originally accepted R0C contract.

## Context

Canvas and Phaser generated players historically embedded equivalent mutable progress helpers for cleared missions, stars, meta currencies, upgrades, difficulty, rewards, and unlocks. That duplication let renderer templates drift, mixed browser persistence with gameplay rules, and could silently reinterpret or overwrite a profile written by a newer TowerForge version.

Persistent player progress is also an independent compatibility domain. A `.tdproj` migration, checkpoint/replay change, renderer choice, or multiplayer protocol change must not implicitly rewrite it. Generated PWA, single-file, Codex plugin, and desktop-bundled builds must all carry the same runtime contract without making `packages/engine` depend on browser or Node APIs.

## Decision

### Ownership

The pure engine owns `PlayerProfileV2` in `packages/engine/src/profile/player-profile.ts`:

- bounded legacy-array, unversioned-object, and version-1 migrations;
- canonical parse/serialize and immutable launch options;
- immutable difficulty, meta-upgrade, mission-clear, reward, and unlock reducers;
- validation and stable machine-readable result codes.

The engine never reads browser storage. `packages/player-runtime` is a renderer-neutral persistence adapter. It receives content, the engine codec, and a Storage-like port through dependency injection; it imports no DOM, browser global, Node, renderer, or filesystem API. Option bags are read through own data properties, so inherited values and accessors cannot redirect the profile key or invoke host code.

### Storage contract

The profile key remains exactly `towerforge:progress:${appId || manifestName || "game"}`. Scope components are not trimmed, slugged, or suffixed.

- `load()` performs exactly one read and never writes or removes. Current v2 is returned as-is through the codec; legacy data is migrated only in memory. Missing, corrupt, unavailable, and future-version data produce a playable frozen fallback plus a stable result code. Raw bytes and caught error details are not returned.
- `save(profile)` validates and canonically serializes before storage access, then performs one preflight read. Existing future-version data is fail-closed and remains byte-identical. An explicit save may replace missing, legacy, or corrupt data; a failed write is contained.
- Normal **Reset progress** removes only the exact current profile key. It does not enumerate the prefix and does not remove story state or another app's profile.
- The boot recovery overlay is a narrower emergency path that must work even when the player module cannot start. Its reset removes the exact current profile key and the current app's story namespace, while preserving profiles and story keys belonging to other apps.

This adapter is local single-writer persistence. Its preflight is a future-version guard, not compare-and-swap conflict control.

### Generated surfaces and bundling

Canvas and Phaser import the same engine profile APIs and `packages/player-runtime`. Their profile behavior is emitted from one marker-delimited fragment, so renderer templates cannot fork progression or persistence rules. The generated browser adapter supplies `globalThis.localStorage` through a narrow Storage-like port; the shared package itself remains browser-global-free.

Web builds copy the runtime source bytes, precache them for offline use, and inline the relative module graph for `index.single.html` without unresolved runtime specifiers. Codex plugin generation and desktop runtime preparation mirror `packages/player-runtime` alongside CLI/engine/renderer code. Test sources are excluded from shipped runtimes.

## Consequences

- Canvas and Phaser load, migrate, save, reset, warn, and recover identically; renderer selection cannot change profile bytes or rules.
- Reading legacy data has no persistence side effect. Since R4.0A, the next explicit profile-changing action writes canonical v3.
- A future profile remains protected even when the player changes difficulty in the in-memory fallback session. The UI reports that the saved profile belongs to a newer version.
- Corrupt data does not block play; an explicit profile action may replace it with canonical v3.
- Project, mechanics, profile, checkpoint, command journal/replay, and multiplayer protocol versions continue to evolve independently.
- Changes to profile rules require engine tests; changes to persistence require player-runtime tests; generated-player changes require Canvas/Phaser, PWA, single-file, plugin, desktop-bundle, and browser acceptance coverage.

## Non-goals

- Multiple tabs, cloud sync, compare-and-swap, merge resolution, save slots, and account ownership are not part of R0C.
- Rogue-lite run state remains the separate R4.0B `CampaignRun` contract; profile v3 itself contains no run state.
- The renderer and Studio do not acquire profile gameplay rules or direct storage ownership.
