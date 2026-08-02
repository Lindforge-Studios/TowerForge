import { describe, expect, it } from "vitest";
import { createViewportTransformV1 } from "./viewport-transform.mjs";

const options = {
  viewport: { width: 1600, height: 900 },
  worldBounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
  padding: 100, minZoom: 0.5, maxZoom: 3
};

function closePoint(actual, expected) {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
}

describe("ViewportTransformV1 shared renderer contract (RED)", () => {
  it("contains and centers the authored world with a stable golden transform", () => {
    const transform = createViewportTransformV1(options);
    expect(Object.isFrozen(transform)).toBe(true);
    closePoint(transform.worldToScreen({ x: 0, y: 0 }), { x: 450, y: 100 });
    closePoint(transform.worldToScreen({ x: 500, y: 500 }), { x: 800, y: 450 });
    closePoint(transform.worldToScreen({ x: 1000, y: 1000 }), { x: 1150, y: 800 });
    expect(transform.getSnapshot()).toMatchObject({ schemaVersion: 1, zoom: 0.7, offsetX: 450, offsetY: 100 });
  });

  it("round-trips arbitrary finite points through the inverse transform", () => {
    const transform = createViewportTransformV1({ ...options, initialZoom: 1.25 });
    for (const point of [{ x: 0, y: 0 }, { x: 123.5, y: 678.25 }, { x: 1000, y: 1000 }]) {
      closePoint(transform.screenToWorld(transform.worldToScreen(point)), point);
    }
  });

  it("keeps the zoom anchor fixed and clamps zoom and pan to authored bounds", () => {
    const transform = createViewportTransformV1(options);
    const anchor = { x: 900, y: 400 };
    const anchoredWorld = transform.screenToWorld(anchor);
    transform.zoomAt(anchor, 99);
    expect(transform.getSnapshot().zoom).toBe(3);
    closePoint(transform.worldToScreen(anchoredWorld), anchor);
    transform.panBy({ x: 100000, y: -100000 });
    const snapshot = transform.getSnapshot();
    expect(snapshot.offsetX).toBeLessThanOrEqual(options.viewport.width - options.padding);
    expect(snapshot.offsetY).toBeGreaterThanOrEqual(options.padding - (options.worldBounds.maxY - options.worldBounds.minY) * snapshot.zoom);
  });

  it("reset restores the exact contain transform after pan and zoom", () => {
    const transform = createViewportTransformV1({ ...options, initialZoom: 2 });
    const initial = transform.getSnapshot();
    transform.panBy({ x: -200, y: 150 });
    transform.zoomAt({ x: 800, y: 450 }, 0.1);
    transform.reset();
    expect(transform.getSnapshot()).toEqual(initial);
  });

  it.each([
    { ...options, viewport: { width: 0, height: 900 } },
    { ...options, worldBounds: { minX: 1, minY: 0, maxX: 1, maxY: 5 } },
    { ...options, padding: -1 },
    { ...options, minZoom: 2, maxZoom: 1 },
    { ...options, initialZoom: Number.NaN }
  ])("rejects malformed or non-finite transform input", (candidate) => {
    expect(() => createViewportTransformV1(candidate)).toThrow();
  });
});
