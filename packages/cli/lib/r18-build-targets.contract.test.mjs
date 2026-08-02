import { describe, expect, it } from "vitest";
import { normalizeProjectFiles } from "./project-loader.mjs";
import { PROJECT_SCHEMA_VERSION, normalizeVisuals, validateProjectSchemas } from "./project-schema.mjs";

function files({ projectVersion = 5, buildTargets } = {}) {
  return {
    projectDir: "/detached/r18.tdproj",
    manifest: { schemaVersion: projectVersion, name: "R18 contract" },
    balance: { missions: {} },
    maps: {}, mapSources: {}, worldMap: { width: 1, height: 1, regions: [], missionNodes: [] },
    mechanics: undefined, distribution: undefined,
    visuals: normalizeVisuals({}),
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets: buildTargets ?? desktopTargets(), scripts: {}, scriptFiles: {}, scriptIssues: []
  };
}

function desktopTargets() {
  return {
    schemaVersion: 2,
    defaults: { web: "desktop-web" },
    targets: {
      "desktop-web": {
        id: "desktop-web", platform: "web", renderer: "canvas", webDir: "dist-desktop",
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
        quality: "high", locale: "ru", inputProfile: "keyboard_mouse"
      }
    }
  };
}

function relevant(result) {
  return result.issues.filter((issue) => issue.entityKind === "buildTargets" || issue.entityKind === "project");
}

describe("R18 BuildTargets v2 opt-in contract (RED)", () => {
  it("raises only the project domain to v5 and accepts a closed desktop target", () => {
    expect(PROJECT_SCHEMA_VERSION).toBe(5);
    expect(relevant(validateProjectSchemas(files()))).toEqual([]);
    const target = normalizeProjectFiles(files()).buildTargets.targets["desktop-web"];
    expect(target).toMatchObject({
      formFactor: "desktop", quality: "high", locale: "ru", inputProfile: "keyboard_mouse",
      viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 }
    });
  });

  it("requires project v5 whenever BuildTargets v2 is authored", () => {
    const result = validateProjectSchemas(files({ projectVersion: 4 }));
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error", entityKind: "project", fieldPath: "schemaVersion"
    }));
  });

  it.each([
    ["future schema", (value) => { value.schemaVersion = 3; }, "schemaVersion"],
    ["unknown target key", (value) => { value.targets["desktop-web"].rogue = true; }, "targets.desktop-web.rogue"],
    ["unknown viewport key", (value) => { value.targets["desktop-web"].viewport.rogue = true; }, "targets.desktop-web.viewport.rogue"],
    ["invalid form factor", (value) => { value.targets["desktop-web"].formFactor = "television"; }, "targets.desktop-web.formFactor"],
    ["invalid fit", (value) => { value.targets["desktop-web"].viewport.fit = "cover"; }, "targets.desktop-web.viewport.fit"],
    ["invalid zoom order", (value) => { value.targets["desktop-web"].viewport.minZoom = 2; value.targets["desktop-web"].viewport.maxZoom = 1; }, "targets.desktop-web.viewport"],
    ["initial zoom outside bounds", (value) => { value.targets["desktop-web"].viewport.initialZoom = 4; }, "targets.desktop-web.viewport.initialZoom"],
    ["invalid quality", (value) => { value.targets["desktop-web"].quality = "ultra"; }, "targets.desktop-web.quality"],
    ["empty locale", (value) => { value.targets["desktop-web"].locale = ""; }, "targets.desktop-web.locale"],
    ["invalid input profile", (value) => { value.targets["desktop-web"].inputProfile = "gamepad"; }, "targets.desktop-web.inputProfile"]
  ])("rejects %s with a stable field path", (_label, mutate, fieldPath) => {
    const buildTargets = structuredClone(desktopTargets());
    mutate(buildTargets);
    expect(relevant(validateProjectSchemas(files({ buildTargets })))).toContainEqual(
      expect.objectContaining({ severity: "error", fieldPath })
    );
  });

  it("keeps schema v1 and an absent build-target version on the byte-compatible legacy shape", () => {
    for (const buildTargets of [
      { schemaVersion: 1, defaults: { web: "web" }, targets: { web: { platform: "web", renderer: "canvas", webDir: "dist" } } },
      { defaults: { web: "web" }, targets: { web: { platform: "web", renderer: "canvas", webDir: "dist" } } }
    ]) {
      const normalized = normalizeProjectFiles(files({ projectVersion: 1, buildTargets })).buildTargets;
      expect(normalized.schemaVersion).toBe(1);
      expect(normalized.targets.web).not.toHaveProperty("formFactor");
      expect(normalized.targets.web).not.toHaveProperty("viewport");
      expect(normalized.targets.web).not.toHaveProperty("quality");
      expect(normalized.targets.web).not.toHaveProperty("locale");
      expect(normalized.targets.web).not.toHaveProperty("inputProfile");
    }
  });
});
