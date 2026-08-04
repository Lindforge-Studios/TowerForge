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

function splashCatalog(overrides = {}) {
  return {
    schemaVersion: 1,
    playlists: {
      intro: {
        schemaVersion: 1,
        label: "Studio introduction",
        items: [{
          id: "studio",
          spriteId: "studio_logo",
          accessibleLabel: "Lindforge Studios",
          backgroundColor: "#0b0f0d"
        }]
      }
    },
    ...overrides
  };
}

function visuals(sprite = { src: "assets/splashes/studio-logo.png", mimeType: "image/png" }) {
  const value = defaultVisuals();
  value.sprites.studio_logo = sprite;
  return value;
}

function buildTargets(options = {}) {
  const { splashPlaylistId = "intro", includeBinding = true } = options;
  return {
    schemaVersion: 2,
    defaults: { web: "desktop-web" },
    targets: {
      "desktop-web": {
        id: "desktop-web",
        platform: "web",
        renderer: "canvas",
        webDir: "dist-r22",
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
        quality: "high",
        locale: "ru",
        inputProfile: "keyboard_mouse",
        ...(includeBinding ? { splashPlaylistId } : {})
      }
    }
  };
}

function files({
  splashes = splashCatalog(),
  splashesAuthored = true,
  targets = buildTargets(),
  projectVersion = 5,
  projectVisuals = visuals()
} = {}) {
  return {
    projectDir: "/detached/r22.tdproj",
    manifest: { schemaVersion: projectVersion, name: "R22 contract" },
    balance: { missions: {} },
    maps: {},
    mapSources: {},
    worldMap: { width: 1, height: 1, regions: [], missionNodes: [] },
    mechanics: undefined,
    distribution: undefined,
    hud: undefined,
    hudAuthored: false,
    splashes,
    splashesAuthored,
    visuals: projectVisuals,
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets: targets,
    scripts: {},
    scriptFiles: {},
    scriptIssues: []
  };
}

function relevant(result) {
  return result.issues.filter((issue) => ["splashes", "buildTargets", "project"].includes(issue.entityKind));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function diskProject({ includeSplashes = true, includeBinding = true } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r22-splashes-"));
  tempDirs.push(projectDir);
  writeJson(path.join(projectDir, "project.json"), { schemaVersion: 5, name: "R22 disk" });
  writeJson(path.join(projectDir, "content", "balance.json"), {});
  writeJson(path.join(projectDir, "content", "visuals.json"), visuals());
  writeJson(path.join(projectDir, "build-targets.json"), buildTargets({ includeBinding }));
  if (includeSplashes) writeJson(path.join(projectDir, "content", "splashes.json"), splashCatalog());
  return projectDir;
}

describe("R22.1 optional splash project transport and target binding contract (RED)", () => {
  it("loads content/splashes.json verbatim and carries authored state through normalization", () => {
    const projectDir = diskProject();
    const raw = readRawProjectFiles(projectDir);
    expect(raw.splashes).toEqual(splashCatalog());

    const loaded = loadProjectFiles(projectDir);
    expect(loaded.splashesAuthored).toBe(true);
    expect(loaded.splashes).toEqual(expect.objectContaining({ schemaVersion: 1 }));
    expect(loaded.buildTargets.targets["desktop-web"].splashPlaylistId).toBe("intro");
  });

  it("keeps an absent file and unbound project inactive without synthesizing a catalog", () => {
    const projectDir = diskProject({ includeSplashes: false, includeBinding: false });
    const raw = readRawProjectFiles(projectDir);
    const loaded = loadProjectFiles(projectDir);

    expect(raw.splashes).toBeUndefined();
    expect(loaded.splashes).toBeUndefined();
    expect(loaded.splashesAuthored).toBe(false);
    expect(loaded.buildTargets.targets["desktop-web"]).not.toHaveProperty("splashPlaylistId");
    expect(relevant(validateProjectSchemas(files({
      splashes: undefined,
      splashesAuthored: false,
      targets: buildTargets({ includeBinding: false })
    })))).toEqual([]);
  });

  it("accepts and preserves one valid BuildTargets v2 binding", () => {
    expect(relevant(validateProjectSchemas(files()))).toEqual([]);
    expect(normalizeProjectFiles(files()).buildTargets.targets["desktop-web"].splashPlaylistId).toBe("intro");
  });

  it("rejects missing catalogs, missing playlist references and malformed bounded selector IDs", () => {
    const missingCatalog = relevant(validateProjectSchemas(files({ splashes: undefined, splashesAuthored: false })));
    expect(missingCatalog).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "buildTargets",
      fieldPath: "targets.desktop-web.splashPlaylistId"
    }));

    const missingPlaylist = relevant(validateProjectSchemas(files({ targets: buildTargets({ splashPlaylistId: "missing" }) })));
    expect(missingPlaylist).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: "targets.desktop-web.splashPlaylistId",
      message: expect.stringContaining("missing")
    }));

    for (const splashPlaylistId of ["", "x".repeat(129)]) {
      const result = relevant(validateProjectSchemas(files({ targets: buildTargets({ splashPlaylistId }) })));
      expect(result).toContainEqual(expect.objectContaining({
        severity: "error",
        fieldPath: "targets.desktop-web.splashPlaylistId"
      }));
    }
  });

  it("requires every item to reference a safe standalone PNG, JPEG or WebP sprite", () => {
    const cases = [
      ["missing sprite", defaultVisuals(), /missing sprite/i],
      ["atlas frame", visuals({ atlas: "ui", frame: { x: 0, y: 0, w: 64, h: 64 } }), /standalone/i],
      ["SVG", visuals({ src: "assets/splashes/studio-logo.svg", mimeType: "image/svg+xml" }), /PNG|JPEG|WebP/i],
      ["external URL", visuals({ src: "https://example.com/logo.png", mimeType: "image/png" }), /safe|URL|relative/i],
      ["path traversal", visuals({ src: "../logo.png", mimeType: "image/png" }), /safe|traversal|relative/i]
    ];

    for (const [_label, projectVisuals, message] of cases) {
      const result = validateProjectSchemas(files({ projectVisuals }));
      expect(result.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        fieldPath: "playlists.intro.items.0.spriteId",
        message: expect.stringMatching(message)
      }));
    }
  });

  it("structurally validates authored future and malformed catalogs even while reusable but unbound", () => {
    const future = splashCatalog({ schemaVersion: 2 });
    const futureIssues = relevant(validateProjectSchemas(files({
      splashes: future,
      targets: buildTargets({ includeBinding: false })
    })));
    expect(futureIssues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "splashes",
      fieldPath: "schemaVersion"
    }));

    const malformed = { ...splashCatalog(), executable: "javascript:alert(1)" };
    expect(relevant(validateProjectSchemas(files({
      splashes: malformed,
      targets: buildTargets({ includeBinding: false })
    })))).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "splashes"
    }));
  });

  it("fails closed on accessors without invoking them", () => {
    const value = splashCatalog();
    let reads = 0;
    Object.defineProperty(value.playlists.intro.items[0], "caption", {
      enumerable: true,
      get() {
        reads += 1;
        return "unsafe";
      }
    });

    expect(() => validateProjectSchemas(files({ splashes: value }))).not.toThrow();
    expect(reads).toBe(0);
    expect(relevant(validateProjectSchemas(files({ splashes: value })))).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "splashes"
    }));
  });
});
