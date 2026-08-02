import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
let root;
let canvas;
let phaser;
let legacy;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r18-verifier-repair-"));
  canvas = build(path.join(root, "canvas.tdproj"), "canvas", true);
  phaser = build(path.join(root, "phaser.tdproj"), "phaser", true);
  legacy = build(path.join(root, "legacy.tdproj"), "canvas", false);
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("R18 rejected-candidate repair contracts (RED)", () => {
  it("autosaves an authoritative wave-cleared boundary in both renderers", () => {
    for (const generated of [canvas, phaser]) {
      expect(generated.player).toMatch(
        /events\.some\([^)]*waveCleared[\s\S]{0,240}scheduleDesktopAutosave\(\)/
      );
    }
  });

  it("applies and persists every PlayerPreferencesV1 field instead of leaving inert codec data", () => {
    for (const generated of [canvas, phaser]) {
      expect(generated.player).toMatch(/snd[\s\S]{0,160}playerPreferences\.soundEnabled/);
      expect(generated.player).toMatch(/sfx-volume[\s\S]{0,160}playerPreferences\.sfxVolume/);
      expect(generated.player).toMatch(/music-volume[\s\S]{0,160}playerPreferences\.musicVolume/);
      expect(generated.player).toMatch(/fullscreenchange[\s\S]{0,320}fullscreen/);
      expect(generated.player).toMatch(/cameraZoom[\s\S]{0,500}(?:persist|store)PlayerPreferences/);
      expect(generated.player).toMatch(/keyBindings[\s\S]{0,600}event\.code/);
      expect(generated.player).toMatch(/result\.zoom\s*\/\s*previous\.zoom/);
      expect(generated.player).toMatch(/start-wave[\s\S]{0,180}soundEnabled[\s\S]{0,120}audio\.resume/);
      expect(generated.player).toMatch(/desktop-fullscreen[\s\S]{0,320}aria-pressed/);
      expect(generated.html).toMatch(/desktop-key-bindings/);
    }
    expect(legacy.player).not.toMatch(/playerPreferences|desktop-key-bindings/);
  });

  it("resynchronizes mission-dependent selectors and ability UI after Continue", () => {
    for (const generated of [canvas, phaser]) {
      expect(generated.player).toMatch(
        /continueDesktopSession[\s\S]{0,900}(?:syncDesktopPlayerUiAfterRestore|syncMissionDependentPlayerUi)/
      );
    }
  });

  it("provides default build-selection, speed and mission-ability hotkeys through the action path", () => {
    for (const generated of [canvas, phaser]) {
      expect(generated.player).toMatch(/Digit1[\s\S]{0,800}(?:tower-select|selectBuild|selectTower)/);
      expect(generated.player).toMatch(/BracketLeft[\s\S]{0,320}BracketRight/);
      expect(generated.player).toMatch(/KeyQ[\s\S]{0,500}(?:ability|useAbility)/i);
    }
  });

  it("binds desktop session saves to the canonical mission capability digest", () => {
    for (const generated of [canvas, phaser]) {
      expect(generated.player).toMatch(/computeMissionCapabilityDigestV1/);
      expect(generated.player).toMatch(
        /expectedCapabilityDigest[\s\S]{0,420}computeMissionCapabilityDigestV1[\s\S]{0,260}activeMissionId/
      );
      expect(generated.player).toMatch(
        /capabilityDigest\s*:\s*computeMissionCapabilityDigestV1\(\{[\s\S]{0,180}missionId/
      );
    }
    expect(legacy.player).not.toMatch(/computeMissionCapabilityDigestV1|capabilityDigest|expectedCapabilityDigest/);
  });
});

function build(projectDir, renderer, desktop) {
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  const projectPath = path.join(projectDir, "project.json");
  const project = readJson(projectPath);
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  const targetId = desktop ? "desktop" : "legacy";
  const outName = desktop ? "dist-desktop" : "dist-legacy";
  if (desktop) {
    project.schemaVersion = 5;
    targets.schemaVersion = 2;
  }
  targets.targets[targetId] = {
    ...targets.targets[targets.defaults.web],
    id: targetId,
    renderer,
    webDir: outName,
    ...(desktop ? {
      formFactor: "desktop",
      viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
      quality: "balanced",
      locale: "ru",
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
    player: fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8"),
    html: fs.readFileSync(path.join(built.outDir, "index.html"), "utf8")
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
