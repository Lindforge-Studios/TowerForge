# ADR 0059: R18 Large-Screen Web Player

- Status: In Review
- Date: 2026-08-02

## Context

TowerForge's generated player was designed first for the legacy responsive/mobile carrier. Desktop
web games need a bounded viewport, keyboard and pointer camera controls, a compact player shell,
recoverable session saves, PWA metadata, localization and accessibility without changing gameplay
coordinates or forcing those modules into existing targets.

## Decision

An author explicitly opts in with project schema v5 plus `build-targets.json` schema v2 and a target
whose `formFactor` is `desktop` or `responsive`. Schema-v1 targets retain their former source and
bundle path. The guarded authoring transaction is target-local and uses
`read -> recipe -> preview -> apply(ifRevision)`; apply alone promotes both schemas, preserves other
targets, validates the complete project, writes backups and rolls back both files together.

`packages/renderer/src/viewport-transform.mjs` owns pure contain/center, bounded pan/zoom and inverse
hit-test mathematics. Canvas and Phaser consume the same transform; neither changes engine
coordinates, topology, range, line of sight or targeting. Camera input is ignored while a dialog,
menu or editable control owns interaction.

`packages/player-runtime` owns renderer-neutral descriptors and codecs for `PlayerActionDescriptorV1`,
`PlayerPreferencesV1` and `PlayerSessionSaveV1`. Gameplay sessions use an injected asynchronous
storage port and a rotating two-slot commit. Browser builds provide IndexedDB; localStorage is used
only for preferences. Restore validates the content digest before constructing a simulation and the
engine validates checkpoint identity and state. Corrupt, future and incompatible records fail
closed.

The generated desktop shell remains DOM-owned and dispatches actions through one allowlisted action
registry. It provides status/actions, settings/result dialogs, keyboard shortcuts and autosave at
management actions, wave boundaries, page visibility changes and normal page exit. It is localized
through a closed string catalog, uses semantic controls with 44 px minimum targets, honors reduced
motion and applies presentation-only quality/DPR limits.

The PWA manifest, icons, screenshot and shortcuts are emitted only for the large-screen carrier.
The engine, GameCommand v8, checkpoint, journal, profile, campaign and multiplayer version domains
do not change.

## Consequences

- Legacy projects and targets do not import the viewport/session/action modules or receive the new
  DOM shell.
- Renderer code remains responsible only for presentation projection and hit testing.
- Browser storage failures cannot partially restore gameplay; the player starts a clean session and
  reports a recoverable message.
- R19 may reuse `PlayerSessionSaveV1` behind a native storage port, while R20 may replace only the
  projection basis and R21 may replace only the declarative shell layout.

## Rejected alternatives

- Retrofitting every target with desktop fields: violates opt-in compatibility.
- Persisting checkpoints in localStorage: lacks the required atomic asynchronous storage boundary.
- Duplicating viewport mathematics in Phaser: risks pointer and depth divergence.
- Letting the shell mutate engine state directly: bypasses command validation and future HUD reuse.
