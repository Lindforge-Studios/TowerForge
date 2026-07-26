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

describe("R5.4A generated Canvas/Phaser battle-local skill controls", () => {
  const templates = () => [
    functionSource(buildSource, "playerTemplate"),
    functionSource(buildSource, "phaserPlayerTemplate")
  ];

  it("dispatches only the exact GameCommandV6 unlock envelope in both players", () => {
    for (const source of templates()) {
      expect(source).toMatch(
        /dispatchGameCommand\s*\(\s*game\s*,\s*\{[\s\S]{0,320}schemaVersion\s*:\s*6[\s\S]{0,120}type\s*:\s*["']unlockHeroSkill["'][\s\S]{0,180}heroId[\s\S]{0,180}skillId/
      );
      expect(source).not.toMatch(/game\.unlockHeroSkill\s*\(/);
    }
  });

  it("creates a native-button skill panel from authoritative v5 state only", () => {
    expect(buildSource).not.toMatch(/<[^>]+id=["']hero-skill-tree["']/);
    for (const source of templates()) {
      expect(source).toMatch(/projectHeroesPresentation/);
      expect(source).toMatch(/hero-skill-tree/);
      expect(source).toMatch(/data-hero-skill-id|dataset\.heroSkillId/);
      expect(source).toMatch(/createElement\s*\(\s*["']button["']\s*\)/);
      expect(source).toMatch(/skills\.availablePoints|availablePoints/);
      expect(source).toMatch(/skills\.managementAvailable|managementAvailable/);
      expect(source).toMatch(/node\.unlocked|\.unlocked/);
      expect(source).toMatch(/node\.unlockable|\.unlockable/);
      expect(source).toMatch(/\.remove\s*\(\s*\)/);
      expect(source).not.toMatch(/requiresSkillIds\s*\.\s*every|availablePoints\s*>=\s*(?:node\.)?cost/);
    }
  });

  it("does not add another targeting mode or skill UI to absent/null/v1-v4/future snapshots", () => {
    for (const source of templates()) {
      expect(source).not.toMatch(/kind\s*:\s*["']heroSkill["']/);
      expect(source).toMatch(/presentation\.active/);
      expect(source).toMatch(/(?:unit|hero)\?*\.skills|skills\s*\?/);
      expect(source).toMatch(/skills[\s\S]{0,500}(?:remove|hidden|replaceChildren)/i);
    }
  });
});
