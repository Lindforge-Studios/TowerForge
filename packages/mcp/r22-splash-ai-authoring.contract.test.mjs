import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AI_TOOL_NAMES, aiWriteToolNames, selectAiToolsForMode } from "../studio/lib/ai-tool-policy.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r22-splash-ai-"));
  roots.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const visuals = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
  visuals.sprites.frontier_before_battle.mimeType = "image/png";
  fs.writeFileSync(visualsPath, `${JSON.stringify(visuals, null, 2)}\n`, "utf8");
  return projectDir;
}

function tool(name) {
  const value = TOOLS.find((entry) => entry.name === name);
  expect(value, `${name} must be registered`).toBeDefined();
  return value;
}

function ownedBytes(projectDir) {
  const splashPath = path.join(projectDir, "content", "splashes.json");
  return [
    fs.readFileSync(path.join(projectDir, "project.json"), "utf8"),
    fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8"),
    fs.existsSync(splashPath) ? fs.readFileSync(splashPath, "utf8") : null,
    fs.readFileSync(path.join(projectDir, "content", "visuals.json"), "utf8")
  ];
}

describe("R22.3 MCP/AI splash authoring domain (RED)", () => {
  it("describes the bounded static playlist contract and narrow transaction", async () => {
    expect(await callTool("describe_schema", { domain: "splashes" }, {})).toMatchObject({
      requestedDomain: "splashes",
      availableDomains: expect.arrayContaining(["splashes"]),
      splashes: {
        schemaVersion: 1,
        projectSchemaVersion: 5,
        buildTargetsSchemaVersion: 2,
        splashCatalogSchemaVersion: 1,
        imageMimeTypes: ["image/png", "image/jpeg", "image/webp"],
        constraints: expect.objectContaining({ playlists: 16, itemsPerPlaylist: 8, totalPlaybackMs: 30_000 }),
        defaults: expect.objectContaining({ displayMs: 1_800, minimumMs: 600, transitionMs: 220 }),
        recipes: expect.arrayContaining(["single_brand_splash"]),
        authoringTransaction: {
          read: "get_splash_playlists",
          recipe: "get_splash_playlist_recipe",
          preview: "preview_splash_playlist",
          apply: "apply_splash_playlist",
          revisionGuard: "ifRevision"
        }
      }
    });
  });

  it("registers exactly four narrow tools with closed schemas and exact risk classes", () => {
    expect(tool("get_splash_playlists")).toMatchObject({ riskClass: "read_only", sideEffect: "none" });
    expect(tool("get_splash_playlist_recipe")).toMatchObject({
      riskClass: "read_only",
      inputSchema: expect.objectContaining({ additionalProperties: false })
    });
    expect(tool("preview_splash_playlist")).toMatchObject({
      riskClass: "compute_only",
      sideEffect: expect.stringMatching(/writes no project files/i),
      inputSchema: expect.objectContaining({ additionalProperties: false })
    });
    expect(tool("apply_splash_playlist")).toMatchObject({
      riskClass: "write_local",
      sideEffect: expect.stringMatching(/revision.*validation.*backup.*rollback/i),
      inputSchema: expect.objectContaining({
        required: expect.arrayContaining(["projectDir", "playlistId", "playlist", "binding", "ifRevision"]),
        additionalProperties: false
      })
    });
    expect(TOOLS.map((entry) => entry.name)).not.toEqual(expect.arrayContaining([
      "replace_splash_catalog", "write_splash_catalog", "write_splash_html", "execute_splash_script"
    ]));
  });

  it("completes describe/read/recipe/preview/guarded apply/validate without broad writes", async () => {
    const projectDir = fixture();
    const before = ownedBytes(projectDir);
    const read = await callTool("get_splash_playlists", { projectDir }, {});
    const recipe = await callTool("get_splash_playlist_recipe", {
      recipeId: "single_brand_splash",
      playlistId: "studio-intro",
      spriteId: "frontier_before_battle",
      accessibleLabel: "Lindforge Studios"
    }, {});
    expect(recipe).toMatchObject({ detached: true, written: false, playlist: { schemaVersion: 1 } });
    const candidate = {
      projectDir,
      playlistId: "studio-intro",
      playlist: recipe.playlist,
      binding: { targetId: "web-pwa", enabled: true }
    };
    const preview = await callTool("preview_splash_playlist", candidate, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false, revision: read.revision });
    expect(ownedBytes(projectDir)).toEqual(before);
    const applied = await callTool("apply_splash_playlist", { ...candidate, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({ ok: true, written: true, rolledBack: false });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    expect(await callTool("apply_splash_playlist", { ...candidate, ifRevision: preview.revision }, {}))
      .toMatchObject({ ok: false, conflict: true, written: false });
  }, 30_000);

  it("exposes read/compute tools in Ask and Plan and guarded apply only in Act", () => {
    const names = [
      "get_splash_playlists", "get_splash_playlist_recipe", "preview_splash_playlist", "apply_splash_playlist"
    ];
    expect(names.every((name) => AI_TOOL_NAMES.includes(name))).toBe(true);
    const tools = names.map(tool);
    expect(selectAiToolsForMode(tools, "ask").map((entry) => entry.name)).toEqual(names.slice(0, 3));
    expect(selectAiToolsForMode(tools, "plan").map((entry) => entry.name)).toEqual(names.slice(0, 3));
    expect(selectAiToolsForMode(tools, "act").map((entry) => entry.name)).toEqual(names);
    expect([...aiWriteToolNames(tools)]).toEqual(["apply_splash_playlist"]);
  });

  it("teaches agents that TowerForge remains first and generated assets use staging", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(55);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /splashes[\s\S]*TowerForge[\s\S]*get_splash_playlists[\s\S]*get_splash_playlist_recipe[\s\S]*preview_splash_playlist[\s\S]*apply_splash_playlist[\s\S]*ifRevision/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /stage_generated_asset[\s\S]*inspect_staged_asset[\s\S]*commit_staged_asset/i
    );
  });
});
