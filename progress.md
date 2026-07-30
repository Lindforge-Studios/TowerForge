Original prompt: Continue the opt-in TDD implementation of the TowerForge R0–R8 roadmap with subagents and independent verification.

## Current milestone

- S0 integration is in progress: R9 PR #20 is merged into `main`; R10 is being reconciled on top
  before R11 is retargeted. The shared engine merge preserves both active-only `scriptMachines` and
  `quests` checkpoint sections plus both event-field sets.
- S0 regression RED: `npx vitest run packages/engine/src/simulation/r10-quests-runtime.contract.test.ts --maxWorkers=1`
  initially failed the new combined R9+R10 checkpoint assertion because the test assumed a flat
  `entries` form instead of the canonical nested `values` contract. After correcting the contract
  assertion, the focused suite is GREEN at 10/10 and restore digest/snapshot parity is proven with
  both optional sections active.
- ADR numbering collision was resolved without changing feature version domains: R9 remains ADR
  0050 and R10 moved to ADR 0051. R11 will move from 0051 to 0052 during its integration.
- S0 verifier repair RED: the Code Verifier demonstrated that a digest-valid checkpoint could queue
  an impossible `stateMachineTransitioned` event and dispatch it after restore. The focused test
  `rejects a digest-valid queued state-machine transition event with impossible provenance` failed
  with “expected function to throw”. GREEN adds authored script/machine/state/transition provenance,
  binding-scope and queued runtime-context validation. The first constructor sign-off is invalidated
  by this source change and both roles must re-sign the repaired commit.

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
## R9 — TowerScript DX 3.0 (2026-07-29)

- User-approved scope: one opt-in PR on `codex/r9-towerscript-dx3`; TowerScript v7 only; Behavior Tree/HFSM internal v1; Graph, Trace, and Debugger v2; layout v1; optional checkpoint `scriptMachines` v1. R10/R11, release, tag, merge, and auto-merge are excluded.
- R9.1 implements strict closed-own-data validation, descriptor catalogs, bounded deterministic synchronous Behavior Trees (`selector`, `sequence`, `condition`, `select_targets`) and hostile sparse/accessor/proxy/cyclic/future/budget contracts.
- R9.2 integrates scripted targeting at the shared engine acquisition boundary after alive/class/range/LoS filtering, binary-stable bounded candidate ordering, fallback target modes, support/overlap rejection, stable manual-mode rejection, and active-only `Scripted` snapshot/player/Studio metadata.
- R9.3 implements hierarchical state resolution, leaf-to-root authored transitions, self-transition exit/entry, shared typed action execution, diagnostics after committed-state action failures, nested-signal transition budgets, `stateMachineTransitioned`, optional checkpoint/replay state, digest parity, and entity-state cleanup.
- R9.4 implements lossless Graph v2 projection and primitive authoring, behavior/transition Trace and Debugger v2 records, descriptor-driven controller recipes, guarded Studio/MCP preview/apply, updated agent guidance, and `docs/examples/opt-in-towerscript-dx3/`.
- TDD evidence includes independent RED for hostile runtime validation and Studio primitive authoring, plus an E2E RED that exposed the nested descriptor palette lookup before the production fix. Focused engine, graph, Studio, MCP, compatibility, and isolated legacy-heroes checks are green. Full final gates, browser screenshot inspection, two independent sign-offs, commit, push, and PR remain pending.
- Visual inspection exposed overlapping auto-positioned Graph cards after the functional suite was green. A separate RED layout contract now covers containment depth/order, input-order invariance, stable-ID pinned positions, idempotence, and collision avoidance. The Studio-only helper is GREEN at 2/2; R9 browser lifecycle is GREEN at 4/4 with pairwise DOM overlap assertions. The required skill client rendered the generated hex player without console errors, and a separate 1600×1000 Studio screenshot confirmed 11 Graph cards, zero overlaps, and zero console/page errors.
- The first independent code audit reproduced one selection-rollback P1 and two hostile-validation P2 findings. A separate seven-test RED repair slice now proves transactional failed-branch selection, fail-fast controller/child/transition budgets, and revoked-Proxy diagnostics. Focused repair is 20/20 GREEN; the verifier's 10,000-tree probe now emits one bounded issue in 1 ms without inspecting the tail.
- Final post-repair Vitest is GREEN at 3,028/3,028 across 263 files with constrained worker scheduling; sequential Playwright is GREEN at 133/133. Typecheck, engine/build, validate, 60-unit sim, balance, maps compile, plugin build/validate/smoke, desktop runtime preparation, Rust/Tauri 7/7, unsigned arm64 macOS app/DMG build, and macOS bundle/DMG verification are GREEN.
- Final independent Code Verifier and Constructor Integration Verifier re-sign-offs are PASS with no open P0-P2. ADR 0050 is Accepted. PR #20 was merged into `main` as the first S0 integration step.
