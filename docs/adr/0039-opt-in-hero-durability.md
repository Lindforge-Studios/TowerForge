# ADR 0039: Opt-in hero durability

Status: Accepted

Date: 2026-07-26

## Context

Heroes v1 supplies a static roster and v2 independently adds deterministic movement. The next
vertical increment needs heroes to participate in combat without silently changing existing games,
forking the damage pipeline, or prematurely adding mana, abilities, skill trees, auras, blocking,
shield regeneration, or TowerScript hero actions.

## Decision

`heroes` schema v3 monotonically retains the complete v2 profile and requires every definition to
add exact `durability: {maxHp, shield}`. `maxHp` is finite in `(0, 1_000_000_000_000]`; `shield` is
either `null` or exact `{capacity}` with the same positive bound. Structural validation runs even
when the module is disabled. The v1 and v2 shapes remain unchanged.

Only an active, mission-selected v3 profile creates mutable durability. Enemy `towerAttack` damage
targets a live in-range durable hero through the common `DamagePacket` / `DamageResolver` boundary.
The authored shield absorbs resolved damage before HP. A zero-HP hero is defeated exactly once,
cannot move, and is no longer a valid attack target. This slice has no healing, regeneration,
revival, taunt, blocking, threat customization, hero-authored damage type, or new command.

The optional `snapshot.heroes` advances to v3 and adds exact
`durability: {hp,maxHp,shield,defeated}`. `shield` is `null` or exact
`{current,capacity}`. The existing outer `GameCheckpointV1`, engine version, `GameCommandV4`,
journal v4, and replay envelope do not change. The optional nested heroes checkpoint advances from
v1 to v2 only for heroes v3 and stores current HP and shield alongside movement state.

Studio exposes v3 HP/shield fields only inside Mechanics Hub. Future heroes v4+ data is preserved
losslessly and is read-only. CLI and MCP accept versions 1–3 and reuse the existing
revision-guarded preview/apply transaction. `basic_durable_commander_hero` is an inert recipe: it
does not enable heroes, select a mission, enable navigation, bind visuals, or add combat content.
Canvas and Phaser consume only the authoritative optional snapshot and engine events.

## Compatibility and version domains

- Missing, disabled, unselected, v1, and v2 hero content retains its existing runtime shape.
- Project schema v3, mechanics catalog v1, checkpoint v1, command/journal v4, replay, profile, MCP
  protocol, and TowerScript versions are unchanged.
- Heroes module schema, heroes snapshot schema, and nested heroes checkpoint schema evolve
  independently.
- There is no `analyze_heroes` tool and no renderer-side damage, target, shield, or defeat rule.

## Verification plan

The TDD slice covers exact schemas and budgets, disabled malformed content, common-resolver routing,
shield-first damage, exactly-once defeat, checkpoint/replay equivalence, v1/v2 compatibility,
guarded Studio and MCP authoring, both renderer targets and grids, package surfaces, and independent
code plus constructor-integration sign-off.

R5.2A was accepted on 2026-07-26 after the independent code verifier and constructor-integration
verifier both returned PASS with no open P0–P3 findings. The verification also rejects resigned
checkpoints whose hero events contradict authored shield capacity or current HP, and confirms the
same contracts in the regenerated Codex plugin runtime.
