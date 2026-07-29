import { TOWER_TARGET_MODES } from "../simulation/types.js";
import { evaluateTowerScriptExpression } from "./expression.js";
import { TOWER_SCRIPT_LIMITS } from "./schema-descriptor.js";
function compareBinary(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function compareCandidates(mode, left, right) {
    let result = 0;
    if (mode === "last")
        result = left.routeProgress - right.routeProgress;
    else if (mode === "closest")
        result = left.distance - right.distance;
    else if (mode === "furthest")
        result = right.distance - left.distance;
    else if (mode === "strongest" || mode === "largest_hp") {
        result = right.hp - left.hp || right.routeProgress - left.routeProgress;
    }
    else if (mode === "weakest") {
        result = left.hp - right.hp || right.routeProgress - left.routeProgress;
    }
    else if (mode === "fastest_ahead") {
        result = Number(right.hasPierceOnlyArmor) - Number(left.hasPierceOnlyArmor)
            || right.routeProgress - left.routeProgress;
    }
    else
        result = right.routeProgress - left.routeProgress;
    return result || compareBinary(left.id, right.id);
}
function expressionRoot(state, candidate) {
    const candidateContext = candidate === null ? null : {
        ...candidate,
        tags: Object.fromEntries(candidate.tags.map((tag) => [tag, true]))
    };
    return {
        tower: state.context.tower,
        game: state.context.game,
        state: state.context.state,
        candidates: { count: state.candidates.length },
        candidate: candidateContext
    };
}
function evaluateNode(node, state, depth) {
    const selectedBeforeNode = state.selected;
    state.remainingNodes -= 1;
    if (state.remainingNodes < 0 || depth > TOWER_SCRIPT_LIMITS.behaviorTreeDepth) {
        throw new Error("TowerScript behavior tree node budget exceeded.");
    }
    state.visited.push(node.id);
    const finish = (success, selectedTargetIds) => {
        if (!success)
            state.selected = selectedBeforeNode;
        state.trace.push(Object.freeze({
            nodeId: node.id,
            nodeKind: node.type,
            status: success ? "success" : "failure",
            ...(selectedTargetIds === undefined ? {} : { selectedTargetIds: Object.freeze([...selectedTargetIds]) })
        }));
        return success;
    };
    if (node.type === "selector") {
        for (const child of node.children)
            if (evaluateNode(child, state, depth + 1))
                return finish(true);
        return finish(false);
    }
    if (node.type === "sequence") {
        for (const child of node.children)
            if (!evaluateNode(child, state, depth + 1))
                return finish(false);
        return finish(true);
    }
    if (node.type === "condition") {
        if (node.mode === "context") {
            return finish(Boolean(evaluateTowerScriptExpression(node.expression, expressionRoot(state, null), state.expressionBudget)));
        }
        for (const candidate of state.candidates) {
            if (Boolean(evaluateTowerScriptExpression(node.expression, expressionRoot(state, candidate), state.expressionBudget))) {
                return finish(true);
            }
        }
        return finish(false);
    }
    if (node.type !== "action" || node.action !== "select_targets"
        || !TOWER_TARGET_MODES.includes(node.mode)) {
        throw new Error("TowerScript behavior tree action is invalid.");
    }
    const selected = node.filter === undefined
        ? [...state.candidates]
        : state.candidates.filter((candidate) => Boolean(evaluateTowerScriptExpression(node.filter, expressionRoot(state, candidate), state.expressionBudget)));
    selected.sort((left, right) => compareCandidates(node.mode, left, right));
    state.selected = Object.freeze(selected.map((candidate) => candidate.id));
    return finish(state.selected.length > 0, state.selected);
}
/**
 * Pure deterministic TowerScript v7 target decision evaluator. It owns no game state and never
 * calls a renderer or host callback. A caller applies the returned ids only to its prevalidated
 * acquisition candidates and falls back to the tower's ordinary target mode on failure.
 */
export function evaluateTowerScriptBehaviorTree(tree, context) {
    const visited = [];
    if (!Array.isArray(context.candidates)
        || context.candidates.length > TOWER_SCRIPT_LIMITS.behaviorCandidatesPerAcquisition) {
        return Object.freeze({
            schemaVersion: 1,
            status: "failure",
            selectedTargetIds: Object.freeze([]),
            visitedNodeIds: Object.freeze([]),
            trace: Object.freeze([]),
            diagnostic: Object.freeze({
                code: "budget_exceeded",
                message: "TowerScript behavior candidate budget exceeded."
            })
        });
    }
    const candidates = Object.freeze([...context.candidates].sort((left, right) => compareBinary(left.id, right.id)));
    const state = {
        context,
        candidates,
        visited,
        trace: [],
        expressionBudget: { remaining: TOWER_SCRIPT_LIMITS.behaviorExpressionOperationsPerAcquisition },
        remainingNodes: TOWER_SCRIPT_LIMITS.behaviorTreeNodes,
        selected: Object.freeze([])
    };
    try {
        const success = evaluateNode(tree.root, state, 0) && state.selected.length > 0;
        return Object.freeze({
            schemaVersion: 1,
            status: success ? "success" : "failure",
            selectedTargetIds: success ? Object.freeze([...state.selected]) : Object.freeze([]),
            visitedNodeIds: Object.freeze([...visited]),
            trace: Object.freeze([...state.trace])
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Object.freeze({
            schemaVersion: 1,
            status: "failure",
            selectedTargetIds: Object.freeze([]),
            visitedNodeIds: Object.freeze([...visited]),
            trace: Object.freeze([...state.trace]),
            diagnostic: Object.freeze({
                code: /budget exceeded/i.test(message) ? "budget_exceeded"
                    : /expression|\$get|\$op|context path/i.test(message) ? "invalid_expression" : "invalid_tree",
                message
            })
        });
    }
}
