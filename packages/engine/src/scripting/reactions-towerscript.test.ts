import { describe, expect, it } from "vitest";
import {
  TOWER_SCRIPT_ACTION_SCHEMA,
  TOWER_SCRIPT_EVENTS,
  TOWER_SCRIPT_SCHEMA
} from "./schema-descriptor.js";
import { validateTowerScriptDefinitions } from "./validate.js";

function scriptDefinition(
  schemaVersion: number,
  handlers: Record<string, Array<{ actions: Array<Record<string, unknown>> }>>
) {
  return {
    reaction_script: {
      schemaVersion,
      id: "reaction_script",
      bindings: [{ scope: "mission", ids: ["reactions"] }],
      handlers
    }
  };
}

const refs = {
  missionIds: new Set(["reactions"]),
  exposureIds: new Set(["charged"]),
  reactionIds: new Set(["charged_burst"])
} as never;

describe("TowerScript v5 reaction contract", () => {
  it("gates exposure actions and reaction events to schema v5", () => {
    const definition = (schemaVersion: number) => scriptDefinition(schemaVersion, {
      enemyExposureChanged: [{
        actions: [
          { action: "applyEnemyExposure", target: "eventEnemy", exposureId: "charged", stacks: 2 },
          { action: "clearEnemyExposure", target: "eventEnemy", exposureId: "charged" }
        ]
      }],
      enemyReactionTriggered: [{
        actions: [{ action: "clearEnemyExposure", target: "eventEnemy", exposureId: "charged" }]
      }]
    });

    for (const schemaVersion of [1, 2, 3, 4]) {
      const issues = validateTowerScriptDefinitions(definition(schemaVersion) as never, refs);
      expect(issues.some((issue) => (
        issue.fieldPath.includes("enemyExposureChanged") && /schemaVersion 5|version 5/i.test(issue.message)
      ))).toBe(true);
      expect(issues.some((issue) => (
        issue.fieldPath.includes("enemyReactionTriggered") && /schemaVersion 5|version 5/i.test(issue.message)
      ))).toBe(true);
      expect(issues.filter((issue) => (
        issue.fieldPath.includes("action") && /schemaVersion 5|version 5/i.test(issue.message)
      ))).toHaveLength(3);
    }
    expect(validateTowerScriptDefinitions(definition(5) as never, refs)).toEqual([]);
  });

  it("publishes the closed v5 action and event descriptors without exposing the budget diagnostic", () => {
    const actions = TOWER_SCRIPT_ACTION_SCHEMA as unknown as Record<string, {
      required: Record<string, string>;
      optional?: Record<string, string>;
    }>;
    const eventFields = TOWER_SCRIPT_SCHEMA.eventFields as unknown as Record<string, readonly string[]>;

    expect(TOWER_SCRIPT_SCHEMA.schemaVersion).toBe(7);
    expect(TOWER_SCRIPT_EVENTS).toContain("enemyExposureChanged");
    expect(TOWER_SCRIPT_EVENTS).toContain("enemyReactionTriggered");
    expect(TOWER_SCRIPT_EVENTS).not.toContain("reactionBudgetExceeded");
    expect(actions.applyEnemyExposure?.required).toEqual({
      target: "enemy target",
      exposureId: "existing exposure id"
    });
    expect(actions.applyEnemyExposure?.optional?.stacks).toMatch(/expression|default.*1/i);
    expect(actions.clearEnemyExposure?.required).toEqual({
      target: "enemy target",
      exposureId: "existing exposure id"
    });
    expect(eventFields.enemyExposureChanged).toEqual([
      "type",
      "enemyId",
      "enemyTypeId",
      "exposureId",
      "previousStacks",
      "currentStacks",
      "previousRemaining",
      "remaining",
      "cause"
    ]);
    expect(eventFields.enemyReactionTriggered).toEqual([
      "type",
      "reactionId",
      "originEnemyId",
      "originEnemyTypeId",
      "originCoord",
      "triggerDamageType",
      "depth",
      "scheduledTargetIds"
    ]);
    expect(actions).not.toHaveProperty("triggerReaction");
  });

  it("validates enemy targets, known exposure ids, stacks expressions, and the closed action shape", () => {
    const validateAction = (action: Record<string, unknown>) => validateTowerScriptDefinitions(
      scriptDefinition(5, { tick: [{ actions: [action] }] }) as never,
      refs
    );

    expect(validateAction({ action: "applyEnemyExposure", target: "eventTower", exposureId: "charged" }))
      .toContainEqual(expect.objectContaining({ fieldPath: expect.stringContaining("target") }));
    expect(validateAction({ action: "clearEnemyExposure", target: "allTowers", exposureId: "charged" }))
      .toContainEqual(expect.objectContaining({ fieldPath: expect.stringContaining("target") }));
    expect(validateAction({ action: "applyEnemyExposure", target: "eventEnemy", exposureId: "missing" }))
      .toContainEqual(expect.objectContaining({ fieldPath: expect.stringContaining("exposureId") }));
    expect(validateAction({ action: "clearEnemyExposure", target: "eventEnemy" }))
      .toContainEqual(expect.objectContaining({ fieldPath: expect.stringContaining("exposureId") }));
    expect(validateAction({
      action: "applyEnemyExposure",
      target: "eventEnemy",
      exposureId: "charged",
      stacks: { $get: "event.currentStacks" }
    })).toEqual([]);
    expect(validateAction({
      action: "applyEnemyExposure",
      target: "eventEnemy",
      exposureId: "charged",
      duration: 10
    })).toContainEqual(expect.objectContaining({ fieldPath: expect.stringContaining("duration") }));
    expect(validateAction({
      action: "triggerReaction",
      target: "eventEnemy",
      reactionId: "charged_burst"
    })).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/unknown.*action/i) }));
  });

  it("rejects accessor-backed exposure ids without invoking getters or leaking thrown data", () => {
    let getterCalls = 0;
    const hostileAction = Object.defineProperties({}, {
      action: { value: "applyEnemyExposure", enumerable: true },
      target: { value: "allEnemies", enumerable: true },
      exposureId: {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("SECRET_EXPOSURE_GETTER_VALUE");
        }
      },
      stacks: { value: 1, enumerable: true }
    }) as Record<string, unknown>;

    const issues = validateTowerScriptDefinitions(scriptDefinition(5, {
      tick: [{ actions: [hostileAction] }]
    }) as never, refs);

    expect(getterCalls).toBe(0);
    expect(issues).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringContaining("exposureId"),
      message: expect.stringMatching(/own data|accessor|field/i)
    }));
    expect(JSON.stringify(issues)).not.toContain("SECRET_EXPOSURE_GETTER_VALUE");
  });
});
