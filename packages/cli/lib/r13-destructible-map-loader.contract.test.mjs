import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileMapSource, normalizeDestructibleObjects } from "./map-compiler.mjs";
import { loadContentRegistry, loadProjectFiles } from "./project-loader.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function source() {
  return {
    id: "object_map", orientation: "orthogonal", width: 5, height: 3,
    defaultTerrain: "buildable", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 4, r: 0 },
    pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 0 })),
    destructibleObjects: [
      { id: "z_gate", definitionId: "gate", coord: { q: 3, r: 2 } },
      { id: "a_gate", definitionId: "gate", coord: { q: 2, r: 1 } },
      { id: "c_gate", definitionId: "gate", coord: { q: 3, r: 1 } }
    ]
  };
}

const EXPECTED = [
  { id: "a_gate", definitionId: "gate", coord: { q: 2, r: 1 } },
  { id: "c_gate", definitionId: "gate", coord: { q: 3, r: 1 } },
  { id: "z_gate", definitionId: "gate", coord: { q: 3, r: 2 } }
];

const unsafeDestructibleIdentifiers = [
  ["leading whitespace in placement id", { id: " gate_1", definitionId: "gate" }],
  ["trailing whitespace in placement id", { id: "gate_1 ", definitionId: "gate" }],
  ["NUL in placement id", { id: "gate\u0000_1", definitionId: "gate" }],
  ["DEL in placement id", { id: "gate\u007f_1", definitionId: "gate" }],
  ["leading whitespace in definitionId", { id: "gate_1", definitionId: " gate" }],
  ["trailing whitespace in definitionId", { id: "gate_1", definitionId: "gate " }],
  ["newline in definitionId", { id: "gate_1", definitionId: "ga\nte" }],
  ["DEL in definitionId", { id: "gate_1", definitionId: "ga\u007fte" }]
];

describe("R13.4a TMJ compiler and project-loader destructible parity (RED)", () => {
  it.each(unsafeDestructibleIdentifiers)("rejects %s in the exported normalizer", (_label, identifiers) => {
    const placement = { ...identifiers, coord: { q: 0, r: 0 } };
    expect(() => normalizeDestructibleObjects([placement], 1, 1))
      .toThrow(/identifier|whitespace|control|ascii|utf-8/i);
  });

  it.each(unsafeDestructibleIdentifiers)("rejects %s in the top-level compile path", (_label, identifiers) => {
    const placement = { ...identifiers, coord: { q: 0, r: 0 } };
    const topLevel = source();
    topLevel.destructibleObjects = [placement];
    expect(() => compileMapSource(topLevel, "unsafe-destructible-id.tmj"))
      .toThrow(/identifier|whitespace|control|ascii|utf-8/i);
  });

  it.each(unsafeDestructibleIdentifiers)("rejects %s in the Tiled-property compile path", (_label, identifiers) => {
    const placement = { ...identifiers, coord: { q: 0, r: 0 } };
    const tiledProperty = source();
    delete tiledProperty.destructibleObjects;
    tiledProperty.properties = [{
      name: "destructibleObjects", type: "string", value: JSON.stringify([placement])
    }];
    expect(() => compileMapSource(tiledProperty, "unsafe-destructible-property.tmj"))
      .toThrow(/identifier|whitespace|control|ascii|utf-8/i);
  });

  it("compiles top-level and documented Tiled-property sources through one canonical contract", () => {
    expect(compileMapSource(source(), "top-level.tmj").destructibleObjects).toEqual(EXPECTED);
    const tiled = source();
    delete tiled.destructibleObjects;
    tiled.properties = [{
      name: "destructibleObjects", type: "string", value: JSON.stringify(source().destructibleObjects)
    }];
    expect(compileMapSource(tiled, "property.tmj").destructibleObjects).toEqual(EXPECTED);

    const ambiguous = source();
    ambiguous.properties = [{ name: "destructibleObjects", type: "string", value: "[]" }];
    expect(() => compileMapSource(ambiguous, "ambiguous.tmj"))
      .toThrow(/destructibleObjects.*ambiguous|either.*top.*Tiled|not both/i);
    const malformed = source();
    delete malformed.destructibleObjects;
    malformed.properties = [{ name: "destructibleObjects", type: "string", value: "not-json" }];
    expect(() => compileMapSource(malformed, "malformed.tmj"))
      .toThrow(/destructibleObjects.*valid JSON|valid JSON.*destructibleObjects/i);
  });

  it("does not execute hostile Tiled property accessors and omits the field exactly when absent", () => {
    let reads = 0;
    const hostileProperty = { type: "string", value: "[]" };
    Object.defineProperty(hostileProperty, "name", {
      enumerable: true, get() { reads += 1; return "destructibleObjects"; }
    });
    const hostile = source();
    delete hostile.destructibleObjects;
    hostile.properties = [hostileProperty];
    expect(() => compileMapSource(hostile, "hostile.tmj"))
      .toThrow(/property|name|data field|accessor/i);
    expect(reads).toBe(0);

    const absent = source();
    delete absent.destructibleObjects;
    const compiled = compileMapSource(absent, "legacy.tmj");
    expect(compiled).not.toHaveProperty("destructibleObjects");
  });

  it("preserves source -> compiled -> loader -> content mapFactory clone parity", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r13-destructible-loader-"));
    projects.push(projectDir);
    fs.cpSync(STARTER, projectDir, { recursive: true });
    const sourcePath = path.join(projectDir, "maps", "src", "tutorial_map.tmj");
    const authored = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    authored.destructibleObjects = [
      { id: "gate_z", definitionId: "gate", coord: { q: 8, r: 2 } },
      { id: "gate_a", definitionId: "gate", coord: { q: 6, r: 2 } }
    ];
    const compiled = compileMapSource(authored, "tutorial_map.tmj");
    fs.writeFileSync(sourcePath, `${JSON.stringify(authored, null, 2)}\n`, "utf8");
    fs.writeFileSync(
      path.join(projectDir, "maps", "compiled", "maps.json"),
      `${JSON.stringify({ tutorial_map: compiled }, null, 2)}\n`, "utf8"
    );
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.missions.tutorial_01.mechanics = {
      profiles: { ballistics: "destructibles", combat: "armored", terraforming: "terrain" }
    };
    fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(projectDir, "content", "mechanics.json"), `${JSON.stringify({
      schemaVersion: 1,
      modules: {
        ballistics: {
          schemaVersion: 1, enabled: true,
          profiles: {
            destructibles: {
              projectiles: {
                towers: { arrow_tower: { trajectory: "direct", travelTimeUnits: 0.4 } },
                destructibles: {
                  definitions: {
                    gate: {
                      maxHp: 100,
                      hitRegion: { kind: "tile", blockerHeight: 2, blocksLineOfSight: true },
                      armorTypeId: "stone",
                      onDestroyed: { terrainTransitionId: "destroy_gate" }
                    }
                  }
                }
              }
            }
          }
        },
        combat: {
          schemaVersion: 2, enabled: true,
          profiles: {
            armored: {
              damageTypes: { physical: { label: "Physical" } },
              armorTypes: { stone: { label: "Stone", defaultMultiplier: 1, multipliers: { physical: 1 } } },
              armorAssignments: { enemies: {} }
            }
          }
        },
        terraforming: {
          schemaVersion: 1, enabled: true,
          profiles: {
            terrain: {
              terrainTransitions: {
                destroy_gate: { fromTerrainTags: ["ground"], toTerrainId: "buildable" }
              }
            }
          }
        }
      }
    }, null, 2)}\n`, "utf8");

    const files = loadProjectFiles(projectDir);
    expect(files.maps.tutorial_map.destructibleObjects).toEqual([
      { id: "gate_a", definitionId: "gate", coord: { q: 6, r: 2 } },
      { id: "gate_z", definitionId: "gate", coord: { q: 8, r: 2 } }
    ]);
    const loaded = await loadContentRegistry(projectDir);
    expect(loaded.content.maps.tutorial_map.destructibleObjects).toEqual(files.maps.tutorial_map.destructibleObjects);
    const map = loaded.content.missions.tutorial_01.mapFactory();
    expect(map.getDestructibleObjects()).toEqual(files.maps.tutorial_map.destructibleObjects);
    const detached = map.getDestructibleObjects();
    detached[0].coord.q = 0;
    expect(map.clone().getDestructibleObjects()).toEqual(files.maps.tutorial_map.destructibleObjects);
  }, 30_000);
});
