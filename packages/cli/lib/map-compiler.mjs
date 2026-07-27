import fs from "node:fs";
import path from "node:path";

// Tiled tile GID ↔ terrain mapping. Authoring tools (Tiled or the Studio map editor) paint a
// "terrain" tilelayer whose GIDs translate to engine terrain kinds.
export const TERRAIN_BY_GID = { 1: "buildable", 2: "path", 3: "blocked", 4: "water", 5: "spawn", 6: "core" };
export const GID_BY_TERRAIN = { buildable: 1, path: 2, blocked: 3, water: 4, spawn: 5, core: 6 };
export const MAX_ELEVATION_OVERRIDES = 65_536;
export const MIN_TILE_ELEVATION = -1_000_000;
export const MAX_TILE_ELEVATION = 1_000_000;

export function readMapSources(projectDir) {
  const srcDir = path.join(projectDir, "maps", "src");
  if (!fs.existsSync(srcDir)) return {};
  const sources = {};
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".tmj")) continue;
    const filePath = path.join(srcDir, entry.name);
    sources[entry.name] = JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  return sources;
}

export function compileMapSources(mapSources, terrainTypes = {}) {
  const maps = {};
  const issues = [];
  for (const [sourceName, source] of Object.entries(mapSources)) {
    try {
      const map = compileMapSource(source, sourceName, terrainTypes);
      maps[map.id] = map;
    } catch (error) {
      issues.push({
        severity: "error",
        entityKind: "mapSource",
        entityId: sourceName,
        fieldPath: "root",
        message: error.message
      });
    }
  }
  return {
    ok: issues.filter((issue) => issue.severity === "error").length === 0,
    maps,
    issues
  };
}

export function compileMapSource(source, sourceName = "map.tmj", terrainTypes = {}) {
  if (!source || typeof source !== "object") {
    throw new Error(`Map source "${sourceName}" must be an object.`);
  }
  const properties = propertiesToObject(source.properties);
  const id = String(properties.id ?? source.id ?? path.basename(sourceName, ".tmj"));
  const width = requirePositiveInteger(source.width, `${sourceName}.width`);
  const height = requirePositiveInteger(source.height, `${sourceName}.height`);
  const defaultTerrain = String(properties.defaultTerrain ?? source.defaultTerrain ?? "buildable");
  const grid = resolveGrid(source, properties, sourceName);
  const spawnCoord = parseCoord(properties.spawnCoord ?? source.spawnCoord, `${sourceName}.spawnCoord`);
  const coreCoord = parseCoord(properties.coreCoord ?? source.coreCoord, `${sourceName}.coreCoord`);
  const pathCenterline = parseCoordArray(properties.pathCenterline ?? source.pathCenterline, `${sourceName}.pathCenterline`);
  const layerOverrides = readTerrainLayer(source, defaultTerrain, width, height);
  const explicitOverrides = normalizeTerrainOverrides(source.terrainOverrides ?? parseJson(properties.terrainOverrides, []), `${sourceName}.terrainOverrides`);
  const terrainOverrides = mergeTerrainOverrides(layerOverrides, explicitOverrides);
  const elevationOverrides = readElevationOverrides(source, properties, width, height, sourceName);
  const pathRoutes = normalizeRoutes(source.pathRoutes ?? parseJson(properties.pathRoutes, []), pathCenterline, `${sourceName}.pathRoutes`);
  validateRoutes(pathRoutes, grid, width, height, defaultTerrain, terrainOverrides, terrainTypes, sourceName);

  const compiled = {
    id,
    width,
    height,
    grid,
    defaultTerrain,
    spawnCoord,
    coreCoord,
    pathCenterline,
    pathRoutes,
    terrainOverrides
  };
  if (elevationOverrides.length > 0) compiled.elevationOverrides = elevationOverrides;
  return compiled;
}

/**
 * Compile the optional authored elevation layer. The sparse list is deliberately stricter than
 * ordinary map metadata: it is gameplay content, so accessors, inherited fields, sparse arrays,
 * duplicates, and non-canonical numeric values are rejected before anything reads them.
 */
function readElevationOverrides(source, properties, width, height, sourceName) {
  let sourceDescriptor = Object.getOwnPropertyDescriptor(source, "elevationOverrides");
  if (sourceDescriptor && !("value" in sourceDescriptor)) {
    throw new Error(`${sourceName}.elevationOverrides must be an own data property; accessors are not allowed.`);
  }
  // Treat an explicitly undefined optional field as absent. This preserves callers that construct
  // legacy source objects with `elevationOverrides: undefined` while still rejecting every other
  // malformed authored value.
  if (sourceDescriptor?.value === undefined) sourceDescriptor = undefined;
  const propertyDescriptor = Object.getOwnPropertyDescriptor(properties, "elevationOverrides");
  if (sourceDescriptor && propertyDescriptor) {
    throw new Error(`${sourceName}.elevationOverrides is ambiguous: author it either at the top level or as a Tiled property, not both.`);
  }
  if (!sourceDescriptor && !propertyDescriptor) return [];

  const authored = sourceDescriptor ? sourceDescriptor.value : propertyDescriptor.value;
  const parsed = parseStrictJson(authored, `${sourceName}.elevationOverrides`);
  return normalizeElevationOverrides(parsed, width, height, `${sourceName}.elevationOverrides`);
}

export function normalizeElevationOverrides(value, width, height, fieldPath = "elevationOverrides") {
  if (!Array.isArray(value)) throw new Error(`${fieldPath} must be a dense array.`);
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error(`${fieldPath} must be an ordinary array.`);
  }
  if (value.length > MAX_ELEVATION_OVERRIDES) {
    throw new Error(`${fieldPath} may contain at most ${MAX_ELEVATION_OVERRIDES} entries.`);
  }
  const arrayDescriptors = Object.getOwnPropertyDescriptors(value);
  const expectedArrayKeys = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
  if (Reflect.ownKeys(arrayDescriptors).some((key) => typeof key !== "string" || !expectedArrayKeys.has(key))) {
    throw new Error(`${fieldPath} must be an ordinary dense array without extra fields.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = arrayDescriptors[index];
    if (!descriptor) throw new Error(`${fieldPath} must be a dense array (missing index ${index}).`);
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(`${fieldPath}.${index} must be an enumerable own data property; accessors are not allowed.`);
    }
  }

  const seen = new Set();
  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = arrayDescriptors[index].value;
    const entryPath = `${fieldPath}.${index}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${entryPath} must be a plain object with q, r, and elevation data fields.`);
    }
    const prototype = Object.getPrototypeOf(entry);
    if (prototype !== Object.prototype) {
      throw new Error(`${entryPath} must be an ordinary plain object with Object.prototype.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 3 || !keys.every((key) => typeof key === "string" && ["q", "r", "elevation"].includes(key))) {
      throw new Error(`${entryPath} must contain exactly the q, r, and elevation fields.`);
    }
    for (const key of ["q", "r", "elevation"]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error(`${entryPath}.${key} must be an enumerable own data property; accessors are not allowed.`);
      }
    }
    const q = descriptors.q.value;
    const r = descriptors.r.value;
    const elevation = descriptors.elevation.value;
    if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) {
      throw new Error(`${entryPath} coordinate q/r must be safe integers.`);
    }
    if (q < 0 || r < 0 || q >= width || r >= height) {
      throw new Error(`${entryPath} coordinate is outside map bounds.`);
    }
    if (!Number.isSafeInteger(elevation) || elevation < MIN_TILE_ELEVATION || elevation > MAX_TILE_ELEVATION) {
      throw new Error(`${entryPath}.elevation must be an integer from ${MIN_TILE_ELEVATION} to ${MAX_TILE_ELEVATION}.`);
    }
    const key = `${q},${r}`;
    if (seen.has(key)) throw new Error(`${entryPath} duplicates elevation coordinate (${q}, ${r}).`);
    seen.add(key);
    if (elevation !== 0) normalized.push({ q, r, elevation });
  }
  normalized.sort((left, right) => left.r - right.r || left.q - right.q);
  return normalized;
}

function resolveGrid(source, properties, sourceName) {
  const explicit = properties["towerforge.gridKind"] ?? properties.gridKind ?? source.gridKind;
  if (explicit === "square" || (!explicit && source.orientation === "orthogonal")) {
    return { kind: "square", adjacency: "cardinal" };
  }
  if (explicit === undefined || explicit === "hex" || source.orientation === "hexagonal") {
    if (source.orientation === "hexagonal" && source.staggeraxis && source.staggeraxis !== "y") {
      throw new Error(`${sourceName}.staggeraxis must be "y" for odd-r hex maps.`);
    }
    return { kind: "hex", layout: "odd-r" };
  }
  throw new Error(`${sourceName} has unsupported grid kind "${String(explicit)}".`);
}

function validateRoutes(pathRoutes, grid, width, height, defaultTerrain, terrainOverrides, terrainTypes, sourceName) {
  const overrides = new Map(terrainOverrides.map((entry) => [`${entry.q},${entry.r}`, entry.terrain]));
  const walkable = (coord) => {
    const terrainId = overrides.get(`${coord.q},${coord.r}`) ?? defaultTerrain;
    return terrainTypes?.[terrainId]?.walkable ?? terrainId !== "blocked";
  };
  for (const route of pathRoutes) {
    route.pathCenterline.forEach((coord, index) => {
      if (coord.q < 0 || coord.r < 0 || coord.q >= width || coord.r >= height) {
        throw new Error(`${sourceName}.pathRoutes.${route.id}[${index}] is outside the map.`);
      }
      if (!walkable(coord)) throw new Error(`${sourceName}.pathRoutes.${route.id}[${index}] crosses non-walkable terrain.`);
      const next = route.pathCenterline[index + 1];
      if (!next) return;
      const dq = Math.abs(next.q - coord.q);
      const dr = Math.abs(next.r - coord.r);
      const adjacent = grid.kind === "square"
        ? dq + dr === 1
        : oddRAdjacent(coord, next);
      if (!adjacent) throw new Error(`${sourceName}.pathRoutes.${route.id} contains a non-adjacent ${grid.kind} segment at index ${index}.`);
    });
  }
}

function oddRAdjacent(a, b) {
  const even = a.r % 2 === 0;
  const deltas = even
    ? [[-1, -1], [0, -1], [-1, 0], [1, 0], [-1, 1], [0, 1]]
    : [[0, -1], [1, -1], [-1, 0], [1, 0], [0, 1], [1, 1]];
  return deltas.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

export function writeCompiledMaps(projectDir, maps) {
  const compiledDir = path.join(projectDir, "maps", "compiled");
  fs.mkdirSync(compiledDir, { recursive: true });
  const filePath = path.join(compiledDir, "maps.json");
  fs.writeFileSync(filePath, JSON.stringify(maps, null, 2) + "\n", "utf8");
  return filePath;
}

export function writeMapSource(projectDir, sourceName, source) {
  if (!/^[a-zA-Z0-9_.-]+\.tmj$/.test(sourceName)) {
    throw new Error(`Unsafe map source name "${sourceName}".`);
  }
  const srcDir = path.join(projectDir, "maps", "src");
  fs.mkdirSync(srcDir, { recursive: true });
  const filePath = path.join(srcDir, sourceName);
  fs.writeFileSync(filePath, JSON.stringify(source, null, 2) + "\n", "utf8");
  return filePath;
}

function propertiesToObject(properties) {
  const result = {};
  if (!Array.isArray(properties)) return result;
  for (const prop of properties) {
    if (!prop || typeof prop !== "object" || Array.isArray(prop)) continue;
    let descriptors;
    try {
      descriptors = Object.getOwnPropertyDescriptors(prop);
    } catch {
      throw new Error("Map property fields could not be inspected safely.");
    }
    const nameDescriptor = descriptors.name;
    if (!nameDescriptor || !("value" in nameDescriptor) || !nameDescriptor.enumerable) {
      throw new Error("Map property name must be an enumerable own data field; accessors are not allowed.");
    }
    const name = nameDescriptor.value;
    if (typeof name !== "string") continue;
    const valueDescriptor = descriptors.value;
    if (!valueDescriptor || !("value" in valueDescriptor) || !valueDescriptor.enumerable) {
      throw new Error(`Map property "${name}" value must be an enumerable own data field; accessors are not allowed.`);
    }
    if (name !== "elevationOverrides") {
      // Preserve the pre-elevation behavior for every legacy Tiled property.
      result[name] = valueDescriptor.value;
      continue;
    }
    if (Object.hasOwn(result, "elevationOverrides")) {
      throw new Error("Tiled map properties may define elevationOverrides only once.");
    }
    result.elevationOverrides = valueDescriptor.value;
  }
  return result;
}

function requirePositiveInteger(value, fieldPath) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${fieldPath} must be a positive safe integer.`);
  }
  return value;
}

function parseCoord(value, fieldPath) {
  const coord = parseJson(value, value);
  if (!coord || !Number.isFinite(coord.q) || !Number.isFinite(coord.r)) {
    throw new Error(`${fieldPath} must be a coord with finite q/r.`);
  }
  return { q: coord.q, r: coord.r };
}

function parseCoordArray(value, fieldPath) {
  const coords = parseJson(value, value);
  if (!Array.isArray(coords) || coords.length < 2) {
    throw new Error(`${fieldPath} must contain at least two coords.`);
  }
  return coords.map((coord, index) => parseCoord(coord, `${fieldPath}.${index}`));
}

// Tiled packs tile flip/rotate state into the high 4 bits of every GID (H=0x80000000,
// V=0x40000000, anti-diagonal=0x20000000, hex-120°-rotate=0x10000000). Mask them off before the
// terrain lookup — otherwise a flipped/rotated path tile's GID (e.g. 0x80000002) misses
// TERRAIN_BY_GID and silently falls back to the default terrain, turning the enemy road buildable.
const GID_TILE_MASK = 0x0fffffff;

/** Read the "terrain" tilelayer (or the first tilelayer) into sparse {q,r,terrain} overrides, skipping default-terrain tiles. */
function readTerrainLayer(source, defaultTerrain, width, height) {
  const layers = Array.isArray(source.layers) ? source.layers : [];
  const layer = layers.find((l) => l && l.type === "tilelayer" && l.name === "terrain")
    ?? layers.find((l) => l && l.type === "tilelayer");
  if (!layer || !Array.isArray(layer.data)) return [];
  const w = Number.isInteger(layer.width) && layer.width > 0 ? layer.width : width;
  const firstGid = terrainFirstGid(source);
  const overrides = [];
  for (let i = 0; i < layer.data.length; i += 1) {
    const gid = layer.data[i] & GID_TILE_MASK; // strip flip/rotate flags
    if (gid === 0) continue; // empty cell
    // TERRAIN_BY_GID is 1-based within the terrain tileset; offset by the tileset's firstgid so a
    // .tmj that declares firstgid != 1 still maps buildable/path/… to the right kinds.
    const terrain = TERRAIN_BY_GID[gid - firstGid + 1];
    if (!terrain || terrain === defaultTerrain) continue;
    const q = i % w;
    const r = Math.floor(i / w);
    if (q < width && r < height) overrides.push({ q, r, terrain });
  }
  return overrides;
}

/** The firstgid of the terrain tileset. Prefers a tileset named "terrain"; otherwise the lowest
 *  declared firstgid (the first tileset). Defaults to 1 when no tilesets are declared — the Studio
 *  map editor emits raw 1-6 GIDs with no tileset block, which this preserves. */
function terrainFirstGid(source) {
  const tilesets = Array.isArray(source.tilesets) ? source.tilesets : [];
  let firstGid = 1;
  let best = Infinity;
  for (const ts of tilesets) {
    if (!ts || !Number.isInteger(ts.firstgid)) continue;
    if (typeof ts.name === "string" && /terrain/i.test(ts.name)) return ts.firstgid;
    if (ts.firstgid < best) { best = ts.firstgid; firstGid = ts.firstgid; }
  }
  return firstGid;
}

/** Merge tile-layer overrides with explicit terrainOverrides; explicit entries win per coord. */
function mergeTerrainOverrides(layerOverrides, explicitOverrides) {
  const byKey = new Map();
  for (const o of layerOverrides) byKey.set(`${o.q},${o.r}`, o);
  for (const o of explicitOverrides) byKey.set(`${o.q},${o.r}`, o);
  return [...byKey.values()];
}

function normalizeTerrainOverrides(value, fieldPath) {
  const overrides = parseJson(value, value);
  if (!Array.isArray(overrides)) return [];
  return overrides.map((override, index) => {
    const coord = parseCoord(override, `${fieldPath}.${index}`);
    return { ...coord, terrain: String(override.terrain ?? "buildable") };
  });
}

function normalizeRoutes(value, pathCenterline, fieldPath) {
  const routes = parseJson(value, value);
  if (!Array.isArray(routes) || routes.length === 0) {
    return [{ id: "main", pathCenterline: [...pathCenterline] }];
  }
  return routes.map((route, index) => {
    if (!route || typeof route !== "object") {
      throw new Error(`${fieldPath}.${index} must be an object.`);
    }
    return {
      id: String(route.id ?? `route_${index + 1}`),
      pathCenterline: parseCoordArray(route.pathCenterline, `${fieldPath}.${index}.pathCenterline`)
    };
  });
}

function parseJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseStrictJson(value, fieldPath) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${fieldPath} must contain valid JSON.`);
  }
}
