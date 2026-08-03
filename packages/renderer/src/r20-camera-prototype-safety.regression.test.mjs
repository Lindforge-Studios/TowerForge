import { describe, expect, it } from "vitest";
import { resolveCameraProfileV1, validateCameraProfileCatalogV1 } from "./camera-projector.mjs";
import { resolveCameraViewVariantV1 } from "./camera-view-assets.mjs";

const SPECIAL_IDS = Object.freeze(["__proto__", "constructor", "prototype"]);
const VIEW_KEY = "isometric_2_1:north";

function ownCatalog(entries) {
  const catalog = Object.create(null);
  for (const [id, value] of entries) {
    Object.defineProperty(catalog, id, { value, enumerable: true, configurable: true, writable: true });
  }
  return catalog;
}

function profile() {
  return {
    schemaVersion: 1,
    projection: "isometric_2_1",
    orientation: "north",
    elevationScale: 1,
    fitPadding: 24,
    minZoom: 0.5,
    maxZoom: 3,
    initialZoom: 1
  };
}

describe("R20 camera prototype-safe identifier contracts (RED)", () => {
  it("preserves own special profile IDs without mutating the compiled catalog prototype", () => {
    const profiles = ownCatalog(SPECIAL_IDS.map((id) => [id, profile()]));
    const result = validateCameraProfileCatalogV1({
      schemaVersion: 1,
      profiles,
      bindings: { maps: ownCatalog([["map_safe", "__proto__"]]), missions: {} }
    });

    expect(result.ok).toBe(true);
    const compiled = result.catalog;
    for (const id of SPECIAL_IDS) expect(Object.hasOwn(compiled.profiles, id), id).toBe(true);
    expect(Object.getPrototypeOf(compiled.profiles) === Object.prototype || Object.getPrototypeOf(compiled.profiles) === null).toBe(true);
    expect(resolveCameraProfileV1({
      schemaVersion: 1,
      profiles,
      bindings: { maps: ownCatalog([["map_safe", "__proto__"]]), missions: {} }
    }, { mapId: "map_safe" })).toMatchObject({ source: "map", profileId: "__proto__" });
  });

  it("resolves own special binding IDs and never resolves inherited catalog properties", () => {
    const authored = {
      schemaVersion: 1,
      profiles: { safe: profile() },
      bindings: { maps: ownCatalog(SPECIAL_IDS.map((id) => [id, "safe"])), missions: {} }
    };
    for (const id of SPECIAL_IDS) {
      expect(resolveCameraProfileV1(authored, { mapId: id })).toMatchObject({ source: "map", profileId: "safe" });
    }

    const unbound = {
      schemaVersion: 1,
      profiles: { safe: profile() },
      bindings: { maps: {}, missions: {} }
    };
    for (const id of SPECIAL_IDS) {
      expect(resolveCameraProfileV1(unbound, { mapId: id })).toMatchObject({
        source: "top_down_fallback",
        profileId: null
      });
    }
  });

  it("preserves own special sprite and tileset IDs without accepting inherited variants", () => {
    const spriteVariants = ownCatalog(SPECIAL_IDS.map((id) => [id, {
      [VIEW_KEY]: { src: `assets/camera/${id}.png`, mimeType: "image/png", anchor: { x: 0.5, y: 1 } }
    }]));
    const tileSetVariants = ownCatalog(SPECIAL_IDS.map((id) => [id, {
      [VIEW_KEY]: {
        atlas: { src: `assets/camera/${id}-tiles.png`, mimeType: "image/png" },
        materials: {}
      }
    }]));
    const visuals = {
      sprites: {},
      viewVariants: { schemaVersion: 1, sprites: spriteVariants, tileSets: tileSetVariants }
    };

    for (const id of SPECIAL_IDS) {
      expect(resolveCameraViewVariantV1({
        visuals, kind: "sprite", id, projection: "isometric_2_1", orientation: "north"
      })).toMatchObject({ status: "exact", id });
      expect(resolveCameraViewVariantV1({
        visuals, kind: "tileSet", id, projection: "isometric_2_1", orientation: "north"
      })).toMatchObject({ status: "exact", id });
    }

    const emptyVisuals = {
      sprites: {},
      viewVariants: { schemaVersion: 1, sprites: {}, tileSets: {} }
    };
    for (const id of SPECIAL_IDS) {
      expect(resolveCameraViewVariantV1({
        visuals: emptyVisuals, kind: "sprite", id, projection: "isometric_2_1", orientation: "north"
      })).toMatchObject({ status: "missing", id });
      expect(resolveCameraViewVariantV1({
        visuals: emptyVisuals, kind: "tileSet", id, projection: "isometric_2_1", orientation: "north"
      })).toMatchObject({ status: "missing", id });
    }
  });
});
