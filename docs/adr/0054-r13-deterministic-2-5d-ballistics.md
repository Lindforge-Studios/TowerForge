# ADR 0054: Opt-in deterministic 2.5D ballistics

- Status: Accepted
- Date: 2026-07-31
- Milestone: R13

## Context

TowerForge needs mortar-style travel, later arc clearance and ricochet, without adding a 3D physics
engine or moving collision and damage authority into Canvas or Phaser. The existing topology,
elevation, common `DamagePacket`/`DamageResolver`, checkpoint/journal replay, Mechanics Hub, and
guarded MCP mechanics transaction remain authoritative.

## Decision

R13 adds a separate mission-selected `ballistics` module. It does not change the existing `physics`
v1 tile-displacement contract. Version 1 is optional and closed. An absent, disabled, unsupported,
or unselected module creates no projectile state, snapshot/checkpoint field, UI mode, bundle work, or
runtime overhead.

R13.1 binds authored tower type IDs under `profile.projectiles.towers`. Only an unchained
`attack.kind === "single"` is supported. Unbound single attacks and all pulse, sniper, antiair,
splash, support, and pipeline attacks remain immediate. A binding chooses `direct | arc`, a positive
bounded `travelTimeUnits`, and, for arc only, positive bounded `maxAltitude`.

Projectile motion is deterministic 2.5D. Map movement stays two-dimensional; altitude is an engine
scalar. With progress in 0..1, direct altitude is the linear interpolation between the launch and
impact-point elevation. Arc altitude is that baseline plus
`4 * maxAltitude * progress * (1 - progress)`. `maxAltitude` is therefore additional height above
the baseline, not an absolute world apex.

At launch, the engine fixes a stable monotonic projectile ID, source coordinate/elevation, target
coordinate/elevation, target entity/component identity, and detached `DamagePacket`. Source-side
modifiers are captured at launch. The projectile is not homing: at arrival it hits only when the
same live target/component remains at the captured cell. Otherwise it emits one deterministic
`projectileMissed` event and disappears without retargeting.

On a landed impact, current target armor, resistance, marks, shields, vanguard interception, and
reaction state are resolved through the existing common damage boundary. Status, component/root
death, reward, and cleanup retain their existing exactly-once behavior. Selling, moving, or
upgrading the source tower does not rewrite the in-flight packet.

Only an active module publishes optional `snapshot.ballistics` inner schema v1. Renderers consume
the ready `sourceCoord`, `targetCoord`, `elapsedUnits`, `travelTimeUnits`, and `altitude`; they may
project those values to pixels but cannot calculate gameplay collisions or damage. The matching
optional checkpoint inner v1 additionally stores the next sequence, captured endpoint elevations,
and private impact payload. Project v3, outer `GameCheckpointV1`, `towerforge-sim-v2`, command/
journal v6, TowerScript, profile, campaign, and multiplayer versions do not increase.

R13.2 will add arc clearance through the topology line, elevation, and authored blocker height.
R13.3 will add bounded ricochet. R13.4 will add atomic destructible-environment mutation. R13.5 will
add a separate `weather` v1 module and RNG domain. Each remains a separate RED/GREEN slice.

### R13.2 amendment: launch-time arc clearance

R13.2 keeps Ballistics at schema v1 and adds optional
`projectiles.clearance.terrainBlockerHeights`. Keys are authored terrain tags; this avoids hardcoded
terrain IDs and avoids placing ballistic policy on the global terrain definition. The mapping is
closed, binary-normalized, deeply frozen, and independently bounded. A zero blocker height is valid
and makes the tile's effective elevation the obstacle top.

At launch, the engine uses the existing topology line from source to fixed target and excludes both
endpoints. For each interior cell it evaluates the R13.1 altitude formula at the line progress,
chooses the maximum matching authored blocker height (binary-min tag on equality), and compares it
with launch-time effective elevation. `projectileAltitude <= obstacleTop` blocks. The first blocking
cell becomes immutable flight provenance; later terraforming cannot change that in-flight result.

Blocked, landed, and missed projectiles share the existing terminal-resolution budget and stable
projectile-ID order. A block resolves before target identity, emits one read-only
`projectileBlocked` GameEvent, and does no damage, status, reaction, death, or reward work. Ray and
inspection budgets are checked before ammunition, cooldown, `towerFired`, or projectile allocation.

Profiles without clearance retain ballistics checkpoint inner v1 exactly. An active clearance uses
inner v2, while public snapshot remains v1 and does not disclose a private collision plan. The v2
checkpoint stores captured blocker coordinate, terrain ID/tag, elevation, and collision time and
validates those against the canonical line and active authored mapping. No project, outer checkpoint,
command/journal, TowerScript, Graph, profile, campaign, or multiplayer version changes.

### R13.3 amendment: bounded topology ricochet

R13.3 keeps Ballistics module v1 and adds optional closed ricochet catalogs plus a per-tower
`ricochet { maxBounces, rangeCells }` binding. Authored terrain surfaces are terrain tags already
present in R13.2 clearance; entity surfaces are armor type IDs from the same mission's active Combat
profile. Each record contains only `true`: reflection behavior belongs to the Ballistics contract,
not arbitrary code or a second modifier pipeline. Maximum bounce count is four and reflected range
is bounded to 256 cells.

A terrain collision uses its captured blocker tag. An entity collision uses effective root or
component armor. A reflective collision happens before the damage resolver. The topology registry
derives the incoming edge and its opposite outgoing direction; the engine scans one bounded ray,
selects the first occupied cell, and then the binary-min enemy among at most 16 candidates. That
root target and coordinate are fixed for the next segment. No candidate creates a fixed terminal
miss rather than homing. At the authored bounce limit, terrain follows normal blocked resolution and
entity armor follows normal landed damage resolution.

The launch-time `DamagePacket` remains detached; a bounce changes only its target reference. Any
landed packet still enters the common resolver with current target defenses and exactly-once
settlement. Public snapshot stays v1 and describes the current segment. Ricochet-enabled Ballistics
uses checkpoint inner v3; v1/v2 remain exact for profiles without it. The read-only
`projectileRicocheted` GameEvent is presentation-only and is not added to TowerScript or Visual
Graph. Weather, arbitrary normals, restitution, penetration, friendly fire, and
renderer-owned reflection remain excluded.

### R13.4 amendment: destructible environment

R13.4 keeps the Ballistics module at schema v1 and adds a closed optional
`projectiles.destructibles.definitions` catalog plus authored map `destructibleObjects`. A profile
may contain an empty `projectiles.towers` record only when the destructible catalog is valid and
non-empty. Definitions carry bounded HP, optional armor type, a tile hit region with blocker height
and LoS flag, and an optional authored persistent terrain transition. Components execute no code.

Projectile collision fixes object provenance for each segment. Object damage still enters the
common `DamageResolver`; HP and exactly-once destruction settle only once. A persistent transition
uses candidate terrain/elevation, navigation rebuild and reachability proof before an atomic commit.
Failure leaves no partial object, terrain, LoS or navigation mutation and publishes no partial
reward. Reset restores authored object and terrain state. Ricochet segments use the same bounded
trace and cannot bypass collision or inspection budgets.

Only an active and mission-selected catalog publishes Ballistics snapshot v2 with destructibles
inner v1 rows. Checkpoint Ballistics inner v4 retains object state and fixed collision provenance;
outer `GameCheckpointV1`, project v3, command/journal v6, profile and multiplayer versions remain
unchanged. `destructibleObjectDamaged` and `destructibleObjectDestroyed` are read-only GameEvents.
They are not TowerScript or Visual Graph events.

Canvas and Phaser consume one fail-closed presentation projector over the authoritative snapshot.
Procedural Juice may use the two event types only through an authored binding at `event.coord`; no
automatic debris or gameplay damage is created by a renderer. Absent, disabled, unselected,
legacy, future or malformed state projects the one inactive shape.

Authoring uses the inert `basic_destructible_environment` recipe and a separate guarded workflow:
`preview_destructible_environment` then `apply_destructible_environment(ifRevision)`. The candidate
transaction owns five files, creates a backup and performs rollback on failure. Every raw map source
used by compilation participates in the revision, while only the selected source is written. No
broad write tool is added. PWA, single-file, web package and `.tdpack` carriers preserve authored
data, while the canonical starter and absent/disabled/unselected paths remain unchanged.

### R13.5 amendment: independent deterministic Weather

R13.5 adds a separate mission-selected `weather` module at schema v1; it does not extend or depend
on Ballistics. A closed profile is exactly `{zones,definitions,schedule}`. Zones are bounded
`{kind:"all_map"}` or `{kind:"tiles",tiles:[{q,r}]}` records. Definitions contain binary-ID-ordered
effects from the closed union `periodic_damage | status | visibility_range | enemy_speed |
tower_fire_rate`. Engine validation owns map bounds, definition/zone references, scalar uniqueness
and all structural/runtime budgets.

For each authored wave, binary-ordered schedule choices plus `calmWeight` select zero or one
occurrence. Selection uses the independent length-prefixed `towerforge:weather:v1` seeded RNG
domain and does not advance simulation, draft, artifact, quest or future effect RNG. Weather starts
with its selected wave, ends when the wave clears and never overlaps another occurrence. Host
randomness and wall-clock time are forbidden.

The engine alone owns zone membership and effects. Periodic damage uses a typed weather
`DamagePacket` and the common resolver/exactly-once death/reward path; status uses existing merge
and expiry rules. Spatial visibility/range, enemy-speed and tower-fire-rate modifiers consult
authoritative enemy tiles and tower anchor tiles. Renderer and Studio code must not reproduce
these rules. Each periodic cursor is the canonical due ordinal for active elapsed time. The runtime
publishes at most the bounded number of due facts and consumes overflow; it never persists a
replayable backlog whose cursor could be rewound through a re-signed checkpoint.

Only an active selected profile adds `snapshot.weather` schema v1 and optional checkpoint Weather
inner v1. Lifecycle/diagnostic events are `weatherStarted`, `weatherEnded`,
`weatherEffectApplied`, and `weatherBudgetExceeded`. Canvas and Phaser consume the same fail-closed
snapshot/event projector. Absent, disabled, unselected, missing-profile and future-version modules
retain the exact legacy snapshot, checkpoint, replay, UI and player path.

Constructor authoring reuses `preview_mechanics_module` followed by guarded
`apply_mechanics_module(ifRevision)`, including validation, backup and rollback; there is no broad
`write_weather` tool. The inert recipes are `basic_blizzard_weather`,
`basic_acid_rain_weather`, and `basic_sandstorm_weather`. The copyable fixture is
`docs/examples/opt-in-weather/`. R13.5 adds no TowerScript action/event, Visual Graph node,
Ballistics coupling, authored terrain mutation or automatic Procedural Juice cue.

## TDD delivery

Each R13 sub-slice freezes its public contract and forbidden scope before production work. The
contract/test role records an expected RED, the engine role reaches focused GREEN, and constructor
surfaces follow under their own RED. Any verifier defect receives a new failing regression before a
fix. Source changes invalidate previous gates and both independent sign-offs.

R13.1 acceptance covers closed hostile-input normalization, active error versus inactive warning
semantics, direct/arc midpoint and endpoint altitude, delayed exactly-once impact, immutable target
point and launch packet, legacy/unbound no-op behavior, active-only snapshot/checkpoint state,
continuous/checkpoint/journal digest equivalence, Studio guarded authoring, MCP discovery/recipe,
Canvas/Phaser projection, generated packages, and plugin parity.

R13.3 acceptance additionally covers closed hostile ricochet catalogs/bindings, topology and input
order invariance, the four-bounce and spatial-candidate budgets, terrain/root/component armor
surfaces, fixed reflected targets, checkpoint inner-v3 replay equivalence, guarded MCP recipe v44,
Mechanics Hub round-trip, and shared Studio/Canvas/Phaser consumption of authoritative event fields.
This amendment is **Accepted** together with the complete R13 milestone after independent code and
constructor-integration verification on the frozen delivery commit.

R13.5 acceptance separately covers hostile own-data normalization, map/reference and effect
budgets, input-order and seed invariance, calm selection, interval boundaries, all five effect
kinds, exact active-only snapshot/checkpoint restore and continuous/journal replay equivalence.
Constructor acceptance covers the three recipes, guarded revision/backup/rollback authoring,
Studio enable/edit/reload/disable/re-enable, shared Canvas/Phaser projection on hex/square and
PWA/single-file/web-package/`.tdpack` carriers. The complete R13 decision is **Accepted** after both
independent sign-offs passed on the final frozen delivery commit.

## Consequences

- TowerForge gains authored projectile travel without a 3D engine or renderer-owned simulation.
- Legacy combat snapshots, replay digests, bundle shape, and performance remain unchanged.
- R13.1 intentionally excludes arc blockers, ricochet, destructibles, debris, weather, homing,
  chain/pipeline projectile delivery, new commands, and TowerScript/Visual Graph vocabulary.
- R13.4 implements destructible environment as its own opt-in vertical slice but still excludes
  automatic debris, weather, homing, new commands and TowerScript/Visual Graph vocabulary.
- R13.5 implements Weather as a separate opt-in capability with its own RNG/checkpoint domains; it
  does not turn weather into a mandatory Ballistics or Procedural Juice rule.
- The ordinary starter remains mechanics-free; R13 reference content is a separate opt-in fixture.
