# ADR 0041: Opt-in battle-local hero skill tree

Status: Accepted

Date: 2026-07-26

## Context

Heroes v1–v4 provide selection, movement, durability, mana, and one active ability. The next
vertical slice needs deterministic progression inside a battle without silently turning hero
skills into persistent profile state, campaign carry, a mandatory interwave pause, or a second
effect runtime. Raising the Heroes module version must also remain safe for definitions that do
not use a tree.

## Decision

`heroes` schema v5 retains the exact v4 definition and adds required nullable `skillTree`.
`null` is an explicit opt-out: the selected unit continues to publish snapshot v4 and nested
checkpoint v3. A non-null tree contains bounded battle-local points and a canonical DAG of nodes.
Each node has all-of prerequisites and one or more allowlisted `hero_ability_damage` modifier
effects. Structural validation always applies; missing prerequisites and cycles are errors only
for an active selected profile and warnings while disabled or unselected.

Only setup and a clear non-final interwave permit exact `GameCommandV6 unlockHeroSkill`.
Validation is atomic and ordered: outcome, capability, hero and skill identity, phase, hero
liveness, duplicate state, prerequisites, then points. A cleared non-final wave grants the
authored `perInterwave` amount after `waveCleared` and before an optional draft offer. The final
wave grants nothing. No RNG is introduced.

Unlocked effects are compiled into engine-owned collision-safe `ModifierSpec` entries at the
existing `run` stage and passed only with the hero ability's one `DamagePacket`. Tower, mission
ability, status/DoT, reaction, and enemy damage are unchanged. Validation rejects any active
modifier sequence that could make the selected ability leave the shared resolver's finite bounds.

The optional runtime projection advances to snapshot v5 only for a non-null selected tree. It
publishes authoritative point counts, management availability, canonical nodes, missing
requirements, and unlockability; Studio and renderers never recompute these rules. The nested
heroes checkpoint advances to v4 with current points and binary-sorted unlocked IDs. Restore
validates prerequisite closure, exact earned-minus-spent accounting, retained point-event
continuity, and the final event against authoritative state. The outer `GameCheckpointV1`,
project v3, mechanics catalog v1, `PlayerProfileV3`, and `CampaignRunV1` remain unchanged.

Studio keeps tree editing in Mechanics Hub. CLI/MCP expose the same v5 descriptor and inert
`basic_hero_skill_tree` recipe through revision-guarded preview/apply. Canvas and Phaser create a
native-button panel only from a valid snapshot v5 and dispatch the exact v6 command for pointer,
touch, and keyboard activation.

## Compatibility and exclusions

- Missing, disabled, unselected, v1–v4, and v5-null paths retain their previous engine, UI,
  checkpoint, and package shapes.
- Future heroes v6+ remains lossless/read-only in Studio and fail-closed in runtime surfaces.
- Skill points and unlocks reset for every `TowerDefenseGame`; campaign settlement deliberately
  carries neither. Persistent or cross-battle skills require a separate `CampaignRunV2` decision.
- R5.4A does not add XP, levels, respec, passive auras, blocking, logistics, TowerScript hero
  actions, multiple abilities, healing, revival, random grants, or profile migration.

## Verification

The TDD slice covers exact v5 authoring and DAG semantics, GameCommand/Journal v6, ordered atomic
failure, interwave events, modifier isolation and overflow, snapshot v5, checkpoint v4 hostile
state/event chains, replay digest equivalence, CampaignRun no-carry, guarded Studio/MCP authoring,
Canvas/Phaser on both grids and all input modes, packaging, legacy paths, and independent code plus
constructor-integration sign-off.
