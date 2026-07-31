import { coordKey } from "./hex.js";
import { createGridTopology, normalizeGridDefinition } from "./topology.js";
export const ELEVATION_LIMITS = Object.freeze({
    overridesPerMap: 65_536,
    minimum: -1_000_000,
    maximum: 1_000_000
});
export const GRID_DESTRUCTIBLE_OBJECT_LIMITS = Object.freeze({
    placementsPerMap: 4_096,
    idUtf8Bytes: 128
});
export class GridElevationValidationError extends Error {
    fieldPath;
    constructor(fieldPath, message) {
        super(message);
        this.fieldPath = fieldPath;
        this.name = "GridElevationValidationError";
    }
}
const elevationIndexes = new WeakMap();
const runtimeElevationIndexes = new WeakMap();
/** Read the optional top-level field without evaluating accessors or inherited data. */
export function inspectGridElevationOverrides(definition) {
    if (definition === null || typeof definition !== "object" || Array.isArray(definition)) {
        throw new GridElevationValidationError("elevationOverrides", "Map definition must be an ordinary object.");
    }
    let prototype;
    let descriptors;
    try {
        prototype = Object.getPrototypeOf(definition);
        descriptors = Object.getOwnPropertyDescriptors(definition);
    }
    catch {
        throw new GridElevationValidationError("elevationOverrides", "Map elevation field could not be inspected safely.");
    }
    if (prototype !== Object.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new GridElevationValidationError("elevationOverrides", "Map elevation field must belong to an ordinary object without inherited or symbol fields.");
    }
    const descriptor = descriptors.elevationOverrides;
    if (descriptor === undefined)
        return undefined;
    if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new GridElevationValidationError("elevationOverrides", "Map elevationOverrides must be an enumerable own data property; accessors are not allowed.");
    }
    return descriptor.value;
}
/** Safely detaches and canonicalizes the closed sparse elevation representation. */
export function normalizeGridElevationOverrides(value, width, height) {
    if (!Number.isSafeInteger(width) || width <= 0) {
        throw new GridElevationValidationError("width", "Map width must be a positive safe integer before elevation is normalized.");
    }
    if (!Number.isSafeInteger(height) || height <= 0) {
        throw new GridElevationValidationError("height", "Map height must be a positive safe integer before elevation is normalized.");
    }
    if (value === undefined)
        return [];
    let prototype;
    let descriptors;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object" ? Object.getOwnPropertyDescriptors(value) : {};
    }
    catch {
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
        throw new GridElevationValidationError("elevationOverrides", `Elevation overrides must contain at most ${ELEVATION_LIMITS.overridesPerMap} entries.`);
    }
    const expectedKeys = new Set(["length"]);
    const normalized = [];
    const seen = new Set();
    for (let index = 0; index < length; index += 1) {
        const indexKey = String(index);
        expectedKeys.add(indexKey);
        const descriptor = descriptors[indexKey];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            throw new GridElevationValidationError(`elevationOverrides[${index}]`, "Elevation overrides must be dense enumerable own data entries.");
        }
        const entry = descriptor.value;
        let entryPrototype;
        let entryDescriptors;
        try {
            entryPrototype = entry !== null && typeof entry === "object" ? Object.getPrototypeOf(entry) : null;
            entryDescriptors = entry !== null && typeof entry === "object" ? Object.getOwnPropertyDescriptors(entry) : {};
        }
        catch {
            throw new GridElevationValidationError(`elevationOverrides[${index}]`, "Elevation override could not be inspected safely.");
        }
        if (entry === null || typeof entry !== "object" || Array.isArray(entry) || entryPrototype !== Object.prototype) {
            throw new GridElevationValidationError(`elevationOverrides[${index}]`, "Elevation override must be a plain object with own data fields.");
        }
        if (Object.getOwnPropertySymbols(entryDescriptors).length > 0) {
            throw new GridElevationValidationError(`elevationOverrides[${index}]`, "Elevation override must not contain symbol fields.");
        }
        const keys = Object.keys(entryDescriptors);
        for (const key of ["q", "r", "elevation"]) {
            const field = entryDescriptors[key];
            if (!field || !field.enumerable || !("value" in field)) {
                throw new GridElevationValidationError(`elevationOverrides[${index}].${key}`, `Elevation override ${key} must be an enumerable own data field.`);
            }
        }
        const extraKey = keys.find((key) => key !== "q" && key !== "r" && key !== "elevation");
        if (extraKey !== undefined || keys.length !== 3) {
            throw new GridElevationValidationError(`elevationOverrides[${index}].${extraKey ?? "fields"}`, "Elevation override has missing or unknown fields.");
        }
        const q = entryDescriptors.q.value;
        const r = entryDescriptors.r.value;
        const elevation = entryDescriptors.elevation.value;
        if (!Number.isSafeInteger(q)) {
            throw new GridElevationValidationError(`elevationOverrides[${index}].q`, "Elevation q must be a safe integer.");
        }
        if (!Number.isSafeInteger(r)) {
            throw new GridElevationValidationError(`elevationOverrides[${index}].r`, "Elevation r must be a safe integer.");
        }
        if (q < 0 || q >= width || r < 0 || r >= height) {
            throw new GridElevationValidationError(`elevationOverrides[${index}]`, `Elevation coordinate ${q},${r} is outside the map.`);
        }
        if (!Number.isSafeInteger(elevation)
            || elevation < ELEVATION_LIMITS.minimum
            || elevation > ELEVATION_LIMITS.maximum) {
            throw new GridElevationValidationError(`elevationOverrides[${index}].elevation`, `Elevation must be a safe integer from ${ELEVATION_LIMITS.minimum} to ${ELEVATION_LIMITS.maximum}.`);
        }
        const key = `${q},${r}`;
        if (seen.has(key)) {
            throw new GridElevationValidationError(`elevationOverrides[${index}]`, `Elevation coordinate ${key} is duplicated.`);
        }
        seen.add(key);
        if (elevation !== 0)
            normalized.push({ q, r, elevation });
    }
    const unexpectedArrayKey = Object.keys(descriptors).find((key) => !expectedKeys.has(key));
    if (unexpectedArrayKey !== undefined) {
        throw new GridElevationValidationError(`elevationOverrides.${unexpectedArrayKey}`, "Elevation overrides array has an unsupported own field.");
    }
    return normalized.sort((left, right) => left.r - right.r || left.q - right.q);
}
/** Read the optional placement field without invoking authored accessors. */
export function inspectGridDestructibleObjects(definition) {
    if (definition === null || typeof definition !== "object" || Array.isArray(definition)) {
        throw new Error("Map definition must be an ordinary object before destructible placements are inspected.");
    }
    let prototype;
    let descriptors;
    try {
        prototype = Object.getPrototypeOf(definition);
        descriptors = Object.getOwnPropertyDescriptors(definition);
    }
    catch {
        throw new Error("Map destructible placements could not be inspected safely.");
    }
    if (prototype !== Object.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error("Map destructible placements require an ordinary map definition without symbol fields.");
    }
    const descriptor = descriptors.destructibleObjects;
    if (descriptor === undefined || ("value" in descriptor && descriptor.value === undefined))
        return undefined;
    if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new Error("Map destructibleObjects must be an enumerable own data field; accessors are forbidden.");
    }
    return descriptor.value;
}
function destructibleUtf8Bytes(value) {
    return new TextEncoder().encode(value).length;
}
function destructibleIdentifier(value, fieldPath) {
    if (typeof value !== "string" || value.length === 0 || value !== value.trim()
        || /[\u0000-\u001f\u007f]/.test(value)
        || destructibleUtf8Bytes(value) > GRID_DESTRUCTIBLE_OBJECT_LIMITS.idUtf8Bytes) {
        throw new Error(`${fieldPath} identifier must contain 1..${GRID_DESTRUCTIBLE_OBJECT_LIMITS.idUtf8Bytes} UTF-8 bytes.`);
    }
    return value;
}
/** Canonicalize the closed, bounded placement list without invoking hostile authored code. */
export function normalizeGridDestructibleObjects(value, width, height) {
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
        throw new Error("Destructible placement map bounds must be positive safe integers.");
    }
    if (value === undefined)
        return [];
    let prototype;
    let descriptors;
    let isArray;
    try {
        isArray = Array.isArray(value);
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
            ? Object.getOwnPropertyDescriptors(value)
            : {};
    }
    catch {
        throw new Error("Destructible placement array could not be inspected safely.");
    }
    if (!isArray || prototype !== Array.prototype) {
        throw new Error("Destructible placements must be an ordinary dense array.");
    }
    const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : undefined;
    if (!Number.isSafeInteger(length) || length < 0) {
        throw new Error("Destructible placement array length must be a non-negative safe integer.");
    }
    if (length > GRID_DESTRUCTIBLE_OBJECT_LIMITS.placementsPerMap) {
        throw new Error(`Destructible placements exceed the ${GRID_DESTRUCTIBLE_OBJECT_LIMITS.placementsPerMap} placement limit.`);
    }
    const expectedKeys = new Set(["length", ...Array.from({ length }, (_, index) => String(index))]);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !expectedKeys.has(key))) {
        throw new Error("Destructible placements must be dense own data without extra fields.");
    }
    const normalized = [];
    const ids = new Set();
    const coords = new Set();
    for (let index = 0; index < length; index += 1) {
        const itemDescriptor = descriptors[String(index)];
        if (!itemDescriptor?.enumerable || !("value" in itemDescriptor)) {
            throw new Error(`Destructible placement ${index} must be an enumerable own data item; sparse/accessor entries are forbidden.`);
        }
        const item = itemDescriptor.value;
        let itemPrototype;
        let itemDescriptors;
        try {
            itemPrototype = item !== null && typeof item === "object" ? Object.getPrototypeOf(item) : null;
            itemDescriptors = item !== null && typeof item === "object"
                ? Object.getOwnPropertyDescriptors(item)
                : {};
        }
        catch {
            throw new Error(`Destructible placement ${index} could not be inspected safely.`);
        }
        const itemKeys = Reflect.ownKeys(itemDescriptors);
        if (item === null || typeof item !== "object" || Array.isArray(item)
            || itemPrototype !== Object.prototype
            || itemKeys.length !== 3
            || itemKeys.some((key) => typeof key !== "string" || !["id", "definitionId", "coord"].includes(key))) {
            throw new Error(`Destructible placement ${index} must contain exactly id, definitionId, and coord data fields.`);
        }
        for (const key of ["id", "definitionId", "coord"]) {
            const descriptor = itemDescriptors[key];
            if (!descriptor?.enumerable || !("value" in descriptor)) {
                throw new Error(`Destructible placement ${index}.${key} must be an enumerable own data field; accessors are forbidden.`);
            }
        }
        const id = destructibleIdentifier(itemDescriptors.id.value, `Destructible placement ${index}.id`);
        const definitionId = destructibleIdentifier(itemDescriptors.definitionId.value, `Destructible placement ${index}.definitionId`);
        const coordValue = itemDescriptors.coord.value;
        let coordPrototype;
        let coordDescriptors;
        try {
            coordPrototype = coordValue !== null && typeof coordValue === "object"
                ? Object.getPrototypeOf(coordValue)
                : null;
            coordDescriptors = coordValue !== null && typeof coordValue === "object"
                ? Object.getOwnPropertyDescriptors(coordValue)
                : {};
        }
        catch {
            throw new Error(`Destructible placement ${index}.coord could not be inspected safely.`);
        }
        const coordKeys = Reflect.ownKeys(coordDescriptors);
        if (coordValue === null || typeof coordValue !== "object" || Array.isArray(coordValue)
            || coordPrototype !== Object.prototype
            || coordKeys.length !== 2
            || coordKeys.some((key) => typeof key !== "string" || (key !== "q" && key !== "r"))) {
            throw new Error(`Destructible placement ${index}.coord must contain exactly q and r data fields.`);
        }
        for (const key of ["q", "r"]) {
            const descriptor = coordDescriptors[key];
            if (!descriptor?.enumerable || !("value" in descriptor)) {
                throw new Error(`Destructible placement ${index}.coord.${key} must be an enumerable own data field.`);
            }
        }
        const q = coordDescriptors.q.value;
        const r = coordDescriptors.r.value;
        if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) {
            throw new Error(`Destructible placement ${index} coordinate q/r must be safe integers.`);
        }
        if (q < 0 || r < 0 || q >= width || r >= height) {
            throw new Error(`Destructible placement ${index} coordinate is outside map bounds.`);
        }
        const coordKeyValue = `${q},${r}`;
        if (ids.has(id))
            throw new Error(`Destructible placement id "${id}" is duplicated.`);
        if (coords.has(coordKeyValue))
            throw new Error(`Destructible placement coordinate ${coordKeyValue} is duplicated.`);
        ids.add(id);
        coords.add(coordKeyValue);
        normalized.push({ id, definitionId, coord: { q: q, r: r } });
    }
    return normalized.sort((left, right) => (left.coord.r - right.coord.r
        || left.coord.q - right.coord.q
        || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)));
}
export class GridMap {
    id;
    width;
    height;
    grid;
    topology;
    tiles;
    pathCenterline;
    pathRoutes;
    spawnCoord;
    coreCoord;
    definition;
    baseTerrainByCoord = new Map();
    constructor(definition) {
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
    static fromDefinition(definition) {
        if (!definition)
            throw new Error("Cannot create GridMap from an undefined definition.");
        return new GridMap(definition);
    }
    clone() {
        return GridMap.fromDefinition(this.definition);
    }
    getTile(coord) {
        return this.tiles.get(coordKey(coord));
    }
    getBaseTerrain(coord) {
        return this.baseTerrainByCoord.get(coordKey(coord));
    }
    elevationAt(coord) {
        if (!Number.isSafeInteger(coord.q) || !Number.isSafeInteger(coord.r) || !this.isInside(coord))
            return undefined;
        const runtime = runtimeElevationIndexes.get(this)?.get(coordKey(coord));
        if (runtime)
            return runtime.elevation;
        return this.getBaseElevation(coord);
    }
    getBaseElevation(coord) {
        if (!Number.isSafeInteger(coord.q) || !Number.isSafeInteger(coord.r) || !this.isInside(coord))
            return undefined;
        let index = elevationIndexes.get(this);
        if (!index) {
            index = new Map((this.definition.elevationOverrides ?? []).map((entry) => [coordKey(entry), entry.elevation]));
            elevationIndexes.set(this, index);
        }
        return index.get(coordKey(coord)) ?? 0;
    }
    getElevationOverrides() {
        return (this.definition.elevationOverrides ?? []).map((entry) => ({ ...entry }));
    }
    getEffectiveElevationOverrides() {
        const effective = new Map((this.definition.elevationOverrides ?? []).map((entry) => [coordKey(entry), { ...entry }]));
        for (const [key, entry] of runtimeElevationIndexes.get(this) ?? []) {
            if (entry.elevation === 0)
                effective.delete(key);
            else
                effective.set(key, { ...entry });
        }
        return [...effective.values()].sort((left, right) => left.r - right.r || left.q - right.q);
    }
    getDestructibleObjects() {
        return (this.definition.destructibleObjects ?? []).map((placement) => ({
            id: placement.id,
            definitionId: placement.definitionId,
            coord: { ...placement.coord }
        }));
    }
    /** Attach the authoritative simulation-owned runtime projection without copying it. */
    useRuntimeElevationOverrides(overrides) {
        runtimeElevationIndexes.set(this, overrides);
    }
    setTerrain(coord, terrain) {
        const tile = this.getTile(coord);
        if (!tile)
            return false;
        tile.terrain = terrain;
        return true;
    }
    restoreTerrain(coord) {
        const terrain = this.getBaseTerrain(coord);
        return terrain === undefined ? false : this.setTerrain(coord, terrain);
    }
    restoreAllTerrain() {
        for (const tile of this.tiles.values())
            tile.terrain = this.baseTerrainByCoord.get(coordKey(tile)) ?? tile.terrain;
    }
    isInside(coord) {
        return coord.q >= 0 && coord.q < this.width && coord.r >= 0 && coord.r < this.height;
    }
    neighbors(coord) {
        return this.topology.neighbors(coord);
    }
    distance(a, b) {
        return this.topology.distance(a, b);
    }
    line(a, b) {
        return this.topology.line(a, b);
    }
    directionBetween(a, b) {
        return this.topology.directionBetween(a, b);
    }
    footprintSize(radius) {
        return this.topology.footprintSize(radius);
    }
    tilesWithin(center, radius) {
        return this.topology.tilesWithin(center, radius).map((coord) => this.getTile(coord)).filter((tile) => Boolean(tile));
    }
    occupiedTowerAt(coord) {
        return this.getTile(coord)?.occupiedBy;
    }
    pathRouteById(routeId) {
        if (!routeId)
            return this.pathRoutes[0];
        return this.pathRoutes.find((route) => route.id === routeId) ?? this.pathRoutes[0];
    }
    allPathCoords() {
        const seen = new Set();
        const coords = [];
        for (const route of this.pathRoutes) {
            for (const coord of route.pathCenterline) {
                const key = coordKey(coord);
                if (seen.has(key))
                    continue;
                seen.add(key);
                coords.push({ ...coord });
            }
        }
        return coords;
    }
    isPathCoord(coord) {
        const key = coordKey(coord);
        return this.pathRoutes.some((route) => route.pathCenterline.some((point) => coordKey(point) === key));
    }
    setOccupied(coords, towerId) {
        for (const coord of coords) {
            const tile = this.getTile(coord);
            if (tile)
                tile.occupiedBy = towerId;
        }
    }
    clearOccupied(towerId) {
        for (const tile of this.tiles.values())
            if (tile.occupiedBy === towerId)
                delete tile.occupiedBy;
    }
    createTiles() {
        const tiles = new Map();
        const overrides = new Map(this.definition.terrainOverrides.map((override) => [coordKey(override), override.terrain]));
        for (let r = 0; r < this.height; r += 1) {
            for (let q = 0; q < this.width; q += 1) {
                const coord = { q, r };
                let terrain = overrides.get(coordKey(coord)) ?? this.definition.defaultTerrain;
                if (coordKey(coord) === coordKey(this.spawnCoord))
                    terrain = "spawn";
                if (coordKey(coord) === coordKey(this.coreCoord))
                    terrain = "core";
                this.baseTerrainByCoord.set(coordKey(coord), terrain);
                tiles.set(coordKey(coord), { ...coord, terrain });
            }
        }
        return tiles;
    }
}
function cloneMapDefinition(definition) {
    const elevationOverrides = normalizeGridElevationOverrides(inspectGridElevationOverrides(definition), definition.width, definition.height);
    const destructibleObjects = normalizeGridDestructibleObjects(inspectGridDestructibleObjects(definition), definition.width, definition.height);
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
        ...(elevationOverrides.length === 0 ? {} : { elevationOverrides }),
        ...(destructibleObjects.length === 0 ? {} : { destructibleObjects })
    };
}
function normalizePathRoutes(definition) {
    const routes = definition.pathRoutes?.length
        ? definition.pathRoutes
        : [{ id: "main", pathCenterline: definition.pathCenterline }];
    return routes.map((route) => ({ id: route.id, pathCenterline: route.pathCenterline.map((coord) => ({ ...coord })) }));
}
/** @deprecated Use GridMap. */
export { GridMap as HexMap };
