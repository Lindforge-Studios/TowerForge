# Opt-In Campaign Battle Handoff

This R4.4C fixture connects an explicit `CampaignRunV1` to individual battles without making
campaign carry mandatory. It deliberately combines three independently versioned contracts:

- `worldMap.campaign.schemaVersion: 1` defines the two-node battle DAG;
- `roguelite` v4 profile marker `campaign.schemaVersion: 2` opts into battle handoff;
- `campaign-run.import.json` remains the unchanged portable CampaignRun v1 document.

The imported run carries one `reinforced_volley` card and one `boss_trophy`. CampaignRun artifact
entries contain no socket assignment, so the trophy starts every prepared battle unsocketed. The
engine applies the carried card from the first tick, owns deterministic launch/settlement IDs, and
advances the run and player profile only after a matching victory.

## Add It to a Project

1. Persist the project at schema v3, then merge `mechanics.json` into
   `content/mechanics.json`.
2. Merge `mission-selection.json` into `balance.missions.tutorial_01` in
   `content/balance.json`.
3. Merge the `campaign` object from `world-map.campaign.fragment.json` into
   `content/world-map.json`.
4. Validate the complete project and build both desired player targets. The fixture references the
   starter IDs `tutorial_01`, `forest`, `arrow_tower`, and `armored_brute`; replace all references
   together when adapting it to another project.

In Studio, use **Mechanics Hub → Rogue-lite → Campaign**. The guarded authoring transaction owns
`project.json`, `content/world-map.json`, `content/balance.json`, and
`content/mechanics.json`; do not copy the marker through an unrelated mechanics or balance patch.

For an AI agent, use the existing surface rather than inventing a handoff tool:

```text
describe_schema({domain:"roguelite"})
→ get_capabilities
→ get_campaign
→ preview_campaign({profileId:"campaign_handoff", campaign})
→ apply_campaign({profileId:"campaign_handoff", campaign, ifRevision})
→ validate_project
```

`preview_campaign` must succeed before apply, and apply must use that preview's exact revision.
The default campaign authoring path writes marker v2 while preserving the profile's artifact and
draft catalogs.

## Play, Import, and Export

Build or open a generated Canvas or Phaser player, use its explicit Campaign Run import control to
load `campaign-run.import.json`, then select `battle_start`. The player asks the engine to prepare
the battle before it adopts the mission/game. While that battle is active, importing a different
run is rejected so the portable document cannot be swapped underneath its launch binding.

On victory, the engine atomically returns the completed node, persistent profile clear, carried
deck, unsocketed artifact inventory, and any bounded cards/loot earned in the battle. Export the
updated run through the same player controls. TowerForge does not copy CampaignRun into browser
storage, the persistent player profile, or host-authored snapshot merges. Defeat or abandon leaves
the input run/profile unchanged.

Settlement is a pure atomic compare-and-swap contract. Commit the returned run and profile
together and clear the pending battle before another update; never retry with the stale
pre-battle pair. The generated players implement this guard for both renderers.

## Disable, Re-enable, and Legacy Checks

Preview and apply campaign disable in Studio or through `preview_campaign` / `apply_campaign`.
Disable removes only the selected profile's `campaign` marker: the authored graph, artifact/draft
catalogs, and mission selection remain available for an explicit re-enable. Re-enable through the
same guarded flow and confirm marker v2 plus the imported run still validate.

For compatibility checks:

- change only the profile marker to `{ "schemaVersion": 1 }` to keep the R4.4A/B campaign graph
  and victory reducer while disabling deck/artifact handoff;
- remove the marker, mission selection, graph, or mechanics file to exercise the inactive path;
- use a compatible newer runtime for marker v3+: current Studio, campaign authoring, and generic
  mechanics authoring keep such markers opaque/read-only and reject writes instead of downgrading;
- with no campaign reference, the ordinary legacy constructor has no campaign controls, carry
  checkpoint state, draft pause, artifact inventory, or implicit run persistence.

See [ADR 0036](../../adr/0036-opt-in-campaign-battle-handoff.md) for the engine boundary and the
[campaign runbook](../../runbook.md) for guarded authoring and operational checks.
