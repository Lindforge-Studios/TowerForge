import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const roots = [];

afterAll(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R18 generated central gameplay action registry routing (RED)", () => {
  for (const renderer of ["canvas", "phaser"]) {
    it(`${renderer} routes pointer/touch/keyboard and management actions through PlayerActionRegistry`, () => {
      const player = buildDesktop(renderer);
      expect(player).toMatch(/createPlayerActionRegistry/);

      const central = sliceBetween(player, "function actAtCoord", "function ensureKeyboardCoord");
      for (const actionId of ["placeTower", "sellTower", "useAbility", "moveHero", "useHeroAbility"]) {
        expect(central, `${renderer} central ${actionId}`).toMatch(registryInvoke(actionId));
      }
      expect(central).not.toMatch(/game\.(?:placeTower|sellTower|useAbility|moveHero|useHeroAbility)\s*\(|dispatchGameCommand\s*\(/);

      const pointerNeedle = renderer === "phaser" ? 'this.input.on("pointerdown"' : 'canvas.addEventListener("pointerdown"';
      const pointer = sliceBetweenLast(player, pointerNeedle, renderer === "phaser" ? 'this.input.on("pointermove"' : "function heroMovementPresentation");
      expect(pointer).toMatch(/actAtCoord\s*\(/);
      const keyboard = sliceBetween(player, 'document.addEventListener("keydown"', "syncSpeedUi()");
      expect(keyboard).toMatch(/actAtCoord\s*\(/);

      const heroSkills = sliceBetween(player, "function updateHeroSkillTree", "function updateCampaignRun");
      expect(heroSkills).toMatch(registryInvoke("unlockHeroSkill"));
      expect(heroSkills).not.toMatch(/dispatchGameCommand\s*\([\s\S]{0,180}unlockHeroSkill/);

      const artifacts = sliceBetween(player, "function updateRogueliteStatus", "function updateQuestStatus");
      expect(artifacts).toMatch(registryInvoke("socketArtifact"));
      expect(artifacts).toMatch(registryInvoke("unsocketArtifact"));
      expect(artifacts).not.toMatch(/dispatchGameCommand\s*\([\s\S]{0,220}(?:socketArtifact|unsocketArtifact)/);

      const arsenal = sliceBetween(player, "function updateArsenalStatus", "const $ =");
      expect(arsenal).toMatch(registryInvoke("configureTowerModules"));
      expect(arsenal).not.toMatch(/dispatchGameCommand\s*\([\s\S]{0,220}configureTowerModules/);
    }, 60_000);
  }

  it("keeps the legacy player on the direct action path with no R18 registry", () => {
    const player = buildLegacy();
    expect(player).not.toMatch(/createPlayerActionRegistry|playerActionRegistry\.invoke|__towerforgePlayerActions/);
    const central = sliceBetween(player, "function actAtCoord", "function ensureKeyboardCoord");
    expect(central).toMatch(/game\.placeTower\s*\(/);
    expect(central).toMatch(/game\.sellTower\s*\(/);
    expect(central).toMatch(/game\.useAbility\s*\(/);
    expect(central).toMatch(/dispatchGameCommand\s*\(/);
  }, 60_000);
});

function buildDesktop(renderer) {
  const projectDir = copyStarter(`desktop-${renderer}`);
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
    renderer,
    webDir: `dist-r18-registry-${renderer}`,
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "en",
    inputProfile: "hybrid"
  };
  writeJson(targetsPath, targets);
  return builtPlayer(projectDir, "desktop", `dist-r18-registry-${renderer}`);
}

function buildLegacy() {
  const projectDir = copyStarter("legacy");
  return builtPlayer(projectDir, undefined, "dist-r18-registry-legacy");
}

function builtPlayer(projectDir, targetId, outDir) {
  const args = [path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", projectDir, "--out", outDir, "--json"];
  if (targetId) args.push("--target", targetId);
  const built = JSON.parse(execFileSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
  return fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8");
}

function copyStarter(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `towerforge-r18-central-${label}-`));
  roots.push(root);
  const projectDir = path.join(root, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  return projectDir;
}

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

function sliceBetweenLast(source, start, end) {
  const from = source.lastIndexOf(start);
  const to = source.indexOf(end, from);
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

function registryInvoke(actionId) {
  return new RegExp(`playerActionRegistry\\.invoke\\(\\s*["']${actionId}["']`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
