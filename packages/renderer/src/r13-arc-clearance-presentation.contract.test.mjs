import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

function event(overrides = {}) {
  return {
    type: "projectileBlocked",
    projectileId: "projectile_2",
    targetCoord: { q: 4, r: 1 },
    blockerCoord: { q: 2, r: 1 },
    terrainId: "cliff",
    blockerTag: "wall",
    projectileAltitude: 5,
    obstacleTop: 5,
    ...overrides
  };
}

function snapshot(events, schemaVersion = 1) {
  return { ballistics: { schemaVersion, projectiles: [] }, lastEvents: events };
}

function projector() {
  expect(Renderer.projectBallisticsEventPresentation).toBeTypeOf("function");
  return Renderer.projectBallisticsEventPresentation;
}

describe("R13.2 shared blocked-projectile presentation (RED)", () => {
  it("projects only exact engine events into detached frozen binary-sorted rows", () => {
    const source = snapshot([
      event({ projectileId: "projectile_z", blockerTag: "z_wall" }),
      { type: "towerFired", towerId: "tower_1", enemyId: "enemy_1", damage: 20 },
      event({ projectileId: "projectile_a", blockerTag: "a_wall" })
    ]);
    const projected = projector()(source);
    expect(projected).toEqual([
      {
        projectileId: "projectile_a",
        targetCoord: { q: 4, r: 1 }, blockerCoord: { q: 2, r: 1 },
        terrainId: "cliff", blockerTag: "a_wall", projectileAltitude: 5, obstacleTop: 5
      },
      {
        projectileId: "projectile_z",
        targetCoord: { q: 4, r: 1 }, blockerCoord: { q: 2, r: 1 },
        terrainId: "cliff", blockerTag: "z_wall", projectileAltitude: 5, obstacleTop: 5
      }
    ]);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(projected.every(Object.isFrozen)).toBe(true);
    source.lastEvents[0].blockerCoord.q = 99;
    expect(projected[1].blockerCoord).toEqual({ q: 2, r: 1 });
  });

  it("fails closed for inactive/future/malformed/hostile/over-budget inputs", () => {
    expect(projector()({ lastEvents: [event()] })).toEqual([]);
    expect(projector()(snapshot([event()], 2))).toEqual([]);
    for (const malformed of [
      event({ projectileId: "" }),
      event({ blockerCoord: { q: 2.5, r: 1 } }),
      event({ projectileAltitude: Number.NaN }),
      event({ obstacleTop: -1_000_001 }),
      event({ extra: true })
    ]) expect(projector()(snapshot([malformed]))).toEqual([]);

    let reads = 0;
    const accessor = event();
    Object.defineProperty(accessor, "blockerTag", {
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

  it("is the sole Canvas/Phaser adapter and contains no gameplay clearance calculation", () => {
    const modulePath = path.resolve("packages/renderer/src/ballistics-presentation.mjs");
    const presentationSource = fs.readFileSync(modulePath, "utf8");
    const canvasSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
    const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");
    expect(canvasSource).toMatch(/projectBallisticsEventPresentation\(snapshot\)|projectBallisticsEventPresentation\(presentationSnapshot\)/);
    const phaser = buildSource.slice(buildSource.indexOf("function phaserPlayerTemplate"));
    expect(phaser).toMatch(/projectBallisticsEventPresentation\(presentationSnapshot\)/);
    for (const source of [presentationSource, canvasSource, phaser]) {
      expect(source).not.toMatch(/topology|lineOfSight|elevationAt|terrainBlockerHeights/);
      expect(source).not.toMatch(/4\s*\*[^\n;]*maxAltitude[^\n;]*progress|obstacleTop\s*=|projectileAltitude\s*=/);
    }
  });
});
