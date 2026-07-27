import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r44b-campaign-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function graph() {
  return {
    schemaVersion: 2,
    rogueliteProfileId: "campaign_run",
    runResources: { coins: { label: "Coins" } },
    entryNodeIds: ["start"],
    nodes: [
      {
        id: "start", type: "battle", missionId: "tutorial_01", regionId: "forest",
        x: 200, y: 300, difficulty: 1, nextNodeIds: ["merchant"]
      },
      {
        id: "merchant", type: "merchant", label: "Field merchant", regionId: "forest",
        x: 420, y: 300, difficulty: 2, nextNodeIds: [],
        choices: [{ id: "supply", label: "Buy supply", costs: { coins: 3 }, grants: { coins: 1 } }]
      }
    ]
  };
}

async function rejection(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error("Expected operation to reject.");
}

describe("R4.4B MCP structural campaign authoring", () => {
  it("advertises the same exact v1/v2 graph schema for preview and guarded apply", async () => {
    const preview = TOOLS.find((tool) => tool.name === "preview_campaign");
    const apply = TOOLS.find((tool) => tool.name === "apply_campaign");
    expect(preview?.description).toMatch(/WorldCampaign v1\/v2/i);
    expect(apply?.description).toMatch(/WorldCampaign v1\/v2/i);
    expect(preview?.inputSchema.properties.campaign).toBe(apply?.inputSchema.properties.campaign);
    expect(preview?.inputSchema.properties.campaign).toMatchObject({
      oneOf: [
        { properties: { schemaVersion: { const: 1 } }, additionalProperties: false },
        {
          required: ["schemaVersion", "rogueliteProfileId", "runResources", "entryNodeIds", "nodes"],
          properties: { schemaVersion: { const: 2 } },
          additionalProperties: false
        }
      ]
    });

    expect(await callTool("describe_schema", { domain: "roguelite" }, {})).toMatchObject({
      roguelite: {
        campaign: {
          supportedSchemaVersions: [1, 2],
          versions: {
            1: { structuralNodes: { choices: false } },
            2: {
              root: {
                requiredFields: ["schemaVersion", "rogueliteProfileId", "runResources", "entryNodeIds", "nodes"]
              },
              structuralNodes: {
                requiredFields: ["id", "type", "label", "regionId", "x", "y", "difficulty", "nextNodeIds", "choices"],
                choice: {
                  requiredFields: ["id", "label", "costs", "grants"],
                  optionalFields: [],
                  additionalProperties: false
                }
              }
            }
          },
          inputSchema: expect.objectContaining({ oneOf: expect.any(Array) })
        }
      }
    });
  });

  it("runs describe -> read -> preview -> guarded apply -> validate for v2 and rejects stale reuse", async () => {
    const projectDir = fixture();
    await callTool("describe_schema", { domain: "roguelite" }, {});
    const before = await callTool("get_campaign", { projectDir }, {});
    expect(before).toMatchObject({ campaignAuthored: false, active: false, revision: expect.any(String) });
    const request = { projectDir, profileId: "campaign_run", campaign: graph(), enabled: true };
    const preview = await callTool("preview_campaign", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      candidate: { worldMap: { campaign: graph() } }
    });
    const applied = await callTool("apply_campaign", { ...request, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect(await callTool("get_campaign", { projectDir }, {})).toMatchObject({
      campaignAuthored: true,
      active: true,
      profileId: "campaign_run",
      campaign: graph()
    });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    expect(await rejection(callTool("apply_campaign", {
      ...request,
      enabled: false,
      ifRevision: preview.revision
    }, {}))).toMatchObject({ code: "conflict" });
  }, 20_000);
});
