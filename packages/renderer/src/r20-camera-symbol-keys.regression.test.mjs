import { describe, expect, it } from "vitest";
import {
  createCameraProjectorV1,
  resolveCameraProfileV1,
  validateCameraProfileCatalogV1
} from "./camera-projector.mjs";
import {
  createCameraRenderSpaceV1,
  projectCameraRenderItemsV1
} from "./camera-renderer-integration.mjs";

function withHiddenSymbol(value) {
  Object.defineProperty(value, Symbol("hidden-camera-field"), {
    value: "must-not-be-ignored",
    enumerable: true,
    configurable: true
  });
  return value;
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

function catalog() {
  return {
    schemaVersion: 1,
    profiles: { iso: profile() },
    bindings: { maps: {}, missions: {} }
  };
}

function renderOptions() {
  return {
    cameraProfile: profile(),
    worldPoints: [
      { x: 0, y: 0, elevation: 0 },
      { x: 2, y: 2, elevation: 1 }
    ],
    viewport: { width: 640, height: 480 },
    viewportProfile: { padding: 24, minZoom: 0.5, maxZoom: 3, initialZoom: 1 }
  };
}

describe("R20 closed camera contracts reject symbol-keyed own data (RED)", () => {
  it("rejects symbols on profiles, catalogs, nested catalogs, contexts and projector points", () => {
    expect(() => createCameraProjectorV1(withHiddenSymbol(profile()))).toThrow(/symbol|own-data|supported/i);

    const root = withHiddenSymbol(catalog());
    expect(validateCameraProfileCatalogV1(root)).toMatchObject({ ok: false });

    const nested = catalog();
    withHiddenSymbol(nested.profiles);
    expect(validateCameraProfileCatalogV1(nested)).toMatchObject({ ok: false });

    expect(() => resolveCameraProfileV1(catalog(), withHiddenSymbol({ buildTargetCameraProfileId: "iso" })))
      .toThrow(/symbol|own-data|supported/i);

    const projector = createCameraProjectorV1(profile());
    expect(() => projector.worldToScreen(withHiddenSymbol({ x: 1, y: 2, elevation: 0 })))
      .toThrow(/symbol|own-data|supported/i);
  });

  it("rejects symbols on render-space options, nested records and dense arrays", () => {
    expect(() => createCameraRenderSpaceV1(withHiddenSymbol(renderOptions())))
      .toThrow(/symbol|own-data|supported/i);

    const viewport = renderOptions();
    withHiddenSymbol(viewport.viewport);
    expect(() => createCameraRenderSpaceV1(viewport)).toThrow(/symbol|own-data|supported/i);

    const worldPoints = renderOptions();
    withHiddenSymbol(worldPoints.worldPoints);
    expect(() => createCameraRenderSpaceV1(worldPoints)).toThrow(/symbol|own-data|supported/i);

    const point = renderOptions();
    withHiddenSymbol(point.worldPoints[0]);
    expect(() => createCameraRenderSpaceV1(point)).toThrow(/symbol|own-data|supported/i);
  });

  it("rejects symbols on projected item arrays and item records", () => {
    const space = createCameraRenderSpaceV1(renderOptions());
    const items = [{ id: "tower_1", kind: "tower", x: 1, y: 1, elevation: 0 }];
    expect(() => projectCameraRenderItemsV1(space, withHiddenSymbol(items)))
      .toThrow(/symbol|own-data|supported/i);
    expect(() => projectCameraRenderItemsV1(space, [withHiddenSymbol(items[0])]))
      .toThrow(/symbol|own-data|supported/i);
  });
});
