import {
  compareCameraDepthKeysV1,
  createCameraProjectorV1,
  resolveCameraProfileV1
} from "./camera-projector.mjs";
import { createViewportTransformV1 } from "./viewport-transform.mjs";

export const CAMERA_RENDER_SPACE_SCHEMA_VERSION = 1;
export { resolveCameraProfileV1 } from "./camera-projector.mjs";

function finite(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`);
  }
  return value;
}

function ownRecord(value, keys, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be a closed own-data object.`);
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("prototype");
  } catch {
    throw new TypeError(`${field} must be an inspectable plain own-data object.`);
  }
  const allowed = new Set(keys);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowed.has(key)) throw new TypeError(`${field}.${key} is not supported.`);
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${field}.${key} must be an enumerable own data property.`);
    }
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function denseArray(value, field, limit) {
  if (!Array.isArray(value) || value.length === 0 || value.length > limit) {
    throw new TypeError(`${field} must contain 1 to ${limit} entries.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${field}[${index}] must be a dense own-data entry.`);
    }
  }
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)].value);
}

function worldPoint(value, field) {
  const row = ownRecord(value, ["x", "y", "elevation"], field);
  return Object.freeze({
    x: finite(row.x, `${field}.x`),
    y: finite(row.y, `${field}.y`),
    elevation: finite(row.elevation ?? 0, `${field}.elevation`)
  });
}

function stableNumber(value) {
  return Object.is(value, -0) ? "0" : Number(value).toString();
}

export function createCameraRenderSpaceV1(options) {
  const input = ownRecord(options, ["cameraProfile", "worldPoints", "viewport", "viewportProfile"], "cameraRenderSpace");
  const projector = createCameraProjectorV1(input.cameraProfile);
  const points = denseArray(input.worldPoints, "cameraRenderSpace.worldPoints", 262_144)
    .map((entry, index) => worldPoint(entry, `cameraRenderSpace.worldPoints[${index}]`));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const projected = projector.worldToScreen(point);
    minX = Math.min(minX, projected.x);
    minY = Math.min(minY, projected.y);
    maxX = Math.max(maxX, projected.x);
    maxY = Math.max(maxY, projected.y);
  }
  if (minX === maxX) { minX -= 0.5; maxX += 0.5; }
  if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
  const projectedBounds = Object.freeze({ minX, minY, maxX, maxY });
  const viewport = ownRecord(input.viewport, ["width", "height"], "cameraRenderSpace.viewport");
  const viewportProfile = ownRecord(input.viewportProfile, ["padding", "minZoom", "maxZoom", "initialZoom"], "cameraRenderSpace.viewportProfile");
  const viewportSize = {
    width: finite(viewport.width, "cameraRenderSpace.viewport.width"),
    height: finite(viewport.height, "cameraRenderSpace.viewport.height")
  };
  const authoredPadding = finite(projector.profile.fitPadding ?? viewportProfile.padding ?? 0, "cameraRenderSpace.padding");
  const effectivePadding = Math.min(authoredPadding, Math.max(0, (Math.min(viewportSize.width, viewportSize.height) - 1) / 2));
  const viewportTransform = createViewportTransformV1({
    viewport: viewportSize,
    worldBounds: projectedBounds,
    padding: effectivePadding,
    panPadding: finite(projector.profile.panPadding ?? 0, "cameraRenderSpace.panPadding"),
    minZoom: finite(projector.profile.minZoom ?? viewportProfile.minZoom, "cameraRenderSpace.minZoom"),
    maxZoom: finite(projector.profile.maxZoom ?? viewportProfile.maxZoom, "cameraRenderSpace.maxZoom"),
    initialZoom: finite(projector.profile.initialZoom ?? viewportProfile.initialZoom, "cameraRenderSpace.initialZoom")
  });
  const worldToScreen = (value) => viewportTransform.worldToScreen(projector.worldToScreen(value));
  const screenToWorld = (value, elevation = 0) => projector.screenToWorld(viewportTransform.screenToWorld(value), elevation);
  const profile = projector.profile;
  const signature = [
    "camera-v1", profile.projection, profile.orientation, stableNumber(profile.elevationScale),
    stableNumber(profile.fitPadding), stableNumber(profile.panPadding), stableNumber(profile.minZoom), stableNumber(profile.initialZoom),
    stableNumber(profile.maxZoom), stableNumber(minX), stableNumber(minY), stableNumber(maxX), stableNumber(maxY)
  ].join("|");
  return Object.freeze({
    schemaVersion: CAMERA_RENDER_SPACE_SCHEMA_VERSION,
    active: true,
    signature,
    profile,
    projector,
    projectedBounds,
    viewportTransform,
    worldToScreen,
    screenToWorld
  });
}

export function projectCameraRenderItemsV1(space, unsafeItems) {
  if (!space || space.schemaVersion !== 1 || typeof space.worldToScreen !== "function" || !space.projector) {
    throw new TypeError("space must be a CameraRenderSpaceV1 instance.");
  }
  const items = denseArray(unsafeItems, "cameraRenderItems", 262_144).map((value, index) => {
    const row = ownRecord(value, ["id", "kind", "x", "y", "elevation"], `cameraRenderItems[${index}]`);
    if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256) {
      throw new TypeError(`cameraRenderItems[${index}].id must be a bounded non-empty string.`);
    }
    if (typeof row.kind !== "string" || row.kind.length === 0 || row.kind.length > 64) {
      throw new TypeError(`cameraRenderItems[${index}].kind must be a bounded non-empty string.`);
    }
    const point = {
      x: finite(row.x, `cameraRenderItems[${index}].x`),
      y: finite(row.y, `cameraRenderItems[${index}].y`),
      elevation: finite(row.elevation ?? 0, `cameraRenderItems[${index}].elevation`)
    };
    const depthKey = space.projector.depthKey({ ...point, entityId: row.id });
    return Object.freeze({ ...row, ...point, screen: space.worldToScreen(point), depthKey });
  });
  items.sort((left, right) => compareCameraDepthKeysV1(left.depthKey, right.depthKey));
  return Object.freeze(items);
}
