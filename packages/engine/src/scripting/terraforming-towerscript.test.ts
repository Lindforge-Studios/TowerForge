import { describe, expect, it } from "vitest";
import {
  TOWER_SCRIPT_ACTION_SCHEMA,
  TOWER_SCRIPT_EVENTS,
  TOWER_SCRIPT_SCHEMA
} from "./schema-descriptor.js";
import { validateTowerScriptDefinitions } from "./validate.js";

function definitions(schemaVersion: number, action: Record<string, unknown>) {
  return {
    terraform: {
      schemaVersion,
      id: "terraform",
      bindings: [{ scope: "mission", ids: ["terraform"] }],
      handlers: { signal: [{ actions: [action] }] }
    }
  };
}

const refs = {
  missionIds: new Set(["terraform"]),
  terrainIds: new Set(["floor", "water", "void"]),
  terrainTags: new Set(["floodable", "path"]),
  terraformingTransitionIds: new Set(["flood", "collapse"])
};

const setTerrain = {
  action: "terraformTiles",
  operations: [{
    kind: "set_terrain",
    target: { q: 1, r: 0 },
    transitionId: "flood"
  }]
};

describe("TowerScript v6 transactional terraforming contract", () => {
  it("publishes the exact v6 action, operation union, limits, and elevation event", () => {
    const actions = TOWER_SCRIPT_ACTION_SCHEMA as unknown as Record<string, unknown>;
    const action = actions.terraformTiles as Record<string, unknown> | undefined;
    expect(TOWER_SCRIPT_SCHEMA.schemaVersion).toBe(6);
    expect(action).toMatchObject({
      required: { operations: "1..64 closed terraform operations" },
      optional: { duration: expect.stringMatching(/expression.*all.*set/i) },
      additionalProperties: false,
      minimumSchemaVersion: 6,
      operationKinds: ["set_terrain", "restore_terrain", "set_elevation", "restore_elevation"]
    });
    expect(TOWER_SCRIPT_EVENTS).toContain("elevationChanged");
    expect(TOWER_SCRIPT_SCHEMA.eventFields.elevationChanged).toEqual([
      "type", "coord", "fromElevation", "toElevation", "source"
    ]);
    expect(TOWER_SCRIPT_SCHEMA.limits).toMatchObject({
      terrainChangesPerTransaction: 64
    });
  });

  it("rejects terraformTiles in v1-v5 and accepts all four exact operations in v6", () => {
    for (const schemaVersion of [1, 2, 3, 4, 5]) {
      const issues = validateTowerScriptDefinitions(definitions(schemaVersion, setTerrain) as never, refs);
      expect(issues).toContainEqual(expect.objectContaining({
        fieldPath: expect.stringContaining("action"),
        message: expect.stringMatching(/schemaVersion 6|version 6/i)
      }));
    }

    const action = {
      action: "terraformTiles",
      operations: [
        { kind: "set_terrain", target: { q: 0, r: 0 }, transitionId: "flood" },
        { kind: "restore_terrain", target: { q: 1, r: 0 } },
        { kind: "set_elevation", target: { q: 2, r: 0 }, elevation: { $get: "event.payload.level" } },
        { kind: "restore_elevation", target: "eventTile" }
      ]
    };
    expect(validateTowerScriptDefinitions(definitions(6, action) as never, refs)).toEqual([]);
  });

  it("enforces 1..64 dense operations and the exact closed operation shapes", () => {
    const validate = (action: Record<string, unknown>) => validateTowerScriptDefinitions(
      definitions(6, action) as never,
      refs
    );
    expect(validate({ action: "terraformTiles", operations: [] }))
      .toContainEqual(expect.objectContaining({ message: expect.stringMatching(/1\.\.64|at least one/i) }));
    expect(validate({
      action: "terraformTiles",
      operations: Array.from({ length: 65 }, (_, q) => ({
        kind: "restore_terrain", target: { q, r: 0 }
      }))
    })).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/64|budget|limit/i) }));
    expect(validate({
      ...setTerrain,
      operations: [{ ...setTerrain.operations[0], terrainId: "water" }]
    })).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringMatching(/operations\[0\].*terrainId/i),
      message: expect.stringMatching(/unknown|closed|not allow/i)
    }));
    expect(validate({
      action: "terraformTiles",
      operations: [{ kind: "set_terrain", target: { q: 1, r: 0 }, transitionId: "missing" }]
    })).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringMatching(/transitionId/i),
      message: expect.stringMatching(/unknown.*transition/i)
    }));
  });

  it("distinguishes an absent duration from an explicitly undefined own duration", () => {
    expect(validateTowerScriptDefinitions(definitions(6, setTerrain) as never, refs)).toEqual([]);
    expect(validateTowerScriptDefinitions(definitions(6, {
      ...setTerrain,
      duration: undefined
    }) as never, refs)).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringMatching(/duration/i),
      message: expect.stringMatching(/expression|required|undefined/i)
    }));
  });

  it.each([
    ["an authored ASCII name with spaces", "flood stage"],
    ["exactly 128 UTF-8 bytes of multibyte text", "я".repeat(64)],
    ["exactly 128 UTF-8 bytes of ASCII text", "x".repeat(128)]
  ])("accepts %s as a profile-parity transition id", (_label, transitionId) => {
    const transitionRefs = {
      ...refs,
      terraformingTransitionIds: new Set([transitionId])
    } as never;
    expect(validateTowerScriptDefinitions(
      definitions(6, {
        action: "terraformTiles",
        operations: [{ kind: "set_terrain", target: { q: 1, r: 0 }, transitionId }]
      }) as never,
      transitionRefs
    )).toEqual([]);
  });

  it("rejects empty and 129-byte transition ids before reference lookup", () => {
    const validateTransitionId = (transitionId: string) => validateTowerScriptDefinitions(
      definitions(6, {
        action: "terraformTiles",
        operations: [{ kind: "set_terrain", target: { q: 1, r: 0 }, transitionId }]
      }) as never,
      { ...refs, terraformingTransitionIds: new Set([transitionId]) } as never
    );
    expect(validateTransitionId("")).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringMatching(/transitionId/i),
      message: expect.stringMatching(/safe|non-empty|1\.\.128/i)
    }));
    expect(validateTransitionId("x".repeat(129))).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringMatching(/transitionId/i),
      message: expect.stringMatching(/1\.\.128|128.*UTF-8/i)
    }));
  });

  it("rejects sparse or accessor-backed operations without invoking hostile getters", () => {
    let getterCalls = 0;
    const hostileOperation = Object.defineProperties({}, {
      kind: { value: "set_terrain", enumerable: true },
      target: { value: { q: 1, r: 0 }, enumerable: true },
      transitionId: {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("SECRET_TRANSITION_GETTER");
        }
      }
    });
    const hostile = validateTowerScriptDefinitions(definitions(6, {
      action: "terraformTiles",
      operations: [hostileOperation]
    }) as never, refs);
    expect(getterCalls).toBe(0);
    expect(hostile).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringMatching(/operations\[0\].*transitionId|operations\[0\]/i),
      message: expect.stringMatching(/own data|accessor|enumerable/i)
    }));
    expect(JSON.stringify(hostile)).not.toContain("SECRET_TRANSITION_GETTER");

    const sparse = new Array(2);
    sparse[1] = { kind: "restore_terrain", target: { q: 1, r: 0 } };
    const sparseIssues = validateTowerScriptDefinitions(definitions(6, {
      action: "terraformTiles",
      operations: sparse
    }) as never, refs);
    expect(sparseIssues).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringContaining("operations"),
      message: expect.stringMatching(/dense|sparse/i)
    }));
  });

  it.each([
    ["duration", (expression: object) => ({
      action: "terraformTiles",
      operations: [{ kind: "set_terrain", target: { q: 1, r: 0 }, transitionId: "flood" }],
      duration: expression
    })],
    ["target coordinate", (expression: object) => ({
      action: "terraformTiles",
      operations: [{ kind: "set_terrain", target: { q: expression, r: 0 }, transitionId: "flood" }]
    })],
    ["elevation", (expression: object) => ({
      action: "terraformTiles",
      operations: [{ kind: "set_elevation", target: { q: 1, r: 0 }, elevation: expression }]
    })]
  ])("rejects an accessor-backed nested %s expression without executing it", (_label, actionWith) => {
    let getterCalls = 0;
    const expression = Object.defineProperty({}, "$get", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("SECRET_NESTED_TERRAFORM_EXPRESSION");
      }
    });
    let thrown: unknown;
    let issues: ReturnType<typeof validateTowerScriptDefinitions> = [];
    try {
      issues = validateTowerScriptDefinitions(definitions(6, actionWith(expression)) as never, refs);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeUndefined();
    expect(getterCalls).toBe(0);
    expect(issues).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringMatching(/duration|target\.q|elevation/i),
      message: expect.stringMatching(/own data|accessor|enumerable|expression/i)
    }));
    expect(JSON.stringify(issues)).not.toContain("SECRET_NESTED_TERRAFORM_EXPRESSION");
  });
});
