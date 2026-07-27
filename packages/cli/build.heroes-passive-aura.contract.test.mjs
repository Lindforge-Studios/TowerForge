import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");
const rendererSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");

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

describe("R5.5A generated Canvas/Phaser passive hero aura presentation", () => {
  const players = () => [
    functionSource(buildSource, "playerTemplate"),
    functionSource(buildSource, "phaserPlayerTemplate")
  ];

  it("adds no aura command, targeting mode, keyboard shortcut, or interactive control", () => {
    for (const source of players()) {
      expect(source).not.toMatch(/type\s*:\s*["'](?:toggle|activate|use)HeroAura["']/i);
      expect(source).not.toMatch(/kind\s*:\s*["']heroAura["']/i);
      expect(source).not.toMatch(/data-hero-aura-(?:button|input|toggle)|id=["']hero-aura-(?:button|input|toggle)/i);
      expect(source).not.toMatch(/GameCommandV?7|schemaVersion\s*:\s*7[\s\S]{0,100}heroAura/i);
    }
  });

  it("drives Canvas and Phaser cues only from the shared authoritative projection", () => {
    const canvas = functionSource(buildSource, "playerTemplate");
    const phaser = functionSource(buildSource, "phaserPlayerTemplate");
    expect(canvas).toMatch(/createCanvasRenderer/);
    expect(rendererSource).toMatch(/projectHeroesPresentation\s*\(\s*snapshot\s*\)/);
    expect(rendererSource).toMatch(/passiveAura[\s\S]{0,500}affectedTowerIds|affectedTowerIds[\s\S]{0,500}passiveAura/);
    expect(phaser).toMatch(/projectHeroesPresentation/);
    expect(phaser).toMatch(/passiveAura[\s\S]{0,700}affectedTowerIds|affectedTowerIds[\s\S]{0,700}passiveAura/);
    expect(`${rendererSource}\n${phaser}`).not.toMatch(
      /passiveAura[\s\S]{0,600}(?:createGridTopology|topology\.distance|hexDistance|manhattanDistance|content\.mechanics)/i
    );
  });

  it("retains null/absent legacy UI and does not synthesize a skill panel for skills:null", () => {
    for (const source of players()) {
      expect(source).toMatch(/projectHeroesPresentation/);
      expect(source).toMatch(/(?:unit|hero)\?*\.skills|skills\s*\?/);
      expect(source).toMatch(/if\s*\(\s*!skills\s*\)[\s\S]{0,160}(?:remove|return)/);
    }
  });
});
