# ADR 0022: Opt-In Dynamic Flow Navigation

Date: 2026-07-24

## Status

Accepted for R2. Independent code and constructor-integration sign-offs completed on 2026-07-25.

## Context

TowerForge currently moves ground enemies over authored `pathRoutes` and direct-flying enemies over a topology line. Placement validates terrain, footprint, aura, occupancy, and funds, but does not prove that a walkable/buildable maze remains connected. R2 adds dynamic navigation without changing legacy projects, adding per-enemy A*, or absorbing R3 elevation and transactional terraforming.

## Decision

### Activation and closed JSON contract

`navigation` becomes an implemented mechanics module at schema v1. It remains active only through the R0 catalog and mission selection gates. Its named profile is this closed discriminated union:

```ts
type NavigationProfileV1 =
  | { readonly mode: "authored_routes" }
  | {
      readonly mode: "dynamic_flow";
      readonly defaultMovementProfileId: string;
      readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
      readonly enemyMovementProfiles?: Readonly<Record<string, string>>;
    };

interface MovementProfileV1 {
  readonly label: string;
  readonly terrainMode: "respect_walkable" | "ignore_walkable";
  readonly towerOccupancy: "blocked" | "ignored";
  readonly defaultTerrainCost: number | null;
  readonly terrainCosts?: Readonly<Record<string, number | null>>;
}
```

Costs are fixed-point safe integers where `1000` is one normal tile. `null` is impassable. An explicit `terrainCosts[terrainId]` wins; otherwise `respect_walkable` first blocks a terrain whose `TerrainTypeDefinition.walkable` is false, then `defaultTerrainCost` applies. The cost of an edge is the cost of the tile entered. The same cost controls route choice and traversal time. `towerOccupancy: "blocked"` removes occupied cells from the profile graph; `"ignored"` supplies burrowing/flying bypass. Target class remains independent: no runtime inference from `targetClass`, `movementKind`, terrain IDs, or elemental names.

In particular, an enemy whose legacy `movementKind` is `direct_flying` still uses the direct topology line whenever navigation is inactive or in `authored_routes` mode. Under `dynamic_flow` it resolves the explicit enemy assignment or the default profile like every other enemy; it bypasses terrain/towers only if the author assigns an appropriate profile. Recipes may suggest that assignment but never synthesize it.

Example authoring shape:

```json
{
  "schemaVersion": 1,
  "modules": {
    "navigation": {
      "schemaVersion": 1,
      "enabled": true,
      "profiles": {
        "maze": {
          "mode": "dynamic_flow",
          "defaultMovementProfileId": "ground",
          "movementProfiles": {
            "ground": {
              "label": "Ground",
              "terrainMode": "respect_walkable",
              "towerOccupancy": "blocked",
              "defaultTerrainCost": 1000
            },
            "air": {
              "label": "Flying",
              "terrainMode": "ignore_walkable",
              "towerOccupancy": "ignored",
              "defaultTerrainCost": 1000
            }
          },
          "enemyMovementProfiles": { "drone": "air" }
        }
      }
    }
  }
}
```

Absent, disabled, unselected, and selected `authored_routes` profiles use the exact existing movement/placement implementation. They allocate no solver/cache, add no snapshot/checkpoint keys, and preserve `movementKind: "path" | "direct_flying"`. Disabled profiles are structurally validated; their broken content references and reachability are warnings. Active dynamic profiles require all references and initial safety pairs to be valid. Unknown fields, hostile shapes, unsupported versions, and budget overflow fail closed regardless of activation.

The bundled `basic_dynamic_navigation` recipe materializes one inert candidate profile with independent `ground`, `floating`, `burrowing`, and `flying` presets. Ground respects walkability and tower occupancy; floating respects walkability but ignores tower occupancy; burrowing and flying ignore both walkability and tower occupancy. The recipe does not add `enemyMovementProfiles`, edit terrain, enable the module, select a mission profile, or write project files. Authors explicitly review assignments and terrain costs before the existing guarded preview/apply transaction.

### Existing maps become endpoint catalogs

R2 adds no map JSON fields. For dynamic flow, each existing route is an endpoint pair: its first coordinate is the spawn and its last coordinate is the goal; interior coordinates remain validated so disabling the capability always yields a valid authored route, but dynamic movement ignores them. This already represents multiple spawns, routes, and goal/core coordinates. Routes ending at the same coordinate share a field. Multiple goal coordinates still damage the mission's one existing `coreHp`; independent core health belongs to a later gameplay module.

The route set is `pathRoutes` or the existing synthesized `main` route over `pathCenterline`. Dynamic route IDs must be unique. Omitted `routeId` selects `main`, else the binary-lowest route ID; authored-route mode retains its legacy default and order. Every dynamic algorithm canonicalizes route/profile/terrain IDs in binary order and coordinates by numeric `(r,q)`, so input record/route order cannot change a field or digest.

The placement safety set contains the route/profile pairs reachable from mission wave groups, the transitive death/phase-spawn graph, and mission-bound `spawnEnemy` TowerScript actions. A live enemy's current profile/goal pair and current cell are also mandatory. Future Director pools must extend this set in R7 before they can spawn counters.

### One shared reverse-Dijkstra field

The pure engine owns `NavigationResolver`; Node, Studio, renderer, and MCP do not implement graph rules. Its cache key is `(movementProfileId, numeric goal coordinate, terrain revision, occupancy revision)`, not enemy or route ID. One reverse Dijkstra starts at one traversable goal and relaxes topology predecessors with:

`candidate = distance[current] + effectiveCost(current)`.

Queue order is `(distance, r, q)`. For equal-cost next cells, the winner is the lowest direction index from `GridTopology.neighbors(node)` (`NW,NE,W,E,SW,SE` for odd-r hex; `N,E,S,W` for square), then numeric `(r,q)`. All additions stay safe integers. Every stored next link strictly lowers distance, so fields are acyclic. There is no per-enemy A*, BFS, random choice, `Math.random`, or renderer pathfinder.

Dynamic enemy state is additive:

```ts
interface EnemyNavigationStateV1 {
  readonly schemaVersion: 1;
  readonly movementProfileId: string;
  readonly currentCoord: GridCoord;
  readonly nextCoord?: GridCoord;
  readonly edgeProgress: number; // [0,1)
  readonly stepsEntered: number;
}
```

`EnemyState.navigation` is present only for active dynamic flow. The existing `routeId` identifies its endpoint pair. `pathProgress` remains present for wire compatibility and mirrors `stepsEntered + edgeProgress`, but dynamic engine/renderer logic must use `navigation`. On a cell boundary the enemy follows one cached next link; status and difficulty speed multiply `1000 / enteredTileCost`. `enemyEnteredTile.pathOrder` is `stepsEntered`. Target ordering uses remaining field cost, then enemy ID. Existing death/phase/script spawns advance over cached flow links from their selected route start or inherited current cell; they never start a search.

The authoritative dynamic progress key is `remainingCost = (1 - edgeProgress) * cost(nextCoord) + fieldDistance(nextCoord)`, or zero at the goal. `first` sorts the smallest finite remaining cost first; `last` reverses that order. Every other target mode preserves its legacy primary semantics: `strongest`, `largest_hp`, and `weakest` keep HP primary and replace only their old route-progress tie-break with smaller remaining cost; `fastest_ahead` keeps its existing pierce-only preference and then uses smaller remaining cost; `closest`/`furthest` keep topology distance to the discrete gameplay coordinate. Binary enemy ID is the final tie-break everywhere. An unreachable enemy has infinite remaining cost: it follows reachable enemies for `first`/progress tie-breaks and leads `last`.

The discrete gameplay coordinate is `currentCoord` below half an edge and `nextCoord` at/above half, matching legacy round-to-tile behavior; renderers may interpolate continuously. In dynamic mode sunlight definitions are resolved once from authored `(routeId,pathOrder)` entries to a coordinate set and test that discrete coordinate. Authored-route mode retains route/order sunlight matching. Thus `enemyEnteredTile.pathOrder` is a dynamic step counter, while sunlight never assumes that counter indexes the authored centerline.

Fields become dirty only after committed occupancy changes (place, move, sell, destruction), committed runtime terrain changes/restores, endpoint initialization, or checkpoint restore. Dirty reasons coalesce. Placement/move commits install their already computed candidate fields; other changes rebuild once at the next deterministic simulation boundary before movement, and changes produced during that tick stabilize once at tick end. Checkpoint creation requires a stable boundary. Pure reads may fill a derived cache but cannot rebind enemies, alter authoritative state, or alter state digests.

After a rebuild, an invalid in-progress edge is cancelled at `currentCoord` (`edgeProgress = 0`); the enemy takes the new canonical link if one exists. If its current cell is unreachable, `nextCoord` is absent, progress does not advance, it does not leak, and its ID appears in `stalledEnemyIds`. Restoring reachability resumes it on the next movement phase. This deterministic stall is the R2 behavior for route-breaking runtime terrain; R3 replaces it with transactional terraforming preflight/rollback.

R2 does not make terrain mutations transactional. Existing TowerScript terrain guards remain, and a committed mutation dirties the field. If such a mutation makes a live cell or required spawn unreachable, movement deterministically stalls and diagnostics report it; R3 will add multi-tile candidate validation and full rollback for terraforming.

### Placement contract

For a profile with blocked tower occupancy, `canPlaceTower`/`canMoveTower` evaluate the complete candidate footprint against every mandatory spawn and live-enemy cell before any resource spend or gameplay mutation. A move removes its old footprint and adds its candidate footprint atomically. Every required cell must still reach its selected goal. Failure returns:

```ts
{
  ok: false,
  reasonKey: "reason.lastPathBlocked",
  reasonParams: { movementProfileId: string, routeId: string }
}
```

The reported pair is binary-first. Rejection changes no resources, tower counter, occupancy, cache revisions, events, checkpoint, or digest. Selling/destroying a tower only removes occupancy. Footprints, multi-spawn, shared/different goals, terrain costs, and profiles that ignore occupancy are tested separately. Affordability may still short-circuit `canPlaceTower`; the compute-only overlay does not depend on funds.

| Active placement case | Navigation decision |
| --- | --- |
| Capability absent/disabled/unselected or profile `authored_routes` | Existing terrain/buildability/aura/occupancy checks only; no last-path analysis. |
| One dynamic profile with `towerOccupancy: "blocked"` | Candidate footprint is removed from that graph; every safety-pair spawn and live-enemy current cell must remain reachable. |
| One dynamic profile with `towerOccupancy: "ignored"` | That profile cannot veto placement and its field is not rebuilt for occupancy alone. |
| Mixed profiles | All blocked profiles are checked in binary profile/route order; the first failing pair rejects the whole atomic action. |
| Baseline already unreachable after a runtime terrain mutation | Reject with `reason.navigationUnavailable` and the first pair; do not misreport the candidate as the cause. |
| Baseline reachable, candidate disconnects it | Reject with `reason.lastPathBlocked` and the first pair. |

### Snapshot, analysis, commands, events, and persistence

The active dynamic snapshot gains only:

```ts
interface NavigationSnapshotV1 {
  readonly schemaVersion: 1;
  readonly mode: "dynamic_flow";
  readonly fields: readonly {
    readonly movementProfileId: string;
    readonly goal: GridCoord;
    readonly routeIds: readonly string[];
    readonly revision: string;
    readonly reachableTileCount: number;
    readonly reachableRouteIds: readonly string[];
    readonly unreachableRouteIds: readonly string[];
  }[];
  readonly stalledEnemyIds: readonly string[];
}
```

`revision` is a stable digest of field inputs, not a mutable generation counter. Arrays are canonically sorted. Flow distances and next links are not exposed in the regular snapshot.

The engine additionally exposes a pure bounded `analyzeNavigation(request)` query. It returns the same field diagnostics and optional placement rows `{coord, ok, reasonKey?, blockingPair?}` in `(r,q)` order; `blockingPair` is the same binary-first pair an action would report. Placement rows require an explicit coordinate subset. Studio includes every viewport tile when the viewport has at most 4,096 cells. For a larger viewport it selects a deterministic window of at most 4,096 cells nearest to the most recent pointer/keyboard interaction anchor, with numeric `(r,q)` tie-breaks, and reports analyzed/total counts as partial coverage. This selection is independent of source record order. Analysis never dispatches a command, appends a journal entry, emits an event, consumes RNG, changes a cache revision, rebinds an enemy, or changes a state digest. Exceeding a query budget fails the whole query with no partial rows.

Cache build/hit/relaxation counters are non-authoritative `NavigationResolverStats` available to engine tests and performance diagnostics only. They are neither `GameSnapshot` fields nor checkpoint/journal/replay data, and reads never affect routing. The regular snapshot exposes stable field input revisions and reachability, not process-history counters.

| Domain | R2 decision |
| --- | --- |
| `GameCommandV1` | No new command and schema stays 1. Existing place/move/sell/tick semantics are capability-dependent and replayed normally. |
| `GameEvent` / TowerScript events | No new event type. Existing placement events occur only after success; terrain/tile events remain. Stalls and field status are snapshot diagnostics, avoiding per-tick event spam. |
| TowerScript | Schema stays v5. No navigation action/scope/host access. Existing `spawnEnemy.routeId` chooses endpoints; its progress and engine child offsets walk cached links. Terrain actions only invalidate fields. |
| Checkpoint | Outer `GameCheckpointV1` and `towerforge-sim-v2` stay unchanged. Per-enemy navigation v1 is serialized inside `state.enemies`; fields/revisions are derived from content, terrain overrides, and tower footprints and are rebuilt/validated on restore. |
| Journal/replay/RNG | Journal v1, command v1, checkpoint v1, replay contract, and seeded RNG v1 stay unchanged. Continuous and restored/replayed runs must have equal digest and snapshot. |

Checkpoint restore rejects navigation on an inactive mission, missing/extra navigation on an active dynamic mission, wrong versions/profiles/routes, non-integer/out-of-map coordinates, invalid next adjacency, `edgeProgress` outside `[0,1)`, incoherent `pathProgress`, non-decreasing next links, over-budget state, and unreachable non-stalled claims. Validation happens before a restored game is published. Derived fields are rebuilt through the same resolver, not trusted from input.

### Budgets

| Contract | Limit |
| --- | ---: |
| Movement profiles / enemy assignments | 32 / 4,096 |
| Route endpoint pairs / unique goals / cached profile-goal pairs | 64 / 64 / 256 |
| Active dynamic map cells | 65,536 |
| Materialized field cells across required pairs | 4,194,304 |
| Terrain overrides per profile / across profile | 256 / 8,192 |
| Terrain cost | safe integer `1..1,000,000`, or `null` |
| Profile/route/terrain ID UTF-8 bytes; label chars | 128; 128 |
| Live dynamic enemy navigation states | 16,384 |
| Placement-analysis coordinates | 4,096 explicit coordinates |
| Placement-analysis relaxations per request | 8,388,608 |

Authored/runtime overflow is a validation or action/query failure; partial fields are never installed. Regular field rebuild admits no partial result. The 500-1,000-enemy proof is operation-based: one profile/goal field build, then O(1) next-link lookup per enemy per entered cell; adding enemies must not increase field-build count or invoke any per-enemy search.

### Constructor and AI surfaces

- Mechanics Hub owns mode, movement profiles, assignments, recipe preview, validation, enable/disable, and save/reload. Base tower/enemy/mission forms remain unchanged while disabled.
- Studio exposes that editor through an isolated detached navigation normalizer. Its `/api/navigation/analyze` facade delegates to the same MCP tool for saved-project authoring analysis. Live Playtest calls its current game's engine query so already placed towers and runtime terrain are included; viewports up to 4,096 cells are complete, while larger viewports use the deterministic interaction-anchor focus window and show explicit partial coverage. The server facade is only a compatibility fallback when that browser runtime lacks the query. `canPlaceTower` preflight and the subsequent `placeTower` action remain authoritative even outside the analyzed window. Generated Canvas/Phaser players request the same engine placement analysis and render identical allowed/blocked cues. Renderers interpolate `currentCoord -> nextCoord` and never calculate fields or placement validity.
- MCP adds compute-only `analyze_navigation` with bounded mission/profile/route/tower/coordinate filters. Capability descriptors and agent instructions direct AI through `describe_schema -> get_capabilities -> analyze_navigation/preview_mechanics_module -> guarded apply -> validate`.
- Navigation authoring continues through existing `preview_mechanics_module` and `apply_mechanics_module`, retaining revision guard, project-v3 upgrade, backup, complete validation, rollback, and no-write stale-revision behavior. `write_map` remains the route/endpoints authoring tool.

### Version table

| Domain | Version after R2 |
| --- | --- |
| Project manifest / mechanics catalog / navigation module | 3 / 1 / 1 |
| Snapshot navigation / enemy navigation state | 1 / 1 |
| Engine compatibility / checkpoint | `towerforge-sim-v2` / 1 |
| Command / journal / seeded RNG | 1 / 1 / 1 |
| TowerScript / persistent player profile | 5 / 3 |
| Multiplayer protocol | Not introduced by R2 |

## Required RED decision table

| Decision boundary | First failing contract |
| --- | --- |
| Absent, disabled, unselected, or `authored_routes` | Byte-equivalent legacy snapshot/checkpoint/golden behavior; no navigation allocation/query section or placement change. |
| Active/future/malformed profile | Closed-shape, version, budget, cross-reference, disabled-warning, active-error, hostile-object, and input-order properties. |
| Endpoint normalization | `pathRoutes` fallback, `main`/binary default, duplicate IDs, shared goals, different goals, multi-spawn, route-order permutations. |
| Solver determinism | Golden fields on hex/square; integer cost; direction and queue ties; terrain override/null; flying and burrowing bypass; record-order property tests. |
| Dirty cache | Exactly one coalesced rebuild per required pair after occupancy/terrain changes; none for unchanged ticks or enemy count; goal init/restore rebuild. |
| Placement | Center and radius footprints; last route/live enemy; move old-footprint exclusion; rejection before spend/counter/event/digest; ignored-occupancy profile. |
| Movement | 1, 500, and 1,000 enemies share fields; costs affect path/time; no per-enemy search; deterministic stall; entered-tile and target ordering. |
| Persistence | Dynamic checkpoint JSON round-trip, malformed-state rejection, continuous = checkpoint suffix = replay digest on both grids and route orders. |
| TowerScript boundary | No v6/actions/events; spawn/terrain compatibility; dirty-at-next-movement; no R3 transactional rollback promise. |
| Engine analysis | Canonical bounded output, explicit subset, no RNG/state/journal/event/digest mutation, overflow failure with no partial result. |
| Studio/MCP | Hub enable-edit-save-reload-disable-re-enable; stale revision/backup/rollback; AI describe-read-analyze-preview-apply-validate equivalence. |
| Player/renderers | Canvas/Phaser x hex/square show the same enemy interpolation and forbidden overlay; mouse/keyboard/touch placement rejects identically. |
| Delivery | Starter/templates unchanged; validate/sim/maps, engine/build/test/e2e, PWA/single-file/web/`.tdpack`, plugin gates; independent code and constructor-integration sign-offs. |

## Consequences and exclusions

Dynamic flow is an optional engine capability over the existing map format, so authors can disable it and recover the authored-route game. Costs, traversal, placement safety, replay, analysis, and rendering share one topology-owned truth. Field work scales with profile/goal pairs rather than enemy count.

Elevation/LoS, push/pull/falls, flood/moat/bridge recipes, multi-tile terrain transactions, incremental flow-field optimization, hero blocking, power/logistics, Director counter pools, multiplayer ownership, and Visual Graph changes are explicitly outside R2. R3 may consume the invalidation/preflight contracts but must not fork the solver.
