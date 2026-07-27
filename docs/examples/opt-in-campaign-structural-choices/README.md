# Opt-In Campaign Structural Choices

This fixture extends the optional campaign coordinator with R4.4B structural choices. It does not
enable itself, persist a run automatically, or transfer battle-local draft cards and artifacts.

1. Merge `mechanics.json` into `content/mechanics.json`.
2. Merge `mission-selection.json` into `missions.tutorial_01` in `content/balance.json`.
3. Merge the `campaign` object from `world-map.campaign.fragment.json` into
   `content/world-map.json`.
4. In Studio use Mechanics Hub → Rogue-lite → Campaign, or follow
   `describe_schema(roguelite) → get_campaign → preview_campaign → apply_campaign → validate`.

After `first_battle`, the event choice grants five coins. The merchant then checks its three-coin
cost against that pre-effect balance and atomically leaves two coins plus one relic. Choosing either
node again is unavailable and cannot grant twice. Canvas and Phaser call the engine reducer and use
the explicit `CampaignRunV1` import/export controls; they do not calculate or persist the balances.

Removing the profile marker disables the campaign runtime and choice UI while preserving the graph.
Graph v1 remains valid and keeps presentation-only merchant/event nodes.
