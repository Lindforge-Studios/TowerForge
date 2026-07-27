import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createCanvasRenderer } from "./index.mjs";

function markCombat(enemies = {}) {
  return {
    schemaVersion: 2,
    shields: { enemies: {}, towers: {} },
    marks: { enemies }
  };
}

function markEvent(overrides = {}) {
  return {
    type: "enemyMarkChanged",
    enemyId: "enemy-1",
    enemyTypeId: "crawler",
    markId: "exposed",
    previousStacks: 0,
    currentStacks: 2,
    previousRemaining: 0,
    remaining: 6,
    cause: "application",
    ...overrides
  };
}

function snapshot(grid, combat, lastEvents = []) {
  return {
    mapId: `map-${grid.kind}`,
    grid,
    tiles: [
      { q: 0, r: 0, terrain: "buildable" },
      { q: 1, r: 0, terrain: "path" }
    ],
    temporaryWaterTiles: [],
    towers: [],
    enemies: [{ id: "enemy-1", typeId: "crawler", hp: 5, maxHp: 5, pathProgress: 0 }],
    pathCenterline: [{ q: 1, r: 0 }, { q: 1, r: 1 }],
    pathRoutes: [],
    spawnCoord: { q: 1, r: 0 },
    lastEvents,
    ...(combat === undefined ? {} : { combat })
  };
}

function contextProbe() {
  const calls = [];
  const call = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    context: {
      beginPath: call("beginPath"),
      moveTo: call("moveTo"),
      lineTo: call("lineTo"),
      closePath: call("closePath"),
      fill: call("fill"),
      stroke: call("stroke"),
      arc: call("arc"),
      rect: call("rect"),
      clip: call("clip"),
      clearRect: call("clearRect"),
      fillRect: call("fillRect"),
      strokeRect: call("strokeRect"),
      fillText: call("fillText"),
      drawImage: call("drawImage"),
      save: call("save"),
      restore: call("restore"),
      translate: call("translate"),
      setLineDash: call("setLineDash"),
      set globalAlpha(_) {},
      set fillStyle(_) {},
      set strokeStyle(_) {},
      set lineWidth(_) {},
      set font(_) {},
      set textAlign(_) {},
      set textBaseline(_) {}
    }
  };
}

function rendererHarness() {
  const probe = contextProbe();
  const canvas = {
    width: 320,
    height: 240,
    getBoundingClientRect: () => ({ width: 320, height: 240, left: 0, top: 0 }),
    getContext: () => probe.context
  };
  return {
    probe,
    renderer: createCanvasRenderer({
      canvas,
      content: { towers: {}, enemies: { crawler: { color: 0x88aa66 } } }
    })
  };
}

const grids = [
  { kind: "hex", layout: "odd-r" },
  { kind: "square", adjacency: "cardinal" }
];

describe("Canvas opt-in mark presentation", () => {
  it.each(grids)("draws bounded mark stack badges on $kind grids", (grid) => {
    const marks = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
      `mark_${String(index).padStart(2, "0")}`,
      { stacks: index + 1, remaining: 10 - index / 10 }
    ]));
    const { renderer, probe } = rendererHarness();
    renderer.drawSnapshot(snapshot(grid, markCombat({ "enemy-1": marks })));

    const texts = probe.calls.filter((entry) => entry.name === "fillText").map((entry) => entry.args[0]);
    expect(texts).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "+2"]);
    expect(texts).toHaveLength(9);
  });

  it.each(grids)("projects an enemyMarkChanged transient cue on $kind grids", (grid) => {
    const { renderer } = rendererHarness();
    const input = snapshot(
      grid,
      markCombat({ "enemy-1": { exposed: { stacks: 2, remaining: 6 } } }),
      [markEvent()]
    );
    renderer.drawSnapshot(input);

    const expected = renderer.enemyPoint(input.enemies[0], input, renderer.geometry(input.tiles, grid));
    const effects = renderer.effects.filter((effect) => effect.kind === "mark");
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ cause: "application", markId: "exposed", stacks: 2 });
    expect(effects[0].x).toBeCloseTo(expected.x);
    expect(effects[0].y).toBeCloseTo(expected.y);
  });

  it.each(grids)("keeps absent/v1/future-v3 snapshots on the no-mark draw path for $kind grids", (grid) => {
    const variants = [
      snapshot(grid, undefined),
      snapshot(grid, { schemaVersion: 1, shields: { enemies: {}, towers: {} } }, [markEvent()]),
      snapshot(grid, {
        schemaVersion: 3,
        shields: { enemies: {}, towers: {} },
        marks: { enemies: { "enemy-1": { exposed: { stacks: 2, remaining: 6 } } } }
      }, [markEvent()])
    ];
    for (const variant of variants) {
      const { renderer, probe } = rendererHarness();
      renderer.drawSnapshot(variant);
      expect(probe.calls.filter((entry) => entry.name === "fillText")).toEqual([]);
      expect(renderer.effects.some((effect) => effect.kind === "mark")).toBe(false);
    }
  });

  it("keeps gameplay mark rules out of the Canvas adapter", () => {
    const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(?:consumePolicy|damageTypes|multiplier|maxStacks)\b/);
    expect(source).not.toMatch(/combat\?*\.marks|combat\[\s*["']marks["']\s*\]/);
  });
});
