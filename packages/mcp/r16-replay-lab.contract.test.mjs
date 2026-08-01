import { describe, expect, it } from "vitest";
import { callTool, TOOLS } from "./tools.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";

const NAMES = ["inspect_replay_archive", "verify_replay_archive", "analyze_replay_branch"];

describe("R16.3 Replay Lab MCP compute-only discovery contract (RED)", () => {
  it("describes archive, ghost and branch versions through the isolated entrypoint", async () => {
    expect(await callTool("describe_schema", { domain: "replayLab" }, {})).toMatchObject({
      requestedDomain: "replayLab",
      availableDomains: expect.arrayContaining(["replayLab"]),
      replayLab: {
        entrypoint: "@towerforge/engine/replay-lab",
        versions: { archive: 1, ghost: 1, branch: 1 },
        limits: { archiveBytes: 72 * 1_024 * 1_024, ghostCachedFrames: 256 },
        analysis: {
          inspect: "inspect_replay_archive",
          verify: "verify_replay_archive",
          branch: "analyze_replay_branch"
        }
      }
    });
  }, 20_000);

  it("advertises only narrow compute-only Replay Lab tools and no replay writer", () => {
    for (const name of NAMES) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      expect(tool).toMatchObject({
        riskClass: "compute_only",
        sideEffect: expect.stringMatching(/writes no project files/i),
        inputSchema: expect.objectContaining({ additionalProperties: false })
      });
      expect(JSON.stringify(tool)).toMatch(/replay|archive|branch/i);
    }
    expect(TOOLS.filter((tool) => /replay/i.test(tool.name) && tool.riskClass === "write_local")).toEqual([]);
  });

  it("teaches agents the inspect -> verify -> branch-analysis workflow without network or writes", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(49);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/Replay Lab[\s\S]*inspect_replay_archive[\s\S]*verify_replay_archive[\s\S]*analyze_replay_branch/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/compute-only[\s\S]*(?:no network|never opens a socket)[\s\S]*writes no project files/i);
  });
});
