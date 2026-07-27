# ADR 0028: PlayerProfile v3 is a migration-only persistent contract

- Status: Accepted
- Date: 2026-07-25

## Context

R0C established an independent engine-owned `PlayerProfileV2` and a renderer-neutral storage adapter. R4 also needs a separate per-run state contract, but changing the persistent profile and introducing rogue run mechanics in one migration would couple version domains and could make optional gameplay appear in legacy projects.

The v2 decoder also validated untrusted objects in multiple passes. A stateful proxy could substitute data between budget validation and serialization or reducer reads. Future profile data had to remain byte-exact even when its opaque fields exceeded limits understood by the current codec.

## Decision

R4.0A promotes only the persistent profile envelope:

- `PlayerProfileV2` remains a migration input with `version: 2`;
- `PlayerProfileV3` is canonical and `PlayerProfile` aliases it;
- v3 keeps exactly `clearedMissionIds`, `starsByMission`, `metaResources`, `upgradeLevels`, and `selectedDifficultyId`;
- v2 uses the single migration `player-profile-v2-to-v3`; legacy arrays and objects first migrate to v2 and then to v3;
- load is read-only, while the first explicit profile mutation writes canonical v3 under the unchanged app-scoped key;
- project, mechanics, checkpoint, command journal/replay, TowerScript, and multiplayer protocol versions do not change.

The engine captures every untrusted profile graph through one descriptor-safe bounded traversal into plain detached data. Decode, exact-envelope serialization, launch options, and immutable reducers operate only on that capture. Accessors, symbols, exotic prototypes, sparse arrays, cycles, unsafe root keys, budget overflow, and descriptor substitution fail closed.

Future root versions are classified before the current codec traverses opaque nested collections. For JSON beyond the current byte budget, a non-allocating lexical preflight looks only for a top-level numeric `version` candidate; a candidate is then validated with JSON parsing and final duplicate-key semantics. Valid v4+ data returns the typed unsupported-version result and cannot be overwritten. Nested-only versions, malformed JSON, absent versions, and duplicate roots whose final value is current remain corrupt/replaceable. Results never expose raw bytes, error details, or embedded secrets. Reset remains the explicit operation allowed to remove the protected exact key.

## Consequences

- Canvas and Phaser share the same migration and storage behavior; v2 bytes do not change at boot and become v3 only after an explicit action.
- Checkpoint, journal, replay, snapshot, and digest output are identical for equivalent native-v3 and migrated-v2 profiles because profiles remain launch input rather than simulation state.
- The ordinary starter remains project schema v1 without `mechanics.json`; R4.0A adds no capability, pause, inventory, draft, or UI.
- `CampaignRun` seed, node, deck, artifacts, and run resources belong to the separate R4.0B codec/export/import contract. Synergies, artifacts, draft, and campaign nodes remain later opt-in slices.

## Verification

The slice follows RED → GREEN engine/runtime → generated-player integration → independent code review → independent constructor-integration review. Contracts cover migration chains, exact canonical bytes, descriptor TOCTOU, reducers without proxy value reads, oversized future preservation, malformed/nested/duplicate version semantics, simulation equivalence, Canvas/Phaser persistence, plugin parity, and legacy compatibility.
