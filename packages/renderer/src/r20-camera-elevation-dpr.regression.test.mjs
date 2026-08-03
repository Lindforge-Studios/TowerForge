import { describe, expect, it } from "vitest";
import { createCanvasRenderer } from "./index.mjs";
import { createViewportTransformV1 } from "./viewport-transform.mjs";

const grid = { kind: "square", adjacency: "cardinal" };

function cameraProfile(overrides = {}) {
  return {
    schemaVersion: 1, projection: "isometric_2_1", orientation: "north", elevationScale: 2,
    fitPadding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1, panPadding: 0, ...overrides
  };
}

function visuals(profile = cameraProfile()) {
  return {
    schemaVersion: 4,
    cameraProfiles: { schemaVersion: 1, profiles: { iso: profile }, bindings: { maps: {}, missions: {} } },
    atlases: {}, sprites: {}, tileSets: {},
    bindings: { towers: {}, enemies: {}, tiles: {}, tileSets: { grids: {}, maps: {} }, ui: {} }
  };
}

function canvasFixture({ width = 800, height = 600, cssWidth = width, cssHeight = height, arcs = [] } = {}) {
  const ctx = new Proxy({
    arc(x, y, radius) { arcs.push({ x, y, radius }); }
  }, {
    get(target, property) { return property in target ? target[property] : () => {}; },
    set(target, property, value) { target[property] = value; return true; }
  });
  return {
    width, height, getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: cssWidth, height: cssHeight })
  };
}

function renderer(canvas, profile = cameraProfile()) {
  return createCanvasRenderer({
    canvas,
    content: { visuals: visuals(profile), towers: { arrow: { label: "Arrow" } } },
    createViewportTransform: createViewportTransformV1,
    viewportProfile: { padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    cameraProfileId: "iso"
  });
}

function isolate(renderer) {
  for (const name of [
    "clear", "drawCachedTileLayer", "drawWeatherPresentation", "drawElevationPresentation",
    "drawNavigationOverlay", "drawFocusCell", "drawPassiveHeroAura", "drawHeroBlocking",
    "drawBallisticsEvents", "drawBallisticsRicochetEvents", "drawEffects", "drawProceduralJuice",
    "drawProceduralChromaticAberration", "drawOutcomeOverlay", "spawnEffects", "advanceEffects"
  ]) renderer[name] = () => {};
  renderer.combinedShakeOffset = () => ({ x: 0, y: 0 });
}

function baseSnapshot(tiles) {
  return {
    missionId: "elevation", mapId: "map", outcome: "playing", grid, tiles,
    pathRoutes: [], pathCenterline: tiles, spawnCoord: tiles[0], towers: [], enemies: [], heroes: [], lastEvents: []
  };
}

describe("R20 verifier: authoritative elevation and DPR camera padding (RED)", () => {
  it("projects tower, destructible and projectile endpoints from authoritative tile elevation", () => {
    const authoredTiles = [
      { q: 0, r: 0, terrain: "buildable", elevation: 0 },
      { q: 1, r: 1, terrain: "buildable", elevation: 3 }
    ];

    const towerRenderer = renderer(canvasFixture());
    isolate(towerRenderer);
    let towerPoint;
    towerRenderer.drawTower = (tower, _snapshot, geom) => { towerPoint = towerRenderer.center(tower.coord, geom); };
    towerRenderer.drawEnemy = () => {};
    towerRenderer.drawDestructibleEnvironmentRow = () => {};
    towerRenderer.drawBallisticsProjectile = () => {};
    towerRenderer.drawSnapshot({ ...baseSnapshot(authoredTiles), towers: [{ id: "tower", typeId: "arrow", coord: { q: 1, r: 1 } }] });
    const towerGeom = towerRenderer.geometry(authoredTiles, grid);
    expect(towerPoint).toEqual(towerRenderer.center({ q: 1, r: 1, elevation: 3 }, towerGeom));

    const destructibleRenderer = renderer(canvasFixture());
    isolate(destructibleRenderer);
    let destructiblePoint;
    destructibleRenderer.drawTower = () => {};
    destructibleRenderer.drawEnemy = () => {};
    destructibleRenderer.drawBallisticsProjectile = () => {};
    destructibleRenderer.drawDestructibleEnvironmentRow = (row, geom) => { destructiblePoint = destructibleRenderer.center(row.coord, geom); };
    destructibleRenderer.drawSnapshot({
      ...baseSnapshot(authoredTiles),
      ballistics: {
        schemaVersion: 2,
        projectiles: [],
        destructibles: { schemaVersion: 1, objects: [{ objectId: "rock", definitionId: "rock", coord: { q: 1, r: 1 }, hp: 10, maxHp: 10, destroyed: false }] }
      }
    });
    const destructibleGeom = destructibleRenderer.geometry(authoredTiles, grid);
    expect(destructiblePoint).toEqual(destructibleRenderer.center({ q: 1, r: 1, elevation: 3 }, destructibleGeom));

    const arcs = [];
    const projectileRenderer = renderer(canvasFixture({ arcs }));
    isolate(projectileRenderer);
    projectileRenderer.drawTower = () => {};
    projectileRenderer.drawEnemy = () => {};
    projectileRenderer.drawDestructibleEnvironmentRow = () => {};
    projectileRenderer.drawSnapshot({
      ...baseSnapshot(authoredTiles),
      ballistics: {
        schemaVersion: 1,
        projectiles: [{
          id: "shot", sourceCoord: { q: 0, r: 0 }, targetCoord: { q: 1, r: 1 }, trajectory: "direct",
          elapsedUnits: 1, travelTimeUnits: 1, altitude: 0
        }]
      }
    });
    const projectileGeom = projectileRenderer.geometry(authoredTiles, grid);
    const expectedProjectile = projectileRenderer.center({ q: 1, r: 1, elevation: 3 }, projectileGeom);
    expect(arcs).toContainEqual(expect.objectContaining({ x: expectedProjectile.x, y: expectedProjectile.y }));
  });

  it("scales authored CSS fit and pan padding into backing pixels on a DPR-2 Canvas", () => {
    const canvas = canvasFixture({ width: 1600, height: 1200, cssWidth: 800, cssHeight: 600 });
    const instance = renderer(canvas, cameraProfile({ fitPadding: 32, panPadding: 32, minZoom: 3, initialZoom: 3, maxZoom: 3 }));
    const manyTiles = Array.from({ length: 20 * 20 }, (_, index) => ({
      q: index % 20, r: Math.floor(index / 20), terrain: "buildable", elevation: 0
    }));
    instance.selectCameraProfile({ mapId: "map" });
    const geom = instance.geometry(manyTiles, grid);
    geom.cameraRenderSpace.viewportTransform.panBy({ x: -1_000_000, y: -1_000_000 });
    const bounds = geom.cameraRenderSpace.projectedBounds;
    const bottomRight = geom.cameraRenderSpace.viewportTransform.worldToScreen({ x: bounds.maxX, y: bounds.maxY });
    expect(bottomRight.x / 2).toBeCloseTo(32, 6);
    expect(bottomRight.y / 2).toBeCloseTo(32, 6);
  });
});
