import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "./project-migrations.mjs";
import { readRawProjectFiles } from "./project-loader.mjs";
import { validateProjectSchemas } from "./project-schema.mjs";
import {
  applyMechanicsModule,
  inspectMechanicsAuthoring,
  previewMechanicsModule
} from "./mechanics-authoring.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const tempProjects = [];

const lineOfSight = Object.freeze({ terrainBlockerTags: Object.freeze([]) });
const highGround = Object.freeze({
  maximumEffectiveElevationDelta: 3,
  rangeBonusPerElevation: 1,
  damageBonusBasisPointsPerElevation: 1_000
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

function copyElevationV2Project() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r33-high-ground-authoring-"));
  tempProjects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);

  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.missions.tutorial_01.mechanics = { profiles: { elevation: "combined" } };
  writeJson(balancePath, balance);

  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      elevation: {
        schemaVersion: 2,
        enabled: true,
        profiles: {
          combined: { lineOfSight },
          sibling_los: { lineOfSight }
        }
      }
    }
  });
  return projectDir;
}

function transactionBytes(projectDir) {
  return ["project.json", "content/mechanics.json", "content/balance.json"].map((relativePath) => {
    const filePath = path.join(projectDir, relativePath);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath).toString("base64") : null;
  });
}

describe("R3.3 elevation high-ground CLI authoring contract", () => {
  it("accepts elevation v3 at the project-schema boundary while version domains remain independent", () => {
    const projectDir = copyElevationV2Project();
    const files = readRawProjectFiles(projectDir);
    files.mechanics.modules.elevation.schemaVersion = 3;
    files.mechanics.modules.elevation.profiles.combined.highGround = highGround;

    const validation = validateProjectSchemas(files);

    expect(validation.issues.filter((issue) => issue.entityKind === "mechanics")).toEqual([]);
    expect(files.manifest.schemaVersion).toBe(3);
    expect(files.mechanics.schemaVersion).toBe(1);
  });

  it("previews and applies a monotonic v2 to v3 upgrade without writes or sibling loss", async () => {
    const projectDir = copyElevationV2Project();
    const before = transactionBytes(projectDir);
    const request = {
      moduleId: "elevation",
      moduleSchemaVersion: 3,
      missionId: "tutorial_01",
      profileId: "combined",
      profile: { lineOfSight, highGround },
      enabled: true
    };

    const preview = await previewMechanicsModule(projectDir, request);

    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(preview.candidate.mechanics.modules.elevation).toEqual({
      schemaVersion: 3,
      enabled: true,
      profiles: {
        combined: { lineOfSight, highGround },
        sibling_los: { lineOfSight }
      }
    });
    expect(preview.candidate.balance.missions.tutorial_01.mechanics.profiles.elevation).toBe("combined");
    expect(transactionBytes(projectDir)).toEqual(before);

    const applied = await applyMechanicsModule(projectDir, { ...request, ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect(await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" })).toMatchObject({
      elevation: {
        authoring: {
          schemaVersion: 3,
          supportedModuleSchemaVersions: [1, 2, 3]
        },
        enabled: true,
        moduleSchemaVersion: 3,
        selectedProfileId: "combined",
        selectedProfile: { lineOfSight, highGround },
        profileIds: ["combined", "sibling_los"]
      }
    });
  });

  it("removes highGround without downgrading v3 or dropping the LoS sibling", async () => {
    const projectDir = copyElevationV2Project();
    const addRequest = {
      moduleId: "elevation",
      moduleSchemaVersion: 3,
      missionId: "tutorial_01",
      profileId: "combined",
      profile: { lineOfSight, highGround },
      enabled: true
    };
    const addPreview = await previewMechanicsModule(projectDir, addRequest);
    expect(addPreview.ok).toBe(true);
    await applyMechanicsModule(projectDir, { ...addRequest, ifRevision: addPreview.revision });

    const removeRequest = {
      ...addRequest,
      moduleSchemaVersion: 3,
      profile: { lineOfSight }
    };
    const removePreview = await previewMechanicsModule(projectDir, removeRequest);
    expect(removePreview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(removePreview.candidate.mechanics.modules.elevation).toEqual({
      schemaVersion: 3,
      enabled: true,
      profiles: {
        combined: { lineOfSight },
        sibling_los: { lineOfSight }
      }
    });
    const removed = await applyMechanicsModule(projectDir, {
      ...removeRequest,
      ifRevision: removePreview.revision
    });
    expect(removed.ok).toBe(true);

    const mechanics = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8"));
    expect(mechanics.modules.elevation.schemaVersion).toBe(3);
    expect(mechanics.modules.elevation.profiles.combined).toEqual({ lineOfSight });
    expect(mechanics.modules.elevation.profiles.sibling_los).toEqual({ lineOfSight });

    const downgrade = await previewMechanicsModule(projectDir, {
      ...removeRequest,
      moduleSchemaVersion: 2
    });
    expect(downgrade).toMatchObject({ ok: false, dryRun: true, written: false });
    expect(downgrade.validation.issues).toContainEqual(expect.objectContaining({
      code: "module_version_downgrade",
      fieldPath: "moduleSchemaVersion"
    }));
  });
});
