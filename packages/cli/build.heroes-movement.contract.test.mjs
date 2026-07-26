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

function expectExactMoveCommand(source) {
  expect(source).toMatch(/dispatchGameCommand\s*\(\s*game\s*,\s*\{[\s\S]{0,260}schemaVersion\s*:\s*4[\s\S]{0,120}type\s*:\s*["']moveHero["'][\s\S]{0,160}heroId[\s\S]{0,160}target\s*:\s*\{[\s\S]{0,100}q[\s\S]{0,100}r/);
  expect(source).not.toMatch(/game\.moveHero\s*\(/);
}

describe("R5.1B generated Canvas/Phaser hero controls", () => {
  it("dispatches exact GameCommand v4 and gates v2/v3 movement through the validated presentation", () => {
    const canvas = functionSource(buildSource, "playerTemplate");
    const phaser = functionSource(buildSource, "phaserPlayerTemplate");

    expectExactMoveCommand(canvas);
    expectExactMoveCommand(phaser);
    expect(canvas).toMatch(/targetingMode[\s\S]{0,180}heroMove/);
    expect(phaser).toMatch(/targetingMode[\s\S]{0,180}heroMove/);
    for (const source of [canvas, phaser]) {
      expect(source).toMatch(/presentation\s*=\s*projectHeroesPresentation\s*\(\s*snapshot\s*\)/);
      expect(source).toMatch(/presentation\.active[\s\S]{0,160}presentation\.units\.every\s*\(\s*\(?hero\)?\s*=>\s*hero\.movement\s*\)/);
      expect(source).not.toMatch(/snapshot\??\.heroes\??\.schemaVersion|snapshot\[['"]heroes['"]\][\s\S]{0,40}schemaVersion/);
    }
  });

  it("routes pointer/touch and keyboard targeting through shared presentation hit testing", () => {
    const canvas = functionSource(buildSource, "playerTemplate");
    const phaser = functionSource(buildSource, "phaserPlayerTemplate");

    for (const source of [canvas, phaser]) {
      expect(source).toMatch(/hitTestHeroesPresentation/);
      expect(source).toMatch(/projectHeroPresentationPoint/);
      expect(source).toMatch(/pointerdown/);
      expect(source).toMatch(/keydown/);
      expect(source).toMatch(/Enter/);
      expect(source).toMatch(/Escape/);
      expect(source).toMatch(/setTargetingMode\s*\(\s*\{\s*kind\s*:\s*["']build["']/);
    }
    expect(buildSource.match(/hitTestHeroesPresentation/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(buildSource.match(/projectHeroPresentationPoint/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("keeps selection UI-only and clears it when the run context changes", () => {
    const canvas = functionSource(buildSource, "playerTemplate");
    const phaser = functionSource(buildSource, "phaserPlayerTemplate");

    for (const source of [canvas, phaser]) {
      expect(source).toMatch(/reset-run[\s\S]{0,500}setTargetingMode\s*\(\s*\{\s*kind\s*:\s*["']build["']/);
      expect(source).toMatch(/missionSelect[\s\S]{0,900}setTargetingMode\s*\(\s*\{\s*kind\s*:\s*["']build["']/);
      expect(source).not.toMatch(/snapshot\.selectedHero|game\.selectedHero/);
    }
  });
});
