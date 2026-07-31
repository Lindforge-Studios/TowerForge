import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const server = fs.readFileSync(path.resolve("packages/studio/server.mjs"), "utf8");

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

describe("R13.4d2 Studio destructible environment Hub surface (RED)", () => {
  it("keeps a separate Destructibles section inside Mechanics Hub and out of ordinary editors", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const id of [
      "mechanics-destructibles-editor",
      "mechanics-destructibles-definition-rows",
      "mechanics-destructibles-map-select",
      "mechanics-destructibles-placement-rows",
      "mechanics-destructibles-status"
    ]) {
      expect(hub, `${id} must live in Mechanics Hub`).toContain(`id="${id}"`);
      expect(outside, `${id} must not leak into ordinary forms`).not.toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    const ordinary = ["renderTowerEditor", "renderMissionEditor"]
      .map((name) => functionSource(app, name)).join("\n");
    expect(ordinary).not.toMatch(/destructibleObjects|blockerHeight|terrainTransitionId/i);
  });

  it("authors the complete closed definition shape without falling back to raw profile JSON", () => {
    const render = functionSource(app, "renderDestructibleEnvironmentEditor");
    for (const marker of [
      "data-destructible-definition-id",
      "data-destructible-max-hp",
      "data-destructible-armor-type-id",
      "data-destructible-blocker-height",
      "data-destructible-blocks-line-of-sight",
      "data-destructible-terrain-transition-id",
      "data-remove-destructible-definition"
    ]) expect(`${html}\n${render}`).toContain(marker);
    for (const field of ["maxHp", "armorTypeId", "hitRegion", "kind", "tile", "blockerHeight", "blocksLineOfSight", "onDestroyed", "terrainTransitionId"]) {
      expect(render).toContain(field);
    }
    expect(`${html}\n${app}`).toContain("btn-mechanics-add-destructible-definition");
    expect(render).not.toMatch(/mechanics-ballistics-profile-json[\s\S]{0,200}(?:destructible|definition)/i);
  });

  it("binds explicit authored maps, definition IDs and tile coordinates through a placement editor", () => {
    const render = functionSource(app, "renderDestructibleEnvironmentEditor");
    for (const marker of [
      "data-destructible-placement-id",
      "data-destructible-placement-definition-id",
      "data-destructible-placement-q",
      "data-destructible-placement-r",
      "data-remove-destructible-placement"
    ]) expect(`${html}\n${render}`).toContain(marker);
    for (const token of ["mapId", "placements", "definitionId", "coord", "q", "r"]) {
      expect(render).toContain(token);
    }
    expect(`${html}\n${app}`).toContain("btn-mechanics-add-destructible-placement");
    expect(render).toMatch(/S\.project\?\.maps|S\.project\.maps|availableMaps/);
    expect(render).not.toMatch(/Math\.random|randomCoord|findEmptyTile|suggestPlacement/);
  });

  it("previews and applies one detached request only through the narrow d1 revision guard", () => {
    const request = functionSource(app, "destructibleEnvironmentRequest");
    const preview = functionSource(app, "previewDestructibleEnvironment");
    const apply = functionSource(app, "applyDestructibleEnvironment");
    for (const token of [
      "moduleSchemaVersion", "missionId", "profileId", "mapId", "enabled",
      "projectiles", "towers", "destructibles", "definitions", "placements"
    ]) expect(request).toContain(token);
    expect(preview).toMatch(/\/api\/mechanics\/destructibles\/preview/);
    expect(apply).toMatch(/Object\.freeze\(destructibleEnvironmentRequest\(enabled\)\)/);
    expect(apply).toMatch(/previewDestructibleEnvironment\(requestSnapshot\)/);
    expect(apply).toMatch(/\/api\/mechanics\/destructibles\/apply/);
    expect(apply).toMatch(/ifRevision\s*:\s*preview\.revision/);
    expect(`${preview}\n${apply}`).not.toMatch(/\/api\/mechanics\/(?:preview|apply)["']/);
  });

  it("reloads after writes, preserves the profile on disable and can re-enable the same candidate", () => {
    const apply = functionSource(app, "applyDestructibleEnvironment");
    const reload = functionSource(app, "reloadDestructibleEnvironment");
    expect(apply).toMatch(/await\s+load\(\)/);
    expect(apply).toMatch(/await\s+reloadDestructibleEnvironment\(\)|DestructibleEnvironmentUI[\s\S]{0,400}(?:reset|null)/);
    expect(reload).toMatch(/\/api\/mechanics\/capabilities|loadMechanicsCapabilities|S\.project/);
    expect(app).toMatch(/btn-mechanics-destructibles-(?:enable|save)[\s\S]{0,500}applyDestructibleEnvironment\(true\)/);
    expect(app).toMatch(/btn-mechanics-destructibles-disable[\s\S]{0,500}applyDestructibleEnvironment\(false\)/);
    expect(app).toMatch(/btn-mechanics-destructibles-reload[\s\S]{0,500}reloadDestructibleEnvironment/);
    expect(functionSource(app, "destructibleEnvironmentRequest")).toMatch(/if\s*\(\s*!enabled\s*\)[\s\S]*profileId[\s\S]*profile[\s\S]*placements/);
  });

  it("preserves future Ballistics data read-only and delegates routes without importing gameplay", () => {
    const normalize = functionSource(app, "normalizeMechanicsDraft");
    const render = functionSource(app, "renderDestructibleEnvironmentEditor");
    const request = functionSource(app, "destructibleEnvironmentRequest");
    expect(normalize).toMatch(/selectedModuleId\s*===\s*["']ballistics["'][\s\S]*mechanicsProjectModuleVersion\(\)\s*===\s*1[\s\S]*deep\(profile\s*\?\?\s*\{\}\)/);
    expect(`${render}\n${request}`).toMatch(/supportedVersion|schemaVersion|future|read.?only/i);
    expect(request).toMatch(/schemaVersion[\s\S]{0,300}(?:throw|read.?only)/i);

    for (const route of [
      "/api/mechanics/destructibles/preview",
      "/api/mechanics/destructibles/apply",
      "preview_destructible_environment",
      "apply_destructible_environment"
    ]) expect(server).toContain(route);
    const routeStart = server.indexOf("/api/mechanics/destructibles/preview");
    const routeEnd = server.indexOf("// ", routeStart + 16);
    const routes = server.slice(routeStart, routeEnd < 0 ? routeStart + 6000 : routeEnd);
    expect(routes).toMatch(/ifRevision/);
    expect(routes).toMatch(/428|revision_required/);
    expect(routes).toMatch(/sanitizeMechanicsResponse/);
    for (const source of [render, request, routes]) {
      expect(source).not.toMatch(/TowerDefenseGame|DamageResolver|traceProjectile|createGridTopology|compileMapSources|persistentTerrainTransaction/);
    }
  });
});
