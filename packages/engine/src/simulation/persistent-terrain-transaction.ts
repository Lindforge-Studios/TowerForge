import {
  TERRAFORMING_LIMITS,
  type TerraformTerrainTransitionV1
} from "../content/terraforming-mechanics.js";
import { coordKey } from "./hex.js";
import type { GridMap } from "./map.js";
import type { GridCoord, TerrainTypeDefinition } from "./types.js";

type PersistentTerrainSource = "script" | "ability";

export interface PersistentTerrainOverrideV1 extends GridCoord {
  readonly terrain: string;
  readonly source: PersistentTerrainSource;
  readonly expiresIn?: number;
}

export interface PersistentTerrainOperationV1 {
  readonly kind: "set_terrain" | "restore_terrain";
  readonly coord: GridCoord;
  readonly order: number;
  readonly transitionId?: string;
  readonly directTerrainId?: string;
  readonly terrainSource?: PersistentTerrainSource;
  readonly previousTerrainOverride?: PersistentTerrainOverrideV1 | null;
}

export interface PersistentTerrainNavigationProofV1 {
  readonly baselineAvailable: boolean;
  readonly candidateAvailable: boolean;
  readonly proof?: unknown;
}

export type PersistentTerrainNavigationPolicyV1 =
  | { readonly mode: "authored_routes" }
  | {
      readonly mode: "dynamic_flow";
      readonly prove: (
        candidateTerrainByCoord: ReadonlyMap<string, string>
      ) => PersistentTerrainNavigationProofV1;
    };

export interface PersistentTerrainTransactionRequestV1 {
  readonly map: GridMap;
  readonly terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>;
  readonly transitions: Readonly<Record<string, TerraformTerrainTransitionV1>>;
  readonly runtimeOverrides: ReadonlyMap<string, PersistentTerrainOverrideV1>;
  readonly operations: readonly PersistentTerrainOperationV1[];
  readonly navigation: PersistentTerrainNavigationPolicyV1;
}

export interface PersistentTerrainTransactionAdoptionV1 {
  readonly writes: readonly {
    readonly coord: GridCoord;
    readonly terrain: string;
  }[];
  readonly runtimeOverrides: readonly PersistentTerrainOverrideV1[];
  readonly events: readonly {
    readonly order: number;
    readonly event: Readonly<Record<string, unknown>>;
  }[];
  readonly navigationProof?: unknown;
}

/** Opaque one-shot prepared transaction. It intentionally has no public data surface. */
export interface PreparedPersistentTerrainTransactionV1 {
  readonly __opaque?: never;
}

export class PersistentTerrainTransactionError extends Error {
  readonly code = "invalid_action" as const;

  constructor(readonly reasonKey: string, message: string) {
    super(message);
    this.name = "PersistentTerrainTransactionError";
  }
}

const preparedAdoptions = new WeakMap<
  PreparedPersistentTerrainTransactionV1,
  PersistentTerrainTransactionAdoptionV1
>();

function reject(reasonKey: string, message: string): never {
  throw new PersistentTerrainTransactionError(reasonKey, message);
}

function frozenCoord(coord: GridCoord): GridCoord {
  return Object.freeze({ q: coord.q, r: coord.r });
}

function copyOverride(override: PersistentTerrainOverrideV1): PersistentTerrainOverrideV1 {
  return Object.freeze({
    q: override.q,
    r: override.r,
    terrain: override.terrain,
    source: override.source,
    ...(override.expiresIn === undefined ? {} : { expiresIn: override.expiresIn })
  });
}

function terrainMetadata(
  terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>,
  terrainId: string
): Readonly<Record<string, unknown>> {
  const definition = terrainTypes[terrainId];
  if (!definition) {
    return reject("terraform.invalid_operation", `Terrain "${terrainId}" is not authored.`);
  }
  return Object.freeze({
    id: definition.id,
    label: definition.label,
    buildable: definition.buildable,
    walkable: definition.walkable,
    groundSpeedMultiplier: definition.groundSpeedMultiplier,
    tags: Object.freeze([...definition.tags])
  });
}

function validateOperationBatch(
  map: GridMap,
  operations: readonly PersistentTerrainOperationV1[]
): void {
  if (!Array.isArray(operations)
    || operations.length > TERRAFORMING_LIMITS.operationsPerBatch) {
    reject(
      "terraform.operation_budget_exceeded",
      `Persistent terrain operations exceed ${TERRAFORMING_LIMITS.operationsPerBatch}.`
    );
  }
  const cells = new Set<string>();
  for (const operation of operations) {
    if (!operation || (operation.kind !== "set_terrain" && operation.kind !== "restore_terrain")) {
      reject("terraform.invalid_operation", "Persistent terrain operation kind is invalid.");
    }
    if (!Number.isSafeInteger(operation.coord?.q) || !Number.isSafeInteger(operation.coord?.r)
      || !map.isInside(operation.coord)) {
      reject("terraform.target_outside_map", "Persistent terrain target is outside the map.");
    }
    if (!Number.isSafeInteger(operation.order)) {
      reject("terraform.invalid_operation", "Persistent terrain operation order must be a safe integer.");
    }
    const key = coordKey(operation.coord);
    if (cells.has(key)) {
      reject("terraform.duplicate_target", `Persistent terrain target ${key} is duplicated.`);
    }
    cells.add(key);
  }
}

function effectiveTerrainByCoord(
  map: GridMap,
  overrides: ReadonlyMap<string, PersistentTerrainOverrideV1>
): Map<string, string> {
  const result = new Map<string, string>();
  for (const tile of map.tiles.values()) {
    const key = coordKey(tile);
    const terrain = overrides.get(key)?.terrain ?? map.getBaseTerrain(tile);
    if (!terrain) {
      reject("terraform.invalid_operation", `Map is missing base terrain at ${key}.`);
    }
    result.set(key, terrain);
  }
  return result;
}

function routeAvailability(
  map: GridMap,
  terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>,
  terrainAt: (coord: GridCoord) => string | undefined
): boolean {
  return map.pathRoutes.every((route) => route.pathCenterline
    .every((coord) => {
    const terrainId = terrainAt(coord);
    return terrainId !== undefined && terrainTypes[terrainId]?.walkable === true;
    }));
}

/** Prepare a complete mutation-free persistent terrain publication. */
export function preparePersistentTerrainTransaction(
  request: PersistentTerrainTransactionRequestV1
): PreparedPersistentTerrainTransactionV1 {
  validateOperationBatch(request.map, request.operations);
  const overrides = new Map<string, PersistentTerrainOverrideV1>();
  for (const [key, override] of request.runtimeOverrides) {
    overrides.set(key, copyOverride(override));
  }
  const writes: Array<{ readonly coord: GridCoord; readonly terrain: string }> = [];
  const events: Array<{
    readonly order: number;
    readonly event: Readonly<Record<string, unknown>>;
  }> = [];
  const effectiveTerrain = (coord: GridCoord): string | undefined => (
    overrides.get(coordKey(coord))?.terrain ?? request.map.getBaseTerrain(coord)
  );

  for (const operation of request.operations) {
    const key = coordKey(operation.coord);
    const currentTerrain = effectiveTerrain(operation.coord);
    const baseTerrain = request.map.getBaseTerrain(operation.coord);
    if (!currentTerrain || !baseTerrain) {
      reject("terraform.target_outside_map", `Persistent terrain target ${key} is outside the map.`);
    }
    const existing = overrides.get(key);
    if (typeof existing?.expiresIn === "number") {
      reject("terraform.target_owned", `Persistent terrain target ${key} has a timed owner.`);
    }

    let nextTerrain: string;
    let eventSource: PersistentTerrainSource | "restore";
    if (operation.previousTerrainOverride !== undefined) {
      nextTerrain = operation.previousTerrainOverride?.terrain ?? baseTerrain;
      eventSource = "restore";
      if (operation.previousTerrainOverride) {
        terrainMetadata(request.terrainTypes, operation.previousTerrainOverride.terrain);
        overrides.set(key, copyOverride(operation.previousTerrainOverride));
      } else {
        overrides.delete(key);
      }
    } else if (operation.kind === "set_terrain") {
      if (operation.directTerrainId !== undefined) {
        terrainMetadata(request.terrainTypes, operation.directTerrainId);
        nextTerrain = operation.directTerrainId;
      } else {
        const transition = operation.transitionId === undefined
          ? undefined
          : request.transitions[operation.transitionId];
        if (!transition) {
          reject(
            "terraform.transition_missing",
            `Persistent terrain transition "${String(operation.transitionId)}" is unavailable.`
          );
        }
        terrainMetadata(request.terrainTypes, transition.toTerrainId);
        const currentTags = request.terrainTypes[currentTerrain]?.tags ?? [];
        if (!transition.fromTerrainTags.some((tag) => currentTags.includes(tag))) {
          reject(
            "terraform.transition_source_tag_mismatch",
            `Persistent terrain transition does not accept "${currentTerrain}".`
          );
        }
        nextTerrain = transition.toTerrainId;
      }
      eventSource = operation.terrainSource ?? "script";
      if (currentTerrain !== nextTerrain) {
        if (nextTerrain === baseTerrain) overrides.delete(key);
        else overrides.set(key, Object.freeze({
          q: operation.coord.q,
          r: operation.coord.r,
          terrain: nextTerrain,
          source: operation.terrainSource ?? "script"
        }));
      }
    } else {
      nextTerrain = baseTerrain;
      eventSource = "restore";
      if (currentTerrain !== nextTerrain) overrides.delete(key);
    }

    if (currentTerrain !== nextTerrain) {
      const coord = frozenCoord(operation.coord);
      writes.push(Object.freeze({ coord, terrain: nextTerrain }));
      events.push(Object.freeze({
        order: operation.order,
        event: Object.freeze({
          type: "terrainChanged",
          coord,
          fromTerrain: currentTerrain,
          toTerrain: nextTerrain,
          terrainMetadata: terrainMetadata(request.terrainTypes, nextTerrain),
          source: eventSource
        })
      }));
    }
  }

  if (overrides.size > TERRAFORMING_LIMITS.activeTerrainOverrides) {
    reject(
      "terraform.override_budget_exceeded",
      `Persistent terrain overrides exceed ${TERRAFORMING_LIMITS.activeTerrainOverrides}.`
    );
  }

  let navigationProof: unknown;
  if (events.length > 0) {
    const candidateTerrain = effectiveTerrainByCoord(request.map, overrides);
    if (request.navigation.mode === "authored_routes") {
      const baselineAvailable = routeAvailability(
        request.map,
        request.terrainTypes,
        (coord) => request.map.getTile(coord)?.terrain
      );
      const candidateAvailable = routeAvailability(
        request.map,
        request.terrainTypes,
        (coord) => candidateTerrain.get(coordKey(coord))
      );
      if (!candidateAvailable) {
        reject(
          baselineAvailable
            ? "terraform.last_authored_route_blocked"
            : "terraform.authored_route_unavailable",
          baselineAvailable
            ? "Persistent terrain candidate blocks an authored route."
            : "Persistent terrain candidate does not repair unavailable authored routes."
        );
      }
    } else {
      const proof = request.navigation.prove(new Map(candidateTerrain));
      if (!proof.candidateAvailable) {
        reject(
          proof.baselineAvailable ? "terraform.last_path_blocked" : "terraform.navigation_unavailable",
          proof.baselineAvailable
            ? "Persistent terrain candidate blocks the last dynamic path."
            : "Persistent terrain candidate does not repair dynamic navigation."
        );
      }
      navigationProof = proof.proof;
    }
  }

  const runtimeOverrides = [...overrides.values()]
    .map(copyOverride)
    .sort((left, right) => left.r - right.r || left.q - right.q);
  const adoption = Object.freeze({
    writes: Object.freeze(writes),
    runtimeOverrides: Object.freeze(runtimeOverrides),
    events: Object.freeze([...events].sort((left, right) => left.order - right.order)),
    ...(navigationProof === undefined ? {} : { navigationProof })
  });
  const prepared = Object.freeze({}) as PreparedPersistentTerrainTransactionV1;
  preparedAdoptions.set(prepared, adoption);
  return prepared;
}

/** Publish one prepared value once. Repeated or foreign adoption is an intentional no-op. */
export function adoptPersistentTerrainTransaction(
  prepared: PreparedPersistentTerrainTransactionV1,
  publish: (adoption: PersistentTerrainTransactionAdoptionV1) => void
): Readonly<{ adopted: boolean }> {
  const adoption = preparedAdoptions.get(prepared);
  if (!adoption) return Object.freeze({ adopted: false });
  preparedAdoptions.delete(prepared);
  publish(adoption);
  return Object.freeze({ adopted: true });
}
