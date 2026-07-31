# ADR 0055: Opt-in Modular Arsenal and CampaignRunV2

- Status: Accepted
- Date: 2026-08-01
- Milestone: R14

## Context

TowerForge already has typed artifact instances, sockets, upgrade branches, the shared modifier
pipeline, deterministic commands, checkpoints and campaign runs. Modular tower parts and gem
crafting must extend those contracts without creating a second item system or changing legacy
projects.

## Decision

R14 adds the mission-selected `arsenal` module at schema v1. It is absent from the starter and is
active only when the catalog entry is enabled and the mission selects a profile. A profile declares
closed base, barrel and core definitions, tower blueprints and exact 3×3 crafting recipes. The pure
engine compiler is the only authority for compatibility, footprint and effective damage, range and
durability multipliers.

`CampaignRun` independently advances from v1 to v2. Importing v1 performs the explicit
`campaign-run-v1-to-v2` migration and adds an empty `arsenal.moduleInventory`. The profile remains
`PlayerProfileV3`; project v3, outer `GameCheckpointV1`, simulation v2 and multiplayer contracts do
not change.

`GameCommand` and command journal advance to v7. `configureTowerModules` is accepted only during
setup or between waves and preserves current HP ratio while changing effective durability.
`craftGem` consumes exact unsocketed artifact instance IDs against a bounded relative recipe and
creates one deterministic output instance atomically. Gems remain ordinary artifact instances and
continue to use the existing socket system.

Only active Arsenal adds `snapshot.arsenal` v1 and per-tower checkpoint loadouts. The snapshot
contains tower IDs, engine-filtered available module choices, effective multipliers and detached
crafting recipes. Studio and generated Canvas/Phaser players dispatch v7 commands and never compute
compatibility or effective stats. MCP uses existing schema discovery, inert recipes and guarded
mechanics preview/apply; it adds no broad write tool.

An upgrade branch that changes tower type selects the target blueprint's default loadout or removes
Arsenal state when the target has no blueprint. Removing or disabling the module restores the exact
legacy targeting, damage, checkpoint, snapshot and player path.

## TDD and acceptance

R14.0 first proved CampaignRun v1 migration, v2 round-trip and hostile/future rejection. R14.1 and
R14.3 then proved the pure compiler and atomic rotated crafting contract. R14.2 added v7 command,
checkpoint/journal replay and legacy-no-op contracts before constructor surfaces. Renderer and
Studio contracts require detached fail-closed projection, explicit tower identity and command-only
mutation. Final acceptance requires the full repository, browser, plugin, package, desktop and
release gates on the exact tagged commit.

## Excluded

- A second gem inventory or socket system.
- Module changes during an active wave.
- Arbitrary module scripts or renderer-owned stat calculation.
- Persistent profile ownership, trading, macro-economy and real-money mechanics.
- Automatic activation by recipes or migration.
