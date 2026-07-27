import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

function auraSnapshot(overrides = {}) {
  return {
    heroes: {
      schemaVersion: 6,
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
          id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 20,
          cooldown: 3, cooldownRemaining: 0, range: 8, damage: 30, ready: true
        },
        skills: null,
        passiveAura: {
          id: "command_link",
          label: "Command Link",
          radius: 3,
          active: true,
          affectedTowerIds: ["tower_10", "tower_2"]
        },
        ...overrides
      }]
    }
  };
}

describe("R5.5A shared passive hero aura presentation", () => {
  it("detaches and freezes the exact authoritative v6 aura membership", () => {
    const source = auraSnapshot();
    const projected = Renderer.projectHeroesPresentation(source);

    expect(projected).toEqual({ active: true, units: [source.heroes.units[0]] });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.units)).toBe(true);
    expect(Object.isFrozen(projected.units[0])).toBe(true);
    expect(Object.isFrozen(projected.units[0].passiveAura)).toBe(true);
    expect(Object.isFrozen(projected.units[0].passiveAura.affectedTowerIds)).toBe(true);

    source.heroes.units[0].passiveAura.active = false;
    source.heroes.units[0].passiveAura.affectedTowerIds.splice(0);
    expect(projected.units[0].passiveAura).toMatchObject({
      active: true,
      affectedTowerIds: ["tower_10", "tower_2"]
    });
  });

  it("trusts published active state and tower ids without deriving phase, distance, or membership", () => {
    const projected = Renderer.projectHeroesPresentation(auraSnapshot({
      coord: { q: 0, r: 0 },
      durability: { hp: 100, maxHp: 100, shield: { current: 10, capacity: 20 }, defeated: false },
      activeAbility: {
        id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 20,
        cooldown: 3, cooldownRemaining: 0, range: 8, damage: 30, ready: true
      },
      passiveAura: {
        id: "command_link", label: "Command Link", radius: 0, active: true,
        affectedTowerIds: ["authoritative_far_tower"]
      }
    }));

    expect(projected).toMatchObject({
      active: true,
      units: [{
        durability: { defeated: false },
        passiveAura: { active: true, radius: 0, affectedTowerIds: ["authoritative_far_tower"] }
      }]
    });
  });

  it("accepts independent nullable skills and an inactive empty aura", () => {
    const projected = Renderer.projectHeroesPresentation(auraSnapshot({
      skills: null,
      passiveAura: {
        id: "command_link", label: "Command Link", radius: 65_536,
        active: false, affectedTowerIds: []
      }
    }));
    expect(projected).toMatchObject({
      active: true,
      units: [{ skills: null, passiveAura: { active: false, affectedTowerIds: [] } }]
    });
  });

  it("preserves authoritative terminal ready and aura state without reconstructing outcome", () => {
    for (const outcome of ["victory", "defeat"]) {
      const snapshot = auraSnapshot({
        activeAbility: {
          id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 20,
          cooldown: 3, cooldownRemaining: 0, range: 8, damage: 30, ready: false
        },
        passiveAura: {
          id: "command_link", label: "Command Link", radius: 3,
          active: false, affectedTowerIds: []
        }
      });
      snapshot.outcome = outcome;

      expect(Renderer.projectHeroesPresentation(snapshot)).toMatchObject({
        active: true,
        units: [{
          durability: { defeated: false },
          activeAbility: { ready: false },
          passiveAura: { active: false, affectedTowerIds: [] }
        }]
      });
    }
  });

  it("rejects impossible active aura state for a defeated hero", () => {
    expect(Renderer.projectHeroesPresentation(auraSnapshot({
      durability: { hp: 0, maxHp: 100, shield: { current: 0, capacity: 20 }, defeated: true },
      activeAbility: {
        id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 20,
        cooldown: 3, cooldownRemaining: 0, range: 8, damage: 30, ready: false
      },
      passiveAura: {
        id: "command_link", label: "Command Link", radius: 3,
        active: true, affectedTowerIds: ["tower_1"]
      }
    }))).toEqual({ active: false, units: [] });
  });

  it("[verifier] accepts the engine-owned 65,536 affected-tower snapshot budget", () => {
    const affectedTowerIds = Array.from(
      { length: 4_097 },
      (_, index) => `tower_${String(index).padStart(5, "0")}`
    );
    const projected = Renderer.projectHeroesPresentation(auraSnapshot({
      passiveAura: {
        id: "command_link", label: "Command Link", radius: 65_536, active: true,
        affectedTowerIds
      }
    }));

    expect(projected.active).toBe(true);
    expect(projected.units[0].passiveAura.affectedTowerIds).toEqual(affectedTowerIds);
  });

  it("fails closed for malformed, hostile, sparse, duplicate, unsorted, or future aura snapshots", () => {
    const valid = auraSnapshot().heroes.units[0];
    const sparse = ["tower_1", "tower_2"];
    delete sparse[0];
    const hostileAura = {};
    Object.defineProperty(hostileAura, "id", { enumerable: true, get() { throw new Error("no read"); } });
    for (const passiveAura of [
      { ...valid.passiveAura, radius: -1 },
      { ...valid.passiveAura, radius: 65_537 },
      { ...valid.passiveAura, active: false },
      { ...valid.passiveAura, affectedTowerIds: ["tower_2", "tower_10"] },
      { ...valid.passiveAura, affectedTowerIds: ["tower_1", "tower_1"] },
      { ...valid.passiveAura, affectedTowerIds: sparse },
      { ...valid.passiveAura, extra: true },
      hostileAura,
      new Proxy(valid.passiveAura, { ownKeys() { throw new Error("hostile"); } })
    ]) {
      expect(Renderer.projectHeroesPresentation({
        heroes: { schemaVersion: 6, units: [{ ...valid, passiveAura }] }
      })).toEqual({ active: false, units: [] });
    }
    expect(Renderer.projectHeroesPresentation({
      heroes: { ...auraSnapshot().heroes, schemaVersion: 7 }
    })).toEqual({ active: false, units: [] });
  });
});
