import { describe, expect, it, vi } from "vitest";
import { tickHeadless } from "./headless.js";
import type { TowerDefenseGame } from "./TowerDefenseGame.js";

function clock() {
  let elapsed = 0;
  const tick = vi.fn((units: number) => { elapsed += Math.max(0, Math.min(units, 0.2)); });
  return { game: { tick } as unknown as TowerDefenseGame, tick, elapsed: () => elapsed };
}

describe("headless time contract", () => {
  it.each([0.01, 0.1, 0.2, 1, 10])("advances the complete duration with step %s and a remainder", (step) => {
    const c = clock();
    tickHeadless(c.game, 10.037, step);
    expect(c.elapsed()).toBeCloseTo(10.037, 10);
    expect(c.tick.mock.calls.every(([units]) => units > 0 && units <= 0.2)).toBe(true);
  });
  it.each([NaN, Infinity, -Infinity, -1])("rejects invalid duration %s before mutation", (units) => {
    const c = clock();
    c.tick.mockImplementation(() => { throw new Error("Invalid input reached tick"); });
    expect(() => tickHeadless(c.game, units)).toThrow(RangeError);
    expect(c.tick).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -Infinity, -1, 0])("rejects invalid step %s before mutation", (step) => {
    const c = clock();
    c.tick.mockImplementation(() => { throw new Error("Invalid input reached tick"); });
    expect(() => tickHeadless(c.game, 1, step)).toThrow(RangeError);
    expect(c.tick).not.toHaveBeenCalled();
  });
  it("keeps zero duration inert", () => {
    const c = clock();
    tickHeadless(c.game, 0);
    expect(c.tick).not.toHaveBeenCalled();
  });
});
