import { describe, expect, it } from "vitest";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool } from "./tools.mjs";

describe("R14 Arsenal MCP/AI discovery", () => {
  it("describes the guarded authoring, v2 run, authoritative snapshot and both v7 commands", async () => {
    const descriptor = await callTool("describe_schema", { domain: "arsenal" }, {});
    expect(descriptor.arsenal.authoring).toMatchObject({ schemaVersion: 1, moduleId: "arsenal" });
    expect(descriptor.arsenal.campaignRun).toMatchObject({ schemaVersion: 2, field: "arsenal.moduleInventory" });
    expect(descriptor.arsenal.snapshot.engineOwnedFields).toContain("availableModules");
    expect(descriptor.arsenal.commands).toMatchObject({
      schemaVersion: 7,
      configureTowerModules: { phase: "setup_or_between" },
      craftGem: { board: "3x3", phase: "setup_or_between" }
    });
    expect(descriptor.arsenal.recipes).toContain("basic_modular_arsenal");
  }, 15_000);

  it("teaches agents to discover, preview and guarded-apply without a broad write tool", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBe(48);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/describe_schema.*arsenal[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module/);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/configureTowerModules[\s\S]*craftGem/);
  });
});
