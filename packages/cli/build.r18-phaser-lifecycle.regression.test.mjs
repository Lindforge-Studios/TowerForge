import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
let root;
let desktopPlayer;
let legacyPlayer;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r18-phaser-lifecycle-"));
  desktopPlayer = buildDesktop(path.join(root, "desktop.tdproj"));
  legacyPlayer = buildLegacy(path.join(root, "legacy.tdproj"));
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("R18 generated Phaser lifecycle contract (RED)", () => {
  it("ignores BFCache pagehide and reserves disposal for persisted:false", () => {
    const lifecycle = lifecycleBlock(desktopPlayer);
    expect(lifecycle).toMatch(
      /addEventListener\(\s*["']pagehide["']\s*,\s*\(\s*event\s*\)\s*=>\s*\{[\s\S]{0,320}if\s*\(\s*!event\.persisted\s*\)[\s\S]{0,220}disposeDesktopPhaserPlayer/
    );
    expect(lifecycle).not.toMatch(/addEventListener\(\s*["']pagehide["'][\s\S]{0,320}\{\s*once\s*:\s*true\s*\}/);
  });

  it("uses a hidden-page-safe single-flight disposer without requestAnimationFrame", () => {
    const lifecycle = lifecycleBlock(desktopPlayer);
    expect(lifecycle).not.toMatch(/requestAnimationFrame/);
    expect(lifecycle).toMatch(/(?:disposePromise|disposeFlight|disposalPromise|disposeTask)/);
    expect(lifecycle).toMatch(/return\s+(?:disposePromise|disposeFlight|disposalPromise|disposeTask)/);
  });

  it("keeps the legacy Phaser target free of the R18 disposal lifecycle", () => {
    expect(legacyPlayer).not.toMatch(/__towerforgeDispose|disposeDesktopPhaserPlayer|WEBGL_lose_context/);
  });

  it("bounds desktop Phaser backbuffer and frame scheduling through the selected quality preset", () => {
    expect(desktopPlayer).toMatch(/let\s+phaserPresentationQuality\s*=/);
    expect(desktopPlayer).toMatch(/resolution\s*:\s*phaserPresentationQuality\.resolution/);
    expect(desktopPlayer).toMatch(/target\s*:\s*phaserPresentationQuality\.targetFps/);
    expect(desktopPlayer).toMatch(/limit\s*:\s*phaserPresentationQuality\.targetFps/);
    expect(desktopPlayer).toMatch(/forceSetTimeOut\s*:\s*true/);
    expect(desktopPlayer).toMatch(/resolvePlayerPresentationQualityV1/);
    expect(desktopPlayer).toMatch(/__towerforgePresentationQuality/);
    expect(legacyPlayer).not.toMatch(/phaserPresentationQuality|forceSetTimeOut/);
  });

  it("keeps presentation FPS detached from fixed simulation cadence and retains substep events", () => {
    expect(desktopPlayer).toMatch(/createFixedSimulationClockV1/);
    expect(desktopPlayer).toMatch(/phaserSimulationClock\.advance\(delta,\s*speed/);
    expect(desktopPlayer).toMatch(/game\.tick\(units\)/);
    expect(desktopPlayer).toMatch(/events\.push\(\.\.\.stepSnapshot\.lastEvents\)/);
    expect(desktopPlayer).not.toMatch(/game\.tick\(\(Math\.min\(50,\s*delta\)[\s\S]{0,120}\*\s*speed\)/);
    expect(legacyPlayer).not.toMatch(/createFixedSimulationClockV1|phaserSimulationClock|fixed-simulation-clock/);
  });

  it("resets the fixed clock when the current run is reset in place", () => {
    expect(desktopPlayer).toMatch(/reset-run[\s\S]{0,500}game\.reset\(\)[\s\S]{0,240}resetPlayerSimulationClock\(\)/);
  });
});

function lifecycleBlock(source) {
  const start = source.indexOf("disposeDesktopPhaserPlayer");
  const from = source.lastIndexOf("const desktopScene", start);
  const to = source.indexOf("const desktopViewportActions", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(start);
  return source.slice(from, to);
}

function buildDesktop(projectDir) {
  copyStarter(projectDir);
  const projectPath = path.join(projectDir, "project.json");
  const project = readJson(projectPath);
  project.schemaVersion = 5;
  writeJson(projectPath, project);
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.schemaVersion = 2;
  targets.targets.desktop = {
    ...targets.targets[targets.defaults.web],
    id: "desktop",
    renderer: "phaser",
    webDir: "dist-desktop",
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "en",
    inputProfile: "hybrid"
  };
  writeJson(targetsPath, targets);
  return buildPlayer(projectDir, "desktop", "dist-desktop");
}

function buildLegacy(projectDir) {
  copyStarter(projectDir);
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets.legacy = {
    ...targets.targets[targets.defaults.web],
    id: "legacy",
    renderer: "phaser",
    webDir: "dist-legacy"
  };
  writeJson(targetsPath, targets);
  return buildPlayer(projectDir, "legacy", "dist-legacy");
}

function buildPlayer(projectDir, targetId, outDir) {
  const built = JSON.parse(execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--target", targetId,
    "--out", outDir,
    "--json"
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
  return fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8");
}

function copyStarter(projectDir) {
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
