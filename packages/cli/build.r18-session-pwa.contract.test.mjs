import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRotatingPlayerSessionStore,
  parsePlayerSessionSaveV1,
  serializePlayerSessionSaveV1
} from "../player-runtime/src/player-session-store.mjs";

const repoRoot = path.resolve(".");
const roots = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R18.3 desktop session and preferences carrier (RED)", () => {
  it("ships IndexedDB two-slot Continue/autosave wiring while keeping preferences in localStorage", () => {
    const built = buildDesktop("session");
    const html = text(built.outDir, "index.html");
    const player = text(built.outDir, "player.mjs");
    const adapterPath = path.join(built.outDir, "player-runtime", "indexeddb-session-storage.mjs");
    const preferences = text(built.outDir, "player-runtime/player-preferences.mjs");
    const sessionStore = text(built.outDir, "player-runtime/player-session-store.mjs");

    expect(fs.existsSync(adapterPath)).toBe(true);
    const adapter = fs.readFileSync(adapterPath, "utf8");
    expect(adapter).toMatch(/indexedDB\.open/);
    expect(adapter).not.toMatch(/localStorage|sessionStorage/);
    expect(sessionStore).toMatch(/slot-0|slot-1/);
    expect(sessionStore).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(preferences).not.toMatch(/indexedDB|sessionStorage/);

    expect(html).toMatch(/<button[^>]+id="desktop-continue"[^>]*>/);
    expect(player).toMatch(/createRotatingPlayerSessionStore/);
    expect(player).toMatch(/createIndexedDbSessionStorage/);
    expect(player).toMatch(/localStorage[\s\S]{0,240}(?:PlayerPreferences|playerPreferences)/i);
    expect(player).toMatch(/(?:pagehide|visibilitychange)[\s\S]{0,600}(?:save|autosave)/i);
    expect(player).toMatch(/desktop-continue[\s\S]{0,600}playerActionRegistry\.invoke\("continueSession"\)/);
    expect(player).toMatch(/"continueSession"\s*:\s*\(\)\s*=>\s*continueDesktopSession\(\)/);
    expect(player).toMatch(/continueDesktopSession[\s\S]{0,300}loadLatest/);
  }, 60_000);

  it("checks the content digest before restore and never exposes a future/corrupt partial save", async () => {
    const storage = new AsyncStorage();
    const restore = vi.fn((value) => value.activeMissionId);
    const store = createRotatingPlayerSessionStore({
      storage,
      baseKey: "towerforge:session:digest",
      expectedContentDigest: "b".repeat(64),
      codec: { parse: parsePlayerSessionSaveV1, serialize: serializePlayerSessionSaveV1 },
      restore
    });
    storage.values.set("towerforge:session:digest:head", "0");
    storage.values.set("towerforge:session:digest:slot-0", serializePlayerSessionSaveV1(sessionSave("a".repeat(64))));
    const mismatch = await store.loadLatest();
    expect(mismatch).toEqual({ code: "session_content_mismatch" });
    expect(restore).not.toHaveBeenCalled();

    for (const raw of [
      "not-json",
      JSON.stringify({ ...sessionSave("b".repeat(64)), schemaVersion: 2 })
    ]) {
      storage.values.set("towerforge:session:digest:slot-0", raw);
      const rejected = await store.loadLatest();
      expect(rejected.code).toMatch(/session_(?:corrupt|version_unsupported)/);
      expect(rejected).not.toHaveProperty("save");
      expect(rejected).not.toHaveProperty("restored");
    }
    expect(restore).not.toHaveBeenCalled();
  });
});

describe("R18.4 localized accessible desktop PWA carrier (RED)", () => {
  it("emits localized install metadata, favicon, bounded action controls and quality settings", () => {
    const built = buildDesktop("pwa");
    const html = text(built.outDir, "index.html");
    const css = text(built.outDir, "styles.css");
    const player = text(built.outDir, "player.mjs");
    const qualityRuntime = text(built.outDir, "player-runtime/presentation-quality.mjs");
    const manifest = JSON.parse(text(built.outDir, "manifest.webmanifest"));

    expect(manifest.lang).toBe("ru");
    expect(manifest.categories).toEqual(expect.arrayContaining(["games"]));
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.icons.some((icon) => /(?:any|maskable)/.test(icon.purpose ?? "any"))).toBe(true);
    expect(manifest.screenshots.length).toBeGreaterThan(0);
    expect(manifest.shortcuts.length).toBeGreaterThan(0);
    expect(html).toMatch(/<link[^>]+rel="icon"/);
    expect(fs.existsSync(path.join(built.outDir, "player-runtime", "localized-strings.mjs"))).toBe(true);
    expect(player).toMatch(/localized-strings\.mjs|createPlayerStrings/);

    for (const id of ["desktop-pause", "desktop-settings", "desktop-fullscreen", "desktop-reset-view", "desktop-continue"]) {
      expect(html).toMatch(new RegExp(`<button[^>]+id="${id}"[^>]+(?:aria-label|aria-describedby)=`));
    }
    expect(html).toMatch(/<(?:dialog|section)[^>]+id="desktop-(?:settings|pause)-dialog"/);
    expect(html).toMatch(/<(?:dialog|section)[^>]+id="desktop-result-dialog"/);
    expect(html).toMatch(/id="desktop-quality"[\s\S]{0,300}value="low"[\s\S]{0,300}value="balanced"[\s\S]{0,300}value="high"/);
    expect(css).toMatch(/--player-action-min-size:\s*44px/);
    expect(css).toMatch(/min-(?:width|height):\s*var\(--player-action-min-size\)/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(player).toMatch(/resolvePlayerPresentationQualityV1/);
    expect(qualityRuntime).toMatch(/low[\s\S]{0,300}balanced[\s\S]{0,300}high/);
  }, 60_000);

  it("leaves a schema-v1 target on the legacy output path with no desktop-only imports or metadata", () => {
    const built = buildLegacy("legacy");
    const html = text(built.outDir, "index.html");
    const player = text(built.outDir, "player.mjs");
    const manifest = JSON.parse(text(built.outDir, "manifest.webmanifest"));
    expect(html).toContain('<main id="app">');
    expect(html).not.toMatch(/desktop-(?:continue|quality|pause|settings|result)|data-towerforge-player-shell/);
    expect(player).not.toMatch(/indexeddb-session-storage|localized-strings|createRotatingPlayerSessionStore|PlayerPreferences/);
    for (const relative of [
      "player-runtime/indexeddb-session-storage.mjs",
      "player-runtime/localized-strings.mjs",
      "player-runtime/player-preferences.mjs",
      "player-runtime/presentation-quality.mjs",
      "player-runtime/player-session-store.mjs"
    ]) expect(fs.existsSync(path.join(built.outDir, relative)), relative).toBe(false);
    for (const field of ["lang", "icons", "screenshots", "shortcuts", "categories", "display_override"]) {
      expect(manifest).not.toHaveProperty(field);
    }
  }, 60_000);
});

function sessionSave(contentDigest) {
  return {
    schemaVersion: 1,
    activeMissionId: "tutorial_01",
    checkpoint: { schemaVersion: 1, engineVersion: "towerforge-sim-v2", opaque: "checkpoint" },
    journalSuffix: [{ sequence: 0, command: { schemaVersion: 8, type: "startWave" } }],
    contentDigest,
    capabilityDigest: "tf-capabilities-v1:0123456789abcdef",
    savedAt: "2026-08-02T00:00:00.000Z"
  };
}

class AsyncStorage {
  constructor() { this.values = new Map(); }
  async getItem(key) { return this.values.get(key) ?? null; }
  async setItem(key, value) { this.values.set(key, value); }
  async removeItem(key) { this.values.delete(key); }
}

function buildDesktop(label) {
  const projectDir = copyStarter(label);
  const projectPath = path.join(projectDir, "project.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  project.schemaVersion = 5;
  writeJson(projectPath, project);
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
  targets.schemaVersion = 2;
  targets.targets.desktop = {
    ...targets.targets[targets.defaults.web], id: "desktop", webDir: `dist-r18-${label}`,
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced", locale: "ru", inputProfile: "keyboard_mouse"
  };
  writeJson(targetsPath, targets);
  return build(projectDir, "desktop", `dist-r18-${label}`);
}

function buildLegacy(label) {
  const projectDir = copyStarter(label);
  return build(projectDir, undefined, `dist-r18-${label}`);
}

function copyStarter(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `towerforge-r18-session-${label}-`));
  roots.push(root);
  const projectDir = path.join(root, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  return projectDir;
}

function build(projectDir, targetId, outDir) {
  const args = [path.join(repoRoot, "packages/cli/build.mjs"), "--project", projectDir, "--out", outDir, "--json"];
  if (targetId) args.push("--target", targetId);
  return JSON.parse(execFileSync(process.execPath, args, {
    cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
}

function text(root, relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }
function writeJson(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
