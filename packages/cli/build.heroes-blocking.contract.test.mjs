import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");
const rendererSource = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
const presentationSource = fs.readFileSync(
  path.resolve("packages/renderer/src/heroes-presentation.mjs"), "utf8"
);

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

describe("R5.6A generated Canvas/Phaser authoritative hero-blocking presentation", () => {
  const players = () => [
    functionSource(buildSource, "playerTemplate"),
    functionSource(buildSource, "phaserPlayerTemplate")
  ];

  it("adds no blocking command, input mode, shortcut, or interactive control", () => {
    for (const source of players()) {
      expect(source).not.toMatch(/type\s*:\s*["'](?:toggle|start|stop|assign)HeroBlock/i);
      expect(source).not.toMatch(/kind\s*:\s*["']heroBlock/i);
      expect(source).not.toMatch(/data-hero-block(?:ing)?-(?:button|input|toggle)|id=["']hero-block/i);
      expect(source).not.toMatch(/GameCommandV?7|schemaVersion\s*:\s*7[\s\S]{0,120}heroBlock/i);
    }
  });

  it("drives Canvas and Phaser hold cues only from the shared authoritative projection", () => {
    const canvas = functionSource(buildSource, "playerTemplate");
    const phaser = functionSource(buildSource, "phaserPlayerTemplate");
    expect(canvas).toMatch(/createCanvasRenderer/);
    expect(rendererSource).toMatch(/projectHeroesPresentation\s*\(\s*snapshot\s*\)/);
    expect(`${rendererSource}\n${phaser}`).toMatch(
      /blocking[\s\S]{0,800}blockedEnemyIds|blockedEnemyIds[\s\S]{0,800}blocking/
    );
    expect(presentationSource).toMatch(/blockedEnemyIds/);
    expect(`${rendererSource}\n${phaser}`).not.toMatch(
      /blockedEnemyIds[\s\S]{0,700}(?:createGridTopology|topology\.distance|hexDistance|manhattanDistance|content\.mechanics|movementProfileIds)/i
    );
  });

  it("keeps literal v1-v6 and absent heroes on their existing presentation paths", () => {
    expect(presentationSource).toMatch(/schemaVersion\s*!==\s*1|schemaVersion\s*===\s*1/);
    expect(presentationSource).toMatch(/schemaVersion\s*!==\s*6|schemaVersion\s*===\s*6/);
    expect(presentationSource).toMatch(/schemaVersion\s*!==\s*7|schemaVersion\s*===\s*7/);
    for (const source of players()) expect(source).toMatch(/projectHeroesPresentation/);
  });
});
