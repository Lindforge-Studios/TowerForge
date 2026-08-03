import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callTool } from "../../mcp/tools.mjs";
import { copyVisualAssets, planProjectAssetImport } from "./assets.mjs";
import { stageGeneratedAsset } from "./generated-assets.mjs";
import { listVisualAssetPaths, normalizeVisuals, validateProjectSchemas } from "./project-schema.mjs";

const repoRoot = path.resolve(".");
const VIEW_KEY = "isometric_2_1:north";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBP"), Buffer.from("VP8 ")]);
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function cameraProfiles() {
  return {
    schemaVersion: 1,
    profiles: {
      iso: {
        schemaVersion: 1,
        projection: "isometric_2_1",
        orientation: "north",
        elevationScale: 1.5,
        fitPadding: 32,
        minZoom: 0.5,
        maxZoom: 3,
        initialZoom: 1
      }
    },
    bindings: { maps: {}, missions: {} }
  };
}

function validVisuals() {
  return normalizeVisuals({
    schemaVersion: 4,
    cameraProfiles: cameraProfiles(),
    atlases: { base_tiles: { src: "assets/base/tiles.png" } },
    sprites: {
      frontier_before_battle: { src: "assets/themes/verdant-frontier/battle-background.png" },
      tower_base: { src: "assets/base/tower.png" },
      enemy_base: { src: "assets/base/enemy.png" },
      tile_base: { atlas: "base_tiles", frame: { x: 0, y: 0, w: 1, h: 1 } }
    },
    tileSets: {
      ground: {
        id: "ground",
        atlas: "base_tiles",
        tileWidth: 1,
        tileHeight: 1,
        margin: 0,
        spacing: 0,
        topology: "square",
        ruleKind: "random",
        materials: {
          buildable: { signatures: { random: [{ spriteId: "tile_base", weight: 1 }] } },
          path: { signatures: { random: [{ spriteId: "tile_base", weight: 1 }] } }
        }
      }
    },
    viewVariants: {
      schemaVersion: 1,
      sprites: {
        tower_base: {
          [VIEW_KEY]: { src: "assets/camera/tower.png", mimeType: "image/png", anchor: { x: 0.5, y: 0.85 } }
        },
        enemy_base: {
          [VIEW_KEY]: { src: "assets/camera/enemy.jpg", mimeType: "image/jpeg", anchor: { x: 0.5, y: 0.8 } }
        }
      },
      tileSets: {
        ground: {
          [VIEW_KEY]: {
            atlas: { src: "assets/camera/ground.webp", mimeType: "image/webp" },
            materials: {
              buildable: { signatures: { random: [{ spriteId: "tile_base", weight: 1 }] } },
              path: { signatures: { random: [{ spriteId: "tile_base", weight: 1 }] } }
            }
          }
        }
      }
    }
  });
}

function projectFiles(visuals = validVisuals()) {
  return {
    manifest: { schemaVersion: 5, name: "R20 view assets" },
    balance: { missions: {}, terrainTypes: { buildable: { id: "buildable" }, path: { id: "path" } } },
    maps: {},
    mapSources: {},
    mechanics: undefined,
    distribution: undefined,
    visuals,
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets: { schemaVersion: 1, targets: {} },
    scripts: {},
    scriptFiles: {},
    scriptIssues: []
  };
}

function viewIssues(visuals) {
  return validateProjectSchemas(projectFiles(visuals)).issues.filter((issue) => (
    issue.entityKind === "visuals" && issue.fieldPath.includes("viewVariants")
  ));
}

describe("R20.3 visuals v4 view-variant asset contract (RED)", () => {
  it("accepts the closed catalog and lists PNG/JPEG/WebP variant paths deterministically", () => {
    const visuals = validVisuals();
    expect(viewIssues(visuals)).toEqual([]);
    expect(listVisualAssetPaths(visuals).filter((entry) => entry.kind.startsWith("camera"))).toEqual([
      { kind: "cameraSpriteVariant", id: `enemy_base@${VIEW_KEY}`, path: "assets/camera/enemy.jpg", mimeType: "image/jpeg" },
      { kind: "cameraSpriteVariant", id: `tower_base@${VIEW_KEY}`, path: "assets/camera/tower.png", mimeType: "image/png" },
      { kind: "cameraTileSetVariant", id: `ground@${VIEW_KEY}`, path: "assets/camera/ground.webp", mimeType: "image/webp" }
    ]);
  });

  it.each([
    ["future version", (value) => { value.viewVariants.schemaVersion = 2; }, "viewVariants.schemaVersion"],
    ["unknown root field", (value) => { value.viewVariants.executableHook = "alert(1)"; }, "viewVariants.executableHook"],
    ["invalid view key", (value) => { value.viewVariants.sprites.tower_base["perspective_3d:free"] = value.viewVariants.sprites.tower_base[VIEW_KEY]; }, "viewVariants.sprites.tower_base.perspective_3d:free"],
    ["unsafe path", (value) => { value.viewVariants.sprites.tower_base[VIEW_KEY].src = "../outside.png"; }, `viewVariants.sprites.tower_base.${VIEW_KEY}.src`],
    ["MIME/extension mismatch", (value) => { value.viewVariants.sprites.tower_base[VIEW_KEY].mimeType = "image/jpeg"; }, `viewVariants.sprites.tower_base.${VIEW_KEY}.mimeType`],
    ["unsafe SVG", (value) => { value.viewVariants.sprites.tower_base[VIEW_KEY] = { src: "assets/camera/tower.svg", mimeType: "image/svg+xml", anchor: { x: 0.5, y: 1 } }; }, `viewVariants.sprites.tower_base.${VIEW_KEY}`],
    ["invalid anchor", (value) => { value.viewVariants.sprites.tower_base[VIEW_KEY].anchor.x = 1.1; }, `viewVariants.sprites.tower_base.${VIEW_KEY}.anchor.x`],
    ["mandatory tileset material", (value) => { delete value.viewVariants.tileSets.ground[VIEW_KEY].materials.path; }, `viewVariants.tileSets.ground.${VIEW_KEY}.materials.path`]
  ])("rejects %s with a stable field path", (_label, mutate, fieldPath) => {
    const visuals = validVisuals();
    mutate(visuals);
    expect(viewIssues(visuals)).toContainEqual(expect.objectContaining({ severity: "error", fieldPath }));
  });

  it("warns for an optional sprite variant whose base sprite is unavailable", () => {
    const visuals = validVisuals();
    visuals.viewVariants.sprites.optional_missing = {
      [VIEW_KEY]: { src: "assets/camera/optional.png", mimeType: "image/png", anchor: { x: 0.5, y: 0.5 } }
    };
    expect(viewIssues(visuals)).toContainEqual(expect.objectContaining({
      severity: "warning",
      fieldPath: `viewVariants.sprites.optional_missing.${VIEW_KEY}`
    }));
  });

  it("accepts an omitted sprite-variant anchor and applies the shared default", () => {
    const visuals = validVisuals();
    delete visuals.viewVariants.sprites.tower_base[VIEW_KEY].anchor;
    expect(viewIssues(visuals)).toEqual([]);
  });

  it("copies active PNG/JPEG/WebP variants and rejects signature or size mismatches", () => {
    const projectDir = temporaryProject("copy");
    writeViewAssetBytes(projectDir);
    const outDir = path.join(projectDir, "dist");
    const copied = copyVisualAssets(projectDir, outDir, validVisuals(), {
      cameraView: { projection: "isometric_2_1", orientation: "north" }
    });
    expect(copied.invalid).toEqual([]);
    for (const relative of ["assets/camera/tower.png", "assets/camera/enemy.jpg", "assets/camera/ground.webp"]) {
      expect(fs.readFileSync(path.join(outDir, relative))).toEqual(fs.readFileSync(path.join(projectDir, relative)));
    }

    fs.writeFileSync(path.join(projectDir, "assets/camera/tower.png"), Buffer.from("not png"));
    fs.writeFileSync(path.join(projectDir, "assets/camera/ground.webp"), WEBP);
    fs.truncateSync(path.join(projectDir, "assets/camera/ground.webp"), 32 * 1024 * 1024 + 1);
    const rejected = copyVisualAssets(projectDir, path.join(projectDir, "dist-invalid"), validVisuals(), {
      cameraView: { projection: "isometric_2_1", orientation: "north" }
    });
    expect(rejected.invalid).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `tower_base@${VIEW_KEY}`, reason: expect.stringMatching(/signature|MIME/i) }),
      expect.objectContaining({ id: `ground@${VIEW_KEY}`, reason: expect.stringMatching(/size|32/i) })
    ]));
  });

  it("packages every active variant into PWA and single-file output", () => {
    const projectDir = copyStarter("package");
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const starterVisuals = readJson(visualsPath);
    const cameraVisuals = validVisuals();
    writeJson(visualsPath, {
      ...starterVisuals,
      ...cameraVisuals,
      atlases: { ...starterVisuals.atlases, ...cameraVisuals.atlases },
      sprites: { ...starterVisuals.sprites, ...cameraVisuals.sprites },
      bindings: { ...starterVisuals.bindings, ...cameraVisuals.bindings },
      tileSets: { ...starterVisuals.tileSets, ...cameraVisuals.tileSets }
    });
    writeViewAssetBytes(projectDir);
    writeJson(path.join(projectDir, "project.json"), { ...readJson(path.join(projectDir, "project.json")), schemaVersion: 5 });
    writeJson(path.join(projectDir, "build-targets.json"), {
      schemaVersion: 2,
      defaults: { web: "camera-web" },
      targets: {
        "camera-web": {
          id: "camera-web", platform: "web", renderer: "canvas", webDir: "dist-camera-view",
          formFactor: "desktop",
          viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
          quality: "high", locale: "en", inputProfile: "keyboard_mouse", cameraProfileId: "iso"
        }
      }
    });

    const built = JSON.parse(execFileSync(process.execPath, [
      path.join(repoRoot, "packages/cli/build.mjs"), "--project", projectDir,
      "--target", "camera-web", "--single-file", "--json"
    ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } }));
    for (const relative of ["assets/camera/tower.png", "assets/camera/enemy.jpg", "assets/camera/ground.webp"]) {
      expect(fs.existsSync(path.join(built.outDir, relative)), relative).toBe(true);
      expect(fs.readFileSync(path.join(built.outDir, "offline-sw.js"), "utf8")).toContain(`./${relative}`);
    }
    const single = fs.readFileSync(path.join(built.outDir, "index.single.html"), "utf8");
    expect(single).toContain("data:image/png;base64,");
    expect(single).toContain("data:image/jpeg;base64,");
    expect(single).toContain("data:image/webp;base64,");
  }, 60_000);

  it("keeps visuals v4 and viewVariants through guarded asset and tileset imports", async () => {
    const projectDir = copyStarter("guarded");
    writeJson(path.join(projectDir, "project.json"), { ...readJson(path.join(projectDir, "project.json")), schemaVersion: 5 });
    writeJson(path.join(projectDir, "content/visuals.json"), validVisuals());
    fs.mkdirSync(path.join(projectDir, "imports"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "imports/new.png"), PNG);

    const assetPlan = planProjectAssetImport(projectDir, validVisuals(), {
      sourcePath: "imports/new.png", targetPath: "camera/new.png", id: "new_asset", kind: "sprite"
    });
    expect(assetPlan.visuals.schemaVersion).toBe(4);
    expect(assetPlan.visuals.viewVariants).toEqual(validVisuals().viewVariants);

    const tilesetBytes = fs.readFileSync(path.join(repoRoot, "packages/cli/theme-packs/verdant-frontier/assets/tiles-square.png"));
    fs.mkdirSync(path.join(projectDir, "assets/tilesets"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "assets/tilesets/guarded.png"), tilesetBytes);
    const request = {
      projectDir,
      sourceName: "guarded.tsj",
      topology: "square",
      descriptor: JSON.stringify({
        type: "tileset", name: "guarded", image: "tilesets/guarded.png",
        tilewidth: 64, tileheight: 64, tilecount: 1, columns: 1,
        properties: [{ name: "towerforge.terrainId", value: "buildable" }]
      })
    };
    const preview = await callTool("preview_tileset_import", request, {});
    const applied = await callTool("apply_tileset_import", { ...request, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({ ok: true, written: true });
    const after = readJson(path.join(projectDir, "content/visuals.json"));
    expect(after.schemaVersion).toBe(4);
    expect(after.viewVariants).toEqual(validVisuals().viewVariants);
  }, 60_000);

  it("accepts WebP in the existing staged-generation validation pipeline", () => {
    const projectDir = temporaryProject("staged-webp");
    const staged = stageGeneratedAsset(projectDir, {
      bytes: WEBP,
      declaredMimeType: "image/webp",
      fileName: "tower-isometric.webp",
      license: { id: "CC0-1.0", attribution: null },
      provenance: {
        generator: "agent-runtime", provider: "test", model: "test-model",
        generatedAt: "2026-08-03T00:00:00.000Z"
      }
    });
    expect(staged).toMatchObject({ mimeType: "image/webp", readyForPreview: true });
  });
});

function temporaryProject(label) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `towerforge-r20-view-${label}-`));
  roots.push(projectDir);
  fs.mkdirSync(path.join(projectDir, "assets/camera"), { recursive: true });
  return projectDir;
}

function copyStarter(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `towerforge-r20-view-${label}-`));
  roots.push(root);
  const projectDir = path.join(root, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples/starter.tdproj"), projectDir, { recursive: true });
  return projectDir;
}

function writeViewAssetBytes(projectDir) {
  fs.mkdirSync(path.join(projectDir, "assets/camera"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "assets/base"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "assets/camera/tower.png"), PNG);
  fs.writeFileSync(path.join(projectDir, "assets/camera/enemy.jpg"), JPEG);
  fs.writeFileSync(path.join(projectDir, "assets/camera/ground.webp"), WEBP);
  fs.writeFileSync(path.join(projectDir, "assets/base/tower.png"), PNG);
  fs.writeFileSync(path.join(projectDir, "assets/base/enemy.png"), PNG);
  fs.writeFileSync(path.join(projectDir, "assets/base/tiles.png"), PNG);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
