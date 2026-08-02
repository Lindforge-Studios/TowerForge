import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDefaultPlayerActionDescriptors } from "../player-runtime/src/player-actions.mjs";

const repoRoot = path.resolve(".");
const roots = [];

afterAll(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R18 generated storage and action wiring verifier repairs (RED)", () => {
  it("keeps profile v3 and story markers in injected IndexedDB storage and localStorage only for preferences", () => {
    const built = buildDesktop("storage");
    const player = text(built.outDir, "player.mjs");
    const boot = text(built.outDir, "boot.js");
    const adapter = text(built.outDir, "player-runtime/indexeddb-session-storage.mjs");

    expect(adapter).toMatch(/indexedDB\.open/);
    expect(adapter).not.toMatch(/localStorage|sessionStorage/);
    expect(player).toMatch(/createIndexedDb\w*Storage[\s\S]{0,320}(?:profile|progress)/i);
    expect(player).toMatch(/createPlayerProfileStore\s*\(\s*\{[\s\S]{0,360}storage\s*:/);
    expect(player).toMatch(/createIndexedDb\w*Storage[\s\S]{0,320}(?:story|seen)/i);
    expect(player).toMatch(/(?:storySeenStore|storyMarkerStore|storyStorage)\.(?:getItem|setItem)/);

    const nonPreferenceLocalStorage = player.split("\n")
      .filter((line) => line.includes("localStorage") && !/playerPreferences(?:Key|Raw)?/.test(line));
    expect(nonPreferenceLocalStorage).toEqual([]);
    expect(player).toMatch(/localStorage\.getItem\(playerPreferencesKey\)/);
    expect(player).toMatch(/localStorage\.setItem\(playerPreferencesKey/);
    expect(boot).toMatch(/indexedDB/);
    expect(boot).not.toMatch(/localStorage|sessionStorage/);
  }, 60_000);

  it("routes every descriptor plus desktop shell and hotkeys through the shared action registry", () => {
    const built = buildDesktop("actions");
    const player = text(built.outDir, "player.mjs");
    expect(player).toMatch(/createPlayerActionRegistry/);
    expect(player).toMatch(/const\s+playerActionRegistry\s*=\s*createPlayerActionRegistry\s*\(/);

    for (const { id } of createDefaultPlayerActionDescriptors()) {
      expect(player, `generated handler for ${id}`).toMatch(new RegExp(`["']${escapeRegex(id)}["']\\s*:`));
    }
    for (const [elementId, actionId] of [
      ["desktop-upgrade", "upgradeTower"],
      ["desktop-pause", "pause"],
      ["desktop-reset-view", "cameraReset"],
      ["desktop-settings", "openSettings"],
      ["desktop-fullscreen", "fullscreen"]
    ]) {
      expect(player, `${elementId} registry wiring`).toMatch(new RegExp(
        `\\$\\(["']${elementId}["']\\)[\\s\\S]{0,360}playerActionRegistry\\.invoke\\(["']${actionId}["']`
      ));
    }
    const hotkeys = sliceBetween(player, 'document.addEventListener("keydown"', "globalThis.__towerforgePlayerActions");
    expect(hotkeys).toMatch(/playerActionRegistry\.invoke/);
    expect(hotkeys).not.toMatch(/game\.(?:upgradeTower|sellTower|setTowerTargetMode)|desktopViewportActions\.(?:cameraPan|cameraZoom|cameraReset)|setPaused\(/);
  }, 60_000);

  it("leaves the legacy target on its existing localStorage path without R18 storage/action imports", () => {
    const built = buildLegacy("legacy");
    const player = text(built.outDir, "player.mjs");
    const boot = text(built.outDir, "boot.js");
    expect(player).toMatch(/localStorage/);
    expect(boot).toMatch(/localStorage/);
    expect(player).not.toMatch(/createIndexedDb\w*Storage|createPlayerActionRegistry|__towerforgePlayerActions/);
    expect(fs.existsSync(path.join(built.outDir, "player-runtime", "indexeddb-session-storage.mjs"))).toBe(false);
  }, 60_000);
});

function buildDesktop(label) {
  const projectDir = copyStarter(label);
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
    appId: `local.towerforge.r18.repair.${label}`,
    renderer: "canvas",
    webDir: `dist-r18-repair-${label}`,
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "ru",
    inputProfile: "keyboard_mouse"
  };
  writeJson(targetsPath, targets);
  return build(projectDir, "desktop", `dist-r18-repair-${label}`);
}

function buildLegacy(label) {
  const projectDir = copyStarter(label);
  return build(projectDir, undefined, `dist-r18-repair-${label}`);
}

function copyStarter(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `towerforge-r18-repair-${label}-`));
  roots.push(root);
  const projectDir = path.join(root, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  return projectDir;
}

function build(projectDir, targetId, outDir) {
  const args = [path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", projectDir, "--out", outDir, "--json"];
  if (targetId) args.push("--target", targetId);
  return JSON.parse(execFileSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
}

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function text(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
