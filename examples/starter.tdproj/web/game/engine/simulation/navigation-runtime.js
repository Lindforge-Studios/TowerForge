import { NAVIGATION_LIMITS, normalizeNavigationProfileV1 } from "../content/navigation-mechanics.js";
import { buildNavigationField } from "./navigation-field.js";
function fail(message) {
    throw new Error(`Invalid navigation resolver input: ${message}`);
}
function inspectDescriptors(value, context) {
    try {
        return Object.getOwnPropertyDescriptors(value);
    }
    catch {
        return fail(`${context} could not be inspected safely.`);
    }
}
function plainRecord(value, context) {
    let prototype;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    }
    catch {
        return fail(`${context} could not be inspected safely.`);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
        return fail(`${context} must be a plain object with enumerable own data fields.`);
    }
    const descriptors = inspectDescriptors(value, context);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        return fail(`${context} must not contain symbol fields.`);
    }
    const detached = {};
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            return fail(`${context}.${key} must be an enumerable own data field.`);
        }
        Object.defineProperty(detached, key, {
            value: descriptor.value,
            enumerable: true,
            configurable: true,
            writable: true
        });
    }
    return detached;
}
function denseArray(value, context, maximumLength) {
    let prototype;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    }
    catch {
        return fail(`${context} could not be inspected safely.`);
    }
    if (!Array.isArray(value) || prototype !== Array.prototype) {
        return fail(`${context} must be an ordinary dense array.`);
    }
    let lengthDescriptor;
    try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    }
    catch {
        return fail(`${context} length could not be inspected safely.`);
    }
    if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) {
        return fail(`${context} has an invalid array length.`);
    }
    const length = lengthDescriptor.value;
    if (length > maximumLength) {
        return fail(`${context} exceeds the ${maximumLength} item budget.`);
    }
    const descriptors = inspectDescriptors(value, context);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        return fail(`${context} must not contain symbol fields.`);
    }
    const values = [];
    for (const key of Object.keys(descriptors)) {
        if (key === "length")
            continue;
        const descriptor = descriptors[key];
        if (!/^(0|[1-9]\d*)$/.test(key)
            || Number(key) >= length
            || !descriptor
            || !descriptor.enumerable
            || !("value" in descriptor)) {
            return fail(`${context} contains a sparse index or unsupported non-data field.`);
        }
        values[Number(key)] = descriptor.value;
    }
    if (Object.keys(descriptors).length !== length + 1 || values.length !== length) {
        return fail(`${context} must be dense and contain no extra fields.`);
    }
    return values;
}
function exactKeys(record, allowed, context) {
    const keys = new Set(allowed);
    for (const key of Object.keys(record)) {
        if (!keys.has(key))
            fail(`${context} contains unknown field "${key}".`);
    }
}
function required(record, key, context) {
    if (!Object.prototype.hasOwnProperty.call(record, key))
        fail(`${context}.${key} is required.`);
    return record[key];
}
function compareBinary(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function compareCoords(left, right) {
    return left.r - right.r || left.q - right.q;
}
function utf8ByteLength(value) {
    let bytes = 0;
    for (const character of value) {
        const point = character.codePointAt(0);
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    return bytes;
}
function boundedId(value, context) {
    if (typeof value !== "string" || value.length === 0)
        fail(`${context} must be a non-empty string id.`);
    if (utf8ByteLength(value) > NAVIGATION_LIMITS.idUtf8Bytes) {
        fail(`${context} exceeds the ${NAVIGATION_LIMITS.idUtf8Bytes} UTF-8 byte budget.`);
    }
    return value;
}
function positiveDimension(value, context) {
    if (!Number.isSafeInteger(value) || value < 1 || value > NAVIGATION_LIMITS.activeMapCells) {
        return fail(`${context} must be a positive safe integer within the navigation cell budget.`);
    }
    return value;
}
function normalizeGrid(value) {
    const grid = plainRecord(value, "grid");
    if (grid.kind === "square") {
        exactKeys(grid, ["kind", "adjacency"], "square grid");
        if (grid.adjacency !== "cardinal")
            fail("square grid adjacency must be cardinal.");
        return Object.freeze({ kind: "square", adjacency: "cardinal" });
    }
    if (grid.kind === "hex") {
        exactKeys(grid, ["kind", "layout"], "hex grid");
        if (grid.layout !== "odd-r")
            fail("hex grid layout must be odd-r.");
        return Object.freeze({ kind: "hex", layout: "odd-r" });
    }
    return fail("grid kind must be square or hex.");
}
function normalizeCoord(value, context, width, height) {
    const coord = plainRecord(value, context);
    exactKeys(coord, ["q", "r"], context);
    const q = required(coord, "q", context);
    const r = required(coord, "r", context);
    if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) {
        return fail(`${context} q and r must be safe integers.`);
    }
    if (q < 0 || q >= width || r < 0 || r >= height) {
        return fail(`${context} must be inside the ${width}x${height} map.`);
    }
    return Object.freeze({ q: q, r: r });
}
function normalizeProfile(value) {
    const profile = normalizeNavigationProfileV1(value);
    if (profile.mode !== "dynamic_flow")
        fail("profile must use dynamic_flow mode.");
    if (!Object.prototype.hasOwnProperty.call(profile.movementProfiles, profile.defaultMovementProfileId)) {
        fail(`default movement profile "${profile.defaultMovementProfileId}" is unknown.`);
    }
    for (const [enemyId, movementProfileId] of Object.entries(profile.enemyMovementProfiles ?? {})) {
        if (!Object.prototype.hasOwnProperty.call(profile.movementProfiles, movementProfileId)) {
            fail(`enemy assignment "${enemyId}" references unknown movement profile "${movementProfileId}".`);
        }
    }
    return profile;
}
function normalizeTerrainTypes(value, profile) {
    const authored = plainRecord(value, "terrainTypes");
    const terrainIds = Object.keys(authored);
    if (terrainIds.length > NAVIGATION_LIMITS.terrainDefinitions) {
        fail(`terrainTypes exceed the ${NAVIGATION_LIMITS.terrainDefinitions} definition budget.`);
    }
    const result = {};
    let totalTags = 0;
    for (const terrainId of terrainIds.sort(compareBinary)) {
        boundedId(terrainId, `terrainTypes.${terrainId}`);
        const definition = plainRecord(authored[terrainId], `terrainTypes.${terrainId}`);
        exactKeys(definition, ["id", "label", "buildable", "walkable", "groundSpeedMultiplier", "tags"], `terrainTypes.${terrainId}`);
        if (boundedId(required(definition, "id", `terrainTypes.${terrainId}`), `terrainTypes.${terrainId}.id`) !== terrainId) {
            fail(`terrainTypes.${terrainId}.id must match its record key.`);
        }
        const label = required(definition, "label", `terrainTypes.${terrainId}`);
        if (typeof label !== "string" || label.length === 0 || label.length > NAVIGATION_LIMITS.labelLength) {
            fail(`terrainTypes.${terrainId}.label must contain 1..${NAVIGATION_LIMITS.labelLength} characters.`);
        }
        const buildable = required(definition, "buildable", `terrainTypes.${terrainId}`);
        const walkable = required(definition, "walkable", `terrainTypes.${terrainId}`);
        if (typeof buildable !== "boolean" || typeof walkable !== "boolean") {
            fail(`terrainTypes.${terrainId} buildable and walkable must be boolean.`);
        }
        const groundSpeedMultiplier = required(definition, "groundSpeedMultiplier", `terrainTypes.${terrainId}`);
        if (typeof groundSpeedMultiplier !== "number"
            || !Number.isFinite(groundSpeedMultiplier)
            || groundSpeedMultiplier < 0) {
            fail(`terrainTypes.${terrainId}.groundSpeedMultiplier must be finite and non-negative.`);
        }
        const authoredTags = denseArray(required(definition, "tags", `terrainTypes.${terrainId}`), `terrainTypes.${terrainId}.tags`, NAVIGATION_LIMITS.terrainTagsPerDefinition);
        totalTags += authoredTags.length;
        if (totalTags > NAVIGATION_LIMITS.terrainTagsAcrossDefinitions) {
            fail(`terrainTypes exceed the ${NAVIGATION_LIMITS.terrainTagsAcrossDefinitions} total-tag budget.`);
        }
        const tags = [];
        for (let index = 0; index < authoredTags.length; index += 1) {
            const tag = authoredTags[index];
            if (typeof tag !== "string")
                fail(`terrainTypes.${terrainId}.tags[${index}] must be a string.`);
            if (utf8ByteLength(tag) > NAVIGATION_LIMITS.terrainTagUtf8Bytes) {
                fail(`terrainTypes.${terrainId}.tags[${index}] exceeds the `
                    + `${NAVIGATION_LIMITS.terrainTagUtf8Bytes} UTF-8 byte budget.`);
            }
            tags.push(tag);
        }
        Object.freeze(tags);
        const normalized = {
            id: terrainId,
            label,
            buildable,
            walkable,
            groundSpeedMultiplier,
            tags
        };
        Object.freeze(normalized);
        Object.defineProperty(result, terrainId, { value: normalized, enumerable: true });
    }
    for (const [movementProfileId, movementProfile] of Object.entries(profile.movementProfiles)) {
        for (const terrainId of Object.keys(movementProfile.terrainCosts ?? {})) {
            if (!Object.prototype.hasOwnProperty.call(result, terrainId)) {
                fail(`movement profile "${movementProfileId}" references unknown terrain "${terrainId}".`);
            }
        }
    }
    return Object.freeze(result);
}
function coordKey(coord) {
    return `${coord.q},${coord.r}`;
}
function normalizeTerrainByCoord(value, width, height, terrainTypes) {
    const authored = plainRecord(value, "terrainByCoord");
    const expected = width * height;
    if (Object.keys(authored).length !== expected) {
        fail(`terrainByCoord must contain exactly ${expected} map cells.`);
    }
    const entries = [];
    for (const key of Object.keys(authored).sort(compareBinary)) {
        const match = /^(0|[1-9]\d*),(0|[1-9]\d*)$/.exec(key);
        if (!match)
            fail(`terrainByCoord key "${key}" must use canonical q,r coordinates.`);
        const q = Number(match[1]);
        const r = Number(match[2]);
        if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r) || q >= width || r >= height) {
            fail(`terrainByCoord key "${key}" is outside the ${width}x${height} map.`);
        }
        const terrainId = authored[key];
        if (typeof terrainId !== "string" || !Object.prototype.hasOwnProperty.call(terrainTypes, terrainId)) {
            fail(`terrainByCoord.${key} must reference a known terrain id.`);
        }
        entries.push([key, terrainId]);
    }
    const result = {};
    for (const [key, terrainId] of entries) {
        Object.defineProperty(result, key, { value: terrainId, enumerable: true });
    }
    for (let r = 0; r < height; r += 1) {
        for (let q = 0; q < width; q += 1) {
            if (!Object.prototype.hasOwnProperty.call(result, `${q},${r}`)) {
                fail(`terrainByCoord is missing cell ${q},${r}.`);
            }
        }
    }
    return Object.freeze({
        value: Object.freeze(result),
        signature: JSON.stringify(entries)
    });
}
function normalizeOccupiedCoords(value, width, height) {
    const authored = denseArray(value, "occupiedCoords", width * height);
    const byKey = new Map();
    for (let index = 0; index < authored.length; index += 1) {
        const coord = normalizeCoord(authored[index], `occupiedCoords[${index}]`, width, height);
        byKey.set(coordKey(coord), coord);
    }
    const coords = [...byKey.values()].sort(compareCoords);
    Object.freeze(coords);
    return Object.freeze({
        value: coords,
        signature: JSON.stringify(coords)
    });
}
function normalizeRouteEndpoints(value, context, width, height) {
    let prototype;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    }
    catch {
        return fail(`${context} could not be inspected safely.`);
    }
    if (!Array.isArray(value) || prototype !== Array.prototype) {
        return fail(`${context} must be an ordinary dense array.`);
    }
    let lengthDescriptor;
    try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    }
    catch {
        return fail(`${context} length could not be inspected safely.`);
    }
    if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) {
        return fail(`${context} has an invalid array length.`);
    }
    const length = lengthDescriptor.value;
    if (length < 2)
        fail(`${context} requires at least two endpoint coordinates.`);
    if (length > NAVIGATION_LIMITS.activeMapCells) {
        fail(`${context} exceeds the ${NAVIGATION_LIMITS.activeMapCells} point budget.`);
    }
    const endpointValues = [];
    for (const index of [0, length - 1]) {
        let descriptor;
        try {
            descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        }
        catch {
            return fail(`${context}[${index}] could not be inspected safely.`);
        }
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            fail(`${context}[${index}] must be an enumerable own data field.`);
        }
        endpointValues.push(descriptor.value);
    }
    return Object.freeze({
        start: normalizeCoord(endpointValues[0], `${context}[0]`, width, height),
        goal: normalizeCoord(endpointValues[1], `${context}[${length - 1}]`, width, height)
    });
}
function normalizeRoutes(value, width, height, movementProfileCount) {
    const authored = denseArray(value, "routes", NAVIGATION_LIMITS.routeEndpointPairs);
    if (authored.length === 0)
        fail("routes must contain at least one endpoint pair.");
    const routes = [];
    const ids = new Set();
    const goals = new Set();
    for (let routeIndex = 0; routeIndex < authored.length; routeIndex += 1) {
        const route = plainRecord(authored[routeIndex], `routes[${routeIndex}]`);
        exactKeys(route, ["id", "pathCenterline"], `routes[${routeIndex}]`);
        const id = boundedId(required(route, "id", `routes[${routeIndex}]`), `routes[${routeIndex}].id`);
        if (ids.has(id))
            fail(`routes contain duplicate route id "${id}".`);
        ids.add(id);
        const endpoints = normalizeRouteEndpoints(required(route, "pathCenterline", `routes[${routeIndex}]`), `routes[${routeIndex}].pathCenterline`, width, height);
        goals.add(coordKey(endpoints.goal));
        routes.push(Object.freeze({ id, start: endpoints.start, goal: endpoints.goal }));
    }
    if (goals.size > NAVIGATION_LIMITS.uniqueGoals) {
        fail(`routes exceed the ${NAVIGATION_LIMITS.uniqueGoals} unique-goal budget.`);
    }
    const profileGoalPairs = movementProfileCount * goals.size;
    if (!Number.isSafeInteger(profileGoalPairs) || profileGoalPairs > NAVIGATION_LIMITS.cachedProfileGoalPairs) {
        fail(`movement-profile/goal pairs exceed the ${NAVIGATION_LIMITS.cachedProfileGoalPairs} cache budget.`);
    }
    const materializedCells = width * height * profileGoalPairs;
    if (!Number.isSafeInteger(materializedCells) || materializedCells > NAVIGATION_LIMITS.materializedFieldCells) {
        fail(`navigation fields exceed the ${NAVIGATION_LIMITS.materializedFieldCells} materialized-cell budget.`);
    }
    routes.sort((left, right) => compareBinary(left.id, right.id));
    Object.freeze(routes);
    const byId = new Map(routes.map((route) => [route.id, route]));
    const signature = JSON.stringify(routes.map((route) => ({
        id: route.id,
        start: route.start,
        goal: route.goal
    })));
    return Object.freeze({ routes, byId, signature });
}
function cacheKey(movementProfileId, goal) {
    return JSON.stringify([movementProfileId, goal.q, goal.r]);
}
/** Derived, non-authoritative shared flow-field cache for one active dynamic profile. */
export class NavigationResolver {
    grid;
    width;
    height;
    profile;
    terrainTypes;
    terrainByCoord;
    occupiedCoords;
    routes;
    fields = new Map();
    fieldBuildCount = 0;
    fieldQueryCount = 0;
    generation = 0;
    dirty = false;
    constructor(value) {
        const request = plainRecord(value, "request");
        exactKeys(request, ["grid", "width", "height", "profile", "terrainTypes", "terrainByCoord", "occupiedCoords", "routes"], "request");
        const width = positiveDimension(required(request, "width", "request"), "width");
        const height = positiveDimension(required(request, "height", "request"), "height");
        const cellCount = width * height;
        if (!Number.isSafeInteger(cellCount) || cellCount > NAVIGATION_LIMITS.activeMapCells) {
            fail(`map dimensions exceed the ${NAVIGATION_LIMITS.activeMapCells} cell budget.`);
        }
        const profile = normalizeProfile(required(request, "profile", "request"));
        const terrainTypes = normalizeTerrainTypes(required(request, "terrainTypes", "request"), profile);
        this.grid = normalizeGrid(required(request, "grid", "request"));
        this.width = width;
        this.height = height;
        this.profile = profile;
        this.terrainTypes = terrainTypes;
        this.terrainByCoord = normalizeTerrainByCoord(required(request, "terrainByCoord", "request"), width, height, terrainTypes);
        this.occupiedCoords = normalizeOccupiedCoords(required(request, "occupiedCoords", "request"), width, height);
        this.routes = normalizeRoutes(required(request, "routes", "request"), width, height, Object.keys(profile.movementProfiles).length);
    }
    getField(movementProfileId, routeId) {
        this.incrementQueryCount();
        const safeMovementProfileId = boundedId(movementProfileId, "movementProfileId");
        const safeRouteId = boundedId(routeId, "routeId");
        if (!Object.prototype.hasOwnProperty.call(this.profile.movementProfiles, safeMovementProfileId)) {
            fail(`unknown movement profile "${safeMovementProfileId}".`);
        }
        const route = this.routes.byId.get(safeRouteId);
        if (!route)
            fail(`unknown route "${safeRouteId}".`);
        const key = cacheKey(safeMovementProfileId, route.goal);
        const installed = this.fields.get(key);
        if (installed) {
            this.dirty = false;
            return installed;
        }
        const field = buildNavigationField({
            grid: this.grid,
            width: this.width,
            height: this.height,
            movementProfileId: safeMovementProfileId,
            goal: route.goal,
            profile: this.profile.movementProfiles[safeMovementProfileId],
            terrainTypes: this.terrainTypes,
            terrainByCoord: this.terrainByCoord.value,
            occupiedCoords: this.occupiedCoords.value
        });
        if (this.fieldBuildCount === Number.MAX_SAFE_INTEGER)
            fail("field build counter overflowed.");
        this.fieldBuildCount += 1;
        this.fields.set(key, field);
        this.dirty = false;
        return field;
    }
    updateTerrainByCoord(value) {
        const candidate = normalizeTerrainByCoord(value, this.width, this.height, this.terrainTypes);
        if (candidate.signature === this.terrainByCoord.signature)
            return false;
        this.prepareInvalidation();
        this.terrainByCoord = candidate;
        this.invalidateFields(() => true);
        return true;
    }
    updateOccupiedCoords(value) {
        const candidate = normalizeOccupiedCoords(value, this.width, this.height);
        if (candidate.signature === this.occupiedCoords.signature)
            return false;
        this.prepareInvalidation();
        this.occupiedCoords = candidate;
        this.invalidateFields((field) => (this.profile.movementProfiles[field.movementProfileId]?.towerOccupancy === "blocked"));
        return true;
    }
    updateRoutes(value) {
        const candidate = normalizeRoutes(value, this.width, this.height, Object.keys(this.profile.movementProfiles).length);
        if (candidate.signature === this.routes.signature)
            return false;
        this.prepareInvalidation();
        this.routes = candidate;
        const retainedGoals = new Set(candidate.routes.map((route) => coordKey(route.goal)));
        this.invalidateFields((field) => !retainedGoals.has(coordKey(field.goal)));
        return true;
    }
    getStats() {
        return Object.freeze({
            fieldBuildCount: this.fieldBuildCount,
            fieldQueryCount: this.fieldQueryCount,
            generation: this.generation
        });
    }
    incrementQueryCount() {
        if (this.fieldQueryCount === Number.MAX_SAFE_INTEGER)
            fail("field query counter overflowed.");
        this.fieldQueryCount += 1;
    }
    prepareInvalidation() {
        if (!this.dirty && this.generation === Number.MAX_SAFE_INTEGER) {
            fail("navigation resolver generation overflowed.");
        }
    }
    invalidateFields(predicate) {
        for (const [key, field] of this.fields) {
            if (predicate(field))
                this.fields.delete(key);
        }
        if (!this.dirty) {
            this.generation += 1;
            this.dirty = true;
        }
    }
}
