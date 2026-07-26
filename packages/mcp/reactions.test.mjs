import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEngine } from "../cli/lib/project-loader.mjs";
import { TOOLS, callTool } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const tempProjects = [];

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function reactionReadyProject() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mcp-reactions-"));
  tempProjects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });

  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.missions.tutorial_01.mechanics = { profiles: { combat: "elemental" } };
  balance.terrainTypes ??= {};
  balance.terrainTypes.water = {
    id: "water",
    label: "Water",
    buildable: false,
    walkable: true,
    groundSpeedMultiplier: 0.6,
    tags: ["water", "wet"]
  };
  writeJson(balancePath, balance);

  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      combat: {
        schemaVersion: 3,
        enabled: true,
        profiles: {
          elemental: {
            damageTypes: {
              physical: { label: "Physical" },
              fire: { label: "Fire" },
              ice: { label: "Ice" },
              lightning: { label: "Lightning" }
            }
          }
        }
      }
    }
  });
  return projectDir;
}

describe("R1.5 reactions MCP/AI surface", () => {
  it("discovers reactions v1, independent reaction state, limits, and the v5 reaction vocabulary", async () => {
    const engine = await loadEngine();
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});
    const reactions = await callTool("describe_schema", { domain: "reactions" }, {});

    expect(engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toEqual(["combat", "reactions", "navigation", "elevation", "physics", "terraforming", "roguelite"]);
    expect(engine.REACTION_LIMITS).toEqual({
      exposureDefinitions: 256,
      damageTypeApplicationBindings: 256,
      applicationsPerDamageType: 16,
      totalExposureApplications: 4096,
      reactionDefinitions: 256,
      requirementsPerReaction: 8,
      effectsPerReaction: 8,
      totalReactionEffects: 2048,
      runtimeExposureApplications: 16384,
      labelLength: 128,
      idTagUtf8Bytes: 128,
      duration: 1_000_000_000,
      maxStacks: 256,
      flatDamage: 1_000_000_000_000,
      sourceMultiplier: 1_000_000,
      radius: 64,
      targetsPerEffect: 64,
      maxDepth: 4,
      secondaryPacketsPerRoot: 256
    });
    expect(engine.REACTIONS_MECHANICS_SCHEMA).toMatchObject({
      moduleId: "reactions",
      schemaVersion: 1,
      supportedModuleSchemaVersions: [1],
      dependency: { moduleId: "combat", supportedModuleSchemaVersions: [2, 3] },
      limits: engine.REACTION_LIMITS
    });
    expect(mechanics.mechanics.implementedModuleIds).toEqual(["combat", "reactions", "navigation", "elevation", "physics", "terraforming", "roguelite"]);
    expect(mechanics.mechanics.modules.reactions).toMatchObject({
      authoring: engine.REACTIONS_MECHANICS_SCHEMA,
      snapshot: { field: "reactions", optional: true, supportedSchemaVersions: [1] },
      events: ["enemyExposureChanged", "enemyReactionTriggered", "reactionBudgetExceeded"]
    });
    expect(reactions.requestedDomain).toBe("reactions");
    expect(reactions.reactions).toEqual(mechanics.mechanics.modules.reactions);
    expect(reactions.towerScript.schemaVersion).toBe(6);
    expect(reactions.towerScript.actions.applyEnemyExposure).toBeTruthy();
    expect(reactions.towerScript.actions.clearEnemyExposure).toBeTruthy();
    expect(reactions.towerScript.events).toEqual(expect.arrayContaining([
      "enemyExposureChanged", "enemyReactionTriggered"
    ]));
    expect(TOOLS.find((tool) => tool.name === "get_capabilities")).toMatchObject({
      riskClass: "read_only", sideEffect: "none"
    });
    expect(TOOLS.find((tool) => tool.name === "preview_mechanics_module")).toMatchObject({
      riskClass: "read_only", sideEffect: "none"
    });
    expect(TOOLS.find((tool) => tool.name === "apply_mechanics_module")).toMatchObject({
      riskClass: "write_local",
      sideEffect: expect.stringMatching(/revision|validation|backup|rollback/i)
    });
  });

  it("materializes all three project-bound recipes and completes the guarded reactions lifecycle", async () => {
    const projectDir = reactionReadyProject();
    const listed = await callTool("list_recipes", { collection: "mechanics" }, {});
    expect(listed.recipes.map((recipe) => recipe.id)).toEqual(expect.arrayContaining([
      "elemental_shatter", "wet_chain_shock", "poison_combustion"
    ]));

    for (const recipeId of ["elemental_shatter", "wet_chain_shock", "poison_combustion"]) {
      const materialized = await callTool("get_recipe", {
        projectDir, collection: "mechanics", recipeId
      }, {});
      expect(materialized.recipe).toMatchObject({
        unmetPrerequisites: [],
        entity: {
          moduleId: "reactions",
          moduleSchemaVersion: 1,
          missionId: "tutorial_01",
          profileId: recipeId,
          enabled: true
        }
      });
    }

    const materialized = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "elemental_shatter"
    }, {});
    const request = { projectDir, ...materialized.recipe.entity };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      revision: materialized.revision,
      validation: { ok: true, issues: [] }
    });
    expect(preview.candidate.mechanics.modules.combat.schemaVersion).toBe(3);
    expect(preview.candidate.mechanics.modules.reactions).toEqual({
      schemaVersion: 1,
      enabled: true,
      profiles: { elemental_shatter: materialized.recipe.entity.profile }
    });
    expect(preview.candidate.balance.missions.tutorial_01.mechanics.profiles).toEqual({
      combat: "elemental", reactions: "elemental_shatter"
    });

    const applied = await callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    const capabilities = await callTool("get_capabilities", {
      projectDir, missionId: "tutorial_01"
    }, {});
    expect(capabilities).toMatchObject({
      reactions: {
        enabled: true,
        moduleSchemaVersion: 1,
        selectedProfileId: "elemental_shatter",
        selectedProfile: materialized.recipe.entity.profile
      },
      capabilities: { reactions: { active: true, reason: "active" } }
    });
    expect(await callTool("validate_project", { projectDir }, {}))
      .toMatchObject({ ok: true, issues: [] });

    const stale = await callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {}).catch((error) => error);
    expect(stale).toMatchObject({ code: "conflict" });
  });

  it("reports recipe prerequisites and refuses a partial write when wet is unavailable", async () => {
    const projectDir = reactionReadyProject();
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.terrainTypes.water.tags = ["water"];
    writeJson(balancePath, balance);
    const before = fs.readFileSync(path.join(projectDir, "content", "mechanics.json"));

    const materialized = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "wet_chain_shock"
    }, {});
    expect(materialized.recipe.unmetPrerequisites).toContainEqual(expect.objectContaining({
      code: "reaction_terrain_tag_missing", terrainTag: "wet"
    }));
    const rejected = await callTool("preview_mechanics_module", {
      projectDir, ...materialized.recipe.entity
    }, {}).catch((error) => error);
    expect(rejected).toMatchObject({ code: "reaction_terrain_tag_missing" });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")))
      .toEqual(JSON.parse(before.toString("utf8")));
  });

  it("[verifier] preserves the missing damage-type prerequisite code at the AI boundary", async () => {
    const projectDir = reactionReadyProject();
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const mechanics = JSON.parse(fs.readFileSync(mechanicsPath, "utf8"));
    delete mechanics.modules.combat.profiles.elemental.damageTypes.lightning;
    writeJson(mechanicsPath, mechanics);

    const materialized = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "wet_chain_shock"
    }, {});
    expect(materialized.recipe.unmetPrerequisites).toContainEqual(expect.objectContaining({
      code: "reaction_damage_type_missing", damageTypeId: "lightning"
    }));
    const rejected = await callTool("preview_mechanics_module", {
      projectDir, ...materialized.recipe.entity
    }, {}).catch((error) => error);

    expect(rejected).toMatchObject({ code: "reaction_damage_type_missing" });
  });

  it("[verifier] preserves the dependency_missing validation code at the AI boundary", async () => {
    const projectDir = reactionReadyProject();
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    delete balance.missions.tutorial_01.mechanics.profiles.combat;
    writeJson(balancePath, balance);

    const materialized = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "elemental_shatter"
    }, {});
    const rejected = await callTool("preview_mechanics_module", {
      projectDir, ...materialized.recipe.entity
    }, {}).catch((error) => error);

    expect(rejected).toMatchObject({ code: "dependency_missing" });
  });
});
