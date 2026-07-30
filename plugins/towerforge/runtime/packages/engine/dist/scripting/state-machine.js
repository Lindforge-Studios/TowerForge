import { evaluateTowerScriptExpression } from "./expression.js";
import { TOWER_SCRIPT_LIMITS } from "./schema-descriptor.js";
function parentPath(path) {
    const index = path.lastIndexOf("/");
    return index <= 0 ? "" : path.slice(0, index);
}
function flattenStates(machine) {
    const records = new Map();
    let count = 0;
    const visit = (states, parent, depth) => {
        if (depth > TOWER_SCRIPT_LIMITS.stateMachineDepth)
            throw new Error("TowerScript state machine depth budget exceeded.");
        for (const node of states) {
            count += 1;
            if (count > TOWER_SCRIPT_LIMITS.stateMachineStates)
                throw new Error("TowerScript state machine state budget exceeded.");
            const path = `${parent}/${node.id}`;
            if (records.has(path))
                throw new Error(`Duplicate TowerScript state path "${path}".`);
            records.set(path, { path, parentPath: parent, node });
            if (node.states?.length)
                visit(node.states, path, depth + 1);
        }
    };
    visit(machine.states, "", 0);
    return records;
}
/** Canonical absolute state paths used by checkpoint validation and authoring surfaces. */
export function collectTowerScriptStatePaths(machine) {
    return [...flattenStates(machine).keys()].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}
/**
 * Verifies the authored provenance carried by a persisted transition event without re-evaluating
 * its condition. Runtime checkpoint validation separately proves that the referenced context is
 * bound to this machine and already holds the transition target as its active state.
 */
export function hasTowerScriptStateTransitionProvenance(machine, transitionId, fromStatePath, toStatePath) {
    const records = flattenStates(machine);
    if (!records.has(fromStatePath) || !records.has(toStatePath))
        return false;
    let sourcePath = fromStatePath;
    while (sourcePath) {
        const record = records.get(sourcePath);
        if (!record)
            return false;
        const transition = (record.node.transitions ?? []).find((candidate) => candidate.id === transitionId);
        if (transition) {
            if (!transition.target.startsWith("/"))
                return false;
            return resolveInitialLeaf(machine, records, transition.target) === toStatePath;
        }
        sourcePath = record.parentPath;
    }
    return false;
}
function resolveInitialLeaf(machine, records, startPath) {
    let path = startPath ?? `/${machine.initial}`;
    const seen = new Set();
    while (true) {
        if (seen.has(path))
            throw new Error("TowerScript state machine initial-state cycle detected.");
        seen.add(path);
        const record = records.get(path);
        if (!record)
            throw new Error(`Unknown TowerScript state path "${path}".`);
        if (!record.node.states?.length)
            return path;
        if (!record.node.initial)
            throw new Error(`Compound TowerScript state "${path}" needs initial.`);
        path = `${path}/${record.node.initial}`;
    }
}
function pathChain(path) {
    const parts = path.split("/").filter(Boolean);
    return parts.map((_, index) => `/${parts.slice(0, index + 1).join("/")}`);
}
function actionsForPaths(records, paths, field) {
    return paths.flatMap((path) => [...(records.get(path)?.node[field] ?? [])]);
}
export function initializeTowerScriptStateMachine(machine, enteredAt) {
    const records = flattenStates(machine);
    const leaf = resolveInitialLeaf(machine, records);
    return {
        state: {
            schemaVersion: 1,
            activeStatePath: leaf,
            enteredAt,
            transitionCount: 0
        },
        entryActions: actionsForPaths(records, pathChain(leaf), "entryActions")
    };
}
function matchingTransition(records, activePath, eventName, context) {
    const expressionBudget = { remaining: TOWER_SCRIPT_LIMITS.behaviorExpressionOperationsPerAcquisition };
    let path = activePath;
    while (path) {
        const record = records.get(path);
        if (!record)
            throw new Error(`Unknown active TowerScript state path "${path}".`);
        for (const transition of record.node.transitions ?? []) {
            if (transition.event !== eventName)
                continue;
            if (transition.when !== undefined && !Boolean(evaluateTowerScriptExpression(transition.when, context, expressionBudget)))
                continue;
            return { sourcePath: path, transition };
        }
        path = record.parentPath;
    }
    return null;
}
function commonAncestor(left, right) {
    const leftParts = left.split("/").filter(Boolean);
    const rightParts = right.split("/").filter(Boolean);
    const common = [];
    for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index += 1) {
        if (leftParts[index] !== rightParts[index])
            break;
        common.push(leftParts[index]);
    }
    return common.length ? `/${common.join("/")}` : "";
}
export function planTowerScriptStateTransition(machine, current, eventName, context, enteredAt) {
    const records = flattenStates(machine);
    if (!records.has(current.activeStatePath))
        throw new Error("TowerScript state machine active state is unknown.");
    const match = matchingTransition(records, current.activeStatePath, eventName, context);
    if (!match)
        return null;
    if (!match.transition.target.startsWith("/"))
        throw new Error("TowerScript state transition target must be absolute.");
    const targetLeaf = resolveInitialLeaf(machine, records, match.transition.target);
    let boundary = commonAncestor(match.sourcePath, targetLeaf);
    if (boundary === match.sourcePath)
        boundary = parentPath(match.sourcePath);
    const activeChain = pathChain(current.activeStatePath);
    const exitPaths = [...activeChain].reverse().filter((path) => path !== boundary && path.startsWith(`${boundary}/`));
    const targetChain = pathChain(targetLeaf);
    const entryPaths = targetChain.filter((path) => path !== boundary && path.startsWith(`${boundary}/`));
    return {
        schemaVersion: 1,
        transitionId: match.transition.id,
        fromStatePath: current.activeStatePath,
        toStatePath: targetLeaf,
        exitActions: actionsForPaths(records, exitPaths, "exitActions"),
        transitionActions: [...(match.transition.actions ?? [])],
        entryActions: actionsForPaths(records, entryPaths, "entryActions"),
        state: {
            schemaVersion: 1,
            activeStatePath: targetLeaf,
            enteredAt,
            transitionCount: current.transitionCount + 1
        }
    };
}
