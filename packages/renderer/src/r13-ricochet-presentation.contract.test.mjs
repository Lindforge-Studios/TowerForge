import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

function event(overrides = {}) {
  return {
    type: "projectileRicocheted",
    projectileId: "projectile_2",
    bounceCount: 1,
    surfaceKind: "terrain",
    surfaceId: "reflective_rock",
    collisionCoord: { q: 2, r: 1 },
    nextSourceCoord: { q: 3, r: 1 },
    nextTargetCoord: { q: 5, r: 1 },
    ...overrides
  };
}

function snapshot(events, schemaVersion = 1) {
  return { ballistics: { schemaVersion, projectiles: [] }, lastEvents: events };
}

function projector() {
  expect(Renderer.projectBallisticsRicochetEventPresentation).toBeTypeOf("function");
  return Renderer.projectBallisticsRicochetEventPresentation;
}

describe("R13.3 shared ricochet-event presentation (RED)", () => {
  it("projects exact authoritative rows in stable order as detached deeply frozen data", () => {
    const source = snapshot([
      event({ projectileId: "projectile_z", bounceCount: 2, surfaceKind: "armor", surfaceId: "plated" }),
      { type: "towerFired", towerId: "tower_1", enemyId: "enemy_1", damage: 20 },
      event({ projectileId: "projectile_a", bounceCount: 1 })
    ]);
    const projected = projector()(source);
    expect(projected).toEqual([
      {
        projectileId: "projectile_a", bounceCount: 1,
        surfaceKind: "terrain", surfaceId: "reflective_rock",
        collisionCoord: { q: 2, r: 1 }, nextSourceCoord: { q: 3, r: 1 },
        nextTargetCoord: { q: 5, r: 1 }
      },
      {
        projectileId: "projectile_z", bounceCount: 2,
        surfaceKind: "armor", surfaceId: "plated",
        collisionCoord: { q: 2, r: 1 }, nextSourceCoord: { q: 3, r: 1 },
        nextTargetCoord: { q: 5, r: 1 }
      }
    ]);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(projected.every((row) => Object.isFrozen(row)
      && Object.isFrozen(row.collisionCoord)
      && Object.isFrozen(row.nextSourceCoord)
      && Object.isFrozen(row.nextTargetCoord))).toBe(true);
    source.lastEvents[0].collisionCoord.q = 99;
    expect(projected[1].collisionCoord).toEqual({ q: 2, r: 1 });
  });

  it("fails closed without active v1 state and for malformed, hostile, duplicate, or over-budget events", () => {
    expect(projector()({ lastEvents: [event()] })).toEqual([]);
    expect(projector()(snapshot([event()], 2))).toEqual([]);
    for (const malformed of [
      event({ projectileId: "" }),
      event({ bounceCount: 0 }),
      event({ bounceCount: 5 }),
      event({ surfaceKind: "shield" }),
      event({ collisionCoord: { q: 2.5, r: 1 } }),
      event({ extra: true })
    ]) expect(projector()(snapshot([malformed]))).toEqual([]);

    expect(projector()(snapshot([
      event({ projectileId: "projectile_1", bounceCount: 1 }),
      event({ projectileId: "projectile_1", bounceCount: 1 })
    ]))).toEqual([]);
    let reads = 0;
    const accessor = event();
    Object.defineProperty(accessor, "surfaceId", {
      enumerable: true,
      get() { reads += 1; throw new Error("must not execute"); }
    });
    expect(() => projector()(snapshot([accessor]))).not.toThrow();
    expect(projector()(snapshot([accessor]))).toEqual([]);
    expect(reads).toBe(0);
    expect(projector()(snapshot(Array.from({ length: 4097 }, (_, index) => (
      event({ projectileId: `projectile_${index + 1}` })
    ))))).toEqual([]);
  });

  it("keeps the blocked projector API unchanged and adapters free of reflection gameplay", () => {
    expect(Renderer.projectBallisticsEventPresentation(snapshot([event()]))).toEqual([]);
    const presentationSource = fs.readFileSync(
      path.resolve("packages/renderer/src/ballistics-presentation.mjs"), "utf8"
    );
    const canvasSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
    const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");
    expect(canvasSource).toMatch(/projectBallisticsRicochetEventPresentation\(snapshot\)|projectBallisticsRicochetEventPresentation\(presentationSnapshot\)/);
    const phaser = buildSource.slice(buildSource.indexOf("function phaserPlayerTemplate"));
    expect(phaser).toMatch(/projectBallisticsRicochetEventPresentation\(presentationSnapshot\)/);
    for (const source of [presentationSource, canvasSource, phaser]) {
      expect(source).not.toMatch(/traceProjectileRicochetRayV1|createGridTopology|DamageResolver/);
      expect(source).not.toMatch(/(?:incoming|direction|vector)[\s\S]{0,100}(?:reflect|bounce).*=/i);
    }
  });
});
