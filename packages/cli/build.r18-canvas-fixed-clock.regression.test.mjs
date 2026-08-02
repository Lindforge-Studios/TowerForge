import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
let root;
let desktop;
let phaserDesktop;
let legacy;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r18-canvas-clock-"));
  desktop = buildTarget(path.join(root, "desktop.tdproj"), true, "canvas");
  phaserDesktop = buildTarget(path.join(root, "phaser-desktop.tdproj"), true, "phaser");
  legacy = buildTarget(path.join(root, "legacy.tdproj"), false, "canvas");
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("R18 generated Canvas fixed simulation cadence (RED)", () => {
  it("uses the shared fixed clock and retains every engine substep event", () => {
    expect(desktop.player).toMatch(/createFixedSimulationClockV1/);
    expect(desktop.player).toMatch(/playerSimulationClock\.advance\(dtSeconds\s*\*\s*1000,\s*speed/);
    expect(desktop.player).toMatch(/game\.tick\(units\)/);
    expect(desktop.player).toMatch(/events\.push\(\.\.\.stepSnapshot\.lastEvents\)/);
    expect(desktop.player).not.toMatch(/game\.tick\(\(dtSeconds\s*\/\s*timeUnitSeconds\)\s*\*\s*speed\)/);
    expect(fs.existsSync(path.join(desktop.outDir, "player-runtime", "fixed-simulation-clock.mjs"))).toBe(true);
  });

  it("resets the sub-frame clock for explicit run reset in both generated renderers", () => {
    for (const generated of [desktop, phaserDesktop]) {
      expect(generated.player).toMatch(/reset-run[\s\S]{0,500}game\.reset\(\)[\s\S]{0,240}resetPlayerSimulationClock\(\)/);
    }
  });

  it("applies the persisted quality preference to real Canvas and Phaser presentation controls", () => {
    for (const generated of [desktop, phaserDesktop]) {
      expect(generated.player).toMatch(/resolvePlayerPresentationQualityV1/);
      expect(generated.player).toMatch(/persistPlayerPreferences[\s\S]{0,500}applyPlayerPresentationQuality\(playerPreferences\.quality\)/);
    }
    expect(desktop.player).toMatch(/renderer\.setMaxDevicePixelRatio\(profile\.maxDevicePixelRatio\)/);
    expect(desktop.player).toMatch(/__towerforgePresentationQuality/);
    expect(phaserDesktop.player).toMatch(/loop\.targetFps\s*=\s*profile\.targetFps/);
    expect(phaserDesktop.player).toMatch(/loop\._target\s*=\s*1000\s*\/\s*profile\.targetFps/);
    expect(phaserDesktop.player).toMatch(/loop\.raf\.delay\s*=\s*1000\s*\/\s*profile\.targetFps/);
    expect(phaserDesktop.player).toMatch(/__towerforgePresentationQuality/);
  });

  it("keeps the legacy Canvas carrier free of the R18 simulation clock", () => {
    expect(legacy.player).not.toMatch(/createFixedSimulationClockV1|playerSimulationClock|fixed-simulation-clock/);
    expect(legacy.player).not.toMatch(/__towerforgePresentationQuality|presentation-quality/);
    expect(fs.existsSync(path.join(legacy.outDir, "player-runtime", "fixed-simulation-clock.mjs"))).toBe(false);
  });
});

function buildTarget(projectDir, largeScreen, renderer) {
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  const projectPath = path.join(projectDir, "project.json");
  const project = readJson(projectPath);
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  const targetId = largeScreen ? "desktop" : "legacy";
  const outName = largeScreen ? "dist-desktop" : "dist-legacy";
  if (largeScreen) {
    project.schemaVersion = 5;
    targets.schemaVersion = 2;
  }
  targets.targets[targetId] = {
    ...targets.targets[targets.defaults.web],
    id: targetId,
    renderer,
    webDir: outName,
    ...(largeScreen ? {
      formFactor: "desktop",
      viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
      quality: "balanced",
      locale: "en",
      inputProfile: "hybrid"
    } : {})
  };
  writeJson(projectPath, project);
  writeJson(targetsPath, targets);
  const built = JSON.parse(execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--target", targetId,
    "--out", outName,
    "--json"
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
  return {
    outDir: built.outDir,
    player: fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8")
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
