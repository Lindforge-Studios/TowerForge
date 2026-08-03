import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rendererSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");

function profile(overrides = {}) {
  return {
    schemaVersion: 1,
    projection: "isometric_2_1",
    orientation: "north",
    elevationScale: 2,
    fitPadding: 20,
    minZoom: 0.5,
    maxZoom: 3,
    initialZoom: 1,
    ...overrides
  };
}

function points() {
  return [
    { x: 0, y: 0, elevation: 0 },
    { x: 4, y: 0, elevation: 0 },
    { x: 0, y: 2, elevation: 0 },
    { x: 4, y: 2, elevation: 2 }
  ];
}

async function integrationApi() {
  return import("./camera-renderer-integration.mjs");
}

async function renderSpace(overrides = {}) {
  const { createCameraRenderSpaceV1 } = await integrationApi();
  return createCameraRenderSpaceV1({
    cameraProfile: profile(),
    worldPoints: points(),
    viewport: { width: 400, height: 300 },
    viewportProfile: { padding: 20, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    ...overrides
  });
}

describe("R20.2 shared camera renderer integration (RED)", () => {
  it("projects bounds before constructing the R18 ViewportTransform", async () => {
    const space = await renderSpace();
    expect(space).toMatchObject({
      schemaVersion: 1,
      active: true,
      projectedBounds: { minX: -2, minY: -1, maxX: 4, maxY: 2 }
    });
    expect(Object.isFrozen(space)).toBe(true);

    const world = { x: 4, y: 2, elevation: 2 };
    const projected = space.projector.worldToScreen(world);
    expect(projected).toEqual({ x: 2, y: -1 });
    expect(space.worldToScreen(world)).toEqual(space.viewportTransform.worldToScreen(projected));
  });

  it("inverts ViewportTransform before the camera projector for pointer hit testing", async () => {
    const space = await renderSpace();
    const world = { x: 3.25, y: 1.75, elevation: 1.5 };
    const screen = space.worldToScreen(world);
    const restored = space.screenToWorld(screen, world.elevation);
    expect(restored.x).toBeCloseTo(world.x, 10);
    expect(restored.y).toBeCloseTo(world.y, 10);
    expect(restored.elevation).toBe(world.elevation);

    const projected = space.viewportTransform.screenToWorld(screen);
    expect(space.projector.screenToWorld(projected, world.elevation)).toEqual(restored);
  });

  it("derives an input-order-invariant signature from projected bounds and profile", async () => {
    const forward = await renderSpace();
    const reversed = await renderSpace({ worldPoints: [...points()].reverse() });
    const rotated = await renderSpace({ cameraProfile: profile({ orientation: "east" }) });
    expect(forward.signature).toBe(reversed.signature);
    expect(rotated.signature).not.toBe(forward.signature);
    expect(forward.signature).toMatch(/isometric_2_1|camera-v1/i);
  });

  it("keeps top-down elevation-zero projection an identity before the viewport", async () => {
    const space = await renderSpace({
      cameraProfile: profile({ projection: "top_down", elevationScale: 0 }),
      worldPoints: [{ x: -2, y: -1, elevation: 0 }, { x: 5, y: 7, elevation: 0 }]
    });
    const world = { x: 3, y: 4, elevation: 0 };
    expect(space.projector.worldToScreen(world)).toEqual({ x: 3, y: 4 });
    expect(space.worldToScreen(world)).toEqual(space.viewportTransform.worldToScreen({ x: 3, y: 4 }));
  });

  it("aligns tiles, elevated entities and projectiles through one transform and stable depth order", async () => {
    const { projectCameraRenderItemsV1 } = await integrationApi();
    const space = await renderSpace();
    const items = [
      { id: "entity-2", kind: "tower", x: 4, y: 2, elevation: 1 },
      { id: "projectile", kind: "projectile", x: 4, y: 2, elevation: 3 },
      { id: "tile", kind: "tile", x: 4, y: 2, elevation: 0 },
      { id: "entity-10", kind: "enemy", x: 4, y: 2, elevation: 1 }
    ];
    const forward = projectCameraRenderItemsV1(space, items);
    const reversed = projectCameraRenderItemsV1(space, [...items].reverse());

    expect(forward).toEqual(reversed);
    expect(forward.map((item) => item.id)).toEqual(["projectile", "entity-10", "entity-2", "tile"]);
    for (const item of forward) {
      expect(item.screen).toEqual(space.worldToScreen({ x: item.x, y: item.y, elevation: item.elevation }));
      expect(Object.isFrozen(item)).toBe(true);
    }
  });

  it("accepts an empty first-frame actor list while retaining non-empty world bounds", async () => {
    const { projectCameraRenderItemsV1 } = await integrationApi();
    const space = await renderSpace();

    expect(projectCameraRenderItemsV1(space, [])).toEqual([]);
  });

  it("routes Canvas center, bounds, hit testing and draw ordering through the shared module", () => {
    expect(rendererSource).toMatch(/from\s+["']\.\/camera-renderer-integration\.mjs["']/);
    expect(rendererSource).toMatch(/createCameraRenderSpaceV1\s*\(/);
    expect(rendererSource).toMatch(/camera(?:Render)?Space\.worldToScreen\s*\(/);
    expect(rendererSource).toMatch(/camera(?:Render)?Space\.screenToWorld\s*\(/);
    expect(rendererSource).toMatch(/projectCameraRenderItemsV1\s*\(/);
    expect(rendererSource).not.toMatch(/function\s+(?:isometric|dimetric|cameraProject|projectCameraBasis)\w*\s*\(/i);
  });
});
