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
const RUNTIME_AGENT = path.resolve("plugins/towerforge/runtime/packages/mcp/agent-instructions.mjs");
const RUNTIME_TOOLS = path.resolve("plugins/towerforge/runtime/packages/mcp/tools.mjs");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r58a-ammo-mcp-"));
  roots.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function projectTree(rootDir) {
  const rows = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    ))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) rows.push([path.relative(rootDir, absolute), fs.readFileSync(absolute).toString("base64")]);
    }
  };
  visit(rootDir);
  return rows;
}

function recipeParameters(overrides = {}) {
  return {
    consumerTowerTypeId: "cannon_tower",
    ammoTypeId: "shell",
    ammoLabel: "Shell",
    capacity: 30,
    startingAmount: 12,
    consumptionPerActivation: 1,
    ...overrides
  };
}

describe("R5.8A MCP/AI local ammunition authoring RED", () => {
  it("preserves exact Logistics v1/v2 authoring within the v3 domain and exposes no refill tool", async () => {
    const logistics = await callTool("describe_schema", { domain: "logistics" }, {});
    expect(logistics).toMatchObject({
      requestedDomain: "logistics",
      availableDomains: expect.arrayContaining(["logistics"]),
      logistics: {
        authoring: {
          moduleId: "logistics",
          supportedModuleSchemaVersions: [1, 2, 3],
          versions: {
            1: expect.objectContaining({ requiredFields: ["power"], additionalProperties: false }),
            2: expect.objectContaining({
              requiredFields: ["power", "ammunition"], additionalProperties: false,
              ammunition: expect.objectContaining({ requiredFields: ["types", "towerInventories"] })
            }),
            3: expect.objectContaining({
              requiredFields: ["power", "ammunition", "supply"], additionalProperties: false
            })
          },
          limits: expect.objectContaining({
            ammunitionTypes: 256,
            authoredTowerInventories: 4_096,
            liveAmmunitionInventories: 4_096,
            ammunitionAmount: 1_000_000_000,
            idUtf8Bytes: 128,
            labelUtf8Bytes: 128
          })
        },
        checkpoint: expect.objectContaining({ field: "state.logistics", schemaVersion: 2 }),
        snapshot: expect.objectContaining({ field: "logistics", optional: true, supportedSchemaVersions: [1, 2, 3] }),
        commands: []
      }
    });
    const names = TOOLS.map((tool) => tool.name);
    for (const forbidden of ["refill_ammunition", "transfer_ammunition", "analyze_logistics", "create_factory"])
      expect(names).not.toContain(forbidden);
  });

  it("runs describe -> capabilities -> recipe -> preview -> guarded apply -> validate without recipe writes", async () => {
    const projectDir = fixture();
    const before = projectTree(projectDir);
    await expect(callTool("describe_schema", { domain: "logistics" }, {})).resolves.toHaveProperty("logistics");
    const capabilities = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(capabilities.capabilities.logistics).toMatchObject({ available: true, active: false, reason: "module_missing" });

    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_local_ammunition",
      parameters: recipeParameters()
    }, {});
    expect(materialized.recipe.entity).toEqual({
      moduleId: "logistics",
      moduleSchemaVersion: 2,
      missionId: "tutorial_01",
      profileId: "basic_local_ammunition",
      profile: {
        power: null,
        ammunition: {
          types: { shell: { label: "Shell" } },
          towerInventories: {
            cannon_tower: {
              ammoTypeId: "shell", capacity: 30, startingAmount: 12, consumptionPerActivation: 1
            }
          }
        }
      }
    });
    expect(materialized.recipe.entity).not.toHaveProperty("enabled");
    expect(projectTree(projectDir)).toEqual(before);

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(projectTree(projectDir)).toEqual(before);
    const applied = await callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({
      ok: true, written: true, rolledBack: false, previousRevision: preview.revision,
      backup: { directory: expect.any(String) }
    });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true, issues: [] });
  }, 20_000);

  it("fails stale and malformed requests closed and documents backup plus rollback", async () => {
    const projectDir = fixture();
    const materialized = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "basic_local_ammunition",
      parameters: recipeParameters()
    }, {});
    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    fs.appendFileSync(path.join(projectDir, "content", "balance.json"), " ", "utf8");
    const afterEdit = projectTree(projectDir);
    expect(await callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {}))
      .toMatchObject({ ok: false, conflict: true, written: false });
    expect(projectTree(projectDir)).toEqual(afterEdit);

    const malformed = await callTool("preview_mechanics_module", {
      ...request,
      profile: {
        power: null,
        ammunition: {
          types: { shell: { label: "Shell", extra: true } },
          towerInventories: {
            cannon_tower: {
              ammoTypeId: "missing", capacity: 1, startingAmount: 2, consumptionPerActivation: 0
            }
          }
        }
      }
    }, {});
    expect(malformed).toMatchObject({ ok: false, dryRun: true, written: false });
    const applyTool = TOOLS.find((tool) => tool.name === "apply_mechanics_module");
    expect(applyTool).toMatchObject({ riskClass: "write_local" });
    expect(JSON.stringify(applyTool)).toMatch(/revision[\s\S]*validation[\s\S]*(?:backup[\s\S]*rollback|rollback[\s\S]*backup)/i);
  });

  it("keeps future Logistics v4 opaque and refuses recipe application without changing bytes", async () => {
    const projectDir = fixture();
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.missions.tutorial_01.mechanics = { profiles: { logistics: "future" } };
    writeJson(balancePath, balance);
    writeJson(mechanicsPath, {
      schemaVersion: 1,
      modules: {
        logistics: {
          schemaVersion: 4, enabled: true,
          profiles: {
            future: { power: null, ammunition: null, supply: null, factories: { opaque: [1, 2, 3] } }
          }
        }
      }
    });
    const before = projectTree(projectDir);
    const capabilities = await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {});
    expect(capabilities.capabilities.logistics).toMatchObject({
      available: true, active: false, reason: "module_version_unsupported", moduleSchemaVersion: 4
    });
    const recipe = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "basic_local_ammunition", parameters: recipeParameters()
    }, {});
    const attempted = await callTool("preview_mechanics_module", {
      projectDir, ...recipe.recipe.entity, enabled: true
    }, {});
    expect(attempted).toMatchObject({ ok: false, written: false });
    expect(attempted.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module_version_unsupported" })
    ]));
    expect(projectTree(projectDir)).toEqual(before);
  });

  it("publishes guide v29 with source/plugin/runtime parity and the guarded ammo workflow", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(29);
    for (const phrase of [
      "Logistics v2", "basic_local_ammunition", "ammunition", "towerInventories",
      "consumptionPerActivation", "power:null", "no refill"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /describe_schema[\s\S]*get_capabilities[\s\S]*get_recipe[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/snapshot[\s\S]*(?:authoritative|never derive|never recompute)/i);

    const sourceAgent = fs.readFileSync(path.resolve("packages/mcp/agent-instructions.mjs"), "utf8");
    const sourceTools = fs.readFileSync(path.resolve("packages/mcp/tools.mjs"), "utf8");
    const runtimeAgent = fs.readFileSync(RUNTIME_AGENT, "utf8");
    const runtimeTools = fs.readFileSync(RUNTIME_TOOLS, "utf8");
    const skill = fs.readFileSync(PLUGIN_SKILL, "utf8");
    expect(runtimeAgent).toBe(sourceAgent);
    expect(runtimeTools).toBe(sourceTools);
    expect(skill).toContain("basic_local_ammunition");
    expect(skill).toMatch(/Logistics v2|local ammunition/i);
  });
});
