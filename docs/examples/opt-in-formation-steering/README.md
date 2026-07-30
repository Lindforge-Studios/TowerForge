# Opt-in formation steering

This R12.3 fixture enables one `enemyBehaviors` v1 formation profile and its explicit Navigation v1
`dynamic_flow` dependency for starter mission `tutorial_01`. The formation recipe is inert and
never enables Navigation; both module profiles and both mission selections remain visible here on
purpose.

1. Start from a project containing `armored_brute`, `basic_grunt`, `swift_runner`, and
   `tutorial_01`.
2. Persist the guarded project migration to schema v3.
3. Merge `mechanics.json` into `content/mechanics.json`, preserving unrelated modules/profiles.
4. Merge `mission-selection.json` into only the intended mission.
5. Run `npm run validate`, `npm run maps:compile -- --project <project>`, and
   `npm run sim tutorial_01 60`.
6. Compare continuous simulation, checkpoint restore, and journal replay digests.

The `main` cohort assigns the three starter enemy types to `vanguard`, `body`, and `support`. The
shared dynamic-flow field remains authoritative; local deterministic steering only chooses among
equal-optimal flow candidates and inspects at most 16 same-cohort neighbours. At runtime the player
reads cohort/role labels from optional `snapshot.enemyBehaviors.formations` and never recomputes
movement.

Removing either mission selection restores ordinary movement and removes formation snapshot/UI
work. The ordinary starter does not include these files. See Proposed
[ADR 0053](../../adr/0053-r12-advanced-enemy-behaviors.md).
