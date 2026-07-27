# ADR 0019: Opt-In Armor Matrix

Date: 2026-07-24

## Status

Accepted

## Context

R1.1 established one resolver/application boundary and R1.2 inserted stateful shields without changing legacy projects. R1.3 needs author-defined damage and armor types across every existing damage source, but must not hardcode elemental presets, duplicate resolution in renderers, introduce reaction behavior, or create mutable state for a static lookup table.

The change also needs an explicit compatibility boundary: an older client that knows combat v1 must not silently ignore v2 armor fields, while an existing v1 shield profile must remain valid and upgradeable without forcing armor onto the project.

## Decision

- The mechanics catalog remains schema v1 and the authored project remains schema v3. The `combat` module owns its independent schema: v1 is shields-only; v2 retains optional shields and adds `damageTypes`, `armorTypes`, and enemy-only `armorAssignments`.
- Damage-type and armor-type IDs are project-authored. A damage type contains a bounded non-empty `label`. An armor type contains a bounded non-empty `label`, required `multipliers` keyed only by declared damage types, and an optional `defaultMultiplier`.
- A packet without `damageType` uses `physical`. Therefore, a profile with at least one enemy armor assignment must declare `damageTypes.physical`. An explicit matrix entry wins over `defaultMultiplier`; absence of both means `1`. A multiplier of `0` is valid and represents immunity.
- Every tower delivery, ability, TowerScript damage action, poison/status/DoT tick, enemy attack, and core leak continues through `DamagePacket` and the one engine boundary. For an assigned enemy the fixed order is `source modifiers -> armor matrix -> entity resistance -> legacy pierce_only -> shield -> HP`.
- Existing enemy `resistances` remain per-enemy overrides and multiply after the author-defined matrix. The `armor_piercing` tag preserves its compatibility meaning: it bypasses only legacy `pierce_only`, never the v2 matrix.
- R1.3 supports enemy assignments only. Tower armor, marks, vulnerabilities, exposures, reactions, and secondary effects are outside this increment and are not inferred from names such as `fire`, `ice`, or `lightning`.
- Validation is closed and bounded: at most 256 damage types, 256 armor types, 4,096 enemy assignments, 16,384 matrix entries, 128 characters per label, and multipliers in `0..1,000,000`. Unknown/unsafe structure and budget overflow are always errors. Broken semantic references in disabled profiles are warnings; preview/enable performs full semantic validation and rejects them.
- Armor definitions are immutable content, not runtime state. An armor-only profile does not create `snapshot.combat` or checkpoint combat state. The authored mechanics catalog still participates in the simulation content digest, so restoring a checkpoint against changed armor content fails before simulation.
- Studio exposes v2 editors only inside Mechanics Hub. Studio and MCP consume the engine schema descriptor, support an explicit guarded v1-to-v2 upgrade, reject downgrade/future versions, and preserve authored profiles across disable/re-enable.
- Project-bound recipes use the greater of their minimum combat version and the already-authored combat version. Consequently a shield-only v1 recipe remains composable after a project reaches v2 instead of accidentally requesting a downgrade.
- `basic_elemental_armor_matrix` is an optional recipe. It declares physical, magic, fire, ice, and lightning plus example plated/warded matrices and assigns at most one deterministic existing enemy. It does not enable reactions.
- Renderers and generated players receive the resolved result through existing snapshots/events. They do not read the matrix or calculate armor; armor-only content needs no new renderer projection.

## Consequences

- A missing mechanics file, disabled module, absent mission selection, or unassigned enemy keeps the legacy damage result and adds no armor result fields or runtime state.
- Combat v1 projects continue to run as shields-only. The authoring transaction may upgrade v1 to v2, but never downgrades v2 or rewrites version domains other than the project/catalog/mission files in that guarded operation.
- Content changes that appear presentation-free can still invalidate checkpoints because armor changes gameplay. Checkpoint schema and engine version remain independent and do not change for this stateless feature.
- The elemental recipe is convenient seed data, not a mandatory type taxonomy or a hidden dependency on future reactions.

## Verification

- Content and runtime: `packages/engine/src/content/armor-matrix.test.ts` and `packages/engine/src/simulation/damage-armor-matrix.test.ts`.
- Shared resolver and checkpoint/replay: the armor matrix cases in engine damage, shield, checkpoint, and replay suites.
- Guarded authoring: `packages/cli/lib/mechanics-authoring.test.mjs`, `packages/cli/lib/mechanics-recipes.test.mjs`, `packages/mcp/mechanics.test.mjs`, and `packages/studio/public/mechanics-surface.test.mjs`.
- Build/package compatibility: `packages/cli/build.mechanics.test.mjs` plus the Canvas/Phaser, hex/square, PWA, single-file, web package, and `.tdpack` gates.
- Reference data: `docs/examples/opt-in-elemental-armor-matrix/`.
