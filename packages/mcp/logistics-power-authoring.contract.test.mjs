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
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r57a-logistics-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  const arrow = balance.towers.arrow_tower;
  const cannon = balance.towers.cannon_tower;
  balance.towers.power_plant = { ...structuredClone(arrow), id: "power_plant", label: "Power Plant" };
  balance.towers.power_pylon = { ...structuredClone(arrow), id: "power_pylon", label: "Power Pylon" };
  balance.towers.arc_tower = { ...structuredClone(cannon), id: "arc_tower", label: "Arc Tower" };
  balance.missions.tutorial_01.buildTowerIds = ["arc_tower", "power_plant", "power_pylon"];
  writeJson(balancePath, balance);
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
      else if (entry.isFile()) rows.push([
        path.relative(rootDir, absolute), fs.readFileSync(absolute).toString("base64")
      ]);
    }
  };
  visit(rootDir);
  return rows;
}

describe("R5.7A MCP/AI Logistics power authoring RED", () => {
  it("describes the exact Logistics v1 domain, snapshot, bounds, and no second allocator tool", async () => {
    const logistics = await callTool("describe_schema", { domain: "logistics" }, {});
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});
    expect(logistics).toMatchObject({
      schemaVersion: 4,
      requestedDomain: "logistics",
      availableDomains: expect.arrayContaining(["logistics"]),
      logistics: {
        authoring: {
          moduleId: "logistics",
          schemaVersion: 3,
          supportedModuleSchemaVersions: [1, 2, 3],
          versions: {
            1: expect.objectContaining({
              requiredFields: ["power"], additionalProperties: false,
              power: expect.objectContaining({ nullable: true, additionalProperties: false })
            }),
            2: expect.any(Object),
            3: expect.any(Object)
          },
          limits: expect.objectContaining({
            idUtf8Bytes: 128,
            definitionsPerRole: 4_096,
            definitionsAcrossRoles: 4_096,
            power: expect.objectContaining({
              output: 1_000_000_000_000,
              demand: 1_000_000_000_000,
              radius: 64,
              priority: 1_000_000,
              liveParticipants: 4_096
            })
          })
        },
        snapshot: { field: "logistics", optional: true, supportedSchemaVersions: [1, 2, 3] },
        events: []
      }
    });
    expect(mechanics.mechanics.implementedModuleIds).toContain("logistics");
    expect(mechanics.mechanics.modules.logistics).toEqual(logistics.logistics);
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_logistics");
    expect(TOOLS.map((tool) => tool.name)).not.toContain("allocate_power");
  });

  it("runs capabilities -> parameterized recipe -> preview -> guarded apply -> validate", async () => {
    const projectDir = fixture();
    const before = projectTree(projectDir);
    const capabilities = await callTool("get_capabilities", {
      projectDir, missionId: "tutorial_01"
    }, {});
    expect(capabilities.capabilities.logistics).toMatchObject({
      moduleId: "logistics", available: true, active: false, reason: "module_missing"
    });

    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_power_grid",
      parameters: {
        generatorTowerTypeId: "power_plant",
        relayTowerTypeId: "power_pylon",
        consumerTowerTypeId: "arc_tower"
      }
    }, {});
    expect(materialized.recipe.entity).toEqual({
      moduleId: "logistics",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "basic_power_grid",
      profile: {
        power: {
          generators: { power_plant: { output: 20, linkRadius: 4, coverageRadius: 3 } },
          relays: { power_pylon: { linkRadius: 5, coverageRadius: 4 } },
          consumers: { arc_tower: { demand: 8, priority: 10 } }
        }
      }
    });
    expect(materialized.recipe.entity).not.toHaveProperty("enabled");
    expect(projectTree(projectDir)).toEqual(before);

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true, dryRun: true, written: false,
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: { modules: { logistics: { schemaVersion: 1, enabled: true } } },
        balance: { missions: { tutorial_01: { mechanics: { profiles: { logistics: "basic_power_grid" } } } } }
      }
    });
    expect(projectTree(projectDir)).toEqual(before);

    const applied = await callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({
      ok: true, written: true, rolledBack: false, previousRevision: preview.revision,
      backup: { directory: expect.any(String) }
    });
    expect((await callTool("validate_project", { projectDir }, {})).ok).toBe(true);
    expect((await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {}))
      .capabilities.logistics).toMatchObject({
        available: true, active: true, moduleSchemaVersion: 1, profileId: "basic_power_grid"
      });
  }, 20_000);

  it("rejects stale and malformed guarded writes without changing project bytes", async () => {
    const projectDir = fixture();
    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_power_grid",
      parameters: {
        generatorTowerTypeId: "power_plant",
        relayTowerTypeId: "power_pylon",
        consumerTowerTypeId: "arc_tower"
      }
    }, {});
    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    fs.appendFileSync(path.join(projectDir, "content", "balance.json"), " ", "utf8");
    const afterConcurrentEdit = projectTree(projectDir);
    const stale = await callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {});
    expect(stale).toMatchObject({ ok: false, conflict: true, written: false });
    expect(projectTree(projectDir)).toEqual(afterConcurrentEdit);

    const malformed = await callTool("preview_mechanics_module", {
      ...request,
      profile: {
        power: {
          generators: { power_plant: { output: -1, linkRadius: 4, coverageRadius: 3 } },
          relays: {},
          consumers: { arc_tower: { demand: 8, priority: 10, secret: "no" } }
        }
      }
    }, {});
    expect(malformed).toMatchObject({ ok: false, dryRun: true, written: false });
    expect(projectTree(projectDir)).toEqual(afterConcurrentEdit);
  }, 20_000);

  it("publishes narrow side-effect metadata for the existing guarded tools", () => {
    const preview = TOOLS.find((tool) => tool.name === "preview_mechanics_module");
    const apply = TOOLS.find((tool) => tool.name === "apply_mechanics_module");
    expect(preview).toMatchObject({ riskClass: "read_only", sideEffect: "none" });
    expect(apply).toMatchObject({ riskClass: "write_local" });
    expect(JSON.stringify(preview)).toMatch(/read|dry[-_ ]?run|no write/i);
    expect(JSON.stringify(apply)).toMatch(/write_local|revision|backup|rollback/i);
  });

  it("teaches the opt-in power flow and keeps source, public skill, and generated runtime aligned", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(28);
    for (const phrase of [
      "Logistics v1", "basic_power_grid", "generators", "relays", "consumers",
      "output", "demand", "priority", "powered"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /logistics[\s\S]*describe_schema[\s\S]*get_capabilities[\s\S]*get_recipe[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /basic_power_grid[\s\S]*(?:never|does not)[\s\S]*(?:enable|select|create|tower)/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/snapshot[\s\S]*(?:never recompute|authoritative)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /(?:no|or)\s+analyze_logistics|analyze_logistics[^.]*not added/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/ammo|inventory|factory|production/i);

    const skill = fs.readFileSync(PLUGIN_SKILL, "utf8");
    expect(skill).toMatch(/Logistics v1|power grid/i);
    expect(skill).toContain("basic_power_grid");
    expect(skill).toMatch(/preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*validate_project/i);
    expect(skill).toMatch(/never[\s\S]{0,200}(?:enable|select|create tower)/i);

    const sourceAgent = fs.readFileSync(path.resolve("packages/mcp/agent-instructions.mjs"), "utf8");
    const runtimeAgent = fs.readFileSync(RUNTIME_AGENT, "utf8");
    const sourceTools = fs.readFileSync(path.resolve("packages/mcp/tools.mjs"), "utf8");
    const runtimeTools = fs.readFileSync(RUNTIME_TOOLS, "utf8");
    expect(runtimeAgent).toBe(sourceAgent);
    expect(runtimeTools).toBe(sourceTools);
    expect(runtimeAgent).toContain("basic_power_grid");
    expect(runtimeTools).toMatch(/logistics/);
  });
});
