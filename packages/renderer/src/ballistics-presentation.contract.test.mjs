import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

const INACTIVE = Object.freeze({ active: false, projectiles: Object.freeze([]) });

function projectile(overrides = {}) {
  return {
    id: "projectile_1",
    sourceCoord: { q: 1, r: 2 },
    targetCoord: { q: 5, r: 2 },
    trajectory: "arc",
    elapsedUnits: 0.2,
    travelTimeUnits: 0.4,
    altitude: 6,
    maxAltitude: 6,
    ...overrides
  };
}

function snapshot(projectiles) {
  return { ballistics: { schemaVersion: 1, projectiles } };
}

function projector() {
  expect(Renderer.projectBallisticsPresentation).toBeTypeOf("function");
  return Renderer.projectBallisticsPresentation;
}

describe("R13.1 shared projectile presentation (RED)", () => {
  it("projects detached frozen binary-stable authoritative rows and bounded progress", () => {
    const source = snapshot([
      projectile({ id: "projectile_z", trajectory: "direct", altitude: 3, maxAltitude: undefined }),
      projectile({ id: "projectile_a", elapsedUnits: 0.1 })
    ]);
    const projected = projector()(source);

    expect(projected).toEqual({
      active: true,
      projectiles: [
        {
          id: "projectile_a",
          sourceCoord: { q: 1, r: 2 }, targetCoord: { q: 5, r: 2 }, trajectory: "arc",
          elapsedUnits: 0.1, travelTimeUnits: 0.4, progress: 0.25, altitude: 6, maxAltitude: 6
        },
        {
          id: "projectile_z",
          sourceCoord: { q: 1, r: 2 }, targetCoord: { q: 5, r: 2 }, trajectory: "direct",
          elapsedUnits: 0.2, travelTimeUnits: 0.4, progress: 0.5, altitude: 3
        }
      ]
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.projectiles)).toBe(true);
    expect(projected.projectiles.every(Object.isFrozen)).toBe(true);
    source.ballistics.projectiles[1].sourceCoord.q = 99;
    expect(projected.projectiles[0].sourceCoord).toEqual({ q: 1, r: 2 });
  });

  it("uses one shared pixel projector for Canvas and Phaser", () => {
    expect(Renderer.projectBallisticsPresentationPoint).toBeTypeOf("function");
    const row = projector()(snapshot([projectile()])).projectiles[0];
    const point = Renderer.projectBallisticsPresentationPoint(
      row,
      (coord) => ({ x: coord.q * 10, y: coord.r * 10 }),
      2
    );
    expect(point).toEqual({ x: 30, y: 8, altitude: 6 });

    const rendererSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
    const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");
    expect(rendererSource).toMatch(/export\s+\*\s+from\s+["']\.\/ballistics-presentation\.mjs["']/);
    expect(rendererSource).toMatch(/projectBallisticsPresentation\s*\(snapshot\)/);
    expect(rendererSource).toMatch(/projectBallisticsPresentationPoint\s*\(/);
    expect(rendererSource).toMatch(/drawSnapshot[\s\S]*ballisticsPresentation\.active/);

    const phaser = buildSource.slice(buildSource.indexOf("function phaserPlayerTemplate"));
    expect(phaser).toMatch(/projectBallisticsPresentation\s*\(presentationSnapshot\)/);
    expect(phaser).toMatch(/projectBallisticsPresentationPoint\s*\(/);
    expect(phaser).toMatch(/ballisticsPresentation\.active/);
    expect(phaser).not.toMatch(/elapsedUnits\s*\/\s*[^\n;]*travelTimeUnits/);
  });

  it("fails closed for absent, future, malformed, accessor, proxy, and over-budget state", () => {
    expect(projector()(undefined)).toEqual(INACTIVE);
    expect(projector()({})).toEqual(INACTIVE);
    expect(projector()({ ballistics: { schemaVersion: 2, projectiles: [] } })).toEqual(INACTIVE);

    for (const malformed of [
      { schemaVersion: 1, projectiles: {}, extra: true },
      { schemaVersion: 1, projectiles: [projectile({ elapsedUnits: -1 })] },
      { schemaVersion: 1, projectiles: [projectile({ elapsedUnits: 0.5 })] },
      { schemaVersion: 1, projectiles: [projectile({ travelTimeUnits: 0 })] },
      { schemaVersion: 1, projectiles: [projectile({ trajectory: "homing" })] },
      { schemaVersion: 1, projectiles: [projectile({ trajectory: "direct", maxAltitude: 1 })] },
      { schemaVersion: 1, projectiles: [projectile({ trajectory: "arc", maxAltitude: undefined })] },
      { schemaVersion: 1, projectiles: [projectile({ unexpected: true })] }
    ]) expect(projector()({ ballistics: malformed })).toEqual(INACTIVE);

    let reads = 0;
    const accessor = projectile();
    Object.defineProperty(accessor, "altitude", {
      enumerable: true,
      get() { reads += 1; throw new Error("projectile accessor executed"); }
    });
    expect(() => projector()(snapshot([accessor]))).not.toThrow();
    expect(projector()(snapshot([accessor]))).toEqual(INACTIVE);
    expect(reads).toBe(0);

    const hostile = new Proxy([], { getOwnPropertyDescriptor() { throw new Error("hostile projectile list"); } });
    expect(() => projector()(snapshot(hostile))).not.toThrow();
    expect(projector()(snapshot(hostile))).toEqual(INACTIVE);

    expect(projector()(snapshot(Array.from({ length: 4097 }, (_, index) => (
      projectile({ id: `projectile_${index + 1}` })
    ))))).toEqual(INACTIVE);
  });

  it("keeps presentation free of gameplay simulation, topology, ricochet, and weather rules", () => {
    const sourcePath = path.resolve("packages/renderer/src/ballistics-presentation.mjs");
    expect(fs.existsSync(sourcePath)).toBe(true);
    const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
    expect(source).not.toMatch(
      /DamageResolver|TowerDefenseGame|content\.mechanics|topology|lineOfSight|ricochet|weather|targeting/
    );
  });
});
