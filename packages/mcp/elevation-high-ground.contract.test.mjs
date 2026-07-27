import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const PLUGIN_SKILL = path.resolve("plugins/towerforge/skills/towerforge-authoring/SKILL.md");
const tempProjects = [];
const highGround = Object.freeze({
  maximumEffectiveElevationDelta: 3,
  rangeBonusPerElevation: 1,
  damageBonusBasisPointsPerElevation: 1_000
});

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r33-high-ground-mcp-"));
  tempProjects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);

  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.missions.tutorial_01.mechanics = { profiles: { elevation: "combined" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      elevation: {
        schemaVersion: 3,
        enabled: true,
        profiles: {
          combined: {
            lineOfSight: { terrainBlockerTags: [] },
            highGround
          }
        }
      }
    }
  });
  return projectDir;
}

describe("R3.3 MCP and agent high-ground surface contract", () => {
  it("describes elevation v3 and its exact engine-owned limits without a new analyzer", async () => {
    const elevation = await callTool("describe_schema", { domain: "elevation" }, {});
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});

    expect(elevation.elevation).toMatchObject({
      authoring: {
        moduleId: "elevation",
        schemaVersion: 3,
        supportedModuleSchemaVersions: [1, 2, 3],
        profile: {
          optionalFields: ["lineOfSight", "highGround"],
          versions: {
            1: { optionalFields: [] },
            2: { optionalFields: ["lineOfSight"] },
            3: { optionalFields: ["lineOfSight", "highGround"] }
          },
          highGround: {
            requiredFields: [
              "maximumEffectiveElevationDelta",
              "rangeBonusPerElevation",
              "damageBonusBasisPointsPerElevation"
            ],
            optionalFields: [],
            additionalProperties: false
          }
        },
        limits: {
          highGround: {
            maximumEffectiveElevationDelta: 64,
            rangeBonusPerElevation: 16,
            damageBonusBasisPointsPerElevation: 10_000,
            totalRangeBonus: 64,
            totalDamageBonusBasisPoints: 100_000,
            modifiersPerDamagePacket: 1
          }
        }
      },
      snapshot: { field: "elevation", supportedSchemaVersions: [1] },
      events: []
    });
    expect(mechanics.mechanics.modules.elevation).toEqual(elevation.elevation);
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_high_ground");
  });

  it("returns the selected v3 profile and materializes the inert project-bound recipe", async () => {
    const projectDir = fixture();
    const capabilities = await callTool("get_capabilities", {
      projectDir,
      missionId: "tutorial_01"
    }, {});
    expect(capabilities).toMatchObject({
      revision: expect.any(String),
      capabilities: {
        elevation: {
          available: true,
          active: true,
          moduleSchemaVersion: 3,
          profileId: "combined"
        }
      },
      elevation: {
        authoring: { schemaVersion: 3, supportedModuleSchemaVersions: [1, 2, 3] },
        enabled: true,
        moduleSchemaVersion: 3,
        selectedProfileId: "combined",
        selectedProfile: {
          lineOfSight: { terrainBlockerTags: [] },
          highGround
        }
      }
    });

    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_elevation_high_ground"
    }, {});
    expect(materialized).toMatchObject({
      revision: capabilities.revision,
      recipe: {
        id: "basic_elevation_high_ground",
        moduleSchemaVersion: 3,
        entity: {
          moduleId: "elevation",
          moduleSchemaVersion: 3,
          missionId: "tutorial_01",
          profileId: "basic_elevation_high_ground",
          profile: { highGround }
        }
      },
      nextValidActions: [
        expect.stringMatching(/preview_mechanics_module/),
        expect.stringMatching(/apply_mechanics_module.*ifRevision|preview revision/i),
        "validate_project"
      ]
    });
    expect(materialized.recipe.entity).not.toHaveProperty("enabled");
    expect(JSON.stringify(materialized.recipe)).not.toMatch(/elevationOverrides|mapPatch|missionPatch/);
  });

  it("teaches agents and the bundled plugin the guarded v3 flow and forbidden scope", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(16);
    for (const phrase of [
      "basic_elevation_high_ground",
      "highGround",
      "maximumEffectiveElevationDelta",
      "rangeBonusPerElevation",
      "damageBonusBasisPointsPerElevation"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /highGround[\s\S]*get_capabilities[\s\S]*get_recipe[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /highGround[\s\S]*(?:does not|never|must not)[\s\S]*(?:map|enable|select)/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/no analyze_high_ground|analyze_high_ground[^.]*not added/i);

    const skill = fs.readFileSync(PLUGIN_SKILL, "utf8");
    expect(skill).toContain("basic_elevation_high_ground");
    expect(skill).toMatch(/elevation v3|high[- ]ground/i);
    expect(skill).toMatch(/preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*validate_project/i);
    expect(skill).not.toMatch(/(?:call|use|run)\s+analyze_high_ground/i);
  });
});
