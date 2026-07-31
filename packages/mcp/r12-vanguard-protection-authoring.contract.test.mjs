import { describe, expect, it } from "vitest";
import path from "node:path";
import { TOWER_SCRIPT_EVENTS } from "../engine/dist/scripting/schema-descriptor.js";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool } from "./tools.mjs";

describe("R12.4c vanguard protection MCP/AI vocabulary (RED)", () => {
  it("describes the closed protection vocabulary, budgets, snapshot and read-only GameEvent", async () => {
    const described = await callTool("describe_schema", { domain: "enemyBehaviors" }, {});
    expect(described.enemyBehaviors).toMatchObject({
      authoring: {
        formationCohort: {
          requiredFields: ["members", "steering"],
          optionalFields: ["protection"],
          additionalProperties: false
        },
        formationProtection: {
          requiredFields: ["radius", "sourceKinds"],
          optionalFields: [],
          additionalProperties: false,
          sourceKinds: ["tower", "ability", "tower_script", "status", "reaction", "enemy"]
        },
        limits: {
          protectionRadius: 4,
          protectionSourceKinds: 6,
          protectionCandidatesPerPacket: 16,
          protectionTransactionsPerTick: 512
        }
      },
      snapshot: {
        formations: {
          protection: {
            field: "enemyBehaviors.formations.protection",
            optional: true,
            schemaVersion: 1
          }
        }
      },
      gameEvents: [{
        name: "vanguardDamageIntercepted",
        readOnly: true,
        towerScript: false
      }]
    });
    expect(TOWER_SCRIPT_EVENTS).not.toContain("vanguardDamageIntercepted");
  });

  it("discovers the inert recipe through the existing mechanics collection", async () => {
    const materialized = await callTool("get_recipe", {
      projectDir: path.resolve("examples/starter.tdproj"),
      collection: "mechanics",
      recipeId: "basic_vanguard_protection"
    }, {});
    expect(materialized.recipe).toMatchObject({
      id: "basic_vanguard_protection",
      moduleId: "enemyBehaviors",
      moduleSchemaVersion: 1,
      prerequisites: {
        navigation: { moduleSchemaVersion: 1, mode: "dynamic_flow" },
        combat: { moduleSchemaVersion: 1, enemyRootShields: true },
        enemyBehaviors: { moduleSchemaVersion: 1, formations: true }
      }
    });
  });

  it("teaches agents the guarded workflow and forbids TowerScript or invented writers", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(41);
    for (const phrase of [
      "Vanguard protection v1",
      "basic_vanguard_protection",
      "dynamic_flow",
      "root Combat shield",
      "vanguardDamageIntercepted",
      "read-only GameEvent",
      "snapshot.enemyBehaviors.formations.protection",
      "preview_mechanics_module",
      "apply_mechanics_module",
      "validate_project",
      "16",
      "512"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /vanguardDamageIntercepted[\s\S]*(?:not|never)[\s\S]*(?:TowerScript|Visual Graph)/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).not.toMatch(
      /(?:apply|write|save|analyze)_vanguard_(?:protection|interception)/i
    );
  });
});
