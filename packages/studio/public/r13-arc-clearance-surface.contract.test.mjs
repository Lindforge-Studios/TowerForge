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

function studioBallisticsNormalizer() {
  const source = functionSource(app, "normalizeBallisticsMechanicsDraft");
  const ownDataValue = (record, key) => {
    if (record === null || typeof record !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  };
  const deep = (value) => structuredClone(value);
  return Function("ownDataValue", "deep", `${source}; return normalizeBallisticsMechanicsDraft;`)(ownDataValue, deep);
}

describe("R13.2 Studio arc-clearance surface (RED)", () => {
  it("keeps optional clearance lossless and closed in the Ballistics Mechanics Hub editor", () => {
    const normalize = functionSource(app, "normalizeBallisticsMechanicsDraft");
    const render = functionSource(app, "renderBallisticsMechanicsEditor");
    const update = functionSource(app, "updateBallisticsMechanicsDraft");
    expect(normalize).toMatch(/ownDataValue\(projectiles,\s*["']clearance["']\)/);
    expect(normalize).toMatch(/terrainBlockerHeights/);
    expect(normalize).not.toMatch(/topology|elevationAt|lineOfSight|projectileAltitude|obstacleTop/);
    const authored = {
      projectiles: {
        towers: { mortar: { trajectory: "arc", travelTimeUnits: 1, maxAltitude: 6 } },
        clearance: { terrainBlockerHeights: { wall: 4, opaque: 2 }, rejected: true },
        rejected: true
      },
      rejected: true
    };
    const normalized = studioBallisticsNormalizer()(authored);
    expect(normalized).toEqual({
      projectiles: {
        towers: { mortar: { trajectory: "arc", travelTimeUnits: 1, maxAltitude: 6 } },
        clearance: { terrainBlockerHeights: { wall: 4, opaque: 2 } }
      }
    });
    authored.projectiles.clearance.terrainBlockerHeights.wall = 99;
    expect(normalized.projectiles.clearance.terrainBlockerHeights.wall).toBe(4);
    expect(`${render}\n${update}`).toMatch(/clearance|terrainBlockerHeights/);
    expect(update).toMatch(/JSON\.parse/);
    expect(update).toMatch(/setCustomValidity/);
    expect(functionSource(app, "applyMechanics")).toMatch(/preview\.revision/);
    expect(html).toMatch(/Ballistics[\s\S]*terrainBlockerHeights|terrainBlockerHeights[\s\S]*Ballistics/i);
  });

  it("preserves unknown future Ballistics profiles read-only and returns to the exact R13.1 editor when clearance is absent", () => {
    const render = functionSource(app, "renderBallisticsMechanicsEditor");
    expect(render).toMatch(/schemaVersion\s*===\s*1/);
    expect(render).toMatch(/readOnly/);
    expect(render).toMatch(/input\.disabled\s*=\s*readOnly/);
    expect(render).toMatch(/readOnly[\s\S]*deep\(MechanicsUI\.draft/);
    expect(render).toMatch(/normalizeBallisticsMechanicsDraft\(MechanicsUI\.draft\)/);
    expect(render).toMatch(/clearance|terrainBlockerHeights/);
    expect(studioBallisticsNormalizer()({
      projectiles: { towers: { bolt: { trajectory: "direct", travelTimeUnits: 1 } } }
    })).toEqual({
      projectiles: { towers: { bolt: { trajectory: "direct", travelTimeUnits: 1 } } }
    });
  });

  it("uses only the shared blocked-event projector in Studio, Canvas, and Phaser", () => {
    const playtest = functionSource(app, "renderPlaytestBallistics");
    expect(playtest).toMatch(/projectBallisticsEventPresentation\(snapshot\)/);
    expect(playtest).toMatch(/projectileId|blockerCoord|blockerTag/);

    const phaser = build.slice(build.indexOf("function phaserPlayerTemplate"));
    for (const source of [app, phaser]) {
      expect(source).toMatch(/projectBallisticsEventPresentation\(/);
      expect(source).not.toMatch(/(?:topology|lineOfSight|elevationAt|terrainBlockerHeights)[\s\S]{0,120}projectileBlocked/i);
      expect(source).not.toMatch(/projectileBlocked[\s\S]{0,180}(?:maxAltitude|progress\s*\*|obstacleTop\s*=)/i);
    }
  });
});
