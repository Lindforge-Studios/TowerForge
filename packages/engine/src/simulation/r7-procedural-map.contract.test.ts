import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";

type MapGenerationSpecV1 = {
  readonly schemaVersion: 1;
  readonly mapId: string;
  readonly seed: string;
  readonly grid: { readonly kind: "square"; readonly adjacency: "cardinal" }
    | { readonly kind: "hex"; readonly layout: "odd-r" };
  readonly width: number;
  readonly height: number;
  readonly entrances: number;
  readonly loops: number;
  readonly terrain: {
    readonly buildable: string;
    readonly path: string;
    readonly blocked: string;
  };
  readonly buildableRatio: { readonly min: number; readonly max: number };
};

type GeneratedMap = {
  readonly schemaVersion: 1;
  readonly spec: MapGenerationSpecV1;
  readonly source: {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly gridKind: "square" | "hex";
    readonly spawnCoord: { readonly q: number; readonly r: number };
    readonly coreCoord: { readonly q: number; readonly r: number };
    readonly pathCenterline: readonly { readonly q: number; readonly r: number }[];
    readonly pathRoutes: readonly {
      readonly id: string;
      readonly pathCenterline: readonly { readonly q: number; readonly r: number }[];
    }[];
    readonly terrainOverrides: readonly { readonly q: number; readonly r: number; readonly terrain: string }[];
  };
  readonly evidence: {
    readonly reachable: boolean;
    readonly entranceCount: number;
    readonly loopCount: number;
    readonly buildableRatio: number;
    readonly tilesetTerrainIds: readonly string[];
    readonly structuralSmoke: { readonly contract: "generated_map_structure_v1"; readonly ok: boolean };
  };
};

function proceduralMapGenerator(): (input: MapGenerationSpecV1) => GeneratedMap {
  const generate = (Engine as unknown as {
    generateProceduralMap?: (input: MapGenerationSpecV1) => GeneratedMap;
  }).generateProceduralMap;
  expect(generate, "R7 map generation must be a pure seeded engine contract")
    .toBeTypeOf("function");
  return generate!;
}

function generateProceduralMap(spec: MapGenerationSpecV1): GeneratedMap {
  return proceduralMapGenerator()(spec);
}

function terrainCycleRank(generated: GeneratedMap, pathTerrain: string): number {
  const topology = Engine.createGridTopology(generated.spec.grid);
  const vertices = new Set(generated.source.terrainOverrides
    .filter((tile) => tile.terrain === pathTerrain)
    .map((tile) => `${tile.q},${tile.r}`));
  let edges = 0;
  for (const key of vertices) {
    const [q, r] = key.split(",").map(Number);
    for (const neighbor of topology.neighbors({ q: q!, r: r! })) {
      const other = `${neighbor.q},${neighbor.r}`;
      if (vertices.has(other) && key < other) edges += 1;
    }
  }
  let components = 0;
  const remaining = new Set(vertices);
  while (remaining.size > 0) {
    components += 1;
    const queue = [remaining.values().next().value as string];
    remaining.delete(queue[0]!);
    while (queue.length > 0) {
      const key = queue.shift()!;
      const [q, r] = key.split(",").map(Number);
      for (const neighbor of topology.neighbors({ q: q!, r: r! })) {
        const other = `${neighbor.q},${neighbor.r}`;
        if (remaining.delete(other)) queue.push(other);
      }
    }
  }
  return edges - vertices.size + components;
}

const SPEC: MapGenerationSpecV1 = {
  schemaVersion: 1,
  mapId: "snow_canyon",
  seed: "snow-canyon:two-entrances:v1",
  grid: { kind: "square", adjacency: "cardinal" },
  width: 14,
  height: 10,
  entrances: 2,
  loops: 1,
  terrain: { buildable: "snow", path: "road", blocked: "cliff" },
  buildableRatio: { min: 0.35, max: 0.75 }
};

describe("R7 procedural MapGenerationSpec", () => {
  it("generates canonical byte-identical output and complete acceptance evidence from a seed", () => {
    const first = generateProceduralMap(SPEC);
    const second = generateProceduralMap(structuredClone(SPEC));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.spec).toEqual(SPEC);
    expect(first.source).toMatchObject({
      id: "snow_canyon",
      width: 14,
      height: 10,
      gridKind: "square"
    });
    expect(first.source.pathCenterline.length).toBeGreaterThan(1);
    expect(first.source.pathRoutes).toHaveLength(2);
    expect(first.evidence).toMatchObject({
      reachable: true,
      entranceCount: 2,
      loopCount: 1,
      tilesetTerrainIds: ["cliff", "road", "snow"],
      structuralSmoke: { contract: "generated_map_structure_v1", ok: true }
    });
    expect(first.evidence.buildableRatio).toBeGreaterThanOrEqual(SPEC.buildableRatio.min);
    expect(first.evidence.buildableRatio).toBeLessThanOrEqual(SPEC.buildableRatio.max);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.source)).toBe(true);
    expect(Object.isFrozen(first.evidence)).toBe(true);
  });

  it("rejects malformed, future-version, and impossible specs without partial output", () => {
    const generate = proceduralMapGenerator();
    const invalid = [
      { ...SPEC, schemaVersion: 2 },
      { ...SPEC, entrances: 0 },
      { ...SPEC, width: 3, height: 3, entrances: 8 },
      { ...SPEC, buildableRatio: { min: 0.9, max: 0.1 } }
    ];
    for (const candidate of invalid) {
      expect(() => generate(candidate as MapGenerationSpecV1)).toThrow();
    }
  });

  it("rejects accessors and non-plain generation specs without invoking authored code", () => {
    const generate = proceduralMapGenerator();
    let invoked = false;
    const accessor = { ...SPEC } as Record<string, unknown>;
    Object.defineProperty(accessor, "seed", {
      enumerable: true,
      get() {
        invoked = true;
        return "unsafe";
      }
    });
    expect(() => generate(accessor as unknown as MapGenerationSpecV1)).toThrow(/plain|data|accessor|inspect/i);
    expect(invoked).toBe(false);
    expect(() => generate(Object.assign(Object.create({ inherited: true }), SPEC))).toThrow(/plain|prototype/i);
  });

  it.each([
    ["square", { kind: "square", adjacency: "cardinal" }],
    ["hex", { kind: "hex", layout: "odd-r" }]
  ] as const)("emits compiler-valid adjacent %s route segments", (_label, grid) => {
    const generated = generateProceduralMap({ ...SPEC, grid });
    const topology = Engine.createGridTopology(grid);
    for (const route of generated.source.pathRoutes) {
      expect(route.pathCenterline[0]).toEqual(expect.objectContaining({ q: 0 }));
      expect(route.pathCenterline.at(-1)).toEqual(generated.source.coreCoord);
      for (let index = 1; index < route.pathCenterline.length; index += 1) {
        expect(topology.distance(route.pathCenterline[index - 1]!, route.pathCenterline[index]!)).toBe(1);
      }
    }
  });

  it.each([
    ["square", { kind: "square", adjacency: "cardinal" }],
    ["hex", { kind: "hex", layout: "odd-r" }]
  ] as const)("materializes requested %s loop corridors in the emitted terrain graph", (_label, grid) => {
    const generated = generateProceduralMap({ ...SPEC, grid, entrances: 1, loops: 2 });
    expect(terrainCycleRank(generated, SPEC.terrain.path)).toBeGreaterThanOrEqual(2);
    expect(generated.evidence.loopCount).toBe(2);
  });
});
