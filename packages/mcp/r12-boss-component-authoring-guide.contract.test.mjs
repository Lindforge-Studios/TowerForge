import { describe, expect, it } from "vitest";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool } from "./tools.mjs";

const RECIPE_ID = "component_driven_boss_phase";

describe("R12.2 component-driven boss phase authoring guide (RED)", () => {
  it("exposes an inert schema-v7 HFSM controller recipe through the existing script descriptor", async () => {
    const described = await callTool("describe_schema", { domain: "scripts" }, {});
    const recipe = described.towerScript.controllerRecipes.find((entry) => entry.id === RECIPE_ID);

    expect(recipe).toEqual({
      id: RECIPE_ID,
      controller: "state_machine",
      schemaVersion: 1,
      minimumTowerScriptSchemaVersion: 7,
      parameters: {
        enemyTypeId: "existing composite enemy type id",
        componentId: "existing component id from the mission-selected enemyBehaviors profile"
      },
      template: {
        schemaVersion: 1,
        id: "component_phase",
        bindings: [{ scope: "enemy", ids: ["$enemyTypeId"] }],
        initial: "intact",
        states: [
          {
            id: "intact",
            transitions: [{
              id: "component_destroyed",
              event: "bossComponentDestroyed",
              target: "/exposed",
              when: { $op: "eq", args: [{ $get: "component.id" }, "$componentId"] }
            }]
          },
          { id: "exposed" }
        ]
      }
    });
  });

  it("documents the exact descriptor/read/preview/guarded-apply/validate/trace workflow", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBe(39);
    for (const phrase of [
      "component_driven_boss_phase",
      "bossComponentDamaged",
      "bossComponentDestroyed",
      "component.id",
      "TowerScript schema v7",
      "Graph v2",
      "preview_tower_script_trace",
      "transition provenance",
      "get_tower_script",
      "upsert_tower_script",
      "validate_project"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /describe_schema[\s\S]*scripts[\s\S]*get_tower_script[\s\S]*upsert_tower_script[\s\S]*dryRun:true[\s\S]*ifRevision[\s\S]*validate_project[\s\S]*preview_tower_script_trace/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/Graph v2[\s\S]*(?:no new|existing)[\s\S]*(?:grammar|node)/i);
  });
});
