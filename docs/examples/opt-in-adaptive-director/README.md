# Opt-in adaptive Wave Director

This R7 fixture activates one deterministic `director` v1 profile. It never invents an enemy,
changes an authored wave, or enables itself for another mission.

1. Make sure the normal enemy catalog contains `armored_brute`; change the explicit reference if
   the project uses another authored counter enemy.
2. Persist the normal mechanics migration and set `project.json.schemaVersion` to `3` in the same
   guarded transaction.
3. Copy `mechanics.json` to `content/mechanics.json`, or materialize the inert
   `basic_adaptive_wave_director` recipe in Mechanics Hub / MCP.
4. Merge `mission-selection.json` into only the missions that should use the Director.
5. Preview the mechanics change, apply it with the current revision, run `npm run validate`, and
   inspect a playtest `directorDecision` event before packaging.

Before an unstarted wave, the engine measures authored damage share, coverage, movement layers,
and Logistics brownout. A counter is eligible only when all its conditions match, its declared
`threatCost` fits `base + perWave * nextWaveIndex`, and every fairness bound is satisfied. Eligible
counters are ordered by descending priority, descending greatest matched-condition severity, then
binary ascending counter ID. The selected groups are appended to a detached wave plan; the source
wave remains unchanged. The decision and reason are authoritative engine output surfaced through
the optional Director snapshot/event projection.

`propose_balance_patches` is a separate authoring operation. It runs bounded seed × strategy
simulation work in cancellable Node workers, caches completed evidence by content hash and engine
version, and returns ranked proposals only. Cancellation publishes no partial ranking, and no
proposal applies itself. Use the existing balance dry-run and revision-guarded apply flow after
reviewing the evidence.

`preview_procedural_map` similarly converts a closed `MapGenerationSpecV1` into a local seeded
candidate and returns topology, reachability, materialized-loop and buildable-ratio evidence plus
canonical compile, terrain validation, bound-tileset coverage and a deterministic headless runtime
smoke without writing a map. The runtime smoke is explicitly not a balance claim. Commit the same
spec only through `commit_procedural_map` with the preview revision; source and compiled maps share
one backup/rollback boundary. Generated media follows the independent
provider-neutral `stage_generated_asset → inspect_staged_asset → commit_staged_asset` flow: the
project receives only a validated opaque handle until an explicit guarded import. Provider keys
and account credentials never enter the project; license and provenance do.

Deleting the mission selection, disabling the module, or removing the catalog preserves the
legacy wave, snapshot/event, RNG, checkpoint gameplay-state shape, player, and UI path. As with all
authored mechanics, the content digest still binds catalog bytes while the file remains present.

See [ADR 0048](../../adr/0048-opt-in-director-and-generative-studio.md).
