import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const server = fs.readFileSync(path.resolve("packages/studio/server.mjs"), "utf8");
const styles = fs.readFileSync(path.resolve("packages/studio/public/styles.css"), "utf8");

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

describe("R3.1 Studio elevation surface", () => {
  it("reports elevation transaction conflicts and failures with stable HTTP semantics", () => {
    const errorResponseFactory = Function(
      "sanitizeMechanicsResponse",
      `return (${functionSource(server, "mechanicsErrorResponse")});`
    );
    const errorResponse = errorResponseFactory((value) => value);
    expect(errorResponse(Object.assign(new Error("commit"), { code: "commit_conflict" })).status).toBe(409);
    expect(errorResponse(Object.assign(new Error("rollback ownership"), { code: "rollback_conflict" })).status).toBe(409);
    expect(errorResponse(Object.assign(new Error("candidate"), { code: "candidate_validation_failed" })).status).toBe(422);
    expect(errorResponse(Object.assign(new Error("post-write"), { code: "post_write_validation_failed" })).status).toBe(422);
    expect(errorResponse(Object.assign(new Error("rollback I/O"), { code: "rollback_failed" })).status).toBe(500);

    const elevationRouteStart = server.indexOf('if (req.method === "POST" && ["/api/maps/elevation/preview"');
    const elevationRouteEnd = server.indexOf('if (req.method === "POST" && ["/api/mechanics/preview"', elevationRouteStart);
    const elevationRoute = server.slice(elevationRouteStart, elevationRouteEnd);
    expect(elevationRouteStart).toBeGreaterThanOrEqual(0);
    expect(elevationRoute).not.toMatch(/failure\.status\s*===\s*500\s*\?\s*422/);
  });

  it("retains the authored elevation foundation while advertising shipped LoS and high-ground only", () => {
    const moduleRow = app.match(/\{\s*id:\s*["']elevation["'][^}]*\}/)?.[0] ?? "";
    expect(moduleRow).toMatch(/authored|tile elevation/i);
    expect(moduleRow).toMatch(/line of sight|\bLoS\b/i);
    expect(moduleRow).toMatch(/high[- ]ground|damage bonus|range bonus/i);
    expect(moduleRow).not.toMatch(/terraform/i);
  });

  it("bounds the elevation canvas independently of total map area and reports a focused partial window", () => {
    expect(app).toMatch(/MAX_ELEVATION_(?:CANVAS_)?(?:TILES|CELLS)\s*=\s*(?:4_?096|65_?536)/);
    const loadMap = functionSource(app, "loadElevationMap");
    expect(loadMap).not.toMatch(
      /for\s*\([^)]*r[^)]*map\.height[^)]*\)[\s\S]*for\s*\([^)]*q[^)]*map\.width[^)]*\)[\s\S]*canvasTiles\.push/
    );
    expect(app).toMatch(/canvas(?:Window|Tiles)[\s\S]{0,500}focusedCoord|focusedCoord[\s\S]{0,500}canvas(?:Window|Tiles)/);
    expect(app).toMatch(/partial[\s\S]{0,120}(?:tile|cell|map)|(?:shown|showing)[\s\S]{0,120}(?:of|tile|cell)/i);
  });

  it("bounds raw elevation row materialization without truncating the guarded draft", () => {
    expect(app).toMatch(/MAX_ELEVATION_(?:EDITOR_)?ROWS\s*=\s*(?:256|512|1_?024|4_?096)/);
    const render = functionSource(app, "renderElevationEditor");
    expect(render).not.toMatch(/ElevationUI\.overrides\.map\(elevationRowHtml\)/);
    expect(render).toMatch(/(?:slice|window)[\s\S]{0,200}MAX_ELEVATION_(?:EDITOR_)?ROWS/i);
    expect(`${render}\n${functionSource(app, "renderElevationState")}`).toMatch(
      /partial[\s\S]{0,160}(?:override|row)|(?:showing|shown)[\s\S]{0,160}(?:of|override|row)/i
    );
    const draft = functionSource(app, "elevationRowsDraft");
    expect(draft).toMatch(/ElevationUI\.overrides/);
    expect(draft).toMatch(/dataset\.elevationIndex|data-elevation-index/);
    expect(draft).toMatch(/(?:\.\.\.entry|structuredClone|\.map\([^)]*=>\s*\(\{\s*\.\.\.)/);
    const apply = functionSource(app, "applyMapElevations");
    expect(apply).toMatch(/elevationOverrides\s*:\s*ElevationUI\.overrides/);
  });

  it("keeps elevation authoring in Mechanics Hub with a separate map editor state", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const id of [
      "mechanics-elevation-editor",
      "mechanics-elevation-map",
      "mechanics-elevation-override-rows",
      "btn-elevation-add-override",
      "btn-elevation-preview",
      "btn-elevation-apply",
      "mechanics-elevation-state"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
    }
    expect(app).toMatch(/(?:const|let|var)\s+ElevationUI\b/);
    expect(functionSource(app, "normalizeElevationOverrides")).not.toMatch(/MechanicsUI|S\.project|damage|range|lineOfSight/i);
  });

  it("previews and applies only canonical elevations through guarded map endpoints", () => {
    const normalize = functionSource(app, "normalizeElevationOverrides");
    const preview = functionSource(app, "previewMapElevations");
    const apply = functionSource(app, "applyMapElevations");
    expect(normalize).toMatch(/elevation/);
    expect(normalize).toMatch(/(?:r[\s\S]*q|q[\s\S]*r).*sort|sort[\s\S]*(?:r|q)/);
    expect(preview).toMatch(/\/api\/maps\/elevation\/preview/);
    expect(apply).toMatch(/\/api\/maps\/elevation\/apply/);
    expect(apply).toMatch(/ifRevision\s*:\s*(?:ElevationUI\.)?preview\.revision/);
    expect(apply).toMatch(/await\s+load\(\)/);
    expect(server).toMatch(/preview_map_elevations/);
    expect(server).toMatch(/apply_map_elevations/);
    expect(server).toMatch(/\/api\/maps\/elevation\/(?:preview|apply)/);
  });

  it("preserves map elevations through module disable/re-enable without auto-enabling gameplay", () => {
    expect(app).toMatch(/selectedModuleId\s*===\s*["']elevation["']/);
    expect(app).toMatch(/loadMechanicsProfile[\s\S]*elevation/);
    expect(app).not.toMatch(/ElevationUI[\s\S]{0,500}(?:enabled\s*=\s*true|applyMechanics\()/);
    expect(`${app}\n${html}`).toMatch(/elevation.*(?:badge|contour)|(?:badge|contour).*elevation/i);
  });

  it("authors the same elevation brush with mouse, touch, and keyboard through a shared visual projector", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    expect(hub).toMatch(/id="mechanics-elevation-canvas"[^>]*tabindex="0"/);
    expect(outside).not.toContain('id="mechanics-elevation-canvas"');
    expect(styles).toMatch(/#mechanics-elevation-canvas[^{]*{[^}]*touch-action\s*:\s*none/i);
    expect(app).toMatch(/import\s*{[^}]*projectElevationCues[^}]*}\s*from\s*["']\/renderer\/index\.mjs["']/s);
    expect(app).toMatch(/ElevationUI\s*=\s*{[\s\S]*focusedCoord[\s\S]*brushLevel/);

    const install = functionSource(app, "installElevationCanvasInput");
    for (const eventName of ["pointerdown", "pointermove", "pointerup", "pointercancel", "keydown"]) {
      expect(install).toContain(eventName);
    }
    expect(install).toContain("setPointerCapture");
    expect(install).toMatch(/Arrow(?:Up|Down|Left|Right)/);
    expect(install).toMatch(/(?:Enter|Space|\[|\]|["']0["'])/);
    expect(install).toMatch(/projectElevationCues/);
  });
});
