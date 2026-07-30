# TowerScript DX 3.0 opt-in fixture

This fixture enables R9 by authoring one TowerScript with `schemaVersion: 7`. It does not create or select `content/mechanics.json`.

- `boss_priority.tower.json` binds a Behavior Tree to `pelter`. When any visible `boss` candidate is below 20% HP, only boss targets are ordered; otherwise the tower uses `weakest`.
- The same script contains an enemy-scoped nested HFSM for the boss phase and a map-scoped HFSM for the encounter phase.
- `enemy-tags.fragment.json` shows the optional `EnemyType.tags` authoring used by the target filter.

Remove `behaviorTrees` and `stateMachines` (or return the script to schema v6) to restore ordinary target-mode UI and legacy runtime behavior.
