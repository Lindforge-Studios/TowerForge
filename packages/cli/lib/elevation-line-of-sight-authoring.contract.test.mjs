import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "./project-migrations.mjs";
import { readRawProjectFiles } from "./project-loader.mjs";
import {
  applyMechanicsModule,
  inspectMechanicsAuthoring,
  previewMechanicsModule
} from "./mechanics-authoring.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const tempProjects = [];

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function copyMigratedStarter() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r32-elevation-authoring-"));
  tempProjects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function transactionBytes(projectDir) {
  return ["project.json", "content/mechanics.json", "content/balance.json"].map((relativePath) => {
    const filePath = path.join(projectDir, relativePath);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath).toString("base64") : null;
  });
}

async function authorLegacyElevation(projectDir) {
  const request = {
    moduleId: "elevation",
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    profileId: "legacy",
    profile: {},
    enabled: true
  };
  const preview = await previewMechanicsModule(projectDir, request);
  if (!preview.ok) throw new Error(`Could not arrange elevation v1: ${JSON.stringify(preview.validation)}`);
  const applied = await applyMechanicsModule(projectDir, { ...request, ifRevision: preview.revision });
  if (!applied.ok) throw new Error(`Could not arrange elevation v1: ${JSON.stringify(applied.validation)}`);
  return applied;
}

const losProfile = Object.freeze({
  lineOfSight: Object.freeze({ terrainBlockerTags: Object.freeze([]) })
});

describe("R3.2 elevation mechanics authoring contract", () => {
  it("returns elevation directly from the canonical mechanics inspection", async () => {
    const projectDir = copyMigratedStarter();
    await authorLegacyElevation(projectDir);

    const inspection = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });

    expect(inspection.elevation).toMatchObject({
      authoring: {
        moduleId: "elevation",
        schemaVersion: 3,
        supportedModuleSchemaVersions: [1, 2, 3]
      },
      enabled: true,
      moduleSchemaVersion: 1,
      selectedProfileId: "legacy",
      selectedProfile: {},
      profileIds: ["legacy"]
    });
  });

  it("previews and applies the monotonic elevation v1 to v2 upgrade without preview writes", async () => {
    const projectDir = copyMigratedStarter();
    await authorLegacyElevation(projectDir);
    const before = transactionBytes(projectDir);
    const request = {
      moduleId: "elevation",
      moduleSchemaVersion: 2,
      missionId: "tutorial_01",
      profileId: "deterministic_los",
      profile: losProfile,
      enabled: true
    };

    const preview = await previewMechanicsModule(projectDir, request);

    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(preview.candidate.mechanics.modules.elevation).toEqual({
      schemaVersion: 2,
      enabled: true,
      profiles: { legacy: {}, deterministic_los: losProfile }
    });
    expect(preview.candidate.balance.missions.tutorial_01.mechanics.profiles.elevation)
      .toBe("deterministic_los");
    expect(transactionBytes(projectDir)).toEqual(before);

    const applied = await applyMechanicsModule(projectDir, { ...request, ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect(await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" })).toMatchObject({
      elevation: {
        enabled: true,
        moduleSchemaVersion: 2,
        selectedProfileId: "deterministic_los",
        selectedProfile: losProfile
      }
    });
  });

  it("reports the stable downgrade error for elevation v2 to v1", async () => {
    const projectDir = copyMigratedStarter();
    await authorLegacyElevation(projectDir);
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const mechanics = JSON.parse(fs.readFileSync(mechanicsPath, "utf8"));
    mechanics.modules.elevation.schemaVersion = 2;
    mechanics.modules.elevation.profiles.legacy = losProfile;
    writeJson(mechanicsPath, mechanics);
    const before = transactionBytes(projectDir);

    const preview = await previewMechanicsModule(projectDir, {
      moduleId: "elevation",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "legacy",
      profile: {},
      enabled: true
    });

    expect(preview).toMatchObject({ ok: false, dryRun: true, written: false });
    expect(preview.validation.issues).toContainEqual(expect.objectContaining({
      code: "module_version_downgrade",
      fieldPath: "moduleSchemaVersion"
    }));
    expect(transactionBytes(projectDir)).toEqual(before);
  });
});
