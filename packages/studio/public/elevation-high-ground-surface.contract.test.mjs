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

describe("R3.3 Studio high-ground authoring surface contract", () => {
  it("keeps the toggle and three bounded integer fields only in Mechanics Hub", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    const ids = [
      "mechanics-elevation-high-ground-enabled",
      "mechanics-elevation-high-ground-max-delta",
      "mechanics-elevation-high-ground-range-bonus",
      "mechanics-elevation-high-ground-damage-bps"
    ];
    for (const id of ids) {
      expect(hub).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
    }
    expect(hub).toMatch(/high[- ]ground/i);
    const elevationStart = hub.indexOf('<div id="mechanics-elevation-editor"');
    const elevationEnd = hub.indexOf('<div id="mechanics-physics-editor"', elevationStart);
    const elevationEditor = hub.slice(elevationStart, elevationEnd);
    expect(elevationEditor).not.toMatch(/push|pull|fall hazard|terraform|flood|moat|bridge/i);

    expect(hub).toMatch(/id="mechanics-elevation-high-ground-max-delta"[^>]*type="number"[^>]*min="1"[^>]*max="64"[^>]*step="1"/);
    expect(hub).toMatch(/id="mechanics-elevation-high-ground-range-bonus"[^>]*type="number"[^>]*min="0"[^>]*max="16"[^>]*step="1"/);
    expect(hub).toMatch(/id="mechanics-elevation-high-ground-damage-bps"[^>]*type="number"[^>]*min="0"[^>]*max="10000"[^>]*step="1"/);
  });

  it("preserves the LoS sibling and derives v3 field bounds from the engine descriptor", () => {
    const normalize = functionSource(app, "normalizeElevationLineOfSightDraft");
    const effectiveVersion = functionSource(app, "mechanicsEffectiveModuleSchemaVersion");
    const renderName = app.match(/function (renderElevationHighGroundEditor)\s*\(/)?.[1];

    expect(normalize).toMatch(/lineOfSight[\s\S]*highGround|highGround[\s\S]*lineOfSight/);
    expect(normalize).toMatch(/maximumEffectiveElevationDelta/);
    expect(normalize).toMatch(/rangeBonusPerElevation/);
    expect(normalize).toMatch(/damageBonusBasisPointsPerElevation/);
    expect(effectiveVersion).toMatch(/elevation[\s\S]*highGround[\s\S]*3/);
    expect(effectiveVersion).toMatch(/mechanicsProjectModuleVersion|Math\.max/);
    expect(renderName).toBe("renderElevationHighGroundEditor");

    const render = functionSource(app, renderName);
    expect(render).toMatch(/mechanicsHighGroundLimits|limits\??\.highGround|highGround\??\.limits/);
    expect(render).toMatch(/maximumEffectiveElevationDelta/);
    expect(render).toMatch(/rangeBonusPerElevation/);
    expect(render).toMatch(/damageBonusBasisPointsPerElevation/);
    expect(render).toMatch(/delete\s+MechanicsUI\.draft\.highGround/);
    expect(render).not.toMatch(/delete\s+MechanicsUI\.draft\.lineOfSight/);
  });

  it("saves the complete detached v3 profile through the existing guarded transaction", () => {
    const request = functionSource(app, "mechanicsRequest");
    const apply = functionSource(app, "applyMechanics");
    const preview = functionSource(app, "previewMechanics");
    const load = functionSource(app, "loadMechanicsProfile");

    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).toMatch(/moduleSchemaVersion/);
    expect(request).not.toMatch(/delete\s+profile\.(?:lineOfSight|highGround)/);
    expect(app).toMatch(/selectedModuleId\s*===\s*["']elevation["'][\s\S]*renderElevationHighGroundEditor\s*\(/);
    expect(load).toMatch(/normalizeMechanicsDraft\(profile\)/);
    expect(app).toMatch(/basic_elevation_high_ground/);

    expect(apply).toMatch(/previewMechanics/);
    expect(preview).toMatch(/\/api\/mechanics\/preview/);
    expect(apply).toMatch(/\/api\/mechanics\/apply/);
    expect(apply).toMatch(/ifRevision|preview\.revision/);
    expect(server).toMatch(/previewMechanicsModule|preview_mechanics_module/);
    expect(server).toMatch(/applyMechanicsModule|apply_mechanics_module/);
  });
});
