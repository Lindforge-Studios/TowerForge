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
const projects = [];
const profile = {
  bosses: {
    basic_grunt: {
      components: {
        core: {
          maxHp: 20,
          hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.25 },
          tags: ["core"]
        }
      }
    }
  },
  targeting: { towers: { arrow_tower: { priorityTags: ["core"] } } }
};

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r12-enemy-behaviors-cli-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function request(overrides = {}) {
  return {
    moduleId: "enemyBehaviors",
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    profileId: "targetable_boss",
    profile,
    enabled: true,
    ...overrides
  };
}

describe("R12.1d enemyBehaviors CLI authoring contract (RED)", () => {
  it("inspects the absent v1 authoring surface without creating mechanics.json", async () => {
    const projectDir = fixture();
    const before = fs.existsSync(path.join(projectDir, "content", "mechanics.json"));

    const view = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });

    expect(view.enemyBehaviors).toMatchObject({
      authoring: { moduleId: "enemyBehaviors", supportedModuleSchemaVersions: [1] },
      enabled: false,
      profileIds: []
    });
    expect(view.capabilities.enemyBehaviors).toMatchObject({
      available: true, active: false, reason: "module_missing"
    });
    expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(before);
  });

  it("previews, applies by revision, preserves profiles on disable, and rejects stale apply", async () => {
    const projectDir = fixture();
    const preview = await previewMechanicsModule(projectDir, request());
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(preview.candidate.manifest.schemaVersion).toBe(3);
    expect(preview.candidate.mechanics.modules.enemyBehaviors).toEqual({
      schemaVersion: 1, enabled: true, profiles: { targetable_boss: profile }
    });
    expect(preview.candidate.balance.missions.tutorial_01.mechanics.profiles.enemyBehaviors)
      .toBe("targetable_boss");

    const applied = await applyMechanicsModule(projectDir, { ...request(), ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect((await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" })).enemyBehaviors)
      .toMatchObject({ enabled: true, moduleSchemaVersion: 1, selectedProfileId: "targetable_boss", selectedProfile: profile });

    const stale = await applyMechanicsModule(projectDir, { ...request(), ifRevision: preview.revision });
    expect(stale).toMatchObject({ ok: false, conflict: true, written: false });

    const disablePreview = await previewMechanicsModule(projectDir, {
      moduleId: "enemyBehaviors", moduleSchemaVersion: 1, enabled: false
    });
    const disabled = await applyMechanicsModule(projectDir, {
      moduleId: "enemyBehaviors", moduleSchemaVersion: 1, enabled: false,
      ifRevision: disablePreview.revision
    });
    expect(disabled).toMatchObject({ ok: true, written: true });
    expect(readRawProjectFiles(projectDir).mechanics.modules.enemyBehaviors).toEqual({
      schemaVersion: 1, enabled: false, profiles: { targetable_boss: profile }
    });
  }, 20_000);

  it("preserves future module schema losslessly read-only and refuses a v1 overwrite", async () => {
    const projectDir = fixture();
    const futureProfile = { bosses: profile.bosses, futureControllers: { mode: "quantum" } };
    writeJson(path.join(projectDir, "content", "mechanics.json"), {
      schemaVersion: 1,
      modules: {
        enemyBehaviors: { schemaVersion: 2, enabled: true, profiles: { future_boss: futureProfile } }
      }
    });
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.missions.tutorial_01.mechanics = { profiles: { enemyBehaviors: "future_boss" } };
    writeJson(balancePath, balance);
    const before = fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8");

    const view = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });
    expect(view.enemyBehaviors).toMatchObject({
      enabled: true, moduleSchemaVersion: 2, selectedProfileId: "future_boss", selectedProfile: futureProfile
    });
    expect(view.capabilities.enemyBehaviors).toMatchObject({
      available: true, active: false, reason: "module_version_unsupported", moduleSchemaVersion: 2
    });
    const attempted = await previewMechanicsModule(projectDir, request());
    expect(attempted).toMatchObject({ ok: false, written: false });
    expect(attempted.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module_version_unsupported" })
    ]));
    expect(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")).toBe(before);
  });
});
