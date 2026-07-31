import { TOWER_SCRIPT_ACTION_SCHEMA } from "./schema-descriptor.js";
import { canonicalStringify } from "../simulation/stable-digest.js";
export const TOWER_SCRIPT_GRAPH_SCHEMA_VERSION = 2;
function clone(value) {
    return JSON.parse(canonicalStringify(value, {
        maxDepth: 64,
        maxNodes: 100_000,
        maxBytes: 2 * 1024 * 1024
    }));
}
function escapePointer(value) {
    return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
function unescapePointer(value) {
    return value.replaceAll("~1", "/").replaceAll("~0", "~");
}
function legacyNodeId(path) {
    return path === "" ? "00:script" : `10:${path}`;
}
function stableId(prefix, ...parts) {
    return `${prefix}:${parts.map((part) => encodeURIComponent(part)).join(":")}`;
}
function edgeId(kind, from, to, order) {
    return `edge:${kind}:${from}:${String(order).padStart(6, "0")}:${to}`;
}
function compareBinary(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function behaviorKind(value) {
    if (!isRecord(value))
        return "raw";
    if (value.type === "selector")
        return "behavior_selector";
    if (value.type === "sequence")
        return "behavior_sequence";
    if (value.type === "condition")
        return "behavior_condition";
    if (value.type === "action")
        return "behavior_action";
    return "raw";
}
export function towerScriptAstToGraph(source) {
    const root = clone(source);
    if (!isRecord(root) || typeof root.id !== "string" || root.id.length === 0) {
        throw new Error("TowerScript graph source needs a non-empty script id.");
    }
    const rootId = legacyNodeId("");
    const nodes = [{ id: rootId, kind: "script", astPath: "", raw: root }];
    const edges = [];
    const addNode = (kind, astPath, raw, parentId, order, id = legacyNodeId(astPath)) => {
        nodes.push({ id, kind, astPath, raw: clone(raw) });
        edges.push({ id: edgeId("containment", parentId, id, order), kind: "containment", from: parentId, to: id, order });
        return id;
    };
    const addActionList = (actions, basePath, parentId, orderOffset = 0) => {
        if (!Array.isArray(actions))
            return;
        actions.forEach((action, actionIndex) => {
            const actionPath = `${basePath}/${actionIndex}`;
            const name = isRecord(action) && typeof action.action === "string" ? action.action : "";
            addNode(Object.hasOwn(TOWER_SCRIPT_ACTION_SCHEMA, name) ? "action" : "raw", actionPath, action, parentId, orderOffset + actionIndex);
        });
    };
    if (Array.isArray(root.bindings)) {
        root.bindings.forEach((binding, index) => addNode("binding", `/bindings/${index}`, binding, rootId, index));
    }
    if (isRecord(root.handlers)) {
        for (const eventName of Object.keys(root.handlers).sort(compareBinary)) {
            const handlers = root.handlers[eventName];
            if (!Array.isArray(handlers))
                continue;
            handlers.forEach((handler, handlerIndex) => {
                if (!isRecord(handler))
                    return;
                const handlerPath = `/handlers/${escapePointer(eventName)}/${handlerIndex}`;
                const handlerId = addNode("handler", handlerPath, handler, rootId, handlerIndex);
                if (Object.hasOwn(handler, "when"))
                    addNode("condition", `${handlerPath}/when`, handler.when, handlerId, 0);
                addActionList(handler.actions, `${handlerPath}/actions`, handlerId, 1);
            });
        }
    }
    const addBehaviorNode = (node, path, parentId, order, treeId) => {
        const authoredId = isRecord(node) && typeof node.id === "string" ? node.id : path;
        const kind = behaviorKind(node);
        const id = addNode(kind, path, node, parentId, order, stableId("bt", treeId, authoredId));
        if (kind === "behavior_selector" || kind === "behavior_sequence") {
            const children = isRecord(node) ? node.children : undefined;
            if (Array.isArray(children))
                children.forEach((child, index) => addBehaviorNode(child, `${path}/children/${index}`, id, index, treeId));
        }
    };
    if (Array.isArray(root.behaviorTrees))
        root.behaviorTrees.forEach((tree, treeIndex) => {
            if (!isRecord(tree))
                return;
            const treeIdValue = typeof tree.id === "string" ? tree.id : String(treeIndex);
            const path = `/behaviorTrees/${treeIndex}`;
            const treeId = addNode("behavior_tree", path, tree, rootId, treeIndex, stableId("bt", treeIdValue));
            if (Array.isArray(tree.bindings))
                tree.bindings.forEach((binding, bindingIndex) => addNode("binding", `${path}/bindings/${bindingIndex}`, binding, treeId, bindingIndex, stableId("bt", treeIdValue, "binding", String(bindingIndex))));
            if (Object.hasOwn(tree, "root"))
                addBehaviorNode(tree.root, `${path}/root`, treeId, 1_000, treeIdValue);
        });
    const stateNodesByPath = new Map();
    const transitionTargets = [];
    const addState = (state, path, parentId, order, machineId, absoluteParent) => {
        if (!isRecord(state)) {
            addNode("raw", path, state, parentId, order);
            return;
        }
        const stateName = typeof state.id === "string" ? state.id : String(order);
        const absolutePath = `${absoluteParent}/${stateName}`;
        const id = addNode("state", path, state, parentId, order, stableId("hfsm", machineId, "state", absolutePath));
        stateNodesByPath.set(`${machineId}:${absolutePath}`, id);
        addActionList(state.entryActions, `${path}/entryActions`, id, 100);
        addActionList(state.exitActions, `${path}/exitActions`, id, 200);
        if (Array.isArray(state.transitions))
            state.transitions.forEach((transition, transitionIndex) => {
                const transitionPath = `${path}/transitions/${transitionIndex}`;
                const transitionName = isRecord(transition) && typeof transition.id === "string"
                    ? transition.id
                    : String(transitionIndex);
                const transitionId = addNode("transition", transitionPath, transition, id, 300 + transitionIndex, stableId("hfsm", machineId, "transition", transitionName));
                if (isRecord(transition) && typeof transition.target === "string") {
                    transitionTargets.push({ transitionNodeId: transitionId, targetPath: `${machineId}:${transition.target}` });
                }
                if (isRecord(transition))
                    addActionList(transition.actions, `${transitionPath}/actions`, transitionId);
            });
        if (Array.isArray(state.states))
            state.states.forEach((child, childIndex) => addState(child, `${path}/states/${childIndex}`, id, 400 + childIndex, machineId, absolutePath));
    };
    if (Array.isArray(root.stateMachines))
        root.stateMachines.forEach((machine, machineIndex) => {
            if (!isRecord(machine))
                return;
            const machineName = typeof machine.id === "string" ? machine.id : String(machineIndex);
            const path = `/stateMachines/${machineIndex}`;
            const machineId = addNode("state_machine", path, machine, rootId, machineIndex, stableId("hfsm", machineName));
            if (Array.isArray(machine.bindings))
                machine.bindings.forEach((binding, bindingIndex) => addNode("binding", `${path}/bindings/${bindingIndex}`, binding, machineId, bindingIndex, stableId("hfsm", machineName, "binding", String(bindingIndex))));
            if (Array.isArray(machine.states))
                machine.states.forEach((state, stateIndex) => addState(state, `${path}/states/${stateIndex}`, machineId, stateIndex, machineName, ""));
        });
    for (const [order, target] of transitionTargets.entries()) {
        const targetId = stateNodesByPath.get(target.targetPath);
        if (!targetId)
            continue;
        edges.push({
            id: edgeId("transition_target", target.transitionNodeId, targetId, order),
            kind: "transition_target",
            from: target.transitionNodeId,
            to: targetId,
            order
        });
    }
    nodes.sort((left, right) => compareBinary(left.id, right.id));
    edges.sort((left, right) => compareBinary(left.id, right.id));
    return clone({ schemaVersion: TOWER_SCRIPT_GRAPH_SCHEMA_VERSION, scriptId: root.id, nodes, edges });
}
function validateGraph(graph) {
    if (!isRecord(graph) || (graph.schemaVersion !== 1 && graph.schemaVersion !== 2)) {
        throw new Error("Unsupported TowerScript graph schema version.");
    }
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
        throw new Error("TowerScript graph needs node and edge arrays.");
    const ids = new Set();
    const astPaths = new Set();
    const nodeById = new Map();
    const allowedKinds = new Set([
        "script", "binding", "handler", "condition", "action", "raw", "behavior_tree", "behavior_selector",
        "behavior_sequence", "behavior_condition", "behavior_action", "state_machine", "state", "transition"
    ]);
    for (const node of graph.nodes) {
        if (!isRecord(node) || typeof node.id !== "string" || typeof node.astPath !== "string")
            throw new Error("TowerScript graph node is invalid.");
        if (typeof node.kind !== "string" || !allowedKinds.has(node.kind)) {
            throw new Error(`TowerScript graph node "${node.id}" has an unsupported kind.`);
        }
        if (graph.schemaVersion === 1 && !["script", "binding", "handler", "condition", "action", "raw"].includes(node.kind)) {
            throw new Error(`TowerScript graph v1 node "${node.id}" has an unsupported kind.`);
        }
        if (ids.has(node.id))
            throw new Error(`TowerScript graph contains duplicate node id "${node.id}".`);
        if (astPaths.has(node.astPath))
            throw new Error(`TowerScript graph contains duplicate AST path "${node.astPath}".`);
        if (graph.schemaVersion === 1 && node.id !== legacyNodeId(node.astPath)) {
            throw new Error(`TowerScript graph node "${node.id}" does not match its AST path.`);
        }
        ids.add(node.id);
        astPaths.add(node.astPath);
        nodeById.set(node.id, node);
    }
    const edgeIds = new Set();
    const containmentEdges = [];
    const transitionEdges = [];
    for (const edge of graph.edges) {
        if (!isRecord(edge) || typeof edge.id !== "string" || typeof edge.from !== "string" || typeof edge.to !== "string"
            || !Number.isInteger(edge.order))
            throw new Error("TowerScript graph edge is invalid.");
        if (edgeIds.has(edge.id))
            throw new Error(`TowerScript graph contains duplicate edge id "${edge.id}".`);
        edgeIds.add(edge.id);
        if (!ids.has(edge.from) || !ids.has(edge.to))
            throw new Error(`TowerScript graph edge "${edge.id}" has a missing endpoint.`);
        if (graph.schemaVersion === 2 && edge.kind !== "containment" && edge.kind !== "transition_target") {
            throw new Error(`TowerScript graph edge "${edge.id}" has an unsupported kind.`);
        }
        if (graph.schemaVersion === 2 && edge.kind === "transition_target") {
            transitionEdges.push(edge);
        }
        else
            containmentEdges.push(edge);
    }
    const root = graph.nodes.find((node) => node.astPath === "" && node.kind === "script");
    if (!root)
        throw new Error("TowerScript graph is missing its script root node.");
    if (containmentEdges.length !== graph.nodes.length - 1) {
        throw new Error("TowerScript graph must contain one containment edge per non-root node.");
    }
    for (const node of graph.nodes) {
        const incoming = containmentEdges.filter((edge) => edge.to === node.id);
        if (node === root ? incoming.length !== 0 : incoming.length !== 1) {
            throw new Error(`TowerScript graph node "${node.id}" has an invalid containment parent.`);
        }
    }
    const visited = new Set();
    const visit = (id) => {
        if (visited.has(id))
            return;
        visited.add(id);
        for (const edge of containmentEdges.filter((candidate) => candidate.from === id))
            visit(edge.to);
    };
    visit(root.id);
    if (visited.size !== graph.nodes.length)
        throw new Error("TowerScript graph containment has a cycle or unreachable node.");
    for (const edge of transitionEdges) {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        if (from?.kind !== "transition" || to?.kind !== "state" || !isRecord(from.raw) || typeof from.raw.target !== "string") {
            throw new Error(`TowerScript graph transition edge "${edge.id}" is invalid.`);
        }
        const stateRaw = to.raw;
        if (!isRecord(stateRaw) || typeof stateRaw.id !== "string" || !to.astPath.includes("/states/")) {
            throw new Error(`TowerScript graph transition edge "${edge.id}" has an invalid target state.`);
        }
        const machinePath = from.astPath.slice(0, from.astPath.indexOf("/states/"));
        const targetNode = [...nodeById.values()].find((node) => node.kind === "state"
            && node.astPath.startsWith(`${machinePath}/states/`)
            && node.id === edge.to);
        if (!targetNode)
            throw new Error(`TowerScript graph transition edge "${edge.id}" target is outside its machine.`);
        const stateNames = [...nodeById.values()]
            .filter((node) => node.kind === "state"
            && node.astPath.startsWith(`${machinePath}/states/`)
            && (targetNode.astPath === node.astPath || targetNode.astPath.startsWith(`${node.astPath}/states/`)))
            .sort((left, right) => left.astPath.length - right.astPath.length)
            .map((node) => isRecord(node.raw) && typeof node.raw.id === "string" ? node.raw.id : "");
        if (`/${stateNames.join("/")}` !== from.raw.target) {
            throw new Error(`TowerScript graph transition edge "${edge.id}" does not match its authored target.`);
        }
    }
    if (graph.schemaVersion === 2) {
        for (const node of graph.nodes) {
            if (node.kind !== "transition" || !isRecord(node.raw) || typeof node.raw.target !== "string")
                continue;
            if (transitionEdges.filter((edge) => edge.from === node.id).length !== 1) {
                throw new Error(`TowerScript graph transition node "${node.id}" needs one target edge.`);
            }
        }
    }
}
function setPointer(root, pointer, value) {
    if (!pointer.startsWith("/"))
        throw new Error(`Invalid TowerScript graph AST path "${pointer}".`);
    const parts = pointer.slice(1).split("/").map(unescapePointer);
    let parent = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const token = parts[index];
        if (Array.isArray(parent)) {
            const arrayIndex = Number(token);
            if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= parent.length)
                throw new Error(`TowerScript graph path "${pointer}" is dangling.`);
            parent = parent[arrayIndex];
        }
        else if (isRecord(parent) && Object.hasOwn(parent, token))
            parent = parent[token];
        else
            throw new Error(`TowerScript graph path "${pointer}" is dangling.`);
    }
    const last = parts.at(-1);
    if (Array.isArray(parent)) {
        const arrayIndex = Number(last);
        if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= parent.length)
            throw new Error(`TowerScript graph path "${pointer}" is dangling.`);
        parent[arrayIndex] = clone(value);
    }
    else if (isRecord(parent) && Object.hasOwn(parent, last))
        parent[last] = clone(value);
    else
        throw new Error(`TowerScript graph path "${pointer}" is dangling.`);
}
export function towerScriptGraphToAst(graph) {
    const safeGraph = clone(graph);
    validateGraph(safeGraph);
    const root = safeGraph.nodes.find((node) => node.astPath === "" && node.kind === "script");
    if (!isRecord(root.raw))
        throw new Error("TowerScript graph script root must contain an object AST.");
    const ast = clone(root.raw);
    const children = safeGraph.nodes.filter((node) => node.astPath !== "").sort((left, right) => {
        const depth = left.astPath.split("/").length - right.astPath.split("/").length;
        return depth || compareBinary(left.astPath, right.astPath);
    });
    for (const node of children)
        setPointer(ast, node.astPath, node.raw);
    if (typeof ast.id !== "string" || ast.id !== safeGraph.scriptId)
        throw new Error("TowerScript graph script id does not match its AST.");
    return clone(ast);
}
export function createTowerScriptNodeCatalog(descriptor) {
    if (!isRecord(descriptor) || !Array.isArray(descriptor.events) || !Array.isArray(descriptor.scopes)
        || !isRecord(descriptor.actions) || !isRecord(descriptor.expression) || !Array.isArray(descriptor.expression.operators)) {
        throw new Error("TowerScript descriptor is invalid.");
    }
    const entries = (names) => names.map((name) => ({ name }));
    const actionDescriptors = descriptor.actions;
    const completion = isRecord(descriptor.completion) ? descriptor.completion : undefined;
    const completionCatalog = isRecord(completion?.catalog) ? completion.catalog : undefined;
    const eventEntries = Array.isArray(completionCatalog?.events)
        ? completionCatalog.events
        : entries(descriptor.events);
    return clone({
        schemaVersion: 2,
        towerScriptSchemaVersion: descriptor.schemaVersion,
        graph: descriptor.graph,
        debug: descriptor.debug,
        controllers: {
            handlers: { schemaVersion: 1 },
            behaviorTrees: descriptor.behaviorTrees,
            stateMachines: descriptor.stateMachines
        },
        controllerRecipes: descriptor.controllerRecipes,
        nodeKinds: [
            "script", "binding", "handler", "condition", "action", "raw", "behavior_tree", "behavior_selector",
            "behavior_sequence", "behavior_condition", "behavior_action", "state_machine", "state", "transition"
        ],
        events: eventEntries,
        actions: Object.keys(actionDescriptors).sort(compareBinary).map((name) => ({ name, descriptor: actionDescriptors[name] })),
        operators: entries(descriptor.expression.operators),
        scopes: entries(descriptor.scopes)
    });
}
