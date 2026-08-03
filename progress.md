Original prompt: Continue the opt-in TDD implementation of the TowerForge R0–R8 roadmap with subagents and independent verification.

## 2026-08-01 — R16.1 ReplayArchiveV1 RED

- Contract freeze: the browser-safe Replay Lab is a dedicated `@towerforge/engine/replay-lab`
  entrypoint and is not exported by the root engine. `ReplayArchiveV1` carries only the existing
  `GameCommandJournal` v1–v8, uses an engine-owned mission capability digest, fixes the `TFRP`
  magic/schema/header/declared-length/checksum behavior, and rejects archives above 72 MiB.
- Added RED contracts in `packages/engine/src/replay-lab/replay-archive.contract.test.ts`,
  `replay-archive-security.contract.test.ts`, and `replay-lab-entrypoint.contract.test.ts`. They
  cover deterministic v1–v8 round-trip, detached identity, header/checksum/length corruption,
  pre-construction rejection, hostile binary/journal input, the exact size ceiling, and root export
  isolation.
- RED command:
  `npx vitest run packages/engine/src/replay-lab/replay-archive.contract.test.ts packages/engine/src/replay-lab/replay-archive-security.contract.test.ts packages/engine/src/replay-lab/replay-lab-entrypoint.contract.test.ts --maxWorkers=1`.
- Expected RED result: 3/3 files failed. Both archive suites failed collection because
  `packages/engine/src/replay-lab/index.js` does not exist; the entrypoint suite independently
  failed because `packages/engine/package.json` has no `./replay-lab` export. The root-export
  absence assertion already passes. No production code was changed in this slice.

## 2026-08-01 — R16.1–R16.4 implementation GREEN pending sign-off

- The isolated Replay Lab now supplies ReplayArchiveV1, detached Ghost frames, immutable What-If
  branches, read-only Studio/MCP surfaces and a separate gameplay-free reference relay package.
- A Studio acceptance regression exposed explicit optional `undefined` fields in trusted engine
  snapshots: canonical checkpoint cloning correctly rejected them even though they are valid
  presentation fields. Ghost snapshot detachment now uses `structuredClone` on the engine-owned
  snapshot and recursively freezes the result; it does not weaken archive/journal validation.
- Focused engine/renderer result after the fix: 6 files, 34 tests passed. Focused Studio acceptance
  `npx playwright test tests/e2e/r16-replay-lab.spec.mjs`: 1 passed. The first sandboxed attempt
  could not bind `127.0.0.1` (`EPERM`); the identical approved loopback run passed.
- This is implementation evidence only. ADR 0057 remains Proposed and R16 remains pending full
  exact-commit gates plus independent Code Verifier and Constructor Integration Verifier sign-off.

## 2026-08-01 — R16.2 Ghost Session RED

- Added `packages/engine/src/replay-lab/ghost-session.contract.test.ts` for construction from a
  branded decoded archive only, a command-free public surface, deterministic seek/advance/final,
  exact deeply immutable ghost envelopes, active/source isolation, bounds and 256-frame cache
  eviction with deterministic re-seek.
- Added `packages/renderer/src/ghost-replay-presentation.contract.test.mjs` for the pure shared
  binary-stable overlay projection, detached rows, fail-closed hostile input and bounded
  4,096-tower/4,096-enemy output with explicit overflow counts.
- RED command:
  `npx vitest run packages/engine/src/replay-lab/ghost-session.contract.test.ts packages/renderer/src/ghost-replay-presentation.contract.test.mjs --maxWorkers=1`.
- Expected RED result: 2/2 files failed. The engine suite failed collection because the isolated
  Replay Lab entrypoint does not exist; both renderer tests failed because the shared limits and
  `projectGhostReplayPresentation` export do not exist. No production code was changed.

## 2026-08-01 — R16.3 What-If Branches RED

- Added compact engine contracts in `packages/engine/src/replay-lab/replay-branch.contract.test.ts`
  for fork-at-zero/middle/end, exact immutable parent provenance, deterministic branch/final
  digests, invalid fork/parent/version/suffix rejection, and first-divergence reporting.
- Added declarative-only Studio and MCP contracts in
  `packages/studio/public/r16-replay-lab-surface.contract.test.mjs` and
  `packages/mcp/r16-replay-lab.contract.test.mjs`. Replay Lab must be an isolated read-only tab;
  archive verification and branch analysis are narrow compute-only tools with no project writer or
  network side effect.
- RED command:
  `npx vitest run packages/engine/src/replay-lab/replay-branch.contract.test.ts packages/studio/public/r16-replay-lab-surface.contract.test.mjs packages/mcp/r16-replay-lab.contract.test.mjs --maxWorkers=1`.
- Expected RED result: 3/3 files and 10/10 tests failed. Engine lacks the branch create/replay/
  divergence exports; Studio lacks the Replay Lab tab/runtime delegation; MCP rejects the unknown
  `replayLab` schema domain and exposes none of the three compute-only tools or agent guidance. No
  production code was changed.

## R11 architecture handoff (2026-07-29)

- R11 is an independent opt-in presentation milestone semantically built on the accepted R8 surface;
  it must not import or require R9/R10 contracts. The delivery branch is stacked on R10 only because
  both milestones touch shared Studio/player/plugin files. During S0 integration it is renumbered
  to ADR 0052; its accepted feature contract remains unchanged.
- Public storage is visuals schema v3 with optional `proceduralJuice` schema v1 and exactly
  `particleEmitters`, `audioCues`, `cameraCues`, and `eventBindings`. It is not a mechanics module.
  First guarded authoring promotes the project manifest and visuals document to the existing v3;
  absence keeps current renderer/audio behavior and snapshot bytes.
- Exact v1 records and production budgets are documented in ADR 0052. Current agreed catalog caps
  are 64/64/64 cues and 128 bindings, with 16 references of each cue kind per binding, 256 particles
  per emitter, at most 64 source events, 2,048 live renderer particles, and 32 scheduled audio voices
  per frame and simultaneously live in Web Audio.
- `packages/renderer` owns the pure deterministic plan and thin Canvas/Phaser/Web Audio/compositor
  adapters. Engine events/snapshots remain authoritative; no engine RNG, state, event, snapshot,
  checkpoint, command/journal, digest, TowerScript, mechanics, profile, campaign, or multiplayer
  version changes are allowed.
- Delivery order is R11.1 catalog/pure planner → R11.2 particles → R11.3 audio → R11.4 camera plus
  Studio/MCP/packages. Every slice starts RED. Final work needs active/absent and adversarial schema
  tests, continuous/checkpoint/replay projection equivalence, Canvas/Phaser × square/hex,
  accessibility/audio fallbacks, guarded authoring, packaging/plugin parity, and independent Code
  Verifier plus Constructor Integration Verifier PASS.

## Current milestone

- S0 integration is in progress: R9 PR #20 and R10 PR #21 are merged into `main`; R11 is being
  reconciled on top. The shared engine merge preserves both active-only `scriptMachines` and
  `quests` checkpoint sections plus both event-field sets.
- S0 regression RED: `npx vitest run packages/engine/src/simulation/r10-quests-runtime.contract.test.ts --maxWorkers=1`
  initially failed the new combined R9+R10 checkpoint assertion because the test assumed a flat
  `entries` form instead of the canonical nested `values` contract. After correcting the contract
  assertion, the focused suite is GREEN at 10/10 and restore digest/snapshot parity is proven with
  both optional sections active.
- ADR numbering collision was resolved without changing feature version domains: R9 remains ADR
  0050, R10 is ADR 0051, and R11 is ADR 0052.
- S0 verifier repair RED: the Code Verifier demonstrated that a digest-valid checkpoint could queue
  an impossible `stateMachineTransitioned` event and dispatch it after restore. The focused test
  `rejects a digest-valid queued state-machine transition event with impossible provenance` failed
  with “expected function to throw”. GREEN adds authored script/machine/state/transition provenance,
  binding-scope and queued runtime-context validation. The first constructor sign-off is invalidated
  by this source change and both roles must re-sign the repaired commit.
- S0 second verifier RED: Constructor Integration Verifier replayed a legitimate already-consumed
  `stateMachineTransitioned` event by rolling only `scriptEventCursor` backward; restore succeeded
  and the next command repeated a TowerScript handler side effect. The compatibility audit then
  proved that a global drained-queue rule would reject valid v0.4.0 checkpoints. The narrowed final
  contract preserves all historic non-HFSM queues but rejects any persisted
  `stateMachineTransitioned` event at or beyond `scriptEventCursor`. The impossible-provenance test
  marks its synthetic event historical so it independently reaches authored cross-reference
  validation; the cursor-rollback test covers exactly-once dispatch. The narrow form was re-frozen
  at `ffb4c26`, independently re-signed, passed full CI, and merged through PR #21.

- R0–R2 and R3.1–R3.4a are complete with independent code and constructor-integration sign-off.
- R3.4a opt-in physics v1 is complete through engine, validation, Studio Mechanics Hub, MCP/AI, recipes, shared renderer projection, Canvas/Phaser × hex/square builds, packages, plugin runtime, reference fixture, and documentation.
- R3.4a final evidence is green: focused physics/build/package 75/75, full Vitest 1512/1512 across 120 files, Playwright 17/17, typecheck/build/validate/sim/balance/maps, plugin build/validate/smoke, harness audit, and diff checks.
- R3.4a independent code and constructor-integration sign-offs are GREEN; ADR 0026 is Accepted.
- R3.4b transactional route-safe terraforming is complete through the opt-in capability/schema, TowerScript v6, authored/dynamic runtime, timed checkpoint state, compatibility adapters, CLI/MCP/AI, Studio Mechanics Hub, shared renderer/player presentation, packages, public reference fixture, and both independent sign-offs. The exact runtime ceilings remain 16,384 sources/causes, 256 fields, and 8,388,608 baseline+candidate field/proof cells; fail-before-read and the 8,191-live shared-field boundary are covered. Atomic adoption/rejection and non-counting snapshot peeks are preserved.
- Accepted engine-only C3A adds persistent `set_elevation`/`restore_elevation` behind simultaneous active elevation plus terraforming elevation policy. Mixed terrain/elevation batches commit atomically in declared event order; layer ceilings are 512 each and 1,024 combined. Pure elevation performs no navigation solver work, immediately updates effective snapshot/LoS/high-ground, resets to authored base, and dispatches real TowerScript `elevationChanged` events after commit.
- C3A also adds the minimal exact optional checkpoint state `{schemaVersion:1,runtimeElevationOverrides}`. It is required even empty only for the active elevation-plus-policy combination and forbidden otherwise; outer `GameCheckpointV1`, `towerforge-sim-v2`, command, journal, and replay versions remain unchanged. Inactive/disabled/unselected snapshot and checkpoint byte shapes remain legacy-compatible.
- R3.4b C3A evidence is green: contract RED 10/22 plus an independently discovered dispatch RED, full Vitest 1623/1623, Playwright 17/17, conformance 69/69, typecheck, engine/build, validate, sim, plugin build/validate/smoke, and independent code plus constructor-integration sign-offs.
- Accepted engine-only C3B adds opt-in native `duration` for set-only batches. The 512-group ceiling is checked before expressions; duration is evaluated once before targets/values and is finite in `(0, 1_000_000_000]`. Effective non-noop changes allocate one exclusive same-layer ownership group and a monotonic sequence; pending ownership is bounded at 512 terrain, 512 elevation, and 1,024 combined targets. No-op is allocation- and event-free.
- Historic legacy timers advance first, then native groups use an ULP-bounded countdown. All due groups restore through one atomic candidate/navigation proof in sequence→original-operation order. Unsafe expiry retains every due group at zero without diagnostics/events and retries through `tick(0)`. Active snapshot adds terraforming v1 pending state; inner checkpoint v2 stores next sequence, groups, applied values, and exact before-images. Historic v0/v1 forms preserve form/digest until successful timed promotion; outer versions remain unchanged and terrain-only v2 rejects hidden elevation state.
- C3B RED → GREEN and double-verification evidence is green: focused 71/71, full Vitest 1671/1671 across 132 files, focused golden/checkpoint/replay/template conformance 198/198, renderer/template 53/53, full Playwright 17/17, isolated 4 templates × 2 grids × 2 renderers matrix 1/1, and typecheck/build:engine/validate/sim/build/plugin build/validate/smoke. Independent code and constructor-integration sign-offs are PASS.
- Accepted C4A adapts legacy TowerScript `setTileTerrain`/`restoreTileTerrain` only on the active terraforming path. Direct sets require a known authored terrain but no transition/tag; set/restore share candidate → authored/dynamic proof → atomic publish. Timed set uses the C3B native group, exact before-image, ownership, expiry, and checkpoint inner v2. Fixed budget/expression order is action → one terrain slot → timed group/duration → q → r → destination/ownership/candidate/proof/publish; true effective no-op exits before proof/group/sequence/publication. Absent/disabled/unselected branches remain literal legacy behavior.
- C4A TDD and double-verification are green: initial 7 RED/4 GREEN; corrected/migrated focused fixtures 42/42; verifier-authored active authored-route no-op RED then GREEN; relevant engine 149/149. Code sign-off covered focused 134, C4A 5×12, and full engine/shared 1661 (Studio listen was sandbox-denied only); constructor sign-off covered focused 302, scripts 80, template/conformance 284, full 1683, Playwright 17/17, all gates, and plugin byte-sync. No public TowerScript v6/project/outer-checkpoint/snapshot/MCP/Studio/renderer API changed.
- Accepted C4B adapts `path_water` only on the active terraforming path. It selects the complete immutable authored-path radius and rejects more than 64 cells atomically without truncation; remaining priority is group cap → duration → known `water` → terrain ownership. Direct ability-source operations share the common candidate/proof/publish tail, write no outer `expiresIn`, and create one native group containing changed cells only. All/partial no-op uses still consume cooldown and emit `waterAbilityUsed` with the full selection; all-no-op does not allocate or promote form.
- `temporaryWaterTiles` is derived from historic legacy timers followed by positive-remaining native ability-water targets in group-sequence then target-order order with dedupe. Unsafe zero-state retry retains terrain/ownership but removes the cue and special slow; persistent water has no path-water slow. Checkpoint restore gates ability source on active authored `path_water`, applied `water`, and immutable authored `path`; effective fresh use promotes historic form, reset clears/reinitializes native state, and checkpoint/journal replay remains digest-equivalent. Inactive absent/disabled/unselected square/hex stays literal legacy. No public TowerScript/project/outer-checkpoint/snapshot/MCP/Studio/renderer API changed.
- C4B TDD and double-verification are green with no findings: initial 16 RED/7 GREEN (23 contracts), C4A+C4B 35/35, all terraforming 172/172, broader root 194/194; code verifier repeated 23×3 and full 1706; integration verifier covered focused 194, golden/checkpoint/replay/template/conformance 326, Playwright 17/17, all gates, and plugin byte-sync.
- Accepted C5A exposes exact terraforming v1 descriptors through CLI/MCP/AI and adds three project-bound parameterized inert recipes: `tagged_flood`, `tagged_moat`, and `tagged_destructible_bridge`. They bind only authored tags/terrain IDs, return a detached profile plus TowerScript v6 snippet, and never enable/select mechanics or write maps, terrain, or scripts. Mechanics apply and script upsert retain independent revisions, validation, backups, and rollback.
- C5A parameter handling is exact closed own-data, 1–128 UTF-8 bytes, proxy/TOCTOU safe, and fail-closed for every recipe that does not declare parameters. `describe_schema(terraforming) → get_capabilities → get_recipe → preview(explicit missionId, enabled:true) → guarded apply → separate upsert_tower_script → validate` is published by agent guide v15. Existing Studio recipe GET remains operational and read-only by listing the new parameterized recipes as inert metadata.
- C5A final TDD/double-verification evidence is GREEN: repair matrix 44/44, relevant 249/249, full Vitest 1743/1743, Playwright 17/17, typecheck/build/validate/sim/plugin gates and byte-sync. Code verification stress-tested 160 large FIFO frames / 4,840,932 bytes, controlled late EPIPE, self-revoking proxies, and all recipe parameter boundaries; constructor integration reconfirmed legacy byte identity, full guarded authoring, Studio GET, workspace confinement, and plugin runtime. Both sign-offs PASS without findings.
- Accepted C5B adds an isolated Terraforming card to Mechanics Hub, a strict read-only recipe facade, authored transition/elevation editors, lossless future-version read-only behavior, and the complete guarded lifecycle. Materialization and preview are byte-preserving; enable performs the explicit v3 migration; save/reload is exact; global disable preserves profiles and mission selections while making the capability inactive; re-enable restores the same authored intent. Ordinary forms, Visual Graph, renderers, and players remain unchanged.
- C5B TDD began at 18 RED/4 GREEN and is now green at focused 25/25, Studio regression 104/104, Chromium lifecycle 8/8, full Vitest 1762/1762, and full Playwright 25/25. Independent code verification passed with 64 concurrent recipe requests plus XSS/prototype/path probes. Constructor integration reconfirmed legacy byte identity, MCP/AI parity, Canvas/Phaser × hex/square/player compatibility, build/plugin gates, and byte-identical plugin runtime. Both sign-offs are PASS without findings.
- Accepted C6 adds one bounded descriptor-safe shared projector. Effective tile/elevation snapshots are authoritative; current events are invalidation hints only and pending expiry groups are validation-only. Canvas and Phaser share square self+8 / odd-r self+6 autotile expansion and use full redraw when bounded union/expansion fails. Studio Playtest, generated PWA/single-file players, web packages, `.tdpack`, and `docs/examples/opt-in-transactional-terraforming/` use the same contract. Absent/disabled/unselected missions remain on the legacy path.
- C6 TDD began with 11 RED; repair regressions covered exact keys and malformed UTF-16. A browser regression exposed and closed the stale Studio `drawElevationCues` call. Final evidence is focused 48/48, package 3/3, Studio 8/8, player 2/2, full Vitest 1777/1777, E2E 27/27, the template/grid/renderer matrix, and all required typecheck/build/validate/sim/plugin gates. Independent code and constructor-integration verification are PASS without findings; ADR 0027 is Accepted.
- R4.0A is implemented as a migration-only profile slice: canonical `PlayerProfileV3` keeps the same five persistent domains, v2/legacy loads remain read-only until explicit mutation, and future opaque bytes are protected beyond current codec budgets. It deliberately leaves per-run state to the separate R4.0B contract and enables no rogue mechanic or UI.
- R4.0B implements the separate content-independent `CampaignRunV1` create/decode/import/export codec with inert ordered deck/artifact instance references and run resources. It has no automatic persistence, UI, MCP, capability, or simulation integration. The next allowed R4 increment is opt-in synergy tags; artifact semantics, draft, and campaign nodes remain later slices.
- R4.1A is accepted: opt-in `roguelite` v1 tower tags and 2/4/6 damage synergies use the shared run-stage modifier pipeline, Mechanics Hub/MCP authoring, and optional renderer/player projection without consuming `CampaignRunV1`.
- R4.2A/B/C are accepted: `roguelite` v2 adds deterministic boss artifact loot and between-wave socketing through `GameCommandV2`, nested checkpoint state, Studio/player controls, and separate verifier-approved active/legacy paths.
- R4.3 is accepted: `roguelite` v3 adds deterministic three-card wave draft, `GameCommandV3`, pause-until-choice, checkpoint/journal replay equivalence, and Canvas/Phaser plus Studio controls. Final evidence was 1,902/1,902 Vitest and 41/41 Playwright.
- R4.4A is accepted: `roguelite` v4 and optional `worldMap.campaign` v1 provide a bounded typed DAG above battle simulations. `CampaignRunV1` stays a separate explicit-import/export document; persistent profile, battle snapshot/checkpoint, command and replay versions do not change. Studio and MCP share an exact closed schema and a revision-guarded four-file transaction hardened against Proxy/TOCTOU and parent-symlink swaps. Active/absent Canvas/Phaser × hex/square scenarios cover mouse, keyboard, touch, battle victory, structural-node guard, and portable run round-trip. Final evidence is 1,938/1,938 Vitest, 44/44 Playwright, all required build/plugin gates, exact source/plugin parity, and independent code plus constructor PASS without P0–P2 findings.

## 2026-07-29 — R10 completed

- R10 is split into two independent tracks: compute-only Persona QA and the mission-selected
  `quests` v1 gameplay module. Its runtime contract is independent from R9 and both are now
  integrated on the shared mainline.
- Accepted architecture, version domains, delivery slices, limits and acceptance criteria are
  recorded in `docs/adr/0051-r10-persona-qa-and-procedural-quests.md`; the canonical architecture
  and runbook document the completed implementation.
- R10.1 began RED on the missing fixed-persona runner/report, `quests` capability/closed descriptor
  and deterministic weighted selector exports.
- R10.1–R10.4 are implemented across the pure engine, bounded Node worker/cache, public CLI,
  read-only Studio QA Lab, compute-only MCP, Mechanics Hub, shared renderer/Playtest, generated
  players/packages and the opt-in reference fixture. The worker rechecks engine/content identity,
  rejects selected maps above 65,536 cells before simulation construction, validates cached
  evidence against the exact request matrix and emits no partial findings on cancellation.
- Active quest runtime owns exact lethal-source attribution, mission-applicable typed script/status
  producers, positive-to-zero eligible shield depletion, active-only events/snapshot/checkpoint,
  strict restore validation, and continuous/checkpoint/journal digest equivalence. Persona QA has
  a separate all-three-persona command-journal replay proof without enlarging ordinary reports.
- R10 Studio surfaces are implemented as two isolated paths: an evidence-only Persona QA Lab in
  Balance and a `quests` v1 editor in Mechanics Hub. Both compute previews are revision-bound;
  quest writes reuse the existing preview -> guarded apply transaction, and future quests v2+
  modules remain lossless/read-only.
- Studio Playtest consumes only the shared renderer `projectQuestPresentation(snapshot)` output.
  The optional panel disappears on absent/invalid quest state and shows authoritative progress plus
  bounded transient completed/failed cues when active; Studio contains no selection or progress
  rules.
- Studio R10 evidence: RED 4/4 before implementation; public surface contracts 133/133 GREEN;
  Studio server integration 17/17 GREEN including real Persona QA, stale content-hash rejection and
  inactive quest preview. Browser smoke used the required web-game Playwright client, produced no
  console errors, and visually checked Persona QA plus the Quest editor at
  `/private/tmp/towerforge-r10-balance-ok/shot-0.png` and
  `/private/tmp/towerforge-r10-quest-editor-detail/shot-0.png`.
- Independent constructor verification added an exact quests Studio lifecycle contract and an
  active/legacy package matrix. The Studio suite is now 17/17 and proves preview -> enable -> edit
  -> reload -> disable -> inactive preview -> re-enable; the package contract is 2/2 across
  Canvas/Phaser x hex/square, PWA, single-file, web archive, `.tdpack`, and untouched starter.
  A real Chromium pass also exercised Persona QA, seeded quest preview, guarded save/disable/
  re-enable, and the active-only Playtest HUD; desktop packaging retained the exact module and
  shared projector. Verification found and repaired a compile-on-demand blocker, stale plugin
  mirror, help-text localization collision, hidden quest event IDs and fail-open renderer states.
- The independent generated-player browser acceptance is 1/1 across eight active/absent
  combinations (`Canvas | Phaser` x `hex | square`). Active snapshots render the authoritative
  `Verifier finisher 0/1` HUD and absent snapshots expose neither quest state nor visible panel;
  every player boots without page errors.
- R10 constructor-integration verification is complete and PASS. The previously escalated
  compile-on-demand, event `questId`, localization, renderer state/cue consistency, Proxy, and
  accessor-backed source-scan findings are fixed and independently green. Final evidence includes
  Studio surface 6/6, Studio server lifecycle 17/17, active/legacy package matrix 2/2, focused R10
  player 1/1, full Playwright 133/133, full Vitest 3,070/3,070, all non-browser gates, and exact
  source-to-plugin parity for CLI, MCP, engine dist, renderer, vendor, and player runtime trees.
- R10 code verification is complete and PASS with no open P0–P2 findings. Focused contracts are
  53/53, the consolidated R10 suite is 68/68, and the verifier reconfirmed exact damage attribution,
  shield semantics, checkpoint restore, selectors, all-three-persona replay, worker/cache safety,
  renderer fail-closed behavior and version boundaries. The residual P3 note is limited to
  same-user derived-cache authenticity; strict audits can use `--no-cache`.
- R10 is accepted. Full evidence is Vitest 3,070/3,070 across 271 files, Playwright 133/133,
  Studio 17/17, surface contracts 6/6, all required repository gates and exact plugin parity.
## 2026-07-29 — R11 accepted

- RED contracts independently fixed the visuals-v3 closed schema, catalog/reference/budget limits,
  hostile-own-data handling, deterministic projector semantics, legacy engine invariants, shared
  renderer consumption, runtime bounds, Web Audio precedence, Studio lifecycle, packages, and MCP.
- GREEN implementation adds the opt-in `proceduralJuice` v1 catalogs, `tf-juice-rng-v1` pure
  projector, bounded local particle/audio/camera runtime, Canvas/Phaser adapters, presentation-only
  hit stop, reduced/off motion, isolated Studio Juice workspace, guarded CLI/MCP authoring, recipes,
  synthetic-event preview, AI descriptors/instructions, reference fixture, and package surfaces.
- First authoring explicitly promotes both the project manifest and visuals document to the existing
  schema v3. Absent data allocates no Juice runtime and preserves gameplay snapshots, checkpoints,
  journals, state/content digests, ordinary Studio forms, and legacy renderer/audio behavior.
- Focused R11 contracts are GREEN at 53/53 across nine files. The final complete unit run is
  3,123/3,123 across 280 files and the complete browser run is 134/134. Typecheck, engine/build,
  validate, tutorial sim, balance, map compile, production build, mobile/desktop packages, and
  plugin build/validate/smoke have passed.
- Real browser acceptance verifies guarded Studio authoring and both generated players. Canvas and
  Phaser render the same placed tower and deterministic spark burst with matching structured state
  and no application errors (only the expected missing favicon request). Independent Code Verifier
  and Constructor Integration Verifier sign-offs are PASS with no open P0–P2 findings; the final
  frozen-tree rerun, both package targets, and exact source-to-plugin parity are green. ADR 0052 is
  Accepted.

## R9 — TowerScript DX 3.0 (2026-07-29)

- User-approved scope: one opt-in PR on `codex/r9-towerscript-dx3`; TowerScript v7 only; Behavior Tree/HFSM internal v1; Graph, Trace, and Debugger v2; layout v1; optional checkpoint `scriptMachines` v1. R10/R11, release, tag, merge, and auto-merge are excluded.
- R9.1 implements strict closed-own-data validation, descriptor catalogs, bounded deterministic synchronous Behavior Trees (`selector`, `sequence`, `condition`, `select_targets`) and hostile sparse/accessor/proxy/cyclic/future/budget contracts.
- R9.2 integrates scripted targeting at the shared engine acquisition boundary after alive/class/range/LoS filtering, binary-stable bounded candidate ordering, fallback target modes, support/overlap rejection, stable manual-mode rejection, and active-only `Scripted` snapshot/player/Studio metadata.
- R9.3 implements hierarchical state resolution, leaf-to-root authored transitions, self-transition exit/entry, shared typed action execution, diagnostics after committed-state action failures, nested-signal transition budgets, `stateMachineTransitioned`, optional checkpoint/replay state, digest parity, and entity-state cleanup.
- R9.4 implements lossless Graph v2 projection and primitive authoring, behavior/transition Trace and Debugger v2 records, descriptor-driven controller recipes, guarded Studio/MCP preview/apply, updated agent guidance, and `docs/examples/opt-in-towerscript-dx3/`.
- TDD evidence includes independent RED for hostile runtime validation and Studio primitive authoring, plus an E2E RED that exposed the nested descriptor palette lookup before the production fix. Focused engine, graph, Studio, MCP, compatibility, and isolated legacy-heroes checks are green.
- Visual inspection exposed overlapping auto-positioned Graph cards after the functional suite was green. A separate RED layout contract now covers containment depth/order, input-order invariance, stable-ID pinned positions, idempotence, and collision avoidance. The Studio-only helper is GREEN at 2/2; R9 browser lifecycle is GREEN at 4/4 with pairwise DOM overlap assertions. The required skill client rendered the generated hex player without console errors, and a separate 1600×1000 Studio screenshot confirmed 11 Graph cards, zero overlaps, and zero console/page errors.
- The first independent code audit reproduced one selection-rollback P1 and two hostile-validation P2 findings. A separate seven-test RED repair slice now proves transactional failed-branch selection, fail-fast controller/child/transition budgets, and revoked-Proxy diagnostics. Focused repair is 20/20 GREEN; the verifier's 10,000-tree probe now emits one bounded issue in 1 ms without inspecting the tail.
- Final post-repair Vitest is GREEN at 3,028/3,028 across 263 files with constrained worker scheduling; sequential Playwright is GREEN at 133/133. Typecheck, engine/build, validate, 60-unit sim, balance, maps compile, plugin build/validate/smoke, desktop runtime preparation, Rust/Tauri 7/7, unsigned arm64 macOS app/DMG build, and macOS bundle/DMG verification are GREEN.
- Final independent Code Verifier and Constructor Integration Verifier re-sign-offs are PASS with no open P0-P2. ADR 0050 is Accepted. PR #20 was merged into `main` as the first S0 integration step.

## 2026-07-31 — S0 combined R9–R11 freeze candidate

- PR #20 and PR #21 are merged into `main`. R11 was merged with that exact base while preserving
  TowerScript v7/Graph-Trace-Debugger v2, Persona QA/quests v1, and visuals-v3 Procedural Juice v1.
- The ADR collision is resolved as R9 0050, R10 0051, and R11 0052 without changing feature version
  domains. Canonical source was merged first; the Codex plugin mirror was then regenerated.
- Focused combined contracts are GREEN at 362/362. Full Vitest is GREEN at 3,157/3,157 across 283
  files and full Playwright is GREEN at 135/135. Typecheck, engine build, validate, tutorial sim,
  balance, maps compile, production build, plugin build/validate/smoke, mobile/desktop scaffolds, and
  Rust/Tauri 7/7 are GREEN.
- The tree is now ready for an exact-commit Code Verifier and Constructor Integration Verifier
  re-freeze. Any subsequent source change invalidates those sign-offs.

## 2026-07-31 — S0 complete and R12.1 contract freeze

- The exact R9–R11 integration commit `917bcb5` passed GitHub CI, Code Verifier, Constructor
  Integration Verifier, and the independent source/plugin/docs audit with no new P0–P3 findings.
  PR #22 was merged to `main` as `e505e4f`; R12 starts from that source in
  `codex/r12-advanced-enemies`.
- ADR 0053 freezes the opt-in `enemyBehaviors` v1 boundary. The first R12.1 slice is content-only:
  capability, closed normalizer, hostile-data budgets, active/inactive semantic references, and a
  fail-closed resolver. DamagePacket routing and runtime component state are a separate RED.
- Program Architect, Contract/Test Designer, and Constructor Surface Architect are separate roles.
  The production author will not perform either final verification sign-off.
- R12.1a RED is recorded with
  `npm run test -- packages/engine/src/content/enemy-behaviors-mechanics.contract.test.ts`:
  1 failed file, 6/6 expected failures. The baseline lacks the module/capability and descriptor,
  reports `Unknown mechanics module "enemyBehaviors"`, exports no closed normalizer/resolver, and
  cannot emit module-specific active-error/inactive-warning cross-reference diagnostics. No
  production file was changed before this evidence.
- R12.1a GREEN adds the pure engine-owned `enemyBehaviors` v1 types, closed normalizer, schema
  descriptor, capability resolution, semantic cross-reference validation, and fail-closed active
  resolver. The original contract is GREEN at 6/6; the compatibility content suite is 179/179 and
  the complete engine suite is 2,039/2,039 across 118 files. Typecheck is GREEN. Runtime component
  HP/shields, DamagePacket targeting, snapshots, and checkpoint state remain intentionally absent
  until the next independent RED.
### R12.1b RED evidence — boss component runtime

- Contract/Test Designer added `packages/engine/src/simulation/r12-boss-components-runtime.contract.test.ts` against `4c29f6c`.
- Command: `npx vitest run packages/engine/src/simulation/r12-boss-components-runtime.contract.test.ts --maxWorkers=1`.
- Expected RED: 1 file failed; 6 tests total; 3 failed / 3 passed. Missing active `enemyBehaviors` snapshot/checkpoint sections and component-target damage incorrectly mutated root HP. Absent, disabled, and unselected compatibility controls passed.

### R12.1b GREEN evidence — boss component runtime

- Runtime state is active-only and detached in snapshots/checkpoints; inactive shapes remain byte-free of `enemyBehaviors`.
- Component packets use the shared `DamageResolver`, preserve root HP, consume root shield before component shield, discard component HP overflow, and reject incoherent component ids before resolution.
- Checkpoint validation is closed and authored-state aware; restore preserves the state digest. DamagePacket descriptor v2 exposes optional enemy `componentId` without changing command/journal versions.
- Descriptor RED: `packages/engine/src/content/schema-descriptor.test.ts` failed 1/34 before the v2 metadata was added.
- GREEN: focused runtime 9/9; focused engine/content 171/171; `npm run typecheck` PASS; `npm run build:engine` PASS; full `npm run test` 3172/3172 across 285 files.

### R12.1c RED evidence — tower routing and ability suppression

- Focused command: `npx vitest run packages/engine/src/simulation/r12-boss-components-runtime.contract.test.ts --maxWorkers=1`.
- Expected RED: 12 tests total; 2 failed / 10 passed. Tower-origin damage still hit root HP instead of the binary-first live component selected by authored `priorityTags`; therefore component skip/fallback behavior was absent.

### R12.1c GREEN evidence — tower routing and ability suppression

- Tower-origin packets now select the first live component by authored tag order and binary component id; destroyed matches are skipped and exhausted bindings fall back to root HP.
- Destroyed components suppress only the allowlisted authored boss abilities (`towerAttack`, `towerDisrupt`, `healAura`); component destruction itself grants no kill, reward, or root damage.
- GREEN: R12 runtime/routing 12/12; focused TowerDefenseGame compatibility 66/66; `npm run typecheck` PASS; `npm run build:engine` PASS.

### R12.1d RED evidence — constructor and AI surfaces

- Independent CLI/MCP contract designers ran `npx vitest run packages/cli/lib/r12-enemy-behaviors-authoring.contract.test.mjs packages/mcp/r12-enemy-behaviors-authoring.contract.test.mjs --maxWorkers=1`: 2 files failed, 6/6 tests failed. The module was absent from loader authoring views, schema domains, capability output, and guarded preview/apply workflows.
- Independent Studio contract designer ran `npx vitest run packages/studio/public/r12-enemy-behaviors-surface.contract.test.mjs --maxWorkers=1`: 3/3 failed. Mechanics Hub had no isolated card/editor or draft helpers, and its hard 32-recipe truncation hid the new recipe.
- Independent renderer/player contract designer ran `npx vitest run packages/renderer/src/enemy-components-presentation.contract.test.mjs --maxWorkers=1`: 5/5 failed. No fail-closed shared component projector or Canvas/Phaser wiring existed.
- The project-bound recipe contract ran with `npx vitest run packages/cli/lib/r12-enemy-behaviors-recipe.contract.test.mjs --maxWorkers=1`: 4/4 failed because `basic_targetable_boss_components` and its typed missing-context error did not exist.

### R12.1d GREEN evidence — constructor and AI surfaces

- CLI and MCP now expose the same engine-owned `enemyBehaviors` v1 descriptor, active capability, compact authoring view, and existing revision-guarded preview/apply transaction.
- Mechanics Hub owns an isolated JSON editor with future-version read-only preservation; the ordinary enemy/tower forms remain unchanged. The recipe list is no longer truncated at 32 entries.
- `basic_targetable_boss_components` materializes a deterministic binary-first authored enemy/tower candidate and remains inert until explicit guarded enablement.
- Canvas and Phaser consume one bounded fail-closed projection of the authoritative optional snapshot; they only draw component bars while the module is active and do not own targeting or damage rules.
- Focused GREEN command covering engine routing, recipe, CLI/MCP, Studio, and renderer/player contracts: 6 files, 23/23 tests passed.

### R12.2 contract freeze and RED evidence — component events / HFSM

- Public v7-only events `bossComponentDamaged` and `bossComponentDestroyed` carry the same closed captured post-resolution payload: enemy/type/component/source, previous/current/max HP, HP delta, previous/current/capacity component shield, and component-local absorbed delta. Root-shield absorption is excluded.
- A packet emits damage only for an effective component-local decrease and destruction only for the first positive-to-zero crossing. Stable order is root `enemyShieldChanged` (when applicable) -> component damaged -> component destroyed -> caller legacy `enemyHit`. Regeneration and dead-component repeats emit neither lifecycle event.
- HFSM alone receives an optional detached/frozen `component` expression root built from the captured event payload plus authored metadata. Ordinary handlers and non-component events do not gain that root. Existing leaf-to-ancestor resolution, target-before-actions, action/event/transition budgets and all version domains remain unchanged.
- Independent schema/runtime RED command: `npx vitest run packages/engine/src/scripting/r12-boss-component-events-schema.contract.test.ts packages/engine/src/simulation/r12-boss-component-events.contract.test.ts --maxWorkers=1` -> 2 files failed, 13 expected failures / 1 negative control passed. Events, exact fields, v7 gate, runtime ordering, all seven source kinds and handler dispatch were absent.
- Independent HFSM/checkpoint RED command: `npx vitest run packages/engine/src/simulation/r12-boss-component-hfsm.contract.test.ts packages/engine/src/simulation/r12-boss-component-checkpoint.contract.test.ts --maxWorkers=1` -> 2 files failed, 11 expected failures / 4 inactive compatibility controls passed. Machines remained in their initial state and no component lifecycle events existed to validate or replay.

### R12.2 GREEN engine evidence — component events / HFSM

- The engine emits the two schema-v7 lifecycle events from resolved component-local HP/shield deltas, before the legacy `enemyHit` caller event, and never emits them for root-only absorption, regeneration, or repeated damage to an already destroyed component.
- HFSM transition planning and exit/transition/entry actions receive one detached frozen component snapshot captured from the triggering event; ordinary handlers retain their previous expression roots.
- Checkpoint restore validates the closed event shape, authored enemy/component references, source kind, scaled capacities, arithmetic deltas, and destruction crossing without requiring a historical event to match the latest live component state.
- Focused GREEN: the four new contracts plus existing scripting validation, HFSM, checkpoint and replay coverage passed 110/110. `npm run typecheck` and `npm run build:engine` are the next exact engine gates before surface integration.

### R12.2 RED/GREEN surface evidence

- Independent surface RED added exact descriptor, Graph, MCP trace, and Studio picker contracts. Focused RED was 3 failed / 3 passed: the engine descriptor lacked component field metadata and event minimum versions, while the Studio picker offered v7 events to legacy scripts. Existing Graph v2 lossless round-trip and compute-only event-to-transition trace provenance already passed without a new grammar.
- GREEN publishes exact detached component/shield fields and minimum event schema versions, keeps Graph/Trace v2, and filters Studio handler/transition choices against the canonical script AST version using descriptor metadata rather than hardcoded R12 names. Focused engine + MCP + Studio surface contracts pass 6/6.
- A follow-up regression RED proved that the generated Studio node catalog dropped `minimumSchemaVersion`; the catalog now carries the engine completion entries losslessly, so actual UI filtering and descriptor discovery use the same metadata.
- Independent docs/AI RED was 2/2 expected failures for the missing component-phase recipe and guide v38. GREEN adds the inert `component_driven_boss_phase` descriptor and guide v39 without a write tool or Graph grammar change; its focused docs/agent suite passed 38/38.
- Exact slice gates: typecheck, engine build, project validation, tutorial simulation, web build, plugin build/validate/smoke, and the combined R12.1/R12.2 focused suite pass. The first parallel full-unit run passed 3,234/3,236 and exposed two unrelated MCP concurrency flakes; their immediate serial rerun passed 97/97. A clean full-unit rerun remains required on the frozen commit.

## 2026-07-31 — R12.3 formation steering

### R12.3a contract freeze / RED / GREEN — formation content

- Formation steering extends the same opt-in `enemyBehaviors` v1 profile; it does not add a module or version bump. A profile may contain bosses, formations, or both, while targeting still requires bosses. Formation-only activation requires mission-selected dynamic-flow Navigation.
- Authored cohorts bind each enemy type to one role (`vanguard | body | support`) and one closed steering tuple. Bounds are 64 cohorts, 256 members per cohort, 4,096 assignments, radius 1..2, integer weights 0..1,000 with at least one positive weight. Vanguard protection remains outside this slice.
- Independent content RED added 28 tests: 9 expected failures / 19 negative controls passed. Missing contracts were descriptor/profile support, formation-only normalization, canonical freezing, early budgets, dynamic-flow dependency and enemy references.
- GREEN accepts detached binary-canonical formation-only or mixed profiles, preserves the exact boss-only normalized byte shape, rejects hostile/accessor/sparse/cyclic and over-budget data before reading a tail value, and reports active semantic errors versus inactive warnings. Focused content/component compatibility is 55/55; typecheck and engine build pass.

### R12.3b RED/GREEN — pure formation planner

- Independent planner RED added 33/33 expected failures against the missing exported pure API. Contracts pin the closed request/result, square/hex topology, exact safe-integer cohesion/separation/role score, host-candidate confinement, canonical/direction tie-breaks, permutation invariance, 16-neighbor bound, detached freeze, hostile inputs and overflow rejection.
- GREEN adds `selectFormationSteeringNextV1` as a pure engine-only chooser over an already host-proven equal-optimal candidate set. It does not read maps, fields, entities, RNG or renderer state and cannot invent a navigation step. Focused planner/navigation compatibility passes 52/52; typecheck and engine build pass.

### R12.3c RED/GREEN — formation runtime, checkpoint, determinism, and scale

- Independent runtime RED command: `npx vitest run packages/engine/src/simulation/r12-formation-steering-runtime.contract.test.ts --maxWorkers=1` -> 4/4 expected failures. Active formation membership, checkpoint state, shared-field steering integration, and frozen bounded counters were absent.
- Independent scale RED command: `npx vitest run packages/engine/src/simulation/r12-formation-steering-runtime-scale.contract.test.ts --maxWorkers=1` -> 7/7 expected failures. Checkpoint formation validation, replay/restore parity, cohort/profile/goal partitions, live-order invariance, edge-progress gating, and bounded 500/1,000-enemy work were absent.
- GREEN builds immutable once-per-tick spatial observations partitioned by authored cohort, movement profile, and field goal. It inspects at most 32 bucket entries and passes at most 16 same-partition neighbors to the pure planner. Steering runs only at `edgeProgress === 0` and may choose only topology-adjacent equal-optimal field cells; mid-edge state is never replanned.
- Active snapshots/checkpoints publish binary-canonical live membership while absent, disabled, unselected, authored-route, and boss-only paths perform no formation work and publish no formation section. Restore validates exact authored cohort/role membership and accepts a non-canonical navigation link only when it is equal-optimal for an active formation enemy.
- GREEN evidence: the two new runtime suites pass 11/11; focused navigation/checkpoint/replay/TowerDefenseGame compatibility passes 190/190; `npm run typecheck` passes. Diagnostic counters are detached/frozen and excluded from checkpoint and digest state.

### R12.3d RED/GREEN — constructor, AI, renderer, and player surfaces

- Independent surface RED added four contracts and produced 12/12 expected failures: the inert recipe and dynamic-flow prerequisite were missing; MCP omitted the formations snapshot vocabulary and guide; Mechanics Hub had no isolated cohort editor; Canvas/Phaser had no shared active-only presentation projector.
- GREEN adds `basic_formation_steering` without enabling Navigation or Enemy Behaviors, reuses the existing preview/revision-guarded apply transaction, publishes the engine-owned closed descriptor and guide v40, and keeps formation editing inside Mechanics Hub. No broad or formation-specific writer was added.
- One fail-closed bounded renderer projector turns authoritative `snapshot.enemyBehaviors.formations` membership into detached binary-stable role rows. Canvas and generated Phaser only draw role cues; neither path reads mechanics content or recomputes movement.
- Focused surface GREEN passes 12/12. Renderer/Studio compatibility passes 362/362; related recipe and agent-guide suites pass 53/53; the production web build passes. Browser verification opened Advanced Enemy Behaviors, confirmed both recipes and the isolated Formation cohorts editor, exercised scrolling, and reported zero console errors. Evidence screenshot: `/private/tmp/towerforge-r12-formation-editor-detail.png`.

## 2026-07-31 — R12.4 vanguard protection

### R12.4a contract freeze / RED / GREEN — protected cohort content

- Vanguard protection extends an authored formation cohort with the optional closed object
  `{ radius, sourceKinds }`. Radius is bounded to 1..4 and source kinds are a non-empty canonical
  subset of `tower | ability | tower_script | status | reaction | enemy`; leak damage is excluded.
  Runtime budgets are frozen at 16 inspected candidates per packet and 512 successful redirects
  per public tick.
- Active semantic validation requires at least one vanguard and one body/support type and an active
  root Combat shield for every authored vanguard. Disabled or unselected Enemy Behaviors retains
  structural validation but downgrades those cross-module dependencies to warnings.
- Independent RED command:
  `npx vitest run packages/engine/src/content/r12-vanguard-protection-mechanics.contract.test.ts`
  produced 16/16 expected failures against the missing protection schema, limits, normalizer and
  semantic validation. Production code was unchanged when the evidence was captured.
- GREEN implements detached, deeply frozen, binary-canonical normalization and closed own-data
  validation, including accessor/proxy/sparse/cyclic/duplicate/future-source/over-budget cases.
  Focused content contract is GREEN at 16/16; the R12.3 content compatibility contract remains
  GREEN. Runtime interception and its event/snapshot/checkpoint state remain a separate RED slice.

### R12.4b RED/GREEN — bounded runtime interception

- Independent runtime RED command:
  `npx vitest run packages/engine/src/simulation/r12-vanguard-protection-runtime.contract.test.ts --maxWorkers=1`
  produced 8/8 expected failures against the missing redirect, event, metadata, checkpoint validator,
  diagnostics and budgets. A test-only follow-up corrected the fixture's distinction between an
  omitted component argument and explicit root targeting; production was not changed for that fix.
- GREEN redirects one complete eligible packet to the nearest then binary-first live same-cohort
  vanguard with a positive root Combat shield. The component target is cleared, overflow remains on
  that vanguard, no second interception is possible, and the shared DamageResolver recomputes the
  chosen vanguard's armor, resistance, marks and legacy pierce adapter before shield/HP mutation.
- A lazy spatial index avoids a per-packet live-enemy scan. Candidate collection is topology-bounded
  and capped at 16; successful transactions are capped at 512 per public tick. Read-only cumulative
  diagnostics are detached from snapshot/checkpoint/digest state, while only active authored
  protection metadata and the exact interception event enter snapshot/checkpoint state.
- Focused runtime is GREEN at 8/8. Checkpoint/replay/damage/formation compatibility is GREEN at
  127/127; `npm run typecheck` and `npm run build:engine` pass. Constructor surfaces remain a
  separate RED/GREEN slice.

### R12.4b independent audit regression — target attribution and runtime cleanup

- The pre-freeze architecture audit identified three production risks. An independent test designer
  captured them in a six-test regression contract before production changes: all 6/6 tests failed for
  post-interception hit/status attribution, armor-block attribution, stale reset diagnostics/cache,
  spawn-time cache invalidation, and interception occurring before exact target/component validation.
- GREEN keeps `towerFired` attached to the tower's acquired target but attaches `enemyHit`,
  `enemyArmorBlocked`, and legacy on-hit status to the actual vanguard that received the packet.
  Damage target identity and authored component existence are now validated before interception.
- Reset, TowerScript spawn, phase spawn, and death/replacement paths invalidate the lazy protection
  index; reset also clears all protection counters. Focused regression plus original runtime contracts
  pass 14/14 and `npm run typecheck` passes.

### R12.4c RED/GREEN — constructor, AI, renderer, and player surfaces

- Independent surface RED added four contracts and produced 12/12 expected failures: the inert
  recipe and explicit prerequisites were missing; MCP omitted the closed protection vocabulary and
  read-only GameEvent; Mechanics Hub had no isolated protection guidance; Canvas/Phaser had no
  shared active-only presentation projector.
- GREEN adds `basic_vanguard_protection` without enabling or selecting Navigation, Combat, or Enemy
  Behaviors; guide v41 and schema discovery reuse the existing guarded mechanics transaction and add
  no dedicated writer. Mechanics Hub keeps protection inside the formation JSON editor.
- Canvas and generated Phaser consume one bounded fail-closed projector over authoritative active
  snapshot metadata/events and do not own interceptor selection. Focused surface GREEN passes 12/12;
  Renderer/Studio compatibility passes 379/379 and related guide/descriptor compatibility passes
  83/83.
- A separate projector-hardening RED found 5 fail-open own-data cases for extra/symbol array fields
  and a cyclic event value. Closed dense-array validation and event-shape screening make the expanded
  projector contract GREEN at 14/14 without changing gameplay state.
- The first full browser gate exposed a recipe-list regression after a Combat profile without root
  enemy shields was authored: two existing Mechanics Hub lifecycles reached `Mechanics unavailable`.
  An independent focused RED pinned both the leaked empty shield-fact array and whole-list failure.
  The project context now omits unavailable shield facts, preserving the inert binary-first recipe
  candidate while authoritative preview still rejects the unmet prerequisite. Focused CLI is GREEN
  at 5/5 and both affected Studio E2E lifecycles pass 2/2 in serial.
- Independent browser acceptance then recorded 2 RED / 1 GREEN: Studio injected `bosses: {}` into a
  valid formations-only profile, while Canvas/Phaser headless text omitted the already-authoritative
  protection projection; absent/disabled controls were already GREEN. The lossless Studio normalizer
  now preserves omitted bosses and both player templates expose the shared active-only projector in
  `render_game_to_text`. Full Studio lifecycle, Canvas/Phaser × hex/square, and absent/disabled paths
  pass 3/3 Playwright scenarios.
- The active package contract passes 2/2 and covers Canvas/Phaser × hex/square, PWA, single-file,
  portable web ZIP, `.tdpack`, exact project selection, bundled engine/renderer projection, and an
  untouched starter without synthesized protection snapshot/checkpoint state.

### R12.4d RED/GREEN — documentation and opt-in fixture

- Independent docs/fixture RED command:
  `npx vitest run packages/mcp/r12-vanguard-protection-docs.contract.test.mjs` produced 3/3
  expected failures because the `opt-in-vanguard-protection` catalog, mission selection, and README
  did not exist. Production runtime was unchanged when the evidence was captured.
- GREEN adds one detached fixture that explicitly composes Navigation v1 `dynamic_flow`, a Combat
  root shield, and an `enemyBehaviors` protected formation. Architecture, ADR, roadmap, and runbook
  freeze one-hop interception, 16 candidates per packet, 512 redirects per public tick, and the
  read-only non-TowerScript `vanguardDamageIntercepted` GameEvent.
- Focused docs/fixture contract is GREEN at 3/3. The combined agent-guide/docs check is GREEN at
  7/7; both fixture JSON documents parse successfully and the scoped diff check passes.

### R12 final verifier repair — mission-scoped armor and checkpointed protection budget

- The first frozen R12 commit `b65dc7c` did not receive Code Verifier sign-off. The independent
  review found two P1 defects: component armor validation accepted an armor type from an unrelated
  unselected Combat profile, and the gameplay-affecting 512-interception public-tick counter was
  not restored from checkpoints. The earlier freeze, gates, and integration sign-off were therefore
  invalidated before the branch was published.
- Independent RED added mission-selected active/disabled/unselected armor reference cases and a
  checkpoint-only closed `protectionRuntime` v1 contract. The initial focused command
  `npx vitest run packages/engine/src/content/enemy-behaviors-mechanics.contract.test.ts packages/engine/src/simulation/r12-vanguard-protection-runtime.contract.test.ts --maxWorkers=1`
  failed 10/24 for the missing checks and state. A first GREEN attempt left 4/24 failures: two
  diagnostic contracts, one inactive-field rejection, and a test-only navigation fixture whose
  manually placed enemy lacked a valid `nextCoord` for restore.
- GREEN validates component armor against every mission-selected Combat profile that can activate
  the Enemy Behaviors profile. Inactive references remain warnings. Checkpoints now preserve only
  `{ schemaVersion: 1, transactionsThisTick }` when authored protection is active; snapshots and
  inactive checkpoints remain unchanged. The independent test designer repaired only the invalid
  navigation fixture and did not alter production or the 511 -> restore -> 2 packet boundary.
- Focused repair is GREEN at 24/24. The linked R12 content, components, HFSM, formation, protection,
  checkpoint, navigation, journal, replay, and damage set is GREEN at 332/332; `npm run typecheck`
  and `npm run build:engine` pass. A new exact-commit freeze, complete gates, and two new independent
  sign-offs remain required.

### R12 second verifier repair — event-bound budget and hostile own-data reads

- The second frozen commit `55e8150` passed the complete local gates and Constructor Integration
  Verifier, but did not receive Code Verifier sign-off. That audit confirmed one P1 checkpoint
  budget bypass and two P2 hostile-accessor paths. The integration sign-off and all freeze evidence
  were invalidated before publication.
- Independent checkpoint RED added 17 successful interceptions, a pristine restore, then a forged
  `transactionsThisTick: 0` with a recomputed digest. The focused suite failed 1/16 because restore
  accepted a state whose retained `vanguardDamageIntercepted` events proved that 17 of the 512
  transactions had already been consumed. Positive pristine and tick-reset controls passed.
- Independent hostile-data RED added a sibling Combat-module accessor and accessors for R12 recipe
  context fields `defaultMissionId`, `missionIds`, `enemyIds`, and `towerIds`. Engine validation
  failed 1/10 and recipe materialization failed 4/9 because each getter was executed once.
- GREEN requires the checkpoint transaction counter to equal this public tick's validated
  interception-event count. Enemy Behaviors cross-reference validation now continues only through
  descriptor-safe detached Combat/profile/armor records. Recipe context fields use a closed
  enumerable own-data reader and reject accessors with stable code `mechanics_recipe_context_invalid`.
- The three repair suites are GREEN at 35/35; the broader CLI recipe, engine content,
  checkpoint/navigation/journal/replay/damage/R12 compatibility set is GREEN at 1,196/1,196;
  `npm run typecheck` passes. Another exact-commit freeze, full gates, and two new independent
  sign-offs remain mandatory.

### R12 third verifier repair — nested recipe ID catalogs

- Frozen commit `926bfff` passed the complete local gates, but the next Code Verifier correctly
  withheld sign-off: top-level context fields were descriptor-safe while nested ID arrays still
  reached `Array.prototype.filter`, executing index accessors and Proxy traps.
- Independent RED covers `missionIds`, `enemyIds`, and `towerIds` across accessor-backed index zero,
  throwing Proxy, revoked Proxy, and sparse arrays. It failed 12/21: accessors/traps ran, revoked
  proxies leaked a raw `TypeError`, and sparse arrays were silently accepted. Normal and top-level
  own-data controls remained GREEN.
- GREEN adds a Node-side, bounded dense own-data ID-catalog inspector. It rejects Proxy arrays before
  reading elements, inspects ordinary arrays only through descriptors, rejects symbols, extra keys,
  accessors, holes, non-string/empty entries, and lengths above 100,000, then sorts a detached copy.
  R12 formation/protection and existing parameterized recipes now consume the same safe catalog.
- The focused hostile matrix is GREEN at 21/21; the complete CLI library suite is GREEN at 359/359;
  typecheck, engine build, plugin build/validate/smoke, generated runtime sync, and diff checks pass.
  The source is not publishable until one more exact-commit full gate cycle and two fresh sign-offs.

## 2026-07-31 — R13.1 projectile foundation

### Contract freeze and RED evidence

- R13.1 introduces a separate mission-selected `ballistics` v1 profile and does not extend the
  existing tile-displacement `physics` module. Only explicitly bound, unchained `single` attacks
  become projectiles; unbound single attacks and every other attack kind stay on the immediate
  legacy path.
- `maxAltitude` is additional height over the linear source-to-target elevation baseline. Direct
  flight uses the baseline; arc flight uses
  `baseline + 4 * maxAltitude * progress * (1 - progress)`. Source/target coordinates, endpoint
  elevations, component target, and a detached launch-time `DamagePacket` are immutable in flight.
- The first pre-production command
  `npx vitest run packages/engine/src/content/r13-ballistics-mechanics.contract.test.ts packages/engine/src/simulation/r13-projectile-foundation.contract.test.ts --maxWorkers=1`
  produced 15 expected failures / 5 passing legacy-negative controls. The test designer then
  corrected only time expectations to preserve the existing public-tick clamp of 0.2; typecheck
  remained GREEN and the corrected/expanded contract remained RED at 15 failures / 8 passes while
  content/runtime support was absent or incomplete.
- Frozen exclusions: arc clearance, ricochet, destructibles, weather, homing, chain/pipeline/splash
  projectile delivery, new commands, TowerScript events/actions, Visual Graph nodes, and renderer-
  owned collision or damage rules.

### GREEN engine evidence

- The pure engine now owns closed own-data profile normalization, active capability resolution,
  fixed-tick projectile launch/advance/impact, stable projectile IDs, scalar altitude, fixed-point
  misses, and exactly-once impact through the shared `DamageResolver` boundary. Target armor,
  resistance, marks, shields, vanguard interception, reactions, status and death settlement remain
  impact-time engine work; source modifiers and target component identity are captured at launch.
- Active projects receive optional inner-v1 snapshot/checkpoint state. Inactive/disabled/unselected
  projects synthesize no state. Checkpoint validation rejects inactive/future/malformed/duplicate/
  over-budget state, and checkpoint restore plus command-journal replay preserve the continuous
  digest.
- Focused GREEN: the content/runtime R13.1 contracts pass 23/23; damage-routing and R13 runtime pass
  27/27; the broader affected engine compatibility set passes 200/200; `npm run typecheck` passes.
  Constructor/AI/renderer/player surfaces remain a separate RED/GREEN slice.

### Surface RED evidence

- Before surface production, the isolated command
  `npx vitest run packages/mcp/r13-ballistics-authoring.contract.test.mjs packages/renderer/src/ballistics-presentation.contract.test.mjs packages/studio/public/r13-ballistics-surface.contract.test.mjs --maxWorkers=1`
  failed all 11 tests for the intended missing contracts: complete MCP descriptors and inert recipe,
  guide v42 workflow, a shared fail-closed presentation projector, Mechanics Hub editor, Playtest
  overlay, and generated Canvas/Phaser consumption.
- The RED explicitly forbids renderer-owned altitude/gameplay calculation and keeps the editor out of
  ordinary tower/mission forms. Production implementation and final GREEN are recorded only after
  that independent test design.

### Surface GREEN evidence

- The shared renderer now fail-closes absent/future/malformed/hostile/over-budget ballistics state,
  returns detached binary-stable presentation rows, and interpolates pixels from engine-owned
  altitude without implementing flight or collision. Canvas, Studio Playtest, and generated Phaser
  use the same projector and hide all ballistics work when the optional snapshot section is absent.
- Mechanics Hub owns the closed JSON editor and active/read-only state; ordinary tower and mission
  forms remain unchanged. MCP publishes the v1 descriptor, inert
  `basic_projectile_ballistics` recipe, guarded preview/apply flow, and guide v42 without adding a
  broad ballistics write/analyze tool. Generated plugin runtime is synchronized from source.
- The exact pre-production RED command is GREEN at 11/11. Engine contracts remain GREEN at 23/23,
  and `npm run typecheck` passes. Full frozen-commit gates and independent sign-offs remain pending.

## 2026-07-31 — R13.2 arc clearance

### Contract freeze and RED evidence

- Ballistics remains module schema v1. R13.2 adds optional
  `projectiles.clearance.terrainBlockerHeights`, keyed by authored terrain tags rather than terrain
  IDs. Absence preserves the exact R13.1 profile/checkpoint path. Clearance samples the canonical
  topology line once at launch, excludes endpoints, and blocks when projectile altitude is less
  than or equal to effective tile elevation plus the highest matching authored blocker height;
  equal-height tag provenance uses binary-min order.
- The launch-time trace is immutable. A blocked projectile reaches its captured collision time,
  consumes the existing terminal-resolution budget, emits exactly one read-only
  `projectileBlocked` GameEvent, and performs no damage/reward/reaction work. Ray or operation budget
  failure happens before `towerFired`, ammunition, cooldown, or allocation.
- Clearance uses optional ballistics checkpoint inner schema v2 and stores only sufficient immutable
  blocker provenance; the outer checkpoint, snapshot v1, GameCommand/Journal, TowerScript, and Graph
  versions do not change. R13.2 excludes ricochet, destructibles, dynamic mid-flight collision,
  entity blockers, weather, homing, enemy projectiles, and new commands/script nodes.
- Pre-production command
  `npx vitest run packages/engine/src/content/r13-arc-clearance-mechanics.contract.test.ts packages/engine/src/simulation/r13-arc-clearance.contract.test.ts --maxWorkers=1`
  proved RED at 13 expected failures / 7 legacy-negative controls. Content-only RED was independently
  reproduced at 4 failures / 4 controls; `npm run typecheck` remained GREEN before production.

### Engine GREEN and pre-freeze regression

- Engine content/runtime now normalizes the closed tag-height map, traces the canonical line once at
  launch, clamps terminal flight to the captured collision, emits `projectileBlocked`, and persists
  active-clearance checkpoint inner v2 while preserving exact v1 without clearance. The original
  R13.2 contract is GREEN at 20/20; combined R13.1/R13.2 runtime is GREEN at 27/27; typecheck and
  engine build pass.
- A manual pre-freeze audit then proved a forged-checkpoint gap: v2 could claim a later line cell
  while skipping an immutable earlier blocker. The new regression first failed 1/12 for exactly
  that reason. Validation now rejects an earlier immutable authored blocker while allowing cells
  whose persisted terrain/elevation override may legitimately postdate launch. The regression and
  R13.1 compatibility are GREEN at 27/27; this source change invalidated the earlier gate evidence.

### Surface RED/GREEN and presentation regression

- The isolated R13.2 surface contract began RED at 9/9 for the missing descriptor/checkpoint/event
  metadata, inert clearance recipe, guide v43, Studio optional editor, and shared Canvas/Phaser
  blocked-event projection. It is now GREEN at 9/9; combined R13.1/R13.2 surface compatibility is
  GREEN at 34/34, and Studio/CLI build contracts pass 234/234.
- Manual surface audit proved that the R13.1 projector incorrectly rejected a direct projectile on
  non-zero terrain elevation. A test first failed 1/4 with authoritative altitude `3`; the projector
  now forbids only `maxAltitude` on a direct trajectory and accepts bounded engine altitude. The
  complete 34-test surface matrix, typecheck, build, and plugin build/validate/smoke pass after the
  repair; previous surface gate evidence was invalidated and rerun.

## 2026-07-31 — R13.3 bounded ricochet

### Contract freeze

- Ballistics remains schema v1. Optional global surface catalogs use existing terrain tags and
  mission-active Combat armor type IDs; a tower binding opts into safe-integer `maxBounces` 1..4
  and `rangeCells` 1..256. Terrain surfaces require the same R13.2 clearance tag. No arbitrary
  normals, restitution, attenuation, or code are authored.
- Reflection is topology-owned deterministic backscatter: the incoming canonical edge selects the
  opposite direction, a bounded ray chooses the first occupied tile, and at most 16 enemies there
  are binary-sorted. The reflected root target is fixed for its segment. Any landed packet retains
  the launch amount/source/modifiers and changes only detached target identity before using the
  common resolver.
- Public snapshot remains v1; ricochet-enabled checkpoint state uses inner v3 and emits only a
  read-only `projectileRicocheted` GameEvent. Destructibles, weather, enemy projectiles, commands,
  TowerScript/Graph nodes, homing, and renderer collision remain forbidden scope.

### RED evidence

- Before production, the exact command
  `npx vitest run packages/engine/src/content/r13-ricochet-mechanics.contract.test.ts packages/engine/src/simulation/r13-ricochet-topology.contract.test.ts packages/engine/src/simulation/r13-ricochet-runtime.contract.test.ts --maxWorkers=1`
  proved RED at 18 expected failures / 3 legacy controls passing. The failures cover the absent
  closed schema/normalizer/cross-references, pure topology ray planner, terrain/root/component
  reflection, bounce cap, fixed reflected target, bounded candidate choice, active-only checkpoint
  inner v3, and replay equivalence. `npm run typecheck` remained GREEN and no production source was
  changed before this evidence.

### Engine GREEN and bounded-lookup regression

- The original content/topology/runtime contracts reached GREEN at 21/21; the combined R13.1–R13.3
  engine matrix reached 64/64 with typecheck and engine build passing.
- A manual pre-freeze audit then proved that candidate truncation happened only after a full enemy
  scan for every reflected-ray cell. The new 1,000-enemy regression failed 1/9 with 11,001
  `enemyCoord` inspections against the bounded ceiling of 1,100. Production must build one
  deterministic per-tick spatial lookup and inspect at most 16 binary-ordered candidates per cell
  before R13.3 can return to GREEN; all earlier gate evidence is invalidated.
- The regression is GREEN at 9/9 after moving candidate discovery to a lazy deterministic coord
  index built once on the first terminal reflective collision of a tick. Per-cell rows are sorted
  and capped at 16 once, then reused by all remaining projectiles. Combined R13.1–R13.3 engine
  runtime is GREEN at 41/41; typecheck and engine build pass after the repair.

### Surface RED evidence

- After freezing the additive authoring/presentation contract, the exact command
  `npx vitest run packages/mcp/r13-ricochet-authoring.contract.test.mjs packages/renderer/src/r13-ricochet-presentation.contract.test.mjs packages/studio/public/r13-ricochet-surface.contract.test.mjs --maxWorkers=1 --reporter=dot`
  failed all 10 tests across three files. Expected missing contracts are the checkpoint-v3/event
  descriptor, inert `basic_projectile_ricochet` recipe, guide v44, fail-closed shared event
  projector, Mechanics Hub preservation, and shared Playtest/Canvas/Phaser consumption. Typecheck
  remained GREEN and no production surface changed before this evidence.
- The first surface implementation reached 10/10 GREEN, then manual hostile-data review added a
  separate regression: a nested `terrainTags` accessor was executed by the Studio draft deep clone.
  The regression failed 1/4 with exactly one getter invocation. The imported-project normalizer must
  descriptor-inspect the new nested records and omit an invalid branch without executing it; the
  earlier surface GREEN and build evidence is invalidated until this test passes.

### Surface GREEN

- MCP now exposes the closed terrain/armor surface catalogs, per-tower ricochet binding, checkpoint
  inner v3, `projectileRicocheted`, inert `basic_projectile_ricochet`, and agent guide v44 through
  the existing guarded mechanics transaction only.
- Studio preserves only supported global ricochet catalogs, exposes the recipe in Mechanics Hub,
  and displays authoritative ricochet provenance in Playtest. Canvas and generated Phaser consume
  the same fail-closed shared projector and contain no reflection, collision, or target-selection
  gameplay rules.
- A post-GREEN hostile-input audit added a nested-accessor regression and proved RED at 1/4 in the
  Studio surface file: the initial catalog clone executed an enumerable getter once. The
  normalization now inspects own property descriptors, rejects accessor/symbol/non-boolean
  catalogs and hostile tower bindings without executing them, and copies only closed surface and
  binding records.
- The expanded exact surface command is GREEN at 11/11 across the same three files. `npm run build`
  and the source-generated plugin `build/validate/smoke` pass after the repair. The remaining full
  gates, freeze, and both independent sign-off are still required; R13 as a whole is not Accepted.

## 2026-07-31 — R13.4a destructible environment content and map contract

### Contract freeze and RED evidence

- Ballistics remains module schema v1 and adds only optional
  `projectiles.destructibles.definitions`. A definition is closed own data with required `maxHp`
  and tile `hitRegion { kind, blockerHeight, blocksLineOfSight }`, plus optional Combat
  `armorTypeId` and `onDestroyed { terrainTransitionId }`. Maps add only canonical
  `destructibleObjects[{ id, definitionId, coord }]`; R13.4a contains no runtime damage target,
  collision, LoS behavior, snapshot, checkpoint, event, command, TowerScript, or renderer work.
- Frozen limits are 256 definitions per profile, 4,096 placements per map, 128 UTF-8 bytes per ID,
  max HP 1,000,000,000, blocker height 1,000,000, and one placement per cell. Definitions sort by
  binary ID; placements sort by `(r,q,id)`. Active broken definition/Combat armor/Terraforming
  transition references are errors, while disabled or unselected authored references are warnings.
- The map source contract accepts exactly one top-level or documented Tiled JSON property,
  canonicalizes it during compile, preserves it through project loading and `GridMap` clones, and
  omits the field exactly when absent.
- Before production, the exact command
  `npx vitest run packages/engine/src/content/r13-destructible-environment-mechanics.contract.test.ts packages/engine/src/simulation/r13-destructible-map.contract.test.ts packages/cli/lib/r13-destructible-map-loader.contract.test.mjs --maxWorkers=1 --reporter=dot`
  proved RED at 11 expected failures / 2 legacy controls passing. Missing contracts are the schema
  and limits, hostile-safe definition/placement normalization, reference severity, TMJ compile
  preservation, loader parity, and `GridMap` clone access. `npm run typecheck` remained GREEN and no
  production source changed before this evidence.
- Post-GREEN contract audit found that placement `id` and `definitionId` accepted leading/trailing
  whitespace and embedded ASCII control characters. The focused regression command
  `npx vitest run packages/engine/src/simulation/r13-destructible-map.contract.test.ts packages/cli/lib/r13-destructible-map-loader.contract.test.mjs --maxWorkers=1 --reporter=dot`
  is RED at 32/38: all eight unsafe identifier cases are accepted independently by the engine map
  normalizer, exported CLI normalizer, top-level compile path, and documented Tiled-property compile
  path, while the six existing R13.4a controls remain GREEN. No production source changed for this
  audit evidence.

### GREEN content/map evidence

- Ballistics v1 now owns a closed, deeply frozen destructible definition catalog, while the shared
  grid-map contract owns canonical detached placements. TMJ top-level and Tiled-property authoring,
  compiled maps, project loading, and `GridMap` clones preserve the same `(r,q,id)` ordering and
  omit the optional field exactly when absent. Active cross-reference failures are errors;
  disabled or unselected profiles remain warning-only.
- The identifier regression was repaired only in the shared engine and CLI placement validators:
  both now reject surrounding whitespace and ASCII control characters consistently with the
  Ballistics catalog ID contract. The complete R13.4a focused command is GREEN at 45/45 after the
  repair. Runtime collision, damage, LoS, terrain mutation, events, snapshots and checkpoints
  remain deliberately absent from this slice.

## 2026-07-31 — R13.4b1 pure destructible collision and damage planning

### Contract freeze and RED evidence

- This slice is pure engine groundwork only. It adds an immutable body index, a fixed launch-time
  collision trace, `DamageTargetRef { kind: "map_object", objectId, definitionId }`, and a
  non-mutating map-object damage plan. It does not wire `TowerDefenseGame`, events, snapshots,
  checkpoints, LoS, terrain mutation, destruction settlement, TowerScript, Studio, MCP, renderer,
  or player surfaces.
- The collision contract follows the topology-owned square/hex line, excludes the source and
  includes the target, selects the earliest object independent of body input order, and gives a
  map object priority over a supplied terrain collision at the same cell/time. Direct and arc
  altitude use the existing projectile formula and block at equality; only strictly greater
  altitude clears. The independent ceilings are a 256-cell ray and 1,048,576 cell inspections per
  tick. Indexes and traces are detached, deeply frozen, and reject hostile, sparse, cyclic, or
  duplicate bodies without invoking accessors.
- The damage planner accepts the original projectile `DamagePacket`, delegates arithmetic to
  `DamageResolver`, replaces only its target with the validated map-object identity, and preserves a
  detached packet including source/tags/modifiers. It validates object HP/identity and armor-context
  coherence, never mutates HP, and returns exactly `no_effect`, `nonlethal`, or
  `requires_atomic_destruction`. The final outcome deliberately leaves exactly-once destruction and
  transactional terrain adoption to a later runtime slice.
- Before production, the exact command
  `npx vitest run packages/engine/src/simulation/r13-destructible-collision-damage.contract.test.ts --maxWorkers=1 --reporter=dot`
  proved RED at 10/10. Missing contracts are the independent limits, exported body index and trace,
  `map_object` target validation, and pure damage planner. `npm run typecheck` is GREEN, and no
  production source changed before this evidence.
- The first pure implementation reached GREEN at 10/10. A manual contract audit then found three
  independent trust-boundary gaps: collision-body and damage-state IDs accepted surrounding
  whitespace/ASCII controls; object damage accepted general resolver `resistances`, `legacyArmor`,
  and `marks` despite the b1 armor-matrix-only contract; and caller-supplied terrain provenance was
  trusted without proving its coordinate/time against the topology line. Before any repair, the
  expanded exact command above is RED at 22/32 while all original 10 controls remain GREEN. The 22
  failures comprise eight body-ID cases, eight state-ID cases, three forbidden contexts, and three
  forged terrain collisions (off-ray, source cell, and mismatched elapsed time). `npm run typecheck`
  remains GREEN and no production source changed for this audit evidence.

### GREEN pure collision/damage evidence

- The engine now exports an opaque frozen O(1) collision index, a topology-owned fixed collision
  trace, the additive `map_object` damage target, and a non-mutating DamageResolver-backed plan.
  IDs use the same whitespace/control/UTF-8 policy as the authored catalog and map placements;
  object damage accepts only the matching armor matrix; supplied terrain provenance is proved
  against the source-exclusive ray and deterministic elapsed formula before it can affect priority.
- The expanded b1 contract and base DamageResolver suite are GREEN at 40/40. Typecheck and engine
  build pass. `TowerDefenseGame`, events, snapshot/checkpoint state, LoS, destruction settlement and
  terrain mutation remain absent by contract.

## 2026-07-31 — R13.4b2 pure dynamic destructible line of sight

### Contract freeze and RED evidence

- This is a separate pure foundation after R13.4b1. It adds
  `buildDynamicAuthoredLineOfSightIndexV1` over live
  `{ objectId, definitionId, coord, blockerHeight }` rows and a generalized
  `traceLineOfSightV2`. The index never caches elevation: every trace reads current
  `GridMap.elevationAt`, so a Terraforming runtime elevation projection changes the result without
  rebuilding authored blocker data. There is no `TowerDefenseGame`, event, snapshot, checkpoint,
  LoS-state persistence, Studio, MCP, renderer, or player integration in this slice.
- The generalized tracer accepts the legacy terrain/elevation policy and dynamic index as
  independent optional inputs. It uses the topology-owned square/hex line, ignores source and target
  cells, evaluates the closest cell first, and resolves same-cell blockers in the fixed order
  terrain tag → destructible → elevation. A dynamic object blocks at exact ray-height equality and
  exposes detached provenance with current elevation, object/definition IDs, and blocker height.
  With no dynamic index, the existing `traceLineOfSight` wrapper and result remain exact.
- Index input is canonical and permutation-invariant, accepts exactly 4,096 live blockers, rejects
  4,097, duplicate IDs/cells, sparse/cyclic/hostile inputs and accessors without execution. Existing
  LoS ceilings remain 256 cells per ray and 1,048,576 cell inspections per operation.
- Before production, the exact command
  `npx vitest run packages/engine/src/simulation/r13-dynamic-destructible-los.contract.test.ts --maxWorkers=1 --reporter=dot`
  proved RED at 8/8 because both new pure exports are absent. `npm run typecheck` is GREEN. No
  production source changed before this evidence.
- The first pure implementation reached GREEN at 8/8. A manual policy-boundary audit then proved
  that `traceLineOfSightV2` still applied authored tile elevation when a dynamic index was present
  but the independent legacy terrain/elevation policy was absent. The focused command above is RED
  at exactly 1/11: a high interior tile incorrectly returns `elevation` instead of `clear`. The two
  controls remain GREEN: a zero-height live blocker on that tile returns `destructible`, while an
  explicitly supplied legacy policy with empty terrain tags returns `elevation`. `npm run typecheck`
  remains GREEN and no production source changed for this audit evidence.

### GREEN pure LoS evidence

- The engine now exports a canonical hostile-safe dynamic blocker index and a generalized trace
  that shares one topology walk, reads current effective elevation, and preserves the fixed
  same-cell priority. The legacy tracer remains the exact implementation when no dynamic index is
  supplied.
- A post-GREEN audit proved RED for one policy leak: a dynamic index with no legacy policy still
  activated elevation-only blocking. The regression failed 1/11 while both boundary controls
  passed. Elevation-only blocking now requires the explicit legacy policy; a destructible object
  still uses current cell elevation for its own obstacle top. The expanded b2 contract plus existing
  LoS suite are GREEN at 40/40; typecheck and engine build pass. No live game wiring or persistence
  is part of b2.

## 2026-07-31 — R13.4c2 internal persistent terrain transaction kernel

### Contract freeze and RED evidence

- R13.4c2 extracts only an internal opaque `preparePersistentTerrainTransaction` /
  `adoptPersistentTerrainTransaction` kernel. It is not exported from the engine index and does not
  import or reference projectile/destructible runtime code. Prepare is mutation-free; the first
  adopt exposes one complete precomputed publication through a single callback and returns
  `{adopted:true}`; repeated or foreign adoption is a no-throw no-op returning `{adopted:false}`.
- The kernel preserves existing authored-order terrain semantics: transitions and source tags,
  direct terrain IDs, restore and previous-override restoration, sources, legacy timed ownership,
  the 512 override cap, and stable ordered events. Authored routes distinguish baseline breakage
  from an unrepaired candidate and allow repair. Dynamic flow invokes one proof callback during
  prepare, never during adopt; a failed proof mutates nothing. Effective no-op skips proof and
  publishes empty changes.
- Before production, the exact command
  `npx vitest run packages/engine/src/simulation/persistent-terrain-transaction.test.ts --maxWorkers=1 --reporter=dot`
  proved RED at 7 failures / 1 internal-boundary control passing because the direct internal module
  and both kernel functions are absent. `npm run typecheck` is GREEN. No production,
  `TowerDefenseGame`, projectile, or destructible source changed before this evidence.

### GREEN internal transaction evidence

- The internal module now prepares a detached frozen terrain candidate without touching the map or
  live overrides, preserves authored operation/event order, enforces transition/source/ownership/
  override and route-safety failures, and runs a dynamic navigation proof exactly once during
  prepare. The first adoption publishes the complete precomputed value and returns
  `{adopted:true}`; repeated or foreign adoption does not invoke the callback and returns
  `{adopted:false}`.
- The focused R13.4c2 contract is GREEN at 8/8. The module remains absent from the engine index,
  imports no projectile/destructible runtime, and does not wire `TowerDefenseGame`, events,
  snapshots, checkpoints, collision, or terrain mutation.
- A post-GREEN compatibility audit added two regressions before repair: authored-route safety must
  include the spawn/core endpoints exactly like the existing runtime, and publication events must
  be sorted by their stable authored `order` even when internal operation input is permuted. The
  expanded focused command is RED at 2/10 while the original eight controls remain GREEN; no
  production source changed for this audit evidence.
- The compatibility regressions are repaired by checking every authored route coordinate and by
  sorting the detached publication events by authored order. The expanded focused contract is
  GREEN at 10/10; the internal/public and ballistics/destructible boundaries remain unchanged.

## 2026-07-31 — R13.4c3 authoritative destructible runtime integration

### Contract freeze and RED evidence

- This slice wires only already-authored Ballistics v1 destructibles into the public
  `TowerDefenseGame` runtime. Active state is nested under Ballistics snapshot v2 and checkpoint
  v4 with a destructibles schema v1 section; disabled, unselected and absent Ballistics retain the
  exact legacy shape. Project, command, journal and outer checkpoint versions do not change.
- A fixed launch-time map-object collision redirects the existing `DamagePacket` away from the
  original enemy. Nonlethal damage settles once. Lethal damage and an optional persistent terrain
  transition form one atomic transaction: successful publication orders damage, terrain and
  destruction events; failed reachability rolls back HP, destroyed state, terrain and events.
  Destroyed objects no longer participate in later collision. Reset restores authored HP/terrain.
- Checkpoint rows are complete, canonical and hostile-safe: future nested versions, duplicate or
  unknown IDs, missing authored rows, out-of-range HP and incoherent HP/destroyed pairs are rejected
  before restore. Continuous execution, checkpoint resume and command-journal replay must produce
  the same state digest and snapshot.
- Scope exclusions are dynamic LoS, ricochet/surface changes, TowerScript events/actions, Studio,
  renderers and new debug APIs. The contract uses only public `TowerDefenseGame`, checkpoint and
  journal APIs plus fixture builders.
- Before production, the exact command
  `npx vitest run packages/engine/src/simulation/r13-destructible-runtime.contract.test.ts --maxWorkers=1 --reporter=dot`
  proved RED at 6/6: the current runtime still publishes Ballistics snapshot v1/checkpoint v1 and
  has no authoritative destructible state, collision damage, atomic destruction or restore/reset
  contract. `npm run typecheck` is GREEN. No production source changed before this evidence.

### Post-GREEN adversarial audit RED evidence

- After the original six c3 contracts reached GREEN, three compact regressions audited only fixed
  collision timing, canonical checkpoint order and hostile nested rows. The stored collision for
  the fixture ray `q0 → q4` through `q2` records `elapsedUnits: 0.2`; settlement must occur at that
  time rather than waiting for the full `0.4` target travel time. Destructible checkpoint rows must
  be strictly binary-ordered by object ID, just like projectile rows. Sparse arrays and accessor-
  backed rows/fields must be rejected without invoking a getter.
- The exact focused command above is RED at 2 failures / 7 passes: all original six controls and
  the hostile nested-row regression remain GREEN, while collision still settles at full travel
  time (`hp 50` instead of `30` at `0.2`) and a valid reversed `gate_2, gate_1` checkpoint is
  accepted. `npm run typecheck` remains GREEN. No production source changed for this audit.
- After the elapsed-time repair, the shared test `impact()` helper was aligned to advance exactly
  one `0.2` tick: that is now the authoritative collision boundary for the fixture. A second public
  tick would correctly clear `lastEvents` and would make the event-order assertions observe the
  wrong transaction boundary. The later unobstructed enemy projectile still advances its authored
  full `0.4` travel time explicitly. The focused c3 contract is GREEN at 9/9 and typecheck passes;
  no production or exactly-once expectation changed during this test alignment.

### Final ownership and elevation boundary RED evidence

- Two final c3 regressions exercise boundaries already owned by native Terraforming. A lethal
  destructible transition must not overwrite a terrain cell owned by
  `pendingTerraformExpiryGroups`; the projectile is consumed while object HP/destroyed state,
  effective terrain and destructible/terrain events remain unchanged. Separately, an in-flight
  fixed collision launched against an active runtime elevation override must persist that effective
  `blockerElevation` and round-trip through checkpoint restore.
- The exact focused command is RED at 2 failures / 9 passes. All previous nine controls remain
  GREEN. The current runtime destroys the timed-owned object (`hp 0`, `destroyed:true`) and its
  checkpoint validator compares collision elevation only with authored base elevation, rejecting
  the valid runtime-elevation checkpoint as incoherent. `npm run typecheck` is GREEN. The fixtures
  use a narrow runtime-internals cast solely to construct otherwise valid native state; no
  production source, timed expiry semantics or elevation validation was weakened.

### Reflected-segment destructible integration RED evidence

- A compact ricochet regression requires every newly created reflected segment to run the same
  bounded destructible trace as an initial launch. The authored gate at the reflected target
  `q5,r1` is temporarily destroyed for the inbound segment and restored to a valid live runtime
  state before the terrain bounce; this is necessary because the square-grid reflection retraces
  the inbound ray. After the bounce, the fixed checkpoint projectile must carry
  `destructibleCollision`; impact damages the gate from 50 to 30 exactly once and leaves the enemy
  at 100 HP.
- The combined focused command for ricochet plus c3 is RED at 1 failure / 20 passes. All 11 c3
  controls and the previous nine ricochet controls remain GREEN. The reflected projectile has the
  canonical `q4 → q5` segment but lacks `destructibleCollision`, proving that `reflectProjectile`
  does not trace the new segment. `npm run typecheck` is GREEN. Only the test fixture and this
  evidence changed; production remains untouched.

### C3/C4 fixture dependency alignment

- Once c4 made authored `blocksLineOfSight:true` authoritative, the c3 gate between its tower and
  enemy correctly prevented target acquisition and therefore projectile launch. C3 explicitly
  excludes dynamic LoS and tests collision plus atomic persistence, so its fixture now authors
  `blocksLineOfSight:false`; blocker height and every collision/destruction assertion are unchanged.
- The combined c3, c4 runtime and ricochet focused suites are GREEN at 27/27, and typecheck passes.
  This is a test dependency alignment only; production behavior and c4 LoS coverage are unchanged.

## 2026-07-31 — R13.4d1 guarded destructible authoring and MCP

### Contract freeze and RED evidence

- D1 adds one narrow authoring transaction over exactly five owned sources: `project.json`,
  `content/mechanics.json`, `content/balance.json`, the selected `maps/src/<mapId>.tmj`, and
  `maps/compiled/maps.json`. Preview is write-free and returns the complete validated candidate;
  apply requires its composite revision, creates a five-file backup and rolls back already-replaced
  owned files on failure. Existing loader, map compiler and project validation remain canonical.
- The request carries one Ballistics v1 profile plus exact map placements and mission/map IDs.
  Definition references, bounds and confined map IDs are validated before writes. The
  `basic_destructible_environment` recipe may bind existing project mission/map IDs, but remains
  inert: it writes nothing, contains no `enabled` flag and supplies no placement or coordinate.
- MCP exposes only `preview_destructible_environment` and `apply_destructible_environment` with
  compute-only/write-local metadata, closed schemas, revision/backup/rollback guidance and the
  existing `validate_project` follow-up. No broad destructible writer, TowerScript action or
  surface-owned collision/damage/LoS/terrain rule is introduced. Source CLI/MCP/guide files must be
  byte-identical to the generated plugin runtime.
- Before production, the exact command
  `npx vitest run packages/cli/lib/r13-destructible-environment-authoring.contract.test.mjs packages/mcp/r13-destructible-environment-authoring.contract.test.mjs --maxWorkers=1 --reporter=dot`
  proved RED at 8/8: the narrow CLI module and tools are absent, the recipe is unknown, the schema
  lacks placement/transaction descriptors, the guide remains v44, and the new source/plugin file
  is absent. `npm run typecheck` is GREEN. Studio, renderer, package, documentation fixture and all
  production sources remain outside this RED slice.

### Engine ruling for placement-inert recipes

- A Ballistics v1 profile with `projectiles.towers:{}` is structurally and semantically valid only
  when it also contains a non-empty valid destructible definition catalog. This lets the guarded
  recipe author definitions before an explicit map placement without inventing a tower binding.
  A profile with empty towers and no destructibles remains invalid, preserving the pre-R13.4 empty
  profile guard.
- The focused content command
  `npx vitest run packages/engine/src/content/r13-destructible-environment-mechanics.contract.test.ts --maxWorkers=1 --reporter=dot`
  is RED at 1 failure / 8 passes: the new inert-profile case is rejected by the unconditional empty
  towers guard, while the explicit empty-profile control and all prior destructible content
  contracts remain GREEN. `npm run typecheck` is GREEN. Production is untouched.

### GREEN guarded authoring and plugin parity evidence

- Ballistics v1 normalization now accepts `projectiles.towers:{}` only after a valid non-empty
  destructible definition catalog has normalized; the same empty tower catalog without
  destructibles remains rejected. The focused destructible content contract is GREEN at 9/9, and
  `npm run typecheck` plus `npm run build:engine` are GREEN.
- The source CLI now owns the exact five-file preview/apply transaction using the existing
  mechanics authoring, map compiler, project normalization and content validation primitives.
  Preview is write-free; apply rejects stale revisions, backs up all five owned paths, validates
  the combined candidate and restores original bytes after an injected partial replacement
  failure. The inert `basic_destructible_environment` recipe binds the selected mission/map but
  creates no placement and activates no capability.
- MCP now exposes the two narrow tools with closed schemas and compute-only/write-local metadata,
  publishes Ballistics checkpoint schema v4 plus destructible placement/transaction/event
  descriptors, and teaches the guarded workflow in agent guide v45. The exact CLI+MCP contract is
  GREEN at 8/8. `npm run plugin:build` regenerated the mirror from source; source-to-plugin parity,
  `npm run plugin:validate` and `npm run plugin:smoke` are GREEN. No Studio, renderer, gameplay or
  TowerScript authoring surface was added in this slice.
- The final focused mechanics/map/recipe/MCP regression batch is GREEN at 107/107 across 12 files,
  including the additive R13.2/R13.3 descriptor and guide alignment. Final `npm run typecheck`,
  `npm run build:engine` and source diff checks are GREEN on the same working source.

### R13 authoring descriptor dependency alignment

- C3 added Ballistics checkpoint inner schema v4 without removing v1-v3, so the additive R13.2 arc
  clearance and R13.3 ricochet MCP assertions now accept `[1,2,3,4]`. D1 advances the shared agent
  guide from v44 to v45, so the prior ricochet guide assertion follows that exact version. No other
  clearance, ricochet, recipe, workflow or exclusion expectation changed.
- The combined arc-clearance, ricochet and destructible-environment MCP suites are GREEN at 11/11;
  typecheck passes. This is test dependency alignment only, with no production change.

### Post-GREEN hostile-input and revision-closure RED evidence

- Two compact CLI regressions freeze the remaining d1 trust boundaries. Preview must reject
  accessor-bearing, proxy and non-plain request objects as unsafe own-data without invoking a
  getter/trap or changing any owned byte. The composite preview revision must cover every raw map
  source consumed by `compileMapSources`, not only the selected placement source, so a later change
  to an otherwise valid second source makes guarded apply conflict before any write.
- The exact command
  `npx vitest run packages/cli/lib/r13-destructible-environment-authoring.contract.test.mjs --maxWorkers=1 --reporter=verbose`
  is RED at 2 failures / 4 controls passing. The hostile accessor currently executes and rejects
  with `HOSTILE_REQUEST_GETTER`; changing `maps/src/other.tmj` after preview leaves the revision
  unchanged and guarded apply incorrectly returns `ok:true, written:true` instead of a no-write
  conflict. The original preview, apply/rollback, malformed-reference/traversal and inert-recipe
  contracts remain GREEN. `npm run typecheck` is GREEN. This audit changed only the focused CLI
  contract and this evidence; production source remains untouched.

### Post-GREEN audit repair evidence

- The CLI now inspects the complete request as detached ordinary own-data before any request value
  is read. Prototype and property descriptors are obtained inside the guarded inspection; Proxy,
  accessors, symbols, non-enumerable/extra array properties, custom prototypes, sparse/cyclic data
  and inspection-budget overflow fail closed as structured `input_unsafe` validation. No hostile
  accessor or Proxy `get` trap executes, and downstream validators receive detached plain records.
- Composite revision input is now the binary-sorted union of the exact five transaction files and
  every raw `maps/src/*.tmj` byte represented in the map-source set consumed by
  `compileMapSources`. Candidate writes and backups remain exactly the selected five owned files;
  changing a sibling map source after preview returns a no-write revision conflict.
- The repaired CLI contract is GREEN at 6/6. The focused mechanics/map/recipe/MCP regression batch
  is GREEN at 109/109 across 12 files after `npm run plugin:build`; direct CLI source/plugin parity,
  `npm run plugin:validate`, `npm run plugin:smoke`, `npm run typecheck` and source diff checks are
  GREEN.

### GREEN authoritative runtime evidence

- Active Ballistics destructibles now initialize complete authored runtime rows, publish snapshot
  v2/checkpoint v4 only when selected, and retain fixed launch collision provenance through
  checkpoint restore and command-journal replay. Damage is planned through the common
  `DamageResolver`; nonlethal settlement is single-shot, while lethal HP/destruction and the
  optional persistent terrain transition are committed together only after reachability succeeds.
  Failed terrain preparation consumes the projectile without mutating the object, enemy, terrain,
  overrides, or events. Destroyed objects are removed from future launch collision and reset
  restores authored object HP and terrain.
- The frozen R13.4c3 contract is GREEN at 6/6. The focused regression batch covering projectile
  foundation, ricochet runtime/topology, checkpoint, the persistent terrain transaction kernel,
  Terraforming runtime/path-water/dynamic/duration/checkpoint, and Ballistics/Ricochet content is
  GREEN at 220/220 across 13 files. Dynamic LoS, surfaces, TowerScript/Graph and outer project,
  command, journal and checkpoint versions remain unchanged.
- The adversarial timing/order repair now uses the stored destructible collision `elapsedUnits` as
  the projectile terminal time and rejects restored projectiles that have advanced beyond it.
  Complete destructible checkpoint rows additionally require strict binary object-ID order. The
  aligned focused contract is GREEN at 9/9; the same 13-file regression batch is GREEN at 223/223.
  `npm run typecheck` and `npm run build:engine` are GREEN on the repaired source.
- Two boundary regressions now preserve ownership and launch provenance: lethal destruction does
  not prepare or publish an `onDestroyed` terrain transition while a native timed terrain group
  owns that cell, and checkpoint restore accepts the stored finite blocker elevation for a cell
  carrying an active runtime elevation mutation while immutable cells still require authored
  elevation equality. The focused c3 contract is GREEN at 11/11 and the 13-file regression batch
  is GREEN at 225/225; typecheck and the engine build remain GREEN.
- Reflected ricochet segments now run the same live destructible trace and per-tick inspection
  accounting as initial launch, combine terrain/object terminal collisions with the same stable
  priority, and replace rather than retain the previous segment's terminal provenance. Exhausted
  clearance or destructible budget rejects the reflection before publishing its event/state. The
  focused ricochet+c3 pair is GREEN at 21/21 and the 13-file regression batch is GREEN at 226/226;
  typecheck and the engine build remain GREEN.

## 2026-07-31 — R13.4c4 live dynamic destructible LoS wiring

### Contract freeze and RED evidence

- This slice derives an immutable dynamic LoS index only from active, live Ballistics
  destructibles whose authored hit region has `blocksLineOfSight:true`. Tower acquisition uses the
  generalized engine trace even when Elevation LoS is absent; `single` and the direct `pulse`
  consumer share the same visibility decision. Destroyed objects are excluded after checkpoint
  restore, while objects with the flag disabled remain collision-capable but do not block LoS.
- Compute-only diagnostics retain the exact legacy schema v1 path when only Elevation LoS is
  active. Active dynamic blockers use schema v2 with Ballistics profile identity and stable
  object/definition/height provenance. The index is derived from the existing Ballistics v4
  checkpoint state and is not persisted; no renderer, Studio, MCP, event, command, journal,
  snapshot or checkpoint shape changes are part of c4.
- Before production, the exact command
  `npx vitest run packages/engine/src/simulation/r13-dynamic-destructible-los-runtime.contract.test.ts --maxWorkers=1 --reporter=dot`
  proved RED at 5 failures / 1 compatibility control passing. Square and hex single acquisition,
  the shared single/pulse gateway, live-versus-destroyed blockage, dynamic diagnostic provenance,
  and checkpoint-derived targeting all fail because the live runtime does not yet build or route
  through the dynamic index. The `blocksLineOfSight:false` compatibility control passes.
  `npm run typecheck` is GREEN. This Contract/Test Designer changed only the new focused test and
  this evidence; production source remained untouched for the RED proof.

### GREEN live dynamic LoS evidence

- The runtime now rebuilds one derived immutable LoS index alongside the live destructible
  collision index, including only non-destroyed objects whose authored hit region enables LoS
  blocking. It is reconstructed after initialization, reset, checkpoint restore and destruction;
  no LoS index or result is added to snapshots or checkpoints.
- Existing single/sniper/splash/antiair/pipeline acquisition and the direct pulse consumer share
  the generalized trace whenever a live dynamic index exists. When only Elevation LoS is active,
  targeting and diagnostics retain the direct legacy trace/analyzer path and exact schema v1
  result. Dynamic diagnostics publish compute-only schema v2 Ballistics provenance.
- The focused c4 contract is GREEN at 6/6. After the collision-only c3 fixture explicitly disabled
  LoS blocking per its frozen scope exclusion, the c4/pure-LoS/legacy-LoS/consumer/high-ground/c3
  regression matrix is GREEN at 101/101 across six files. `npm run typecheck` and
  `npm run build:engine` are GREEN.
- A boundary regression separated authored dynamic-LoS capability from the current live blocker
  count. A selected destructible profile with at least one authored blocking placement now retains
  an empty derived index after every such object is destroyed, so compute-only diagnostics remain
  schema v2 and report a clear row. Projects with no authored blocking placement keep the exact
  undefined/legacy fast path. The focused c4 contract is GREEN at 7/7 and the same six-file matrix
  is GREEN at 102/102; typecheck and the engine build remain GREEN.

### Post-GREEN empty-live-index diagnostic RED evidence

- One regression freezes the capability/runtime distinction after checkpoint restore. When the
  authored Ballistics destructible LoS capability remains selected but every authored blocker is
  destroyed, the derived index is empty rather than inactive: compute-only analysis must remain
  schema v2 with `profiles.ballistics`, return a visible `clear` row, and still persist no LoS
  index in the checkpoint.
- The exact focused c4 command is RED at 1 failure / 6 controls passing. The restored game returns
  `undefined` because the current runtime drops the derived index when there are no live blockers;
  all prior square/hex targeting, shared gateway, false-flag, live/destroyed, provenance and restore
  controls remain GREEN. `npm run typecheck` is GREEN. Only the focused contract and this evidence
  changed; production source remained untouched for this post-GREEN RED proof.

## 2026-07-31 — R13.4d2 Studio Destructibles Hub RED contract

- The Studio contract freezes one separate Destructibles section inside Mechanics Hub. It authors
  every closed v1 definition field, binds an explicit authored map and exact placement IDs/tile
  coordinates, and never moves those fields into ordinary tower or mission forms. Preview and apply
  must use the narrow d1 destructible-environment routes with one detached request and the exact
  preview revision; generic mechanics writes are forbidden for this five-file boundary.
- The same contract requires reload after writes, explicit disable/re-enable without discarding the
  profile or placements, and lossless read-only handling of future Ballistics module data. The
  Studio/server surface may delegate to the d1 tools but must not import simulation, collision,
  DamageResolver, topology, map compilation or persistent terrain transaction rules.
- Before production, the exact focused command
  `npx vitest run packages/studio/public/r13-destructible-environment-surface.contract.test.mjs --maxWorkers=1 --reporter=dot`
  is RED at 6/6 expected failures: the section IDs, definition/placement editor, narrow lifecycle
  functions and Studio routes do not exist yet. The adjacent static R13 command covering
  Ballistics foundation, arc clearance, ricochet and this new contract reports 11/11 existing
  controls GREEN and only the same six d2 failures. This Contract/Test Designer changed only the
  new public contract and this evidence; Studio/server production, renderer and packaging remain
  untouched.

### GREEN Studio and server evidence

- Mechanics Hub now contains one dedicated Destructibles editor for the complete closed v1
  definition fields and explicit authored-map placements. Its detached draft remains separate from
  ordinary project dirtiness and tower/mission editors. Future Ballistics versions retain their
  loaded profile losslessly and expose the dedicated controls read-only.
- Preview and apply capture one detached request and use only
  `/api/mechanics/destructibles/preview` plus `/api/mechanics/destructibles/apply` with the preview
  revision. Disable submits the same profile and placements, then reload/re-enable restores the
  authored candidate. The two Studio server routes delegate to the d1 MCP/CLI tools, require the
  apply revision and sanitize filesystem/backup details before returning browser data; no gameplay,
  renderer, topology, collision or map-compiler implementation is imported into the surface.
- The exact d2 contract is GREEN at 6/6. Adjacent Ballistics/arc/ricochet/d2 static and Studio
  server suites are GREEN at 37/37, and the AI server suite is GREEN at 7/7. `npm run build` and
  `npm run typecheck` pass. Full Playwright reached 137/138 with one pre-existing Heroes
  skill-effect timing failure; its isolated rerun is GREEN at 1/1, so no out-of-scope Heroes source
  was changed.

## 2026-07-31 — R13.4d3a shared renderer and opt-in Juice RED contract

- One pure `projectDestructibleEnvironmentPresentation` contract consumes only active Ballistics
  snapshot v2/destructibles v1 state and returns detached deeply frozen rows in binary object-ID
  order. Absent/legacy/future, malformed HP coherence, accessor/proxy, sparse, duplicate and more
  than 4,096 rows fail closed to the one inactive shape without executing authored traps. Canvas
  and generated Phaser must consume this shared projection; the projector imports no simulation,
  collision, navigation, LoS, terrain-transition or targeting rules.
- Procedural Juice remains independently opt-in. `destructibleObjectDamaged` and
  `destructibleObjectDestroyed` can produce cues only through exact authored event bindings, with
  the presentation origin taken from the authoritative `event.coord`. A valid catalog without a
  matching binding remains active but emits no particle, audio or camera instruction.
- Before renderer production, the exact command
  `npx vitest run packages/renderer/src/r13-destructible-environment-presentation.contract.test.mjs packages/renderer/src/procedural-juice-presentation.contract.test.mjs packages/renderer/src/ballistics-presentation.contract.test.mjs packages/renderer/src/r13-arc-clearance-presentation.contract.test.mjs packages/renderer/src/r13-ricochet-presentation.contract.test.mjs --maxWorkers=1 --reporter=verbose`
  is RED at 6 failures / 22 controls passing. Five failures identify the absent pure projector,
  source export and Canvas/Phaser adapters; the sixth returns inactive because the two authored
  destructible event types are not yet allowlisted. The new no-binding control and all existing
  R11/R13 renderer controls remain GREEN. `npm run typecheck` is GREEN. Only the two renderer
  contracts and this evidence changed; renderer/CLI production, Studio, packages and docs remain
  untouched.

### GREEN shared presentation evidence

- The renderer now exports one pure fail-closed destructible-environment projector. It accepts
  only Ballistics snapshot v2/destructibles v1, validates the complete closed object/coordinate
  own-data shape, HP/destroyed coherence, duplicate IDs and the 4,096-row budget, then returns
  detached deeply frozen rows in binary object-ID order. Hostile, accessor, sparse, malformed,
  legacy and future inputs return the single inactive presentation without executing traps.
- Canvas and generated Phaser consume that same projector and draw only its presentation rows;
  neither adapter derives collision, damage, navigation, LoS, terrain mutation or targeting.
  Procedural Juice adds only the two destructible event IDs to its shared validation/presentation
  allowlist. Cues remain authored-binding driven and use authoritative `event.coord`; a catalog
  without a matching binding emits no automatic debris, particle, audio or camera instruction.
- The exact focused R13/R11 renderer command is GREEN at 28/28. The adjacent renderer, player
  template and Procedural Juice schema/authoring batch is GREEN at 93/93 across 11 files.
  `npm run build`, `npm run plugin:build`, `npm run plugin:validate` and
  `npm run plugin:smoke` are GREEN; generated plugin renderer parity comes only from the source
  build workflow. Full Playwright is GREEN at 138/138; direct source/plugin byte parity for the
  projector, renderer entrypoint, Juice projector, build template and visuals schema plus source
  diff checks also pass.

### Post-GREEN destructible presentation identifier RED evidence

- One compact malformed-state regression aligns presentation IDs with the engine/map 128-byte
  safe-ID policy: both `objectId` and `definitionId` must reject leading/trailing whitespace and
  embedded ASCII newline/NUL characters, returning the single inactive projection.
- The exact command
  `npx vitest run packages/renderer/src/r13-destructible-environment-presentation.contract.test.mjs --maxWorkers=1 --reporter=verbose`
  is RED at 1 failure / 5 controls passing. The current projector accepts the first hostile value,
  `objectId:" gate_1"`, and returns an active row; all canonical/frozen, malformed-state,
  accessor/proxy/sparse/duplicate, over-budget and Canvas/Phaser boundary controls remain GREEN.
  `npm run typecheck` is GREEN. Only the focused renderer contract and this evidence changed;
  production remains untouched for this audit proof.

### Post-GREEN destructible presentation identifier GREEN evidence

- The shared renderer projector now enforces the engine/map safe-ID boundary before creating any
  presentation row: identifiers must already be trimmed and cannot contain ASCII control
  characters. Invalid `objectId` or `definitionId` values therefore fail closed without leaking a
  partially active destructible presentation into Canvas or Phaser.
- The exact focused command
  `npx vitest run packages/renderer/src/r13-destructible-environment-presentation.contract.test.mjs --maxWorkers=1 --reporter=dot`
  is GREEN at 6/6, including whitespace, newline and NUL regressions.

## 2026-07-31 — R13.4d3b generated packages, fixture and docs RED contract

- One static package contract freezes the generated-player integration without running a build in
  RED. Canvas must consume the shared presentation-only adapter through the renderer, while Phaser
  imports and consumes the same projector directly; the composed paths cover Canvas/Phaser ×
  hex/square. The adapter may read only snapshot presentation data and may not import or reproduce
  DamageResolver, simulation, collision, navigation, LoS, terrain-transition or targeting rules.
- Runtime presentation remains inactive for absent/disabled/unselected state, while authored
  mechanics continue through the existing PWA, single-file, portable web and `.tdpack` carriers.
  The canonical starter source must remain free of mechanics/destructible placement data. A new
  `docs/examples/opt-in-destructible-environment` fixture freezes the intentionally empty tower
  binding plus one `basic_crate` definition/placement and the
  `basic_destructible_environment` mission selection.
- Documentation must record R13.4 snapshot Ballistics v2 and checkpoint Ballistics v4 domains, both
  destructible events, the narrow `preview_destructible_environment` → guarded
  `apply_destructible_environment` five-file backup/rollback workflow, package matrix and exact
  legacy/TowerScript/broad-write exclusions.
- Before package/docs production, the exact command
  `npx vitest run packages/cli/build.r13-destructible-environment-package-docs.contract.test.mjs --maxWorkers=1 --reporter=verbose`
  is RED at 3 expected failures / 1 starter compatibility control passing across four cases. The
  failures identify the missing shared projector/package wiring and absent opt-in
  fixture/documentation; the untouched starter control is GREEN. Full builds were intentionally
  deferred to final gates. This
  Contract/Test Designer changed only the focused static contract and this evidence; renderer,
  CLI/package, fixture and documentation production remained untouched for the RED proof.

### GREEN package, fixture and documentation evidence

- The frozen four-case d3b contract is GREEN at 4/4. The Canvas/Phaser × hex/square shared
  projector and active-only package carriers were already complete in d3a, so d3b required no
  production source change. The canonical starter project data remains free of R13.4 mechanics and
  destructible placements; only generated package output was refreshed by the package smoke.
- `docs/examples/opt-in-destructible-environment` now provides the complete inert-capable reference:
  one `basic_destructible_environment` Ballistics profile with empty tower projectile bindings, one
  bounded `basic_crate` definition, one explicit map placement and the matching mission selection.
- ROADMAP, runbook and ADR 0054 now freeze Ballistics snapshot v2, checkpoint inner v4, both
  destructible events, the narrow `preview_destructible_environment` → guarded
  `apply_destructible_environment` five-file transaction, backup/rollback semantics, Canvas/Phaser
  and PWA/single-file/web-package/`.tdpack` carriers, and absent/disabled/unselected legacy
  behavior. They also state the TowerScript/Visual Graph and broad-write exclusions.
- The package/docs plus packaging/templates/`.tdpack` static regression batch is GREEN at 19/19
  across four files. `npm run build`, `npm run package:web`, `npm run validate` and
  `npm run sim tutorial_01 60` are GREEN. Plugin gates were not repeated because this d3b slice
  changes no source or plugin input; the exact d3a source-to-plugin parity evidence remains valid.

## 2026-07-31 — R13.5a Weather v1 frozen architecture contract

- **Capability boundary.** Weather is a new independent `weather` mechanics module, schema v1,
  selected only by `mission.mechanics.profiles.weather`. The closed profile is
  `{ zones, definitions, schedule }`; it has no Ballistics, Elevation, Terraforming, Procedural
  Juice or Combat dependency. `MECHANICS_MODULE_IDS`, implemented capabilities, validation and the
  shared descriptor gain `weather`, while the catalog remains schema v1. Structural validation is
  safe for disabled data; map bounds and definition/zone references are semantic enable/preview
  errors. Missing, disabled, unselected, missing-profile and future-version modules are inert.
- **Zones and weather definitions.** `zones` is a record of stable zone IDs. A zone is exactly
  `{ kind:"all_map" }` or `{ kind:"tiles", tiles:[{q,r}, ...] }`; tile lists are dense, unique,
  detached and canonicalized by `(q,r)`, and selected tiles must exist on the mission map.
  `definitions` maps weather IDs to `{ label, effects }`, where `effects` is a binary-ID-ordered
  record of the following closed union only:
  `{kind:"periodic_damage",target:"enemies",amount,intervalUnits,damageType?}`,
  `{kind:"status",target:"enemies",intervalUnits,status:StatusEffectSpec}`,
  `{kind:"visibility_range",multiplier}`, `{kind:"enemy_speed",multiplier}`, or
  `{kind:"tower_fire_rate",multiplier}`. One definition may contain at most one of each scalar
  multiplier kind; periodic effects may coexist. The first periodic application is one complete
  interval after activation. Enemy membership uses its authoritative current tile; tower spatial
  multipliers use the tower anchor tile. Damage uses a typed weather `DamagePacket` source and the
  existing resolver/exactly-once kill and reward path; status uses the existing merge/expiry rules.
- **Seeded schedule.** `schedule` is exactly `{ calmWeight, choices }`, where each choice record is
  `{ weatherId, zoneId, weight }`. For every authored wave, binary-sorted choices plus the optional
  calm weight produce zero or one selection; weather starts with the wave, ends when that wave is
  cleared, and never overlaps another occurrence. With typed root-seed payload `p`, the exact
  length-prefixed RNG domain is
  `towerforge:weather:v1|<s|n>:<p.length>:<p>|m:<missionId.length>:<missionId>`; it is wholly
  separate from simulation, draft, artifact, quest and future weather-effect RNG. Reordering
  choices, zones, definitions or other content records cannot change the schedule; `Math.random`
  and wall-clock time are forbidden.
- **Public pure surface.** The engine exports `WEATHER_LIMITS`, `WEATHER_MECHANICS_SCHEMA`,
  `WeatherProfileValidationError`, `normalizeWeatherProfileV1`, `resolveActiveWeatherMechanics`,
  `createWeatherScheduleV1(profile,{seed,missionId,waveCount})`,
  `createWeatherRuntimeV1(schedule)` and
  `advanceWeatherRuntimeV1(profile,schedule,runtime,{waveIndex,elapsedUnits,waveActive})`.
  Profile and schedule remain explicit immutable own-data inputs; there is no hidden runtime plan or
  closure. Pure advance returns detached transition and due-effect facts only; `TowerDefenseGame`
  owns entity lookup, DamageResolver/status application and event publication.
- **Budgets.** V1 permits at most 64 zones, 4,096 tiles per zone / 16,384 across the profile,
  64 definitions, 16 effects per definition / 512 total, 256 schedule choices, 4,096 scheduled
  waves, 128 UTF-8 bytes per ID and 256 per label. Weights are integers `0..1,000,000` with a
  positive total not exceeding `2^32-1`; `intervalUnits` is finite in `(0,1e9]`, damage in
  `[0,1e12]`, and multipliers in `[0.05,20]`. One tick may inspect at most 16,384 zone targets and
  apply at most 4,096 periodic effects/DamagePackets; exhaustion emits one bounded diagnostic and
  stops remaining weather work for that tick without partial reapplication.
- **Active runtime domains.** An active capability alone adds `snapshot.weather` schema v1 with
  `profileId`, the current occurrence or `null`, canonical zone scope and wave-relative elapsed
  time. Optional checkpoint `state.weather` schema v1 stores profile provenance, weather RNG
  initial/current state, active choice/wave/elapsed state and periodic cursors. Lifecycle/effect
  events are `weatherStarted`, `weatherEnded`, `weatherEffectApplied` and
  `weatherBudgetExceeded`; all carry stable profile/weather/zone/choice/effect provenance as
  applicable and exist only while Weather is active. Reset restores the initial schedule and
  clears transient state. `GameCheckpointV1`, `towerforge-sim-v2`, project v3, map format,
  commands/journal, profile, multiplayer, Ballistics and TowerScript version domains do not bump.
- **Acceptance.** RED must cover closed own-data validation (accessor/proxy/sparse/cyclic/future
  and over-budget), zone bounds/cross-references, seed and input-order invariance, calm selection,
  wave start/clear transitions, periodic boundaries, all five effect kinds, budget exhaustion and
  `Math.random` isolation. Runtime acceptance requires absent/disabled/unselected exact legacy
  snapshots/checkpoints and no tick/RNG overhead; continuous = checkpoint restore = journal replay
  digest; exact-once damage/death/reward/status settlement; reset cleanup; and equivalent
  hex/square zone membership. Weather recipes, Studio/MCP, Canvas/Phaser and package carriers are
  later surface slices, not part of the pure runtime RED/GREEN slice.
- **Forbidden scope.** R13.5 does not add 3D fluid/particle physics, moving or overlapping zones,
  arbitrary expressions/scripts, host APIs, JavaScript/eval, per-entity RNG, weather-authored
  terrain mutation, homing/ballistic coupling, new statuses, TowerScript actions/events, Visual
  Graph nodes, renderer-owned membership/modifiers, broad MCP writes or automatic Juice cues.
  Blizzard, Acid Rain and Sandstorm remain disabled recipes until the authoring/surface slice.

### R13.5a pure Weather RED evidence

- A separate six-case pure contract freezes canonical detached profile normalization, hostile
  own-data rejection, identifier/cross-reference/budget limits, seeded per-wave selection in the
  independent Weather RNG domain, calm outcomes, runtime start/interval/end facts and strict
  future-version rejection. It does not construct `TowerDefenseGame` or assert live gameplay.
- Before production, the exact command
  `npx vitest run packages/engine/src/content/r13-weather-mechanics.contract.test.ts --maxWorkers=1 --reporter=dot`
  is RED because the frozen `weather-mechanics` module and its public pure exports do not yet
  exist. No Weather production source changed before this evidence.

### R13.5a pure Weather GREEN evidence

- The engine now owns a closed Weather v1 normalizer, canonical zones/definitions/choices, the
  length-prefixed independent seeded wave schedule and an explicit immutable runtime reducer that
  emits only lifecycle and due-effect facts. It uses no host RNG, simulation entity lookup or
  renderer state.
- The focused pure contract is GREEN at 6/6 and `npm run typecheck` passes. Live damage, movement,
  tower cadence, snapshot and checkpoint wiring remain isolated in the already-RED R13.5b slice.

### R13.5b live Weather integration RED evidence

- The focused `TowerDefenseGame` contract deliberately starts after the pure profile/schedule
  boundary. It freezes active-only `snapshot.weather` v1, one deterministic occurrence for each
  authored wave, exact `weatherStarted`/`weatherEnded` lifecycle, and a checkpoint-owned active
  cursor with separate initial/current Weather RNG provenance. No normalizer, hostile-input or
  weighted-selection primitive case is duplicated here.
- One periodic all-map Acid effect must cross its first `0.2` boundary exactly once, submit one
  weather-sourced `{area,over_time}` enemy `DamagePacket` through `DamageResolver`, settle HP once,
  publish one ordinal effect event and do no additional work on `tick(0)`. Separate comparisons
  freeze the zone-local enemy-speed multiplier before movement and the tower fire-rate multiplier
  without mutating immutable tower definitions.
- Checkpoint restore and command-journal replay must converge with continuous simulation after
  another periodic boundary. Absent, disabled and unselected fixtures must omit Weather from both
  snapshot and checkpoint, publish no weather events, and retain exact legacy enemy HP/progress.
- Before runtime production, the exact command
  `npx vitest run packages/engine/src/simulation/r13-weather-runtime.contract.test.ts --maxWorkers=1 --reporter=verbose`
  is RED at 5 expected integration failures / 3 legacy controls passing across eight cases. The
  missing active snapshot/events, zero periodic resolver calls, unchanged enemy speed/fire rate and
  absent checkpoint section are the expected failures; all three inactive paths are GREEN.
  `npm run typecheck` is GREEN. This Contract/Test Designer changed only the focused runtime
  contract and this evidence; engine production remains untouched for the RED proof.

### R13.5b live Weather integration GREEN evidence

- `TowerDefenseGame` now resolves Weather only for the selected v1 capability, derives a schedule
  from the root seeded state without advancing the simulation RNG, and owns the active occurrence,
  wave lifecycle, zone membership and periodic cursors. Periodic damage uses the common
  `DamageResolver` with a typed Weather source; status, enemy speed, visibility/range and tower
  fire-rate effects reuse existing engine paths. Renderers receive authoritative state only.
- Active Weather publishes snapshot v1 and checkpoint inner v1; restore and journal replay
  converge with continuous simulation. Reset clears runtime state. Absent, disabled and
  unselected modules omit all Weather state/events and preserve legacy movement/damage.
- The live contract is GREEN at 8/8. The combined pure/live/damage/vanguard compatibility batch is
  GREEN at 38/38, and `npm run typecheck` passes.

### R13.5 post-GREEN audit repair

- Independent engine audit first proved three RED regressions: nested accessor/proxy schedule and
  runtime records were insufficiently inspected, a re-signed checkpoint could substitute a wider
  active zone, and a periodic backlog above the per-call cap repeated ordinals after the second
  advance. Production was unchanged for the RED proof.
- Schedule/runtime decoding now reconstructs closed detached nested data, checkpoint restore proves
  active zone bytes against the authored choice, and bounded backlog cursors advance by exactly the
  number emitted so subsequent calls drain once without repetition. The expanded pure/live suite
  is GREEN at 21/21 and typecheck passes.

### R13.5 post-GREEN engine audit RED evidence

- An independent test-only audit first reran the frozen pure/live contracts at 14/14 GREEN with
  `npx vitest run packages/engine/src/content/r13-weather-mechanics.contract.test.ts packages/engine/src/simulation/r13-weather-runtime.contract.test.ts --maxWorkers=1 --reporter=verbose`.
- The audit added focused acceptance coverage for exact authored tile membership on both square
  and odd-r hex maps, status-before-movement, visibility-before-target-acquisition, reset cleanup,
  and future checkpoint schema rejection. These controls are GREEN and confirm the intended live
  wiring without requiring production changes.
- Three concrete gaps are preserved as RED regressions. First, `createWeatherRuntimeV1` accepts a
  schedule containing an accessor-backed occurrence because nested occurrence records are not
  inspected; the paired active-runtime proxy contract also requires trap-free rejection. Second,
  a re-signed checkpoint can replace the active authored `tiles` zone with `all_map` because zone
  provenance is not compared with the scheduled choice. Third, after a 5,000-application backlog,
  the 4,096-cap first pass and 904-item second pass leave the cursor at 4,096, so a third zero-delta
  advance repeats ordinals 4,097..5,000.
- The exact combined audit command above is RED at 3/21 (18 controls GREEN). This audit changed
  tests and `progress.md` only; `weather-mechanics.ts` and `TowerDefenseGame.ts` were not edited.

### R13.5c constructor surfaces RED evidence

- A separate eight-case contract freezes the remaining constructor surface without adding Weather
  production: active semantic cross-reference and mission-map tile-bound failures versus disabled
  warnings; the Weather schema descriptor; three inert Blizzard, Acid Rain and Sandstorm recipes;
  the existing guarded single-module preview/apply transaction with revision, validation, backup,
  rollback and stale-revision refusal; an isolated Weather Mechanics Hub editor with future-version
  read-only state; one fail-closed snapshot projector shared by Canvas and Phaser; and an opt-in docs
  fixture while the canonical starter remains unchanged.
- Before surface production, the exact command
  `npx vitest run packages/engine/src/content/r13-weather-authoring-validation.contract.test.ts packages/mcp/r13-weather-surfaces.contract.test.mjs --maxWorkers=1 --reporter=verbose`
  is RED at 8/8 for the intended missing boundaries: no Weather semantic/map-bounds validator, schema
  domain, recipes, Studio editor, renderer projector or reference fixture exists yet. The failures
  are contract assertions or explicit unknown-domain/unknown-recipe/module-not-found errors; no
  Weather production source changed for this evidence.

### R13.5c Studio and renderer GREEN evidence

- Studio now exposes Weather as a separate Mechanics Hub module with isolated zone, definition and
  schedule editors. It preserves future module versions read-only and reuses the existing detached
  Preview/Enable/Save/Disable revision-guarded lifecycle instead of copying engine rules into the UI.
- A single fail-closed `projectWeatherPresentation` adapter validates the authoritative optional
  Weather v1 snapshot. Canvas and generated Phaser paths consume that shared projection for
  presentation-only zone tinting; neither path computes schedules, membership or gameplay effects.
- The focused command
  `npx vitest run packages/mcp/r13-weather-surfaces.contract.test.mjs --maxWorkers=1 --reporter=verbose -t "keeps Weather|uses one fail-closed"`
  is GREEN at 2/2 with four unrelated R13.5c cases skipped. `node --check` passes for the Studio app,
  renderer projector/index and generated-player build source, and the focused diff check is clean.

### R13.5c documentation and opt-in fixture GREEN evidence

- `docs/examples/opt-in-weather` now contains a complete Weather v1 catalog plus explicit mission
  selection. It documents and demonstrates `basic_blizzard_weather`,
  `basic_acid_rain_weather` and `basic_sandstorm_weather` without changing the mechanics-free
  canonical starter.
- ROADMAP, runbook, both architecture documents and ADR 0054 now record the independent Weather
  RNG/runtime boundary, `snapshot.weather` v1 and lifecycle/effect events, the guarded
  `preview_mechanics_module` → `apply_mechanics_module(ifRevision)` workflow with backup/rollback,
  shared Canvas/Phaser projection and absent/disabled/unselected legacy behavior.
- The exact docs-focused R13.5c case is GREEN at 1/1 with five non-doc surface cases skipped.
  Both fixture JSON files parse successfully and the documentation/fixture diff check is clean.
  This slice changes no production code.

### R13.5d browser acceptance GREEN evidence

- A dedicated Playwright contract covers the complete Weather Mechanics Hub lifecycle:
  enable, edit, preview, save, reload, disable and re-enable through the existing guarded flow.
- Generated-player acceptance builds and boots active Weather on Canvas/Phaser × hex/square,
  proves the authoritative `snapshot.weather` payload, consumes the shared fail-closed projector
  and observes the visible presentation tint. Separate absent and disabled controls prove the
  Weather-free legacy path.
- `npx playwright test tests/e2e/weather.spec.mjs --workers=1` is GREEN at 3/3. The first restricted
  sandbox attempt could not bind loopback (`EPERM`); the same test passed under the approved local
  loopback permission. No production source changed for this acceptance slice.

### R13 final gate evidence

- Engine/content gates on the frozen candidate are GREEN: `npm run typecheck`,
  `npm run build:engine`, `npm run test` (349 files, 3680 tests), `npm run validate`,
  `npm run sim tutorial_01 60`, `npm run balance -- --project examples/starter.tdproj`,
  and `npm run maps:compile -- --project examples/starter.tdproj`.
- Studio/player gates are GREEN: `npm run build` and `npm run test:e2e` (141/141), including
  the dedicated Weather lifecycle and Canvas/Phaser × hex/square matrix. A first full E2E pass
  exposed a test-only early-read race plus an unrelated transient campaign 409; the regression
  was fixed by polling an explicit absent state, the focused six-case rerun passed, and the exact
  complete command then passed at 141/141.
- Public authoring/runtime parity and packaging gates are GREEN: `npm run plugin:build`,
  `npm run plugin:validate`, `npm run plugin:smoke`, and both mobile and desktop package commands.
  No macOS release artifact, tag or release is produced by R13.

### R13 final independent verification repairs

- The final Code Verifier held the first frozen candidate and added five test-only RED regressions.
  The exact focused command was
  `npx vitest run packages/engine/src/simulation/r13-projectile-foundation.contract.test.ts packages/engine/src/content/r13-weather-mechanics.contract.test.ts packages/engine/src/simulation/r13-weather-runtime.contract.test.ts --maxWorkers=1 --reporter=verbose`:
  3 files failed, 5 tests failed and 36 controls passed. It proved forged projectile-binding and
  deterministic Weather-occurrence checkpoint acceptance, 4,097 live applications despite the
  4,096 budget, a mutable normalized `slowAffectsClasses` list, and two due effects at elapsed zero
  for a valid sub-picosecond interval.
- The final Constructor Integration Verifier independently added two test-only RED contracts with
  `npx vitest run packages/studio/public/r13-destructible-environment-surface.contract.test.mjs --maxWorkers=1 --reporter=verbose`:
  2 tests failed and 6 controls passed. They proved the missing narrow preview-only control and
  `Save candidate` implicitly enabling a disabled Ballistics module.
- Production now proves projectile flight fields against the authored tower binding, reconstructs
  the canonical Weather schedule from the root RNG for checkpoint provenance, bounds actual entity
  applications per tick, uses scale-relative boundary tolerance and deep-freezes normalized status
  lists. Destructibles preview writes nothing, while save preserves the capability's current
  `moduleEnabled` state. The combined focused command is GREEN at 4 files / 49 tests.
- The repaired frozen candidate is GREEN on every required gate: `npm run typecheck`,
  `npm run build:engine`, `npm run test` (349 files / 3,687 tests), `npm run validate`,
  `npm run sim tutorial_01 60`, `npm run balance -- --project examples/starter.tdproj`,
  `npm run maps:compile -- --project examples/starter.tdproj`, `npm run build`,
  `npm run test:e2e` (141/141), all three plugin build/validate/smoke commands, and mobile plus
  desktop scaffold packaging. The first parallel unit pass produced three legacy MCP test timeouts;
  the isolated files passed 41/41 and the exact complete `npm run test` rerun passed 3,687/3,687.

### R13 second final-verification RED/GREEN evidence

- Re-verification held `6e246ac`: the Constructor Integration Verifier added one real-transaction
  RED test proving a disabled destructible edit previewed the old `maxHp: 50` instead of requested
  `99` and applied no write (1 failed / 6 controls passed). The Code Verifier added two RED tests
  proving active Weather could diverge from outer wave lifecycle and periodic cursor `1` could be
  re-signed as `0` or `100` (2 failed / 15 controls passed).
- The narrow five-file destructible transaction now authors the exact supplied candidate through
  normal semantic validation and only then restores `module.enabled=false`; disabled save therefore
  writes profile/map bytes without activating gameplay, including the first authored candidate.
- Weather checkpoint validation now binds active state to outer `waveIndex`/`waveState`, derives the
  exact occurrence from the root RNG, and requires periodic cursors to equal the canonical ordinal
  for active elapsed time. Bounded due-fact overflow is consumed deterministically instead of being
  stored as ambiguous replay backlog. The focused Weather and destructible regressions are GREEN;
  the pre-existing first-load CLI timeout passed on an immediate isolated 7/7 rerun.
- The second repaired candidate is GREEN on the complete final matrix: typecheck, engine build,
  349 unit files / 3,690 tests, validate, tutorial simulation, starter balance, map compilation,
  web build, 141/141 E2E, plugin build/validate/smoke, and both mobile and desktop scaffold packages.
  The first full-unit attempt correctly caught stale generated plugin bytes; after `plugin:build`,
  the focused parity contract and the exact complete `npm run test` rerun passed.

### R13 pure Weather runtime final RED/GREEN evidence

- The final Code Verifier held `ccb8684` and proved the exported pure runtime still accepted a
  forged settled cursor `1 -> 0` (replay) or `1 -> 100` (silent repair), even though checkpoint
  restore already rejected both. The test-only RED command had 2 failures and 10 controls passing.
- `advanceWeatherRuntimeV1` now proves active occurrence provenance and requires the exact canonical
  cursor set before any transition or due-effect emission. Both forged cases fail closed; the pure
  plus live Weather focused suite is GREEN at 29/29.
- After plugin regeneration, the exact final matrix is GREEN again: typecheck, engine build,
  349 unit files / 3,692 tests, validate, tutorial simulation, starter balance, map compilation,
  web build, 141/141 E2E, plugin build/validate/smoke, and mobile plus desktop packaging. The first
  unit pass hit two known first-load MCP timeouts; those files passed 28/28 in isolation and the
  unchanged exact `npm run test` rerun passed 3,692/3,692.
- A final hostile-ID audit added one RED case for the valid own-data effect ID `__proto__`: the
  normalizer preserved it, but ordinary-object cursor lookup reached `Object.prototype` and threw
  before the first effect. Cursor reads now require an own property, and cursor construction in
  both the pure runtime and checkpoint validator uses explicit own data properties. The pure/live
  Weather focused suite is GREEN at 30/30 with exact `__proto__` cursor and due-fact round-trip.
- The hostile-ID repair is GREEN on the complete matrix: typecheck, engine build, 349 unit files /
  3,693 tests, validate, tutorial simulation, starter balance, map compilation, web build,
  141/141 E2E, plugin build/validate/smoke, and mobile plus desktop packages. The first unit pass
  repeated two known first-load MCP timeouts; the isolated 28/28 controls and unchanged exact
  complete `npm run test` rerun passed.

## 2026-07-31 — R13 remote CI result and roadmap pause

- The published R13 head is `b3069a41353c128d7d0d459316229fe7bffbf460` in stacked PR #24;
  local and remote branch SHAs match. PR #23 remains the green R12 base.
- GitHub Actions run `30601422668` passed typecheck, engine build, plugin build/validate/smoke and
  source parity, all 349 unit files / 3,693 tests, project validation, tutorial simulation, map
  compilation, and web build. The final Playwright step failed at 140/141.
- The failure is the legacy R4.4B Studio future-version lifecycle at
  `tests/e2e/mechanics-roguelite-campaign-run.spec.mjs:56`: the guarded future-schema preview leaves
  source bytes unchanged and reaches the expected read-only/newer result, but its HTTP 400 response
  is collected as `Failed to load resource` and violates `browserErrors() === []`.
- A sandboxed focused run was invalid because loopback bind was denied. The approved loopback rerun
  `npx playwright test tests/e2e/mechanics-roguelite-campaign-run.spec.mjs --workers=1` reproduced
  the actual issue at 1 failed / 2 passed, with HTTP 409 locally. This supersedes the earlier claim
  that the exact remote candidate had a green final CI gate.
- R13 remains implemented and independently reviewed, but is not accepted until this finding gets a
  dedicated RED/GREEN repair, all exact-commit gates are rerun, and both independent sign-offs are
  renewed. No source fix, merge, tag, or release is part of this documentation update.
- The owner explicitly paused the roadmap after R13. R14–R17 are planned only and must not be
  started, exposed as capabilities, merged, tagged, or released without a new owner command.

## 2026-07-31 — agent harness documentation refresh

- `harness-project-setup` classified the repository as an existing project with every required
  baseline document present. `AGENTS.md` remains the sole policy gateway; no duplicate `CLAUDE.md`
  was introduced.
- README RU/EN now distinguishes published v0.4.0, R9–R11 on `main`, green open R12 PR #23, red
  stacked R13 PR #24, and the explicit pause before unimplemented R14–R17.
- `ARCHITECTURE.md` and the product architecture now include the implemented Weather version domain,
  Ballistics checkpoint v1–v4 progression, R13.4 transactional destructibles, and current agent
  descriptors without presenting planned R14–R17 contracts as available.
- ROADMAP, runbook, release baseline, quality gaps, engine review, reference examples, PR template,
  and chronological evidence were synchronized with the same delivery state and TDD/sign-off rules.
- Verification: harness audit reports no missing baseline docs; local Markdown links pass in 11
  canonical files; the placeholder scan found no `TODO(user)`, `TBD`, `FIXME`, or `[TODO`; docs-related
  Vitest is 8 files / 33 tests green; `npm run validate` passes; and the documented Persona QA smoke
  command runs three deterministic personas successfully. Runtime production code was not changed.

## 2026-08-01 — R13 release-gate race repaired

- RED evidence: the focused Studio campaign lifecycle repeated 12 times failed once because an
  in-flight `POST /api/mechanics/apply` returned `409 Conflict` after the fixture edited
  `content/mechanics.json` directly. The product transaction had already written the expected data;
  the test observed the file before the guarded HTTP request completed.
- GREEN: the E2E contract now awaits the exact mechanics apply response and asserts that it succeeded
  before introducing the future-version fixture. Twenty serial repetitions passed without a browser
  error.
- This repairs the reproducible PR #24 CI symptom without weakening stale-revision handling or
  future-version read-only preservation. Full exact-commit CI and both R13 sign-offs remain required
  before merge.

## 2026-08-01 — R13 accepted and R14 Modular Arsenal

- R13 PR #24 merged into `main` as `318671c25f79f79f6092ff9abe77e443f1093bba`. Exact source
  `3b629248c421e5d2c0b6cab6b7174543c2794798` passed CI run `30655702863`; the repaired browser
  race had already passed 20/20 repeated serial runs.
- R14.0 RED introduced `r14-campaign-run-v2.contract.test.ts`: before implementation, four of five
  contracts failed because CampaignRun still emitted v1 and rejected/ignored the Arsenal inventory.
  GREEN adds the explicit v1→v2 migration, closed hostile-data codec and independent
  `arsenal.moduleInventory`; the combined campaign focused set passed 78/78.
- R14.1/R14.3 RED introduced `r14-arsenal.contract.test.ts`; all four contracts initially failed
  because the module normalizer, compiler and crafting reducer did not exist. GREEN adds closed
  authoring data, base/barrel/core compatibility, immutable effective multipliers and exact rotated
  3×3 crafting with atomic concrete artifact consumption; 4/4 pass.
- R14.2 adds GameCommand/Journal v7, active-only tower loadouts, shared modifier-pipeline damage,
  range and durability, management-phase module configuration, runtime `craftGem`, checkpoint and
  journal replay equivalence, branch-upgrade loadout cleanup and absent-module no-op coverage.
- R14.4 adds the isolated Studio Arsenal editor, authoritative Playtest controls, a fail-closed
  renderer projector used by Canvas and Phaser generated players, MCP schema/recipe discovery and
  agent guide v48. Campaign presentation now accepts both legacy Run v1 and current Run v2 module
  inventory without deriving gameplay.
- Final source-tree verification passed 3,716/3,716 unit and contract tests in 357 files, typecheck,
  engine build, content validation, the 60-second tutorial simulation, starter balance and map
  compilation, production web build, all three plugin build/validate/smoke checks, and mobile plus
  desktop scaffold packaging. `cargo test` passed 7/7 desktop bridge/lifecycle tests.
- The first full browser pass exposed one stale assertion that still expected imported CampaignRun
  v1 to remain v1. A focused RED regression proved the intended explicit v1→v2 migration; after the
  expectation was corrected, the exact final browser matrix passed 141/141 across Studio, Canvas,
  Phaser, hex and square paths.
- The local Apple-silicon Tauri build produced `TowerForge_0.5.0_aarch64.dmg`. The first sandboxed
  attempt failed at the system `hdiutil` boundary; the identical command succeeded with normal
  macOS device access. `verify:macos-bundle` then mounted the DMG and verified both the complete
  ad-hoc app signature and the disk-image container. The artifact remains an unsigned,
  non-notarized pre-release until Developer ID credentials are configured.

## 2026-08-01 — v0.5.1 Windows release-gate repair

- RED evidence: tagged v0.5.0 desktop workflow `30661346389` stopped before Windows packaging at
  `r11-procedural-juice-surface.contract.test.mjs`. The contract searched for a literal LF-only
  route header, while the Windows checkout used CRLF and returned index `-1`. No v0.5.0 GitHub
  release or public installer was created.
- GREEN changes the contract to locate the route with an explicit LF/CRLF expression and runs the
  same assertion against both the checked-out source and a synthetic CRLF copy. Product runtime
  behavior is unchanged.
- The already-pushed failed-build tag is not moved or reused. Package, desktop, Tauri, Cargo, MCP
  and plugin versions advance together to v0.5.1 for the next exact-source release attempt.
- Focused regression passed 5/5; the complete unit/contract set passed 3,716/3,716 after rerunning
  with the loopback access required by Studio server tests. Typecheck, engine build and all plugin
  build/validate/smoke gates are GREEN with `towerforge@0.5.1`.
- The exact local v0.5.1 Apple-silicon build and strict bundle verifier passed. Its temporary local
  DMG SHA-256 is `6e06ef33a7b564f06f492101b0ec137eaabbac168e1dfb29e8af8d23555dc87c`;
  published installers will receive independent native-runner hashes in `SHA256SUMS`.

## 2026-08-01 — v0.5.2 Windows plugin-export budget

- RED evidence: tagged v0.5.1 workflow `30663472083` passed the CRLF regression but stopped before
  Windows packaging when the complete checksummed plugin export exceeded Vitest's default
  five-second limit. The export itself had already passed the dedicated plugin workflow. No
  v0.5.1 GitHub release or public installer was created.
- GREEN gives this filesystem-heavy cross-platform contract an explicit 30-second budget while
  preserving every manifest, hash, subprocess verification and tamper-detection assertion.
- Failed tags remain immutable. The next release attempt advances all public version domains
  together to v0.5.2.

## 2026-08-01 — R15 deterministic Macro-Economy

- R15.1 RED command:
  `npm run test -- --run packages/engine/src/content/r15-macro-economy-market.contract.test.ts`.
  All three contracts failed for the expected reason: the closed profile normalizer, market runtime
  and deterministic next-wave price step did not exist. GREEN adds `macroEconomy` v1, bounded
  commodity/deposit/altar schemas, a domain-separated seeded market and input-order invariance.
- R15.2/R15.3 runtime contracts were authored before their production paths. The missing v8
  command/journal union, active snapshot/checkpoint state, deposit maturity and atomic ritual
  actions were RED, then implemented through the canonical dispatcher and shared
  DamageResolver/status paths. Trades and deposits remain management-only; rituals are allowed
  while the outcome is `playing`, so their combat effects have authoritative targets.
- The first active checkpoint run exposed a RED event-codec regression: `commodityTraded` was not
  accepted by the closed checkpoint event schema. A later verifier regression proved that a
  post-wave checkpoint used non-canonical null-prototype price records and rejected a valid negative
  `pendingNetDemand`. Both now have focused GREEN coverage, together with complete commodity record,
  quote-bound and seed-provenance rejection.
- Focused engine, renderer, Studio, MCP/AI and generated-player/package contracts are GREEN at
  18/18 across six files. The first real browser acceptance run then recorded two additional RED
  integration defects: the Studio draft normalizer appended combat-only fields to Macro-Economy,
  and generated players replaced command buttons every animation frame so pointer activation could
  never stabilize. The fixes keep closed module drafts raw and memoize engine-owned presentation;
  the complete Studio lifecycle plus Canvas/Phaser × hex/square command matrix is GREEN at 3/3,
  including keyboard and touch activation and absent/disabled legacy bundles.
- The pre-freeze repository pass reached 3,734/3,734 unit/contract tests and the pre-R15 browser
  baseline reached 141/141. Exact final gates and two independent sign-offs remain required before
  ADR 0056 can move from Proposed to Accepted.
- The first independent freeze was rejected. Fresh RED regressions reproduced seven findings:
  another co-op player could sacrifice an owned tower, partitioned wallets shared market state,
  hostile direct ritual arrays could throw, selection order changed snapshots, recomputed forged
  checkpoint provenance passed the inner codec, temporary damage modifiers could exceed the shared
  64-entry resolver budget, and inactive runtime files remained in a legacy bundle. The focused
  command completed with 7 failed / 17 control tests passed.
- GREEN canonicalizes descriptor-safe ritual selections and affected enemies, enforces every
  `owner_only` ritual target, removes sacrificed ownership, and rejects Macro-Economy v1 with
  partitioned multiplayer resources in both content validation and `MatchSession` create/restore.
  Deposits now record their opened-wave proof; ritual modifiers carry exact altar/effect/sequence
  provenance, positive finite multipliers and duration bounds; shared modifier capacity and numeric
  products are preflighted before tower destruction. Legacy builds prune full Macro-Economy engine
  and renderer modules and bind common engine imports to an inert optional-mechanics adapter.
  The repaired focused set is GREEN at 27/27 across four files.
- The first complete rerun then exposed one existing R8 packaging interaction: an active
  multiplayer-only build retained `match-session`'s static Macro-Economy import after the R15 file
  was pruned. The existing conditional multiplayer package contract supplied the RED; the inactive
  adapter rewrite now covers that optional entrypoint too, and the combined R8/R15 packaging set is
  GREEN at 3/3.
- The second independent freeze was also rejected. Code verification supplied RED reproductions
  for reset leakage, finite modifier products that overflowed derived range/fire-rate, and sequence
  values without safe increment headroom. Integration verification proved the stronger opt-in
  invariant was still false: copied `TowerDefenseGame.js` and `command-internal.js` retained full
  R15 runtime/parser bytes and per-instance empty state even though catalog files were pruned.
- GREEN now resets market/deposits/modifiers/sequences from the original deterministic seed, caps
  aggregate temporary multiplier products at a conservative `1e100`, and bounds both sequences at
  one billion with atomic command rejection before increment. Inactive engine instances no longer
  allocate any R15 own fields. The engine build emits explicit optional-section markers; the
  generated-player packager strips those engine, validator, command and multiplayer sections plus
  the catalog/presentation modules before single-file graph and service-worker collection. Active
  builds retain the complete implementation. The second repaired focused matrix is GREEN at 17/17.
- The third freeze produced two final RED regressions. Code verification showed that restoring an
  inactive legacy checkpoint created four empty R15 own-properties even though a fresh legacy game
  did not. Constructor integration verification showed that the pruned legacy bundle still exposed
  `macroEconomy` in the mechanics catalog and five R15 checkpoint event-schema names. The combined
  focused run failed exactly those two tests with 14 controls passing.
- GREEN removes inactive restore assignments and places the module IDs plus event descriptors under
  the same compiled optional-section boundary as the runtime. Legacy package construction now strips
  `content/mechanics.js` as well. The repaired engine and R12/R15 packaging matrix passes 17/17, while
  active builds retain the complete catalog and event codec.
- The fourth Code Verifier rejected the freeze with two additional hostile/numeric cases. RED added
  a validator-approved `1e308` tower plus a finite ritual multiplier that previously failed later in
  `DamageResolver`, and symbol-keyed authored/command arrays that the string-key descriptor count
  silently accepted. The focused run failed exactly all three new assertions with 15 controls green.
- GREEN rejects own symbols in every R15 dense-array and ritual command boundary. Ritual preflight
  now evaluates pending temporary damage after authored base, meta, rogue, Arsenal, elevation and
  hero stages, validates checkpoint-restored temporary damage the same way, and conservatively
  proves range/fire-rate products across compatible Arsenal modules and authored Weather before any
  tower is sacrificed. The repaired focused matrix passes 95/95 across five files.
- The fifth Code Verifier found that the proof's tower domain still followed the Studio palette even
  though the public headless placement API accepts every registered tower, and that checkpoint
  restore did not reuse the non-damage proof. RED reproduced an unlisted `1e308` damage tower plus
  authored range/fire-rate restore overflow; all three new assertions failed with 15 controls green.
- GREEN extends damage proof to the full engine-placeable tower registry and moves range/fire-rate
  composition into a pure Macro-Economy helper shared by live ritual preflight and checkpoint
  validation. It includes exact meta levels and conservative Arsenal, support and Weather bounds.
  The repaired focused matrix passes 98/98 across five files.
- The sixth Code Verifier isolated the remaining pulse DoT path: `dotDamagePerUnit` re-enters the
  common tower DamageResolver after its source tower may be sacrificed, but the finite proof covered
  only `pulseDamage`. Live and forged-checkpoint RED tests both reproduced acceptance of a `1e308`
  DoT followed by failure on a finite temporary multiplier.
- GREEN treats pulse DoT as an explicit over-time damage candidate. Its proof mirrors runtime stages:
  meta, global synergy, optional sunlight and temporary modifiers, while excluding source-tower
  Arsenal/artifact/draft/high-ground/hero modifiers. Live and checkpoint paths share the corrected
  proof; the repaired focused set passes 97/97 across four files.
- Final frozen-tree gates passed: typecheck, engine build, 3,748/3,748 tests in 363 files, content
  validation, the 60-unit starter simulation, balance, map compilation, web build, 144/144 browser
  E2E, plugin build/validate/smoke, mobile scaffold and desktop scaffold packaging. The starter
  simulation remained `playing` with core 10, two of three waves, two towers, one enemy and 45 coins.
- Independent Code Verifier sign-off: PASS, with 101/101 focused tests and no P0–P2 findings.
  Independent Constructor Integration Verifier sign-off: PASS, with 76/76 focused tests, 3/3 R15
  browser acceptance, strict legacy carrier pruning, active carrier presence and exact plugin parity.
  ADR 0056 is Accepted; R15 is complete pending its separate PR merge/release workflow.

## 2026-08-01 — R16.4 Reference Relay RED

- Contract freeze adds a separate `@towerforge/reference-relay` workspace with an injected
  loopback-server adapter and no simulation dependency. The relay contract requires the existing
  R8 capability-handshake negotiation before any frame forwarding, opaque detached FIFO frames,
  cross-room isolation, deterministic cleanup and idempotent close.
- Closed limits are fixed at 128 UTF-8 bytes for invite codes and peer IDs, four peers per room,
  1 MiB per frame and 256 queued frames per peer. The public server descriptor explicitly promises
  loopback by default and no accounts, matchmaking or gameplay logic.
- Additional compatibility contracts keep Replay Lab, ghost presentation and the reference relay
  out of untouched starter single-file, mobile and desktop carriers. MCP discovery publishes only
  static deployment metadata and agent guidance; it exposes no socket-opening or relay write tool.
- RED command:
  `npx vitest run packages/reference-relay/src/relay.contract.test.mjs packages/cli/build.r16-replay-lab-package.contract.test.mjs packages/mcp/r16-reference-relay.contract.test.mjs --maxWorkers=1`.
  The expected RED was observed: the relay entrypoint does not exist, the legacy carrier still
  includes `engine/replay-lab`, and MCP has neither the `replayLab` descriptor nor reference-relay
  guidance. Result: three failed files and three failed executable tests; the relay suite failed at
  collection before production exists. No R16.4 production code was added in this slice.

## 2026-08-01 — R16 Replay Lab browser acceptance RED

- Added one focused Playwright acceptance over a disposable starter project and loopback Studio.
  It opens the isolated Replay Lab tab, verifies its `data-project-write="none"` boundary, imports a
  truncated three-byte archive, and proves the rejection leaves the timeline empty, every replay
  control disabled, ordinary Save disabled, the dirty badge clear, project bytes unchanged and the
  request log free of writes.
- The same test creates a valid checksummed archive through the built engine, imports it in Studio,
  and uses the native range control to seek from journal sequence 0 to 2 while preserving the same
  read-only guarantees.
- RED command: `npm run test:e2e -- tests/e2e/r16-replay-lab.spec.mjs`.
  The malformed-input/read-only path and valid import reached GREEN, then the expected integration
  RED reproduced on native seek: the engine reported `Canonical serialization rejects unsupported
  undefined values`, so the timeline remained at `Sequence 0 / 2` instead of `Sequence 2 / 2`.
  Result: one failed test. No production code was changed in this acceptance slice.

## 2026-08-01 — R16 independent verifier repair RED

- Renderer hardening now covers nested hostile row proxies, a proxied array whose `length` access
  throws, and an oversized proxied array that throws if the adapter inspects any row beyond the
  public 4,096-row budget. The contract requires fail-closed `undefined` without an exception and
  applies the bound before traversal and sorting while retaining the authoritative overflow count.
- Focused renderer/Studio command:
  `npx vitest run packages/renderer/src/ghost-replay-presentation.contract.test.mjs packages/studio/public/r16-replay-lab-surface.contract.test.mjs --maxWorkers=1`.
  The expected three RED failures were observed: a hostile `length` trap escaped the shared adapter;
  Studio had no replay preview/overlay and never called `projectGhostReplayPresentation`; archive
  import reused a cached `ReplayLabUI.content` instead of explicitly rebuilding the registry before
  decode. The two pre-existing tests in each file remained GREEN.
- The browser acceptance now starts from an initial checkpoint containing a real tower and requires
  a visible `replay-lab-preview`, one projected ghost tower, removal when the checkbox is cleared and
  restoration when it is checked. A second browser scenario edits authoritative tower range without
  saving and reimports the old archive, proving the current content digest rejects it.
- Browser RED command: `npm run test:e2e -- tests/e2e/r16-replay-lab.spec.mjs`.
  Result: one failed / one passed. The overlay scenario failed because `replay-lab-preview` does not
  exist; the unsaved-edit scenario did reject the stale archive, but the static contract remains RED
  until every import explicitly constructs a fresh engine registry rather than relying on aliased or
  cached state. No production code was changed in this repair wave.

## 2026-08-01 — R16 transactional Replay Lab import RED

- The import contract now treats content, decoded archive, ghost session and initial frame as one
  atomic tuple. `loadReplayLabArchive` must build a local `candidateContent`, decode against it,
  construct `candidateGhost` and successfully seek `candidateFrame` before assigning any member of
  the live `ReplayLabUI` tuple. A failed candidate preserves the previous valid session rather than
  pairing a fresh content registry with an old branded archive.
- Static RED command:
  `npx vitest run packages/studio/public/r16-replay-lab-surface.contract.test.mjs --maxWorkers=1`.
  Result: two expected failures / three controls passed. Current import assigns
  `ReplayLabUI.content` before decode and has no local candidate tuple or post-validation commit.
- The Playwright regression imports valid archive A, makes an unsaved gameplay-range edit, rejects
  A against the new current content, then verifies the old timeline and ghost overlay remain usable
  and attempts a What-If fork. It also specifies the same preservation behavior after a malformed
  follow-up candidate.
- Browser RED command: `npm run test:e2e -- tests/e2e/r16-replay-lab.spec.mjs`.
  Result: one failed / one passed. The earlier malformed/read-only, overlay toggle and seek path is
  GREEN. The transactional regression failed exactly at the fork: the live UI retained archive A
  but had already replaced its content, producing `Replay branch parent content digest provenance
  mismatch.` No production code was changed in this repair slice.

## 2026-08-01 — R16 verifier repair GREEN and final freeze

- The shared ghost projector now contains nested proxies/accessors/symbols/sparse arrays, reads no
  more than 4,096 tower or enemy rows before sorting, and preserves exact overflow counts. Studio
  rebuilds the current content registry before every archive decode and renders a detached shared-
  renderer ghost overlay whose toggle removes and restores projected markers without project writes.
- Repair-focused evidence: 39/39 Vitest contracts and 2/2 Replay Lab Playwright scenarios passed.
  The complete frozen-tree Vitest run passed 3,797/3,797 tests in 374 files. The complete browser
  run passed 146/146 after an isolated 3/3 R15 rerun confirmed the first parallel failure was a
  transient test race rather than a product regression.
- Final gates passed on the frozen implementation: typecheck, engine build, content validation,
  60-unit starter simulation, balance, map compilation, web build, plugin build/validate/smoke,
  mobile scaffold and desktop scaffold packaging. The starter simulation remained `playing` with
  core 10, two of three waves, two towers, one enemy and 45 coins.
- ADR 0057 is Accepted. R16 now awaits repeat independent Code Verifier and Constructor Integration
  Verifier sign-off on this exact tree before PR publication.

## 2026-08-01 — R16 independent verifier repair GREEN

- The shared renderer projector now treats every presented row and coordinate as closed own data,
  contains nested proxy/accessor traps, rejects symbol-bearing or sparse visible input, and reads at
  most the public 4,096-row window before sorting. It retains the authoritative source length only
  for the overflow diagnostic, so oversized frames are bounded without probing row 4,097.
- Replay Lab imports now rebuild the engine content registry from the current Studio draft before
  every decode. An archive created before an unsaved gameplay edit is rejected by the content digest
  instead of being admitted through a stale cached registry.
- The Studio preview calls the shared renderer `projectGhostReplayPresentation` adapter and renders
  only its detached tower/enemy rows. The Ghost overlay checkbox now removes and restores the actual
  preview; no targeting, coordinates, replay progression or other gameplay rule is duplicated in
  Studio.
- Focused contract command:
  `npx vitest run packages/renderer/src/ghost-replay-presentation.contract.test.mjs packages/studio/public/r16-replay-lab-surface.contract.test.mjs`.
  Result: 7/7 passed across two files.
- Browser acceptance command:
  `npx playwright test tests/e2e/r16-replay-lab.spec.mjs`.
  Result: 2/2 passed, covering malformed rejection/read-only isolation, valid import and seek, real
  overlay toggle, and rejection after an unsaved content change. These repairs invalidate the prior
  verifier sign-offs; a new exact-commit freeze and both independent sign-offs remain required.

## 2026-08-01 — R16 transactional Replay Lab import GREEN

- `loadReplayLabArchive` now reads the candidate bytes, constructs a detached current-project
  registry, decodes the archive, creates the ghost and completes `seek(0)` entirely in local
  variables. Only then does one synchronous block replace the live content/archive/ghost/frame
  tuple and clear branch/error state. Any exception therefore preserves the prior valid session.
- The first browser rerun exposed a second alias boundary: the accepted registry still shared
  authored records with the mutable Studio draft, so an unsaved edit also changed the old session's
  effective content digest. `createReplayLabContent` now passes a structured clone into the engine
  registry, preserving the accepted tuple as detached immutable replay provenance. Successful seek
  and branch actions clear a prior import diagnostic without weakening failed-import visibility.
- Focused static/renderer command:
  `npx vitest run packages/studio/public/r16-replay-lab-surface.contract.test.mjs packages/renderer/src/ghost-replay-presentation.contract.test.mjs --maxWorkers=1`.
  Result: 8/8 passed across two files.
- Browser acceptance command:
  `npx playwright test tests/e2e/r16-replay-lab.spec.mjs`.
  Result: 2/2 passed. After both a current-content mismatch and malformed follow-up archive, the
  previous timeline, ghost overlay and What-If fork remain operational. This source repair again
  invalidates the earlier freeze/sign-offs; exact-commit gates and both independent verifiers must
  be repeated before R16 acceptance.

## 2026-08-01 — R16 final exact-tree freeze after transactional repair

- Full Vitest passed 3,798/3,798 tests in 374 files; full Playwright passed 146/146. Typecheck,
  engine build, content validation, the 60-unit starter simulation, balance, map compilation and web
  build passed on the same working tree.
- Codex plugin build/validate/smoke, mobile scaffold packaging and desktop scaffold packaging also
  passed. The starter remained on its legacy Replay-Lab-free player path.
- The frozen tree is now handed to both independent verifiers again. Any further source or contract
  change invalidates these results and requires another freeze.
- Independent Code Verifier sign-off: PASS, with 50/50 focused contracts, 2/2 hostile-input
  regressions and no P0–P2 findings. Independent Constructor Integration Verifier sign-off: PASS,
  with 18/18 focused contracts, 2/2 browser scenarios, 30/30 package compatibility checks and no
  P0–P3 findings. R16 is complete pending its separate PR merge.

## 2026-08-01 — R17.1 Distribution config and reproducible publish candidate RED

- Contract freeze introduces the browser-safe, data-only `@towerforge/distribution` package. Its
  public entrypoint exports `DISTRIBUTION_SCHEMA_VERSION`, `DISTRIBUTION_LIMITS`,
  `validateDistributionConfigV1`, `normalizeDistributionConfigV1`, `buildPublishManifestV1`,
  `verifyPublishManifestV1` and `computePublishCandidateDigestV1`. The package has no filesystem,
  DOM, provider, credential or engine dependency.
- Authoring `content/distribution.json` opts a project into schema v4. Absent projects v1-v3 remain
  valid and expose neither a synthesized distribution config nor an authored flag. Config v1 fixes
  a `tfp_` plus 32-lowercase-hex project ID, an allowlisted license, explicit remix policy and a
  bounded optional monetization/provenance contract.
- `PublishManifestV1` contains exactly schema/format/projectId, engine/content/bundle digests,
  sorted capabilities, license, remix policy and optional source-pack digest. Equivalent input
  order must produce byte-identical JSON and the same SHA-256 candidate digest; clocks, credentials,
  URLs and user-local paths are not fields.
- Pure contract RED command:
  `npx vitest run packages/distribution/src/distribution-config.contract.test.mjs packages/distribution/src/publish-manifest.contract.test.mjs --reporter verbose`.
  Result: two suites failed at collection because `packages/distribution/src/index.mjs` does not
  exist. This is the expected pre-production failure for all seven frozen exports.
- Project-loader RED command:
  `npx vitest run packages/cli/lib/r17-distribution-project-schema.contract.test.mjs --reporter verbose`.
  Result: 4/4 expected failures: current project schema is 3, authored distribution is ignored,
  the optional file is not loaded, and malformed/future distribution has no validation surface.
  No R17 production code was added in this slice.

## 2026-08-01 — R17.2 provider confirmation/adapters RED

- The Node-side entrypoint `packages/cli/lib/distribution/index.mjs` must export
  `previewPublishCandidate`, `preparePublishCandidate`, `mintPublishApproval` and
  `publishPreparedCandidate`. Supported adapter IDs are `filesystem_v1`, `github_pages_v1` and
  `cloudflare_pages_v1`.
- Preview is compute/read-only and never invokes the reproducible build or adapter runtime. Prepare
  writes only private staging. Approval is minted only from `confirmed: true` and binds the exact
  candidate digest, adapter ID and canonical target digest. Publish rejects missing or mismatched
  approval before invoking the provider, keeps credentials runtime-only, verifies the remote result
  and never mutates the source project, including on upload failure.
- Provider RED command:
  `npx vitest run packages/cli/lib/distribution/provider-adapters.contract.test.mjs --reporter verbose`.
  Result: the suite failed at collection because the frozen Node entrypoint does not exist.
- Static MCP safety RED is included in
  `packages/mcp/r17-publish-safety.contract.test.mjs`: agents may inspect/preview a candidate, but
  there is no upload/deploy tool and MCP cannot call approval minting or final publication.
  No R17 production code was added in this slice.

## 2026-08-01 — R17.3 deterministic remix source pack RED

- Pure `validateRemixProvenanceV1` accepts only parent project ID, manifest/source-pack SHA-256,
  attribution and `{kind:"published_tdpack"}`. Paths, URLs, deployment metadata, accessors, cycles
  and future versions fail closed.
- Node `exportRemixSourcePackV2`, `inspectRemixSourcePackV2` and `importRemixSourcePackV2` retain the
  `.tdpack` format at version 2. Export is byte-reproducible and allowed only by license/remix/source
  policy. It excludes `.towerforge`, root deployment/env material and cache trees. Import creates a
  caller-supplied new valid project ID and records `RemixProvenanceV1`; malformed packs roll back
  without a destination.
- RED command:
  `npx vitest run packages/distribution/src/remix-provenance.contract.test.mjs packages/cli/lib/distribution/remix-pack.contract.test.mjs --reporter verbose`.
  Result: two suites failed at collection because the pure validator and remix-pack v2 entrypoint
  do not exist. No R17 production code was added in this slice.

## 2026-08-01 — R17.4 host-only monetization and constructor isolation RED

- `validateMonetizationHookV1` permits at most 16 closed placements with kind
  `banner | interstitial | purchase_link` and surface `top | bottom | menu | between_waves`.
  Rewarded gameplay effects, payment material, embedded URLs, telemetry and arbitrary code are
  outside v1 and rejected rather than passed through.
- The static constructor contract requires a separate Distribution Hub, digest-visible preview and
  explicit confirmation, compute-only MCP discovery, and host-player injection. The engine remains
  free of Distribution, PublishManifest, RemixProvenance and MonetizationHook imports.
- RED command:
  `npx vitest run packages/distribution/src/monetization.contract.test.mjs packages/mcp/r17-publish-safety.contract.test.mjs packages/studio/r17-distribution-surface.contract.test.mjs --reporter verbose`.
  Result: the monetization suite failed at collection, and 4/4 executable static tests failed on
  the missing MCP descriptors, Distribution Hub and host-player hook. The negative engine/MCP
  isolation assertions remained controls. No R17 production code was added in this slice.

## 2026-08-01 — R17 constructor/package acceptance RED

- Added a bounded Studio browser scenario for the optional Distribution Hub: absent file, edit,
  compute-only preview, guarded enable/save, reload, disable and re-enable. The authoring candidate
  fixes project schema v4, license/attribution, remix source policy and one host-only placement.
  External provider upload and desktop ACL are deliberately outside this browser slice.
- Added an MCP acceptance contract for
  `describe_schema(distribution) → read_distribution_config → preview_distribution_config →
  apply_distribution_config(ifRevision) → validate_project`, including stale-revision rejection,
  backup/rollback metadata and clean disable. `preview_publish_candidate` remains compute-only;
  upload/deploy/approval-minting tools are forbidden.
- Added a package matrix for Canvas/Phaser × hex/square. Active, licensed builds must contain the
  published relative `source.tdpack`, a Remix affordance and inert host placement descriptors.
  Untouched starter output must contain none of the R17 runtime/manifest/provenance markers. Both
  active and legacy scans reject provider secrets, user-local absolute paths, rewarded gameplay,
  payment keys and hidden telemetry.
- Static/MCP RED command:
  `npx vitest run packages/mcp/r17-distribution-authoring.contract.test.mjs packages/studio/r17-distribution-surface.contract.test.mjs --reporter=dot`.
  Result during the foundation handoff: 5/5 expected failures. Distribution authoring tools were
  absent, and the partial Studio shell lacked the complete attribution/source/lifecycle controls,
  MCP preview descriptors and host-player injection. One describe call reached the default timeout;
  the test now has an explicit 30-second bound.
- Package RED command:
  `npx vitest run packages/cli/build.r17-distribution-package.contract.test.mjs --reporter=dot --maxWorkers=1`.
  Result: active hex/Canvas failed on the first missing Remix marker; the untouched legacy carrier
  control passed and contained no R17 source pack or runtime markers.
- Browser command:
  `npx playwright test tests/e2e/r17-distribution-studio.spec.mjs --reporter=line`.
  The sandboxed attempt failed only because loopback listen was denied. The approved loopback rerun
  passed 1/1 after concurrent GREEN Studio work landed in the shared tree, covering the complete
  enable/edit/preview/save/reload/disable/re-enable lifecycle. No production file was edited by the
  Contract/Test Designer in this acceptance wave.

## 2026-08-01 — R17 verifier-led repair waves and integration GREEN

- Browser-boundary RED caught `node:crypto`/`Buffer` in the new pure distribution package. The
  package now uses browser-safe UTF-8 and synchronous SHA-256 helpers; Node/filesystem/provider work
  remains in the CLI layer. The focused contract and compatibility set passed 117/117 after the
  version-domain split kept mechanics/elevation authoring on v3 while Distribution promotes to v4.
- Provider-integrity REDs proved that a declared bundle digest could differ from staged bytes, a
  filesystem copy was not independently hashed, and an approval could be retried after an upload
  failure. Prepare now requires the canonical staged digest, filesystem publication verifies the
  copied tree and rolls back on mismatch, and approvals are consumed before every upload attempt.
  Provider contracts passed 8/8; the full R17 pure/CLI focused set passed 41/41.
- Remix REDs caught an implicit engine compilation at export time and retained parent project name
  on import. Export now uses the complete already-built validator without hidden compilation, the
  byte-identical scenario completes in about 1.3 seconds, and import writes both a new bounded name
  and a new project ID while retaining parent identity only in immutable provenance.
- Central Studio acceptance reproduced four integration defects after the initial handoff: the
  saved config button remained disabled, publish prepare supplied a short content hash instead of a
  SHA-256 digest, verified status was erased by rerender, and disable/re-enable lost its in-memory
  draft. The same browser contract was extended through real `filesystem_v1` prepare, explicit
  confirmation, verified output and rollback-safe re-enable; it now passes 1/1.
- Plugin smoke RED proved the generated runtime omitted `packages/distribution`. The mirror builder
  now copies the source package and a parity regression checks it. Plugin build/validate/smoke are
  GREEN.
- Frozen-tree evidence before independent sign-off: typecheck and engine build passed; focused R17
  contracts passed 59/59; full Vitest passed 3,850/3,850 in 388 files; full Playwright passed
  147/147. Validation, 60-unit starter simulation, balance, map compilation, web build, mobile and
  desktop scaffold packages, and Cargo 9/9 also passed. Any further source change invalidates this
  freeze and requires repeat gates and both verifier sign-offs.

## 2026-08-01 — R17 independent-review regressions and final gate freeze

- The first independent Code Verifier review rejected the candidate for root-symlink escape,
  staged-bundle mutation, incomplete provider verification, manifest/source-pack digest drift,
  incompatible ARR remix policy, unbounded tree hashing and incomplete staging cleanup. Each defect
  received a focused failing regression before repair. The final Node boundary now resolves and
  confines real paths, rejects special/oversized trees, re-hashes immediately before upload,
  consumes one-shot approval before crossing the provider boundary, verifies every remote file,
  preserves GitHub trees outside the deployment prefix, and deletes stale files inside it.
- The first Constructor Integration Verifier review proved that a global text scrub could corrupt
  legitimate authored public strings in generated HTML/JS/JSON. The scrub was removed and the
  package contract now asserts semantic preservation while continuing to reject secrets and local
  paths at the actual typed input boundary.
- The full browser run then exposed a Distribution form race: disk persistence became visible before
  the post-save reload completed, allowing a second edit to be overwritten. The same E2E scenario
  was the RED regression. Distribution writes now hold an explicit busy boundary through guarded
  apply and reload; a two-worker five-repeat stress run passed 5/5.
- The Studio publish path also exposed three locale-dependent tree-digest implementations. Build,
  Studio and publish orchestration now share one bounded, binary-stable
  `computePublishTreeDigestV1`; the complete prepare/confirm/filesystem verification scenario is
  GREEN.
- Final pre-sign-off evidence on this tree: typecheck, engine build, validate, starter simulation,
  balance, map compilation and web build passed; focused R17 contracts passed 73/73; full Vitest
  passed 3,868/3,868 in 389 files; full Playwright passed 147/147; plugin build/validate/smoke,
  mobile and desktop scaffold packages, and Cargo 9/9 passed. The tree is now frozen for the two
  independent repeat reviews.

## 2026-08-01 — R17 second verifier RED/GREEN integrity wave

- Code Verifier supplied an end-to-end chosen-boundary collision: `a = "Xb\\0Y"` and
  `a = "X", b = "Y"` produced the same unframed tree digest and allowed staged substitution.
  The exact scenario failed before production repair. Publish tree v1 now uses a format-domain
  prefix and per-file type/path-length/path/content-length/content-SHA-256 frames plus a terminal
  file count; Build, Studio and providers continue to share that one implementation.
- A realistic GitHub recursive-tree RED included structural `tree` entries for the deploy prefix and
  a nested asset. Upload incorrectly scheduled directory deletion and verify counted directories as
  stale files. GitHub upload now deletes stale non-tree leaves only; verification ignores structural
  tree nodes while still rejecting every unexpected blob/submodule leaf.
- Abandoned-candidate RED showed that expiry removed no CLI registry entry. Prepared candidates now
  carry TTL plus realpath/device/inode identities, registries have hard count limits, expired or
  missing candidates are pruned with staging cleanup, root symlink/special/replacement identities
  fail closed, and approvals are bounded and consumed on invalid candidate use.
- Constructor Integration Verifier supplied a double-Prepare RED. The browser now holds a busy
  single-flight boundary across publish preview/prepare/confirm, the server rejects concurrent
  preparation, replaces any previous prepared handle only after a successful new build, calls the
  canonical discard API on expiry/conflict/confirm, and discards every candidate during shutdown.
  The browser regression asserts exactly one staging directory after a synthetic double click and
  zero after confirmed publication.
- Focused repair evidence: provider/registry/Studio contracts passed 27/27 and the complete browser
  publish lifecycle passed 1/1. Because production changed, the prior full-gate evidence and both
  sign-offs are invalidated; a fresh exact-tree gate and independent review follow this entry.
- Fresh exact-tree gate evidence after the second repair: focused R17 passed 76/76; full Vitest
  passed 3,871/3,871 in 389 files; full Playwright passed 147/147. Typecheck, engine build,
  validation, 60-unit simulation, balance, map compilation, web build, plugin build/validate/smoke,
  mobile and desktop scaffold packaging, and Cargo 9/9 all passed. No production changes are
  permitted before both repeat reviewers report on this frozen tree.

## 2026-08-01 — R17 bounded concurrent preparation RED/GREEN

- The third Code Verifier audit demonstrated that 33 gated asynchronous prepare calls all passed a
  32-candidate limit because the registry slot was created only after build completion. The exact
  33-call scenario was committed as RED: 33 fulfilled, zero rejected.
- `preparePublishCandidate` now reserves an in-flight slot synchronously before its first `await`,
  admits work only while `PREPARED.size + PREPARED_IN_FLIGHT < 32`, and releases the reservation in
  `finally` on success or failure. The regression is GREEN with exactly 32 admitted candidates, one
  rejected call and zero staging directories after canonical discard.
- Final exact-tree evidence after this last production change: focused R17 passed 77/77; full
  Vitest passed 3,872/3,872 in 389 files; full Playwright passed 147/147. Typecheck, engine build,
  validation, 60-unit simulation, balance, map compilation, web build, plugin build/validate/smoke,
  mobile and desktop scaffold packaging, and Cargo 9/9 all passed. This is the final tree submitted
  for both independent sign-offs.
- Final independent reviews on that exact runtime tree: Code Verifier PASS and Constructor
  Integration Verifier PASS, with no P0–P3 findings. ADR 0058 is Accepted and R17 is complete;
  subsequent changes in this branch are documentation-only acceptance status and the isolated
  opt-in reference snippets under `docs/examples/opt-in-web-distribution/`.

## 2026-08-01 — R17 CI passive-balance race RED/GREEN

- The first PR CI run exposed an old Studio race after 146/147 browser scenarios passed: a passive
  balance request retained the pre-edit content revision while an external editor replaced project
  bytes, and the delayed endpoint surfaced the stale sweep as HTTP 500. The focused RED proved that
  `/api/balance` ignored an explicit stale `ifRevision` and ran a complete report.
- Passive balance requests now carry the exact project content hash. The server rejects malformed
  revisions, returns an inert HTTP 200 `stale` response before or after a concurrent edit, and keeps
  HTTP 500 for genuine failures on an unchanged revision. Studio discards the inert response rather
  than committing a stale report.
- The focused API regression and the original campaign lifecycle are GREEN. Fresh exact-tree gates
  passed: typecheck, engine build, Vitest 3,873/3,873, Playwright 147/147, validation, starter
  simulation, balance, map compilation, web build, plugin build/validate/smoke, mobile and desktop
  scaffold packaging, and Cargo 9/9. This source change invalidates the previous sign-offs and is
  frozen for two independent repeat reviews before merge.

## 2026-08-01 — v0.6.0 release assembly RED/GREEN

- The release audit found that the cross-platform assembler accepted any non-empty subset of its
  installer allowlist even though the publication policy promises all six formats. The RED suite
  supplied the complete candidate plus six missing-format cases, six duplicate-format cases and an
  unsupported replacement. Before production repair, 14/16 focused tests failed and incomplete
  candidates were copied into release output.
- The assembler now requires exactly one `.dmg`, `.exe`, `.msi`, `.AppImage`, `.deb` and `.rpm`
  before creating output. Duplicate basenames remain a separate early rejection; unrelated
  diagnostic files remain ignored. The focused release suite is GREEN at 16/16 and proves that
  `SHA256SUMS` and the release-note checksum block contain the same six installer hashes.
- Root, desktop npm, Tauri, Cargo, Codex plugin and MCP server versions are synchronized to v0.6.0.
  Current documentation describes the accepted R0–R17 baseline while preserving historical v0.5.2
  evidence. Full repository, browser, native, plugin and macOS bundle gates are required on this
  exact tree before the release PR can merge or the annotated tag can be created.

## 2026-08-01 — v0.6.1 Windows release recovery RED/GREEN

- The immutable annotated `v0.6.0` tag points to merge commit `217f96b`, but tag workflow
  `30699653133` stopped before publication. Windows job `91368289343` failed during generated-player
  package tests because a renderer export was pruned with an LF-only literal after Windows checkout
  converted the source to CRLF. No public v0.6.0 Release or partial installer set was created; the
  tag remains incident evidence and is not moved or reused.
- Focused RED command `npm run test -- --run packages/cli/lib/optional-export-pruning.test.mjs`
  failed before collection because the strict cross-platform pruning contract did not exist. An
  independent review then found the same latent LF-only defect in both inactive Macro-Economy
  exports and its validation import.
- The shared pure helper now accepts exactly one anchored LF, CRLF, or EOF module statement,
  preserves every unrelated byte, validates the relative specifier, and rejects missing or
  duplicate statements. Replay Lab and all Macro-Economy pruning sites use the same helper. Focused
  GREEN covers LF/CRLF/EOF, mixed endings, malformed inputs, false positives, both opt-in domains,
  and the original package paths: 25/25 tests passed.
- Release domains are synchronized to v0.6.1. Before this patch is tagged, the exact merged commit
  must pass full local gates, two fresh independent reviews, ordinary PR CI, and a manual
  cross-platform `Unsigned Desktop Builds` candidate. Only then may a new annotated `v0.6.1` tag
  trigger public unsigned pre-release assembly and post-download verification.
- The frozen local candidate passes typecheck, engine build, Vitest 3,905/3,905, Playwright
  147/147, project validation, tutorial simulation, balance, map compilation, web build, plugin
  build/validate/smoke, mobile and desktop scaffold packaging, and Cargo 9/9. The local Apple
  Silicon DMG `TowerForge_0.6.1_aarch64.dmg` passes complete app signature plus DMG verification;
  its local SHA-256 is `b4da9cd045e04d6e24c29336cdb6d43d0735ee20fc1403eca897322990385a0c`.
- The first Constructor/Release review found one P2 documentation-parity defect: `README.en.md` and
  the compact engine review still described open R12/R13 PRs and planned R14–R17. They now identify
  public v0.5.2 as the R0–R14 baseline, accepted/merged R15–R17, the aborted immutable v0.6.0 tag,
  and v0.6.1 as the replacement candidate. This docs-only repair invalidates both prior sign-offs;
  the amended exact commit requires a fresh verification pair and CI before merge.

## 2026-08-02 — R18 large-screen player foundation RED

- Contract freeze adds tests only for four public boundaries: shared `ViewportTransformV1`, the
  generated-player action/preferences/session runtime, project v5 plus BuildTargets v2 desktop
  form-factor validation, and opt-in desktop player packaging. No production implementation is
  included in this RED slice; the schema-v1 starter remains the required compatibility path.
- RED command:
  `npx vitest run packages/renderer/src/viewport-transform.contract.test.mjs packages/player-runtime/src/r18-player-runtime.contract.test.mjs packages/cli/lib/r18-build-targets.contract.test.mjs packages/cli/build.r18-large-screen-package.contract.test.mjs`.
- Expected result: 4/4 files failed, with 16 failed and 3 passing assertions. The renderer import
  reports missing `viewport-transform.mjs`; the public player-runtime exports are absent; the CLI
  still reports project schema v5 as newer than supported v4 and does not validate closed
  BuildTargets v2 fields; the opt-in desktop build therefore stops before emitting its desktop
  shell/PWA/runtime markers. The untouched legacy build assertion remains green and ships none of
  the R18-only marker/modules.

## 2026-08-02 — v0.6.1 published and independently verified

- PR #32 merged as `db1dd07`; its tree is byte-identical to twice-reviewed exact head `6b65c21`.
  PR CI `30701086156`, main CI `30701673183`, Code Verifier and Constructor/Release Integration
  Verifier all passed with no P0–P3 findings.
- Required pre-tag workflow `30701697798` ran on exact merge SHA and completed macOS, Windows,
  Linux and strict six-installer assembly successfully. The annotated `v0.6.1` tag dereferences to
  `db1dd07`; tagged desktop workflow `30703649784` and plugin export `30703649782` completed SUCCESS.
- GitHub published unsigned pre-release
  `https://github.com/Lindforge-Studios/TowerForge/releases/tag/v0.6.1` with exactly six installers
  and `SHA256SUMS`. All downloaded installers passed the published checksum file; the downloaded
  Apple Silicon DMG passed strict bundle signature, architecture, embedded Node startup and
  container verification.
- Public Codex plugin mirror sync `30705822141` completed SUCCESS. Its v0.6.1 manifest reports
  TowerForge/plugin/MCP `0.6.1` and exact source commit `db1dd07`, and the mirror annotated tag was
  created without moving an existing tag.

## 2026-08-02 — R18.3–R18.4 generated desktop carrier RED

- Contract/Test Designer added only `packages/cli/build.r18-session-pwa.contract.test.mjs`; no
  production source was changed by this slice. The bounded contract covers the opt-in desktop
  carrier's IndexedDB-backed two-slot session storage, Continue and autosave wiring, localStorage-
  only preferences, digest-before-restore behavior, corrupt/future fail-closed results, localized
  PWA metadata, favicon/localized strings, accessible 44 px actions, reduced motion, quality
  settings, and the untouched schema-v1 legacy output path.
- Exact RED command:
  `npm run test -- --run packages/cli/build.r18-session-pwa.contract.test.mjs`.
  Result: expected failure, 1 file; 3 failed and 1 passed of 4 tests. The desktop build does not yet
  emit `player-runtime/indexeddb-session-storage.mjs`; the rotating store restores a mismatched
  `contentDigest` instead of returning `session_content_mismatch`; and the desktop web manifest
  lacks the authored `lang` plus the remaining extended PWA/accessibility metadata. The legacy
  target assertion is already green and proves it imports/emits none of these R18-only surfaces.

## 2026-08-02 — R18 generated desktop player acceptance RED

- Contract/Test Designer added only `tests/e2e/r18-large-screen-player.spec.mjs`; no production
  source was changed by this slice. The bounded Playwright matrix covers Canvas/Phaser and
  hex/square at 1024×720, 1920×1080, and 3440×1440, including wheel zoom, reset, middle-button
  pan, input gating, pointer hit/placement after camera transforms, tower upgrade, rotating
  Continue save/restore with checkpoint/content digests, 44 px actions, localized settings,
  ARIA dialog semantics, preference persistence, and focus return.
- Exact RED command:
  `npx playwright test tests/e2e/r18-large-screen-player.spec.mjs --workers=1`.
  Result: expected failure, 4/4 tests failed. In every Canvas/Phaser × hex/square case, pressing
  Escape while the desktop quality `select` owns focus leaves `#desktop-settings-dialog` visible
  instead of closing the modal and returning focus to `#desktop-settings`. The remaining tested
  viewport, camera, pointer, placement, action, and shell prerequisites reached this shared
  accessibility boundary without browser errors.

## 2026-08-02 — R18 verifier repair RED: storage ordering, ownership and action registry

- Contract/Test Designer added only
  `packages/player-runtime/src/r18-verifier-repairs.regression.test.mjs` and
  `packages/cli/build.r18-verifier-repairs.regression.test.mjs`; production was not changed by
  this repair slice. The regressions freeze invocation-order serialization for concurrent rotating
  saves, IndexedDB ownership of desktop PlayerProfileV3/session/story data with localStorage
  reserved for PlayerPreferencesV1, one complete runtime action registry, registry-routed desktop
  shell/hotkeys, and the unchanged legacy storage/output path.
- Exact RED command:
  `npx vitest run packages/player-runtime/src/r18-verifier-repairs.regression.test.mjs packages/cli/build.r18-verifier-repairs.regression.test.mjs --reporter=verbose`.
  Result: expected failure, 2 files; 4 failed and 1 passed of 5 tests. A controlled delayed older
  save overwrites the newer successful call and loads `older`; `createPlayerActionRegistry` is not
  exported; the generated desktop player still creates the PlayerProfileV3 port from localStorage
  and reads/writes story markers there; and its shell/hotkeys call game/camera functions directly
  instead of the shared registry. The legacy target control is GREEN and retains its existing
  localStorage path without R18 IndexedDB/action-registry imports.

## 2026-08-02 — R18 verifier repair RED: hostile authoring, IndexedDB commit and PWA shortcut

- Contract/Test Designer added only
  `packages/cli/lib/r18-player-target-authoring-hardening.regression.test.mjs`,
  `packages/player-runtime/src/indexeddb-session-storage.regression.test.mjs`, and
  `packages/cli/build.r18-pwa-shortcut.regression.test.mjs`; this slice changed no production.
  The tests require direct preview/apply to reject accessor, Proxy, symbol, sparse, cyclic and
  over-budget candidates without executing getters/traps or writing, require IndexedDB writes and
  removals to settle on transaction completion and reject transaction abort/error, and require the
  advertised Continue shortcut either to use the implemented root URL or invoke Continue through
  the shared registry exactly once.
- Exact focused command:
  `npx vitest run packages/cli/lib/r18-player-target-authoring-hardening.regression.test.mjs packages/player-runtime/src/indexeddb-session-storage.regression.test.mjs packages/cli/build.r18-pwa-shortcut.regression.test.mjs --reporter=verbose`.
  Result: expected failure, 3 files; 3 failed and 8 passed of 11 tests. Direct authoring executes an
  enumerable accessor getter and accepts a symbol-keyed target; the PWA manifest publishes
  `./?action=continue`, but generated player source never consumes `action` or invokes Continue via
  the registry. Proxy, sparse, cyclic and over-budget controls already reject without observed
  traps/writes. The four IndexedDB durability regressions are GREEN on the concurrently repaired
  shared source: set/remove wait for transaction completion and abort/error reject after request
  success.

## 2026-08-02 — R18 verifier repair RED: 1024 px hit targets and central action routing

- Contract/Test Designer added only `tests/e2e/r18-desktop-hit-targets.spec.mjs` and
  `packages/cli/build.r18-central-actions-registry.regression.test.mjs`; this slice changed no
  production. The browser regression uses `elementFromPoint` plus real pointer clicks to protect
  Mission, Difficulty, Tower, Start and Pause at 1024×720. The generated-source regression
  requires Canvas and Phaser pointer/touch/keyboard gameplay plus artifact, module and hero-skill
  management to pass through PlayerActionRegistry, with the untouched legacy target as control.
- Exact RED commands:
  `npx vitest run packages/cli/build.r18-central-actions-registry.regression.test.mjs --reporter=verbose`
  and
  `npx playwright test tests/e2e/r18-desktop-hit-targets.spec.mjs --workers=1`.
  Results: Vitest expected failure, 1 file with 2 failed and 1 passed of 3 tests; both generated
  Canvas and Phaser `actAtCoord` paths still call placement, sell, mission ability, hero move and
  hero ability mutations directly instead of `playerActionRegistry.invoke`, while the legacy
  direct-path control is GREEN. Playwright expected failure, 1/1 failed: at 1024×720
  `elementFromPoint` at the center of `#mission-select` returns `#desktop-action-bar`, proving the
  overlay blocks the primary HUD before the actual-click assertions can run.

## 2026-08-02 — R18 CI repair RED: deterministic Phaser/WebGL teardown

- GitHub run `30735063278` reached 153/154 existing acceptance tests, then the final Phaser
  3440×1440 case exhausted its 120-second budget inside `context.close()` after all gameplay
  assertions had passed; Chromium logged SharedImageManager GPU mailbox failures. Contract/Test
  Designer changed only `tests/e2e/r18-large-screen-player.spec.mjs`: every Phaser case must now
  expose a generated-player `__towerforgeDispose` lifecycle hook which removes its canvas and loses
  the WebGL context before Playwright closes the browser context. Viewport coverage and timeout stay
  unchanged. A test-side fallback explicitly releases the graphics context during RED so the
  regression itself cannot strand the constrained CI GPU process.
- Exact focused RED command:
  `npx playwright test tests/e2e/r18-large-screen-player.spec.mjs --workers=1 --grep "phaser/square desktop target works at 3440x1440"`.
  Result: expected failure, 1/1 failed in 4.5 seconds after all prior assertions. Teardown proof was
  `{ disposeHookAvailable: false, canvasConnected: false, contextLost: true }`: the bounded fallback
  deterministically released WebGL and removed the canvas, while the missing generated hook remains
  the sole RED boundary. GREEN requires the same proof with `disposeHookAvailable: true`, followed
  by the unchanged full 6-case acceptance matrix on the exact candidate.

## 2026-08-02 — R18 CI repair focused GREEN

- Generated large-screen Phaser players now own an idempotent `__towerforgeDispose` lifecycle:
  the Phaser game is destroyed, its WebGL context is explicitly lost, its canvas is removed, and a
  `pagehide` listener invokes the same path during real navigation/close. Legacy and Canvas players
  do not receive this desktop-Phaser-only hook.
- Exact former-failure command passed 1/1 in 6.1 seconds:
  `npx playwright test tests/e2e/r18-large-screen-player.spec.mjs --workers=1 --grep "phaser/square desktop target works at 3440x1440"`.
  The unchanged six-viewport matrix plus compact hit-target regression passed 7/7 with one worker
  in 15.0 seconds, and the combined R18 unit/contract set remained GREEN at 18 files, 78/78 tests.
- GitHub run `30735063278` is retained as the RED evidence (153/154, timeout in WebGL teardown).
  Because this production change invalidates the previous freeze and both sign-offs, the full exact
  gates and both independent verifiers must run again before PR merge.

## 2026-08-02 — R18 verifier repair GREEN: hit targets, action routing and camera evidence

- Replaced the compact desktop action overlay with an in-flow, wrapping action bar, so its real
  pointer hit region no longer covers Mission, Difficulty, Tower, Start or Pause at 1024×720.
- Routed Canvas and Phaser central map interactions plus artifact socketing, runtime module
  configuration and hero-skill unlocks through the shared `PlayerActionRegistry` for desktop
  targets. Compile-time legacy branches retain their direct action path and unchanged output.
- Exposed a desktop-only read-only viewport snapshot for browser acceptance. Camera tests now
  assert authoritative zoom/pan state: zoom-at-pointer is no longer incorrectly inferred from
  movement of the anchored world point, and modal input blocking tolerates Phaser vertical
  recentering while proving that horizontal pan and zoom did not consume keyboard/wheel input.
- Exact focused GREEN command:
  `npx vitest run packages/renderer/src/viewport-transform.contract.test.mjs packages/renderer/src/r18-canvas-viewport-integration.contract.test.mjs packages/player-runtime/src/player-actions.contract.test.mjs packages/player-runtime/src/player-preferences.contract.test.mjs packages/player-runtime/src/player-session-store.contract.test.mjs packages/player-runtime/src/r18-player-runtime.contract.test.mjs packages/cli/lib/r18-build-targets.contract.test.mjs packages/cli/build.r18-large-screen-package.contract.test.mjs packages/cli/build.r18-viewport-integration.contract.test.mjs packages/cli/build.r18-session-pwa.contract.test.mjs packages/mcp/r18-player-targets-authoring.contract.test.mjs packages/studio/r18-player-targets-surface.contract.test.mjs packages/player-runtime/src/r18-verifier-repairs.regression.test.mjs packages/player-runtime/src/indexeddb-session-storage.regression.test.mjs packages/cli/build.r18-verifier-repairs.regression.test.mjs packages/cli/lib/r18-player-target-authoring-hardening.regression.test.mjs packages/cli/build.r18-pwa-shortcut.regression.test.mjs packages/cli/build.r18-central-actions-registry.regression.test.mjs --reporter=dot`.
  Result: 18 files, 78/78 tests passed.
- Exact focused browser command:
  `npx playwright test tests/e2e/r18-large-screen-player.spec.mjs tests/e2e/r18-desktop-hit-targets.spec.mjs --workers=1`.
  Result: 7/7 passed for the six required viewports plus the compact hit-target regression.

## 2026-08-02 — R18 freeze compatibility repair

- The first full `npm run test` freeze attempt correctly rejected the candidate: 30/3983 tests
  failed because split compile-time template expressions made the legacy source-contract brace
  scanner lose the end of both player templates, and the R14 source assertion still required the
  former no-argument arsenal helper call. Runtime-focused R18 tests had remained GREEN, so this was
  treated as a compatibility-contract failure rather than ignored as test noise.
- Re-expressed hero move, hero ability and skill commands as balanced complete compile-time
  alternatives. Generated legacy players retain the original inline `dispatchGameCommand` command
  envelopes, while desktop players emit only the registry invocation. Updated the R14 assertion to
  the parameterized helper contract used to keep desktop and legacy outputs separate.
- Exact compatibility GREEN command:
  `npx vitest run packages/cli/build.logistics-power.contract.test.mjs packages/cli/build.logistics-ammunition.contract.test.mjs packages/cli/build.logistics-ammunition-supply.contract.test.mjs packages/cli/build.heroes-skill-tree.contract.test.mjs packages/cli/build.heroes-passive-aura.contract.test.mjs packages/cli/build.heroes-movement.contract.test.mjs packages/cli/build.heroes-foundation.contract.test.mjs packages/cli/build.heroes-active-ability.contract.test.mjs packages/cli/build.heroes-blocking.contract.test.mjs packages/cli/build.r14-arsenal-package.contract.test.mjs --reporter=dot`.
  Result: 10 files, 33/33 tests passed. The combined R18/legacy command covering the new central
  registry regression plus R14 and the three command-envelope contracts passed 5 files, 13/13.

## 2026-08-02 — R18 exact-candidate gate evidence

- The candidate immediately preceding this evidence-only entry (`62fc0b456dd72adedc5634f58d4e005f99346f1d`)
  passed the complete required gate set with a clean working tree: `npm run typecheck`,
  `npm run build:engine`, `npm run test` (408 files, 3983/3983 tests), `npm run validate`,
  `npm run sim tutorial_01 60`, `npm run build`, and `npm run test:e2e` (154/154).
- Codex plugin parity passed `npm run plugin:build`, `npm run plugin:validate` and
  `npm run plugin:smoke`. The exact source also passed both packaging commands for the starter
  (`mobile` and `desktop`) and `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml`
  (9/9). No generated or package artifact dirtied the source tree.
- This entry is the final documentation-only change before the independent Code Verifier and
  Constructor Integration Verifier freeze. The same complete gate set is repeated on the commit
  containing this entry; any later source or documentation change invalidates the evidence and
  both sign-offs.

## 2026-08-02 — R18 verifier repair focused GREEN

- Serialized the rotating session-store mutation queue, made IndexedDB write/remove operations
  settle only after transaction commit, and moved desktop profile/story/session ownership to one
  IndexedDB data port while keeping localStorage limited to `PlayerPreferencesV1`.
- Added one complete `PlayerActionDescriptorV1` registry used by the desktop shell, camera hotkeys,
  gameplay shortcuts and the PWA Continue launch action. Direct player-target preview/apply now
  rejects accessors, proxies, symbol keys, sparse/cyclic inputs and authored data over budget before
  executing input code or writing project files.
- Exact focused GREEN command:
  `npx vitest run packages/player-runtime/src/r18-verifier-repairs.regression.test.mjs packages/player-runtime/src/indexeddb-session-storage.regression.test.mjs packages/cli/build.r18-verifier-repairs.regression.test.mjs packages/cli/lib/r18-player-target-authoring-hardening.regression.test.mjs packages/cli/build.r18-pwa-shortcut.regression.test.mjs`.
  Result: 5 files, 16/16 tests passed.
- Combined R18 contract command (the original 12 focused files plus all five verifier-repair files)
  passed 17 files and 75/75 tests. The exact browser acceptance command
  `npx playwright test tests/e2e/r18-large-screen-player.spec.mjs --workers=1` passed 6/6 after
  repair for Canvas/Phaser, hex/square, all six required desktop viewports and DPR 1/2.

## 2026-08-02 — R18.1 shared viewport integration RED

- Contract/Test Designer added only
  `packages/renderer/src/r18-canvas-viewport-integration.contract.test.mjs` and
  `packages/cli/build.r18-viewport-integration.contract.test.mjs`; no production source was changed
  by this slice. The focused contract requires one injected shared transform for Canvas draw and
  inverse pointer hit-testing, delegates pan/zoom/reset to that transform, and requires an opt-in
  generated Phaser desktop player to import the same viewport runtime while gating camera gestures
  away from gameplay actions and editable controls. The schema-v1 legacy player remains the
  compatibility control and must contain none of the R18-only runtime or controls.
- Exact RED command:
  `npx vitest run packages/renderer/src/r18-canvas-viewport-integration.contract.test.mjs packages/cli/build.r18-viewport-integration.contract.test.mjs --reporter=dot`.
  Result: expected failure, 2 files; 2 failed and 3 passed of 5 tests. Canvas already projects draw
  coordinates through the injected transform and exposes its camera delegates, but `pickTile` does
  not call `screenToWorld`, so transformed pointer coordinates cannot be resolved consistently.
  The generated desktop Phaser player does not yet import `createViewportTransformV1` or expose the
  gated pan/zoom/reset integration. Both legacy assertions are green: Canvas without the option
  preserves exact legacy coordinates and the schema-v1 player emits no viewport-only module or
  camera-control symbols.

## 2026-08-02 — R18 authoring surfaces RED

- The independent Contract/Test Designer added only
  `packages/mcp/r18-player-targets-authoring.contract.test.mjs` and
  `packages/studio/r18-player-targets-surface.contract.test.mjs`; no production source was changed
  by this slice. The MCP contract freezes the exact target-local workflow
  `describe_schema(playerTargets) -> read_player_targets ->
  get_player_target_recipe(desktop_large_screen) -> preview_player_target ->
  apply_player_target(ifRevision) -> validate_project`. Read, recipe and preview are inert; apply
  owns the atomic project-v5/BuildTargets-v2 promotion, validation, backup and rollback while
  preserving every existing legacy target byte-for-byte.
- The Studio source/API contract retains ordinary `Add target` as the schema-v1 legacy action and
  requires a separate explicit Large-screen desktop preset, all closed v2 target fields, and a
  narrow preview/apply route using the same guarded transaction. Agent instructions must teach the
  exact workflow and explain that a desktop target never changes another target's template path.
- Exact RED command:
  `npx vitest run packages/mcp/r18-player-targets-authoring.contract.test.mjs packages/studio/r18-player-targets-surface.contract.test.mjs --reporter=dot`.
  Result: expected failure, 2 files and 7/7 tests failed. `playerTargets` is not a recognized schema
  domain; all four narrow tools and the `desktop_large_screen` recipe are absent; agent guide v50
  has no R18 workflow; and Studio has neither the explicit desktop preset nor its narrow API or v2
  editors. These failures occurred after the legacy Add-target control was confirmed present.

## 2026-08-02 — R18 focused GREEN before freeze

- Implemented the explicit project-v5/BuildTargets-v2 desktop carrier without changing schema-v1
  targets: one pure shared viewport transform now owns contain/center, bounded pan/zoom and inverse
  hit testing for Canvas and Phaser; the DOM shell owns player actions, keyboard/pointer controls,
  preferences, localized settings/results and accessibility.
- Added renderer-neutral `PlayerActionDescriptorV1`, `PlayerPreferencesV1` and
  `PlayerSessionSaveV1`, plus an injected IndexedDB adapter and rotating two-slot store. Restore
  rejects content mismatch before simulation construction; generated desktop players autosave at
  command/wave/lifecycle boundaries while localStorage remains preferences-only.
- Added the exact guarded authoring flow
  `describe_schema(playerTargets) -> read_player_targets ->
  get_player_target_recipe(desktop_large_screen) -> preview_player_target ->
  apply_player_target(ifRevision) -> validate_project`, shared by MCP and Studio. Apply preserves
  legacy targets, promotes both schemas atomically, validates, backs up and rolls back.
- Focused GREEN command:
  `npx vitest run packages/renderer/src/viewport-transform.contract.test.mjs packages/renderer/src/r18-canvas-viewport-integration.contract.test.mjs packages/player-runtime/src/player-actions.contract.test.mjs packages/player-runtime/src/player-preferences.contract.test.mjs packages/player-runtime/src/player-session-store.contract.test.mjs packages/player-runtime/src/r18-player-runtime.contract.test.mjs packages/cli/lib/r18-build-targets.contract.test.mjs packages/cli/build.r18-large-screen-package.contract.test.mjs packages/cli/build.r18-viewport-integration.contract.test.mjs packages/cli/build.r18-session-pwa.contract.test.mjs packages/mcp/r18-player-targets-authoring.contract.test.mjs packages/studio/r18-player-targets-surface.contract.test.mjs --reporter=dot`.
  Result: 12 files, 59/59 tests passed.
- The acceptance RED localized Escape handling inside the settings form. After moving the modal
  close guard ahead of the editable-control camera guard, exact Playwright command
  `npx playwright test tests/e2e/r18-large-screen-player.spec.mjs --workers=1` passed 6/6 for
  Canvas/Phaser × hex/square at 1024×720, 1280×720, 1440×900, 1920×1080, 2560×1440 and
  3440×1440 with DPR 1/2, including transformed pointer/touch
  placement, pan/zoom/reset, input gating, upgrade, IndexedDB Continue digest restore, preferences,
  ARIA, focus return and reduced motion.
- Pre-freeze gates are GREEN: `npm run typecheck`, `npm run build:engine`, `npm run test`,
  `npm run validate`, `npm run sim tutorial_01 60`, `npm run build`, full Playwright 151/151 before
  the test-only viewport expansion, plugin build/validate/smoke, mobile and desktop package
  generation, and Tauri `cargo test` 9/9. The exact candidate still requires the final full E2E
  rerun and both independent sign-offs after commit freeze.

## 2026-08-02 — R18 verifier repair RED: BFCache-safe Phaser lifecycle

- For Code Verifier finding P1 against candidate `070ffd2`, the Contract/Test Designer added only
  `packages/cli/build.r18-phaser-lifecycle.regression.test.mjs` and
  `tests/e2e/r18-phaser-lifecycle.spec.mjs`; no production source was changed. The contract requires
  a persisted BFCache `pagehide` to preserve the Phaser game and connected canvas, a subsequent
  persisted `pageshow` to remain interactive, and only a non-persisted `pagehide` to dispose. It
  also requires repeated or concurrent `__towerforgeDispose()` calls to share one stable promise,
  settle idempotently, and never depend on `requestAnimationFrame`, which may be suspended while a
  page is hidden. A schema-v1 Phaser target remains the legacy compatibility control.
- Exact static RED command:
  `npx vitest run packages/cli/build.r18-phaser-lifecycle.regression.test.mjs --reporter=verbose`.
  Result: expected failure, 1 file; 2 failed and 1 passed of 3 tests. The generated desktop Phaser
  player ignores `PageTransitionEvent.persisted`, registers the lifecycle listener with
  `{ once: true }`, and its disposer awaits `requestAnimationFrame` instead of returning a stable
  single-flight promise. The legacy target correctly emits none of the R18 lifecycle bridge.
- Exact browser RED command:
  `npx playwright test tests/e2e/r18-phaser-lifecycle.spec.mjs --workers=1`.
  Result: expected failure, 2/2 tests failed. Dispatching `pagehide` with `persisted: true`
  immediately removed the Phaser canvas, so the following persisted `pageshow` had no connected
  `#playfield canvas`. Three concurrent disposer calls returned different promises and observed
  `{ canvasConnected: false, rafCalls: 1, samePromise: false, settled: true }`, while the frozen
  contract requires zero animation-frame calls and one shared promise. GREEN must preserve an
  operational canvas and hit test across the BFCache cycle, dispose on `persisted: false`, and keep
  repeated disposal hidden-page-safe and idempotent.

## 2026-08-02 — R18 verifier repair focused GREEN: BFCache-safe Phaser lifecycle

- Replaced the async/rAF disposer with one stable `disposePromise` owned by a regular function.
  Graphics teardown executes synchronously, every caller receives the same settling promise, and
  destroy/context-loss/canvas-removal are attempted independently so one cleanup failure cannot
  skip the remaining resources.
- The persistent `pagehide` listener now ignores `event.persisted === true`; the live Phaser game,
  canvas and hit-testing survive the paired persisted `pageshow`. Only a final non-persisted
  `pagehide` invokes teardown. Canvas and legacy generated players remain free of the lifecycle
  hook.
- Exact static GREEN command passed 3/3:
  `npx vitest run packages/cli/build.r18-phaser-lifecycle.regression.test.mjs --reporter=verbose`.
  Exact browser GREEN command passed 2/2:
  `npx playwright test tests/e2e/r18-phaser-lifecycle.spec.mjs --workers=1`.
  The combined R18 browser acceptance passed 9/9 with one worker in 17.6 seconds, and the combined
  R18 unit/contract set passed 19 files, 81/81 tests.
- This source repair invalidates candidate `070ffd2` and its incomplete verifier cycle. A new exact
  commit must repeat all gates and both independent sign-offs before PR merge.

## 2026-08-02 — R18 GitHub Linux/SwiftShader teardown RED

- GitHub CI run `30737080851` supplied the exact post-freeze RED on candidate `2aad7ed`: full
  Playwright completed 154/156, then the 3440×1440 Phaser case timed out while Playwright closed
  its browser context after the generated disposer had already destroyed Phaser, lost WebGL and
  detached the canvas. Chromium reported stale `SharedImage` mailboxes during trace finalization.
- The same run exposed an over-specific BFCache assertion: the live marked canvas remained attached
  and interactive, but responsive layout legitimately resized its backing height from 587 to 544
  after the synthetic persisted page transition. BFCache identity and hit-testing are the contract;
  a frozen pixel size is not.
- The test repair must navigate the already-disposed Phaser document to `about:blank` before closing
  the Playwright context, avoid scheduling an animation frame after teardown, and prove same-canvas
  identity with a marker plus live hit-testing while allowing responsive backing-size changes.
  Production runtime contracts remain unchanged. Any test-source change invalidates both previous
  sign-offs and requires a new exact candidate, full gates and independent re-verification.

## 2026-08-02 — R18 GitHub Linux/SwiftShader test repair focused GREEN

- The BFCache browser contract now marks the live canvas, permits responsive backing-size changes,
  requires positive dimensions, and proves inverse hit-testing still returns the exact authored
  tile after persisted `pagehide`/`pageshow`.
- Phaser acceptance captures and asserts successful generated disposal, then navigates the already
  detached WebGL document to `about:blank` before Playwright closes its context. The redundant
  post-disposal animation-frame wait was removed, so trace finalization cannot depend on a stale
  SwiftShader `SharedImage` mailbox.
- Exact focused GREEN command:
  `npx playwright test tests/e2e/r18-phaser-lifecycle.spec.mjs tests/e2e/r18-desktop-hit-targets.spec.mjs tests/e2e/r18-large-screen-player.spec.mjs --workers=1`.
  Result: 9/9 passed in 18.0 seconds. Static lifecycle regression remains GREEN at 3/3. Production
  runtime code was not changed; the test-source repair still requires a new freeze, full gates and
  both independent sign-offs.

## 2026-08-02 — R18 large-surface trace fixture RED

- GitHub CI run `30738248893` validated the first Linux/SwiftShader repair: BFCache passed and
  155/156 browser scenarios completed. The 3440×1440 Phaser scenario reached the generated
  disposer and blank-document detachment, then Playwright 1.61.1 failed only in its retained
  `trace recording` fixture with a 60-second setup timeout and an unbound diagnostic handle. The
  report contained no production, graphics-disposal or `context.close` failure.
- The bounded harness repair disables retained tracing only for the six-case R18 large-screen
  viewport file. All real Chromium contexts, viewport/DPR combinations, Canvas/Phaser assertions,
  pointer/touch/keyboard input, inverse hit tests, placement, session restore, accessibility,
  page-error collection and explicit graphics teardown checks remain active. The dedicated Phaser
  lifecycle suite retains normal tracing.
- Expected GREEN command:
  `npx playwright test tests/e2e/r18-large-screen-player.spec.mjs tests/e2e/r18-phaser-lifecycle.spec.mjs tests/e2e/r18-desktop-hit-targets.spec.mjs --workers=1`.
  Focused result: 9/9 passed in 17.3 seconds. This test-source change creates another exact
  candidate and requires the complete gate/sign-off cycle before merge.

## 2026-08-02 — R18 responsive reset assertion RED

- The exact full local gate after isolating the trace-disabled viewport file completed 155/156.
  Its separate Playwright worker exposed an existing responsive-layout race at 1280×720 touch:
  `Reset view` restored the authored zoom and live inverse mapping, while a late 21-pixel playfield
  height change legitimately re-centered the same tile. The old assertion incorrectly required
  the pre-reflow screen-space Y coordinate to remain within 0.75 pixels.
- The acceptance contract now checks the real boundary: reset restores the authored zoom and the
  post-reset projected point inverse-picks the exact authored tile. Fixed pixel placement across a
  responsive playfield resize is not required. The combined R18 browser command passed 9/9 in
  18.2 seconds. Full gates must be repeated on the next exact candidate before independent sign-off.

## 2026-08-02 — R18 ultrawide CI deadline RED

- GitHub CI run `30739674600` completed every static, unit, build and plugin gate and 155/156
  browser scenarios on candidate `e4d05d9`. The final Phaser/square 3440×1440 scenario reached
  its explicit `context.close()` after the generated disposer had already destroyed Phaser, lost
  the WebGL context and detached the canvas, but the test-wide 120-second deadline cancelled that
  close on the slower shared Linux/SwiftShader runner.
- The harness repair keeps the strict 120-second test bound and moves browser-context ownership to
  the standard Playwright fixture, whose teardown has its own bounded lifecycle after the test.
  All product assertions, page-error collection, direct disposer checks and WebGL context-loss
  checks remain active; no close is swallowed or raced and production code is unchanged. Expected
  GREEN is the exact focused browser command followed by a fresh GitHub full gate on the new frozen
  commit.

## 2026-08-02 — R18 ultrawide full-suite budget RED

- GitHub CI run `30740569700` proved that fixture-owned context teardown alone was insufficient:
  155/156 scenarios passed, but the last 3440×1440 Phaser case exhausted its strict 120-second
  test budget before `releaseGeneratedGraphics` could return on the already-loaded shared Linux
  worker. The resulting null teardown matcher was a secondary timeout symptom; no product
  assertion failed.
- The bounded harness contract now gives only that named ultrawide Phaser case 180 seconds. It
  still requires the generated disposer to return, the canvas to detach and the WebGL context to
  report lost, then explicitly closes the already-blank page before fixture teardown. The other
  five cases remain at 120 seconds, and neither production code nor global Playwright limits are
  changed.

## 2026-08-02 — R18 touch-context wheel delivery RED

- The exact full local browser gate after the ultrawide repair completed 154/156. The 3440×1440
  case passed, while the existing 1280×720 `hasTouch` case exposed a Playwright/Chromium host-input
  flake: `page.mouse.wheel` was occasionally suppressed by touch-only emulation and the authored
  viewport therefore remained at its reset zoom. The same run also reported an unrelated existing
  R17 Studio save-poll timeout, which must pass on focused rerun before freeze but is outside R18.
- The touch case now dispatches the same bounded, cancelable `WheelEvent` directly to the real
  playfield target through the existing helper. Non-touch desktop cases continue to use the host
  mouse wheel, while touch placement still uses the real touchscreen API. This changes only the
  acceptance harness and keeps the camera input contract intact.

## 2026-08-02 — R18 Linux shared-GPU process isolation RED

- GitHub CI run `30741585723` passed the first 155 scenarios but the final ultrawide Phaser case
  exhausted even its scoped 180-second budget after 149 earlier browser scenarios had used the
  same Linux/SwiftShader process. On a fresh browser the exact six-case matrix repeatedly completes
  in seconds, so increasing a product-test timeout again would hide process-level resource
  degradation rather than verify more behavior.
- CI now runs the 150 ordinary scenarios first and the tagged six-case R18 large-screen matrix in
  a second sequential Playwright process. The commands remain one-worker and cover the same 156
  scenarios; no test is skipped from the combined gate. Local `npm run test:e2e` remains unchanged
  and continues to run the whole suite in one command.

## 2026-08-02 — R18 per-viewport browser lifecycle RED

- GitHub CI run `30742324708` proved that a fresh Playwright command was not a sufficient graphics
  boundary: the 150-case core gate passed and the isolated matrix completed its first five cases,
  but the sixth 3440×1440 Phaser case timed out while focusing `#desktop-quality` after the same
  worker-scoped Chromium/SwiftShader process had rendered the preceding five large surfaces.
- The failure occurred before the final case's interaction assertions and did not report a player
  exception, missing control, failed WebGL disposal or product contract mismatch. The matrix now
  launches and closes one Chromium process per viewport case while retaining every viewport/DPR,
  input, inverse-hit-test, gameplay, accessibility, session and explicit WebGL teardown assertion.
  No production source, global timeout, retry or assertion is weakened.
- Expected focused GREEN command:
  `npx playwright test tests/e2e/r18-large-screen-player.spec.mjs --workers=1`.
  This test-source change invalidates candidate `22dd6ba`, both prior sign-offs and its failed CI;
  the next exact candidate must repeat the complete gate and independent verification cycle.

## 2026-08-02 — R18 per-viewport browser lifecycle focused GREEN

- The exact focused command
  `npx playwright test tests/e2e/r18-large-screen-player.spec.mjs --workers=1` passed 6/6 in
  18.7 seconds. Every case creates a real Chromium process with its authored viewport, DPR, touch
  and reduced-motion settings, executes the unchanged product assertions, proves explicit Phaser
  disposal where applicable, and closes its context and browser before the next large surface.
- The ordinary 150-case gate and local `npm run test:e2e` discovery remain unchanged; the tagged
  matrix still contributes exactly the same six scenarios. Full exact-commit gates, GitHub CI and
  both independent sign-offs remain required before merge.

## 2026-08-02 — R18 runner-level SwiftShader isolation RED

- GitHub CI run `30743125954` passed the complete 150-case core gate on candidate `b8ca204` and
  then passed the first five manually browser-isolated large-screen cases. The final 3440×1440
  Phaser case again exhausted its scoped 180-second budget without a product assertion failure.
  This proves the remaining pressure is shared by the Linux runner after the core GPU matrix, not
  by Playwright's browser fixture or the generated player's Phaser lifecycle.
- CI preserves exact 156-scenario coverage but assigns it to fresh runners: 150 ordinary cases,
  five bounded large-screen cases excluding 3440×1440, and the single ultrawide Phaser case. Each
  large-screen job installs Chromium and builds the engine from the same exact source commit. No
  retry, timeout, trace setting, product assertion or local `npm run test:e2e` behavior is changed.
- Candidate `b8ca204` and its incomplete verifier cycle are superseded. The next exact candidate
  requires all three GitHub jobs, local focused evidence and both independent sign-offs before
  merge.

## 2026-08-02 — R18 fixture-teardown budget RED

- Exact run `30744037033` proved the fresh-runner split itself: the five-case job passed 5/5, but
  the single ultrawide job timed out after all product work while the acceptance test awaited its
  manually owned browser cleanup. Code verification found that `context.close()` and
  `browser.close()` were inside the same 180-second product-test budget and the first could prevent
  the second from running.
- Browser/context ownership returns to Playwright's test fixture, whose teardown has a separate
  bounded lifecycle after the product test. The test still explicitly requires the generated
  Phaser disposer, detached canvas and lost WebGL context, then detaches and closes the disposed
  page. Fresh runner isolation remains 150 + 5 + 1; assertions, retries, global timeouts and
  production source are unchanged.
- Candidate `e16738b` is rejected with independent P1/P2 findings. The repair must pass the focused
  ultrawide command, all three exact CI jobs and renewed independent verification before merge.

## 2026-08-02 — R18 fixture-teardown focused GREEN

- With fixture-owned browser/context teardown, the exact ultrawide command
  `npx playwright test tests/e2e/r18-large-screen-player.spec.mjs --grep "3440x1440" --workers=1`
  passed 1/1 in 11.2 seconds; the product case itself completed in 5.4 seconds.
- The complementary command using `--grep-invert "3440x1440"` passed the other 5/5 in 11.7
  seconds. Together with exact discovery, the fresh-runner split remains 150 + 5 + 1 = 156 without
  overlap. A new exact commit, GitHub run and both independent sign-offs remain mandatory.

## 2026-08-02 — R18 Phaser quality scheduling RED

- Exact candidate `7bc585f` kept fixture teardown outside the product-test budget, and GitHub run
  `30744349720` therefore exposed the actual failure: at 3440×1440 the generated Phaser player made
  the settings dialog visible, but the continuously saturated software-rendering main thread could
  not answer a bounded read of its static `role="dialog"` attribute before the 180-second deadline.
- The generated Canvas player already caps quality-dependent DPR, while the Phaser path still
  hardcodes a 60 FPS request and has no large-surface backbuffer quality policy. New regression
  `bounds desktop Phaser backbuffer and frame scheduling through the selected quality preset`
  requires a presentation-only quality profile, bounded resolution, quality-selected FPS and
  yielding timeout scheduling, while proving the legacy Phaser target remains byte-contract free
  of R18 quality runtime.
- Exact RED command:
  `npx vitest run packages/cli/build.r18-phaser-lifecycle.regression.test.mjs --reporter=verbose`.
  Result: 3 existing tests passed and the new contract failed because
  `phaserPresentationQuality` was absent. Gameplay simulation, engine timing and legacy targets
  must remain unchanged.

## 2026-08-02 — R18 Phaser quality scheduling focused GREEN

- The generated large-screen Phaser player now derives a bounded presentation profile from the
  selected build-target quality. It caps backing resolution by viewport pixel budget, selects a
  presentation-only FPS target and uses Phaser's yielding timeout scheduler. Engine ticks,
  commands, checkpoint/journal state and legacy Phaser output are unchanged.
- Exact contract command passed 4/4:
  `npx vitest run packages/cli/build.r18-phaser-lifecycle.regression.test.mjs --reporter=verbose`.
  Exact browser commands passed 1/1 ultrawide in 5.1 seconds and the complementary 5/5 in 10.4
  seconds. The 3440×1440 product case itself fell from 5.4 to 3.0 seconds locally while retaining
  dialog semantics, input blocking, viewport/hit tests, placement, upgrade, accessibility and
  explicit Phaser/WebGL disposal assertions.

## 2026-08-02 — R18 fixed-simulation cadence verifier RED

- Independent constructor verification rejected candidate `b1a82d9`: the R18 Phaser quality preset
  changed the Phaser loop from 60 FPS to 24/30/45/60 FPS while `Scene.update` passed each render
  delta directly into `TowerDefenseGame.tick`. A 12-second run with the same seed therefore produced
  different authoritative state digests at 30 and 60 FPS. Presentation quality was incorrectly
  changing enemy movement and replay state.
- New contract `packages/player-runtime/src/fixed-simulation-clock.contract.test.mjs` runs the real
  starter simulation for the same 12 seconds at every R18 presentation cadence and requires the
  same fixed-step count, state digest and snapshot.
- Exact RED command:
  `npx vitest run packages/player-runtime/src/fixed-simulation-clock.contract.test.mjs --reporter=verbose`.
  Result: suite import failed because `fixed-simulation-clock.mjs` did not exist. Production repair
  must keep Phaser quality presentation-only, retain the R18 ultrawide performance bound, preserve
  all intermediate engine events, and keep legacy targets free of the new runtime module.

## 2026-08-02 — R18 fixed-simulation cadence focused GREEN

- `packages/player-runtime/src/fixed-simulation-clock.mjs` now owns a renderer-neutral fixed 60 Hz
  schedule for large-screen Phaser. It bounds a render delta at 50 ms, keeps playback speed within
  the authored player range and subdivides each fixed step so no engine call exceeds the existing
  `0.2` tick-unit clamp. Render FPS and backbuffer resolution remain presentation-only.
- The generated Phaser adapter drains every engine substep event into the current presentation
  frame and resets its clock whenever a mission, campaign battle or checkpoint replaces the game.
  Schema-v1/legacy builds prune both the export and runtime file.
- Exact deterministic contract passed 2/2, including the real 12-second starter run at
  24/30/45/60 FPS with one snapshot and state digest. Static generated-player contracts passed
  5/5, the 3440×1440 Phaser browser case passed 1/1 in 5.5 seconds, and the remaining large-screen
  matrix passed 5/5 in 9.9 seconds. Plugin source parity was rebuilt and its focused parity test is
  GREEN. Full exact-commit gates and renewed independent sign-offs remain required before merge.

## 2026-08-02 — R18 Canvas cadence, reset phase and runtime quality verifier RED

- Independent verification rejected exact candidate `54a19a1`. Large-screen Canvas still passed
  variable rAF deltas directly to `game.tick`; identical 12-second runs at 24/30/45/60/120 FPS
  produced different state digests and, below 45 FPS, different actual mission elapsed time because
  the engine clamps each call at `0.2` units. The shared fixed clock must drive both generated
  renderers.
- A second lifecycle defect left sub-frame time pending across in-place `Reset run`. Reusing 10 ms
  from the old run caused a new run to tick after another 7 ms, while a fresh clock correctly did
  not. Both Canvas and Phaser reset handlers must clear the clock.
- Runtime `Settings -> Quality` only persisted a dataset value. Canvas DPR and Phaser resolution/FPS
  were still calculated once from the build target, so Low/Balanced/High had no presentation effect.
  A shared closed quality profile and real renderer adapters are required; gameplay state remains
  outside the profile.
- Exact RED commands:
  `npx vitest run packages/player-runtime/src/presentation-quality.contract.test.mjs --reporter=verbose`
  failed because `presentation-quality.mjs` did not exist. The generated Canvas/Phaser regression
  failed four active assertions: missing Canvas fixed clock, missing reset hook in both renderers,
  and missing runtime quality application. Legacy isolation already passed.

## 2026-08-02 — R18 Canvas cadence, reset phase and runtime quality focused GREEN

- Canvas and Phaser large-screen players now share `createFixedSimulationClockV1`; render cadence
  advances the same fixed engine steps and every substep event is retained for the rendered frame.
  Explicit Reset, checkpoint restore and game replacement clear pending sub-frame time.
- The real starter digest contract is identical at 24/30/45/60/120 presentation FPS.
- `presentation-quality.mjs` supplies one bounded renderer-neutral profile. Saved settings apply
  Canvas DPR immediately and Phaser FPS immediately; the selected Phaser backing resolution is
  applied at construction/reload. A read-only browser probe lets E2E verify the actual adapter,
  rather than only the persisted dataset value. Legacy builds prune both R18 runtime modules.
- Focused command:
  `npx vitest run packages/player-runtime/src/presentation-quality.contract.test.mjs packages/player-runtime/src/fixed-simulation-clock.contract.test.mjs packages/renderer/src/index.test.mjs packages/cli/build.r18-canvas-fixed-clock.regression.test.mjs packages/cli/build.r18-phaser-lifecycle.regression.test.mjs`.
  Result: 35/35 GREEN across five files. The complete affected R18 contract set is 113/113 GREEN
  across 23 files, and the executable browser matrix is 6/6 GREEN at 1024×720 through 3440×1440,
  Canvas/Phaser, hex/square and DPR 1/2. Typecheck, engine build, web build and plugin
  build/validate/smoke are GREEN. A new exact commit and complete repository gates remain required
  before the candidate can be frozen again.

## 2026-08-02 — R18 Phaser live scheduler cadence verifier RED

- Independent Constructor Integration Verification rejected exact candidate `d8733d7`. With
  Phaser `forceSetTimeOut: true`, changing `loop.targetFps`, `_target` and `_limitRate` did not
  update the already-started `loop.raf.delay`; Balanced → High continued scheduling 33.333 ms
  callbacks, and Low was still quantized by the same 30 Hz timer.
- The generated-player contract now requires the live adapter to update `loop.raf.delay`. Browser
  acceptance reads the actual scheduler delay after selecting Low, not only the target-FPS field.
  The focused generated-player contract and the 3440×1440 Phaser browser case are expected RED:
  current generated code neither writes nor reports the live scheduler delay.

## 2026-08-02 — R18 Phaser live scheduler cadence focused GREEN

- The Phaser Quality adapter now updates the active timeout driver's `raf.delay` together with the
  TimeStep FPS fields. The next scheduled callback uses the selected cadence; no engine clock,
  snapshot or digest field changes.
- Focused generated-player contracts passed 10/10. The executable 3440×1440 Phaser case passed
  1/1 and verified Low as an actual `41.66667 ms` scheduler delay instead of the previous retained
  Balanced `33.33333 ms`. A fresh exact candidate, full CI and both renewed sign-offs are required.

## 2026-08-02 — R18 verifier repair RED: actual Phaser backbuffer and Studio target identity

- Independent verification found that Phaser 3.80.1 ignores the authored top-level `resolution`
  option and `Scale.RESIZE` writes the full parent dimensions into the canvas. On the real
  3440×1440 Low-quality acceptance viewport the desired 1,500,000-pixel budget therefore still
  produced a 3,596,864-pixel drawing buffer. The browser regression now reads the existing WebGL
  context and requires its actual `drawingBufferWidth × drawingBufferHeight` to stay inside the
  selected profile budget while the canvas retains the large CSS viewport and inverse hit testing.
- The same verification found that Studio's `Large-screen desktop` button always used
  `desktop-large`, silently replacing an authored target through the otherwise guarded upsert API.
  New pure and browser regressions require a bounded deterministic free ID, preservation of the
  existing target and creation of `desktop-large-2` through the real Studio workflow.
- The browser contract also requires a suffixed output directory (`dist-desktop-2`) so the newly
  allocated target cannot overwrite the existing target's generated player on its first build.
- Expected RED commands:
  `npx vitest run packages/studio/public/player-target-id.contract.test.mjs --reporter=verbose` must
  fail collection because the allocator does not exist;
  `npx playwright test tests/e2e/r18-studio-player-targets.spec.mjs --workers=1` must fail because
  the existing target is overwritten; and the 3440×1440 case in
  `tests/e2e/r18-large-screen-player.spec.mjs` must fail because the actual drawing buffer exceeds
  Low's pixel budget. Production code has not been changed for either new defect.

## 2026-08-02 — R18 actual backbuffer and Studio target identity focused GREEN

- Large-screen Phaser now uses the documented `Scale.NONE` resize path. The quality profile derives
  a bounded logical backbuffer, CSS preserves the full playfield, and ScaleManager, cameras, input
  coordinates and the WebGL renderer receive the same dimensions. Runtime quality changes, saved
  preferences and ResizeObserver updates all use the same adapter; disposal disconnects the scoped
  observer. Legacy Phaser remains on its previous `Scale.RESIZE` carrier.
- Studio now allocates the first free ID in the bounded `desktop-large[-N]` range from the guarded
  server read and gives suffixed targets a distinct output directory. The real browser flow
  preserved an authored Phaser/high target and created a Canvas/balanced `desktop-large-2` at
  `dist-desktop-2`.
- Focused Vitest passed 24/24 files and 116/116 tests. Focused browser acceptance passed 10/10:
  Studio allocation, lifecycle/BFCache, 1024 px hit targets, and Canvas/Phaser × hex/square from
  1024×720 through 3440×1440. The ultrawide case reads the actual WebGL drawing buffer, applies Low
  live, verifies the timeout cadence, CSS/logical scaling and real pointer input, then repeats the
  budget assertion after persisted reload and a viewport resize.
- The Codex plugin runtime was rebuilt and the generated CLI mirror is byte-identical. This is
  focused GREEN only; the next exact candidate still requires complete repository gates and two
  fresh independent sign-offs.

## 2026-08-02 — R18 rejected-candidate contract repair RED

- Independent constructor review of exact candidate `70823d2` found three contract gaps. Multiple
  v2 web targets may resolve to the same `webDir`, so CLI validation and MCP preview/apply can
  accept two targets that overwrite one build output. The desktop recipe must allocate the first
  deterministic free `dist-desktop[-N]`; an explicitly duplicated directory must fail preview and
  remain byte-inert on guarded apply.
- `PlayerSessionSaveV1` is scheduled after accepted UI commands, visibility changes and page hide,
  but neither renderer observes the authoritative `waveCleared` event. A real two-wave browser
  fixture now requires the rotating IndexedDB head to contain `clearedWaveCount >= 1` after the
  first inter-wave boundary, before any subsequent management command.
- `PlayerPreferencesV1` codecs carry sound, volumes, fullscreen, camera zoom and key bindings, but
  the generated shell currently applies only UI scale, quality and motion. Repair contracts require
  every declared field to drive the corresponding runtime/controls, persist changes, and restore
  without affecting legacy targets. Fullscreen follows actual `fullscreenchange`; camera zoom uses
  the renderer viewport snapshot; key bindings map bounded action IDs to `KeyboardEvent.code`.
- The same rejected-candidate pass requires Continue to rebuild mission-dependent selectors and
  ability UI, the combat playfield to occupy at least 75% of 1024/1440/1920 viewports, all persistent
  live controls to expose a 44 px hit dimension, and the Russian target to localize real generated
  controls including Pause/Resume. Default hotkeys are frozen as Digit1–Digit9 for build slots,
  BracketLeft/BracketRight for speed, Q/E/R/F for mission abilities, Space for pause and U for
  upgrade; remapped preferences must traverse the same action registry.
- Expected RED commands:
  `npx vitest run packages/cli/lib/r18-build-targets.contract.test.mjs packages/mcp/r18-player-targets-authoring.contract.test.mjs packages/cli/build.r18-verifier-repair.regression.test.mjs --reporter=verbose`
  and
  `npx playwright test tests/e2e/r18-large-screen-player.spec.mjs --workers=1`.
  These additions are tests/evidence only; production remains unchanged.
- Focused RED evidence: the three-file Vitest command exited 1 with six expected failures (duplicate
  validation, recipe allocation, event-boundary save, preference application, Continue resync and
  missing hotkeys). The real Phaser 1920×1080 case reached `waveCleared`, then timed out with the
  latest IndexedDB checkpoint still at `clearedWaveCount: 0`. The real 1024×720 and 1920×1080
  playfields occupied only `0.5795` and `0.7015` of the viewport. The Russian 3440×1440 target
  rendered `Start wave`, proving the generated live shell was not localized. All failures were
  observed against unchanged production at `70823d2`.

## 2026-08-03 — R18 verifier repair RED: capability-bound saves and closed action registry

- Exact candidate `c63dea4` still allowed a `PlayerSessionSaveV1` without a capability digest.
  `createRotatingPlayerSessionStore` checked only the project content digest, so a save authored for
  a different mission capability selection could reach the restore callback. The v1 envelope is now
  contractually required to carry canonical `tf-capabilities-v1:<16 hex>`. The store accepts either
  a fixed expected digest or a mission-aware `expectedCapabilityDigest(save)` resolver and must
  return stable `session_capability_missing` / `session_capability_mismatch` before restore. Generated
  Canvas and Phaser desktop players must use engine-owned `computeReplayCapabilityDigestV1`, compute
  saves from current `missionId`, and resolve loads from `save.activeMissionId`; legacy players remain
  free of the digest function and session fields.
- The same candidate read descriptors and handlers through ordinary property lookup. An inherited
  `id: "constructor"` could resolve `Object.prototype.constructor`; accessor getters were invoked,
  and the registry retained the caller-owned handler map after validation. New contracts require a
  closed schema-v1 descriptor (`schemaVersion`, `id`, `labelKey`, `kind`), exact own data handlers,
  rejection of revoked proxies/accessors/unknown fields/duplicates/future schemas/invalid kinds,
  and invocation through a detached handler map only.
- Expected focused RED command against unchanged production:
  `npx vitest run packages/player-runtime/src/player-session-store.contract.test.mjs packages/player-runtime/src/player-actions.contract.test.mjs packages/cli/build.r18-verifier-repair.regression.test.mjs --reporter=verbose`.
  No production code was changed for this slice.
- Focused RED result on exact `c63dea4`: exit `1`, 13 failed assertions. Session failures were
  missing/loosely formatted capability digests being accepted, both missing and mismatching saves
  reaching `restore`, the mission-aware resolver never being called, and generated Canvas/Phaser
  omitting `computeReplayCapabilityDigestV1`. Registry failures were inherited `constructor`,
  descriptor/handler accessors, unknown fields/handlers, future schema, invalid kind and post-create
  handler mutation all being accepted. Duplicate IDs and revoked-proxy fail-closed behavior already
  passed and remain compatibility guards inside the same RED slice.

## 2026-08-03 — R18 capability/action verifier repair focused GREEN

- The existing R16 capability digest primitive now lives in the ordinary engine stable-digest
  entrypoint while Replay Lab re-exports the exact same function. Its domain, canonical payload and
  output remain `tf-capabilities-v1:<16 hex>`; large-screen single-player builds therefore verify
  capabilities without shipping Replay Lab.
- `PlayerSessionSaveV1` now requires the canonical capability digest. Generated Canvas and Phaser
  players save it for the current mission and resolve the expected value from the saved mission
  before `TowerDefenseGame.fromCheckpoint`. Missing and mismatching selections fail closed and do
  not invoke restore. Content, capability, checkpoint and GameCommand version domains remain
  independent and unchanged.
- `createPlayerActionRegistry` validates exact own-data options, dense bounded descriptor arrays,
  closed schema-v1 descriptors and an exact own-data handler set. It retains a private detached
  `Map`, so prototype inheritance, accessors, unknown handlers and mutation after construction do
  not affect invocation.
- Exact RED command now passes `28/28`. Expanded player-runtime, Replay Archive, generated-player
  and action-registry compatibility run passes `110/110`; `typecheck` and `build:engine` are GREEN.
  This is focused GREEN only. The next exact candidate still requires plugin regeneration, full
  gates and two fresh independent sign-offs.

## 2026-08-03 — R18 full-suite boundary RED: Replay Lab root isolation

- The first full `npm run test` after focused GREEN completed `4022/4023` and failed only
  `replay-lab-entrypoint.contract.test.ts`. Moving the shared hash under the historic
  `computeReplayCapabilityDigestV1` name caused that Replay Lab API name to leak from the ordinary
  root engine entrypoint, violating R16 single-player isolation even though no Replay Lab files were
  bundled.
- The repair keeps the digest algorithm/domain byte-identical but exposes the shared root primitive
  as `computeMissionCapabilityDigestV1`; Replay Lab retains its existing
  `computeReplayCapabilityDigestV1` wrapper only from the isolated entrypoint. Generated R18 players
  use the generic mission API. This existing full-suite failure is the RED regression for the
  boundary fix; production was not further changed before recording it.

## 2026-08-03 — R18 verifier repair pre-freeze GREEN

- The isolated Replay Lab boundary repair passes its focused stack `46/46`; root engine exposes
  only `computeMissionCapabilityDigestV1`, while Replay Lab preserves its existing replay-named
  wrapper and byte-identical digest behavior.
- Full Vitest passes `4023/4023` in 414 files. An immediately preceding full run reached
  `4021/4023` only because two pre-existing MCP tests exceeded their 5-second timeout under local
  load; their isolated repeat passed `28/28`, and the clean full repeat then passed without source
  changes.
- Full Playwright passes `157/157` in 3.6 minutes. The focused R18 browser matrix passes `10/10`
  across Canvas/Phaser, hex/square, 1024–3440 px, Continue, autosave, Studio target allocation,
  persistent hit targets and Phaser lifecycle.
- `typecheck`, `build:engine`, `validate`, `sim tutorial_01 60`, starter balance, maps compile, web
  build, plugin build/validate/smoke, mobile/desktop package scaffolds and Cargo `9/9` are GREEN.
  The tracked plugin runtime was regenerated from source. The next commit is the exact freeze
  candidate; both previous sign-offs are invalid and two new independent sign-offs are required.

## 2026-08-02 — R18 preference edge-case RED

- Read-only follow-up review found that repeated camera zoom stores the requested multiplicative
  factor instead of the viewport's bounded result. At authored `maxZoom`, the renderer stops while
  `PlayerPreferencesV1.cameraZoom` can continue growing, so reload no longer reproduces the visible
  camera. The regression requires persistence to derive the applied ratio from the previous and
  returned viewport snapshots.
- A disabled audio player still allocates and resumes an `AudioContext` when a generic player
  gesture calls `resume()`. The audio contract now requires `resume()` to remain a hardware-free
  no-op until sound is enabled; generated Start Wave wiring must also respect `soundEnabled`.
- Exact RED command:
  `npx vitest run packages/renderer/src/audio.test.mjs packages/cli/build.r18-verifier-repair.regression.test.mjs --reporter=dot`.
  Result: 2 expected failures — one context was allocated while disabled and generated camera
  persistence did not use `result.zoom / previous.zoom`. Production was unchanged for these two
  assertions when the failures were captured.

## 2026-08-02 — R18 rejected-candidate repair GREEN

- BuildTargets v2 now rejects normalized/case-folded web output collisions. The shared desktop
  recipe allocates the first free bounded `dist-desktop[-N]`, and Studio obtains that detached
  candidate through a closed project-bound recipe endpoint before preview and revision-guarded
  apply. The real Studio E2E preserves the authored `desktop-large` target and creates
  `desktop-large-2` at `dist-desktop-2`.
- Both generated renderers autosave the authoritative `waveCleared` boundary. Continue restores the
  checkpoint and resynchronizes mission selector, tower/ability controls, background, music and
  overlays; the two-mission browser fixture proves the UI and restored snapshot agree.
- The desktop canvas fills the viewport and compact DOM surfaces remain bounded overlays. Accepted
  1024/1440/1920 layouts keep at least 75% playfield coverage, all persistent live controls expose
  44 px hit targets, and the Russian catalog owns the complete visible shell including
  Pause/Resume.
- Player preferences now drive camera, sound, SFX/music volumes, fullscreen state and remapped
  keys. Bounded zoom persists the ratio actually returned by the viewport, survives reload at
  authored max zoom and resets through the remapped key. Disabled audio performs no `AudioContext`
  allocation. Build slots, abilities and speed controls dispatch through the shared action registry.
- Focused Vitest: 25 files, 104/104 GREEN. R18 browser integration: 10/10 GREEN. Complete Playwright:
  157/157 GREEN. `typecheck`, `build:engine`, `validate`, `sim tutorial_01 60`, starter balance,
  maps compile, web build, mobile/desktop package scaffolds, Cargo tests and plugin
  build/validate/smoke are GREEN. Source/plugin runtime parity is byte-identical.
- The exact clean-run `npm run test` remains assigned to GitHub CI because two ignored local
  duplicate runtime directories keep a Vitest worker open after the tracked source tests finish.
  They are not part of the commit or clean CI checkout. A new frozen commit, clean CI and two fresh
  independent verifier sign-offs are still required before R18 acceptance.

## 2026-08-03 — R19.1 first-class native desktop target contract RED

- Contract freeze for R19.1 adds a first-class BuildTargets-v2 `platform: "desktop"` selected by
  `defaults.desktop`. The target owns closed `window` and `bundle` records; a project-relative
  1024×1024 PNG is the only icon source and the bundle targets are the six Tauri formats used by
  the later release workflow. The existing schema-v5, viewport and player-runtime version domains
  remain unchanged.
- `native_desktop_game` must be an inert project-bound recipe that reuses the existing
  `read -> recipe -> preview -> guarded apply` transaction. Preview must validate the complete
  desktop target without writing either project file.
- `packageDesktop` must build the selected desktop target itself instead of silently wrapping the
  first web target. Its generated Tauri v2 scaffold must apply authored initial/minimum window
  dimensions, restrictive non-null CSP, no global Tauri injection, a local capability allowlist
  without broad shell/filesystem/network permissions, and automatically generated PNG/ICNS/ICO
  icons. Packaging an explicit legacy web target remains the scaffold-only compatibility adapter.
- Expected focused RED command before production changes:
  `npx vitest run packages/cli/lib/r19-native-desktop-target.contract.test.mjs packages/cli/lib/r19-generated-desktop-scaffold.contract.test.mjs --reporter=verbose`.
  Expected failures are unknown `window`/`bundle` fields and missing `defaults.desktop` validation,
  unknown recipe `native_desktop_game`, rejection of `platform: "desktop"` by the web-only builder,
  plus the current generated `csp: null`, missing capability file and manual-only icon instructions.

## 2026-08-03 — R19.1 first-class native desktop target focused GREEN

- BuildTargets v2 now accepts an explicit `platform: "desktop"`, validates `defaults.desktop` and
  closed window/bundle records, and keeps the R18 large-screen web recipe unchanged. The new
  `native_desktop_game` candidate uses the existing detached preview and revision-guarded apply
  transaction.
- First-class packaging compiles the selected desktop target through an explicit internal carrier
  build mode; it no longer searches for a sibling web target. The legacy explicit web-target wrapper
  remains available. The generated carrier applies authored window values, a restrictive CSP, a
  bounded capability allowlist and deterministic PNG/ICNS/ICO icons derived from the project-bound
  1024×1024 PNG.
- The exact RED command now passes 10/10. This is focused GREEN for R19.1 only; R19.2 native
  persistence/lifecycle, R19.3 installers/workflow and R19.4 updater still require their own
  RED/GREEN slices before the frozen R19 gate.
- Focused RED evidence: exit `1`; two files failed with `9` expected failures and the legacy adapter
  passed `1/1`. Validation rejected the new `window` and `bundle` roots instead of validating their
  closed children, `native_desktop_game` returned `unknown_player_target_recipe`, and direct native
  packaging stopped with `No web build target found`. Because the native package cannot yet reach
  scaffold generation, its downstream window/CSP/capability/icon assertions remain intentionally
  behind that first RED boundary and will execute after direct target selection turns GREEN.

## 2026-08-03 — R19.2 native persistence and lifecycle contract RED

- Contract freeze keeps `PlayerSessionSaveV1` and the existing two-slot rotating store unchanged.
  The renderer-neutral `NativeStorageBridgeV1` maps only the configured `head`, `slot-0` and
  `slot-1` keys onto typed native commands. No project path, filesystem path or arbitrary storage
  key crosses the WebView boundary.
- The native carrier must expose only bounded read/write/remove commands for the two session slots
  and head, plus pending-write, fullscreen and finish-close lifecycle commands. The WebView receives
  no general filesystem, shell, opener, process, HTTP or wildcard capability. Close is prevented
  while a save commit is pending; suspend/resume request a flush; a second launch focuses the
  existing main window.
- The behavioral RED verifies browser/native restore parity and both interrupted-write boundaries:
  failure before a slot write and failure after the alternate slot write but before the head
  commit must both recover the prior committed simulation digest after restart.
- Exact focused RED command:
  `npx vitest run packages/player-runtime/src/r19-native-storage-bridge.contract.test.mjs packages/cli/lib/r19-native-persistence-lifecycle.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; two test files failed. The runtime suite cannot import the intentionally absent
  `native-storage-bridge.mjs`; the generated carrier has none of the nine bounded commands and does
  not copy the native bridge into `dist/player-runtime`. These are the expected pre-production
  failures; the already-green R19.1 carrier generation completed in both packaging tests.

## 2026-08-03 — R19.3 installers and generated release workflow contract RED

- The first-class native target must export a project-owned
  `.github/workflows/towerforge-desktop-release.yml` inside its standalone carrier. The workflow
  checks out `github.sha`, never a moving branch, and owns an explicit six-format matrix:
  macOS DMG, Windows NSIS `.exe` and MSI, Linux AppImage, DEB and RPM.
- Candidate assembly must create `SHA256SUMS`, repeat those hashes in `RELEASE_NOTES.md`, and attach
  both beside every installer. With no signing configuration the generated publication is always a
  pre-release whose title includes `Unsigned build`.
- Local `npm run build` is intentionally different from the CI matrix: a generated bounded helper
  selects only DMG on macOS, NSIS+MSI on Windows or AppImage+DEB+RPM on Linux. Signing credentials
  remain environment/CI-owned; `SIGNING.md` documents fixed secret names, while `.env`, private
  `.towerforge` state, secret values and absolute user-local paths are absent from exported text.
- Exact focused RED command:
  `npx vitest run packages/cli/lib/r19-desktop-release-workflow.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`, one file failed with `4/4` expected failures. R19.1/R19.2 carrier generation
  completed, but no project-owned workflow or signing guide exists, `build` still invokes the broad
  `tauri build`, and no current-platform helper is generated. No R19.3 production file was changed
  before capturing this evidence.

## 2026-08-03 — R19.2 native persistence and lifecycle focused GREEN

- `NativeStorageBridgeV1` maps the existing rotating store's exact head and two slot keys onto six
  native commands. Neither a project path, filesystem path nor arbitrary logical key crosses the
  WebView boundary. Interrupted slot and head writes retain the previously committed session, and
  browser/native ports restore the same detached digest.
- First-class desktop builds alone copy the bridge and select it instead of IndexedDB. Legacy and
  R18 browser targets prune the native export and module. The generated Rust carrier owns fixed
  app-data filenames, size bounds and atomic temporary writes; it exposes only session,
  pending-close and fullscreen commands, prevents close during an active write, emits resume,
  and focuses the existing window through the single-instance plugin.
- The R19.2 RED command now passes 7/7, with syntax checks green for the shared build template,
  packager and native bridge. R19.3 and R19.4 remain separate RED/GREEN slices.

## 2026-08-03 — R19.3 installers and generated release workflow focused GREEN

- A first-class carrier now owns a six-format GitHub Actions matrix tied to `github.sha`, assembles
  all installers with `SHA256SUMS`, repeats every hash in release notes and publishes only an
  `Unsigned build` pre-release in the reference configuration.
- Local `npm run build` calls a bounded current-platform helper: DMG on macOS, NSIS/MSI on Windows,
  or AppImage/DEB/RPM on Linux. It never attempts local cross-compilation. `SIGNING.md` documents
  fixed environment/CI secret names without copying values, `.env`, `.towerforge` state or absolute
  user paths into the carrier.
- The R19.3 RED command now passes 4/4; the combined carrier/package regression passes 14/14.
  Updater support remains the independent R19.4 slice.

## 2026-08-03 — R19.4 optional signed updater focused GREEN

- BuildTargets v2 accepts a desktop-only closed updater record. Absent and explicitly disabled
  configurations emit no updater dependency, plugin, permission, runtime import or preflight file.
  Enabled configuration accepts only bounded HTTPS endpoints without credentials/fragments and a
  public verification key; private material and web-target use fail validation.
- The pure browser-safe preflight rejects malformed/oversized manifests, missing or invalid
  signature status, downgrade, platform mismatch and architecture mismatch before a candidate can
  reach `download_and_install`. Enabled carriers alone configure Tauri updater permissions and call
  that preflight first.
- The focused R19.4 command now passes 12/12. Studio and MCP use the same guarded target transaction;
  AI instructions explicitly prohibit private updater keys.

## 2026-08-03 — R19.4 optional updater contract RED

- BuildTargets v2 gains only the optional closed desktop record
  `{ enabled, endpoints, publicKey }`. Enabled configuration requires a bounded non-empty list of
  HTTPS endpoints without userinfo or fragments and a bounded non-empty public verification key.
  Web targets, unknown fields, `privateKey` and nested private material are rejected. Disabled form
  is exactly `{ enabled: false }` and retains no dormant endpoint/key configuration.
- Absent or disabled updater configuration must produce no updater dependency, plugin, config,
  capability, runtime import or copied preflight module. The enabled carrier may add the Tauri
  updater plugin only with the authored public endpoints/key and narrow check/download-install
  permissions.
- A pure bounded `native-updater-preflight.mjs` contract parses at most 1 MiB, requires a valid
  signature result, a strictly newer version and an exact platform/architecture artifact before the
  generated player can invoke installation. Malformed/oversized input, invalid or missing signature,
  downgrade and platform/architecture mismatch all fail closed.
- Exact focused RED command:
  `npx vitest run packages/player-runtime/src/r19-native-updater-preflight.contract.test.mjs packages/cli/lib/r19-optional-updater.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; two files failed with `3` expected failures and `1` compatibility control passed.
  The absent carrier is already byte-clean. BuildTargets still rejects disabled/enabled `updater`,
  enabled packaging cannot begin, and the pure preflight module is intentionally absent. No R19.4
  production source was changed before recording RED.

## 2026-08-03 — R19.4 generated updater Cargo regression RED

- An actual `cargo check` of an updater-enabled generated carrier failed in
  `tauri::generate_context!`: Tauri's generated updater configuration references `serde_json`, but
  the carrier did not declare it as a direct dependency. The updater-disabled carrier had already
  compiled successfully, so the defect was isolated to the opt-in branch.
- Before changing the packager, the enabled-carrier contract was extended to require the explicit
  bounded dependency. Exact RED command:
  `npx vitest run packages/cli/lib/r19-optional-updater.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; the new dependency assertion failed while the other `3/4` cases passed.

## 2026-08-03 — R19.4 generated updater Cargo regression GREEN

- The packager now emits `serde_json = "1"` only for updater-enabled native carriers. Disabled and
  absent updater carriers remain byte-clean and keep the smaller dependency graph.
- The regression contract passes `4/4`. The regenerated updater-enabled Tauri project then passed
  a real `cargo check` in `7.12s`; the separately generated updater-disabled project passed in
  `4m 57s` on the initial cold dependency build.

## 2026-08-03 — R19 generated macOS game build and launch smoke GREEN

- A temporary schema-v5 project with a first-class Canvas desktop target was packaged through the
  public CLI, installed only its pinned generated carrier dependencies, and ran `npm run build`.
  Tauri completed the optimized native build and produced
  `Cargo Check_0.1.0_aarch64.dmg` in `6m 41s`.
- `hdiutil verify` accepted the DMG (CRC32 `33FB8F8F`); SHA-256 was
  `d21a8758445986cad3dd13903fefe599338a894a5a1a9f2eed78dcd13643d269`.
  The mounted app launched the generated `cargo_check` executable from the DMG and remained alive
  for the smoke observation. It was then terminated and the image was cleanly detached. This is
  local candidate evidence, not a published or signed artifact.

## 2026-08-03 — R19 independent verifier findings regression RED

- Contract/Test Designer added test-only regressions for eight independent verifier boundaries:
  explicit non-web target rejection by mobile/portable-web packaging while preserving only the
  explicit web-to-desktop compatibility adapter; strict SemVer `appVersion` validation including
  non-string/newline/TOML injection candidates; realpath confinement before build/package output
  mutation through an intermediate symlink; native atomic replacement without deleting the last
  committed destination first; ordinary close and suspend save handshakes ending in finish-close;
  native Tauri-owned signed updater check/install without caller `signatureStatus` or a synthetic
  direct `download_and_install` candidate; recursive/non-empty workflow artifact assembly, lock-aware
  npm caching, immutable action/toolchain pins and tag/source links; and current-OS helper
  intersection with the authored bundle targets.
- Exact focused command:
  `npx vitest run packages/cli/lib/r19-verifier-packaging-boundaries.regression.test.mjs packages/cli/lib/r19-verifier-native-contracts.regression.test.mjs packages/cli/lib/r19-verifier-release-workflow.regression.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; `1` of `3` files failed, `1` of `29` tests failed and `28` passed. The remaining
  RED is deterministic workflow pinning: the generated workflow still emits moving references such
  as `actions/checkout@v4` (and a moving `rust-toolchain@stable`) instead of immutable action SHAs
  and fixed language toolchains. Concurrent production repair in the shared R19 worktree had already
  turned the other seven verifier contracts GREEN before this final evidence run; this test-design
  slice changed no production source.

## 2026-08-03 — R19 desktop suspend lifecycle regression RED

- A real `cargo check` of the repaired updater-enabled carrier exposed that desktop Tauri 2.11.5
  has no `tauri::RunEvent::Suspended` variant. The generated carrier therefore failed compilation
  even though the string-level lifecycle contract had accepted the invalid API.
- The regression now requires the supported desktop boundary: `WindowEvent::Focused(false)` emits
  the WebView suspend/save signal, while focus gain and `RunEvent::Resumed` emit resume. Exact RED
  command: `npx vitest run packages/cli/lib/r19-verifier-native-contracts.regression.test.mjs`.
  Result: exit `1`; `1/5` tests failed because the carrier still emitted the nonexistent
  `RunEvent::Suspended` branch. No production source changed before this RED was recorded.

## 2026-08-03 — R19 independent verifier repairs and native lifecycle GREEN

- The complete verifier regression set now passes `29/29`. Repairs include strict explicit-target
  isolation, realpath output confinement, strict SemVer/TOML boundaries, durable atomic native
  replacement, save-before-close, focus-loss suspend flushing, native-owned updater verification,
  immutable workflow/toolchain references, recursive exact artifact assembly, tag/source links and
  authored-format-aware local packaging.
- The R19.4 browser-side updater preflight described by the earlier provisional GREEN was removed:
  the generated WebView no longer supplies candidates or signature claims and has no direct updater
  permission. Tauri's signed updater owns manifest, platform, architecture, downgrade and signature
  rejection before install.
- A freshly generated updater-enabled carrier passed a real `cargo check` in `3m 20s`; a freshly
  generated updater-disabled carrier passed in `36.62s` while reusing the compiled target cache.
  Both use the supported desktop focus lifecycle and contain no `RunEvent::Suspended` branch.

## 2026-08-03 — R19 frozen-candidate full gates and macOS launch GREEN

- Focused R19 contracts pass `62/62`; the full unit suite passes `426` files and `4085` tests.
  `typecheck`, `build:engine`, `validate`, `sim tutorial_01 60`, starter balance, map compilation,
  web build, plugin build/validate/smoke, explicit mobile packaging, explicit legacy desktop-wrapper
  packaging and constructor `cargo test` (`9/9`) all pass.
- The first full Playwright attempt had one pre-existing R5 Studio timing miss while the other
  `156/157` scenarios passed. The exact failed scenario passed alone, and the required complete
  rerun then passed `157/157` in `2.9m`; no source change occurred between those runs.
- A freshly generated updater-disabled first-class carrier compiled and produced
  `Cargo Check_0.1.0_aarch64.dmg`. `hdiutil verify` accepted CRC32 `4E8F34CD`; SHA-256 is
  `6dd6141f4fdb54bcc483488a0a14846f658fb658f0ba760b8398a6dd9c8bf83d`. The app executable was
  launched directly from the read-only mounted DMG, observed alive as PID `52669`, then terminated
  and the image detached cleanly. This is local acceptance evidence, not a signed/published release.

## 2026-08-03 — R19 frozen commit 284a44d authoring/distribution audit RED

- Contract/Test Designer added only two regression suites around the independently rejected frozen
  commit. The authoring suite requires raw CLI and MCP `read_player_targets` to return the authored
  `defaults.desktop`, guarded native apply to select and report the newly committed native default,
  and Studio to reconcile its post-apply state from that authoritative server result instead of
  inventing a local default that changes after reload. The fixture deliberately orders `native-a`
  before the authored `native-b` default.
- The packaging/workflow suite requires `packageDesktop` without an explicit `targetId` to reject
  when `defaults.desktop` is absent, both for a web-only project and for multiple native targets;
  only an explicitly supplied web target remains the legacy wrapper control. It also requires an
  updater-enabled generated workflow to publish updater payloads, detached signatures and signed
  `latest.json`-style metadata, while the disabled carrier/workflow remains updater-byte-clean.
- Signing contracts require generated macOS jobs to consume all six documented Apple
  signing/notarization secrets, Windows jobs to consume and actually import the documented PFX
  certificate/password, and the unconfigured path to remain an explicitly labelled pre-release.
  A repository-owned `.github/workflows/r19-generated-game-acceptance.yml` must run on PR and
  manual dispatch, generate a first-class carrier, build DMG, NSIS, MSI, AppImage, deb and rpm on
  native runners, then verify the complete expected-format set in a separate acceptance job. These
  are source/workflow contracts only; this RED run did not attempt cross-platform CI.
- Exact focused command:
  `npx vitest run packages/studio/r19-default-desktop-selection.regression.test.mjs packages/cli/lib/r19-frozen-workflow-audit.regression.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; both files failed, `9/11` tests failed and `2/11` controls passed. Exact failures:
  `read_player_targets` omits defaults; guarded apply neither changes nor reports `defaults.desktop`;
  Studio hard-codes `desktop: targetId` after apply; both implicit desktop package cases succeed;
  the updater workflow omits payload/signature metadata; macOS secrets are unused; Windows secrets
  are unused and no certificate is imported; and the repository-owned acceptance workflow is
  absent. The updater-disabled byte-clean control and unsigned pre-release control pass. No
  production source or workflow was changed by this RED slice.

## 2026-08-03 — R19 authoring/distribution audit GREEN

- The authoritative BuildTargets-v2 `defaults` record now round-trips through CLI/MCP reads,
  previews, guarded applies and Studio reconciliation. Saving a first-class desktop target selects
  it as `defaults.desktop`; implicit desktop packaging rejects a missing authored desktop default
  before creating output, while an explicitly selected web target remains the compatibility path.
- Generated native release carriers now include executable release assembly and signing-status
  scripts. macOS imports the documented certificate and uses the Apple signing/notarization
  environment, Windows imports the documented PFX and applies its thumbprint, and the no-secret path
  remains an explicitly labelled `Unsigned build` pre-release. Updater-enabled carriers stage the
  real Tauri payload plus adjacent `.sig`, assemble `latest.json`, and include every release asset in
  `SHA256SUMS`; updater-disabled carriers remain byte-clean.
- Repository workflow `r19-generated-game-acceptance.yml` generates a first-class carrier from the
  current source, then builds and verifies DMG, NSIS EXE, MSI, AppImage, DEB and RPM on native
  macOS/Windows/Linux runners. Cross-platform execution is still pending the frozen PR commit.
- Focused R19 suite: `14` files and `74` tests passed. The executable release-assembler regression
  exposed invalid generated newline escaping, and the new updater round-trip exposed an invalid
  generated URL-normalization regular expression; both defects received focused failing evidence
  before repair. The final executable updater/release pair passes `14/14` focused audit tests,
  including six-installers enforcement and `payload + .sig -> latest.json -> SHA256SUMS`.

## 2026-08-03 — R19 native-runner bundle invocation and updater architecture RED

- Exact candidate `1cb56e0f78073eb5cdce758176e3fb41e195a499` passed local full unit/E2E/plugin/package/Cargo
  gates and produced a launchable verified macOS DMG, but repository acceptance run `30776923330`
  failed on native Windows job `91574138880`. The exact log shows
  `npm run tauri:build -- --bundles nsis,msi` becoming `tauri build nsis msi` under npm/PowerShell;
  Tauri forwarded those invalid positional arguments to Cargo and the job exited before compilation.
- Independent Code Verifier also identified that an updater-enabled workflow hard-coded
  `darwin-aarch64` while `macos-latest` may run a different architecture. Static updater metadata
  must therefore derive its platform key from the actual native runner architecture rather than a
  moving-runner assumption.
- Before production repair, the regression requires direct quoted Tauri CLI invocation in both the
  generated project workflow and repository acceptance workflow, prohibits the npm wrapper, makes
  the updater collector derive a bounded platform key from family plus runner architecture, and
  executes the changed collector/assembler contract. Exact RED command:
  `npx vitest run packages/cli/lib/r19-frozen-workflow-audit.regression.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; `3/11` tests failed and `8/11` passed. Failures were the executable collector's
  old argument shape, the missing direct quoted CLI command, and absent `${{ runner.arch }}` metadata.

## 2026-08-03 — R19 final verifier isolation/fullscreen/signature RED

- The rejected `1cb56e0` audit found three additional native-distribution boundaries. First-class
  targets without an explicit `outputDir` all resolve to `<project>/desktop`, so packaging a second
  target overwrites/mixes the first carrier; explicitly duplicated desktop outputs were not rejected
  by schema validation. A generated native player also inferred fullscreen from browser
  `document.fullscreenElement` and toggled a stored preference rather than querying the Tauri window,
  which makes an authored `window.fullscreen: true` first toggle and ARIA state incorrect. Finally,
  signing status was set after certificate import instead of verifying the built macOS/Windows
  artifact before publication.
- RED contracts require a recipe-owned deterministic `desktop-<target-id>` output, isolated fallback
  for older first-class targets, duplicate-output validation, bounded `player_get_fullscreen`, native
  UI synchronization without the browser Fullscreen API, and post-build `codesign`/notarization plus
  Authenticode verification before `signed` status.
- Exact RED command:
  `npx vitest run packages/cli/lib/r19-frozen-workflow-audit.regression.test.mjs packages/cli/lib/r19-native-desktop-target.contract.test.mjs packages/cli/lib/r19-native-persistence-lifecycle.contract.test.mjs packages/cli/lib/r19-verifier-native-contracts.regression.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; `10/31` tests failed and `21/31` passed. Failures match the five workflow/updater
  boundaries plus default-output collision, duplicate-output acceptance, missing recipe output,
  absent Rust fullscreen read command and absent lifecycle/player state synchronization. No
  production file changed before either RED run.

## 2026-08-03 — R19 signed macOS workflow portability RED

- A pre-freeze review of the new post-build signing verification found a GNU-only `find -maxdepth`
  assumption in the generated macOS job. The signed path is not exercised by the unsigned carrier
  acceptance matrix, so it could fail after producing a valid DMG on a native BSD runner.
- Before repairing the generator, the signing workflow regression was extended to prohibit
  `-maxdepth`. Exact RED command:
  `npx vitest run packages/cli/lib/r19-frozen-workflow-audit.regression.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; `1/13` failed and `12/13` passed. The post-build signature test saw the
  unsupported flag in generated YAML exactly as expected.

## 2026-08-03 — R19 verifier repairs focused GREEN

- Direct quoted Tauri invocation now survives PowerShell, updater platform metadata derives from a
  bounded runner family/architecture pair, native targets default to isolated
  `desktop-<target-id>` outputs, and duplicate web/native outputs are rejected before mutation.
- The native lifecycle now reads the actual Tauri window fullscreen state before toggling or
  updating preferences/ARIA. Signed release status is written only after validating the produced
  macOS app signature and stapled ticket or Windows Authenticode signer. The macOS verifier avoids
  GNU-only `find` flags.
- Focused R19 command:
  `npx vitest run packages/cli/lib/r19-*.test.mjs packages/mcp/r19-*.test.mjs packages/player-runtime/src/r19-*.test.mjs packages/studio/r19-*.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `0`; `14/14` files and `81/81` tests passed. `npm run plugin:build` regenerated the
  source-owned plugin runtime. Exact-commit full gates, native matrix CI and independent sign-offs
  remain pending until the repaired candidate is committed.

## 2026-08-03 — R19 cross-platform recipe output allocator RED

- A read-only pre-freeze audit found that schema v2 validates web `webDir` and native `outputDir`
  in one shared namespace, but each recipe allocator inspected only targets of its own platform.
  A valid existing web target could therefore make the native recipe fail its own preview, and the
  reverse collision was equally possible.
- Before changing the allocator, a bidirectional regression was added. Exact RED command:
  `npx vitest run packages/cli/lib/r19-native-desktop-target.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; `1/10` failed and `9/10` passed. The native allocator selected the existing
  web-owned `desktop-native-new`; the first assertion stopped the test before the symmetric check.
- GREEN: both recipes now collect effective web and native output directories through one bounded
  canonical helper. The focused contract passes `10/10`; the plugin mirror was regenerated before
  the next complete R19 regression pass.
- Pre-freeze R19 regression rerun: `14/14` files and `82/82` tests passed. This is focused evidence;
  acceptance still requires the full gate set on the committed SHA.

## 2026-08-03 — R19 final integration verifier disabled-guide RED

- Final Constructor Integration Verifier rejected frozen commit `2c7f436` because an absent or
  disabled updater still left updater secret names, payload language and `latest.json` in generated
  `SIGNING.md`. Runtime/plugin bytes were absent, but the public contract requires the entire
  carrier to remain updater-byte-free when the option is off.
- Before production repair, the disabled-carrier contract was expanded from a hand-picked runtime
  list to every generated text file and now rejects updater secret names and release metadata too.
  Exact RED command:
  `npx vitest run packages/cli/lib/r19-optional-updater.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; `2/4` failed and `2/4` passed. Both absent and explicit `{ enabled: false }`
  cases found the unconditional signing-guide text.

## 2026-08-03 — R19 final verifier follow-up RED contracts

- Code verification found that enabled -> disabled repack preserves
  `scripts/collect-updater-entry.mjs`, and that signed Windows verification recursively counts both
  the application `.exe` and NSIS setup `.exe`. Constructor verification also found dangling
  `defaults.desktop` after Studio rename/delete and ancestor/descendant output overlaps accepted by
  schema/recipe allocation.
- Before production repair, regressions were added for updater-source cleanup, bundle-directory-only
  Authenticode lookup, default rewriting/removal, nested web/native output rejection, and recipe
  allocation against nested paths. Exact RED command:
  `npx vitest run packages/cli/lib/r19-optional-updater.contract.test.mjs packages/cli/lib/r19-frozen-workflow-audit.regression.test.mjs packages/cli/lib/r19-native-desktop-target.contract.test.mjs packages/studio/r19-native-desktop-target-surface.contract.test.mjs --reporter=verbose --maxWorkers=1`.
- Result: exit `1`; `7/33` tests failed and `26/33` passed. Each failure matched the frozen
  verifier finding: two disabled-carrier leaks, one stale generated updater source, one broad
  Windows executable scan, one nested-path schema acceptance, one nested-path recipe collision,
  and one missing Studio default rewrite.
- Minimal production repairs then made the same combined command GREEN: `4/4` files and `33/33`
  tests passed. The complete focused R19 regression set also passed sequentially: `14/14` files and
  `85/85` tests. This remains pre-commit evidence; all repository gates and both independent
  sign-offs must be repeated on the next exact frozen source commit.

## 2026-08-03 — R19 nested-output diagnostic compatibility RED

- The first full unit gate on candidate `9ae9591` exposed two existing R18 contract failures:
  `packages/mcp/r18-player-targets-authoring.contract.test.mjs` and
  `packages/cli/lib/r18-build-targets.contract.test.mjs`. Result: `2/4108` failed while `4106/4108`
  passed. Both expected the stable duplicate-output diagnostic vocabulary (`unique`, `duplicate` or
  `already used`), while the stricter nested-path implementation emitted only `isolated`.
- This is accepted as the compatibility RED for the verifier-driven diagnostic repair. The minimal
  fix preserves the new ancestor/descendant rejection and restores the word `unique`. Candidate
  `9ae9591` and all of its partial gate evidence are invalidated.

## 2026-08-03 — R19 final Studio rename-collision RED

- Constructor Integration Verification of frozen commit `c2500cd` found that renaming a build
  target to an existing target ID silently overwrote the existing record, rewrote platform defaults,
  and could then pass ordinary schema validation. This bypassed the explicit Remove confirmation.
- Before production repair, a focused Studio contract now requires an own-property collision guard,
  restoration of the edited input to the original ID, and an early return before target assignment.
  Exact RED command:
  `npx vitest run packages/studio/r19-native-desktop-target-surface.contract.test.mjs --reporter=verbose --maxWorkers=1`.
- Result: exit `1`; `1/5` tests failed and `4/5` passed for the expected missing collision guard.
- The same integration audit found that a real updater-enabled native build can leave updater
  payloads/signatures under `src-tauri/target` and updater dependency bytes in generated
  `Cargo.lock`. The earlier enabled -> disabled test had not seeded build outputs. Before production
  repair it now seeds those bounded generated artifacts, requires their removal, and proves an
  unrelated carrier note survives. Combined RED command:
  `npx vitest run packages/studio/r19-native-desktop-target-surface.contract.test.mjs packages/cli/lib/r19-optional-updater.contract.test.mjs --reporter=verbose --maxWorkers=1`.
- Result: exit `1`; `2/10` tests failed and `8/10` passed. The failures were exactly the missing
  pre-mutation rename collision guard and the retained updater-enabled native build directory.
  Candidate `c2500cd`, its CI runs, and both rejected verifier reports are not reusable as final
  acceptance evidence.
- Minimal repairs made the same combined command GREEN: `2/2` files and `10/10` tests passed.
- The complete focused R19 set then passed sequentially: `14/14` files and `86/86` tests. Full
  exact-commit gates and fresh verifier sign-offs remain mandatory after the next commit.

## 2026-08-03 — R19 exact-candidate symlink confinement and rename-rebind RED

- Both independent verifiers rejected frozen production commit `0aea94b` after its local and GitHub
  gates passed. Code verification found that disabled-updater cleanup followed an existing internal
  `src-tauri` symlink and that Studio retained old target-card handlers after a successful rename.
  Constructor integration verification additionally reproduced an external-file overwrite by
  replacing generated `src-tauri/Cargo.toml` with a symlink before repack.
- Before production repair, three regressions were added: successful rename must rerender/rebind;
  repack must reject an exact generated-file symlink without changing its outside sentinel; and
  disabled-updater cleanup must reject a symlinked `src-tauri` without deleting outside `target` or
  `Cargo.lock` sentinels.
- Exact RED command:
  `npx vitest run packages/studio/r19-native-desktop-target-surface.contract.test.mjs packages/cli/lib/r19-verifier-packaging-boundaries.regression.test.mjs packages/cli/lib/r19-optional-updater.contract.test.mjs --reporter=verbose --maxWorkers=1`.
- Expected RED is the missing Studio rerender plus unsafe successful/throwing native repacks that
  mutate external sentinels. Candidate `0aea94b`, CI runs `30785188932`/`30785188939`, its gate
  evidence and both rejected verifier reports are not reusable for acceptance.
- Result: exit `1`; exactly `3/32` tests failed and `29/32` passed. The failures were the missing
  rename rerender, a successful repack through a generated-file symlink, and successful cleanup
  through a symlinked `src-tauri`; both external mutation paths reproduced the verifier findings.
- Minimal GREEN routes every generated package scaffold read/write/cleanup through the shared
  project-confined writer and rerenders the Studio card after the ID transaction. The exact RED
  command now passes `32/32`; the complete focused R19 suite passes `14/14` files and `89/89`
  tests. The source/plugin runtime mirror was regenerated. Full gates and both independent
  sign-offs still require a new exact committed candidate.

## 2026-08-03 — R19 dangling generated-file symlink RED

- Code verification rejected exact candidate `ecc86e8` after every local/GitHub gate passed. The
  confined writer rejected an exact symlink only when its target already existed because the shared
  path helper used `existsSync`. A dangling generated-file symlink therefore looked absent and
  `writeFileSync` followed it to create a new external target.
- Before production repair, a separate regression packages a carrier, replaces generated
  `src-tauri/Cargo.toml` with a symlink to a nonexistent outside file, repackages, and requires a
  closed failure while both the missing target and link remain untouched.
- Exact RED command:
  `npx vitest run packages/cli/lib/r19-verifier-packaging-boundaries.regression.test.mjs --reporter=verbose --maxWorkers=1`.
- Expected RED is a successful second package and newly created outside TOML. Candidate `ecc86e8`,
  its CI runs `30786379326`/`30786379344`, complete gate evidence, rejected Code Verifier report and
  now-invalid Constructor Integration sign-off cannot be reused for final acceptance.
- Result: exit `1`; exactly `1/21` failed and `20/21` passed. The second package returned success,
  proving the dangling link escaped the exact-path check. GREEN changes the shared nearest-ancestor
  and exact-path discovery to `lstat`, rejects unresolved symlinks before mutation, and makes the
  same command pass `21/21` while preserving the existing symlink and output-isolation cases.

## 2026-08-03 — R19 exact frozen acceptance GREEN

- Exact frozen production source:
  `9a386303d2d894e17ba81d927074622efe0a912d`. The dangling-symlink repair advances shared project
  confinement to `lstat`, rejects unresolved exact/intermediate symlinks before mutation and leaves
  outside targets untouched. The complete focused R19 set passes `14/14` files and `90/90` tests.
- Exact-commit local gates are GREEN: typecheck, engine build, content validation, tutorial
  simulation, starter balance, map compilation, complete build, plugin build/validate/smoke and
  source-to-plugin byte parity. The complete unit suite passes `428/428` files and `4113/4113`
  tests; Playwright passes `157/157`; desktop Cargo passes `9/9`; mobile packaging, the legacy
  desktop wrapper and the first-class native carrier all pass.
- GitHub CI run `30788623051` is GREEN for common, R18 large-screen and ultrawide checks. Generated
  game acceptance run `30788623046` is GREEN for generation, macOS, Windows, Ubuntu and final
  acceptance; exactly six installer formats were assembled.
- The exact-source macOS artifact
  `/private/tmp/towerforge-r19-exact-ecc86e8.tdproj/native-carrier/src-tauri/target/release/bundle/dmg/R19 Generated Acceptance_0.1.0_aarch64.dmg`
  passed `hdiutil verify`, mounted read-only and launched the generated application. Its SHA-256 is
  `00e9cbe161ba88c8acbf17495bf2848801bfc94830ef91b461b383d8ce0b271f`.
- Fresh read-only Code Verifier and Constructor Integration Verifier audits both issued explicit
  SIGN-OFF for the exact frozen source. They independently covered exact/intermediate/dangling
  symlink confinement, scaffold/archive boundaries, updater cleanup, Windows signing scope, output
  isolation, Studio create/edit/rename/reload/collision/rebinding, native storage/lifecycle,
  disabled/legacy paths, MCP/AI/plugin parity and all six installer formats. No actionable findings
  remain. ADR 0060 is Accepted; R19 is ready for PR #35 merge.

## 2026-08-03 — R20.1 CameraProfile/projector contract RED

- Contract freeze before production changes: `CameraProfileV1` is a closed own-data renderer
  contract with `top_down`, `isometric_2_1` and `dimetric_oblique` projections, four fixed authored
  orientations, scalar presentation elevation, bounded fit/zoom settings and deterministic depth
  ordering by projected Y, elevation and stable entity ID. The pure projector owns projection,
  inverse hit coordinates and depth keys; engine coordinates and gameplay are unchanged.
- Resolution precedence is frozen as mission binding -> map binding -> BuildTargets v2
  `cameraProfileId` -> visuals default -> bundled top-down fallback. `content/visuals.json` v4 can
  contain `cameraProfiles` schema v1 together with existing Procedural Juice v1. Visuals v3 and a
  BuildTargets v2 target without `cameraProfileId` retain their prior normalized shapes.
- Focused RED tests were added without production changes in
  `packages/renderer/src/r20-camera-projector.contract.test.mjs` and
  `packages/cli/lib/r20-camera-project-schema.contract.test.mjs`. They cover golden projection
  vectors, four orientations, inverse/elevation round trips, stable depth, precedence, input-order
  invariance, detached results, future/unknown/non-finite/over-budget inputs, accessor/proxy/cycle
  confinement, visuals v4 validation, v3 compatibility, Procedural Juice coexistence and
  BuildTargets camera references.
- Exact RED command:
  `npx vitest run packages/renderer/src/r20-camera-projector.contract.test.mjs packages/cli/lib/r20-camera-project-schema.contract.test.mjs --reporter=verbose --maxWorkers=1`.
- Expected RED: renderer import fails because `camera-projector.mjs` does not exist; BuildTargets v2
  rejects `cameraProfileId` as unknown; visuals has no v4/CameraProfile validation; Procedural Juice
  still requires exactly visuals v3. Result: exit `1`, both files failed, `15/16` tests failed and
  the sole passing test proved the camera-absent visuals v3/BuildTargets compatibility baseline.
  R20.3 view-specific asset variants are explicitly outside this R20.1 slice.

## 2026-08-03 — R20.1 CameraProfile/projector focused GREEN

- Added one browser-safe pure projector in `packages/renderer/src/camera-projector.mjs`. It compiles
  closed `CameraProfileV1` own data, applies the frozen three projection bases and four rotations,
  provides the elevation-aware inverse, emits stable depth keys and resolves mission -> map ->
  build target -> visuals default -> bundled top-down without reading or mutating engine state.
- `content/visuals.json` validation now accepts schema v4 camera catalogs and preserves inner
  Procedural Juice v1. BuildTargets v2 accepts one optional bounded `cameraProfileId` and rejects an
  unknown reference. Visuals v2/v3 defaults and camera-absent v1/v2 build targets remain unchanged.
- The exact RED command is now GREEN: `2/2` files and `32/32` tests pass. Focused affected-layer
  regressions for R11 schema/authoring/presentation, R18/R19 build targets and the Canvas renderer
  pass `6/6` files and `72/72` tests. R20.2 renderer integration remains a separate RED/GREEN slice.

## 2026-08-03 — R20.2 shared renderer/generated-player integration RED

- Contract freeze after the R20.1 pure projector baseline `230b9cc`: Canvas and Phaser must use one
  renderer-owned `camera-renderer-integration.mjs` render-space composition. It projects authored
  world points before constructing the R18 `ViewportTransform`, reverses viewport before projector
  for hit tests, derives bounds/signatures from projected coordinates and applies the same
  elevation/depth ordering to tiles, entities and projectiles. Engine coordinates remain untouched.
- Two focused RED files were added before R20.2 production changes:
  `packages/renderer/src/r20-camera-renderer-integration.contract.test.mjs` and
  `packages/cli/build.r20-camera-projection-package.contract.test.mjs`. The generated package
  matrix covers Canvas/Phaser x hex/square, project data, PWA cache, single-file embedding and an
  untouched legacy/top-down output. Browser interaction acceptance is deliberately deferred to a
  separate R20.2b slice.
- Exact RED command:
  `npx vitest run packages/renderer/src/r20-camera-renderer-integration.contract.test.mjs packages/cli/build.r20-camera-projection-package.contract.test.mjs --reporter=verbose --maxWorkers=1`.
- Expected RED: the shared integration module/import does not exist; Canvas still composes only raw
  grid coordinates with `ViewportTransform`; generated active builds do not contain the shared
  camera module; and legacy builds currently copy `camera-projector.mjs` despite the feature being
  absent. Result: exit `1`, both files failed and all `8/8` tests failed for those exact reasons.
  No production file was changed by the Contract/Test Designer.

## 2026-08-03 — R20.2 visuals-v4 Juice renderer coexistence RED

- A focused regression was added before changing the R11 renderer compiler: the same valid
  Procedural Juice v1 catalog must produce byte-equivalent presentation instructions when visuals
  v4 adds an independent camera catalog. Exact command:
  `npx vitest run packages/renderer/src/procedural-juice-presentation.contract.test.mjs --reporter=verbose --maxWorkers=1 -t "preserves the exact Procedural Juice projection"`.
- Result: exit `1`, the new test failed because the renderer still accepted exactly visuals v3 and
  returned the inert projection for v4. The expected v3 projection remained active. This RED is
  limited to coexistence; it does not change Juice effects or camera-profile semantics.

## 2026-08-03 — R20.2 shared renderer/generated-player focused GREEN

- Added one browser-safe `camera-renderer-integration.mjs` that composes the R20 projector before
  the R18 viewport transform, reverses that order for hit testing, derives projected bounds and a
  stable render-space signature, and applies the shared depth comparator to detached render items.
  The Canvas renderer now uses that contract for map bounds, centers, pointer selection and tower
  ordering. Active generated Canvas and Phaser players import the exact same module for hex and
  square targets; PWA and single-file outputs contain it, while inactive legacy outputs exclude
  both R20 modules and camera-profile reads.
- Visuals v4 now preserves the exact existing Procedural Juice projection instead of treating the
  independent camera catalog as an incompatible future catalog. This coexistence repair changes no
  Juice cue, entropy or gameplay semantics.
- The combined focused command passes `3/3` files and `22/22` tests. Renderer/build regressions pass
  `4/4` files and `43/43` tests; syntax checks, `git diff --check` and `npm run build` are GREEN.
  R20.3 asset variants and R20.4 Camera Studio/MCP remain separate contract-first slices.

## 2026-08-03 — R20.3 view-specific assets RED

- Contract/Test Designer added focused pure-renderer and CLI/package contracts before production
  changes. The frozen v1 shape is `visuals.viewVariants` with an exact
  `projection:orientation` key, optional sprite billboard fallback, mandatory tileset-material
  coverage, bounded anchors and project-local PNG/JPEG/WebP assets. Coverage rows must be detached
  and binary-stable; another authored view is never an implicit fallback.
- The CLI contract also requires deterministic asset enumeration/copying, signature and declared
  size verification, PWA/single-file inclusion, WebP support in the existing guarded staging
  pipeline, and preservation of visuals v4/view variants through ordinary asset and tileset
  imports. The known tileset write that forced `schemaVersion = 2` is captured as a regression.
- Exact RED command:
  `npx vitest run packages/renderer/src/r20-camera-view-assets.contract.test.mjs packages/cli/lib/r20-camera-view-assets.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`, `2/2` files and all `17/17` tests failed for the expected missing resolver,
  missing schema/path/copy validation, missing WebP signature support and visuals-v4 downgrade.
  No production file was changed by the Contract/Test Designer.

## 2026-08-03 — R20.3 view-specific assets focused GREEN

- Added the shared `camera-view-assets.mjs` resolver and coverage projector. Exact variants are
  keyed only by projection plus orientation; standalone sprites use the authored billboard as a
  warning-producing fallback, while missing tileset materials are blocking coverage errors.
  Results are detached, deeply frozen and binary-stable.
- Visuals v4 now validates a closed `viewVariants` v1 catalog with bounded anchors, mandatory
  authored tileset materials and project-local PNG/JPEG/WebP declarations. Build asset enumeration
  and copying include the variant files and verify their signatures and 32 MiB size ceiling.
  Single-file builds embed the same assets, and WebP is accepted by the existing guarded staging
  pipeline. Asset and MCP tileset imports preserve visuals v4 instead of downgrading it to v2.
- Canvas resolves camera-specific standalone sprites and anchors at presentation time; generated
  Phaser players preload and resolve the same catalog. Legacy projects remain on their base
  sprites, and inactive packages exclude the R20 view-asset module.
- The exact RED command is now GREEN at `2/2` files and `17/17` tests. Focused schema, assets,
  generated-asset, renderer and generative-MCP regressions pass `6/6` files and `78/78` tests;
  MCP asset/tileset selection passes `5/5`. Syntax checks and `git diff --check` are GREEN.

## 2026-08-03 — R20.4 Camera Studio/MCP authoring RED

- Contract review corrected an R20.1 drift: the approved selection order is exactly mission -> map
  -> build-target -> built-in top-down. `cameraProfiles.bindings.defaultProfileId` is not part of
  the public plan or ADR 0061 and must be rejected rather than creating a fifth implicit default.
- A focused MCP/AI contract was added before production changes. It requires the `camera` schema
  domain, narrow read/recipe/compute-preview/guarded-upsert tools, detached recipes for all three
  projections and four orientations, resolution/bounds/clipping/depth/asset-coverage diagnostics,
  adjacent Procedural Juice/view-variant preservation, stale-revision rejection, backup/rollback
  metadata, updated agent instructions and no broad camera-section replacement tool.
- Exact RED command:
  `npx vitest run packages/mcp/r20-camera-authoring.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`, one file and all `5/5` tests failed: unknown `camera` domain/tools and guide v52.
  No production file was changed by the Contract/Test Designer.

## 2026-08-03 — R20.4 Procedural Juice/camera coexistence RED

- Before changing the existing visuals authoring transaction, a regression promoted a fixture to
  project v5/visuals v4 with empty `cameraProfiles` and `viewVariants`, then previewed a normal
  Procedural Juice edit. Exact command:
  `npx vitest run packages/cli/lib/procedural-juice-authoring.contract.test.mjs --reporter=verbose --maxWorkers=1 -t "preserves visuals v4 camera"`.
- Result: exit `1`; the focused test failed because the R11 authoring guard supported visuals only
  through v3 and would have downgraded a valid camera catalog. The expected repair accepts v4 and
  preserves both adjacent R20 catalogs byte-for-data through preview/apply.

## 2026-08-03 — R20.4 Camera Studio surface RED

- Before Studio production changes, a focused source contract required projection/orientation,
  profile and map/mission binding controls, preview/apply actions, diagnostics output and the exact
  narrow MCP-backed read/recipe/preview/apply server routes.
- Exact RED command:
  `npx vitest run packages/studio/r20-camera-studio.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; both `2/2` tests failed because Camera Studio controls, client workflow and
  server routes did not exist.

## 2026-08-03 — R20.4 pre-freeze hardening RED

- After the first Camera Studio lifecycle E2E reached GREEN, two missing acceptance boundaries were
  captured before hardening production code: owned camera sources must reject symlink traversal,
  and Camera Studio must expose the full bounded profile/viewport surface plus an actual preview
  canvas rather than only projection/orientation and textual JSON.
- Exact command:
  `npx vitest run packages/mcp/r20-camera-authoring.contract.test.mjs packages/studio/r20-camera-studio.contract.test.mjs --reporter=verbose --maxWorkers=1`.
- Result: exit `1`; `2/2` focused tests failed for the expected reasons. The authoring transaction
  followed a symlinked `content` directory and wrote an outside temporary fixture, while the Studio
  lacked viewport preset, fit/pan/elevation/zoom controls and `camera-preview-canvas`. The remaining
  six tests stayed GREEN. All writes were confined to temporary test directories.

## 2026-08-03 — R20.4 binding disable/re-enable RED

- A final opt-in lifecycle contract was added before production changes: disabling one authored
  mission/map binding must restore the built-in top-down fallback without deleting the reusable
  profile, and applying the same binding again must re-enable it. Studio must expose the guarded
  disable action beside preview/apply.
- Exact command:
  `npx vitest run packages/mcp/r20-camera-authoring.contract.test.mjs packages/studio/r20-camera-studio.contract.test.mjs --reporter=dot --maxWorkers=1`.
- Result: exit `1`; the focused binding test still resolved the mission profile because
  `binding.enabled=false` was ignored, and the Studio contract lacked `btn-camera-disable`.

## 2026-08-03 — R20.4 Camera Studio lifecycle/security focused GREEN

- The narrow camera authoring transaction now rejects symlink traversal through the project root,
  owned JSON parents and backup directories before it reads or writes. It rechecks the composite
  revision immediately before commit, preserves adjacent visuals-v4 catalogs and keeps backups
  project-confined. Camera preview derives bounded map geometry, reports actual padded clipping and
  returns detached projected points for the Studio canvas.
- Camera Studio now exposes all CameraProfileV1 bounds, six desktop viewport presets, a live
  projection canvas, map/mission binding, guarded preview/apply and guarded binding disable. A
  disabled binding leaves the reusable profile intact and restores the lower-precedence selection;
  the same profile can be re-enabled without reauthoring it.
- Focused MCP/Studio/Juice coexistence tests pass `4/4` files and `24/24` tests. The real browser
  lifecycle `tests/e2e/r20-camera-studio.spec.mjs` passes enable -> save -> disable -> top-down
  restoration -> re-enable -> reload plus stale-revision rejection. This is not the R20 freeze:
  renderer/package and saved-profile/AI authoring gaps identified by pre-freeze audit remain open.

## 2026-08-03 — R20 pre-freeze authoring/AI/default-anchor RED

- Independent pre-freeze review added behavioral regressions for mandatory tileset coverage,
  accessor/proxy/cycle/profile-budget inputs, injected two-file commit failure, the shared optional
  sprite-anchor default and embedded Studio AI access to all four narrow camera tools.
- Exact command:
  `npx vitest run packages/mcp/r20-camera-authoring-hardening.contract.test.mjs packages/studio/lib/ai-tool-policy.test.mjs packages/cli/lib/r20-camera-view-assets.contract.test.mjs packages/renderer/src/r20-camera-view-assets.contract.test.mjs --reporter=verbose --maxWorkers=1`.
- Result: exit `1`, `4/4` files with six expected failures: missing required view coverage did not
  make preview/apply fail; an accessor executed twice; the second-rename fault left a staged file;
  omitted anchors were rejected/not normalized; and embedded AI filtered out the camera tools.
  Revoked proxies, cycles and the 33rd profile already failed closed and remained GREEN.

## 2026-08-03 — R20 pre-freeze renderer/package P0 RED

- An independent Contract/Test Designer added two behavioral regression files after the audit;
  production and `progress.md` were untouched by that role.
- Renderer command:
  `npx vitest run packages/renderer/src/r20-camera-p0-runtime.regression.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`, `3/3` RED: Canvas mixed-kind actors were category ordered, the active tileset
  variant still loaded the base atlas, and schema-valid `fitPadding=512` crashed 1024×720.
- Package command:
  `npx vitest run packages/cli/build.r20-camera-p0-runtime-isolation.regression.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`, `5/5` RED: a plain target in a mixed project still bundled camera runtime;
  Phaser only imported but did not invoke shared depth projection; picking skipped shared inverse
  conversion; tileset variants had no runtime texture path; and authored anchors never reached
  `setOrigin`.

## 2026-08-03 — R20 saved-profile/build-target Studio RED

- Camera Studio source and browser contracts now require a saved-profile picker that restores all
  editable values and its mission/map binding after reload, plus a Build Targets
  `cameraProfileId` selector populated from the same catalog.
- Before production changes the combined authoring command reported `8/39` RED across the complete
  hardening set, and `tests/e2e/r20-camera-studio.spec.mjs` failed `1/1` because
  `#camera-profile-picker` did not exist. After the independent hardening fixes, the same source
  set narrowed to exactly the picker/reload and build-target UI failures; their GREEN evidence is
  recorded only after the browser lifecycle passes.

## 2026-08-03 — R20 pre-freeze authoring and runtime GREEN

- Camera Studio now reloads saved profiles and bindings, exposes the same catalog to the
  BuildTargets-v2 `cameraProfileId` selector, and keeps guarded disable/re-enable semantics. The
  complete focused authoring/hardening matrix is GREEN at `6/6` files and `39/39` tests; the real
  browser lifecycle is GREEN at `2/2` tests, including persisted build-target selection.
- Canvas now depth-orders mixed camera actors through the shared projector, consumes exact
  camera tileset variants and accepts the schema-valid maximum fit padding without crashing. The
  exact renderer RED command is GREEN at `3/3` tests.
- Generated Phaser players now invoke the shared depth projector for tiles and actors, route
  pointer selection through the inverse camera transform, preload and consume exact tileset
  atlases, and apply authored sprite anchors. A non-camera target in the same project excludes all
  camera modules and profile reads. The exact package RED command is GREEN at `5/5` tests.
- This remains pre-freeze evidence. The exact candidate commit, full gates and two independent
  sign-offs are recorded separately after the focused matrix and generated package smoke pass.

## 2026-08-03 — R20 first full-gate parity repair

- The first frozen candidate `96afd13f8d2415f5a6dfc6d4062d0dffcfc2c373` passed typecheck and
  engine build, then the complete unit gate correctly failed `16` tests. The failures were confined
  to the generated Codex plugin runtime still carrying the pre-R20 renderer/MCP/guide bytes and
  legacy contracts pinning agent guide v52 after the intentional camera authoring bump to v53.
- No camera runtime or constructor behavior failed. `npm run plugin:build` regenerated the owned
  mirror from source, and the nine exact guide-version assertions were promoted to v53. The focused
  set covering all 16 prior failures is GREEN at `14/14` files and `73/73` tests.
- Because this repair changes tracked test/mirror files, the first freeze and its partial gate
  evidence are invalid. A new exact candidate commit receives the complete gate set from the start.

## 2026-08-03 — R20 independent-verifier regression RED

- The first independent Code and Constructor Integration reviews rejected candidate `a5a0c20`.
  Contract/Test Designer changes were limited to five regression files and captured four distinct
  release blockers before production repair: generated Phaser did not place projectiles and
  destructibles into its real mixed-actor depth order; Canvas/Phaser actor projection ignored
  authoritative tile elevation; a catalog selected only through mission/map bindings was omitted
  from a target bundle; and CSS-authored fit/pan padding was not scaled for a DPR-2 Canvas.
- Exact renderer/package RED command:
  `npx vitest run packages/renderer/src/r20-camera-elevation-dpr.regression.test.mjs packages/cli/build.r20-camera-p0-runtime-isolation.regression.test.mjs --reporter=verbose --maxWorkers=1`.
  Initial result: exit `1`, five expected RED assertions covering the real Phaser layers,
  elevation, binding-only activation and DPR padding.
- A separate fail-closed command
  `npx vitest run packages/renderer/src/r20-camera-view-assets-hardening.regression.test.mjs packages/cli/lib/r20-camera-view-assets.contract.test.mjs --reporter=verbose --maxWorkers=1`
  produced five expected RED assertions: accessor fallback, cyclic stack overflow, absent schema
  budgets and runtime acceptance above 4096 sprite/256 tileset variant records.
- The topology-aware preview regression in
  `packages/mcp/r20-camera-authoring.contract.test.mjs` also failed because preview used raw q/r
  bounds rather than the shared square/hex world centers and viewport render space. No production
  code was changed by the Contract/Test Designer.

## 2026-08-03 — R20 independent-verifier regression focused GREEN

- View-variant schema, resolver and coverage now validate closed own-data without invoking
  accessors, contain proxy/cycle failures and enforce the shared 4096/256 budgets. Camera preview
  now uses the same square/hex centers, projector, target viewport and clipping calculation as the
  player runtime.
- Canvas resolves entity elevation from authoritative snapshot tiles, invalidates cached camera
  bounds when elevation changes and scales authored fit/pan padding into backing pixels. Generated
  Phaser uses the same elevation lookup for tiles, towers, destructibles and projectile endpoints;
  inverse hit testing is performed at each candidate tile elevation.
- Phaser camera builds now allocate one real Graphics layer per stable actor key and assign all
  towers, enemies, heroes, projectiles and destructibles from one
  `projectCameraRenderItemsV1` order. Mission/map bindings activate the camera runtime even without
  a target default, while a genuinely unbound target still excludes all camera modules.
- Exact combined focused command covering the five independent regression files plus shared
  projector integration is GREEN: `5/5` executed files and `38/38` tests. Syntax checks and
  `git diff --check` are GREEN. This repair invalidates the previous freeze and both prior review
  outcomes; the next commit must run the full gates and receive fresh independent sign-offs.

## 2026-08-03 — R20 second full-gate legacy-contract repair

- Candidate `0359fd9` passed typecheck, validation and the tutorial simulation. The complete
  one-worker unit gate then ran `441` files and found one test-contract conflict after `4211`
  passing tests: an R13 source-regex prohibited every renderer identifier containing
  `elevationAt`, although R20 legitimately resolves authoritative tile elevation solely for
  presentation projection.
- The R13 boundary still forbids topology, LoS, blocker-height and arc-clearance recomputation; its
  assertion was narrowed to those gameplay concepts. Focused R13 plus R20 elevation verification
  is GREEN at `2/2` files and `5/5` tests. Because a tracked test changed, `0359fd9` is no longer
  the frozen candidate and the complete gate sequence restarts on the next commit.

## 2026-08-03 — R20 final candidate gate evidence

- Production/test candidate `7be82f407481ee9880c27c737daaa433e8ba96eb` is clean. Full unit gate
  passed `441/441` files and `4212/4212` tests with the repository/CI one-worker setting. Full
  Playwright E2E passed `159/159` scenarios in the same one-worker setting, including the Camera
  Studio lifecycle and both generated player paths.
- `npm run typecheck`, `npm run build:engine`, `npm run validate`,
  `npm run sim tutorial_01 60` and `npm run build` are GREEN. The generated web PWA is valid.
- `npm run plugin:build`, `npm run plugin:validate` and `npm run plugin:smoke` are GREEN with no
  mirror diff. Mobile and desktop scaffold packaging both succeed for `examples/starter.tdproj`;
  desktop Rust tests pass `9/9` and the working tree remains clean.
- The full gates ran after the R13 contract correction and on the exact production/test tree above.
  Independent Code Verifier and Constructor Integration Verifier reviews are still required before
  R20 acceptance or merge.

## 2026-08-03 — R20 second independent-verifier rejection and RED evidence

- Independent review rejected candidate `6837d1c` and invalidated its freeze/sign-offs. Four
  release blockers were separated from the previous focused matrix: BuildTargets v1 could activate
  the camera runtime through visuals-only mission/map bindings; camera preview retained a duplicate
  zero-elevation point over an authored elevated coordinate; a newly authored but still unbound
  camera profile previewed the built-in top-down fallback; and no narrow guarded Studio/MCP path
  could bind an already imported/staged view-specific asset. Constructor review also found that
  generated Phaser used camera variants for heroes and tiles but not towers or enemies.
- An independent Contract/Test Designer captured the failures before the production repair in
  `build.r20-camera-p0-runtime-isolation.regression.test.mjs`,
  `r20-camera-authoring.contract.test.mjs`,
  `r20-camera-view-variant-authoring.regression.test.mjs`, and
  `r20-camera-studio.contract.test.mjs`. The isolated RED assertions failed for the expected
  missing legacy gate, authoritative coordinate merge, candidate preview, one-variant lifecycle,
  Studio binder and Phaser sprite/anchor paths. Production and this progress log were not changed
  by the test-designer role.

## 2026-08-03 — R20 verifier repairs focused GREEN

- Camera projection activation is now gated by BuildTargets v2 large-screen targets; legacy v1
  bundles strip camera imports, exports, constructor catalog resolution and selector code even when
  visuals v4 contains reusable bindings. Preview coordinates are merged by q/r with elevation
  overrides authoritative, and an unbound candidate profile is rendered directly for pre-save live
  inspection without changing persisted selection precedence.
- Added narrow `preview_camera_view_variant` and `apply_camera_view_variant` operations. They accept
  one sprite or tileset variant, enforce closed bounded own-data, project-local real files,
  PNG/JPEG/WebP signature and size validation, canonical schema/coverage validation, revision
  recheck, confined backup and rollback. Camera Studio exposes the same guarded one-variant binder
  for existing or staged assets; the embedded AI policy and instructions advertise this granular
  workflow rather than a broad visuals writer.
- Generated camera-enabled Phaser players now resolve tower and enemy bindings through the same
  exact view-variant catalog as Canvas, apply authored anchors, participate in the stable mixed-actor
  depth order and clean up despawned images. The legacy generated source remains byte-structurally
  free of those image maps and camera branches.
- Exact focused unit command covering all R20 contract/regression files is GREEN at `14/14` files
  and `103/103` tests. The real Camera Studio Playwright lifecycle is GREEN at `2/2`; its first
  sandboxed attempt failed only because binding `127.0.0.1` was denied, and the approved local-port
  rerun passed. `git diff --check` is GREEN. This is pre-freeze evidence: the full gates and both
  independent reviews must run again on the next exact committed candidate.

## 2026-08-03 — R20 repaired candidate full gates

- Production/test candidate `65c7e530d2e05ce63fa98ee55745952695395796` was clean before and
  after the complete gate run. `npm run typecheck`, `npm run build:engine`, `npm run validate`,
  `npm run sim tutorial_01 60` and `npm run build` are GREEN.
- Full one-worker unit gate passed `442/442` files and `4219/4219` tests. Full one-worker
  Playwright E2E passed `159/159`, including R20 Camera Studio, Canvas/Phaser, hex/square,
  legacy paths and all R18 large-screen viewport scenarios.
- `npm run plugin:build`, `npm run plugin:validate` and `npm run plugin:smoke` are GREEN and leave
  the generated mirror unchanged. Starter mobile and desktop package commands are GREEN; desktop
  Rust lifecycle tests pass `9/9`. `git diff --exit-code` is GREEN after all generators and gates.
- This entry is the only change after the exact production/test candidate. The production tree is
  frozen; fresh independent Code Verifier and Constructor Integration Verifier sign-offs must
  review the docs-only child commit before PR creation or merge.

## 2026-08-03 — R20 final verifier security/runtime RED

- The next independent review rejected docs candidate `b605f60` on four release boundaries. The
  Contract/Test Designer changed tests and this chronological evidence only; production and plugin
  sources remained untouched. The freeze and the preceding full-gate evidence are invalidated.
- Exact focused unit command:
  `npx vitest run packages/cli/lib/r20-camera-view-assets.contract.test.mjs packages/renderer/src/r20-camera-prototype-safety.regression.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`, `5` expected RED and `16` passing tests. A camera-variant symlink was followed
  and copied from outside the project; a signature-invalid camera asset still produced build exit
  `0`/`ok:true`; own `__proto__`/`constructor`/`prototype` profile and binding IDs were dropped or
  resolved through mutated/inherited prototypes; and the equivalent sprite/tileset ID contract did
  not remain closed own-data.
- Actual generated-player command:
  `npx playwright test tests/e2e/r20-camera-generated-boot.regression.spec.mjs --workers=1 --reporter=line`.
  The sandboxed attempt reached the expected loopback restriction (`listen EPERM`); the approved
  loopback rerun exited `1` with `2/2` expected RED browser cases. The built Canvas target emitted
  one and the built Phaser target emitted three page errors, all exactly
  `cameraRenderSpace.viewportProfile.fit is not supported.` This proves both generated paths passed
  the complete BuildTargets viewport object into the closed camera render-space contract.

## 2026-08-03 — R20 final verifier repairs focused GREEN

- Asset import and build copying now inspect every source path component without following
  symlinks, require a confined regular file and preserve the previous missing-file result. A
  signature/size/symlink-invalid referenced camera asset aborts the build before project data,
  service worker or single-file output can claim success.
- Camera profile, binding and view-variant catalogs preserve all valid JSON identifiers, including
  `__proto__`, `constructor` and `prototype`, as own records without prototype mutation. Runtime
  selection and exact/fallback/material resolution use own-property lookup and never observe
  inherited values.
- Generated Canvas and Phaser normalize the BuildTargets viewport into the closed render-space
  subset instead of forwarding `fit`. The first actual browser rerun then exposed a second
  expected runtime boundary: a valid pre-placement frame has no depth-sorted actors. The existing
  actual-boot RED therefore remained red with `cameraRenderItems must contain 1...`; the shared
  projector now accepts a dense empty actor list while world bounds remain non-empty and bounded.
- Focused unit command covering asset IO, projector/view catalogs and render integration is GREEN
  at `7/7` files and `58/58` tests. The actual generated-player Playwright regression is GREEN at
  `2/2`, with no page errors for either Canvas or Phaser. The complete R20-focused unit matrix is
  GREEN at `15/15` files and `109/109` tests; combined Camera Studio plus generated-player browser
  coverage is GREEN at `4/4`. `git diff --check` is GREEN. Plugin parity, full gates and both fresh
  independent sign-offs remain required after the repair commit.

## 2026-08-03 — R20 repaired exact-candidate gates

- Production and regression candidate `eba06721c81e6fbd12d57c80e2dd9b09ef9df499` is clean and
  frozen after the security and generated-player boot repairs. `npm run typecheck`,
  `npm run build:engine`, `npm run validate`, `npm run sim tutorial_01 60` and `npm run build`
  are GREEN.
- The complete one-worker unit gate passed `443/443` files and `4225/4225` tests. The complete
  one-worker Playwright gate passed `161/161`, including the actual generated Canvas and Phaser
  camera-player boot regressions with no browser page errors.
- `npm run plugin:build`, `npm run plugin:validate` and `npm run plugin:smoke` are GREEN. Starter
  mobile and desktop package commands are GREEN, and desktop Rust lifecycle tests pass `9/9`.
  Generators and gates leave the candidate unchanged: `git diff --exit-code` is GREEN.
- This evidence-only entry is the sole change after the production/test candidate. Two fresh,
  independent reviewers must sign off the resulting docs-only child before R20 PR creation and
  merge; either source change invalidates both reviews.

## 2026-08-03 — R20 hidden-key verifier RED evidence

- Independent verification rejected exact docs candidate `e4531a6` because the closed projector
  and render-space own-data contracts ignored symbol keys, while ordinary-object cloning and
  lookup could hide or reinterpret valid JSON identifiers `__proto__`, `constructor` and
  `prototype`. The Contract/Test Designer changed regression tests and this evidence only;
  production and generated plugin runtime remain untouched, and all previous freeze/sign-off
  evidence is invalidated.
- Exact focused command:
  `npx vitest run packages/renderer/src/r20-camera-symbol-keys.regression.test.mjs packages/cli/lib/r20-camera-view-assets.contract.test.mjs packages/mcp/r20-camera-view-variant-authoring.regression.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`, `7` expected RED and `27` passing tests across `3/3` red files.
- The three renderer RED groups prove symbol-bearing profiles/catalogs/contexts/points,
  render-space options/viewport/world arrays and projected item arrays/records are currently
  accepted instead of rejected. Project-schema RED proves a malformed camera variant under the
  own JSON ID `__proto__` disappears from validation. Public MCP/AI RED proves `__proto__` and
  `constructor` cannot complete the one-variant preview/apply workflow, and a hidden
  `__proto__` variant field is not reported at its authored field path. The equivalent valid
  `prototype` flow and the visible `constructor`/`prototype` malformed-field checks remain GREEN,
  keeping the repair boundary narrow.

## 2026-08-03 — R20 hidden-key repair focused GREEN

- Closed camera projector and render-space inputs now reject symbol-keyed own data, including
  nested records and dense arrays. Project-schema validation uses prototype-neutral records, while
  camera authoring uses own-property lookup and definition so valid JSON identifiers `__proto__`,
  `constructor` and `prototype` cannot mutate or inherit from a catalog prototype.
- The exact former RED command is GREEN at `3/3` files and `34/34` tests. The complete focused R20
  camera matrix is GREEN at `16/16` files and `122/122` tests. `npm run plugin:build`,
  `npm run plugin:validate`, `npm run plugin:smoke` and `git diff --check` are GREEN; the plugin
  runtime mirrors all four repaired source files.
- This is pre-freeze evidence. Because production changed after the rejected candidate, the full
  exact-candidate gates and both independent sign-offs must run again before PR creation or merge.

## 2026-08-03 — R20 hidden-key repaired exact-candidate gates

- Production/test candidate `7fbbf1b2131654ff2330d6e242d76c773157d75e` was clean before and
  after the complete gate run. `npm run typecheck`, `npm run build:engine`, `npm run validate`,
  `npm run sim tutorial_01 60` and `npm run build` are GREEN.
- Full unit passed `444/444` files and `4238/4238` tests. Full Playwright E2E passed `161/161`,
  including Camera Studio and actual generated Canvas/Phaser camera-player boot coverage.
- `npm run plugin:build`, `npm run plugin:validate` and `npm run plugin:smoke` are GREEN. Starter
  mobile and desktop package commands are GREEN, and desktop Rust lifecycle tests pass `9/9`.
  `git diff --exit-code` and `git diff --cached --exit-code` are GREEN after all generators and
  gates.
- This evidence-only entry is the sole change after the exact production/test candidate. R20 is
  frozen again for two fresh independent sign-offs; any source change invalidates both.

## 2026-08-03 — R21 contract freeze

- R21 is isolated on `codex/r21-hud-studio` and begins only after the R20 merge. ADR 0062 freezes
  optional `content/hud.json` as `HudCatalogV1`, optional BuildTargets-v2 `hudProfileId`, reuse of
  `PlayerActionDescriptorV1`, and one browser DOM shell over a pure renderer-neutral HUD runtime.
  Project v5, BuildTargets v2, visuals v4, GameCommand/journal v8, checkpoint, profile, campaign,
  TowerScript and multiplayer versions remain unchanged.
- Runtime activation requires project v5 + BuildTargets v2 + a desktop/responsive selected target +
  an explicit valid HUD profile binding. An unbound large-screen target keeps the built-in R18
  shell. BuildTargets v1 does not read or bundle HUD code even if a reusable catalog exists.
- R21.1 through R21.6 stay independent RED/GREEN slices: catalog/project transport; pure layout,
  components and bindings; screen graph/recovery; menu/input presets; Studio/assets; MCP/AI and
  package parity. Each slice must record its own expected RED before production changes. Full gates
  and both independent sign-offs are reserved for the exact frozen R21 candidate.
- Forbidden scope is fixed: no engine or command changes, arbitrary JavaScript/CSS/HTML, executable
  object paths, renderer-owned HUD, HUD-owned world projection, host/native APIs, external network
  access, broad write tools, unsafe media, automatic asset commit or removable recovery overlay.

## 2026-08-03 — R21.1a HudCatalog/project transport RED evidence

- The independent Contract/Test Designer added tests and this chronological evidence only; no
  production source, generated runtime or plugin mirror was changed. The narrow slice freezes the
  pure closed `HudCatalogV1` compiler, optional `content/hud.json` transport, explicit
  `hudAuthored`, BuildTargets-v2 `hudProfileId` cross-reference and the missing/unbound/v1 legacy
  matrix. Composite guarded authoring revision remains a separate R21.1b RED/GREEN slice.
- Exact focused command:
  `npx vitest run packages/player-runtime/src/r21-hud-catalog.contract.test.mjs packages/cli/lib/r21-hud-project-schema.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; `2/2` files RED, with one failed pure-runtime suite plus `7` failed and `1`
  passing CLI tests. The pure failure is the expected missing `./hud-catalog.mjs` module. CLI RED
  proves that the loader drops authored HUD data/flags, `hudProfileId` is still an unknown target
  field, profile references and legacy form-factor bindings are not checked, and malformed/future/
  symbol/accessor-bearing unbound catalogs are ignored. The already-existing project-v5 rule is
  the single passing compatibility assertion.

## 2026-08-03 — R21.1a HudCatalog/project transport focused GREEN

- Added the pure renderer-neutral `HudCatalogV1` validator/normalizer with closed own-data
  inspection, schema-v1 budgets, detached deeply frozen output, prototype-neutral dynamic
  records, stable diagnostics and safe handling of special JSON IDs. No DOM, Node, engine or
  gameplay dependency was introduced.
- `content/hud.json` now travels through raw and normalized project loading with explicit
  `hudAuthored` state. BuildTargets v2 accepts optional `hudProfileId`, validates it against an
  authored catalog and restricts custom bindings to desktop/responsive form factors. Missing,
  unbound and BuildTargets-v1 legacy paths remain inactive and do not synthesize a HUD.
- The exact former RED command is GREEN at `2/2` files and `23/23` tests. The focused loader,
  schema and R18/R20 generated-build compatibility matrix is GREEN at `9/9` files and `88/88`
  tests. `npm run plugin:build`, `npm run plugin:validate`, `npm run plugin:smoke` and
  `git diff --check` are GREEN; the generated plugin runtime mirrors the touched CLI/runtime
  sources. Composite authoring remains intentionally deferred to R21.1b.

## 2026-08-03 — R21.1b guarded HUD authoring RED evidence

- The independent Contract/Test Designer added only
  `packages/cli/lib/r21-hud-authoring.contract.test.mjs` and this chronological evidence; no
  production source, MCP surface or generated plugin runtime changed. This slice freezes one
  narrow CLI-owned profile upsert with an optional single build-target binding. It deliberately
  does not add the R21.6 MCP tools or a broad catalog/project writer.
- The composite revision owns exactly `project.json`, `build-targets.json`, optional
  `content/hud.json` and `content/visuals.json`. Read, inert recipe and preview are write-free;
  apply requires the exact preview revision, rechecks it before mutation, promotes the first save
  to project v5 / BuildTargets v2, validates the complete candidate, writes confined four-source
  backup evidence and rolls all already-replaced sources back after a partial atomic-write failure.
  An absent HUD source is represented explicitly in the backup rather than synthesized before
  commit.
- The contract preserves existing HUD profiles, every unrelated build target, CameraProfile and
  all other visuals data. Disabling its one target binding removes only `hudProfileId`, so the
  built-in R18 shell becomes active again without deleting the reusable profile. Malformed and
  future catalogs, a missing revision and stale changes in any of the four sources fail before a
  HUD write.
- Exact focused command:
  `npx vitest run packages/cli/lib/r21-hud-authoring.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`, one expected RED suite before test collection because the new narrow
  `packages/cli/lib/hud-authoring.mjs` module does not exist. The contract contains nine tests;
  the missing module is the first expected production boundary, and no fallback writer was used.

## 2026-08-03 — R21.1b guarded HUD authoring focused GREEN

- Added the narrow CLI-owned HUD authoring surface: detached read and bundled recipe, compute-only
  preview and revision-guarded apply. The composite SHA-256 covers the exact bytes of
  `project.json`, `build-targets.json`, optional `content/hud.json` (with an explicit absent marker)
  and `content/visuals.json`; a stale change in any owned source is rejected before validation or
  mutation.
- First save promotes only the required project/build-target version fields, upserts one validated
  reusable profile and optionally binds one existing desktop/responsive target. Unrelated targets,
  defaults, visuals and camera data are preserved; disabling removes only that target's
  `hudProfileId`. Apply creates confined four-source backup evidence and restores exact prior bytes,
  including the absent HUD state, after an injected partial rename failure.
- The frozen RED fixture's BuildTargets stale case originally rewrote identical bytes. The test-only
  mutation was corrected to a real stale target value so it measures the frozen exact-byte revision
  contract rather than filesystem metadata. The exact former RED command is GREEN at `1/1` file and
  `9/9` tests.
- The focused HUD catalog/project/authoring plus loader/schema and R20 camera compatibility matrix is
  GREEN at `8/8` files and `101/101` tests. `npm run plugin:build`, `npm run plugin:validate`,
  `npm run plugin:smoke` and `git diff --check` are GREEN; the generated plugin runtime mirrors the
  new CLI authoring module. MCP and Studio authoring remain explicitly deferred to R21.6/R21.5.

## 2026-08-03 — R21.2 pure layout/components/bindings RED evidence

- The independent Contract/Test Designer added only pure player-runtime contract tests and this
  chronological evidence; no production source, DOM shell, generated runtime or plugin mirror was
  changed. The slice freezes typed data-only component definitions, per-variant closed layout
  records, responsive boundary selection, safe-area anchoring, stable traversal and detached
  frozen layout plans. Screen transitions remain reserved for R21.3.
- The contract uses the existing `PlayerActionDescriptorV1` IDs and a closed v1 selector-descriptor
  allowlist. Authored arbitrary object paths, JavaScript/CSS/HTML, renderer state and unknown
  component states fail closed. The representative matrix covers primitives, stack/container,
  counter/progress bindings, button actions and the specialized `build_menu`, `radial_menu` and
  `repeater` components without introducing a DOM dependency.
- Exact focused command:
  `npx vitest run packages/player-runtime/src/r21-hud-catalog.contract.test.mjs packages/player-runtime/src/r21-hud-layout.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; `2/2` files RED, with one expected rich-node catalog assertion failure and one
  expected collection failure because `packages/player-runtime/src/hud-layout.mjs` does not yet
  exist. Existing R21.1 catalog coverage remains `19` tests GREEN. The frozen compiler contracts
  additionally cover desktop/tablet/mobile breakpoints, exact safe rectangles, 44 px diagnostics,
  radial/repeater ceilings, input-order invariance, future/unknown/malformed/accessor/symbol/sparse/
  cyclic data and revoked option proxies.

## 2026-08-03 — R21.2 pure layout/components/bindings focused GREEN

- Extended the closed `HudCatalogV1` normalizer with the complete schema-v1 component allowlist,
  six authorable component states, bounded detached properties/static payloads, typed data/action
  bindings and optional per-variant layout records. Executable/markup/style/URL/path fields,
  arbitrary selector paths, unknown layouts/layers, sparse arrays, cycles, accessors, symbols and
  future records fail closed without invoking authored code.
- Added the DOM-free `compileHudLayoutV1` runtime. It selects mobile/tablet/desktop variants at the
  authored breakpoints, computes a safe rectangle and bounded anchor/flow/container rectangles,
  traverses authored roots and children stably regardless of source record insertion order, checks
  selector/action descriptors, detaches runtime state and bounded collections, and publishes stable
  accessibility diagnostics for interactive controls below `44px`.
- The exact RED command is now GREEN at `2/2` files and `40/40` tests. The full
  `packages/player-runtime/src` compatibility matrix is GREEN at `12/12` files and `124/124` tests.
  `node --check` passes for both pure runtime modules; `npm run plugin:build`,
  `npm run plugin:validate`, `npm run plugin:smoke` and `git diff --check` are GREEN, and the
  generated plugin runtime contains the same new catalog/layout exports. R21.3 screen navigation
  and the browser-owned DOM shell remain intentionally outside this slice.

## 2026-08-03 — R21.3 pure screen graph/recovery RED evidence

- The independent Contract/Test Designer added only the pure player-runtime screen-graph contract,
  minimal `HudCatalogV1` transition assertions and this chronological evidence; no production
  source, browser DOM shell, generated runtime or plugin mirror was changed. The slice freezes
  ordered typed navigation transitions with optional source screens, allowlisted player events,
  bounded descriptor conditions and at most one transition per dispatch. Screen navigation cannot
  execute gameplay actions.
- The DOM-free session contract covers every R21 shell surface, authored first-match ordering,
  insertion-order invariance for record maps, AND conditions, detached runtime selector state and
  structurally cyclic graphs that advance only one edge per dispatch. Malformed/future/unknown/
  accessor/symbol/sparse/proxy/over-budget inputs fail into a reserved built-in recovery overlay;
  authors cannot replace or remove that system fallback.
- Exact focused command:
  `npx vitest run packages/player-runtime/src/r21-hud-catalog.contract.test.mjs packages/player-runtime/src/r21-hud-screen-graph.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: exit `1`; `2/2` files RED, `26` existing assertions GREEN and two expected catalog
  assertions RED because non-empty transitions are not yet normalized and the recovery screen ID
  is not reserved. The new runtime suite fails before collection because
  `packages/player-runtime/src/hud-screen-graph.mjs` does not yet exist. These are the expected
  production boundaries; no alternate navigation implementation was used.

## 2026-08-04 — R21.3 pure screen graph/recovery focused GREEN

- Added the DOM-free `hud-screen-graph.mjs` runtime and public player-runtime export. It validates
  the same closed selector descriptors as the layout compiler, detaches bounded selector state,
  evaluates authored transitions in stable order and performs at most one navigation hop per
  dispatch. Navigation has no command, signal, renderer or gameplay mutation surface.
- `HudCatalogV1` now normalizes frozen schema-v1 transitions with optional source screens,
  allowlisted player events, scalar typed conditions and the frozen 256/16 budgets. Transition and
  screen lookup remains prototype-safe; authored profiles cannot claim the reserved
  `__towerforge_system_recovery__` identity.
- Invalid/future/malformed catalog, descriptor or runtime state creates a non-throwing failed
  session whose frozen snapshot activates the mandatory built-in recovery overlay. Unknown
  dispatch events also fail closed into that overlay; a valid dispatch uses detached state and
  never follows a second edge recursively.
- Exact focused command:
  `npx vitest run packages/player-runtime/src/r21-hud-catalog.contract.test.mjs packages/player-runtime/src/r21-hud-screen-graph.contract.test.mjs --reporter=verbose --maxWorkers=1`.
  Result: `2/2` files and `42/42` tests GREEN. The complete `packages/player-runtime/src` matrix is
  GREEN at `13/13` files and `146/146` tests. `node --check` passes for the catalog and screen graph;
  `npm run plugin:build`, `npm run plugin:validate`, `npm run plugin:smoke`, source-to-plugin byte
  parity and `git diff --check` are GREEN.
