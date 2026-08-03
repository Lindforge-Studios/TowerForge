import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectFiles, normalizeProjectFiles, readRawProjectFiles } from "./project-loader.mjs";
import { defaultVisuals, validateProjectSchemas } from "./project-schema.mjs";

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function variant(width, height) {
  return { schemaVersion: 1, designViewport: { width, height }, rootNodeIds: [] };
}

function hudCatalog() {
  return {
    schemaVersion: 1,
    profiles: {
      main: {
        schemaVersion: 1,
        label: "Main HUD",
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
      }
    }
  };
}

function target({ hudProfileId, formFactor = "desktop" } = {}) {
  return {
    id: "desktop-web",
    platform: "web",
    renderer: "canvas",
    webDir: "dist-r21",
    formFactor,
    viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
    quality: "high",
    locale: "ru",
    inputProfile: "keyboard_mouse",
    ...(hudProfileId === undefined ? {} : { hudProfileId })
  };
}

function buildTargets(options = {}) {
  return {
    schemaVersion: 2,
    defaults: { web: "desktop-web" },
    targets: { "desktop-web": target(options) }
  };
}

function files({
  projectVersion = 5,
  hud = hudCatalog(),
  hudAuthored = true,
  targets = buildTargets({ hudProfileId: "main" })
} = {}) {
  return {
    projectDir: "/detached/r21.tdproj",
    manifest: { schemaVersion: projectVersion, name: "R21 HUD contract" },
    balance: { missions: {} },
    maps: {},
    mapSources: {},
    worldMap: { width: 1, height: 1, regions: [], missionNodes: [] },
    mechanics: undefined,
    distribution: undefined,
    visuals: defaultVisuals(),
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets: targets,
    hud,
    hudAuthored,
    scripts: {},
    scriptFiles: {},
    scriptIssues: []
  };
}

function relevant(result) {
  return result.issues.filter((issue) => ["hud", "buildTargets", "project"].includes(issue.entityKind));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function diskProject({ includeHud = true } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r21-hud-"));
  tempDirs.push(projectDir);
  writeJson(path.join(projectDir, "project.json"), { schemaVersion: 5, name: "R21 disk" });
  writeJson(path.join(projectDir, "content", "balance.json"), {});
  writeJson(path.join(projectDir, "content", "visuals.json"), defaultVisuals());
  writeJson(path.join(projectDir, "build-targets.json"), buildTargets(includeHud ? { hudProfileId: "main" } : {}));
  if (includeHud) writeJson(path.join(projectDir, "content", "hud.json"), hudCatalog());
  return projectDir;
}

describe("R21.1 optional HUD project transport and binding contract (RED)", () => {
  it("loads content/hud.json verbatim and carries explicit hudAuthored state through normalization", () => {
    const projectDir = diskProject();
    const raw = readRawProjectFiles(projectDir);
    expect(raw.hud).toEqual(hudCatalog());

    const loaded = loadProjectFiles(projectDir);
    expect(loaded.hudAuthored).toBe(true);
    expect(loaded.hud).toEqual(hudCatalog());
    expect(loaded.buildTargets.targets["desktop-web"].hudProfileId).toBe("main");
  });

  it("keeps an absent HUD file absent and does not synthesize a catalog", () => {
    const projectDir = diskProject({ includeHud: false });
    const raw = readRawProjectFiles(projectDir);
    const loaded = loadProjectFiles(projectDir);

    expect(raw.hud).toBeUndefined();
    expect(loaded.hud).toBeUndefined();
    expect(loaded.hudAuthored).toBe(false);
    expect(loaded.buildTargets.targets["desktop-web"]).not.toHaveProperty("hudProfileId");
  });

  it("accepts a valid explicit desktop/responsive binding and preserves it", () => {
    const validation = relevant(validateProjectSchemas(files()));
    expect(validation).toEqual([]);
    expect(normalizeProjectFiles(files()).buildTargets.targets["desktop-web"].hudProfileId).toBe("main");

    const responsive = files({ targets: buildTargets({ hudProfileId: "main", formFactor: "responsive" }) });
    expect(relevant(validateProjectSchemas(responsive))).toEqual([]);
  });

  it("rejects missing profile references, missing catalogs and legacy-form-factor bindings at stable paths", () => {
    const missingProfile = relevant(validateProjectSchemas(files({
      targets: buildTargets({ hudProfileId: "missing" })
    })));
    expect(missingProfile).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "buildTargets",
      fieldPath: "targets.desktop-web.hudProfileId",
      message: expect.stringContaining("missing")
    }));

    const missingCatalog = relevant(validateProjectSchemas(files({ hud: undefined, hudAuthored: false })));
    expect(missingCatalog).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: "targets.desktop-web.hudProfileId"
    }));

    const legacyForm = relevant(validateProjectSchemas(files({
      targets: buildTargets({ hudProfileId: "main", formFactor: "legacy" })
    })));
    expect(legacyForm).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: "targets.desktop-web.hudProfileId",
      message: expect.stringMatching(/desktop|responsive/i)
    }));
  });

  it("requires project v5 when HUD is authored or bound", () => {
    const result = relevant(validateProjectSchemas(files({ projectVersion: 4 })));
    expect(result).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "project",
      fieldPath: "schemaVersion",
      message: expect.stringMatching(/HUD|schema v?5/i)
    }));
  });

  it("structurally validates an authored unbound catalog without activating a custom shell", () => {
    const invalidHud = hudCatalog();
    invalidHud.executable = "javascript:alert(1)";
    const unbound = files({ hud: invalidHud, targets: buildTargets() });
    expect(relevant(validateProjectSchemas(unbound))).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "hud",
      fieldPath: expect.stringMatching(/executable|root/)
    }));

    const validUnbound = files({ targets: buildTargets() });
    expect(relevant(validateProjectSchemas(validUnbound))).toEqual([]);
    expect(normalizeProjectFiles(validUnbound).buildTargets.targets["desktop-web"])
      .not.toHaveProperty("hudProfileId");
  });

  it("keeps the strict legacy matrix inactive for missing, unbound and BuildTargets-v1 projects", () => {
    const missing = files({ hud: undefined, hudAuthored: false, targets: buildTargets() });
    expect(relevant(validateProjectSchemas(missing))).toEqual([]);

    const v1Targets = {
      schemaVersion: 1,
      defaults: { web: "legacy-web" },
      targets: {
        "legacy-web": { id: "legacy-web", platform: "web", renderer: "canvas", webDir: "dist-legacy" }
      }
    };
    const legacy = files({ projectVersion: 4, hud: undefined, hudAuthored: false, targets: v1Targets });
    expect(relevant(validateProjectSchemas(legacy))).toEqual([]);
    const normalized = normalizeProjectFiles(legacy);
    expect(normalized.hud).toBeUndefined();
    expect(normalized.hudAuthored).toBe(false);
    expect(normalized.buildTargets.schemaVersion).toBe(1);
  });

  it("rejects malformed, future and symbol-bearing authored catalogs without invoking accessors", () => {
    const future = hudCatalog();
    future.schemaVersion = 2;
    expect(relevant(validateProjectSchemas(files({ hud: future })))).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "hud",
      fieldPath: "schemaVersion"
    }));

    const symbolCatalog = hudCatalog();
    symbolCatalog[Symbol("hidden")] = true;
    expect(relevant(validateProjectSchemas(files({ hud: symbolCatalog })))).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "hud"
    }));

    const accessorCatalog = hudCatalog();
    let reads = 0;
    Object.defineProperty(accessorCatalog.profiles.main, "label", {
      enumerable: true,
      get() { reads += 1; return "unsafe"; }
    });
    expect(() => validateProjectSchemas(files({ hud: accessorCatalog }))).not.toThrow();
    expect(reads).toBe(0);
    expect(relevant(validateProjectSchemas(files({ hud: accessorCatalog })))).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "hud"
    }));
  });
});
