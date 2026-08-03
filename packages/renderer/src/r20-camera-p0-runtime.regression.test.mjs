import { afterEach, describe, expect, it } from "vitest";
import { createCanvasRenderer } from "./index.mjs";
import { createCameraRenderSpaceV1 } from "./camera-renderer-integration.mjs";
import { createViewportTransformV1 } from "./viewport-transform.mjs";

const grid = { kind: "square", adjacency: "cardinal" };
const tiles = [
  { q: 0, r: 0, terrain: "buildable" },
  { q: 1, r: 1, terrain: "buildable" }
];
const originalImage = globalThis.Image;

afterEach(() => {
  if (originalImage === undefined) delete globalThis.Image;
  else globalThis.Image = originalImage;
});

function profile(overrides = {}) {
  return {
    schemaVersion: 1,
    projection: "isometric_2_1",
    orientation: "north",
    elevationScale: 1,
    fitPadding: 32,
    minZoom: 0.5,
    maxZoom: 3,
    initialZoom: 1,
    panPadding: 0,
    ...overrides
  };
}

function cameraVisuals(overrides = {}) {
  return {
    schemaVersion: 4,
    assetsRoot: "assets",
    atlases: {},
    sprites: {},
    tileSets: {},
    bindings: { towers: {}, enemies: {}, tiles: {}, tileSets: { grids: {}, maps: {} }, ui: {} },
    cameraProfiles: {
      schemaVersion: 1,
      profiles: { iso: profile() },
      bindings: { maps: {}, missions: {} }
    },
    ...overrides
  };
}

function canvasFixture() {
  const context = new Proxy({}, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });
  return {
    width: 800,
    height: 600,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 })
  };
}

function isolateWorldDrawing(renderer, order) {
  for (const name of [
    "clear", "drawCachedTileLayer", "drawWeatherPresentation", "drawElevationPresentation",
    "drawNavigationOverlay", "drawFocusCell", "drawDestructibleEnvironmentPresentation",
    "drawPassiveHeroAura", "drawHero", "drawHeroBlocking", "drawBallisticsPresentation",
    "drawBallisticsEvents", "drawBallisticsRicochetEvents", "drawEffects", "drawProceduralJuice",
    "drawProceduralChromaticAberration", "drawOutcomeOverlay", "spawnEffects", "advanceEffects"
  ]) renderer[name] = () => {};
  renderer.combinedShakeOffset = () => ({ x: 0, y: 0 });
  renderer.drawTower = (tower) => order.push(`tower:${tower.id}`);
  renderer.drawEnemy = (enemy) => order.push(`enemy:${enemy.id}`);
}

describe("R20 P0 renderer behavior gaps (RED)", () => {
  it("Canvas submits mixed world entities to one shared depth order and keeps inverse hit testing", () => {
    const renderer = createCanvasRenderer({
      canvas: canvasFixture(),
      content: { visuals: cameraVisuals(), towers: { arrow: { label: "Arrow" } }, enemies: { grunt: { color: 0xaaaaaa } } },
      createViewportTransform: createViewportTransformV1,
      viewportProfile: { padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
      cameraProfileId: "iso"
    });
    const order = [];
    isolateWorldDrawing(renderer, order);
    const snapshot = {
      missionId: "camera_depth",
      mapId: "map_a",
      outcome: "playing",
      grid,
      tiles,
      pathRoutes: [],
      pathCenterline: [{ q: 0, r: 0 }],
      spawnCoord: { q: 0, r: 0 },
      towers: [{ id: "tower-back", typeId: "arrow", coord: { q: 1, r: 1 } }],
      enemies: [{ id: "enemy-front", typeId: "grunt", pathProgress: 0, hp: 1, maxHp: 1 }],
      heroes: [],
      lastEvents: []
    };

    renderer.drawSnapshot(snapshot);
    expect(order).toEqual(["enemy:enemy-front", "tower:tower-back"]);

    const geom = renderer.geometry(tiles, grid);
    const target = renderer.center(tiles[1], geom);
    expect(renderer.pickTile({ clientX: target.x, clientY: target.y }, tiles)).toEqual({ q: 1, r: 1 });
  });

  it("Canvas consumes the active tileset view atlas instead of the base atlas", () => {
    const loaded = [];
    globalThis.Image = class FakeImage {
      complete = true;
      naturalWidth = 64;
      naturalHeight = 64;
      set src(value) { this._src = value; loaded.push(value); }
      get src() { return this._src; }
    };
    const visuals = cameraVisuals({
      atlases: { ground_base: { src: "assets/base/ground.png" } },
      sprites: { ground_tile: { atlas: "ground_base", frame: { x: 0, y: 0, w: 64, h: 64 } } },
      tileSets: {
        ground: {
          id: "ground", atlas: "ground_base", tileWidth: 64, tileHeight: 64,
          margin: 0, spacing: 0, topology: "square", ruleKind: "random",
          materials: { buildable: { signatures: { random: [{ spriteId: "ground_tile", weight: 1 }] } } }
        }
      },
      bindings: { towers: {}, enemies: {}, tiles: {}, tileSets: { grids: {}, maps: { map_a: "ground" } }, ui: {} },
      viewVariants: {
        schemaVersion: 1,
        sprites: {},
        tileSets: {
          ground: {
            "isometric_2_1:north": {
              atlas: { src: "assets/camera/ground-iso.webp", mimeType: "image/webp" },
              materials: { buildable: { signatures: { random: [{ spriteId: "ground_tile", weight: 1 }] } } }
            }
          }
        }
      }
    });
    const renderer = createCanvasRenderer({
      canvas: canvasFixture(), content: { visuals }, createViewportTransform: createViewportTransformV1,
      viewportProfile: { padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 }, cameraProfileId: "iso"
    });
    renderer.selectCameraProfile({ mapId: "map_a" });
    const geom = renderer.geometry(tiles, grid);
    renderer.drawTile(tiles[0], geom, { id: "map_a", grid, tiles, pathRoutes: [] });

    expect(loaded).toContain("assets/camera/ground-iso.webp");
    expect(loaded).not.toContain("assets/base/ground.png");
  });

  it("supports the schema-maximum fit padding on the minimum desktop viewport", () => {
    const space = createCameraRenderSpaceV1({
      cameraProfile: profile({ fitPadding: 512 }),
      worldPoints: [{ x: 0, y: 0, elevation: 0 }, { x: 10, y: 10, elevation: 0 }],
      viewport: { width: 1024, height: 720 },
      viewportProfile: { padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 }
    });
    expect(space.active).toBe(true);
    expect(space.viewportTransform.getSnapshot().zoom).toBeGreaterThan(0);
  });
});
