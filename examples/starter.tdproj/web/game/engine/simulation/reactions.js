import { REACTION_LIMITS } from "../content/mechanics.js";
function binary(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}
function emptyPlan() {
    return deepFreeze({
        consumptions: [], exposureApplications: [], triggers: [], secondaryPlans: [], diagnostics: []
    });
}
/**
 * Pure deterministic reaction planner. It observes a captured pre-HP state and returns only
 * mutations/events/secondary packets; the game owns all state mutation and damage settlement.
 */
export function planReactions(input) {
    const { primary } = input;
    const eligibleSource = primary.sourceKind === "tower"
        || primary.sourceKind === "ability"
        || primary.sourceKind === "tower_script"
        || (primary.sourceKind === "reaction" && primary.allowReactions);
    if (!eligibleSource || primary.tags.includes("over_time") || !(primary.resolvedFinalAmount > 0)) {
        return emptyPlan();
    }
    const profile = input.profile;
    const definitions = profile.exposures?.definitions ?? {};
    const applicationBindings = profile.exposures?.applications?.damageTypes ?? {};
    const reactions = profile.reactions ?? {};
    const consumptions = [];
    const triggers = [];
    const secondaryPlans = [];
    const diagnostics = [];
    const reservedExposure = new Map();
    const reservedStatus = new Set();
    let suppressApplications = false;
    let remainingPackets = Math.max(0, input.budget.secondaryPacketsRemaining);
    let depthDropped = 0;
    let packetDropped = 0;
    for (const reactionId of Object.keys(reactions).sort(binary)) {
        const reaction = reactions[reactionId];
        if (!reaction.trigger.damageTypes.includes(primary.damageType))
            continue;
        const requirements = reaction.requirements ?? [];
        let matches = true;
        for (const requirement of requirements) {
            if (requirement.kind === "exposure") {
                const available = Math.max(0, (primary.exposures[requirement.exposureId]?.stacks ?? 0)
                    - (reservedExposure.get(requirement.exposureId) ?? 0));
                if (available < (requirement.minStacks ?? 1))
                    matches = false;
            }
            else if (requirement.kind === "status") {
                if (!(requirement.statusId in primary.statuses) || reservedStatus.has(requirement.statusId))
                    matches = false;
            }
            else if (!primary.terrainTags.includes(requirement.tag)) {
                matches = false;
            }
            if (!matches)
                break;
        }
        if (!matches)
            continue;
        for (const requirement of requirements) {
            if (requirement.kind === "exposure" && requirement.consume && requirement.consume !== "none") {
                const current = primary.exposures[requirement.exposureId]?.stacks ?? 0;
                const amount = requirement.consume === "all" ? current : 1;
                reservedExposure.set(requirement.exposureId, (reservedExposure.get(requirement.exposureId) ?? 0) + amount);
                consumptions.push({
                    kind: "exposure", reactionId, enemyId: primary.rootEnemyId,
                    exposureId: requirement.exposureId, stacks: requirement.consume
                });
            }
            else if (requirement.kind === "status" && requirement.consume === "clear") {
                reservedStatus.add(requirement.statusId);
                consumptions.push({
                    kind: "status", reactionId, enemyId: primary.rootEnemyId, statusId: requirement.statusId
                });
            }
        }
        suppressApplications ||= reaction.suppressTriggerExposureApplications === true;
        const reactionPlans = [];
        for (const effectId of Object.keys(reaction.effects).sort(binary)) {
            const effect = reaction.effects[effectId];
            let targets;
            if (effect.target.kind === "primary") {
                targets = primary.aliveAfterPrimary ? [primary.rootEnemyId] : [];
            }
            else if (effect.target.kind === "radius") {
                const target = effect.target;
                targets = input.candidates
                    .filter((candidate) => candidate.alive && candidate.enemyId !== primary.rootEnemyId)
                    .filter((candidate) => candidate.topologyDistance <= target.radius)
                    .sort((left, right) => left.topologyDistance - right.topologyDistance || binary(left.enemyId, right.enemyId))
                    .slice(0, target.maxTargets)
                    .map((candidate) => candidate.enemyId);
            }
            else {
                const target = effect.target;
                targets = input.candidates
                    .filter((candidate) => candidate.alive && candidate.enemyId !== primary.rootEnemyId)
                    .filter((candidate) => candidate.terrainTags.includes(target.tag))
                    .sort((left, right) => left.topologyDistance - right.topologyDistance || binary(left.enemyId, right.enemyId))
                    .slice(0, target.maxTargets)
                    .map((candidate) => candidate.enemyId);
            }
            const amount = effect.amount.kind === "flat"
                ? effect.amount.value
                : primary.afterModifiers * effect.amount.multiplier;
            for (const targetEnemyId of targets) {
                reactionPlans.push({
                    reactionId, effectId, targetEnemyId, amount, damageType: effect.damageType,
                    depth: primary.depth + 1,
                    tags: effect.target.kind === "primary" ? ["reaction"] : ["reaction", "area"],
                    allowReactions: effect.allowReactions === true
                });
            }
        }
        let admitted;
        if (reactionPlans.length > 0 && primary.depth >= REACTION_LIMITS.maxDepth) {
            admitted = [];
            depthDropped += reactionPlans.length;
        }
        else {
            admitted = reactionPlans.slice(0, remainingPackets);
            packetDropped += reactionPlans.length - admitted.length;
            remainingPackets -= admitted.length;
        }
        triggers.push({
            reactionId,
            originEnemyId: primary.rootEnemyId,
            originEnemyTypeId: primary.rootEnemyTypeId,
            originCoord: { ...primary.originCoord },
            triggerDamageType: primary.damageType,
            depth: primary.depth,
            scheduledTargetIds: [...new Set(admitted.map((plan) => plan.targetEnemyId))]
        });
        secondaryPlans.push(...admitted);
    }
    if (depthDropped > 0)
        diagnostics.push({
            rootEnemyId: primary.rootEnemyId, rootEnemyTypeId: primary.rootEnemyTypeId,
            budget: "depth", limit: REACTION_LIMITS.maxDepth, dropped: depthDropped
        });
    if (packetDropped > 0)
        diagnostics.push({
            rootEnemyId: primary.rootEnemyId, rootEnemyTypeId: primary.rootEnemyTypeId,
            budget: "secondary_packets", limit: REACTION_LIMITS.secondaryPacketsPerRoot, dropped: packetDropped
        });
    const exposureApplications = [];
    if (primary.aliveAfterPrimary && !suppressApplications) {
        let available = Math.max(0, input.budget.liveExposuresRemaining);
        let dropped = 0;
        for (const application of applicationBindings[primary.damageType] ?? []) {
            const definition = definitions[application.exposureId];
            if (!definition)
                continue;
            const createsLiveExposure = primary.exposures[application.exposureId] === undefined;
            if (createsLiveExposure && available <= 0) {
                dropped += 1;
                continue;
            }
            exposureApplications.push({
                enemyId: primary.rootEnemyId,
                exposureId: application.exposureId,
                stacks: application.stacks ?? 1,
                duration: definition.duration,
                maxStacks: definition.maxStacks,
                cause: "damage"
            });
            if (createsLiveExposure)
                available -= 1;
        }
        if (dropped > 0) {
            diagnostics.push({
                rootEnemyId: primary.rootEnemyId,
                rootEnemyTypeId: primary.rootEnemyTypeId,
                budget: "live_exposures",
                limit: REACTION_LIMITS.runtimeExposureApplications,
                dropped
            });
        }
    }
    return deepFreeze({ consumptions, exposureApplications, triggers, secondaryPlans, diagnostics });
}
