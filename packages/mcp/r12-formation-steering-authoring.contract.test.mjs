import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r12-formations-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

describe("R12.3 formation steering MCP/AI authoring surface (RED)", () => {
  it("describes the closed formations vocabulary, roles, budgets, and active-only snapshot section", async () => {
    const described = await callTool("describe_schema", { domain: "enemyBehaviors" }, {});
    expect(described.enemyBehaviors).toMatchObject({
      authoring: {
        profile: {
          optionalFields: ["bosses", "targeting", "formations"],
          atLeastOneFields: ["bosses", "formations"]
        },
        formations: { requiredFields: ["cohorts"], optionalFields: [], additionalProperties: false },
        formationCohort: {
          requiredFields: ["members", "steering"], optionalFields: [], additionalProperties: false
        },
        formationSteering: {
          requiredFields: ["neighborRadius", "cohesionWeight", "separationWeight", "roleWeight"],
          optionalFields: [], additionalProperties: false
        },
        formationRoles: ["vanguard", "body", "support"],
        limits: {
          cohortsPerProfile: 64,
          membersPerCohort: 256,
          formationAssignmentsPerProfile: 4096,
          neighborRadius: 2,
          steeringWeight: 1000
        }
      },
      snapshot: {
        field: "enemyBehaviors",
        optional: true,
        supportedSchemaVersions: [1],
        formations: {
          field: "enemyBehaviors.formations",
          optional: true,
          schemaVersion: 1,
          roles: ["vanguard", "body", "support"]
        }
      },
      commands: []
    });
  });

  it("uses the existing recipe -> preview -> guarded apply transaction and rejects stale revisions", async () => {
    const projectDir = fixture();
    const navigationRecipe = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "basic_dynamic_navigation"
    }, {});
    const navigationEntity = structuredClone(navigationRecipe.recipe.entity);
    navigationEntity.profile.enemyMovementProfiles = {
      armored_brute: "ground", basic_grunt: "ground", swift_runner: "ground"
    };
    const navigationPreview = await callTool("preview_mechanics_module", {
      projectDir, ...navigationEntity, enabled: true
    }, {});
    expect(navigationPreview).toMatchObject({ ok: true, dryRun: true, validation: { ok: true } });
    await callTool("apply_mechanics_module", {
      projectDir, ...navigationEntity, enabled: true, ifRevision: navigationPreview.revision
    }, {});

    const beforeRecipe = fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8");
    const materialized = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "basic_formation_steering"
    }, {});
    expect(materialized.recipe.entity).toMatchObject({
      moduleId: "enemyBehaviors",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profile: { formations: { cohorts: { main: { members: expect.any(Object) } } } }
    });
    expect(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")).toBe(beforeRecipe);

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false, validation: { ok: true } });
    const applied = await callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });

    await expect(callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {})).rejects.toMatchObject({ code: "conflict" });
  }, 30_000);

  it("teaches agents the dependency and authoritative snapshot workflow without inventing steering tools", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(40);
    for (const phrase of [
      "Enemy formations v1",
      "basic_formation_steering",
      "dynamic_flow",
      "vanguard",
      "body",
      "support",
      "snapshot.enemyBehaviors.formations",
      "preview_mechanics_module",
      "apply_mechanics_module",
      "validate_project"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/formation[\s\S]*(?:never|do not)[\s\S]*(?:derive|recompute)[\s\S]*steering/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).not.toContain("analyze_formation_steering");
  });
});
