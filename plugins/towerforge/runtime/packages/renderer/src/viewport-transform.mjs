export const VIEWPORT_TRANSFORM_SCHEMA_VERSION = 1;

function finiteNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`);
  }
  return value;
}

function positiveNumber(value, field) {
  const number = finiteNumber(value, field);
  if (number <= 0) throw new RangeError(`${field} must be greater than zero.`);
  return number;
}

function point(value, field) {
  if (!value || typeof value !== "object") throw new TypeError(`${field} must be an object.`);
  return { x: finiteNumber(value.x, `${field}.x`), y: finiteNumber(value.y, `${field}.y`) };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createViewportTransformV1(options) {
  if (!options || typeof options !== "object") throw new TypeError("Viewport transform options must be an object.");
  const viewport = {
    width: positiveNumber(options.viewport?.width, "viewport.width"),
    height: positiveNumber(options.viewport?.height, "viewport.height")
  };
  const worldBounds = {
    minX: finiteNumber(options.worldBounds?.minX, "worldBounds.minX"),
    minY: finiteNumber(options.worldBounds?.minY, "worldBounds.minY"),
    maxX: finiteNumber(options.worldBounds?.maxX, "worldBounds.maxX"),
    maxY: finiteNumber(options.worldBounds?.maxY, "worldBounds.maxY")
  };
  const worldWidth = worldBounds.maxX - worldBounds.minX;
  const worldHeight = worldBounds.maxY - worldBounds.minY;
  if (worldWidth <= 0 || worldHeight <= 0) throw new RangeError("worldBounds must have positive width and height.");

  const padding = finiteNumber(options.padding ?? 0, "padding");
  if (padding < 0 || padding * 2 >= viewport.width || padding * 2 >= viewport.height) {
    throw new RangeError("padding must leave a positive viewport area.");
  }
  const minZoom = positiveNumber(options.minZoom ?? 0.5, "minZoom");
  const maxZoom = positiveNumber(options.maxZoom ?? 4, "maxZoom");
  if (minZoom > maxZoom) throw new RangeError("minZoom must not exceed maxZoom.");

  const containZoom = Math.min(
    (viewport.width - padding * 2) / worldWidth,
    (viewport.height - padding * 2) / worldHeight
  );
  const initialZoom = clamp(
    options.initialZoom === undefined ? containZoom : finiteNumber(options.initialZoom, "initialZoom"),
    minZoom,
    maxZoom
  );
  const initial = Object.freeze({
    zoom: initialZoom,
    offsetX: (viewport.width - worldWidth * initialZoom) / 2 - worldBounds.minX * initialZoom,
    offsetY: (viewport.height - worldHeight * initialZoom) / 2 - worldBounds.minY * initialZoom
  });
  let state = { ...initial };

  const panLimits = (zoom) => {
    const scaledWidth = worldWidth * zoom;
    const scaledHeight = worldHeight * zoom;
    const minOffsetX = viewport.width - padding - worldBounds.maxX * zoom;
    const maxOffsetX = padding - worldBounds.minX * zoom;
    const minOffsetY = viewport.height - padding - worldBounds.maxY * zoom;
    const maxOffsetY = padding - worldBounds.minY * zoom;
    return {
      minOffsetX: scaledWidth <= viewport.width - padding * 2 ? (viewport.width - scaledWidth) / 2 - worldBounds.minX * zoom : minOffsetX,
      maxOffsetX: scaledWidth <= viewport.width - padding * 2 ? (viewport.width - scaledWidth) / 2 - worldBounds.minX * zoom : maxOffsetX,
      minOffsetY: scaledHeight <= viewport.height - padding * 2 ? (viewport.height - scaledHeight) / 2 - worldBounds.minY * zoom : minOffsetY,
      maxOffsetY: scaledHeight <= viewport.height - padding * 2 ? (viewport.height - scaledHeight) / 2 - worldBounds.minY * zoom : maxOffsetY
    };
  };
  const bounded = (candidate) => {
    const limits = panLimits(candidate.zoom);
    return {
      zoom: candidate.zoom,
      offsetX: clamp(candidate.offsetX, Math.min(limits.minOffsetX, limits.maxOffsetX), Math.max(limits.minOffsetX, limits.maxOffsetX)),
      offsetY: clamp(candidate.offsetY, Math.min(limits.minOffsetY, limits.maxOffsetY), Math.max(limits.minOffsetY, limits.maxOffsetY))
    };
  };

  const worldToScreen = (value) => {
    const target = point(value, "worldPoint");
    return Object.freeze({ x: target.x * state.zoom + state.offsetX, y: target.y * state.zoom + state.offsetY });
  };
  const screenToWorld = (value) => {
    const target = point(value, "screenPoint");
    return Object.freeze({ x: (target.x - state.offsetX) / state.zoom, y: (target.y - state.offsetY) / state.zoom });
  };
  const panBy = (delta) => {
    const amount = point(delta, "delta");
    state = bounded({ ...state, offsetX: state.offsetX + amount.x, offsetY: state.offsetY + amount.y });
    return getSnapshot();
  };
  const zoomAt = (anchorValue, requestedZoom) => {
    const anchor = point(anchorValue, "anchor");
    const nextZoom = clamp(positiveNumber(requestedZoom, "zoom"), minZoom, maxZoom);
    const worldAnchor = screenToWorld(anchor);
    state = bounded({
      zoom: nextZoom,
      offsetX: anchor.x - worldAnchor.x * nextZoom,
      offsetY: anchor.y - worldAnchor.y * nextZoom
    });
    return getSnapshot();
  };
  const reset = () => {
    state = { ...initial };
    return getSnapshot();
  };
  function getSnapshot() {
    return Object.freeze({ schemaVersion: VIEWPORT_TRANSFORM_SCHEMA_VERSION, ...state });
  }

  return Object.freeze({ worldToScreen, screenToWorld, panBy, zoomAt, reset, getSnapshot });
}
