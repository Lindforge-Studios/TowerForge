import { DESTRUCTIBLE_ENVIRONMENT_LIMITS } from "../content/ballistics-mechanics.js";
import type { GridMap } from "./map.js";
import type { GridCoord } from "./types.js";

export interface DynamicAuthoredLineOfSightBlockerV1 {
  readonly objectId: string;
  readonly definitionId: string;
  readonly coord: GridCoord;
  readonly blockerHeight: number;
}

/** Opaque, immutable handle for authored dynamic LoS blockers. */
export interface DynamicAuthoredLineOfSightIndexV1 {
  readonly schemaVersion: 1;
}

interface StoredDynamicAuthoredLineOfSightIndexV1 {
  readonly map: GridMap;
  readonly byCell: ReadonlyMap<string, DynamicAuthoredLineOfSightBlockerV1>;
}

type DescriptorMap = Readonly<Record<PropertyKey, PropertyDescriptor>>;

const storedIndexes = new WeakMap<
  DynamicAuthoredLineOfSightIndexV1,
  StoredDynamicAuthoredLineOfSightIndexV1
>();

function fail(context: string, message: string): never {
  throw new Error(`${context} is invalid: ${message}`);
}

function inspectRecord(value: unknown, context: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(context, "expected an ordinary object with own data fields.");
  }
  let prototype: object | null;
  let descriptors: DescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as DescriptorMap;
  } catch {
    return fail(context, "value could not be inspected safely.");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(context, "expected an ordinary object prototype.");
  }
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) {
    return fail(context, "symbol fields are not supported.");
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      return fail(context, `${key} must be an enumerable own data field; accessors are forbidden.`);
    }
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function requireExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  context: string
): void {
  const actual = Object.keys(record).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    fail(context, `must contain exactly ${expected.join(", ")}.`);
  }
}

function inspectDenseArray(value: unknown): readonly unknown[] {
  let isArray: boolean;
  let prototype: object | null;
  let descriptors: DescriptorMap;
  try {
    isArray = Array.isArray(value);
    prototype = isArray && value !== null ? Object.getPrototypeOf(value) : null;
    descriptors = isArray ? Object.getOwnPropertyDescriptors(value) as DescriptorMap : {};
  } catch {
    return fail("Dynamic authored LoS blocker list", "list could not be inspected safely.");
  }
  if (!isArray || prototype !== Array.prototype) {
    return fail("Dynamic authored LoS blocker list", "expected an ordinary dense array.");
  }
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) {
    return fail("Dynamic authored LoS blocker list", "symbol fields are not supported.");
  }
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    return fail("Dynamic authored LoS blocker list", "array length could not be inspected safely.");
  }
  if ((length as number) > DESTRUCTIBLE_ENVIRONMENT_LIMITS.placementsPerMap) {
    return fail(
      "Dynamic authored LoS blocker index",
      `blocker limit ${DESTRUCTIBLE_ENVIRONMENT_LIMITS.placementsPerMap} exceeded.`
    );
  }
  for (const key of Object.keys(descriptors)) {
    if (key === "length") continue;
    if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= (length as number)) {
      return fail("Dynamic authored LoS blocker list", "array contains unsupported fields.");
    }
  }
  const result: unknown[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      return fail(
        "Dynamic authored LoS blocker list",
        `array must be dense and index ${index} must be an own data field.`
      );
    }
    result.push(descriptor.value);
  }
  return result;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function identifier(value: unknown, context: string): string {
  if (typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)
    || utf8ByteLength(value) > DESTRUCTIBLE_ENVIRONMENT_LIMITS.idUtf8Bytes) {
    return fail(
      context,
      `must be a non-empty safe identifier of at most ${DESTRUCTIBLE_ENVIRONMENT_LIMITS.idUtf8Bytes} UTF-8 bytes.`
    );
  }
  return value;
}

function coordinate(value: unknown, map: GridMap, context: string): GridCoord {
  const record = inspectRecord(value, context);
  requireExactKeys(record, ["q", "r"], context);
  if (!Number.isSafeInteger(record.q) || !Number.isSafeInteger(record.r)) {
    return fail(context, "q and r must be safe integers.");
  }
  const result = { q: record.q as number, r: record.r as number };
  if (!map.isInside(result)) return fail(context, "coordinate is outside the map.");
  return Object.freeze(result);
}

function height(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0
    || value > DESTRUCTIBLE_ENVIRONMENT_LIMITS.maximumBlockerHeight) {
    return fail(
      context,
      `must be between 0 and ${DESTRUCTIBLE_ENVIRONMENT_LIMITS.maximumBlockerHeight}.`
    );
  }
  return value;
}

function cellKey(coord: GridCoord): string {
  return `${coord.q},${coord.r}`;
}

function compareBlockers(
  left: DynamicAuthoredLineOfSightBlockerV1,
  right: DynamicAuthoredLineOfSightBlockerV1
): number {
  return left.coord.r - right.coord.r
    || left.coord.q - right.coord.q
    || (left.objectId < right.objectId ? -1 : left.objectId > right.objectId ? 1 : 0);
}

/** Build a detached, canonical O(1) cell lookup without caching mutable terrain elevation. */
export function buildDynamicAuthoredLineOfSightIndexV1(
  map: GridMap,
  value: readonly DynamicAuthoredLineOfSightBlockerV1[]
): DynamicAuthoredLineOfSightIndexV1 {
  const source = inspectDenseArray(value);
  const blockers: DynamicAuthoredLineOfSightBlockerV1[] = [];
  const objectIds = new Set<string>();
  const cells = new Set<string>();
  for (let index = 0; index < source.length; index += 1) {
    const context = `Dynamic authored LoS blocker ${index}`;
    const record = inspectRecord(source[index], context);
    requireExactKeys(record, ["objectId", "definitionId", "coord", "blockerHeight"], context);
    const objectId = identifier(record.objectId, `${context} objectId`);
    const definitionId = identifier(record.definitionId, `${context} definitionId`);
    const coord = coordinate(record.coord, map, `${context} coordinate`);
    const blockerHeight = height(record.blockerHeight, `${context} blockerHeight`);
    const key = cellKey(coord);
    if (objectIds.has(objectId)) return fail(context, `duplicate object id "${objectId}".`);
    if (cells.has(key)) return fail(context, `duplicate blocker coordinate ${key}.`);
    objectIds.add(objectId);
    cells.add(key);
    blockers.push(Object.freeze({ objectId, definitionId, coord, blockerHeight }));
  }
  blockers.sort(compareBlockers);
  const byCell = new Map<string, DynamicAuthoredLineOfSightBlockerV1>();
  for (const blocker of blockers) byCell.set(cellKey(blocker.coord), blocker);
  const result = Object.freeze({ schemaVersion: 1 as const });
  storedIndexes.set(result, Object.freeze({ map, byCell }));
  return result;
}

/** Internal pure lookup used by the generalized LoS tracer. */
export function dynamicAuthoredLineOfSightBlockerAtV1(
  map: GridMap,
  index: DynamicAuthoredLineOfSightIndexV1,
  coord: GridCoord
): DynamicAuthoredLineOfSightBlockerV1 | undefined {
  const stored = storedIndexes.get(index);
  if (!stored) return fail("Dynamic authored LoS blocker index", "index was not created by this runtime.");
  if (stored.map !== map) return fail("Dynamic authored LoS blocker index", "index belongs to another map.");
  return stored.byCell.get(cellKey(coord));
}
