import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPlayerTarget,
  getPlayerTargetRecipe,
  previewPlayerTarget,
  readPlayerTargets
} from "../cli/lib/player-target-authoring.mjs";
import { callTool } from "../mcp/tools.mjs";

const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function nativeTarget(id, appName) {
  return {
    id,
    platform: "desktop",
    renderer: "canvas",
    appId: `com.example.${id}`,
    appName,
    appVersion: "1.2.3",
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "auto",
    inputProfile: "keyboard_mouse",
    window: { width: 1280, height: 720, minWidth: 1024, minHeight: 720, fullscreen: false, resizable: true },
    bundle: { iconSource: "assets/app-icon.png", targets: ["dmg"] }
  };
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-default-desktop-"));
  projects.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 5;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(projectDir, "build-targets.json"), `${JSON.stringify({
    schemaVersion: 2,
    defaults: { web: "web-pwa", desktop: "native-b" },
    targets: {
      "web-pwa": {
        id: "web-pwa",
        platform: "web",
        renderer: "canvas",
        webDir: "dist",
        formFactor: "responsive",
        viewport: { fit: "contain", padding: 16, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
        quality: "balanced",
        locale: "auto",
        inputProfile: "hybrid"
      },
      "native-a": nativeTarget("native-a", "Native A"),
      "native-b": nativeTarget("native-b", "Native B")
    }
  }, null, 2)}\n`, "utf8");
  return projectDir;
}

describe("R19 frozen audit: authoritative defaults.desktop selection", () => {
  it("returns the authored desktop default consistently through CLI and MCP reads when native target order differs", async () => {
    const projectDir = fixture();

    expect(readPlayerTargets(projectDir)).toMatchObject({
      defaults: { web: "web-pwa", desktop: "native-b" },
      targets: { "native-a": expect.any(Object), "native-b": expect.any(Object) }
    });
    expect(await callTool("read_player_targets", { projectDir }, {})).toMatchObject({
      defaults: { web: "web-pwa", desktop: "native-b" }
    });
  });

  it("guarded native apply selects the newly authored native target and reports the committed default without reload drift", () => {
    const projectDir = fixture();
    const recipe = getPlayerTargetRecipe(projectDir, "native_desktop_game", "native-c");
    const preview = previewPlayerTarget(projectDir, recipe.targetId, recipe.target);
    expect(preview.ok).toBe(true);

    const applied = applyPlayerTarget(projectDir, recipe.targetId, recipe.target, { ifRevision: preview.revision });
    expect(applied).toMatchObject({
      ok: true,
      written: true,
      defaults: { desktop: "native-c" }
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8"))).toMatchObject({
      defaults: { web: "web-pwa", desktop: "native-c" }
    });
    expect(readPlayerTargets(projectDir)).toMatchObject({ defaults: { desktop: "native-c" } });
  });

  it("Studio reconciles the post-apply build-target state from the guarded server result instead of inventing a local desktop default", () => {
    const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
    const start = app.indexOf('const addNativeDesktopBtn = $("btn-add-native-desktop-target")');
    const end = app.indexOf("\nfunction showBuildResult", start);
    const nativeFlow = app.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(nativeFlow).toMatch(/const applied = await apiPost\([^\n]*player-targets\/apply[\s\S]{0,1400}(?:applied\.defaults|apiGet\(["']\/api\/player-targets["']\))/);
    expect(nativeFlow).not.toMatch(/const applied = await apiPost\([^\n]*player-targets\/apply[\s\S]{0,1400}defaults:\s*\{[^}]*desktop:\s*targetId/);
  });
});
