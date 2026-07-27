# ADR 0037: Static hero roster is a separate opt-in foundation

- Status: Accepted
- Date: 2026-07-26
- Roadmap: R5.1A

## Context

The Heroes pillar ultimately needs movement, combat state, active abilities, skills, auras, and
optional enemy blocking. Introducing all of those together would couple roster authoring to a new
command/journal version, mutable checkpoint state, navigation semantics, input handling, and
TowerScript. It would also make it difficult to prove that a project which does not select heroes
still uses the exact legacy constructor and player path.

TowerForge already has a planned stable `heroes` module ID and guarded opt-in authoring boundary,
but the engine does not yet expose an executable hero capability. The first vertical increment must
therefore establish a bounded content identity and renderer-visible engine truth without pretending
that active hero control is already implemented.

## Decision

R5.1A implements only `heroes` module schema v1. A profile is a closed own-data object with exact
fields `selectedHeroId` and `definitions`. `definitions` contains 1–32 author-defined entries; every
entry is exactly `{label, spawn:"core"}`. Definition IDs and labels contain at most 128 UTF-8 bytes.
Definitions are inspected without invoking accessors, canonicalized in binary ID order, detached,
and frozen.

`selectedHeroId` is a semantic cross-reference rather than a structural shortcut. Structural shape
and budgets are validated for every authored profile. A missing selected definition is an error if
the profile is active for a mission and a warning while disabled or unselected. An unsupported
future heroes version fails closed and remains opaque/read-only in Studio and AI authoring.

For an active selected profile, `TowerDefenseGame` derives exactly one immutable unit at
`map.coreCoord`. Its runtime `id` and `definitionId` both identify the selected authored definition.
The unit is exposed only under optional `snapshot.heroes` schema v1 with exact fields `id`,
`definitionId`, `label`, and detached `coord`. Definition insertion order does not affect the
snapshot or content digest, and unselected definitions never become runtime units.

The hero is derived content, not mutable checkpoint state. R5.1A does not change
`GameCheckpointV1`, `towerforge-sim-v2`, GameCommand/Journal v3, replay, player profile,
CampaignRun, seeded RNG, or TowerScript v6. A checkpoint contains no hero section; restore validates
the existing content digest and derives the same unit from the profile and map. There are no hero
events, actions, HP, shield, mana, cooldowns, abilities, skills, modifiers, auras, blocking, or
navigation fields in this version.

Studio keeps roster authoring in Mechanics Hub and reuses the revision-guarded project/mechanics/
balance transaction with validation, backup, and rollback. MCP/AI exposes the engine-owned heroes
descriptor and `basic_commander_hero` recipe through the existing discovery/preview/apply flow.
The recipe is inert: it neither enables the module nor selects a mission.

Canvas and Phaser consume one bounded, fail-closed presentation projection over
`snapshot.heroes`. They may resolve an explicitly authored `visuals.bindings.heroes[definitionId]`
sprite and otherwise draw a deterministic shape fallback. Normalization must not synthesize an
empty heroes binding into legacy projects, and renderers must not inspect mechanics profiles or
derive the spawn themselves.

R5.1B is a separate TDD increment. It owns hero movement definitions, `moveHero`,
GameCommand/Journal v4, mutable navigation state, nested checkpoint state, deterministic replay,
and mouse/touch/headless input equivalence. Later slices independently add health/shields,
mana/abilities, skills/auras, and dynamic-navigation-only blocking.

## Consequences

- Projects without an active heroes v1 selection publish no hero snapshot, allocate no hero
  runtime state, and retain their previous player and checkpoint shape.
- Authors and agents can establish a reusable roster and visual identity before choosing any active
  hero mechanics.
- A static displayed unit is intentionally not controllable in R5.1A; UI and documentation must not
  advertise movement or combat abilities yet.
- Keeping the unit derived avoids a premature persistence contract and lets R5.1B design retarget,
  terrain-cost, dirty-occupancy, and mid-edge behavior under its own RED tests.

## Verification

R5.1A begins with independent RED contract suites for engine authoring/runtime, CLI guarded
authoring/build, Studio, MCP/AI, shared renderer projection, and optional hero visual bindings.
Completion additionally requires legacy/disabled/future fixtures, Canvas and Phaser on hex and
square maps, PWA/single-file/web-package/`.tdpack`, plugin parity, full relevant gates, and separate
code and constructor-integration sign-offs. Final counts are recorded in `docs/ROADMAP.md` only
after those checks pass.
