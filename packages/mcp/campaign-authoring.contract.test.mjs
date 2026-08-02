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
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r44a-campaign-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function graph() {
  return {
    schemaVersion: 1,
    rogueliteProfileId: "campaign_run",
    entryNodeIds: ["start"],
    nodes: [{
      id: "start",
      type: "battle",
      missionId: "tutorial_01",
      regionId: "forest",
      x: 200,
      y: 300,
      difficulty: 1,
      nextNodeIds: []
    }]
  };
}

async function rejection(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error("Expected operation to reject.");
}

describe("R4.4A MCP campaign authoring contract", () => {
  it("publishes narrow get/preview/apply tools with exact risk and revision metadata", () => {
    const previewTool = TOOLS.find((tool) => tool.name === "preview_campaign");
    const applyTool = TOOLS.find((tool) => tool.name === "apply_campaign");
    expect(TOOLS.find((tool) => tool.name === "get_campaign")).toMatchObject({
      riskClass: "read_only",
      sideEffect: "none",
      inputSchema: {
        type: "object",
        properties: { projectDir: expect.any(Object) },
        additionalProperties: false
      }
    });
    expect(previewTool).toMatchObject({
      riskClass: "read_only",
      sideEffect: "none",
      inputSchema: {
        properties: {
          projectDir: expect.any(Object),
          profileId: expect.any(Object),
          campaign: {
            oneOf: [
              {
                type: "object",
                required: ["schemaVersion", "rogueliteProfileId", "entryNodeIds", "nodes"],
                additionalProperties: false,
                properties: {
                  schemaVersion: { const: 1 },
                  nodes: {
                    type: "array",
                    maxItems: 1_024,
                    items: {
                      oneOf: [
                        {
                          required: ["id", "type", "missionId", "regionId", "x", "y", "difficulty", "nextNodeIds"],
                          additionalProperties: false,
                          properties: { type: { enum: ["battle", "elite", "boss"] } }
                        },
                        {
                          required: ["id", "type", "label", "regionId", "x", "y", "difficulty", "nextNodeIds"],
                          additionalProperties: false,
                          properties: { type: { enum: ["merchant", "event"] } }
                        }
                      ]
                    }
                  }
                }
              },
              {
                type: "object",
                required: ["schemaVersion", "rogueliteProfileId", "runResources", "entryNodeIds", "nodes"],
                additionalProperties: false,
                properties: {
                  schemaVersion: { const: 2 },
                  runResources: { type: "object", maxProperties: 256 },
                  nodes: {
                    type: "array",
                    maxItems: 1_024,
                    items: {
                      oneOf: [
                        expect.objectContaining({
                          required: ["id", "type", "missionId", "regionId", "x", "y", "difficulty", "nextNodeIds"],
                          additionalProperties: false
                        }),
                        expect.objectContaining({
                          required: ["id", "type", "label", "regionId", "x", "y", "difficulty", "nextNodeIds", "choices"],
                          additionalProperties: false
                        })
                      ]
                    }
                  }
                }
              }
            ]
          },
          enabled: { type: "boolean", default: true }
        },
        required: ["profileId"],
        additionalProperties: false
      }
    });
    expect(applyTool).toMatchObject({
      riskClass: "write_local",
      sideEffect: expect.stringMatching(/project\.json.*world-map\.json.*balance\.json.*mechanics\.json.*revision.*validation.*backup.*rollback/i),
      inputSchema: {
        properties: {
          ifRevision: expect.any(Object),
          campaign: expect.objectContaining({
            oneOf: [
              expect.objectContaining({
                required: ["schemaVersion", "rogueliteProfileId", "entryNodeIds", "nodes"],
                additionalProperties: false
              }),
              expect.objectContaining({
                required: ["schemaVersion", "rogueliteProfileId", "runResources", "entryNodeIds", "nodes"],
                additionalProperties: false
              })
            ]
          })
        },
        required: ["profileId", "ifRevision"],
        additionalProperties: false
      }
    });
    expect(previewTool.inputSchema.properties.campaign)
      .toBe(applyTool.inputSchema.properties.campaign);
  });

  it("describes roguelite profile v4 and a bounded campaign graph without extending generic mechanics writes", async () => {
    const roguelite = await callTool("describe_schema", { domain: "roguelite" }, {});
    expect(roguelite).toMatchObject({
      schemaVersion: 5,
      requestedDomain: "roguelite",
      roguelite: {
        authoring: {
          schemaVersion: 4,
          supportedModuleSchemaVersions: [1, 2, 3, 4],
          profileVersions: {
            4: { requiredFields: ["synergies"], optionalFields: ["artifacts", "draft", "campaign"] }
          }
        },
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
          nodeTypes: ["battle", "elite", "merchant", "event", "boss"],
          limits: { nodes: 1_024, edges: 8_192, entryNodes: 64 }
        }
      }
    });
    expect(roguelite.roguelite.campaign.graph).toMatchObject({ supportedSchemaVersions: [1, 2] });
    expect(roguelite.roguelite.campaign.inputSchema.oneOf
      .map((variant) => variant.properties.schemaVersion.const)).toEqual([1, 2]);
    for (const name of ["preview_mechanics_module", "apply_mechanics_module"]) {
      expect(TOOLS.find((tool) => tool.name === name)?.inputSchema.properties.moduleSchemaVersion.enum)
        .toContain(4);
    }
  });

  it("runs read -> preview -> guarded apply -> read and rejects a stale apply", async () => {
    const projectDir = fixture();
    const before = await callTool("get_campaign", { projectDir }, {});
    expect(before).toMatchObject({
      schemaVersion: 1,
      revision: expect.any(String),
      campaignAuthored: false,
      active: false
    });

    const request = {
      projectDir,
      profileId: "campaign_run",
      campaign: graph(),
      enabled: true
    };
    const preview = await callTool("preview_campaign", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      revision: before.revision,
      candidate: {
        manifest: { schemaVersion: 3 },
        worldMap: { campaign: graph() },
        mechanics: { modules: { roguelite: { schemaVersion: 4, enabled: true } } },
        balance: { missions: { tutorial_01: { mechanics: { profiles: { roguelite: "campaign_run" } } } } }
      }
    });

    const applied = await callTool("apply_campaign", { ...request, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    expect(await callTool("get_campaign", { projectDir }, {})).toMatchObject({
      active: true,
      profileId: "campaign_run",
      campaign: graph()
    });
    const stale = await rejection(callTool("apply_campaign", {
      ...request,
      enabled: false,
      ifRevision: preview.revision
    }, {}));
    expect(stale).toMatchObject({ code: "conflict" });
  });
});
