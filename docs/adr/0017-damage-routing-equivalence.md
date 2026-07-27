# ADR 0017: Damage routing equivalence boundary

- Status: Accepted
- Date: 2026-07-24

## Context

The shared `DamagePacket` and stateless `DamageResolver` introduced in R0B already covered the arithmetic required by later deep-combat mechanics. R1 nevertheless needs a single mutation boundary before shields can be inserted safely. Leaving enemy, core, and tower HP application in separate resolver call sites would make it possible for a future source or target to bypass shields, resolve twice, or settle death and rewards from the arithmetic layer.

R1.1 is an equivalence increment. It must prove complete routing without changing authored content, project schemas, simulation snapshots, gameplay events, renderer behavior, or the legacy result of any existing project.

## Decision

`TowerDefenseGame.resolveAndApplyDamage` is the one private boundary that invokes `DamageResolver.resolve` and applies the returned `finalAmount` to mutable HP. Its target formulas intentionally preserve legacy behavior:

Before resolution or mutation, the boundary fails closed unless the packet target kind matches the mutable target and, for enemy or tower targets, the exact entity id and type id also match.

- enemy HP becomes `max(0, hp - finalAmount)`;
- core HP becomes `max(0, hp - finalAmount)`;
- destructible tower HP becomes `(hp ?? 0) - finalAmount` and remains subject to the existing immediate destruction flow.

Target-specific wrappers assemble typed packets and compatibility context, then delegate once to that boundary. They do not resolve or mutate HP independently. The routed inventory includes direct, chain, pulse, sniper, anti-air, splash, and pipeline tower damage; lingering tower DoT; ability damage; poison/status ticks; TowerScript enemy and core damage; enemy attacks on towers; and enemy leaks damaging the core. Area, multi-target, and chain delivery resolve once per delivered target.

Legacy ordering is unchanged: the producer computes its raw amount, packet modifiers run, tower-origin enemy damage applies entity resistance and the `pierce_only` adapter, the result reaches HP, and existing gameplay events and settlement run afterward. Non-tower damage retains its previous neutral resistance and armor behavior until an explicit later opt-in contract changes it.

Events, status application, enemy removal, tower destruction, kill counters, spawn-on-death, defeat, and rewards remain outside `DamageResolver` and `resolveAndApplyDamage`. `removeDeadEnemies` remains the sole enemy death/reward settlement owner, so multiple authored damage actions can resolve without granting a kill twice.

An enemy reaching the end of its route is a lifecycle transition rather than damage to that enemy. Setting its HP to the canonical removal marker `0` therefore stays outside the damage boundary; the resulting `leak` packet directed at the core still resolves exactly once. Healing, regeneration, initialization, and checkpoint restoration are likewise not damage routes.

R1.1 adds no damage or armor catalog, no mechanics profile, no snapshot section, and no Studio, MCP, renderer, player, CLI, or project-schema authoring surface. The absent, disabled, enabled-empty, and engine-unavailable combat variants are required to produce the same gameplay snapshot. Their `getStateDigest()` values and content fingerprints are not required to match because the authored mechanics catalog and version intentionally participate in the simulation content digest. `DamagePacket`, `DamageResolver`, and the machine-readable combat schema remain version 1.

## Consequences

- A future damaging source has one typed engine integration point and one HP mutation boundary.
- Resolver-call matrices can prove that each logical target hit resolves exactly once. Golden snapshots prove legacy gameplay equivalence; replay/checkpoint digest checks compare runs under one unchanged content identity.
- Existing raw-versus-resolved event payload semantics are preserved; normalizing those payloads would be a separate compatibility decision.
- The private boundary is the insertion point for R1.2 shields, but R1.1 neither advertises nor implements shields.
- Author-defined armor matrices, marks, vulnerabilities, reactions, and bounded secondary effects remain later independent R1 increments.

## Verification

- Pure resolver behavior remains covered by `packages/engine/src/simulation/damage.test.ts`.
- Complete source, target, delivery, HP-write, and exactly-once settlement contracts are covered by the R1.1 engine routing tests.
- Existing golden snapshot, checkpoint, journal/replay, starter simulation, Canvas/Phaser, package, and plugin gates must remain unchanged.
