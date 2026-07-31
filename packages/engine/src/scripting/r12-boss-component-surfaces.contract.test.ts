import { describe, expect, it } from "vitest";
import {
  TOWER_SCRIPT_SCHEMA
} from "./schema-descriptor.js";
import type { TowerScriptDefinition } from "./types.js";
import {
  createTowerScriptNodeCatalog,
  towerScriptAstToGraph,
  towerScriptGraphToAst
} from "./graph.js";

const COMPONENT_CONTEXT_FIELDS = [
  "schemaVersion",
  "enemyId",
  "enemyTypeId",
  "id",
  "label",
  "hp",
  "maxHp",
  "hpRatio",
  "destroyed",
  "tags",
  "disablesAbilities",
  "shield"
] as const;

function componentScript(): TowerScriptDefinition {
  return {
    schemaVersion: 7,
    id: "component_phase",
    bindings: [{ scope: "global" }],
    handlers: {
      bossComponentDamaged: [{
        id: "remember_damage",
        actions: [{ action: "setState", key: "component", value: { $get: "event.componentId" } }]
      }]
    },
    stateMachines: [{
      schemaVersion: 1,
      id: "boss_phase",
      bindings: [{ scope: "enemy", ids: ["citadel_boss"] }],
      initial: "intact",
      states: [
        {
          id: "intact",
          transitions: [{
            id: "component_lost",
            event: "bossComponentDestroyed",
            target: "/exposed",
            when: { $op: "eq", args: [{ $get: "component.id" }, "shield_core"] }
          }]
        },
        { id: "exposed" }
      ]
    }]
  };
}

describe("R12.2 component scripting descriptors and Graph v2 (RED)", () => {
  it("describes the complete read-only HFSM component context and v7-only event metadata", () => {
    const machine = TOWER_SCRIPT_SCHEMA.stateMachines as unknown as {
      contextRoots: readonly string[];
      componentContext: {
        schemaVersion: number;
        availableForEvents: readonly string[];
        source: string;
        fields: readonly string[];
        shieldFields: readonly string[];
      };
    };
    const completion = TOWER_SCRIPT_SCHEMA.completion.catalog.events as unknown as Array<{
      name: string;
      fields: readonly string[];
      minimumSchemaVersion?: number;
    }>;

    expect(machine.contextRoots).toContain("component");
    expect(machine.componentContext).toEqual({
      schemaVersion: 1,
      availableForEvents: ["bossComponentDamaged", "bossComponentDestroyed"],
      source: "captured_post_resolution_event",
      fields: COMPONENT_CONTEXT_FIELDS,
      shieldFields: ["current", "capacity", "ratio"]
    });
    for (const eventName of ["bossComponentDamaged", "bossComponentDestroyed"]) {
      expect(completion.find((entry) => entry.name === eventName)).toMatchObject({
        name: eventName,
        minimumSchemaVersion: 7,
        fields: expect.arrayContaining(["componentId", "sourceKind", "previousHp", "currentHp", "hpDamage"])
      });
    }
  });

  it("round-trips component events through existing handler/transition Graph v2 grammar losslessly", () => {
    const source = componentScript();
    const graph = towerScriptAstToGraph(source);
    const restored = towerScriptGraphToAst(JSON.parse(JSON.stringify(graph)));

    expect(restored).toEqual(source);
    expect(graph.schemaVersion).toBe(2);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "handler",
        astPath: "/handlers/bossComponentDamaged/0"
      }),
      expect.objectContaining({
        kind: "transition",
        raw: expect.objectContaining({ event: "bossComponentDestroyed", target: "/exposed" })
      })
    ]));
    expect(graph.nodes.some((node) => /boss_component|component_event/i.test(node.kind))).toBe(false);
    expect(new Set(graph.edges.map((edge) => edge.kind))).toEqual(new Set(["containment", "transition_target"]));

    const catalog = createTowerScriptNodeCatalog(TOWER_SCRIPT_SCHEMA);
    expect(catalog.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "bossComponentDamaged", minimumSchemaVersion: 7 }),
      expect.objectContaining({ name: "bossComponentDestroyed", minimumSchemaVersion: 7 })
    ]));
    expect(catalog.nodeKinds).not.toEqual(expect.arrayContaining([
      "boss_component_event",
      "component_context"
    ]));
  });
});
