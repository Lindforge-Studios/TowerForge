# Opt-In Campaign Run

This fixture demonstrates the isolated R4.4A campaign coordinator. It does not enable itself and it
does not add campaign state to a battle checkpoint, replay, or persistent player profile.

1. Merge `mechanics.json` into `content/mechanics.json`.
2. Merge `mission-selection.json` into the referenced mission in `content/balance.json`.
3. Merge the `campaign` object from `world-map.campaign.fragment.json` into
   `content/world-map.json`.
4. In Studio use Mechanics Hub → Rogue-lite → Campaign, or use the AI flow
   `describe_schema(roguelite) → get_campaign → preview_campaign → apply_campaign → validate`.

The first node launches `tutorial_01`. After its recorded victory the event node becomes available,
but R4.4A deliberately returns `node_type_not_implemented` for event and merchant gameplay. Both
Canvas and Phaser expose explicit JSON import/export through the engine-owned `CampaignRunV1`
codec; no browser storage write occurs automatically.

Removing the profile `campaign` marker disables the run UI and reducer while preserving the graph
for later re-enable. Removing `worldMap.campaign`, the module, or mission selection leaves the
legacy mission map and player behavior unchanged.
