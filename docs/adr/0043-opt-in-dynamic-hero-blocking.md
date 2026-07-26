# ADR 0043: Opt-in dynamic hero blocking

Status: Accepted

Date: 2026-07-27

Roadmap: R5.6A

## Context

Heroes v1-v6 provide one selected commander, deterministic movement, durability, a targeted
ability, an independently nullable battle-local skill tree, and an independently nullable passive
tower-damage aura. The next small vertical slice lets that commander hold a bounded number of
enemies without turning blocking into a mandatory rule, treating the hero as a tower footprint, or
forking the Dynamic Navigation solver.

Blocking differs from the aura in one important respect: it can only be defined against the
mission's active dynamic enemy movement profiles. The generic navigation contract deliberately has
no hardcoded `ground`, `flying`, or `burrowing` enum, so engine behavior must use explicit authored
profile references rather than infer a layer from an ID, label, terrain mode, target class, or tower
occupancy policy.

## Decision

### Authoring and cross-capability dependency

R5.6A monotonically extends the `heroes` module to schema v7. Every v7 definition retains the
complete v6 shape and adds required nullable `blocking`. `null` is the literal opt-out. A non-null
value is the following exact closed own-data object:

```json
{
  "blocking": {
    "blockCapacity": 2,
    "movementProfileIds": ["ground"]
  }
}
```

`blockCapacity` is a safe integer in `1..64`. `movementProfileIds` is a dense array of 1-32 unique
IDs, each containing 1-128 UTF-8 bytes; normalization sorts it in binary ascending order. Sparse
arrays, accessors, proxies that cannot be inspected safely, inherited fields, symbols, duplicates,
unknown fields, and values beyond those limits fail closed. These structural checks apply even when
Heroes is disabled or its profile is not selected.

Only the selected definition's non-null `blocking` has an active semantic dependency. Every mission
selecting that Heroes profile must also select an enabled Navigation v1 profile whose mode is
`dynamic_flow`, and every blocking movement-profile ID must exist in that selected navigation
profile. Missing, disabled, unselected, `authored_routes`, unsupported, and broken-profile cases are
validation errors when the blocking definition is active. The equivalent cross-capability issue is
a warning while the Heroes module/profile is inactive. Unselected hero definitions remain
structurally valid but their unused navigation references are warnings rather than activation
errors.

Neither validation nor authoring infers eligibility from `towerOccupancy`, `terrainMode`, enemy
`targetClass`, `movementKind`, profile names, or bundled recipe names. A developer decides exactly
which author-defined movement profiles the hero can hold. The engine does not add a separate
movement-layer enum in this slice.

An explicit Studio/MCP v6-to-v7 promotion is one module-level guarded transaction. Before editing
the selected definition it writes `blocking:null` to every definition missing the field in every
existing v6 profile. It preserves all unrelated profile data and then validates the complete
candidate atomically. Loading, validation, build, and play never promote content implicitly.
Unsupported future Heroes v8+ data stays opaque, lossless, read-only in authoring surfaces, and
fail-closed at runtime.

### Deterministic hold semantics

Blocking is runtime-active exactly when all of the following are true:

- the mission has the active, selected, non-null Heroes v7 definition;
- the same mission has its validated active `dynamic_flow` navigation profile;
- the selected hero is alive; and
- the mission outcome is `playing`.

The hero anchor is its authoritative `currentCoord`. A hero part-way across an edge still blocks at
the old current coordinate; renderer interpolation never enters gameplay. Hero movement runs before
enemy movement. Entering a new hero cell therefore releases the old anchor and establishes the new
anchor in the same tick before any enemy advances. A hero defeated later in the enemy-attack phase
releases all holds for the next enemy-movement phase. Terminal outcomes expose blocking as inactive
immediately.

At each enemy-movement boundary, an eligible current candidate is a live dynamic enemy whose
authored `movementProfileId` is listed by the hero, whose authoritative `currentCoord` equals the
hero anchor, whose `edgeProgress` is exactly zero, and whose current navigation field cell is
reachable. A stalled enemy is reported by Navigation and does not consume hero capacity. Existing
candidates are sorted by binary enemy ID and the first `blockCapacity` are held. A held enemy keeps
its coordinate, zero edge progress, path progress, and canonical next link; it spends no movement
budget. Status durations, attacks, cooldowns, damage, targeting, and every other enemy phase proceed
normally.

When blocking is active, dynamic enemies are processed in binary enemy-ID order. If a non-holder
enters the hero anchor at an exact cell boundary and a slot is still free, it acquires the slot and
stops before spending any remaining movement budget. The same check runs before goal/core leak, so
an eligible enemy already at, spawned at, or newly entering a hero-occupied goal is held when a slot
is available. When capacity is full, extra enemies continue through the cell or leak normally.
New arrivals cannot displace a current holder inside that movement phase. At the next stable
boundary, the complete co-located candidate set is derived again and the binary-lowest IDs win; no
acquisition history becomes persistent state.

Blocking does not add the hero coordinate to `NavigationResolver` occupancy. It does not dirty or
rebuild a field, change reachability, participate in last-path placement checks, alter terrain or
terraform transactions, change tower footprints, or run A* or another per-enemy search. Every
enemy keeps using its existing shared profile/goal field. The runtime performs at most one bounded
scan of the existing 16,384-live-dynamic-enemy limit per movement boundary and publishes at most 64
blocked IDs. It consumes no RNG and no `ModifierSpec` or effect budget.

### Snapshot, checkpoint, commands, and events

A selected non-null blocking definition publishes `snapshot.heroes` v7. Its one unit uses the
complete v4 movement/durability/mana/active-ability base and adds exact fields:

```text
skills: HeroSkillsStateSnapshotV5 | null
passiveAura: HeroPassiveAuraStateSnapshotV6 | null
blocking: {
  blockCapacity,
  active,
  blockedEnemyIds
}
```

`skills` and `passiveAura` are independently populated from their v5/v6 definitions. Blocking
snapshot IDs are dense, unique, binary sorted, bounded by `blockCapacity`, and are empty whenever
`active` is false. The engine is the only source of the set. Renderer, Studio, and generated
players may display the capacity and hold cues for only those IDs; they never infer profile
eligibility, coordinates, reachability, liveness, or assignment.

The literal compatibility matrix is:

| Selected v7 definition | Snapshot | Nested Heroes checkpoint |
| --- | --- | --- |
| tree `null`, aura `null`, blocking `null` | v4 | v3 |
| tree non-null, aura `null`, blocking `null` | v5 | v4 |
| aura non-null, blocking `null` | v6; skills nullable as in R5.5A | v3/v4 from tree only |
| blocking non-null | v7; skills and aura independently nullable | v3/v4 from tree only |

The held set is fully derived from already checkpointed hero/enemy navigation, durability, outcome,
and bound content. It adds no mutable checkpoint field and does not advance the nested Heroes
checkpoint beyond v3/v4. Checkpoint restore first validates and restores those existing fields and
the active dynamic navigation contract, then derives the same hold set. Continuous execution,
checkpoint suffix, and command-journal replay must produce the same snapshot and state digest.

R5.6A adds no gameplay command and no event. `GameCommandV6`, journal v6, outer
`GameCheckpointV1`, `towerforge-sim-v2`, project schema v3, mechanics catalog v1,
`PlayerProfileV3`, `CampaignRunV1`, multiplayer protocol, seeded RNG v1, and TowerScript v6 remain
unchanged. Blocking state is inspected through the authoritative snapshot rather than a per-tick
event stream. The MCP capability/schema guide may advance to its next authoring descriptor version;
that is not a simulation or transport protocol bump.

### Constructor, AI, renderer, and package surfaces

- `packages/engine` owns v7 normalization, dependency validation, candidate ordering, goal hold,
  snapshot v7, and checkpoint/replay equivalence. It remains pure TypeScript.
- CLI/project-loader code accepts v1-v7, preserves future v8 data, and exposes the inert
  `basic_dynamic_hero_blocking` recipe. The recipe may reference a conventional `ground` profile
  for review but never creates, enables, edits, or selects Navigation; it also never enables or
  selects Heroes implicitly. Previewing it against a project without the required active dynamic
  profile returns the ordinary semantic diagnostic without writing.
- Mechanics Hub contains the nullable blocking editor, capacity and profile-ID controls, dependency
  diagnostics, and explicit promotion. Main hero-adjacent tower, enemy, mission, and map forms do
  not receive disabled blocking controls, and Studio never auto-enables Navigation.
- MCP/AI advertises Heroes v7, snapshot v7, dependency rules, future v8 fail-close behavior, and the
  guarded `describe -> read -> recipe -> preview -> apply with revision -> validate` flow. Writes
  retain validation, backup, rollback, and stale-revision no-write behavior. The public authoring
  skill carries the same contract.
- The shared renderer validates and detaches snapshot v7 and projects only authoritative hero and
  blocked-enemy IDs. Canvas and Phaser show equivalent bounded hold cues on hex and square maps.
  They dispatch no new pointer, touch, keyboard, or headless input.
- Legacy templates, starter, PWA, single-file, web package, and `.tdpack` keep their old content and
  UI when blocking is absent or null. Packaging does not synthesize either mechanics module.

## Compatibility and exclusions

- Missing, disabled, unselected, v1-v6, v7-null-blocking, and unsupported-future paths retain their
  prior snapshot, checkpoint, input, build, and runtime behavior. A nullable v7 field is not an
  activation signal.
- R5.6A retains one selected hero. It adds no multiple-hero capacity sharing, taunt/threat rules,
  collision radius, footprint, attack interception, counterattack, damage reflection, enemy
  knockback, or crowd-control resistance.
- Blocking does not modify enemy speed/status, navigation field costs, tower occupancy, buildability,
  placement overlays, displacement, elevation/LoS, terrain, or route safety.
- There is no new active hero ability, skill effect, aura effect, TowerScript hero scope/event/action,
  logistics, power, ammo, factory, campaign carry, profile progression, or multiplayer ownership.
- Power grid and ammo/factory logistics remain separate later R5 increments and must not share this
  Heroes schema bump.

## Required RED and acceptance plan

The implementation starts with independently authored failing contracts before production edits:

1. Content RED covers exact v7/null shapes, 1/64 capacity boundaries, 1/32 unique profile IDs,
   UTF-8, canonical order, hostile inputs, disabled structural errors, inactive semantic warnings,
   active dynamic cross-references, module-wide v6-to-v7 promotion, and future v8 fail-close.
2. Runtime RED covers hex and square anchors, explicit profile filtering, capacity overflow, binary
   candidate order, zero-progress eligibility, mid-edge hero behavior, new arrival with a large
   delta, full-capacity pass-through, goal/core hold-before-leak, stalled enemies, hero movement,
   defeat, terminal outcome, and no RNG or read mutation.
3. Navigation RED proves no hero occupancy, dirty revision, resolver rebuild, per-enemy search,
   placement/last-path decision, terrain transaction, or `stalledEnemyIds` masking.
4. Snapshot/checkpoint RED covers every compatibility-matrix row, authoritative bounded IDs,
   malformed checkpoint rejection through existing state validators, continuous/checkpoint/replay
   digest equivalence, and literal absent/v1-v6/null fixtures.
5. Surface RED covers Studio edit/save/reload/disable/re-enable, multi-definition null promotion,
   dependency diagnostics without auto-enable, invalid/no-write and future read-only behavior, MCP
   recipe and guarded AI flow, stale revision, backup/rollback, and public plugin parity.
6. Player/package RED covers the shared fail-closed v7 projection, Canvas/Phaser on hex and square,
   authoritative hold/release/defeat cues with no new input controls, four templates, PWA,
   single-file, web package, `.tdpack`, and absent/null compatibility.

Acceptance requires the applicable typecheck, engine build, full unit/property/determinism/golden
tests, validation, tutorial simulation, balance, map compile, web build, full browser E2E, and
plugin build/validate/smoke gates. The author of production code cannot provide either final sign-off;
an independent Code Verifier and an independent Constructor Integration Verifier must both return
PASS before this ADR becomes Accepted.

## Acceptance evidence

Independent engine/content RED produced 44 expected failures with eight baseline passes. Independent
surface RED produced 32 expected failures with 49 baseline passes. During read-only verification,
the Code Verifier found one P2 terminal-ordering edge case: a precomputed holder could survive on
the goal after an earlier non-blockable binary-ID enemy caused defeat. A dedicated regression first
failed 1/1, then passed after the holder branch was made conditional on blocking remaining active.

The final isolated unit/property/determinism/golden gate passed 2,325/2,325 tests across 206 files.
The final isolated Playwright gate passed 107/107. Code re-verification passed 121/121 focused and
508/508 expanded contracts, including source/public-plugin byte parity. Constructor integration
verification passed 168/168 vertical contracts, 61/61 full Heroes regression, 4/4 shared
stale/rollback cases, 6/6 targeted v7/future-v8 browser cases, 19/19 template contracts, and the full
four-template × two-grid × two-renderer browser matrix. PWA, single-file, web package, and `.tdpack`
paths passed while the untouched starter remained mechanics-free.

Typecheck, engine build, project validation, tutorial simulation, balance, map compile, web build,
and plugin build/validate/smoke passed. Both independent verifiers returned PASS with no open P0–P3
findings. The public reference fixture is
`docs/examples/opt-in-hero-roster/mechanics-blocking.json`, paired with
`mission-blocking-selection.json`.
