import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r51a-heroes-mcp-"));
  projects.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject.");
}

describe("R5.1A MCP/AI static hero authoring", () => {
  it("describes the closed roster, optional snapshot, and explicitly deferred runtime surfaces", async () => {
    const heroes = await callTool("describe_schema", { domain: "heroes" }, {});
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});

    expect(heroes).toMatchObject({
      requestedDomain: "heroes",
      heroes: {
        authoring: {
          moduleId: "heroes",
          schemaVersion: 1,
          supportedModuleSchemaVersions: [1],
          limits: { definitions: 32, idUtf8Bytes: 128, labelUtf8Bytes: 128 }
        },
        snapshot: { field: "heroes", optional: true, supportedSchemaVersions: [1] },
        events: []
      }
    });
    expect(heroes.availableDomains).toContain("heroes");
    expect(heroes.heroes).not.toHaveProperty("commands");
    expect(heroes.heroes).not.toHaveProperty("towerScript");
    expect(mechanics.mechanics.implementedModuleIds).toContain("heroes");
    expect(mechanics.mechanics.modules.heroes).toEqual(heroes.heroes);
    expect(TOOLS.map((tool) => tool.name)).not.toContain("analyze_heroes");
  });

  it("runs describe -> read -> recipe -> preview -> guarded apply -> validate", async () => {
    const projectDir = fixture();
    const described = await callTool("describe_schema", { domain: "heroes" }, {});
    expect(described.heroes.authoring.moduleId).toBe("heroes");

    const before = await callTool("get_capabilities", {
      projectDir,
      missionId: "tutorial_01"
    }, {});
    expect(before.capabilities.heroes).toMatchObject({
      available: true, active: false, reason: "module_missing"
    });

    const materialized = await callTool("get_recipe", {
      projectDir,
      collection: "mechanics",
      recipeId: "basic_commander_hero"
    }, {});
    expect(materialized.recipe).toMatchObject({
      id: "basic_commander_hero",
      moduleId: "heroes",
      moduleSchemaVersion: 1,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 1,
        missionId: "tutorial_01",
        profileId: "basic_commander_hero",
        profile: {
          selectedHeroId: "commander",
          definitions: { commander: { label: "Commander", spawn: "core" } }
        }
      }
    });

    const request = {
      projectDir,
      ...materialized.recipe.entity,
      enabled: true
    };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      revision: materialized.revision,
      validation: { ok: true, issues: [] },
      candidate: {
        manifest: { schemaVersion: 3 },
        mechanics: { modules: { heroes: { schemaVersion: 1, enabled: true } } },
        balance: {
          missions: {
            tutorial_01: { mechanics: { profiles: { heroes: "basic_commander_hero" } } }
          }
        }
      }
    });

    const applied = await callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {});
    expect(applied).toMatchObject({ ok: true, previousRevision: preview.revision });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    expect(await callTool("get_capabilities", {
      projectDir,
      missionId: "tutorial_01"
    }, {})).toMatchObject({
      capabilities: {
        heroes: {
          available: true,
          active: true,
          moduleSchemaVersion: 1,
          profileId: "basic_commander_hero"
        }
      }
    });

    const stale = await rejection(callTool("apply_mechanics_module", {
      ...request,
      ifRevision: preview.revision
    }, {}));
    expect(stale).toMatchObject({ code: "conflict" });
  });

  it("rejects inherited __proto__ as a sprite definition instead of accepting Object.prototype", async () => {
    const projectDir = fixture();
    await applyHeroesProfile(projectDir, "commanders", {
      selectedHeroId: "commander",
      definitions: { commander: { label: "Commander", spawn: "core" } }
    });
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const before = fs.readFileSync(visualsPath, "utf8");

    const error = await rejection(callTool("bind_sprite", {
      projectDir,
      kind: "heroes",
      entityId: "commander",
      spriteId: "__proto__"
    }, {}));
    expect(error).toMatchObject({ message: expect.stringMatching(/sprite|not found|unknown/i) });
    expect(fs.readFileSync(visualsPath, "utf8")).toBe(before);
  });

  it("round-trips own __proto__ hero and sprite IDs through bind and own-safe removal", async () => {
    const projectDir = fixture();
    const profile = JSON.parse(`{
      "selectedHeroId": "__proto__",
      "definitions": {
        "__proto__": { "label": "Prototype Warden", "spawn": "core" }
      }
    }`);
    await applyHeroesProfile(projectDir, "prototype_commanders", profile);

    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const visuals = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
    Object.defineProperty(visuals.sprites, "__proto__", {
      value: { src: "assets/prototype-warden.png" },
      enumerable: true,
      configurable: true,
      writable: true
    });
    fs.writeFileSync(visualsPath, `${JSON.stringify(visuals, null, 2)}\n`, "utf8");

    const bound = await callTool("bind_sprite", {
      projectDir,
      kind: "heroes",
      entityId: "__proto__",
      spriteId: "__proto__"
    }, {});
    expect(bound).toMatchObject({ ok: true, written: true });
    let persisted = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
    expect(Object.hasOwn(persisted.sprites, "__proto__")).toBe(true);
    expect(Object.hasOwn(persisted.bindings, "heroes")).toBe(true);
    expect(Object.hasOwn(persisted.bindings.heroes, "__proto__")).toBe(true);
    expect(persisted.bindings.heroes.__proto__).toBe("__proto__");

    const removed = await callTool("bind_sprite", {
      projectDir,
      kind: "heroes",
      entityId: "__proto__",
      spriteId: "",
      ifRevision: bound.revision
    }, {});
    expect(removed).toMatchObject({ ok: true, written: true });
    persisted = JSON.parse(fs.readFileSync(visualsPath, "utf8"));
    expect(Object.hasOwn(persisted.bindings.heroes, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(persisted.bindings.heroes)).toBe(Object.prototype);
  });
});

async function applyHeroesProfile(projectDir, profileId, profile) {
  const request = {
    projectDir,
    moduleId: "heroes",
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    enabled: true,
    profileId,
    profile
  };
  const preview = await callTool("preview_mechanics_module", request, {});
  expect(preview).toMatchObject({ ok: true, dryRun: true });
  const applied = await callTool("apply_mechanics_module", {
    ...request,
    ifRevision: preview.revision
  }, {});
  expect(applied).toMatchObject({ ok: true });
  return applied;
}
