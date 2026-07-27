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
const REQUIRED_PARAMETERS = [
  "producerTowerTypeId", "storageTowerTypeId", "consumerTowerTypeId", "ammoTypeId", "ammoLabel",
  "productionRecipeId", "productionRecipeLabel", "consumerCapacity", "consumerStartingAmount",
  "consumptionPerActivation", "outputAmount", "productionInterval", "producerCapacity",
  "producerStartingAmount", "producerTransferRadius", "producerTransferAmount", "producerTransferInterval",
  "storageCapacity", "storageStartingAmount", "storageTransferRadius", "storageTransferAmount",
  "storageTransferInterval"
];
const ammunition = {
  types: { shell: { label: "Shell" } },
  towerInventories: {
    cannon_tower: { ammoTypeId: "shell", capacity: 30, startingAmount: 0, consumptionPerActivation: 1 }
  }
};
const supply = {
  productionRecipes: {
    forge_shell: { label: "Forge shell", ammoTypeId: "shell", outputAmount: 4, interval: 1 }
  },
  producers: {
    shell_factory: {
      recipeId: "forge_shell", capacity: 120, startingAmount: 0,
      transferRadius: 4, transferAmount: 8, transferInterval: 0.4
    }
  },
  storages: {
    shell_depot: {
      ammoTypeId: "shell", capacity: 240, startingAmount: 0,
      transferRadius: 5, transferAmount: 12, transferInterval: 0.4
    }
  }
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r58b-supply-cli-"));
  roots.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  const base = balance.towers.cannon_tower;
  balance.towers.shell_factory = { ...structuredClone(base), id: "shell_factory", label: "Shell Factory" };
  balance.towers.shell_depot = { ...structuredClone(base), id: "shell_depot", label: "Shell Depot" };
  writeJson(balancePath, balance);
  return projectDir;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function bytes(projectDir) {
  return ["project.json", "content/mechanics.json", "content/balance.json"].map((relativePath) => {
    const filePath = path.join(projectDir, relativePath);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath).toString("base64") : null;
  });
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

function context() {
  return {
    defaultMissionId: "tutorial_01", missionIds: ["tutorial_01"],
    towerIds: ["shell_factory", "shell_depot", "cannon_tower", "support_tower"],
    towerAttackKindsByTowerId: {
      shell_factory: "support", shell_depot: "support", cannon_tower: "splash", support_tower: "support"
    }
  };
}

function request(overrides = {}) {
  return {
    moduleId: "logistics", moduleSchemaVersion: 3, missionId: "tutorial_01",
    profileId: "factory_supply", profile: { power: null, ammunition, supply }, enabled: true,
    ...overrides
  };
}

describe("R5.8B Logistics v3 CLI supply authoring RED", () => {
  it("publishes the exact 22-parameter inert basic_factory_ammunition_supply recipe", () => {
    const descriptor = listMechanicsRecipes().find((recipe) => recipe.id === "basic_factory_ammunition_supply");
    expect(descriptor).toMatchObject({
      id: "basic_factory_ammunition_supply", moduleId: "logistics", moduleSchemaVersion: 3,
      parameterSchema: { type: "object", required: REQUIRED_PARAMETERS, additionalProperties: false }
    });
    expect(Object.keys(descriptor.parameterSchema.properties)).toEqual(REQUIRED_PARAMETERS);
    for (const field of ["consumerCapacity", "producerCapacity", "storageCapacity"]) {
      expect(descriptor.parameterSchema.properties[field]).toMatchObject({
        type: "integer", minimum: 1, maximum: 1_000_000_000
      });
    }
    for (const field of ["producerTransferRadius", "storageTransferRadius"])
      expect(descriptor.parameterSchema.properties[field]).toMatchObject({ type: "integer", minimum: 0, maximum: 64 });
    for (const field of ["productionInterval", "producerTransferInterval", "storageTransferInterval"])
      expect(descriptor.parameterSchema.properties[field]).toMatchObject({ type: "number", minimum: 0.2, maximum: 1_000_000 });

    const recipe = materializeMechanicsRecipe("basic_factory_ammunition_supply", {
      ...context(), parameters: parameters()
    });
    expect(recipe.entity).toEqual({
      moduleId: "logistics", moduleSchemaVersion: 3, missionId: "tutorial_01",
      profileId: "basic_factory_ammunition_supply", profile: { power: null, ammunition, supply }
    });
    expect(recipe.entity).not.toHaveProperty("enabled");
    expect(JSON.stringify(recipe)).not.toMatch(/towerPatch|createTower|script|command|refillTool/i);
  });

  it("rejects extra/missing parameters, overlapping roles, non-fire consumers, and dependent bounds", () => {
    const validContext = context();
    expect(() => materializeMechanicsRecipe("basic_factory_ammunition_supply", {
      ...validContext, parameters: parameters({ unexpected: true })
    })).toThrow(/additional|unexpected|parameter/i);
    const missing = parameters();
    delete missing.storageTransferInterval;
    expect(() => materializeMechanicsRecipe("basic_factory_ammunition_supply", {
      ...validContext, parameters: missing
    })).toThrow(/storageTransferInterval|required|parameter/i);
    expect(() => materializeMechanicsRecipe("basic_factory_ammunition_supply", {
      ...validContext, parameters: parameters({ storageTowerTypeId: "shell_factory" })
    })).toThrow(/distinct|producer|storage/i);
    expect(() => materializeMechanicsRecipe("basic_factory_ammunition_supply", {
      ...validContext, parameters: parameters({ consumerTowerTypeId: "support_tower" })
    })).toThrow(/fire|attack|consumer/i);
    expect(() => materializeMechanicsRecipe("basic_factory_ammunition_supply", {
      ...validContext, parameters: parameters({ producerCapacity: 5, producerTransferAmount: 6 })
    })).toThrow(/producerTransferAmount|capacity/i);
    expect(() => materializeMechanicsRecipe("basic_factory_ammunition_supply", {
      ...validContext, parameters: parameters({ productionInterval: 0.199 })
    })).toThrow(/productionInterval|0\.2|minimum/i);
  });

  it("reads v2 byte-identically and explicitly promotes every preserved profile to exact v3", async () => {
    const projectDir = fixture();
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.missions.tutorial_01.mechanics = { profiles: { logistics: "ammo" } };
    writeJson(balancePath, balance);
    writeJson(path.join(projectDir, "content", "mechanics.json"), {
      schemaVersion: 1,
      modules: {
        logistics: {
          schemaVersion: 2, enabled: true,
          profiles: { ammo: { power: null, ammunition }, spare: { power: null, ammunition: null } }
        }
      }
    });
    const before = bytes(projectDir);
    expect(await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" })).toMatchObject({
      logistics: { moduleSchemaVersion: 2, selectedProfile: { power: null, ammunition } }
    });
    expect(bytes(projectDir)).toEqual(before);

    const promotion = request({ profileId: "ammo", profile: { power: null, ammunition, supply: null } });
    const preview = await previewMechanicsModule(projectDir, promotion);
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(preview.candidate.mechanics.modules.logistics).toEqual({
      schemaVersion: 3, enabled: true,
      profiles: {
        ammo: { power: null, ammunition, supply: null },
        spare: { power: null, ammunition: null, supply: null }
      }
    });
    expect(bytes(projectDir)).toEqual(before);
    expect(await applyMechanicsModule(projectDir, { ...promotion, ifRevision: preview.revision }))
      .toMatchObject({ ok: true, written: true, rolledBack: false, backup: { directory: expect.any(String) } });
  });

  it("previews, applies, reloads, disables, and re-enables an exact supply profile", async () => {
    const projectDir = fixture();
    const before = bytes(projectDir);
    const preview = await previewMechanicsModule(projectDir, request());
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false, validation: { ok: true, issues: [] } });
    expect(bytes(projectDir)).toEqual(before);
    const applied = await applyMechanicsModule(projectDir, { ...request(), ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, written: true, rolledBack: false });
    expect((await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" })).logistics)
      .toMatchObject({ moduleSchemaVersion: 3, selectedProfile: { power: null, ammunition, supply } });
    const disable = await previewMechanicsModule(projectDir, {
      moduleId: "logistics", moduleSchemaVersion: 3, enabled: false
    });
    expect(disable.ok).toBe(true);
    expect(await applyMechanicsModule(projectDir, {
      moduleId: "logistics", moduleSchemaVersion: 3, enabled: false, ifRevision: disable.revision
    })).toMatchObject({ ok: true, written: true });
    expect((await previewMechanicsModule(projectDir, request())).ok).toBe(true);
  });

  it("fails malformed, stale, rollback, and future-v4 writes closed without byte loss", async () => {
    const malformedDir = fixture();
    const beforeMalformed = bytes(malformedDir);
    const malformed = await previewMechanicsModule(malformedDir, request({
      profile: {
        power: null, ammunition,
        supply: { ...supply, producers: { shell_factory: { ...supply.producers.shell_factory, recipeId: "missing" } } }
      }
    }));
    expect(malformed).toMatchObject({ ok: false, written: false });
    expect(bytes(malformedDir)).toEqual(beforeMalformed);

    const staleDir = fixture();
    const stale = await previewMechanicsModule(staleDir, request());
    fs.appendFileSync(path.join(staleDir, "content", "balance.json"), " ", "utf8");
    const afterEdit = bytes(staleDir);
    expect(await applyMechanicsModule(staleDir, { ...request(), ifRevision: stale.revision }))
      .toMatchObject({ ok: false, conflict: true, written: false });
    expect(bytes(staleDir)).toEqual(afterEdit);

    const rollbackDir = fixture();
    const beforeRollback = bytes(rollbackDir);
    await expect(applyMechanicsModule(rollbackDir, {
      ...request(), ifRevision: mechanicsAuthoringRevision(rollbackDir)
    }, {
      afterFileReplace(relativePath) {
        if (relativePath === "content/mechanics.json") throw new Error("R58B_INJECTED_FAILURE");
      }
    })).rejects.toThrow("R58B_INJECTED_FAILURE");
    expect(bytes(rollbackDir)).toEqual(beforeRollback);

    const futureDir = fixture();
    writeJson(path.join(futureDir, "content", "mechanics.json"), {
      schemaVersion: 1,
      modules: { logistics: { schemaVersion: 4, enabled: true, profiles: { future: { opaque: [1, 2, 3] } } } }
    });
    const futureBefore = bytes(futureDir);
    expect((await previewMechanicsModule(futureDir, request())).ok).toBe(false);
    expect(bytes(futureDir)).toEqual(futureBefore);
  });
});
