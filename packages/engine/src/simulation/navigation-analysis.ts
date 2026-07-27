import { NAVIGATION_LIMITS } from "../content/navigation-mechanics.js";
import type { GridCoord, NavigationFieldSnapshotV1 } from "./types.js";

export interface NavigationAnalysisRequestV1 {
  /** Optional field-diagnostic filter; placement rows still preserve every live required path. */
  readonly movementProfileIds?: readonly string[];
  /** Optional field-diagnostic filter; placement rows still preserve every live required path. */
  readonly routeIds?: readonly string[];
  readonly towerTypeId?: string;
  readonly coordinates?: readonly GridCoord[];
}

export interface NavigationPlacementAnalysisRowV1 {
  readonly coord: GridCoord;
  readonly ok: boolean;
  readonly reasonKey?: string;
  readonly blockingPair?: {
    readonly movementProfileId: string;
    readonly routeId: string;
  };
}

export interface NavigationAnalysisV1 {
  readonly schemaVersion: 1;
  readonly mode: "dynamic_flow";
  readonly profileId: string;
  readonly fields: readonly NavigationFieldSnapshotV1[];
  readonly placementRows: readonly NavigationPlacementAnalysisRowV1[];
}

export const NAVIGATION_ANALYSIS_SCHEMA = Object.freeze({
  schemaVersion: 1,
  request: Object.freeze({
    explicitCoordinateSubset: true,
    maxCoordinates: NAVIGATION_LIMITS.placementAnalysisCoordinates
  }),
  result: Object.freeze({
    placementOrder: "r,q",
    blockingPairOrder: "binary"
  })
});

export interface NavigationAnalysisValidationContext {
  readonly width: number;
  readonly height: number;
  readonly movementProfileIds: readonly string[];
  readonly routeIds: readonly string[];
  readonly towerTypeIds: readonly string[];
}

export interface NormalizedNavigationAnalysisRequestV1 {
  readonly movementProfileIds: readonly string[];
  readonly routeIds: readonly string[];
  readonly towerTypeId?: string;
  readonly coordinates: readonly GridCoord[];
}

type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;

function fail(message: string): never {
  throw new Error(`Invalid navigation analysis request: ${message}`);
}

function inspectDescriptors(value: object, context: string): DescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(value) as DescriptorMap;
  } catch {
    return fail(`${context} could not be inspected safely.`);
  }
}

function plainRecord(value: unknown, context: string): Record<string, unknown> {
  let prototype: object | null;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
  } catch {
    return fail(`${context} could not be inspected safely.`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
    return fail(`${context} must be a plain object with enumerable own data fields.`);
  }
  const descriptors = inspectDescriptors(value, context);
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    return fail(`${context} must not contain symbol fields.`);
  }
  const detached: Record<string, unknown> = {};
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

function denseArray(value: unknown, context: string, maximumLength: number): readonly unknown[] {
  let prototype: object | null;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
  } catch {
    return fail(`${context} could not be inspected safely.`);
  }
  if (!Array.isArray(value) || prototype !== Array.prototype) {
    return fail(`${context} must be an ordinary dense array.`);
  }
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    return fail(`${context} length could not be inspected safely.`);
  }
  if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) {
    return fail(`${context} has an invalid length.`);
  }
  const length = lengthDescriptor.value as number;
  if (length > maximumLength) {
    return fail(`${context} exceeds the ${maximumLength} item budget limit.`);
  }
  const descriptors = inspectDescriptors(value, context);
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    return fail(`${context} must not contain symbol fields.`);
  }
  const result: unknown[] = [];
  for (const key of Object.keys(descriptors)) {
    if (key === "length") continue;
    const descriptor = descriptors[key];
    if (
      !/^(0|[1-9]\d*)$/.test(key)
      || Number(key) >= length
      || !descriptor
      || !descriptor.enumerable
      || !("value" in descriptor)
    ) {
      return fail(`${context} contains a sparse index or unsupported non-data field.`);
    }
    result[Number(key)] = descriptor.value;
  }
  if (Object.keys(descriptors).length !== length + 1 || result.length !== length) {
    return fail(`${context} must be dense and contain no extra fields.`);
  }
  return result;
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], context: string): void {
  const known = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) fail(`${context} contains unknown field "${key}".`);
  }
}

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCoords(left: GridCoord, right: GridCoord): number {
  return left.r - right.r || left.q - right.q;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function boundedId(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${context} must be a non-empty string id.`);
  if (utf8ByteLength(value) > NAVIGATION_LIMITS.idUtf8Bytes) {
    fail(`${context} exceeds the ${NAVIGATION_LIMITS.idUtf8Bytes} UTF-8 byte limit.`);
  }
  return value;
}

function normalizeIdFilter(
  value: unknown,
  context: "movementProfileIds" | "routeIds",
  knownIds: readonly string[],
  maximumLength: number
): readonly string[] {
  const authored = denseArray(value, context, maximumLength);
  const known = new Set(knownIds);
  const seen = new Set<string>();
  const label = context === "movementProfileIds" ? "profile" : "route";
  const result: string[] = [];
  for (let index = 0; index < authored.length; index += 1) {
    const id = boundedId(authored[index], `${context}[${index}]`);
    if (seen.has(id)) fail(`${context} contains duplicate ${label} id "${id}".`);
    if (!known.has(id)) fail(`${context} references unknown ${label} id "${id}".`);
    seen.add(id);
    result.push(id);
  }
  return Object.freeze(result.sort(compareBinary));
}

function normalizeCoordinates(
  value: unknown,
  width: number,
  height: number
): readonly GridCoord[] {
  const authored = denseArray(
    value,
    "coordinates",
    NAVIGATION_LIMITS.placementAnalysisCoordinates
  );
  const seen = new Set<string>();
  const result: GridCoord[] = [];
  for (let index = 0; index < authored.length; index += 1) {
    const coord = plainRecord(authored[index], `coordinates[${index}]`);
    exactKeys(coord, ["q", "r"], `coordinates[${index}]`);
    if (!Object.prototype.hasOwnProperty.call(coord, "q") || !Object.prototype.hasOwnProperty.call(coord, "r")) {
      fail(`coordinates[${index}] requires q and r.`);
    }
    if (!Number.isSafeInteger(coord.q) || !Number.isSafeInteger(coord.r)) {
      fail(`coordinates[${index}] coordinate q and r must be safe integers.`);
    }
    const q = coord.q as number;
    const r = coord.r as number;
    if (q < 0 || q >= width || r < 0 || r >= height) {
      fail(`coordinates[${index}] coordinate must be inside the ${width}x${height} map.`);
    }
    const key = `${q},${r}`;
    if (seen.has(key)) fail(`coordinates contains duplicate coordinate ${key}.`);
    seen.add(key);
    result.push(Object.freeze({ q, r }));
  }
  return Object.freeze(result.sort(compareCoords));
}

/** Strictly detach and canonicalize one active dynamic-flow analysis request. */
export function normalizeNavigationAnalysisRequestV1(
  value: NavigationAnalysisRequestV1,
  context: NavigationAnalysisValidationContext
): NormalizedNavigationAnalysisRequestV1 {
  const request = plainRecord(value, "request");
  exactKeys(request, ["movementProfileIds", "routeIds", "towerTypeId", "coordinates"], "request");

  const hasTower = Object.prototype.hasOwnProperty.call(request, "towerTypeId");
  const hasCoordinates = Object.prototype.hasOwnProperty.call(request, "coordinates");
  if (hasCoordinates && !hasTower) fail("coordinates require towerTypeId.");
  if (hasTower && !hasCoordinates) fail("towerTypeId requires coordinates.");

  const movementProfileIds = Object.prototype.hasOwnProperty.call(request, "movementProfileIds")
    ? normalizeIdFilter(
        request.movementProfileIds,
        "movementProfileIds",
        context.movementProfileIds,
        NAVIGATION_LIMITS.movementProfiles
      )
    : Object.freeze([...context.movementProfileIds].sort(compareBinary));
  const routeIds = Object.prototype.hasOwnProperty.call(request, "routeIds")
    ? normalizeIdFilter(
        request.routeIds,
        "routeIds",
        context.routeIds,
        NAVIGATION_LIMITS.routeEndpointPairs
      )
    : Object.freeze([...context.routeIds].sort(compareBinary));

  if (!hasTower) {
    return Object.freeze({ movementProfileIds, routeIds, coordinates: Object.freeze([]) });
  }
  const towerTypeId = boundedId(request.towerTypeId, "towerTypeId");
  if (!context.towerTypeIds.includes(towerTypeId)) {
    fail(`towerTypeId references unknown tower "${towerTypeId}".`);
  }
  const coordinates = normalizeCoordinates(request.coordinates, context.width, context.height);
  return Object.freeze({ movementProfileIds, routeIds, towerTypeId, coordinates });
}
