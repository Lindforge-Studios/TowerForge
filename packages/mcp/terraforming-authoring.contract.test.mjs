import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEngine, readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const RECIPE_IDS = Object.freeze([
  "tagged_flood",
  "tagged_moat",
  "tagged_destructible_bridge"
]);
const DEFAULT_TRANSITION_IDS = Object.freeze({
  tagged_flood: "flood",
  tagged_moat: "moat",
  tagged_destructible_bridge: "destroy_bridge"
});
const PARAMETER_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    sourceTerrainTag: { type: "string" },
    destinationTerrainId: { type: "string" },
    transitionId: { type: "string" }
  },
  required: ["sourceTerrainTag", "destinationTerrainId"],
  additionalProperties: false
});
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r34b-terraforming-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.terrainTypes = {
    path: {
      id: "path",
      label: "Path",
      buildable: false,
      walkable: true,
      groundSpeedMultiplier: 1,
      tags: ["path", "mutable_path"]
    },
    water: {
      id: "water",
      label: "Water",
      buildable: false,
      walkable: true,
      groundSpeedMultiplier: 0.6,
      tags: ["water"]
    }
  };
  writeJson(balancePath, balance);
  return projectDir;
}

function inactiveInvalidFixture() {
  const projectDir = fixture();
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.missions.tutorial_01.mechanics = { profiles: { terraforming: "broken" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      terraforming: {
        schemaVersion: 1,
        enabled: false,
        profiles: {
          broken: {
            terrainTransitions: {
              flood: {
                fromTerrainTags: ["missing_source_tag"],
                toTerrainId: "missing_destination"
              }
            }
          }
        }
      }
    }
  });
  return projectDir;
}

function snapshotTree(rootDir) {
  const entries = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => (
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ))) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(rootDir, absolutePath);
      if (entry.isDirectory()) {
        entries.push({ path: `${relativePath}/`, type: "directory" });
        visit(absolutePath);
      } else if (entry.isFile()) {
        entries.push({ path: relativePath, type: "file", contents: fs.readFileSync(absolutePath).toString("base64") });
      } else entries.push({ path: relativePath, type: "other" });
    }
  };
  visit(rootDir);
  return entries;
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject.");
}

function scriptFromSnippet(snippet) {
  return {
    schemaVersion: snippet.minimumSchemaVersion,
    id: "agent_tagged_flood",
    enabled: true,
    bindings: [{ scope: "global" }],
    handlers: {
      enemyEnteredTile: [{
        id: "flood_entered_tile",
        actions: [snippet.action]
      }]
    }
  };
}

describe("R3.4b C5A MCP and AI terraforming authoring contract", () => {
  it("projects the exact engine terraforming and TowerScript descriptors without a new analyzer", async () => {
    const engine = await loadEngine();
    const terraforming = await callTool("describe_schema", { domain: "terraforming" }, {});
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});

    expect(terraforming).toMatchObject({
      schemaVersion: 5,
      requestedDomain: "terraforming",
      terraforming: {
        authoring: engine.TERRAFORMING_MECHANICS_SCHEMA,
        snapshot: { field: "terraforming", optional: true, supportedSchemaVersions: [1] },
        events: ["terrainChanged", "elevationChanged"]
      }
    });
    expect(terraforming.terraforming.authoring).toEqual(engine.TERRAFORMING_MECHANICS_SCHEMA);
    expect(terraforming.towerScript).toEqual(engine.TOWER_SCRIPT_SCHEMA);
    expect(terraforming.terraforming.events).not.toContain("waterAbilityUsed");
    expect(mechanics.mechanics.modules.terraforming).toEqual(terraforming.terraforming);

    const names = TOOLS.map((tool) => tool.name);
    for (const deferredTool of [
      "analyze_terraforming",
      "preview_terraforming",
      "apply_terraforming",
      "render_terraforming",
      "edit_terraforming_studio"
    ]) expect(names).not.toContain(deferredTool);
  });

  it("returns a versioned compact terraforming capability view without writing legacy projects", async () => {
    const engine = await loadEngine();
    const projectDir = fixture();
    const before = snapshotTree(projectDir);

    const result = await callTool("get_capabilities", {
      projectDir,
      missionId: "tutorial_01"
    }, {});

    expect(result).toMatchObject({
      schemaVersion: 1,
      revision: expect.any(String),
      rawProjectSchemaVersion: 2,
      mechanicsAuthored: false,
      missionId: "tutorial_01",
      capabilities: {
        terraforming: {
          available: true,
          moduleEnabled: false,
          active: false,
          reason: "module_missing"
        }
      },
      terraforming: {
        authoring: engine.TERRAFORMING_MECHANICS_SCHEMA,
        enabled: false,
        profileIds: [],
        profileUses: {}
      }
    });
    expect(result.terraforming).not.toHaveProperty("selectedProfileId");
    expect(result.terraforming).not.toHaveProperty("selectedProfile");
    expect(snapshotTree(projectDir)).toEqual(before);
    expect(TOOLS.find((tool) => tool.name === "get_capabilities")).toMatchObject({
      riskClass: "read_only",
      sideEffect: "none"
    });
  });

  it("advertises exactly three parameterized inert recipes and materializes their exact detached candidates", async () => {
    const projectDir = fixture();
    const before = snapshotTree(projectDir);
    const getRecipe = TOOLS.find((tool) => tool.name === "get_recipe");
    expect(getRecipe.inputSchema.properties.parameters.oneOf).toContainEqual(PARAMETER_SCHEMA);
    expect(getRecipe.inputSchema.required).not.toContain("parameters");

    const listed = await callTool("list_recipes", { collection: "mechanics" }, {});
    const terraformingRecipes = listed.recipes.filter((recipe) => recipe.moduleId === "terraforming");
    expect(terraformingRecipes.map((recipe) => recipe.id)).toEqual(RECIPE_IDS);
    for (const recipe of terraformingRecipes) expect(recipe.parameterSchema).toEqual(PARAMETER_SCHEMA);

    for (const recipeId of RECIPE_IDS) {
      const transitionId = DEFAULT_TRANSITION_IDS[recipeId];
      const materialized = await callTool("get_recipe", {
        projectDir,
        collection: "mechanics",
        recipeId,
        parameters: {
          sourceTerrainTag: "mutable_path",
          destinationTerrainId: "water"
        }
      }, {});
      expect(materialized.recipe).toMatchObject({
        id: recipeId,
        moduleId: "terraforming",
        moduleSchemaVersion: 1,
        parameterSchema: PARAMETER_SCHEMA,
        entity: {
          moduleId: "terraforming",
          moduleSchemaVersion: 1,
          profileId: recipeId,
          profile: {
            terrainTransitions: {
              [transitionId]: {
                fromTerrainTags: ["mutable_path"],
                toTerrainId: "water"
              }
            }
          }
        },
        towerScriptSnippet: {
          minimumSchemaVersion: 6,
          action: {
            action: "terraformTiles",
            operations: [{ kind: "set_terrain", target: "eventTile", transitionId }]
          }
        }
      });
      expect(materialized.recipe.entity).not.toHaveProperty("enabled");
      expect(materialized.recipe.entity).not.toHaveProperty("missionId");
      expect(materialized.nextValidActions).toEqual([
        expect.stringMatching(/preview_mechanics_module/),
        expect.stringMatching(/apply_mechanics_module.*ifRevision|preview revision/i),
        expect.stringMatching(/upsert_tower_script/),
        "validate_project"
      ]);
      expect(materialized.nextValidActions[0]).toMatch(
        /^preview_mechanics_module\b.*\bmissionId\b.*\benabled:true\b/i
      );
    }
    expect(snapshotTree(projectDir)).toEqual(before);
  });

  it("keeps recipe parameters closed and rejects missing or invented authored references", async () => {
    const projectDir = fixture();
    const common = { projectDir, collection: "mechanics", recipeId: "tagged_flood" };
    const cases = [
      [{ ...common }, /parameters|sourceTerrainTag|destinationTerrainId|required/i],
      [{ ...common, parameters: { sourceTerrainTag: "mutable_path", destinationTerrainId: "water", extra: true } }, /parameters|extra|closed|unknown/i],
      [{ ...common, parameters: { sourceTerrainTag: "invented_tag", destinationTerrainId: "water" } }, /sourceTerrainTag|invented_tag|terrain tag|unknown/i],
      [{ ...common, parameters: { sourceTerrainTag: "mutable_path", destinationTerrainId: "invented_terrain" } }, /destinationTerrainId|invented_terrain|terrain|unknown/i]
    ];
    for (const [args, message] of cases) {
      await expect(callTool("get_recipe", args, {})).rejects.toThrow(message);
    }
  });

  it.each([
    ["enemies", "grunt"],
    ["towers", "sniper"],
    ["missions", "classic"],
    ["mechanics", "basic_displacement_physics"]
  ])("fails closed when get_recipe receives parameters for non-terraform recipe %s/%s", async (collection, recipeId) => {
    const projectDir = fixture();
    await expect(callTool("get_recipe", {
      projectDir,
      collection,
      recipeId,
      parameters: {
        sourceTerrainTag: "mutable_path",
        destinationTerrainId: "water"
      }
    }, {})).rejects.toMatchObject({ code: "terraform_recipe_parameter_invalid" });
  });

  it("completes mechanics then TowerScript authoring with independent guarded revisions", async () => {
    const projectDir = fixture();
    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "tagged_flood",
      parameters: {
        sourceTerrainTag: "mutable_path",
        destinationTerrainId: "water",
        transitionId: "agent_flood"
      }
    }, {});
    const request = {
      projectDir,
      missionId: "tutorial_01",
      ...materialized.recipe.entity
    };
    expect(request).toMatchObject({ missionId: "tutorial_01" });

    const scriptsBefore = (await callTool("get_project_summary", { projectDir }, {})).revisions.scripts;
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      revision: materialized.revision,
      validation: { ok: true, issues: [] },
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: { modules: { terraforming: { schemaVersion: 1, enabled: true } } },
        balance: { missions: { tutorial_01: { mechanics: { profiles: { terraforming: "tagged_flood" } } } } }
      }
    });
    const applied = await callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });

    const staleMechanics = await rejection(callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {}));
    expect(staleMechanics).toMatchObject({ code: "conflict" });

    const afterMechanics = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(afterMechanics).toMatchObject({
      capabilities: {
        terraforming: {
          available: true,
          active: true,
          moduleSchemaVersion: 1,
          profileId: "tagged_flood"
        }
      },
      terraforming: {
        enabled: true,
        moduleSchemaVersion: 1,
        selectedProfileId: "tagged_flood",
        selectedProfile: materialized.recipe.entity.profile
      }
    });

    const script = scriptFromSnippet(materialized.recipe.towerScriptSnippet);
    const scriptPath = "scripts/gameplay/agent-tagged-flood.tower.json";
    const scriptPreview = await callTool("upsert_tower_script", {
      projectDir,
      path: scriptPath,
      script,
      dryRun: true,
      ifRevision: scriptsBefore
    }, {});
    expect(scriptPreview).toMatchObject({ ok: true, dryRun: true, written: false });
    const scriptApplied = await callTool("upsert_tower_script", {
      projectDir,
      path: scriptPath,
      script,
      ifRevision: scriptPreview.revision
    }, {});
    expect(scriptApplied).toMatchObject({ ok: true, written: true, scriptId: "agent_tagged_flood" });
    const staleScript = await callTool("upsert_tower_script", {
      projectDir,
      path: scriptPath,
      script,
      ifRevision: scriptPreview.revision
    }, {});
    expect(staleScript).toMatchObject({ ok: false, conflict: true, written: false });

    const afterScript = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(afterScript.revision).toBe(afterMechanics.revision);
    expect((await callTool("validate_project", { projectDir }, {})).ok).toBe(true);
  });

  it("keeps broken disabled terraforming references as warnings and promotes them to active errors", async () => {
    const projectDir = inactiveInvalidFixture();
    const before = snapshotTree(projectDir);
    const inactive = await callTool("preview_mechanics_module", {
      projectDir,
      moduleId: "terraforming",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      enabled: false
    }, {});
    expect(inactive.ok).toBe(true);
    expect(inactive.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", fieldPath: expect.stringMatching(/terraforming.*fromTerrainTags/i) }),
      expect.objectContaining({ severity: "warning", fieldPath: expect.stringMatching(/terraforming.*toTerrainId/i) })
    ]));
    expect(inactive.validation.issues.some((issue) => issue.severity === "error")).toBe(false);

    const active = await rejection(callTool("preview_mechanics_module", {
      projectDir,
      moduleId: "terraforming",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "broken",
      enabled: true
    }, {}));
    expect(active).toMatchObject({ code: "validation" });
    expect(active.message).toMatch(/unknown terrain|unknown terrain tag|missing_source_tag|missing_destination/i);
    expect(snapshotTree(projectDir)).toEqual(before);
  });

  it("preserves the terraforming safe AI order in the additive guide and enforces workspace-bound project selection", async () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(16);
    for (const phrase of [
      "tagged_flood",
      "tagged_moat",
      "tagged_destructible_bridge",
      "sourceTerrainTag",
      "destinationTerrainId",
      "transitionId",
      "terraformTiles",
      "upsert_tower_script"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /describe_schema[^.]*terraforming[\s\S]*get_capabilities[\s\S]*get_recipe[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*upsert_tower_script[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /terraforming[\s\S]*(?:inert|never|must not|does not)[\s\S]*(?:enable|select|write|map|terrain)/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/no analyze_terraforming|analyze_terraforming[^.]*not added/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/never supply or request an absolute projectDir/i);

    const projectDir = fixture();
    const context = {
      defaultProjectDir: projectDir,
      forceDefaultProject: true,
      allowedProjectRoots: [path.dirname(projectDir)]
    };
    await expect(callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, context))
      .rejects.toThrow(/projectDir is not accepted in workspace-bound mode/i);
    const selected = await callTool("get_capabilities", { missionId: "tutorial_01" }, context);
    expect(selected.missionId).toBe("tutorial_01");
  });
});
