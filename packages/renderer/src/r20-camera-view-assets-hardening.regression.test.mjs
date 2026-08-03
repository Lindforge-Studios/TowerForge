import { describe, expect, it } from "vitest";
import { projectCameraViewAssetCoverageV1, resolveCameraViewVariantV1 } from "./camera-view-assets.mjs";

const VIEW = "isometric_2_1:north";
const context = { projection: "isometric_2_1", orientation: "north" };

function spriteAsset(id = "probe") {
  return { src: `assets/${id}.png`, mimeType: "image/png", anchor: { x: 0.5, y: 1 } };
}

function visuals() {
  return {
    schemaVersion: 4,
    sprites: { probe: { src: "assets/base.png" } },
    tileSets: {},
    viewVariants: { schemaVersion: 1, sprites: { probe: { [VIEW]: spriteAsset() } }, tileSets: {} }
  };
}

describe("R20 verifier: fail-closed bounded view variants (RED)", () => {
  it("rejects an accessor exact variant without executing it or falling through to fallback", () => {
    const catalog = visuals();
    let reads = 0;
    Object.defineProperty(catalog.viewVariants.sprites.probe, VIEW, {
      enumerable: true,
      get() { reads += 1; return spriteAsset("accessor"); }
    });
    expect(() => resolveCameraViewVariantV1({ visuals: catalog, kind: "sprite", id: "probe", ...context }))
      .toThrow(/accessor|own.data|inspect/i);
    expect(reads).toBe(0);
  });

  it("rejects a cyclic exact variant without a recursive stack overflow", () => {
    const catalog = visuals();
    const exact = catalog.viewVariants.sprites.probe[VIEW];
    exact.loop = exact;
    let error;
    try { resolveCameraViewVariantV1({ visuals: catalog, kind: "sprite", id: "probe", ...context }); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RangeError);
    expect(error.message).toMatch(/cyclic|own.data|bounded/i);
  });

  it("rejects more than 4096 sprite variant records in resolver and coverage", () => {
    const catalog = visuals();
    catalog.viewVariants.sprites = Object.fromEntries(Array.from({ length: 4097 }, (_, index) => [
      `sprite_${index}`, { [VIEW]: spriteAsset(`sprite_${index}`) }
    ]));
    expect(() => resolveCameraViewVariantV1({ visuals: catalog, kind: "sprite", id: "sprite_0", ...context }))
      .toThrow(/4096|budget/i);
    expect(() => projectCameraViewAssetCoverageV1({
      visuals: catalog, ...context, spriteIds: Object.keys(catalog.viewVariants.sprites), tileSets: []
    })).toThrow(/4096|budget/i);
  });

  it("rejects more than 256 tileset variant records in resolver and coverage", () => {
    const catalog = visuals();
    catalog.viewVariants.tileSets = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [
      `tiles_${index}`,
      { [VIEW]: { atlas: { src: `assets/tiles_${index}.png`, mimeType: "image/png" }, materials: { buildable: {} } } }
    ]));
    expect(() => resolveCameraViewVariantV1({ visuals: catalog, kind: "tileSet", id: "tiles_0", ...context }))
      .toThrow(/256|budget/i);
    expect(() => projectCameraViewAssetCoverageV1({
      visuals: catalog,
      ...context,
      spriteIds: [],
      tileSets: Object.keys(catalog.viewVariants.tileSets).map((tileSetId) => ({ tileSetId, materialIds: ["buildable"] }))
    })).toThrow(/256|budget/i);
  });
});
