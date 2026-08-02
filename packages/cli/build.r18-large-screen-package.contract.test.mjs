import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R18 opt-in large-screen generated player contract (RED)", () => {
  it("ships the desktop shell, PWA metadata and shared runtime only for a desktop form-factor target", () => {
    const projectDir = copyStarter("desktop");
    const projectPath = path.join(projectDir, "project.json");
    const project = readJson(projectPath);
    project.schemaVersion = 5;
    writeJson(projectPath, project);

    const targetsPath = path.join(projectDir, "build-targets.json");
    const targets = readJson(targetsPath);
    targets.schemaVersion = 2;
    targets.targets["desktop-large"] = {
      ...targets.targets[targets.defaults.web],
      id: "desktop-large",
      renderer: "canvas",
      webDir: "dist-r18-desktop",
      formFactor: "desktop",
      viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
      quality: "high",
      locale: "ru",
      inputProfile: "keyboard_mouse"
    };
    writeJson(targetsPath, targets);

    const built = build(projectDir, "desktop-large", "dist-r18-desktop");
    const html = fs.readFileSync(path.join(built.outDir, "index.html"), "utf8");
    const manifest = readJson(path.join(built.outDir, "manifest.webmanifest"));
    const projectData = fs.readFileSync(path.join(built.outDir, "project-data.js"), "utf8");
    const serviceWorker = fs.readFileSync(path.join(built.outDir, "offline-sw.js"), "utf8");
    expect(() => execFileSync(process.execPath, ["--check", path.join(built.outDir, "player.mjs")], { encoding: "utf8" })).not.toThrow();

    expect(html).toContain('data-towerforge-player-shell="desktop"');
    expect(html).toMatch(/id="desktop-(?:action-bar|shell)"/);
    expect(manifest).toMatchObject({ display: "standalone", display_override: ["window-controls-overlay", "standalone"] });
    expect(projectData).toMatch(/"formFactor"\s*:\s*"desktop"/);
    for (const relative of [
      "player-runtime/player-actions.mjs",
      "player-runtime/player-preferences.mjs",
      "player-runtime/player-session-store.mjs",
      "renderer/viewport-transform.mjs"
    ]) {
      expect(fs.existsSync(path.join(built.outDir, relative)), relative).toBe(true);
      expect(serviceWorker, `${relative} PWA cache`).toContain(`./${relative}`);
    }
  }, 60_000);

  it("keeps the untouched schema-v1 starter free of the desktop shell and R18 runtime", () => {
    const projectDir = copyStarter("legacy");
    const built = build(projectDir, undefined, "dist-r18-legacy");
    const html = fs.readFileSync(path.join(built.outDir, "index.html"), "utf8");
    const manifest = readJson(path.join(built.outDir, "manifest.webmanifest"));
    expect(html).not.toMatch(/data-towerforge-player-shell|id="desktop-(?:action-bar|shell)"/);
    expect(manifest).not.toHaveProperty("display_override");
    for (const relative of [
      "player-runtime/player-actions.mjs",
      "player-runtime/player-preferences.mjs",
      "player-runtime/player-session-store.mjs",
      "renderer/viewport-transform.mjs"
    ]) {
      expect(fs.existsSync(path.join(built.outDir, relative)), relative).toBe(false);
    }
  }, 60_000);
});

function copyStarter(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `towerforge-r18-${label}-`));
  roots.push(root);
  const projectDir = path.join(root, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  return projectDir;
}

function build(projectDir, targetId, outDir) {
  const args = [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--out", outDir,
    "--single-file",
    "--json"
  ];
  if (targetId) args.push("--target", targetId);
  return JSON.parse(execFileSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
