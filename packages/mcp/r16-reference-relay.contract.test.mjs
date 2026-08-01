import { describe, expect, it } from "vitest";
import { callTool, TOOLS } from "./tools.mjs";
import { TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";

describe("R16.4 reference relay MCP discovery contract (RED)", () => {
  it("publishes deployment metadata without exposing a network or write tool", async () => {
    const described = await callTool("describe_schema", { domain: "replayLab" }, {});
    expect(described.replayLab.referenceRelay).toEqual({
      schemaVersion: 1,
      package: "@towerforge/reference-relay",
      defaultHost: "127.0.0.1",
      limits: { inviteCodeUtf8Bytes: 128, peerIdUtf8Bytes: 128, peersPerRoom: 4, frameBytes: 1_048_576, queuedFramesPerPeer: 256 },
      accounts: false,
      matchmaking: false,
      gameplayLogic: false
    });
    expect(TOOLS.filter((tool) => /relay/i.test(tool.name))).toEqual([]);
  }, 20_000);

  it("teaches self-host loopback and mandatory handshake without claiming hosted services", () => {
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/reference relay[\s\S]*@towerforge\/reference-relay[\s\S]*127\.0\.0\.1/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/capability handshake[\s\S]*(?:before|prior)[\s\S]*(?:frame|command)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/no accounts|without accounts/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).not.toMatch(/TowerForge Cloud (?:is|provides).*relay|hosted matchmaking is available/i);
  });
});
