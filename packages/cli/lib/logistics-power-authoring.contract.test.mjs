import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "./project-migrations.mjs";
import { loadEngine, readRawProjectFiles } from "./project-loader.mjs";
import {
  applyMechanicsModule,
  inspectMechanicsAuthoring,
  mechanicsAuthoringRevision,
  previewMechanicsModule
} from "./mechanics-authoring.mjs";
import { listMechanicsRecipes, materializeMechanicsRecipe } from "./mechanics-recipes.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const projects = [];
const powerProfile = Object.freeze({
  power: Object.freeze({
    generators: Object.freeze({
      power_plant: Object.freeze({ output: 20, linkRadius: 4, coverageRadius: 3 })
    }),
    relays: Object.freeze({
      power_pylon: Object.freeze({ linkRadius: 5, coverageRadius: 4 })
    }),
    consumers: Object.freeze({
      arc_tower: Object.freeze({ demand: 8, priority: 10 })
    })
  })
});

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture({ addPowerTowers = true } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r57a-logistics-cli-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  if (addPowerTowers) {
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    const arrow = balance.towers.arrow_tower;
    const cannon = balance.towers.cannon_tower;
    balance.towers.power_plant = { ...structuredClone(arrow), id: "power_plant", label: "Power Plant" };
    balance.towers.power_pylon = { ...structuredClone(arrow), id: "power_pylon", label: "Power Pylon" };
    balance.towers.arc_tower = { ...structuredClone(cannon), id: "arc_tower", label: "Arc Tower" };
    balance.missions.tutorial_01.buildTowerIds = ["arc_tower", "power_plant", "power_pylon"];
    writeJson(balancePath, balance);
  }
  return projectDir;
}

function transactionBytes(projectDir) {
  return ["project.json", "content/mechanics.json", "content/balance.json"].map((relativePath) => {
    const filePath = path.join(projectDir, relativePath);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath).toString("base64") : null;
  });
}

function request(overrides = {}) {
  return {
    moduleId: "logistics",
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    profileId: "basic_power_grid",
    profile: powerProfile,
    enabled: true,
    ...overrides
  };
}

describe("R5.7A Logistics v1 CLI/project/recipe authoring RED", () => {
  it("keeps an untouched starter mechanics-free before any explicit authoring", () => {
    const projectDir = fixture({ addPowerTowers: false });
    expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(false);
    expect(readRawProjectFiles(projectDir).balance.missions.tutorial_01.mechanics).toBeUndefined();
  });

  it("advertises an exact parameterized inert basic_power_grid recipe without creating towers", () => {
    expect(listMechanicsRecipes()).toContainEqual(expect.objectContaining({
      id: "basic_power_grid",
      moduleId: "logistics",
      moduleSchemaVersion: 1,
      parameterSchema: {
        type: "object",
        required: ["generatorTowerTypeId", "relayTowerTypeId", "consumerTowerTypeId"],
        additionalProperties: false,
        properties: {
          generatorTowerTypeId: expect.objectContaining({ type: "string", maxUtf8Bytes: 128 }),
          relayTowerTypeId: expect.objectContaining({ type: "string", maxUtf8Bytes: 128 }),
          consumerTowerTypeId: expect.objectContaining({ type: "string", maxUtf8Bytes: 128 })
        }
      }
    }));

    const recipe = materializeMechanicsRecipe("basic_power_grid", {
      defaultMissionId: "tutorial_01",
      missionIds: ["tutorial_01"],
      towerIds: ["arc_tower", "power_plant", "power_pylon"],
      towerAttackKindsByTowerId: {
        arc_tower: "single", power_plant: "support", power_pylon: "support_buff"
      },
      parameters: {
        generatorTowerTypeId: "power_plant",
        relayTowerTypeId: "power_pylon",
        consumerTowerTypeId: "arc_tower"
      }
    });
    expect(recipe).toMatchObject({
      id: "basic_power_grid",
      moduleId: "logistics",
      moduleSchemaVersion: 1,
      entity: {
        moduleId: "logistics",
        moduleSchemaVersion: 1,
        missionId: "tutorial_01",
        profileId: "basic_power_grid",
        profile: powerProfile
      }
    });
    expect(recipe.entity).not.toHaveProperty("enabled");
    expect(JSON.stringify(recipe)).not.toMatch(/towerPatch|createTower|missionPatch|selectedProfile|enabled\s*:/i);
  });

  it("rejects duplicate/missing recipe roles and non-fire-capable consumers before materialization", () => {
    const context = {
      defaultMissionId: "tutorial_01",
      missionIds: ["tutorial_01"],
      towerIds: ["arc_tower", "power_plant", "power_pylon"],
      towerAttackKindsByTowerId: {
        arc_tower: "single", power_plant: "support", power_pylon: "support_buff"
      }
    };
    expect(() => materializeMechanicsRecipe("basic_power_grid", {
      ...context,
      parameters: {
        generatorTowerTypeId: "power_plant",
        relayTowerTypeId: "power_plant",
        consumerTowerTypeId: "arc_tower"
      }
    })).toThrow(/distinct|role/i);
    expect(() => materializeMechanicsRecipe("basic_power_grid", {
      ...context,
      parameters: {
        generatorTowerTypeId: "power_plant",
        relayTowerTypeId: "power_pylon",
        consumerTowerTypeId: "missing"
      }
    })).toThrow(/missing|unknown|tower/i);
    expect(() => materializeMechanicsRecipe("basic_power_grid", {
      ...context,
      parameters: {
        generatorTowerTypeId: "power_plant",
        relayTowerTypeId: "arc_tower",
        consumerTowerTypeId: "power_pylon"
      }
    })).toThrow(/consumer|fire|attack/i);
  });

  it("inspects the absent module through the exact engine descriptor without writing", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const engine = await loadEngine();
    const view = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });

    expect(engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toContain("logistics");
    expect(view.capabilities.logistics).toMatchObject({
      moduleId: "logistics", available: true, active: false, reason: "module_missing"
    });
    expect(view.logistics).toEqual({
      authoring: engine.LOGISTICS_MECHANICS_SCHEMA,
      enabled: false,
      profileIds: [],
      profileUses: {}
    });
    expect(transactionBytes(projectDir)).toEqual(before);
  });

  it("previews, applies with backup, reloads, disables, and re-enables one exact power profile", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const preview = await previewMechanicsModule(projectDir, request());
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      validation: { ok: true, issues: [] },
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: {
          schemaVersion: 1,
          modules: {
            logistics: { schemaVersion: 1, enabled: true, profiles: { basic_power_grid: powerProfile } }
          }
        },
        balance: {
          missions: { tutorial_01: { mechanics: { profiles: { logistics: "basic_power_grid" } } } }
        }
      }
    });
    expect(transactionBytes(projectDir)).toEqual(before);

    const applied = await applyMechanicsModule(projectDir, { ...request(), ifRevision: preview.revision });
    expect(applied).toMatchObject({
      ok: true, written: true, rolledBack: false, previousRevision: preview.revision,
      backup: {
        files: {
          project: { existed: true }, mechanics: { existed: false }, balance: { existed: true }
        }
      }
    });
    expect(fs.existsSync(applied.backup.directory)).toBe(true);
    expect((await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" })).logistics)
      .toMatchObject({
        enabled: true, moduleSchemaVersion: 1, selectedProfileId: "basic_power_grid",
        selectedProfile: powerProfile,
        profileUses: { basic_power_grid: ["tutorial_01"] }
      });

    const disable = await previewMechanicsModule(projectDir, {
      moduleId: "logistics", moduleSchemaVersion: 1, enabled: false
    });
    expect(disable.ok).toBe(true);
    const disabled = await applyMechanicsModule(projectDir, {
      moduleId: "logistics", moduleSchemaVersion: 1, enabled: false, ifRevision: disable.revision
    });
    expect(disabled).toMatchObject({ ok: true, written: true });
    expect(readRawProjectFiles(projectDir).mechanics.modules.logistics).toMatchObject({
      enabled: false, profiles: { basic_power_grid: powerProfile }
    });
    const reenablePreview = await previewMechanicsModule(projectDir, request());
    const reenabled = await applyMechanicsModule(projectDir, {
      ...request(), ifRevision: reenablePreview.revision
    });
    expect(reenabled).toMatchObject({ ok: true, written: true });
  }, 20_000);

  it("rejects malformed/invalid active power and preserves source bytes on stale apply and rollback", async () => {
    const invalidDir = fixture();
    const beforeInvalid = transactionBytes(invalidDir);
    const malformed = await previewMechanicsModule(invalidDir, request({
      profile: {
        power: {
          generators: { power_plant: { output: Number.POSITIVE_INFINITY, linkRadius: 4, coverageRadius: 3 } },
          relays: { power_plant: { linkRadius: 5, coverageRadius: 4 } },
          consumers: { power_pylon: { demand: 8, priority: 10, extra: true } }
        }
      }
    }));
    expect(malformed).toMatchObject({ ok: false, dryRun: true, written: false });
    expect(malformed.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", fieldPath: expect.stringMatching(/logistics|power|generator|relay|consumer/i) })
    ]));
    expect(transactionBytes(invalidDir)).toEqual(beforeInvalid);

    const staleDir = fixture();
    const stalePreview = await previewMechanicsModule(staleDir, request());
    fs.appendFileSync(path.join(staleDir, "content", "balance.json"), " ", "utf8");
    const afterExternalEdit = transactionBytes(staleDir);
    const stale = await applyMechanicsModule(staleDir, { ...request(), ifRevision: stalePreview.revision });
    expect(stale).toMatchObject({ ok: false, conflict: true, written: false });
    expect(transactionBytes(staleDir)).toEqual(afterExternalEdit);

    const rollbackDir = fixture();
    const beforeRollback = transactionBytes(rollbackDir);
    await expect(applyMechanicsModule(rollbackDir, {
      ...request(), ifRevision: mechanicsAuthoringRevision(rollbackDir)
    }, {
      afterFileReplace(relativePath) {
        if (relativePath === "content/mechanics.json") throw new Error("R57A_INJECTED_REPLACE_FAILURE");
      }
    })).rejects.toThrow("R57A_INJECTED_REPLACE_FAILURE");
    expect(transactionBytes(rollbackDir)).toEqual(beforeRollback);
  }, 20_000);

  it("preserves future v2 losslessly read-only and refuses guarded writes", async () => {
    const projectDir = fixture();
    const manifestPath = path.join(projectDir, "project.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.schemaVersion = 3;
    writeJson(manifestPath, manifest);
    const futureProfile = { power: null, quantumLinks: { mode: "future", coefficients: [1, 2, 3] } };
    writeJson(path.join(projectDir, "content", "mechanics.json"), {
      schemaVersion: 1,
      modules: {
        logistics: { schemaVersion: 2, enabled: true, profiles: { future_grid: futureProfile } }
      }
    });
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.missions.tutorial_01.mechanics = { profiles: { logistics: "future_grid" } };
    writeJson(balancePath, balance);
    const before = transactionBytes(projectDir);

    const view = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });
    expect(view.logistics).toMatchObject({
      enabled: true, moduleSchemaVersion: 2, selectedProfileId: "future_grid",
      selectedProfile: futureProfile
    });
    expect(view.capabilities.logistics).toMatchObject({
      available: true, active: false, reason: "module_version_unsupported", moduleSchemaVersion: 2
    });
    const attempted = await previewMechanicsModule(projectDir, request());
    expect(attempted).toMatchObject({ ok: false, written: false });
    expect(attempted.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module_version_unsupported" })
    ]));
    expect(transactionBytes(projectDir)).toEqual(before);
  });
});
