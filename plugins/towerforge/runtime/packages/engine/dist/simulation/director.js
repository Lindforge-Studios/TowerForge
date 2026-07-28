function metricValue(condition, analysis) {
    switch (condition.metric) {
        case "damage_share": return analysis.damageShares[condition.key ?? ""] ?? 0;
        case "coverage_ratio": return analysis.coverageRatios[condition.key ?? ""] ?? 0;
        case "movement_layer_share": return analysis.movementLayerShares[condition.key ?? ""] ?? 0;
        case "logistics_brownout_ratio": return analysis.logisticsBrownoutRatio;
    }
}
function conditionSeverity(condition, observed) {
    return condition.operator === "gte" ? observed - condition.threshold : condition.threshold - observed;
}
function cloneGroup(group) {
    return Object.freeze({
        enemyId: group.enemyId,
        count: group.count,
        spawnInterval: group.spawnInterval,
        startDelay: group.startDelay,
        ...(group.routeId === undefined ? {} : { routeId: group.routeId })
    });
}
function trailingUses(ids, counterId) {
    let uses = 0;
    for (let index = ids.length - 1; index >= 0 && ids[index] === counterId; index -= 1)
        uses += 1;
    return uses;
}
/** Pure authored-pool-only policy. It never mutates the authored wave or request. */
export function planDirectorWaveV1(profile, request) {
    if (!Number.isSafeInteger(request.nextWaveIndex) || request.nextWaveIndex < profile.fairness.minimumWaveIndex) {
        return undefined;
    }
    const threatBudget = profile.threatBudget.base + profile.threatBudget.perWave * request.nextWaveIndex;
    if (!Number.isFinite(threatBudget))
        return undefined;
    const candidates = [];
    for (const id of Object.keys(profile.counterPool).sort()) {
        const counter = profile.counterPool[id];
        const addedEnemies = counter.groups.reduce((sum, group) => sum + group.count, 0);
        if (counter.threatCost > threatBudget
            || counter.groups.length > profile.fairness.maxAddedGroups
            || counter.groups.length > 8
            || addedEnemies > profile.fairness.maxAddedEnemies
            || trailingUses(request.recentCounterIds, id) >= profile.fairness.maxConsecutiveUses)
            continue;
        let severity = 0;
        let reason;
        let eligible = true;
        for (const condition of counter.conditions) {
            const observed = metricValue(condition, request.analysis);
            if (!Number.isFinite(observed)) {
                eligible = false;
                break;
            }
            const currentSeverity = conditionSeverity(condition, observed);
            if (currentSeverity < 0) {
                eligible = false;
                break;
            }
            if (!reason || currentSeverity > severity) {
                severity = currentSeverity;
                reason = Object.freeze({ ...condition, observed });
            }
        }
        if (eligible && reason)
            candidates.push({ id, counter, severity, reason });
    }
    candidates.sort((left, right) => (right.counter.priority - left.counter.priority
        || right.severity - left.severity
        || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)));
    const selected = candidates[0];
    if (!selected)
        return undefined;
    const authoredGroups = Object.freeze(request.nextWave.groups.map(cloneGroup));
    const addedGroups = Object.freeze(selected.counter.groups.map(cloneGroup));
    const wave = Object.freeze({
        id: request.nextWave.id,
        label: request.nextWave.label,
        groups: Object.freeze([...authoredGroups, ...addedGroups])
    });
    return Object.freeze({
        schemaVersion: 1,
        nextWaveIndex: request.nextWaveIndex,
        authoredWaveId: request.nextWave.id,
        decision: Object.freeze({
            counterId: selected.id,
            threatCost: selected.counter.threatCost,
            reason: selected.reason,
            addedGroups
        }),
        wave
    });
}
