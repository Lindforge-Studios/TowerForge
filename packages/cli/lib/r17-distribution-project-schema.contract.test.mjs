import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectFiles, readRawProjectFiles } from "./project-loader.mjs";
import {
  PROJECT_SCHEMA_VERSION,
  normalizeVisuals,
  validateProjectSchemas
} from "./project-schema.mjs";

const tempProjects = [];

afterEach(() => {
  for (const projectDir of tempProjects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function distributionConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    projectId: "tfp_0123456789abcdef0123456789abcdef",
    license: { spdxId: "ARR", attribution: "TowerForge project author" },
    remix: { policy: "forbidden", includeSource: false },
    ...overrides
  };
}

function schemaFiles(schemaVersion, distribution) {
  return {
    manifest: { schemaVersion },
    balance: { missions: {} },
    maps: {},
    mapSources: {},
    mechanics: undefined,
    distribution,
    visuals: normalizeVisuals({}),
    storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
    battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
    buildTargets: { schemaVersion: 1, targets: {} }
  };
}

function projectFixture({ schemaVersion = 4, distribution } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r17-distribution-"));
  tempProjects.push(projectDir);
  fs.writeFileSync(path.join(projectDir, "project.json"), `${JSON.stringify({
    schemaVersion,
    name: "Distribution contract"
  }, null, 2)}\n`, "utf8");
  if (distribution !== undefined) {
    fs.mkdirSync(path.join(projectDir, "content"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "content", "distribution.json"), `${JSON.stringify(distribution, null, 2)}\n`, "utf8");
  }
  return projectDir;
}

describe("R17.1a project schema v4 distribution boundary (RED)", () => {
  it("raises the current project schema to v4 while preserving absent v1-v3 projects", () => {
    expect(PROJECT_SCHEMA_VERSION).toBe(4);
    for (const schemaVersion of [1, 2, 3, 4]) {
      const result = validateProjectSchemas(schemaFiles(schemaVersion, undefined));
      expect(result.issues.some((issue) => issue.entityKind === "distribution"), `schema v${schemaVersion}`).toBe(false);
      expect(result.issues.some((issue) => issue.entityKind === "project" && issue.fieldPath === "schemaVersion"), `schema v${schemaVersion}`).toBe(false);
    }
  });

  it("requires project schema v4 only when content/distribution.json is authored", () => {
    for (const schemaVersion of [1, 2, 3]) {
      const legacyResult = validateProjectSchemas(schemaFiles(schemaVersion, distributionConfig()));
      expect(legacyResult.ok).toBe(false);
      expect(legacyResult.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        entityKind: "project",
        fieldPath: "schemaVersion",
        message: expect.stringMatching(/distribution|schema.*4|v4/i)
      }));
    }

    const current = validateProjectSchemas(schemaFiles(4, distributionConfig()));
    expect(current.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("loads the optional authored file and keeps an absent project distribution-free", () => {
    const authoredDir = projectFixture({ distribution: distributionConfig() });
    expect(readRawProjectFiles(authoredDir).distribution).toEqual(distributionConfig());
    expect(loadProjectFiles(authoredDir)).toMatchObject({
      distribution: distributionConfig(),
      distributionAuthored: true
    });

    const legacyDir = projectFixture({ schemaVersion: 3 });
    expect(readRawProjectFiles(legacyDir).distribution).toBeUndefined();
    const legacy = loadProjectFiles(legacyDir);
    expect(legacy.distribution).toBeUndefined();
    expect(legacy.distributionAuthored).toBe(false);
  });

  it("rejects future, malformed and closed-data violations at content/distribution.json", () => {
    const cases = [
      distributionConfig({ schemaVersion: 2 }),
      distributionConfig({ projectId: "bad" }),
      distributionConfig({ unknown: true })
    ];
    for (const distribution of cases) {
      const result = validateProjectSchemas(schemaFiles(4, distribution));
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        entityKind: "distribution",
        entityId: "content/distribution.json"
      }));
    }
  });
});
