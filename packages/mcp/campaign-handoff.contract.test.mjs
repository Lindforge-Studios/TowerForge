import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const toolsSource = fs.readFileSync(path.resolve("packages/mcp/tools.mjs"), "utf8");

describe("R4.4C MCP/agent campaign handoff discovery", () => {
  it("describes marker-v2 carry without inventing another authoring or runtime tool", async () => {
    const described = await callTool("describe_schema", { domain: "roguelite" }, {});
    expect(described).toMatchObject({
      roguelite: {
        campaign: {
          handoff: {
            markerSchemaVersion: 2,
            campaignRunSchemaVersion: 1,
            prepare: "prepareCampaignBattle",
            settle: "settleCampaignBattleVictory",
            carries: ["deck", "artifacts"],
            socketPolicy: "cleared_between_battles",
            persistence: "explicit_import_export_only"
          }
        }
      }
    });
    expect(described.roguelite.authoring.campaign.supportedSchemaVersions).toEqual([1, 2]);
    expect(TOOLS.some((tool) => /campaign.*(?:battle|handoff)|(?:battle|handoff).*campaign/i.test(tool.name))).toBe(false);
    expect(toolsSource).not.toMatch(/name:\s*["'](?:prepareCampaignBattle|settleCampaignBattleVictory)["']/);
  });

  it("teaches agents the guarded authoring flow and forbids host-side loadout merging", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBe(30);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/campaign marker v2/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/prepareCampaignBattle[\s\S]*settleCampaignBattleVictory/);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/deck[\s\S]*artifacts[\s\S]*(?:unsocket|socket assignments)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/never[\s\S]{0,180}(?:merge|reconstruct)[\s\S]{0,180}snapshot/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/explicit[\s\S]{0,100}(?:import|export)[\s\S]{0,120}(?:not|never)[\s\S]{0,100}(?:profile|storage)/i);
  });
});
