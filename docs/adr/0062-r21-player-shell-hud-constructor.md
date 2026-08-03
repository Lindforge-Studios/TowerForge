# ADR 0062: R21 Player Shell & HUD Constructor

- Status: Proposed
- Date: 2026-08-03

## Context

R18 supplies one built-in large-screen player shell and the closed
`PlayerActionDescriptorV1` registry. R19 packages that player without widening the native bridge,
and R20 projects the game world before the R18 viewport transform. The built-in shell is usable as
a fallback, but authors cannot compose their own responsive combat HUD, build menu, result screens
or visual hierarchy. Replacing the generated templates with arbitrary HTML, CSS or JavaScript would
bypass the action registry, split Canvas and Phaser behavior and make imported projects executable.

R21 therefore needs a versioned data-only presentation contract, one browser DOM implementation,
guarded authoring and strict legacy pruning. It must not move gameplay decisions into Studio,
renderers or authored UI data.

## Decision

### Activation and storage

R21 adds optional `content/hud.json` with root `HudCatalogV1` (`schemaVersion: 1`). A profile has a
stable ID, closed metadata, ordered breakpoints, common nodes, three responsive layout variants,
a declarative screen graph and asset-role bindings. BuildTargets v2 receives optional
`hudProfileId`. A custom HUD is active only when all of the following are true:

1. the project is schema v5;
2. the selected build target is BuildTargets v2 and has `formFactor: desktop | responsive`;
3. that target owns an explicit `hudProfileId`;
4. `content/hud.json` is present, schema v1 and contains the referenced valid profile.

An R18/R19 large-screen target without `hudProfileId` uses the unchanged built-in R18 shell. A
BuildTargets-v1 target does not read, validate for runtime selection, import or package the HUD
runtime even if a reusable `content/hud.json` exists. Missing references on an active target are
errors; an unselected catalog may be structurally inspected by Studio but cannot activate runtime
code. First guarded HUD save reuses project schema v5 and BuildTargets v2; it does not introduce a
project-v6 migration.

The authoring revision covers `project.json`, `build-targets.json`, `content/hud.json` and
`content/visuals.json`. Preview and apply preserve unrelated camera, Procedural Juice, targets and
visual catalogs. Apply rechecks the exact revision, validates all four candidates, writes confined
backups and rolls back its complete owned set on failure.

### Package boundaries

- `packages/player-runtime` owns closed data validation, normalized layout plans, safe selectors,
  bounded screen-graph evaluation, presets and descriptor-driven action binding. It stays
  renderer-neutral and has no DOM, browser global, Node or gameplay-rule dependency.
- A new browser-only `packages/player-shell` owns the single semantic DOM renderer, responsive
  measurement, focus/input routing and component state. Generated Canvas and Phaser players and
  Studio preview use this same adapter. It consumes `PlayerActionDescriptorV1` and injected
  snapshot/player-state ports; it cannot construct gameplay commands outside the registry.
- `packages/renderer` continues to draw only the game world. It neither creates HUD controls nor
  applies screen-space layout through the R20 world projector.
- `packages/cli` owns optional-file loading, cross-file validation, confined writes and conditional
  bundling. `packages/studio` edits the catalog through CLI-owned transactions and does not
  duplicate layout, selector, graph or action rules.
- `packages/mcp` exposes descriptor/read/recipe/preview/guarded-apply/render-preview operations by
  reusing those contracts. No broad project-tree or arbitrary markup writer is added.
- `packages/engine` is unchanged. HUD data is not part of content capabilities, simulation state,
  content digests, checkpoints, journals or multiplayer checksums.

`PlayerShellPortV1` is an internal injected boundary between the pure runtime and the DOM adapter.
It exposes detached snapshot/player state, action availability/dispatch, localization, preferences
and camera-reset/fullscreen callbacks. The shell never receives an engine instance or a native
filesystem/shell bridge.

### Layout, components and assets

Each profile declares desktop (`1920x1080`), tablet (`1024x768`) and mobile (`390x844`) variants.
Default breakpoints are mobile `<768`, tablet `768..1199` and desktop `>=1200`; authored boundaries
must remain strictly ordered. Layout uses only anchors, docks, bounded stacks/grids, safe areas,
minimum/maximum sizes and bounded offsets. Layer names are fixed to
`background | content | overlay | modal | system`; author-defined CSS, HTML, selectors and z-index
are invalid.

Schema v1 components are `text`, `localized_text`, `image`, `icon`, `counter`, `progress_bar`,
`status_chip`, `button`, `toggle`, `slider`, `select`, `panel`, `nine_slice`, `stack`, `grid`, `dock`,
`drawer`, `modal`, `repeater`, `build_menu`, `ability_bar`, `selected_entity_card`, `radial_menu` and
`tile_popover`. Bindings reference only descriptor IDs published by the runtime; arbitrary object
paths and expression evaluation are forbidden. Collections receive bounded detached items and a
stable item context.

UI assets remain sprite IDs in visuals v4. Icon/image, atlas-frame and nine-slice metadata reuse
the existing provider-neutral staged asset path. No HUD file contains a host path, URL, binary,
font, SVG, provider credential or generation prompt. Upload/generation remains
`stage -> preview -> MIME/license/provenance validation -> guarded commit`.

### Actions and screen graph

R21 reuses `PlayerActionDescriptorV1`; no parallel command vocabulary is created. A binding may
invoke an allowlisted UI action, an existing versioned `GameCommand`, or safe TowerScript
`emitSignal` with a static closed bounded payload. Context actions receive only the selected tower,
hero, tile or current collection-item identity supplied by the shell. Availability comes from the
descriptor and authoritative state, not from author-authored predicates.

Screen navigation is a closed finite graph over `title`, `profile_selection`, `loading`,
`mission_selection`, `campaign_selection`, `story`, `setup`, `gameplay`, `between_wave`, `draft`,
`pause`, `settings`, `victory`, `defeat`, `result` and `recoverable_error` surfaces. Transitions use
allowlisted player events and bounded conjunctions over descriptor-owned selectors. At most one
transition fires per event in stable authored order. A transition changes only visible shell state;
all gameplay mutation still passes through the action registry.

Boot, corrupt/future-save diagnostics and unrecoverable shell failures remain covered by a small
built-in system-layer recovery overlay. Authored data cannot remove, cover, navigate around or bind
actions into this overlay.

### Budgets and future data

Closed own-data validation rejects accessors, proxies, symbol keys, sparse arrays, cycles, unknown
fields, non-finite numbers and data beyond these schema-v1 ceilings:

- 16 profiles per catalog;
- 32 screens and 512 unique nodes per profile;
- nesting depth 16 and 1,536 total layout records per profile;
- 256 transitions and 16 condition terms per transition;
- 12 simultaneously visible radial items;
- 128 materialized repeater items per screen.

Node, screen, transition and binding IDs are stable JSON strings and are stored in
prototype-neutral catalogs with own-property lookup. Studio may retain an unknown future node as a
raw lossless record. A schema-v1 runtime does not execute, coerce or downgrade that node; an active
surface that requires it fails closed and the built-in recovery overlay remains available.

### Version domains

- project manifest: v5, unchanged;
- BuildTargets: v2 plus optional `hudProfileId`;
- `HudCatalogV1`, profile/layout/screen graph and `PlayerShellPortV1`: schema v1;
- visuals: v4, unchanged; HUD stores sprite references only;
- `PlayerActionDescriptorV1`, `ViewportTransformV1`, `PlayerPreferencesV1` and
  `PlayerSessionSaveV1`: unchanged;
- engine, GameCommand/journal v8, checkpoint, content registry/capability digest, profile,
  CampaignRun, TowerScript and multiplayer: unchanged.

## TDD delivery slices

1. **R21.1 — catalog and project contract.** Record RED for closed `HudCatalogV1`, budgets,
   BuildTargets binding, composite revision, optional-file loading and the complete inactive/legacy
   matrix. Implement validation and project transport only; no DOM components.
2. **R21.2 — layout, components and bindings.** Record RED for responsive reflow, constraints,
   selector/action allowlists, component states and malformed/future data. Implement the pure layout
   compiler and descriptor-driven action plan before the DOM adapter.
3. **R21.3 — screen graph and recovery.** Record RED for every allowed transition, stable ordering,
   cycle-safe navigation/budgets, gameplay isolation and mandatory recovery fallback. Implement one
   bounded shell-state transition per player event.
4. **R21.4 — build menus and input parity.** Record RED for horizontal quickbar, edge dock, catalog
   drawer, radial wheel, tile popover, mobile bottom sheet and command palette across pointer,
   keyboard, gamepad and touch. Implement all presets from the same primitives and registry.
5. **R21.5 — HUD Studio and assets.** Record RED for WYSIWYG layout, device/mock-state previews,
   constraints/accessibility diagnostics, guarded lifecycle and asset staging. Implement Studio
   with the shared runtime and DOM shell, not a second preview algorithm.
6. **R21.6 — AI and packaging parity.** Record RED for schema discovery, narrow recipe/preview/apply,
   rendered preview, plugin parity and conditional PWA/single-file/web/tdpack/native inclusion.
   Implement package pruning and the common Canvas/Phaser shell last.

Every slice records the expected failure command and summary in `progress.md` before production
changes, reaches focused GREEN, then runs affected-layer compatibility regressions. Full unit,
browser, plugin and touched package gates run on one exact frozen R21 candidate before independent
Code Verifier and Constructor Integration Verifier reviews. Any source change invalidates both
reviews and the gate evidence.

## Acceptance

- Desktop, tablet and mobile layouts reflow deterministically at their boundaries and respect safe
  areas, minimum 44 px interactive targets, focus order, ARIA labels, contrast and reduced motion.
- All editable screen transitions and all seven build-menu presets work through one action registry
  with pointer, keyboard, gamepad and touch input.
- Canvas and Phaser use the same DOM shell and produce equivalent actions while the world renderer,
  R20 projection and engine coordinates remain unchanged.
- Studio supports enable -> edit -> preview -> save -> reload -> disable -> re-enable, plus stale
  revision, invalid asset, backup and rollback cases. Camera and HUD transactions preserve one
  another.
- MCP/AI completes `describe -> read -> recipe -> preview -> guarded apply -> validate -> render
  preview` without a broad writer or external side effect.
- PWA, single-file, web package, `.tdpack` and native desktop use the selected profile. Missing
  `content/hud.json` on a large-screen target uses the built-in R18 shell.
- Starter, project v1-v4, BuildTargets v1 and unbound BuildTargets-v2 targets retain their prior
  bytes, UI, action behavior, package module set, snapshot/replay digest and performance path.

## Forbidden scope

- Engine rules, new GameCommands, checkpoint/journal/profile/campaign/multiplayer fields or a
  mechanics capability.
- Arbitrary JavaScript, CSS, HTML, DOM selectors, executable expressions, `eval`, host/native APIs,
  network requests, URLs, unsafe SVG, custom fonts or project-owned credentials.
- Renderer-owned HUD controls, HUD-owned camera/world projection or duplicated Canvas/Phaser
  dispatch rules.
- Removal or author control of the boot/crash recovery overlay.
- A second socket, inventory, build eligibility, targeting or gameplay-state implementation.
- Automatic asset commit, broad content replacement, hidden telemetry, monetization execution or
  store/cloud integration.

## Consequences

- Authors can replace the R18 shell with a responsive branded shell without making project content
  executable or coupling UI to one renderer.
- The action registry remains the only UI-to-gameplay boundary, so future components can be added
  without changing simulation protocols.
- Legacy projects pay neither validation-at-runtime nor bundle/import cost for R21.
- The extra browser-only package makes the DOM ownership explicit and prevents the renderer-neutral
  runtime from accumulating browser globals.

## Rejected alternatives

- Storing arbitrary HTML/CSS/JS: turns project data into executable code and bypasses validation.
- Putting HUD layout into `content/visuals.json`: couples visual assets, camera profiles and screen
  navigation into one write/revision domain.
- Rendering HUD inside Canvas or Phaser: duplicates input/focus/accessibility behavior and mixes
  screen-space UI with world projection.
- Extending GameCommand for navigation: UI visibility is not deterministic gameplay state.
- Activating any `hud.json` globally: would alter legacy and unrelated build targets.
