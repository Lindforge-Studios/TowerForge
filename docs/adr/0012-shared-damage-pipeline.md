# ADR 0012: Shared Deterministic Damage Pipeline

Date: 2026-07-23

## Status

Accepted

## Context

Legacy TowerForge damage was applied by several independent paths: tower attacks, lingering pulse damage, poison, abilities, TowerScript actions, enemy attacks, and core leaks. Deep-combat extensions need one deterministic ordering contract, but introducing shields, armor matrices, marks, or reactions together with that refactor would make equivalence impossible to review.

## Decision

- Define bounded, data-only `ModifierSpec` values in the pure engine. Resolution order is `base → tower_upgrade → meta → run → spatial → temporary`; within a stage it is `flat → additive_ratio → multiplier`, with binary ascending `id` as the final tie-break.
- Define a serializable `DamagePacket` with closed source kinds, target kinds, and tags. Runtime code rejects malformed references, unknown kinds/tags, non-finite values and arithmetic overflow, duplicate modifier IDs, unknown modifier enums, and modifier budgets above 64.
- Make `DamageResolver` stateless. R0B resolves `modifiers → entity resistance → legacy pierce_only adapter`; the caller then applies the result to HP.
- Route direct tower hits, tower/status DoT, abilities, TowerScript enemy/core damage, enemy tower attacks, and leaks through the same resolver.
- Keep entity mutation, status application, gameplay events, death removal, and rewards in `TowerDefenseGame`. A resolver call cannot remove an entity or grant rewards.
- Preserve legacy semantics: level-scaled tower damage is the base value, meta damage is a `meta` modifier, sunlight AoE is a `spatial` modifier, and non-tower sources retain their previous neutral resistance/armor behavior until an opt-in contract changes it.
- Publish `ModifierSpec` and `DamagePacket` through the engine schema descriptor and MCP `describe_schema` `combat`/`all` domains.
- Defer shields, author-defined armor matrices, marks, vulnerabilities, and elemental reactions to separate R1 RED/GREEN increments.

## Consequences

- New damage-producing mechanics have one typed integration point and cannot silently choose a different modifier order.
- Existing projects do not need `content/mechanics.json`; the resolver refactor is behavior-preserving infrastructure rather than an activated mechanic.
- The compatibility `pierce_only` rule remains explicit and removable after authored armor profiles exist.
- Event emission and reward ownership remain testable independently from arithmetic resolution.
- Future R1 slices must extend the resolver pipeline without moving gameplay mutation or secondary-effect budgets into adapters.

## Verification

- Pure contracts: `packages/engine/src/simulation/modifiers.test.ts` and `damage.test.ts`.
- Legacy source integration and exactly-once outcomes: `packages/engine/src/simulation/TowerDefenseGame.test.ts`.
- Machine-readable discovery: `packages/engine/src/content/schema-descriptor.test.ts` and `packages/mcp/tools.test.mjs`.
- Golden simulation and full touched-layer gates remain defined by `AGENTS.md`.
