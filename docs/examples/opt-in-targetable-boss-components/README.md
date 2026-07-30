# Opt-in targetable boss components

This R12.1 fixture enables one `enemyBehaviors` v1 profile for `tutorial_01`. It matches the
deterministic `basic_targetable_boss_components` recipe when materialized against the starter:
binary-first `armored_brute` is the composite enemy and binary-first `arrow_tower` prioritizes its
`core` component. The recipe and these files are examples only; neither enables itself in another
project.

1. Start from a project that contains `armored_brute`, `arrow_tower`, and `tutorial_01`.
2. Persist the normal guarded migration so `project.json.schemaVersion` is `3`.
3. Copy `mechanics.json` to `content/mechanics.json`, preserving unrelated modules/profiles.
4. Merge `mission-selection.json` into only the mission that should use the profile.
5. Run `npm run validate` and `npm run sim tutorial_01 60`.
6. Verify continuous simulation, checkpoint restore, and journal replay produce the same digest.

The `core` owns 20 HP and a normalized circular hit region. `arrow_tower` routes a root hit to the
first live component with tag `core`; if no matching live component remains, normal root targeting
is restored. Component overflow does not damage root HP and component destruction grants no reward.

Only an active supported selection adds `snapshot.enemyBehaviors` v1 and the matching optional
checkpoint state. Remove the mission selection or disable the module through the same guarded
mechanics transaction to restore the exact legacy snapshot/UI/player path. See Proposed
[ADR 0053](../../adr/0053-r12-advanced-enemy-behaviors.md).
