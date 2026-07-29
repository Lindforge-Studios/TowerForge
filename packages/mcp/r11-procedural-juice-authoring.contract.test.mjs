import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const roots = [];
const STARTER = path.resolve("examples/starter.tdproj");

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r11-mcp-"));
  roots.push(projectDir);
  fs.cpSync(STARTER, projectDir, { recursive: true });
  return projectDir;
}

function tool(name) {
  return TOOLS.find((entry) => entry.name === name);
}

describe("R11 procedural juice MCP/AI contract (RED)", () => {
  it("documents the complete guarded visuals-only workflow in the exported plugin skill", () => {
    const skill = fs.readFileSync(path.resolve("plugins/towerforge/skills/towerforge-authoring/SKILL.md"), "utf8");
    expect(skill).toMatch(/Procedural Juice[\s\S]*describe_schema[\s\S]*proceduralJuice[\s\S]*get_procedural_juice[\s\S]*get_procedural_juice_recipe[\s\S]*preview_procedural_juice[\s\S]*apply_procedural_juice[\s\S]*ifRevision[\s\S]*validate_project/i);
    expect(skill).toMatch(/compute-only[\s\S]*preview_procedural_juice_event/i);
    expect(skill).toMatch(/visuals-only[\s\S]*never[\s\S]*content\/mechanics\.json/i);
  });

  it("describes the visuals-only opt-in schema, budgets, recipes, and guarded workflow", async () => {
    const result = await callTool("describe_schema", { domain: "proceduralJuice" }, {});
    expect(result).toMatchObject({
      requestedDomain: "proceduralJuice",
      availableDomains: expect.arrayContaining(["proceduralJuice"]),
      proceduralJuice: {
        schemaVersion: 1,
        visualsSchemaVersion: 3,
        activation: "content/visuals.json.proceduralJuice",
        mechanicsRequired: false,
        deterministic: true,
        presentationOnly: true,
        budgets: expect.any(Object),
        tools: {
          read: "get_procedural_juice",
          recipe: "get_procedural_juice_recipe",
          preview: "preview_procedural_juice",
          apply: "apply_procedural_juice",
          eventPreview: "preview_procedural_juice_event"
        }
      }
    });
  });

  it("advertises narrow closed tools with explicit risk metadata", () => {
    expect(tool("get_procedural_juice")).toMatchObject({ riskClass: "read_only", sideEffect: "none" });
    expect(tool("get_procedural_juice_recipe")).toMatchObject({ riskClass: "read_only", sideEffect: "none" });
    expect(tool("preview_procedural_juice")).toMatchObject({
      riskClass: "compute_only",
      sideEffect: expect.stringMatching(/writes no project files/i),
      inputSchema: expect.objectContaining({ additionalProperties: false })
    });
    expect(tool("preview_procedural_juice_event")).toMatchObject({
      riskClass: "compute_only",
      sideEffect: expect.stringMatching(/writes no project files/i),
      inputSchema: expect.objectContaining({ additionalProperties: false })
    });
    expect(tool("preview_procedural_juice_event").inputSchema.properties.event.properties.type.enum)
      .toEqual(expect.arrayContaining(["enemyHit", "heroAbilityUsed", "objectiveCompleted"]));
    expect(tool("apply_procedural_juice")).toMatchObject({
      riskClass: "write_local",
      sideEffect: expect.stringMatching(/revision guard[\s\S]*validation[\s\S]*backup[\s\S]*rollback/i),
      inputSchema: {
        type: "object",
        properties: expect.objectContaining({ ifRevision: expect.any(Object), proceduralJuice: expect.any(Object) }),
        required: ["proceduralJuice", "ifRevision"],
        additionalProperties: false
      }
    });
  });

  it("runs describe -> detached recipe -> read -> preview -> guarded apply -> validate -> remove", async () => {
    const projectDir = fixture();
    const before = await callTool("get_procedural_juice", { projectDir }, {});
    expect(before).toMatchObject({ authored: false, active: false, revision: expect.any(String) });
    const recipe = await callTool("get_procedural_juice_recipe", {
      recipeId: "impact_feedback",
      missionIds: ["tutorial_01"]
    }, {});
    const request = { projectDir, proceduralJuice: recipe.proceduralJuice };
    const preview = await callTool("preview_procedural_juice", request, {});
    expect(preview).toMatchObject({ ok: true, dryRun: true, written: false, revision: before.revision });
    const applied = await callTool("apply_procedural_juice", { ...request, ifRevision: preview.revision }, {});
    expect(applied).toMatchObject({ ok: true, written: true, previousRevision: preview.revision });
    await expect(callTool("apply_procedural_juice", { ...request, ifRevision: preview.revision }, {}))
      .rejects.toThrow(/revision|stale|changed|conflict/i);
    expect(await callTool("validate_project", { projectDir }, {})).toMatchObject({ ok: true });

    const disablePreview = await callTool("preview_procedural_juice", { projectDir, proceduralJuice: null }, {});
    const disabled = await callTool("apply_procedural_juice", {
      projectDir,
      proceduralJuice: null,
      ifRevision: disablePreview.revision
    }, {});
    expect(disabled).toMatchObject({ ok: true, written: true });
    expect(await callTool("get_procedural_juice", { projectDir }, {})).toMatchObject({ authored: false, active: false });
  });

  it("previews one event through the deterministic shared renderer projector without writes", async () => {
    const projectDir = fixture();
    const recipe = await callTool("get_procedural_juice_recipe", {
      recipeId: "impact_feedback",
      missionIds: ["tutorial_01"]
    }, {});
    const preview = await callTool("preview_procedural_juice", { projectDir, proceduralJuice: recipe.proceduralJuice }, {});
    await callTool("apply_procedural_juice", {
      projectDir,
      proceduralJuice: recipe.proceduralJuice,
      ifRevision: preview.revision
    }, {});
    const before = fs.readFileSync(path.join(projectDir, "content", "visuals.json"));
    const request = {
      projectDir,
      missionId: "tutorial_01",
      missionElapsed: 12.5,
      originCoord: { q: 2, r: 3 },
      event: { type: "enemyHit", enemyId: "enemy-1", enemyTypeId: "basic_grunt", damage: 9 }
    };
    const first = await callTool("preview_procedural_juice_event", request, {});
    const second = await callTool("preview_procedural_juice_event", request, {});
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      active: true,
      projection: {
        active: true,
        particleBursts: [expect.objectContaining({ emitterId: "impact_sparks", origin: { q: 2, r: 3 } })],
        audioCues: [expect.objectContaining({ cueId: "impact_tone", frequencyHz: expect.any(Number) })]
      }
    });
    expect(fs.readFileSync(path.join(projectDir, "content", "visuals.json")).equals(before)).toBe(true);
  });

  it("rejects accessor event payloads without invoking them", async () => {
    const projectDir = fixture();
    let invoked = false;
    const event = { type: "enemyHit" };
    Object.defineProperty(event, "damage", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("must not run");
      }
    });
    await expect(callTool("preview_procedural_juice_event", {
      projectDir,
      missionId: "tutorial_01",
      missionElapsed: 1,
      originCoord: { q: 0, r: 0 },
      event
    }, {})).rejects.toThrow(/own-data|data property|unsafe/i);
    expect(invoked).toBe(false);
  });

  it("rejects oversized event property names before constructing amplified diagnostics", async () => {
    const projectDir = fixture();
    const event = { type: "enemyHit" };
    Object.defineProperty(event, "x".repeat(129), { value: 1, enumerable: true });
    let caught;
    try {
      await callTool("preview_procedural_juice_event", {
        projectDir,
        missionId: "tutorial_01",
        missionElapsed: 1,
        originCoord: { q: 0, r: 0 },
        event
      }, {});
    } catch (error) { caught = error; }
    expect(caught).toBeTruthy();
    expect(caught.code).toMatch(/input_unsafe|budget_exceeded/);
    expect(caught.message.length).toBeLessThan(512);
  });

  it("teaches agents that Procedural Juice is visuals-only, opt-in, and guarded", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBeGreaterThanOrEqual(37);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(
      /Procedural Juice[\s\S]*get_procedural_juice[\s\S]*get_procedural_juice_recipe[\s\S]*preview_procedural_juice[\s\S]*apply_procedural_juice[\s\S]*validate_project/i
    );
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/content\/visuals\.json[\s\S]*(?:does not require|without) content\/mechanics\.json/i);
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toMatch(/preview_procedural_juice_event[\s\S]*(?:compute-only|writes no project files)/i);
  });
});
