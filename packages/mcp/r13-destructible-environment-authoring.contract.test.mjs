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
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r13-destructible-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function tool(name) {
  const candidate = TOOLS.find((entry) => entry.name === name);
  expect(candidate, `${name} must be registered`).toBeDefined();
  return candidate;
}

describe("R13.4d1 MCP/AI destructible environment authoring (RED)", () => {
  it("describes the closed definition/placement contract and registers only narrow preview/apply tools", async () => {
    const described = await callTool("describe_schema", { domain: "ballistics" }, {});
    expect(described).toMatchObject({
      requestedDomain: "ballistics",
      ballistics: {
        authoring: {
          moduleId: "ballistics", schemaVersion: 1,
          destructibles: {
            definition: {
              requiredFields: ["maxHp", "hitRegion"],
              optionalFields: ["armorTypeId", "onDestroyed"], additionalProperties: false
            },
            placement: {
              requiredFields: ["id", "definitionId", "coord"],
              optionalFields: [], additionalProperties: false
            }
          }
        },
        authoringTransaction: {
          preview: "preview_destructible_environment",
          apply: "apply_destructible_environment",
          revisionGuard: "ifRevision",
          files: [
            "project.json", "content/mechanics.json", "content/balance.json",
            "maps/src/<mapId>.tmj", "maps/compiled/maps.json"
          ]
        }
      }
    });
    expect(tool("preview_destructible_environment")).toMatchObject({
      riskClass: "compute_only", sideEffect: "none",
      inputSchema: { additionalProperties: false }
    });
    expect(tool("apply_destructible_environment")).toMatchObject({
      riskClass: "write_local",
      sideEffect: expect.stringMatching(/revision.*backup.*rollback/i),
      inputSchema: { additionalProperties: false, required: expect.arrayContaining(["projectDir", "ifRevision"]) }
    });
    expect(TOOLS.map((entry) => entry.name)).not.toContain("write_destructibles");
  }, 30_000);

  it("materializes an inert recipe, then completes explicit bind → preview → apply → validate", async () => {
    const projectDir = fixture();
    const recipeResult = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "basic_destructible_environment"
    }, {});
    expect(recipeResult.recipe).toMatchObject({
      id: "basic_destructible_environment", authoringTool: "preview_destructible_environment",
      entity: {
        missionId: "tutorial_01", mapId: "tutorial_map", placements: [],
        profile: {
          projectiles: {
            towers: {}, destructibles: { definitions: { basic_crate: expect.any(Object) } }
          }
        }
      }
    });
    expect(recipeResult.recipe.entity).not.toHaveProperty("enabled");
    const request = {
      projectDir,
      ...recipeResult.recipe.entity,
      missionId: "tutorial_01",
      mapId: "tutorial_map",
      enabled: true,
      placements: [{ id: "basic_crate_1", definitionId: "basic_crate", coord: { q: 6, r: 2 } }]
    };
    const preview = await callTool("preview_destructible_environment", request, {});
    expect(preview).toMatchObject({
      ok: true, dryRun: true, written: false, revision: expect.any(String),
      validation: { ok: true, issues: [] }
    });
    const applied = await callTool("apply_destructible_environment", {
      ...request, ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({
      ok: true, written: true, previousRevision: preview.revision,
      backup: { directory: expect.stringMatching(/^\.towerforge\/backups\//) }
    });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    expect(await callTool("apply_destructible_environment", {
      ...request, ifRevision: preview.revision
    }, {})).toMatchObject({ ok: false, conflict: true, written: false });
  }, 30_000);

  it("teaches the explicit guarded workflow and forbids gameplay rules, TowerScript and broad writes", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(45);
    for (const phrase of [
      "R13.4", "basic_destructible_environment", "destructibleObjects",
      "preview_destructible_environment", "apply_destructible_environment", "ifRevision",
      "backup", "rollback", "validate_project"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /destructible[\s\S]*explicit[\s\S]*(?:mission|map)[\s\S]*(?:placement|coordinate)/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /engine[\s\S]*(?:owns|authoritative)[\s\S]*(?:collision|damage|line of sight|terrain)/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).not.toMatch(
      /(?:TowerScript.*destructible|write_destructibles|save_destructibles)/i
    );
  });

  it("keeps the new CLI transaction, recipes, tools and guide byte-identical in plugin runtime", () => {
    const pairs = [
      ["packages/cli/lib/destructible-environment-authoring.mjs", "plugins/towerforge/runtime/packages/cli/lib/destructible-environment-authoring.mjs"],
      ["packages/cli/lib/mechanics-recipes.mjs", "plugins/towerforge/runtime/packages/cli/lib/mechanics-recipes.mjs"],
      ["packages/mcp/tools.mjs", "plugins/towerforge/runtime/packages/mcp/tools.mjs"],
      ["packages/mcp/agent-instructions.mjs", "plugins/towerforge/runtime/packages/mcp/agent-instructions.mjs"]
    ];
    for (const [source, runtime] of pairs) {
      expect(fs.existsSync(source), `source exists: ${source}`).toBe(true);
      expect(fs.existsSync(runtime), `plugin runtime exists: ${runtime}`).toBe(true);
      expect(fs.readFileSync(runtime)).toEqual(fs.readFileSync(source));
    }
  });
});
