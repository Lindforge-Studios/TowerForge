import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r18-player-targets-"));
  projects.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  return projectDir;
}

function tool(name) {
  const found = TOOLS.find((entry) => entry.name === name);
  expect(found, `${name} must be registered`).toBeDefined();
  return found;
}

function authoredBytes(projectDir) {
  return {
    manifest: fs.readFileSync(path.join(projectDir, "project.json"), "utf8"),
    buildTargets: fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8")
  };
}

describe("R18 playerTargets MCP/AI authoring (RED)", () => {
  it("describes the narrow read → inert recipe → compute preview → guarded apply workflow", async () => {
    const described = await callTool("describe_schema", { domain: "playerTargets" }, {});
    expect(described).toMatchObject({
      requestedDomain: "playerTargets",
      playerTargets: {
        projectSchemaVersion: 5,
        buildTargetsSchemaVersion: 2,
        desktop: {
          formFactor: "desktop",
          viewport: { fit: "contain" },
          inputProfile: "keyboard_mouse"
        },
        recipes: expect.arrayContaining(["desktop_large_screen"]),
        authoringTransaction: {
          read: "read_player_targets",
          recipe: "get_player_target_recipe",
          preview: "preview_player_target",
          apply: "apply_player_target",
          revisionGuard: "ifRevision"
        }
      }
    });

    expect(tool("read_player_targets")).toMatchObject({ riskClass: "read_only", sideEffect: "none" });
    expect(tool("get_player_target_recipe")).toMatchObject({ riskClass: "read_only", sideEffect: "none" });
    expect(tool("preview_player_target")).toMatchObject({ riskClass: "compute_only", sideEffect: "none" });
    expect(tool("apply_player_target")).toMatchObject({
      riskClass: "write_local",
      sideEffect: expect.stringMatching(/revision.*validation.*backup.*rollback/i),
      inputSchema: {
        required: expect.arrayContaining(["targetId", "target", "ifRevision"]),
        additionalProperties: false
      }
    });
  }, 30_000);

  it("keeps read/recipe/preview inert, promotes both schemas atomically, and preserves the legacy target", async () => {
    const projectDir = fixture();
    const before = authoredBytes(projectDir);
    const legacy = JSON.parse(before.buildTargets).targets["web-pwa"];

    const read = await callTool("read_player_targets", { projectDir }, {});
    expect(read).toMatchObject({
      projectSchemaVersion: 1,
      buildTargetsSchemaVersion: 1,
      revision: expect.any(String),
      targets: { "web-pwa": legacy }
    });
    expect(authoredBytes(projectDir)).toEqual(before);

    const recipe = await callTool("get_player_target_recipe", {
      projectDir, recipeId: "desktop_large_screen", targetId: "desktop-large"
    }, {});
    expect(recipe).toMatchObject({
      recipeId: "desktop_large_screen",
      targetId: "desktop-large",
      detached: true,
      written: false,
      revision: read.revision,
      target: {
        id: "desktop-large",
        platform: "web",
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
        quality: "balanced",
        locale: "auto",
        inputProfile: "keyboard_mouse"
      }
    });
    expect(authoredBytes(projectDir)).toEqual(before);

    const preview = await callTool("preview_player_target", {
      projectDir, targetId: recipe.targetId, target: recipe.target
    }, {});
    expect(preview).toMatchObject({
      ok: true, dryRun: true, written: false, revision: read.revision,
      projectSchemaVersion: 5, buildTargetsSchemaVersion: 2,
      validation: { ok: true }
    });
    expect(authoredBytes(projectDir)).toEqual(before);

    const applied = await callTool("apply_player_target", {
      projectDir, targetId: recipe.targetId, target: recipe.target, ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({
      ok: true, written: true, rolledBack: false, previousRevision: preview.revision,
      validation: { ok: true },
      backup: { directory: expect.stringMatching(/^\.towerforge\/backups\//) }
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8"));
    const targets = JSON.parse(fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8"));
    expect(manifest.schemaVersion).toBe(5);
    expect(targets.schemaVersion).toBe(2);
    expect(targets.targets["web-pwa"]).toEqual(legacy);
    expect(targets.targets["desktop-large"]).toEqual(recipe.target);
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
  }, 30_000);

  it("fails stale or invalid candidates before mutation and advertises backup/rollback semantics", async () => {
    const projectDir = fixture();
    const recipe = await callTool("get_player_target_recipe", {
      projectDir, recipeId: "desktop_large_screen", targetId: "desktop-large"
    }, {});
    const preview = await callTool("preview_player_target", {
      projectDir, targetId: recipe.targetId, target: recipe.target
    }, {});
    const applied = await callTool("apply_player_target", {
      projectDir, targetId: recipe.targetId, target: recipe.target, ifRevision: preview.revision
    }, {});
    expect(applied.ok).toBe(true);
    const committed = authoredBytes(projectDir);

    const stale = await callTool("apply_player_target", {
      projectDir,
      targetId: recipe.targetId,
      target: { ...recipe.target, locale: "ru" },
      ifRevision: preview.revision
    }, {});
    expect(stale).toMatchObject({ ok: false, conflict: true, written: false });
    expect(authoredBytes(projectDir)).toEqual(committed);

    const current = await callTool("read_player_targets", { projectDir }, {});
    const invalid = await callTool("preview_player_target", {
      projectDir,
      targetId: "broken",
      target: { ...recipe.target, id: "broken", viewport: { ...recipe.target.viewport, maxZoom: 0.25 } }
    }, {});
    expect(invalid).toMatchObject({ ok: false, dryRun: true, written: false, validation: { ok: false } });
    expect(invalid.revision).toBe(current.revision);
    expect(authoredBytes(projectDir)).toEqual(committed);
  }, 30_000);

  it("allocates a free recipe output and rejects duplicate webDir before apply", async () => {
    const projectDir = fixture();
    const first = await callTool("get_player_target_recipe", {
      projectDir, recipeId: "desktop_large_screen", targetId: "desktop-one"
    }, {});
    const firstPreview = await callTool("preview_player_target", {
      projectDir, targetId: first.targetId, target: first.target
    }, {});
    expect(firstPreview.ok).toBe(true);
    expect((await callTool("apply_player_target", {
      projectDir, targetId: first.targetId, target: first.target, ifRevision: firstPreview.revision
    }, {})).ok).toBe(true);

    const second = await callTool("get_player_target_recipe", {
      projectDir, recipeId: "desktop_large_screen", targetId: "desktop-two"
    }, {});
    expect(second.target.webDir).toBe("dist-desktop-2");

    const before = authoredBytes(projectDir);
    const duplicate = { ...second.target, webDir: first.target.webDir };
    const duplicatePreview = await callTool("preview_player_target", {
      projectDir, targetId: second.targetId, target: duplicate
    }, {});
    expect(duplicatePreview).toMatchObject({
      ok: false,
      dryRun: true,
      written: false,
      validation: {
        ok: false,
        issues: expect.arrayContaining([expect.objectContaining({
          fieldPath: "targets.desktop-two.webDir",
          message: expect.stringMatching(/already used|duplicate|unique/i)
        })])
      }
    });
    expect(authoredBytes(projectDir)).toEqual(before);

    const applied = await callTool("apply_player_target", {
      projectDir,
      targetId: second.targetId,
      target: duplicate,
      ifRevision: duplicatePreview.revision
    }, {});
    expect(applied).toMatchObject({ ok: false, written: false });
    expect(authoredBytes(projectDir)).toEqual(before);
  }, 30_000);

  it("teaches agents the exact target-local workflow and legacy isolation", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBe(53);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /describe_schema[^\n]*playerTargets[\s\S]*read_player_targets[\s\S]*get_player_target_recipe[\s\S]*desktop_large_screen[\s\S]*preview_player_target[\s\S]*apply_player_target[\s\S]*ifRevision[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /(?:legacy|schema v1)[\s\S]*(?:unchanged|exact|must not|does not)[\s\S]*(?:desktop|large-screen)|(?:desktop|large-screen)[\s\S]*(?:legacy|schema v1)[\s\S]*(?:unchanged|exact|must not|does not)/i
    );
  });
});
