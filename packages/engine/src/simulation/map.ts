import { coordKey } from "./hex.js";
import { createGridTopology, normalizeGridDefinition, type GridDirection, type GridTopology } from "./topology.js";
import type { GridCoord, GridDefinition, GridPathRoute, GridTile, Terrain } from "./types.js";

export interface GridMapTerrainOverride extends GridCoord {
  terrain: Terrain;
}

export interface GridMapElevationOverride extends GridCoord {
  elevation: number;
}

export const ELEVATION_LIMITS = Object.freeze({
  overridesPerMap: 65_536,
  minimum: -1_000_000,
  maximum: 1_000_000
});

export class GridElevationValidationError extends Error {
  constructor(readonly fieldPath: string, message: string) {
    super(message);
    this.name = "GridElevationValidationError";
  }
}

export interface GridMapDefinition {
  id: string;
  width: number;
  height: number;
  /** Omitted v1 maps retain the canonical odd-r hex topology. */
  grid?: GridDefinition;
  defaultTerrain: Terrain;
  pathCenterline: GridCoord[];
  pathRoutes?: GridPathRoute[];
  spawnCoord: GridCoord;
  coreCoord: GridCoord;
  terrainOverrides: GridMapTerrainOverride[];
  /** Sparse, signed authored elevation. Omitted and zero-valued cells both resolve to 0. */
  elevationOverrides?: GridMapElevationOverride[];
}

const elevationIndexes = new WeakMap<GridMap, ReadonlyMap<string, number>>();
const runtimeElevationIndexes = new WeakMap<GridMap, ReadonlyMap<string, GridMapElevationOverride>>();

/** Read the optional top-level field without evaluating accessors or inherited data. */
export function inspectGridElevationOverrides(definition: unknown): unknown {
  if (definition === null || typeof definition !== "object" || Array.isArray(definition)) {
    throw new GridElevationValidationError("elevationOverrides", "Map definition must be an ordinary object.");
  }
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(definition);
    descriptors = Object.getOwnPropertyDescriptors(definition);
  } catch {
    throw new GridElevationValidationError("elevationOverrides", "Map elevation field could not be inspected safely.");
  }
  if (prototype !== Object.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new GridElevationValidationError(
      "elevationOverrides",
      "Map elevation field must belong to an ordinary object without inherited or symbol fields."
    );
  }
  const descriptor = descriptors.elevationOverrides;
  if (descriptor === undefined) return undefined;
  if (!descriptor.enumerable || !("value" in descriptor)) {
    throw new GridElevationValidationError(
      "elevationOverrides",
      "Map elevationOverrides must be an enumerable own data property; accessors are not allowed."
    );
  }
  return descriptor.value;
}

/** Safely detaches and canonicalizes the closed sparse elevation representation. */
export function normalizeGridElevationOverrides(
  value: unknown,
  width: number,
  height: number
): GridMapElevationOverride[] {
  if (!Number.isSafeInteger(width) || width <= 0) {
    throw new GridElevationValidationError("width", "Map width must be a positive safe integer before elevation is normalized.");
  }
  if (!Number.isSafeInteger(height) || height <= 0) {
    throw new GridElevationValidationError("height", "Map height must be a positive safe integer before elevation is normalized.");
  }
  if (value === undefined) return [];
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = value !== null && typeof value === "object" ? Object.getOwnPropertyDescriptors(value) : {};
  } catch {
    throw new GridElevationValidationError("elevationOverrides", "Elevation overrides could not be inspected safely.");
  }
  if (!Array.isArray(value) || prototype !== Array.prototype) {
    throw new GridElevationValidationError("elevationOverrides", "Elevation overrides must be an ordinary dense array.");
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new GridElevationValidationError("elevationOverrides", "Elevation overrides must not contain symbol fields.");
  }
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
  if (!Number.isSafeInteger(length) || length < 0 || length > ELEVATION_LIMITS.overridesPerMap) {
    throw new GridElevationValidationError(
      "elevationOverrides",
      `Elevation overrides must contain at most ${ELEVATION_LIMITS.overridesPerMap} entries.`
    );
  }
  const expectedKeys = new Set<string>(["length"]);
  const normalized: GridMapElevationOverride[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const indexKey = String(index);
    expectedKeys.add(indexKey);
    const descriptor = descriptors[indexKey];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new GridElevationValidationError(
        `elevationOverrides[${index}]`,
        "Elevation overrides must be dense enumerable own data entries."
      );
    }
    const entry = descriptor.value;
    let entryPrototype: object | null;
    let entryDescriptors: PropertyDescriptorMap;
    try {
      entryPrototype = entry !== null && typeof entry === "object" ? Object.getPrototypeOf(entry) : null;
      entryDescriptors = entry !== null && typeof entry === "object" ? Object.getOwnPropertyDescriptors(entry) : {};
    } catch {
      throw new GridElevationValidationError(
        `elevationOverrides[${index}]`,
        "Elevation override could not be inspected safely."
      );
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry) || entryPrototype !== Object.prototype) {
      throw new GridElevationValidationError(
        `elevationOverrides[${index}]`,
        "Elevation override must be a plain object with own data fields."
      );
    }
    if (Object.getOwnPropertySymbols(entryDescriptors).length > 0) {
      throw new GridElevationValidationError(
        `elevationOverrides[${index}]`,
        "Elevation override must not contain symbol fields."
      );
    }
    const keys = Object.keys(entryDescriptors);
    for (const key of ["q", "r", "elevation"]) {
      const field = entryDescriptors[key];
      if (!field || !field.enumerable || !("value" in field)) {
        throw new GridElevationValidationError(
          `elevationOverrides[${index}].${key}`,
          `Elevation override ${key} must be an enumerable own data field.`
        );
      }
    }
    const extraKey = keys.find((key) => key !== "q" && key !== "r" && key !== "elevation");
    if (extraKey !== undefined || keys.length !== 3) {
      throw new GridElevationValidationError(
        `elevationOverrides[${index}].${extraKey ?? "fields"}`,
        "Elevation override has missing or unknown fields."
      );
    }
    const q = entryDescriptors.q!.value;
    const r = entryDescriptors.r!.value;
    const elevation = entryDescriptors.elevation!.value;
    if (!Number.isSafeInteger(q)) {
      throw new GridElevationValidationError(`elevationOverrides[${index}].q`, "Elevation q must be a safe integer.");
    }
    if (!Number.isSafeInteger(r)) {
      throw new GridElevationValidationError(`elevationOverrides[${index}].r`, "Elevation r must be a safe integer.");
    }
    if (q < 0 || q >= width || r < 0 || r >= height) {
      throw new GridElevationValidationError(
        `elevationOverrides[${index}]`,
        `Elevation coordinate ${q},${r} is outside the map.`
      );
    }
    if (
      !Number.isSafeInteger(elevation)
      || elevation < ELEVATION_LIMITS.minimum
      || elevation > ELEVATION_LIMITS.maximum
    ) {
      throw new GridElevationValidationError(
        `elevationOverrides[${index}].elevation`,
        `Elevation must be a safe integer from ${ELEVATION_LIMITS.minimum} to ${ELEVATION_LIMITS.maximum}.`
      );
    }
    const key = `${q},${r}`;
    if (seen.has(key)) {
      throw new GridElevationValidationError(
        `elevationOverrides[${index}]`,
        `Elevation coordinate ${key} is duplicated.`
      );
    }
    seen.add(key);
    if (elevation !== 0) normalized.push({ q, r, elevation });
  }
  const unexpectedArrayKey = Object.keys(descriptors).find((key) => !expectedKeys.has(key));
  if (unexpectedArrayKey !== undefined) {
    throw new GridElevationValidationError(
      `elevationOverrides.${unexpectedArrayKey}`,
      "Elevation overrides array has an unsupported own field."
    );
  }
  return normalized.sort((left, right) => left.r - right.r || left.q - right.q);
}

export class GridMap {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly grid: GridDefinition;
  readonly topology: GridTopology;
  readonly tiles: Map<string, GridTile>;
  readonly pathCenterline: GridCoord[];
  readonly pathRoutes: GridPathRoute[];
  readonly spawnCoord: GridCoord;
  readonly coreCoord: GridCoord;

  private readonly definition: GridMapDefinition;
  private readonly baseTerrainByCoord = new Map<string, Terrain>();

  private constructor(definition: GridMapDefinition) {
    this.definition = cloneMapDefinition(definition);
    this.id = definition.id;
    this.width = definition.width;
    this.height = definition.height;
    this.grid = normalizeGridDefinition(definition.grid);
    this.topology = createGridTopology(this.grid);
    this.pathRoutes = normalizePathRoutes(definition);
    this.pathCenterline = this.pathRoutes[0]?.pathCenterline.map((coord) => ({ ...coord })) ?? [];
    this.spawnCoord = { ...definition.spawnCoord };
    this.coreCoord = { ...definition.coreCoord };
    this.tiles = this.createTiles();
  }

  static fromDefinition(definition: GridMapDefinition | undefined): GridMap {
    if (!definition) throw new Error("Cannot create GridMap from an undefined definition.");
    return new GridMap(definition);
  }

  clone(): GridMap {
    return GridMap.fromDefinition(this.definition);
  }

  getTile(coord: GridCoord): GridTile | undefined {
    return this.tiles.get(coordKey(coord));
  }

  getBaseTerrain(coord: GridCoord): Terrain | undefined {
    return this.baseTerrainByCoord.get(coordKey(coord));
  }

  elevationAt(coord: GridCoord): number | undefined {
    if (!Number.isSafeInteger(coord.q) || !Number.isSafeInteger(coord.r) || !this.isInside(coord)) return undefined;
    const runtime = runtimeElevationIndexes.get(this)?.get(coordKey(coord));
    if (runtime) return runtime.elevation;
    return this.getBaseElevation(coord);
  }

  getBaseElevation(coord: GridCoord): number | undefined {
    if (!Number.isSafeInteger(coord.q) || !Number.isSafeInteger(coord.r) || !this.isInside(coord)) return undefined;
    let index = elevationIndexes.get(this);
    if (!index) {
      index = new Map((this.definition.elevationOverrides ?? []).map((entry) => [coordKey(entry), entry.elevation]));
      elevationIndexes.set(this, index);
    }
    return index.get(coordKey(coord)) ?? 0;
  }

  getElevationOverrides(): GridMapElevationOverride[] {
    return (this.definition.elevationOverrides ?? []).map((entry) => ({ ...entry }));
  }

  getEffectiveElevationOverrides(): GridMapElevationOverride[] {
    const effective = new Map(
      (this.definition.elevationOverrides ?? []).map((entry) => [coordKey(entry), { ...entry }])
    );
    for (const [key, entry] of runtimeElevationIndexes.get(this) ?? []) {
      if (entry.elevation === 0) effective.delete(key);
      else effective.set(key, { ...entry });
    }
    return [...effective.values()].sort((left, right) => left.r - right.r || left.q - right.q);
  }

  /** Attach the authoritative simulation-owned runtime projection without copying it. */
  useRuntimeElevationOverrides(overrides: ReadonlyMap<string, GridMapElevationOverride>): void {
    runtimeElevationIndexes.set(this, overrides);
  }

  setTerrain(coord: GridCoord, terrain: Terrain): boolean {
    const tile = this.getTile(coord);
    if (!tile) return false;
    tile.terrain = terrain;
    return true;
  }

  restoreTerrain(coord: GridCoord): boolean {
    const terrain = this.getBaseTerrain(coord);
    return terrain === undefined ? false : this.setTerrain(coord, terrain);
  }

  restoreAllTerrain(): void {
    for (const tile of this.tiles.values()) tile.terrain = this.baseTerrainByCoord.get(coordKey(tile)) ?? tile.terrain;
  }

  isInside(coord: GridCoord): boolean {
    return coord.q >= 0 && coord.q < this.width && coord.r >= 0 && coord.r < this.height;
  }

  neighbors(coord: GridCoord): GridCoord[] {
    return this.topology.neighbors(coord);
  }

  distance(a: GridCoord, b: GridCoord): number {
    return this.topology.distance(a, b);
  }

  line(a: GridCoord, b: GridCoord): GridCoord[] {
    return this.topology.line(a, b);
  }

  directionBetween(a: GridCoord, b: GridCoord): GridDirection | undefined {
    return this.topology.directionBetween(a, b);
  }

  footprintSize(radius: number): number {
    return this.topology.footprintSize(radius);
  }

  tilesWithin(center: GridCoord, radius: number): GridTile[] {
    return this.topology.tilesWithin(center, radius).map((coord) => this.getTile(coord)).filter((tile): tile is GridTile => Boolean(tile));
  }

  occupiedTowerAt(coord: GridCoord): string | undefined {
    return this.getTile(coord)?.occupiedBy;
  }

  pathRouteById(routeId: string | undefined): GridPathRoute | undefined {
    if (!routeId) return this.pathRoutes[0];
    return this.pathRoutes.find((route) => route.id === routeId) ?? this.pathRoutes[0];
  }

  allPathCoords(): GridCoord[] {
    const seen = new Set<string>();
    const coords: GridCoord[] = [];
    for (const route of this.pathRoutes) {
      for (const coord of route.pathCenterline) {
        const key = coordKey(coord);
        if (seen.has(key)) continue;
        seen.add(key);
        coords.push({ ...coord });
      }
    }
    return coords;
  }

  isPathCoord(coord: GridCoord): boolean {
    const key = coordKey(coord);
    return this.pathRoutes.some((route) => route.pathCenterline.some((point) => coordKey(point) === key));
  }

  setOccupied(coords: GridCoord[], towerId: string): void {
    for (const coord of coords) {
      const tile = this.getTile(coord);
      if (tile) tile.occupiedBy = towerId;
    }
  }

  clearOccupied(towerId: string): void {
    for (const tile of this.tiles.values()) if (tile.occupiedBy === towerId) delete tile.occupiedBy;
  }

  private createTiles(): Map<string, GridTile> {
    const tiles = new Map<string, GridTile>();
    const overrides = new Map(this.definition.terrainOverrides.map((override) => [coordKey(override), override.terrain]));
    for (let r = 0; r < this.height; r += 1) {
      for (let q = 0; q < this.width; q += 1) {
        const coord = { q, r };
        let terrain: Terrain = overrides.get(coordKey(coord)) ?? this.definition.defaultTerrain;
        if (coordKey(coord) === coordKey(this.spawnCoord)) terrain = "spawn";
        if (coordKey(coord) === coordKey(this.coreCoord)) terrain = "core";
        this.baseTerrainByCoord.set(coordKey(coord), terrain);
        tiles.set(coordKey(coord), { ...coord, terrain });
      }
    }
    return tiles;
  }
}

function cloneMapDefinition(definition: GridMapDefinition): GridMapDefinition {
  const elevationOverrides = normalizeGridElevationOverrides(
    inspectGridElevationOverrides(definition),
    definition.width,
    definition.height
  );
  return {
    id: definition.id,
    width: definition.width,
    height: definition.height,
    grid: normalizeGridDefinition(definition.grid),
    defaultTerrain: definition.defaultTerrain,
    pathCenterline: definition.pathCenterline.map((coord) => ({ ...coord })),
    pathRoutes: normalizePathRoutes(definition),
    spawnCoord: { ...definition.spawnCoord },
    coreCoord: { ...definition.coreCoord },
    terrainOverrides: definition.terrainOverrides.map((override) => ({ ...override })),
    ...(elevationOverrides.length === 0 ? {} : { elevationOverrides })
  };
}

function normalizePathRoutes(definition: GridMapDefinition): GridPathRoute[] {
  const routes = definition.pathRoutes?.length
    ? definition.pathRoutes
    : [{ id: "main", pathCenterline: definition.pathCenterline }];
  return routes.map((route) => ({ id: route.id, pathCenterline: route.pathCenterline.map((coord) => ({ ...coord })) }));
}

/** @deprecated Use GridMapTerrainOverride. */
export type HexMapTerrainOverride = GridMapTerrainOverride;
/** @deprecated Use GridMapDefinition. */
export type HexMapDefinition = GridMapDefinition;
/** @deprecated Use GridMap. */
export { GridMap as HexMap };
