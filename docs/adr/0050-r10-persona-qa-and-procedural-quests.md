# ADR 0050: Multi-Agent Persona QA and opt-in Procedural Quests

- Status: Accepted
- Date: 2026-07-29
- Milestone: R10

## Context

TowerForge needs two related but independently deployable capabilities:

1. a deterministic headless QA suite that exercises a mission with several recognizably different
   player policies; and
2. battle-local secondary quests selected differently for different seeded runs.

Neither capability may turn an external AI provider into part of gameplay. Persona QA must remain
an authoring analysis service that cannot modify a project. Quests are gameplay and therefore need
the same explicit mission-level opt-in, checkpoint/replay guarantees, guarded authoring and
inactive compatibility path as the existing mechanics modules.

R10 must not depend on TowerScript v7, Behavior Trees, HFSM or `EnemyType.tags` from the still-open
R9 pull request. It may be merged before or after R9 after ordinary conflict resolution in shared
schema files.

## Decision

R10 is split into two versioned domains.

### Persona QA v1

The pure TypeScript engine owns three fixed, data-free persona identifiers:

- `aggressive_rush`;
- `greedy_economy`;
- `turtle_shield`.

`PersonaQaRequestV1` is a closed request containing explicit mission IDs, string seeds, persona IDs,
simulation duration and tick step. `runPersonaQaSuiteV1` normalizes every dimension in binary order
before starting a simulation. Each persona emits only existing validated `GameCommandV6` commands;
it has no filesystem, DOM, renderer, worker, provider, wall-clock or network access.

`PersonaQaReportV1` contains the canonical dimensions and one detached, deeply frozen run result per
mission × seed × persona. A run reports outcome, final state digest, remaining core ratio, tower
count, leaks, elapsed simulation units and accepted command count. This report is independent of the
legacy balance report and never changes or applies balance content.

Heavy batches use the separate Node-side worker service in
`packages/cli/lib/persona-qa-worker.mjs`. It reuses the bounded scheduling principles established by
the R7 auto-balancer, but it does not share auto-balancer proposal schemas or patch application.
Its v1 cache is independently keyed by content digest, engine version and canonical request digest;
only completed results are stored below `.towerforge/cache/persona-qa/v1`. Cancellation returns no
partial findings and creates no cache entry. Every worker rechecks engine/content identity before
accepting a task, and completed cached evidence is structurally matched to the exact canonical
Cartesian request. The public CLI command, read-only Studio QA Lab, and compute-only MCP persona
tool reuse the worker and receive no write or automatic-fix path: a human or agent must separately
choose the existing balance preview/apply workflow.

The v1 engine ceilings are:

| Dimension | Limit |
| --- | ---: |
| Missions per request | 32 |
| Seeds per request | 64 |
| Personas | 3 fixed IDs |
| Total runs | 1,024 |
| Total simulated ticks across the matrix | 2,000,000 |
| Simulation duration per run | 3,600 units |
| Tick step | 0.05–0.2 units |
| UTF-8 bytes per dimension value | 256 |
| Cells in a selected mission map | 65,536 |
| Build passes per decision | 80 |
| Upgrade attempts per tower/decision | 4 |

The Node worker additionally caps concurrency at 8, each task at 180 seconds, and a cache envelope
at 16 MiB. It confines the private cache path, creates directories/files with modes `0700`/`0600`,
and ignores corrupt or future cache envelopes. Those operational limits do not enter gameplay state
or the engine report schema.

### Procedural Quests v1

Gameplay quests use a new public mechanics module ID `quests`. The Studio label is
“Challenges / Procedural Quests”, but the persisted identifier is always `quests`.

An exact closed `QuestProfileV1` contains:

- `selectionCount`;
- a record of weighted quest definitions;
- for each definition, `label`, positive integer `weight` and one objective.

The initial objective vocabulary is deliberately small:

- `kill_with_source`: count kills attributed to one exact existing damage source
  `{kind,id}`, where kind is `tower | ability | tower_script | status | reaction`;
- `preserve_shield`: clear an authored number of waves without an eligible shield being depleted
  from positive to zero in scope `tower | hero | any`; partial shield loss is allowed.

The engine selects quests through weighted sampling without replacement over binary-sorted eligible
definition IDs. Selection uses a quest-domain-separated `SeededRng`; it never advances the main
simulation RNG and never calls `Math.random`. The returned selection is sorted by quest ID so source
record or eligibility-list order cannot affect state. A run may select fewer definitions than
`selectionCount` when fewer definitions are eligible.

The authored v1 ceilings are:

| Dimension | Limit |
| --- | ---: |
| Selected quests | 3 |
| Definitions per profile | 256 |
| Weight | 1,000,000 |
| Kill target | 1,000,000 |
| Shield-preservation waves | 10,000 |
| ID/source UTF-8 bytes | 128 |
| Label UTF-8 bytes | 256 |

Quest runtime is battle-local. Only an active supported `quests` profile may add the exact optional
`snapshot.quests` (`QuestSnapshotV1`) and checkpoint `state.quests`, which deliberately uses the
same snapshot-form schema v1 entries. Restore recomputes the expected deterministic selection from
the checkpoint's original simulation RNG identity plus mission ID and validates profile, IDs/order,
labels, kinds, targets, progress and status before adoption. Killing-source attribution is captured
from the exact existing `DamagePacket.source` only when that packet produces an enemy
positive-HP-to-zero transition, without changing the legacy `enemyKilled` event.
`preserve_shield` fails once only when an eligible tower or hero shield crosses from positive to
zero; partial damage and enemy shields do not count. Surviving objectives advance on the existing
authoritative `waveCleared` event, so Studio and renderers never recompute progress.

Quest completion/failure produces active-only typed events and read-only snapshot presentation.
V1 quests do not replace mission victory/failure objectives and do not write persistent profile,
campaign or multiplayer state. They introduce no new player command and grant no implicit reward.

## Package boundaries

- `packages/engine/src/simulation/persona-qa.ts` owns pure policies, request normalization and run
  evidence.
- `packages/engine/src/content/quest-mechanics.ts` owns the closed profile, capability resolution,
  descriptor and selection contract.
- Quest progress/reducers and the `TowerDefenseGame` adapter remain in the pure engine.
- Node worker pools, cache, project loading and cancellation remain in `packages/cli`.
- Studio is an editor/viewer over engine descriptors and authoritative reports/snapshots.
- MCP reuses the CLI loader/worker and existing guarded mechanics transaction.
- Canvas, Phaser and generated players project optional quest snapshot state and never calculate
  selection, attribution or progress.

## Version domains

- Persona QA request/report: v1.
- Persona worker/cache envelope: v1.
- Mechanics catalog: v1, with new module ID `quests`.
- `quests` module/profile: v1.
- Quest selection/runtime/snapshot: v1.
- Optional checkpoint `quests` section: inner v1.
- Project: v3.
- Outer `GameCheckpointV1` and `towerforge-sim-v2`: unchanged.
- `GameCommand` and journal/replay: v6, unchanged.
- Player profile v3, `CampaignRunV1`, TowerScript, renderer/player and multiplayer protocols:
  unchanged.

Adding the module to capability discovery is an additive authoring capability. An old engine that
does not know `quests` must reject the unknown mechanics module instead of silently running it.

## Delivery slices

1. **R10.1 — pure foundations.** RED contracts first for fixed persona policies/report ordering,
   hostile/budgeted requests, closed quests v1 content and deterministic weighted selection.
2. **R10.2 — Persona QA service.** Bounded cancellable Node workers, cache/content identity and
   deterministic findings.
3. **R10.3 — quest runtime.** Active-only generation, kill attribution, shield preservation,
   typed events, snapshot/checkpoint/digest and continuous/checkpoint/journal equivalence.
4. **R10.4 — constructor integration.** Public Persona QA CLI/Studio/MCP, Mechanics Hub editor,
   inert recipe, guarded AI flow, Canvas/Phaser/player presentation, opt-in fixture, packages and
   documentation.

Every slice follows RED → GREEN engine → GREEN surfaces → refactor → independent code verification
→ independent constructor-integration verification. Persona workers and quest runtime are never
combined into one acceptance slice.

R10.1–R10.4 are implemented across engine, workers/CLI, Studio, MCP/AI, shared renderer/player
projection, generated packages, desktop packaging, documentation and the opt-in reference fixture.
Focused contracts include deterministic persona ordering and three-persona replay proof, hostile
request/cache/checkpoint validation, damaging-source semantics, active/inactive quest runtime,
guarded Studio/MCP authoring, and Canvas/Phaser × hex/square package/player coverage. Final
repository evidence is green: Vitest 3,070/3,070 across 271 files, Playwright 133/133, Studio
server integration 17/17, public surface contracts 6/6, and every required typecheck, engine,
validation, simulation, balance, map, build and plugin gate. Source and exported plugin runtime
trees are byte-identical. The independent Code Verifier and Constructor Integration Verifier both
returned PASS with no open P0–P2 findings. The only residual P3 note is that the local same-user
derived cache is not cryptographically authenticated; strict audits can run with `--no-cache`.

## Compatibility and safety

Absent, disabled, unselected and unsupported-future `quests` content must not select quests, consume
RNG, add events/snapshot/checkpoint fields, change a state digest or expose player UI. Starter and
legacy projects retain their current balance sweep, snapshot and package behavior.

All new input uses closed own-data validation and rejects accessors, proxies, symbols, sparse arrays,
cycles, custom prototypes, malformed UTF-8, duplicate IDs and over-budget matrices before running a
simulation. Persona QA executes no arbitrary policy code. Quest definitions cannot call `eval`,
`Function`, JavaScript/Lua, host APIs, filesystem, network, provider tools, wall clock or unseeded
randomness.

## Acceptance

R10 is accepted only when:

- persona runs are repeatable and source-order invariant, and failing evidence can be reproduced
  from the exact mission/persona/seed;
- persona continuous execution and command-journal replay reach the same digest;
- worker cancellation/cache/timeout and malformed request paths fail closed without project writes;
- quest selection and progress survive checkpoint restore and journal replay with the same digest;
- active kill-source and shield objectives pass/fail once, while inactive state is byte-shape
  compatible;
- Studio can enable → edit → preview → save → reload → disable → re-enable the module;
- AI can execute `describe → capabilities/recipe → preview → guarded apply → validate`, plus
  compute-only persona and quest previews;
- Canvas/Phaser × hex/square, PWA, single-file, web package, `.tdpack` and desktop paths pass;
- all repository gates required by `AGENTS.md` pass;
- independent Code Verifier and Constructor Integration Verifier sign off with no open P0–P2
  findings.

## Excluded scope

External LLM agents controlling gameplay, online QA services, self-applying balance patches,
arbitrary authored persona code, learned policies, narrative dialogue generation, quest chains,
persistent/daily-service quests, campaign carry, multiplayer quest synchronization, quest rewards,
R11 procedural juice, release/tagging and automatic merge are outside R10.
