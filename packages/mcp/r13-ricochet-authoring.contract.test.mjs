import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { materializeMechanicsRecipe } from "../cli/lib/mechanics-recipes.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r13-ricochet-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

describe("R13.3 MCP/AI ricochet authoring (RED)", () => {
  it("describes the closed surfaces/binding vocabulary, exact limits, checkpoint v3, and event", async () => {
    const described = await callTool("describe_schema", { domain: "ballistics" }, {});
    expect(described).toMatchObject({
      requestedDomain: "ballistics",
      ballistics: {
        authoring: {
          moduleId: "ballistics", schemaVersion: 1,
          projectiles: {
            requiredFields: ["towers"], optionalFields: ["clearance", "ricochet", "destructibles"],
            additionalProperties: false
          },
          ricochet: {
            requiredFields: [], optionalFields: ["terrainTags", "armorTypes"],
            additionalProperties: false,
            surfaceRecord: { kind: "record", value: { const: true } },
            limits: {
              terrainSurfaceTags: 64, armorTypeSurfaces: 64, maxBouncesPerProjectile: 4,
              maximumReflectedRayDistance: 256, enemyCandidatesPerCell: 16,
              ricochetsPerTick: 4096, cellInspectionsPerTick: 1_048_576,
              surfaceIdUtf8Bytes: 128
            }
          },
          towerBinding: {
            requiredFields: ["trajectory", "travelTimeUnits"],
            optionalFields: ["maxAltitude", "ricochet"], additionalProperties: false
          },
          towerRicochet: {
            requiredFields: ["maxBounces", "rangeCells"], optionalFields: [],
            additionalProperties: false
          }
        },
        checkpoint: {
          field: "ballistics", optional: true, supportedSchemaVersions: [1, 2, 3, 4],
          clearanceCollisionSchemaVersion: 1, ricochetCheckpointSchemaVersion: 1
        },
        events: expect.arrayContaining(["projectileMissed", "projectileBlocked", "projectileRicocheted"]),
        commands: []
      }
    });
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_ballistics");
  }, 30_000);

  it("materializes an inert bounded ricochet recipe and completes the guarded workflow", async () => {
    const projectDir = fixture();
    const before = fs.existsSync(path.join(projectDir, "content", "mechanics.json"))
      ? fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")
      : null;
    const materialized = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "basic_projectile_ricochet"
    }, {});
    expect(materialized.recipe).toMatchObject({
      id: "basic_projectile_ricochet", moduleId: "ballistics", moduleSchemaVersion: 1,
      entity: {
        moduleId: "ballistics", moduleSchemaVersion: 1, missionId: "tutorial_01",
        profileId: "basic_projectile_ricochet",
        profile: {
          projectiles: {
            towers: expect.any(Object),
            clearance: { terrainBlockerHeights: expect.any(Object) },
            ricochet: { terrainTags: expect.any(Object) }
          }
        }
      }
    });
    const profile = materialized.recipe.entity.profile;
    expect(Object.keys(profile.projectiles.towers)).toHaveLength(1);
    expect(Object.values(profile.projectiles.towers)[0]).toEqual({
      trajectory: "direct", travelTimeUnits: 0.4,
      ricochet: { maxBounces: 2, rangeCells: 12 }
    });
    const terrainTags = Object.keys(profile.projectiles.ricochet.terrainTags);
    expect(terrainTags).toHaveLength(1);
    expect(profile.projectiles.ricochet.terrainTags[terrainTags[0]]).toBe(true);
    expect(profile.projectiles.clearance.terrainBlockerHeights).toEqual({ [terrainTags[0]]: 1 });
    expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))
      ? fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")
      : null).toBe(before);

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true, dryRun: true, written: false, validation: { ok: true, issues: [] },
      candidate: { mechanics: { modules: { ballistics: { schemaVersion: 1 } } } }
    });
    const applied = await callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
  }, 30_000);

  it("stays unbound and invents no tower, terrain, armor, or mission IDs without prerequisites", () => {
    const recipe = materializeMechanicsRecipe("basic_projectile_ricochet", {
      towerIds: [], terrainTags: [], armorTypeIds: [], missionIds: [], defaultMissionId: ""
    });
    expect(recipe.entity).toMatchObject({
      moduleId: "ballistics", moduleSchemaVersion: 1, missionId: "",
      profileId: "basic_projectile_ricochet",
      profile: { projectiles: { towers: {} } }
    });
    expect(recipe.entity.profile.projectiles).not.toHaveProperty("clearance");
    expect(recipe.entity.profile.projectiles).not.toHaveProperty("ricochet");
    expect(JSON.stringify(recipe)).not.toMatch(/tower_1|terrain_1|armor_1|mission_1/);
  });

  it("publishes the current guide and teaches the existing narrow guarded workflow", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBe(48);
    for (const phrase of [
      "R13.3", "basic_projectile_ricochet", "terrainTags", "armorTypes", "maxBounces",
      "rangeCells", "projectileRicocheted", "describe_schema", "get_recipe",
      "preview_mechanics_module", "apply_mechanics_module", "validate_project"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/ricochet[\s\S]*terrain[\s\S]*armor/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/R13\.3[\s\S]*(?:does not|excludes|defer)[\s\S]*(?:weather|destructible)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).not.toMatch(/(?:analyze|write|save)_ballistics/i);
  });
});
