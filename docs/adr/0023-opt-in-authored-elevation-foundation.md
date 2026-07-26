# ADR 0023: Opt-In Authored Elevation Foundation

Date: 2026-07-25

## Status

Accepted. Independent code and constructor-integration sign-offs were issued on 2026-07-25.

## Context

R2 established topology-owned dynamic navigation without elevation. Later R3 slices need one deterministic map-height contract before they can add line of sight, high-ground modifiers, displacement, hazards, or route-breaking terrain changes. That foundation must remain optional: an author who does not select elevation must keep the established map, simulation, Studio, renderer, build, and package behavior.

The map dimensions already use `width` and `height`, so tile height is named `elevation`. The project needs one canonical sparse representation, an explicit capability switch, safe authoring transactions, and a presentation contract without prematurely introducing gameplay rules.

## Decision

### Slice boundary

R3.1 adds authored elevation data, capability resolution, immutable runtime lookup, an optional snapshot section, guarded constructor surfaces, and shared visual cues. It does not add line-of-sight checks, high-ground range/damage bonuses, push/pull, fall hazards, terrain mutation, bridge destruction, flood/moat recipes, or new TowerScript commands/events. Those require separate RED/GREEN cycles.

### Authored map data

`GridMapDefinition` gains one optional field:

```ts
interface GridElevationOverride extends GridCoord {
  readonly elevation: number;
}

interface GridMapDefinition {
  readonly elevationOverrides?: readonly GridElevationOverride[];
}
```

- A missing entry means elevation `0`; there is no authored `defaultElevation` field.
- `q`, `r`, and `elevation` are safe integers. Coordinates must be in bounds and unique. Elevation is bounded to `-1_000_000..1_000_000`.
- At most 65,536 overrides may be authored. Arrays must be dense ordinary data, and each item is a closed own-data `{q,r,elevation}` object.
- Explicit zero entries canonicalize away. Compiler output is sorted by numeric `(r,q)`, independent of source order.
- `maps/src/*.tmj` accepts a top-level `elevationOverrides` array or the same JSON value in a Tiled property. The compiler emits `elevationOverrides` only when nonzero values remain.
- Any authored elevation field requires project schema v3. Legacy v1/v2 sources, starter projects, and templates do not receive a synthesized field or implicit schema upgrade.

The engine map API exposes `elevationAt(coord): number | undefined`: an in-bounds cell resolves to its override or `0`; an out-of-bounds coordinate returns `undefined`. Terrain, topology, navigation, combat, and TowerScript do not consult this value in R3.1. Elevation is not added to every legacy `GridTile` or `snapshot.tiles` row.

### Opt-in module and runtime projection

- Add `elevation` as an executable mechanics module with module schema v1.
- The v1 profile is the closed empty object `{}`. It is a mission-level switch over map-authored data, not a second map-data container.
- A mission is active only when `content/mechanics.json` contains an enabled elevation v1 module and `mission.mechanics.profiles.elevation` selects an existing profile. Absent, disabled, unselected, missing-profile, future-version, and engine-unavailable states fail closed to the legacy path.
- The bundled `basic_authored_elevation` recipe returns an empty profile only. It never edits a map, enables the module, selects a mission, or writes a project.

An active snapshot may contain:

```ts
interface ElevationSnapshotV1 {
  readonly schemaVersion: 1;
  readonly defaultElevation: 0;
  readonly overrides: readonly GridElevationOverride[];
}
```

The section is present for an active flat map with `overrides: []`, detached from authored data, and sorted by numeric `(r,q)`. It is absent on every inactive path. Existing `snapshot.tiles`, events, commands, checkpoints, TowerScript, profile, and multiplayer schemas remain unchanged.

Elevation is immutable simulation content and already participates in the content digest through map definitions. Therefore an authored elevation change rejects restoration of a checkpoint made from different content, even when the module is disabled. The outer `GameCheckpointV1` and engine compatibility version do not change; continuous, restored, and replayed runs against the same content must keep the same digest.

### Constructor, AI, and renderer surfaces

- Mechanics Hub owns elevation v1 enable/disable/profile selection and uses the existing revision-guarded mechanics transaction.
- The Mechanics Hub owns a dedicated elevation map panel with layer brush and raw values while elevation is selected. It keeps a separate detached map draft and does not place elevation controls in ordinary map, tower, enemy, or mission forms.
- `preview_map_elevations` is compute-only. Its revision covers `project.json`, the compiled map aggregate, and every `maps/src/*.tmj`. `apply_map_elevations` writes one confined target source, recompiles maps, upgrades the manifest to project v3 when elevation is authored, validates the complete project, creates a backup, and rolls back only its owned source/compiled/manifest writes while preserving a conflicting external edit. Any change, addition, or deletion elsewhere in the map-source set invalidates the preview before stale compiled data can be published. Ordinary unsaved map edits must be resolved before apply.
- MCP and Studio share that transaction. The agent workflow is `describe_schema({domain:"elevation"}) -> read map source -> preview_map_elevations -> apply_map_elevations -> get_capabilities -> preview_mechanics_module -> apply_mechanics_module -> validate_project`.
- Canvas, Phaser, Studio Playtest, PWA, and single-file players consume one bounded fail-closed elevation presentation projector over `snapshot.elevation`. It may show a level badge or contour cue, but it never computes line of sight, range, damage, movement, or physics.

All write tools retain narrow schemas, `riskClass`/`sideEffect` metadata, revision checks, pre-write validation, backups, and rollback. Malformed/accessor/future/budget-overflow input fails closed before any project write.

### Version table

| Domain | Version after R3.1 |
| --- | --- |
| Project manifest / mechanics catalog / elevation module | 3 / 1 / 1 |
| Snapshot elevation section | 1 |
| Engine compatibility / checkpoint | unchanged / 1 |
| Command / journal / seeded RNG | 1 / 1 / 1 |
| TowerScript / player profile | unchanged |
| Multiplayer protocol | not introduced |

## Required RED Matrix

- Missing/disabled/unselected elevation keeps the legacy snapshot, generated player, Studio forms, and no runtime elevation section/allocation.
- Closed profile and map validation covers valid, malformed, accessor, sparse, duplicate, out-of-bounds, zero-canonicalization, future-version, and 65,536-entry budget boundaries.
- Hex and square compilation is input-order independent and supports both top-level and JSON Tiled-property forms without synthesizing legacy data.
- Active flat/non-flat snapshots are detached, canonical, fail closed on unknown versions, and do not alter legacy `snapshot.tiles`.
- Same-content continuous/checkpoint/replay digests agree; changed authored elevation rejects restore through the content digest.
- Studio performs enable -> edit -> preview -> guarded save -> reload -> disable -> re-enable and blocks stale revisions/dirty-map races with rollback evidence.
- AI performs the equivalent describe -> read -> preview map -> guarded apply -> capability -> preview/enable -> validate flow.
- Canvas and Phaser on hex and square show equivalent active cues and retain the absent/disabled draw path. PWA, single-file, portable web, `.tdpack`, and plugin gates remain valid.
- Two independent verifiers issue code and constructor-integration sign-offs before this ADR becomes Accepted.

## Consequences

Elevation becomes portable, deterministic map content without forcing gameplay semantics on authors or renderers. Later R3 slices can consume `elevationAt` and the active capability without changing the source shape or overloading the map dimension named `height`.

The active snapshot is a presentation/read contract, not authoritative mutable state. R3.1 intentionally leaves elevation invisible to routing, placement, damage, range, TowerScript, and checkpoint state. Any such behavior belongs to a later opt-in profile version or independent typed mechanic with its own TDD and sign-offs.
