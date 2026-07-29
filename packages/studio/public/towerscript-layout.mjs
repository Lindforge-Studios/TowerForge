const ORIGIN = 24;
const COLUMN_STEP = 320;
const ROW_STEP = 318;
const NODE_WIDTH = 260;
const NODE_HEIGHT = 286;

function compareBinary(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finitePosition(value) {
  return value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y))
    ? { ...value, x: Number(value.x), y: Number(value.y) }
    : null;
}

function intersects(left, right) {
  return left.x < right.x + NODE_WIDTH && left.x + NODE_WIDTH > right.x
    && left.y < right.y + NODE_HEIGHT && left.y + NODE_HEIGHT > right.y;
}

/**
 * Computes deterministic Studio-only positions for a validated TowerScript graph.
 * Existing layout v1 positions remain authoritative; only missing nodes are placed.
 */
export function layoutTowerScriptGraph(graph, existingPositions = {}, preferredPositions = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const nodeById = new Map(nodes
    .filter((node) => node && typeof node.id === "string")
    .map((node) => [node.id, node]));
  const children = new Map();
  for (const edge of edges) {
    if (!edge || (graph?.schemaVersion === 2 && edge.kind !== "containment")) continue;
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    const entries = children.get(edge.from) ?? [];
    entries.push(edge);
    children.set(edge.from, entries);
  }
  for (const entries of children.values()) entries.sort((left, right) => {
    const order = Number(left.order) - Number(right.order);
    if (order) return order;
    const leftNode = nodeById.get(left.to);
    const rightNode = nodeById.get(right.to);
    return compareBinary(String(leftNode?.astPath ?? left.to), String(rightNode?.astPath ?? right.to));
  });

  const ordered = [];
  const depths = new Map();
  const visited = new Set();
  const visit = (nodeId, depth) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    depths.set(nodeId, depth);
    ordered.push(nodeId);
    for (const edge of children.get(nodeId) ?? []) visit(edge.to, depth + 1);
  };
  const roots = nodes
    .filter((node) => node?.astPath === "" || !edges.some((edge) => edge?.to === node?.id && (graph?.schemaVersion !== 2 || edge.kind === "containment")))
    .sort((left, right) => compareBinary(String(left?.astPath ?? left?.id), String(right?.astPath ?? right?.id)));
  for (const root of roots) visit(root.id, 0);
  for (const node of [...nodes].sort((left, right) => compareBinary(String(left?.astPath ?? left?.id), String(right?.astPath ?? right?.id)))) {
    visit(node.id, 0);
  }

  const result = {};
  const occupied = [];
  for (const nodeId of ordered) {
    const manual = finitePosition(Object.prototype.hasOwnProperty.call(existingPositions, nodeId)
      ? existingPositions[nodeId]
      : null);
    if (!manual) continue;
    result[nodeId] = manual;
    occupied.push(manual);
  }

  const rows = new Map();
  for (const nodeId of ordered) {
    const depth = depths.get(nodeId) ?? 0;
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    if (result[nodeId]) continue;
    const preferred = finitePosition(Object.prototype.hasOwnProperty.call(preferredPositions, nodeId)
      ? preferredPositions[nodeId]
      : null);
    const position = preferred ?? { x: ORIGIN + depth * COLUMN_STEP, y: ORIGIN + row * ROW_STEP };
    while (occupied.some((candidate) => intersects(position, candidate))) position.y += ROW_STEP;
    result[nodeId] = position;
    occupied.push(position);
  }
  return result;
}
