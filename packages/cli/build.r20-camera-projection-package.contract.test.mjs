import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProject } from "./lib/create-project.mjs";

const repoRoot = path.resolve(".");
const tempRoots = [];
const combinations = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
));

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("R20.2 generated Canvas/Phaser camera parity (RED)", () => {
  it("uses one camera render-space module for Canvas/Phaser on hex/square outputs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r20-camera-package-"));
    tempRoots.push(root);
    const importStatements = [];

    for (const { grid, renderer } of combinations) {
      const { projectDir } = createProject({
        name: `camera_${grid}_${renderer}`,
        parentDir: root,
        templateName: "classic",
        gridKind: grid
      });
      enableCamera(projectDir, renderer, grid);
      const targetId = `camera-${renderer}`;
      const built = build(projectDir, targetId);
      expect(built).toMatchObject({ ok: true, targetId });

      for (const relative of [
        "renderer/camera-projector.mjs",
        "renderer/camera-renderer-integration.mjs",
        "renderer/viewport-transform.mjs",
        "offline-sw.js",
        "index.single.html"
      ]) expect(fs.existsSync(path.join(built.outDir, relative)), `${grid}/${renderer}: ${relative}`).toBe(true);

      const project = (await import(
        `${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?r20=${grid}-${renderer}-${Date.now()}`
      )).default;
      expect(project.visuals.cameraProfiles.profiles.iso).toMatchObject({
        schemaVersion: 1,
        projection: "isometric_2_1",
        orientation: grid === "hex" ? "north" : "east",
        elevationScale: 1.5
      });
      expect(project.buildTarget.cameraProfileId).toBe("iso");
      expect(Object.values(project.maps).every((map) => map.grid.kind === grid)).toBe(true);

      const player = fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8");
      const sharedImport = player.match(/import\s+\{[^}]*createCameraRenderSpaceV1[^}]*\}\s+from\s+["']\.\/renderer\/camera-renderer-integration\.mjs["'];?/s)?.[0];
      expect(sharedImport, `${grid}/${renderer}: shared camera import`).toBeTruthy();
      importStatements.push(sharedImport.replace(/\s+/g, " "));
      expect(player).toContain("projectCameraRenderItemsV1");
      expect(player).toContain("cameraProfileId");
      expect(player).not.toMatch(/function\s+(?:isometric|dimetric|cameraProject|projectCameraBasis)\w*\s*\(/i);

      const serviceWorker = fs.readFileSync(path.join(built.outDir, "offline-sw.js"), "utf8");
      expect(serviceWorker).toContain('"./renderer/camera-projector.mjs"');
      expect(serviceWorker).toContain('"./renderer/camera-renderer-integration.mjs"');
      const single = decodedSingleFileModules(fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8"));
      expect(single).toContain('"cameraProfileId":"iso"');
      expect(single).toContain("createCameraRenderSpaceV1");
    }

    expect(new Set(importStatements).size).toBe(1);
  }, 120_000);

  it("keeps an untouched legacy/top-down build free of R20 modules and camera reads", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r20-camera-legacy-"));
    tempRoots.push(root);
    const projectDir = path.join(root, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const built = build(projectDir, "web-pwa", "dist-r20-legacy");

    for (const relative of [
      "renderer/camera-projector.mjs",
      "renderer/camera-renderer-integration.mjs"
    ]) expect(fs.existsSync(path.join(built.outDir, relative)), relative).toBe(false);
    const project = (await import(
      `${pathToFileURL(path.join(built.outDir, "project-data.js")).href}?r20-legacy=${Date.now()}`
    )).default;
    expect(project.visuals).not.toHaveProperty("cameraProfiles");
    expect(project.buildTarget).not.toHaveProperty("cameraProfileId");
    expect(fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8"))
      .not.toMatch(/camera-projector|camera-renderer-integration|cameraProfileId|cameraProfiles/);
  }, 60_000);
});

function enableCamera(projectDir, renderer, grid) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 5;
  writeJson(manifestPath, manifest);

  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const visuals = readJson(visualsPath);
  visuals.schemaVersion = 4;
  visuals.cameraProfiles = {
    schemaVersion: 1,
    profiles: {
      iso: {
        schemaVersion: 1,
        projection: "isometric_2_1",
        orientation: grid === "hex" ? "north" : "east",
        elevationScale: 1.5,
        fitPadding: 32,
        minZoom: 0.5,
        maxZoom: 3,
        initialZoom: 1
      }
    },
    bindings: { maps: {}, missions: {} }
  };
  writeJson(visualsPath, visuals);

  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.schemaVersion = 2;
  targets.defaults = { web: `camera-${renderer}` };
  targets.targets = {
    [`camera-${renderer}`]: {
      id: `camera-${renderer}`,
      platform: "web",
      renderer,
      webDir: `dist-camera-${grid}-${renderer}`,
      formFactor: "desktop",
      viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
      quality: "high",
      locale: "en",
      inputProfile: "keyboard_mouse",
      cameraProfileId: "iso"
    }
  };
  writeJson(targetsPath, targets);
}

function build(projectDir, targetId, outDir = undefined) {
  const args = [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--target", targetId,
    "--single-file",
    "--json"
  ];
  if (outDir) args.push("--out", outDir);
  return JSON.parse(execFileSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
}

function decodedSingleFileModules(html) {
  return [...html.matchAll(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/g)]
    .map((match) => Buffer.from(match[1], "base64").toString("utf8"))
    .join("\n");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
