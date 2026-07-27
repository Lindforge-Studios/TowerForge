# ADR 0040: Opt-in deterministic targeted hero ability

Status: Accepted

Date: 2026-07-26

## Context

Heroes v1–v3 provide roster selection, movement, HP, shield, and defeat. The next vertical slice
needs one actively controlled spell with an authoritative resource and cooldown without turning
every project into a hero game, reusing mission-ability UI state as gameplay state, or prematurely
adding skill trees, auras, blocking, logistics, random effects, or a second script runtime.

## Decision

`heroes` schema v4 monotonically retains the exact v3 definition and adds exact
`mana: {max,starting,regenerationPerUnit}` plus one exact inline
`activeAbility: {id,label,target:"enemy",manaCost,cooldown,range,damage}`. The inline ability is
intentionally single-target and damage-only in this slice. ID and label remain bounded by 128
UTF-8 bytes. Mana and damage values are finite and bounded; range is an integer bounded by the
shared navigation map-cell limit. Structural validation applies even when the module is disabled.

Only an active, mission-selected v4 profile creates mana and cooldown state. A new exact
`GameCommandV5 useHeroAbility` identifies the hero, authored ability, and authoritative live enemy
ID. The engine validates capability, mission outcome, IDs, defeat, cooldown, mana, target liveness,
and tile distance before mutation. Success spends mana, starts the cooldown, and routes one packet
through the existing ability damage source and common `DamageResolver`; failures are atomic.

While simulation time advances, a living hero regenerates mana and reduces its cooldown by the
same deterministic delta. Draft pause, defeat, and ended missions freeze this state. No RNG is
introduced. Hero movement continues independently and renderer interpolation does not affect range.

The optional `snapshot.heroes` advances to v4 and adds authoritative mana and active-ability
presentation state, including `cooldownRemaining` and `ready`. The nested heroes checkpoint
advances to v3 with current `mana` and `abilityCooldownRemaining`. The outer
`GameCheckpointV1`, project schema v3, mechanics catalog v1, and player-profile versions remain
unchanged. GameCommand and journal advance independently to v5.

Canvas and Phaser expose a dynamic unit-action control only for a valid v4 presentation. A local
interaction mode keeps mission ability, hero movement, sell, and hero ability targeting mutually
exclusive. UI hit testing selects an enemy ID; the engine alone decides liveness, range, resource,
and cooldown validity. Studio and MCP reuse guarded preview/apply with an inert v4 recipe that does
not enable heroes, select a mission, bind visuals, or add other mechanics.

## Compatibility and exclusions

- Missing, disabled, unselected, v1, v2, and v3 heroes keep their prior snapshot, checkpoint,
  player UI, and command behavior.
- Future heroes v5+ data remains lossless and read-only in Studio and fail-closed at runtime.
- R5.3A does not add multiple abilities, area/status/displacement effects, damage-type authoring,
  LoS, skills, auras, blocking, healing, revival, shield regeneration, logistics, or TowerScript
  hero scope/actions.
- Renderers never calculate mana, cooldown, readiness, valid targets, range, or damage.

## Verification

The accepted TDD slice covers exact schemas and bounds, disabled/future content, exact GameCommand and
journal v5, atomic failure paths, deterministic mana/cooldown ticking, shared damage resolution,
checkpoint/replay equivalence, fail-closed presentation, Studio and MCP guarded authoring,
Canvas/Phaser input on both grids, packaging, legacy paths, and independent code plus
constructor-integration sign-off.

Verifier-driven RED tests additionally require `ready:false` after victory/defeat, bind the final
retained `heroAbilityUsed` event to authoritative checkpoint mana/cooldown, validate the complete
retained mana chain, and preserve a valid two-cast zero-cooldown checkpoint round-trip. Code and
constructor-integration verifiers accepted the slice with no remaining P0–P3 findings.
