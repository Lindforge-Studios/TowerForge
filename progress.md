Original prompt: Continue the opt-in TDD implementation of the TowerForge R0–R8 roadmap with subagents and independent verification.

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
