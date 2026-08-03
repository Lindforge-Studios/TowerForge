import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../..");
const projects = [];

beforeAll(() => {
  if (!fs.existsSync(path.join(repoRoot, "packages/engine/dist/index.js"))) {
    execFileSync("npm", ["run", "build:engine"], { cwd: repoRoot, stdio: "ignore" });
  }
});

afterEach(() => {
  for (const root of projects.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-build-boundary-"));
  projects.push(root);
  execFileSync(process.execPath, [path.join(repoRoot, "packages/cli/create.mjs"), "game", "--dir", root, "--template", "classic"], { stdio: "ignore" });
  const projectDir = path.join(root, "game.tdproj");

  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 5;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const png = new PNG({ width: 1024, height: 1024 });
  png.data.fill(0x77);
  fs.mkdirSync(path.join(projectDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "assets", "app-icon.png"), PNG.sync.write(png));

  fs.writeFileSync(path.join(projectDir, "build-targets.json"), `${JSON.stringify({
    schemaVersion: 2,
    defaults: { web: "web-pwa", desktop: "native-desktop" },
    targets: {
      "web-pwa": {
        id: "web-pwa",
        platform: "web",
        renderer: "canvas",
        webDir: "dist",
        formFactor: "legacy",
        viewport: { fit: "contain", padding: 0, minZoom: 1, maxZoom: 1, initialZoom: 1 },
        quality: "balanced",
        locale: "auto",
        inputProfile: "touch"
      },
      "native-desktop": {
        id: "native-desktop",
        platform: "desktop",
        renderer: "canvas",
        appId: "com.example.boundary",
        appName: "Boundary Game",
        appVersion: "0.1.0",
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
        quality: "balanced",
        locale: "auto",
        inputProfile: "keyboard_mouse",
        window: { width: 1280, height: 720, minWidth: 1024, minHeight: 720, fullscreen: false, resizable: true },
        bundle: { iconSource: "assets/app-icon.png", targets: ["dmg"] }
      }
    }
  }, null, 2)}\n`, "utf8");
  return projectDir;
}

function runBuild(projectDir, targetId, ...extra) {
  return spawnSync(process.execPath, [
    path.join(repoRoot, "packages/cli/build.mjs"),
    "--project", projectDir,
    "--target", targetId,
    "--out", `boundary-${targetId}`,
    "--json",
    ...extra
  ], { cwd: repoRoot, encoding: "utf8" });
}

describe("R19 native desktop build boundary", () => {
  it("keeps the public build command web-only", () => {
    const result = runBuild(fixture(), "native-desktop");

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/supports web targets only/)
    });
  }, 30_000);

  it("does not let the internal desktop compiler flag widen to web targets", () => {
    const result = runBuild(fixture(), "web-pwa", "--native-desktop-bundle");

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/requires a desktop target/)
    });
  }, 30_000);
});
