# ADR 0021: Opt-In Data-Driven Elemental Reactions

Date: 2026-07-24

## Status

Accepted and implemented in R1.5. Independent code and constructor-integration sign-offs were completed on 2026-07-24.

## Context

R1.1 established one damage application boundary; R1.2-R1.4 added shields, armor, and marks. R1.5 must add reactions without inferring rules from elemental names, changing legacy projects, or forcing reactions on authors who only want existing combat mechanics.

The extension platform already reserves a separate `reactions` module. The contract must settle module dependencies, exposure lifetime, directional ordering, the post-HP hook, secondary-damage recursion, lethal origins, exact bundled recipes, and bounded author/runtime work before production code is written.

## Decision

### Versions and dependency

- Implement `reactions` module schema v1; keep combat at v3. Project schema v3 and mechanics catalog v1 do not change.
- An active reactions profile requires the same mission to select active combat v2/v3. All damage-type references resolve against that combat profile. Missing/incompatible combat yields `dependency_missing` and an active-project validation error.
- Disabled/unselected broken references are warnings. Unsafe shapes and authored budget overflow are always errors.
- Add optional top-level `snapshot.reactions` and checkpoint reaction-state schema v1. Do not change `snapshot.combat` v2 or outer checkpoint, command, journal, replay, profile, or multiplayer versions. A pending reaction queue is never serialized.
- TowerScript advances to v5; v1-v4 reject the new actions/events.

### Closed profile shape

```ts
interface ReactionsProfileV1 {
  exposures?: {
    definitions: Record<string, { label: string; duration: number; maxStacks: number }>;
    applications?: { damageTypes?: Record<string, Array<{ exposureId: string; stacks?: number }>> };
  };
  reactions: Record<string, {
    label: string;
    trigger: { damageTypes: string[] };
    requirements?: Array<
      | { kind: "exposure"; exposureId: string; minStacks?: number; consume?: "none" | "one" | "all" }
      | { kind: "status"; statusId: "poison" | "slow" | "stun"; consume?: "none" | "clear" }
      | { kind: "terrain_tag"; tag: string }
    >;
    suppressTriggerExposureApplications?: boolean;
    effects: Record<string, {
      kind: "damage";
      amount:
        | { kind: "flat"; value: number }
        | { kind: "source_after_modifiers"; multiplier: number };
      damageType: string;
      target:
        | { kind: "primary" }
        | { kind: "radius"; radius: number; maxTargets: number }
        | { kind: "terrain_tag"; tag: string; maxTargets: number };
      allowReactions?: boolean;
    }>;
  }>;
}
```

- Records and effects use binary ID order; trigger lists are non-empty/unique. Requirements are AND; duplicate `kind + id` requirements are invalid.
- Definitions are directional. A symmetric pair is two definitions.
- Exposure applications add/clamp stacks and refresh full duration. Potential matches are computed from one captured prior-state snapshot, then consumable exposure/status requirements are reserved and committed in binary reaction-ID order; a later rule requiring state already reserved by an earlier rule is skipped. Current-hit applications happen afterward unless a fired definition suppresses them, and only if the origin survives.
- Terrain predicates read current authored `TerrainTypeDefinition.tags`. Temporary-water presentation state and terrain IDs do not synthesize `wet`.
- Fan-out selectors always exclude the origin. `primary` may target it only while it survives.

### Resolver hook and ordering

The fixed order is:

`modifiers -> marks -> armor -> resistance -> legacy -> shield -> HP -> mark mutations -> reaction planning/consumption -> exposure application -> secondary FIFO`.

- Eligible roots are positive post-resistance/pre-shield enemy hits from direct tower, ability, or TowerScript sources. Full shield absorption is eligible. Status, enemy, leak, `over_time`, zero/immune hits, and reaction damage are ineligible by default. Area/armor-piercing roots remain eligible per target.
- A pure `ReactionResolver` returns state mutations, typed events, and secondary plans. `TowerDefenseGame` executes every secondary packet through the same damage boundary with source `{kind:"reaction", reactionId}` and tag `reaction`; fan-out also carries `area`.
- `source_after_modifiers` uses the primary `DamageResolution.afterModifiers`. Secondary damage still receives current marks, armor, resistance, legacy armor, shields, and HP.
- Execution is synchronous iterative FIFO, not stack recursion. Reaction/effect/exposure IDs use binary order. Fan-out targets use topology distance from captured origin, then binary enemy ID, with no duplicate per effect.
- `allowReactions` defaults false. Explicit chaining is limited to reaction depth 4 and 256 secondary packets per root hit.
- Capture origin coordinate, exposures, status, and terrain before HP mutation. A lethal origin may seed fan-out, but is never re-hit; a primary effect skips a dead origin; queued work skips a target already dead.
- Event subsequence is primary shield/mark changes, exposure consumption, `enemyReactionTriggered`, secondary subtree, then later `enemyKilled` settlement. Existing source-summary events stay at current call sites. `removeDeadEnemies()` remains the sole death/reward path.
- Exposures age after shield regeneration and marks, before status/DoT. `tick(0)` does not age them.

### Budgets and safety

| Contract | Limit |
| --- | ---: |
| Exposure definitions / reaction definitions | 256 / 256 |
| Damage-type bindings / applications per type / total applications | 256 / 16 / 4,096 |
| Requirements/effects per reaction / total effects | 8 / 8 / 2,048 |
| Live enemy exposures | 16,384 |
| Label chars / ID or tag UTF-8 bytes | 128 / 128 |
| Duration / stacks | `>0..1e9` / safe integer `1..256` |
| Flat damage / source multiplier | `>0..1e12` / `>0..1e6` |
| Radius / targets per fan-out | safe integer `1..64` / `1..64` |
| Reaction depth / secondary packets per root | 4 / 256 |

Authored overflow is invalid. Runtime exhaustion admits the stable prefix, drops the rest, and emits at most one `reactionBudgetExceeded` event per root and budget kind. Validation accepts only closed own-data JSON shapes: no accessors, exotic prototypes, symbols, sparse arrays, cycles, non-finite values, expressions, regex execution, `eval`, host APIs, filesystem, or network.

### State, scripts, and presentation

- `ReactionStateV1` stores only `enemyId -> exposureId -> {stacks, remaining}`. Empty state is absent. Checkpoint restore validates versions, refs, limits, binary keys, and selected profile before map creation; continuous and restored replay digests must match.
- Add `enemyExposureChanged` with cause `damage | consume | expiration | script`, and `enemyReactionTriggered` with reaction/origin/type/coordinate/damageType/depth/bounded target IDs. `reactionBudgetExceeded` is diagnostic and is not a TowerScript handler event.
- TowerScript v5 adds `applyEnemyExposure`, `clearEnemyExposure`, `enemyExposureChanged`, and `enemyReactionTriggered`. Actions are enemy-only, scope-aware, bounded, and never directly evaluate the matrix.
- Mechanics Hub owns reaction authoring. MCP uses capability-aware descriptors, project-bound recipes, and existing guarded preview/apply/validate with revision, backup, and rollback. Ordinary entity forms remain unchanged.
- Canvas and Phaser share a fail-closed projection for exactly reactions state v1: at most 8 binary exposure badges per enemy plus overflow and 32 cues per frame. Renderers never evaluate definitions, predicates, targets, damage, consumption, or expiry.

### Bundled recipes

| Recipe | Prerequisite | Exact behavior |
| --- | --- | --- |
| `elemental_shatter` | Active combat v2/v3 declares `fire`, `ice`, `physical` | Fire/ice exposures: duration 4, max stack 1. Two directions consume all opposite exposure, suppress current application, and deal `2 * afterModifiers` physical damage to surviving primary. |
| `wet_chain_shock` | Combat declares `lightning`; a terrain type has tag `wet` | Lightning on wet origin deals `0.5 * afterModifiers` lightning damage to up to 32 other alive wet-tile enemies in distance/ID order. |
| `poison_combustion` | Combat declares `fire` | Fire on active poison clears origin poison, then deals `1.0 * afterModifiers` fire damage to up to 32 other alive enemies within topology radius 2. |

All recipe effects are non-recursive. Recipes are independent project-bound seed profiles, never auto-enabled, and never patch combat, balance, terrain, or scripts. Unmet prerequisites are typed preview errors with no write; apply writes only the reactions profile/module and mission selection atomically.

## Required RED matrix

Tests must cover capability/version/dependency and disabled legacy paths; closed validation/cross-profile refs/budgets; exposure add-refresh-expire-consume order; eligible source/tag matrix; exact three-recipe formulas and target sets on hex/square; binary-order properties; shield/armor/marks; lethal origin; FIFO/depth/fan-out exhaustion; exactly-once death/reward; checkpoint/replay digest; TowerScript v5 gating; Studio save/reload/disable/re-enable; equivalent MCP guarded authoring; stale revision/rollback; Canvas/Phaser fail-closed presentation; template, PWA, single-file, web, `.tdpack`, plugin, and both independent sign-offs.

## Consequences

Reactions compose with combat v2/v3 without upgrading combat. Secondary effects retain the shared damage/death contracts while bounded FIFO prevents runaway graphs. Hardcoded elemental taxonomies, generalized statuses, tower/core reactions, Visual Graph, and provider/network work remain outside R1.5.
