# Opt-in projectile ballistics

This R13.1 fixture enables one `ballistics` v1 profile for `tutorial_01`. It matches the
deterministic `basic_projectile_ballistics` recipe when materialized against the starter:
binary-first eligible `arrow_tower` receives a fixed non-homing arc with `travelTimeUnits: 0.4`
and `maxAltitude: 2`; binary-first migrated terrain tag `blocked` receives blocker height `1` for
R13.2 clearance. The recipe and these files are inert examples; they do not enable another project
automatically.

1. Start from a project containing `arrow_tower` and `tutorial_01`.
2. Persist the guarded project migration so `project.json.schemaVersion` is `3`.
3. Copy `mechanics.json` to `content/mechanics.json`, preserving unrelated modules and profiles.
4. Merge `mission-selection.json` into only the mission that should use the profile.
5. Run `npm run validate` and `npm run sim tutorial_01 60`.
6. Verify continuous simulation, checkpoint restore, and journal replay produce one digest.

Only explicitly bound, unchained `single` attacks become authoritative projectiles. The engine
captures the launch packet, endpoint, and first launch-time blocker on its canonical topology line,
advances scalar altitude, and resolves a landed hit through the shared damage boundary. Canvas and
Phaser consume `snapshot.ballistics` and `projectileBlocked` through shared presentation projectors;
they do not own flight, collision, targeting, or damage.

Remove the mission selection or disable the module through the same guarded mechanics transaction
to restore the instant legacy attack path and remove the optional snapshot/checkpoint/UI state.
Remove `clearance` alone to retain R13.1 projectile travel without obstacle checks. Ricochet has a
separate `docs/examples/opt-in-projectile-ricochet/` fixture; destructibles and weather remain
outside this R13.1/R13.2 fixture.
See Proposed [ADR 0054](../../adr/0054-r13-deterministic-2-5d-ballistics.md).
