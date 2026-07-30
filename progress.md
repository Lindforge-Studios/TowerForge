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
