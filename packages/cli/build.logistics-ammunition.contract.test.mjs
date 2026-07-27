import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTemplate, TEMPLATE_NAMES } from "./lib/templates.mjs";

const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");
const rendererIndex = fs.readFileSync(path.resolve("packages/renderer/src/index.mjs"), "utf8");
const projectorSource = fs.readFileSync(
  path.resolve("packages/renderer/src/logistics-power-presentation.mjs"), "utf8"
);

function functionSource(source, name, from = 0) {
  const start = source.indexOf(`function ${name}`, from);
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

function players() {
  return [
    functionSource(buildSource, "playerTemplate"),
    functionSource(buildSource, "phaserPlayerTemplate")
  ];
}

describe("R5.8A generated Canvas/Phaser ammunition presentation RED", () => {
  it("ships the shared v1/v2 Logistics projector to both generated players", () => {
    expect(rendererIndex).toMatch(/export[\s\S]*projectLogisticsPresentation/);
    expect(projectorSource).toMatch(/schemaVersion\s*===?\s*2|schemaVersion\s*!==\s*2/);
    expect(projectorSource).toMatch(/ammunition[\s\S]*inventories/);
    for (const source of players()) {
      expect(source).toMatch(/projectLogisticsPresentation/);
      expect(source).toMatch(/logistics-status/);
      expect(source).toMatch(/ammunition\.inventories|presentation\.ammunition/);
    }
  });

  it("renders visible amount/capacity and depleted cues in Canvas and Phaser without deriving ammo", () => {
    for (const source of players()) {
      const render = functionSource(source, "updateLogisticsStatus");
      expect(render).toMatch(/amount[\s\S]{0,300}capacity/);
      expect(render).toMatch(/logistics-ammunition-cue/);
      expect(render).toMatch(/logistics-depleted-cue/);
      expect(render).toMatch(/hasRequiredAmmo/);
      expect(render).not.toMatch(/hasRequiredAmmo\s*=|amount\s*>=\s*.*consumption/);
    }
    expect(`${projectorSource}\n${players().join("\n")}`).not.toMatch(
      /content\.mechanics|towerInventories|startingAmount|createAmmoInventory|resolveAmmunition/
    );
  });

  it("keeps power and ammunition cues independent and uses no combined operational state", () => {
    for (const source of players()) {
      const render = functionSource(source, "updateLogisticsStatus");
      expect(render).toMatch(/brownout|powered|allocated/i);
      expect(render).toMatch(/hasRequiredAmmo|depleted/);
      expect(render).not.toMatch(/(?:operational|canFire)\s*=|powered\s*&&\s*.*hasRequiredAmmo/);
    }
  });

  it("adds no refill command, player input, button, shortcut, or headless action", () => {
    for (const source of players()) {
      expect(source).not.toMatch(/type\s*:\s*["'](?:refill|transfer|reload)(?:Ammunition|Ammo)["']/i);
      expect(source).not.toMatch(/data-(?:ammo|ammunition)-(?:button|input|command|toggle)/i);
      expect(source).not.toMatch(/(?:key|code)\s*===?\s*["'](?:KeyR|ReloadAmmo)["']/i);
    }
  });

  it("keeps every ordinary template free of authored Logistics or ammunition state", () => {
    expect(TEMPLATE_NAMES).toEqual(["classic", "maze", "idle", "roguelike"]);
    for (const name of TEMPLATE_NAMES) {
      const template = getTemplate(name);
      expect(template.mechanics).toBeUndefined();
      expect(JSON.stringify(template.balance)).not.toMatch(/"logistics"\s*:|"ammunition"\s*:|"towerInventories"\s*:/);
    }
  });
});
