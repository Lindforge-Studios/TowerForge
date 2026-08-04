import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SPLASH_AUTHORING_SCHEMA_V1,
  SPLASH_PLAYLIST_RECIPE_IDS,
  applySplashPlaylist,
  getSplashPlaylistRecipe,
  getSplashPlaylists,
  previewSplashPlaylist
} from "./splash-authoring.mjs";

const roots = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function playlist(label = "Studio introduction") {
  return {
    schemaVersion: 1,
    label,
    items: [{
      id: "studio",
      spriteId: "frontier_before_battle",
      accessibleLabel: "Lindforge Studios",
      backgroundColor: "#0b0f0d",
      fit: "contain",
      transition: "fade_scale",
      displayMs: 1_800,
      minimumMs: 600,
      transitionMs: 220
    }]
  };
}

function catalog() {
  return { schemaVersion: 1, playlists: { intro: playlist("Existing introduction") } };
}

function fixture({ withCatalog = true, legacyVersions = false } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r22-splash-authoring-"));
  roots.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });

  const projectPath = path.join(projectDir, "project.json");
  const targetsPath = path.join(projectDir, "build-targets.json");
  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const manifest = readJson(projectPath);
  const targets = readJson(targetsPath);
  const visuals = readJson(visualsPath);
  visuals.sprites.frontier_before_battle.mimeType = "image/png";
  writeJson(visualsPath, visuals);
  writeJson(projectPath, { ...manifest, schemaVersion: legacyVersions ? 1 : 5 });
  writeJson(targetsPath, {
    ...targets,
    schemaVersion: legacyVersions ? 1 : 2,
    targets: {
      ...targets.targets,
      "web-pwa": {
        ...targets.targets["web-pwa"],
        ...(legacyVersions ? {} : {
          formFactor: "legacy",
          viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
          quality: "auto",
          locale: "auto",
          inputProfile: "hybrid",
          ...(withCatalog ? { splashPlaylistId: "intro" } : {})
        })
      }
    }
  });
  if (withCatalog) writeJson(path.join(projectDir, "content", "splashes.json"), catalog());
  return projectDir;
}

function request(enabled = true) {
  return {
    playlistId: "authored",
    playlist: playlist("Authored introduction"),
    binding: { targetId: "web-pwa", enabled }
  };
}

function ownedBytes(projectDir) {
  const splashPath = path.join(projectDir, "content", "splashes.json");
  return {
    project: fs.readFileSync(path.join(projectDir, "project.json"), "utf8"),
    targets: fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8"),
    splashes: fs.existsSync(splashPath) ? fs.readFileSync(splashPath, "utf8") : null,
    visuals: fs.readFileSync(path.join(projectDir, "content", "visuals.json"), "utf8")
  };
}

describe("R22.3 narrow guarded splash authoring transaction (RED)", () => {
  it("publishes one versioned read/recipe/preview/apply contract", () => {
    expect(SPLASH_AUTHORING_SCHEMA_V1).toMatchObject({
      schemaVersion: 1,
      projectSchemaVersion: 5,
      buildTargetsSchemaVersion: 2,
      splashCatalogSchemaVersion: 1,
      revisionSources: ["project.json", "build-targets.json", "content/splashes.json", "content/visuals.json"],
      authoringTransaction: {
        read: "get_splash_playlists",
        recipe: "get_splash_playlist_recipe",
        preview: "preview_splash_playlist",
        apply: "apply_splash_playlist",
        revisionGuard: "ifRevision"
      }
    });
    expect(SPLASH_PLAYLIST_RECIPE_IDS).toContain("single_brand_splash");
    const recipe = getSplashPlaylistRecipe("single_brand_splash", "authored", {
      spriteId: "frontier_before_battle",
      accessibleLabel: "Lindforge Studios"
    });
    expect(recipe).toMatchObject({
      recipeId: "single_brand_splash",
      playlistId: "authored",
      detached: true,
      written: false,
      playlist: { schemaVersion: 1, items: [{ spriteId: "frontier_before_battle" }] }
    });
    expect(Object.isFrozen(recipe)).toBe(true);
  });

  it("keeps the generated playlist label valid for the longest accessible label", () => {
    const accessibleLabel = "A".repeat(512);
    const recipe = getSplashPlaylistRecipe("single_brand_splash", "long_brand", {
      spriteId: "frontier_before_battle",
      accessibleLabel
    });

    expect(recipe.playlist.items[0].accessibleLabel).toBe(accessibleLabel);
    expect(recipe.playlist.label.length).toBeLessThanOrEqual(256);
  });

  it("keeps read, recipe and preview compute-only with a detached timeline", () => {
    const projectDir = fixture();
    const before = ownedBytes(projectDir);
    const read = getSplashPlaylists(projectDir);
    expect(read).toMatchObject({
      schemaVersion: 1,
      projectSchemaVersion: 5,
      buildTargetsSchemaVersion: 2,
      splashCatalogSchemaVersion: 1,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      playlists: { intro: { label: "Existing introduction" } },
      bindings: { "web-pwa": "intro" }
    });
    getSplashPlaylistRecipe("single_brand_splash", "detached", {
      spriteId: "frontier_before_battle",
      accessibleLabel: "Detached"
    });
    const preview = previewSplashPlaylist(projectDir, request());
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      revision: read.revision,
      projectSchemaVersion: 5,
      buildTargetsSchemaVersion: 2,
      splashCatalogSchemaVersion: 1,
      validation: { ok: true },
      timeline: {
        playlistId: "authored",
        itemCount: 1,
        totalPlaybackMs: 2_020,
        items: [{ id: "studio", spriteId: "frontier_before_battle", assetReady: true }]
      }
    });
    expect(ownedBytes(projectDir)).toEqual(before);
  });

  it("previews an existing standalone image when visuals omits its optional MIME type", () => {
    const projectDir = fixture();
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const visuals = readJson(visualsPath);
    delete visuals.sprites.frontier_before_battle.mimeType;
    writeJson(visualsPath, visuals);

    expect(previewSplashPlaylist(projectDir, request())).toMatchObject({
      ok: true,
      timeline: { items: [{ spriteId: "frontier_before_battle", assetReady: true }] }
    });
  });

  it("reads only a bounded image header and rejects splash assets larger than 32 MiB", () => {
    const projectDir = fixture();
    const visuals = readJson(path.join(projectDir, "content", "visuals.json"));
    const assetPath = path.join(projectDir, visuals.sprites.frontier_before_battle.src);
    const realReadFile = fs.readFileSync.bind(fs);
    vi.spyOn(fs, "readFileSync").mockImplementation((filePath, ...args) => {
      if (path.resolve(String(filePath)) === path.resolve(assetPath)) {
        throw new Error("splash preview must not read the complete image");
      }
      return realReadFile(filePath, ...args);
    });
    expect(previewSplashPlaylist(projectDir, request())).toMatchObject({
      ok: true,
      timeline: { items: [{ assetReady: true }] }
    });
    vi.restoreAllMocks();

    fs.truncateSync(assetPath, 32 * 1024 * 1024 + 1);
    expect(previewSplashPlaylist(projectDir, request())).toMatchObject({
      ok: false,
      timeline: { items: [{ assetReady: false }] },
      validation: { issues: [{ code: "SPLASH_ASSET_NOT_READY" }] }
    });
  });

  it("atomically promotes legacy project/targets, creates the optional catalog and preserves visuals", () => {
    const projectDir = fixture({ withCatalog: false, legacyVersions: true });
    const beforeVisuals = ownedBytes(projectDir).visuals;
    const candidate = request();
    const preview = previewSplashPlaylist(projectDir, candidate);
    expect(preview).toMatchObject({ ok: true, projectSchemaVersion: 5, buildTargetsSchemaVersion: 2 });
    const applied = applySplashPlaylist(projectDir, { ...candidate, ifRevision: preview.revision });
    expect(applied).toMatchObject({
      ok: true,
      written: true,
      rolledBack: false,
      previousRevision: preview.revision,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      validation: { ok: true },
      backup: { directory: expect.stringMatching(/^\.towerforge\/backups\//) }
    });
    expect(readJson(path.join(projectDir, "project.json")).schemaVersion).toBe(5);
    const targets = readJson(path.join(projectDir, "build-targets.json"));
    expect(targets.schemaVersion).toBe(2);
    expect(targets.targets["web-pwa"].splashPlaylistId).toBe("authored");
    expect(readJson(path.join(projectDir, "content", "splashes.json")).playlists.authored)
      .toEqual(playlist("Authored introduction"));
    expect(ownedBytes(projectDir).visuals).toBe(beforeVisuals);
    expect(fs.readdirSync(path.join(projectDir, applied.backup.directory)))
      .toEqual(expect.arrayContaining(["project.json.bak", "build-targets.json.bak", "splashes.json.absent", "visuals.json.bak"]));
  });

  it("guards every source and rejects stale revisions without mutation", () => {
    const mutations = [
      ["project.json", (value) => ({ ...value, description: "changed" })],
      ["build-targets.json", (value) => ({ ...value, defaults: { ...value.defaults, desktop: "changed" } })],
      ["content/splashes.json", (value) => ({ ...value, playlists: { ...value.playlists, intro: playlist("Changed") } })],
      ["content/visuals.json", (value) => ({ ...value, terrainTextureSize: (value.terrainTextureSize ?? 128) + 1 })]
    ];
    for (const [relative, mutate] of mutations) {
      const projectDir = fixture();
      const candidate = request();
      const preview = previewSplashPlaylist(projectDir, candidate);
      const filePath = path.join(projectDir, relative);
      writeJson(filePath, mutate(readJson(filePath)));
      const changed = ownedBytes(projectDir);
      expect(applySplashPlaylist(projectDir, { ...candidate, ifRevision: preview.revision }), relative)
        .toMatchObject({ ok: false, conflict: true, written: false });
      expect(ownedBytes(projectDir), relative).toEqual(changed);
    }
  });

  it("disable removes only the target binding and preserves every reusable playlist and asset", () => {
    const projectDir = fixture();
    const enabled = request();
    const enabledPreview = previewSplashPlaylist(projectDir, enabled);
    expect(applySplashPlaylist(projectDir, { ...enabled, ifRevision: enabledPreview.revision }).ok).toBe(true);
    const beforeVisuals = ownedBytes(projectDir).visuals;
    const disabled = {
      ...request(false),
      // Disable is binding-only. Even a stale or accidentally edited Studio/agent draft must not
      // rewrite the reusable catalog while removing the target selector.
      playlist: playlist("Must not replace the saved catalog")
    };
    const disabledPreview = previewSplashPlaylist(projectDir, disabled);
    const result = applySplashPlaylist(projectDir, { ...disabled, ifRevision: disabledPreview.revision });
    expect(result).toMatchObject({ ok: true, written: true, rolledBack: false });
    expect(readJson(path.join(projectDir, "build-targets.json")).targets["web-pwa"])
      .not.toHaveProperty("splashPlaylistId");
    const saved = readJson(path.join(projectDir, "content", "splashes.json"));
    expect(saved.playlists.intro).toEqual(playlist("Existing introduction"));
    expect(saved.playlists.authored).toEqual(playlist("Authored introduction"));
    expect(ownedBytes(projectDir).visuals).toBe(beforeVisuals);
    expect(getSplashPlaylists(projectDir).bindings).toEqual({});
  });

  it("rolls back all owned bytes and cleans temporary files after a partial write failure", () => {
    const projectDir = fixture();
    const candidate = request();
    const preview = previewSplashPlaylist(projectDir, candidate);
    const before = ownedBytes(projectDir);
    const realRename = fs.renameSync.bind(fs);
    let renameCount = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
      renameCount += 1;
      if (renameCount === 3) throw new Error("injected splash transaction rename failure");
      return realRename(...args);
    });
    expect(applySplashPlaylist(projectDir, { ...candidate, ifRevision: preview.revision }))
      .toMatchObject({ ok: false, written: false, rolledBack: true });
    expect(ownedBytes(projectDir)).toEqual(before);
    expect(findTemporaryFiles(projectDir)).toEqual([]);
  });

  it("requires exact revision and exports no broad catalog or project writer", async () => {
    const projectDir = fixture();
    expect(() => applySplashPlaylist(projectDir, request())).toThrow(/ifRevision|revision/i);
    const module = await import("./splash-authoring.mjs");
    expect(Object.keys(module)).not.toEqual(expect.arrayContaining([
      "replaceSplashCatalog", "writeSplashCatalog", "replaceProject", "writeVisuals"
    ]));
  });

  it("keeps prototype-named detached playlist IDs as own data", () => {
    for (const playlistId of ["__proto__", "constructor"]) {
      const recipe = getSplashPlaylistRecipe("single_brand_splash", playlistId, {
        spriteId: "frontier_before_battle",
        accessibleLabel: "Prototype safe"
      });
      expect(recipe.playlistId).toBe(playlistId);
      expect(recipe.playlist.items).toHaveLength(1);
    }
    expect(Object.prototype).not.toHaveProperty("items");
  });
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function findTemporaryFiles(projectDir) {
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.name.includes(".tmp.")) found.push(path.relative(projectDir, absolute));
    }
  };
  walk(projectDir);
  return found;
}
