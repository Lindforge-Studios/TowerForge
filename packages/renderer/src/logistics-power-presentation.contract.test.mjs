import { describe, expect, it } from "vitest";
import { loadEngine } from "../../cli/lib/project-loader.mjs";
import * as Renderer from "./index.mjs";

function snapshot(overrides = {}) {
  return {
    logistics: {
      schemaVersion: 1,
      power: {
        components: [{
          id: "tower_generator",
          output: 8,
          demand: 16,
          allocated: 8,
          nodeIds: ["tower_generator", "tower_relay"],
          consumerIds: ["tower_arc_a", "tower_arc_b"]
        }],
        nodes: [
          {
            towerId: "tower_generator", towerTypeId: "power_plant", role: "generator",
            componentId: "tower_generator", output: 8,
            linkTowerIds: ["tower_relay"],
            coveredConsumerIds: ["tower_arc_a"]
          },
          {
            towerId: "tower_relay", towerTypeId: "power_pylon", role: "relay",
            componentId: "tower_generator", output: 0,
            linkTowerIds: ["tower_generator"],
            coveredConsumerIds: ["tower_arc_b"]
          }
        ],
        consumers: [
          {
            towerId: "tower_arc_a", towerTypeId: "arc_tower", demand: 8, priority: 10,
            nodeId: "tower_generator", componentId: "tower_generator", powered: true
          },
          {
            towerId: "tower_arc_b", towerTypeId: "arc_tower", demand: 8, priority: 20,
            nodeId: "tower_relay", componentId: "tower_generator", powered: false
          }
        ],
        ...overrides
      }
    }
  };
}

function projector() {
  expect(Renderer.projectLogisticsPresentation).toBeTypeOf("function");
  return Renderer.projectLogisticsPresentation;
}

function expectDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

function boundedSnapshot({
  nodeCount,
  consumerCount,
  edgeCount = 0,
  nodeOutput = 0,
  consumerDemand = 1,
  powered = false
}) {
  const nodeIds = Array.from({ length: nodeCount }, (_, index) => `node_${String(index).padStart(4, "0")}`);
  const consumerIds = Array.from(
    { length: consumerCount }, (_, index) => `consumer_${String(index).padStart(4, "0")}`
  );
  const linksByNodeId = new Map(nodeIds.map((towerId) => [towerId, []]));
  let remainingEdges = edgeCount;
  for (let left = 0; left < nodeIds.length && remainingEdges > 0; left += 1) {
    for (let right = left + 1; right < nodeIds.length && remainingEdges > 0; right += 1) {
      linksByNodeId.get(nodeIds[left]).push(nodeIds[right]);
      linksByNodeId.get(nodeIds[right]).push(nodeIds[left]);
      remainingEdges -= 1;
    }
  }
  expect(remainingEdges, "fixture needs enough node pairs for the requested edges").toBe(0);
  for (const links of linksByNodeId.values()) links.sort();
  const componentId = nodeIds[0] ?? "empty_component";
  return {
    schemaVersion: 1,
    power: {
      components: nodeCount === 0 ? [] : [{
        id: componentId,
        output: nodeCount * nodeOutput,
        demand: consumerCount * consumerDemand,
        allocated: powered ? consumerCount * consumerDemand : 0,
        nodeIds,
        consumerIds
      }],
      nodes: nodeIds.map((towerId, index) => ({
        towerId,
        towerTypeId: "relay",
        role: nodeOutput > 0 ? "generator" : "relay",
        componentId,
        output: nodeOutput,
        linkTowerIds: linksByNodeId.get(towerId),
        coveredConsumerIds: index === 0 ? consumerIds : []
      })),
      consumers: consumerIds.map((towerId) => ({
        towerId,
        towerTypeId: "consumer",
        demand: consumerDemand,
        priority: 0,
        nodeId: componentId,
        componentId,
        powered
      }))
    }
  };
}

describe("R5.7A shared authoritative logistics power presentation", () => {
  it("detaches and freezes exact components, node links, coverage, and brownout rows", () => {
    const source = snapshot();
    const projected = projector()(source);

    expect(projected).toEqual({ active: true, power: source.logistics.power });
    expectDeeplyFrozen(projected);
    source.logistics.power.components[0].output = 999;
    source.logistics.power.nodes[0].linkTowerIds.splice(0);
    source.logistics.power.consumers[0].powered = false;
    expect(projected.power.components[0].output).toBe(8);
    expect(projected.power.nodes[0].linkTowerIds).toEqual(["tower_relay"]);
    expect(projected.power.consumers[0].powered).toBe(true);
  });

  it("trusts authoritative links and allocation without importing content or deriving topology", () => {
    const projected = projector()(snapshot({
      components: [{
        id: "far_node", output: 1, demand: 1, allocated: 1,
        nodeIds: ["far_node"], consumerIds: ["far_consumer"]
      }],
      nodes: [{
        towerId: "far_node", towerTypeId: "generator", role: "generator",
        componentId: "far_node", output: 1,
        linkTowerIds: [], coveredConsumerIds: ["far_consumer"]
      }],
      consumers: [{
        towerId: "far_consumer", towerTypeId: "consumer", demand: 1, priority: 0,
        nodeId: "far_node", componentId: "far_node", powered: true
      }]
    }));

    expect(projected).toMatchObject({
      active: true,
      power: {
        nodes: [{ linkTowerIds: [], coveredConsumerIds: ["far_consumer"] }],
        consumers: [{ powered: true }]
      }
    });
    expect(Renderer.projectLogisticsPresentation.toString()).not.toMatch(
      /createGridTopology|topology\.distance|hexDistance|manhattanDistance|content\.mechanics|linkRadius|coverageRadius/
    );
  });

  it("projects an authoritative snapshot produced by the real engine power builder", async () => {
    const engine = await loadEngine();
    expect(engine.buildLogisticsPowerSnapshotV1).toBeTypeOf("function");
    const logistics = engine.buildLogisticsPowerSnapshotV1({
      generators: { generator: { output: 8, linkRadius: 2, coverageRadius: 2 } },
      relays: { relay: { linkRadius: 2, coverageRadius: 2 } },
      consumers: {
        priority_consumer: { demand: 8, priority: 1 },
        brownout_consumer: { demand: 8, priority: 2 }
      }
    }, [
      { id: "tower_1", typeId: "generator", coord: { q: 0, r: 0 } },
      { id: "tower_2", typeId: "relay", coord: { q: 1, r: 0 } },
      { id: "tower_3", typeId: "priority_consumer", coord: { q: 0, r: 1 } },
      { id: "tower_4", typeId: "brownout_consumer", coord: { q: 1, r: 1 } }
    ], {
      generator: { footprintRadius: 0 },
      relay: { footprintRadius: 0 },
      priority_consumer: { footprintRadius: 0 },
      brownout_consumer: { footprintRadius: 0 }
    }, {
      distance: (left, right) => Math.abs(left.q - right.q) + Math.abs(left.r - right.r)
    });

    expect(projector()({ logistics })).toEqual({ active: true, power: logistics.power });
  });

  it("accepts output, demand, and allocation at the 1024-node live aggregate bound", () => {
    const logistics = boundedSnapshot({
      nodeCount: 1_024,
      consumerCount: 1_024,
      edgeCount: 1_023,
      nodeOutput: 1_000_000_000_000,
      consumerDemand: 1_000_000_000_000,
      powered: true
    });
    expect(logistics.power.components[0]).toMatchObject({
      output: 1_024_000_000_000_000,
      demand: 1_024_000_000_000_000,
      allocated: 1_024_000_000_000_000
    });
    expect(projector()({ logistics })).toHaveProperty("active", true);
  });

  it("accepts engine-order fractional allocation that differs from binary tower order", () => {
    const demandInBinaryTowerOrder = [1_000_000_000_000, 0.2, 0.1]
      .reduce((sum, demand) => sum + demand, 0);
    const allocatedInPriorityOrder = [0.1, 0.2, 1_000_000_000_000]
      .reduce((sum, demand) => sum + demand, 0);
    expect(allocatedInPriorityOrder).not.toBe(demandInBinaryTowerOrder);

    const projected = projector()(snapshot({
      components: [{
        id: "tower_generator_a",
        output: 1_000_000_000_001,
        demand: demandInBinaryTowerOrder,
        allocated: allocatedInPriorityOrder,
        nodeIds: ["tower_generator_a", "tower_generator_b"],
        consumerIds: ["tower_a_big", "tower_m_fraction", "tower_z_fraction"]
      }],
      nodes: [
        {
          towerId: "tower_generator_a", towerTypeId: "generator_a", role: "generator",
          componentId: "tower_generator_a", output: 1_000_000_000_000,
          linkTowerIds: ["tower_generator_b"],
          coveredConsumerIds: ["tower_a_big", "tower_m_fraction", "tower_z_fraction"]
        },
        {
          towerId: "tower_generator_b", towerTypeId: "generator_b", role: "generator",
          componentId: "tower_generator_a", output: 1,
          linkTowerIds: ["tower_generator_a"], coveredConsumerIds: []
        }
      ],
      consumers: [
        {
          towerId: "tower_a_big", towerTypeId: "consumer_big", demand: 1_000_000_000_000,
          priority: 2, nodeId: "tower_generator_a", componentId: "tower_generator_a", powered: true
        },
        {
          towerId: "tower_m_fraction", towerTypeId: "consumer_fraction", demand: 0.2,
          priority: 1, nodeId: "tower_generator_a", componentId: "tower_generator_a", powered: true
        },
        {
          towerId: "tower_z_fraction", towerTypeId: "consumer_fraction", demand: 0.1,
          priority: 0, nodeId: "tower_generator_a", componentId: "tower_generator_a", powered: true
        }
      ]
    }));

    expect(projected).toMatchObject({
      active: true,
      power: {
        components: [{
          output: 1_000_000_000_001,
          demand: demandInBinaryTowerOrder,
          allocated: allocatedInPriorityOrder
        }],
        consumers: [
          { towerId: "tower_a_big", powered: true },
          { towerId: "tower_m_fraction", powered: true },
          { towerId: "tower_z_fraction", powered: true }
        ]
      }
    });
  });

  it("returns one frozen inactive value for absent/null inputs without reading unrelated fields", () => {
    let unrelatedReads = 0;
    const hostileNarrowRead = {};
    Object.defineProperty(hostileNarrowRead, "towers", {
      enumerable: true,
      get() { unrelatedReads += 1; throw new Error("must stay snapshot-logistics-only"); }
    });

    const first = projector()(hostileNarrowRead);
    const second = projector()({ logistics: undefined });
    expect(first).toEqual({ active: false, power: null });
    expect(second).toBe(first);
    expectDeeplyFrozen(first);
    expect(unrelatedReads).toBe(0);
  });

  it.each([
    {
      name: "a node row omitted from its component nodeIds",
      mutate(logistics) {
        logistics.power.components[0].nodeIds = ["tower_generator"];
      }
    },
    {
      name: "a consumer row omitted from its component consumerIds",
      mutate(logistics) {
        logistics.power.components[0].consumerIds = ["tower_arc_a"];
        logistics.power.components[0].demand = 8;
      }
    },
    {
      name: "an asymmetric node link",
      mutate(logistics) {
        logistics.power.nodes[1].linkTowerIds = [];
      }
    },
    {
      name: "a powered consumer after the first priority brownout",
      mutate(logistics) {
        logistics.power.consumers[0].priority = 0;
        logistics.power.consumers[0].powered = false;
        logistics.power.consumers[1].priority = 1;
        logistics.power.consumers[1].powered = true;
      }
    }
  ])("fails closed for $name even when component aggregates still match", ({ mutate }) => {
    const logistics = structuredClone(snapshot().logistics);
    mutate(logistics);
    expect(projector()({ logistics })).toEqual({ active: false, power: null });
  });

  it.each([
    {
      name: "a component ID that is not its binary-lowest node ID",
      mutate(logistics) {
        logistics.power.components[0].id = "zz_component";
        for (const node of logistics.power.nodes) node.componentId = "zz_component";
        for (const consumer of logistics.power.consumers) consumer.componentId = "zz_component";
      }
    },
    {
      name: "a zero-output generator and zero-output component",
      mutate(logistics) {
        logistics.power.components[0].output = 0;
        logistics.power.components[0].allocated = 0;
        logistics.power.nodes[0].output = 0;
        for (const consumer of logistics.power.consumers) consumer.powered = false;
      }
    },
    {
      name: "a premature brownout despite output 10 covering demand 8",
      mutate(logistics) {
        logistics.power.components[0].output = 10;
        logistics.power.components[0].demand = 8;
        logistics.power.components[0].allocated = 0;
        logistics.power.components[0].consumerIds = ["tower_arc_a"];
        logistics.power.nodes[0].output = 10;
        logistics.power.nodes[1].coveredConsumerIds = [];
        logistics.power.consumers = [{
          ...logistics.power.consumers[0],
          demand: 8,
          priority: 0,
          powered: false
        }];
      }
    }
  ])("Code Verifier P2 exact invariant: fails closed for $name", ({ mutate }) => {
    const logistics = structuredClone(snapshot().logistics);
    mutate(logistics);
    expect(projector()({ logistics })).toEqual({ active: false, power: null });
  });

  it("Code Verifier P2 disjoint node and consumer IDs: fails closed for one tower in both sets", () => {
    const logistics = {
      schemaVersion: 1,
      power: {
        components: [{
          id: "tower_x",
          output: 8,
          demand: 8,
          allocated: 8,
          nodeIds: ["tower_x"],
          consumerIds: ["tower_x"]
        }],
        nodes: [{
          towerId: "tower_x",
          towerTypeId: "power_plant",
          role: "generator",
          componentId: "tower_x",
          output: 8,
          linkTowerIds: [],
          coveredConsumerIds: ["tower_x"]
        }],
        consumers: [{
          towerId: "tower_x",
          towerTypeId: "arc_tower",
          demand: 8,
          priority: 0,
          nodeId: "tower_x",
          componentId: "tower_x",
          powered: true
        }]
      }
    };

    expect(projector()({ logistics })).toEqual({ active: false, power: null });
  });

  it("fails closed for future, malformed, unsorted, duplicate, impossible, and over-budget data", () => {
    const valid = snapshot().logistics.power;
    const sparseNodes = [...valid.nodes];
    delete sparseNodes[0];
    const invalid = [
      { schemaVersion: 4, power: valid, ammunition: null, supply: null, opaque: true },
      { ...snapshot().logistics, schemaVersion: 2 },
      { schemaVersion: 1 },
      { schemaVersion: 1, power: { ...valid, extra: true } },
      { schemaVersion: 1, power: { ...valid, nodes: sparseNodes } },
      { schemaVersion: 1, power: { ...valid, components: [...valid.components, valid.components[0]] } },
      { schemaVersion: 1, power: { ...valid, nodes: [...valid.nodes].reverse() } },
      { schemaVersion: 1, power: { ...valid, consumers: [...valid.consumers].reverse() } },
      { schemaVersion: 1, power: { ...valid, components: [{ ...valid.components[0], allocated: 21 }] } },
      { schemaVersion: 1, power: { ...valid, nodes: [{ ...valid.nodes[0], role: "battery" }] } },
      { schemaVersion: 1, power: { ...valid, consumers: [{ ...valid.consumers[0], nodeId: null, componentId: null, powered: true }] } },
      { schemaVersion: 1, power: { ...valid, consumers: [{ ...valid.consumers[0], demand: Number.POSITIVE_INFINITY }] } },
      { schemaVersion: 1, power: { ...valid, nodes: Array.from({ length: 16_385 }, (_, index) => ({
        ...valid.nodes[0], towerId: `tower_${String(index).padStart(5, "0")}`
      })) } },
      new Proxy(snapshot().logistics, { ownKeys() { throw new Error("hostile"); } })
    ];

    for (const logistics of invalid) {
      expect(projector()({ logistics })).toEqual({ active: false, power: null });
    }
  });

  it("fails closed above 4096 live participants or 1024 live nodes", () => {
    expect(projector()({ logistics: boundedSnapshot({ nodeCount: 1, consumerCount: 4_096 }) }))
      .toHaveProperty("active", false);
    expect(projector()({ logistics: boundedSnapshot({ nodeCount: 1_025, consumerCount: 0 }) }))
      .toHaveProperty("active", false);
  });

  it("fails closed at 65,537 undirected or 131,074 directed authoritative link IDs", () => {
    const logistics = boundedSnapshot({ nodeCount: 363, consumerCount: 0, edgeCount: 65_537 });
    const directedLinks = logistics.power.nodes.reduce(
      (count, node) => count + node.linkTowerIds.length,
      0
    );
    expect(directedLinks).toBe(131_074);
    expect(projector()({ logistics })).toHaveProperty("active", false);
  });
});
