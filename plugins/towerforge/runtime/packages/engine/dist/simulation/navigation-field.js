import { NAVIGATION_LIMITS } from "../content/navigation-mechanics.js";
import { createGridTopology } from "./topology.js";
/** Closed runtime-input budgets for one pure field build. */
export const NAVIGATION_FIELD_INPUT_LIMITS = Object.freeze({
    terrainDefinitions: NAVIGATION_LIMITS.terrainDefinitions,
    terrainTagsPerDefinition: NAVIGATION_LIMITS.terrainTagsPerDefinition,
    terrainTagsAcrossDefinitions: NAVIGATION_LIMITS.terrainTagsAcrossDefinitions,
    terrainTagUtf8Bytes: NAVIGATION_LIMITS.terrainTagUtf8Bytes,
    terrainLabelLength: NAVIGATION_LIMITS.labelLength
});
const DEFAULT_MAX_RELAXATIONS = NAVIGATION_LIMITS.placementAnalysisRelaxations;
function fail(message) {
    throw new Error(`Invalid navigation field request: ${message}`);
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
        return fail(`${context} must be a plain object containing own data fields.`);
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
function denseArray(value, context, maxLength) {
    let prototype;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    }
    catch {
        return fail(`${context} array could not be inspected safely.`);
    }
    if (!Array.isArray(value) || prototype !== Array.prototype) {
        return fail(`${context} must be an ordinary dense array.`);
    }
    let earlyLengthDescriptor;
    try {
        earlyLengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    }
    catch {
        return fail(`${context} array length could not be inspected safely.`);
    }
    if (!earlyLengthDescriptor
        || !("value" in earlyLengthDescriptor)
        || !Number.isSafeInteger(earlyLengthDescriptor.value)) {
        return fail(`${context} array has an invalid length.`);
    }
    const earlyLength = earlyLengthDescriptor.value;
    if (maxLength !== undefined && earlyLength > maxLength) {
        return fail(`${context} array exceeds the ${maxLength} item budget.`);
    }
    const descriptors = inspectDescriptors(value, `${context} array`);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        return fail(`${context} array must not contain symbol fields.`);
    }
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) {
        return fail(`${context} array has an invalid length.`);
    }
    const length = lengthDescriptor.value;
    if (length !== earlyLength)
        return fail(`${context} array length changed during inspection.`);
    const values = [];
    for (const key of Object.keys(descriptors)) {
        if (key === "length")
            continue;
        if (!/^(0|[1-9]\d*)$/.test(key)) {
            return fail(`${context} array contains an unsupported non-index field.`);
        }
        const index = Number(key);
        const descriptor = descriptors[key];
        if (index >= length || !descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            return fail(`${context} array contains a sparse index or non-data field.`);
        }
        values[index] = descriptor.value;
    }
    if (Object.keys(descriptors).length !== length + 1 || values.length !== length) {
        return fail(`${context} array must not be sparse.`);
    }
    return values;
}
function exactKeys(record, keys, context) {
    const allowed = new Set(keys);
    for (const key of Object.keys(record)) {
        if (!allowed.has(key))
            fail(`${context} contains unknown field "${key}".`);
    }
}
function required(record, key, context) {
    if (!Object.prototype.hasOwnProperty.call(record, key))
        fail(`${context}.${key} is required.`);
    return record[key];
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
        fail(`${context} exceeds the ${NAVIGATION_LIMITS.idUtf8Bytes} UTF-8 byte limit.`);
    }
    return value;
}
function positiveSafeInteger(value, context, maximum) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        return fail(`${context} must be a safe integer in the range 1..${maximum}.`);
    }
    return value;
}
function terrainCost(value, context) {
    if (value === null)
        return null;
    return positiveSafeInteger(value, context, NAVIGATION_LIMITS.terrainCost);
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
function normalizeProfile(value) {
    const profile = plainRecord(value, "profile");
    exactKeys(profile, ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost", "terrainCosts"], "profile");
    const label = required(profile, "label", "profile");
    if (typeof label !== "string" || label.length === 0 || label.length > NAVIGATION_LIMITS.labelLength) {
        fail(`profile.label must contain 1..${NAVIGATION_LIMITS.labelLength} characters.`);
    }
    const terrainMode = required(profile, "terrainMode", "profile");
    if (terrainMode !== "respect_walkable" && terrainMode !== "ignore_walkable") {
        fail("profile.terrainMode must be respect_walkable or ignore_walkable.");
    }
    const towerOccupancy = required(profile, "towerOccupancy", "profile");
    if (towerOccupancy !== "blocked" && towerOccupancy !== "ignored") {
        fail("profile.towerOccupancy must be blocked or ignored.");
    }
    const defaultTerrainCost = terrainCost(required(profile, "defaultTerrainCost", "profile"), "profile.defaultTerrainCost");
    let terrainCosts;
    if (Object.prototype.hasOwnProperty.call(profile, "terrainCosts") && profile.terrainCosts !== undefined) {
        const authored = plainRecord(profile.terrainCosts, "profile.terrainCosts");
        const ids = Object.keys(authored).sort(compareBinary);
        if (ids.length > NAVIGATION_LIMITS.terrainOverridesPerProfile) {
            fail(`profile.terrainCosts exceeds the ${NAVIGATION_LIMITS.terrainOverridesPerProfile} override budget.`);
        }
        const normalized = {};
        for (const terrainId of ids) {
            boundedId(terrainId, `profile.terrainCosts.${terrainId}`);
            Object.defineProperty(normalized, terrainId, {
                value: terrainCost(authored[terrainId], `profile.terrainCosts.${terrainId}`),
                enumerable: true
            });
        }
        terrainCosts = Object.freeze(normalized);
    }
    return Object.freeze({
        label: label,
        terrainMode,
        towerOccupancy,
        defaultTerrainCost,
        ...(terrainCosts === undefined ? {} : { terrainCosts })
    });
}
function normalizeTerrainTypes(value) {
    const authored = plainRecord(value, "terrainTypes");
    const terrainIds = Object.keys(authored);
    if (terrainIds.length > NAVIGATION_FIELD_INPUT_LIMITS.terrainDefinitions) {
        fail(`terrainTypes definition count exceeds the `
            + `${NAVIGATION_FIELD_INPUT_LIMITS.terrainDefinitions} definition budget.`);
    }
    const result = new Map();
    let totalTagCount = 0;
    for (const terrainId of terrainIds.sort(compareBinary)) {
        boundedId(terrainId, `terrainTypes.${terrainId}`);
        const definition = plainRecord(authored[terrainId], `terrainTypes.${terrainId}`);
        exactKeys(definition, ["id", "label", "buildable", "walkable", "groundSpeedMultiplier", "tags"], `terrainTypes.${terrainId}`);
        if (boundedId(required(definition, "id", `terrainTypes.${terrainId}`), `terrainTypes.${terrainId}.id`) !== terrainId) {
            fail(`terrainTypes.${terrainId}.id must match its record key.`);
        }
        const label = required(definition, "label", `terrainTypes.${terrainId}`);
        if (typeof label !== "string"
            || label.length === 0
            || label.length > NAVIGATION_FIELD_INPUT_LIMITS.terrainLabelLength) {
            fail(`terrainTypes.${terrainId}.label must contain `
                + `1..${NAVIGATION_FIELD_INPUT_LIMITS.terrainLabelLength} characters.`);
        }
        if (typeof required(definition, "buildable", `terrainTypes.${terrainId}`) !== "boolean") {
            fail(`terrainTypes.${terrainId}.buildable must be boolean.`);
        }
        const walkable = required(definition, "walkable", `terrainTypes.${terrainId}`);
        if (typeof walkable !== "boolean")
            fail(`terrainTypes.${terrainId}.walkable must be boolean.`);
        const speed = required(definition, "groundSpeedMultiplier", `terrainTypes.${terrainId}`);
        if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0) {
            fail(`terrainTypes.${terrainId}.groundSpeedMultiplier must be a finite non-negative number.`);
        }
        const tags = denseArray(required(definition, "tags", `terrainTypes.${terrainId}`), `terrainTypes.${terrainId}.tags`, NAVIGATION_FIELD_INPUT_LIMITS.terrainTagsPerDefinition);
        totalTagCount += tags.length;
        if (totalTagCount > NAVIGATION_FIELD_INPUT_LIMITS.terrainTagsAcrossDefinitions) {
            fail(`terrainTypes total tags exceed the `
                + `${NAVIGATION_FIELD_INPUT_LIMITS.terrainTagsAcrossDefinitions} tag budget.`);
        }
        for (let tagIndex = 0; tagIndex < tags.length; tagIndex += 1) {
            const tag = tags[tagIndex];
            if (typeof tag !== "string")
                fail(`terrainTypes.${terrainId}.tags must contain strings.`);
            if (utf8ByteLength(tag) > NAVIGATION_FIELD_INPUT_LIMITS.terrainTagUtf8Bytes) {
                fail(`terrainTypes.${terrainId}.tags[${tagIndex}] exceeds the `
                    + `${NAVIGATION_FIELD_INPUT_LIMITS.terrainTagUtf8Bytes} UTF-8 byte budget.`);
            }
        }
        result.set(terrainId, walkable);
    }
    return result;
}
function coordKey(coord) {
    return `${coord.q},${coord.r}`;
}
function parseCoordKey(value, width, height, context) {
    const match = /^(0|[1-9]\d*),(0|[1-9]\d*)$/.exec(value);
    if (!match)
        return fail(`${context} key "${value}" must use canonical q,r coordinates.`);
    const q = Number(match[1]);
    const r = Number(match[2]);
    if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r) || q >= width || r >= height) {
        return fail(`${context} key "${value}" is outside the ${width}x${height} map.`);
    }
    return { q, r };
}
function normalizeTerrainGrid(value, width, height, terrainTypes) {
    const authored = plainRecord(value, "terrainByCoord");
    const expected = width * height;
    if (Object.keys(authored).length !== expected) {
        fail(`terrainByCoord must provide exactly ${expected} map cells.`);
    }
    const result = new Map();
    for (const key of Object.keys(authored).sort(compareBinary)) {
        parseCoordKey(key, width, height, "terrainByCoord");
        const terrainId = authored[key];
        if (typeof terrainId !== "string" || !terrainTypes.has(terrainId)) {
            fail(`terrainByCoord.${key} must reference a known terrain id.`);
        }
        result.set(key, terrainId);
    }
    for (let r = 0; r < height; r += 1) {
        for (let q = 0; q < width; q += 1) {
            if (!result.has(`${q},${r}`))
                fail(`terrainByCoord is missing cell ${q},${r}.`);
        }
    }
    return result;
}
function normalizeOccupiedCoords(value, width, height) {
    const authored = denseArray(value, "occupiedCoords");
    if (authored.length > width * height)
        fail("occupiedCoords exceeds the map cell budget.");
    const result = new Set();
    for (let index = 0; index < authored.length; index += 1) {
        result.add(coordKey(normalizeCoord(authored[index], `occupiedCoords[${index}]`, width, height)));
    }
    return result;
}
function normalizeBudget(value) {
    if (value === undefined) {
        return { maxCells: NAVIGATION_LIMITS.activeMapCells, maxRelaxations: DEFAULT_MAX_RELAXATIONS };
    }
    const budget = plainRecord(value, "budget");
    exactKeys(budget, ["maxCells", "maxRelaxations"], "budget");
    const maxCells = budget.maxCells === undefined
        ? NAVIGATION_LIMITS.activeMapCells
        : positiveSafeInteger(budget.maxCells, "budget.maxCells", NAVIGATION_LIMITS.activeMapCells);
    const maxRelaxations = budget.maxRelaxations === undefined
        ? DEFAULT_MAX_RELAXATIONS
        : positiveSafeInteger(budget.maxRelaxations, "budget.maxRelaxations", DEFAULT_MAX_RELAXATIONS);
    return { maxCells, maxRelaxations };
}
function normalizeRequest(value) {
    const request = plainRecord(value, "request");
    exactKeys(request, [
        "grid", "width", "height", "movementProfileId", "goal", "profile",
        "terrainTypes", "terrainByCoord", "occupiedCoords", "budget"
    ], "request");
    const width = positiveSafeInteger(required(request, "width", "request"), "width", NAVIGATION_LIMITS.activeMapCells);
    const height = positiveSafeInteger(required(request, "height", "request"), "height", NAVIGATION_LIMITS.activeMapCells);
    const budget = normalizeBudget(request.budget);
    const cellCount = width * height;
    if (!Number.isSafeInteger(cellCount) || cellCount > NAVIGATION_LIMITS.activeMapCells || cellCount > budget.maxCells) {
        fail(`map dimensions contain ${cellCount} cells, exceeding the ${budget.maxCells} cell budget `
            + `(platform maximum ${NAVIGATION_LIMITS.activeMapCells}).`);
    }
    const terrainTypes = normalizeTerrainTypes(required(request, "terrainTypes", "request"));
    return {
        grid: normalizeGrid(required(request, "grid", "request")),
        width,
        height,
        movementProfileId: boundedId(required(request, "movementProfileId", "request"), "movementProfileId"),
        goal: normalizeCoord(required(request, "goal", "request"), "goal", width, height),
        profile: normalizeProfile(required(request, "profile", "request")),
        terrainWalkability: terrainTypes,
        terrainByCoord: normalizeTerrainGrid(required(request, "terrainByCoord", "request"), width, height, terrainTypes),
        occupiedKeys: normalizeOccupiedCoords(required(request, "occupiedCoords", "request"), width, height),
        maxRelaxations: budget.maxRelaxations
    };
}
function compareBinary(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function compareCoords(left, right) {
    return left.r - right.r || left.q - right.q;
}
function compareQueue(left, right) {
    return left.distance - right.distance || compareCoords(left.coord, right.coord);
}
class MinQueue {
    entries = [];
    push(entry) {
        let index = this.entries.length;
        this.entries.push(entry);
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            const parentEntry = this.entries[parent];
            if (compareQueue(parentEntry, entry) <= 0)
                break;
            this.entries[index] = parentEntry;
            index = parent;
        }
        this.entries[index] = entry;
    }
    pop() {
        const first = this.entries[0];
        const tail = this.entries.pop();
        if (!first || !tail || this.entries.length === 0)
            return first;
        let index = 0;
        while (true) {
            const leftIndex = index * 2 + 1;
            const rightIndex = leftIndex + 1;
            if (leftIndex >= this.entries.length)
                break;
            let childIndex = leftIndex;
            if (rightIndex < this.entries.length
                && compareQueue(this.entries[rightIndex], this.entries[leftIndex]) < 0) {
                childIndex = rightIndex;
            }
            const child = this.entries[childIndex];
            if (compareQueue(tail, child) <= 0)
                break;
            this.entries[index] = child;
            index = childIndex;
        }
        this.entries[index] = tail;
        return first;
    }
}
function inside(coord, request) {
    return coord.q >= 0 && coord.q < request.width && coord.r >= 0 && coord.r < request.height;
}
function effectiveCost(coord, request) {
    const key = coordKey(coord);
    if (request.profile.towerOccupancy === "blocked" && request.occupiedKeys.has(key))
        return null;
    const terrainId = request.terrainByCoord.get(key);
    if (terrainId === undefined)
        return null;
    const hasOverride = Object.prototype.hasOwnProperty.call(request.profile.terrainCosts ?? {}, terrainId);
    if (hasOverride)
        return request.profile.terrainCosts[terrainId] ?? null;
    if (request.profile.terrainMode === "respect_walkable" && request.terrainWalkability.get(terrainId) !== true) {
        return null;
    }
    return request.profile.defaultTerrainCost;
}
function directionIndex(from, to, neighbors) {
    const index = neighbors.findIndex((candidate) => candidate.q === to.q && candidate.r === to.r);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
function prefersNext(origin, candidate, incumbent, neighbors) {
    if (!incumbent)
        return true;
    const candidateDirection = directionIndex(origin, candidate, neighbors);
    const incumbentDirection = directionIndex(origin, incumbent, neighbors);
    return candidateDirection < incumbentDirection
        || (candidateDirection === incumbentDirection && compareCoords(candidate, incumbent) < 0);
}
function freezeCoord(coord) {
    return Object.freeze({ q: coord.q, r: coord.r });
}
/**
 * Builds one canonical reverse-Dijkstra field. The function is pure: inputs are safely detached,
 * no cache or RNG is consulted, and every returned gameplay value is deeply frozen.
 */
export function buildNavigationField(request) {
    const normalized = normalizeRequest(request);
    const topology = createGridTopology(normalized.grid);
    const goalKey = coordKey(normalized.goal);
    const distances = new Map();
    const nextByCoord = new Map();
    const coordsByKey = new Map();
    const queue = new MinQueue();
    let relaxations = 0;
    if (effectiveCost(normalized.goal, normalized) !== null) {
        distances.set(goalKey, 0);
        coordsByKey.set(goalKey, normalized.goal);
        queue.push({ coord: normalized.goal, distance: 0 });
    }
    for (let current = queue.pop(); current; current = queue.pop()) {
        const currentKey = coordKey(current.coord);
        if (distances.get(currentKey) !== current.distance)
            continue;
        const enteredCost = effectiveCost(current.coord, normalized);
        if (enteredCost === null)
            continue;
        for (const predecessor of topology.neighbors(current.coord)) {
            if (!inside(predecessor, normalized) || effectiveCost(predecessor, normalized) === null)
                continue;
            relaxations += 1;
            if (relaxations > normalized.maxRelaxations) {
                fail(`relaxation budget ${normalized.maxRelaxations} was exceeded.`);
            }
            const candidateDistance = current.distance + enteredCost;
            if (!Number.isSafeInteger(candidateDistance))
                fail("distance addition exceeded the safe-integer range.");
            const predecessorKey = coordKey(predecessor);
            const incumbentDistance = distances.get(predecessorKey);
            if (incumbentDistance === undefined || candidateDistance < incumbentDistance) {
                distances.set(predecessorKey, candidateDistance);
                coordsByKey.set(predecessorKey, { q: predecessor.q, r: predecessor.r });
                nextByCoord.set(predecessorKey, { q: current.coord.q, r: current.coord.r });
                queue.push({ coord: { q: predecessor.q, r: predecessor.r }, distance: candidateDistance });
            }
            else if (candidateDistance === incumbentDistance) {
                const orderedNeighbors = topology.neighbors(predecessor);
                if (prefersNext(predecessor, current.coord, nextByCoord.get(predecessorKey), orderedNeighbors)) {
                    nextByCoord.set(predecessorKey, { q: current.coord.q, r: current.coord.r });
                }
            }
        }
    }
    const cells = [...distances.entries()]
        .map(([key, distance]) => {
        const coord = freezeCoord(coordsByKey.get(key));
        const next = nextByCoord.get(key);
        return Object.freeze({
            coord,
            distance,
            ...(next === undefined ? {} : { nextCoord: freezeCoord(next) })
        });
    })
        .sort((left, right) => compareCoords(left.coord, right.coord));
    return Object.freeze({
        movementProfileId: normalized.movementProfileId,
        goal: freezeCoord(normalized.goal),
        cells: Object.freeze(cells),
        stats: Object.freeze({ relaxations })
    });
}
