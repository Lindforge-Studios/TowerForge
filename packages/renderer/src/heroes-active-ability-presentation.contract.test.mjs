import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

function abilitySnapshot(overrides = {}) {
  return {
    heroes: {
      schemaVersion: 4,
      units: [{
        id: "commander",
        definitionId: "commander",
        label: "Commander",
        coord: { q: 1, r: 2 },
        movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 },
        durability: {
          hp: 100, maxHp: 100, shield: { current: 10, capacity: 20 }, defeated: false
        },
        mana: { current: 40, max: 100, regenerationPerUnit: 5 },
        activeAbility: {
          id: "arc_bolt",
          label: "Arc Bolt",
          target: "enemy",
          manaCost: 20,
          cooldown: 3,
          cooldownRemaining: 0,
          range: 8,
          damage: 30,
          ready: true
        },
        ...overrides
      }]
    }
  };
}

describe("R5.3A shared hero active-ability presentation", () => {
  it("projects and deeply freezes the exact authoritative v4 unit", () => {
    const source = abilitySnapshot();
    const projected = Renderer.projectHeroesPresentation(source);

    expect(projected).toEqual({ active: true, units: [source.heroes.units[0]] });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.units)).toBe(true);
    expect(Object.isFrozen(projected.units[0])).toBe(true);
    expect(Object.isFrozen(projected.units[0].mana)).toBe(true);
    expect(Object.isFrozen(projected.units[0].activeAbility)).toBe(true);
    source.heroes.units[0].mana.current = 0;
    source.heroes.units[0].activeAbility.ready = false;
    expect(projected.units[0].mana.current).toBe(40);
    expect(projected.units[0].activeAbility.ready).toBe(true);
  });

  it("accepts authoritative cooldown/mana states and fails closed for malformed invariants", () => {
    expect(Renderer.projectHeroesPresentation(abilitySnapshot({
      mana: { current: 5, max: 100, regenerationPerUnit: 0 },
      activeAbility: {
        id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 20,
        cooldown: 3, cooldownRemaining: 1.25, range: 8, damage: 30, ready: false
      }
    }))).toMatchObject({
      active: true,
      units: [{ mana: { current: 5 }, activeAbility: { cooldownRemaining: 1.25, ready: false } }]
    });

    for (const overrides of [
      { mana: { current: -1, max: 100, regenerationPerUnit: 5 } },
      { mana: { current: 101, max: 100, regenerationPerUnit: 5 } },
      { mana: { current: 40, max: 100, regenerationPerUnit: -1 } },
      { activeAbility: { ...abilitySnapshot().heroes.units[0].activeAbility, target: "tile" } },
      { activeAbility: { ...abilitySnapshot().heroes.units[0].activeAbility, cooldownRemaining: 4 } },
      { activeAbility: { ...abilitySnapshot().heroes.units[0].activeAbility, manaCost: 0 } },
      { activeAbility: { ...abilitySnapshot().heroes.units[0].activeAbility, range: 1.5 } },
      { activeAbility: { ...abilitySnapshot().heroes.units[0].activeAbility, ready: false } },
      { activeAbility: { ...abilitySnapshot().heroes.units[0].activeAbility, extra: true } },
      { mana: { current: 40, max: 100, regenerationPerUnit: 5, extra: true } }
    ]) {
      expect(Renderer.projectHeroesPresentation(abilitySnapshot(overrides)))
        .toEqual({ active: false, units: [] });
    }
  });

  it("treats v5 as future and retains v1-v3 compatibility", () => {
    expect(Renderer.projectHeroesPresentation({
      heroes: { ...abilitySnapshot().heroes, schemaVersion: 5 }
    })).toEqual({ active: false, units: [] });
    expect(Renderer.projectHeroesPresentation({
      heroes: {
        schemaVersion: 3,
        units: [{
          id: "commander", definitionId: "commander", label: "Commander", coord: { q: 1, r: 2 },
          movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 },
          durability: { hp: 10, maxHp: 10, shield: null, defeated: false }
        }]
      }
    })).toMatchObject({ active: true, units: [{ durability: { hp: 10 } }] });
  });

  it("selects only live enemy presentation targets with deterministic binary ties", () => {
    const enemies = [
      { id: "zeta", hp: 10, point: { x: 3, y: 4 } },
      { id: "alpha", hp: 10, point: { x: -3, y: -4 } },
      { id: "dead", hp: 0, point: { x: 0, y: 0 } }
    ];
    const project = (enemy) => enemy.point;
    expect(Renderer.selectHeroAbilityEnemy(enemies, { x: 0, y: 0 }, project)).toBe("alpha");
    expect(Renderer.selectHeroAbilityEnemy(enemies, { x: 3, y: 4 }, project, 1)).toBe("zeta");
    expect(Renderer.selectHeroAbilityEnemy(enemies, { x: 0, y: 0 }, project, 1)).toBeNull();
  });
});
