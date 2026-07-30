import { describe, expect, it } from "vitest";
import {
  TOWER_SCRIPT_EVENTS,
  TOWER_SCRIPT_SCHEMA
} from "./schema-descriptor.js";
import { validateTowerScriptDefinitions } from "./validate.js";

const EVENTS = ["bossComponentDamaged", "bossComponentDestroyed"] as const;
const EVENT_FIELDS = [
  "type",
  "enemyId",
  "enemyTypeId",
  "componentId",
  "sourceKind",
  "previousHp",
  "currentHp",
  "maxHp",
  "hpDamage",
  "previousShield",
  "currentShield",
  "shieldCapacity",
  "shieldAbsorbed"
] as const;

function definition(schemaVersion: number, event: string) {
  return {
    component_events: {
      schemaVersion,
      id: "component_events",
      bindings: [{ scope: "global" }],
      handlers: {
        [event]: [{ actions: [{ action: "incrementState", key: "seen" }] }]
      }
    }
  };
}

describe("R12.2 boss-component TowerScript event schema (RED)", () => {
  it("publishes both v7 event names with the exact closed payload shape", () => {
    const fields = TOWER_SCRIPT_SCHEMA.eventFields as unknown as Record<string, readonly string[]>;

    expect(TOWER_SCRIPT_EVENTS).toEqual(expect.arrayContaining([...EVENTS]));
    expect(fields.bossComponentDamaged).toEqual(EVENT_FIELDS);
    expect(fields.bossComponentDestroyed).toEqual(EVENT_FIELDS);
  });

  it.each(EVENTS)("gates %s to TowerScript schema v7", (event) => {
    for (const schemaVersion of [1, 2, 3, 4, 5, 6]) {
      expect(validateTowerScriptDefinitions(definition(schemaVersion, event) as never))
        .toContainEqual(expect.objectContaining({
          fieldPath: `handlers.${event}`,
          message: expect.stringMatching(/schemaVersion 7|version 7/i)
        }));
    }
    expect(validateTowerScriptDefinitions(definition(7, event) as never)).toEqual([]);
  });
});
