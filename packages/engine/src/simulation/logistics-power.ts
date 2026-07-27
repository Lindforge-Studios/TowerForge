import type {
  LogisticsPowerDefinitionV1,
  LogisticsGeneratorDefinitionV1,
  LogisticsRelayDefinitionV1
} from "../content/logistics-mechanics.js";
import type { GridMap } from "./map.js";
import type {
  LogisticsPowerComponentSnapshotV1,
  LogisticsPowerConsumerSnapshotV1,
  LogisticsPowerNodeSnapshotV1,
  LogisticsSnapshotV1,
  TowerState,
  TowerType
} from "./types.js";
import { LOGISTICS_POWER_LIMITS } from "../content/logistics-mechanics.js";

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface LogisticsPowerTopologyCountsV1 {
  readonly participants: number;
  readonly nodes: number;
  readonly undirectedEdges: number;
}

type PowerTower = Pick<TowerState, "id" | "typeId" | "coord" | "hp">;
type PowerDistance = Pick<GridMap, "distance">;

/** A destructible tower at zero HP is retained only for checkpoint fidelity, never as live power topology. */
export function isLiveLogisticsPowerTower(tower: Pick<TowerState, "hp">): boolean {
  return tower.hp === undefined || tower.hp > 0;
}

function powerRole(
  power: LogisticsPowerDefinitionV1,
  towerTypeId: string
): "generator" | "relay" | "consumer" | undefined {
  if (Object.prototype.hasOwnProperty.call(power.generators, towerTypeId)) return "generator";
  if (Object.prototype.hasOwnProperty.call(power.relays, towerTypeId)) return "relay";
  if (Object.prototype.hasOwnProperty.call(power.consumers, towerTypeId)) return "consumer";
  return undefined;
}

function powerNodesLink(
  power: LogisticsPowerDefinitionV1,
  towerTypes: Readonly<Record<string, TowerType>>,
  map: PowerDistance,
  left: PowerTower,
  right: PowerTower
): boolean {
  if (!isLiveLogisticsPowerTower(left) || !isLiveLogisticsPowerTower(right)) return false;
  const leftDefinition = power.generators[left.typeId] ?? power.relays[left.typeId];
  const rightDefinition = power.generators[right.typeId] ?? power.relays[right.typeId];
  const leftType = towerTypes[left.typeId];
  const rightType = towerTypes[right.typeId];
  if (!leftDefinition || !rightDefinition || !leftType || !rightType) return false;
  const distance = Math.max(
    0,
    map.distance(left.coord, right.coord) - leftType.footprintRadius - rightType.footprintRadius
  );
  return distance <= leftDefinition.linkRadius && distance <= rightDefinition.linkRadius;
}

function assertTopologyCounts(counts: LogisticsPowerTopologyCountsV1): void {
  if (counts.participants > LOGISTICS_POWER_LIMITS.liveParticipants) {
    throw new Error(
      `Logistics power participant limit ${LOGISTICS_POWER_LIMITS.liveParticipants} exceeded.`
    );
  }
  if (counts.nodes > LOGISTICS_POWER_LIMITS.liveNodes) {
    throw new Error(`Logistics power node limit ${LOGISTICS_POWER_LIMITS.liveNodes} exceeded.`);
  }
  if (counts.undirectedEdges > LOGISTICS_POWER_LIMITS.undirectedEdges) {
    throw new Error(
      `Logistics power edge limit ${LOGISTICS_POWER_LIMITS.undirectedEdges} exceeded.`
    );
  }
}

/** Count and bound a complete candidate topology before links or coverage are materialized. */
export function preflightLogisticsPowerTopologyV1(
  power: LogisticsPowerDefinitionV1,
  towers: readonly PowerTower[],
  towerTypes: Readonly<Record<string, TowerType>>,
  map: PowerDistance
): LogisticsPowerTopologyCountsV1 {
  const nodes: PowerTower[] = [];
  let participants = 0;
  for (const tower of towers) {
    if (!isLiveLogisticsPowerTower(tower)) continue;
    const role = powerRole(power, tower.typeId);
    if (!role) continue;
    participants += 1;
    assertTopologyCounts({ participants, nodes: nodes.length, undirectedEdges: 0 });
    if (role === "generator" || role === "relay") {
      nodes.push(tower);
      assertTopologyCounts({ participants, nodes: nodes.length, undirectedEdges: 0 });
    }
  }
  let undirectedEdges = 0;
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      if (!powerNodesLink(power, towerTypes, map, nodes[leftIndex]!, nodes[rightIndex]!)) continue;
      undirectedEdges += 1;
      assertTopologyCounts({ participants, nodes: nodes.length, undirectedEdges });
    }
  }
  return Object.freeze({ participants, nodes: nodes.length, undirectedEdges });
}

/** Bound one placement using an already valid live topology in O(live nodes). */
export function preflightLogisticsPowerPlacementV1(
  power: LogisticsPowerDefinitionV1,
  towers: readonly PowerTower[],
  towerTypes: Readonly<Record<string, TowerType>>,
  map: PowerDistance,
  current: LogisticsPowerTopologyCountsV1,
  candidate: PowerTower
): LogisticsPowerTopologyCountsV1 {
  const role = powerRole(power, candidate.typeId);
  if (!isLiveLogisticsPowerTower(candidate)) return current;
  if (!role) return current;
  const node = role === "generator" || role === "relay";
  assertTopologyCounts({
    participants: current.participants + 1,
    nodes: current.nodes + Number(node),
    undirectedEdges: current.undirectedEdges
  });
  let addedEdges = 0;
  if (node) {
    for (const tower of towers) {
      if (!isLiveLogisticsPowerTower(tower)) continue;
      const towerRole = powerRole(power, tower.typeId);
      if ((towerRole === "generator" || towerRole === "relay")
        && powerNodesLink(power, towerTypes, map, tower, candidate)) addedEdges += 1;
    }
  }
  const counts = Object.freeze({
    participants: current.participants + 1,
    nodes: current.nodes + Number(node),
    undirectedEdges: current.undirectedEdges + addedEdges
  });
  assertTopologyCounts(counts);
  return counts;
}

/** Derive bounded counters after removing one participant, without rebuilding the graph. */
export function preflightLogisticsPowerRemovalV1(
  power: LogisticsPowerDefinitionV1,
  towers: readonly PowerTower[],
  towerTypes: Readonly<Record<string, TowerType>>,
  map: PowerDistance,
  current: LogisticsPowerTopologyCountsV1,
  towerId: string
): LogisticsPowerTopologyCountsV1 {
  const removed = towers.find((tower) => tower.id === towerId);
  if (removed && !isLiveLogisticsPowerTower(removed)) return current;
  const role = removed && powerRole(power, removed.typeId);
  if (!removed || !role) return current;
  const node = role === "generator" || role === "relay";
  let removedEdges = 0;
  if (node) {
    for (const tower of towers) {
      if (tower.id === towerId) continue;
      if (!isLiveLogisticsPowerTower(tower)) continue;
      const towerRole = powerRole(power, tower.typeId);
      if ((towerRole === "generator" || towerRole === "relay")
        && powerNodesLink(power, towerTypes, map, removed, tower)) removedEdges += 1;
    }
  }
  const counts = Object.freeze({
    participants: current.participants - 1,
    nodes: current.nodes - Number(node),
    undirectedEdges: current.undirectedEdges - removedEdges
  });
  if (counts.participants < 0 || counts.nodes < 0 || counts.undirectedEdges < 0) {
    throw new Error("Logistics power topology counters are incoherent.");
  }
  assertTopologyCounts(counts);
  return counts;
}

/** Bound one node movement using an already valid live topology in O(live nodes). */
export function preflightLogisticsPowerMoveV1(
  power: LogisticsPowerDefinitionV1,
  towers: readonly PowerTower[],
  towerTypes: Readonly<Record<string, TowerType>>,
  map: PowerDistance,
  current: LogisticsPowerTopologyCountsV1,
  towerId: string,
  candidateCoord: TowerState["coord"]
): LogisticsPowerTopologyCountsV1 {
  const moving = towers.find((tower) => tower.id === towerId);
  if (moving && !isLiveLogisticsPowerTower(moving)) return current;
  const role = moving && powerRole(power, moving.typeId);
  if (!moving || (role !== "generator" && role !== "relay")) return current;
  let oldEdges = 0;
  let newEdges = 0;
  const candidate = { ...moving, coord: candidateCoord };
  for (const tower of towers) {
    if (tower.id === towerId) continue;
    if (!isLiveLogisticsPowerTower(tower)) continue;
    const towerRole = powerRole(power, tower.typeId);
    if (towerRole !== "generator" && towerRole !== "relay") continue;
    if (powerNodesLink(power, towerTypes, map, moving, tower)) oldEdges += 1;
    if (powerNodesLink(power, towerTypes, map, candidate, tower)) newEdges += 1;
  }
  const counts = Object.freeze({
    participants: current.participants,
    nodes: current.nodes,
    undirectedEdges: current.undirectedEdges - oldEdges + newEdges
  });
  assertTopologyCounts(counts);
  return counts;
}

interface GeneratorNodeRuntime {
  readonly tower: TowerState;
  readonly type: TowerType;
  readonly role: "generator";
  readonly definition: LogisticsGeneratorDefinitionV1;
  readonly links: Set<string>;
}

interface RelayNodeRuntime {
  readonly tower: TowerState;
  readonly type: TowerType;
  readonly role: "relay";
  readonly definition: LogisticsRelayDefinitionV1;
  readonly links: Set<string>;
}

type NodeRuntime = GeneratorNodeRuntime | RelayNodeRuntime;

function footprintEdgeDistance(map: GridMap, left: NodeRuntime | { tower: TowerState; type: TowerType }, right: NodeRuntime | { tower: TowerState; type: TowerType }): number {
  return Math.max(
    0,
    map.distance(left.tower.coord, right.tower.coord) - left.type.footprintRadius - right.type.footprintRadius
  );
}

function freezeSnapshot(snapshot: LogisticsSnapshotV1): LogisticsSnapshotV1 {
  const components = Object.freeze(snapshot.power.components.map((component) => Object.freeze({
    ...component,
    nodeIds: Object.freeze([...component.nodeIds]),
    consumerIds: Object.freeze([...component.consumerIds])
  })));
  const nodes = Object.freeze(snapshot.power.nodes.map((node) => Object.freeze({
    ...node,
    linkTowerIds: Object.freeze([...node.linkTowerIds]),
    coveredConsumerIds: Object.freeze([...node.coveredConsumerIds])
  })));
  const consumers = Object.freeze(snapshot.power.consumers.map((consumer) => Object.freeze({ ...consumer })));
  return Object.freeze({
    schemaVersion: 1,
    power: Object.freeze({ components, nodes, consumers })
  });
}

/** Build the authoritative deterministic power graph from live towers. */
export function buildLogisticsPowerSnapshotV1(
  power: LogisticsPowerDefinitionV1,
  towers: readonly TowerState[],
  towerTypes: Readonly<Record<string, TowerType>>,
  map: GridMap
): LogisticsSnapshotV1 {
  const nodes: NodeRuntime[] = [];
  const consumers: Array<{
    tower: TowerState;
    type: TowerType;
    demand: number;
    priority: number;
  }> = [];
  let participantCount = 0;
  for (const tower of [...towers].sort((left, right) => compareBinary(left.id, right.id))) {
    if (!isLiveLogisticsPowerTower(tower)) continue;
    const type = towerTypes[tower.typeId];
    if (!type) continue;
    const generator = power.generators[tower.typeId];
    const relay = power.relays[tower.typeId];
    const consumer = power.consumers[tower.typeId];
    if (!generator && !relay && !consumer) continue;
    participantCount += 1;
    assertTopologyCounts({
      participants: participantCount,
      nodes: nodes.length + Number(Boolean(generator || relay)),
      undirectedEdges: 0
    });
    if (generator) nodes.push({ tower, type, role: "generator", definition: generator, links: new Set() });
    else if (relay) nodes.push({ tower, type, role: "relay", definition: relay, links: new Set() });
    else consumers.push({ tower, type, demand: consumer!.demand, priority: consumer!.priority });
  }

  const nodeById = new Map(nodes.map((node) => [node.tower.id, node]));
  let undirectedEdgeCount = 0;
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex]!;
      const distance = footprintEdgeDistance(map, left, right);
      if (distance > left.definition.linkRadius || distance > right.definition.linkRadius) continue;
      undirectedEdgeCount += 1;
      assertTopologyCounts({
        participants: participantCount,
        nodes: nodes.length,
        undirectedEdges: undirectedEdgeCount
      });
      left.links.add(right.tower.id);
      right.links.add(left.tower.id);
    }
  }

  const componentByNodeId = new Map<string, string>();
  const componentNodeIds = new Map<string, string[]>();
  for (const start of nodes) {
    if (componentByNodeId.has(start.tower.id)) continue;
    const queue = [start.tower.id];
    const memberIds: string[] = [];
    componentByNodeId.set(start.tower.id, start.tower.id);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor]!;
      memberIds.push(id);
      const node = nodeById.get(id)!;
      for (const linkedId of [...node.links].sort(compareBinary)) {
        if (componentByNodeId.has(linkedId)) continue;
        componentByNodeId.set(linkedId, start.tower.id);
        queue.push(linkedId);
      }
    }
    memberIds.sort(compareBinary);
    const componentId = memberIds[0]!;
    for (const id of memberIds) componentByNodeId.set(id, componentId);
    componentNodeIds.set(componentId, memberIds);
  }

  const attached = consumers.map((consumer) => {
    let selected: NodeRuntime | undefined;
    let selectedDistance = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
      const distance = footprintEdgeDistance(map, consumer, node);
      if (distance > node.definition.coverageRadius) continue;
      if (!selected || distance < selectedDistance
        || (distance === selectedDistance && compareBinary(node.tower.id, selected.tower.id) < 0)) {
        selected = node;
        selectedDistance = distance;
      }
    }
    return {
      ...consumer,
      nodeId: selected?.tower.id ?? null,
      componentId: selected ? componentByNodeId.get(selected.tower.id)! : null,
      powered: false
    };
  });

  const attachedByComponent = new Map<string, typeof attached>();
  for (const consumer of attached) {
    if (consumer.componentId === null) continue;
    const entries = attachedByComponent.get(consumer.componentId) ?? [];
    entries.push(consumer);
    attachedByComponent.set(consumer.componentId, entries);
  }

  const componentSnapshots: LogisticsPowerComponentSnapshotV1[] = [];
  for (const [componentId, nodeIds] of [...componentNodeIds].sort(([left], [right]) => compareBinary(left, right))) {
    const output = nodeIds.reduce((sum, nodeId) => {
      const node = nodeById.get(nodeId)!;
      return sum + (node.role === "generator" ? node.definition.output : 0);
    }, 0);
    const componentConsumers = attachedByComponent.get(componentId) ?? [];
    const allocationOrder = [...componentConsumers].sort((left, right) => (
      left.priority - right.priority || compareBinary(left.tower.id, right.tower.id)
    ));
    let remaining = output;
    let allocated = 0;
    let brownout = false;
    for (const consumer of allocationOrder) {
      if (brownout || consumer.demand > remaining) {
        brownout = true;
        continue;
      }
      consumer.powered = true;
      remaining -= consumer.demand;
      allocated += consumer.demand;
    }
    componentSnapshots.push({
      id: componentId,
      output,
      demand: componentConsumers.reduce((sum, consumer) => sum + consumer.demand, 0),
      allocated,
      nodeIds: [...nodeIds],
      consumerIds: componentConsumers.map((consumer) => consumer.tower.id).sort(compareBinary)
    });
  }

  const nodeSnapshots: LogisticsPowerNodeSnapshotV1[] = nodes.map((node) => ({
    towerId: node.tower.id,
    towerTypeId: node.tower.typeId,
    role: node.role,
    componentId: componentByNodeId.get(node.tower.id)!,
    output: node.role === "generator" ? node.definition.output : 0,
    linkTowerIds: [...node.links].sort(compareBinary),
    coveredConsumerIds: attached
      .filter((consumer) => consumer.nodeId === node.tower.id)
      .map((consumer) => consumer.tower.id)
      .sort(compareBinary)
  }));
  const consumerSnapshots: LogisticsPowerConsumerSnapshotV1[] = attached
    .sort((left, right) => compareBinary(left.tower.id, right.tower.id))
    .map((consumer) => ({
      towerId: consumer.tower.id,
      towerTypeId: consumer.tower.typeId,
      demand: consumer.demand,
      priority: consumer.priority,
      nodeId: consumer.nodeId,
      componentId: consumer.componentId,
      powered: consumer.powered
    }));
  return freezeSnapshot({
    schemaVersion: 1,
    power: { components: componentSnapshots, nodes: nodeSnapshots, consumers: consumerSnapshots }
  });
}

/** Return a detached frozen projection so snapshot consumers cannot mutate the derived cache. */
export function cloneLogisticsPowerSnapshotV1(snapshot: LogisticsSnapshotV1): LogisticsSnapshotV1 {
  return freezeSnapshot(snapshot);
}
