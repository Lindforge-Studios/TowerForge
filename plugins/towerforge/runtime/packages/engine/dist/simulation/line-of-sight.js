import { LINE_OF_SIGHT_LIMITS } from "../content/elevation-mechanics.js";
function fail(message) {
    throw new Error(`Line-of-sight analysis request is invalid: ${message}`);
}
function ownPlainRecord(value, context) {
    let prototype;
    let descriptors;
    let array;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object" ? Object.getOwnPropertyDescriptors(value) : {};
        array = Array.isArray(value);
    }
    catch {
        return fail(`${context} could not be inspected safely.`);
    }
    if (value === null || typeof value !== "object" || array || prototype !== Object.prototype) {
        return fail(`${context} must be a plain object with own data fields.`);
    }
    if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) {
        fail(`${context} must not contain symbol fields.`);
    }
    const result = {};
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            fail(`${context}.${key} must be an enumerable own data field; accessors are not allowed.`);
        }
        result[key] = descriptor.value;
    }
    return result;
}
function exactKeys(record, expected, context) {
    const keys = Object.keys(record).sort();
    const canonical = [...expected].sort();
    if (keys.length !== canonical.length || keys.some((key, index) => key !== canonical[index])) {
        fail(`${context} must contain exactly ${expected.join(", ")}.`);
    }
}
function coordinate(value, map, context) {
    const record = ownPlainRecord(value, context);
    exactKeys(record, ["q", "r"], context);
    const q = record.q;
    const r = record.r;
    if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) {
        fail(`${context} q/r must be safe integer coordinates.`);
    }
    const result = { q: q, r: r };
    if (!map.isInside(result))
        fail(`${context} coordinate is outside map bounds.`);
    return result;
}
function targetArray(value, map) {
    let descriptors;
    let prototype;
    let array;
    try {
        array = Array.isArray(value);
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        return fail("targets could not be inspected safely.");
    }
    if (!array || prototype !== Array.prototype)
        fail("targets must be an ordinary dense array.");
    const lengthValue = descriptors.length?.value;
    if (!Number.isSafeInteger(lengthValue) || lengthValue < 0) {
        fail("targets must expose a safe array length.");
    }
    const length = lengthValue;
    if (length > LINE_OF_SIGHT_LIMITS.analysisTargets) {
        fail(`targets exceed the ${LINE_OF_SIGHT_LIMITS.analysisTargets} target budget.`);
    }
    if (Reflect.ownKeys(descriptors).some((key) => {
        if (key === "length")
            return false;
        if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key))
            return true;
        return Number(key) >= length;
    }))
        fail("targets must not contain extra string or symbol fields.");
    const result = [];
    const seen = new Set();
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            fail(`targets[${index}] must be an own data item; sparse arrays and accessors are not allowed.`);
        }
        const item = coordinate(descriptor.value, map, `targets[${index}]`);
        const key = `${item.q},${item.r}`;
        if (seen.has(key))
            fail("targets must contain unique coordinates; duplicate target found.");
        seen.add(key);
        result.push(item);
    }
    return result.sort((left, right) => left.r - right.r || left.q - right.q);
}
export function normalizeLineOfSightAnalysisRequestV1(value, map) {
    const request = ownPlainRecord(value, "request");
    exactKeys(request, ["source", "targets"], "request");
    const source = Object.freeze(coordinate(request.source, map, "source"));
    const targets = Object.freeze(targetArray(request.targets, map).map((item) => Object.freeze(item)));
    return Object.freeze({ source, targets });
}
function blocker(coord, terrainId, elevation, tag) {
    return Object.freeze({
        coord: Object.freeze({ ...coord }),
        terrainId,
        elevation,
        ...(tag === undefined ? {} : { tag })
    });
}
function row(target, visible, reason, blockedBy) {
    return Object.freeze({
        target: Object.freeze({ ...target }),
        visible,
        reason,
        ...(blockedBy === undefined ? {} : { blocker: blockedBy })
    });
}
export function traceLineOfSight(map, terrainTypes, terrainBlockerTags, source, target, remainingCellInspections = LINE_OF_SIGHT_LIMITS.cellInspectionsPerOperation) {
    const distance = map.distance(source, target);
    if (distance > LINE_OF_SIGHT_LIMITS.maximumRayDistance) {
        return { row: row(target, false, "ray_budget_exceeded"), cellInspections: 0, budgetExceeded: true };
    }
    const line = map.line(source, target);
    const steps = line.length - 1;
    if (steps <= 1)
        return { row: row(target, true, "clear"), cellInspections: 0, budgetExceeded: false };
    const sourceElevation = map.elevationAt(source);
    const targetElevation = map.elevationAt(target);
    if (sourceElevation === undefined || targetElevation === undefined) {
        return { row: row(target, false, "operation_budget_exceeded"), cellInspections: 0, budgetExceeded: true };
    }
    const blockers = new Set(terrainBlockerTags);
    let inspections = 0;
    for (let index = 1; index < line.length - 1; index += 1) {
        if (inspections >= remainingCellInspections) {
            return {
                row: row(target, false, "operation_budget_exceeded"),
                cellInspections: inspections,
                budgetExceeded: true
            };
        }
        inspections += 1;
        const coord = line[index];
        const tile = map.getTile(coord);
        const elevation = map.elevationAt(coord);
        if (!tile || elevation === undefined) {
            return {
                row: row(target, false, "operation_budget_exceeded"),
                cellInspections: inspections,
                budgetExceeded: true
            };
        }
        const terrainTags = terrainTypes[tile.terrain]?.tags ?? [];
        let matchingTag;
        for (const tag of terrainTags) {
            if (blockers.has(tag) && (matchingTag === undefined || tag < matchingTag))
                matchingTag = tag;
        }
        if (matchingTag !== undefined) {
            return {
                row: row(target, false, "terrain_tag", blocker(coord, tile.terrain, elevation, matchingTag)),
                cellInspections: inspections,
                budgetExceeded: false
            };
        }
        const rayHeightNumerator = (sourceElevation + 1) * (steps - index) + (targetElevation + 1) * index;
        if (elevation * steps >= rayHeightNumerator) {
            return {
                row: row(target, false, "elevation", blocker(coord, tile.terrain, elevation)),
                cellInspections: inspections,
                budgetExceeded: false
            };
        }
    }
    return { row: row(target, true, "clear"), cellInspections: inspections, budgetExceeded: false };
}
export function analyzeLineOfSightTargets(map, terrainTypes, profile, request) {
    let remaining = LINE_OF_SIGHT_LIMITS.cellInspectionsPerOperation;
    let inspected = 0;
    let budgetExceeded = false;
    const rows = [];
    for (const target of request.targets) {
        const result = traceLineOfSight(map, terrainTypes, profile.terrainBlockerTags, request.source, target, remaining);
        rows.push(result.row);
        inspected += result.cellInspections;
        remaining = Math.max(0, remaining - result.cellInspections);
        budgetExceeded ||= result.budgetExceeded;
    }
    return Object.freeze({
        schemaVersion: 1,
        profileId: profile.profileId,
        source: Object.freeze({ ...request.source }),
        rows: Object.freeze(rows),
        coverage: Object.freeze({
            requestedTargets: request.targets.length,
            analyzedTargets: rows.length,
            cellInspections: inspected,
            budgetExceeded
        })
    });
}
