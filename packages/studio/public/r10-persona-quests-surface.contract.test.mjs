import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const server = fs.readFileSync(path.resolve("packages/studio/server.mjs"), "utf8");

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

describe("R10 Studio Persona QA and procedural quest surfaces", () => {
  it("does not reuse the broad applied-state translation suffix for read-only quest help", () => {
    expect(html).not.toContain("Unsaved draft changes are never simulated or applied.");
    expect(html).toContain("This preview never simulates gameplay and never writes unsaved draft changes.");
  });

  it("keeps Persona QA as a read-only lab inside Balance and invalidates evidence by content hash", () => {
    const balanceStart = html.indexOf('<section id="tab-balance"');
    const balanceEnd = html.indexOf('<section id="workbench-drawer"', balanceStart);
    const balance = html.slice(balanceStart, balanceEnd);
    for (const id of [
      "persona-qa-lab", "persona-qa-missions", "persona-qa-seeds", "persona-qa-personas",
      "persona-qa-seconds", "persona-qa-tick-step", "btn-run-persona-qa", "persona-qa-results"
    ]) expect(balance).toContain(`id="${id}"`);
    expect(balance).toMatch(/read-only|evidence-only/i);
    expect(balance).not.toMatch(/apply|save patch|auto(?:matic)? fix/i);

    const run = functionSource(app, "runPersonaQa");
    expect(run).toContain('/api/persona-qa/run');
    expect(run).toMatch(/contentHash\s*:\s*S\.contentHash/);
    expect(run).toMatch(/personaIds/);
    expect(run).not.toMatch(/api\/mechanics\/apply|api\/project\/save|apply_balance/i);
    expect(app).toMatch(/personaQaReportRevision[\s\S]{0,300}S\.contentHash/);
  });

  it("uses a narrow guarded Studio endpoint backed by the compute-only MCP tool", () => {
    expect(server).toMatch(/POST[\s\S]{0,160}\/api\/persona-qa\/run/);
    expect(server).toMatch(/callTool\(\s*["']run_persona_qa["']/);
    expect(server).toMatch(/contentHash[\s\S]{0,260}projectHash\(\)/);
    expect(server).toMatch(/persona-qa[\s\S]{0,1000}(?:before|after|current|serverHash)[\s\S]{0,300}projectHash\(\)/i);
  });

  it("keeps the quests v1 editor isolated inside Mechanics Hub and future modules read-only", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const id of [
      "mechanics-quests-editor", "mechanics-quests-capability", "mechanics-quests-read-only",
      "mechanics-quests-selection-count", "mechanics-quests-definitions",
      "mechanics-quests-preview-seed", "btn-mechanics-quests-preview-generation",
      "mechanics-quests-generation-result"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
    }
    const ordinary = ["renderTowerEditor", "renderEnemyDetail", "renderMissionEditor"]
      .map((name) => functionSource(app, name)).join("\n");
    expect(ordinary).not.toMatch(/quest|selectionCount|kill_with_source|preserve_shield/i);

    expect(app).toMatch(/\{\s*id:\s*["']quests["']/);
    expect(app).toMatch(/QUEST_RECIPE_IDS\s*=\s*new Set\(\[["']basic_procedural_quests["']\]\)/);
    expect(functionSource(app, "mechanicsRequest")).toMatch(/quests[\s\S]{0,260}(?:future|read-only|schemaVersion\s*2)/i);
  });

  it("edits the closed profile through shared guarded lifecycle and previews saved seeded selection", () => {
    const normalize = functionSource(app, "normalizeQuestMechanicsDraft");
    expect(normalize).toMatch(/selectionCount/);
    expect(normalize).toMatch(/definitions/);
    const render = functionSource(app, "renderQuestMechanicsEditor");
    expect(render).toMatch(/JSON\.parse/);
    expect(render).toMatch(/setCustomValidity/);
    expect(render).toMatch(/supportedVersion/);
    expect(functionSource(app, "applyMechanics")).toMatch(/preview\.revision/);
    expect(functionSource(app, "previewQuestGeneration")).toContain("/api/quests/preview-generation");
    expect(server).toMatch(/callTool\(\s*["']preview_quest_generation["']/);
    expect(server).toMatch(/\/api\/quests\/preview-generation/);
  });

  it("projects active quest progress and transient cues into Playtest without owning quest rules", () => {
    expect(html).toContain('id="pt-quests"');
    const render = functionSource(app, "renderPlaytestQuests");
    expect(render).toMatch(/PT\.rmod\.projectQuestPresentation\(snapshot\)/);
    expect(render).toMatch(/presentation\s*===\s*null|!presentation/);
    expect(render).toMatch(/panel\.hidden\s*=\s*(?:presentation\s*===\s*null|true)/);
    expect(render).toMatch(/presentation\.entries/);
    expect(render).toMatch(/presentation\.cues/);
    expect(render).not.toMatch(/snapshot\.quests|selectProceduralQuests|kill_with_source|preserve_shield/);
    expect(functionSource(app, "updatePlaytestHud")).toMatch(/renderPlaytestQuests\(s\)/);
  });
});
