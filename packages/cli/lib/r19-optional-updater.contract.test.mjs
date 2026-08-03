import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { normalizeVisuals, validateProjectSchemas } from "./project-schema.mjs";
import { packageDesktop } from "./packaging.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../..");
const roots = [];

beforeAll(() => {
  if (!fs.existsSync(path.join(repoRoot, "packages/engine/dist/index.js"))) {
    execFileSync("npm", ["run", "build:engine"], { cwd: repoRoot, stdio: "ignore" });
  }
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function target(updater, platform = "desktop") {
  return {
    id: "native-desktop",
    platform,
    renderer: "canvas",
    ...(platform === "web" ? { webDir: "dist" } : {
      appId: "com.example.updater",
      appName: "Updater Game",
      appVersion: "1.1.0",
      window: { width: 1280, height: 720, minWidth: 1024, minHeight: 720, fullscreen: false, resizable: true },
      bundle: { iconSource: "assets/app-icon.png", targets: ["dmg"] }
    }),
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "auto",
    inputProfile: "keyboard_mouse",
    ...(updater === undefined ? {} : { updater })
  };
}

function buildTargets(updater, platform = "desktop") {
  return {
    schemaVersion: 2,
    defaults: { [platform]: "native-desktop" },
    targets: { "native-desktop": target(updater, platform) }
  };
}

function issues(buildTargetsValue) {
  return validateProjectSchemas({
    projectDir: "/detached/r19-updater.tdproj",
    manifest: { schemaVersion: 5, name: "Updater contract" },
    balance: { missions: {} },
    maps: {},
    mapSources: {},
    worldMap: { width: 1, height: 1, regions: [], missionNodes: [] },
    mechanics: undefined,
    distribution: undefined,
    visuals: normalizeVisuals({}),
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets: buildTargetsValue,
    scripts: {},
    scriptFiles: {},
    scriptIssues: []
  }).issues.filter((issue) => issue.entityKind === "buildTargets");
}

function fixture(updater) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-updater-"));
  roots.push(root);
  execFileSync(process.execPath, [path.join(repoRoot, "packages/cli/create.mjs"), "game", "--dir", root, "--template", "classic"], { stdio: "ignore" });
  const projectDir = path.join(root, "game.tdproj");
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 5;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const icon = new PNG({ width: 1024, height: 1024 });
  icon.data.fill(0x33);
  fs.mkdirSync(path.join(projectDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "assets", "app-icon.png"), PNG.sync.write(icon));
  fs.writeFileSync(path.join(projectDir, "build-targets.json"), `${JSON.stringify(buildTargets(updater), null, 2)}\n`, "utf8");
  return projectDir;
}

function carrierUpdaterText(nativeDir) {
  const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".rs", ".toml", ".txt", ".yaml", ".yml"]);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (textExtensions.has(path.extname(entry.name))) files.push(absolute);
    }
  };
  visit(nativeDir);
  return files.sort().map((file) => fs.readFileSync(file, "utf8")).join("\n");
}

const ENABLED = Object.freeze({
  enabled: true,
  endpoints: ["https://updates.example.test/{{target}}/{{arch}}/{{current_version}}"],
  publicKey: "RWQ1-public-verification-key"
});

describe("R19.4 optional updater target and carrier (RED)", () => {
  it("accepts only the closed desktop HTTPS/public-key contract and rejects private material", () => {
    expect(issues(buildTargets(ENABLED))).toEqual([]);
    expect(issues(buildTargets(undefined))).toEqual([]);
    expect(issues(buildTargets({ enabled: false }))).toEqual([]);

    for (const candidate of [
      { ...ENABLED, privateKey: "forbidden" },
      { ...ENABLED, private: { key: "forbidden" } },
      { enabled: true, endpoints: [], publicKey: "key" },
      { enabled: true, endpoints: ["http://updates.example.test/game"], publicKey: "key" },
      { enabled: true, endpoints: ["https://user:pass@updates.example.test/game"], publicKey: "key" },
      { enabled: true, endpoints: ["https://updates.example.test/game#fragment"], publicKey: "key" },
      { enabled: true, endpoints: Array.from({ length: 17 }, (_, index) => `https://updates.example.test/${index}`), publicKey: "key" },
      { enabled: true, endpoints: [`https://updates.example.test/${"x".repeat(4096)}`], publicKey: "key" },
      { enabled: true, endpoints: ["https://updates.example.test/game"], publicKey: "" },
      { enabled: true, endpoints: ["https://updates.example.test/game"], publicKey: "x".repeat(32_769) }
    ]) {
      expect(issues(buildTargets(candidate)), JSON.stringify(candidate).slice(0, 240)).not.toEqual([]);
    }
    expect(issues(buildTargets(ENABLED, "web"))).not.toEqual([]);
  });

  it.each([["absent", undefined], ["disabled", { enabled: false }]])("keeps updater bytes absent when configuration is %s", async (_label, updater) => {
    const projectDir = fixture(updater);
    const result = await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
    expect(result.ok, result.error).toBe(true);
    const nativeDir = path.join(projectDir, "native");
    expect(carrierUpdaterText(nativeDir)).not.toMatch(
      /tauri-plugin-updater|@tauri-apps\/plugin-updater|plugins["'.:\s]+updater|updater:allow-|native-updater-preflight|plugin:updater|downloadAndInstall|TAURI_SIGNING_PRIVATE_KEY|latest\.json|updater payload/i
    );
    expect(fs.readdirSync(path.join(nativeDir, "dist", "player-runtime"))).not.toContain("native-updater-preflight.mjs");
  }, 60_000);

  it("removes updater-only generated sources when an existing carrier is repackaged as disabled", async () => {
    const projectDir = fixture(ENABLED);
    const first = await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
    expect(first.ok, first.error).toBe(true);
    const nativeDir = path.join(projectDir, "native");
    expect(fs.existsSync(path.join(nativeDir, "scripts", "collect-updater-entry.mjs"))).toBe(true);
    const targetDir = path.join(nativeDir, "src-tauri", "target", "release", "bundle", "updater");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "game.app.tar.gz"), "stale updater payload");
    fs.writeFileSync(path.join(targetDir, "game.app.tar.gz.sig"), "stale updater signature");
    fs.writeFileSync(path.join(nativeDir, "src-tauri", "Cargo.lock"), "name = \"tauri-plugin-updater\"\n");
    const authorNote = path.join(nativeDir, "AUTHOR-NOTE.txt");
    fs.writeFileSync(authorNote, "keep this unrelated carrier note\n");

    fs.writeFileSync(path.join(projectDir, "build-targets.json"), `${JSON.stringify(buildTargets({ enabled: false }), null, 2)}\n`);
    const second = await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
    expect(second.ok, second.error).toBe(true);
    expect(fs.existsSync(path.join(nativeDir, "scripts", "collect-updater-entry.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(nativeDir, "src-tauri", "target"))).toBe(false);
    expect(fs.existsSync(path.join(nativeDir, "src-tauri", "Cargo.lock"))).toBe(false);
    expect(fs.readFileSync(authorNote, "utf8")).toBe("keep this unrelated carrier note\n");
    expect(carrierUpdaterText(nativeDir)).not.toMatch(
      /tauri-plugin-updater|TAURI_SIGNING_PRIVATE_KEY|latest\.json|updater payload/i
    );
  }, 60_000);

  it("emits only the signed updater plugin/config/capability and preflight-first runtime when enabled", async () => {
    const projectDir = fixture(ENABLED);
    const result = await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
    expect(result.ok, result.error).toBe(true);
    const nativeDir = path.join(projectDir, "native");
    const cargo = fs.readFileSync(path.join(nativeDir, "src-tauri", "Cargo.toml"), "utf8");
    const config = JSON.parse(fs.readFileSync(path.join(nativeDir, "src-tauri", "tauri.conf.json"), "utf8"));
    const capability = JSON.parse(fs.readFileSync(path.join(nativeDir, "src-tauri", "capabilities", "main.json"), "utf8"));
    const player = fs.readFileSync(path.join(nativeDir, "dist", "player.mjs"), "utf8");

    expect(cargo).toMatch(/tauri-plugin-updater/);
    expect(cargo).toMatch(/^serde_json\s*=\s*"=1\.0\.151"$/m);
    expect(config.plugins?.updater).toEqual({ endpoints: ENABLED.endpoints, pubkey: ENABLED.publicKey });
    expect(config.bundle?.createUpdaterArtifacts).toBe(true);
    expect(capability.permissions).not.toEqual(expect.arrayContaining([
      "updater:allow-check",
      "updater:allow-download-and-install"
    ]));
    expect(fs.existsSync(path.join(nativeDir, "dist", "player-runtime", "native-updater-preflight.mjs"))).toBe(false);
    expect(player).toMatch(/player_check_and_install_update/);
    expect(player).not.toMatch(/signatureStatus|plugin:updater\|download_and_install|\{\s*candidate\s*\}/);
  }, 60_000);
});
