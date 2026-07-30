# Opt-in vanguard protection

This detached R12.4 fixture composes three independent mission-selected profiles. Copy
`mechanics.json` into a schema-v3 project only after checking the referenced enemy IDs, then merge
`mission-selection.json` into the intended mission. The example deliberately does not change the
ordinary starter project.

- Navigation v1 selects `dynamic_flow`; authored routes are not eligible for formation protection.
- Combat v1 gives the `armored_brute` vanguard a root Combat shield. Component shields do not
  satisfy this prerequisite.
- `enemyBehaviors` v1 assigns the vanguard, body, and support roles and enables protection for the
  authored packet source kinds inside radius 2.

For an eligible hit on a body/support enemy, the engine examines at most 16 binary-stable vanguard
candidates and redirects to the first living same-cohort vanguard with remaining root shield. The
redirect is one-hop: the redirected packet cannot trigger another interception. At most 512
successful interceptions occur per public tick. The redirected packet still uses the common
`DamageResolver`; it changes neither armor/resistance rules nor root exact-once death and reward
settlement.

Presentation reads active protection metadata from
`snapshot.enemyBehaviors.formations.protection`. The `vanguardDamageIntercepted` record is a
read-only GameEvent for UI/diagnostics; it is not a TowerScript or Visual Graph event. Removing or
disabling any selected prerequisite restores ordinary dynamic-flow combat and removes protection
snapshot/checkpoint/UI work. Absent, unsupported, or unselected content remains inert.
