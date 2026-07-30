import { describe, expect, it } from "vitest";
import {
  TOWER_SCRIPT_ACTION_SCHEMA,
  TOWER_SCRIPT_EVENTS,
  TOWER_SCRIPT_OPERATORS,
  TOWER_SCRIPT_SCHEMA,
  TOWER_SCRIPT_SCOPES
} from "./schema-descriptor.js";
import type { TowerScriptDefinition } from "./types.js";
import {
  createTowerScriptNodeCatalog,
  towerScriptAstToGraph,
  towerScriptGraphToAst,
  type TowerScriptGraph,
  type TowerScriptGraphV1
} from "./graph.js";

function fullV6Script(): TowerScriptDefinition {
  return {
    schemaVersion: 6,
    id: "lossless_v6",
    label: "Lossless graph",
    description: "Every authored AST field stays canonical TowerScript JSON.",
    enabled: true,
    bindings: [
      { scope: "global" },
      { scope: "tower", ids: ["pelter", "sniper"] },
      { scope: "terrain", ids: ["water"] }
    ],
    initialState: {
      count: 0,
      nested: { enabled: true, values: [1, "two", null] }
    },
    handlers: {
      signal: [{
        id: "on_signal",
        when: {
          $op: "and",
          args: [
            { $op: "eq", args: [{ $get: "event.signal" }, "terraform"] },
            { $op: "gte", args: [{ $get: "state.count" }, 0] }
          ]
        },
        actions: [
          { action: "incrementState", key: "count", amount: 2 },
          { action: "emitSignal", signal: "observed", payload: { count: { $get: "state.count" } } },
          {
            action: "terraformTiles",
            operations: [
              { kind: "set_terrain", target: "eventTile", transitionId: "flood" },
              { kind: "set_elevation", target: { q: 2, r: { $op: "add", args: [0, 1] } }, elevation: -1 }
            ],
            duration: { $op: "max", args: [1, { $get: "event.duration" }] }
          }
        ]
      }],
      tick: [{
        id: "paced",
        every: 0.25,
        actions: [{ action: "setState", key: "lastTick", value: { $get: "game.elapsed" } }]
      }]
    }
  };
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("R6C lossless TowerScript Visual Graph contract", () => {
  it("round-trips the complete canonical v6 AST without inventing a second language", () => {
    const source = fullV6Script();
    const pristine = jsonClone(source);

    const graph = towerScriptAstToGraph(source);
    const restored = towerScriptGraphToAst(graph);

    expect(graph).toMatchObject({
      schemaVersion: 2,
      scriptId: "lossless_v6",
      nodes: expect.any(Array),
      edges: expect.any(Array)
    });
    expect(restored).toEqual(pristine);
    expect(source).toEqual(pristine);
    expect(restored).not.toBe(source);
    expect(graph.nodes.map((node) => node.id)).toEqual(
      [...graph.nodes.map((node) => node.id)].sort()
    );
    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
  });

  it("keeps graph identity deterministic across detached JSON round-trips", () => {
    const source = fullV6Script();
    const first = towerScriptAstToGraph(source);
    const second = towerScriptAstToGraph(jsonClone(source));

    expect(second).toEqual(first);
    expect(towerScriptGraphToAst(jsonClone(first))).toEqual(source);
  });

  it("preserves an unknown future action as a raw node and restores it byte-for-byte at the AST level", () => {
    const future = jsonClone(fullV6Script()) as unknown as {
      schemaVersion: number;
      id: string;
      handlers: { signal: Array<{ actions: Array<Record<string, unknown>> }> };
    };
    const rawAction = {
      action: "futureTeleport",
      target: "eventEnemy",
      destination: { q: { $get: "event.q" }, r: 7 },
      futurePolicy: { preserve: true, modes: ["safe", "fast"] }
    };
    future.handlers.signal[0]!.actions.splice(1, 0, rawAction);
    const pristine = jsonClone(future);

    const graph = towerScriptAstToGraph(future);
    const raw = graph.nodes.find((node) => node.kind === "raw");

    expect(raw).toMatchObject({
      kind: "raw",
      astPath: "/handlers/signal/0/actions/1",
      raw: rawAction
    });
    expect(towerScriptGraphToAst(graph)).toEqual(pristine);

    const mutableRaw = raw as unknown as { raw: { futurePolicy: { preserve: boolean } } };
    mutableRaw.raw.futurePolicy.preserve = false;
    expect(future).toEqual(pristine);
  });

  it("rejects malformed graph structure instead of producing a lossy or invalid AST", () => {
    const graph = jsonClone(towerScriptAstToGraph(fullV6Script())) as unknown as {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    graph.nodes[1]!.id = graph.nodes[0]!.id;
    expect(() => towerScriptGraphToAst(graph as unknown as TowerScriptGraphV1)).toThrow(/duplicate|node.*id/i);

    const dangling = jsonClone(towerScriptAstToGraph(fullV6Script())) as unknown as {
      edges: Array<Record<string, unknown>>;
    };
    dangling.edges.push({ id: "dangling", from: "missing", to: "also_missing", order: 0 });
    expect(() => towerScriptGraphToAst(dangling as unknown as TowerScriptGraphV1)).toThrow(/edge|missing|dangling/i);
  });

  it("generates events, actions, operators, scopes, and help directly from engine descriptors", () => {
    const catalog = createTowerScriptNodeCatalog(TOWER_SCRIPT_SCHEMA);

    expect(catalog).toMatchObject({
      schemaVersion: 2,
      towerScriptSchemaVersion: TOWER_SCRIPT_SCHEMA.schemaVersion
    });
    expect(catalog.events.map((entry) => entry.name)).toEqual([...TOWER_SCRIPT_EVENTS]);
    expect(catalog.actions.map((entry) => entry.name)).toEqual(Object.keys(TOWER_SCRIPT_ACTION_SCHEMA).sort());
    expect(catalog.operators.map((entry) => entry.name)).toEqual([...TOWER_SCRIPT_OPERATORS]);
    expect(catalog.scopes.map((entry) => entry.name)).toEqual([...TOWER_SCRIPT_SCOPES]);
    for (const entry of catalog.actions) {
      expect(entry.descriptor).toEqual(
        TOWER_SCRIPT_ACTION_SCHEMA[entry.name as keyof typeof TOWER_SCRIPT_ACTION_SCHEMA]
      );
    }

    const descriptorWithFutureAction = jsonClone(TOWER_SCRIPT_SCHEMA) as unknown as {
      schemaVersion: number;
      events: string[];
      eventFields: Record<string, string[]>;
      expression: { operators: string[] };
      scopes: string[];
      actions: Record<string, { required: Record<string, string>; optional?: Record<string, string> }>;
    };
    descriptorWithFutureAction.actions.futureTeleport = {
      required: { target: "enemy target", destination: "tile expression" },
      optional: { duration: "expression > 0" }
    };
    const futureCatalog = createTowerScriptNodeCatalog(descriptorWithFutureAction);
    expect(futureCatalog.actions).toContainEqual({
      name: "futureTeleport",
      descriptor: descriptorWithFutureAction.actions.futureTeleport
    });
  });

  it("projects v7 Behavior Trees and nested HFSMs with stable authored ids and checked transition edges", () => {
    const source: TowerScriptDefinition = {
      schemaVersion: 7,
      id: "dx3",
      bindings: [],
      handlers: {},
      behaviorTrees: [{
        schemaVersion: 1,
        id: "boss_priority",
        bindings: [{ scope: "tower", ids: ["pelter"] }],
        root: {
          id: "choose",
          type: "selector",
          children: [
            {
              id: "finish_boss",
              type: "sequence",
              children: [
                { id: "boss_low", type: "condition", mode: "any_candidate", expression: { $get: "candidate.tags.boss" } },
                { id: "boss", type: "action", action: "select_targets", filter: { $get: "candidate.tags.boss" }, mode: "weakest" }
              ]
            },
            { id: "fallback", type: "action", action: "select_targets", mode: "weakest" }
          ]
        }
      }],
      stateMachines: [{
        schemaVersion: 1,
        id: "boss_phase",
        bindings: [{ scope: "global" }],
        initial: "combat",
        states: [{
          id: "combat",
          initial: "phase_one",
          states: [
            { id: "phase_one", transitions: [{ id: "enrage", event: "signal", target: "/combat/phase_two" }] },
            { id: "phase_two" }
          ]
        }]
      }]
    };
    const graph = towerScriptAstToGraph(source);

    expect(towerScriptGraphToAst(graph)).toEqual(source);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "bt:boss_priority:choose", kind: "behavior_selector" }),
      expect.objectContaining({ id: "hfsm:boss_phase:state:%2Fcombat%2Fphase_two", kind: "state" }),
      expect.objectContaining({ id: "hfsm:boss_phase:transition:enrage", kind: "transition" })
    ]));
    expect(graph.edges).toContainEqual(expect.objectContaining({
      kind: "transition_target",
      from: "hfsm:boss_phase:transition:enrage",
      to: "hfsm:boss_phase:state:%2Fcombat%2Fphase_two"
    }));

    const malformed = jsonClone(graph);
    const transitionEdge = malformed.edges.find((edge) => edge.kind === "transition_target")!;
    (transitionEdge as { to: string }).to = "hfsm:boss_phase:state:%2Fcombat%2Fphase_one";
    expect(() => towerScriptGraphToAst(malformed)).toThrow(/transition.*target|authored target/i);
  });

  it("continues to accept legacy Graph v1 projections", () => {
    const v2 = towerScriptAstToGraph(fullV6Script());
    const legacy: TowerScriptGraphV1 = {
      schemaVersion: 1,
      scriptId: v2.scriptId,
      nodes: v2.nodes as unknown as TowerScriptGraphV1["nodes"],
      edges: v2.edges.map(({ id, from, to, order }) => ({ id, from, to, order }))
    };
    expect(towerScriptGraphToAst(jsonClone(legacy) as TowerScriptGraph)).toEqual(fullV6Script());
  });
});
