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
  return [functionSource(buildSource, "playerTemplate"), functionSource(buildSource, "phaserPlayerTemplate")];
}

describe("R5.8B generated Canvas/Phaser ammunition supply presentation RED", () => {
  it("ships the same strict v1/v2/v3 Logistics projector to both generated players", () => {
    expect(rendererIndex).toMatch(/export[\s\S]*projectLogisticsPresentation/);
    expect(projectorSource).toMatch(/schemaVersion\s*===?\s*3|schemaVersion\s*!==\s*3/);
    expect(projectorSource).toMatch(/supply[\s\S]*producers[\s\S]*storages[\s\S]*edges/);
    for (const source of players()) {
      expect(source).toMatch(/projectLogisticsPresentation/);
      expect(source).toMatch(/logistics-status/);
      expect(source).toMatch(/presentation\.supply|supply\.producers/);
    }
  });

  it("renders stock, progress, directed links, paused state, and refill relationships on Canvas and Phaser", () => {
    for (const source of players()) {
      const render = functionSource(source, "updateLogisticsStatus");
      expect(render).toMatch(/producers[\s\S]*storages|storages[\s\S]*producers/);
      expect(render).toMatch(/amount[\s\S]{0,300}capacity/);
      expect(render).toMatch(/productionProgress|transferProgress/);
      expect(render).toMatch(/logistics-supply-link-cue/);
      expect(render).toMatch(/logistics-supply-paused-cue/);
      expect(render).toMatch(/logistics-refill-cue/);
      expect(render).toMatch(/sourceTowerId[\s\S]{0,300}destinationTowerId/);
      expect(render).not.toMatch(/operational\s*=|powered\s*&&|amount\s*>=|progress\s*\+=/);
    }
  });

  it("adds no supply/refill command, player input, transfer simulation, or renderer topology", () => {
    for (const source of players()) {
      expect(source).not.toMatch(/type\s*:\s*["'](?:refill|transfer|produce)(?:Ammunition|Ammo|Supply)["']/i);
      expect(source).not.toMatch(/data-(?:refill|transfer|produce)-(?:button|input|command|toggle)/i);
      expect(source).not.toMatch(/(?:key|code)\s*===?\s*["'](?:KeyR|ReloadAmmo|TransferAmmo)["']/i);
    }
    expect(`${projectorSource}\n${players().join("\n")}`).not.toMatch(
      /topology\.distance|(?:build|compute|derive)(?:Supply|Transfer|Edge)|transferProgress\s*\+=|productionProgress\s*\+=/
    );
  });

  it("keeps all ordinary templates free of authored supply state and UI", () => {
    expect(TEMPLATE_NAMES).toEqual(["classic", "maze", "idle", "roguelike"]);
    for (const name of TEMPLATE_NAMES) {
      const template = getTemplate(name);
      expect(template.mechanics).toBeUndefined();
      expect(JSON.stringify(template.balance)).not.toMatch(
        /"logistics"\s*:|"supply"\s*:|"productionRecipes"\s*:|"producers"\s*:|"storages"\s*:/
      );
    }
  });
});
