import { describe, expect, it } from "vitest";
import { TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

function tool(name) {
  const found = TOOLS.find((entry) => entry.name === name);
  expect(found, `${name} must be registered`).toBeDefined();
  return found;
}

describe("R19.1 MCP first-class native desktop target surface", () => {
  it("describes native desktop separately from the retained R18 web desktop recipe", async () => {
    const described = await callTool("describe_schema", { domain: "playerTargets" }, {});
    expect(described).toMatchObject({
      requestedDomain: "playerTargets",
      playerTargets: {
        projectSchemaVersion: 5,
        buildTargetsSchemaVersion: 2,
        desktop: { formFactor: "desktop", viewport: { fit: "contain" } },
        nativeDesktop: {
          platform: "desktop",
          defaultSelector: "defaults.desktop",
          window: { width: 1440, height: 900, minWidth: 1024, minHeight: 720, fullscreen: false, resizable: true },
          bundle: {
            iconSource: expect.stringMatching(/1024x1024 PNG/i),
            targets: ["dmg", "nsis", "msi", "appimage", "deb", "rpm"]
          }
        },
        recipes: ["desktop_large_screen", "native_desktop_game"],
        packaging: { tool: "package_desktop", targetSpecific: true, legacyWebAdapter: true }
      }
    });
  });

  it("publishes a closed AI schema for the native target and exact recipe selection", () => {
    const recipe = tool("get_player_target_recipe");
    expect(recipe.inputSchema.properties.recipeId.enum).toEqual(["desktop_large_screen", "native_desktop_game"]);

    const target = tool("preview_player_target").inputSchema.properties.target;
    expect(target.properties.platform.enum).toEqual(["web", "android", "ios", "desktop"]);
    expect(target.properties.window).toMatchObject({
      type: "object",
      required: ["width", "height", "minWidth", "minHeight", "fullscreen", "resizable"],
      additionalProperties: false
    });
    expect(target.properties.bundle).toMatchObject({
      type: "object",
      required: ["iconSource", "targets"],
      additionalProperties: false
    });
    expect(target.properties.bundle.properties.targets.items.enum).toEqual(["dmg", "nsis", "msi", "appimage", "deb", "rpm"]);
  });

  it("requires an exact target for package_desktop and teaches agents not to fall back", () => {
    expect(tool("package_desktop")).toMatchObject({
      riskClass: "write_local",
      inputSchema: {
        required: ["targetId"],
        additionalProperties: false
      }
    });
    expect(tool("package_desktop").description).toMatch(/first-class.*desktop.*legacy web.*compatibility/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/native_desktop_game[\s\S]*preview_player_target[\s\S]*apply_player_target[\s\S]*package_desktop/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/never[\s\S]{0,120}(?:fallback|fall back|different target|first web target)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/desktop_large_screen[\s\S]{0,160}platform web|platform web[\s\S]{0,160}desktop_large_screen/i);
  });
});
