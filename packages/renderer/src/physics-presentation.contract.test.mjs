import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as renderer from "./index.mjs";

const sourcePath = path.resolve("packages/renderer/src/physics-presentation.mjs");
const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
const canvasSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

function projector() {
  expect(renderer.projectPhysicsPresentationCues).toBeTypeOf("function");
  return renderer.projectPhysicsPresentationCues;
}

const displacement = Object.freeze({
  type: "enemyDisplacementResolved",
  sourceKind: "tower",
  sourceId: "tower-1",
  sourceCoord: Object.freeze({ q: 1, r: 1 }),
  enemyId: "enemy-1",
  mode: "push",
  requestedDistance: 2,
  movedDistance: 1,
  from: Object.freeze({ q: 2, r: 1 }),
  to: Object.freeze({ q: 3, r: 1 }),
  stopReason: "blocker"
});
const fell = Object.freeze({
  type: "enemyFell",
  sourceKind: "ability",
  sourceId: "gust",
  sourceCoord: Object.freeze({ q: 1, r: 1 }),
  enemyId: "enemy-2",
  from: Object.freeze({ q: 2, r: 1 }),
  to: Object.freeze({ q: 3, r: 1 }),
  terrainTag: "fall_hazard"
});

describe("R3.4a shared physics presentation contract", () => {
  it("projects only detached engine-authored displacement and fall events", () => {
    const snapshot = Object.freeze({ lastEvents: Object.freeze([displacement, fell, Object.freeze({ type: "enemyHit" })]) });
    const before = structuredClone(snapshot);
    expect(projector()(snapshot)).toEqual([
      {
        kind: "displacement",
        sourceKind: "tower",
        sourceId: "tower-1",
        sourceCoord: { q: 1, r: 1 },
        enemyId: "enemy-1",
        mode: "push",
        requestedDistance: 2,
        movedDistance: 1,
        from: { q: 2, r: 1 },
        to: { q: 3, r: 1 },
        stopReason: "blocker"
      },
      {
        kind: "fall",
        sourceKind: "ability",
        sourceId: "gust",
        sourceCoord: { q: 1, r: 1 },
        enemyId: "enemy-2",
        from: { q: 2, r: 1 },
        to: { q: 3, r: 1 },
        terrainTag: "fall_hazard"
      }
    ]);
    expect(snapshot).toEqual(before);
  });

  it("fails closed for malformed, accessor-backed, and over-budget events", () => {
    expect(projector()(undefined)).toEqual([]);
    expect(projector()({ lastEvents: [{ ...displacement, movedDistance: -1 }] })).toEqual([]);
    const accessor = {};
    Object.defineProperty(accessor, "type", { enumerable: true, get() { throw new Error("secret"); } });
    expect(() => projector()({ lastEvents: [accessor] })).not.toThrow();
    expect(projector()({ lastEvents: [accessor] })).toEqual([]);

    const many = Array.from({ length: 300 }, (_, index) => ({
      ...displacement,
      enemyId: `enemy-${index}`
    }));
    expect(projector()({ lastEvents: many })).toHaveLength(256);
  });

  it("is shared by Canvas and Phaser and contains no gameplay recomputation", () => {
    expect(source).not.toBe("");
    expect(canvasSource).toMatch(/export\s+\*\s+from\s+["']\.\/physics-presentation\.mjs["']/);
    expect(canvasSource).toMatch(/projectPhysicsPresentationCues\s*\(/);
    expect(buildSource.match(/projectPhysicsPresentationCues\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source).not.toMatch(
      /topology|neighbors|distanceTo|pathProgress|navigationField|terrainTypes|walkable|fallHazardTerrainTags|TowerDefenseGame/
    );
  });
});
