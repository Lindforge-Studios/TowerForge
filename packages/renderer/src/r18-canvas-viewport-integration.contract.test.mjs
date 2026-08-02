import { describe, expect, it, vi } from "vitest";
import { createCanvasRenderer } from "./index.mjs";

const tiles = [
  { q: 0, r: 0, terrain: "buildable" },
  { q: 1, r: 1, terrain: "buildable" }
];
const grid = { kind: "square", adjacency: "cardinal" };

function canvasFixture() {
  const context = new Proxy({
    measureText: () => ({ width: 0 })
  }, {
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

function snapshot() {
  return {
    missionId: "r18_canvas",
    outcome: "playing",
    grid,
    tiles,
    pathRoutes: [],
    towers: [{ id: "tower-1", typeId: "pelter", coord: { q: 1, r: 1 } }],
    enemies: [],
    heroes: [],
    lastEvents: []
  };
}

function isolateDraw(renderer, onTower) {
  renderer.clear = () => {};
  renderer.drawCachedTileLayer = () => {};
  renderer.drawElevationPresentation = () => {};
  renderer.drawNavigationOverlay = () => {};
  renderer.drawEffects = () => {};
  renderer.drawProceduralJuice = () => {};
  renderer.drawOutcomeOverlay = () => {};
  renderer.drawProceduralChromaticAberration = () => {};
  renderer.spawnEffects = () => {};
  renderer.advanceEffects = () => {};
  renderer.combinedShakeOffset = () => ({ x: 0, y: 0 });
  renderer.drawTower = onTower;
}

describe("R18.1 Canvas shared viewport integration (RED)", () => {
  it("uses one injected viewport transform for drawing and inverse pointer hit-testing", () => {
    const calls = { world: [], screen: [], factory: [] };
    const transform = {
      worldToScreen(point) {
        calls.world.push(point);
        return { x: point.x + 300, y: point.y - 50 };
      },
      screenToWorld(point) {
        calls.screen.push(point);
        return { x: point.x - 300, y: point.y + 50 };
      },
      panBy() {}, zoomAt() {}, reset() {},
      getSnapshot: () => ({ schemaVersion: 1, zoom: 1, offsetX: 300, offsetY: -50 })
    };
    const viewportFactory = vi.fn((options) => {
      calls.factory.push(options);
      return transform;
    });
    const renderer = createCanvasRenderer({
      canvas: canvasFixture(),
      content: { towers: { pelter: { label: "Pelter" } } },
      createViewportTransform: viewportFactory,
      viewportProfile: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 }
    });
    let drawnTowerPoint = null;
    isolateDraw(renderer, (tower, _snapshot, geom) => {
      drawnTowerPoint = renderer.center(tower.coord, geom);
    });

    renderer.drawSnapshot(snapshot());
    expect(viewportFactory).toHaveBeenCalledTimes(2);
    expect(drawnTowerPoint).toEqual({ x: 700, y: 350 });
    expect(calls.world).toContainEqual({ x: 400, y: 400 });
    expect(renderer.pickTile({ clientX: 700, clientY: 350 }, tiles)).toEqual({ q: 1, r: 1 });
    expect(calls.screen).toContainEqual({ x: 700, y: 350 });
  });

  it("delegates bounded pan, zoom and reset controls to the active shared transform", () => {
    const transform = {
      worldToScreen: (point) => point,
      screenToWorld: (point) => point,
      panBy: vi.fn(() => ({ schemaVersion: 1, zoom: 1, offsetX: 10, offsetY: -5 })),
      zoomAt: vi.fn(() => ({ schemaVersion: 1, zoom: 2, offsetX: 0, offsetY: 0 })),
      reset: vi.fn(() => ({ schemaVersion: 1, zoom: 1, offsetX: 0, offsetY: 0 })),
      getSnapshot: () => ({ schemaVersion: 1, zoom: 1, offsetX: 0, offsetY: 0 })
    };
    const renderer = createCanvasRenderer({
      canvas: canvasFixture(),
      createViewportTransform: () => transform,
      viewportProfile: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 }
    });
    renderer.geometry(tiles, grid);

    expect(renderer.panViewportBy({ x: 10, y: -5 })).toEqual(expect.objectContaining({ offsetX: 10 }));
    expect(renderer.zoomViewportAt({ clientX: 400, clientY: 300 }, 2)).toEqual(expect.objectContaining({ zoom: 2 }));
    expect(renderer.resetViewport()).toEqual(expect.objectContaining({ zoom: 1 }));
    expect(transform.panBy).toHaveBeenCalledWith({ x: 10, y: -5 });
    expect(transform.zoomAt).toHaveBeenCalledWith({ x: 400, y: 300 }, 2);
    expect(transform.reset).toHaveBeenCalledTimes(1);
  });

  it("preserves legacy coordinates and hit-testing when no viewport factory is supplied", () => {
    const renderer = createCanvasRenderer({ canvas: canvasFixture() });
    const geom = renderer.geometry(tiles, grid);
    expect(renderer.center({ q: 0, r: 0 }, geom)).toEqual({ x: 200, y: 200 });
    expect(renderer.center({ q: 1, r: 1 }, geom)).toEqual({ x: 400, y: 400 });
    expect(renderer.pickTile({ clientX: 400, clientY: 400 }, tiles)).toEqual({ q: 1, r: 1 });
  });
});
