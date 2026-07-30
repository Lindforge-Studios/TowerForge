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

describe("R11 Studio Procedural Juice Lab", () => {
  it("keeps the opt-in editor isolated in Assets rather than gameplay forms", () => {
    const assetsStart = html.indexOf('<section id="tab-assets"');
    const assetsEnd = html.indexOf('<section id="tab-mechanics"', assetsStart);
    const assets = html.slice(assetsStart, assetsEnd);
    const outside = `${html.slice(0, assetsStart)}${html.slice(assetsEnd)}`;
    for (const id of [
      "procedural-juice-lab", "procedural-juice-state", "procedural-juice-editor",
      "procedural-juice-recipe", "btn-procedural-juice-recipe", "procedural-juice-event",
      "procedural-juice-event-json", "btn-procedural-juice-event-preview",
      "btn-procedural-juice-preview", "btn-procedural-juice-apply",
      "btn-procedural-juice-disable", "procedural-juice-result"
    ]) {
      expect(assets).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
    }
    const ordinary = ["renderTowerEditor", "renderEnemyDetail", "renderMissionEditor"]
      .map((name) => functionSource(app, name)).join("\n");
    expect(ordinary).not.toMatch(/proceduralJuice|particleEmitters|cameraCues/i);
  });

  it("uses the narrow preview/apply lifecycle and an exact project+visuals authoring revision", () => {
    const render = functionSource(app, "renderProceduralJuiceLab");
    expect(render).toMatch(/future|read.?only|supported/i);
    expect(render).toMatch(/visualsRevision/);
    expect(functionSource(app, "previewProceduralJuice")).toContain("/api/procedural-juice/preview");
    const apply = functionSource(app, "applyProceduralJuice");
    expect(apply).toContain("/api/procedural-juice/apply");
    expect(apply).toMatch(/visualsRevision/);
    expect(apply).toMatch(/preview/);
    expect(functionSource(app, "disableProceduralJuice")).toMatch(/procedural-juice\/preview[\s\S]*procedural-juice\/apply/);
    expect(functionSource(app, "previewProceduralJuiceEvent")).toContain("/api/procedural-juice/event-preview");
    expect(functionSource(app, "loadProceduralJuiceRecipe")).toContain("/api/procedural-juice/recipes");
  });

  it("delegates every Studio operation to the same MCP tools", () => {
    const pairs = [
      ["/api/procedural-juice/read", "get_procedural_juice"],
      ["/api/procedural-juice/recipes", "get_procedural_juice_recipe"],
      ["/api/procedural-juice/event-preview", "preview_procedural_juice_event"],
      ["/api/procedural-juice/preview", "preview_procedural_juice"],
      ["/api/procedural-juice/apply", "apply_procedural_juice"]
    ];
    for (const [route, tool] of pairs) {
      expect(server).toContain(route);
      expect(server).toMatch(new RegExp(`callTool\\(\\s*["']${tool}["']`));
    }
  });

  it("keeps compute-only preview failures free of Studio trace writes", () => {
    const start = server.indexOf('if (req.method === "POST" && [\n    "/api/procedural-juice/event-preview"');
    const end = server.indexOf("// Persona QA is evidence-only", start);
    expect(start).toBeGreaterThanOrEqual(0);
    const route = server.slice(start, end);
    expect(route).toMatch(/const isWrite = pathname\.endsWith\("\/apply"\)/);
    expect(route).toMatch(/catch \(error\) \{\s*if \(isWrite\) \{\s*writeRunTrace/);
  });

  it("resets same-mission presentation state and drains muted procedural cues", () => {
    const reset = functionSource(app, "resetPlaytestPresentation");
    expect(reset).toContain("resetProceduralJuicePresentation");
    expect(reset).toContain("disposeProceduralVoices");
    expect(functionSource(app, "newPlaytestGame")).toContain("resetPlaytestPresentation");
    const present = functionSource(app, "presentPlaytestSnapshot");
    expect(present.indexOf("drainProceduralAudioCues")).toBeLessThan(present.indexOf('$("pt-sound")?.checked'));
  });
});
