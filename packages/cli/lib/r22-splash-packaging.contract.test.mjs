import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packageDesktop, packageMobile, packageWeb } from "./packaging.mjs";

const repoRoot = path.resolve(".");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r22-packaging-"));
const projectDir = path.join(root, "game.tdproj");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

beforeAll(() => {
  if (!fs.existsSync(path.join(repoRoot, "packages/engine/dist/index.js"))) {
    execFileSync("npm", ["run", "build:engine"], { cwd: repoRoot, stdio: "ignore" });
  }
  fs.cpSync(path.join(repoRoot, "examples/starter.tdproj"), projectDir, { recursive: true });
  const manifestPath = path.join(projectDir, "project.json");
  writeJson(manifestPath, { ...readJson(manifestPath), schemaVersion: 5 });
  const visualsPath = path.join(projectDir, "content/visuals.json");
  const visuals = readJson(visualsPath);
  writeJson(visualsPath, {
    ...visuals,
    sprites: {
      ...visuals.sprites,
      studio_logo: { src: "assets/splashes/studio.png", mimeType: "image/png" }
    }
  });
  fs.mkdirSync(path.join(projectDir, "assets/splashes"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "assets/splashes/studio.png"), PNG);
  fs.mkdirSync(path.join(projectDir, "assets"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "assets/brand/towerforge-app-icon.png"), path.join(projectDir, "assets/app-icon.png"));
  writeJson(path.join(projectDir, "content/splashes.json"), {
    schemaVersion: 1,
    playlists: {
      intro: {
        schemaVersion: 1,
        label: "Studio introduction",
        items: [{
          id: "studio", spriteId: "studio_logo", accessibleLabel: "Example Studio",
          backgroundColor: "#101820", fit: "contain", transition: "fade",
          displayMs: 700, minimumMs: 300, transitionMs: 120
        }]
      }
    }
  });
  writeJson(path.join(projectDir, "build-targets.json"), {
    schemaVersion: 2,
    defaults: { web: "splash-web", desktop: "splash-desktop" },
    targets: {
      "splash-web": webTarget("splash-web", "canvas", "web-splash", true),
      "plain-web": webTarget("plain-web", "phaser", "web-plain", false),
      "splash-desktop": {
        ...webTarget("splash-desktop", "phaser", "desktop-web", true),
        platform: "desktop",
        appId: "com.example.splashgame",
        appName: "Splash Game",
        appTitle: "Splash Game",
        appVersion: "0.8.0",
        window: { width: 1280, height: 800, minWidth: 1024, minHeight: 720, fullscreen: false, resizable: true },
        bundle: { iconSource: "assets/app-icon.png", targets: ["dmg", "nsis", "msi", "appimage", "deb", "rpm"] }
      }
    }
  });
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("R22.4 active-only splash packaging", () => {
  it("carries the selected offline playlist through portable web, mobile and first-class desktop", async () => {
    const web = await packageWeb(projectDir, { targetId: "splash-web", outDir: "portable-r22" });
    const mobile = await packageMobile(projectDir, { targetId: "splash-web", outDir: "mobile-r22" });
    const desktop = await packageDesktop(projectDir, { targetId: "splash-desktop", outDir: "desktop-r22" });
    for (const [carrier, bundleDir] of [
      [web, path.join(web.outDir, "game")],
      [mobile, path.join(mobile.outDir, "www")],
      [desktop, path.join(desktop.outDir, "dist")]
    ]) {
      expect(carrier.ok, carrier.error).toBe(true);
      expect(fs.readFileSync(path.join(bundleDir, "index.html"), "utf8")).toContain("towerforge-project-splash");
      expect(fs.readFileSync(path.join(bundleDir, "boot.js"), "utf8")).toContain("__towerforgeProjectSplashDismissed");
      expect(fs.existsSync(path.join(bundleDir, "assets/splashes/studio.png"))).toBe(true);
    }
    const single = fs.readFileSync(path.join(web.outDir, "game/index.single.html"), "utf8");
    expect(single).toMatch(/studio_logo[\s\S]{0,300}data:image\/png;base64,/);
  }, 120_000);

  it("keeps an unbound mobile carrier free of project splash runtime and assets", async () => {
    const mobile = await packageMobile(projectDir, { targetId: "plain-web", outDir: "mobile-r22-plain" });
    expect(mobile.ok, mobile.error).toBe(true);
    const bundleDir = path.join(mobile.outDir, "www");
    expect(fs.readFileSync(path.join(bundleDir, "index.html"), "utf8")).not.toContain("towerforge-project-splash");
    expect(fs.readFileSync(path.join(bundleDir, "boot.js"), "utf8")).not.toContain("__towerforgeProjectSplash");
    expect(fs.readFileSync(path.join(bundleDir, "project-data.js"), "utf8")).not.toMatch(/"splashes"\s*:/u);
  }, 60_000);

  it("keeps the public plugin build compiler source-identical for splash lifecycle markers", () => {
    const source = fs.readFileSync(path.join(repoRoot, "packages/cli/build.mjs"), "utf8");
    const plugin = fs.readFileSync(path.join(repoRoot, "plugins/towerforge/runtime/packages/cli/build.mjs"), "utf8");
    for (const marker of [
      "projectSplashBootRecoveryTemplate",
      "__towerforgeProjectSplashDismissed",
      "splashPlaylistId",
      "towerforge-project-splash"
    ]) {
      expect(source, marker).toContain(marker);
      expect(plugin, marker).toContain(marker);
    }
  });
});

function webTarget(id, renderer, webDir, active) {
  return {
    id, platform: "web", renderer, webDir,
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
    quality: "balanced", locale: "en", inputProfile: "keyboard_mouse",
    ...(active ? { splashPlaylistId: "intro" } : {})
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
