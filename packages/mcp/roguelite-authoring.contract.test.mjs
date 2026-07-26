import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { loadEngine, readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const tempProjects = [];

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r41a-roguelite-mcp-"));
  tempProjects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.towers.arrow_tower.tags = ["sniper"];
  writeJson(balancePath, balance);
  return projectDir;
}

describe("R4.1A/R4.2E roguelite MCP and AI authoring contract", () => {
  it("describes v1-v4 runtime state and preserves exact v2 artifact management commands for AI agents", async () => {
    const engine = await loadEngine();
    const projectDir = fixture();
    const roguelite = await callTool("describe_schema", { domain: "roguelite" }, {});
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});
    const capabilities = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});

    expect(roguelite).toMatchObject({
      schemaVersion: 4,
      requestedDomain: "roguelite",
      roguelite: {
        authoring: engine.ROGUELITE_MECHANICS_SCHEMA,
        snapshot: { field: "roguelite", optional: true, supportedSchemaVersions: [1, 2, 3, 4] },
        events: ["artifactDropped", "artifactSocketed", "artifactUnsocketed"],
        commands: {
          schemaVersion: 3,
          phase: "between",
          socketArtifact: {
            requiredFields: ["artifactInstanceId", "towerId", "slotId"],
            optionalFields: [],
            additionalProperties: false
          },
          unsocketArtifact: {
            requiredFields: ["artifactInstanceId", "towerId", "slotId"],
            optionalFields: [],
            additionalProperties: false
          }
        }
      }
    });
    expect(mechanics.mechanics.modules.roguelite).toEqual(roguelite.roguelite);
    expect(capabilities).toMatchObject({
      capabilities: { roguelite: { available: true, active: false, reason: "module_missing" } },
      roguelite: {
        authoring: engine.ROGUELITE_MECHANICS_SCHEMA,
        enabled: false,
        towerTagsByTowerId: { arrow_tower: ["sniper"] }
      }
    });
  });

  it("describes v3 draft authoring, the v4 snapshot, and exact chooseDraftOption command without a new writer", async () => {
    const engine = await loadEngine();
    const roguelite = await callTool("describe_schema", { domain: "roguelite" }, {});

    expect(roguelite).toMatchObject({
      schemaVersion: 4,
      requestedDomain: "roguelite",
      roguelite: {
        authoring: engine.ROGUELITE_MECHANICS_SCHEMA,
        snapshot: { field: "roguelite", optional: true, supportedSchemaVersions: [1, 2, 3, 4] },
        commands: {
          schemaVersion: 3,
          chooseDraftOption: {
            requiredFields: ["offerId", "cardId"],
            optionalFields: [],
            additionalProperties: false
          }
        }
      }
    });
    expect(roguelite.roguelite.authoring).toMatchObject({
      schemaVersion: 4,
      supportedModuleSchemaVersions: [1, 2, 3, 4],
      profileVersions: {
        3: { requiredFields: ["synergies"], optionalFields: ["artifacts", "draft"] },
        4: { requiredFields: ["synergies"], optionalFields: ["artifacts", "draft", "campaign"] }
      }
    });
    expect(TOOLS.map((tool) => tool.name)).not.toContain("apply_roguelite_draft");
    for (const toolName of ["preview_mechanics_module", "apply_mechanics_module"]) {
      expect(TOOLS.find((tool) => tool.name === toolName)?.inputSchema.properties.moduleSchemaVersion.enum)
        .toContain(3);
    }
  });

  it("materializes detached boss loot and applies its v2 profile only through the guarded transaction", async () => {
    const projectDir = fixture();
    const before = ["project.json", "content/mechanics.json", "content/balance.json"].map((relativePath) => {
      const filePath = path.join(projectDir, relativePath);
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
    });

    const listed = await callTool("list_recipes", { collection: "mechanics" }, {});
    const listedRecipe = listed.recipes.find((recipe) => recipe.id === "basic_boss_artifact_loot");
    expect(listedRecipe?.parameterSchema).toEqual({
      type: "object",
      properties: {
        towerTypeIds: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 128 },
          minItems: 1,
          maxItems: 16,
          uniqueItems: true
        },
        bossEnemyTypeId: { type: "string", minLength: 1, maxLength: 128 }
      },
      required: ["towerTypeIds", "bossEnemyTypeId"],
      additionalProperties: false
    });

    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_boss_artifact_loot",
      parameters: {
        towerTypeIds: ["arrow_tower"],
        bossEnemyTypeId: "armored_brute"
      }
    }, {});
    expect(materialized.recipe).toMatchObject({
      moduleId: "roguelite",
      moduleSchemaVersion: 2,
      entity: {
        moduleId: "roguelite",
        moduleSchemaVersion: 2,
        profileId: "basic_boss_artifact_loot",
        profile: {
          synergies: {},
          artifacts: {
            definitions: {
              boss_trophy: {
                label: "Boss Trophy",
                slotType: "core",
                modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.1 }]
              }
            },
            towerSlots: {
              arrow_tower: [{ slotId: "core", slotType: "core" }]
            },
            bossLootTables: {
              armored_brute: {
                rolls: 1,
                entries: [{ artifactId: "boss_trophy", weight: 1 }]
              }
            }
          }
        }
      }
    });
    expect(materialized.recipe.entity).not.toHaveProperty("enabled");
    expect(materialized.recipe.entity).not.toHaveProperty("missionId");
    expect(["project.json", "content/mechanics.json", "content/balance.json"].map((relativePath) => {
      const filePath = path.join(projectDir, relativePath);
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
    })).toEqual(before);

    const request = {
      projectDir,
      ...materialized.recipe.entity,
      missionId: "tutorial_01",
      enabled: true
    };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(preview.candidate.mechanics.modules.roguelite).toEqual({
      schemaVersion: 2,
      enabled: true,
      profiles: { basic_boss_artifact_loot: materialized.recipe.entity.profile }
    });
    const applied = await callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, written: true, rolledBack: false });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")))
      .toEqual(preview.candidate.mechanics);
  });

  it("advertises the parameterized inert recipe and forwards towerTags through guarded preview/apply", async () => {
    const projectDir = fixture();
    const getRecipe = TOOLS.find((tool) => tool.name === "get_recipe");
    expect(JSON.stringify(getRecipe.inputSchema.properties.parameters)).toContain("towerTypeIds");
    for (const toolName of ["preview_mechanics_module", "apply_mechanics_module"]) {
      expect(TOOLS.find((tool) => tool.name === toolName).inputSchema.properties.towerTags).toMatchObject({
        type: "object"
      });
    }

    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_elemental_synergy",
      parameters: { towerTypeIds: ["arrow_tower", "cannon_tower"] }
    }, {});
    expect(materialized.recipe).toMatchObject({
      moduleId: "roguelite",
      entity: {
        moduleId: "roguelite",
        profileId: "basic_elemental_synergy",
        towerTags: {
          arrow_tower: ["elemental", "sniper"],
          cannon_tower: ["elemental"]
        }
      }
    });
    expect(materialized.recipe.entity).not.toHaveProperty("enabled");

    const request = {
      projectDir,
      ...materialized.recipe.entity,
      missionId: "tutorial_01",
      enabled: true
    };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview.candidate.balance.towers.arrow_tower.tags).toEqual(["elemental", "sniper"]);
    expect(preview.candidate.balance.towers.cannon_tower.tags).toEqual(["elemental"]);
    const applied = await callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, written: true });

    const persisted = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    expect(persisted.towers.arrow_tower.tags).toEqual(["elemental", "sniper"]);
    expect(persisted.towers.cannon_tower.tags).toEqual(["elemental"]);
  });

  it("documents the complete opt-in AI flow and never invents a dedicated analyzer", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(16);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /roguelite[\s\S]*describe_schema[\s\S]*get_capabilities[\s\S]*get_recipe[\s\S]*basic_elemental_synergy[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/towerTypeIds[\s\S]*towerTags/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/inert|never auto[- ]?enable|does not enable/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/wave draft[\s\S]*GameCommand v3[\s\S]*chooseDraftOption/i);
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_roguelite");
  });
});
