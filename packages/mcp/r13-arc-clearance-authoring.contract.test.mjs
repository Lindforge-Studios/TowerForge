import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r13-clearance-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

describe("R13.2 MCP/AI arc-clearance authoring (RED)", () => {
  it("describes the closed tag-height vocabulary, exact limits, checkpoint v2, and read-only blocked event", async () => {
    const described = await callTool("describe_schema", { domain: "ballistics" }, {});
    expect(described).toMatchObject({
      requestedDomain: "ballistics",
      ballistics: {
        authoring: {
          moduleId: "ballistics",
          schemaVersion: 1,
          projectiles: {
            requiredFields: ["towers"], optionalFields: ["clearance", "ricochet", "destructibles"], additionalProperties: false
          },
          clearance: {
            requiredFields: ["terrainBlockerHeights"], optionalFields: [], additionalProperties: false,
            terrainBlockerHeights: {
              kind: "record", key: "terrainTag",
              value: { type: "number", minimum: 0, maximum: 1_000_000 }
            },
            limits: {
              terrainBlockerTags: 64, terrainTagUtf8Bytes: 128,
              maximumBlockerHeight: 1_000_000, terrainDefinitions: 256,
              terrainTagsPerDefinition: 64, terrainTagsAcrossDefinitions: 8_192,
              maximumRayDistance: 256, cellInspectionsPerTick: 1_048_576
            }
          }
        },
        snapshot: { field: "ballistics", optional: true, supportedSchemaVersions: [1] },
        checkpoint: {
          field: "ballistics", optional: true, supportedSchemaVersions: [1, 2, 3, 4],
          clearanceCollisionSchemaVersion: 1
        },
        events: expect.arrayContaining(["projectileMissed", "projectileBlocked"]),
        commands: []
      }
    });
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_ballistics");
  });

  it("materializes an inert clearance recipe and completes guarded preview/apply/validate", async () => {
    const projectDir = fixture();
    const before = fs.existsSync(path.join(projectDir, "content", "mechanics.json"))
      ? fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")
      : null;
    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_projectile_ballistics"
    }, {});
    expect(materialized.recipe).toMatchObject({
      id: "basic_projectile_ballistics",
      moduleId: "ballistics",
      moduleSchemaVersion: 1,
      entity: {
        moduleId: "ballistics",
        moduleSchemaVersion: 1,
        missionId: "tutorial_01",
        profile: {
          projectiles: {
            towers: expect.any(Object),
            clearance: { terrainBlockerHeights: expect.any(Object) }
          }
        }
      }
    });
    const heights = materialized.recipe.entity.profile.projectiles.clearance.terrainBlockerHeights;
    expect(Object.keys(heights)).toHaveLength(1);
    expect(Object.values(heights)[0]).toBeGreaterThanOrEqual(0);
    expect(Object.values(heights)[0]).toBeLessThanOrEqual(1_000_000);
    expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))
      ? fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")
      : null).toBe(before);

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true, dryRun: true, written: false, validation: { ok: true, issues: [] },
      candidate: {
        mechanics: {
          modules: {
            ballistics: {
              schemaVersion: 1,
              profiles: {
                [materialized.recipe.entity.profileId]: {
                  projectiles: { clearance: { terrainBlockerHeights: heights } }
                }
              }
            }
          }
        }
      }
    });
    const applied = await callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
  }, 30_000);

  it("teaches the R13.2 guarded flow without inventing broad writes or deferred mechanics", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(43);
    for (const phrase of [
      "R13.2", "terrainBlockerHeights", "projectileBlocked", "basic_projectile_ballistics",
      "describe_schema", "get_recipe", "preview_mechanics_module", "apply_mechanics_module", "validate_project"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/clearance[\s\S]*terrain tag[\s\S]*height/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/R13\.2[\s\S]*(?:does not|excludes|defer)[\s\S]*(?:ricochet|weather|destructible)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).not.toMatch(/(?:analyze|write|save)_ballistics/i);
  });
});
