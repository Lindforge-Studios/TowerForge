import { describe, expect, it } from "vitest";
import {
  TOWER_SCRIPT_ACTION_SCHEMA,
  TOWER_SCRIPT_EVENTS,
  TOWER_SCRIPT_LIMITS,
  TOWER_SCRIPT_SCHEMA,
  TOWER_SCRIPT_SCOPES
} from "./schema-descriptor.js";
import { validateTowerScriptDefinitions } from "./validate.js";

describe("TowerScript schema descriptor", () => {
  it("keeps v1-v6 vocabularies accepted and gates versioned events through v7", () => {
    const v3OnlyEvents = new Set<string>(["enemyShieldChanged", "towerShieldChanged"]);
    const v4OnlyEvents = new Set<string>(["enemyMarkChanged"]);
    const v5OnlyEvents = new Set<string>(["enemyExposureChanged", "enemyReactionTriggered"]);
    const v6OnlyEvents = new Set<string>(["elevationChanged"]);
    const v7OnlyEvents = new Set<string>(["stateMachineTransitioned"]);
    const legacyHandlers = Object.fromEntries(TOWER_SCRIPT_EVENTS.filter((event) => (
      !v3OnlyEvents.has(event) && !v4OnlyEvents.has(event) && !v5OnlyEvents.has(event)
      && !v6OnlyEvents.has(event) && !v7OnlyEvents.has(event)
    )).map((event) => [
      event,
      [{ actions: [{ action: "incrementState", key: "count" }] }]
    ]));
    for (const schemaVersion of [1, 2] as const) {
      expect(validateTowerScriptDefinitions({
        [`legacy_v${schemaVersion}`]: {
          schemaVersion,
          id: `legacy_v${schemaVersion}`,
          bindings: [{ scope: "global" }],
          handlers: legacyHandlers
        }
      })).toEqual([]);
    }

    const v3Handlers = Object.fromEntries(TOWER_SCRIPT_EVENTS.filter((event) => (
      !v4OnlyEvents.has(event) && !v5OnlyEvents.has(event) && !v6OnlyEvents.has(event) && !v7OnlyEvents.has(event)
    )).map((event) => [
      event,
      [{ actions: [{ action: "incrementState", key: "count" }] }]
    ]));
    expect(validateTowerScriptDefinitions({
      descriptor_contract_v3: {
        schemaVersion: 3,
        id: "descriptor_contract_v3",
        bindings: [{ scope: "global" }],
        handlers: v3Handlers
      }
    } as never)).toEqual([]);

    const v4Handlers = Object.fromEntries(TOWER_SCRIPT_EVENTS.filter((event) => (
      !v5OnlyEvents.has(event) && !v6OnlyEvents.has(event) && !v7OnlyEvents.has(event)
    )).map((event) => [
      event,
      [{ actions: [{ action: "incrementState", key: "count" }] }]
    ]));
    expect(validateTowerScriptDefinitions({
      descriptor_contract_v4: {
        schemaVersion: 4,
        id: "descriptor_contract_v4",
        bindings: [{ scope: "global" }],
        handlers: v4Handlers
      }
    } as never)).toEqual([]);

    const v5Handlers = Object.fromEntries(TOWER_SCRIPT_EVENTS.filter((event) => (
      !v6OnlyEvents.has(event) && !v7OnlyEvents.has(event)
    )).map((event) => [
      event,
      [{ actions: [{ action: "incrementState", key: "count" }] }]
    ]));
    expect(validateTowerScriptDefinitions({
      descriptor_contract_v5: {
        schemaVersion: 5,
        id: "descriptor_contract_v5",
        bindings: [{ scope: "global" }],
        handlers: v5Handlers
      }
    } as never)).toEqual([]);

    const v6Handlers = Object.fromEntries(TOWER_SCRIPT_EVENTS.filter((event) => (
      !v7OnlyEvents.has(event)
    )).map((event) => [
      event,
      [{ actions: [{ action: "incrementState", key: "count" }] }]
    ]));
    expect(validateTowerScriptDefinitions({
      descriptor_contract_v6: {
        schemaVersion: 6,
        id: "descriptor_contract_v6",
        bindings: [{ scope: "global" }],
        handlers: v6Handlers
      }
    } as never)).toEqual([]);

    expect(validateTowerScriptDefinitions({
      descriptor_contract_v6: {
        schemaVersion: 6,
        id: "descriptor_contract_v6",
        bindings: [{ scope: "global" }],
        handlers: { stateMachineTransitioned: [{ actions: [{ action: "incrementState", key: "count" }] }] }
      }
    } as never)).toEqual([
      expect.objectContaining({
        fieldPath: "handlers.stateMachineTransitioned",
        message: expect.stringMatching(/schemaVersion 7|version 7/i)
      })
    ]);

    const v7Handlers = Object.fromEntries(TOWER_SCRIPT_EVENTS.map((event) => [
      event,
      [{ actions: [{ action: "incrementState", key: "count" }] }]
    ]));
    expect(validateTowerScriptDefinitions({
      descriptor_contract_v7: {
        schemaVersion: 7,
        id: "descriptor_contract_v7",
        bindings: [{ scope: "global" }],
        handlers: v7Handlers
      }
    } as never)).toEqual([]);
  });

  it("gates shield vocabulary to v3 and enforces enemy/tower target families", () => {
    const definition = (schemaVersion: 1 | 2 | 3 | 4, event: string, action: Record<string, unknown>) => ({
      shield_contract: {
        schemaVersion,
        id: "shield_contract",
        bindings: [{ scope: "global" }],
        handlers: { [event]: [{ actions: [action] }] }
      }
    });
    const enemyRestore = { action: "restoreEnemyShield", target: "eventEnemy", amount: 4 };
    const towerRestore = { action: "restoreTowerShield", target: "eventTower", amount: { $get: "event.amount" } };

    for (const schemaVersion of [1, 2] as const) {
      expect(validateTowerScriptDefinitions(definition(schemaVersion, "enemyShieldChanged", enemyRestore) as never)).not.toEqual([]);
      expect(validateTowerScriptDefinitions(definition(schemaVersion, "towerShieldChanged", towerRestore) as never)).not.toEqual([]);
    }
    expect(validateTowerScriptDefinitions(definition(3, "enemyShieldChanged", enemyRestore) as never)).toEqual([]);
    expect(validateTowerScriptDefinitions(definition(3, "towerShieldChanged", towerRestore) as never)).toEqual([]);
    expect(validateTowerScriptDefinitions(definition(4, "enemyShieldChanged", enemyRestore) as never)).toEqual([]);
    expect(validateTowerScriptDefinitions(definition(4, "towerShieldChanged", towerRestore) as never)).toEqual([]);
    expect(validateTowerScriptDefinitions(definition(3, "tick", {
      action: "restoreEnemyShield", target: "eventTower", amount: 1
    }) as never)).toEqual([expect.objectContaining({ fieldPath: expect.stringContaining("target") })]);
    expect(validateTowerScriptDefinitions(definition(3, "tick", {
      action: "restoreTowerShield", target: "eventEnemy", amount: 1
    }) as never)).toEqual([expect.objectContaining({ fieldPath: expect.stringContaining("target") })]);
    expect(validateTowerScriptDefinitions(definition(3, "tick", {
      action: "restoreEnemyShield", target: "eventEnemy"
    }) as never)).toEqual([expect.objectContaining({ fieldPath: expect.stringContaining("amount") })]);
    expect(validateTowerScriptDefinitions(definition(3, "tick", {
      action: "restoreTowerShield", target: "eventTower"
    }) as never)).toEqual([expect.objectContaining({ fieldPath: expect.stringContaining("amount") })]);
  });

  it("publishes actionable shapes, contexts, examples, and runtime limits", () => {
    const actions = TOWER_SCRIPT_ACTION_SCHEMA as unknown as Record<string, {
      required: Record<string, string>;
    }>;
    expect(TOWER_SCRIPT_SCOPES).toContain("ability");
    expect(TOWER_SCRIPT_SCHEMA.schemaVersion).toBe(7);
    expect(TOWER_SCRIPT_EVENTS).toEqual(expect.arrayContaining([
      "enemyShieldChanged", "towerShieldChanged", "enemyMarkChanged",
      "enemyExposureChanged", "enemyReactionTriggered", "elevationChanged", "stateMachineTransitioned"
    ]));
    expect(actions.restoreEnemyShield?.required).toEqual({ target: "enemy target", amount: "expression >= 0" });
    expect(actions.restoreTowerShield?.required).toEqual({ target: "tower target", amount: "expression >= 0" });
    expect(actions).not.toHaveProperty("damageShield");
    expect(TOWER_SCRIPT_ACTION_SCHEMA.spawnEnemy.optional?.count).toContain("32");
    expect(TOWER_SCRIPT_SCHEMA.eventFields.enemyKilled).toContain("enemyTypeId");
    expect((TOWER_SCRIPT_SCHEMA.eventFields as Record<string, readonly string[]>).enemyShieldChanged).toEqual(expect.arrayContaining([
      "enemyId", "enemyTypeId", "previous", "current", "capacity", "cause", "amount"
    ]));
    expect((TOWER_SCRIPT_SCHEMA.eventFields as Record<string, readonly string[]>).towerShieldChanged).toEqual(expect.arrayContaining([
      "towerId", "towerTypeId", "previous", "current", "capacity", "cause", "amount"
    ]));
    expect(TOWER_SCRIPT_SCHEMA.expression.gameFields).toContain("difficultyId");
    expect(TOWER_SCRIPT_SCHEMA.example.handlers.enemyKilled).toHaveLength(1);
    expect(TOWER_SCRIPT_LIMITS.actionsPerTransaction).toBe(512);
  });
});
