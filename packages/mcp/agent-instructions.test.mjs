import { describe, expect, it } from "vitest";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { TOOLS } from "./tools.mjs";

describe("TowerForge shared agent instructions", () => {
  it("routes every shipped authoring layer through the safe workflow", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBe(32);
    for (const phrase of ["universal pipeline", "TowerScript", "metaProgression", "list_theme_packs", "preview_tile_binding", "revision tokens", "validate_project", "list_workspace_projects", "get_capabilities", "content/mechanics.json", "basic_regenerating_shields", "basic_vulnerability_marks", "marks", "elemental_shatter", "wet_chain_shock", "poison_combustion", "prerequisites", "reactions", "basic_elemental_synergy", "towerTypeIds", "towerTags", "socketArtifact", "unsocketArtifact", "between-wave boundary", "get_campaign", "preview_campaign", "apply_campaign", "CampaignRun"]) {
      expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    }
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /get_capabilities[\s\S]*get_recipe[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*ifRevision/
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/disabled[\s\S]*legacy|legacy[\s\S]*disabled/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/reaction[\s\S]*(?:never|must not|do not)[\s\S]*(?:patch|edit)[\s\S]*(?:combat|terrain|balance)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/dependency_missing|reaction_terrain_tag_missing/);
    for (const code of ["project_migration_required", "module_unavailable", "validation", "conflict"]) {
      expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(code);
    }
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain("Never request or invent JavaScript");
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /describe_schema[\s\S]*scripts[\s\S]*get_tower_script_graph[\s\S]*preview_tower_script_graph[\s\S]*apply_tower_script_graph[\s\S]*ifRevision[\s\S]*validate_project/i
    );
  });

  it("routes opt-in elevation LoS through the compute-only candidate analysis without map mutation", () => {
    for (const phrase of [
      "basic_elevation_line_of_sight",
      "analyze_line_of_sight",
      "exact candidate",
      "elevation_terrain_tag_missing",
      "writes no project files"
    ]) expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /get_capabilities[\s\S]*preview_map_elevations[\s\S]*apply_map_elevations[\s\S]*preview_mechanics_module[\s\S]*analyze_line_of_sight[\s\S]*apply_mechanics_module/i
    );
  });

  it("routes opt-in navigation through discovery, guarded authoring, and validation without auto-enable", () => {
    for (const phrase of [
      "navigation",
      "describe_schema",
      "get_capabilities",
      "analyze_navigation",
      "preview_mechanics_module",
      "apply_mechanics_module",
      "validate_project",
      "authored_routes"
    ]) {
      expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    }
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /describe_schema[\s\S]*navigation[\s\S]*get_capabilities[\s\S]*analyze_navigation[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /navigation[\s\S]*(?:never|must not|does not|do not)[\s\S]*(?:auto[- ]?enable|enable automatically)/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /authored_routes[\s\S]*(?:legacy|existing movement|existing placement)|(?:legacy|existing movement|existing placement)[\s\S]*authored_routes/i
    );
  });

  it("advertises mechanics tools without stale R0A/navigation-unavailable or combat-only version wording", () => {
    const preview = TOOLS.find((tool) => tool.name === "preview_mechanics_module");
    const apply = TOOLS.find((tool) => tool.name === "apply_mechanics_module");
    expect(preview).toBeTruthy();
    expect(apply).toBeTruthy();

    for (const tool of [preview, apply]) {
      expect(tool.description).not.toMatch(/R0A/i);
      expect(tool.description).not.toMatch(/navigation[\s\S]*unavailable|unavailable[\s\S]*navigation/i);
      const versionDescription = tool.inputSchema.properties.moduleSchemaVersion.description;
      expect(versionDescription).toMatch(/navigation[\s\S]*v1/i);
      expect(versionDescription).toMatch(/combat[\s\S]*v1[\s\S]*v2[\s\S]*v3/i);
      expect(versionDescription).toMatch(/heroes[\s\S]*v1[\s\S]*v2[\s\S]*v3[\s\S]*v4[\s\S]*v5[\s\S]*v6/i);
      expect(versionDescription).not.toMatch(/^combat module contract version/i);
    }
  });
});
