# ADR 0061: R20 Camera Projection Studio

- Status: Proposed
- Date: 2026-08-03

## Context

R18 introduced an opt-in large-screen player and the renderer-owned `ViewportTransformV1` for
contain/center, pan, zoom, screen/world conversion and hit testing. R19 reused that player inside a
first-class native carrier. Both renderers still draw the authored two-dimensional world only in the
legacy top-down projection, and the generated Phaser path retains projection-specific glue beside the
Canvas adapter.

R20 must let an author select a 2.5D presentation without changing simulation coordinates, topology,
line of sight, ranges, pathfinding, ballistics, command ordering or replay identity. It also must not
force projects or targets that do not author a camera profile to load a new runtime, visual document
shape, UI or asset set.

## Decision

R20 is a presentation-only, opt-in contract. It requires no `content/mechanics.json` entry and does
not create a capability in the engine. The first explicit guarded camera save promotes
`content/visuals.json` to schema v4 and, when necessary, the project manifest to the already-defined
schema v5. Reading, validating, building, packaging or saving an unrelated domain never synthesizes
camera records or changes a legacy project. A visuals-v2/v3 project and a BuildTargets-v1 target
continue through the literal top-down path and do not import the R20 projection or Camera Studio
modules.

Visuals v4 adds a closed `cameraProfiles` catalog whose records use inner `CameraProfileV1`, closed
map and mission bindings, and closed view-variant records. BuildTargets v2 may select an optional
`cameraProfileId`. The resolved profile order is exactly:

1. active mission binding;
2. active map binding;
3. selected build target `cameraProfileId`;
4. the built-in legacy `top_down` profile, which is not materialized into project data.

An invalid explicit reference is an error rather than permission to fall through. A missing optional
sprite variant may fall back to the existing sprite as a billboard and is reported as a warning. An
explicit view-specific tileset/material binding must be complete and topology-compatible; otherwise
validation fails before preview, build or write.

`CameraProfileV1` owns only presentation parameters:

- `projection`: `top_down | isometric_2_1 | dimetric_oblique`;
- `orientation`: `north | east | south | west`;
- finite `elevationScale` in `[0, 4]`;
- integer CSS-pixel `fitPadding` in `[0, 512]`;
- finite `minZoom`, `initialZoom` and `maxZoom` in `[0.1, 8]`, ordered
  `minZoom <= initialZoom <= maxZoom`;
- integer projected-world `panPadding` in `[0, 2048]`.

Project-authored sprite anchors are normalized `{x,y}` values in `[0,1]` and default to `{0.5,1}`.
View keys use the canonical `<projection>:<orientation>` form. A visuals document may contain at
most 32 camera profiles, 1,024 combined map/mission bindings, 4,096 sprite-variant records and 256
tileset-variant records. IDs are non-empty strings of at most 128 UTF-8 bytes. Catalogs are closed
own-data records; malformed, accessor, proxy, sparse, cyclic, future-version and over-budget input is
rejected before renderer or Studio construction.

`packages/renderer` owns one pure projector that computes projected coordinates, inverse hit tests,
projected bounds, elevation offset and a stable depth tuple. Canvas, generated Phaser, Studio preview
and packaged players must consume the same projector and basis vectors. The composition order is
`engine world coordinate -> CameraProfileV1 projector -> ViewportTransformV1 -> screen`. Depth order
is projected Y, then elevation, then binary-stable entity ID. The same projection is applied to
tiles, towers, enemies, heroes, projectiles, destructibles, weather, overlays, particles, selection
cues and world-aligned decoration. A battle background remains a viewport backdrop.

Camera selection and rendering never enter `packages/engine`. They do not alter snapshots, state
digests, checkpoints, journals, multiplayer checksums, fixed ticks, RNG domains or projectile
collision. Pan and zoom remain the bounded player preferences accepted in R18. Projection and
orientation are authored and fixed for a running game; the player cannot rotate the world or change
projection at runtime.

View-specific assets use the existing provider-neutral staged asset boundary. R20 v1 accepts only
project-relative PNG, JPEG or WebP images. Generated or uploaded candidates pass staging, preview,
MIME/signature/size/license/provenance validation and a revision-guarded commit with backup and
rollback. Unsafe SVG, custom fonts, provider credentials, arbitrary external URLs and local absolute
paths are rejected. Studio and MCP must not duplicate asset coverage or projection rules.

The version domains remain independent:

- project manifest: v5;
- build targets: v2 with optional `cameraProfileId`;
- visuals: v4;
- `CameraProfileV1` and view-variant records: inner schema v1;
- `ViewportTransformV1`, `PlayerPreferencesV1` and `PlayerSessionSaveV1`: unchanged;
- Procedural Juice: inner schema v1, preserved unchanged inside visuals v4;
- engine, GameCommand/journal v8, checkpoint, profile, campaign, TowerScript and multiplayer:
  unchanged.

## TDD delivery slices

1. **R20.1 — CameraProfile contract.** Record expected RED for closed validation, profile resolution,
   three projection modes, four orientations, bounded settings, precedence and legacy absence. Then
   implement the pure descriptor/projector contract and golden basis vectors.
2. **R20.2 — shared renderer runtime.** Record RED for inverse round trips, clipping, elevation,
   projectile alignment and stable depth order. Then route Canvas and Phaser through the common
   projector without copying the rules into either adapter.
3. **R20.3 — view-specific assets.** Record RED for coverage, fallback, required material failure,
   safe image formats, staging and rollback. Then add the closed visuals-v4 variant catalog and
   guarded asset path.
4. **R20.4 — Camera Studio and AI.** Record RED for live preview, diagnostics, schema discovery,
   compute-only preview and guarded apply. Then add the isolated Studio workspace, narrow MCP tools,
   agent instructions, generated-player/package parity and documentation.

Every slice runs focused tests plus regressions for its affected packages. The exact candidate then
runs the complete typecheck, engine build, unit, validation, simulation, web build, browser E2E,
plugin and touched package gates before two independent sign-offs. A production-source change after
freeze invalidates both gate evidence and both sign-offs.

## Acceptance

- Golden projection vectors and inverse coordinate round trips pass for hex and square maps across
  all three projections and four orientations.
- Canvas and Phaser produce the same projected bounds, hit target and depth order for source-record
  permutations; elevation, projectiles, destructibles, weather and Juice cues remain aligned.
- Mission binding wins over map binding, map wins over target, target wins over built-in top-down;
  invalid authored references fail closed.
- The coverage report distinguishes exact variant, billboard/base fallback and missing mandatory
  material; PNG/JPEG/WebP staged imports commit only through revision validation and rollback.
- Studio supports preview, edit, guarded save, reload, remove/disable and re-enable. MCP/AI supports
  `describe -> read -> recipe -> preview -> guarded apply -> validate` with no broad replace tool.
- PWA, single-file, web package, `.tdpack` and first-class native desktop package use the selected
  profile and the same projector.
- Starter, visuals v2/v3 and legacy targets retain their prior project bytes, snapshot/replay digest,
  rendered top-down behavior, player markup and bundle module set.

## Forbidden scope

- Engine-coordinate, topology, line-of-sight, pathfinding, range, targeting, damage or ballistics
  changes.
- A real 3D/WebGL world renderer, meshes, lighting, free-orbit camera, custom shaders or 3D assets.
- Player-controlled rotation, projection switching or camera-profile gameplay commands.
- A second Canvas/Phaser projection implementation or renderer-owned gameplay inference.
- Arbitrary JavaScript, CSS, HTML, SVG, fonts, host APIs, filesystem/network access or project-owned
  provider secrets.
- R21 HUD/screen graph work, new TowerScript actions/events, or any gameplay/schema version bump.

## Consequences

- Authors can ship top-down, isometric 2:1 or softer dimetric games from the same authoritative 2D
  simulation and use four fixed authored orientations.
- Existing sprites remain usable through a documented billboard fallback; richer views may provide
  guarded view variants without forking gameplay content.
- Renderer and viewport responsibilities stay composable: the projector changes world presentation,
  while `ViewportTransformV1` continues to own fit, pan, zoom and screen placement.
- Legacy projects pay no storage, UI or bundle cost for R20.

## Rejected alternatives

- Adding camera profiles to mechanics capabilities: presentation selection is not mission gameplay.
- Rotating engine coordinates or maps: would change topology, commands and deterministic state.
- Implementing projection separately in Canvas and Phaser: would make hit testing and depth diverge.
- Treating the R11 camera cue as a camera profile: Juice cues are bounded event effects, not a world
  projection or authoring/binding contract.
