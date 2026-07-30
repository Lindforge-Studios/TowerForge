import {
  ENEMY_BEHAVIORS_LIMITS,
  FORMATION_ROLES,
  type FormationRoleV1,
  type FormationSteeringDefinitionV1
} from "../content/enemy-behaviors-mechanics.js";
import { createGridTopology } from "./topology.js";
import type { GridCoord, GridDefinition } from "./types.js";

export interface FormationSteeringCandidateV1 {
  readonly coord: GridCoord;
  readonly remainingCostMilli: number;
}

export interface FormationSteeringSelfV1 {
  readonly enemyId: string;
  readonly cohortId: string;
  readonly role: FormationRoleV1;
}

export interface FormationSteeringNeighborV1 {
  readonly enemyId: string;
  readonly role: FormationRoleV1;
  readonly anchorCoord: GridCoord;
  readonly remainingCostMilli: number;
}

export interface FormationSteeringRequestV1 {
  readonly schemaVersion: 1;
  readonly grid: GridDefinition;
  readonly currentCoord: GridCoord;
  readonly canonicalNextCoord: GridCoord;
  readonly candidates: readonly FormationSteeringCandidateV1[];
  readonly self: FormationSteeringSelfV1;
  readonly neighbors: readonly FormationSteeringNeighborV1[];
  readonly steering: FormationSteeringDefinitionV1;
}

export interface FormationSteeringResultV1 {
  readonly schemaVersion: 1;
  readonly nextCoord: GridCoord;
  readonly neighborIds: readonly string[];
  readonly score: number;
}

type DescriptorMap = Readonly<Record<PropertyKey, PropertyDescriptor>>;

const REQUEST_FIELDS = Object.freeze([
  "schemaVersion", "grid", "currentCoord", "canonicalNextCoord", "candidates", "self", "neighbors", "steering"
] as const);
const ROLE_RANK: Readonly<Record<FormationRoleV1, number>> = Object.freeze({ vanguard: 0, body: 1, support: 2 });
const MAX_CANDIDATES = 8;

function fail(message: string): never {
  throw new Error(`Invalid formation steering request: ${message}`);
}

function inspectRecord(value: unknown, path: string, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${path} must be a plain object.`);
  let prototype: object | null;
  let descriptors: DescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as DescriptorMap;
  } catch {
    fail(`${path} could not be inspected safely; proxies are unsupported.`);
  }
  if (prototype !== Object.prototype && prototype !== null) fail(`${path} must be a plain own-data object.`);
  if (Object.getOwnPropertySymbols(descriptors).length > 0) fail(`${path} rejects symbol fields.`);
  const allowed = new Set(fields);
  for (const key of Object.keys(descriptors)) {
    if (!allowed.has(key)) fail(`${path} is closed; unknown field "${key}".`);
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor) fail(`${path}.${field} is required.`);
    if (!descriptor.enumerable || !("value" in descriptor)) fail(`${path}.${field} must be an enumerable own data property; accessors are forbidden.`);
    Object.defineProperty(result, field, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function inspectDenseArray(value: unknown, path: string, minimum: number, maximum: number): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be a dense array.`);
  let prototype: object | null;
  let descriptors: DescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as DescriptorMap;
  } catch {
    fail(`${path} could not be inspected safely as a dense array.`);
  }
  if (prototype !== Array.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) {
    fail(`${path} must be a plain dense array.`);
  }
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum) {
    fail(`${path} exceeds the ${minimum}..${maximum} budget limit.`);
  }
  if (Object.keys(descriptors).filter((key) => key !== "length").length !== length) fail(`${path} must not be sparse.`);
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail(`${path}[${index}] must be an enumerable own data property; accessors are forbidden.`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedId(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()
    || new TextEncoder().encode(value).length > ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes
  ) fail(`${path} must be a bounded non-empty id.`);
  return value;
}

function safeInteger(value: unknown, path: string, minimum = Number.MIN_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(`${path} must be a safe integer${minimum === 0 ? " and non-negative" : ""}.`);
  return value as number;
}

function coord(value: unknown, path: string): GridCoord {
  const record = inspectRecord(value, path, ["q", "r"]);
  return Object.freeze({
    q: safeInteger(record.q, `${path}.q`),
    r: safeInteger(record.r, `${path}.r`)
  });
}

function grid(value: unknown): GridDefinition {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("grid must be a closed object.");
  let kind: unknown;
  try {
    const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
    if (!kindDescriptor?.enumerable || !("value" in kindDescriptor)) fail("grid.kind must be an own data property.");
    kind = kindDescriptor.value;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid formation steering")) throw error;
    fail("grid could not be inspected safely.");
  }
  if (kind === "square") {
    const square = inspectRecord(value, "grid", ["kind", "adjacency"]);
    if (square.adjacency !== "cardinal") fail('grid.adjacency must be "cardinal".');
    return Object.freeze({ kind: "square", adjacency: "cardinal" });
  }
  if (kind === "hex") {
    const hex = inspectRecord(value, "grid", ["kind", "layout"]);
    if (hex.layout !== "odd-r") fail('grid.layout must be "odd-r".');
    return Object.freeze({ kind: "hex", layout: "odd-r" });
  }
  fail("grid.kind must be square or hex.");
}

function role(value: unknown, path: string): FormationRoleV1 {
  if (typeof value !== "string" || !(FORMATION_ROLES as readonly string[]).includes(value)) {
    fail(`${path} must be vanguard, body, or support.`);
  }
  return value as FormationRoleV1;
}

function steering(value: unknown): FormationSteeringDefinitionV1 {
  const record = inspectRecord(value, "steering", [
    "neighborRadius", "cohesionWeight", "separationWeight", "roleWeight"
  ]);
  const neighborRadius = safeInteger(record.neighborRadius, "steering.neighborRadius", 1);
  if (neighborRadius > ENEMY_BEHAVIORS_LIMITS.neighborRadius) fail("steering.neighborRadius must be 1 or 2.");
  const weights = ["cohesionWeight", "separationWeight", "roleWeight"] as const;
  const normalized = weights.map((field) => {
    const weight = safeInteger(record[field], `steering.${field}`, 0);
    if (weight > ENEMY_BEHAVIORS_LIMITS.steeringWeight) fail(`steering.${field} exceeds the weight limit.`);
    return weight;
  });
  if (normalized.every((weight) => weight === 0)) fail("steering requires at least one positive weight.");
  return Object.freeze({
    neighborRadius: neighborRadius as 1 | 2,
    cohesionWeight: normalized[0]!,
    separationWeight: normalized[1]!,
    roleWeight: normalized[2]!
  });
}

function sameCoord(left: GridCoord, right: GridCoord): boolean {
  return left.q === right.q && left.r === right.r;
}

function safeMultiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) fail("score multiplication overflowed the safe integer range.");
  return result;
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) fail("score addition overflowed the safe integer range.");
  return result;
}

/** Pure bounded formation chooser over a host-proven equal-optimal flow candidate set. */
export function selectFormationSteeringNextV1(request: FormationSteeringRequestV1): FormationSteeringResultV1 {
  const root = inspectRecord(request, "request", REQUEST_FIELDS);
  if (root.schemaVersion !== 1) fail("schemaVersion must be 1.");
  const normalizedGrid = grid(root.grid);
  const topology = createGridTopology(normalizedGrid);
  const currentCoord = coord(root.currentCoord, "currentCoord");
  const canonicalNextCoord = coord(root.canonicalNextCoord, "canonicalNextCoord");
  const selfInput = inspectRecord(root.self, "self", ["enemyId", "cohortId", "role"]);
  const self = Object.freeze({
    enemyId: boundedId(selfInput.enemyId, "self.enemyId"),
    cohortId: boundedId(selfInput.cohortId, "self.cohortId"),
    role: role(selfInput.role, "self.role")
  });
  const normalizedSteering = steering(root.steering);

  const candidateInputs = inspectDenseArray(root.candidates, "candidates", 1, MAX_CANDIDATES);
  const seenCandidateCoords = new Set<string>();
  let canonicalCount = 0;
  const candidates = candidateInputs.map((value, index) => {
    const record = inspectRecord(value, `candidates[${index}]`, ["coord", "remainingCostMilli"]);
    const candidateCoord = coord(record.coord, `candidates[${index}].coord`);
    if (topology.distance(currentCoord, candidateCoord) !== 1) fail(`candidates[${index}] must be topology-adjacent.`);
    const key = `${candidateCoord.q},${candidateCoord.r}`;
    if (seenCandidateCoords.has(key)) fail(`candidates contain duplicate coord ${key}.`);
    seenCandidateCoords.add(key);
    if (sameCoord(candidateCoord, canonicalNextCoord)) canonicalCount += 1;
    return Object.freeze({
      coord: candidateCoord,
      remainingCostMilli: safeInteger(record.remainingCostMilli, `candidates[${index}].remainingCostMilli`, 0)
    });
  });
  if (canonicalCount !== 1) fail("canonicalNextCoord must occur in candidates exactly once.");

  const neighborInputs = inspectDenseArray(root.neighbors, "neighbors", 0, 16);
  const seenNeighborIds = new Set<string>();
  const neighbors = neighborInputs.map((value, index) => {
    const record = inspectRecord(value, `neighbors[${index}]`, ["enemyId", "role", "anchorCoord", "remainingCostMilli"]);
    const enemyId = boundedId(record.enemyId, `neighbors[${index}].enemyId`);
    if (enemyId === self.enemyId) fail("neighbors must not contain self enemyId.");
    if (seenNeighborIds.has(enemyId)) fail(`neighbors contain duplicate enemyId "${enemyId}".`);
    seenNeighborIds.add(enemyId);
    return Object.freeze({
      enemyId,
      role: role(record.role, `neighbors[${index}].role`),
      anchorCoord: coord(record.anchorCoord, `neighbors[${index}].anchorCoord`),
      remainingCostMilli: safeInteger(record.remainingCostMilli, `neighbors[${index}].remainingCostMilli`, 0)
    });
  }).sort((left, right) => {
    const distance = topology.distance(currentCoord, left.anchorCoord) - topology.distance(currentCoord, right.anchorCoord);
    return distance || compareBinary(left.enemyId, right.enemyId);
  });

  const orderedDirections = topology.neighbors(currentCoord);
  const scored = candidates.map((candidate) => {
    let score = 0;
    for (const neighbor of neighbors) {
      const distance = topology.distance(candidate.coord, neighbor.anchorCoord);
      if (!Number.isSafeInteger(distance)) fail("score distance overflowed the safe integer range.");
      score = safeAdd(score, safeMultiply(distance, normalizedSteering.cohesionWeight));
      score = safeAdd(score, safeMultiply(Math.max(0, 2 - distance), normalizedSteering.separationWeight));
      const selfRank = ROLE_RANK[self.role];
      const neighborRank = ROLE_RANK[neighbor.role];
      const roleDelta = selfRank < neighborRank
        ? Math.max(0, candidate.remainingCostMilli - neighbor.remainingCostMilli)
        : selfRank > neighborRank
          ? Math.max(0, neighbor.remainingCostMilli - candidate.remainingCostMilli)
          : 0;
      score = safeAdd(score, safeMultiply(roleDelta, normalizedSteering.roleWeight));
    }
    return { candidate, score };
  }).sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    const leftCanonical = sameCoord(left.candidate.coord, canonicalNextCoord);
    const rightCanonical = sameCoord(right.candidate.coord, canonicalNextCoord);
    if (leftCanonical !== rightCanonical) return leftCanonical ? -1 : 1;
    const leftDirection = orderedDirections.findIndex((candidate) => sameCoord(candidate, left.candidate.coord));
    const rightDirection = orderedDirections.findIndex((candidate) => sameCoord(candidate, right.candidate.coord));
    return leftDirection - rightDirection
      || left.candidate.coord.r - right.candidate.coord.r
      || left.candidate.coord.q - right.candidate.coord.q;
  });
  const selected = scored[0]!;
  return Object.freeze({
    schemaVersion: 1,
    nextCoord: Object.freeze({ q: selected.candidate.coord.q, r: selected.candidate.coord.r }),
    neighborIds: Object.freeze(neighbors.map((neighbor) => neighbor.enemyId)),
    score: selected.score
  });
}
