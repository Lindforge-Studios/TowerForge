import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "./project-migrations.mjs";
import { readRawProjectFiles } from "./project-loader.mjs";
import {
  applyMechanicsModule,
  inspectMechanicsAuthoring,
  mechanicsAuthoringRevision,
  previewMechanicsModule
} from "./mechanics-authoring.mjs";
import { listMechanicsRecipes, materializeMechanicsRecipe } from "./mechanics-recipes.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const roots = [];
const power = Object.freeze({
  generators: Object.freeze({}), relays: Object.freeze({}), consumers: Object.freeze({})
});
const ammunition = Object.freeze({
  types: Object.freeze({ shell: Object.freeze({ label: "Shell" }) }),
  towerInventories: Object.freeze({
    cannon_tower: Object.freeze({
      ammoTypeId: "shell", capacity: 30, startingAmount: 12, consumptionPerActivation: 1
    })
  })
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r58a-ammo-cli-"));
  roots.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function transactionBytes(projectDir) {
  return ["project.json", "content/mechanics.json", "content/balance.json"].map((relativePath) => {
    const filePath = path.join(projectDir, relativePath);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath).toString("base64") : null;
  });
}

function installV1(projectDir) {
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.missions.tutorial_01.mechanics = { profiles: { logistics: "grid" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: { logistics: { schemaVersion: 1, enabled: true, profiles: { grid: { power } } } }
  });
}

function v2Request(overrides = {}) {
  return {
    moduleId: "logistics",
    moduleSchemaVersion: 2,
    missionId: "tutorial_01",
    profileId: "local_ammunition",
    profile: { power: null, ammunition },
    enabled: true,
    ...overrides
  };
}

describe("R5.8A Logistics v2 CLI and recipe authoring RED", () => {
  it("publishes the exact six-parameter inert basic_local_ammunition recipe", () => {
    expect(listMechanicsRecipes()).toContainEqual(expect.objectContaining({
      id: "basic_local_ammunition",
      moduleId: "logistics",
      moduleSchemaVersion: 2,
      parameterSchema: {
        type: "object",
        required: [
          "consumerTowerTypeId", "ammoTypeId", "ammoLabel", "capacity",
          "startingAmount", "consumptionPerActivation"
        ],
        additionalProperties: false,
        properties: {
          consumerTowerTypeId: expect.objectContaining({ type: "string", maxUtf8Bytes: 128 }),
          ammoTypeId: expect.objectContaining({ type: "string", maxUtf8Bytes: 128 }),
          ammoLabel: expect.objectContaining({ type: "string", maxUtf8Bytes: 128 }),
          capacity: expect.objectContaining({ type: "integer", minimum: 1, maximum: 1_000_000_000 }),
          startingAmount: expect.objectContaining({ type: "integer", minimum: 0, maximum: 1_000_000_000 }),
          consumptionPerActivation: expect.objectContaining({ type: "integer", minimum: 1, maximum: 1_000_000_000 })
        }
      }
    }));

    const recipe = materializeMechanicsRecipe("basic_local_ammunition", {
      defaultMissionId: "tutorial_01",
      missionIds: ["tutorial_01"],
      towerIds: ["cannon_tower"],
      towerAttackKindsByTowerId: { cannon_tower: "splash" },
      parameters: {
        consumerTowerTypeId: "cannon_tower",
        ammoTypeId: "shell",
        ammoLabel: "Shell",
        capacity: 30,
        startingAmount: 12,
        consumptionPerActivation: 1
      }
    });
    expect(recipe.entity).toEqual({
      moduleId: "logistics",
      moduleSchemaVersion: 2,
      missionId: "tutorial_01",
      profileId: "basic_local_ammunition",
      profile: { power: null, ammunition }
    });
    expect(recipe.entity).not.toHaveProperty("enabled");
    expect(JSON.stringify(recipe)).not.toMatch(/towerPatch|createTower|attackPatch|supply|factory|refill/i);
  });

  it("rejects extra/missing parameters, non-fire-capable towers, and invalid dependent amounts", () => {
    const context = {
      defaultMissionId: "tutorial_01",
      missionIds: ["tutorial_01"],
      towerIds: ["cannon_tower", "support_tower"],
      towerAttackKindsByTowerId: { cannon_tower: "splash", support_tower: "support" }
    };
    const valid = {
      consumerTowerTypeId: "cannon_tower", ammoTypeId: "shell", ammoLabel: "Shell",
      capacity: 30, startingAmount: 12, consumptionPerActivation: 1
    };
    expect(() => materializeMechanicsRecipe("basic_local_ammunition", {
      ...context, parameters: { ...valid, unexpected: true }
    })).toThrow(/additional|unexpected|parameter/i);
    expect(() => materializeMechanicsRecipe("basic_local_ammunition", {
      ...context, parameters: { ...valid, consumerTowerTypeId: "support_tower" }
    })).toThrow(/fire|attack|consumer/i);
    expect(() => materializeMechanicsRecipe("basic_local_ammunition", {
      ...context, parameters: { ...valid, capacity: 10, startingAmount: 11 }
    })).toThrow(/startingAmount|capacity/i);
    expect(() => materializeMechanicsRecipe("basic_local_ammunition", {
      ...context, parameters: { ...valid, capacity: 10, consumptionPerActivation: 11 }
    })).toThrow(/consumptionPerActivation|capacity/i);
  });

  it("reads a v1 power module without migration, then explicitly promotes it to v2", async () => {
    const projectDir = fixture();
    installV1(projectDir);
    const beforeRead = transactionBytes(projectDir);
    const view = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });
    expect(view.logistics).toMatchObject({
      moduleSchemaVersion: 1,
      selectedProfileId: "grid",
      selectedProfile: { power }
    });
    expect(transactionBytes(projectDir)).toEqual(beforeRead);

    const promotion = {
      moduleId: "logistics", moduleSchemaVersion: 2, missionId: "tutorial_01",
      profileId: "grid", profile: { power, ammunition: null }, enabled: true
    };
    const preview = await previewMechanicsModule(projectDir, promotion);
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(preview.candidate.mechanics.modules.logistics).toMatchObject({
      schemaVersion: 2, enabled: true, profiles: { grid: { power, ammunition: null } }
    });
    expect(transactionBytes(projectDir)).toEqual(beforeRead);

    const applied = await applyMechanicsModule(projectDir, { ...promotion, ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, written: true, rolledBack: false });
    expect(readRawProjectFiles(projectDir).mechanics.modules.logistics).toMatchObject({
      schemaVersion: 2, profiles: { grid: { power, ammunition: null } }
    });
  });

  it("previews, applies, reloads, disables, and re-enables an ammunition-only profile", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const preview = await previewMechanicsModule(projectDir, v2Request());
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false, validation: { ok: true, issues: [] } });
    expect(preview.candidate.mechanics.modules.logistics).toMatchObject({
      schemaVersion: 2,
      enabled: true,
      profiles: { local_ammunition: { power: null, ammunition } }
    });
    expect(transactionBytes(projectDir)).toEqual(before);
    const applied = await applyMechanicsModule(projectDir, { ...v2Request(), ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, written: true, rolledBack: false, backup: { directory: expect.any(String) } });
    expect((await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" })).logistics)
      .toMatchObject({ moduleSchemaVersion: 2, selectedProfile: { power: null, ammunition } });

    const disable = await previewMechanicsModule(projectDir, {
      moduleId: "logistics", moduleSchemaVersion: 2, enabled: false
    });
    expect(disable.ok).toBe(true);
    await applyMechanicsModule(projectDir, {
      moduleId: "logistics", moduleSchemaVersion: 2, enabled: false, ifRevision: disable.revision
    });
    const reenable = await previewMechanicsModule(projectDir, v2Request());
    expect(reenable.ok).toBe(true);
  });

  it("fails malformed ammunition without writes and preserves stale/rollback transaction bytes", async () => {
    const malformedDir = fixture();
    const beforeMalformed = transactionBytes(malformedDir);
    const malformed = await previewMechanicsModule(malformedDir, v2Request({
      profile: {
        power: null,
        ammunition: {
          types: { shell: { label: "Shell", inherited: true } },
          towerInventories: {
            cannon_tower: {
              ammoTypeId: "missing", capacity: 10, startingAmount: 11,
              consumptionPerActivation: 0, extra: true
            }
          }
        }
      }
    }));
    expect(malformed).toMatchObject({ ok: false, dryRun: true, written: false });
    expect(malformed.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", fieldPath: expect.stringMatching(/logistics|ammunition|towerInventories/i) })
    ]));
    expect(transactionBytes(malformedDir)).toEqual(beforeMalformed);

    const staleDir = fixture();
    const stalePreview = await previewMechanicsModule(staleDir, v2Request());
    fs.appendFileSync(path.join(staleDir, "content", "balance.json"), " ", "utf8");
    const afterEdit = transactionBytes(staleDir);
    expect(await applyMechanicsModule(staleDir, {
      ...v2Request(), ifRevision: stalePreview.revision
    })).toMatchObject({ ok: false, conflict: true, written: false });
    expect(transactionBytes(staleDir)).toEqual(afterEdit);

    const rollbackDir = fixture();
    const beforeRollback = transactionBytes(rollbackDir);
    await expect(applyMechanicsModule(rollbackDir, {
      ...v2Request(), ifRevision: mechanicsAuthoringRevision(rollbackDir)
    }, {
      afterFileReplace(relativePath) {
        if (relativePath === "content/mechanics.json") throw new Error("R58A_INJECTED_FAILURE");
      }
    })).rejects.toThrow("R58A_INJECTED_FAILURE");
    expect(transactionBytes(rollbackDir)).toEqual(beforeRollback);
  });
});
