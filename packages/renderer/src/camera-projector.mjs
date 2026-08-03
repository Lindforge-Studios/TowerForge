export const CAMERA_PROFILE_SCHEMA_VERSION = 1;

const PROJECTIONS = new Set(["top_down", "isometric_2_1", "dimetric_oblique"]);
const ORIENTATIONS = new Set(["north", "east", "south", "west"]);
const PROFILE_KEYS = Object.freeze([
  "schemaVersion", "projection", "orientation", "elevationScale", "fitPadding",
  "minZoom", "maxZoom", "initialZoom", "panPadding"
]);

function ownDescriptors(value, allowedKeys, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be a closed own-data object.`);
  }
  let descriptors;
  let prototype;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new TypeError(`${field} must be an inspectable own-data object.`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${field} must be a plain own-data object.`);
  }
  const allowed = new Set(allowedKeys);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowed.has(key)) throw new TypeError(`${field}.${key} is not supported.`);
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${field}.${key} must be an enumerable own data property; accessors are not allowed.`);
    }
  }
  return descriptors;
}

function ownValue(descriptors, key) {
  return descriptors[key]?.value;
}

function finite(value, field, min = -Infinity, max = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${field} must be a finite number from ${min} to ${max}.`);
  }
  return value;
}

function boundedInteger(value, field, min, max, fallback) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) {
    throw new TypeError(`${field} must be an integer from ${min} to ${max}.`);
  }
  return candidate;
}

function identifier(value, field, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || value.length === 0 || new TextEncoder().encode(value).byteLength > 128) {
    throw new TypeError(`${field} must be a non-empty identifier no greater than 128 UTF-8 bytes.`);
  }
  return value;
}

function compileProfile(value, field = "cameraProfile") {
  const descriptors = ownDescriptors(value, PROFILE_KEYS, field);
  const schemaVersion = ownValue(descriptors, "schemaVersion");
  if (schemaVersion !== CAMERA_PROFILE_SCHEMA_VERSION) {
    throw new TypeError(`${field}.schemaVersion must be supported version ${CAMERA_PROFILE_SCHEMA_VERSION}.`);
  }
  const projection = ownValue(descriptors, "projection");
  if (!PROJECTIONS.has(projection)) throw new TypeError(`${field}.projection is unsupported.`);
  const orientation = ownValue(descriptors, "orientation");
  if (!ORIENTATIONS.has(orientation)) throw new TypeError(`${field}.orientation is unsupported.`);
  const elevationScale = finite(ownValue(descriptors, "elevationScale"), `${field}.elevationScale`, 0, 4);
  const fitPadding = boundedInteger(ownValue(descriptors, "fitPadding"), `${field}.fitPadding`, 0, 512, 0);
  const minZoom = finite(ownValue(descriptors, "minZoom"), `${field}.minZoom`, 0.1, 8);
  const maxZoom = finite(ownValue(descriptors, "maxZoom"), `${field}.maxZoom`, 0.1, 8);
  const initialZoom = finite(ownValue(descriptors, "initialZoom"), `${field}.initialZoom`, 0.1, 8);
  if (minZoom > initialZoom || initialZoom > maxZoom) {
    throw new TypeError(`${field} zoom range must satisfy minZoom <= initialZoom <= maxZoom.`);
  }
  const panPadding = boundedInteger(ownValue(descriptors, "panPadding"), `${field}.panPadding`, 0, 2048, 0);
  return Object.freeze({
    schemaVersion, projection, orientation, elevationScale, fitPadding,
    minZoom, maxZoom, initialZoom, panPadding
  });
}

function point(value, field, includeElevation) {
  const allowed = includeElevation ? ["x", "y", "elevation", "entityId"] : ["x", "y"];
  const descriptors = ownDescriptors(value, allowed, field);
  const elevationValue = ownValue(descriptors, "elevation");
  return {
    x: finite(ownValue(descriptors, "x"), `${field}.x`),
    y: finite(ownValue(descriptors, "y"), `${field}.y`),
    elevation: includeElevation ? finite(elevationValue ?? 0, `${field}.elevation`) : 0,
    entityId: includeElevation ? ownValue(descriptors, "entityId") : undefined
  };
}

function rotate(x, y, orientation) {
  if (orientation === "east") return { x: -y, y: x };
  if (orientation === "south") return { x: -x, y: -y };
  if (orientation === "west") return { x: y, y: -x };
  return { x, y };
}

function unrotate(x, y, orientation) {
  if (orientation === "east") return { x: y, y: -x };
  if (orientation === "south") return { x: -x, y: -y };
  if (orientation === "west") return { x: -y, y: x };
  return { x, y };
}

function projectBasis(x, y, projection) {
  if (projection === "isometric_2_1") return { x: x - y, y: (x + y) / 2 };
  if (projection === "dimetric_oblique") return { x: x - y / 2, y: x / 2 + y * 0.75 };
  return { x, y };
}

function inverseBasis(x, y, projection) {
  if (projection === "isometric_2_1") return { x: y + x / 2, y: y - x / 2 };
  if (projection === "dimetric_oblique") {
    return { x: 0.75 * x + 0.5 * y, y: -0.5 * x + y };
  }
  return { x, y };
}

export function compareCameraDepthKeysV1(leftValue, rightValue) {
  const left = depthKeyRecord(leftValue, "leftDepthKey");
  const right = depthKeyRecord(rightValue, "rightDepthKey");
  if (left.projectedY !== right.projectedY) return left.projectedY - right.projectedY;
  if (left.elevation !== right.elevation) return left.elevation - right.elevation;
  return left.entityId < right.entityId ? -1 : left.entityId > right.entityId ? 1 : 0;
}

function depthKeyRecord(value, field) {
  const descriptors = ownDescriptors(value, ["projectedY", "elevation", "entityId"], field);
  return {
    projectedY: finite(ownValue(descriptors, "projectedY"), `${field}.projectedY`),
    elevation: finite(ownValue(descriptors, "elevation"), `${field}.elevation`),
    entityId: identifier(ownValue(descriptors, "entityId"), `${field}.entityId`)
  };
}

export function createCameraProjectorV1(unsafeProfile) {
  const profile = compileProfile(unsafeProfile);
  const projectWithoutElevation = (world) => {
    const rotated = rotate(world.x, world.y, profile.orientation);
    return projectBasis(rotated.x, rotated.y, profile.projection);
  };
  const worldToScreen = (unsafePoint) => {
    const world = point(unsafePoint, "worldPoint", true);
    const projected = projectWithoutElevation(world);
    return Object.freeze({ x: projected.x, y: projected.y - world.elevation * profile.elevationScale });
  };
  const screenToWorld = (unsafePoint, unsafeElevation = 0) => {
    const screen = point(unsafePoint, "screenPoint", false);
    const elevation = finite(unsafeElevation, "elevation");
    const basis = inverseBasis(screen.x, screen.y + elevation * profile.elevationScale, profile.projection);
    const world = unrotate(basis.x, basis.y, profile.orientation);
    return Object.freeze({ x: world.x, y: world.y, elevation });
  };
  const depthKey = (unsafePoint) => {
    const world = point(unsafePoint, "depthPoint", true);
    const entityId = identifier(world.entityId, "depthPoint.entityId");
    const projected = projectWithoutElevation(world);
    return Object.freeze({
      projectedY: projected.y - world.elevation * profile.elevationScale,
      elevation: world.elevation,
      entityId
    });
  };
  return Object.freeze({ schemaVersion: 1, profile, worldToScreen, screenToWorld, depthKey });
}

function catalogEntries(value, field, limit) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be a closed own-data catalog.`);
  }
  let descriptors;
  let prototype;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new TypeError(`${field} must be an inspectable own-data catalog.`);
  }
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${field} must be a plain own-data catalog.`);
  const entries = Object.entries(descriptors);
  if (entries.length > limit) throw new RangeError(`${field} exceeds its ${limit}-entry budget.`);
  return entries.map(([id, descriptor]) => {
    identifier(id, `${field} id`);
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${field}.${id} must be an enumerable own data property; accessors are not allowed.`);
    }
    return [id, descriptor.value];
  });
}

function compileBindings(value, profileIds) {
  const descriptors = ownDescriptors(value, ["defaultProfileId", "maps", "missions"], "cameraProfiles.bindings");
  const compileMap = (key) => {
    const result = {};
    const raw = ownValue(descriptors, key) ?? {};
    for (const [id, profileId] of catalogEntries(raw, `cameraProfiles.bindings.${key}`, 1024)) {
      identifier(profileId, `cameraProfiles.bindings.${key}.${id}`);
      if (!profileIds.has(profileId)) throw new TypeError(`cameraProfiles.bindings.${key}.${id} references unknown profile "${profileId}".`);
      result[id] = profileId;
    }
    return Object.freeze(result);
  };
  const defaultProfileId = identifier(ownValue(descriptors, "defaultProfileId"), "cameraProfiles.bindings.defaultProfileId", { optional: true });
  if (defaultProfileId !== undefined && !profileIds.has(defaultProfileId)) {
    throw new TypeError(`cameraProfiles.bindings.defaultProfileId references unknown profile "${defaultProfileId}".`);
  }
  return Object.freeze({
    ...(defaultProfileId === undefined ? {} : { defaultProfileId }),
    maps: compileMap("maps"),
    missions: compileMap("missions")
  });
}

function compileCatalog(unsafeCatalog) {
  const descriptors = ownDescriptors(unsafeCatalog, ["schemaVersion", "profiles", "bindings"], "cameraProfiles");
  if (ownValue(descriptors, "schemaVersion") !== 1) {
    throw new TypeError("cameraProfiles.schemaVersion must be supported version 1.");
  }
  const profiles = {};
  for (const [id, value] of catalogEntries(ownValue(descriptors, "profiles"), "cameraProfiles.profiles", 32)) {
    profiles[id] = compileProfile(value, `cameraProfiles.profiles.${id}`);
  }
  const profileIds = new Set(Object.keys(profiles));
  const bindings = compileBindings(ownValue(descriptors, "bindings"), profileIds);
  return Object.freeze({ schemaVersion: 1, profiles: Object.freeze(profiles), bindings });
}

export function validateCameraProfileCatalogV1(unsafeCatalog) {
  try {
    return Object.freeze({ ok: true, catalog: compileCatalog(unsafeCatalog) });
  } catch (error) {
    return Object.freeze({ ok: false, error });
  }
}

function contextValue(context, key) {
  if (context === undefined) return undefined;
  const descriptors = ownDescriptors(context, ["missionId", "mapId", "buildTargetCameraProfileId"], "cameraContext");
  const value = ownValue(descriptors, key);
  return value === undefined ? undefined : identifier(value, `cameraContext.${key}`);
}

const FALLBACK_PROFILE = Object.freeze({
  schemaVersion: 1,
  projection: "top_down",
  orientation: "north",
  elevationScale: 0,
  fitPadding: 0,
  minZoom: 0.5,
  maxZoom: 4,
  initialZoom: 1,
  panPadding: 0
});

export function resolveCameraProfileV1(unsafeCatalog, context = {}) {
  const catalog = compileCatalog(unsafeCatalog);
  const missionId = contextValue(context, "missionId");
  const mapId = contextValue(context, "mapId");
  const buildTargetProfileId = contextValue(context, "buildTargetCameraProfileId");
  const selected = missionId && catalog.bindings.missions[missionId]
    ? { profileId: catalog.bindings.missions[missionId], source: "mission" }
    : mapId && catalog.bindings.maps[mapId]
      ? { profileId: catalog.bindings.maps[mapId], source: "map" }
      : buildTargetProfileId
        ? { profileId: buildTargetProfileId, source: "build_target" }
        : catalog.bindings.defaultProfileId
          ? { profileId: catalog.bindings.defaultProfileId, source: "default" }
          : null;
  if (!selected) return Object.freeze({ profileId: null, source: "top_down_fallback", profile: FALLBACK_PROFILE });
  const profile = catalog.profiles[selected.profileId];
  if (!profile) throw new TypeError(`Camera ${selected.source} references unknown profile "${selected.profileId}".`);
  return Object.freeze({ ...selected, profile });
}
