# ADR 0048: Opt-in Director and Generative Studio

- Status: Accepted
- Date: 2026-07-28
- Milestone: R7

## Context

TowerForge needs adaptive waves, automated balance evidence, procedural maps, and agent-produced
assets without making any of those services mandatory for an ordinary project. Simulation remains
deterministic and local-first; authoring automation must never silently commit gameplay or media.

## Decision

R7 ships as four independent vertical contracts:

1. `director` mechanics v1 is an opt-in authored counter pool and deterministic policy. The engine
   may adapt only the next unstarted wave, within an authored threat budget and fairness caps, and
   emits an explanation with the selected authored counter. No active profile means the wave,
   snapshot/checkpoint gameplay-state shape, RNG consumption, and events remain legacy; the normal
   content digest still binds any authored catalog bytes.
2. Auto-balancing runs bounded simulation batches outside the engine runtime. It returns ranked,
   evidence-backed patch proposals. Cancellation is cooperative and no proposal can commit itself;
   authors must use the existing guarded balance preview/apply transaction.
3. A provider or author first reduces a prompt to closed `MapGenerationSpecV1`. A pure
   seeded generator owns topology generation and returns reachability, materialized-loop,
   buildable-ratio, declared-terrain, and explicitly structural evidence. The project-aware preview
   then runs canonical compilation, terrain validation, bound-tileset coverage and two identical
   deterministic headless runtime runs. This is a runtime compatibility smoke, not a balance claim.
   A separate `commit_procedural_map(ifRevision)` transaction recompiles and validates before and
   after writing, backs up the existing files, and rolls source plus compiled catalog back together.
4. Asset providers return bytes plus declared metadata to a provider-neutral staging boundary.
   TowerForge issues an opaque handle, validates signature/MIME/size/license/provenance, exposes
   inspectable validation metadata, and imports it only through an explicit revision-guarded
   commit. Provider keys, account credentials, and prompts are not staged metadata or project data.

Procedural maps and asset hooks never share a commit transaction. The engine imports no worker,
filesystem, provider, network, Studio, renderer, or MCP code. Studio and MCP consume the same
descriptors and guarded Node-side operations.

## Determinism and safety

- Director ordering uses authored priority, greatest matched-condition severity, then binary ID
  order. `threatCost` is an eligibility budget, not a tie-break.
- Generators use TowerForge seeded RNG and closed finite budgets; `Math.random` is forbidden.
- Balance results include content/engine/request identity and evidence; map results retain the exact
  detached spec beside their evidence.
- Cancellation leaves no writes or staged partial gameplay state.
- Staged assets are confined below `.towerforge`, have bounded size, and are addressed only
  by random opaque handles. Signature mismatch, traversal, symlink escape, unknown license, stale
  revision, or invalid post-import project aborts the operation and rolls back owned writes.

## Compatibility

Starter and legacy projects do not select `director`, do not create its snapshot section or UI, and
do not start workers/providers. Generative Studio tools are authoring capabilities rather than
mission mechanics and therefore never affect player bundles unless their committed project data is
already referenced by ordinary maps or visuals.
