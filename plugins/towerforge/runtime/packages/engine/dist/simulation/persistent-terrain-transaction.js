import { TERRAFORMING_LIMITS } from "../content/terraforming-mechanics.js";
import { coordKey } from "./hex.js";
export class PersistentTerrainTransactionError extends Error {
    reasonKey;
    code = "invalid_action";
    constructor(reasonKey, message) {
        super(message);
        this.reasonKey = reasonKey;
        this.name = "PersistentTerrainTransactionError";
    }
}
const preparedAdoptions = new WeakMap();
function reject(reasonKey, message) {
    throw new PersistentTerrainTransactionError(reasonKey, message);
}
function frozenCoord(coord) {
    return Object.freeze({ q: coord.q, r: coord.r });
}
function copyOverride(override) {
    return Object.freeze({
        q: override.q,
        r: override.r,
        terrain: override.terrain,
        source: override.source,
        ...(override.expiresIn === undefined ? {} : { expiresIn: override.expiresIn })
    });
}
function terrainMetadata(terrainTypes, terrainId) {
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
function validateOperationBatch(map, operations) {
    if (!Array.isArray(operations)
        || operations.length > TERRAFORMING_LIMITS.operationsPerBatch) {
        reject("terraform.operation_budget_exceeded", `Persistent terrain operations exceed ${TERRAFORMING_LIMITS.operationsPerBatch}.`);
    }
    const cells = new Set();
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
function effectiveTerrainByCoord(map, overrides) {
    const result = new Map();
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
function routeAvailability(map, terrainTypes, terrainAt) {
    return map.pathRoutes.every((route) => route.pathCenterline
        .every((coord) => {
        const terrainId = terrainAt(coord);
        return terrainId !== undefined && terrainTypes[terrainId]?.walkable === true;
    }));
}
/** Prepare a complete mutation-free persistent terrain publication. */
export function preparePersistentTerrainTransaction(request) {
    validateOperationBatch(request.map, request.operations);
    const overrides = new Map();
    for (const [key, override] of request.runtimeOverrides) {
        overrides.set(key, copyOverride(override));
    }
    const writes = [];
    const events = [];
    const effectiveTerrain = (coord) => (overrides.get(coordKey(coord))?.terrain ?? request.map.getBaseTerrain(coord));
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
        let nextTerrain;
        let eventSource;
        if (operation.previousTerrainOverride !== undefined) {
            nextTerrain = operation.previousTerrainOverride?.terrain ?? baseTerrain;
            eventSource = "restore";
            if (operation.previousTerrainOverride) {
                terrainMetadata(request.terrainTypes, operation.previousTerrainOverride.terrain);
                overrides.set(key, copyOverride(operation.previousTerrainOverride));
            }
            else {
                overrides.delete(key);
            }
        }
        else if (operation.kind === "set_terrain") {
            if (operation.directTerrainId !== undefined) {
                terrainMetadata(request.terrainTypes, operation.directTerrainId);
                nextTerrain = operation.directTerrainId;
            }
            else {
                const transition = operation.transitionId === undefined
                    ? undefined
                    : request.transitions[operation.transitionId];
                if (!transition) {
                    reject("terraform.transition_missing", `Persistent terrain transition "${String(operation.transitionId)}" is unavailable.`);
                }
                terrainMetadata(request.terrainTypes, transition.toTerrainId);
                const currentTags = request.terrainTypes[currentTerrain]?.tags ?? [];
                if (!transition.fromTerrainTags.some((tag) => currentTags.includes(tag))) {
                    reject("terraform.transition_source_tag_mismatch", `Persistent terrain transition does not accept "${currentTerrain}".`);
                }
                nextTerrain = transition.toTerrainId;
            }
            eventSource = operation.terrainSource ?? "script";
            if (currentTerrain !== nextTerrain) {
                if (nextTerrain === baseTerrain)
                    overrides.delete(key);
                else
                    overrides.set(key, Object.freeze({
                        q: operation.coord.q,
                        r: operation.coord.r,
                        terrain: nextTerrain,
                        source: operation.terrainSource ?? "script"
                    }));
            }
        }
        else {
            nextTerrain = baseTerrain;
            eventSource = "restore";
            if (currentTerrain !== nextTerrain)
                overrides.delete(key);
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
        reject("terraform.override_budget_exceeded", `Persistent terrain overrides exceed ${TERRAFORMING_LIMITS.activeTerrainOverrides}.`);
    }
    let navigationProof;
    if (events.length > 0) {
        const candidateTerrain = effectiveTerrainByCoord(request.map, overrides);
        if (request.navigation.mode === "authored_routes") {
            const baselineAvailable = routeAvailability(request.map, request.terrainTypes, (coord) => request.map.getTile(coord)?.terrain);
            const candidateAvailable = routeAvailability(request.map, request.terrainTypes, (coord) => candidateTerrain.get(coordKey(coord)));
            if (!candidateAvailable) {
                reject(baselineAvailable
                    ? "terraform.last_authored_route_blocked"
                    : "terraform.authored_route_unavailable", baselineAvailable
                    ? "Persistent terrain candidate blocks an authored route."
                    : "Persistent terrain candidate does not repair unavailable authored routes.");
            }
        }
        else {
            const proof = request.navigation.prove(new Map(candidateTerrain));
            if (!proof.candidateAvailable) {
                reject(proof.baselineAvailable ? "terraform.last_path_blocked" : "terraform.navigation_unavailable", proof.baselineAvailable
                    ? "Persistent terrain candidate blocks the last dynamic path."
                    : "Persistent terrain candidate does not repair dynamic navigation.");
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
    const prepared = Object.freeze({});
    preparedAdoptions.set(prepared, adoption);
    return prepared;
}
/** Publish one prepared value once. Repeated or foreign adoption is an intentional no-op. */
export function adoptPersistentTerrainTransaction(prepared, publish) {
    const adoption = preparedAdoptions.get(prepared);
    if (!adoption)
        return Object.freeze({ adopted: false });
    preparedAdoptions.delete(prepared);
    publish(adoption);
    return Object.freeze({ adopted: true });
}
