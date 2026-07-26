import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "./project-migrations.mjs";
import { loadEngine, readRawProjectFiles } from "./project-loader.mjs";
import {
  applyMechanicsModule,
  inspectMechanicsAuthoring,
  previewMechanicsModule
} from "./mechanics-authoring.mjs";
import { contentRecipeContext, materializeContentRecipe } from "./content-recipes.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const tempProjects = [];
const profile = Object.freeze({
  synergies: Object.freeze({
    elemental_convergence: Object.freeze({
      label: "Elemental Convergence",
      tag: "elemental",
      tiers: Object.freeze([
        Object.freeze({ requiredCount: 2, modifiers: Object.freeze([{ target: "damage", operation: "additive_ratio", value: 0.10 }]) }),
        Object.freeze({ requiredCount: 4, modifiers: Object.freeze([{ target: "damage", operation: "additive_ratio", value: 0.20 }]) }),
        Object.freeze({ requiredCount: 6, modifiers: Object.freeze([{ target: "damage", operation: "additive_ratio", value: 0.30 }]) })
      ])
    })
  })
});

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r41a-roguelite-authoring-"));
  tempProjects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.towers.arrow_tower.tags = ["sniper", "elemental"];
  balance.towers.cannon_tower.tags = ["tech"];
  writeJson(balancePath, balance);
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
    moduleId: "roguelite",
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    profileId: "basic_elemental_synergy",
    profile,
    towerTags: {
      cannon_tower: ["elemental", "tech"],
      arrow_tower: ["elemental", "sniper"]
    },
    enabled: true,
    ...overrides
  };
}

describe("R4.1A roguelite CLI and recipe authoring contract", () => {
  it("inspects the exact engine descriptor and detached binary-sorted non-empty tower tags", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const engine = await loadEngine();

    const result = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });

    expect(result.capabilities.roguelite).toMatchObject({
      moduleId: "roguelite",
      available: true,
      active: false,
      reason: "module_missing"
    });
    expect(result.roguelite).toEqual({
      authoring: engine.ROGUELITE_MECHANICS_SCHEMA,
      enabled: false,
      profileIds: [],
      profileUses: {},
      towerTagsByTowerId: {
        arrow_tower: ["elemental", "sniper"],
        cannon_tower: ["tech"]
      }
    });
    result.roguelite.towerTagsByTowerId.arrow_tower.push("mutated");
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"))
      .towers.arrow_tower.tags).toEqual(["sniper", "elemental"]);
    expect(transactionBytes(projectDir)).toEqual(before);
  });

  it("materializes one inert parameterized elemental recipe and merges existing tower tags", () => {
    const source = {
      manifest: { defaultMissionId: "tutorial_01" },
      mechanics: { schemaVersion: 1, modules: {} },
      maps: {},
      balance: {
        defaultMissionId: "tutorial_01",
        missions: { tutorial_01: {} },
        towers: {
          zeta: { tags: ["nature", "elemental"] },
          Alpha: { tags: ["tech"] },
          alpha: {}
        }
      }
    };
    const context = contentRecipeContext(source);
    expect(context.towerIds).toEqual(["Alpha", "alpha", "zeta"]);
    expect(context.towerTagsByTowerId).toEqual({ Alpha: ["tech"], zeta: ["elemental", "nature"] });

    const result = materializeContentRecipe("mechanics", "basic_elemental_synergy", {
      ...context,
      parameters: { towerTypeIds: ["zeta", "Alpha"] }
    });

    expect(result).toMatchObject({
      id: "basic_elemental_synergy",
      moduleId: "roguelite",
      moduleSchemaVersion: 1,
      suggestedId: "basic_elemental_synergy",
      parameterSchema: {
        type: "object",
        required: ["towerTypeIds"],
        additionalProperties: false,
        properties: {
          towerTypeIds: { type: "array", minItems: 1, maxItems: 16, uniqueItems: true }
        }
      },
      entity: {
        moduleId: "roguelite",
        moduleSchemaVersion: 1,
        profileId: "basic_elemental_synergy",
        profile,
        towerTags: {
          Alpha: ["elemental", "tech"],
          zeta: ["elemental", "nature"]
        }
      }
    });
    expect(result.entity).not.toHaveProperty("enabled");
    expect(result.entity).not.toHaveProperty("missionId");
  });

  it("previews and applies profile plus balance tower tags in one guarded three-file transaction", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);

    const preview = await previewMechanicsModule(projectDir, request());

    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(preview.candidate.balance.towers.arrow_tower.tags).toEqual(["elemental", "sniper"]);
    expect(preview.candidate.balance.towers.cannon_tower.tags).toEqual(["elemental", "tech"]);
    expect(preview.candidate.mechanics.modules.roguelite).toEqual({
      schemaVersion: 1,
      enabled: true,
      profiles: { basic_elemental_synergy: profile }
    });
    expect(preview.candidate.balance.missions.tutorial_01.mechanics.profiles.roguelite)
      .toBe("basic_elemental_synergy");
    expect(transactionBytes(projectDir)).toEqual(before);

    const applied = await applyMechanicsModule(projectDir, { ...request(), ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, dryRun: false, written: true, rolledBack: false });
    const raw = readRawProjectFiles(projectDir);
    expect(raw.balance.towers.arrow_tower.tags).toEqual(["elemental", "sniper"]);
    expect(raw.balance.towers.cannon_tower.tags).toEqual(["elemental", "tech"]);
    expect(raw.mechanics.modules.roguelite.profiles.basic_elemental_synergy).toEqual(profile);
  });

  it("rejects a stale tower-tag apply and rolls balance back after a final replace failure", async () => {
    const staleDir = fixture();
    const stalePreview = await previewMechanicsModule(staleDir, request());
    fs.appendFileSync(path.join(staleDir, "content", "balance.json"), " ", "utf8");
    const afterExternalEdit = transactionBytes(staleDir);
    const stale = await applyMechanicsModule(staleDir, { ...request(), ifRevision: stalePreview.revision });
    expect(stale).toMatchObject({ ok: false, written: false, conflict: true });
    expect(transactionBytes(staleDir)).toEqual(afterExternalEdit);

    const rollbackDir = fixture();
    const before = transactionBytes(rollbackDir);
    const preview = await previewMechanicsModule(rollbackDir, request());
    await expect(applyMechanicsModule(rollbackDir, {
      ...request(),
      ifRevision: preview.revision
    }, {
      afterFileReplace(relativePath) {
        if (relativePath === "content/balance.json") throw new Error("R41A_INJECTED_BALANCE_REPLACE_FAILURE");
      }
    })).rejects.toThrow("R41A_INJECTED_BALANCE_REPLACE_FAILURE");
    expect(transactionBytes(rollbackDir)).toEqual(before);
  });

  it("rejects towerTags outside enabled roguelite authoring and rejects unknown tower ids without writes", async () => {
    for (const invalidRequest of [
      request({ moduleId: "combat", profileId: "illegal_cross_module", profile: {}, towerTags: { arrow_tower: ["elemental"] } }),
      request({ enabled: false }),
      request({ towerTags: { missing_tower: ["elemental"] } }),
      request({ towerTags: { arrow_tower: ["elemental", "elemental"] } })
    ]) {
      const projectDir = fixture();
      const before = transactionBytes(projectDir);
      const result = await previewMechanicsModule(projectDir, invalidRequest);
      expect(result).toMatchObject({ ok: false, dryRun: true, written: false });
      expect(result.validation.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ severity: "error", message: expect.stringMatching(/towerTags|roguelite|enabled|missing_tower|tower/i) })
      ]));
      expect(transactionBytes(projectDir)).toEqual(before);
    }
  });

  it("removes the optional tower tags field when the full replacement list is empty", async () => {
    const projectDir = fixture();
    const preview = await previewMechanicsModule(projectDir, request({
      towerTags: { arrow_tower: [], cannon_tower: ["elemental", "tech"] }
    }));

    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(preview.candidate.balance.towers.arrow_tower).not.toHaveProperty("tags");
  });

  it("keeps towerTypeIds closed, unique, authored, and bounded to 1..16", () => {
    const context = {
      towerIds: Array.from({ length: 17 }, (_, index) => `tower_${index}`),
      towerTagsByTowerId: {},
      parameters: { towerTypeIds: ["tower_0"] }
    };
    const invalid = [
      { parameters: undefined },
      { parameters: {} },
      { parameters: { towerTypeIds: [] } },
      { parameters: { towerTypeIds: ["tower_0", "tower_0"] } },
      { parameters: { towerTypeIds: ["not_authored"] } },
      { parameters: { towerTypeIds: context.towerIds } },
      { parameters: { towerTypeIds: ["tower_0"], extra: true } }
    ];
    for (const override of invalid) {
      expect(() => materializeContentRecipe("mechanics", "basic_elemental_synergy", {
        ...context,
        ...override
      })).toThrow(/towerTypeIds|parameter|1\.\.16|unique|authored|closed|unknown/i);
    }
  });
});
