# Opt-in projectile ricochet

This R13.3 fixture enables one `ballistics` v1 profile for `tutorial_01`. It matches the inert
`basic_projectile_ricochet` recipe against the starter: binary-first eligible `arrow_tower` receives
a direct fixed-travel projectile with at most two bounces over twelve cells, while the binary-first
authored terrain tag `blocked` is both a clearance blocker and a reflective surface.

1. Start from a project containing `arrow_tower`, terrain tag `blocked`, and `tutorial_01`.
2. Persist the guarded project migration so `project.json.schemaVersion` is `3`.
3. Copy `mechanics.json` to `content/mechanics.json`, preserving unrelated modules and profiles.
4. Merge `mission-selection.json` into only the mission that should use the profile.
5. Run `npm run validate` and `npm run sim tutorial_01 60`.
6. Verify continuous simulation, checkpoint restore, and journal replay produce one digest.

The engine owns topology reflection, the bounded spatial candidate lookup, the fixed next target,
and all damage resolution. Studio, Canvas, and Phaser consume `projectileRicocheted` only through the
shared presentation projector. Removing `projectiles.ricochet` and the tower's `ricochet` binding
retains ordinary R13.1/R13.2 projectile travel and clearance; removing the mission selection restores
the instant legacy attack path.

The recipe never enables the module, selects a mission, or invents tower, terrain, or armor IDs.
Destructibles and weather remain outside this fixture. See Proposed
[ADR 0054](../../adr/0054-r13-deterministic-2-5d-ballistics.md).
