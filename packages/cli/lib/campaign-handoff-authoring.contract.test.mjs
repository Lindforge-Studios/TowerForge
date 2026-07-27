import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyCampaignAuthoring,
  inspectCampaignAuthoring,
  previewCampaignAuthoring
} from "./campaign-authoring.mjs";
import { previewMechanicsModule } from "./mechanics-authoring.mjs";
import { migrateProjectFiles, writeMigratedProjectFiles } from "./project-migrations.mjs";
import { readRawProjectFiles } from "./project-loader.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r44c-authoring-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migrated.files);
  const files = readRawProjectFiles(projectDir);
  writeJson(path.join(projectDir, "project.json"), { ...files.manifest, schemaVersion: 3 });
  const towerId = Object.keys(files.balance.towers).sort()[0];
  if (towerId) files.balance.towers[towerId].tags = ["carry"];
  writeJson(path.join(projectDir, "content", "balance.json"), files.balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      roguelite: {
        schemaVersion: 3,
        enabled: true,
        profiles: {
          campaign_run: {
            synergies: {},
            artifacts: { definitions: {}, towerSlots: {}, bossLootTables: {} },
            draft: {
              definitions: {
                alpha: { label: "Alpha", effects: [{ kind: "modifier", scope: { kind: "all_towers" }, modifier: { target: "damage", operation: "additive_ratio", value: 0 } }] },
                beta: { label: "Beta", effects: [{ kind: "modifier", scope: { kind: "all_towers" }, modifier: { target: "damage", operation: "additive_ratio", value: 0 } }] },
                gamma: { label: "Gamma", effects: [{ kind: "modifier", scope: { kind: "all_towers" }, modifier: { target: "damage", operation: "additive_ratio", value: 0 } }] }
              },
              pools: {
                default: {
                  entries: ["alpha", "beta", "gamma"].map((cardId) => ({ cardId, weight: 1 }))
                }
              },
              defaultPoolId: "default"
            }
          }
        }
      }
    }
  });
  return projectDir;
}

function graph() {
  return {
    schemaVersion: 1,
    rogueliteProfileId: "campaign_run",
    entryNodeIds: ["battle"],
    nodes: [{
      id: "battle", type: "battle", missionId: "tutorial_01", regionId: "forest",
      x: 200, y: 300, difficulty: 1, nextNodeIds: []
    }]
  };
}

function transactionBytes(projectDir) {
  return ["project.json", "content/world-map.json", "content/balance.json", "content/mechanics.json"]
    .map((relativePath) => fs.readFileSync(path.join(projectDir, relativePath)).toString("base64"));
}

describe("R4.4C marker-v2 campaign authoring lifecycle", () => {
  it("upgrades only the campaign marker to v2 and preserves the v3 artifact/draft profile exactly", async () => {
    const projectDir = fixture();
    const beforeProfile = structuredClone(readRawProjectFiles(projectDir).mechanics.modules.roguelite.profiles.campaign_run);
    const request = { profileId: "campaign_run", campaign: graph(), enabled: true };
    const preview = await previewCampaignAuthoring(projectDir, request);
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false });
    expect(preview.candidate.mechanics.modules.roguelite).toMatchObject({
      schemaVersion: 4,
      enabled: true,
      profiles: { campaign_run: { campaign: { schemaVersion: 2 } } }
    });
    expect(preview.candidate.mechanics.modules.roguelite.profiles.campaign_run).toEqual({
      ...beforeProfile,
      campaign: { schemaVersion: 2 }
    });

    const applied = await applyCampaignAuthoring(projectDir, { ...request, ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, written: true });
    const enabled = readRawProjectFiles(projectDir);
    expect(enabled.mechanics.modules.roguelite.profiles.campaign_run).toEqual({
      ...beforeProfile,
      campaign: { schemaVersion: 2 }
    });

    const disablePreview = await previewCampaignAuthoring(projectDir, { profileId: "campaign_run", enabled: false });
    await applyCampaignAuthoring(projectDir, {
      profileId: "campaign_run", enabled: false, ifRevision: disablePreview.revision
    });
    const disabled = readRawProjectFiles(projectDir);
    expect(disabled.worldMap.campaign).toEqual(graph());
    expect(disabled.mechanics.modules.roguelite.profiles.campaign_run).toEqual(beforeProfile);

    const reenablePreview = await previewCampaignAuthoring(projectDir, request);
    await applyCampaignAuthoring(projectDir, { ...request, ifRevision: reenablePreview.revision });
    expect(readRawProjectFiles(projectDir).mechanics.modules.roguelite.profiles.campaign_run.campaign)
      .toEqual({ schemaVersion: 2 });
  }, 30_000);

  it("continues to inspect an already-authored marker-v1 campaign without writes", async () => {
    const projectDir = fixture();
    const files = readRawProjectFiles(projectDir);
    files.worldMap.campaign = graph();
    files.balance.missions.tutorial_01.mechanics = { profiles: { roguelite: "campaign_run" } };
    files.mechanics.modules.roguelite.schemaVersion = 4;
    // Keep this compatibility fixture intentionally at the original R4.4A shape. The combined
    // artifact/draft preservation contract is exercised independently by the marker-v2 test.
    delete files.mechanics.modules.roguelite.profiles.campaign_run.artifacts;
    delete files.mechanics.modules.roguelite.profiles.campaign_run.draft;
    files.mechanics.modules.roguelite.profiles.campaign_run.campaign = { schemaVersion: 1 };
    writeJson(path.join(projectDir, "content", "world-map.json"), files.worldMap);
    writeJson(path.join(projectDir, "content", "balance.json"), files.balance);
    writeJson(path.join(projectDir, "content", "mechanics.json"), files.mechanics);
    const before = transactionBytes(projectDir);

    expect(await inspectCampaignAuthoring(projectDir)).toMatchObject({
      campaignAuthored: true,
      active: true,
      profileId: "campaign_run",
      campaign: graph()
    });
    expect(transactionBytes(projectDir)).toEqual(before);
  });

  it("rejects generic AI/Studio profile replacement when any future campaign marker must be preserved", async () => {
    const projectDir = fixture();
    const files = readRawProjectFiles(projectDir);
    files.mechanics.modules.roguelite.schemaVersion = 4;
    files.mechanics.modules.roguelite.profiles.campaign_run.campaign = {
      schemaVersion: 3,
      rawFutureField: { preserve: ["exact", 3] }
    };
    writeJson(path.join(projectDir, "content", "mechanics.json"), files.mechanics);
    const before = transactionBytes(projectDir);

    const preview = await previewMechanicsModule(projectDir, {
      moduleId: "roguelite",
      moduleSchemaVersion: 4,
      missionId: "tutorial_01",
      profileId: "campaign_run",
      profile: { synergies: {} },
      enabled: true
    });
    expect(preview.ok).toBe(false);
    expect(preview.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "nested_version_unsupported",
        fieldPath: "modules.roguelite.profiles.campaign_run.campaign.schemaVersion"
      })
    ]));
    const campaignPreview = await previewCampaignAuthoring(projectDir, {
      profileId: "campaign_run",
      campaign: graph(),
      enabled: true
    });
    expect(campaignPreview.ok).toBe(false);
    expect(campaignPreview.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "nested_version_unsupported" })
    ]));
    expect(transactionBytes(projectDir)).toEqual(before);
  });
});
