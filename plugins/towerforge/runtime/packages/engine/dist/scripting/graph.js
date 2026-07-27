import { TOWER_SCRIPT_ACTION_SCHEMA } from "./schema-descriptor.js";
import { canonicalStringify } from "../simulation/stable-digest.js";
export const TOWER_SCRIPT_GRAPH_SCHEMA_VERSION = 1;
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
function nodeId(path) {
    return path === "" ? "00:script" : `10:${path}`;
}
function edgeId(from, to, order) {
    return `edge:${from}:${String(order).padStart(6, "0")}:${to}`;
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function pathParent(path) {
    const index = path.lastIndexOf("/");
    return index <= 0 ? "" : path.slice(0, index);
}
export function towerScriptAstToGraph(source) {
    const root = clone(source);
    if (!isRecord(root) || typeof root.id !== "string" || root.id.length === 0) {
        throw new Error("TowerScript graph source needs a non-empty script id.");
    }
    const nodes = [{ id: nodeId(""), kind: "script", astPath: "", raw: root }];
    const edges = [];
    const addNode = (kind, astPath, raw, parentPath, order) => {
        const id = nodeId(astPath);
        const parent = nodeId(parentPath);
        nodes.push({ id, kind, astPath, raw: clone(raw) });
        edges.push({ id: edgeId(parent, id, order), from: parent, to: id, order });
    };
    if (Array.isArray(root.bindings)) {
        root.bindings.forEach((binding, index) => addNode("binding", `/bindings/${index}`, binding, "", index));
    }
    if (isRecord(root.handlers)) {
        for (const eventName of Object.keys(root.handlers).sort()) {
            const handlers = root.handlers[eventName];
            if (!Array.isArray(handlers))
                continue;
            handlers.forEach((handler, handlerIndex) => {
                if (!isRecord(handler))
                    return;
                const handlerPath = `/handlers/${escapePointer(eventName)}/${handlerIndex}`;
                addNode("handler", handlerPath, handler, "", handlerIndex);
                if (Object.hasOwn(handler, "when"))
                    addNode("condition", `${handlerPath}/when`, handler.when, handlerPath, 0);
                if (!Array.isArray(handler.actions))
                    return;
                handler.actions.forEach((action, actionIndex) => {
                    const actionPath = `${handlerPath}/actions/${actionIndex}`;
                    const name = isRecord(action) && typeof action.action === "string" ? action.action : "";
                    addNode(Object.hasOwn(TOWER_SCRIPT_ACTION_SCHEMA, name) ? "action" : "raw", actionPath, action, handlerPath, actionIndex + 1);
                });
            });
        }
    }
    nodes.sort((left, right) => left.id.localeCompare(right.id));
    edges.sort((left, right) => left.id.localeCompare(right.id));
    return clone({
        schemaVersion: TOWER_SCRIPT_GRAPH_SCHEMA_VERSION,
        scriptId: root.id,
        nodes,
        edges
    });
}
function validateGraph(graph) {
    if (!isRecord(graph) || graph.schemaVersion !== TOWER_SCRIPT_GRAPH_SCHEMA_VERSION) {
        throw new Error("Unsupported TowerScript graph schema version.");
    }
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
        throw new Error("TowerScript graph needs node and edge arrays.");
    const ids = new Set();
    const astPaths = new Set();
    for (const node of graph.nodes) {
        if (!isRecord(node) || typeof node.id !== "string" || typeof node.astPath !== "string")
            throw new Error("TowerScript graph node is invalid.");
        if (typeof node.kind !== "string"
            || !["script", "binding", "handler", "condition", "action", "raw"].includes(node.kind)) {
            throw new Error(`TowerScript graph node "${node.id}" has an unsupported kind.`);
        }
        if (ids.has(node.id))
            throw new Error(`TowerScript graph contains duplicate node id "${node.id}".`);
        if (astPaths.has(node.astPath))
            throw new Error(`TowerScript graph contains duplicate AST path "${node.astPath}".`);
        if (node.id !== nodeId(node.astPath))
            throw new Error(`TowerScript graph node "${node.id}" does not match its AST path.`);
        ids.add(node.id);
        astPaths.add(node.astPath);
    }
    const edgeIds = new Set();
    for (const edge of graph.edges) {
        if (!isRecord(edge) || typeof edge.id !== "string" || typeof edge.from !== "string" || typeof edge.to !== "string") {
            throw new Error("TowerScript graph edge is invalid.");
        }
        if (edgeIds.has(edge.id))
            throw new Error(`TowerScript graph contains duplicate edge id "${edge.id}".`);
        edgeIds.add(edge.id);
        if (!ids.has(edge.from) || !ids.has(edge.to))
            throw new Error(`TowerScript graph edge "${edge.id}" has a missing endpoint.`);
    }
    const root = graph.nodes.find((node) => node.astPath === "" && node.kind === "script");
    if (!root)
        throw new Error("TowerScript graph is missing its script root node.");
    if (graph.edges.length !== graph.nodes.length - 1)
        throw new Error("TowerScript graph must contain one parent edge per non-root node.");
    for (const node of graph.nodes) {
        if (node === root)
            continue;
        const actionMarker = node.astPath.lastIndexOf("/actions/");
        const directParent = node.kind === "condition"
            ? pathParent(node.astPath)
            : (node.kind === "action" || node.kind === "raw") && actionMarker > 0
                ? node.astPath.slice(0, actionMarker)
                : "";
        const expectedParent = astPaths.has(directParent) ? nodeId(directParent) : root.id;
        const incoming = graph.edges.filter((edge) => edge.to === node.id);
        if (incoming.length !== 1 || incoming[0].from !== expectedParent) {
            throw new Error(`TowerScript graph node "${node.id}" has an invalid parent edge.`);
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
        else if (isRecord(parent) && Object.hasOwn(parent, token)) {
            parent = parent[token];
        }
        else {
            throw new Error(`TowerScript graph path "${pointer}" is dangling.`);
        }
    }
    const last = parts.at(-1);
    if (Array.isArray(parent)) {
        const arrayIndex = Number(last);
        if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= parent.length)
            throw new Error(`TowerScript graph path "${pointer}" is dangling.`);
        parent[arrayIndex] = clone(value);
    }
    else if (isRecord(parent) && Object.hasOwn(parent, last)) {
        parent[last] = clone(value);
    }
    else {
        throw new Error(`TowerScript graph path "${pointer}" is dangling.`);
    }
}
export function towerScriptGraphToAst(graph) {
    const safeGraph = clone(graph);
    validateGraph(safeGraph);
    const root = safeGraph.nodes.find((node) => node.astPath === "" && node.kind === "script");
    if (!isRecord(root.raw))
        throw new Error("TowerScript graph script root must contain an object AST.");
    const ast = clone(root.raw);
    const children = safeGraph.nodes
        .filter((node) => node.astPath !== "")
        .sort((left, right) => {
        const depth = left.astPath.split("/").length - right.astPath.split("/").length;
        return depth || left.astPath.localeCompare(right.astPath);
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
    return clone({
        schemaVersion: 1,
        towerScriptSchemaVersion: descriptor.schemaVersion,
        events: entries(descriptor.events),
        actions: Object.keys(actionDescriptors).sort().map((name) => ({ name, descriptor: actionDescriptors[name] })),
        operators: entries(descriptor.expression.operators),
        scopes: entries(descriptor.scopes)
    });
}
