import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installNativePlayerLifecycleV1 } from "../../player-runtime/src/native-storage-bridge.mjs";
import { packageDesktop } from "./packaging.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../..");
let fixtureRoot;
let nativeDir;

beforeAll(async () => {
  if (!fs.existsSync(path.join(repoRoot, "packages/engine/dist/index.js"))) {
    execFileSync("npm", ["run", "build:engine"], { cwd: repoRoot, stdio: "ignore" });
  }
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-verifier-native-"));
  execFileSync(process.execPath, [path.join(repoRoot, "packages/cli/create.mjs"), "game", "--dir", fixtureRoot, "--template", "classic"], { stdio: "ignore" });
  const projectDir = path.join(fixtureRoot, "game.tdproj");
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 5;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const icon = new PNG({ width: 1024, height: 1024 });
  icon.data.fill(0x62);
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
        appId: "com.example.nativeverifier",
        appName: "Native Verifier",
        appVersion: "1.2.3",
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
        quality: "balanced",
        locale: "auto",
        inputProfile: "keyboard_mouse",
        window: { width: 1280, height: 720, minWidth: 1024, minHeight: 720, fullscreen: false, resizable: true },
        bundle: { iconSource: "assets/app-icon.png", targets: ["dmg"] },
        updater: {
          enabled: true,
          endpoints: ["https://updates.example.test/{{target}}/{{arch}}/{{current_version}}"],
          publicKey: "RWQ1-public-verification-key"
        }
      }
    }
  }, null, 2)}\n`, "utf8");
  const result = await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native" });
  expect(result.ok, result.error).toBe(true);
  nativeDir = path.join(projectDir, "native");
}, 60_000);

afterAll(() => {
  if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("R19 verifier native persistence/lifecycle contract", () => {
  it("never creates an atomic-write gap by removing the committed destination before replacement", () => {
    const rust = fs.readFileSync(path.join(nativeDir, "src-tauri", "src", "lib.rs"), "utf8");
    const atomicWrite = rust.match(/fn\s+atomic_write\b[\s\S]*?\n}\n/)?.[0] ?? "";

    expect(atomicWrite).toMatch(/sync_all/);
    expect(atomicWrite).toMatch(/rename|persist|replace/i);
    expect(atomicWrite).not.toMatch(/remove_(?:file|dir_all)\s*\(\s*destination/);
    expect(atomicWrite).not.toMatch(/destination\.exists\(\)[\s\S]*remove_[\s\S]*rename/);
  });

  it("routes an ordinary native close request through save completion before finish-close", async () => {
    const calls = [];
    const window = new EventTarget();
    const document = new EventTarget();
    const lifecycle = installNativePlayerLifecycleV1({
      window,
      document,
      async invoke(command, args) { calls.push([command, args]); },
      async save() { calls.push(["save"]); return { code: "saved" }; }
    });

    window.dispatchEvent(new Event("towerforge-native-close-requested"));
    await settle();

    expect(calls).toEqual([
      ["player_set_pending_write", { pending: true }],
      ["save"],
      ["player_set_pending_write", { pending: false }],
      ["player_finish_close", undefined]
    ]);
    lifecycle.dispose();
  });

  it("flushes an ordinary native suspend request without treating resume as the only lifecycle save signal", async () => {
    const calls = [];
    const window = new EventTarget();
    const document = new EventTarget();
    const lifecycle = installNativePlayerLifecycleV1({
      window,
      document,
      async invoke(command, args) { calls.push([command, args]); },
      async save() { calls.push(["save"]); return { code: "saved" }; }
    });

    window.dispatchEvent(new Event("towerforge-native-suspend"));
    await settle();

    expect(calls).toEqual([
      ["player_set_pending_write", { pending: true }],
      ["save"],
      ["player_set_pending_write", { pending: false }]
    ]);
    lifecycle.dispose();
  });

  it("makes Rust prevent ordinary close until the WebView handshake finishes and maps desktop focus loss to suspend", () => {
    const rust = fs.readFileSync(path.join(nativeDir, "src-tauri", "src", "lib.rs"), "utf8");

    expect(rust).toMatch(/CloseRequested[\s\S]{0,1200}prevent_close\(\)[\s\S]{0,1200}towerforge-native-close-requested/i);
    expect(rust).toMatch(/Focused\(false\)[\s\S]{0,800}towerforge-native-suspend/i);
    expect(rust).not.toMatch(/RunEvent::Suspended/);
  });
});

describe("R19 verifier signed native updater contract", () => {
  it("uses the native signed Tauri updater object instead of trusting caller signatureStatus or sending a synthetic candidate", () => {
    const cargo = fs.readFileSync(path.join(nativeDir, "src-tauri", "Cargo.toml"), "utf8");
    const rust = fs.readFileSync(path.join(nativeDir, "src-tauri", "src", "lib.rs"), "utf8");
    const player = fs.readFileSync(path.join(nativeDir, "dist", "player.mjs"), "utf8");
    const preflightPath = path.join(nativeDir, "dist", "player-runtime", "native-updater-preflight.mjs");

    expect(cargo).toMatch(/^tauri-plugin-updater\s*=\s*"=\d+\.\d+\.\d+"$/m);
    expect(rust).toMatch(/use\s+tauri_plugin_updater::UpdaterExt/);
    expect(rust).toMatch(/app\.updater\(\)[\s\S]{0,1000}\.check\(\)\.await/);
    expect(rust).toMatch(/update\.download_and_install\s*\(/);
    expect(player).toMatch(/nativePlayerInvoke\(["']player_check_and_install_update["']\)/);
    expect(player).not.toMatch(/plugin:updater\|download_and_install/);
    expect(player).not.toMatch(/\{\s*candidate\s*\}/);
    expect(player).not.toMatch(/signatureStatus/);
    expect(fs.existsSync(preflightPath)).toBe(false);
  });
});
