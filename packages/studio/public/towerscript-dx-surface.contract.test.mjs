import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const styles = fs.readFileSync(path.resolve("packages/studio/public/styles.css"), "utf8");

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

describe("R6 TowerScript DX Studio surface RED", () => {
  it("keeps one canonical script workbench with an explicit JSON/Graph projection toggle", () => {
    const scriptsStart = html.indexOf('<section id="tab-scripts"');
    const scriptsEnd = html.indexOf('<section id="tab-assets"', scriptsStart);
    const scripts = html.slice(scriptsStart, scriptsEnd);

    for (const id of [
      "script-view-json",
      "script-view-graph",
      "script-editor",
      "script-graph-pane",
      "script-graph-canvas",
      "script-graph-node-palette",
      "script-graph-help"
    ]) {
      expect(scripts).toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    expect(scripts).toMatch(/JSON/i);
    expect(scripts).toMatch(/Graph/i);
    expect(styles).toMatch(/\.script-graph-(?:pane|canvas|node|edge)/);
  });

  it("loads one lossless graph projection and saves only its validated canonical AST behind preview revision", () => {
    const load = functionSource(app, "loadTowerScriptGraph");
    const render = functionSource(app, "renderTowerScriptGraph");
    const save = functionSource(app, "saveTowerScriptGraph");

    expect(load).toMatch(/get_tower_script_graph|\/api\/project\/script\/graph/);
    expect(load).toMatch(/graph|layout|revision/);
    expect(render).toMatch(/\.nodes|\.edges|kind\s*===\s*["']raw["']/);
    expect(render).toMatch(/data-(?:graph-node|tower-script-node)/);
    expect(save).toMatch(/preview_tower_script_graph|\/preview/);
    expect(save).toMatch(/apply_tower_script_graph|\/apply/);
    expect(save).toMatch(/ifRevision\s*:\s*preview\.revision/);
    expect(save).toMatch(/validation\?*\.ok|preview\.ok/);
    expect(save).not.toMatch(/eval\s*\(|new\s+Function|Function\s*\(/);
  });

  it("builds node palette, completion, and contextual help from the engine descriptor catalog", () => {
    const help = functionSource(app, "renderTowerScriptNodeHelp");
    const palette = functionSource(app, "renderTowerScriptNodePalette");

    expect(app).toMatch(/\/api\/(?:tower-?script|schema)[^"']*schema|describe_schema/);
    for (const collection of ["events", "actions", "operators", "scopes"]) {
      expect(`${help}\n${palette}`).toMatch(new RegExp(`(?:nodeCatalog|completion|descriptor)[\\s\\S]*\\.${collection}|\\.${collection}[\\s\\S]*(?:nodeCatalog|completion|descriptor)`));
    }
    expect(palette).toMatch(/\.map\s*\(/);
    expect(help).toMatch(/descriptor|required|optional/);
    expect(`${help}\n${palette}`).not.toMatch(
      /\[(?:\s*["'](?:grantResource|damageCore|incrementState|emitSignal)["']\s*,?){2,}\s*\]/
    );
  });

  it("authors graph structure from the descriptor palette and keeps every reparent/delete canonical", () => {
    const render = functionSource(app, "renderTowerScriptGraph");
    const palette = functionSource(app, "renderTowerScriptNodePalette");
    const add = functionSource(app, "addTowerScriptGraphNode");
    const reparent = functionSource(app, "reparentTowerScriptGraphNode");
    const remove = functionSource(app, "deleteTowerScriptGraphNode");

    expect(palette).toMatch(/data-node-catalog-(?:group|kind)/);
    expect(palette).toMatch(/addTowerScriptGraphNode/);
    expect(add).toMatch(/nodeCatalog|descriptor/);
    expect(add).toMatch(/towerScriptAstToGraph|rebuildTowerScriptGraph/);
    expect(reparent).toMatch(/handler|actions|event/);
    expect(reparent).toMatch(/towerScriptAstToGraph|rebuildTowerScriptGraph/);
    expect(remove).toMatch(/bindings|handlers|actions|when/);
    expect(remove).toMatch(/towerScriptAstToGraph|rebuildTowerScriptGraph/);
    expect(render).toMatch(/data-graph-parent|data-graph-event/);
    expect(render).toMatch(/data-graph-delete/);
    expect(render).toMatch(/beginTowerScriptNodeDrag/);
    expect(render).toMatch(/readOnly\s*=\s*true/);
  });

  it("authors every known node through descriptor-driven controls and reserves raw JSON for unknown future nodes", () => {
    const render = functionSource(app, "renderTowerScriptGraph");
    const fields = functionSource(app, "renderGraphNodeFields");

    expect(render).toMatch(/renderGraphNodeFields/);
    expect(fields).toMatch(/nodeCatalog|schemaDescriptor/);
    expect(fields).toMatch(/data-graph-field/);
    expect(fields).toMatch(/createElement\(\s*["'](?:input|select|fieldset)["']/);
    expect(fields).toMatch(/script|binding|handler|action|condition/);
    expect(render).toMatch(/if\s*\(\s*isRaw\s*\)[\s\S]*createElement\(\s*["']textarea["']/);
    expect(render).not.toMatch(/JSON\.parse\(\s*source\.value|source\.addEventListener/);
  });

  it("exposes trace cursor, all four step modes, resume, and bounded tick rewind in Playtest", () => {
    const playtestStart = html.indexOf('<section id="tab-playtest"');
    const playtestEnd = html.indexOf('<section id="tab-balance"', playtestStart);
    const playtest = html.slice(playtestStart, playtestEnd);

    for (const id of [
      "script-debugger",
      "script-debug-step-mode",
      "btn-script-debug-step",
      "btn-script-debug-resume",
      "script-debug-rewind-ticks",
      "btn-script-debug-rewind",
      "script-debug-trace",
      "script-debug-state"
    ]) expect(playtest).toContain(`id="${id}"`);
    for (const mode of ["tick", "event", "handler", "action"]) {
      expect(playtest).toMatch(new RegExp(`<option[^>]+value=["']${mode}["']`));
    }
    expect(playtest).toMatch(/min=["']1["']/);
  });

  it("delegates stepping and rewind to TowerScriptDebugSession and renders structured diffs/diagnostics", () => {
    const step = functionSource(app, "stepTowerScriptDebugger");
    const rewind = functionSource(app, "rewindTowerScriptDebugger");
    const render = functionSource(app, "renderTowerScriptDebugger");

    expect(step).toMatch(/\.step\s*\(/);
    expect(step).toMatch(/script-debug-step-mode|mode/);
    expect(step).toMatch(/cursor|traceEntry|snapshot/);
    expect(rewind).toMatch(/\.rewindTicks\s*\(/);
    expect(rewind).toMatch(/script-debug-rewind-ticks/);
    expect(render).toMatch(/event|binding|handler|condition|action|state_diff|diagnostic/);
    expect(render).toMatch(/changes|before|after|diagnostic/);
    expect(app).toMatch(/\.resume\s*\(/);
  });

  it("pins debugger history while stepping and resumes only through the explicit resume control", () => {
    const step = functionSource(app, "stepTowerScriptDebugger");
    const resume = functionSource(app, "resumeTowerScriptDebugger");

    expect(step).toMatch(/pt-speed/);
    expect(step).toMatch(/value\s*=\s*["']0["']/);
    expect(step).toMatch(/resumeSpeed/);
    expect(resume).toMatch(/pt-speed/);
    expect(resume).toMatch(/resumeSpeed/);
    expect(resume).toMatch(/dispatchEvent\s*\(\s*new Event\s*\(\s*["']input["']/);
  });
});
