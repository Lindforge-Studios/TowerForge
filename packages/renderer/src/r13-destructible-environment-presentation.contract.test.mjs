import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

const INACTIVE = Object.freeze({ active: false, rows: Object.freeze([]) });

function object(overrides = {}) {
  return {
    objectId: "gate_1",
    definitionId: "gate",
    coord: { q: 2, r: 1 },
    hp: 30,
    maxHp: 50,
    destroyed: false,
    ...overrides
  };
}

function snapshot(objects) {
  return {
    ballistics: {
      schemaVersion: 2,
      projectiles: [],
      destructibles: { schemaVersion: 1, objects }
    }
  };
}

function projector() {
  expect(
    Renderer.projectDestructibleEnvironmentPresentation,
    "R13.4d3a must export one pure shared destructible-environment projector"
  ).toBeTypeOf("function");
  return Renderer.projectDestructibleEnvironmentPresentation;
}

describe("R13.4d3a shared destructible-environment presentation (RED)", () => {
  it("projects detached, deeply frozen rows in binary object-ID order", () => {
    const source = snapshot([
      object({ objectId: "wall_z", definitionId: "wall", coord: { q: 7, r: 1 }, hp: 0, destroyed: true }),
      object({ objectId: "gate_a" })
    ]);
    const projected = projector()(source);

    expect(projected).toEqual({
      active: true,
      rows: [
        {
          objectId: "gate_a", definitionId: "gate", coord: { q: 2, r: 1 },
          hp: 30, maxHp: 50, hpRatio: 0.6, destroyed: false
        },
        {
          objectId: "wall_z", definitionId: "wall", coord: { q: 7, r: 1 },
          hp: 0, maxHp: 50, hpRatio: 0, destroyed: true
        }
      ]
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.rows)).toBe(true);
    expect(projected.rows.every(Object.isFrozen)).toBe(true);
    expect(projected.rows.every((row) => Object.isFrozen(row.coord))).toBe(true);

    const permuted = snapshot([
      object({ objectId: "gate_a" }),
      object({ objectId: "wall_z", definitionId: "wall", coord: { q: 7, r: 1 }, hp: 0, destroyed: true })
    ]);
    expect(projector()(permuted)).toEqual(projected);

    source.ballistics.destructibles.objects[1].hp = 1;
    source.ballistics.destructibles.objects[1].coord.q = 99;
    expect(projected.rows[0]).toMatchObject({ hp: 30, coord: { q: 2, r: 1 } });
  });

  it("returns the one inactive shape for absent, legacy, future and malformed state", () => {
    const project = projector();
    for (const candidate of [
      undefined,
      {},
      { ballistics: { schemaVersion: 1, projectiles: [] } },
      { ballistics: { schemaVersion: 3, projectiles: [], destructibles: { schemaVersion: 1, objects: [] } } },
      { ballistics: { schemaVersion: 2, projectiles: [], destructibles: { schemaVersion: 2, objects: [] } } },
      snapshot([object({ hp: -1 })]),
      snapshot([object({ hp: 51 })]),
      snapshot([object({ destroyed: true, hp: 1 })]),
      snapshot([object({ maxHp: 0 })]),
      snapshot([object({ unexpected: true })])
    ]) expect(project(candidate)).toEqual(INACTIVE);
  });

  it("rejects surrounding whitespace and ASCII controls in both authored ID fields", () => {
    const project = projector();
    const unsafeIds = [" gate_1", "gate_1 ", "gate\n1", "gate\u00001"];
    for (const field of ["objectId", "definitionId"]) {
      for (const value of unsafeIds) {
        expect(project(snapshot([object({ [field]: value })]))).toEqual(INACTIVE);
      }
    }
  });

  it("fails closed on accessor, hostile proxy, sparse and duplicate rows without executing traps", () => {
    const project = projector();
    let reads = 0;
    const accessor = object();
    Object.defineProperty(accessor, "hp", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("destructible accessor executed");
      }
    });
    expect(() => project(snapshot([accessor]))).not.toThrow();
    expect(project(snapshot([accessor]))).toEqual(INACTIVE);
    expect(reads).toBe(0);

    const hostile = new Proxy([object()], {
      getOwnPropertyDescriptor() { throw new Error("hostile destructible list"); },
      ownKeys() { throw new Error("hostile destructible keys"); }
    });
    expect(() => project(snapshot(hostile))).not.toThrow();
    expect(project(snapshot(hostile))).toEqual(INACTIVE);

    const sparse = new Array(2);
    sparse[1] = object();
    expect(project(snapshot(sparse))).toEqual(INACTIVE);
    expect(project(snapshot([object(), object({ coord: { q: 3, r: 1 } })]))).toEqual(INACTIVE);
  });

  it("rejects state above the authored 4,096-object presentation budget", () => {
    const rows = Array.from({ length: 4_097 }, (_, index) => object({
      objectId: `gate_${String(index).padStart(4, "0")}`,
      coord: { q: index, r: 0 }
    }));
    expect(projector()(snapshot(rows))).toEqual(INACTIVE);
  });

  it("is the shared Canvas/Phaser source and imports no gameplay rules", () => {
    const sourcePath = path.resolve("packages/renderer/src/destructible-environment-presentation.mjs");
    const canvasSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
    const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

    expect(fs.existsSync(sourcePath)).toBe(true);
    expect(canvasSource).toMatch(
      /export\s+\*\s+from\s+["']\.\/destructible-environment-presentation\.mjs["']/
    );
    expect(canvasSource).toMatch(/projectDestructibleEnvironmentPresentation\s*\(snapshot\)/);
    expect(canvasSource).toMatch(/drawSnapshot[\s\S]*destructibleEnvironmentPresentation\.active/);

    const phaser = buildSource.slice(buildSource.indexOf("function phaserPlayerTemplate"));
    expect(phaser).toMatch(/projectDestructibleEnvironmentPresentation/);
    expect(phaser).toMatch(/projectDestructibleEnvironmentPresentation\s*\((?:presentationSnapshot|snap)\)/);
    expect(phaser).toMatch(/destructibleEnvironmentPresentation\.active/);

    const pureSource = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
    expect(pureSource).not.toMatch(
      /DamageResolver|TowerDefenseGame|content\.mechanics|collision|navigation|lineOfSight|terrainTransition|target(?:ing|Mode)/
    );
  });
});
