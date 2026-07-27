import { describe, expect, it } from "vitest";
import { AI_TOOL_NAMES, aiWriteToolNames, isAiToolName, selectAiTools, selectAiToolsForMode } from "./ai-tool-policy.mjs";

describe("Studio AI tool policy", () => {
  const tools = [
    { name: "get_entity", riskClass: "read_only", inputSchema: { type: "object", properties: { projectDir: { type: "string" }, id: { type: "string" } }, required: ["projectDir", "id"] } },
    { name: "get_recipe", riskClass: "read_only", inputSchema: { type: "object", properties: { projectDir: { type: "string" }, collection: { type: "string" }, recipeId: { type: "string" }, parameters: { type: "object", additionalProperties: false } }, required: ["projectDir", "collection", "recipeId"] } },
    { name: "upsert_entity", riskClass: "write_local" },
    { name: "write_map", riskClass: "write_local" },
    { name: "list_theme_packs", riskClass: "read_only" },
    { name: "preview_theme_pack", riskClass: "compute_only" },
    { name: "apply_theme_pack", riskClass: "write_local" },
    { name: "get_capabilities", riskClass: "read_only" },
    { name: "analyze_line_of_sight", riskClass: "compute_only" },
    { name: "preview_map_elevations", riskClass: "read_only" },
    { name: "apply_map_elevations", riskClass: "write_local" },
    { name: "preview_mechanics_module", riskClass: "read_only" },
    { name: "apply_mechanics_module", riskClass: "write_local" },
    { name: "build_project", riskClass: "write_local" },
    { name: "package_desktop", riskClass: "write_local" }
  ];

  it("exposes authoring tools but keeps build and packaging outside chat", () => {
    expect(selectAiTools(tools).map((tool) => tool.name)).toEqual([
      "get_entity", "get_recipe", "upsert_entity", "write_map", "list_theme_packs", "preview_theme_pack", "apply_theme_pack",
      "get_capabilities", "analyze_line_of_sight", "preview_map_elevations", "apply_map_elevations",
      "preview_mechanics_module", "apply_mechanics_module"
    ]);
    expect(selectAiTools(tools)[0].inputSchema.properties).not.toHaveProperty("projectDir");
    expect(selectAiTools(tools)[0].inputSchema.required).toEqual(["id"]);
    const recipeTool = selectAiTools(tools).find((tool) => tool.name === "get_recipe");
    expect(recipeTool.inputSchema.properties).not.toHaveProperty("projectDir");
    expect(recipeTool.inputSchema.properties.parameters).toEqual({ type: "object", additionalProperties: false });
    expect(recipeTool.inputSchema.required).toEqual(["collection", "recipeId"]);
    expect(AI_TOOL_NAMES).toContain("compile_maps");
    expect(AI_TOOL_NAMES).toContain("bind_mission_music");
    expect(AI_TOOL_NAMES).toContain("upsert_story_comic");
    expect(AI_TOOL_NAMES).toContain("list_theme_packs");
    expect(AI_TOOL_NAMES).toContain("preview_theme_pack");
    expect(AI_TOOL_NAMES).toContain("apply_theme_pack");
    expect(AI_TOOL_NAMES).toContain("apply_progression_patch");
    expect(AI_TOOL_NAMES).toContain("dry_run_progression_patch");
    expect(AI_TOOL_NAMES).toContain("get_progression");
    expect(AI_TOOL_NAMES).toContain("get_capabilities");
    expect(AI_TOOL_NAMES).toContain("analyze_line_of_sight");
    expect(AI_TOOL_NAMES).toContain("preview_map_elevations");
    expect(AI_TOOL_NAMES).toContain("apply_map_elevations");
    expect(AI_TOOL_NAMES).toContain("preview_mechanics_module");
    expect(AI_TOOL_NAMES).toContain("apply_mechanics_module");
    expect(AI_TOOL_NAMES).toContain("get_tower_script_graph");
    expect(AI_TOOL_NAMES).toContain("preview_tower_script_graph");
    expect(AI_TOOL_NAMES).toContain("apply_tower_script_graph");
    expect(AI_TOOL_NAMES).toContain("describe_schema");
    expect(AI_TOOL_NAMES).toContain("get_recipe");
    expect(AI_TOOL_NAMES).not.toContain("analyze_terraforming");
    expect(isAiToolName("build_project")).toBe(false);
    expect(isAiToolName("package_desktop")).toBe(false);
  });

  it("derives write detection from MCP risk metadata", () => {
    expect([...aiWriteToolNames(tools)].sort()).toEqual([
      "apply_map_elevations", "apply_mechanics_module", "apply_theme_pack", "upsert_entity", "write_map"
    ]);
  });

  it("enforces Ask, Plan, and Act capability levels", () => {
    const modeTools = [
      { name: "get_entity", riskClass: "read_only", inputSchema: { type: "object", properties: {} } },
      { name: "get_recipe", riskClass: "read_only", inputSchema: { type: "object", properties: { projectDir: { type: "string" }, parameters: { type: "object" } }, required: ["projectDir"] } },
      { name: "balance_report", riskClass: "compute_only", inputSchema: { type: "object", properties: {} } },
      { name: "dry_run_balance_patch", riskClass: "compute_only", inputSchema: { type: "object", properties: {} } },
      { name: "upsert_entity", riskClass: "write_local", inputSchema: { type: "object", properties: {} } },
      { name: "get_capabilities", riskClass: "read_only", inputSchema: { type: "object", properties: {} } },
      { name: "analyze_line_of_sight", riskClass: "compute_only", inputSchema: { type: "object", properties: {} } },
      { name: "preview_map_elevations", riskClass: "read_only", inputSchema: { type: "object", properties: {} } },
      { name: "apply_map_elevations", riskClass: "write_local", inputSchema: { type: "object", properties: {} } },
      { name: "preview_mechanics_module", riskClass: "read_only", inputSchema: { type: "object", properties: {} } },
      { name: "apply_mechanics_module", riskClass: "write_local", inputSchema: { type: "object", properties: {} } }
    ];
    expect(selectAiToolsForMode(modeTools, "ask").map((tool) => tool.name)).toEqual([
      "get_entity", "get_recipe", "balance_report", "get_capabilities", "analyze_line_of_sight", "preview_map_elevations", "preview_mechanics_module"
    ]);
    expect(selectAiToolsForMode(modeTools, "plan").map((tool) => tool.name)).toEqual([
      "get_entity", "get_recipe", "balance_report", "dry_run_balance_patch", "get_capabilities", "analyze_line_of_sight",
      "preview_map_elevations", "preview_mechanics_module"
    ]);
    expect(selectAiToolsForMode(modeTools, "act").map((tool) => tool.name)).toEqual([
      "get_entity", "get_recipe", "balance_report", "dry_run_balance_patch", "upsert_entity",
      "get_capabilities", "analyze_line_of_sight", "preview_map_elevations", "apply_map_elevations",
      "preview_mechanics_module", "apply_mechanics_module"
    ]);
  });
});
