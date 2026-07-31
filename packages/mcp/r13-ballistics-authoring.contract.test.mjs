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
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r13-ballistics-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

async function rejection(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error("Expected operation to reject.");
}

describe("R13.1 MCP/AI ballistics projectile-foundation authoring (RED)", () => {
  it("describes the closed v1 vocabulary, budgets, active-only snapshot, and read-only miss event", async () => {
    const described = await callTool("describe_schema", { domain: "ballistics" }, {});
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});

    expect(described).toMatchObject({
      requestedDomain: "ballistics",
      ballistics: {
        authoring: {
          moduleId: "ballistics",
          schemaVersion: 1,
          supportedModuleSchemaVersions: [1],
          profile: {
            requiredFields: ["projectiles"], optionalFields: [], additionalProperties: false
          },
          towerBinding: {
            requiredFields: ["trajectory", "travelTimeUnits"],
            optionalFields: ["maxAltitude", "ricochet"],
            additionalProperties: false,
            trajectories: ["direct", "arc"]
          },
          limits: {
            towerBindingsPerProfile: 256,
            activeProjectiles: 4096,
            impactsPerTick: 4096,
            travelTimeUnits: 1_000_000,
            maxAltitude: 1_000_000,
            idUtf8Bytes: 128
          }
        },
        snapshot: {
          field: "ballistics",
          optional: true,
          supportedSchemaVersions: [1],
          projectile: {
            requiredFields: [
              "id", "sourceCoord", "targetCoord", "trajectory", "elapsedUnits",
              "travelTimeUnits", "altitude"
            ],
            optionalFields: ["maxAltitude"],
            additionalProperties: false
          }
        },
        events: expect.arrayContaining(["projectileMissed"]),
        commands: []
      }
    });
    expect(mechanics.mechanics.implementedModuleIds).toContain("ballistics");
    expect(mechanics.mechanics.modules.ballistics).toEqual(described.ballistics);
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_ballistics");
  });

  it("runs describe/read/recipe/preview/guarded apply/validate and rejects a stale revision", async () => {
    const projectDir = fixture();
    const before = fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8");
    const capabilities = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(capabilities.capabilities.ballistics).toMatchObject({ available: true, active: false });

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
        profileId: "basic_projectile_ballistics",
        profile: { projectiles: { towers: expect.any(Object) } }
      }
    });
    const bindings = materialized.recipe.entity.profile.projectiles.towers;
    expect(Object.keys(bindings)).toHaveLength(1);
    expect(Object.values(bindings)[0]).toEqual({
      trajectory: "arc", travelTimeUnits: 0.4, maxAltitude: 2
    });
    expect(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8")).toBe(before);

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      validation: { ok: true, issues: [] },
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: { modules: { ballistics: { schemaVersion: 1, enabled: true } } },
        balance: {
          missions: {
            tutorial_01: { mechanics: { profiles: { ballistics: "basic_projectile_ballistics" } } }
          }
        }
      }
    });

    const applied = await callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    expect(await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {}))
      .toMatchObject({
        capabilities: {
          ballistics: {
            available: true,
            active: true,
            moduleSchemaVersion: 1,
            profileId: "basic_projectile_ballistics"
          }
        }
      });

    const stale = await rejection(callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {}));
    expect(stale).toMatchObject({ code: "conflict" });
  }, 30_000);

  it("teaches the opt-in guarded workflow and keeps deferred ballistics features out of R13.1", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(42);
    for (const phrase of [
      "Ballistics v1",
      "basic_projectile_ballistics",
      "direct",
      "arc",
      "travelTimeUnits",
      "maxAltitude",
      "snapshot.ballistics",
      "preview_mechanics_module",
      "apply_mechanics_module",
      "validate_project"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /ballistics[\s\S]*describe_schema[\s\S]*get_capabilities[\s\S]*get_recipe[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /R13\.1[\s\S]*(?:does not|excludes|defer)[\s\S]*(?:clearance|ricochet|weather|destructible)/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).not.toMatch(/(?:analyze|write|save)_ballistics/i);
  });
});
