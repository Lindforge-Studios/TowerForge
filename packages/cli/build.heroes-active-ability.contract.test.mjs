import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

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

describe("R5.3A generated Canvas/Phaser hero ability controls", () => {
  it("dispatches only the exact GameCommandV5 envelope", () => {
    for (const source of [
      functionSource(buildSource, "playerTemplate"),
      functionSource(buildSource, "phaserPlayerTemplate")
    ]) {
      expect(source).toMatch(/dispatchGameCommand\s*\(\s*game\s*,\s*\{[\s\S]{0,320}schemaVersion\s*:\s*5[\s\S]{0,120}type\s*:\s*["']useHeroAbility["'][\s\S]{0,180}heroId[\s\S]{0,180}abilityId[\s\S]{0,180}targetEnemyId/);
      expect(source).not.toMatch(/game\.useHeroAbility\s*\(/);
    }
  });

  it("uses one mutually-exclusive targeting mode and authoritative v4 readiness cues", () => {
    for (const source of [
      functionSource(buildSource, "playerTemplate"),
      functionSource(buildSource, "phaserPlayerTemplate")
    ]) {
      expect(source).toMatch(/targetingMode/);
      expect(source).toMatch(/kind\s*:\s*["']heroAbility["']/);
      expect(source).toMatch(/kind\s*:\s*["']heroMove["']/);
      expect(source).toMatch(/kind\s*:\s*["']missionAbility["']/);
      expect(source).toMatch(/kind\s*:\s*["']sell["']/);
      expect(source).toMatch(/projectHeroesPresentation/);
      expect(source).toMatch(/activeAbility\.ready|ability\.ready/);
      expect(source).toMatch(/cooldownRemaining/);
      expect(source).toMatch(/mana\.current/);
      expect(source).toMatch(/Digit1/);
      expect(source).toMatch(/Escape/);
    }
  });

  it("creates the hero action bar dynamically only for a valid active v4 projection", () => {
    expect(buildSource).not.toMatch(/<[^>]+id=["']hero-action-bar["']/);
    for (const source of [
      functionSource(buildSource, "playerTemplate"),
      functionSource(buildSource, "phaserPlayerTemplate")
    ]) {
      expect(source).toMatch(/createElement\s*\(\s*["'](?:section|div)["']\s*\)/);
      expect(source).toMatch(/hero-action-bar/);
      expect(source).toMatch(/presentation\.active/);
      expect(source).toMatch(/activeAbility/);
      expect(source).toMatch(/\.remove\s*\(\s*\)/);
    }
  });
});
