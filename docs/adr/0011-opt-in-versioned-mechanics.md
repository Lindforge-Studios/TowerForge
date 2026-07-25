# ADR 0011: Opt-In Versioned Mechanics

Date: 2026-07-23

## Status

Accepted

## Context

TowerForge needs deep combat, dynamic navigation, rogue-lite runs, heroes, logistics, debugging, generative tooling, and multiplayer without turning every game into a mandatory mixture of those systems. Existing `.tdproj` projects and generated players must keep their current behavior. Studio and AI agents also need one engine-owned way to distinguish planned, authored, enabled, selected, and actually implemented capabilities.

Adding optional fields to `content/balance.json` would make disabled mechanics difficult to discover and easy for an older CLI to ignore. Coupling project, save-profile, replay, and network versions would make unrelated migrations unsafe.

## Decision

- Add optional `content/mechanics.json` with catalog `schemaVersion: 1`. Each module has its own `schemaVersion`, `enabled` flag, and named `profiles`.
- Keep stable engine-owned module IDs: `combat`, `reactions`, `navigation`, `elevation`, `physics`, `roguelite`, `heroes`, `logistics`, `director`, `scriptingDx`, and `multiplayer`.
- Let a mission select profiles through `mission.mechanics.profiles`. Authoring a catalog does not activate a module by itself.
- Resolve every mission into a read-only `CapabilitySet`. A capability is active only when the engine implements the module, the catalog contains and enables it, and the mission selects an existing profile.
- Make project schema v3 the explicit boundary for authoring `content/mechanics.json`. Legacy projects without the file remain v2 and MUST NOT gain the file or a schema bump during load, ordinary save, build, package, or capability reads.
- Structurally validate authored modules even when disabled. Missing or disabled cross-references in inactive selections are warnings; a missing selected profile in an enabled module is an error. Unsupported IDs and future schema versions fail closed.
- Expose capability-aware schema discovery and read-only inspection to Studio and MCP. Enabling a future implemented module MUST be a revision-guarded transaction over `project.json`, `content/mechanics.json`, and the mission selection with validation, backup, and rollback.
- Version the project manifest, mechanics catalog/modules, player profile, checkpoint/replay codec, and multiplayer protocol independently.
- Ship elemental and other genre examples as optional recipes/reference fixtures, never as starter defaults.

R0A established the contract and authoring surfaces with an empty implemented-module allowlist. R1.2 makes `combat` the first executable module, limited to the closed shield profile described in [ADR 0018](0018-opt-in-combat-shields.md). Later mechanics still enter one bounded TDD slice at a time.

## Consequences

- Existing projects, golden snapshots, templates, renderers, and single-player bundles retain the legacy path and no-file invariant.
- A new CLI cannot accidentally activate authored data, because availability is engine-owned. An old CLI cannot silently ignore mechanics authored by a v3 project.
- Studio keeps advanced authoring in a separate Mechanics Hub instead of adding disabled controls to tower, enemy, and mission forms.
- MCP/AI clients can discover planned and active capabilities without filesystem mutation, and unavailable modules fail before writes.
- Multi-file enable operations are more expensive than a single JSON edit, but they have an explicit atomicity and rollback contract.
- Independent version domains require separate migration and compatibility tests, avoiding implicit corruption across project, profile, replay, and network data.
- An engine release may grow the implemented-module allowlist without activating existing authored data: module enablement and a valid per-mission profile selection are still required.

## Verification

- Engine contract tests: `packages/engine/src/content/mechanics.test.ts`.
- Loader/schema/migration tests: `packages/cli/lib/project-loader.test.mjs`, `project-schema.test.mjs`, and `project-migrations.test.mjs`.
- Build embedding regression: `packages/cli/build.mechanics.test.mjs`.
- Studio no-synthesis and Mechanics Hub contracts: `packages/studio/server.test.mjs` and `packages/studio/public/mechanics-surface.test.mjs`.
- MCP discovery/no-write contracts: `packages/mcp/mechanics.test.mjs` and `packages/mcp/agent-instructions.test.mjs`.
- Release gates remain the touched-layer commands in `AGENTS.md`.
