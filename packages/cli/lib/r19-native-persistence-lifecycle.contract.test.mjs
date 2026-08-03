import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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

function fixture(fullscreen = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-native-lifecycle-"));
  roots.push(root);
  execFileSync(process.execPath, [path.join(repoRoot, "packages/cli/create.mjs"), "game", "--dir", root, "--template", "classic"], { stdio: "ignore" });
  const projectDir = path.join(root, "game.tdproj");
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 5;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const icon = new PNG({ width: 1024, height: 1024 });
  icon.data.fill(0x66);
  fs.mkdirSync(path.join(projectDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "assets", "app-icon.png"), PNG.sync.write(icon));
  fs.writeFileSync(path.join(projectDir, "build-targets.json"), `${JSON.stringify({
    schemaVersion: 2,
    defaults: { desktop: "native-desktop" },
    targets: {
      "native-desktop": {
        id: "native-desktop",
        platform: "desktop",
        renderer: "canvas",
        appId: "com.example.nativepersistence",
        appName: "Native Persistence",
        appVersion: "0.1.0",
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
        quality: "balanced",
        locale: "auto",
        inputProfile: "keyboard_mouse",
        window: { width: 1280, height: 720, minWidth: 1024, minHeight: 720, fullscreen, resizable: true },
        bundle: { iconSource: "assets/app-icon.png", targets: ["dmg"] }
      }
    }
  }, null, 2)}\n`, "utf8");
  return projectDir;
}

describe("R19.2 generated native persistence and lifecycle (RED)", () => {
  it("exposes only bounded session, head, remove, fullscreen and close commands", async () => {
    const projectDir = fixture();
    const result = await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
    expect(result.ok, result.error).toBe(true);
    const nativeDir = path.join(projectDir, "native");
    const rust = fs.readFileSync(path.join(nativeDir, "src-tauri", "src", "lib.rs"), "utf8");
    const capability = JSON.parse(fs.readFileSync(path.join(nativeDir, "src-tauri", "capabilities", "main.json"), "utf8"));

    for (const command of [
      "player_session_read_head",
      "player_session_read_slot",
      "player_session_write_slot",
      "player_session_write_head",
      "player_session_remove_slot",
      "player_session_remove_head",
      "player_set_pending_write",
      "player_get_fullscreen",
      "player_set_fullscreen",
      "player_finish_close"
    ]) {
      expect(rust, command).toMatch(new RegExp(`fn\\s+${command}\\b`));
      expect(rust, command).toMatch(new RegExp(`generate_handler!\\[[\\s\\S]*\\b${command}\\b`));
    }
    expect(rust).not.toMatch(/tauri_plugin_(?:fs|shell|opener|http)|std::process::Command|Command::new/);
    expect(rust).not.toMatch(/fn\s+player_[^(]+\([^)]*\b(?:path|key)\s*:/);
    expect(capability.permissions).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/(?:^|:)(?:default|fs|shell|opener|process|http)(?::|$)|\*/i)
    ]));
  }, 60_000);

  it("queries authoritative native fullscreen state and does not infer it from document.fullscreenElement", async () => {
    const projectDir = fixture(true);
    const result = await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native-fullscreen" });
    expect(result.ok, result.error).toBe(true);
    const player = fs.readFileSync(path.join(projectDir, "native-fullscreen", "dist", "player.mjs"), "utf8");

    expect(player).toMatch(/nativePlayerLifecycle\.getFullscreen\(\)/);
    expect(player).not.toMatch(/playerPreferences\.fullscreen\s*&&\s*!document\.fullscreenElement/);
    expect(player).not.toMatch(/document\.addEventListener\(["']fullscreenchange/);
  }, 60_000);

  it("guards close while a write is pending, flushes across suspend/resume, and focuses the existing single instance", async () => {
    const projectDir = fixture();
    await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
    const nativeDir = path.join(projectDir, "native");
    const rust = fs.readFileSync(path.join(nativeDir, "src-tauri", "src", "lib.rs"), "utf8");
    const cargo = fs.readFileSync(path.join(nativeDir, "src-tauri", "Cargo.toml"), "utf8");
    const runtime = fs.readFileSync(path.join(nativeDir, "dist", "player-runtime", "native-storage-bridge.mjs"), "utf8");

    expect(rust).toMatch(/CloseRequested[\s\S]{0,1000}prevent_close\(\)/);
    expect(rust).toMatch(/pending_write|pending.*write/i);
    expect(rust).toMatch(/(?:RunEvent::)?Resum(?:e|ed)[\s\S]{0,800}(?:emit|flush)/i);
    expect(cargo).toMatch(/tauri-plugin-single-instance/);
    expect(rust).toMatch(/tauri_plugin_single_instance::init[\s\S]{0,1000}(?:set_focus|show)/);
    expect(runtime).toMatch(/player_set_pending_write/);
    expect(runtime).toMatch(/player_finish_close/);
    expect(runtime).toMatch(/player_set_fullscreen/);
    expect(runtime).toMatch(/visibilitychange|pagehide/);
    expect(runtime).toMatch(/resume/i);
    expect(runtime).toMatch(/flush/i);
  }, 60_000);
});
