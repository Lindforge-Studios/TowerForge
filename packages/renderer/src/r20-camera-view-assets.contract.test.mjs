import { describe, expect, it } from "vitest";

const VIEW_KEY = "isometric_2_1:north";

function visuals() {
  return {
    schemaVersion: 4,
    sprites: {
      tower_base: { src: "assets/base/tower.png" },
      enemy_base: { src: "assets/base/enemy.png" },
      tile_base: { src: "assets/base/tile.png" }
    },
    tileSets: {
      ground: {
        materials: {
          buildable: { signatures: { random: [{ spriteId: "tile_base", weight: 1 }] } },
          path: { signatures: { random: [{ spriteId: "tile_base", weight: 1 }] } }
        }
      }
    },
    viewVariants: {
      schemaVersion: 1,
      sprites: {
        tower_base: {
          [VIEW_KEY]: {
            src: "assets/camera/tower-iso-north.png",
            mimeType: "image/png",
            anchor: { x: 0.5, y: 0.85 }
          }
        }
      },
      tileSets: {
        ground: {
          [VIEW_KEY]: {
            atlas: {
              src: "assets/camera/ground-iso-north.webp",
              mimeType: "image/webp"
            },
            materials: {
              buildable: { signatures: { random: [{ spriteId: "tile_base", weight: 1 }] } }
            }
          }
        }
      }
    }
  };
}

async function api() {
  return import("./camera-view-assets.mjs");
}

describe("R20.3 view-specific camera asset resolution (RED)", () => {
  it("resolves exact, billboard fallback and missing sprite variants", async () => {
    const { resolveCameraViewVariantV1 } = await api();
    const context = { projection: "isometric_2_1", orientation: "north" };

    expect(resolveCameraViewVariantV1({ visuals: visuals(), kind: "sprite", id: "tower_base", ...context }))
      .toMatchObject({ status: "exact", key: VIEW_KEY, asset: { mimeType: "image/png" } });
    expect(resolveCameraViewVariantV1({ visuals: visuals(), kind: "sprite", id: "enemy_base", ...context }))
      .toMatchObject({ status: "fallback", key: VIEW_KEY, asset: { src: "assets/base/enemy.png" } });
    expect(resolveCameraViewVariantV1({ visuals: visuals(), kind: "sprite", id: "missing", ...context }))
      .toEqual({ status: "missing", key: VIEW_KEY, kind: "sprite", id: "missing", asset: null });
  });

  it("reports exact/fallback/missing coverage in binary-stable order", async () => {
    const { projectCameraViewAssetCoverageV1 } = await api();
    const request = {
      visuals: visuals(),
      projection: "isometric_2_1",
      orientation: "north",
      spriteIds: ["tower_base", "missing", "enemy_base"],
      tileSets: [{ tileSetId: "ground", materialIds: ["path", "buildable"] }]
    };
    const forward = projectCameraViewAssetCoverageV1(request);
    const reversed = projectCameraViewAssetCoverageV1({
      ...request,
      spriteIds: [...request.spriteIds].reverse(),
      tileSets: [{ tileSetId: "ground", materialIds: [...request.tileSets[0].materialIds].reverse() }]
    });

    expect(forward).toEqual(reversed);
    expect(forward).toMatchObject({ schemaVersion: 1, ok: false, projection: "isometric_2_1", orientation: "north" });
    expect(forward.entries.map(({ kind, id, status }) => ({ kind, id, status }))).toEqual([
      { kind: "sprite", id: "enemy_base", status: "fallback" },
      { kind: "sprite", id: "missing", status: "missing" },
      { kind: "sprite", id: "tower_base", status: "exact" },
      { kind: "tileSetMaterial", id: "ground:buildable", status: "exact" },
      { kind: "tileSetMaterial", id: "ground:path", status: "missing" }
    ]);
    expect(forward.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "sprite", id: "enemy_base", status: "fallback" }),
      expect.objectContaining({ kind: "sprite", id: "missing", status: "missing" })
    ]));
    expect(forward.errors).toEqual([
      expect.objectContaining({ kind: "tileSetMaterial", id: "ground:path", status: "missing" })
    ]);
    expect(Object.isFrozen(forward)).toBe(true);
    expect(Object.isFrozen(forward.entries)).toBe(true);
  });

  it("uses projection plus orientation as an exact key without cross-view fallback", async () => {
    const { resolveCameraViewVariantV1 } = await api();
    const result = resolveCameraViewVariantV1({
      visuals: visuals(),
      kind: "sprite",
      id: "tower_base",
      projection: "isometric_2_1",
      orientation: "east"
    });
    expect(result).toMatchObject({ status: "fallback", key: "isometric_2_1:east" });
    expect(result.asset.src).toBe("assets/base/tower.png");
  });

  it("normalizes an omitted exact-variant anchor to the ADR default", async () => {
    const { resolveCameraViewVariantV1 } = await api();
    const catalog = visuals();
    delete catalog.viewVariants.sprites.tower_base[VIEW_KEY].anchor;
    const result = resolveCameraViewVariantV1({
      visuals: catalog,
      kind: "sprite",
      id: "tower_base",
      projection: "isometric_2_1",
      orientation: "north"
    });
    expect(result).toMatchObject({
      status: "exact",
      asset: { anchor: { x: 0.5, y: 1 } }
    });
  });
});
