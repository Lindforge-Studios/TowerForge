import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTemplate, TEMPLATE_NAMES } from "./lib/templates.mjs";

const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");
const rendererIndex = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
const logisticsPresentationPath = path.resolve("packages/renderer/src/logistics-power-presentation.mjs");

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

describe("R5.7A generated Canvas/Phaser power-grid presentation RED", () => {
  const players = () => [
    functionSource(buildSource, "playerTemplate"),
    functionSource(buildSource, "phaserPlayerTemplate")
  ];

  it("ships one shared Logistics snapshot projector to both generated players", () => {
    expect(fs.existsSync(logisticsPresentationPath)).toBe(true);
    expect(rendererIndex).toMatch(/export[\s\S]*projectLogisticsPresentation/);
    for (const source of players()) {
      expect(source).toMatch(/projectLogisticsPresentation/);
      expect(source).toMatch(/snapshot\.logistics|projectLogisticsPresentation\s*\(\s*(?:snap|snapshot)/);
      expect(source).toMatch(/logistics-status/);
    }
  });

  it("draws links, coverage, component supply, and brownout only from authoritative projection rows", () => {
    const presentation = fs.existsSync(logisticsPresentationPath)
      ? fs.readFileSync(logisticsPresentationPath, "utf8")
      : "";
    expect(presentation).toMatch(/components/);
    expect(presentation).toMatch(/linkTowerIds/);
    expect(presentation).toMatch(/coveredConsumerIds/);
    expect(presentation).toMatch(/powered/);
    expect(`${rendererIndex}\n${players().join("\n")}`).toMatch(/brownout|unpowered|allocated/i);
    expect(`${presentation}\n${players().join("\n")}`).not.toMatch(
      /createGridTopology|topology\.distance|hexDistance|manhattanDistance|linkRadius|coverageRadius|content\.mechanics/
    );
    for (const source of players()) {
      const render = functionSource(source, "updateLogisticsStatus");
      expect(render).toMatch(/logistics-link-cue/);
      expect(render).toMatch(/logistics-coverage-cue/);
      expect(render).toMatch(/node\.linkTowerIds[\s\S]{0,800}(?:textContent|append|lineTo|stroke)/);
      expect(render).toMatch(/node\.coveredConsumerIds[\s\S]{0,800}(?:textContent|append|lineTo|stroke)/);
      expect(render).not.toMatch(/dataset\.(?:linkCount|coveredConsumerCount)/);
    }
  });

  it("adds no command, input mode, button, keyboard shortcut, or headless action", () => {
    for (const source of players()) {
      expect(source).not.toMatch(/type\s*:\s*["'](?:connect|disconnect|toggle|assign)(?:Power|Logistics)/i);
      expect(source).not.toMatch(/kind\s*:\s*["'](?:power|logistics)(?:Connect|Assign|Toggle)/i);
      expect(source).not.toMatch(/data-(?:power|logistics)-(?:button|input|toggle|command)/i);
      expect(source).not.toMatch(/GameCommandV?7[\s\S]{0,160}(?:power|logistics)/i);
    }
  });

  it("keeps all four untouched templates free of authored Logistics and power UI state", () => {
    expect(TEMPLATE_NAMES).toEqual(["classic", "maze", "idle", "roguelike"]);
    for (const name of TEMPLATE_NAMES) {
      const template = getTemplate(name);
      expect(template.mechanics).toBeUndefined();
      expect(JSON.stringify(template.balance)).not.toMatch(/"logistics"\s*:|"power"\s*:/);
    }
  });
});
