import { describe, expect, it } from "vitest";
import { compileMapSource, normalizeElevationOverrides } from "./map-compiler.mjs";
import { validateProjectSchemas } from "./project-schema.mjs";
import { listMechanicsRecipes, materializeMechanicsRecipe } from "./mechanics-recipes.mjs";

function source(elevationOverrides) {
  return {
    id: "elevation_map",
    orientation: "orthogonal",
    width: 3,
    height: 2,
    defaultTerrain: "buildable",
    spawnCoord: { q: 0, r: 0 },
    coreCoord: { q: 2, r: 1 },
    pathCenterline: [
      { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 2, r: 1 }
    ],
    elevationOverrides
  };
}

function schemaFiles(schemaVersion, elevationOverrides) {
  return {
    manifest: { schemaVersion },
    balance: { missions: {} },
    maps: {
      elevation_map: {
        id: "elevation_map",
        width: 3,
        height: 2,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 0 },
        coreCoord: { q: 2, r: 1 },
        pathCenterline: [],
        pathRoutes: [],
        terrainOverrides: [],
        ...(elevationOverrides === undefined ? {} : { elevationOverrides })
      }
    },
    mapSources: {},
    mechanics: undefined,
    visuals: {},
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets: { schemaVersion: 1, targets: {} }
  };
}

describe("R3.1 map elevation authoring contract", () => {
  it("compiles sparse elevations canonically and omits both zeros and an empty legacy field", () => {
    const compiled = compileMapSource(source([
      { q: 2, r: 1, elevation: -7 },
      { q: 1, r: 0, elevation: 4 },
      { q: 0, r: 1, elevation: 0 },
      { q: 2, r: 0, elevation: 2 }
    ]), "elevation.tmj");
    expect(compiled.height).toBe(2);
    expect(compiled.elevationOverrides).toEqual([
      { q: 1, r: 0, elevation: 4 },
      { q: 2, r: 0, elevation: 2 },
      { q: 2, r: 1, elevation: -7 }
    ]);

    const legacy = compileMapSource(source(undefined), "legacy.tmj");
    const flat = compileMapSource(source([{ q: 1, r: 0, elevation: 0 }]), "flat.tmj");
    expect(Object.hasOwn(legacy, "elevationOverrides")).toBe(false);
    expect(Object.hasOwn(flat, "elevationOverrides")).toBe(false);
  });

  it.each([
    ["fractional", [{ q: 1, r: 0, elevation: 1.5 }]],
    ["below bound", [{ q: 1, r: 0, elevation: -1_000_001 }]],
    ["above bound", [{ q: 1, r: 0, elevation: 1_000_001 }]],
    ["fractional coord", [{ q: 1.5, r: 0, elevation: 1 }]],
    ["out of bounds", [{ q: 3, r: 0, elevation: 1 }]],
    ["duplicate", [{ q: 1, r: 0, elevation: 1 }, { q: 1, r: 0, elevation: 2 }]],
    ["extra key", [{ q: 1, r: 0, elevation: 1, height: 99 }]],
    ["sparse", Object.assign(new Array(2), { 1: { q: 1, r: 0, elevation: 1 } })]
  ])("rejects %s elevation data", (_label, elevationOverrides) => {
    expect(() => compileMapSource(source(elevationOverrides), "invalid-elevation.tmj"))
      .toThrow(/elevation|dense|duplicate|coordinate|bounds|field/i);
  });

  it("accepts exactly 65,536 compiled elevation rows and rejects 65,537 before sparse traversal", () => {
    const exact = Array.from({ length: 65_536 }, (_, q) => ({ q, r: 0, elevation: 1 }));
    expect(normalizeElevationOverrides(exact, 65_536, 1)).toHaveLength(65_536);
    expect(() => normalizeElevationOverrides(new Array(65_537), 65_537, 1))
      .toThrow(/65.?536|at most|entries/i);
  });

  it("does not invoke elevation accessors", () => {
    let calls = 0;
    const entry = { q: 1, r: 0 };
    Object.defineProperty(entry, "elevation", {
      enumerable: true,
      get() { calls += 1; return 4; }
    });
    expect(() => compileMapSource(source([entry]), "accessor.tmj")).toThrow(/elevation|data property|accessor/i);
    expect(calls).toBe(0);
  });

  it("does not invoke an accessor-backed Tiled property name while identifying elevation metadata", () => {
    let calls = 0;
    const tiledProperty = {
      type: "string",
      value: JSON.stringify([{ q: 1, r: 0, elevation: 4 }])
    };
    Object.defineProperty(tiledProperty, "name", {
      enumerable: true,
      get() { calls += 1; return "elevationOverrides"; }
    });
    const tiledSource = source(undefined);
    delete tiledSource.elevationOverrides;
    tiledSource.properties = [tiledProperty];

    expect(() => compileMapSource(tiledSource, "tiled-name-accessor.tmj"))
      .toThrow(/property|name|data field|accessor/i);
    expect(calls).toBe(0);
  });

  it("compiles the JSON Tiled property form through the same canonical contract", () => {
    const tiledSource = source(undefined);
    delete tiledSource.elevationOverrides;
    tiledSource.properties = [{
      name: "elevationOverrides",
      type: "string",
      value: JSON.stringify([
        { q: 2, r: 1, elevation: -3 },
        { q: 1, r: 0, elevation: 4 },
        { q: 0, r: 0, elevation: 0 }
      ])
    }];
    expect(compileMapSource(tiledSource, "tiled-property.tmj").elevationOverrides).toEqual([
      { q: 1, r: 0, elevation: 4 },
      { q: 2, r: 1, elevation: -3 }
    ]);
  });

  it("rejects ambiguous top-level plus Tiled-property elevation authoring", () => {
    const ambiguous = source([{ q: 1, r: 0, elevation: 4 }]);
    ambiguous.properties = [{
      name: "elevationOverrides",
      type: "string",
      value: JSON.stringify([{ q: 2, r: 1, elevation: -3 }])
    }];
    expect(() => compileMapSource(ambiguous, "ambiguous-elevation.tmj"))
      .toThrow(/elevation.*ambiguous|either.*top.*tiled|not both/i);
  });

  it("rejects duplicate and malformed Tiled elevation properties", () => {
    const duplicate = source(undefined);
    delete duplicate.elevationOverrides;
    duplicate.properties = [
      { name: "elevationOverrides", type: "string", value: "[]" },
      { name: "elevationOverrides", type: "string", value: "[]" }
    ];
    expect(() => compileMapSource(duplicate, "duplicate-tiled-elevation.tmj"))
      .toThrow(/elevation.*only once|duplicate/i);

    const malformed = source(undefined);
    delete malformed.elevationOverrides;
    malformed.properties = [{ name: "elevationOverrides", type: "string", value: "not-json" }];
    expect(() => compileMapSource(malformed, "malformed-tiled-elevation.tmj"))
      .toThrow(/elevation.*valid json|valid json.*elevation/i);
  });

  it("rejects null-prototype elevation entries to match the engine ordinary-object contract", () => {
    const entry = Object.assign(Object.create(null), { q: 1, r: 0, elevation: 4 });
    expect(() => compileMapSource(source([entry]), "null-prototype-entry.tmj"))
      .toThrow(/elevation|plain|ordinary|prototype|object/i);
  });

  it.each([
    ["width", Number.MAX_SAFE_INTEGER + 1, 2],
    ["height", 3, Number.MAX_SAFE_INTEGER + 1]
  ])("rejects an unsafe-integer map %s during source compilation", (_field, width, height) => {
    const unsafe = source([{ q: 1, r: 0, elevation: 4 }]);
    unsafe.width = width;
    unsafe.height = height;
    expect(() => compileMapSource(unsafe, "unsafe-dimension.tmj"))
      .toThrow(/width|height|dimension|safe integer/i);
  });

  it("rejects unsafe-integer compiled and authored source dimensions in project schema v3", () => {
    const files = schemaFiles(3, [{ q: 1, r: 0, elevation: 4 }]);
    files.maps.elevation_map.width = Number.MAX_SAFE_INTEGER + 1;
    const unsafeSource = source([{ q: 1, r: 0, elevation: 4 }]);
    unsafeSource.height = Number.MAX_SAFE_INTEGER + 1;
    files.mapSources = { "unsafe-dimension.tmj": unsafeSource };

    const result = validateProjectSchemas(files);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "map",
      entityId: "elevation_map",
      fieldPath: "width"
    }));
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "mapSource",
      entityId: "unsafe-dimension.tmj",
      fieldPath: expect.stringMatching(/height|root/i)
    }));
  });

  it("requires project schema v3 for any authored elevation while legacy maps remain valid", () => {
    for (const version of [1, 2]) {
      const authored = validateProjectSchemas(schemaFiles(version, [{ q: 1, r: 0, elevation: 2 }]));
      expect(authored.ok).toBe(false);
      expect(authored.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        entityKind: "project",
        fieldPath: "schemaVersion",
        message: expect.stringMatching(/elevation.*3|schemaVersion 3/i)
      }));
      expect(validateProjectSchemas(schemaFiles(version, undefined)).issues).not.toContainEqual(
        expect.objectContaining({ message: expect.stringMatching(/elevation/i) })
      );
    }
    expect(validateProjectSchemas(schemaFiles(3, [{ q: 1, r: 0, elevation: 2 }])).issues)
      .not.toContainEqual(expect.objectContaining({ severity: "error", fieldPath: expect.stringMatching(/elevation/i) }));
  });

  it("ships a pure elevation recipe that neither enables the module nor mutates a map", () => {
    expect(listMechanicsRecipes()).toContainEqual(expect.objectContaining({
      id: "basic_authored_elevation",
      moduleId: "elevation",
      moduleSchemaVersion: 1
    }));
    const context = Object.freeze({
      missionId: "tutorial_01",
      mechanics: Object.freeze({ schemaVersion: 1, modules: Object.freeze({}) }),
      maps: Object.freeze({ tutorial_map: Object.freeze({ elevationOverrides: Object.freeze([]) }) })
    });
    const before = structuredClone(context);
    const materialized = materializeMechanicsRecipe("basic_authored_elevation", context);
    expect(materialized).toMatchObject({
      entity: {
        moduleId: "elevation",
        moduleSchemaVersion: 1,
        profile: {}
      }
    });
    expect(materialized.entity).not.toHaveProperty("enabled");
    expect(materialized.entity).not.toHaveProperty("elevationOverrides");
    expect(context).toEqual(before);
  });
});
