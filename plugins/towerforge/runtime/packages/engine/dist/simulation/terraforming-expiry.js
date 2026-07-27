export function terraformExpiryTargetKey(target) {
    return `${target.layer}:${target.q},${target.r}`;
}
/** Pure countdown: callers decide whether due groups can be committed atomically. */
export function advanceTerraformExpiryGroups(groups, delta) {
    return groups.map((group) => {
        const difference = group.remaining - delta;
        const roundingBound = Number.EPSILON * 8 * Math.max(Math.abs(group.remaining), Math.abs(delta));
        const remaining = difference <= 0 || (delta > 0 && difference <= roundingBound)
            ? 0
            : difference;
        return {
            sequence: group.sequence,
            remaining,
            targets: group.targets
        };
    });
}
export function countTerraformExpiryOwnership(groups) {
    let terrain = 0;
    let elevation = 0;
    for (const group of groups) {
        for (const target of group.targets) {
            if (target.layer === "terrain")
                terrain += 1;
            else
                elevation += 1;
        }
    }
    return { terrain, elevation, combined: terrain + elevation };
}
export function buildTerraformingSnapshot(groups) {
    return {
        schemaVersion: 1,
        pendingExpiryGroups: groups.map((group) => ({
            sequence: group.sequence,
            remaining: group.remaining,
            targets: group.targets.map(({ layer, q, r }) => ({ layer, q, r }))
        }))
    };
}
