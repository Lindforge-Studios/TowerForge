import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "./project-migrations.mjs";
import { loadEngine, readRawProjectFiles, validateProjectDir } from "./project-loader.mjs";
import {
  applyMechanicsModule,
  inspectMechanicsAuthoring,
  mechanicsAuthoringRevision,
  previewMechanicsModule
} from "./mechanics-authoring.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const tempProjects = [];
const validProfile = Object.freeze({
  terrainTransitions: Object.freeze({
    flood: Object.freeze({ fromTerrainTags: Object.freeze(["path"]), toTerrainId: "water" })
  })
});
const brokenProfile = Object.freeze({
  terrainTransitions: Object.freeze({
    flood: Object.freeze({ fromTerrainTags: Object.freeze(["missing_tag"]), toTerrainId: "missing_terrain" })
  })
});

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture({ mechanics, schemaVersion = 2, secondMission = false } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r34b-terraforming-authoring-"));
  tempProjects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);

  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = schemaVersion;
  writeJson(manifestPath, manifest);

  if (secondMission) {
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.missions.secondary = structuredClone(balance.missions.tutorial_01);
    balance.missions.secondary.id = "secondary";
    balance.missions.secondary.label = "Secondary";
    writeJson(balancePath, balance);
  }
  if (mechanics !== undefined) {
    writeJson(path.join(projectDir, "content", "mechanics.json"), mechanics);
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
    moduleId: "terraforming",
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    profileId: "mutable",
    profile: validProfile,
    enabled: true,
    ...overrides
  };
}

describe("R3.4b C5A terraforming CLI authoring contract", () => {
  it("inspects an absent module through the exact engine descriptor without authoring files", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const engine = await loadEngine();

    const view = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });

    expect(view.mechanicsAuthored).toBe(false);
    expect(view.capabilities.terraforming).toMatchObject({
      moduleId: "terraforming",
      available: true,
      active: false,
      reason: "module_missing"
    });
    expect(view.terraforming).toEqual({
      authoring: engine.TERRAFORMING_MECHANICS_SCHEMA,
      enabled: false,
      profileIds: [],
      profileUses: {}
    });
    expect(transactionBytes(projectDir)).toEqual(before);
  });

  it("reports deterministic cross-mission profile uses for an active selected profile", async () => {
    const projectDir = fixture({
      schemaVersion: 3,
      secondMission: true,
      mechanics: {
        schemaVersion: 1,
        modules: {
          terraforming: {
            schemaVersion: 1,
            enabled: true,
            profiles: { z_unused: {}, mutable: validProfile }
          }
        }
      }
    });
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.missions.tutorial_01.mechanics = { profiles: { terraforming: "mutable" } };
    balance.missions.secondary.mechanics = { profiles: { terraforming: "mutable" } };
    writeJson(balancePath, balance);

    const view = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });

    expect(view.terraforming).toMatchObject({
      enabled: true,
      moduleSchemaVersion: 1,
      selectedProfileId: "mutable",
      selectedProfile: validProfile,
      profileIds: ["mutable", "z_unused"],
      profileUses: {
        mutable: ["secondary", "tutorial_01"],
        z_unused: []
      }
    });
    expect(view.capabilities.terraforming).toMatchObject({ active: true, profileId: "mutable", reason: "active" });
  });

  it("previews the narrow v2 to v3 transaction without changing any source byte", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);

    const preview = await previewMechanicsModule(projectDir, request());

    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      migration: { required: true, from: 2, to: 3 }
    });
    expect(preview.candidate.manifest.schemaVersion).toBe(3);
    expect(preview.candidate.mechanics).toEqual({
      schemaVersion: 1,
      modules: {
        terraforming: {
          schemaVersion: 1,
          enabled: true,
          profiles: { mutable: validProfile }
        }
      }
    });
    expect(preview.candidate.balance.missions.tutorial_01.mechanics.profiles.terraforming).toBe("mutable");
    expect(transactionBytes(projectDir)).toEqual(before);
  });

  it("applies by revision with a three-file backup and reloads the selected profile", async () => {
    const projectDir = fixture();
    const preview = await previewMechanicsModule(projectDir, request());

    const applied = await applyMechanicsModule(projectDir, { ...request(), ifRevision: preview.revision });

    expect(applied).toMatchObject({
      ok: true,
      dryRun: false,
      written: true,
      rolledBack: false,
      previousRevision: preview.revision,
      backup: {
        files: {
          project: { existed: true },
          mechanics: { existed: false, path: null },
          balance: { existed: true }
        }
      }
    });
    expect(applied.revision).toBe(mechanicsAuthoringRevision(projectDir));
    expect(applied.revision).not.toBe(preview.revision);
    expect(fs.existsSync(applied.backup.directory)).toBe(true);

    const raw = readRawProjectFiles(projectDir);
    expect(raw.manifest.schemaVersion).toBe(3);
    expect(raw.mechanics.modules.terraforming.profiles.mutable).toEqual(validProfile);
    expect(raw.balance.missions.tutorial_01.mechanics.profiles.terraforming).toBe("mutable");
    expect(await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" })).toMatchObject({
      terraforming: {
        enabled: true,
        moduleSchemaVersion: 1,
        selectedProfileId: "mutable",
        selectedProfile: validProfile
      }
    });
  });

  it("rejects stale apply and rolls back all owned writes after an injected replace failure", async () => {
    const staleDir = fixture();
    const stalePreview = await previewMechanicsModule(staleDir, request());
    fs.appendFileSync(path.join(staleDir, "content", "balance.json"), " ", "utf8");
    const afterExternalEdit = transactionBytes(staleDir);

    const stale = await applyMechanicsModule(staleDir, { ...request(), ifRevision: stalePreview.revision });
    expect(stale).toMatchObject({ ok: false, written: false, conflict: true });
    expect(transactionBytes(staleDir)).toEqual(afterExternalEdit);

    const rollbackDir = fixture();
    const before = transactionBytes(rollbackDir);
    await expect(applyMechanicsModule(rollbackDir, {
      ...request(),
      ifRevision: mechanicsAuthoringRevision(rollbackDir)
    }, {
      afterFileReplace(relativePath) {
        if (relativePath === "content/mechanics.json") throw new Error("C5A_INJECTED_REPLACE_FAILURE");
      }
    })).rejects.toThrow("C5A_INJECTED_REPLACE_FAILURE");
    expect(transactionBytes(rollbackDir)).toEqual(before);
  });

  it("allows a disabled broken profile to remain inert but rejects enabling it", async () => {
    const projectDir = fixture({
      schemaVersion: 3,
      mechanics: {
        schemaVersion: 1,
        modules: {
          terraforming: {
            schemaVersion: 1,
            enabled: false,
            profiles: { broken: brokenProfile }
          }
        }
      }
    });
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.missions.tutorial_01.mechanics = { profiles: { terraforming: "broken" } };
    writeJson(balancePath, balance);
    const before = transactionBytes(projectDir);

    const disabled = await previewMechanicsModule(projectDir, {
      moduleId: "terraforming",
      moduleSchemaVersion: 1,
      enabled: false
    });
    expect(disabled).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(disabled.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", message: expect.stringMatching(/missing_tag|missing_terrain|unknown/i) })
    ]));
    expect(transactionBytes(projectDir)).toEqual(before);

    const enabled = await previewMechanicsModule(projectDir, request({
      profileId: "broken",
      profile: brokenProfile
    }));
    expect(enabled).toMatchObject({ ok: false, dryRun: true, written: false });
    expect(enabled.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", message: expect.stringMatching(/missing_tag|missing_terrain|unknown/i) })
    ]));
    expect(transactionBytes(projectDir)).toEqual(before);
  });

  it("rejects malformed disabled profile structure through the combined engine validation path", async () => {
    const malformedProfile = {
      terrainTransitions: {
        flood: { fromTerrainTags: "path", toTerrainId: "water", extra: true }
      }
    };
    const projectDir = fixture({
      schemaVersion: 3,
      mechanics: {
        schemaVersion: 1,
        modules: {
          terraforming: {
            schemaVersion: 1,
            enabled: false,
            profiles: { malformed: malformedProfile }
          }
        }
      }
    });
    const before = transactionBytes(projectDir);

    const loaded = await validateProjectDir(projectDir);
    const structuralIssues = loaded.result.issues.filter((issue) => (
      /terraforming.*terrainTransitions.*flood/i.test(`${issue.fieldPath} ${issue.message}`)
    ));
    expect(structuralIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        entityKind: "mechanics",
        message: expect.stringMatching(/array|closed|unknown|extra|structure/i)
      })
    ]));

    const preview = await previewMechanicsModule(projectDir, {
      moduleId: "terraforming",
      moduleSchemaVersion: 1,
      enabled: false
    });
    expect(preview).toMatchObject({ ok: false, dryRun: true, written: false });
    expect(preview.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        entityKind: "mechanics",
        message: expect.stringMatching(/array|closed|unknown|extra|structure/i)
      })
    ]));
    expect(transactionBytes(projectDir)).toEqual(before);
  });
});
