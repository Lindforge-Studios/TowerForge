import { describe, expect, it } from "vitest";
import * as MapModule from "./map.js";
import { GridMap, type GridMapDefinition } from "./map.js";

function definition(objects?: unknown): GridMapDefinition {
  return {
    id: "object_map", width: 5, height: 3,
    grid: { kind: "square", adjacency: "cardinal" }, defaultTerrain: "buildable",
    spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 4, r: 0 },
    pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 0 })),
    pathRoutes: [], terrainOverrides: [],
    ...(objects === undefined ? {} : { destructibleObjects: objects })
  } as unknown as GridMapDefinition;
}

function objects(): Array<{ id: string; definitionId: string; coord: { q: number; r: number } }> {
  return [
    { id: "z_gate", definitionId: "gate", coord: { q: 3, r: 2 } },
    { id: "c_gate", definitionId: "gate", coord: { q: 3, r: 1 } },
    { id: "a_gate", definitionId: "gate", coord: { q: 2, r: 1 } }
  ];
}

function normalize(value: unknown, width = 5, height = 3): any[] {
  const fn = (MapModule as unknown as {
    normalizeGridDestructibleObjects?: (value: unknown, width: number, height: number) => any[];
  }).normalizeGridDestructibleObjects;
  expect(fn).toBeTypeOf("function");
  return fn!(value, width, height);
}

const unsafeDestructibleIdentifiers = [
  ["leading whitespace in placement id", { id: " gate_1", definitionId: "gate" }],
  ["trailing whitespace in placement id", { id: "gate_1 ", definitionId: "gate" }],
  ["NUL in placement id", { id: "gate\u0000_1", definitionId: "gate" }],
  ["DEL in placement id", { id: "gate\u007f_1", definitionId: "gate" }],
  ["leading whitespace in definitionId", { id: "gate_1", definitionId: " gate" }],
  ["trailing whitespace in definitionId", { id: "gate_1", definitionId: "gate " }],
  ["newline in definitionId", { id: "gate_1", definitionId: "ga\nte" }],
  ["DEL in definitionId", { id: "gate_1", definitionId: "ga\u007fte" }]
] as const;

describe("R13.4a map destructible placement contract (RED)", () => {
  it.each(unsafeDestructibleIdentifiers)("rejects %s", (_label, identifiers) => {
    expect(() => normalize([{
      ...identifiers,
      coord: { q: 0, r: 0 }
    }], 1, 1)).toThrow(/identifier|whitespace|control|ascii|utf-8/i);
  });

  it("canonicalizes exact placements by (r,q,id), detaches them, and preserves GridMap clone parity", () => {
    const authored = objects();
    expect(normalize(authored)).toEqual([
      { id: "a_gate", definitionId: "gate", coord: { q: 2, r: 1 } },
      { id: "c_gate", definitionId: "gate", coord: { q: 3, r: 1 } },
      { id: "z_gate", definitionId: "gate", coord: { q: 3, r: 2 } }
    ]);
    const map = GridMap.fromDefinition(definition(authored));
    const read = (subject: GridMap): any[] => {
      const getter = (subject as unknown as { getDestructibleObjects?: () => any[] }).getDestructibleObjects;
      expect(getter).toBeTypeOf("function");
      return getter!.call(subject);
    };
    expect(read(map)).toEqual(normalize(authored));
    authored[0]!.coord.q = 0;
    const detached = read(map);
    detached[0].coord.q = 4;
    expect(read(map)).toEqual([
      { id: "a_gate", definitionId: "gate", coord: { q: 2, r: 1 } },
      { id: "c_gate", definitionId: "gate", coord: { q: 3, r: 1 } },
      { id: "z_gate", definitionId: "gate", coord: { q: 3, r: 2 } }
    ]);
    expect(read(map.clone())).toEqual(read(map));
  });

  it("rejects duplicate IDs, duplicate cells, out-of-map coordinates, extras, sparse, accessor, and proxy inputs", () => {
    const duplicateId = objects();
    duplicateId[1]!.id = duplicateId[0]!.id;
    const duplicateCell = objects();
    duplicateCell[1]!.coord = { ...duplicateCell[0]!.coord };
    for (const malformed of [
      duplicateId,
      duplicateCell,
      [{ id: "gate", definitionId: "gate", coord: { q: 5, r: 0 } }],
      [{ id: "gate", definitionId: "gate", coord: { q: 1.5, r: 0 } }],
      [{ id: "gate", definitionId: "gate", coord: { q: 1, r: 0 }, extra: true }],
      Object.assign(new Array(2), { 1: objects()[0] })
    ]) expect(() => normalize(malformed)).toThrow(/destruct|placement|duplicate|coordinate|bounds|field|dense/i);

    let reads = 0;
    const accessor = objects()[0]!;
    Object.defineProperty(accessor, "definitionId", {
      enumerable: true, get() { reads += 1; throw new Error("must not execute"); }
    });
    expect(() => normalize([accessor])).toThrow(/accessor|data|inspect|definition/i);
    expect(reads).toBe(0);
    const proxy = new Proxy([], { getOwnPropertyDescriptor() { throw new Error("hostile list"); } });
    expect(() => normalize(proxy)).toThrow(/inspect|destruct|placement|array/i);
  });

  it("accepts exactly 4096 placements, rejects 4097, enforces 128-byte IDs, and keeps absence exact", () => {
    const exact = Array.from({ length: 4_096 }, (_, index) => ({
      id: `object_${index}`, definitionId: "gate", coord: { q: index, r: 0 }
    }));
    expect(normalize(exact, 4_096, 1)).toHaveLength(4_096);
    expect(() => normalize(new Array(4_097), 4_097, 1)).toThrow(/4096|limit|placements/i);
    expect(() => normalize([{
      id: "x".repeat(129), definitionId: "gate", coord: { q: 0, r: 0 }
    }], 1, 1)).toThrow(/128|identifier|UTF-8/i);
    expect(normalize(undefined)).toEqual([]);
    const legacy = GridMap.fromDefinition(definition());
    const getter = (legacy as unknown as { getDestructibleObjects?: () => any[] }).getDestructibleObjects;
    expect(getter).toBeTypeOf("function");
    expect(getter!.call(legacy)).toEqual([]);
  });
});
