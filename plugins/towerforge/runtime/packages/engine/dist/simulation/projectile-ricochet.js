import { RICOCHET_LIMITS } from "../content/ballistics-mechanics.js";
function fail(message) {
    throw new Error(`Projectile ricochet request is invalid: ${message}`);
}
function inspectRecord(value, context) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return fail(`${context} must be a plain object with own data fields.`);
    }
    let prototype;
    let descriptors;
    try {
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        return fail(`${context} could not be inspected safely.`);
    }
    if (prototype !== Object.prototype)
        fail(`${context} must use the plain object prototype.`);
    if (Object.getOwnPropertySymbols(descriptors).length > 0)
        fail(`${context} rejects symbol fields.`);
    const result = {};
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            fail(`${context}.${key} must be an enumerable own data field; accessors are forbidden.`);
        }
        result[key] = descriptor.value;
    }
    return result;
}
function exactKeys(record, keys, context) {
    const actual = Object.keys(record).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        fail(`${context} has missing or unsupported fields.`);
    }
}
function coord(value, map, context) {
    const record = inspectRecord(value, context);
    exactKeys(record, ["q", "r"], context);
    if (!Number.isSafeInteger(record.q) || !Number.isSafeInteger(record.r)) {
        fail(`${context} must contain safe integer coordinates.`);
    }
    const result = { q: record.q, r: record.r };
    if (!map.isInside(result))
        fail(`${context} is outside the map.`);
    return result;
}
const OPPOSITE_DIRECTION = Object.freeze({
    N: "S", S: "N", E: "W", W: "E", NE: "SW", SW: "NE", NW: "SE", SE: "NW"
});
/** Plan one deterministic topology-owned backscatter ray without inspecting gameplay entities. */
export function traceProjectileRicochetRayV1(map, value, remainingCellInspections = RICOCHET_LIMITS.cellInspectionsPerTick) {
    const request = inspectRecord(value, "request");
    exactKeys(request, ["kind", "incomingFromCoord", "collisionCoord", "rangeCells"], "request");
    if (request.kind !== "terrain" && request.kind !== "armor")
        fail("kind must be terrain or armor.");
    const incomingFromCoord = coord(request.incomingFromCoord, map, "incomingFromCoord");
    const collisionCoord = coord(request.collisionCoord, map, "collisionCoord");
    if (!Number.isSafeInteger(request.rangeCells)
        || request.rangeCells < 1
        || request.rangeCells > RICOCHET_LIMITS.maximumReflectedRayDistance) {
        fail(`rangeCells must be a safe integer in 1..${RICOCHET_LIMITS.maximumReflectedRayDistance}.`);
    }
    if (!Number.isSafeInteger(remainingCellInspections) || remainingCellInspections < 0) {
        fail("remaining cell inspection budget must be a non-negative safe integer.");
    }
    const incomingDirection = map.directionBetween(incomingFromCoord, collisionCoord);
    if (incomingDirection === undefined)
        fail("incoming and collision coordinates must be topology-adjacent.");
    const outgoingDirection = OPPOSITE_DIRECTION[incomingDirection];
    const nextSourceCoord = request.kind === "terrain" ? incomingFromCoord : collisionCoord;
    const ray = [];
    let current = nextSourceCoord;
    let inspections = 0;
    for (let index = 0; index < request.rangeCells; index += 1) {
        if (inspections >= remainingCellInspections) {
            return Object.freeze({ ok: false, reason: "operation_budget_exceeded", cellInspections: inspections });
        }
        const next = map.neighbors(current).find((candidate) => map.directionBetween(current, candidate) === outgoingDirection);
        if (!next || !map.isInside(next))
            break;
        inspections += 1;
        const detached = Object.freeze({ q: next.q, r: next.r });
        ray.push(detached);
        current = detached;
    }
    return Object.freeze({
        ok: true,
        nextSourceCoord: Object.freeze({ ...nextSourceCoord }),
        ray: Object.freeze(ray),
        cellInspections: inspections
    });
}
