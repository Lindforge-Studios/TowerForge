import { TERRAFORMING_LIMITS } from "../content/terraforming-mechanics.js";
import { failDynamicTerraformingSafetyBudget, isDynamicTerraformingSafetyEntryCount } from "./terraforming-navigation-budget.js";
function checkedCombinedFieldCells(fieldCount, obligationCount, mapCellCount) {
    if (obligationCount > Number.MAX_SAFE_INTEGER - fieldCount) {
        failDynamicTerraformingSafetyBudget();
    }
    const proofFieldCount = fieldCount + obligationCount;
    if (proofFieldCount > Math.floor(Number.MAX_SAFE_INTEGER / 2)) {
        failDynamicTerraformingSafetyBudget();
    }
    const doubledFields = proofFieldCount * 2;
    if (doubledFields !== 0 && mapCellCount > Math.floor(Number.MAX_SAFE_INTEGER / doubledFields)) {
        failDynamicTerraformingSafetyBudget();
    }
    const combined = mapCellCount * doubledFields;
    if (!Number.isSafeInteger(combined))
        failDynamicTerraformingSafetyBudget();
    return combined;
}
export function assertDynamicTerraformingSafetyBudget(input) {
    const obligationCount = input.obligationCount ?? 0;
    const observationCount = input.observationCount ?? 0;
    if (!Number.isSafeInteger(input.sourceCount)
        || input.sourceCount < 1
        || !Number.isSafeInteger(input.fieldCount)
        || input.fieldCount < 1
        || !Number.isSafeInteger(input.mapCellCount)
        || input.mapCellCount < 1
        || !isDynamicTerraformingSafetyEntryCount(input.sourceCount)
        || !isDynamicTerraformingSafetyEntryCount(obligationCount)
        || !isDynamicTerraformingSafetyEntryCount(observationCount)
        || input.fieldCount > TERRAFORMING_LIMITS.profileGoalFieldsPerTransaction)
        failDynamicTerraformingSafetyBudget();
    const combined = checkedCombinedFieldCells(input.fieldCount, obligationCount, input.mapCellCount);
    if (combined > TERRAFORMING_LIMITS.fieldCellsBaselineAndCandidate) {
        failDynamicTerraformingSafetyBudget();
    }
}
const SOURCE_KIND_RANK = Object.freeze({
    route_source: 0,
    route_goal: 1,
    wave_spawn: 2,
    death_spawn: 3,
    phase_spawn: 4,
    script_spawn: 5,
    pending_death_spawn: 6,
    live_current: 7,
    live_next: 8
});
function compareBinary(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function groupKey(movementProfileId, goal) {
    return JSON.stringify([movementProfileId, goal.q, goal.r]);
}
function compareFieldRef(left, right) {
    return compareBinary(left.movementProfileId, right.movementProfileId)
        || left.goal.r - right.goal.r
        || left.goal.q - right.goal.q;
}
function compareObligation(left, right) {
    return compareFieldRef(left.parent, right.parent) || compareFieldRef(left.child, right.child);
}
function compareObservation(left, right) {
    return (left.kind === right.kind ? 0 : left.kind === "death_spawn" ? -1 : 1)
        || compareBinary(left.parentEnemyTypeId, right.parentEnemyTypeId)
        || compareBinary(left.childEnemyTypeId, right.childEnemyTypeId);
}
function movementProfileIdForEnemy(profile, enemy) {
    return profile.enemyMovementProfiles?.[enemy.typeId] ?? profile.defaultMovementProfileId;
}
/** Builds the canonical solver-free safety input and enforces all C2 navigation budgets. */
export function prepareDynamicTerraformingSafetySet(input) {
    const routes = [...input.routes].sort((left, right) => compareBinary(left.id, right.id));
    const routesById = new Map(routes.map((route) => [route.id, route]));
    const groupsByKey = new Map();
    const assertKnownMovementProfile = (movementProfileId) => {
        if (!Object.prototype.hasOwnProperty.call(input.profile.movementProfiles, movementProfileId)) {
            throw new Error(`Dynamic terraforming safety references unknown movement profile "${movementProfileId}".`);
        }
    };
    const ensureGroup = (movementProfileId, route) => {
        assertKnownMovementProfile(movementProfileId);
        const goal = route.pathCenterline.at(-1);
        if (!goal)
            throw new Error(`Dynamic navigation route "${route.id}" has no goal.`);
        const key = groupKey(movementProfileId, goal);
        const existing = groupsByKey.get(key);
        if (existing) {
            existing.routeIds.add(route.id);
            return existing;
        }
        const created = {
            key,
            movementProfileId,
            goal: { q: goal.q, r: goal.r },
            routeIds: new Set([route.id]),
            sourcesByKey: new Map()
        };
        groupsByKey.set(key, created);
        return created;
    };
    const addSource = (group, source) => {
        const key = JSON.stringify([
            source.routeId,
            source.kind,
            source.coord.q,
            source.coord.r,
            source.subjectId
        ]);
        group.sourcesByKey.set(key, source);
    };
    for (const movementProfileId of Object.keys(input.profile.movementProfiles).sort(compareBinary)) {
        for (const route of routes) {
            const coord = route.pathCenterline[0];
            const goal = route.pathCenterline.at(-1);
            if (!coord || !goal)
                throw new Error(`Dynamic navigation route "${route.id}" has no endpoints.`);
            const group = ensureGroup(movementProfileId, route);
            addSource(group, Object.freeze({
                kind: "route_source",
                movementProfileId,
                routeId: route.id,
                goal: Object.freeze({ q: goal.q, r: goal.r }),
                coord: Object.freeze({ q: coord.q, r: coord.r }),
                subjectId: ""
            }));
            addSource(group, Object.freeze({
                kind: "route_goal",
                movementProfileId,
                routeId: route.id,
                goal: Object.freeze({ q: goal.q, r: goal.r }),
                coord: Object.freeze({ q: goal.q, r: goal.r }),
                subjectId: ""
            }));
        }
    }
    for (const provenance of input.spawnProvenance) {
        const route = routesById.get(provenance.routeId);
        if (!route)
            throw new Error(`Dynamic spawn provenance references unknown route "${provenance.routeId}".`);
        const goal = route.pathCenterline.at(-1);
        if (!goal)
            throw new Error(`Dynamic navigation route "${route.id}" has no goal.`);
        const group = ensureGroup(provenance.movementProfileId, route);
        addSource(group, Object.freeze({
            kind: provenance.kind,
            movementProfileId: provenance.movementProfileId,
            routeId: route.id,
            goal: Object.freeze({ q: goal.q, r: goal.r }),
            coord: Object.freeze({ q: provenance.coord.q, r: provenance.coord.r }),
            subjectId: provenance.subjectId
        }));
    }
    const mutableObligationsByKey = new Map();
    const observationKeys = new Set();
    for (const obligation of input.spawnObligations ?? []) {
        assertKnownMovementProfile(obligation.parent.movementProfileId);
        assertKnownMovementProfile(obligation.child.movementProfileId);
        const parent = Object.freeze({
            movementProfileId: obligation.parent.movementProfileId,
            goal: Object.freeze({ q: obligation.parent.goal.q, r: obligation.parent.goal.r })
        });
        const child = Object.freeze({
            movementProfileId: obligation.child.movementProfileId,
            goal: Object.freeze({ q: obligation.child.goal.q, r: obligation.child.goal.r })
        });
        const parentKey = groupKey(parent.movementProfileId, parent.goal);
        const childKey = groupKey(child.movementProfileId, child.goal);
        if (!groupsByKey.has(parentKey)) {
            throw new Error(`Dynamic spawn obligation references unknown parent field ${parentKey}.`);
        }
        if (!groupsByKey.has(childKey)) {
            throw new Error(`Dynamic spawn obligation references unknown child field ${childKey}.`);
        }
        const key = JSON.stringify([
            parent.movementProfileId,
            parent.goal.q,
            parent.goal.r,
            child.movementProfileId,
            child.goal.q,
            child.goal.r
        ]);
        let mutable = mutableObligationsByKey.get(key);
        if (!mutable) {
            mutable = {
                key,
                parent,
                child,
                observationsByKey: new Map()
            };
            mutableObligationsByKey.set(key, mutable);
        }
        const observations = [...obligation.observations].sort(compareObservation);
        for (const candidate of observations) {
            const observation = Object.freeze({
                kind: candidate.kind,
                parentEnemyTypeId: candidate.parentEnemyTypeId,
                childEnemyTypeId: candidate.childEnemyTypeId
            });
            const observationKey = JSON.stringify([
                observation.kind,
                observation.parentEnemyTypeId,
                observation.childEnemyTypeId
            ]);
            observationKeys.add(JSON.stringify([key, observationKey]));
            mutable.observationsByKey.set(observationKey, observation);
        }
    }
    const canonicalObligations = [...mutableObligationsByKey.values()]
        .map((obligation) => Object.freeze({
        key: obligation.key,
        parent: obligation.parent,
        child: obligation.child,
        observations: Object.freeze([...obligation.observationsByKey.values()].sort(compareObservation))
    }))
        .sort(compareObligation);
    const obligations = canonicalObligations.filter((obligation) => (groupKey(obligation.parent.movementProfileId, obligation.parent.goal)
        !== groupKey(obligation.child.movementProfileId, obligation.child.goal)));
    const deadNavigableEnemies = input.enemies
        .filter((enemy) => enemy.hp <= 0 && enemy.routeId !== undefined && enemy.navigation !== undefined)
        .sort((left, right) => compareBinary(left.id, right.id));
    for (const enemy of deadNavigableEnemies) {
        const route = routesById.get(enemy.routeId);
        if (!route)
            throw new Error(`Dynamic enemy "${enemy.id}" references unknown route "${enemy.routeId}".`);
        const routeGoal = route.pathCenterline.at(-1);
        if (!routeGoal)
            throw new Error(`Dynamic navigation route "${route.id}" has no goal.`);
        if (enemy.navigation.currentCoord.q === routeGoal.q
            && enemy.navigation.currentCoord.r === routeGoal.r)
            continue;
        const parentMovementProfileId = movementProfileIdForEnemy(input.profile, enemy);
        const parentKey = groupKey(parentMovementProfileId, routeGoal);
        for (const obligation of canonicalObligations) {
            if (groupKey(obligation.parent.movementProfileId, obligation.parent.goal) !== parentKey)
                continue;
            if (!obligation.observations.some((observation) => (observation.kind === "death_spawn"
                && observation.parentEnemyTypeId === enemy.typeId)))
                continue;
            const childGroup = groupsByKey.get(groupKey(obligation.child.movementProfileId, obligation.child.goal));
            if (!childGroup)
                throw new Error(`Dynamic spawn obligation "${obligation.key}" has no child field.`);
            addSource(childGroup, Object.freeze({
                kind: "pending_death_spawn",
                movementProfileId: obligation.child.movementProfileId,
                routeId: route.id,
                goal: Object.freeze({ ...obligation.child.goal }),
                coord: Object.freeze({ ...enemy.navigation.currentCoord }),
                subjectId: enemy.id
            }));
        }
    }
    const liveEnemies = input.enemies
        .filter((enemy) => enemy.hp > 0 && enemy.routeId !== undefined && enemy.navigation !== undefined)
        .sort((left, right) => compareBinary(left.id, right.id));
    for (const enemy of liveEnemies) {
        const route = routesById.get(enemy.routeId);
        if (!route)
            throw new Error(`Dynamic enemy "${enemy.id}" references unknown route "${enemy.routeId}".`);
        const goal = route.pathCenterline.at(-1);
        if (!goal)
            throw new Error(`Dynamic navigation route "${route.id}" has no goal.`);
        const movementProfileId = movementProfileIdForEnemy(input.profile, enemy);
        const group = ensureGroup(movementProfileId, route);
        addSource(group, Object.freeze({
            kind: "live_current",
            movementProfileId,
            routeId: route.id,
            goal: Object.freeze({ q: goal.q, r: goal.r }),
            coord: Object.freeze({ ...enemy.navigation.currentCoord }),
            subjectId: enemy.id
        }));
        if (enemy.navigation.edgeProgress > 0 && enemy.navigation.nextCoord) {
            addSource(group, Object.freeze({
                kind: "live_next",
                movementProfileId,
                routeId: route.id,
                goal: Object.freeze({ q: goal.q, r: goal.r }),
                coord: Object.freeze({ ...enemy.navigation.nextCoord }),
                subjectId: enemy.id
            }));
        }
    }
    const groups = [...groupsByKey.values()]
        .sort((left, right) => (compareBinary(left.movementProfileId, right.movementProfileId)
        || left.goal.r - right.goal.r
        || left.goal.q - right.goal.q))
        .map((group) => {
        const sources = [...group.sourcesByKey.values()].sort((left, right) => (compareBinary(left.routeId, right.routeId)
            || SOURCE_KIND_RANK[left.kind] - SOURCE_KIND_RANK[right.kind]
            || left.coord.r - right.coord.r
            || left.coord.q - right.coord.q
            || compareBinary(left.subjectId, right.subjectId)));
        return Object.freeze({
            key: group.key,
            movementProfileId: group.movementProfileId,
            goal: Object.freeze({ ...group.goal }),
            routeId: [...group.routeIds].sort(compareBinary)[0],
            sources: Object.freeze(sources)
        });
    });
    const sourceCount = groups.reduce((total, group) => total + group.sources.length, 0);
    const fieldCount = groups.length;
    const obligationCount = obligations.length;
    const observationCount = observationKeys.size;
    assertDynamicTerraformingSafetyBudget({
        sourceCount,
        fieldCount,
        obligationCount,
        observationCount,
        mapCellCount: input.mapCellCount
    });
    const combinedFieldCells = checkedCombinedFieldCells(fieldCount, obligationCount, input.mapCellCount);
    const common = {
        groups: Object.freeze(groups),
        sourceCount,
        fieldCount,
        combinedFieldCells
    };
    if (input.spawnObligations === undefined)
        return Object.freeze(common);
    return Object.freeze({
        groups: common.groups,
        obligations: Object.freeze(obligations),
        sourceCount,
        fieldCount,
        obligationCount,
        observationCount,
        combinedFieldCells
    });
}
