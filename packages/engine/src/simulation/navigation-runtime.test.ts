import { describe, expect, it, vi } from "vitest";
import * as Engine from "../index.js";
import type { DynamicFlowNavigationProfileV1 } from "../content/navigation-mechanics.js";
import type { NavigationFieldResult } from "./navigation-field.js";
import type { GridCoord, GridDefinition, GridPathRoute, TerrainTypeDefinition } from "./types.js";

interface NavigationResolverRequestFixture {
  readonly grid: GridDefinition;
  readonly width: number;
  readonly height: number;
  readonly profile: DynamicFlowNavigationProfileV1;
  readonly terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>;
  readonly terrainByCoord: Readonly<Record<string, string>>;
  readonly occupiedCoords: readonly GridCoord[];
  readonly routes: readonly GridPathRoute[];
}

interface NavigationResolverStatsFixture {
  readonly fieldBuildCount: number;
  readonly fieldQueryCount: number;
  readonly generation: number;
}

interface NavigationResolverFixture {
  getField(movementProfileId: string, routeId: string): NavigationFieldResult;
  updateTerrainByCoord(terrainByCoord: Readonly<Record<string, string>>): boolean;
  updateOccupiedCoords(occupiedCoords: readonly GridCoord[]): boolean;
  updateRoutes(routes: readonly GridPathRoute[]): boolean;
  getStats(): NavigationResolverStatsFixture;
}

interface NavigationResolverConstructorFixture {
  new(request: NavigationResolverRequestFixture): NavigationResolverFixture;
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

const DYNAMIC_PROFILE: DynamicFlowNavigationProfileV1 = Object.freeze({
  mode: "dynamic_flow",
  defaultMovementProfileId: "ground",
  movementProfiles: Object.freeze({
    air: Object.freeze({
      label: "Air",
      terrainMode: "ignore_walkable",
      towerOccupancy: "ignored",
      defaultTerrainCost: 1_000
    }),
    ground: Object.freeze({
      label: "Ground",
      terrainMode: "respect_walkable",
      towerOccupancy: "blocked",
      defaultTerrainCost: 1_000,
      terrainCosts: Object.freeze({ floor: 1_000, mud: 3_000 })
    })
  }),
  enemyMovementProfiles: Object.freeze({ drone: "air", grunt: "ground" })
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

function routes(): GridPathRoute[] {
  return [
    {
      id: "route_a",
      pathCenterline: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 2, r: 0 },
        { q: 3, r: 0 },
        { q: 4, r: 0 },
        { q: 4, r: 1 }
      ]
    },
    {
      id: "route_b",
      pathCenterline: [
        { q: 0, r: 2 },
        { q: 1, r: 2 },
        { q: 2, r: 2 },
        { q: 3, r: 2 },
        { q: 4, r: 2 },
        { q: 4, r: 1 }
      ]
    },
    {
      id: "route_c",
      pathCenterline: [
        { q: 0, r: 1 },
        { q: 1, r: 1 },
        { q: 2, r: 1 },
        { q: 3, r: 1 },
        { q: 4, r: 1 },
        { q: 4, r: 2 }
      ]
    }
  ];
}

function resolverRequest(
  overrides: Partial<NavigationResolverRequestFixture> = {}
): NavigationResolverRequestFixture {
  return {
    grid: { kind: "square", adjacency: "cardinal" },
    width: 5,
    height: 3,
    profile: DYNAMIC_PROFILE,
    terrainTypes: TERRAIN_TYPES,
    terrainByCoord: terrainGrid(5, 3),
    occupiedCoords: [{ q: 2, r: 0 }, { q: 2, r: 2 }],
    routes: routes(),
    ...overrides
  };
}

function createResolver(
  overrides: Partial<NavigationResolverRequestFixture> = {}
): NavigationResolverFixture {
  const Resolver = (Engine as unknown as {
    NavigationResolver?: NavigationResolverConstructorFixture;
  }).NavigationResolver;
  expect(Resolver, "R2.2 must export NavigationResolver from the pure engine")
    .toBeTypeOf("function");
  return new Resolver!(resolverRequest(overrides));
}

function reverseRecord<T>(value: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).reverse());
}

function cloneRoutes(value: readonly GridPathRoute[]): GridPathRoute[] {
  return value.map((route) => ({
    id: route.id,
    pathCenterline: route.pathCenterline.map((coord) => ({ ...coord }))
  }));
}

describe("R2.2 NavigationResolver shared field cache", () => {
  it("keys fields by movement profile and numeric goal, so same-goal route aliases share one object", () => {
    const resolver = createResolver();
    expect(resolver.getStats()).toEqual({
      fieldBuildCount: 0,
      fieldQueryCount: 0,
      generation: 0
    });

    const groundA = resolver.getField("ground", "route_a");
    const groundB = resolver.getField("ground", "route_b");
    expect(groundB).toBe(groundA);
    expect(groundB.goal).toEqual({ q: 4, r: 1 });

    const airA = resolver.getField("air", "route_a");
    const groundC = resolver.getField("ground", "route_c");
    expect(airA).not.toBe(groundA);
    expect(groundC).not.toBe(groundA);
    expect(groundC.goal).toEqual({ q: 4, r: 2 });
    expect(resolver.getStats()).toMatchObject({
      fieldBuildCount: 3,
      fieldQueryCount: 4
    });
  });

  it.each([500, 1_000])("serves %i enemy-style queries from one field build without time assertions", (queries) => {
    const resolver = createResolver({ occupiedCoords: [] });
    let shared: NavigationFieldResult | undefined;
    for (let index = 0; index < queries; index += 1) {
      const field = resolver.getField("ground", index % 2 === 0 ? "route_a" : "route_b");
      shared ??= field;
      expect(field).toBe(shared);
    }

    const digestBeforeStatsReads = Engine.stableDigest(shared);
    const stats = resolver.getStats();
    expect(stats).toMatchObject({ fieldBuildCount: 1, fieldQueryCount: queries });
    expect(Number.isSafeInteger(stats.generation)).toBe(true);
    expect(Object.isFrozen(stats)).toBe(true);
    expect(resolver.getStats()).toEqual(stats);
    expect(Engine.stableDigest(shared)).toBe(digestBeforeStatsReads);
    expect(shared).not.toHaveProperty("fieldBuildCount");
    expect(shared).not.toHaveProperty("fieldQueryCount");
    expect(shared).not.toHaveProperty("generation");
  });

  it("treats reordered but identical terrain, occupancy, and route inputs as clean no-ops", () => {
    const initial = resolverRequest();
    const resolver = createResolver(initial);
    const field = resolver.getField("ground", "route_a");
    const before = resolver.getStats();

    expect(resolver.updateTerrainByCoord(reverseRecord(initial.terrainByCoord))).toBe(false);
    expect(resolver.updateOccupiedCoords([...initial.occupiedCoords].reverse())).toBe(false);
    expect(resolver.updateRoutes(cloneRoutes(initial.routes).reverse())).toBe(false);
    expect(resolver.getStats()).toEqual(before);

    expect(resolver.getField("ground", "route_a")).toBe(field);
    expect(resolver.getStats()).toEqual({
      ...before,
      fieldQueryCount: before.fieldQueryCount + 1
    });
  });

  it("treats route interiors as non-runtime data and inspects only first/last endpoints", () => {
    const initialRoutes = routes();
    const resolver = createResolver({ routes: initialRoutes });
    const installed = resolver.getField("ground", "route_a");
    const before = resolver.getStats();
    const changedInterior = cloneRoutes(initialRoutes);
    changedInterior[0]!.pathCenterline[2] = { q: 0, r: 2 };

    expect.soft(resolver.updateRoutes(changedInterior)).toBe(false);
    expect.soft(resolver.getStats()).toEqual(before);
    expect.soft(resolver.getField("ground", "route_a")).toBe(installed);

    let enumeratedCenterlineKeys = 0;
    let inspectedElements = 0;
    const longCenterline = new Proxy(
      Array.from({ length: 4_096 }, (_, index) => (
        index === 0
          ? { q: 0, r: 0 }
          : index === 4_095
            ? { q: 4, r: 1 }
            : { q: 2, r: 1 }
      )),
      {
        ownKeys(target) {
          enumeratedCenterlineKeys += 1;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, property) {
          if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
            inspectedElements += 1;
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        }
      }
    );
    const endpointOnly = createResolver({
      routes: [{ id: "route_a", pathCenterline: longCenterline }]
    });
    expect.soft(endpointOnly.getField("ground", "route_a").goal).toEqual({ q: 4, r: 1 });
    expect.soft(enumeratedCenterlineKeys).toBe(0);
    expect.soft(inspectedElements).toBeLessThanOrEqual(2);
  });

  it("retains cached fields when a new route is only a same-goal alias", () => {
    const initialRoutes = routes();
    const resolver = createResolver({ routes: initialRoutes });
    const installed = resolver.getField("ground", "route_a");
    const before = resolver.getStats();
    const alias: GridPathRoute = {
      id: "route_alias",
      pathCenterline: [{ q: 0, r: 1 }, { q: 4, r: 1 }]
    };

    expect(resolver.updateRoutes([...initialRoutes, alias])).toBe(true);
    expect(resolver.getField("ground", "route_alias")).toBe(installed);
    expect(resolver.getStats().fieldBuildCount).toBe(before.fieldBuildCount);
  });

  it("retains fields for unchanged numeric goals when another route endpoint changes", () => {
    const changedRoutes = cloneRoutes(routes());
    changedRoutes[2]!.pathCenterline[changedRoutes[2]!.pathCenterline.length - 1] = { q: 4, r: 0 };
    const resolver = createResolver();
    const unchangedGoal = resolver.getField("ground", "route_a");
    const oldChangedGoal = resolver.getField("ground", "route_c");
    const before = resolver.getStats();

    expect(resolver.updateRoutes(changedRoutes)).toBe(true);
    expect.soft(resolver.getField("ground", "route_a")).toBe(unchangedGoal);
    expect.soft(resolver.getField("ground", "route_c")).not.toBe(oldChangedGoal);
    expect.soft(resolver.getStats().fieldBuildCount).toBe(before.fieldBuildCount + 1);
  });

  it("invalidates occupancy-sensitive fields without rebuilding ignored-occupancy profiles", () => {
    const resolver = createResolver({ occupiedCoords: [] });
    const ground = resolver.getField("ground", "route_a");
    const air = resolver.getField("air", "route_a");
    const before = resolver.getStats();

    expect(resolver.updateOccupiedCoords([{ q: 1, r: 0 }])).toBe(true);
    expect(resolver.getField("air", "route_a")).toBe(air);
    expect(resolver.getField("ground", "route_a")).not.toBe(ground);
    expect(resolver.getStats().fieldBuildCount).toBe(before.fieldBuildCount + 1);
  });

  it("coalesces multiple effective terrain, occupancy, and endpoint updates until the next query", () => {
    const resolver = createResolver();
    const initial = resolver.getField("ground", "route_a");
    const beforeUpdates = resolver.getStats();
    const topology = Engine.createGridTopology({ kind: "square", adjacency: "cardinal" });
    const changedRoutes = routes().map((route) => (
      route.id === "route_a" || route.id === "route_b"
        ? {
            ...route,
            pathCenterline: topology.line(route.pathCenterline[0]!, { q: 4, r: 0 })
          }
        : route
    ));

    expect(resolver.updateTerrainByCoord(terrainGrid(5, 3, { "1,1": "mud" }))).toBe(true);
    expect(resolver.updateOccupiedCoords([{ q: 1, r: 0 }, { q: 1, r: 2 }])).toBe(true);
    expect(resolver.updateRoutes(changedRoutes)).toBe(true);
    const dirty = resolver.getStats();
    expect(dirty.fieldBuildCount).toBe(beforeUpdates.fieldBuildCount);
    expect(dirty.fieldQueryCount).toBe(beforeUpdates.fieldQueryCount);
    expect(dirty.generation).toBeGreaterThan(beforeUpdates.generation);

    const rebuiltA = resolver.getField("ground", "route_a");
    expect(rebuiltA).not.toBe(initial);
    expect(rebuiltA.goal).toEqual({ q: 4, r: 0 });
    expect(resolver.getStats()).toMatchObject({
      fieldBuildCount: beforeUpdates.fieldBuildCount + 1,
      fieldQueryCount: beforeUpdates.fieldQueryCount + 1
    });

    const rebuiltB = resolver.getField("ground", "route_b");
    expect(rebuiltB).toBe(rebuiltA);
    expect(resolver.getStats()).toMatchObject({
      fieldBuildCount: beforeUpdates.fieldBuildCount + 1,
      fieldQueryCount: beforeUpdates.fieldQueryCount + 2
    });
  });

  it("produces identical fields and digests for permuted constructor inputs", () => {
    const baselineInput = resolverRequest();
    const permutedProfile: DynamicFlowNavigationProfileV1 = {
      ...baselineInput.profile,
      movementProfiles: reverseRecord(Object.fromEntries(Object.entries(
        baselineInput.profile.movementProfiles
      ).map(([profileId, profile]) => [
        profileId,
        profile.terrainCosts === undefined
          ? { ...profile }
          : { ...profile, terrainCosts: reverseRecord(profile.terrainCosts) }
      ]))),
      enemyMovementProfiles: reverseRecord(baselineInput.profile.enemyMovementProfiles ?? {})
    };
    const permutedInput = resolverRequest({
      profile: permutedProfile,
      terrainTypes: reverseRecord(baselineInput.terrainTypes),
      terrainByCoord: reverseRecord(baselineInput.terrainByCoord),
      occupiedCoords: [...baselineInput.occupiedCoords].reverse(),
      routes: cloneRoutes(baselineInput.routes).reverse()
    });
    const baselineBefore = structuredClone(baselineInput);
    const permutedBefore = structuredClone(permutedInput);

    const baseline = createResolver(baselineInput);
    const permuted = createResolver(permutedInput);
    const baselineField = baseline.getField("ground", "route_a");
    const permutedField = permuted.getField("ground", "route_a");
    expect(permutedField).toEqual(baselineField);
    expect(Engine.stableDigest(permutedField)).toBe(Engine.stableDigest(baselineField));
    expect(permuted.getStats()).toEqual(baseline.getStats());
    expect(baselineInput).toEqual(baselineBefore);
    expect(permutedInput).toEqual(permutedBefore);
  });

  it("rejects invalid ids, hostile updates, and route-budget overflow without installing partial state", () => {
    const resolver = createResolver();
    const installed = resolver.getField("ground", "route_a");
    const before = resolver.getStats();

    expect(() => resolver.getField("missing_profile", "route_a")).toThrow(/movement profile|missing_profile|unknown/i);
    expect(() => resolver.getField("ground", "missing_route")).toThrow(/route|missing_route|unknown/i);
    const afterInvalidIds = resolver.getStats();
    expect(afterInvalidIds.fieldBuildCount).toBe(before.fieldBuildCount);
    expect(afterInvalidIds.generation).toBe(before.generation);
    expect(afterInvalidIds.fieldQueryCount).toBeGreaterThanOrEqual(before.fieldQueryCount);
    expect(afterInvalidIds.fieldQueryCount).toBeLessThanOrEqual(before.fieldQueryCount + 2);

    const getter = vi.fn(() => {
      throw new Error("SECRET_RUNTIME_TERRAIN_ACCESSOR");
    });
    const hostileTerrain = Object.defineProperty({}, "0,0", {
      enumerable: true,
      get: getter
    }) as Readonly<Record<string, string>>;
    let caught: unknown;
    try {
      resolver.updateTerrainByCoord(hostileTerrain);
    } catch (error) {
      caught = error;
    }
    expect(getter).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain("SECRET_RUNTIME_TERRAIN_ACCESSOR");
    expect(resolver.getStats()).toEqual(afterInvalidIds);

    const tooManyRoutes = Array.from({ length: 65 }, (_, index) => ({
      id: `route_${index}`,
      pathCenterline: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 2, r: 0 },
        { q: 3, r: 0 },
        { q: 4, r: 0 },
        { q: 4, r: 1 }
      ]
    }));
    expect(() => resolver.updateRoutes(tooManyRoutes)).toThrow(/64|route|budget|limit|maximum/i);
    const sparseOccupancy = new Array(1) as GridCoord[];
    expect(() => resolver.updateOccupiedCoords(sparseOccupancy)).toThrow(/sparse|dense|occup|array/i);
    expect(resolver.getStats()).toEqual(afterInvalidIds);

    expect(resolver.getField("ground", "route_a")).toBe(installed);
    expect(resolver.getStats()).toEqual({
      ...afterInvalidIds,
      fieldQueryCount: afterInvalidIds.fieldQueryCount + 1
    });
  });
});
