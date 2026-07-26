import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEngine, readRawProjectFiles } from "./project-loader.mjs";
import { migrateProjectFiles, writeMigratedProjectFiles } from "./project-migrations.mjs";
import {
  applyMechanicsModule,
  inspectMechanicsAuthoring,
  previewMechanicsModule
} from "./mechanics-authoring.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r51a-heroes-cli-"));
  projects.push(projectDir);
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

function request(overrides = {}) {
  return {
    moduleId: "heroes",
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    profileId: "field_commander",
    profile: {
      selectedHeroId: "commander",
      definitions: {
        commander: { label: "Commander", spawn: "core" }
      }
    },
    enabled: true,
    ...overrides
  };
}

describe("R5.1A CLI heroes inspect and guarded authoring", () => {
  it("inspects an absent heroes module through the engine descriptor without writing", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const engine = await loadEngine();
    const view = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });

    expect(view.capabilities.heroes).toMatchObject({
      moduleId: "heroes", available: true, active: false, reason: "module_missing"
    });
    expect(view.heroes).toEqual({
      authoring: engine.HEROES_MECHANICS_SCHEMA,
      enabled: false,
      profileIds: [],
      profileUses: {}
    });
    expect(transactionBytes(projectDir)).toEqual(before);
  }, 15_000);

  it("previews and applies the exact profile through the generic three-file transaction", async () => {
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const preview = await previewMechanicsModule(projectDir, request());

    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      validation: { ok: true, issues: [] },
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: {
          schemaVersion: 1,
          modules: {
            heroes: {
              schemaVersion: 1,
              enabled: true,
              profiles: { field_commander: request().profile }
            }
          }
        },
        balance: {
          missions: {
            tutorial_01: { mechanics: { profiles: { heroes: "field_commander" } } }
          }
        }
      }
    });
    expect(transactionBytes(projectDir)).toEqual(before);

    const applied = await applyMechanicsModule(projectDir, {
      ...request(),
      ifRevision: preview.revision
    });
    expect(applied).toMatchObject({
      ok: true,
      written: true,
      previousRevision: preview.revision,
      backup: {
        files: {
          project: { existed: true },
          balance: { existed: true },
          mechanics: { existed: false }
        }
      }
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "content", "mechanics.json"), "utf8")))
      .toEqual(preview.candidate.mechanics);

    const reread = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });
    expect(reread.heroes).toMatchObject({
      enabled: true,
      moduleSchemaVersion: 1,
      selectedProfileId: "field_commander",
      selectedProfile: request().profile,
      profileIds: ["field_commander"],
      profileUses: { field_commander: ["tutorial_01"] }
    });
    expect(reread.capabilities.heroes).toMatchObject({
      available: true, active: true, profileId: "field_commander", reason: "active"
    });
  }, 15_000);

  it("rejects stale apply and malformed rosters without changing any transaction bytes", async () => {
    const projectDir = fixture();
    const preview = await previewMechanicsModule(projectDir, request());
    expect(preview.ok).toBe(true);
    fs.appendFileSync(path.join(projectDir, "content", "balance.json"), " ", "utf8");
    const concurrent = transactionBytes(projectDir);
    const stale = await applyMechanicsModule(projectDir, {
      ...request(),
      ifRevision: preview.revision
    });
    expect(stale).toMatchObject({ ok: false, conflict: true, expectedRevision: preview.revision });
    expect(transactionBytes(projectDir)).toEqual(concurrent);

    const malformed = await previewMechanicsModule(projectDir, request({
      profile: {
        selectedHeroId: "ghost",
        definitions: { commander: { label: "Commander", spawn: "spawn" } }
      }
    }));
    expect(malformed.ok).toBe(false);
    expect(malformed.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/heroes|selectedHeroId|spawn/i)
      })
    ]));
    expect(transactionBytes(projectDir)).toEqual(concurrent);
  }, 15_000);
});

describe("R5.2A CLI durable hero authoring", () => {
  it("previews and applies an exact heroes v3 profile through the existing guarded transaction", async () => {
    const projectDir = fixture();
    const durable = request({
      moduleSchemaVersion: 3,
      profileId: "durable_commander",
      profile: {
        selectedHeroId: "commander",
        definitions: {
          commander: {
            label: "Commander",
            spawn: "core",
            movement: { movementProfileId: "ground", speed: 1 },
            durability: { maxHp: 100, shield: { capacity: 25 } }
          }
        },
        movementProfiles: {
          ground: {
            label: "Ground",
            terrainMode: "respect_walkable",
            towerOccupancy: "blocked",
            defaultTerrainCost: 1000
          }
        }
      }
    });

    const preview = await previewMechanicsModule(projectDir, durable);
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      validation: { ok: true, issues: [] },
      candidate: {
        mechanics: { modules: { heroes: { schemaVersion: 3, enabled: true } } },
        balance: {
          missions: {
            tutorial_01: { mechanics: { profiles: { heroes: "durable_commander" } } }
          }
        }
      }
    });
    expect(preview.candidate.mechanics.modules.navigation).toBeUndefined();

    const applied = await applyMechanicsModule(projectDir, {
      ...durable,
      ifRevision: preview.revision
    });
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });

    const reread = await inspectMechanicsAuthoring(projectDir, { missionId: "tutorial_01" });
    expect(reread.heroes).toMatchObject({
      enabled: true,
      moduleSchemaVersion: 3,
      selectedProfileId: "durable_commander",
      selectedProfile: durable.profile
    });
    expect(reread.capabilities.navigation.active).toBe(false);
  }, 15_000);
});
