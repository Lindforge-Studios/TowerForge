# ADR 0027: Opt-In Transactional Terraforming

Date: 2026-07-25

## Status

Accepted. The complete R3.4b vertical slice passed independent RED evidence, code verification, constructor-integration verification, and regression gates on 2026-07-25. The accepted scope comprises capability/schema/validation and TowerScript v6 foundation; runtime C1/C2A/C2B1/B2A/B2B/C3A/C3B; active-only C4A legacy TowerScript and C4B `path_water` adapters; C5A CLI/MCP/AI authoring; C5B Studio Mechanics Hub authoring; and C6 shared Canvas/Phaser/player presentation plus package surfaces. C1 covers persistent terrain transactions on `authored_routes`; C2A adds verified dynamic-flow candidates and atomic adoption; C2B1/B2A/B2B close bounded spawn provenance, parent→child field obligations, safety preparation, and runtime consumption before resolver construction. C3A adds persistent effective elevation and real TowerScript `elevationChanged` dispatch. C3B adds bounded timed set-only batches, deterministic grouped expiry, active-only snapshot expiry state, and exact inner checkpoint schema v2 with v0/v1 compatibility. C4A routes active `setTileTerrain`/`restoreTileTerrain` through the common transaction; C4B does the same for the full immutable-base `path_water` selection. C5A adds exact engine descriptors, project-bound parameterized inert recipes, guarded mechanics/script authoring, and safe stdio/plugin integration. C5B adds detached parameter materialization and guarded profile authoring inside a separate Terraforming card. C6 adds one bounded descriptor-safe projector, common topology-specific autotile invalidation, snapshot-authoritative elevation cues, and full-redraw fallback while keeping absent/disabled/unselected projects on the legacy path.

## Context

TowerForge already has bounded legacy `setTileTerrain` / `restoreTileTerrain` actions and the `path_water` ability. Before C4A/C4B those paths mutated runtime terrain and then dirtied dynamic navigation without staging a complete candidate or proving reachability before mutation. C4A closes that gap for the two TowerScript actions and C4B closes it for `path_water`, but only while terraforming is active; inactive capability states retain the literal legacy implementations. R2 supplied the shared deterministic flow-field solver, while R3.1–R3.4a supplied authored elevation, LoS/high-ground, and tile displacement without route-breaking terrain changes.

R3.4b must add optional terrain/elevation mutation without coupling it to displacement, inventing a second pathfinder, or changing projects that do not select the new capability. Failed mutations must leave gameplay map data, override state, navigation caches, enemies, terrain/elevation events, and renderer cues unchanged. A reached active action may still consume the deliberately reserved TowerScript budgets and append exactly one rejection diagnostic; because both are checkpointed runtime state, rejection does not claim whole-checkpoint or digest identity.

## Decision

### Independent capability

Add a new `terraforming` v1 module after `physics` in the mechanics allowlist and implemented-capability list:

```ts
interface TerraformingProfileV1 {
  readonly terrainTransitions?: Readonly<Record<string, {
    readonly fromTerrainTags: readonly string[];
    readonly toTerrainId: string;
  }>>;
  readonly elevation?: {
    readonly minimum: number;
    readonly maximum: number;
    readonly maximumDeltaPerOperation: number;
  };
}
```

The profile is an exact closed own-data record. A transition admits a set only when the current effective terrain has at least one listed source tag and the destination equals its author-defined `toTerrainId`. Empty profiles are valid and inert.

Terrain mutation depends only on active `terraforming`. Elevation mutation additionally requires an active elevation v1–v3 profile and the selected terraforming profile's elevation policy. Dynamic navigation is not a capability dependency: dynamic-flow missions use the existing solver, while authored-route missions use a bounded route check. Physics is never required.

Absent, disabled, unselected, malformed, and future terraforming capabilities add no snapshot/checkpoint state, solver work, preflight, or renderer surface. Existing terrain actions, water ability, and expiry retain their exact legacy behavior on that path.

### TowerScript v6 batch action

TowerScript v6 adds one action and one event; Visual Graph remains unchanged:

```ts
type TerraformOperationV1 =
  | { readonly kind: "set_terrain"; readonly target: TowerScriptTileTarget; readonly transitionId: string }
  | { readonly kind: "restore_terrain"; readonly target: TowerScriptTileTarget }
  | { readonly kind: "set_elevation"; readonly target: TowerScriptTileTarget; readonly elevation: TowerScriptExpression }
  | { readonly kind: "restore_elevation"; readonly target: TowerScriptTileTarget };

type TerraformTilesActionV1 = {
  readonly action: "terraformTiles";
  readonly operations: readonly TerraformOperationV1[];
  readonly duration?: TowerScriptExpression;
};
```

Actions and operations are exact closed own-data records. The dense operations array contains 1–64 entries. Duplicate `(layer, q, r)` targets are rejected; terrain and elevation may target the same tile in one batch. A duration is allowed only when every operation is `set_*`. Before any duration, target, or value expression is evaluated, the runtime checks the 512-group ceiling. It then evaluates the common duration exactly once, before all target and value expressions, and requires a finite number in `(0, 1_000_000_000]`; fractional values are valid. An invalid resolved duration always rejects with `invalid_action` / `terraform.duration_out_of_range`.

TowerScript v1–v5 reject `terraformTiles`; v6 accepts it. When terraforming is inactive, the new action is a deterministic no-op. Accepted C4A converts active legacy `setTileTerrain`/`restoreTileTerrain` execution to the common transaction without changing their public TowerScript shape or schema version. Native timed operations still reject a coordinate carrying a historic legacy `expiresIn`; active legacy set/restore reject both native same-layer ownership and historic legacy timed ownership with `terraform.target_owned`. Accepted C4B applies equivalent active ownership and transaction rules to `path_water` without changing the ability contract. The absent, disabled, and unselected paths retain their literal legacy action and ability implementations.

### Exact limits

```ts
const TERRAFORMING_LIMITS = {
  transitionDefinitions: 64,
  sourceTagsPerTransition: 8,
  sourceTagsAcrossProfile: 512,
  idOrTagUtf8Bytes: 128,
  operationsPerBatch: 64,
  operationsPerScriptTransaction: 64,
  distinctCellsPerBatch: 64,
  activeTerrainOverrides: 512,
  activeElevationOverrides: 512,
  activeOverridesCombined: 1_024,
  elevationMinimum: -1_000_000,
  elevationMaximum: 1_000_000,
  maximumElevationDeltaPerOperation: 64,
  duration: 1_000_000_000,
  safetySourcesPerTransaction: 16_384,
  profileGoalFieldsPerTransaction: 256,
  fieldCellsBaselineAndCandidate: 8_388_608,
  pendingExpiryGroups: 512,
  pendingTerrainOwnership: 512,
  pendingElevationOwnership: 512,
  pendingOwnershipCombined: 1_024
} as const;
```

The full batch reserves its operation budget before expression evaluation or planning. The existing `scriptTerrainChangesRemaining` counter remains the authoritative per-script-transaction budget. If the complete reservation does not fit, the remaining terrain budget becomes `0` and the action rejects with `budget_exceeded` plus `terraform.operation_budget_exceeded`; no operation or target is inspected. Navigation's existing map/profile/route limits remain authoritative; R3.4b adds neither a search algorithm nor per-enemy A*.

### Candidate and atomic commit

Every active runtime terrain/elevation mutation follows one order:

1. Resolve and detach the active profile and action.
2. Reserve the complete operation budget.
3. For a timed action, require an all-set batch and reserve the expiry-group slot before evaluating any expression; then evaluate the common duration once.
4. Evaluate targets and values in declared order, then validate refs, bounds, duplicates, transition tags, elevation policy/delta, ownership, and override limits.
5. Build detached candidate terrain/elevation overrides, effective layers, expiry ownership, and future events.
6. Skip navigation entirely for elevation-only candidates.
7. For dynamic flow, build separate baseline and candidate `NavigationResolver` instances, materialize shared profile+goal fields, and prove all safety sources.
8. For authored routes, create no solver and prove every relevant route coordinate remains walkable.
9. On failure, discard the candidate.
10. On success, atomically publish override maps and effective layers, adopt the already-verified navigation candidate, clear/rebind lookups and enemy-field references, stabilize dynamic links, update expiry groups, and only then append events.

Before step 10 the live map, override maps, navigation resolver/generation/stats/lookups, enemy navigation state, expiry counters, gameplay snapshot sections, terrain/elevation event queue, and renderer cues do not change. Reserved operation/action budgets and the single typed rejection diagnostic are the only allowed failure observables. Rollback is therefore candidate disposal, never compensating mutation.

The runtime is delivered in bounded slices. Accepted C1 supports persistent terrain batches on authored-route missions. It reserves the full batch before expression evaluation, stages effective terrain and persistent override state, proves every authored route, and publishes all writes before ordered `terrainChanged` events. Accepted C2A uses detached baseline/candidate resolvers for active `dynamic_flow`, groups fields by movement profile and numeric goal, and globally distinguishes repair, unchanged failure, and newly blocked paths. Success publishes terrain and overrides, adopts the prewarmed resolver/cache/enemy-field map, rebinds live enemies, synchronizes compatibility cues, and only then appends events. Dead-yet-unreaped enemies carry a candidate field association without receiving a live rebind. Accepted C2B1/B2A combine canonical wave, transitive death/phase, and mission-reachable TowerScript v1–v6 spawn provenance with parent→child field obligations and endpoint/live sources, then freeze profile+numeric-goal groups without constructing or reading a resolver. Applied handlers alone expand the terrain fixpoint; disabled or unreachable scripts do not. Accepted B2B invokes that preparation before creating baseline/candidate resolvers and maps budget failure to the stable `budget_exceeded` / `terraform.solver_budget_exceeded` diagnostic. Exact ceilings cover `16 384` safety sources plus canonical causes/observations, `256` fields, and `8 388 608` baseline+candidate cells across normal fields and parent→child proofs. A fail-before-read sentinel demonstrates that overflow performs no resolver construction or field access.

For every non-self parent→child obligation, baseline and candidate checks require the child field to contain every cell in the corresponding parent field except the parent's terminal goal. A dead unreaped parent that can still emit a death spawn contributes its current cell as a pending source in the child field, but a parent already at its terminal goal contributes no such source. The ordinary safety set still covers route endpoints, canonical spawn sources, live current coordinates, and live in-progress next coordinates. Fields remain shared by movement profile plus numeric goal: the exact 8,191-live-enemy / 16,384-source runtime boundary materializes one candidate field, not one search per enemy. Snapshot lookup uses a non-counting field peek, so inspection does not change resolver statistics.

B2B preserves C2A's atomic boundary: successful terrain and override publication adopts the already-proven resolver, lookup cache, shared fields, and enemy rebinds before compatibility cues and events; rejection retains live map/navigation/cache/enemy identities and their statistics apart from the documented budget reservation and one diagnostic. It changes no public project, mechanics, TowerScript, snapshot, checkpoint, command, Studio/MCP, renderer, or player contract.

Accepted C3A layers persistent runtime elevation over the immutable authored base. `set_elevation` requires a safe integer inside both engine and active policy bounds and no more than `maximumDeltaPerOperation` from the current effective value; `restore_elevation` returns directly to the authored base and therefore does not reapply a transition-only delta constraint. The runtime stores only cells that differ from authored base; snapshots and checkpoints project them in canonical numeric `(r,q)` order. A same-layer duplicate is rejected, while terrain and elevation may target the same cell; mixed batches publish both layers atomically and emit committed terrain/elevation events in declared operation order. A no-op creates no override and no event. The existing 512-entry terrain and 512-entry elevation ceilings are enforced separately, with a 1,024-entry combined ceiling.

Pure elevation does not construct, inspect, invalidate, or adopt a navigation resolver or its fields. `GridMap.elevationAt`, active `snapshot.elevation`, engine-owned LoS, and high-ground read the effective value immediately after commit, while reset clears the runtime elevation layer. Successful change dispatches the real `elevationChanged {coord,fromElevation,toElevation,source}` event through TowerScript after commit. Inactive terraforming remains an exact no-op before dependency/policy inspection; active elevation operations reject missing elevation capability or policy with their stable reason keys.

C3A's checkpoint state is deliberately minimal and contains no duration ownership: `{schemaVersion:1,runtimeElevationOverrides}`. It is required, even when the array is empty, exactly when the mission has both active elevation and an active terraforming elevation policy; it is forbidden in every other capability state. The codec requires a dense exact array, canonical unique in-map coordinates, at most 512 entries, at most 1,024 combined terrain/elevation overrides, a safe integer inside engine and policy bounds, and a value different from authored base. Restore does not revalidate per-operation delta, validates the detached state before publishing the game, restores the effective elevation layer, and runs derived integrity checks; only a terrain component causes navigation rebuild. The strict event codec accepts `elevationChanged` only for that active combination.

The outer `GameCheckpointV1`, `towerforge-sim-v2`, command, journal, replay, RNG, project, mechanics catalog, profile, and multiplayer version domains do not change. The optional inner state participates in the normal state digest and checkpoint/replay equivalence. Inactive, disabled, and unselected checkpoint/snapshot byte shapes remain unchanged. C3A's contract run first demonstrated RED at 10/22; independent code verification then exposed missing runtime TowerScript dispatch and added another RED before the fix. Final evidence is full Vitest 1,623/1,623, Playwright 17/17, conformance 69/69, typecheck, engine/build, validate, sim, and plugin build/validate/smoke. Independent code and constructor-integration sign-offs are GREEN.

Accepted C3B adds native duration without changing persistent batches. A successful timed non-noop batch produces exactly one group; only effective changes enter it, the first sequence is `1`, and the monotonically increasing sequence advances only after publication. A timed no-op allocates no group, consumes no sequence, and emits no change event. Same-layer ownership is exclusive until expiry: another native timed or persistent set/restore rejects with `terraform.target_owned`; terrain and elevation ownership on the same coordinate remain independent. Before publication the runtime enforces 512 pending terrain targets, 512 pending elevation targets, 1,024 combined pending targets, 512 groups, and 64 entries per group. These ownership ceilings count even when the applied effective value equals the authored base and therefore has no runtime override row.

Each clamped `0..0.2` tick advances legacy `expiresIn` timers first and then the native groups. Native countdown uses an eight-ULP-scaled rounding bound so equivalent fractional partitions reach the same deterministic due boundary. All groups due in that tick are sorted by sequence and restored as one combined candidate in original operation order, with one baseline-plus-candidate navigation proof. Successful restore publishes all groups and emits only committed `source: "restore"` terrain/elevation events. An unsafe restore publishes none, retains every due group at `remaining: 0`, emits no diagnostic or partial event, and retries the same atomic candidate on a later boundary, including `tick(0)`.

C3B followed RED → GREEN with separate runtime/navigation/checkpoint contracts and verifier-authored regressions for authored-base projection and pending-ownership capacity. Final engine evidence is 71/71 focused tests, full Vitest 1,671/1,671 across 132 files, focused golden/checkpoint/replay/template conformance 198/198, and renderer/template regressions 53/53. Typecheck, engine build, project validation, simulation, full build, and plugin build/validate/smoke are GREEN. Full Playwright is 17/17; the isolated 4 templates × 2 grids × 2 renderers matrix is 1/1. Independent code and constructor-integration sign-offs are PASS.

Accepted C4A is an active-only compatibility adapter for the existing TowerScript `setTileTerrain` and `restoreTileTerrain` actions. A direct set must name a known authored terrain ID, but deliberately does not require a transition definition or source tag: the legacy action has no such public fields. After resolution, set and restore use the same detached candidate, authored-route or dynamic-flow proof, and atomic publication tail as native operations. Inactive, disabled, and unselected missions still execute the literal legacy branch, including its earlier expression order, repeat/max `expiresIn` behavior, checkpoint form, and state digest.

C4A fixes the active evaluation and budget order as follows: the action budget has already been consumed; reserve one terrain-operation slot; for a timed set check the 512-group ceiling, evaluate duration exactly once, and require it in `(0, 1_000_000_000]`; then evaluate `q` and `r`; then validate bounds, destination, ownership and capacity before building/proving/publishing the candidate. A true effective no-op stops after the required budget and expression work but before navigation proof, group allocation, sequence advance, map/navigation publication, event emission, or historic checkpoint-form promotion. An effective timed set uses one C3B native group with the exact prior override as its before-image and never writes a new legacy `expiresIn`. Existing native ownership or a restored historic legacy timer rejects with `terraform.target_owned`.

C4A began at 7 RED/4 GREEN. After correcting and migrating legacy-control fixtures, its focused suite reached 42/42; independent code verification added an authored-route no-op edge RED and confirmed the fix GREEN. The final relevant engine regression was 149/149. Code sign-off covered focused 134 plus the C4A matrix at 5×12 and full engine/shared 1,661; only sandbox-denied Studio listen probes failed outside those engine results. Constructor-integration sign-off covered focused 302, scripts 80, template/conformance 284, full 1,683, Playwright 17/17, all required gates, and byte-identical plugin runtime. Both independent sign-offs are PASS.

C4A raises no public TowerScript v6, project, outer checkpoint, snapshot, MCP, Studio, renderer, or player version/API.

Accepted C4B is an active-only compatibility adapter for `path_water`. Selection is computed from the complete immutable authored-path set inside the ability radius, not from the mutable effective terrain. A selection above the 64-operation limit rejects atomically with `terraform.operation_budget_exceeded`; it is never truncated or reduced to only cells that would change. After that size guard the exact failure priority is pending-group capacity, duration range, known authored `water` terrain, then same-layer native or historic legacy ownership. Cross-layer elevation ownership remains valid.

The adapter creates direct `source: "ability"` set operations and sends them through the common detached candidate, authored-route/dynamic-flow proof, and atomic publish tail. A successful effective use creates exactly one native group containing only changed cells and exact before-images; runtime terrain overrides carry `source: "ability"` but no outer `expiresIn`. All-no-op and partial-no-op uses still consume the complete ability cooldown and emit `waterAbilityUsed` with the full immutable-base selection. All-no-op allocates no group/sequence, emits no terrain changes, and preserves historic checkpoint form; partial no-op groups and emits only effective changes.

`temporaryWaterTiles` is a derived detached compatibility view rather than authoritative timer state. Historic legacy ability-water timers appear first; positive-remaining native ability-water targets follow in group-sequence and target-order order; duplicate coordinates are removed in first-observed order. A route-unsafe expiry retained at `remaining: 0` therefore keeps terrain and ownership for atomic retry but disappears from this cue. The special `path_water` slow follows the derived positive timer, not merely water terrain or ability source, so it is also absent during a zero-state retry and from persistent water.

Checkpoint restore accepts native terrain source `ability` only if terraforming is active, the mission authors `path_water`, the applied terrain is `water`, and the immutable authored terrain is `path`. Historic form remains unchanged through legacy expiry or all-no-op use; the next effective active ability use promotes it to inner schema v2. Reset clears runtime terrain, derived cues, native groups, sequence and cooldown while retaining the active empty v2 contract. Checkpoint/journal replay and fractional tick partitions preserve snapshots and digests. Absent, disabled, and unselected square/hex missions retain the literal legacy behavior, including selections above 64 and outer `expiresIn`.

C4B started with 16 RED/7 GREEN across 23 contracts. Final focused C4A+C4B is 35/35, all terraforming suites are 172/172, and the broader root set is 194/194. Independent code verification repeated all 23 contracts three times and full Vitest 1,706; constructor integration covered focused 194, golden/checkpoint/replay/template/conformance 326, Playwright 17/17, every required gate, and byte-identical plugin runtime. Both reviewers reported PASS with no findings.

C4B raises no public TowerScript v6, project, outer checkpoint, snapshot, MCP, Studio, renderer, or player version/API. Accepted C5A adds only additive CLI/MCP/AI discovery and guarded authoring. Accepted C5B adds the Studio surface, and accepted C6 adds shared renderer/player projection without changing those version domains.

### Reachability safety set

The placement-only `navigationMandatoryPairs` is insufficient because it filters on tower occupancy. Terraforming builds its own canonical safety sources for every occupancy mode:

- every wave enemy/profile/route pair;
- transitive death and phase spawns;
- mission-reachable TowerScript `spawnEnemy` actions;
- all route sources and goals, including multi-goal maps;
- each live enemy's current coordinate;
- its in-progress next coordinate when `edgeProgress > 0`.

Ordering is movement profile ID, goal `(r,q)`, route ID, source-kind rank, source `(r,q)`, then enemy ID. Each profile+goal field is built once regardless of enemy count. Source and goal must be enterable, and every route/live source must occur in the candidate field.

An inaccessible baseline may be repaired. If the candidate remains inaccessible, return `terraform.navigation_unavailable` or `terraform.authored_route_unavailable`; if a reachable baseline becomes inaccessible, return `terraform.last_path_blocked` or `terraform.last_authored_route_blocked`.

### Timed groups

A successful timed non-noop batch owns one expiry group containing only its effective layer/coordinate changes and exact before-images. Ownership is exclusive per layer: it cannot be overwritten, manually restored, or replaced by another batch before expiry. Cross-layer ownership of the same coordinate is valid. Expiry does not run one transaction per group: every group due at the boundary is combined into one restore candidate and one route-safety proof. If that combined candidate is unsafe, all due ownership remains at `remaining: 0` for a silent deterministic retry; there is no partial commit and no expiry diagnostic. Historic legacy timers advance first and otherwise retain their pre-C3B behavior. C4A/C4B create no new legacy timer on the active path; timed TowerScript sets and effective `path_water` changes join the native group model.

### Stable failure reasons and events

The engine uses:

```text
terraform.invalid_operation
terraform.operation_budget_exceeded
terraform.duplicate_target
terraform.target_outside_map
terraform.transition_missing
terraform.transition_source_tag_mismatch
terraform.elevation_dependency_missing
terraform.elevation_policy_missing
terraform.elevation_out_of_range
terraform.elevation_delta_exceeded
terraform.override_budget_exceeded
terraform.duration_out_of_range
terraform.expiry_group_budget_exceeded
terraform.target_owned
terraform.authored_route_unavailable
terraform.last_authored_route_blocked
terraform.navigation_unavailable
terraform.last_path_blocked
terraform.solver_budget_exceeded
```

TowerScript diagnostics gain optional `reasonKey`; ordinary invalid and budget classifications remain. Successful terrain changes retain the existing `terrainChanged` event. TowerScript v6 adds `elevationChanged { coord, fromElevation, toElevation, source: "script" | "restore" }`. Events follow declared operation order and appear only after full commit; no-op values emit nothing.

### Snapshot, checkpoint, and version domains

Active terraforming adds `snapshot.terraforming` schema v1 with canonical detached `pendingExpiryGroups`; each row exposes only `{sequence,remaining,targets:[{layer,q,r}]}`. It is present only for an active selected terraforming capability and is omitted for absent, disabled, unselected, malformed, or future modules. `snapshot.tiles` remains authoritative effective terrain, `snapshot.terrainOverrides` remains wire-compatible, and `snapshot.elevation` remains schema v1.

Checkpoint outer v1, engine v2, command v1, journal v1, replay v1, RNG v1, project v3, mechanics catalog v1, player profile, and multiplayer versions do not change. The exact active inner schema v2 is `{schemaVersion:2,runtimeElevationOverrides,nextExpiryGroupSequence,pendingExpiryGroups}`. Each group is `{sequence,remaining,entries}`. A terrain entry records `{layer:"terrain",order,q,r,appliedTerrain,previousOverride:null|{terrain,source}}`; an elevation entry records `{layer:"elevation",order,q,r,appliedElevation,previousElevationOverride:number|null}`. Exact before-images restore the state that existed before the timed batch, including a prior persistent override.

The codec accepts historic terrain-only form v0 (no inner terraforming section) and C3A form v1. Restore and re-emission preserve their form and digest until the first successful timed non-noop batch promotes the state to v2; fresh active terraforming state emits v2. Schema v2 validates canonical sequence/order, bounds, ownership, applied effective projection, and before-images before publication. A terrain target with `source: "ability"` is valid only for active terraforming when the mission authors `path_water`, its applied terrain is `water`, and its immutable authored base is `path`; otherwise restore fails closed. A terrain-only v2 checkpoint rejects non-empty runtime elevation or elevation expiry entries instead of accepting hidden inactive elevation state. Inactive checkpoints retain their legacy byte shape and reject injected terraforming state.

### Recipes and authoring surfaces

Accepted C5A adds `tagged_flood`, `tagged_moat`, and `tagged_destructible_bridge` as parameterized inert recipes. The caller supplies a real authored source tag, destination terrain ID, and optional transition ID. A recipe validates closed own-data fields, 1–128 UTF-8 byte limits, and authored references, then proposes only a profile transition and a TowerScript v6 snippet. It never enables/selects the module, writes a script or map, adds terrain, or invents IDs such as `water`, `void`, or `bridge`. Recipes that do not declare parameters reject them rather than ignore them.

Accepted C5B gives Studio a separate Terraforming Mechanics Hub card, transition table, optional elevation policy, and binary-sorted authored tag/terrain selectors that keep missing authored values visible. A narrow read-only recipe endpoint delegates to the shared project-bound `get_recipe` tool with a closed body and sanitized response. Materialization changes only a detached draft and a read-only TowerScript v6 snippet; preview is write-free, while enable/save/disable continue through the common revision-guarded mechanics transaction. Future terraforming versions remain lossless and entirely read-only. Global Disable preserves profiles and every mission selection while setting the module inactive, so re-enable restores authored intent without reconstruction. Ordinary entity and mission forms remain unchanged. Raw TowerScript schema already supports v6; Visual Graph does not.

Accepted C5A MCP/AI follows `describe_schema("terraforming") → get_capabilities → get_recipe(parameters) → preview_mechanics_module(explicit missionId, enabled:true) → guarded apply → upsert_tower_script(separate revision) → validate_project`. Descriptors reuse the exact engine contract and publish limits, dependencies, actions, reasons, and snapshot rules. Existing revision, validation, backup, and rollback guarantees remain mandatory. Agent guide v15 documents this workflow; no project, module, TowerScript, snapshot/checkpoint, MCP protocol, or package version changes. The stdio transport drains FIFO frames before success exit and converts late broken-pipe errors into one controlled failure path. Accepted C5B preserves materialized non-parameterized recipes in the existing Studio GET, keeps parameterized recipes inert until explicit materialization, and adds no new AI tool or version domain.

Accepted C6 makes Canvas and Phaser consume the same fail-closed `projectTerraformingPresentation`. Effective `snapshot.tiles` and `snapshot.elevation` are authoritative across first frame, reset, checkpoint restore, missed events, and malformed/future event data. Current `terrainChanged` and `elevationChanged` events are bounded invalidation hints only; `pendingExpiryGroups` are validated as active v1 wire state but never emitted as per-frame invalidation roots. The projector reads exact own-data descriptors, applies group/event/root budgets, rejects malformed and future data without invoking accessors, and returns detached deeply frozen terrain/elevation roots plus the shared elevation presentation.

`expandAutotileInvalidations` is the common renderer helper: square expands each root to self plus eight neighbors and odd-r hex to self plus six, then filters against current tiles, deduplicates, sorts by `(r,q)`, and returns a detached frozen result. Canvas and Phaser union event hints with authoritative snapshot-diff roots. If the union exceeds the bound or expansion fails, they perform a full redraw instead of losing the snapshot difference. Presentation adds no terrain transition, elevation, navigation, expiry, or gameplay calculation. Studio Playtest and generated PWA, single-file, web-package, and `.tdpack` surfaces ship the same renderer modules. The public opt-in fixture is `docs/examples/opt-in-transactional-terraforming/`; absent, disabled, and unselected missions retain no terraforming section or extra surface.

## Required RED and acceptance evidence

- Every capability state; closed profiles/actions; hostile accessors, symbols, prototypes, proxies, and sparse arrays; every exact limit at, below, and above the boundary.
- Active errors versus inactive warnings for tags, terrain IDs, policies, and dependencies; TowerScript v1–v5 rejection and v6 acceptance.
- Inactive `terraformTiles` no-op and byte-for-behavior legacy terrain/water/expiry paths.
- Single and multi-layer batches; duplicate runtime targets; same-cell cross-layer changes; transition allow/deny; no hardcoded terrain IDs.
- Failure leaves map, overrides, resolver identity/generation/stats, enemy navigation, expiry state, terrain/elevation events, and renderer cues unchanged; only the documented action/operation budgets and one typed diagnostic may change.
- Authored route repair/reject; dynamic multi-spawn/route/goal; every movement profile and occupancy mode; transitive spawns; source/goal/current/next safety; parent→child full-field proof except terminal goal; pending dead source except dead-at-goal.
- Shared fields through the accepted 8,191-live-enemy / 16,384-source boundary; exact cause/field/field+proof-cell budgets reject before resolver construction/read; snapshot peeks do not change stats; elevation-only leaves navigation untouched and immediately updates LoS/high-ground.
- Accepted C3A contract evidence starts at RED 10/22, plus a verifier-authored RED for real `elevationChanged` dispatch; GREEN covers set/restore, policy and delta failures, mixed order, layer/combined budgets, reset, effective snapshot/LoS/high-ground, strict checkpoint state, digest/replay, and legacy byte-shape equivalence.
- Accepted C3B began with failing duration/runtime/navigation/checkpoint contracts and two verifier-authored RED regressions for authored-base projection and pending-ownership capacity. GREEN covers evaluation order, group and ownership boundaries, exclusivity, no-op allocation, partition-stable countdown, combined due restore, unsafe zero retry, legacy coexistence guards, snapshot v1, checkpoint v2, historic-form preservation/promotion, hostile restore rejection, and replay digest equivalence.
- Accepted C4A began at 7 RED/4 GREEN, reached 42/42 after control-fixture correction/migration, and includes a verifier-authored RED for an active authored-route no-op. GREEN covers active direct known-terrain set/restore without transitions, shared authored/dynamic proof and publish, native timed ownership/checkpoint v2, exact budget/expression order, no-op early exit, historic-timer collisions, and literal absent/disabled/unselected legacy behavior.
- Accepted C4B began at 16 RED/7 GREEN across 23 contracts. GREEN covers immutable-base full selection, atomic over-64 rejection, exact guard priority, ability-source common proof/publish, changed-only native grouping, all/partial no-op ability semantics, derived/deduplicated temporary-water cues, zero-retry cue/slow removal, checkpoint source gating/form promotion/reset, replay/partition equivalence, and literal inactive square/hex behavior.
- Studio enable/edit/save/reload/disable/re-enable; equivalent guarded AI flow; Canvas/Phaser × hex/square; PWA, single-file, web package, `.tdpack`, plugin, and harness gates.
- C6 started at 11 RED; repair regressions covered exact keys and malformed UTF-16. Final evidence is focused 48/48, package 3/3, Studio 8/8, player 2/2, full Vitest 1,777/1,777, E2E 27/27, the template/grid/renderer matrix, and every prescribed gate. The browser pass caught and fixed the stale Studio `drawElevationCues` call. Independent code and constructor-integration reviewers both reported PASS without findings.
- Independent code and constructor-integration sign-offs by reviewers who did not author production code.

## Deferred and forbidden scope

R3.4b does not add a pathfinding algorithm, per-enemy A*, displacement/fall changes, Visual Graph nodes, static source-map transaction replacement, arbitrary code or host access, persistent project mutation during play, hardcoded terrain IDs, procedural generation/assets, GameCommand variants, project v4, renderer gameplay math, or any R4–R8 system.

## Consequences

Authors can opt into bounded persistent or timed terrain/elevation changes without enabling physics. The same existing navigation solver validates terrain candidates exactly once per shared profile+goal, while elevation-only candidates bypass it and failed attempts are observationally inert. Timed native batches add explicit ownership and checkpoint state only for active terraforming; inactive projects keep their legacy wire shape and behavior. Active legacy TowerScript terrain set/restore and `path_water` now share those atomic guarantees without changing their public schemas. CLI/MCP/AI agents and Studio can discover and author the same capability through detached parameterized recipes and guarded revision domains. Canvas, Phaser, Studio Playtest, generated players, and package outputs display effective changes through one snapshot-authoritative presentation contract without taking ownership of gameplay rules.
