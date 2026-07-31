import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import type { TerraformTerrainTransitionV1 } from "../content/terraforming-mechanics.js";
import { GridMap, type GridMapDefinition } from "./map.js";
import type { GridCoord, TerrainTypeDefinition } from "./types.js";

type Source = "script" | "ability";
interface Override { q: number; r: number; terrain: string; source: Source; expiresIn?: number }
interface Operation {
  kind: "set_terrain" | "restore_terrain";
  coord: GridCoord;
  order: number;
  transitionId?: string;
  directTerrainId?: string;
  terrainSource?: Source;
  previousTerrainOverride?: Override | null;
}
interface DynamicProof { baselineAvailable: boolean; candidateAvailable: boolean; proof?: unknown }
interface Request {
  map: GridMap;
  terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>;
  transitions: Readonly<Record<string, TerraformTerrainTransitionV1>>;
  runtimeOverrides: ReadonlyMap<string, Override>;
  operations: readonly Operation[];
  navigation:
    | { mode: "authored_routes" }
    | { mode: "dynamic_flow"; prove: (candidate: ReadonlyMap<string, string>) => DynamicProof };
}
interface Prepared { readonly __opaque?: never }
interface Adoption {
  readonly writes: readonly { readonly coord: GridCoord; readonly terrain: string }[];
  readonly runtimeOverrides: readonly Override[];
  readonly events: readonly { readonly order: number; readonly event: Record<string, unknown> }[];
  readonly navigationProof?: unknown;
}
interface Api {
  preparePersistentTerrainTransaction(request: Request): Prepared;
  adoptPersistentTerrainTransaction(
    prepared: Prepared,
    publish: (adoption: Adoption) => void
  ): { readonly adopted: boolean };
}

const INTERNAL_PATH = "./persistent-terrain-transaction.js";

async function api(): Promise<Api> {
  let loaded: Record<string, unknown> = {};
  try {
    loaded = await import(INTERNAL_PATH) as Record<string, unknown>;
  } catch {
    // Expected pre-production RED: keep individual permanent contracts visible to Vitest.
  }
  expect(loaded.preparePersistentTerrainTransaction, "R13.4c2 internal prepare kernel")
    .toBeTypeOf("function");
  expect(loaded.adoptPersistentTerrainTransaction, "R13.4c2 internal one-shot adopt kernel")
    .toBeTypeOf("function");
  return loaded as unknown as Api;
}

const TERRAIN_TYPES: Readonly<Record<string, TerrainTypeDefinition>> = {
  floor: { id: "floor", label: "Floor", buildable: true, walkable: true, groundSpeedMultiplier: 1, tags: ["dry"] },
  spawn: { id: "spawn", label: "Spawn", buildable: false, walkable: true, groundSpeedMultiplier: 1, tags: ["dry"] },
  core: { id: "core", label: "Core", buildable: false, walkable: true, groundSpeedMultiplier: 1, tags: ["dry"] },
  water: { id: "water", label: "Water", buildable: false, walkable: true, groundSpeedMultiplier: 0.5, tags: ["wet"] },
  stone: { id: "stone", label: "Stone", buildable: false, walkable: true, groundSpeedMultiplier: 1, tags: ["stone"] },
  wall: { id: "wall", label: "Wall", buildable: false, walkable: false, groundSpeedMultiplier: 1, tags: ["blocked"] }
};
const TRANSITIONS = {
  flood: { fromTerrainTags: ["dry"], toTerrainId: "water" },
  dry: { fromTerrainTags: ["wet"], toTerrainId: "floor" }
} as const;

function map(options: { width?: number; height?: number; routes?: GridMapDefinition["pathRoutes"] } = {}): GridMap {
  const width = options.width ?? 5;
  const height = options.height ?? 3;
  return GridMap.fromDefinition({
    id: "persistent_transaction", width, height,
    grid: { kind: "square", adjacency: "cardinal" }, defaultTerrain: "floor",
    spawnCoord: { q: 0, r: 1 }, coreCoord: { q: width - 1, r: 1 },
    pathCenterline: Array.from({ length: width }, (_, q) => ({ q, r: 1 })),
    pathRoutes: options.routes ?? [], terrainOverrides: []
  });
}

function request(overrides: Partial<Request> = {}): Request {
  return {
    map: map(), terrainTypes: TERRAIN_TYPES, transitions: TRANSITIONS,
    runtimeOverrides: new Map(),
    operations: [{ kind: "set_terrain", coord: { q: 1, r: 0 }, transitionId: "flood", order: 0 }],
    navigation: { mode: "authored_routes" },
    ...overrides
  };
}

function fingerprint(subject: GridMap, overrides: ReadonlyMap<string, Override>): string {
  return JSON.stringify({
    tiles: [...subject.tiles.values()].map(({ q, r, terrain }) => ({ q, r, terrain })),
    overrides: [...overrides.entries()]
  });
}

function reason(error: unknown): string | undefined {
  return (error as { reasonKey?: string }).reasonKey;
}

describe("R13.4c2 internal persistent terrain transaction kernel (RED)", () => {
  it("remains internal instead of becoming an engine-index projectile/destructible surface", () => {
    expect((Engine as unknown as Record<string, unknown>).preparePersistentTerrainTransaction).toBeUndefined();
    expect((Engine as unknown as Record<string, unknown>).adoptPersistentTerrainTransaction).toBeUndefined();
  });

  it("prepares an opaque frozen candidate without mutating the map or current overrides", async () => {
    const kernel = await api();
    const input = request();
    const before = fingerprint(input.map, input.runtimeOverrides);
    const prepared = kernel.preparePersistentTerrainTransaction(input);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(fingerprint(input.map, input.runtimeOverrides)).toBe(before);
  });

  it("rejects current transition, source, bounds, timed-ownership, and override-cap failures without mutation", async () => {
    const kernel = await api();
    const ordinary = map();
    const timed = new Map([["1,0", { q: 1, r: 0, terrain: "water", source: "script" as const, expiresIn: 2 }]]);
    const large = map({ width: 33, height: 17 });
    const full = new Map<string, Override>();
    for (let index = 0; index < 512; index += 1) {
      full.set(`${index % 32},${Math.floor(index / 32)}`, {
        q: index % 32, r: Math.floor(index / 32), terrain: "water", source: "script"
      });
    }
    const cases: Array<[Request, string]> = [
      [request({ map: ordinary, transitions: {}, operations: [{ kind: "set_terrain", coord: { q: 1, r: 0 }, transitionId: "missing", order: 0 }] }), "terraform.transition_missing"],
      [request({ map: ordinary, operations: [{ kind: "set_terrain", coord: { q: 1, r: 0 }, transitionId: "dry", order: 0 }] }), "terraform.transition_source_tag_mismatch"],
      [request({ map: ordinary, operations: [{ kind: "restore_terrain", coord: { q: 9, r: 0 }, order: 0 }] }), "terraform.target_outside_map"],
      [request({ map: ordinary, runtimeOverrides: timed, operations: [{ kind: "restore_terrain", coord: { q: 1, r: 0 }, order: 0 }] }), "terraform.target_owned"],
      [request({ map: large, runtimeOverrides: full, operations: [{ kind: "set_terrain", coord: { q: 32, r: 16 }, directTerrainId: "water", order: 0 }] }), "terraform.override_budget_exceeded"]
    ];
    for (const [input, expected] of cases) {
      const before = fingerprint(input.map, input.runtimeOverrides);
      try {
        kernel.preparePersistentTerrainTransaction(input);
        expect.fail(`Expected ${expected}`);
      } catch (error) {
        expect(reason(error)).toBe(expected);
      }
      expect(fingerprint(input.map, input.runtimeOverrides)).toBe(before);
    }
  });

  it("distinguishes authored baseline breakage, unavailable candidates, and a repairing candidate", async () => {
    const kernel = await api();
    const healthy = map();
    expect(() => kernel.preparePersistentTerrainTransaction(request({
      map: healthy,
      operations: [{ kind: "set_terrain", coord: { q: 2, r: 1 }, directTerrainId: "wall", order: 0 }]
    }))).toThrow(expect.objectContaining({ reasonKey: "terraform.last_authored_route_blocked" }));

    const broken = map();
    broken.setTerrain({ q: 2, r: 1 }, "wall");
    const brokenOverrides = new Map([["2,1", { q: 2, r: 1, terrain: "wall", source: "script" as const }]]);
    expect(() => kernel.preparePersistentTerrainTransaction(request({
      map: broken, runtimeOverrides: brokenOverrides,
      operations: [{ kind: "set_terrain", coord: { q: 1, r: 1 }, directTerrainId: "water", order: 0 }]
    }))).toThrow(expect.objectContaining({ reasonKey: "terraform.authored_route_unavailable" }));
    expect(() => kernel.preparePersistentTerrainTransaction(request({
      map: broken, runtimeOverrides: brokenOverrides,
      operations: [{ kind: "restore_terrain", coord: { q: 2, r: 1 }, order: 0 }]
    }))).not.toThrow();
  });

  it("preserves authored-route endpoint safety instead of omitting spawn or core cells", async () => {
    const kernel = await api();
    for (const q of [0, 4]) {
      expect(() => kernel.preparePersistentTerrainTransaction(request({
        map: map(),
        operations: [{
          kind: "set_terrain",
          coord: { q, r: 1 },
          directTerrainId: "wall",
          order: 0
        }]
      }))).toThrow(expect.objectContaining({ reasonKey: "terraform.last_authored_route_blocked" }));
    }
  });

  it("runs a dynamic proof exactly once and rejects a failed proof without mutation", async () => {
    const kernel = await api();
    let successCalls = 0;
    const successInput = request({ navigation: {
      mode: "dynamic_flow",
      prove: () => { successCalls += 1; return { baselineAvailable: true, candidateAvailable: true, proof: "ready" }; }
    } });
    const prepared = kernel.preparePersistentTerrainTransaction(successInput);
    expect(successCalls).toBe(1);
    kernel.adoptPersistentTerrainTransaction(prepared, () => undefined);
    expect(successCalls).toBe(1);

    let failureCalls = 0;
    const failureInput = request({ navigation: {
      mode: "dynamic_flow",
      prove: () => { failureCalls += 1; return { baselineAvailable: true, candidateAvailable: false }; }
    } });
    const before = fingerprint(failureInput.map, failureInput.runtimeOverrides);
    expect(() => kernel.preparePersistentTerrainTransaction(failureInput))
      .toThrow(expect.objectContaining({ reasonKey: "terraform.last_path_blocked" }));
    expect(failureCalls).toBe(1);
    expect(fingerprint(failureInput.map, failureInput.runtimeOverrides)).toBe(before);
  });

  it("publishes two ordered writes/events all at once and permits one no-throw adoption only", async () => {
    const kernel = await api();
    let proofCalls = 0;
    const input = request({
      operations: [
        { kind: "set_terrain", coord: { q: 1, r: 0 }, directTerrainId: "water", order: 0 },
        { kind: "set_terrain", coord: { q: 2, r: 0 }, directTerrainId: "stone", order: 1 }
      ],
      navigation: {
        mode: "dynamic_flow",
        prove: () => { proofCalls += 1; return { baselineAvailable: true, candidateAvailable: true, proof: "precomputed" }; }
      }
    });
    const before = fingerprint(input.map, input.runtimeOverrides);
    const prepared = kernel.preparePersistentTerrainTransaction(input);
    expect(fingerprint(input.map, input.runtimeOverrides)).toBe(before);
    let published: Adoption | undefined;
    expect(kernel.adoptPersistentTerrainTransaction(prepared, (value) => {
      expect(fingerprint(input.map, input.runtimeOverrides)).toBe(before);
      published = value;
    })).toEqual({ adopted: true });
    expect(proofCalls).toBe(1);
    expect(published).toMatchObject({
      writes: [{ coord: { q: 1, r: 0 }, terrain: "water" }, { coord: { q: 2, r: 0 }, terrain: "stone" }],
      events: [{ order: 0 }, { order: 1 }], navigationProof: "precomputed"
    });
    expect(kernel.adoptPersistentTerrainTransaction(prepared, () => undefined))
      .toEqual({ adopted: false });
  });

  it("preserves directTerrainId, restore, previous override, authored order, and source", async () => {
    const kernel = await api();
    const subject = map();
    subject.setTerrain({ q: 2, r: 0 }, "stone");
    subject.setTerrain({ q: 3, r: 0 }, "water");
    const overrides = new Map<string, Override>([
      ["2,0", { q: 2, r: 0, terrain: "stone", source: "script" }],
      ["3,0", { q: 3, r: 0, terrain: "water", source: "ability" }]
    ]);
    const prepared = kernel.preparePersistentTerrainTransaction(request({
      map: subject, runtimeOverrides: overrides,
      operations: [
        { kind: "set_terrain", coord: { q: 1, r: 0 }, directTerrainId: "water", terrainSource: "ability", order: 0 },
        { kind: "restore_terrain", coord: { q: 2, r: 0 }, order: 1 },
        {
          kind: "set_terrain", coord: { q: 3, r: 0 }, order: 2,
          previousTerrainOverride: { q: 3, r: 0, terrain: "stone", source: "script" }
        }
      ]
    }));
    let adoption: Adoption | undefined;
    kernel.adoptPersistentTerrainTransaction(prepared, (value) => { adoption = value; });
    expect(adoption).toMatchObject({
      writes: [
        { coord: { q: 1, r: 0 }, terrain: "water" },
        { coord: { q: 2, r: 0 }, terrain: "floor" },
        { coord: { q: 3, r: 0 }, terrain: "stone" }
      ],
      runtimeOverrides: expect.arrayContaining([
        { q: 1, r: 0, terrain: "water", source: "ability" },
        { q: 3, r: 0, terrain: "stone", source: "script" }
      ]),
      events: [
        { order: 0, event: { source: "ability" } },
        { order: 1, event: { source: "restore" } },
        { order: 2, event: { source: "restore" } }
      ]
    });
    expect(adoption?.runtimeOverrides).not.toContainEqual(expect.objectContaining({ q: 2, r: 0 }));
  });

  it("publishes events in stable authored order even when prepared operations arrive permuted", async () => {
    const kernel = await api();
    const prepared = kernel.preparePersistentTerrainTransaction(request({
      operations: [
        { kind: "set_terrain", coord: { q: 2, r: 0 }, directTerrainId: "stone", order: 2 },
        { kind: "set_terrain", coord: { q: 1, r: 0 }, directTerrainId: "water", order: 1 }
      ]
    }));
    let adoption: Adoption | undefined;
    kernel.adoptPersistentTerrainTransaction(prepared, (value) => { adoption = value; });
    expect(adoption?.events.map((event) => event.order)).toEqual([1, 2]);
  });

  it("treats an effective no-op as proof-free and publishes empty ordered changes", async () => {
    const kernel = await api();
    let proofCalls = 0;
    const prepared = kernel.preparePersistentTerrainTransaction(request({
      operations: [{ kind: "restore_terrain", coord: { q: 1, r: 0 }, order: 0 }],
      navigation: {
        mode: "dynamic_flow",
        prove: () => { proofCalls += 1; return { baselineAvailable: true, candidateAvailable: true }; }
      }
    }));
    let adoption: Adoption | undefined;
    kernel.adoptPersistentTerrainTransaction(prepared, (value) => { adoption = value; });
    expect(proofCalls).toBe(0);
    expect(adoption).toMatchObject({ writes: [], events: [], runtimeOverrides: [] });
  });
});
