# ADR 0029: CampaignRun v1 is an explicit inert transport document

- Status: Accepted
- Date: 2026-07-25

## Context

Persistent `PlayerProfileV3` must not absorb per-run rogue state. At the same time, later seeded draft, artifact, and campaign slices need a portable run document whose version can evolve independently from the project, profile, simulation checkpoint, command journal/replay, TowerScript, and multiplayer protocol.

Introducing content definitions, gameplay consumers, persistence, and UI together with the codec would turn optional mechanics into a default runtime burden. R4.0B therefore establishes only the transport contract.

## Decision

The pure engine exports versioned `CampaignRunV1`:

```ts
interface CampaignRunV1 {
  readonly version: 1;
  readonly seed: GameSeed;
  readonly nodeId: string | null;
  readonly deck: readonly { readonly instanceId: string; readonly cardId: string }[];
  readonly artifacts: readonly { readonly instanceId: string; readonly artifactId: string }[];
  readonly runResources: Readonly<Record<string, number>>;
}
```

`createCampaignRun(seed)` returns an exact empty run without consulting randomness. `decodeCampaignRun`, `importCampaignRun`, and `exportCampaignRun` provide detached deep-frozen validation and canonical JSON. V1 is the only source and has no migrations. A safe-integer future version throws `UnsupportedCampaignRunVersionError`; invalid current data is never repaired or downgraded.

Deck and artifact arrays preserve order. Duplicate card or artifact definition IDs are allowed, while `instanceId` is unique within its own collection. The same instance spelling may occur once in each collection because they are separate identity domains. IDs are bounded opaque references; resources are bounded opaque keys with finite non-negative values. The codec deliberately takes no `GameContentRegistry`, project ID, or content digest.

Every untrusted container is captured through one own-descriptor snapshot into plain data before validation or serialization. Accessors, symbols, exotic prototypes, sparse arrays, cycles, extra fields, invalid primitives, and budget overflow fail closed. In-memory decode classifies a future root before traversing opaque nested data. JSON import enforces the 1 MiB raw UTF-8 boundary before parsing; unlike PlayerProfile storage, R4.0B has no existing bytes that an older runtime might overwrite, so arbitrarily oversized future documents are not parsed.

The codec is exported from the engine index and mirrored into the generated Codex plugin runtime. No Studio, player runtime, browser Storage, MCP tool/schema, project loader, content registry, TowerScript, renderer, simulation action, snapshot, checkpoint, journal, replay, or digest consumes it in R4.0B.

## Consequences

- A run can be explicitly exported/imported without changing persistent profile or simulation state.
- The presence of deck and artifact references in the inert document does not implement deckbuilding, loot, sockets, effects, draft pause, or campaign navigation.
- Later opt-in slices add authored semantic validation and deterministic reducers without silently activating them for legacy projects.
- Later draft/loot determinism must explicitly add its RNG cursor/counter contract; v1 stores the typed seed only and never calls `Math.random`.

## Verification

Acceptance covers exact public types and limits, canonical golden bytes, string/numeric seed round-trips, deep detachment/freezing, array order, duplicate identity rules, safe resource keys, malformed/future/budget cases, stateful proxies, hostile descriptors, and stable repeated export/import. Constructor integration separately proves that legacy templates, players, snapshots, checkpoints, digests, Studio, MCP, and starter capability discovery remain unchanged.
