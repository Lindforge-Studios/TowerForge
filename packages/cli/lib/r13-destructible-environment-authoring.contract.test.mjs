import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeMechanicsRecipe } from "./mechanics-recipes.mjs";
import { compileMapSources } from "./map-compiler.mjs";
import { migrateProjectFiles, writeMigratedProjectFiles } from "./project-migrations.mjs";
import { readRawProjectFiles } from "./project-loader.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const MODULE_PATH = "./destructible-environment-authoring.mjs";
const projects = [];
const TRANSACTION_FILES = [
  "project.json", "content/mechanics.json", "content/balance.json",
  "maps/src/tutorial_map.tmj", "maps/compiled/maps.json"
];
const definition = Object.freeze({
  maxHp: 50,
  hitRegion: Object.freeze({ kind: "tile", blockerHeight: 1, blocksLineOfSight: false })
});

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

async function api() {
  let loaded = {};
  try {
    loaded = await import(MODULE_PATH);
  } catch {
    // Expected pre-production RED: keep every transaction contract visible.
  }
  expect(loaded.previewDestructibleEnvironment, "narrow destructible preview API").toBeTypeOf("function");
  expect(loaded.applyDestructibleEnvironment, "narrow destructible guarded apply API").toBeTypeOf("function");
  return loaded;
}

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r13-destructible-authoring-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function bytes(projectDir) {
  return Object.fromEntries(TRANSACTION_FILES.map((relativePath) => {
    const filePath = path.join(projectDir, relativePath);
    return [relativePath, fs.existsSync(filePath) ? fs.readFileSync(filePath).toString("base64") : null];
  }));
}

function request(overrides = {}) {
  return {
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    profileId: "destructible_environment",
    mapId: "tutorial_map",
    enabled: true,
    profile: {
      projectiles: {
        towers: {},
        destructibles: { definitions: { basic_crate: definition } }
      }
    },
    placements: [{
      id: "basic_crate_1", definitionId: "basic_crate", coord: { q: 6, r: 2 }
    }],
    ...overrides
  };
}

describe("R13.4d1 guarded destructible environment authoring (RED)", () => {
  it("previews the exact mechanics, mission and map candidate without changing any source byte", async () => {
    const projectDir = fixture();
    const before = bytes(projectDir);
    const authoring = await api();
    const preview = await authoring.previewDestructibleEnvironment(projectDir, request());

    expect(preview).toMatchObject({
      ok: true, dryRun: true, written: false, revision: expect.any(String),
      validation: { ok: true, issues: [] },
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: {
          modules: {
            ballistics: {
              schemaVersion: 1, enabled: true,
              profiles: { destructible_environment: request().profile }
            }
          }
        },
        balance: {
          missions: {
            tutorial_01: { mechanics: { profiles: { ballistics: "destructible_environment" } } }
          }
        },
        mapSource: {
          id: "tutorial_map",
          destructibleObjects: [{
            id: "basic_crate_1", definitionId: "basic_crate", coord: { q: 6, r: 2 }
          }]
        },
        compiledMaps: {
          tutorial_map: {
            destructibleObjects: [{
              id: "basic_crate_1", definitionId: "basic_crate", coord: { q: 6, r: 2 }
            }]
          }
        }
      }
    });
    expect(bytes(projectDir)).toEqual(before);
  });

  it("applies only by preview revision with five-file backup, rejects stale reuse and rolls back replacement failure", async () => {
    const authoring = await api();
    const projectDir = fixture();
    const preview = await authoring.previewDestructibleEnvironment(projectDir, request());
    const applied = await authoring.applyDestructibleEnvironment(projectDir, {
      ...request(), ifRevision: preview.revision
    });
    expect(applied).toMatchObject({
      ok: true, written: true, rolledBack: false, previousRevision: preview.revision,
      backup: { directory: expect.any(String), files: expect.any(Object) }
    });
    expect(Object.keys(applied.backup.files).sort()).toEqual([...TRANSACTION_FILES].sort());
    expect(await authoring.applyDestructibleEnvironment(projectDir, {
      ...request(), ifRevision: preview.revision
    })).toMatchObject({ ok: false, conflict: true, written: false });

    const rollbackDir = fixture();
    const before = bytes(rollbackDir);
    const rollbackPreview = await authoring.previewDestructibleEnvironment(rollbackDir, request());
    await expect(authoring.applyDestructibleEnvironment(rollbackDir, {
      ...request(), ifRevision: rollbackPreview.revision
    }, {
      afterFileReplace(relativePath) {
        if (relativePath === "maps/src/tutorial_map.tmj") throw new Error("SYNTHETIC_DESTRUCTIBLE_WRITE_FAILURE");
      }
    })).rejects.toThrow(/SYNTHETIC_DESTRUCTIBLE_WRITE_FAILURE/);
    expect(bytes(rollbackDir)).toEqual(before);
  }, 30_000);

  it("fails malformed cross-references and traversal closed without writes or outside-project access", async () => {
    const authoring = await api();
    const cases = [
      request({ placements: [{ id: "crate", definitionId: "missing", coord: { q: 6, r: 2 } }] }),
      request({ placements: [{ id: "crate", definitionId: "basic_crate", coord: { q: -1, r: 2 } }] }),
      request({ mapId: "../tutorial_map" })
    ];
    for (const candidate of cases) {
      const projectDir = fixture();
      const before = bytes(projectDir);
      const preview = await authoring.previewDestructibleEnvironment(projectDir, candidate);
      expect(preview).toMatchObject({ ok: false, written: false });
      expect(preview.validation.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: expect.stringMatching(/invalid|missing|unsafe|traversal|reference/) })
      ]));
      expect(bytes(projectDir)).toEqual(before);
    }
  });

  it("materializes basic_destructible_environment as a project-bound but placement-inert recipe", () => {
    const recipe = materializeMechanicsRecipe("basic_destructible_environment", {
      missionIds: ["tutorial_01"], mapIds: ["tutorial_map"], defaultMissionId: "tutorial_01"
    });
    expect(recipe).toMatchObject({
      id: "basic_destructible_environment",
      moduleId: "ballistics",
      moduleSchemaVersion: 1,
      authoringTool: "preview_destructible_environment",
      entity: {
        moduleSchemaVersion: 1,
        missionId: "tutorial_01",
        mapId: "tutorial_map",
        profileId: "basic_destructible_environment",
        profile: {
          projectiles: {
            towers: {},
            destructibles: { definitions: { basic_crate: definition } }
          }
        },
        placements: []
      }
    });
    expect(recipe.entity).not.toHaveProperty("enabled");
    expect(JSON.stringify(recipe.entity.placements)).not.toMatch(/"q"|"r"/);
  });

  it("rejects accessor, proxy-get and non-plain requests without executing hostile code or writing", async () => {
    const authoring = await api();
    const projectDir = fixture();
    const before = bytes(projectDir);
    let reads = 0;

    const accessor = request();
    Object.defineProperty(accessor, "mapId", {
      enumerable: true,
      get() { reads += 1; throw new Error("HOSTILE_REQUEST_GETTER"); }
    });
    const proxied = new Proxy(request(), {
      get(target, key, receiver) {
        reads += 1;
        return Reflect.get(target, key, receiver);
      }
    });
    class RequestRecord { constructor() { Object.assign(this, request()); } }

    for (const candidate of [accessor, proxied, new RequestRecord()]) {
      await expect(authoring.previewDestructibleEnvironment(projectDir, candidate)).resolves.toMatchObject({
        ok: false, written: false,
        validation: { issues: expect.arrayContaining([
          expect.objectContaining({ code: expect.stringMatching(/input_unsafe|request_invalid|plain_data/) })
        ]) }
      });
    }
    expect(reads).toBe(0);
    expect(bytes(projectDir)).toEqual(before);
  });

  it("invalidates preview revision when any map source participating in compilation changes", async () => {
    const authoring = await api();
    const projectDir = fixture();
    const tutorialPath = path.join(projectDir, "maps", "src", "tutorial_map.tmj");
    const otherPath = path.join(projectDir, "maps", "src", "other.tmj");
    const tutorial = JSON.parse(fs.readFileSync(tutorialPath, "utf8"));
    const other = structuredClone(tutorial);
    other.id = "other";
    const idProperty = other.properties.find((entry) => entry.name === "id");
    if (idProperty) idProperty.value = "other";
    fs.writeFileSync(otherPath, `${JSON.stringify(other, null, 2)}\n`, "utf8");

    const balance = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    const compiled = compileMapSources({
      "tutorial_map.tmj": tutorial,
      "other.tmj": other
    }, balance.terrainTypes ?? {});
    expect(compiled.ok).toBe(true);
    fs.writeFileSync(
      path.join(projectDir, "maps", "compiled", "maps.json"),
      `${JSON.stringify(compiled.maps, null, 2)}\n`,
      "utf8"
    );

    const preview = await authoring.previewDestructibleEnvironment(projectDir, request());
    expect(preview).toMatchObject({ ok: true, written: false, revision: expect.any(String) });
    other.label = "changed after preview";
    fs.writeFileSync(otherPath, `${JSON.stringify(other, null, 2)}\n`, "utf8");
    const beforeApply = bytes(projectDir);

    expect(await authoring.applyDestructibleEnvironment(projectDir, {
      ...request(), ifRevision: preview.revision
    })).toMatchObject({ ok: false, conflict: true, written: false });
    expect(bytes(projectDir)).toEqual(beforeApply);
  }, 30_000);
});
