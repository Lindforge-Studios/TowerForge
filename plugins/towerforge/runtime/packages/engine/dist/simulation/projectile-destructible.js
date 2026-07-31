import { DESTRUCTIBLE_ENVIRONMENT_LIMITS } from "../content/ballistics-mechanics.js";
import { DamageResolver } from "./damage.js";
import { projectileAltitudeAtProgress } from "./projectile-clearance.js";
export const DESTRUCTIBLE_COLLISION_LIMITS = Object.freeze({
    maximumRayDistance: 256,
    cellInspectionsPerTick: 1_048_576
});
const collisionBodiesByIndex = new WeakMap();
function fail(context, message) {
    throw new Error(`${context} is invalid: ${message}`);
}
function inspectRecord(value, context) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return fail(context, "expected a plain object with own data fields.");
    }
    let prototype;
    let descriptors;
    try {
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        return fail(context, "value could not be inspected safely.");
    }
    if (prototype !== Object.prototype && prototype !== null) {
        return fail(context, "expected the plain object prototype.");
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        return fail(context, "symbol fields are not supported.");
    }
    const result = Object.create(null);
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            return fail(context, `${key} must be an enumerable own data field; accessors are forbidden.`);
        }
        Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
    }
    return result;
}
function exactKeys(record, allowed, context) {
    const actual = Object.keys(record).sort();
    const expected = [...allowed].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        fail(context, "contains missing or unsupported fields.");
    }
}
function keysWithOptional(record, required, optional, context) {
    const actual = Object.keys(record);
    const allowed = new Set([...required, ...optional]);
    if (required.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
        || actual.some((key) => !allowed.has(key))) {
        fail(context, "contains missing or unsupported fields.");
    }
}
function inspectDenseArray(value, context) {
    let isArray;
    let prototype = null;
    let descriptors;
    try {
        isArray = Array.isArray(value);
        prototype = isArray ? Object.getPrototypeOf(value) : null;
        descriptors = isArray
            ? Object.getOwnPropertyDescriptors(value)
            : {};
    }
    catch {
        return fail(context, "list could not be inspected safely.");
    }
    if (!isArray)
        return fail(context, "expected an array.");
    if (prototype !== Array.prototype)
        return fail(context, "expected the standard array prototype.");
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        return fail(context, "symbol fields are not supported.");
    }
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) {
        return fail(context, "array length could not be inspected safely.");
    }
    const length = lengthDescriptor.value;
    const expectedKeys = new Set(["length", ...Array.from({ length }, (_, index) => String(index))]);
    if (Object.keys(descriptors).some((key) => !expectedKeys.has(key))) {
        return fail(context, "array contains unsupported placement fields.");
    }
    const result = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            return fail(context, `array must be dense and index ${index} must be an own data field.`);
        }
        result.push(descriptor.value);
    }
    return result;
}
function nonEmptyId(value, context) {
    if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()
        || /[\u0000-\u001f\u007f]/u.test(value)
        || utf8ByteLength(value) > DESTRUCTIBLE_ENVIRONMENT_LIMITS.idUtf8Bytes) {
        return fail(context, "must be a non-empty bounded id without surrounding whitespace or ASCII controls.");
    }
    return value;
}
function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code < 0x80)
            bytes += 1;
        else if (code < 0x800)
            bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff
            && index + 1 < value.length
            && value.charCodeAt(index + 1) >= 0xdc00
            && value.charCodeAt(index + 1) <= 0xdfff) {
            bytes += 4;
            index += 1;
        }
        else
            bytes += 3;
    }
    return bytes;
}
function finiteNumber(value, context, minimum = Number.NEGATIVE_INFINITY) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
        return fail(context, "must be a finite number in the supported range.");
    }
    return value;
}
function inspectCoord(value, map, context) {
    const record = inspectRecord(value, context);
    exactKeys(record, ["q", "r"], context);
    if (!Number.isSafeInteger(record.q) || !Number.isSafeInteger(record.r)) {
        return fail(context, "coordinate components must be safe integers.");
    }
    const coord = { q: record.q, r: record.r };
    if (!map.isInside(coord))
        return fail(context, "coordinate is outside the map.");
    return Object.freeze(coord);
}
function coordKey(coord) {
    return `${coord.q},${coord.r}`;
}
function binaryCompare(left, right) {
    return left.coord.r - right.coord.r
        || left.coord.q - right.coord.q
        || (left.objectId < right.objectId ? -1 : left.objectId > right.objectId ? 1 : 0);
}
/** Build a detached O(1) lookup for launch-time fixed projectile collision. */
export function createDestructibleCollisionIndexV1(map, value) {
    const authored = inspectDenseArray(value, "Destructible collision body index");
    if (authored.length > DESTRUCTIBLE_ENVIRONMENT_LIMITS.placementsPerMap) {
        fail("Destructible collision body index", "placement budget exceeded.");
    }
    const bodies = [];
    const objectIds = new Set();
    const cells = new Set();
    for (let index = 0; index < authored.length; index += 1) {
        const context = `Destructible collision body ${index}`;
        const record = inspectRecord(authored[index], context);
        exactKeys(record, ["objectId", "definitionId", "coord", "blockerHeight"], context);
        const objectId = nonEmptyId(record.objectId, `${context} objectId`);
        const definitionId = nonEmptyId(record.definitionId, `${context} definitionId`);
        const coord = inspectCoord(record.coord, map, `${context} coordinate`);
        const blockerHeight = finiteNumber(record.blockerHeight, `${context} blockerHeight`, 0);
        if (blockerHeight > DESTRUCTIBLE_ENVIRONMENT_LIMITS.maximumBlockerHeight) {
            fail(context, "blockerHeight exceeds the supported maximum.");
        }
        const cell = coordKey(coord);
        if (objectIds.has(objectId))
            fail(context, `duplicate object id "${objectId}".`);
        if (cells.has(cell))
            fail(context, `duplicate placement at coordinate ${cell}.`);
        objectIds.add(objectId);
        cells.add(cell);
        bodies.push(Object.freeze({ objectId, definitionId, coord, blockerHeight }));
    }
    bodies.sort(binaryCompare);
    const lookup = new Map();
    for (const body of bodies)
        lookup.set(coordKey(body.coord), body);
    const result = Object.freeze({ schemaVersion: 1 });
    collisionBodiesByIndex.set(result, lookup);
    return result;
}
function inspectTerrainCollision(value, map) {
    if (value === undefined)
        return undefined;
    const record = inspectRecord(value, "Projectile terrain collision");
    exactKeys(record, [
        "blockerCoord", "terrainId", "blockerTag", "blockerElevation", "elapsedUnits"
    ], "Projectile terrain collision");
    const blockerCoord = inspectCoord(record.blockerCoord, map, "Projectile terrain collision coordinate");
    const terrainId = nonEmptyId(record.terrainId, "Projectile terrain collision terrainId");
    const blockerTag = nonEmptyId(record.blockerTag, "Projectile terrain collision blockerTag");
    const blockerElevation = finiteNumber(record.blockerElevation, "Projectile terrain collision elevation");
    const elapsedUnits = finiteNumber(record.elapsedUnits, "Projectile terrain collision elapsedUnits", 0);
    return Object.freeze({
        kind: "terrain", blockerCoord, terrainId, blockerTag, blockerElevation, elapsedUnits
    });
}
function inspectTraceRequest(value, map) {
    const record = inspectRecord(value, "Projectile destructible collision request");
    keysWithOptional(record, [
        "sourceCoord", "targetCoord", "sourceElevation", "targetElevation", "trajectory", "travelTimeUnits"
    ], ["maxAltitude", "terrainCollision"], "Projectile destructible collision request");
    const sourceCoord = inspectCoord(record.sourceCoord, map, "Projectile source coordinate");
    const targetCoord = inspectCoord(record.targetCoord, map, "Projectile target coordinate");
    const sourceElevation = finiteNumber(record.sourceElevation, "Projectile source elevation");
    const targetElevation = finiteNumber(record.targetElevation, "Projectile target elevation");
    if (record.trajectory !== "direct" && record.trajectory !== "arc") {
        fail("Projectile destructible collision request", "trajectory must be direct or arc.");
    }
    const travelTimeUnits = finiteNumber(record.travelTimeUnits, "Projectile travel time", 0);
    let maxAltitude;
    if (record.trajectory === "arc") {
        maxAltitude = finiteNumber(record.maxAltitude, "Projectile arc maxAltitude", 0);
    }
    else if (record.maxAltitude !== undefined) {
        fail("Projectile destructible collision request", "direct trajectory cannot define maxAltitude.");
    }
    const terrainCollision = inspectTerrainCollision(record.terrainCollision, map);
    return Object.freeze({
        sourceCoord, targetCoord, sourceElevation, targetElevation,
        trajectory: record.trajectory, travelTimeUnits,
        ...(maxAltitude === undefined ? {} : { maxAltitude }),
        ...(terrainCollision === undefined ? {} : { terrainCollision })
    });
}
function terrainResult(cellInspections, collision) {
    return Object.freeze({ ok: true, cellInspections, collision });
}
function validateTerrainCollisionProvenance(request, line) {
    const collision = request.terrainCollision;
    if (collision === undefined)
        return;
    const steps = line.length - 1;
    const lineIndex = line.findIndex((coord, index) => index > 0
        && coord.q === collision.blockerCoord.q
        && coord.r === collision.blockerCoord.r);
    if (lineIndex < 1 || steps <= 0) {
        fail("Projectile terrain collision provenance", "blocker coordinate must be on the source-exclusive topology ray.");
    }
    const expectedElapsedUnits = request.travelTimeUnits * (lineIndex / steps);
    const tolerance = Number.EPSILON
        * Math.max(1, Math.abs(expectedElapsedUnits), Math.abs(collision.elapsedUnits))
        * 8;
    if (Math.abs(collision.elapsedUnits - expectedElapsedUnits) > tolerance) {
        fail("Projectile terrain collision provenance", `elapsedUnits must match the topology ray index (${expectedElapsedUnits}).`);
    }
}
/** Trace source-exclusive/target-inclusive fixed collision against map objects and prior terrain provenance. */
export function traceProjectileDestructibleCollisionV1(map, index, value, remainingCellInspections = DESTRUCTIBLE_COLLISION_LIMITS.cellInspectionsPerTick) {
    const lookup = collisionBodiesByIndex.get(index);
    if (!lookup)
        fail("Destructible collision index", "index was not created by this runtime.");
    if (!Number.isSafeInteger(remainingCellInspections) || remainingCellInspections < 0) {
        fail("Destructible collision operation budget", "must be a non-negative safe integer.");
    }
    const request = inspectTraceRequest(value, map);
    const distance = map.distance(request.sourceCoord, request.targetCoord);
    if (distance > DESTRUCTIBLE_COLLISION_LIMITS.maximumRayDistance) {
        return Object.freeze({ ok: false, reason: "ray_budget_exceeded", cellInspections: 0 });
    }
    const line = map.line(request.sourceCoord, request.targetCoord);
    validateTerrainCollisionProvenance(request, line);
    const steps = line.length - 1;
    if (steps <= 0)
        return Object.freeze({ ok: true, cellInspections: 0 });
    let inspections = 0;
    for (let lineIndex = 1; lineIndex < line.length; lineIndex += 1) {
        if (inspections >= remainingCellInspections) {
            return Object.freeze({ ok: false, reason: "operation_budget_exceeded", cellInspections: inspections });
        }
        inspections += 1;
        const coord = line[lineIndex];
        const progress = lineIndex / steps;
        const elapsedUnits = request.travelTimeUnits * progress;
        const body = lookup.get(coordKey(coord));
        if (body !== undefined) {
            const blockerElevation = map.elevationAt(coord);
            if (blockerElevation === undefined) {
                return Object.freeze({ ok: false, reason: "operation_budget_exceeded", cellInspections: inspections });
            }
            const projectileAltitude = projectileAltitudeAtProgress(request.sourceElevation, request.targetElevation, request.trajectory, request.maxAltitude, progress);
            if (projectileAltitude <= blockerElevation + body.blockerHeight
                && (request.terrainCollision === undefined || request.terrainCollision.elapsedUnits >= elapsedUnits)) {
                const collision = Object.freeze({
                    kind: "map_object",
                    objectId: body.objectId,
                    definitionId: body.definitionId,
                    collisionCoord: Object.freeze({ q: coord.q, r: coord.r }),
                    blockerElevation,
                    blockerHeight: body.blockerHeight,
                    elapsedUnits
                });
                return Object.freeze({ ok: true, cellInspections: inspections, collision });
            }
        }
        if (request.terrainCollision !== undefined && request.terrainCollision.elapsedUnits <= elapsedUnits) {
            return terrainResult(inspections, request.terrainCollision);
        }
    }
    return request.terrainCollision === undefined
        ? Object.freeze({ ok: true, cellInspections: inspections })
        : terrainResult(inspections, request.terrainCollision);
}
function deepDetachAndFreeze(value, context, seen = new WeakSet()) {
    if (value === null || typeof value !== "object")
        return value;
    if (seen.has(value))
        return fail(context, "cyclic values are not supported.");
    seen.add(value);
    if (Array.isArray(value)) {
        const items = inspectDenseArray(value, context).map((item, index) => deepDetachAndFreeze(item, `${context}[${index}]`, seen));
        seen.delete(value);
        return Object.freeze(items);
    }
    const record = inspectRecord(value, context);
    const detached = {};
    for (const key of Object.keys(record)) {
        Object.defineProperty(detached, key, {
            value: deepDetachAndFreeze(record[key], `${context}.${key}`, seen),
            enumerable: true
        });
    }
    seen.delete(value);
    return Object.freeze(detached);
}
function inspectObjectState(value) {
    const record = inspectRecord(value, "Destructible map object state");
    keysWithOptional(record, ["objectId", "definitionId", "hp", "maxHp"], ["armorTypeId"], "Destructible map object state");
    const objectId = nonEmptyId(record.objectId, "Destructible map object objectId");
    const definitionId = nonEmptyId(record.definitionId, "Destructible map object definitionId");
    const maxHp = finiteNumber(record.maxHp, "Destructible map object maxHp", Number.MIN_VALUE);
    if (maxHp > DESTRUCTIBLE_ENVIRONMENT_LIMITS.maxHp) {
        fail("Destructible map object state", "maxHp exceeds the supported maximum.");
    }
    const hp = finiteNumber(record.hp, "Destructible map object hp", 0);
    if (hp > maxHp)
        fail("Destructible map object state", "hp cannot exceed maxHp.");
    const armorTypeId = record.armorTypeId === undefined
        ? undefined
        : nonEmptyId(record.armorTypeId, "Destructible map object armorTypeId");
    return Object.freeze({ objectId, definitionId, hp, maxHp, ...(armorTypeId === undefined ? {} : { armorTypeId }) });
}
function inspectDamageContext(value) {
    const record = inspectRecord(value, "Destructible damage context");
    keysWithOptional(record, [], ["armorMatrix"], "Destructible damage context");
    return Object.freeze({
        ...(record.armorMatrix === undefined
            ? {}
            : { armorMatrix: record.armorMatrix })
    });
}
/** Plan map-object damage without mutating HP, collision state, terrain, or the source packet. */
export function planDestructibleObjectDamageV1(value, objectValue, contextValue = {}) {
    const object = inspectObjectState(objectValue);
    const packetRecord = inspectRecord(value, "Destructible damage packet");
    keysWithOptional(packetRecord, ["amount", "source", "target"], ["damageType", "tags", "modifiers"], "Destructible damage packet");
    const context = inspectDamageContext(contextValue);
    const matrixArmorTypeId = context.armorMatrix === undefined
        ? undefined
        : inspectRecord(context.armorMatrix, "Destructible damage armor matrix").armorTypeId;
    if (object.armorTypeId !== matrixArmorTypeId) {
        fail("Destructible damage armor provenance", `object armor "${String(object.armorTypeId)}" and matrix armor "${String(matrixArmorTypeId)}" mismatch.`);
    }
    const damagePacket = Object.freeze({
        amount: packetRecord.amount,
        ...(packetRecord.damageType === undefined ? {} : { damageType: packetRecord.damageType }),
        source: deepDetachAndFreeze(packetRecord.source, "Destructible damage source"),
        target: Object.freeze({ kind: "map_object", objectId: object.objectId, definitionId: object.definitionId }),
        ...(packetRecord.tags === undefined
            ? {}
            : { tags: deepDetachAndFreeze(packetRecord.tags, "Destructible damage tags") }),
        ...(packetRecord.modifiers === undefined
            ? {}
            : { modifiers: deepDetachAndFreeze(packetRecord.modifiers, "Destructible damage modifiers") })
    });
    const resolution = deepDetachAndFreeze(DamageResolver.resolve(damagePacket, context), "Destructible damage resolution");
    const nextHp = Math.max(0, object.hp - resolution.finalAmount);
    const outcome = nextHp === object.hp
        ? "no_effect"
        : nextHp === 0
            ? "requires_atomic_destruction"
            : "nonlethal";
    return Object.freeze({
        outcome,
        objectId: object.objectId,
        definitionId: object.definitionId,
        previousHp: object.hp,
        nextHp,
        damagePacket,
        resolution
    });
}
