import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import type { GridCoord, GridDefinition, TerrainTypeDefinition } from "./types.js";

interface MovementProfileV1Fixture {
  readonly label: string;
  readonly terrainMode: "respect_walkable" | "ignore_walkable";
  readonly towerOccupancy: "blocked" | "ignored";
  readonly defaultTerrainCost: number | null;
  readonly terrainCosts?: Readonly<Record<string, number | null>>;
}

interface NavigationFieldRequestFixture {
  readonly grid: GridDefinition;
  readonly width: number;
  readonly height: number;
  readonly movementProfileId: string;
  readonly goal: GridCoord;
  readonly profile: MovementProfileV1Fixture;
  readonly terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>;
  readonly terrainByCoord: Readonly<Record<string, string>>;
  readonly occupiedCoords: readonly GridCoord[];
  readonly budget?: {
    readonly maxCells?: number;
    readonly maxRelaxations?: number;
  };
}

interface NavigationFieldCellFixture {
  readonly coord: GridCoord;
  readonly distance: number;
  readonly nextCoord?: GridCoord;
}

interface NavigationFieldResultFixture {
  readonly movementProfileId: string;
  readonly goal: GridCoord;
  readonly cells: readonly NavigationFieldCellFixture[];
  readonly stats: { readonly relaxations: number };
}

type NavigationFieldBuilder = (
  request: NavigationFieldRequestFixture
) => NavigationFieldResultFixture;

function buildNavigationField(request: NavigationFieldRequestFixture): NavigationFieldResultFixture {
  const build = (Engine as unknown as { buildNavigationField?: NavigationFieldBuilder }).buildNavigationField;
  expect(build, "R2.1 must export the pure buildNavigationField contract from the engine")
    .toBeTypeOf("function");
  return build!(request);
}

const TERRAIN_TYPES: Readonly<Record<string, TerrainTypeDefinition>> = Object.freeze({
  floor: Object.freeze({
    id: "floor",
    label: "Floor",
    buildable: true,
    walkable: true,
    groundSpeedMultiplier: 1,
    tags: []
  }),
  mud: Object.freeze({
    id: "mud",
    label: "Mud",
    buildable: true,
    walkable: true,
    groundSpeedMultiplier: 0.5,
    tags: ["slow"]
  }),
  rock: Object.freeze({
    id: "rock",
    label: "Rock",
    buildable: false,
    walkable: false,
    groundSpeedMultiplier: 0,
    tags: ["blocked"]
  })
});

const SOLVER_TERRAIN_INPUT_LIMITS = Object.freeze({
  definitions: 256,
  tagsPerDefinition: 64,
  tagsAcrossDefinitions: 8_192,
  tagUtf8Bytes: 128,
  labelLength: 128
});

function terrainDefinition(
  id: string,
  tags: readonly string[] = [],
  label = id
): TerrainTypeDefinition {
  return {
    id,
    label,
    buildable: true,
    walkable: true,
    groundSpeedMultiplier: 1,
    tags: [...tags]
  };
}

const GROUND_PROFILE: MovementProfileV1Fixture = Object.freeze({
  label: "Ground",
  terrainMode: "respect_walkable",
  towerOccupancy: "blocked",
  defaultTerrainCost: 1_000
});

function coordKey(coord: GridCoord): string {
  return `${coord.q},${coord.r}`;
}

function terrainGrid(
  width: number,
  height: number,
  overrides: Readonly<Record<string, string>> = {}
): Record<string, string> {
  return Object.fromEntries(Array.from({ length: height }, (_, r) => (
    Array.from({ length: width }, (_, q) => {
      const key = coordKey({ q, r });
      return [key, overrides[key] ?? "floor"] as const;
    })
  )).flat());
}

function request(
  overrides: Partial<NavigationFieldRequestFixture> = {}
): NavigationFieldRequestFixture {
  const width = overrides.width ?? 3;
  const height = overrides.height ?? 3;
  return {
    grid: { kind: "square", adjacency: "cardinal" },
    width,
    height,
    movementProfileId: "ground",
    goal: { q: width - 1, r: 1 },
    profile: GROUND_PROFILE,
    terrainTypes: TERRAIN_TYPES,
    terrainByCoord: terrainGrid(width, height),
    occupiedCoords: [],
    ...overrides
  };
}

function reverseRecord<T>(value: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).reverse());
}

function cellAt(result: NavigationFieldResultFixture, q: number, r: number): NavigationFieldCellFixture | undefined {
  return result.cells.find((cell) => cell.coord.q === q && cell.coord.r === r);
}

function assertCanonicalAcyclicField(
  result: NavigationFieldResultFixture,
  grid: GridDefinition
): void {
  const topology = Engine.createGridTopology(grid);
  const byCoord = new Map(result.cells.map((cell) => [coordKey(cell.coord), cell]));
  const canonical = [...result.cells].sort((left, right) => (
    left.coord.r - right.coord.r || left.coord.q - right.coord.q
  ));
  expect(result.cells).toEqual(canonical);
  expect(new Set(result.cells.map((cell) => coordKey(cell.coord))).size).toBe(result.cells.length);
  for (const cell of result.cells) {
    expect(Number.isSafeInteger(cell.distance)).toBe(true);
    expect(cell.distance).toBeGreaterThanOrEqual(0);
    if (!cell.nextCoord) {
      expect(cell.coord).toEqual(result.goal);
      expect(cell.distance).toBe(0);
      continue;
    }
    expect(topology.distance(cell.coord, cell.nextCoord)).toBe(1);
    expect(byCoord.get(coordKey(cell.nextCoord))?.distance).toBeLessThan(cell.distance);
  }
}

describe("R2.1 pure reverse-Dijkstra navigation field", () => {
  it("builds the canonical square golden and resolves equal paths by topology direction index", () => {
    const candidate = request();
    const result = buildNavigationField(candidate);

    expect(result).toMatchObject({
      movementProfileId: "ground",
      goal: { q: 2, r: 1 },
      cells: [
        { coord: { q: 0, r: 0 }, distance: 3_000, nextCoord: { q: 1, r: 0 } },
        { coord: { q: 1, r: 0 }, distance: 2_000, nextCoord: { q: 2, r: 0 } },
        { coord: { q: 2, r: 0 }, distance: 1_000, nextCoord: { q: 2, r: 1 } },
        { coord: { q: 0, r: 1 }, distance: 2_000, nextCoord: { q: 1, r: 1 } },
        { coord: { q: 1, r: 1 }, distance: 1_000, nextCoord: { q: 2, r: 1 } },
        { coord: { q: 2, r: 1 }, distance: 0 },
        { coord: { q: 0, r: 2 }, distance: 3_000, nextCoord: { q: 0, r: 1 } },
        { coord: { q: 1, r: 2 }, distance: 2_000, nextCoord: { q: 1, r: 1 } },
        { coord: { q: 2, r: 2 }, distance: 1_000, nextCoord: { q: 2, r: 1 } }
      ]
    });
    expect(Number.isSafeInteger(result.stats.relaxations)).toBe(true);
    expect(result.stats.relaxations).toBeGreaterThan(0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.cells)).toBe(true);
    expect(result.cells.every(Object.isFrozen)).toBe(true);
    assertCanonicalAcyclicField(result, candidate.grid);
  });

  it("builds the odd-r hex golden and uses NW/NE/W/E/SW/SE tie order", () => {
    const candidate = request({
      grid: { kind: "hex", layout: "odd-r" },
      width: 3,
      height: 2,
      goal: { q: 2, r: 0 },
      terrainByCoord: terrainGrid(3, 2)
    });
    const result = buildNavigationField(candidate);

    expect(result.cells).toEqual([
      { coord: { q: 0, r: 0 }, distance: 2_000, nextCoord: { q: 1, r: 0 } },
      { coord: { q: 1, r: 0 }, distance: 1_000, nextCoord: { q: 2, r: 0 } },
      { coord: { q: 2, r: 0 }, distance: 0 },
      { coord: { q: 0, r: 1 }, distance: 2_000, nextCoord: { q: 1, r: 0 } },
      { coord: { q: 1, r: 1 }, distance: 1_000, nextCoord: { q: 2, r: 0 } },
      { coord: { q: 2, r: 1 }, distance: 1_000, nextCoord: { q: 2, r: 0 } }
    ]);
    assertCanonicalAcyclicField(result, candidate.grid);
  });

  it("is byte-stable under terrain, occupancy, and record insertion permutations and never uses Math.random", () => {
    const base = request({
      width: 4,
      height: 3,
      goal: { q: 3, r: 1 },
      profile: {
        ...GROUND_PROFILE,
        terrainCosts: { mud: 3_000, floor: 1_000 }
      },
      terrainByCoord: terrainGrid(4, 3, { "1,0": "mud", "2,2": "rock" }),
      occupiedCoords: [{ q: 1, r: 1 }, { q: 2, r: 1 }]
    });
    const permuted = request({
      ...base,
      profile: {
        ...base.profile,
        terrainCosts: reverseRecord(base.profile.terrainCosts ?? {})
      },
      terrainTypes: reverseRecord(base.terrainTypes),
      terrainByCoord: reverseRecord(base.terrainByCoord),
      occupiedCoords: [...base.occupiedCoords].reverse()
    });
    const beforeBase = structuredClone(base);
    const beforePermuted = structuredClone(permuted);
    const originalRandom = Math.random;
    Math.random = () => {
      throw new Error("buildNavigationField must not use Math.random");
    };

    try {
      expect(JSON.stringify(buildNavigationField(base))).toBe(JSON.stringify(buildNavigationField(permuted)));
    } finally {
      Math.random = originalRandom;
    }
    expect(base).toEqual(beforeBase);
    expect(permuted).toEqual(beforePermuted);
  });

  it("uses entered-tile cost and applies walkability, explicit overrides, and tower occupancy per profile", () => {
    const terrainByCoord = terrainGrid(3, 2, { "1,0": "mud" });
    const expensiveMud = buildNavigationField(request({
      width: 3,
      height: 2,
      goal: { q: 2, r: 0 },
      terrainByCoord,
      profile: { ...GROUND_PROFILE, terrainCosts: { mud: 5_000 } }
    }));
    expect(cellAt(expensiveMud, 0, 0)).toEqual({
      coord: { q: 0, r: 0 },
      distance: 4_000,
      nextCoord: { q: 0, r: 1 }
    });

    const rockGrid = terrainGrid(3, 2, { "1,0": "rock" });
    const respectingWalkability = buildNavigationField(request({
      width: 3,
      height: 2,
      goal: { q: 2, r: 0 },
      terrainByCoord: rockGrid
    }));
    expect(cellAt(respectingWalkability, 1, 0)).toBeUndefined();
    expect(cellAt(respectingWalkability, 0, 0)?.nextCoord).toEqual({ q: 0, r: 1 });

    const explicitRockOverride = buildNavigationField(request({
      width: 3,
      height: 2,
      goal: { q: 2, r: 0 },
      terrainByCoord: rockGrid,
      profile: { ...GROUND_PROFILE, terrainCosts: { rock: 900 } }
    }));
    expect(cellAt(explicitRockOverride, 0, 0)?.nextCoord).toEqual({ q: 1, r: 0 });
    expect(cellAt(explicitRockOverride, 1, 0)?.distance).toBe(1_000);

    const occupied = [{ q: 1, r: 0 }];
    const blockedByTower = buildNavigationField(request({
      width: 3,
      height: 2,
      goal: { q: 2, r: 0 },
      terrainByCoord: terrainGrid(3, 2),
      occupiedCoords: occupied
    }));
    expect(cellAt(blockedByTower, 1, 0)).toBeUndefined();
    expect(cellAt(blockedByTower, 0, 0)?.nextCoord).toEqual({ q: 0, r: 1 });

    const ignoresTowerAndWalkability = buildNavigationField(request({
      width: 3,
      height: 2,
      goal: { q: 2, r: 0 },
      terrainByCoord: rockGrid,
      occupiedCoords: occupied,
      profile: {
        ...GROUND_PROFILE,
        terrainMode: "ignore_walkable",
        towerOccupancy: "ignored"
      }
    }));
    expect(cellAt(ignoresTowerAndWalkability, 0, 0)?.nextCoord).toEqual({ q: 1, r: 0 });
  });

  it("fails the whole field on cell/relaxation budget overflow", () => {
    expect(() => buildNavigationField(request({
      width: 3,
      height: 2,
      goal: { q: 2, r: 0 },
      terrainByCoord: terrainGrid(3, 2),
      budget: { maxCells: 5, maxRelaxations: 100 }
    }))).toThrow(/budget|cells|5/i);

    expect(() => buildNavigationField(request({
      width: 3,
      height: 2,
      goal: { q: 2, r: 0 },
      terrainByCoord: terrainGrid(3, 2),
      budget: { maxCells: 6, maxRelaxations: 1 }
    }))).toThrow(/budget|relaxation|1/i);

    expect(() => buildNavigationField(request({
      width: 257,
      height: 256,
      goal: { q: 0, r: 0 },
      terrainByCoord: {},
      budget: undefined
    }))).toThrow(/65,?536|budget|cells|dimensions/i);
  });

  it("rejects hostile/non-JSON terrain and occupancy shapes without invoking accessors or leaking payloads", () => {
    let getterCalls = 0;
    const hostileTerrain = Object.defineProperty({}, "0,0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("SECRET_TERRAIN_ACCESSOR_PAYLOAD");
      }
    }) as Record<string, string>;
    let caught: unknown;
    try {
      buildNavigationField(request({
        width: 1,
        height: 1,
        goal: { q: 0, r: 0 },
        terrainByCoord: hostileTerrain
      }));
    } catch (error) {
      caught = error;
    }
    expect(getterCalls).toBe(0);
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain("SECRET_TERRAIN_ACCESSOR_PAYLOAD");

    const inheritedTerrain = Object.assign(Object.create({ "0,0": "floor" }), {
      "1,0": "floor"
    });
    expect(() => buildNavigationField(request({
      width: 2,
      height: 1,
      goal: { q: 1, r: 0 },
      terrainByCoord: inheritedTerrain
    }))).toThrow(/plain object|prototype|own data|terrain/i);

    const sparseOccupancy = new Array(1) as GridCoord[];
    expect(() => buildNavigationField(request({ occupiedCoords: sparseOccupancy })))
      .toThrow(/array|sparse|occup|coordinate|own data/i);

    for (const cost of [0, 1.5, Number.NaN, 1_000_001]) {
      expect(() => buildNavigationField(request({
        profile: { ...GROUND_PROFILE, defaultTerrainCost: cost }
      }))).toThrow(/cost|integer|finite|1,?000,?000|range/i);
    }
  });

  it("bounds terrain definitions, labels, tag counts, total tags, and tag UTF-8 bytes before field work", () => {
    const tooManyDefinitions = Object.fromEntries(Array.from(
      { length: SOLVER_TERRAIN_INPUT_LIMITS.definitions + 1 },
      (_, index) => {
        const id = index === 0 ? "floor" : `terrain_${index}`;
        return [id, terrainDefinition(id)] as const;
      }
    ));
    expect.soft(() => buildNavigationField(request({ terrainTypes: tooManyDefinitions })))
      .toThrow(/terrainTypes|definition|256|budget|limit|maximum/i);

    const excessiveLabel = "L".repeat(SOLVER_TERRAIN_INPUT_LIMITS.labelLength + 1);
    expect.soft(() => buildNavigationField(request({
      terrainTypes: { floor: terrainDefinition("floor", [], excessiveLabel) }
    }))).toThrow(/terrainTypes|label|128|budget|limit|maximum/i);

    const excessiveTags = Array.from(
      { length: SOLVER_TERRAIN_INPUT_LIMITS.tagsPerDefinition + 1 },
      (_, index) => `tag_${index}`
    );
    expect.soft(() => buildNavigationField(request({
      terrainTypes: { floor: terrainDefinition("floor", excessiveTags) }
    }))).toThrow(/terrainTypes|tags|64|budget|limit|maximum/i);

    const definitionsWithTooManyTotalTags = Object.fromEntries(Array.from(
      { length: 129 },
      (_, terrainIndex) => {
        const id = terrainIndex === 0 ? "floor" : `terrain_${terrainIndex}`;
        const tags = Array.from(
          { length: SOLVER_TERRAIN_INPUT_LIMITS.tagsPerDefinition },
          (_, tagIndex) => `t${terrainIndex}_${tagIndex}`
        );
        return [id, terrainDefinition(id, tags)] as const;
      }
    ));
    expect.soft(() => buildNavigationField(request({ terrainTypes: definitionsWithTooManyTotalTags })))
      .toThrow(/terrainTypes|tags|8,?192|total|budget|limit|maximum/i);

    const overlongUtf8Tag = "é".repeat(Math.floor(SOLVER_TERRAIN_INPUT_LIMITS.tagUtf8Bytes / 2) + 1);
    expect.soft(() => buildNavigationField(request({
      terrainTypes: { floor: terrainDefinition("floor", [overlongUtf8Tag]) }
    }))).toThrow(/terrainTypes|tag|128|UTF-?8|byte|budget|limit|maximum/i);
  });

  it("rejects an oversized terrain tag array before inspecting any tag elements", () => {
    let inspectedTagElements = 0;
    const tags = new Proxy(
      Array.from(
        { length: SOLVER_TERRAIN_INPUT_LIMITS.tagsPerDefinition + 1 },
        (_, index) => `tag_${index}`
      ),
      {
        getOwnPropertyDescriptor(target, property) {
          if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
            inspectedTagElements += 1;
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        }
      }
    );
    const terrainTypes: Readonly<Record<string, TerrainTypeDefinition>> = {
      floor: {
        id: "floor",
        label: "Floor",
        buildable: true,
        walkable: true,
        groundSpeedMultiplier: 1,
        tags
      }
    };

    expect(() => buildNavigationField(request({ terrainTypes })))
      .toThrow(/terrainTypes|tags|64|budget|limit|maximum/i);
    expect(inspectedTagElements).toBe(0);
  });
});
