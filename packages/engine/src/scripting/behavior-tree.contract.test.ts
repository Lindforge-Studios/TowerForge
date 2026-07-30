import { describe, expect, it } from "vitest";
import {
  evaluateTowerScriptBehaviorTree,
  type TowerScriptBehaviorTreeV1,
  type TowerScriptTargetCandidateV1
} from "./behavior-tree.js";
import { TOWER_SCRIPT_LIMITS, TOWER_SCRIPT_SCHEMA } from "./schema-descriptor.js";
import { validateTowerScriptDefinitions } from "./validate.js";

const candidates: readonly TowerScriptTargetCandidateV1[] = Object.freeze([
  Object.freeze({
    id: "enemy-weak",
    typeId: "grunt",
    tags: Object.freeze([]),
    hp: 10,
    maxHp: 100,
    hpRatio: 0.1,
    distance: 3,
    routeProgress: 0.5,
    hasPierceOnlyArmor: false
  }),
  Object.freeze({
    id: "enemy-boss",
    typeId: "boss",
    tags: Object.freeze(["boss"]),
    hp: 150,
    maxHp: 1_000,
    hpRatio: 0.15,
    distance: 5,
    routeProgress: 0.7,
    hasPierceOnlyArmor: false
  })
]);

function bossFinisherTree(): TowerScriptBehaviorTreeV1 {
  return {
    schemaVersion: 1,
    id: "boss_finisher",
    bindings: [{ scope: "tower", ids: ["archer"] }],
    root: {
      id: "choose",
      type: "selector",
      children: [
        {
          id: "finish_boss",
          type: "sequence",
          children: [
            {
              id: "boss_low",
              type: "condition",
              mode: "any_candidate",
              expression: {
                $op: "and",
                args: [
                  { $get: "candidate.tags.boss" },
                  { $op: "lt", args: [{ $get: "candidate.hpRatio" }, 0.2] }
                ]
              }
            },
            {
              id: "select_boss",
              type: "action",
              action: "select_targets",
              filter: { $get: "candidate.tags.boss" },
              mode: "first"
            }
          ]
        },
        {
          id: "finish_weak",
          type: "action",
          action: "select_targets",
          mode: "weakest"
        }
      ]
    }
  };
}

function context(overrides: Partial<{ candidates: readonly TowerScriptTargetCandidateV1[] }> = {}) {
  return {
    tower: Object.freeze({ id: "tower-1", typeId: "archer", level: 1, targetMode: "first" as const }),
    game: Object.freeze({ missionId: "mission", elapsed: 1 }),
    state: Object.freeze({}),
    candidates: overrides.candidates ?? candidates
  };
}

function validateTrees(behaviorTrees: unknown) {
  return validateTowerScriptDefinitions({
    smart_targeting: {
      schemaVersion: 7,
      id: "smart_targeting",
      bindings: [],
      handlers: {},
      behaviorTrees
    }
  } as never, { towerIds: new Set(["archer"]) });
}

describe("R9.1 TowerScript v7 Behavior Tree contract (RED)", () => {
  it("evaluates selector/sequence and selects the low-health boss", () => {
    expect(evaluateTowerScriptBehaviorTree(bossFinisherTree(), context())).toMatchObject({
      schemaVersion: 1,
      status: "success",
      selectedTargetIds: ["enemy-boss"],
      visitedNodeIds: ["choose", "finish_boss", "boss_low", "select_boss"]
    });
  });

  it("falls through to weakest and is invariant to candidate input order", () => {
    const healthy = candidates.map((candidate) => candidate.id === "enemy-boss"
      ? Object.freeze({ ...candidate, hp: 800, hpRatio: 0.8 })
      : candidate);
    const first = evaluateTowerScriptBehaviorTree(bossFinisherTree(), context({ candidates: healthy }));
    const reversed = evaluateTowerScriptBehaviorTree(bossFinisherTree(), context({ candidates: [...healthy].reverse() }));
    expect(first).toEqual(reversed);
    expect(first).toMatchObject({ status: "success", selectedTargetIds: ["enemy-weak", "enemy-boss"] });
  });

  it("rolls back a failed sequence selection before a later selector branch succeeds", () => {
    const tree: TowerScriptBehaviorTreeV1 = {
      schemaVersion: 1,
      id: "no_selection_leak",
      bindings: [{ scope: "tower", ids: ["archer"] }],
      root: {
        id: "choose",
        type: "selector",
        children: [
          {
            id: "failed_branch",
            type: "sequence",
            children: [
              {
                id: "select_boss_first",
                type: "action",
                action: "select_targets",
                filter: { $get: "candidate.tags.boss" },
                mode: "first"
              },
              { id: "reject_branch", type: "condition", mode: "context", expression: false }
            ]
          },
          { id: "successful_without_selection", type: "condition", mode: "context", expression: true }
        ]
      }
    };

    expect(evaluateTowerScriptBehaviorTree(tree, context())).toMatchObject({
      status: "failure",
      selectedTargetIds: [],
      visitedNodeIds: [
        "choose", "failed_branch", "select_boss_first", "reject_branch", "successful_without_selection"
      ]
    });
  });

  it("returns bounded failure instead of selecting an out-of-budget candidate set", () => {
    const overBudget = Array.from(
      { length: TOWER_SCRIPT_LIMITS.behaviorCandidatesPerAcquisition + 1 },
      (_, index) => Object.freeze({ ...candidates[0]!, id: `enemy-${String(index).padStart(4, "0")}` })
    );
    expect(evaluateTowerScriptBehaviorTree(bossFinisherTree(), context({ candidates: overBudget }))).toMatchObject({
      status: "failure",
      selectedTargetIds: [],
      diagnostic: { code: "budget_exceeded" }
    });
  });

  it("publishes schema v7 and rejects invalid, duplicate, future, and non-own controller data", () => {
    expect(TOWER_SCRIPT_SCHEMA).toMatchObject({
      schemaVersion: 7,
      supportedSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
      behaviorTrees: { schemaVersion: 1 }
    });

    const valid = {
      schemaVersion: 7,
      id: "smart_targeting",
      bindings: [],
      handlers: {},
      behaviorTrees: [bossFinisherTree()]
    } as const;
    expect(validateTowerScriptDefinitions({ smart_targeting: valid } as never, {
      towerIds: new Set(["archer"])
    })).toEqual([]);

    const duplicate = structuredClone(valid) as any;
    duplicate.behaviorTrees[0].root.children[1].id = "boss_low";
    expect(validateTowerScriptDefinitions({ smart_targeting: duplicate }, { towerIds: new Set(["archer"]) }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/duplicate.*node id/i) })]));

    const future = structuredClone(valid) as any;
    future.behaviorTrees[0].schemaVersion = 2;
    expect(validateTowerScriptDefinitions({ smart_targeting: future }, { towerIds: new Set(["archer"]) }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ fieldPath: expect.stringContaining("schemaVersion") })]));

    const accessor = structuredClone(valid) as any;
    Object.defineProperty(accessor.behaviorTrees[0].root, "children", {
      enumerable: true,
      get() { throw new Error("must not execute"); }
    });
    expect(() => validateTowerScriptDefinitions({ smart_targeting: accessor }, { towerIds: new Set(["archer"]) }))
      .not.toThrow();
    expect(validateTowerScriptDefinitions({ smart_targeting: accessor }, { towerIds: new Set(["archer"]) }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/own data|accessor/i) })]));
  });

  it("rejects sparse tree/children arrays, cyclic nodes, and hostile proxies as own-data violations", () => {
    const sparseTrees = new Array(2);
    sparseTrees[1] = bossFinisherTree();
    expect(validateTrees(sparseTrees)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: expect.stringMatching(/behaviorTrees\[0\]|behaviorTrees/),
        message: expect.stringMatching(/dense|sparse|own data/i)
      })
    ]));

    const sparseChildren = structuredClone(bossFinisherTree()) as any;
    const children = new Array(2);
    children[1] = { id: "eventual_action", type: "action", action: "select_targets", mode: "first" };
    sparseChildren.root.children = children;
    expect(validateTrees([sparseChildren])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: expect.stringMatching(/root\.children(?:\[0\])?/),
        message: expect.stringMatching(/dense|sparse|own data/i)
      })
    ]));

    const cyclicRoot: any = { id: "cycle", type: "selector", children: [] };
    cyclicRoot.children.push(cyclicRoot);
    expect(validateTrees([{ ...bossFinisherTree(), root: cyclicRoot }])).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/cycle/i) })
    ]));

    const hostileRoot = new Proxy({}, {
      ownKeys() { throw new Error("SECRET_BT_PROXY_TRAP"); }
    });
    let proxyIssues: ReturnType<typeof validateTrees> = [];
    expect(() => { proxyIssues = validateTrees([{ ...bossFinisherTree(), root: hostileRoot }]); }).not.toThrow();
    expect(proxyIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/inspect.*own data|own data.*inspect/i) })
    ]));
    expect(JSON.stringify(proxyIssues)).not.toContain("SECRET_BT_PROXY_TRAP");
  });

  it("does not execute accessor-backed node fields and rejects the future inner schema", () => {
    let getterCalls = 0;
    const accessorRoot = Object.defineProperties({}, {
      id: { value: "hostile", enumerable: true },
      type: { value: "selector", enumerable: true },
      children: {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("SECRET_BT_GETTER");
        }
      }
    });
    const accessorIssues = validateTrees([{ ...bossFinisherTree(), root: accessorRoot }]);
    expect(getterCalls).toBe(0);
    expect(accessorIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: expect.stringMatching(/root\.children/),
        message: expect.stringMatching(/own data|accessor/i)
      })
    ]));
    expect(JSON.stringify(accessorIssues)).not.toContain("SECRET_BT_GETTER");

    expect(validateTrees([{ ...bossFinisherTree(), schemaVersion: 2 }])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: "behaviorTrees[0].schemaVersion",
        message: expect.stringMatching(/schemaVersion.*1/i)
      })
    ]));
  });

  it("bounds authored node depth/count and runtime expression work", () => {
    let deepNode: any = { id: "leaf", type: "action", action: "select_targets", mode: "first" };
    for (let depth = 0; depth <= TOWER_SCRIPT_LIMITS.behaviorTreeDepth; depth += 1) {
      deepNode = { id: `depth_${depth}`, type: "sequence", children: [deepNode] };
    }
    expect(validateTrees([{ ...bossFinisherTree(), root: deepNode }])).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/depth.*exceed/i) })
    ]));

    const groups = Array.from({ length: 5 }, (_, group) => ({
      id: `group_${group}`,
      type: "selector",
      children: Array.from({ length: TOWER_SCRIPT_LIMITS.behaviorChildrenPerComposite }, (_, index) => ({
        id: `condition_${group}_${index}`,
        type: "condition",
        mode: "context",
        expression: false
      }))
    }));
    expect(validateTrees([{
      ...bossFinisherTree(),
      root: { id: "over_nodes", type: "selector", children: groups }
    }])).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/node count.*exceed/i) })
    ]));

    const expensive = bossFinisherTree() as any;
    expensive.root.children[0].children[0].expression = {
      $op: "or",
      args: Array.from(
        { length: TOWER_SCRIPT_LIMITS.behaviorExpressionOperationsPerAcquisition + 1 },
        () => false
      )
    };
    expect(evaluateTowerScriptBehaviorTree(expensive, context())).toMatchObject({
      status: "failure",
      selectedTargetIds: [],
      diagnostic: { code: "budget_exceeded" }
    });
  });

  it("fails fast at the behaviorTrees limit without inspecting or diagnosing the over-limit tail", () => {
    const allowed = Array.from({ length: TOWER_SCRIPT_LIMITS.behaviorTreesPerScript }, (_, index) => ({
      ...bossFinisherTree(),
      id: `tree_${index}`,
      root: { id: `root_${index}`, type: "action", action: "select_targets", mode: "first" }
    }));
    let sentinelTouches = 0;
    const sentinel = new Proxy({
      ...bossFinisherTree(),
      id: "must_not_be_inspected",
      root: { id: "must_not_be_inspected", type: "action", action: "select_targets", mode: "first" }
    }, {
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

    const issues = validateTrees([...allowed, sentinel]);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: "behaviorTrees",
        message: expect.stringMatching(/at most|limit|exceed/i)
      })
    ]));
    expect(sentinelTouches).toBe(0);
    expect(issues.some((issue) => issue.fieldPath.startsWith(
      `behaviorTrees[${TOWER_SCRIPT_LIMITS.behaviorTreesPerScript}]`
    ))).toBe(false);
  });

  it("fails fast at the composite-child limit without walking a hostile extra child", () => {
    const children = Array.from(
      { length: TOWER_SCRIPT_LIMITS.behaviorChildrenPerComposite },
      (_, index) => ({ id: `child_${index}`, type: "condition", mode: "context", expression: false })
    );
    let sentinelTouches = 0;
    const sentinel = new Proxy({
      id: "must_not_be_inspected",
      type: "condition",
      mode: "context",
      expression: false
    }, {
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
    const issues = validateTrees([{
      ...bossFinisherTree(),
      root: { id: "bounded_children", type: "selector", children: [...children, sentinel] }
    }]);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: "behaviorTrees[0].root.children",
        message: expect.stringMatching(/too many|limit|exceed/i)
      })
    ]));
    expect(sentinelTouches).toBe(0);
    expect(issues.some((issue) => issue.fieldPath.includes(
      `.children[${TOWER_SCRIPT_LIMITS.behaviorChildrenPerComposite}]`
    ))).toBe(false);
  });

  it("returns a validation issue for a revoked behaviorTrees proxy instead of throwing", () => {
    const subject = Proxy.revocable([bossFinisherTree()], {});
    subject.revoke();
    let issues: ReturnType<typeof validateTrees> = [];
    expect(() => { issues = validateTrees(subject.proxy); }).not.toThrow();
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldPath: "behaviorTrees",
        message: expect.stringMatching(/inspect|own data|array/i)
      })
    ]));
  });
});
