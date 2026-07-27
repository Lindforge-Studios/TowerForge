import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

function durableSnapshot(durability = {
  hp: 7,
  maxHp: 10,
  shield: { current: 0, capacity: 5 },
  defeated: false
}) {
  return {
    heroes: {
      schemaVersion: 3,
      units: [{
        id: "commander",
        definitionId: "commander",
        label: "Commander",
        coord: { q: 1, r: 2 },
        movement: {
          targetCoord: { q: 4, r: 2 },
          nextCoord: { q: 2, r: 2 },
          edgeProgress: 0.25
        },
        durability
      }]
    }
  };
}

describe("R5.2A shared hero durability presentation", () => {
  it("projects and deeply freezes the exact v3 durability section while retaining movement interpolation", () => {
    const source = durableSnapshot();
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
        },
        durability: {
          hp: 7,
          maxHp: 10,
          shield: { current: 0, capacity: 5 },
          defeated: false
        }
      }]
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.units[0])).toBe(true);
    expect(Object.isFrozen(projected.units[0].durability)).toBe(true);
    expect(Object.isFrozen(projected.units[0].durability.shield)).toBe(true);
    source.heroes.units[0].durability.hp = 1;
    source.heroes.units[0].durability.shield.current = 4;
    expect(projected.units[0].durability).toEqual({
      hp: 7, maxHp: 10, shield: { current: 0, capacity: 5 }, defeated: false
    });
    expect(Renderer.projectHeroPresentationPoint(
      projected.units[0],
      ({ q, r }) => ({ x: q * 40, y: r * 30 })
    )).toEqual({ x: 50, y: 60 });
  });

  it("accepts capacity-free heroes and fallen idle heroes, but fails closed for inconsistent durability", () => {
    expect(Renderer.projectHeroesPresentation(durableSnapshot({
      hp: 10, maxHp: 10, shield: null, defeated: false
    }))).toMatchObject({
      active: true,
      units: [{ durability: { hp: 10, maxHp: 10, shield: null, defeated: false } }]
    });
    expect(Renderer.projectHeroesPresentation({
      heroes: {
        ...durableSnapshot({
          hp: 0,
          maxHp: 10,
          shield: { current: 0, capacity: 5 },
          defeated: true
        }).heroes,
        units: [{
          ...durableSnapshot().heroes.units[0],
          movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 },
          durability: {
            hp: 0, maxHp: 10, shield: { current: 0, capacity: 5 }, defeated: true
          }
        }]
      }
    })).toMatchObject({
      active: true,
      units: [{
        movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 },
        durability: { hp: 0, defeated: true }
      }]
    });

    for (const malformed of [
      { hp: -1, maxHp: 10, shield: null, defeated: false },
      { hp: 11, maxHp: 10, shield: null, defeated: false },
      { hp: 1, maxHp: 10, shield: null, defeated: true },
      { hp: 0, maxHp: 10, shield: null, defeated: false },
      { hp: 7, maxHp: 10, shield: { current: 6, capacity: 5 }, defeated: false },
      { hp: 7, maxHp: 10, shield: { current: 0, capacity: 5, regeneration: 1 }, defeated: false },
      { hp: 7, maxHp: 10, shield: null, defeated: false, extra: true }
    ]) {
      expect(Renderer.projectHeroesPresentation(durableSnapshot(malformed)))
        .toEqual({ active: false, units: [] });
    }
  });

  it("preserves the exact existing v1/v2 projections", () => {
    expect(Renderer.projectHeroesPresentation({
      heroes: {
        schemaVersion: 1,
        units: [{
          id: "commander", definitionId: "commander", label: "Commander", coord: { q: 1, r: 2 }
        }]
      }
    })).toMatchObject({ active: true, units: [{ id: "commander", coord: { q: 1, r: 2 } }] });
    expect(Renderer.projectHeroesPresentation({
      heroes: {
        schemaVersion: 2,
        units: [{
          id: "commander", definitionId: "commander", label: "Commander", coord: { q: 1, r: 2 },
          movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 }
        }]
      }
    })).toMatchObject({
      active: true,
      units: [{ movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 } }]
    });
  });
});
