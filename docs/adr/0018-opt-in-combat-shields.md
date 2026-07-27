# ADR 0018: Opt-In Combat Shields

Date: 2026-07-24

## Status

Accepted

## Context

R1.1 established one damage-application boundary, but a shield is stateful: it must absorb resolved damage before HP, regenerate deterministically, survive checkpoints/replay, expose typed TowerScript events/actions, and remain authorable without changing legacy projects. Canvas, Phaser, Studio, and generated players also need a consistent presentation without acquiring combat rules.

## Decision

- `combat` is the first executable mechanics module. A shield is active only when `content/mechanics.json` contains an enabled combat module, the mission selects an existing profile, and that profile assigns a shield to an existing enemy type or destructible tower type.
- Combat profile v1 is closed and currently accepts only `shields`. Each definition has a positive bounded `capacity` and optional bounded regeneration `{ ratePerUnit, delayAfterDamage }`.
- Runtime keys are entity instance IDs, not authored type IDs. Active snapshots and checkpoints add optional `combat.schemaVersion = 1` with enemy/tower shield state `{ current, capacity, regenerationDelayRemaining }`. Inactive games omit `combat` entirely.
- Damage keeps one application order: source modifiers, entity resistance and the legacy `pierce_only` adapter, shield absorption, then HP. Armor matrices, marks, vulnerabilities, and reactions remain separate later increments.
- Damage, regeneration, and script restoration emit `enemyShieldChanged` or `towerShieldChanged` with bounded state and a stable cause. TowerScript v3 may observe those events and use typed `restoreEnemyShield` / `restoreTowerShield` actions; actions clamp at capacity and never create a shield.
- Studio Mechanics Hub and MCP use the engine schema descriptor and one guarded preview/apply transaction. The bundled `basic_regenerating_shields` recipe is optional and targets at most one deterministic existing enemy and one destructible tower.
- `packages/renderer/src/combat-presentation.mjs` is a pure, fail-closed projection over `GameSnapshot.combat` and shield events. Canvas and Phaser consume this projection for visual rings/cues. They do not read mechanics profiles or calculate absorption, regeneration, activation, or damage.
- A valid terminal shield event may remain for the presentation frame in which its entity and the optional combat state have already disappeared. The shared projection accepts that bounded typed event, while an explicitly present unknown combat schema still fails closed. Break cues use only a safely detached previous position or a non-negative integer spawn/same-frame `towerPlaced` coordinate bounded to `1,000,000` per axis; this presentation-only fallback never changes simulation state.

## Consequences

- No mechanics file, disabled combat, no mission selection, or an empty active profile preserves the legacy simulation and drawing path. The ordinary starter remains unchanged.
- Checkpoint/replay digests include active shield state, so continuous and restored runs remain equivalent while project, checkpoint, profile, and protocol versions stay independent.
- Towers without `maxHp` cannot receive authored shields. This prevents a shield from silently making an otherwise indestructible tower participate in the tower-damage lifecycle.
- Presentation treats malformed/future snapshot sections as absent. A missing section is distinct from an explicitly present future section so a terminal v1 event can finish rendering without making version handling permissive. This is a renderer resilience rule, not an alternate validation or gameplay path.

## Verification

- Engine/runtime: `packages/engine/src/simulation/shields.test.ts` and `packages/engine/src/content/combat-mechanics.test.ts`.
- TowerScript schema/runtime: `packages/engine/src/scripting/schema-descriptor.test.ts` and the shield action cases in `shields.test.ts`.
- Guarded authoring: `packages/cli/lib/mechanics-authoring.test.mjs`, `packages/mcp/mechanics.test.mjs`, and `packages/studio/public/mechanics-surface.test.mjs`.
- Renderer/build: `packages/renderer/src/index.test.mjs` and `packages/cli/build.mechanics.test.mjs`.
- Reference data: `docs/examples/opt-in-basic-shields/`.

## Follow-Up

R1.3 extends the independently versioned combat module with v2 armor authoring while leaving this v1 shields-only contract unchanged. See [ADR 0019](0019-opt-in-armor-matrix.md).
