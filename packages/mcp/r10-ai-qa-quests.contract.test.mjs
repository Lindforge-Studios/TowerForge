import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../cli/lib/project-migrations.mjs";
import { readRawProjectFiles } from "../cli/lib/project-loader.mjs";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
const PERSONA_IDS = ["aggressive_rush", "greedy_economy", "turtle_shield"];
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r10-mcp-"));
  roots.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  const migration = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migration.files);
  return projectDir;
}

function sourceTree(rootDir) {
  const rows = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => (
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ))) {
      if (entry.name === ".towerforge") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) rows.push([path.relative(rootDir, absolute), fs.readFileSync(absolute).toString("base64")]);
    }
  };
  visit(rootDir);
  return rows;
}

function tool(name) {
  return TOOLS.find((candidate) => candidate.name === name);
}

async function proceduralQuestRecipe(projectDir) {
  const result = await callTool("get_recipe", {
    projectDir,
    collection: "mechanics",
    recipeId: "basic_procedural_quests"
  }, {});
  return result.recipe.entity;
}

async function enableProceduralQuests(projectDir) {
  const entity = await proceduralQuestRecipe(projectDir);
  const request = { projectDir, ...entity, enabled: true };
  const preview = await callTool("preview_mechanics_module", request, {});
  expect(preview).toMatchObject({
    ok: true,
    dryRun: true,
    written: false,
    revision: expect.any(String)
  });
  const applied = await callTool("apply_mechanics_module", {
    ...request,
    ifRevision: preview.revision
  }, {});
  expect(applied).toMatchObject({ ok: true, written: true, rolledBack: false });
  return { entity, request, preview, applied };
}

describe("R10 multi-agent QA and procedural quests MCP contract (RED)", () => {
  it("publishes a dedicated deterministic personaQa schema descriptor", async () => {
    const described = await callTool("describe_schema", { domain: "personaQa" }, {});
    expect(described).toMatchObject({
      requestedDomain: "personaQa",
      availableDomains: expect.arrayContaining(["personaQa"]),
      personaQa: {
        schemaVersion: 1,
        personaIds: PERSONA_IDS,
        deterministic: true,
        tool: "run_persona_qa",
        request: {
          requiredFields: ["missionIds", "seeds", "personaIds", "simSeconds", "tickStep"],
          additionalProperties: false,
          limits: expect.any(Object)
        }
      }
    });
  });

  it("publishes quests authoring, selection, snapshot, and event descriptors through both domains", async () => {
    const described = await callTool("describe_schema", { domain: "quests" }, {});
    expect(described).toMatchObject({
      requestedDomain: "quests",
      availableDomains: expect.arrayContaining(["quests"]),
      quests: {
        authoring: {
          schemaVersion: 1,
          moduleId: "quests",
          supportedModuleSchemaVersions: [1],
          objectiveKinds: ["kill_with_source", "preserve_shield"]
        },
        selection: {
          schemaVersion: 1,
          tool: "preview_quest_generation",
          deterministic: true,
          weightedWithoutReplacement: true,
          activeMissionProfileOnly: true
        },
        snapshot: { field: "quests", optional: true, supportedSchemaVersions: [1] },
        events: ["questCompleted", "questFailed"]
      }
    });
    const mechanics = await callTool("describe_schema", { domain: "mechanics" }, {});
    expect(mechanics.mechanics.modules.quests).toEqual(described.quests);
  });

  it("exposes two bounded compute-only tools with closed schemas and no write or revision fields", () => {
    expect(tool("run_persona_qa")).toMatchObject({
      riskClass: "compute_only",
      sideEffect: expect.stringMatching(/writes no project files/i),
      inputSchema: {
        type: "object",
        properties: {
          projectDir: expect.any(Object),
          missionIds: expect.objectContaining({
            type: "array", minItems: 1, maxItems: expect.any(Number), uniqueItems: true,
            items: expect.objectContaining({ type: "string", minLength: 1, maxLength: 256 })
          }),
          seeds: expect.objectContaining({
            type: "array", minItems: 1, maxItems: expect.any(Number), uniqueItems: true,
            items: expect.objectContaining({ type: "string", minLength: 1, maxLength: 256 })
          }),
          personaIds: expect.objectContaining({
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { type: "string", enum: PERSONA_IDS }
          }),
          simSeconds: expect.objectContaining({ type: "number", minimum: 0.05, maximum: expect.any(Number) }),
          tickStep: expect.objectContaining({ type: "number", minimum: 0.05, maximum: expect.any(Number) })
        },
        required: ["missionIds", "seeds", "personaIds", "simSeconds", "tickStep"],
        additionalProperties: false
      }
    });
    expect(tool("preview_quest_generation")).toMatchObject({
      riskClass: "compute_only",
      sideEffect: expect.stringMatching(/writes no project files/i),
      inputSchema: {
        type: "object",
        properties: {
          projectDir: expect.any(Object),
          missionId: expect.any(Object),
          seed: expect.objectContaining({ oneOf: expect.any(Array) }),
          eligibleDefinitionIds: expect.objectContaining({
            type: "array",
            maxItems: expect.any(Number),
            uniqueItems: true
          })
        },
        required: ["missionId", "seed"],
        additionalProperties: false
      }
    });
    for (const name of ["run_persona_qa", "preview_quest_generation"]) {
      expect(tool(name)?.inputSchema?.properties).not.toHaveProperty("ifRevision");
      expect(tool(name)?.inputSchema?.properties).not.toHaveProperty("commit");
    }
  });

  it("teaches agents the persona evidence flow and inert guarded quest workflow", () => {
    const authoringSkill = fs.readFileSync(
      path.resolve("plugins/towerforge/skills/towerforge-authoring/SKILL.md"),
      "utf8"
    );
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(36);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/run_persona_qa/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/aggressive_rush[\s\S]*greedy_economy[\s\S]*turtle_shield/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/evidence[- ]only|compute[- ]only/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /quests[\s\S]*get_capabilities[\s\S]*basic_procedural_quests[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/preview_quest_generation/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/never (?:auto[- ]?)?(?:enable|commit)|does not (?:auto[- ]?)?(?:enable|commit)/i);
    expect(authoringSkill).toMatch(/run_persona_qa[\s\S]*aggressive_rush[\s\S]*greedy_economy[\s\S]*turtle_shield/i);
    expect(authoringSkill).toMatch(
      /Quests v1[\s\S]*basic_procedural_quests[\s\S]*preview_mechanics_module[\s\S]*apply_mechanics_module[\s\S]*preview_quest_generation/i
    );
  });

  it("runs deterministic persona QA without changing any project source bytes", async () => {
    const projectDir = fixture();
    const before = sourceTree(projectDir);
    const request = {
      projectDir,
      missionIds: ["tutorial_01"],
      seeds: ["seed-b", "seed-a"],
      personaIds: ["turtle_shield", "greedy_economy", "aggressive_rush"],
      simSeconds: 1,
      tickStep: 0.2
    };
    const first = await callTool("run_persona_qa", request, {});
    const repeated = await callTool("run_persona_qa", { ...request, seeds: ["seed-a", "seed-b"] }, {});
    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      status: "completed",
      missionIds: ["tutorial_01"],
      seeds: ["seed-a", "seed-b"],
      personaIds: PERSONA_IDS,
      runs: expect.any(Array)
    });
    expect(first.runs).toHaveLength(6);
    expect(first.runs.every((run) => typeof run.stateDigest === "string")).toBe(true);
    expect(sourceTree(projectDir)).toEqual(before);
  });

  it("materializes an inert quest recipe and uses the existing guarded mechanics transaction", async () => {
    const projectDir = fixture();
    const before = sourceTree(projectDir);
    const recipes = await callTool("list_recipes", { collection: "mechanics" }, {});
    expect(recipes.recipes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "basic_procedural_quests", moduleId: "quests", moduleSchemaVersion: 1 })
    ]));
    const entity = await proceduralQuestRecipe(projectDir);
    expect(entity).toMatchObject({
      moduleId: "quests",
      moduleSchemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "basic_procedural_quests",
      profile: {
        selectionCount: expect.any(Number),
        definitions: expect.any(Object)
      }
    });
    expect(Object.keys(entity.profile.definitions).length).toBeGreaterThan(0);
    expect(sourceTree(projectDir)).toEqual(before);

    const request = { projectDir, ...entity, enabled: true };
    const preview = await callTool("preview_mechanics_module", request, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false, revision: expect.any(String) });
    expect(sourceTree(projectDir)).toEqual(before);
    const applied = await callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({
      ok: true,
      written: true,
      rolledBack: false,
      previousRevision: preview.revision,
      backup: { directory: expect.any(String) }
    });
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true, issues: [] });
    expect(await callTool("get_capabilities", { projectDir, missionId: "tutorial_01" }, {})).toMatchObject({
      capabilities: {
        quests: { available: true, active: true, profileId: "basic_procedural_quests", reason: "active" }
      }
    });

    const afterApply = sourceTree(projectDir);
    await expect(callTool("apply_mechanics_module", { ...request, ifRevision: preview.revision }, {}))
      .rejects.toMatchObject({ code: "conflict" });
    expect(sourceTree(projectDir)).toEqual(afterApply);
  }, 20_000);

  it("previews active-profile quest selection deterministically and fails closed while inactive", async () => {
    const projectDir = fixture();
    const { entity } = await enableProceduralQuests(projectDir);
    const before = sourceTree(projectDir);
    const request = { projectDir, missionId: "tutorial_01", seed: "daily-seed" };
    const first = await callTool("preview_quest_generation", request, {});
    const repeated = await callTool("preview_quest_generation", structuredClone(request), {});
    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      missionId: "tutorial_01",
      profileId: "basic_procedural_quests",
      seed: "daily-seed",
      dryRun: true,
      written: false,
      quests: expect.any(Array)
    });
    expect(first.quests).toHaveLength(entity.profile.selectionCount);
    expect(first.quests.map((entry) => entry.questId)).toEqual(
      first.quests.map((entry) => entry.questId).sort()
    );
    expect(sourceTree(projectDir)).toEqual(before);

    const eligibleDefinitionId = Object.keys(entity.profile.definitions).sort()[0];
    const eligible = await callTool("preview_quest_generation", {
      ...request,
      eligibleDefinitionIds: [eligibleDefinitionId]
    }, {});
    expect(eligible.quests.map((entry) => entry.questId)).toEqual([eligibleDefinitionId]);
    expect(sourceTree(projectDir)).toEqual(before);

    const legacyDir = fixture();
    const legacyBefore = sourceTree(legacyDir);
    await expect(callTool("preview_quest_generation", {
      projectDir: legacyDir,
      missionId: "tutorial_01",
      seed: "inactive-seed"
    }, {})).rejects.toMatchObject({ code: "module_inactive" });
    expect(sourceTree(legacyDir)).toEqual(legacyBefore);
  }, 20_000);
});
