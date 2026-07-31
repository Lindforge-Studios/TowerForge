import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const repoRoot = path.resolve(".");
const projects = [];

afterEach(() => {
  for (const projectDir of projects.splice(0)) fs.rmSync(projectDir, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r13-weather-"));
  projects.push(projectDir);
  fs.cpSync(path.resolve("examples/starter.tdproj"), projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function tool(name) {
  const value = TOOLS.find((entry) => entry.name === name);
  expect(value, `${name} must be registered`).toBeDefined();
  return value;
}

async function rejection(promise) {
  try {
    await promise;
    throw new Error("Expected operation to reject.");
  } catch (error) {
    return error;
  }
}

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

describe("R13.5c Weather constructor surfaces (RED)", () => {
  it("describes Weather v1 and exposes only the guarded single-module preview/apply workflow", async () => {
    const described = await callTool("describe_schema", { domain: "weather" }, {});
    expect(described).toMatchObject({
      requestedDomain: "weather",
      weather: {
        authoring: { moduleId: "weather", schemaVersion: 1 },
        snapshot: { field: "weather", optional: true, supportedSchemaVersions: [1] },
        events: ["weatherStarted", "weatherEnded", "weatherEffectApplied", "weatherBudgetExceeded"]
      }
    });
    expect(tool("preview_mechanics_module")).toMatchObject({
      riskClass: expect.stringMatching(/compute_only|read_only/), sideEffect: "none",
      inputSchema: { additionalProperties: false, required: expect.arrayContaining(["moduleId"]) }
    });
    expect(tool("apply_mechanics_module")).toMatchObject({
      riskClass: "write_local",
      sideEffect: expect.stringMatching(/revision.*validation.*backup.*rollback/i),
      inputSchema: { additionalProperties: false, required: expect.arrayContaining(["moduleId", "ifRevision"]) }
    });
    expect(TOOLS.map((entry) => entry.name)).not.toContain("write_weather");
  }, 30_000);

  it("ships three inert Blizzard, Acid Rain and Sandstorm recipes", async () => {
    const projectDir = fixture();
    const ids = ["basic_blizzard_weather", "basic_acid_rain_weather", "basic_sandstorm_weather"];
    const recipes = [];
    for (const recipeId of ids) {
      const result = await callTool("get_recipe", { projectDir, collection: "mechanics", recipeId }, {});
      expect(result.recipe).toMatchObject({
        id: recipeId,
        moduleId: "weather",
        entity: {
          moduleId: "weather", moduleSchemaVersion: 1,
          missionId: "tutorial_01", profileId: recipeId,
          profile: { zones: expect.any(Object), definitions: expect.any(Object), schedule: expect.any(Object) }
        }
      });
      expect(result.recipe.entity).not.toHaveProperty("enabled");
      recipes.push(result.recipe.entity.profile);
    }
    const authoredKinds = recipes.flatMap((profile) => Object.values(profile.definitions)
      .flatMap((definition) => Object.values(definition.effects).map((effect) => effect.kind)));
    expect(authoredKinds).toEqual(expect.arrayContaining([
      "periodic_damage", "status", "visibility_range", "enemy_speed", "tower_fire_rate"
    ]));
  }, 30_000);

  it("previews, applies, validates and stale-revision rejects one explicitly enabled recipe", async () => {
    const projectDir = fixture();
    const materialized = await callTool("get_recipe", {
      projectDir, collection: "mechanics", recipeId: "basic_blizzard_weather"
    }, {});
    const request = { projectDir, ...materialized.recipe.entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({ ok: true, written: false, revision: expect.any(String) });
    const applied = await callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({
      ok: true, written: true,
      backup: { directory: expect.stringMatching(/^\.towerforge\/backups\//) }
    });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });
    fs.appendFileSync(path.join(projectDir, "content", "balance.json"), " ", "utf8");
    expect(await rejection(callTool("apply_mechanics_module", {
      ...request, ifRevision: preview.revision
    }, {}))).toMatchObject({ code: "conflict" });
  }, 30_000);

  it("keeps Weather in its own Mechanics Hub editor with guarded lifecycle and future read-only state", () => {
    const html = read("packages/studio/public/index.html");
    const app = read("packages/studio/public/app.js");
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    for (const id of [
      "mechanics-weather-editor", "mechanics-weather-zone-rows",
      "mechanics-weather-definition-rows", "mechanics-weather-schedule-rows"
    ]) expect(hub, id).toContain(`id="${id}"`);
    const render = functionSource(app, "renderWeatherMechanicsEditor");
    for (const token of [
      "all_map", "tiles", "periodic_damage", "status", "visibility_range",
      "enemy_speed", "tower_fire_rate", "calmWeight", "choices"
    ]) expect(render).toContain(token);
    expect(`${render}\n${functionSource(app, "mechanicsRequest")}`).toMatch(/weather[\s\S]*schemaVersion[\s\S]*(?:future|read.?only)/i);
    const apply = functionSource(app, "applyMechanics");
    expect(apply).toMatch(/previewMechanics\(requestSnapshot\)[\s\S]*ifRevision[\s\S]*await\s+load\(\)/);
    expect(app).toMatch(/weather[\s\S]*(?:applyMechanics\(true\)|enable)[\s\S]*(?:applyMechanics\(false\)|disable)/i);
  });

  it("uses one fail-closed snapshot projector in Canvas and Phaser without renderer-owned rules", async () => {
    const Renderer = await import("../renderer/src/weather-presentation.mjs");
    const projector = Renderer.projectWeatherPresentation;
    expect(projector).toBeTypeOf("function");
    const snapshot = {
      weather: {
        schemaVersion: 1, profileId: "storm_field",
        active: {
          waveIndex: 0, choiceId: "blizzard", weatherId: "blizzard", zoneId: "gate",
          zone: { kind: "tiles", tiles: [{ q: 1, r: 1 }] }, elapsedUnits: 0.2
        }
      }
    };
    expect(projector(snapshot)).toMatchObject({ active: true, weatherId: "blizzard", zoneId: "gate" });
    expect(projector({ weather: { ...snapshot.weather, schemaVersion: 2 } })).toMatchObject({ active: false });
    expect(projector({ weather: { ...snapshot.weather, profileId: " bad" } })).toMatchObject({ active: false });

    const source = read("packages/renderer/src/weather-presentation.mjs");
    const canvas = read("packages/renderer/src/index.mjs");
    const phaser = read("packages/cli/build.mjs");
    expect(canvas).toMatch(/projectWeatherPresentation\s*\(snapshot\)/);
    expect(phaser).toMatch(/projectWeatherPresentation\s*\((?:presentationSnapshot|snap)\)/);
    expect(source).not.toMatch(/DamageResolver|TowerDefenseGame|content\.mechanics|Math\.random|enemySpeed|fireRate|rangeMultiplier/);
  });

  it("documents one complete opt-in fixture and leaves the canonical starter Weather-free", () => {
    expect(fs.existsSync(path.resolve("examples/starter.tdproj/content/mechanics.json"))).toBe(false);
    const fixtureRoot = "docs/examples/opt-in-weather";
    for (const file of ["README.md", "mechanics.json", "mission-selection.json"]) {
      expect(fs.existsSync(path.resolve(fixtureRoot, file)), file).toBe(true);
    }
    const docs = [
      `${fixtureRoot}/README.md`, "docs/ROADMAP.md", "docs/runbook.md",
      "docs/adr/0054-r13-deterministic-2-5d-ballistics.md", "packages/mcp/agent-instructions.mjs"
    ].map(read).join("\n");
    for (const marker of [
      "R13.5", "basic_blizzard_weather", "basic_acid_rain_weather", "basic_sandstorm_weather",
      "snapshot.weather", "weatherStarted", "weatherEnded", "weatherEffectApplied",
      "preview_mechanics_module", "apply_mechanics_module", "ifRevision", "backup", "rollback",
      "disabled", "unselected", "Canvas", "Phaser"
    ]) expect(docs, marker).toContain(marker);
    expect(docs).toMatch(/weather[\s\S]*(?:separate|independent)[\s\S]*(?:RNG|random)/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/Weather[\s\S]*describe_schema[\s\S]*get_recipe[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module/i);
  });
});
