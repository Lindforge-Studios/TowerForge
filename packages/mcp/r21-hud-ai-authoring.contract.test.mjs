import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AI_TOOL_NAMES, aiWriteToolNames, selectAiTools } from "../studio/lib/ai-tool-policy.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function variant(width, height) {
  return { schemaVersion: 1, designViewport: { width, height }, rootNodeIds: [] };
}

function profile() {
  return {
    schemaVersion: 1,
    label: "AI authored HUD",
    breakpoints: { mobileMax: 767, tabletMax: 1199 },
    commonNodes: [],
    variants: {
      desktop: variant(1920, 1080), tablet: variant(1024, 768), mobile: variant(390, 844)
    },
    screens: { gameplay: { schemaVersion: 1, surface: "gameplay", rootNodeIds: [] } },
    screenGraph: { schemaVersion: 1, initialScreenId: "gameplay", transitions: [] },
    assetRoles: {}
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r21-hud-ai-"));
  roots.push(root);
  const projectDir = path.join(root, "starter.tdproj");
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  const projectPath = path.join(projectDir, "project.json");
  const targetsPath = path.join(projectDir, "build-targets.json");
  const manifest = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  fs.writeFileSync(projectPath, `${JSON.stringify({ ...manifest, schemaVersion: 5 }, null, 2)}\n`);
  fs.writeFileSync(targetsPath, `${JSON.stringify({
    schemaVersion: 2,
    defaults: { web: "desktop-hud" },
    targets: {
      "desktop-hud": {
        id: "desktop-hud", platform: "web", renderer: "canvas", webDir: "dist-hud",
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
        quality: "high", locale: "en", inputProfile: "keyboard_mouse", hudProfileId: "main"
      }
    }
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(projectDir, "content", "hud.json"), `${JSON.stringify({
    schemaVersion: 1, profiles: { main: profile() }
  }, null, 2)}\n`);
  return projectDir;
}

function tool(name) {
  const result = TOOLS.find((entry) => entry.name === name);
  expect(result, `${name} must be registered`).toBeDefined();
  return result;
}

function ownedBytes(projectDir) {
  return ["project.json", "build-targets.json", "content/hud.json", "content/visuals.json"]
    .map((relative) => fs.readFileSync(path.join(projectDir, relative), "utf8"));
}

describe("R21.6 MCP/AI HUD authoring and rendered-preview domain (RED)", () => {
  it("describes components, selectors, actions, screens, constraints, presets and the narrow transaction", async () => {
    expect(await callTool("describe_schema", { domain: "hud" }, {})).toMatchObject({
      requestedDomain: "hud",
      availableDomains: expect.arrayContaining(["hud"]),
      hud: {
        schemaVersion: 1,
        projectSchemaVersion: 5,
        buildTargetsSchemaVersion: 2,
        components: expect.arrayContaining(["button", "build_menu", "radial_menu", "nine_slice"]),
        selectors: expect.any(Object),
        actions: expect.any(Object),
        screenEvents: expect.any(Array),
        constraints: expect.objectContaining({ profiles: 16, screensPerProfile: 32, nodesPerProfile: 512 }),
        presets: expect.arrayContaining(["desktop_quickbar", "radial_wheel", "mobile_bottom_sheet"]),
        authoringTransaction: {
          read: "get_hud_profiles", recipe: "get_hud_profile_recipe",
          preview: "preview_hud_profile", apply: "apply_hud_profile",
          renderPreview: "render_hud_preview", revisionGuard: "ifRevision"
        }
      }
    });
  });

  it("registers closed read/recipe/preview/apply/render tools with exact risk metadata", () => {
    expect(tool("get_hud_profiles")).toMatchObject({ riskClass: "read_only", sideEffect: "none" });
    expect(tool("get_hud_profile_recipe")).toMatchObject({ riskClass: "read_only", sideEffect: "none" });
    expect(tool("preview_hud_profile")).toMatchObject({
      riskClass: "compute_only", inputSchema: expect.objectContaining({ additionalProperties: false })
    });
    expect(tool("apply_hud_profile")).toMatchObject({
      riskClass: "write_local",
      sideEffect: expect.stringMatching(/revision.*validation.*backup.*rollback/i),
      inputSchema: expect.objectContaining({
        required: expect.arrayContaining(["projectDir", "profileId", "profile", "ifRevision"]),
        additionalProperties: false
      })
    });
    expect(tool("render_hud_preview")).toMatchObject({
      riskClass: "compute_only", sideEffect: expect.stringMatching(/none|writes no project files/i),
      inputSchema: expect.objectContaining({ additionalProperties: false })
    });
    expect(TOOLS.map((entry) => entry.name)).not.toEqual(expect.arrayContaining([
      "replace_hud_catalog", "write_hud_catalog", "write_hud_html", "execute_hud_script"
    ]));
  });

  it("describes validated asset presentation metadata without widening the guarded write flow", async () => {
    const described = await callTool("describe_schema", { domain: "hud" }, {});
    expect(described.hud.assetMetadata).toEqual({
      field: "profile.assetMetadata",
      optional: true,
      roleReferences: "profile.assetRoles",
      schemaVersion: 1,
      kinds: ["image", "atlas_frame", "nine_slice"],
      atlasFrame: { requiredFor: "atlas_frame", type: "bounded_id" },
      nineSlice: {
        requiredFor: "nine_slice",
        fields: ["top", "right", "bottom", "left"],
        values: "bounded_non_negative_numbers"
      }
    });
    expect(described.hud.authoringTransaction).toMatchObject({
      preview: "preview_hud_profile",
      apply: "apply_hud_profile",
      revisionGuard: "ifRevision"
    });
    expect(TOOLS.map((entry) => entry.name)).not.toEqual(expect.arrayContaining([
      "write_hud_asset_metadata", "replace_hud_asset_metadata", "apply_hud_asset_metadata"
    ]));
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /HUD[\s\S]*assetMetadata[\s\S]*image[\s\S]*atlas_frame[\s\S]*nine_slice[\s\S]*preview_hud_profile[\s\S]*apply_hud_profile[\s\S]*ifRevision/i
    );
  });

  it("completes describe/read/recipe/preview/guarded apply/validate without widening the write", async () => {
    const projectDir = fixture();
    const read = await callTool("get_hud_profiles", { projectDir }, {});
    const recipe = await callTool("get_hud_profile_recipe", {
      recipeId: "desktop_quickbar", profileId: "ai-main"
    }, {});
    expect(recipe).toMatchObject({ detached: true, written: false, profile: { schemaVersion: 1 } });
    const candidate = {
      projectDir, profileId: "ai-main", profile: recipe.profile,
      binding: { targetId: "desktop-hud", enabled: true }
    };
    const before = ownedBytes(projectDir);
    const preview = await callTool("preview_hud_profile", candidate, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false, revision: read.revision });
    expect(ownedBytes(projectDir)).toEqual(before);
    const applied = await callTool("apply_hud_profile", { ...candidate, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({ ok: true, written: true, rolledBack: false });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    expect(await callTool("apply_hud_profile", {
      ...candidate, ifRevision: preview.revision
    }, {})).toMatchObject({ ok: false, conflict: true, written: false });
  }, 30_000);

  it("renders a detached mock-state preview without changing any owned source", async () => {
    const projectDir = fixture();
    const before = ownedBytes(projectDir);
    const rendered = await callTool("render_hud_preview", {
      projectDir, targetId: "desktop-hud", profileId: "main", screenId: "gameplay",
      viewport: { width: 1920, height: 1080 }, mockState: "victory"
    }, {});
    expect(rendered).toMatchObject({
      ok: true, written: false, profileId: "main", screenId: "gameplay", variantId: "desktop",
      renderPlan: { schemaVersion: 1, nodes: expect.any(Array), diagnostics: expect.any(Array) }
    });
    expect(rendered).not.toHaveProperty("html");
    expect(rendered).not.toHaveProperty("javascript");
    expect(ownedBytes(projectDir)).toEqual(before);
  });

  it("teaches both external and embedded agents the guarded HUD workflow", () => {
    const names = ["get_hud_profiles", "get_hud_profile_recipe", "preview_hud_profile", "apply_hud_profile", "render_hud_preview"];
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(54);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /describe_schema[\s\S]{0,160}hud[\s\S]*get_hud_profiles[\s\S]*get_hud_profile_recipe[\s\S]*preview_hud_profile[\s\S]*apply_hud_profile[\s\S]*render_hud_preview[\s\S]*ifRevision/i
    );
    expect(names.every((name) => AI_TOOL_NAMES.includes(name))).toBe(true);
    const selected = selectAiTools(names.map((name) => tool(name)));
    expect(selected.map((entry) => entry.name)).toEqual(names);
    expect(selected.every((entry) => !Object.hasOwn(entry.inputSchema.properties, "projectDir"))).toBe(true);
    expect([...aiWriteToolNames(selected)]).toEqual(["apply_hud_profile"]);
  });
});
