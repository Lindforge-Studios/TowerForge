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
const REQUIRED_PARAMETERS = [
  "producerTowerTypeId", "storageTowerTypeId", "consumerTowerTypeId", "ammoTypeId", "ammoLabel",
  "productionRecipeId", "productionRecipeLabel", "consumerCapacity", "consumerStartingAmount",
  "consumptionPerActivation", "outputAmount", "productionInterval", "producerCapacity",
  "producerStartingAmount", "producerTransferRadius", "producerTransferAmount", "producerTransferInterval",
  "storageCapacity", "storageStartingAmount", "storageTransferRadius", "storageTransferAmount",
  "storageTransferInterval"
];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r58b-supply-mcp-"));
  roots.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  const base = balance.towers.cannon_tower;
  balance.towers.shell_factory = { ...structuredClone(base), id: "shell_factory", label: "Shell Factory" };
  balance.towers.shell_depot = { ...structuredClone(base), id: "shell_depot", label: "Shell Depot" };
  fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");
  return projectDir;
}

function tree(rootDir) {
  const rows = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) rows.push([path.relative(rootDir, absolute), fs.readFileSync(absolute).toString("base64")]);
    }
  };
  visit(rootDir);
  return rows;
}

function parameters(overrides = {}) {
  return {
    producerTowerTypeId: "shell_factory", storageTowerTypeId: "shell_depot",
    consumerTowerTypeId: "cannon_tower", ammoTypeId: "shell", ammoLabel: "Shell",
    productionRecipeId: "forge_shell", productionRecipeLabel: "Forge shell",
    consumerCapacity: 30, consumerStartingAmount: 0, consumptionPerActivation: 1,
    outputAmount: 4, productionInterval: 1, producerCapacity: 120, producerStartingAmount: 0,
    producerTransferRadius: 4, producerTransferAmount: 8, producerTransferInterval: 0.4,
    storageCapacity: 240, storageStartingAmount: 0, storageTransferRadius: 5,
    storageTransferAmount: 12, storageTransferInterval: 0.4,
    ...overrides
  };
}

describe("R5.8B MCP/AI ammunition supply authoring RED", () => {
  it("describes exact Logistics v1/v2/v3 limits, ordering, checkpoint v2, snapshot v3, and no commands", async () => {
    const described = await callTool("describe_schema", { domain: "logistics" }, {});
    expect(described.logistics).toMatchObject({
      authoring: {
        moduleId: "logistics", supportedModuleSchemaVersions: [1, 2, 3],
        versions: {
          1: expect.objectContaining({ requiredFields: ["power"], additionalProperties: false }),
          2: expect.objectContaining({ requiredFields: ["power", "ammunition"], additionalProperties: false }),
          3: expect.objectContaining({
            requiredFields: ["power", "ammunition", "supply"], additionalProperties: false,
            supply: expect.objectContaining({
              requiredFields: ["productionRecipes", "producers", "storages"], additionalProperties: false
            })
          })
        },
        limits: expect.objectContaining({
          productionRecipes: 256, producers: 4_096, storages: 4_096,
          authoredSourcesTotal: 4_096, liveSources: 1_024,
          liveAmmunitionInventories: 4_096, directedTransferEdges: 65_536,
          idUtf8Bytes: 128, labelUtf8Bytes: 128,
          inventoryCapacity: 1_000_000_000, amount: 1_000_000_000,
          transferRadius: 64, minimumInterval: 0.2, maximumInterval: 1_000_000
        }),
        transferOrdering: expect.anything()
      },
      checkpoint: expect.objectContaining({ field: "state.logistics", schemaVersion: 2 }),
      snapshot: expect.objectContaining({ field: "logistics", optional: true, supportedSchemaVersions: [1, 2, 3] }),
      commands: []
    });
    expect(JSON.stringify(described.logistics.authoring.transferOrdering)).toMatch(
      /source.*tower.*id.*producer.*storage.*consumer.*distance.*destination/i
    );
    const names = TOOLS.map((tool) => tool.name);
    for (const forbidden of [
      "refill_ammunition", "transfer_ammunition", "produce_ammunition", "set_supply_stock",
      "analyze_logistics", "create_factory"
    ]) expect(names).not.toContain(forbidden);
  });

  it("runs describe -> capabilities -> recipe -> preview -> guarded apply -> validate without recipe writes", async () => {
    const projectDir = fixture();
    const before = tree(projectDir);
    await expect(callTool("describe_schema", { domain: "logistics" }, {})).resolves.toHaveProperty("logistics");
    expect(await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {}))
      .toHaveProperty("capabilities.logistics.active", false);
    const materialized = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "basic_factory_ammunition_supply",
      parameters: parameters()
    }, {});
    expect(materialized.recipe.parameterSchema.required).toEqual(REQUIRED_PARAMETERS);
    expect(materialized.recipe.entity).toMatchObject({
      moduleId: "logistics", moduleSchemaVersion: 3, missionId: "tutorial_01",
      profileId: "basic_factory_ammunition_supply",
      profile: {
        power: null,
        ammunition: {
          types: { shell: { label: "Shell" } },
          towerInventories: {
            cannon_tower: { ammoTypeId: "shell", capacity: 30, startingAmount: 0, consumptionPerActivation: 1 }
          }
        },
        supply: {
          productionRecipes: {
            forge_shell: { label: "Forge shell", ammoTypeId: "shell", outputAmount: 4, interval: 1 }
          },
          producers: { shell_factory: expect.objectContaining({ recipeId: "forge_shell", transferAmount: 8 }) },
          storages: { shell_depot: expect.objectContaining({ ammoTypeId: "shell", transferAmount: 12 }) }
        }
      }
    });
    expect(materialized.recipe.entity).not.toHaveProperty("enabled");
    expect(tree(projectDir)).toEqual(before);

    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(tree(projectDir)).toEqual(before);
    expect(await callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {}))
      .toMatchObject({ ok: true, written: true, rolledBack: false, backup: { directory: expect.any(String) } });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true, issues: [] });
  }, 20_000);

  it("requires explicit guarded v2-to-v3 promotion and fails stale or malformed supply closed", async () => {
    const projectDir = fixture();
    const recipe = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "basic_factory_ammunition_supply", parameters: parameters()
    }, {});
    const request = { projectDir, ...recipe.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    fs.appendFileSync(path.join(projectDir, "content", "balance.json"), " ", "utf8");
    const afterEdit = tree(projectDir);
    expect(await callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {}))
      .toMatchObject({ ok: false, conflict: true, written: false });
    expect(tree(projectDir)).toEqual(afterEdit);

    const malformed = await callTool("preview_mechanics_module", {
      ...request,
      profile: {
        ...recipe.recipe.entity.profile,
        supply: {
          ...recipe.recipe.entity.profile.supply,
          producers: { shell_factory: { ...recipe.recipe.entity.profile.supply.producers.shell_factory, recipeId: "missing" } }
        }
      }
    }, {});
    expect(malformed).toMatchObject({ ok: false, dryRun: true, written: false });
    expect(malformed.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", fieldPath: expect.stringMatching(/supply|producer|recipe/i) })
    ]));
    const applyTool = TOOLS.find((tool) => tool.name === "apply_mechanics_module");
    expect(applyTool).toMatchObject({ riskClass: "write_local" });
    expect(JSON.stringify(applyTool)).toMatch(
      /revision[\s\S]*validation[\s\S]*(?:backup[\s\S]*rollback|rollback[\s\S]*backup)/i
    );
  });

  it("keeps future Logistics v4 opaque, inactive, byte-identical, and unavailable to v3 recipes", async () => {
    const projectDir = fixture();
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.missions.tutorial_01.mechanics = { profiles: { logistics: "future" } };
    fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`);
    fs.writeFileSync(path.join(projectDir, "content", "mechanics.json"), `${JSON.stringify({
      schemaVersion: 1,
      modules: {
        logistics: {
          schemaVersion: 4, enabled: true,
          profiles: { future: { power: null, ammunition: null, supply: null, opaqueConveyors: [1, 2, 3] } }
        }
      }
    }, null, 2)}\n`);
    const before = tree(projectDir);
    expect(await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {})).toMatchObject({
      capabilities: {
        logistics: { active: false, reason: "module_version_unsupported", moduleSchemaVersion: 4 }
      }
    });
    const recipe = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "basic_factory_ammunition_supply", parameters: parameters()
    }, {});
    expect(await callTool("preview_mechanics_module", {
      projectDir, ...recipe.recipe.entity, enabled: true
    }, {})).toMatchObject({ ok: false, written: false });
    expect(tree(projectDir)).toEqual(before);
  });

  it("publishes guide v30 with source/plugin/runtime parity and the guarded supply workflow", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(30);
    for (const phrase of [
      "Logistics v3", "basic_factory_ammunition_supply", "productionRecipes", "producers", "storages",
      "transferInterval", "no refill command"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /describe_schema[\s\S]*get_capabilities[\s\S]*get_recipe[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/snapshot[\s\S]*(?:authoritative|never derive|never recompute)/i);
    const sourceAgent = fs.readFileSync(path.resolve("packages/mcp/agent-instructions.mjs"), "utf8");
    const sourceTools = fs.readFileSync(path.resolve("packages/mcp/tools.mjs"), "utf8");
    expect(fs.readFileSync(RUNTIME_AGENT, "utf8")).toBe(sourceAgent);
    expect(fs.readFileSync(RUNTIME_TOOLS, "utf8")).toBe(sourceTools);
    const skill = fs.readFileSync(PLUGIN_SKILL, "utf8");
    expect(skill).toContain("basic_factory_ammunition_supply");
    expect(skill).toMatch(/Logistics v3|ammunition supply/i);
  });
});
