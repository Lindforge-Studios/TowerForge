import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "./project-migrations.mjs";
import { readRawProjectFiles } from "./project-loader.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

async function campaignApi() {
  let candidate = {};
  try { candidate = await import("./campaign-authoring.mjs"); } catch { /* RED: module is introduced by R4.4A */ }
  for (const name of [
    "campaignAuthoringRevision",
    "inspectCampaignAuthoring",
    "previewCampaignAuthoring",
    "applyCampaignAuthoring"
  ]) expect(candidate[name], `${name} must be exported`).toBeTypeOf("function");
  return candidate;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r44a-campaign-authoring-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  const migrated = readRawProjectFiles(projectDir);
  writeJson(path.join(projectDir, "project.json"), { ...migrated.manifest, schemaVersion: 3 });
  const firstTowerId = Object.keys(migrated.balance.towers ?? {}).sort()[0];
  if (firstTowerId) migrated.balance.towers[firstTowerId].tags = ["tech"];
  writeJson(path.join(projectDir, "content", "balance.json"), migrated.balance);

  const mechanics = {
    schemaVersion: 1,
    modules: {
      roguelite: {
        schemaVersion: 3,
        enabled: true,
        profiles: {
          campaign_run: {
            synergies: {
              existing_synergy: {
                label: "Existing synergy",
                tag: "tech",
                tiers: [{
                  requiredCount: 2,
                  modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.1 }]
                }]
              }
            }
          }
        }
      }
    }
  };
  writeJson(path.join(projectDir, "content", "mechanics.json"), mechanics);
  return projectDir;
}

function campaign() {
  return {
    schemaVersion: 1,
    rogueliteProfileId: "campaign_run",
    entryNodeIds: ["battle_start"],
    nodes: [
      {
        id: "battle_start",
        type: "battle",
        missionId: "tutorial_01",
        regionId: "forest",
        x: 200,
        y: 300,
        difficulty: 1,
        nextNodeIds: ["event_offer"]
      },
      {
        id: "event_offer",
        type: "event",
        label: "A strange signal",
        regionId: "forest",
        x: 420,
        y: 300,
        difficulty: 2,
        nextNodeIds: []
      }
    ]
  };
}

function request(overrides = {}) {
  return {
    profileId: "campaign_run",
    campaign: campaign(),
    enabled: true,
    ...overrides
  };
}

function transactionBytes(projectDir) {
  return ["project.json", "content/world-map.json", "content/balance.json", "content/mechanics.json"]
    .map((relativePath) => fs.readFileSync(path.join(projectDir, relativePath)).toString("base64"));
}

describe("R4.4A guarded CLI campaign authoring", () => {
  it("uses one raw-byte revision over project, world map, balance, and mechanics", async () => {
    const api = await campaignApi();
    for (const relativePath of [
      "project.json",
      "content/world-map.json",
      "content/balance.json",
      "content/mechanics.json"
    ]) {
      const projectDir = fixture();
      const before = api.campaignAuthoringRevision(projectDir);
      fs.appendFileSync(path.join(projectDir, relativePath), " ", "utf8");
      expect(api.campaignAuthoringRevision(projectDir), relativePath).not.toBe(before);
    }
  }, 20_000);

  it("inspects without writes and previews a v4 opt-in while preserving existing roguelite sections", async () => {
    const api = await campaignApi();
    const projectDir = fixture();
    const before = transactionBytes(projectDir);
    const inspected = await api.inspectCampaignAuthoring(projectDir);
    expect(inspected).toMatchObject({
      schemaVersion: 1,
      revision: expect.any(String),
      rawProjectSchemaVersion: 3,
      campaignAuthored: false,
      active: false
    });
    expect(transactionBytes(projectDir)).toEqual(before);

    const preview = await api.previewCampaignAuthoring(projectDir, request());
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false, revision: inspected.revision });
    expect(preview.candidate.manifest.schemaVersion).toBe(3);
    expect(preview.candidate.worldMap.campaign).toEqual(campaign());
    expect(preview.candidate.mechanics.modules.roguelite).toMatchObject({
      schemaVersion: 4,
      enabled: true,
      profiles: {
        campaign_run: {
          synergies: expect.objectContaining({ existing_synergy: expect.any(Object) }),
          campaign: { schemaVersion: 1 }
        }
      }
    });
    expect(preview.candidate.balance.missions.tutorial_01.mechanics.profiles.roguelite)
      .toBe("campaign_run");
    expect(transactionBytes(projectDir)).toEqual(before);
  }, 20_000);

  it("applies with a revision, supports an exact no-op, and disables only the profile marker", async () => {
    const api = await campaignApi();
    const projectDir = fixture();
    const preview = await api.previewCampaignAuthoring(projectDir, request());
    const applied = await api.applyCampaignAuthoring(projectDir, { ...request(), ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, written: true, rolledBack: false, previousRevision: preview.revision });

    const reread = readRawProjectFiles(projectDir);
    expect(reread.worldMap.campaign).toEqual(campaign());
    expect(reread.mechanics.modules.roguelite.enabled).toBe(true);
    expect(reread.mechanics.modules.roguelite.profiles.campaign_run.campaign).toEqual({ schemaVersion: 1 });
    const unchanged = await api.previewCampaignAuthoring(projectDir, request());
    const noOp = await api.applyCampaignAuthoring(projectDir, { ...request(), ifRevision: unchanged.revision });
    expect(noOp).toMatchObject({ ok: true, written: false, rolledBack: false, revision: unchanged.revision });

    const disabledPreview = await api.previewCampaignAuthoring(projectDir, {
      profileId: "campaign_run",
      enabled: false
    });
    const disabled = await api.applyCampaignAuthoring(projectDir, {
      profileId: "campaign_run",
      enabled: false,
      ifRevision: disabledPreview.revision
    });
    expect(disabled).toMatchObject({ ok: true, written: true });
    const disabledFiles = readRawProjectFiles(projectDir);
    expect(disabledFiles.worldMap.campaign).toEqual(campaign());
    expect(disabledFiles.mechanics.modules.roguelite.enabled).toBe(true);
    expect(disabledFiles.mechanics.modules.roguelite.profiles.campaign_run).not.toHaveProperty("campaign");
  }, 20_000);

  it("rejects stale writes and rolls all four files back after an injected final replace failure", async () => {
    const api = await campaignApi();
    const staleDir = fixture();
    const stalePreview = await api.previewCampaignAuthoring(staleDir, request());
    fs.appendFileSync(path.join(staleDir, "content", "world-map.json"), " ", "utf8");
    const externallyEdited = transactionBytes(staleDir);
    const stale = await api.applyCampaignAuthoring(staleDir, { ...request(), ifRevision: stalePreview.revision });
    expect(stale).toMatchObject({ ok: false, written: false, conflict: true });
    expect(transactionBytes(staleDir)).toEqual(externallyEdited);

    const rollbackDir = fixture();
    const before = transactionBytes(rollbackDir);
    const preview = await api.previewCampaignAuthoring(rollbackDir, request());
    await expect(api.applyCampaignAuthoring(rollbackDir, {
      ...request(),
      ifRevision: preview.revision
    }, {
      afterFileReplace(relativePath) {
        if (relativePath === "content/balance.json") throw new Error("R44A_INJECTED_FINAL_REPLACE_FAILURE");
      }
    })).rejects.toThrow("R44A_INJECTED_FINAL_REPLACE_FAILURE");
    expect(transactionBytes(rollbackDir)).toEqual(before);
  }, 20_000);

  it("never follows a content parent swapped to an external symlink between file replacements", async () => {
    const api = await campaignApi();
    const projectDir = fixture();
    const preview = await api.previewCampaignAuthoring(projectDir, request());
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r44a-campaign-outside-"));
    projects.push(outsideDir);
    fs.cpSync(path.join(projectDir, "content"), outsideDir, { recursive: true });
    const externalFiles = ["world-map.json", "balance.json", "mechanics.json"];
    const beforeOutside = externalFiles.map((name) => fs.readFileSync(path.join(outsideDir, name)));

    await expect(api.applyCampaignAuthoring(projectDir, {
      ...request(),
      ifRevision: preview.revision
    }, {
      afterFileReplace(relativePath) {
        if (relativePath !== "project.json") return;
        fs.renameSync(path.join(projectDir, "content"), path.join(projectDir, "content-owned"));
        for (const name of fs.readdirSync(path.join(projectDir, "content-owned"))) {
          if (name.includes(".campaign-stage.")) {
            fs.copyFileSync(path.join(projectDir, "content-owned", name), path.join(outsideDir, name));
          }
        }
        fs.symlinkSync(outsideDir, path.join(projectDir, "content"), "dir");
      }
    })).rejects.toMatchObject({ code: "source_unsafe", rolledBack: true });

    expect(externalFiles.map((name) => fs.readFileSync(path.join(outsideDir, name))))
      .toEqual(beforeOutside);
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).schemaVersion).toBe(3);
  }, 20_000);

  it("keeps prototype-looking profile and mission ids inert during preview", async () => {
    const api = await campaignApi();
    const structuralCampaign = {
      schemaVersion: 2,
      rogueliteProfileId: "__proto__",
      runResources: { coins: { label: "Coins" } },
      entryNodeIds: ["event"],
      nodes: [{
        id: "event",
        type: "event",
        label: "Event",
        regionId: "forest",
        x: 200,
        y: 300,
        difficulty: 1,
        nextNodeIds: [],
        choices: [{ id: "grant", label: "Grant", costs: {}, grants: { coins: 1 } }]
      }]
    };
    delete Object.prototype.campaign;
    delete Object.prototype.mechanics;
    try {
      const profileDir = fixture();
      const preview = await api.previewCampaignAuthoring(profileDir, {
        profileId: "__proto__",
        campaign: structuralCampaign,
        enabled: true
      });
      expect(preview.ok).toBe(true);
      const profiles = preview.candidate.mechanics.modules.roguelite.profiles;
      expect(Object.prototype.hasOwnProperty.call(profiles, "__proto__")).toBe(true);
      expect(profiles.__proto__).toMatchObject({ synergies: {}, campaign: { schemaVersion: 1 } });
      expect(Object.prototype).not.toHaveProperty("campaign");

      const missionDir = fixture();
      const badMission = structuredClone(campaign());
      badMission.nodes[0].missionId = "__proto__";
      const rejected = await api.previewCampaignAuthoring(missionDir, request({ campaign: badMission }));
      expect(rejected).toMatchObject({ ok: false, written: false });
      expect(Object.prototype).not.toHaveProperty("mechanics");
    } finally {
      delete Object.prototype.campaign;
      delete Object.prototype.mechanics;
    }
  }, 20_000);
});
