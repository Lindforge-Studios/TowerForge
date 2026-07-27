import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

function movingSnapshot(overrides = {}) {
  return {
    heroes: {
      schemaVersion: 2,
      units: [{
        id: "commander",
        definitionId: "commander",
        label: "Commander",
        coord: { q: 1, r: 2 },
        movement: {
          targetCoord: { q: 4, r: 2 },
          nextCoord: { q: 2, r: 2 },
          edgeProgress: 0.25,
          ...overrides
        }
      }]
    }
  };
}

describe("R5.1B shared hero movement presentation", () => {
  it("accepts exact snapshot v2 movement while retaining the detached v1 projection", () => {
    const source = movingSnapshot();
    const projected = Renderer.projectHeroesPresentation(source);

    expect(projected).toEqual({
      active: true,
      units: [{
        id: "commander",
        definitionId: "commander",
        label: "Commander",
        coord: { q: 1, r: 2 },
        movement: {
          targetCoord: { q: 4, r: 2 },
          nextCoord: { q: 2, r: 2 },
          edgeProgress: 0.25
        }
      }]
    });
    expect(Object.isFrozen(projected.units[0].movement)).toBe(true);
    expect(Object.isFrozen(projected.units[0].movement.targetCoord)).toBe(true);
    source.heroes.units[0].movement.edgeProgress = 0.9;
    expect(projected.units[0].movement.edgeProgress).toBe(0.25);

    expect(Renderer.projectHeroesPresentation({
      heroes: { ...movingSnapshot().heroes, schemaVersion: 3 }
    })).toEqual({ active: false, units: [] });
  });

  it("interpolates and hit-tests through shared fail-closed renderer helpers", () => {
    const presentation = Renderer.projectHeroesPresentation(movingSnapshot());
    const coordToPoint = ({ q, r }) => ({ x: q * 40, y: r * 30 });

    expect(Renderer.projectHeroPresentationPoint).toBeTypeOf("function");
    expect(Renderer.hitTestHeroesPresentation).toBeTypeOf("function");
    expect(Renderer.projectHeroPresentationPoint(presentation.units[0], coordToPoint))
      .toEqual({ x: 50, y: 60 });
    expect(Renderer.hitTestHeroesPresentation(
      presentation,
      { x: 52, y: 61 },
      coordToPoint,
      8
    )).toBe("commander");
    expect(Renderer.hitTestHeroesPresentation(
      presentation,
      { x: 100, y: 100 },
      coordToPoint,
      8
    )).toBeNull();

    const malformed = Renderer.projectHeroesPresentation(movingSnapshot({ edgeProgress: 1.1 }));
    expect(malformed).toEqual({ active: false, units: [] });
    expect(() => Renderer.projectHeroPresentationPoint({ movement: {} }, coordToPoint)).not.toThrow();
    expect(Renderer.projectHeroPresentationPoint({ movement: {} }, coordToPoint)).toBeUndefined();
  });

  it("treats idle nullable movement as the current coordinate and rejects extra gameplay fields", () => {
    const idle = Renderer.projectHeroesPresentation(movingSnapshot({
      targetCoord: null,
      nextCoord: null,
      edgeProgress: 0
    }));
    const coordToPoint = ({ q, r }) => ({ x: q * 10, y: r * 20 });
    expect(Renderer.projectHeroPresentationPoint(idle.units[0], coordToPoint)).toEqual({ x: 10, y: 40 });

    const hostile = movingSnapshot();
    hostile.heroes.units[0].movement.path = [{ q: 2, r: 2 }];
    expect(Renderer.projectHeroesPresentation(hostile)).toEqual({ active: false, units: [] });
  });
});
