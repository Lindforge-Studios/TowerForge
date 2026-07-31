import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const build = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

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

describe("R13.1 Studio and generated-player ballistics surface (RED)", () => {
  it("keeps the closed editor inside Mechanics Hub and out of ordinary tower/mission forms", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;

    for (const id of [
      "mechanics-ballistics-editor",
      "mechanics-ballistics-capability",
      "mechanics-ballistics-read-only",
      "mechanics-ballistics-profile-json"
    ]) {
      expect(hub, `${id} must live in Mechanics Hub`).toContain(`id="${id}"`);
      expect(outside, `${id} must not leak into ordinary forms`).not.toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    const ordinary = ["renderTowerEditor", "renderMissionEditor"]
      .map((name) => functionSource(app, name)).join("\n");
    expect(ordinary).not.toMatch(/ballistics|trajectory|travelTimeUnits|maxAltitude/i);
  });

  it("normalizes and edits the closed profile through the existing revision-guarded lifecycle", () => {
    expect(app).toMatch(/\{\s*id:\s*["']ballistics["']/);
    expect(app).toMatch(/BALLISTICS_RECIPE_IDS[\s\S]{0,180}basic_projectile_ballistics/);
    const normalize = functionSource(app, "normalizeBallisticsMechanicsDraft");
    const render = functionSource(app, "renderBallisticsMechanicsEditor");
    const update = functionSource(app, "updateBallisticsMechanicsDraft");
    for (const token of ["projectiles", "towers", "direct", "arc", "travelTimeUnits", "maxAltitude"]) {
      expect(`${normalize}\n${render}\n${update}`).toContain(token);
    }
    expect(render).toContain("mechanics-ballistics-profile-json");
    expect(render).toMatch(/supportedVersion|schemaVersion|read.?only/i);
    expect(update).toMatch(/JSON\.parse/);
    expect(update).toMatch(/setCustomValidity/);
    expect(functionSource(app, "applyMechanics")).toMatch(/preview\.revision/);
  });

  it("consumes only active shared presentation in Playtest and hides the legacy path", () => {
    expect(html).toContain('id="pt-ballistics"');
    const render = functionSource(app, "renderPlaytestBallistics");
    expect(render).toMatch(/PT\.rmod\.projectBallisticsPresentation\(snapshot\)/);
    expect(render).toMatch(/presentation\.active/);
    expect(render).toMatch(/panel\.hidden/);
    expect(render).toMatch(/presentation\.projectiles/);
    expect(render).toMatch(/projectBallisticsPresentationPoint/);
    expect(render).not.toMatch(/snapshot\.ballistics|elapsedUnits\s*\/\s*[^\n;]*travelTimeUnits/);
    expect(functionSource(app, "updatePlaytestHud")).toMatch(/renderPlaytestBallistics\(s\)/);
  });

  it("uses the shared active-only projector in Canvas and Phaser without local flight rules", () => {
    expect(app).toMatch(/projectBallisticsPresentation/);
    expect(app).toMatch(/projectBallisticsPresentationPoint/);
    const phaser = build.slice(build.indexOf("function phaserPlayerTemplate"));
    expect(phaser).toMatch(/projectBallisticsPresentation\(presentationSnapshot\)/);
    expect(phaser).toMatch(/projectBallisticsPresentationPoint/);
    expect(phaser).toMatch(/ballisticsPresentation\.active/);

    for (const source of [app, phaser]) {
      expect(source).not.toMatch(/4\s*\*[^\n;]*maxAltitude[^\n;]*progress[^\n;]*\(1\s*-\s*progress\)/);
      expect(source).not.toMatch(/(?:lineOfSight|blockerHeight|weatherZone).*projectile/i);
    }
  });
});
