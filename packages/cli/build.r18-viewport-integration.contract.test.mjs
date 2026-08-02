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

describe("R18.1 generated Phaser desktop viewport integration (RED)", () => {
  it("imports the shared viewport and gates camera pan/zoom/reset away from gameplay input", () => {
    const projectDir = copyStarter("phaser-desktop");
    authorDesktopTarget(projectDir);
    const built = build(projectDir, "r18-phaser-desktop", "dist-r18-phaser-desktop");
    const player = fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8");
    const serviceWorker = fs.readFileSync(path.join(built.outDir, "offline-sw.js"), "utf8");
    expect(() => execFileSync(process.execPath, ["--check", path.join(built.outDir, "player.mjs")], { encoding: "utf8" })).not.toThrow();

    expect(player).toMatch(/import[\s\S]*createViewportTransformV1[\s\S]*from\s+["']\.\/renderer\/(?:index|viewport-transform)\.mjs["']/);
    expect(player).toMatch(/cameraPan[\s\S]*\.panBy\s*\(/);
    expect(player).toMatch(/cameraZoom[\s\S]*\.zoomAt\s*\(/);
    expect(player).toMatch(/cameraReset[\s\S]*\.reset\s*\(/);
    expect(player).toMatch(/(?:this\.input\.on|addEventListener)\s*\(\s*["']wheel["'][\s\S]{0,1200}preventDefault/);
    expect(player).toMatch(/pointerdown[\s\S]{0,1800}(?:cameraGestureActive|cameraPanActive|viewportGesture)[\s\S]{0,1800}actAtCoord/);
    expect(player).toMatch(/(?:INPUT|SELECT|TEXTAREA|isContentEditable)[\s\S]{0,1600}(?:cameraPan|cameraZoom|cameraReset)/);
    expect(fs.existsSync(path.join(built.outDir, "renderer", "viewport-transform.mjs"))).toBe(true);
    expect(serviceWorker).toContain("./renderer/viewport-transform.mjs");
  }, 60_000);

  it("keeps a legacy Phaser target free of shared viewport imports and camera-control code", () => {
    const projectDir = copyStarter("phaser-legacy");
    const targetPath = path.join(projectDir, "build-targets.json");
    const targets = readJson(targetPath);
    targets.targets["r18-phaser-legacy"] = {
      ...targets.targets[targets.defaults.web],
      id: "r18-phaser-legacy",
      renderer: "phaser",
      webDir: "dist-r18-phaser-legacy"
    };
    writeJson(targetPath, targets);
    const built = build(projectDir, "r18-phaser-legacy", "dist-r18-phaser-legacy");
    const player = fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8");
    expect(player).not.toMatch(/createViewportTransformV1|cameraGestureActive|cameraPanActive|viewportGesture|cameraPan|cameraZoom|cameraReset/);
    expect(fs.existsSync(path.join(built.outDir, "renderer", "viewport-transform.mjs"))).toBe(false);
  }, 60_000);
});

function copyStarter(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `towerforge-r18-viewport-${label}-`));
  roots.push(root);
  const projectDir = path.join(root, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  return projectDir;
}

function authorDesktopTarget(projectDir) {
  const projectPath = path.join(projectDir, "project.json");
  const project = readJson(projectPath);
  project.schemaVersion = 5;
  writeJson(projectPath, project);
  const targetPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetPath);
  targets.schemaVersion = 2;
  targets.targets["r18-phaser-desktop"] = {
    ...targets.targets[targets.defaults.web],
    id: "r18-phaser-desktop",
    renderer: "phaser",
    webDir: "dist-r18-phaser-desktop",
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "high",
    locale: "ru",
    inputProfile: "keyboard_mouse"
  };
  writeJson(targetPath, targets);
}

function build(projectDir, targetId, outDir) {
  try {
    return JSON.parse(execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", targetId,
      "--out", outDir,
      "--single-file",
      "--json"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    }));
  } catch (error) {
    throw new Error(`Generated-player build failed.\nstdout:\n${String(error.stdout ?? "")}\nstderr:\n${String(error.stderr ?? "")}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
