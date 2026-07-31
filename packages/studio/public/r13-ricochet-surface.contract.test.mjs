import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const renderer = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
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

describe("R13.3 Studio and generated-player ricochet surfaces (RED)", () => {
  it("keeps the optional ricochet vocabulary lossless in the Ballistics Mechanics Hub", () => {
    expect(app).toMatch(/BALLISTICS_RECIPE_IDS[\s\S]{0,240}basic_projectile_ricochet/);
    const normalize = functionSource(app, "normalizeBallisticsMechanicsDraft");
    const render = functionSource(app, "renderBallisticsMechanicsEditor");
    const update = functionSource(app, "updateBallisticsMechanicsDraft");
    for (const token of ["ricochet", "terrainTags", "armorTypes", "maxBounces", "rangeCells"]) {
      expect(`${normalize}\n${render}\n${update}`).toContain(token);
    }
    expect(normalize).not.toMatch(/createGridTopology|traceProjectileRicochetRayV1|DamageResolver/);
    const authored = {
      projectiles: {
        towers: {
          cannon: {
            trajectory: "direct", travelTimeUnits: 0.4,
            ricochet: { maxBounces: 2, rangeCells: 12 }
          }
        },
        ricochet: {
          terrainTags: { reflective_rock: true }, armorTypes: { plated: true }, rejected: true
        },
        rejected: true
      },
      rejected: true
    };
    const normalized = studioBallisticsNormalizer()(authored);
    expect(normalized).toEqual({
      projectiles: {
        towers: {
          cannon: {
            trajectory: "direct", travelTimeUnits: 0.4,
            ricochet: { maxBounces: 2, rangeCells: 12 }
          }
        },
        ricochet: { terrainTags: { reflective_rock: true }, armorTypes: { plated: true } }
      }
    });
    authored.projectiles.ricochet.terrainTags.reflective_rock = false;
    expect(normalized.projectiles.ricochet.terrainTags.reflective_rock).toBe(true);
    expect(update).toMatch(/JSON\.parse/);
    expect(update).toMatch(/setCustomValidity/);
    expect(functionSource(app, "applyMechanics")).toMatch(/preview\.revision/);
    expect(html).toMatch(/Ballistics[\s\S]*(?:ricochet|maxBounces|terrainTags)/i);
  });

  it("never executes nested accessors while normalizing imported ricochet records", () => {
    let reads = 0;
    const terrainTags = {};
    Object.defineProperty(terrainTags, "reflective_rock", {
      enumerable: true,
      get() { reads += 1; return true; }
    });
    const normalized = studioBallisticsNormalizer()({
      projectiles: {
        towers: {},
        ricochet: { terrainTags }
      }
    });
    expect(reads).toBe(0);
    expect(normalized).toEqual({ projectiles: { towers: {} } });

    const towerBinding = { trajectory: "direct", travelTimeUnits: 0.4 };
    Object.defineProperty(towerBinding, "ricochet", {
      enumerable: true,
      get() { reads += 1; return { maxBounces: 2, rangeCells: 12 }; }
    });
    const normalizedTower = studioBallisticsNormalizer()({
      projectiles: { towers: { cannon: towerBinding } }
    });
    expect(reads).toBe(0);
    expect(normalizedTower).toEqual({ projectiles: { towers: {} } });
  });

  it("renders authoritative bounce events in Playtest through the separate shared projector", () => {
    const playtest = functionSource(app, "renderPlaytestBallistics");
    expect(playtest).toMatch(/projectBallisticsRicochetEventPresentation\(snapshot\)/);
    for (const token of [
      "projectileId", "bounceCount", "surfaceKind", "surfaceId", "collisionCoord",
      "nextSourceCoord", "nextTargetCoord"
    ]) expect(playtest).toContain(token);
    expect(playtest).not.toMatch(/createGridTopology|traceProjectileRicochetRayV1|DamageResolver/);
    expect(playtest).not.toMatch(/(?:incoming|direction|vector)[\s\S]{0,100}(?:reflect|bounce).*=/i);
  });

  it("uses the same shared ricochet projector in generated Canvas and Phaser paths", () => {
    expect(renderer).toMatch(/projectBallisticsRicochetEventPresentation\(snapshot\)|projectBallisticsRicochetEventPresentation\(presentationSnapshot\)/);
    const phaser = build.slice(build.indexOf("function phaserPlayerTemplate"));
    expect(phaser).toMatch(/projectBallisticsRicochetEventPresentation\(presentationSnapshot\)/);
    for (const source of [renderer, phaser]) {
      expect(source).not.toMatch(/traceProjectileRicochetRayV1|createGridTopology|DamageResolver/);
      expect(source).not.toMatch(/surfaceKind[\s\S]{0,100}(?:incoming|direction|vector).*=/i);
    }
  });
});
