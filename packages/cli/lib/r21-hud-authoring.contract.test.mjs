import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HUD_AUTHORING_SCHEMA_V1,
  applyHudProfile,
  getHudProfileRecipe,
  getHudProfiles,
  previewHudProfile
} from "./hud-authoring.mjs";

const roots = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function variant(width, height) {
  return { schemaVersion: 1, designViewport: { width, height }, rootNodeIds: [] };
}

function profile(label = "Main HUD") {
  return {
    schemaVersion: 1,
    label,
    breakpoints: { mobileMax: 767, tabletMax: 1199 },
    commonNodes: [],
    variants: {
      desktop: variant(1920, 1080),
      tablet: variant(1024, 768),
      mobile: variant(390, 844)
    },
    screens: {
      gameplay: { schemaVersion: 1, surface: "gameplay", rootNodeIds: [] }
    },
    screenGraph: { schemaVersion: 1, initialScreenId: "gameplay", transitions: [] },
    assetRoles: {}
  };
}

function catalog(profileId = "main", value = profile()) {
  return { schemaVersion: 1, profiles: { [profileId]: value } };
}

function desktopTarget() {
  return {
    id: "desktop-web",
    platform: "web",
    renderer: "canvas",
    webDir: "dist-desktop",
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
    quality: "high",
    locale: "ru",
    inputProfile: "keyboard_mouse",
    cameraProfileId: "iso"
  };
}

function fixture({ withHud = true, projectVersion = 4, targetsVersion = 1 } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r21-hud-authoring-"));
  roots.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });

  const projectPath = path.join(projectDir, "project.json");
  const targetsPath = path.join(projectDir, "build-targets.json");
  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const manifest = readJson(projectPath);
  const targets = readJson(targetsPath);
  const visuals = readJson(visualsPath);
  writeJson(projectPath, { ...manifest, schemaVersion: projectVersion });
  writeJson(targetsPath, {
    schemaVersion: targetsVersion,
    defaults: { ...targets.defaults },
    targets: { ...targets.targets, "desktop-web": desktopTarget() }
  });
  writeJson(visualsPath, {
    ...visuals,
    schemaVersion: 4,
    proceduralJuice: { schemaVersion: 1, particleEmitters: {}, audioCues: {}, cameraCues: {}, eventBindings: {} },
    cameraProfiles: {
      schemaVersion: 1,
      profiles: {
        iso: {
          schemaVersion: 1,
          projection: "isometric_2_1",
          orientation: "north",
          elevationScale: 1,
          fitPadding: 32,
          minZoom: 0.5,
          maxZoom: 3,
          initialZoom: 1,
          panPadding: 64
        }
      },
      bindings: { maps: {}, missions: {} }
    },
    viewVariants: { schemaVersion: 1, sprites: {}, tileSets: {} }
  });
  if (withHud) writeJson(path.join(projectDir, "content", "hud.json"), catalog());
  return projectDir;
}

function ownedBytes(projectDir) {
  const hudPath = path.join(projectDir, "content", "hud.json");
  return {
    project: fs.readFileSync(path.join(projectDir, "project.json"), "utf8"),
    targets: fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8"),
    hud: fs.existsSync(hudPath) ? fs.readFileSync(hudPath, "utf8") : null,
    visuals: fs.readFileSync(path.join(projectDir, "content", "visuals.json"), "utf8")
  };
}

function request(value = profile("Authored HUD"), enabled = true) {
  return {
    profileId: "authored",
    profile: value,
    binding: { targetId: "desktop-web", enabled }
  };
}

describe("R21.1b narrow guarded HUD authoring contract (RED)", () => {
  it("publishes one versioned CLI-owned read/recipe/preview/apply contract", () => {
    expect(HUD_AUTHORING_SCHEMA_V1).toMatchObject({
      schemaVersion: 1,
      projectSchemaVersion: 5,
      buildTargetsSchemaVersion: 2,
      hudCatalogSchemaVersion: 1,
      revisionSources: ["project.json", "build-targets.json", "content/hud.json", "content/visuals.json"],
      authoringTransaction: {
        read: "get_hud_profiles",
        recipe: "get_hud_profile_recipe",
        preview: "preview_hud_profile",
        apply: "apply_hud_profile",
        revisionGuard: "ifRevision"
      }
    });

    const recipe = getHudProfileRecipe("desktop_quickbar", "authored");
    expect(recipe).toMatchObject({
      recipeId: "desktop_quickbar",
      profileId: "authored",
      detached: true,
      written: false,
      profile: { schemaVersion: 1, variants: { desktop: {}, tablet: {}, mobile: {} } }
    });
    expect(Object.isFrozen(recipe)).toBe(true);
    expect(Object.isFrozen(recipe.profile)).toBe(true);
  });

  it.each([
    ["desktop_quickbar", "build_menu", "horizontal_quickbar"],
    ["radial_wheel", "radial_menu", undefined],
    ["mobile_bottom_sheet", "build_menu", "mobile_bottom_sheet"]
  ])("returns a meaningful editable %s recipe instead of an empty placeholder", (recipeId, componentType, presentation) => {
    const recipe = getHudProfileRecipe(recipeId, `profile-${recipeId}`);
    const profile = recipe.profile;

    expect(profile.commonNodes.length).toBeGreaterThan(0);
    expect(profile.commonNodes.some((node) => node.type === componentType)).toBe(true);
    const collection = profile.commonNodes.find((node) => node.type === componentType);
    expect(collection.bindings.actions).toContainEqual({
      event: "select",
      actionId: "selectBuildSlot",
      payload: {}
    });
    if (presentation !== undefined) {
      expect(profile.commonNodes.some((node) => node.properties?.presentation === presentation)).toBe(true);
    }
    for (const variantId of ["desktop", "tablet", "mobile"]) {
      expect(profile.variants[variantId].rootNodeIds.length).toBeGreaterThan(0);
      expect(Object.keys(profile.variants[variantId].layouts ?? {})).toEqual(
        expect.arrayContaining(profile.commonNodes.map((node) => node.id))
      );
    }
    expect(profile.screens.gameplay.rootNodeIds.length).toBeGreaterThan(0);
    expect(profile.screens.pause.rootNodeIds.length).toBeGreaterThan(0);
    expect(profile.commonNodes.some((node) => node.bindings.actions.some((action) => action.actionId === "pause"))).toBe(true);
    expect(previewHudProfile(fixture({ withHud: false }), request(profile))).toMatchObject({
      ok: true,
      validation: { ok: true }
    });
  });

  it("keeps read, recipe and preview compute-only and returns a detached validated candidate", () => {
    const projectDir = fixture();
    const before = ownedBytes(projectDir);
    const read = getHudProfiles(projectDir);
    expect(read).toMatchObject({
      schemaVersion: 1,
      projectSchemaVersion: 4,
      buildTargetsSchemaVersion: 1,
      hudCatalogSchemaVersion: 1,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      profiles: { main: { label: "Main HUD" } },
      bindings: {}
    });
    expect(ownedBytes(projectDir)).toEqual(before);

    getHudProfileRecipe("desktop_quickbar", "authored");
    expect(ownedBytes(projectDir)).toEqual(before);

    const preview = previewHudProfile(projectDir, request());
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      revision: read.revision,
      projectSchemaVersion: 5,
      buildTargetsSchemaVersion: 2,
      hudCatalogSchemaVersion: 1,
      validation: { ok: true },
      candidate: {
        profileId: "authored",
        profile: { label: "Authored HUD" },
        binding: { targetId: "desktop-web", enabled: true }
      }
    });
    expect(Object.isFrozen(preview)).toBe(true);
    expect(ownedBytes(projectDir)).toEqual(before);
  });

  it("atomically promotes the project/targets contracts, upserts one profile and preserves camera, visuals and unrelated targets", () => {
    const projectDir = fixture();
    const beforeVisuals = readJson(path.join(projectDir, "content", "visuals.json"));
    const beforeTargets = readJson(path.join(projectDir, "build-targets.json")).targets;
    const candidate = request();
    const preview = previewHudProfile(projectDir, candidate);
    expect(preview.ok).toBe(true);

    const applied = applyHudProfile(projectDir, { ...candidate, ifRevision: preview.revision });
    expect(applied).toMatchObject({
      ok: true,
      written: true,
      rolledBack: false,
      previousRevision: preview.revision,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      validation: { ok: true },
      backup: { directory: expect.stringMatching(/^\.towerforge\/backups\//) }
    });

    const manifest = readJson(path.join(projectDir, "project.json"));
    const targets = readJson(path.join(projectDir, "build-targets.json"));
    const hud = readJson(path.join(projectDir, "content", "hud.json"));
    expect(manifest.schemaVersion).toBe(5);
    expect(targets.schemaVersion).toBe(2);
    expect(targets.targets["web-pwa"]).toEqual(beforeTargets["web-pwa"]);
    expect(targets.targets["desktop-web"]).toEqual({ ...beforeTargets["desktop-web"], hudProfileId: "authored" });
    expect(hud.profiles.main).toEqual(profile());
    expect(hud.profiles.authored).toEqual(profile("Authored HUD"));
    expect(readJson(path.join(projectDir, "content", "visuals.json"))).toEqual(beforeVisuals);

    const backupDir = path.join(projectDir, applied.backup.directory);
    expect(fs.realpathSync(backupDir).startsWith(`${fs.realpathSync(projectDir)}${path.sep}`)).toBe(true);
    expect(fs.readdirSync(backupDir).sort()).toEqual(expect.arrayContaining([
      "build-targets.json.bak", "hud.json.bak", "project.json.bak", "visuals.json.bak"
    ]));
  });

  it("includes every owned file in the composite revision and rejects each stale apply before mutation", () => {
    const mutations = [
      ["project.json", (value) => ({ ...value, description: "revision changed" })],
      ["build-targets.json", (value) => ({ ...value, defaults: { ...value.defaults, desktop: "stale-target" } })],
      ["content/hud.json", (value) => ({ ...value, profiles: { ...value.profiles, main: { ...value.profiles.main, label: "Changed" } } })],
      ["content/visuals.json", (value) => ({ ...value, terrainTextureSize: (value.terrainTextureSize ?? 128) + 1 })]
    ];
    for (const [relative, mutate] of mutations) {
      const projectDir = fixture();
      const candidate = request();
      const preview = previewHudProfile(projectDir, candidate);
      const filePath = path.join(projectDir, relative);
      writeJson(filePath, mutate(readJson(filePath)));
      const changed = ownedBytes(projectDir);

      const applied = applyHudProfile(projectDir, { ...candidate, ifRevision: preview.revision });
      expect(applied, relative).toMatchObject({ ok: false, conflict: true, written: false });
      expect(ownedBytes(projectDir), relative).toEqual(changed);
    }
  });

  it("removes only the selected target binding and preserves the reusable profile catalog", () => {
    const projectDir = fixture();
    const enabledRequest = request();
    const enabledPreview = previewHudProfile(projectDir, enabledRequest);
    expect(applyHudProfile(projectDir, { ...enabledRequest, ifRevision: enabledPreview.revision }).ok).toBe(true);

    const disabledRequest = request(profile("Authored HUD"), false);
    const disabledPreview = previewHudProfile(projectDir, disabledRequest);
    expect(disabledPreview.ok).toBe(true);
    const disabled = applyHudProfile(projectDir, { ...disabledRequest, ifRevision: disabledPreview.revision });
    expect(disabled).toMatchObject({ ok: true, written: true, rolledBack: false });

    const targets = readJson(path.join(projectDir, "build-targets.json"));
    const hud = readJson(path.join(projectDir, "content", "hud.json"));
    expect(targets.targets["desktop-web"]).not.toHaveProperty("hudProfileId");
    expect(hud.profiles.authored).toEqual(profile("Authored HUD"));
    expect(getHudProfiles(projectDir).bindings).toEqual({});
  });

  it("rejects malformed candidates and future catalogs without writes or downgrade", () => {
    const projectDir = fixture();
    const before = ownedBytes(projectDir);
    const malformed = { ...profile("Broken"), executable: "javascript:alert(1)" };
    expect(previewHudProfile(projectDir, request(malformed))).toMatchObject({
      ok: false, dryRun: true, written: false, validation: { ok: false }
    });
    expect(ownedBytes(projectDir)).toEqual(before);

    const future = readJson(path.join(projectDir, "content", "hud.json"));
    future.schemaVersion = 2;
    writeJson(path.join(projectDir, "content", "hud.json"), future);
    const futureBytes = ownedBytes(projectDir);
    const preview = previewHudProfile(projectDir, request());
    expect(preview).toMatchObject({ ok: false, dryRun: true, written: false, validation: { ok: false } });
    expect(applyHudProfile(projectDir, { ...request(), ifRevision: preview.revision })).toMatchObject({ ok: false, written: false });
    expect(ownedBytes(projectDir)).toEqual(futureBytes);
  });

  it("creates the optional HUD file on first save while backing up its absent state", () => {
    const projectDir = fixture({ withHud: false });
    const beforeVisuals = ownedBytes(projectDir).visuals;
    const candidate = request();
    const preview = previewHudProfile(projectDir, candidate);
    expect(preview.ok).toBe(true);
    const applied = applyHudProfile(projectDir, { ...candidate, ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, written: true, rolledBack: false });
    expect(readJson(path.join(projectDir, "project.json")).schemaVersion).toBe(5);
    expect(readJson(path.join(projectDir, "build-targets.json")).schemaVersion).toBe(2);
    expect(readJson(path.join(projectDir, "content", "hud.json")).profiles.authored).toEqual(profile("Authored HUD"));
    expect(ownedBytes(projectDir).visuals).toBe(beforeVisuals);
    expect(fs.readdirSync(path.join(projectDir, applied.backup.directory)))
      .toEqual(expect.arrayContaining(["hud.json.absent"]));
  });

  it("rolls all four owned files back and cleans temporary files after a partial atomic-write failure", () => {
    const projectDir = fixture();
    const candidate = request();
    const preview = previewHudProfile(projectDir, candidate);
    expect(preview.ok).toBe(true);
    const before = ownedBytes(projectDir);
    const realRename = fs.renameSync.bind(fs);
    let renameCount = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
      renameCount += 1;
      if (renameCount === 3) throw new Error("injected HUD transaction rename failure");
      return realRename(...args);
    });

    const applied = applyHudProfile(projectDir, { ...candidate, ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: false, written: false, rolledBack: true });
    expect(ownedBytes(projectDir)).toEqual(before);
    expect(findTemporaryFiles(projectDir)).toEqual([]);
  });

  it("requires an exact preview revision and exposes no broad project writer", async () => {
    const projectDir = fixture();
    const candidate = request();
    expect(() => applyHudProfile(projectDir, candidate)).toThrow(/ifRevision|revision/i);
    const module = await import("./hud-authoring.mjs");
    expect(Object.keys(module)).not.toEqual(expect.arrayContaining([
      "replaceHudCatalog", "writeHudCatalog", "replaceProject", "writeVisuals"
    ]));
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
  return found.sort();
}
