# ADR 0051: Opt-in Procedural Juice Presentation

- Status: Accepted
- Date: 2026-07-29
- Milestone: R11

## Context

TowerForge already exposes deterministic engine events through `GameSnapshot.lastEvents`, renders
the same authoritative snapshot through Canvas and Phaser, and provides asset-backed SFX plus a
small hardcoded Web Audio fallback. Projects need richer sparks, smoke, flashes, impact variation,
camera shake, hit stop, and chromatic separation without turning those effects into gameplay state
or requiring hundreds of media files.

R11 is semantically defined against the accepted R8 surface and does not import TowerScript v7/R9
or Persona QA/quest/R10 contracts. Its delivery branch is stacked on the R10 tip solely because the
two milestones touch shared documentation, Studio, player-template, and generated-plugin files.
Later event kinds can become eligible only through an explicit compatible extension of the juice
schema.

## Decision

R11 extends `content/visuals.json` from schema v2 to v3. V3 may contain one optional closed block:

```json
{
  "schemaVersion": 3,
  "proceduralJuice": {
    "schemaVersion": 1,
    "particleEmitters": {},
    "audioCues": {},
    "cameraCues": {},
    "eventBindings": {}
  }
}
```

The block is the opt-in switch. It is not a `content/mechanics.json` module and requires no
`mission.mechanics` selection. An event binding may narrow itself to authored mission and enemy
type IDs; a missing mission filter applies to every mission. Cross-references are
validated against the same loaded project. Saving the first R11 definition explicitly promotes
the project manifest and visuals document to v3, so an older CLI cannot silently ignore the new
presentation contract. The mechanics catalog and all gameplay documents retain their existing
versions.

The four catalogs have these responsibilities:

- `particleEmitters[id]` is exactly `{maxParticles,lifetimeMs,speedPxPerSecond,angleDegrees,sizePx,
  color,gravityPxPerSecondSquared,blendMode}`. Each range is a closed `{min,max}` pair. The renderer
  combines these point/shape primitives into recipes for sparks, smoke, flashes, and expanding
  impact waves; it cannot embed shader or script source.
- `audioCues[id]` is exactly `{waveform,baseFrequencyHz,durationMs,gain,pitchSemitones}`.
  `pitchSemitones` contains the bounded coefficients `damage`, `attackSpeed`, `targetSize`, and the
  seeded `{min,max}` `variation`. Those are the only event/content facts that may change the pitch.
  A cue cannot load a URL, `AudioWorklet`, WASM, or arbitrary graph/code.
- `cameraCues[id]` is exactly `{shake,hitStop,chromaticAberration}`. Shake and chromatic separation
  have `durationMs` plus normalized `intensity`; visual hit stop has `durationMs` and a presentation
  `timeScale` in `(0,1]`.
- `eventBindings[id]` is exactly one `event`, optional `missionIds` and `enemyTypeIds` filters, and
  optional plural `particleEmitterIds`, `audioCueIds`, and `cameraCueIds` references. It contains no
  TowerScript expression, predicate language, arbitrary property path, or dependency on R9 tags.

Unsupported future inner versions remain lossless/read-only in Studio and fail closed in players.
Malformed, unavailable, or unmatched entries produce no procedural cue; they never fall back to a
partially interpreted effect.

## Runtime boundary and determinism

`packages/engine` remains the sole source of simulation state and event order, but it does not
simulate particles, audio nodes, camera movement, or presentation clocks. R11 adds no `GameEvent`,
snapshot section, checkpoint field, command, journal entry, RNG consumption, or state-digest input.
`content/visuals.json` remains outside the simulation content digest.

`packages/renderer` owns one browser-safe, DOM-free planning layer over the optional catalog plus
the previous/current snapshots. It resolves a cue anchor from an event coordinate first, then the
matching current entity, then the matching entity in the previous snapshot; wave/outcome cues have
explicit spawn/core fallbacks. If no bounded anchor can be proven, spatial particles are skipped
while non-spatial audio/camera cues may still run. Grid-to-pixel projection continues through the
existing shared renderer geometry.

Catalog records and filters are canonicalized in binary ID order. `lastEvents` retains its
authoritative authored runtime order; matching bindings are applied in binary binding-ID order.
Each occurrence seed binds the procedural-juice digest, mission identity, deterministic snapshot
facts, event ordinal, canonical event data, binding ID, cue ID, and particle index under the
independent `tf-juice-rng-v1` domain. The implementation must not call `Math.random`. Replaying the
same previous/current snapshots returns the same detached instruction frame; the bounded particle
runtime evaluates that burst at an explicit presentation timestamp. Consumers deduplicate the occurrence identity so repeated reads of one
snapshot do not retrigger cues.

Particle motion is evaluated from an absolute integer-millisecond presentation age and closed-form
kinematics rather than frame-by-frame accumulated integration. This makes the shared plan invariant
to Canvas/Phaser render cadence. Web Audio scheduling and pixel rasterization are platform effects;
tests compare their exact pure instruction plans, not speaker output or antialiased pixels.

The visual hit-stop and time-dilation clock never changes an engine delta, fixed multiplayer tick,
command order, cooldown, wave timer, AI decision, replay, or checksum. It only freezes or scales the
local world-presentation clock and resumes from the newest authoritative snapshot. UI accessibility
preferences may reduce or disable motion and always override authored intensity. Audio remains
lazy, user-gesture-gated, muteable, and suspendable.

## Budgets and merge rules

V1 uses fail-before-publish ceilings:

- 64 particle emitters, 64 audio cues, 64 camera cues, and 128 event bindings;
- 64 ASCII characters per authored ID and 64 optional mission or enemy-type IDs per binding filter;
- 16 references of each cue kind per binding and at most 64 source events from one snapshot;
- 256 spawned particles per emitter, 4,096 across the authored emitter catalog, and 2,048 live
  particles per player;
- particle, audio, shake, and chromatic cue duration at most 10,000 ms;
- hit stop at most 1,000 ms with `timeScale` in `(0,1]`; shake and chromatic intensity in `[0,1]`
  map to adapter-owned pixel caps rather than accepting unbounded authored offsets;
- at most 32 newly scheduled audio voices from one snapshot and 32 simultaneously live procedural
  Web Audio sources across repeated renderer frames; ended/suspended voices are disconnected;
- at most 128 authoritative world snapshots in the renderer-owned hit-stop buffer; presentation
  resumes immediately from the newest authoritative snapshot when the cue ends.

When a cap is reached, the planner keeps authoritative event order, then binary binding/cue order,
then particle/voice ordinal and drops the remaining presentation work. It does not truncate source
JSON during authoring. Concurrent camera cues merge without unbounded accumulation: hit stop uses
the greatest remaining duration, shake vectors add then clamp to the global offset cap, and
chromatic offset uses the greatest active magnitude. A user reduced-motion preference disables hit
stop and chromatic separation and clamps shake/particle density; motion-off returns neutral visual
instructions. Hidden/background documents do not queue a catch-up burst.

For a matched event, an explicitly bound asset SFX remains first choice, the authored procedural
cue is the second choice, and the existing hardcoded synth is the final fallback. If no procedural
audio binding matches, the current asset/synth behavior remains unchanged. The shared event
coalescing and voice cap prevent rapid attacks from creating an unbounded Web Audio graph.

## Authoring and package boundaries

Studio exposes a separate Juice workspace under visual/audio authoring rather than adding controls
to gameplay or Mechanics Hub forms. JSON/recipe editing, a synthetic-event instruction preview,
and player playtest consume the same renderer planner. Future versions are visible but read-only.
Save is `preview -> exact project+visuals authoring revision -> validation -> backup -> atomic write
-> rollback` and removes no unrelated visual catalog data.

MCP/AI exposes descriptor-driven discovery and narrow tools:

1. `describe_schema({domain:"proceduralJuice"})`;
2. read the current catalog and combined project+visuals authoring revision;
3. request an inert recipe or compute-only event preview;
4. preview the exact candidate;
5. apply with the returned visuals revision;
6. validate and playtest.

Recipes return detached catalog fragments and never enable, write, import assets, or launch audio.
No broad raw visuals replacement tool is added. The Codex plugin mirrors the same descriptors,
planner, renderer, CLI, and agent instructions from the TowerForge source repository.

Canvas, Phaser, Studio Playtest, PWA, single-file, portable web, `.tdpack`, and desktop packages use
the same planner and only their thin drawing/audio/compositing adapters. R11 contains no Node API in
the renderer and no DOM/Web Audio API in the engine or pure planner.

## Compatibility and exclusions

When `proceduralJuice` is absent, an unchanged visuals-v2 project follows the literal current
renderer/audio behavior and snapshot shape: no catalog traversal, planner allocation, UI section,
or additional event/snapshot read is allowed. An explicit empty v1 block is valid and inert. Deleting the
block disables R11 without changing any gameplay data.

R11 deliberately excludes particle collision/damage, gameplay time scaling, screen effects in
checkpoints/replays, authored GLSL/CSS/JavaScript, arbitrary audio graphs, spatial audio, music
generation, asset generation, recording/render-to-video, multiplayer cue transport, new engine
events, TowerScript actions, and automatic bindings for R9/R10 event kinds.

## Delivery and acceptance

R11 is delivered as four independent TDD increments:

1. **R11.1 — catalog and pure planner:** RED validation/determinism contracts, visuals v3 and
   explicit v2->v3 authoring promotion, descriptors, canonical cue compilation, seed and budgets.
2. **R11.2 — particles:** RED trajectory/anchor/overflow contracts, shared lifetime runtime, Canvas
   and Phaser adapters, square/hex parity, reduced-motion handling.
3. **R11.3 — procedural audio:** RED variation/coalescing/autoplay/fallback contracts, pure voice
   plans, bounded Web Audio adapter, existing asset/synth compatibility.
4. **R11.4 — camera and constructor surfaces:** RED merge/clock/accessibility contracts, shared
   compositor, Studio Juice workspace, MCP/AI preview/apply/recipes, packages, fixture, and docs.

Every increment includes absent/empty/future/malformed and adversarial own-data tests. Final
acceptance additionally requires deterministic results under catalog-record permutation, continuous
versus checkpoint/journal replay snapshot projection, Studio enable/edit/save/reload/remove/re-add,
AI `describe -> read -> preview -> guarded apply -> validate -> event preview`, stale revision and
rollback, Canvas/Phaser on hex/square, normal/reduced/off motion, audio unavailable/suspended, PWA,
single-file, web package, `.tdpack`, desktop build, unchanged starter/golden output, and exact plugin
runtime parity. The relevant repository gates and independent Code Verifier plus Constructor
Integration Verifier sign-offs are mandatory before this ADR can become Accepted.
