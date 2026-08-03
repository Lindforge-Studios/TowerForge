import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import {
  getPlayerTargetRecipe,
  previewPlayerTarget,
  readPlayerTargets
} from "./player-target-authoring.mjs";
import { normalizeProjectFiles } from "./project-loader.mjs";
import { normalizeVisuals, validateProjectSchemas } from "./project-schema.mjs";

const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function nativeDesktopTarget() {
  return {
    id: "native-desktop",
    platform: "desktop",
    renderer: "canvas",
    outputDir: "desktop-native-desktop",
    appId: "com.example.nativegame",
    appName: "Native Game",
    appTitle: "Native Game",
    backgroundColor: "#111111",
    appVersion: "0.1.0",
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
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

function projectFiles(buildTargets) {
  return {
    projectDir: "/detached/r19.tdproj",
    manifest: { schemaVersion: 5, name: "R19 contract" },
    balance: { missions: {} },
    maps: {},
    mapSources: {},
    worldMap: { width: 1, height: 1, regions: [], missionNodes: [] },
    mechanics: undefined,
    distribution: undefined,
    visuals: normalizeVisuals({}),
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets,
    scripts: {},
    scriptFiles: {},
    scriptIssues: []
  };
}

function targets(target = nativeDesktopTarget()) {
  return {
    schemaVersion: 2,
    defaults: { desktop: "native-desktop" },
    targets: { "native-desktop": target }
  };
}

function buildIssues(buildTargets) {
  return validateProjectSchemas(projectFiles(buildTargets)).issues.filter((issue) => (
    issue.entityKind === "buildTargets" || issue.entityKind === "project"
  ));
}

function writePng(filePath, width = 1024, height = 1024) {
  const png = new PNG({ width, height });
  png.data.fill(0x7f);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r19-target-"));
  projects.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  writePng(path.join(projectDir, "assets", "app-icon.png"));
  return projectDir;
}

describe("R19.1 first-class native desktop target (RED)", () => {
  it("accepts platform desktop, defaults.desktop, and closed window/bundle records", () => {
    expect(buildIssues(targets())).toEqual([]);

    const normalized = normalizeProjectFiles(projectFiles(targets())).buildTargets;
    expect(normalized.defaults.desktop).toBe("native-desktop");
    expect(normalized.targets["native-desktop"]).toMatchObject(nativeDesktopTarget());
  });

  it.each([
    ["unknown window field", (value) => { value.targets["native-desktop"].window.rogue = true; }, "targets.native-desktop.window.rogue"],
    ["invalid window size order", (value) => { value.targets["native-desktop"].window.minWidth = 1600; }, "targets.native-desktop.window.minWidth"],
    ["unknown bundle field", (value) => { value.targets["native-desktop"].bundle.rogue = true; }, "targets.native-desktop.bundle.rogue"],
    ["unconfined icon source", (value) => { value.targets["native-desktop"].bundle.iconSource = "../app-icon.png"; }, "targets.native-desktop.bundle.iconSource"],
    ["unsupported bundle target", (value) => { value.targets["native-desktop"].bundle.targets.push("pkg"); }, "targets.native-desktop.bundle.targets.6"],
    ["duplicate native output directory", (value) => {
      value.targets["native-desktop"].outputDir = "desktop-shared";
      value.targets["native-second"] = {
        ...structuredClone(value.targets["native-desktop"]),
        id: "native-second",
        appId: "com.example.nativesecond"
      };
    }, "targets.native-second.outputDir"],
    ["desktop default pointing at web", (value) => {
      value.targets.web = { ...nativeDesktopTarget(), id: "web", platform: "web" };
      value.defaults.desktop = "web";
    }, "defaults.desktop"]
  ])("rejects %s with a stable field path", (_label, mutate, fieldPath) => {
    const candidate = structuredClone(targets());
    mutate(candidate);
    expect(buildIssues(candidate)).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "buildTargets",
      fieldPath
    }));
  });

  it("provides an inert native_desktop_game recipe that previews through the existing guarded transaction", () => {
    const projectDir = fixture();
    const beforeProject = fs.readFileSync(path.join(projectDir, "project.json"), "utf8");
    const beforeTargets = fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8");
    const read = readPlayerTargets(projectDir);

    const recipe = getPlayerTargetRecipe(projectDir, "native_desktop_game", "native-desktop");
    expect(recipe).toMatchObject({
      recipeId: "native_desktop_game",
      targetId: "native-desktop",
      detached: true,
      written: false,
      revision: read.revision,
      target: nativeDesktopTarget()
    });
    expect(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).toBe(beforeProject);
    expect(fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8")).toBe(beforeTargets);

    const preview = previewPlayerTarget(projectDir, recipe.targetId, recipe.target);
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      written: false,
      revision: read.revision,
      projectSchemaVersion: 5,
      buildTargetsSchemaVersion: 2,
      validation: { ok: true }
    });
    expect(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).toBe(beforeProject);
    expect(fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8")).toBe(beforeTargets);
  });

  it("allocates recipe outputs across the shared web and native namespace", () => {
    const projectDir = fixture();
    const buildTargetsPath = path.join(projectDir, "build-targets.json");
    fs.writeFileSync(buildTargetsPath, `${JSON.stringify({
      schemaVersion: 2,
      defaults: { web: "web-pwa", desktop: "native-existing" },
      targets: {
        "web-pwa": {
          id: "web-pwa",
          platform: "web",
          renderer: "canvas",
          webDir: "desktop-native-new"
        },
        "native-existing": {
          ...nativeDesktopTarget(),
          id: "native-existing",
          outputDir: "dist-desktop"
        }
      }
    }, null, 2)}\n`);

    const nativeRecipe = getPlayerTargetRecipe(projectDir, "native_desktop_game", "native-new");
    expect(nativeRecipe.target.outputDir).toBe("desktop-native-new-2");

    const webRecipe = getPlayerTargetRecipe(projectDir, "desktop_large_screen", "desktop-web-new");
    expect(webRecipe.target.webDir).toBe("dist-desktop-2");
  });
});
