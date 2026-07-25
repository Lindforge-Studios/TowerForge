import { TOWER_SCRIPT_EVENT_FIELDS } from "../scripting/schema-descriptor.js";
const SOURCE_KIND_RANK = Object.freeze({
    wave_spawn: 0,
    death_spawn: 1,
    phase_spawn: 2,
    script_spawn: 3
});
function compareBinary(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function compareProvenance(left, right) {
    return compareBinary(left.movementProfileId, right.movementProfileId)
        || left.goal.r - right.goal.r
        || left.goal.q - right.goal.q
        || compareBinary(left.routeId, right.routeId)
        || SOURCE_KIND_RANK[left.kind] - SOURCE_KIND_RANK[right.kind]
        || left.coord.r - right.coord.r
        || left.coord.q - right.coord.q
        || compareBinary(left.subjectId, right.subjectId);
}
function movementProfileId(profile, enemyTypeId) {
    return profile.enemyMovementProfiles?.[enemyTypeId] ?? profile.defaultMovementProfileId;
}
/**
 * Collects the deterministic, mission-reachable dynamic spawn graph without consulting a
 * resolver or mutating runtime state. The returned provenance is intentionally richer than the
 * work-set key so independent authored causes remain visible while spawn cycles stay bounded.
 */
export function collectDynamicTerraformingSpawnProvenance(request) {
    const routes = [...request.routes].sort((left, right) => compareBinary(left.id, right.id));
    const routesById = new Map(routes.map((route) => [route.id, route]));
    const defaultRoute = routes.find((route) => route.id === "main") ?? routes[0];
    if (!defaultRoute) {
        throw new Error("Dynamic terraforming reachability requires at least one route.");
    }
    const resolveRoute = (routeId) => {
        const route = routeId === undefined ? defaultRoute : routesById.get(routeId);
        if (!route)
            throw new Error(`Dynamic navigation spawn references unknown route "${routeId}".`);
        return route;
    };
    const provenanceByKey = new Map();
    const record = (kind, enemyTypeId, route, subjectId) => {
        if (!Object.prototype.hasOwnProperty.call(request.enemyTypes, enemyTypeId))
            return;
        const coord = route.pathCenterline[0];
        const goal = route.pathCenterline.at(-1);
        if (!coord || !goal)
            throw new Error(`Dynamic navigation route "${route.id}" has no endpoints.`);
        const entry = Object.freeze({
            kind,
            movementProfileId: movementProfileId(request.profile, enemyTypeId),
            routeId: route.id,
            goal: Object.freeze({ q: goal.q, r: goal.r }),
            coord: Object.freeze({ q: coord.q, r: coord.r }),
            subjectId
        });
        const key = JSON.stringify([
            entry.movementProfileId,
            entry.goal.q,
            entry.goal.r,
            entry.routeId,
            entry.kind,
            entry.coord.q,
            entry.coord.r,
            entry.subjectId
        ]);
        provenanceByKey.set(key, entry);
    };
    const queued = new Set();
    const worklist = [];
    const enqueue = (enemyTypeId, routeId) => {
        if (!Object.prototype.hasOwnProperty.call(request.enemyTypes, enemyTypeId))
            return undefined;
        const route = resolveRoute(routeId);
        const key = JSON.stringify([enemyTypeId, route.id]);
        if (!queued.has(key)) {
            queued.add(key);
            worklist.push({ enemyTypeId, routeId: route.id });
            worklist.sort((left, right) => (compareBinary(left.enemyTypeId, right.enemyTypeId)
                || compareBinary(left.routeId, right.routeId)));
        }
        return route;
    };
    for (const wave of request.waves) {
        for (const group of wave.groups) {
            const route = enqueue(group.enemyId, group.routeId);
            if (route)
                record("wave_spawn", group.enemyId, route, group.enemyId);
        }
    }
    const reachableEnemyTypeIds = new Set();
    const deathSpawnChildTypeIds = new Set();
    const phaseSpawnChildTypeIds = new Set();
    const reachableTerrainIds = new Set(request.initialReachableTerrainIds);
    const appliedHandlers = new Set();
    const acceptsAny = (ids, candidates) => {
        const accepted = ids === undefined ? undefined : new Set(ids);
        for (const candidate of candidates)
            if (!accepted || accepted.has(candidate))
                return true;
        return false;
    };
    const handlerApplies = (script, eventName) => {
        const eventFields = new Set(TOWER_SCRIPT_EVENT_FIELDS[eventName] ?? []);
        const eventEnemyTypeIds = eventName === "enemySpawnedOnDeath"
            ? deathSpawnChildTypeIds
            : eventName === "enemyPhaseSpawned"
                ? phaseSpawnChildTypeIds
                : reachableEnemyTypeIds;
        for (const binding of script.bindings) {
            if (binding.scope === "global")
                return true;
            if (binding.scope === "mission" && acceptsAny(binding.ids, [request.mission.id]))
                return true;
            if (binding.scope === "map" && acceptsAny(binding.ids, [request.mission.mapId]))
                return true;
            if (binding.scope === "wave" && acceptsAny(binding.ids, [request.mission.waveSetId]))
                return true;
            if (binding.scope === "tower"
                && (eventName === "tick" || eventFields.has("towerId") || eventFields.has("towerIds"))
                && acceptsAny(binding.ids, request.mission.buildTowerIds))
                return true;
            if (binding.scope === "ability"
                && eventFields.has("abilityId")
                && acceptsAny(binding.ids, request.mission.abilityIds))
                return true;
            if (binding.scope === "terrain"
                && (eventFields.has("coord") || eventFields.has("center") || eventFields.has("to"))
                && acceptsAny(binding.ids, reachableTerrainIds))
                return true;
            if (binding.scope === "enemy"
                && (eventName === "tick" || eventFields.has("enemyId") || eventFields.has("targetEnemyId") || eventFields.has("enemyIds"))
                && eventEnemyTypeIds.size > 0
                && acceptsAny(binding.ids, eventEnemyTypeIds))
                return true;
        }
        return false;
    };
    while (true) {
        let changed = false;
        while (worklist.length > 0) {
            const current = worklist.shift();
            changed = true;
            const enemy = request.enemyTypes[current.enemyTypeId];
            if (!enemy)
                continue;
            reachableEnemyTypeIds.add(current.enemyTypeId);
            const inheritedRoute = resolveRoute(current.routeId);
            if (enemy.spawnOnDeath && enemy.spawnOnDeath.count > 0) {
                const childId = enemy.spawnOnDeath.enemyId;
                const childRoute = enqueue(childId, inheritedRoute.id);
                if (childRoute) {
                    deathSpawnChildTypeIds.add(childId);
                    record("death_spawn", childId, childRoute, childId);
                }
            }
            for (const phase of enemy.phaseSpawns ?? []) {
                if (!(phase.count > 0))
                    continue;
                const routeIds = phase.routeIds?.length
                    ? phase.routeIds.slice(0, Math.min(phase.routeIds.length, Math.ceil(phase.count)))
                    : [inheritedRoute.id];
                for (const routeId of routeIds) {
                    const childRoute = enqueue(phase.enemyId, routeId);
                    if (!childRoute)
                        continue;
                    phaseSpawnChildTypeIds.add(phase.enemyId);
                    record("phase_spawn", phase.enemyId, childRoute, phase.enemyId);
                }
            }
        }
        for (const scriptKey of Object.keys(request.scripts).sort(compareBinary)) {
            const script = request.scripts[scriptKey];
            if (!script || script.enabled === false)
                continue;
            for (const eventName of Object.keys(script.handlers).sort(compareBinary)) {
                const handlers = script.handlers[eventName] ?? [];
                for (let handlerIndex = 0; handlerIndex < handlers.length; handlerIndex += 1) {
                    const handlerKey = JSON.stringify([scriptKey, eventName, handlerIndex]);
                    if (appliedHandlers.has(handlerKey) || !handlerApplies(script, eventName))
                        continue;
                    appliedHandlers.add(handlerKey);
                    changed = true;
                    for (const action of handlers[handlerIndex].actions) {
                        if (action.action === "spawnEnemy" && typeof action.enemyTypeId === "string") {
                            const routeId = typeof action.routeId === "string" ? action.routeId : undefined;
                            const childRoute = enqueue(action.enemyTypeId, routeId);
                            if (childRoute)
                                record("script_spawn", action.enemyTypeId, childRoute, script.id);
                        }
                        if (action.action === "setTileTerrain" && typeof action.terrainId === "string") {
                            reachableTerrainIds.add(action.terrainId);
                        }
                        if (action.action === "terraformTiles" && Array.isArray(action.operations)) {
                            for (const operation of action.operations) {
                                if (!operation || typeof operation !== "object" || Array.isArray(operation))
                                    continue;
                                const candidate = operation;
                                if (candidate.kind !== "set_terrain" || typeof candidate.transitionId !== "string")
                                    continue;
                                const terrainId = request.terraformTransitionTerrainById[candidate.transitionId];
                                if (typeof terrainId === "string")
                                    reachableTerrainIds.add(terrainId);
                            }
                        }
                    }
                }
            }
        }
        if (worklist.length === 0 && !changed)
            break;
    }
    return Object.freeze([...provenanceByKey.values()].sort(compareProvenance));
}
