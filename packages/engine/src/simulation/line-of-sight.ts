import { LINE_OF_SIGHT_LIMITS } from "../content/elevation-mechanics.js";
import {
  dynamicAuthoredLineOfSightBlockerAtV1,
  type DynamicAuthoredLineOfSightIndexV1
} from "./destructible-line-of-sight.js";
import type { GridMap } from "./map.js";
import type { GridCoord, TerrainTypeDefinition } from "./types.js";

export type LineOfSightReasonV1 =
  | "clear"
  | "terrain_tag"
  | "elevation"
  | "ray_budget_exceeded"
  | "operation_budget_exceeded";

export interface LineOfSightBlockerV1 {
  readonly coord: GridCoord;
  readonly terrainId: string;
  readonly elevation: number;
  readonly tag?: string;
}

export interface LineOfSightAnalysisRowV1 {
  readonly target: GridCoord;
  readonly visible: boolean;
  readonly reason: LineOfSightReasonV1;
  readonly blocker?: LineOfSightBlockerV1;
}

export interface LineOfSightAnalysisV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly source: GridCoord;
  readonly rows: readonly LineOfSightAnalysisRowV1[];
  readonly coverage: {
    readonly requestedTargets: number;
    readonly analyzedTargets: number;
    readonly cellInspections: number;
    readonly budgetExceeded: boolean;
  };
}

export interface LineOfSightAnalysisV2 {
  readonly schemaVersion: 2;
  readonly profiles: Readonly<{
    readonly elevation?: string;
    readonly ballistics: string;
  }>;
  readonly source: GridCoord;
  readonly rows: readonly LineOfSightAnalysisRowV2[];
  readonly coverage: LineOfSightAnalysisV1["coverage"];
}

export interface LineOfSightAnalysisRequestV1 {
  readonly source: GridCoord;
  readonly targets: readonly GridCoord[];
}

export interface LineOfSightRuntimeProfileV2 {
  readonly profileId: string;
  readonly terrainBlockerTags: readonly string[];
}

interface TraceResult {
  readonly row: LineOfSightAnalysisRowV1;
  readonly cellInspections: number;
  readonly budgetExceeded: boolean;
}

export type LineOfSightReasonV2 = LineOfSightReasonV1 | "destructible";

export interface LineOfSightBlockerV2 extends LineOfSightBlockerV1 {
  readonly objectId?: string;
  readonly definitionId?: string;
  readonly blockerHeight?: number;
}

export interface LineOfSightAnalysisRowV2 {
  readonly target: GridCoord;
  readonly visible: boolean;
  readonly reason: LineOfSightReasonV2;
  readonly blocker?: LineOfSightBlockerV2;
}

export interface LineOfSightTraceResultV2 {
  readonly row: LineOfSightAnalysisRowV2;
  readonly cellInspections: number;
  readonly budgetExceeded: boolean;
}

export interface LineOfSightLegacyPolicyV1 {
  readonly terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>;
  readonly terrainBlockerTags: readonly string[];
}

function fail(message: string): never {
  throw new Error(`Line-of-sight analysis request is invalid: ${message}`);
}

function ownPlainRecord(value: unknown, context: string): Record<string, unknown> {
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let array: boolean;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = value !== null && typeof value === "object" ? Object.getOwnPropertyDescriptors(value) : {};
    array = Array.isArray(value);
  } catch {
    return fail(`${context} could not be inspected safely.`);
  }
  if (value === null || typeof value !== "object" || array || prototype !== Object.prototype) {
    return fail(`${context} must be a plain object with own data fields.`);
  }
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) {
    fail(`${context} must not contain symbol fields.`);
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      fail(`${context}.${key} must be an enumerable own data field; accessors are not allowed.`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[], context: string): void {
  const keys = Object.keys(record).sort();
  const canonical = [...expected].sort();
  if (keys.length !== canonical.length || keys.some((key, index) => key !== canonical[index])) {
    fail(`${context} must contain exactly ${expected.join(", ")}.`);
  }
}

function coordinate(value: unknown, map: GridMap, context: string): GridCoord {
  const record = ownPlainRecord(value, context);
  exactKeys(record, ["q", "r"], context);
  const q = record.q;
  const r = record.r;
  if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) {
    fail(`${context} q/r must be safe integer coordinates.`);
  }
  const result = { q: q as number, r: r as number };
  if (!map.isInside(result)) fail(`${context} coordinate is outside map bounds.`);
  return result;
}

function targetArray(value: unknown, map: GridMap): GridCoord[] {
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let prototype: object | null;
  let array: boolean;
  try {
    array = Array.isArray(value);
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    return fail("targets could not be inspected safely.");
  }
  if (!array || prototype !== Array.prototype) fail("targets must be an ordinary dense array.");
  const lengthValue = descriptors.length?.value;
  if (!Number.isSafeInteger(lengthValue) || (lengthValue as number) < 0) {
    fail("targets must expose a safe array length.");
  }
  const length = lengthValue as number;
  if (length > LINE_OF_SIGHT_LIMITS.analysisTargets) {
    fail(`targets exceed the ${LINE_OF_SIGHT_LIMITS.analysisTargets} target budget.`);
  }
  if (Reflect.ownKeys(descriptors).some((key) => {
    if (key === "length") return false;
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)) return true;
    return Number(key) >= length;
  })) fail("targets must not contain extra string or symbol fields.");
  const result: GridCoord[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      fail(`targets[${index}] must be an own data item; sparse arrays and accessors are not allowed.`);
    }
    const item = coordinate(descriptor.value, map, `targets[${index}]`);
    const key = `${item.q},${item.r}`;
    if (seen.has(key)) fail("targets must contain unique coordinates; duplicate target found.");
    seen.add(key);
    result.push(item);
  }
  return result.sort((left, right) => left.r - right.r || left.q - right.q);
}

export function normalizeLineOfSightAnalysisRequestV1(
  value: unknown,
  map: GridMap
): LineOfSightAnalysisRequestV1 {
  const request = ownPlainRecord(value, "request");
  exactKeys(request, ["source", "targets"], "request");
  const source = Object.freeze(coordinate(request.source, map, "source"));
  const targets = Object.freeze(targetArray(request.targets, map).map((item) => Object.freeze(item)));
  return Object.freeze({ source, targets });
}

function blocker(
  coord: GridCoord,
  terrainId: string,
  elevation: number,
  tag?: string
): LineOfSightBlockerV1 {
  return Object.freeze({
    coord: Object.freeze({ ...coord }),
    terrainId,
    elevation,
    ...(tag === undefined ? {} : { tag })
  });
}

function row(
  target: GridCoord,
  visible: boolean,
  reason: LineOfSightReasonV1,
  blockedBy?: LineOfSightBlockerV1
): LineOfSightAnalysisRowV1 {
  return Object.freeze({
    target: Object.freeze({ ...target }),
    visible,
    reason,
    ...(blockedBy === undefined ? {} : { blocker: blockedBy })
  });
}

export function traceLineOfSight(
  map: GridMap,
  terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>,
  terrainBlockerTags: readonly string[],
  source: GridCoord,
  target: GridCoord,
  remainingCellInspections: number = LINE_OF_SIGHT_LIMITS.cellInspectionsPerOperation
): TraceResult {
  const distance = map.distance(source, target);
  if (distance > LINE_OF_SIGHT_LIMITS.maximumRayDistance) {
    return { row: row(target, false, "ray_budget_exceeded"), cellInspections: 0, budgetExceeded: true };
  }
  const line = map.line(source, target);
  const steps = line.length - 1;
  if (steps <= 1) return { row: row(target, true, "clear"), cellInspections: 0, budgetExceeded: false };
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
    const coord = line[index]!;
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
    let matchingTag: string | undefined;
    for (const tag of terrainTags) {
      if (blockers.has(tag) && (matchingTag === undefined || tag < matchingTag)) matchingTag = tag;
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

function blockerV2(
  coord: GridCoord,
  terrainId: string,
  elevation: number,
  details: {
    readonly tag?: string;
    readonly objectId?: string;
    readonly definitionId?: string;
    readonly blockerHeight?: number;
  } = {}
): LineOfSightBlockerV2 {
  return Object.freeze({
    coord: Object.freeze({ ...coord }),
    terrainId,
    elevation,
    ...(details.tag === undefined ? {} : { tag: details.tag }),
    ...(details.objectId === undefined ? {} : { objectId: details.objectId }),
    ...(details.definitionId === undefined ? {} : { definitionId: details.definitionId }),
    ...(details.blockerHeight === undefined ? {} : { blockerHeight: details.blockerHeight })
  });
}

function rowV2(
  target: GridCoord,
  visible: boolean,
  reason: LineOfSightReasonV2,
  blockedBy?: LineOfSightBlockerV2
): LineOfSightAnalysisRowV2 {
  return Object.freeze({
    target: Object.freeze({ ...target }),
    visible,
    reason,
    ...(blockedBy === undefined ? {} : { blocker: blockedBy })
  });
}

/**
 * Generalized source/target-exclusive LoS trace. When no dynamic index is supplied, the existing
 * public wrapper remains the exact implementation and result contract.
 */
export function traceLineOfSightV2(
  map: GridMap,
  legacyPolicy: LineOfSightLegacyPolicyV1 | undefined,
  dynamicIndex: DynamicAuthoredLineOfSightIndexV1 | undefined,
  source: GridCoord,
  target: GridCoord,
  remainingCellInspections: number = LINE_OF_SIGHT_LIMITS.cellInspectionsPerOperation
): LineOfSightTraceResultV2 {
  if (dynamicIndex === undefined && legacyPolicy !== undefined) {
    return traceLineOfSight(
      map,
      legacyPolicy.terrainTypes,
      legacyPolicy.terrainBlockerTags,
      source,
      target,
      remainingCellInspections
    );
  }
  if (!Number.isSafeInteger(remainingCellInspections) || remainingCellInspections < 0) {
    fail("remainingCellInspections must be a non-negative safe integer");
  }
  const distance = map.distance(source, target);
  if (distance > LINE_OF_SIGHT_LIMITS.maximumRayDistance) {
    return Object.freeze({
      row: rowV2(target, false, "ray_budget_exceeded"),
      cellInspections: 0,
      budgetExceeded: true
    });
  }
  const line = map.line(source, target);
  const steps = line.length - 1;
  if (steps <= 1) {
    return Object.freeze({ row: rowV2(target, true, "clear"), cellInspections: 0, budgetExceeded: false });
  }
  const sourceElevation = map.elevationAt(source);
  const targetElevation = map.elevationAt(target);
  if (sourceElevation === undefined || targetElevation === undefined) {
    return Object.freeze({
      row: rowV2(target, false, "operation_budget_exceeded"),
      cellInspections: 0,
      budgetExceeded: true
    });
  }
  const terrainTypes = legacyPolicy?.terrainTypes ?? {};
  const terrainBlockerTags = new Set(legacyPolicy?.terrainBlockerTags ?? []);
  let inspections = 0;
  for (let index = 1; index < line.length - 1; index += 1) {
    if (inspections >= remainingCellInspections) {
      return Object.freeze({
        row: rowV2(target, false, "operation_budget_exceeded"),
        cellInspections: inspections,
        budgetExceeded: true
      });
    }
    inspections += 1;
    const coord = line[index]!;
    const tile = map.getTile(coord);
    const elevation = map.elevationAt(coord);
    if (!tile || elevation === undefined) {
      return Object.freeze({
        row: rowV2(target, false, "operation_budget_exceeded"),
        cellInspections: inspections,
        budgetExceeded: true
      });
    }

    let matchingTag: string | undefined;
    for (const tag of terrainTypes[tile.terrain]?.tags ?? []) {
      if (terrainBlockerTags.has(tag) && (matchingTag === undefined || tag < matchingTag)) {
        matchingTag = tag;
      }
    }
    if (matchingTag !== undefined) {
      return Object.freeze({
        row: rowV2(
          target,
          false,
          "terrain_tag",
          blockerV2(coord, tile.terrain, elevation, { tag: matchingTag })
        ),
        cellInspections: inspections,
        budgetExceeded: false
      });
    }

    const rayHeightNumerator = (sourceElevation + 1) * (steps - index)
      + (targetElevation + 1) * index;
    const dynamicBlocker = dynamicIndex === undefined
      ? undefined
      : dynamicAuthoredLineOfSightBlockerAtV1(map, dynamicIndex, coord);
    if (dynamicBlocker !== undefined
      && (elevation + dynamicBlocker.blockerHeight) * steps >= rayHeightNumerator) {
      return Object.freeze({
        row: rowV2(
          target,
          false,
          "destructible",
          blockerV2(coord, tile.terrain, elevation, {
            objectId: dynamicBlocker.objectId,
            definitionId: dynamicBlocker.definitionId,
            blockerHeight: dynamicBlocker.blockerHeight
          })
        ),
        cellInspections: inspections,
        budgetExceeded: false
      });
    }
    if (legacyPolicy !== undefined && elevation * steps >= rayHeightNumerator) {
      return Object.freeze({
        row: rowV2(target, false, "elevation", blockerV2(coord, tile.terrain, elevation)),
        cellInspections: inspections,
        budgetExceeded: false
      });
    }
  }
  return Object.freeze({
    row: rowV2(target, true, "clear"),
    cellInspections: inspections,
    budgetExceeded: false
  });
}

export function analyzeLineOfSightTargets(
  map: GridMap,
  terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>,
  profile: LineOfSightRuntimeProfileV2,
  request: LineOfSightAnalysisRequestV1
): LineOfSightAnalysisV1 {
  let remaining: number = LINE_OF_SIGHT_LIMITS.cellInspectionsPerOperation;
  let inspected = 0;
  let budgetExceeded = false;
  const rows: LineOfSightAnalysisRowV1[] = [];
  for (const target of request.targets) {
    const result = traceLineOfSight(
      map,
      terrainTypes,
      profile.terrainBlockerTags,
      request.source,
      target,
      remaining
    );
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

/** Compute-only dynamic diagnostics; no index or result state is persisted by the simulation. */
export function analyzeLineOfSightTargetsV2(
  map: GridMap,
  legacyPolicy: LineOfSightLegacyPolicyV1 | undefined,
  dynamicIndex: DynamicAuthoredLineOfSightIndexV1,
  profiles: LineOfSightAnalysisV2["profiles"],
  request: LineOfSightAnalysisRequestV1
): LineOfSightAnalysisV2 {
  let remaining: number = LINE_OF_SIGHT_LIMITS.cellInspectionsPerOperation;
  let inspected = 0;
  let budgetExceeded = false;
  const rows: LineOfSightAnalysisRowV2[] = [];
  for (const target of request.targets) {
    const result = traceLineOfSightV2(
      map,
      legacyPolicy,
      dynamicIndex,
      request.source,
      target,
      remaining
    );
    rows.push(result.row);
    inspected += result.cellInspections;
    remaining = Math.max(0, remaining - result.cellInspections);
    budgetExceeded ||= result.budgetExceeded;
  }
  return Object.freeze({
    schemaVersion: 2 as const,
    profiles: Object.freeze({ ...profiles }),
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
