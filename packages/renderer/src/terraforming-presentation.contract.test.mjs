import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as renderer from "./index.mjs";

const presentationPath = path.resolve("packages/renderer/src/terraforming-presentation.mjs");
const presentationSource = fs.existsSync(presentationPath) ? fs.readFileSync(presentationPath, "utf8") : "";
const rendererSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

function projector() {
  expect(renderer.projectTerraformingPresentation).toBeTypeOf("function");
  return renderer.projectTerraformingPresentation;
}

function expander() {
  expect(renderer.expandAutotileInvalidations).toBeTypeOf("function");
  return renderer.expandAutotileInvalidations;
}

function section(groups = []) {
  return { schemaVersion: 1, pendingExpiryGroups: groups };
}

function target(layer, q, r) {
  return { layer, q, r };
}

function group(sequence, remaining, targets) {
  return { sequence, remaining, targets };
}

function terrainEvent({ q = 2, r = 1, fromTerrain = "path", toTerrain = "water", source = "script" } = {}) {
  return {
    type: "terrainChanged",
    coord: { q, r },
    fromTerrain,
    toTerrain,
    terrainMetadata: {
      id: toTerrain,
      label: toTerrain,
      buildable: false,
      walkable: true,
      groundSpeedMultiplier: 1,
      tags: [toTerrain]
    },
    source
  };
}

function elevationEvent({ q = 1, r = 0, fromElevation = 0, toElevation = 2, source = "script" } = {}) {
  return { type: "elevationChanged", coord: { q, r }, fromElevation, toElevation, source };
}

function activeSnapshot({ terraforming = section(), elevation, lastEvents = [] } = {}) {
  return { terraforming, elevation, lastEvents };
}

function expectDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

describe("R3.4b C6A shared terraforming presentation projector", () => {
  it("projects detached frozen sorted/deduped invalidation roots and delegates elevation badges", () => {
    const input = activeSnapshot({
      terraforming: section([
        group(1, 0.125, [target("terrain", 2, 1)]),
        group(2, 0.5, [target("elevation", 1, 0)])
      ]),
      elevation: {
        schemaVersion: 1,
        defaultElevation: 0,
        overrides: [{ q: 1, r: 0, elevation: 2 }]
      },
      lastEvents: [
        terrainEvent({ q: 2, r: 1, source: "ability" }),
        elevationEvent({ q: 3, r: 2, source: "restore", fromElevation: 2, toElevation: 0 }),
        terrainEvent({ q: 1, r: 0, source: "restore", fromTerrain: "water", toTerrain: "path" }),
        terrainEvent({ q: 2, r: 1, source: "script" }),
        elevationEvent({ q: 1, r: 0 })
      ]
    });
    const before = structuredClone(input);
    const projected = projector()(input);

    expect(projected).toEqual({
      active: true,
      terrainInvalidations: [{ q: 1, r: 0 }, { q: 2, r: 1 }],
      elevationInvalidations: [{ q: 1, r: 0 }, { q: 3, r: 2 }],
      elevationPresentation: {
        active: true,
        defaultElevation: 0,
        cues: [{ coord: { q: 1, r: 0 }, elevation: 2, label: "+2" }]
      }
    });
    expect(input).toEqual(before);
    expectDeeplyFrozen(projected);
    input.lastEvents[0].coord.q = 99;
    input.elevation.overrides[0].elevation = 99;
    expect(projected.terrainInvalidations).toEqual([{ q: 1, r: 0 }, { q: 2, r: 1 }]);
    expect(projected.elevationPresentation.cues[0].elevation).toBe(2);
  });

  it("returns one exact frozen inactive value without inspecting unrelated snapshot fields", () => {
    let eventReads = 0;
    const absent = {};
    Object.defineProperty(absent, "lastEvents", {
      enumerable: true,
      get() { eventReads += 1; throw new Error("inactive projection must not inspect events"); }
    });
    const first = projector()(absent);
    const second = projector()({ lastEvents: [] });
    expect(projector()(undefined)).toBe(first);
    expect(projector()(null)).toBe(first);
    expect(projector()({ terraforming: null })).toBe(first);
    expect(first).toEqual({ active: false, terrainInvalidations: [], elevationInvalidations: [] });
    expect(second).toBe(first);
    expect(eventReads).toBe(0);
    expectDeeplyFrozen(first);
  });

  it("accepts fractional expiry time and the exact active-section ownership budgets", () => {
    const ownershipOnly = projector()(activeSnapshot({
      terraforming: section([
        group(1, 0.25, [target("terrain", 4, 3)]),
        group(2, 0.5, [target("elevation", 4, 3)])
      ])
    }));
    expect(ownershipOnly).toEqual({
      active: true,
      terrainInvalidations: [],
      elevationInvalidations: [],
      elevationPresentation: { active: false, cues: [] }
    });
    expectDeeplyFrozen(ownershipOnly);

    const maximumGroups = Array.from({ length: 512 }, (_, index) => (
      group(index + 1, index % 2 ? 0.1 : 1_000_000_000, [target(index % 2 ? "terrain" : "elevation", index, 0)])
    ));
    expect(projector()(activeSnapshot({ terraforming: section(maximumGroups) }))).toMatchObject({ active: true });

    const maximumTargets = Array.from({ length: 16 }, (_, groupIndex) => group(
      groupIndex + 1,
      0.5,
      Array.from({ length: 64 }, (_, targetIndex) => target(
        targetIndex % 2 ? "terrain" : "elevation",
        groupIndex * 64 + targetIndex,
        1
      ))
    ));
    expect(projector()(activeSnapshot({ terraforming: section(maximumTargets) }))).toMatchObject({ active: true });
  });

  it("fails closed on future, malformed, fractional-invalid, duplicate, sparse, accessor, and over-budget sections", () => {
    const validTarget = target("terrain", 0, 0);
    const invalidSections = [
      { schemaVersion: 2, pendingExpiryGroups: [] },
      { schemaVersion: 1 },
      { schemaVersion: 1, pendingExpiryGroups: [], extra: true },
      section([group(0, 0.1, [validTarget])]),
      section([group(1, -0.1, [validTarget])]),
      section([group(1, 1_000_000_001, [validTarget])]),
      section([group(1, Number.NaN, [validTarget])]),
      section([group(1, Number.POSITIVE_INFINITY, [validTarget])]),
      section([group(1, 0.1, [])]),
      section([group(1, 0.1, Array.from({ length: 65 }, (_, index) => target("terrain", index, 0)))]),
      section([group(1, 0.1, [{ ...validTarget, extra: true }])]),
      section([group(1, 0.1, [validTarget]), group(2, 0.2, [validTarget])]),
      section([group(1, 0.1, [validTarget]), group(1, 0.2, [target("terrain", 1, 0)])]),
      section([group(2, 0.1, [validTarget]), group(1, 0.2, [target("terrain", 1, 0)])]),
      section([group(1.5, 0.1, [validTarget])]),
      section([group(Number.MAX_SAFE_INTEGER + 1, 0.1, [validTarget])]),
      section(Array.from({ length: 513 }, (_, index) => group(index + 1, 0.1, [target("terrain", index, 0)]))),
      section(Array.from({ length: 17 }, (_, groupIndex) => group(
        groupIndex + 1,
        0.1,
        Array.from({ length: 64 }, (_, targetIndex) => target("terrain", groupIndex * 64 + targetIndex, 0))
      )))
    ];
    const sparseGroups = new Array(1);
    invalidSections.push(section(sparseGroups));
    for (const terraforming of invalidSections) {
      expect(projector()(activeSnapshot({ terraforming }))).toBeUndefined();
    }

    let reads = 0;
    const accessorSection = { schemaVersion: 1 };
    Object.defineProperty(accessorSection, "pendingExpiryGroups", {
      enumerable: true,
      get() { reads += 1; throw new Error("must not invoke section accessors"); }
    });
    expect(() => projector()(activeSnapshot({ terraforming: accessorSection }))).not.toThrow();
    expect(projector()(activeSnapshot({ terraforming: accessorSection }))).toBeUndefined();
    expect(reads).toBe(0);
  });

  it("validates closed engine events, all bounds, dense 4096 input, and 1024 unique roots", () => {
    let unrelatedPayloadReads = 0;
    const unrelated = { type: "waveStarted" };
    Object.defineProperty(unrelated, "hostilePayload", {
      enumerable: true,
      get() { unrelatedPayloadReads += 1; throw new Error("unrelated payload must not be traversed"); }
    });
    expect(projector()(activeSnapshot({ lastEvents: [unrelated] }))).toMatchObject({ active: true });
    expect(unrelatedPayloadReads).toBe(0);

    const opaqueMetadata = new Proxy({}, {
      ownKeys() { throw new Error("terrain metadata is not a renderer input"); },
      getOwnPropertyDescriptor() { throw new Error("terrain metadata is not a renderer input"); }
    });
    const opaqueMetadataEvent = terrainEvent();
    Object.defineProperty(opaqueMetadataEvent, "terrainMetadata", {
      enumerable: true,
      value: opaqueMetadata
    });
    expect(() => projector()(activeSnapshot({ lastEvents: [opaqueMetadataEvent] }))).not.toThrow();
    expect(projector()(activeSnapshot({ lastEvents: [opaqueMetadataEvent] }))).toMatchObject({
      terrainInvalidations: [{ q: 2, r: 1 }]
    });

    const boundary = activeSnapshot({
      lastEvents: [
        terrainEvent({ q: 1_000_000, r: 1_000_000, fromTerrain: "я".repeat(64), toTerrain: "water", source: "ability" }),
        elevationEvent({ q: 0, r: 0, fromElevation: -1_000_000, toElevation: 1_000_000, source: "restore" }),
        ...Array.from({ length: 4_094 }, () => ({ type: "waveStarted", waveIndex: 0 }))
      ]
    });
    expect(projector()(boundary)).toMatchObject({
      active: true,
      terrainInvalidations: [{ q: 1_000_000, r: 1_000_000 }],
      elevationInvalidations: [{ q: 0, r: 0 }]
    });

    const roots = Array.from({ length: 1_024 }, (_, index) => terrainEvent({ q: index, r: 0 }));
    expect(projector()(activeSnapshot({ lastEvents: roots })).terrainInvalidations).toHaveLength(1_024);
  });

  it("fails closed without invoking getters for malformed relevant events, arrays, proxies, or budgets", () => {
    const invalidEvents = [
      { ...terrainEvent(), extra: true },
      Object.fromEntries(Object.entries(terrainEvent()).filter(([key]) => key !== "terrainMetadata")),
      Object.fromEntries([
        ...Object.entries(terrainEvent()).filter(([key]) => key !== "terrainMetadata"),
        ["fromElevation", 0]
      ]),
      { ...terrainEvent(), source: "network" },
      terrainEvent({ q: -1 }),
      terrainEvent({ q: 1.5 }),
      terrainEvent({ q: 1_000_001 }),
      terrainEvent({ fromTerrain: "" }),
      terrainEvent({ toTerrain: "я".repeat(65) }),
      terrainEvent({ fromTerrain: "path", toTerrain: "path" }),
      { ...elevationEvent(), source: "ability" },
      elevationEvent({ fromElevation: -1_000_001 }),
      elevationEvent({ toElevation: 1_000_001 }),
      elevationEvent({ toElevation: 0.5 }),
      elevationEvent({ fromElevation: 2, toElevation: 2 })
    ];
    for (const event of invalidEvents) {
      expect(projector()(activeSnapshot({ lastEvents: [event] }))).toBeUndefined();
    }
    expect(projector()(activeSnapshot({
      lastEvents: Array.from({ length: 4_097 }, () => ({ type: "waveStarted", waveIndex: 0 }))
    }))).toBeUndefined();
    expect(projector()(activeSnapshot({
      lastEvents: Array.from({ length: 1_025 }, (_, index) => terrainEvent({ q: index, r: 0 }))
    }))).toBeUndefined();
    const sparse = new Array(2);
    sparse[1] = terrainEvent();
    expect(projector()(activeSnapshot({ lastEvents: sparse }))).toBeUndefined();

    let reads = 0;
    const accessorEvent = {};
    Object.defineProperty(accessorEvent, "type", {
      enumerable: true,
      get() { reads += 1; throw new Error("must not invoke event accessors"); }
    });
    expect(() => projector()(activeSnapshot({ lastEvents: [accessorEvent] }))).not.toThrow();
    expect(projector()(activeSnapshot({ lastEvents: [accessorEvent] }))).toBeUndefined();
    expect(reads).toBe(0);

    const symbolEvent = terrainEvent();
    symbolEvent[Symbol("hidden")] = true;
    expect(projector()(activeSnapshot({ lastEvents: [symbolEvent] }))).toBeUndefined();
    const inheritedEvent = Object.create({ inherited: true });
    Object.assign(inheritedEvent, terrainEvent());
    expect(projector()(activeSnapshot({ lastEvents: [inheritedEvent] }))).toBeUndefined();

    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() { throw new Error("hostile proxy"); },
      ownKeys() { throw new Error("hostile proxy"); }
    });
    expect(() => projector()(activeSnapshot({ terraforming: hostile }))).not.toThrow();
    expect(projector()(activeSnapshot({ terraforming: hostile }))).toBeUndefined();
  });

  it("fails closed on malformed UTF-16 when the older-webview byte-length fallback is used", () => {
    const textEncoderDescriptor = Object.getOwnPropertyDescriptor(globalThis, "TextEncoder");
    try {
      Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: undefined });
      const malformed = terrainEvent({ fromTerrain: "\ud800" });
      expect(() => projector()(activeSnapshot({ lastEvents: [malformed] }))).not.toThrow();
      expect(projector()(activeSnapshot({ lastEvents: [malformed] }))).toBeUndefined();
    } finally {
      if (textEncoderDescriptor) Object.defineProperty(globalThis, "TextEncoder", textEncoderDescriptor);
      else delete globalThis.TextEncoder;
    }
  });
});

describe("R3.4b C6A shared autotile invalidation expansion", () => {
  it("expands square roots to self plus eight current-tile neighbors, deduped and sorted r/q", () => {
    const tiles = Array.from({ length: 9 }, (_, index) => ({
      q: index % 3,
      r: Math.floor(index / 3),
      terrain: "path"
    }));
    const coordinates = [{ q: 1, r: 1 }, { q: 1, r: 1 }];
    const expanded = expander()({ gridType: "square", coordinates, tiles });
    expect(expanded).toEqual([
      { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 },
      { q: 0, r: 1 }, { q: 1, r: 1 }, { q: 2, r: 1 },
      { q: 0, r: 2 }, { q: 1, r: 2 }, { q: 2, r: 2 }
    ]);
    coordinates[0].q = 99;
    expect(expanded[4]).toEqual({ q: 1, r: 1 });
    expectDeeplyFrozen(expanded);
  });

  it("expands odd-r hex roots to self plus six current-tile neighbors", () => {
    const expected = [
      { q: 1, r: 0 }, { q: 2, r: 0 },
      { q: 0, r: 1 }, { q: 1, r: 1 }, { q: 2, r: 1 },
      { q: 1, r: 2 }, { q: 2, r: 2 }
    ];
    expect(expander()({ gridType: "hex", coordinates: [{ q: 1, r: 1 }], tiles: expected }))
      .toEqual(expected);
  });

  it("caps roots/output and fails closed for malformed/accessor/sparse/extra input", () => {
    const roots = [];
    const tiles = [];
    for (let index = 0; index < 1_024; index += 1) {
      const q = (index % 32) * 4 + 1;
      const r = Math.floor(index / 32) * 4 + 1;
      roots.push({ q, r });
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dq = -1; dq <= 1; dq += 1) tiles.push({ q: q + dq, r: r + dr, terrain: "path" });
      }
    }
    expect(expander()({ gridType: "square", coordinates: roots, tiles })).toHaveLength(9_216);
    expect(expander()({ gridType: "square", coordinates: [...roots, { q: 999, r: 999 }], tiles })).toBeUndefined();
    expect(expander()({ gridType: "triangle", coordinates: [], tiles: [] })).toBeUndefined();
    expect(expander()({ gridType: "hex", coordinates: [], tiles: [], extra: true })).toBeUndefined();
    const sparse = new Array(1);
    expect(expander()({ gridType: "hex", coordinates: sparse, tiles: [] })).toBeUndefined();

    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, "q", {
      enumerable: true,
      get() { reads += 1; throw new Error("must not invoke coordinate accessors"); }
    });
    expect(() => expander()({ gridType: "hex", coordinates: [accessor], tiles: [] })).not.toThrow();
    expect(expander()({ gridType: "hex", coordinates: [accessor], tiles: [] })).toBeUndefined();
    expect(reads).toBe(0);

    let indexReads = 0;
    const accessorCoordinates = [];
    Object.defineProperty(accessorCoordinates, "0", {
      enumerable: true,
      get() { indexReads += 1; throw new Error("must not invoke coordinate index accessors"); }
    });
    Object.defineProperty(accessorCoordinates, "length", { value: 1 });
    expect(() => expander()({ gridType: "hex", coordinates: accessorCoordinates, tiles: [] })).not.toThrow();
    expect(expander()({ gridType: "hex", coordinates: accessorCoordinates, tiles: [] })).toBeUndefined();
    expect(indexReads).toBe(0);

    const hostileArray = new Proxy([], {
      ownKeys() { throw new Error("hostile array"); },
      getOwnPropertyDescriptor() { throw new Error("hostile array"); }
    });
    const hostileInput = new Proxy({}, {
      ownKeys() { throw new Error("hostile input"); },
      getOwnPropertyDescriptor() { throw new Error("hostile input"); }
    });
    for (const input of [
      { gridType: "hex", coordinates: hostileArray, tiles: [] },
      { gridType: "hex", coordinates: [], tiles: hostileArray },
      hostileInput
    ]) {
      expect(() => expander()(input)).not.toThrow();
      expect(expander()(input)).toBeUndefined();
    }
  });
});

describe("R3.4b C6A Canvas/Phaser shared consumption boundaries", () => {
  it("exports one visual-only module with no gameplay/transition/profile recomputation", () => {
    expect(presentationSource).not.toBe("");
    expect(rendererSource).toMatch(/export\s+\*\s+from\s+["']\.\/terraforming-presentation\.mjs["']/);
    expect(presentationSource).not.toMatch(
      /transitionId|profileId|navigationField|pathProgress|walkable|TowerDefenseGame|damageBonus|rangeBonus|lineOfSight/
    );
    expect(presentationSource).not.toMatch(/flash|particle|transient/i);
  });

  it("feeds identical shared hints to Canvas and Phaser while retaining snapshot-diff/reset fallback", () => {
    expect(rendererSource).toMatch(/projectTerraformingPresentation\s*\(/);
    expect(rendererSource).toMatch(/expandAutotileInvalidations\s*\(/);
    expect(rendererSource).toMatch(/terrainInvalidations/);
    expect(rendererSource).toMatch(/elevationPresentation/);
    expect(buildSource.match(/projectTerraformingPresentation\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(buildSource.match(/expandAutotileInvalidations\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(buildSource).toMatch(/terrainInvalidations/);
    expect(buildSource).toMatch(/elevationPresentation/);

    // Event invalidations are hints only: authoritative tile snapshots still drive first-frame,
    // event-loss/checkpoint changes, and map/reset cache rebuilds in both adapters.
    expect(rendererSource).toMatch(/tileTerrainState\.get\(key\)\s*===\s*tile\.terrain/);
    expect(rendererSource).toMatch(/fullRedraw[\s\S]*tileLayerKey/);
    expect(buildSource).toMatch(/tileTerrainState\.get\(key\)\s*!==\s*tile\.terrain/);
    expect(buildSource).toMatch(/fullRedraw[\s\S]*tileImageKey/);

    // Shared expansion accepts at most 1024 authoritative roots. Adapters must explicitly switch
    // to a full rebuild when a snapshot diff is larger; `undefined ?? []` would silently stale art.
    expect(rendererSource).toMatch(/mergeAutotileRoots[\s\S]*unique\.size\s*<=\s*1_024\s*\?[\s\S]*:\s*null/);
    expect(rendererSource).toMatch(/roots\s*===\s*null[\s\S]{0,300}clearRect[\s\S]{0,200}for\s*\(const tile of tiles\)\s*this\.drawTile/);
    expect(buildSource).toMatch(/mergeAutotileRoots[\s\S]*unique\.size\s*<=\s*1024\s*\?[\s\S]*:\s*null/);
    expect(buildSource).toMatch(/roots\s*===\s*null[\s\S]{0,200}new Set\(snap\.tiles\.map/);
    expect(rendererSource).not.toMatch(/function\s+renderingNeighbors\s*\(/);
    expect(buildSource).not.toMatch(/\brenderingNeighbors\s*\(coord,\s*grid\)\s*\{/);
  });
});
