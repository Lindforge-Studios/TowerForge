import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject } from "./lib/create-project.mjs";

const repoRoot = path.resolve(".");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
let root;
let projectDir;
let plainBuild;
let cameraBuild;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r20-p0-runtime-"));
  ({ projectDir } = createProject({ name: "camera_p0", parentDir: root, templateName: "classic", gridKind: "square" }));
  configureMixedTargets(projectDir);
  plainBuild = build(projectDir, "plain-desktop");
  cameraBuild = build(projectDir, "camera-phaser");
}, 120_000);

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("R20 P0 generated runtime isolation and Phaser integration (RED)", () => {
  it("does not ship or initialize camera runtime for an unbound target in a mixed-target project", () => {
    for (const relative of ["camera-projector.mjs", "camera-renderer-integration.mjs", "camera-view-assets.mjs"]) {
      expect(fs.existsSync(path.join(plainBuild.outDir, "renderer", relative)), relative).toBe(false);
    }
    const player = fs.readFileSync(path.join(plainBuild.outDir, "player.mjs"), "utf8");
    expect(player).not.toMatch(/camera-projector|camera-renderer-integration|camera-view-assets|cameraProfileId|cameraProfiles/);
  });

  it("invokes shared depth projection in the actual Phaser scene instead of merely importing it", () => {
    const player = cameraPlayer();
    expect((player.match(/projectCameraRenderItemsV1\s*\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(player).toMatch(/projectCameraRenderItemsV1\s*\([^)]*(?:tower|enemy|hero|projectile)[\s\S]{0,1200}setDepth\s*\(/i);
  });

  it("routes Phaser tile pointer selection through the inverse shared camera transform", () => {
    const player = cameraPlayer();
    const pickTile = player.slice(player.indexOf("  pickTile(x, y) {"), player.indexOf("  enemyPos(", player.indexOf("  pickTile(x, y) {")));
    expect(pickTile).toMatch(/cameraRenderSpace\.screenToWorld\s*\(/);
  });

  it("consumes an exact tileset view variant in the actual Phaser tile path", () => {
    const player = cameraPlayer();
    expect(player).toMatch(/resolveCameraViewVariantV1\s*\(\s*\{[\s\S]{0,300}kind:\s*["']tileSet["']/);
    expect(player).toMatch(/tf-camera-tileset:/);
  });

  it("applies authored view-variant anchors as Phaser image origins", () => {
    const player = cameraPlayer();
    expect(player).toMatch(/add\.image\([^\n]+texture\.(?:key|frame)[\s\S]{0,240}setOrigin\(\s*texture\.anchor\.x\s*,\s*texture\.anchor\.y\s*\)/);
  });

  it("orders projectiles and destructibles together with real Phaser actor primitives", () => {
    const player = cameraPlayer();
    const actorDepth = player.slice(player.indexOf("  cameraActorDepth("), player.indexOf("  enemyPos(", player.indexOf("  cameraActorDepth(")));
    expect(actorDepth).toMatch(/projectBallisticsPresentation\s*\([^)]*snap[^)]*\)[\s\S]*kind:\s*["']projectile["']/);
    expect(actorDepth).toMatch(/projectDestructibleEnvironmentPresentation\s*\([^)]*snap[^)]*\)[\s\S]*kind:\s*["']destructible["']/);
    expect(player).toMatch(/(?:draw|render)CameraOrdered(?:World)?Actors[\s\S]*projectCameraRenderItemsV1[\s\S]*kind\s*===\s*["']projectile["'][\s\S]*(?:fillCircle|add\.image)/);
    expect(player).toMatch(/(?:draw|render)CameraOrdered(?:World)?Actors[\s\S]*kind\s*===\s*["']destructible["'][\s\S]*(?:fillRect|add\.image)/);
  });

  it("uses authoritative tile elevation for Phaser towers, destructibles and projectile endpoints", () => {
    const player = cameraPlayer();
    expect(player).toMatch(/(?:tileElevation|elevationAtCoord)\s*\([^)]*(?:coord|tower\.coord)[^)]*(?:snap\.tiles|tiles)[^)]*\)/);
    expect(player).toMatch(/kind:\s*["']tower["'][\s\S]{0,260}elevation:\s*(?:tileElevation|elevationAtCoord)/);
    expect(player).toMatch(/kind:\s*["']destructible["'][\s\S]{0,260}elevation:\s*(?:tileElevation|elevationAtCoord)/);
    expect(player).toMatch(/kind:\s*["']projectile["'][\s\S]{0,420}(?:sourceCoord|targetCoord)[\s\S]{0,180}(?:tileElevation|elevationAtCoord)/);
  });

  it("activates camera runtime from mission/map bindings even when the target has no cameraProfileId", () => {
    const { projectDir: boundProject } = createProject({ name: "bound_only", parentDir: root, templateName: "classic", gridKind: "hex" });
    configureBoundOnlyTarget(boundProject);
    const built = build(boundProject, "bound-only");
    for (const relative of ["camera-projector.mjs", "camera-renderer-integration.mjs", "camera-view-assets.mjs"]) {
      expect(fs.existsSync(path.join(built.outDir, "renderer", relative)), relative).toBe(true);
    }
    const player = fs.readFileSync(path.join(built.outDir, "player.mjs"), "utf8");
    const canvasRuntime = fs.readFileSync(path.join(built.outDir, "renderer", "index.mjs"), "utf8");
    expect(player).toMatch(/createCanvasRenderer\s*\(\s*\{[\s\S]{0,240}\bcontent\b/);
    expect(canvasRuntime).toMatch(/resolveCameraProfileV1\s*\([^,]+,\s*\{[\s\S]{0,360}missionId:[\s\S]*mapId:[\s\S]*buildTargetCameraProfileId:/);
  });
});

function cameraPlayer() {
  return fs.readFileSync(path.join(cameraBuild.outDir, "player.mjs"), "utf8");
}

function configureMixedTargets(dir) {
  const manifestPath = path.join(dir, "project.json");
  writeJson(manifestPath, { ...readJson(manifestPath), schemaVersion: 5 });

  const visualsPath = path.join(dir, "content", "visuals.json");
  const visuals = readJson(visualsPath);
  visuals.schemaVersion = 4;
  visuals.cameraProfiles = {
    schemaVersion: 1,
    profiles: {
      iso: {
        schemaVersion: 1, projection: "isometric_2_1", orientation: "north", elevationScale: 1.5,
        fitPadding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1, panPadding: 0
      }
    },
    bindings: { maps: {}, missions: {} }
  };
  visuals.sprites.camera_probe = { src: "assets/base-probe.png" };
  visuals.viewVariants = {
    schemaVersion: 1,
    sprites: {
      camera_probe: {
        "isometric_2_1:north": {
          src: "assets/camera-probe.png", mimeType: "image/png", anchor: { x: 0.25, y: 0.9 }
        }
      }
    },
    tileSets: {}
  };
  writeJson(visualsPath, visuals);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", "base-probe.png"), PNG);
  fs.writeFileSync(path.join(dir, "assets", "camera-probe.png"), PNG);

  writeJson(path.join(dir, "build-targets.json"), {
    schemaVersion: 2,
    defaults: { web: "plain-desktop" },
    targets: {
      "plain-desktop": target("plain-desktop", "canvas", "dist-plain"),
      "camera-phaser": { ...target("camera-phaser", "phaser", "dist-camera"), cameraProfileId: "iso" }
    }
  });
}

function configureBoundOnlyTarget(dir) {
  const manifestPath = path.join(dir, "project.json");
  writeJson(manifestPath, { ...readJson(manifestPath), schemaVersion: 5 });
  const balance = readJson(path.join(dir, "content", "balance.json"));
  const missionId = Object.keys(balance.missions)[0];
  const mapId = balance.missions[missionId].mapId;
  const visualsPath = path.join(dir, "content", "visuals.json");
  const visuals = readJson(visualsPath);
  visuals.schemaVersion = 4;
  const authored = (projection, orientation) => ({
    schemaVersion: 1, projection, orientation, elevationScale: 1.5,
    fitPadding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1, panPadding: 0
  });
  visuals.cameraProfiles = {
    schemaVersion: 1,
    profiles: {
      mission_camera: authored("isometric_2_1", "east"),
      map_camera: authored("dimetric_oblique", "south"),
      target_camera: authored("top_down", "north")
    },
    bindings: { maps: { [mapId]: "map_camera" }, missions: { [missionId]: "mission_camera" } }
  };
  writeJson(visualsPath, visuals);
  writeJson(path.join(dir, "build-targets.json"), {
    schemaVersion: 2,
    defaults: { web: "bound-only" },
    targets: { "bound-only": target("bound-only", "canvas", "dist-bound-only") }
  });
}

function target(id, renderer, webDir) {
  return {
    id, platform: "web", renderer, webDir, formFactor: "desktop",
    viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "high", locale: "en", inputProfile: "keyboard_mouse"
  };
}

function build(dir, targetId) {
  const result = JSON.parse(execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", dir,
    "--target", targetId, "--json"
  ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } }));
  execFileSync(process.execPath, ["--check", path.join(result.outDir, "player.mjs")], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return result;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
