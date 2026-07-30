import { describe, expect, it } from "vitest";
import {
  initializeTowerScriptStateMachine,
  planTowerScriptStateTransition
} from "./state-machine.js";
import type { TowerScriptStateMachineV1 } from "./types.js";
import { TOWER_SCRIPT_LIMITS, TOWER_SCRIPT_SCHEMA } from "./schema-descriptor.js";
import { validateTowerScriptDefinitions } from "./validate.js";

function bossMachine(): TowerScriptStateMachineV1 {
  return {
    schemaVersion: 1,
    id: "boss_phases",
    bindings: [{ scope: "enemy", ids: ["boss"] }],
    initial: "combat",
    states: [{
      id: "combat",
      initial: "phase1",
      states: [
        {
          id: "phase1",
          entryActions: [{ action: "setState", key: "phase", value: 1 }],
          exitActions: [{ action: "setState", key: "leftPhase1", value: true }],
          transitions: [{
            id: "enrage",
            event: "enemyHit",
            target: "/combat/phase2",
            when: { $op: "lt", args: [{ $get: "self.hpRatio" }, 0.2] },
            actions: [{ action: "setState", key: "enraged", value: true }]
          }]
        },
        {
          id: "phase2",
          entryActions: [{ action: "setState", key: "phase", value: 2 }],
          transitions: [{ id: "repeat", event: "signal", target: "/combat/phase2" }]
        }
      ]
    }]
  };
}

function validateMachines(stateMachines: unknown) {
  return validateTowerScriptDefinitions({
    boss_controller: {
      schemaVersion: 7,
      id: "boss_controller",
      bindings: [],
      handlers: {},
      stateMachines
    }
  } as never, { enemyIds: new Set(["boss"]) });
}

describe("R9.3 TowerScript HFSM pure planner contract (RED)", () => {
  it("enters nested initial states in root-to-leaf order", () => {
    expect(initializeTowerScriptStateMachine(bossMachine(), 3)).toEqual({
      state: {
        schemaVersion: 1,
        activeStatePath: "/combat/phase1",
        enteredAt: 3,
        transitionCount: 0
      },
      entryActions: [{ action: "setState", key: "phase", value: 1 }]
    });
  });

  it("resolves leaf-to-root authored transitions and returns ordered action phases", () => {
    const initialized = initializeTowerScriptStateMachine(bossMachine(), 0);
    expect(planTowerScriptStateTransition(
      bossMachine(),
      initialized.state,
      "enemyHit",
      { event: { type: "enemyHit" }, self: { hpRatio: 0.15 }, state: {}, game: {} },
      4
    )).toEqual({
      schemaVersion: 1,
      transitionId: "enrage",
      fromStatePath: "/combat/phase1",
      toStatePath: "/combat/phase2",
      exitActions: [{ action: "setState", key: "leftPhase1", value: true }],
      transitionActions: [{ action: "setState", key: "enraged", value: true }],
      entryActions: [{ action: "setState", key: "phase", value: 2 }],
      state: {
        schemaVersion: 1,
        activeStatePath: "/combat/phase2",
        enteredAt: 4,
        transitionCount: 1
      }
    });
  });

  it("does not transition on a false guard and performs a full self-transition", () => {
    const initialized = initializeTowerScriptStateMachine(bossMachine(), 0);
    expect(planTowerScriptStateTransition(
      bossMachine(), initialized.state, "enemyHit",
      { event: {}, self: { hpRatio: 0.8 }, state: {}, game: {} }, 1
    )).toBeNull();

    const phase2 = {
      schemaVersion: 1 as const,
      activeStatePath: "/combat/phase2",
      enteredAt: 4,
      transitionCount: 1
    };
    expect(planTowerScriptStateTransition(
      bossMachine(), phase2, "signal",
      { event: { signal: "repeat" }, self: {}, state: {}, game: {} }, 5
    )).toMatchObject({
      transitionId: "repeat",
      fromStatePath: "/combat/phase2",
      toStatePath: "/combat/phase2",
      entryActions: [{ action: "setState", key: "phase", value: 2 }],
      state: { enteredAt: 5, transitionCount: 2 }
    });
  });

  it("publishes v1 and rejects future, sparse, accessor-backed, and proxy-backed machine data safely", () => {
    expect(TOWER_SCRIPT_SCHEMA.stateMachines).toMatchObject({ schemaVersion: 1 });
    expect(validateMachines([{ ...bossMachine(), schemaVersion: 2 }])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: "stateMachines[0].schemaVersion",
        message: expect.stringMatching(/schemaVersion.*1/i)
      })
    ]));

    const sparseMachines = new Array(2);
    sparseMachines[1] = bossMachine();
    expect(validateMachines(sparseMachines)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/dense|sparse|own data/i) })
    ]));

    const sparseStates = new Array(2);
    sparseStates[1] = bossMachine().states[0];
    expect(validateMachines([{ ...bossMachine(), states: sparseStates }])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: expect.stringMatching(/stateMachines\[0\]\.states(?:\[0\])?/),
        message: expect.stringMatching(/dense|sparse|own data/i)
      })
    ]));

    let getterCalls = 0;
    const accessorState = Object.defineProperties({}, {
      id: { value: "hostile", enumerable: true },
      transitions: {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("SECRET_HFSM_GETTER");
        }
      }
    });
    const accessorIssues = validateMachines([{
      ...bossMachine(), initial: "hostile", states: [accessorState]
    }]);
    expect(getterCalls).toBe(0);
    expect(accessorIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: expect.stringMatching(/states\[0\]\.transitions/),
        message: expect.stringMatching(/own data|accessor/i)
      })
    ]));
    expect(JSON.stringify(accessorIssues)).not.toContain("SECRET_HFSM_GETTER");

    const hostileState = new Proxy({}, {
      ownKeys() { throw new Error("SECRET_HFSM_PROXY_TRAP"); }
    });
    let proxyIssues: ReturnType<typeof validateMachines> = [];
    expect(() => {
      proxyIssues = validateMachines([{ ...bossMachine(), initial: "hostile", states: [hostileState] }]);
    }).not.toThrow();
    expect(proxyIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/inspect.*own data|own data.*inspect/i) })
    ]));
    expect(JSON.stringify(proxyIssues)).not.toContain("SECRET_HFSM_PROXY_TRAP");
  });

  it("rejects cyclic hierarchy explicitly instead of relying on the depth budget", () => {
    const cyclic: any = { id: "loop", initial: "loop", states: [] };
    cyclic.states.push(cyclic);
    const issues = validateMachines([{
      schemaVersion: 1,
      id: "cyclic_machine",
      bindings: [{ scope: "enemy", ids: ["boss"] }],
      initial: "loop",
      states: [cyclic]
    }]);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/cycle/i) })
    ]));
  });

  it("bounds authored hierarchy depth, state count, and transitions per state", () => {
    let nested: any = { id: "leaf" };
    for (let depth = 0; depth <= TOWER_SCRIPT_LIMITS.stateMachineDepth; depth += 1) {
      nested = { id: `depth_${depth}`, initial: nested.id, states: [nested] };
    }
    expect(validateMachines([{
      schemaVersion: 1,
      id: "deep_machine",
      bindings: [{ scope: "enemy", ids: ["boss"] }],
      initial: nested.id,
      states: [nested]
    }])).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/depth.*exceed/i) })
    ]));

    const manyStates = Array.from({ length: TOWER_SCRIPT_LIMITS.stateMachineStates + 1 }, (_, index) => ({
      id: `state_${index}`
    }));
    expect(validateMachines([{
      schemaVersion: 1,
      id: "wide_machine",
      bindings: [{ scope: "enemy", ids: ["boss"] }],
      initial: "state_0",
      states: manyStates
    }])).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/state count.*exceed/i) })
    ]));

    const transitions = Array.from(
      { length: TOWER_SCRIPT_LIMITS.stateTransitionsPerState + 1 },
      (_, index) => ({ id: `transition_${index}`, event: "tick", target: "/idle" })
    );
    expect(validateMachines([{
      schemaVersion: 1,
      id: "transition_budget",
      bindings: [{ scope: "enemy", ids: ["boss"] }],
      initial: "idle",
      states: [{ id: "idle", transitions }]
    }])).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/transitions.*exceed/i) })
    ]));
  });

  it("fails fast at the stateMachines limit without inspecting or diagnosing the over-limit tail", () => {
    const allowed = Array.from({ length: TOWER_SCRIPT_LIMITS.stateMachinesPerScript }, (_, index) => ({
      ...bossMachine(),
      id: `machine_${index}`
    }));
    let sentinelTouches = 0;
    const sentinel = new Proxy({ ...bossMachine(), id: "must_not_be_inspected" }, {
      getPrototypeOf(target) {
        sentinelTouches += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        sentinelTouches += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        sentinelTouches += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });

    const issues = validateMachines([...allowed, sentinel]);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: "stateMachines",
        message: expect.stringMatching(/at most|limit|exceed/i)
      })
    ]));
    expect(sentinelTouches).toBe(0);
    expect(issues.some((issue) => issue.fieldPath.startsWith(
      `stateMachines[${TOWER_SCRIPT_LIMITS.stateMachinesPerScript}]`
    ))).toBe(false);
  });

  it("fails fast at the transition limit without walking a hostile extra transition", () => {
    const transitions = Array.from(
      { length: TOWER_SCRIPT_LIMITS.stateTransitionsPerState },
      (_, index) => ({ id: `transition_${index}`, event: "tick", target: "/idle" })
    );
    let sentinelTouches = 0;
    const sentinel = new Proxy({ id: "must_not_be_inspected", event: "tick", target: "/idle" }, {
      getPrototypeOf(target) {
        sentinelTouches += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        sentinelTouches += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        sentinelTouches += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    const issues = validateMachines([{
      schemaVersion: 1,
      id: "bounded_transitions",
      bindings: [{ scope: "enemy", ids: ["boss"] }],
      initial: "idle",
      states: [{ id: "idle", transitions: [...transitions, sentinel] }]
    }]);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: "stateMachines[0].states[0].transitions",
        message: expect.stringMatching(/transitions.*exceed|too many|limit/i)
      })
    ]));
    expect(sentinelTouches).toBe(0);
    expect(issues.some((issue) => issue.fieldPath.includes(
      `.transitions[${TOWER_SCRIPT_LIMITS.stateTransitionsPerState}]`
    ))).toBe(false);
  });

  it("returns a validation issue for a revoked stateMachines proxy instead of throwing", () => {
    const subject = Proxy.revocable([bossMachine()], {});
    subject.revoke();
    let issues: ReturnType<typeof validateMachines> = [];
    expect(() => { issues = validateMachines(subject.proxy); }).not.toThrow();
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: "stateMachines",
        message: expect.stringMatching(/inspect|own data|array/i)
      })
    ]));
  });
});
