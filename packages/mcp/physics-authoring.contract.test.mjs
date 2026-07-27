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
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r34a-physics-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function tree(rootDir) {
  const entries = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(rootDir, absolute);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) entries.push([relative, fs.readFileSync(absolute).toString("base64")]);
    }
  };
  visit(rootDir);
  return entries;
}

async function rejection(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error("Expected operation to reject.");
}

describe("R3.4a MCP and AI physics authoring contract", () => {
  it("describes physics v1, its events, and no analyzer or TowerScript extension", async () => {
    const physics = await callTool("describe_schema", { domain: "physics" }, {});
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});

    expect(physics).toMatchObject({
      requestedDomain: "physics",
      physics: {
        authoring: {
          moduleId: "physics",
          schemaVersion: 1,
          supportedModuleSchemaVersions: [1],
          limits: {
            displacementDistance: 8,
            displacementEffectsPerSource: 8,
            displacementTargetsPerActivation: 64,
            immuneEnemyTypeIds: 4_096,
            fallHazardTerrainTags: 64,
            idOrTagUtf8Bytes: 128,
            stepsPerEffectApplication: 8,
            stepAttemptsPerActivation: 4_096,
            stepAttemptsPerTick: 32_768
          }
        },
        snapshot: { field: null, optional: true, supportedSchemaVersions: [] },
        events: ["enemyDisplacementResolved", "enemyFell"]
      }
    });
    expect(mechanics.mechanics.implementedModuleIds).toContain("physics");
    expect(mechanics.mechanics.modules.physics).toEqual(physics.physics);
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_physics");
    expect(physics.towerScript?.actions ?? {}).not.toHaveProperty("displaceEnemy");
  });

  it("runs describe/read/recipe/preview/guarded apply/validate and rejects a stale revision", async () => {
    const projectDir = fixture();
    const before = tree(projectDir);
    const capabilities = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(capabilities.capabilities.physics).toMatchObject({ available: true, active: false });

    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "tagged_fall_hazards"
    }, {});
    expect(materialized.recipe.entity).toMatchObject({
      moduleId: "physics",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "tagged_fall_hazards",
      profile: { fallHazardTerrainTags: ["fall_hazard"] }
    });

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      revision: materialized.revision,
      validation: { ok: true, issues: [] },
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: { modules: { physics: { schemaVersion: 1, enabled: true } } },
        balance: { missions: { tutorial_01: { mechanics: { profiles: { physics: "tagged_fall_hazards" } } } } }
      }
    });
    expect(tree(projectDir)).toEqual(before);

    const applied = await callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });
    const validated = await callTool("validate_project", { projectDir }, {});
    expect(validated.ok).toBe(true);
    const reread = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(reread.capabilities.physics).toMatchObject({
      available: true,
      active: true,
      moduleSchemaVersion: 1,
      profileId: "tagged_fall_hazards"
    });

    const stale = await rejection(callTool("apply_mechanics_module", {
      ...request,
      profile: {},
      ifRevision: preview.revision
    }, {}));
    expect(stale).toMatchObject({ code: "conflict" });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8"))
      .modules.physics.profiles.tagged_fall_hazards).toEqual({ fallHazardTerrainTags: ["fall_hazard"] });
  }, 30_000);

  it("teaches the guarded flow, inert recipes, and deferred/forbidden scope", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(16);
    for (const phrase of [
      "basic_displacement_physics",
      "tagged_fall_hazards",
      "displacementImmuneEnemyTypeIds",
      "fallImmuneEnemyTypeIds",
      "fallHazardTerrainTags",
      "stopAtBlocker"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /physics[\s\S]*describe_schema[\s\S]*get_capabilities[\s\S]*get_recipe[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/no analyze_physics|analyze_physics[^.]*not added/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/physics[\s\S]*(?:does not|never|must not)[\s\S]*(?:enable|select|terrain|tower|ability)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/R3\.4b|terraform|flood|moat|bridge/i);

    const skill = fs.readFileSync(PLUGIN_SKILL, "utf8");
    expect(skill).toMatch(/physics v1|tile displacement/i);
    expect(skill).toContain("basic_displacement_physics");
    expect(skill).toContain("tagged_fall_hazards");
    expect(skill).toMatch(/preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*validate_project/i);
  });
});
