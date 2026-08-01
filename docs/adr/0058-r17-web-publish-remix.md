# ADR 0058: Opt-In Web Publish, Remix, and Host Monetization

- Status: Accepted
- Date: 2026-08-01
- Milestone: R17

## Context

TowerForge can already build portable web players and verified project packs, but it does not own a
safe contract for publishing those builds, permitting a source remix, or exposing host-controlled
commercial placements. Adding provider credentials or upload state to `.tdproj`, allowing an agent
to trigger upload, or placing monetization rules in the gameplay engine would violate local-first
ownership, deterministic builds, and the existing permission boundary.

R17 must also preserve the legacy constructor. Opening, validating, building, packaging, or editing
an existing v1-v3 project must not silently opt it into public distribution, change its simulation or
bundle, or create a new project file.

## Decision

R17 is a constructor/distribution capability and never a mission mechanics module. Pure closed data
contracts live under `packages/distribution`; Node project loading, guarded writes, private build
staging, provider adapters and source-pack filesystem work live under `packages/cli/lib/distribution`.
Studio presents those contracts in a separate Distribution Hub. The engine and renderer do not own
publishing, provider, Remix, license, placement or network rules.

### Project boundary and DistributionConfigV1

The optional `content/distribution.json` contains exact schema v1:

- stable `tfp_` plus 32 lowercase hexadecimal project ID;
- allowlisted SPDX license and bounded attribution;
- `forbidden | allowed | allowed_with_attribution` Remix policy and explicit source inclusion;
- optional `MonetizationHookV1`;
- optional inherited `RemixProvenanceV1`.

`ARR` requires forbidden Remix. An allowed policy requires source inclusion, and
`allowed_with_attribution` requires attribution. Unknown fields, accessors, sparse arrays, cyclic,
future-version and over-budget values fail closed without executing untrusted getters.

The first explicit guarded Distribution save promotes `project.json` to schema v4. Mechanics and
elevation retain their existing v3 authoring boundary, including when the containing project is
already v4. Reads, previews, unrelated saves, builds and packages never synthesize the optional file
or promote a v1-v3 project. The write transaction covers the manifest and Distribution file with an
exact revision, validation, private backup, atomic replacement and rollback.

### Deterministic PublishManifestV1

`PublishManifestV1` canonically binds:

- project identity;
- engine version and digest;
- content, web bundle and optional public source-pack digests;
- a binary-sorted unique capability list;
- exact license and Remix policy.

The manifest and its candidate digest are reproducible for the same inputs. They contain no
timestamp, random nonce, provider target, deployment URL, local absolute path, username, credential,
token or upload result. The manifest is an integrity/provenance contract, not a signature or an
authorization to publish.

### Provider adapters and explicit confirmation

Node-side distribution orchestration uses one order:

`preview -> reproducible build in private staging -> exact confirmation -> upload -> remote digest verification`.

Preview performs no build, write, network access or approval minting. Preparation writes only below
private `.towerforge/publish-staging` and produces the immutable manifest plus candidate and target
digests. A human confirmation mints a short-lived, single-use approval bound to the exact candidate,
adapter and target. A mismatch or expiry fails before upload. A provider result is successful only
when its remote digest equals the prepared candidate digest.

The first adapter contracts are `filesystem_v1`, `github_pages_v1`, and `cloudflare_pages_v1`.
Credentials and authenticated clients are injected by the OS/provider runtime and never serialized
into the project, manifest, trace or bundle. Failed upload does not modify source. The filesystem
adapter rejects private-staging overlap and an existing destination rather than overwriting it.

Studio may own the explicit confirmation UX. MCP is restricted to Distribution descriptor/read/
preview/guarded apply, compute-only publish preview, and confined source-pack inspection. MCP has no
tool to prepare an external upload, mint approval, upload, create a provider client, or open a
network connection.

### Deterministic public Remix pack

The ordinary TowerForge project pack remains `.tdpack` v1. R17 adds a separate public source
`.tdpack` v2 only when the authored license and Remix policy allow source inclusion. It uses
canonical entry order and deterministic compression, per-entry checksums, an aggregate entries
digest and an embedded `PublishManifestV1`.

Export includes only allowlisted public project roots. Hidden files, `.towerforge`, caches,
deployment metadata, credentials, symlinks, unsafe paths and over-budget content are rejected or
excluded. Inspection verifies the complete archive without extraction. Import verifies format,
paths, sizes, checksums, manifest identity, license and policy before writing, extracts into a
temporary confined directory, validates the project, assigns a new project ID and only then commits
the destination.

`RemixProvenanceV1` records the parent project ID, parent manifest digest, exact source-pack digest,
attribution and the fixed `published_tdpack` source kind. It stores no origin URL, provider account,
deployment metadata or private editor state. A failed import leaves no partial project.

### Host-only MonetizationHookV1

`MonetizationHookV1` contains at most 16 uniquely identified host placements. V1 allows only
`banner`, `interstitial`, and `purchase_link` kinds on allowlisted host surfaces. It contains no URL,
HTML/script payload, payment key, price, product grant, telemetry selector or gameplay reward.

The generated host may expose inert injection points only when the authored config contains valid
placements. The engine, checkpoint, replay, profile, balance and simulation never see them. An
absent Distribution config adds no placement UI or distribution/provider runtime to the player.

## Version boundaries and compatibility

- `.tdproj` manifest advances independently to v4 only for explicitly authored Distribution v1.
- `content/distribution.json`, `DistributionConfigV1`, `PublishManifestV1`,
  `RemixProvenanceV1`, `MonetizationHookV1`, and provider adapters each begin at schema/contract v1.
- Deterministic public Remix source pack uses `.tdpack` v2; ordinary project `.tdpack` v1 is
  unchanged.
- Mechanics catalogs/modules, Visuals, TowerScript, engine checkpoint/version, commands/journals,
  replay, profile, CampaignRun and multiplayer protocol do not change.
- Projects v1-v3 without the optional file retain their existing snapshots, replay digest, Studio
  behavior, generated players, packages and no-op performance path.
- Future Distribution/manifest/provenance/placement forms fail closed and are never downgraded.

## TDD and acceptance

R17 follows four separately reviewable RED/GREEN slices: project/config and publish-manifest
contracts, provider adapters, Remix source pack/provenance, then host placement and constructor
surfaces. Contract/test design recorded expected RED failures in `progress.md` before production
changes for closed data validation, schema promotion/legacy isolation, provider confirmation,
archive safety, Studio lifecycle, MCP limitations and package isolation.

The final R17 tree passed all required typecheck, build, unit, validation, simulation, Studio E2E,
plugin parity and package gates. Independent Code Verifier and Constructor Integration Verifier
reviews both returned PASS with no P0–P3 findings after their RED regressions were repaired. Runtime
source changes after this acceptance require a new freeze and both reviews again.

## Excluded

- TowerForge Cloud, hosted gallery/search, accounts, moderation, analytics or managed deployments.
- Hosted credentials, provider tokens, deployment URLs or user-local paths in project content.
- MCP/agent approval minting, external upload, socket creation or automatic publish.
- Automatic overwrite/rollback of an existing remote deployment beyond provider verification.
- Copying private `.towerforge` state, caches, deployment metadata or tokens into a Remix.
- Rewarded gameplay rewards, real-money balance, payment processing, hidden telemetry or engine-owned
  monetization.
