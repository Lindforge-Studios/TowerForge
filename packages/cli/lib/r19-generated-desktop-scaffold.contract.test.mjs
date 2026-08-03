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
const projects = [];

beforeAll(() => {
  if (!fs.existsSync(path.join(repoRoot, "packages/engine/dist/index.js"))) {
    execFileSync("npm", ["run", "build:engine"], { cwd: repoRoot, stdio: "ignore" });
  }
});

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-package-"));
  projects.push(root);
  execFileSync(process.execPath, [path.join(repoRoot, "packages/cli/create.mjs"), "game", "--dir", root, "--template", "classic"], { stdio: "ignore" });
  return path.join(root, "game.tdproj");
}

function writeIcon(projectDir) {
  const png = new PNG({ width: 1024, height: 1024 });
  png.data.fill(0x55);
  const iconPath = path.join(projectDir, "assets", "app-icon.png");
  fs.mkdirSync(path.dirname(iconPath), { recursive: true });
  fs.writeFileSync(iconPath, PNG.sync.write(png));
}

function nativeTarget() {
  return {
    id: "native-desktop",
    platform: "desktop",
    renderer: "phaser",
    appId: "com.example.nativegame",
    appName: "Native Game",
    appTitle: "Native Game",
    backgroundColor: "#18202a",
    appVersion: "0.1.0",
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "auto",
    inputProfile: "keyboard_mouse",
    window: {
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 720,
      fullscreen: false,
      resizable: true
    },
    bundle: {
      iconSource: "assets/app-icon.png",
      targets: ["dmg", "nsis", "msi", "appimage", "deb", "rpm"]
    }
  };
}

function enableNativeTarget(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 5;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(projectDir, "build-targets.json"), `${JSON.stringify({
    schemaVersion: 2,
    defaults: { desktop: "native-desktop" },
    targets: { "native-desktop": nativeTarget() }
  }, null, 2)}\n`, "utf8");
  writeIcon(projectDir);
}

function assertRestrictiveCsp(csp) {
  expect(typeof csp).toBe("string");
  expect(csp).toMatch(/default-src\s+'self'/);
  expect(csp).toMatch(/script-src\s+'self'/);
  expect(csp).toMatch(/object-src\s+'none'/);
  expect(csp).toMatch(/base-uri\s+'none'/);
  expect(csp).toMatch(/frame-ancestors\s+'none'/);
  expect(csp).not.toMatch(/unsafe-eval/);
  expect(csp).not.toMatch(/(?:^|[;\s])\*(?:[;\s]|$)/);
  expect(csp).not.toMatch(/http:/);
}

function assertGeneratedIcons(desktopDir) {
  const iconsDir = path.join(desktopDir, "src-tauri", "icons");
  for (const [name, width, height] of [
    ["32x32.png", 32, 32],
    ["128x128.png", 128, 128],
    ["128x128@2x.png", 256, 256]
  ]) {
    const parsed = PNG.sync.read(fs.readFileSync(path.join(iconsDir, name)));
    expect([parsed.width, parsed.height], name).toEqual([width, height]);
  }
  expect(fs.readFileSync(path.join(iconsDir, "icon.icns")).subarray(0, 4).toString("ascii")).toBe("icns");
  expect([...fs.readFileSync(path.join(iconsDir, "icon.ico")).subarray(0, 4)]).toEqual([0, 0, 1, 0]);
}

describe("R19.1 generated native desktop scaffold (RED)", () => {
  it("selects the first-class desktop target directly and materializes its secure Tauri contract", async () => {
    const projectDir = fixture();
    enableNativeTarget(projectDir);

    const result = await packageDesktop(projectDir, { targetId: "native-desktop", outDir: "native-build" });
    expect(result.ok, result.error).toBe(true);
    expect(result).toMatchObject({
      kind: "desktop",
      targetId: "native-desktop",
      app: { appId: "com.example.nativegame", appName: "Native Game" }
    });
    expect(result).not.toHaveProperty("webTargetId");

    const desktopDir = path.join(projectDir, "native-build");
    const conf = JSON.parse(fs.readFileSync(path.join(desktopDir, "src-tauri", "tauri.conf.json"), "utf8"));
    expect(conf.app.windows).toEqual([expect.objectContaining({
      label: "main",
      title: "Native Game",
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 720,
      fullscreen: false,
      resizable: true
    })]);
    expect(conf.app.withGlobalTauri ?? false).toBe(false);
    assertRestrictiveCsp(conf.app.security?.csp);
    expect(conf.bundle.targets).toEqual(["dmg", "nsis", "msi", "appimage", "deb", "rpm"]);
    expect(conf.bundle.icon).toEqual([
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]);

    const capability = JSON.parse(fs.readFileSync(path.join(desktopDir, "src-tauri", "capabilities", "main.json"), "utf8"));
    expect(capability).toMatchObject({ windows: ["main"], local: true, permissions: expect.any(Array) });
    expect(capability).not.toHaveProperty("remote");
    for (const permission of capability.permissions) {
      expect(permission).not.toMatch(/(?:^|:)(?:default|shell|fs|opener|process|http)(?::|$)|\*/i);
      expect(permission).toMatch(/^(?:core:event:allow-(?:listen|emit)|allow-player-[a-z0-9-]+)$/);
    }
    assertGeneratedIcons(desktopDir);
  }, 60_000);

  it("keeps the legacy web-target desktop wrapper available as a compatibility adapter", async () => {
    const projectDir = fixture();
    const result = await packageDesktop(projectDir, { targetId: "web-pwa", outDir: "legacy-desktop" });
    expect(result.ok, result.error).toBe(true);
    expect(result).toMatchObject({ kind: "desktop", webTargetId: "web-pwa" });
    expect(fs.existsSync(path.join(projectDir, "legacy-desktop", "dist", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "legacy-desktop", "src-tauri", "tauri.conf.json"))).toBe(true);
  }, 60_000);
});
