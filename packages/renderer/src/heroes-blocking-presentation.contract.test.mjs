import { describe, expect, it } from "vitest";
import * as Renderer from "./index.mjs";

function blockingSnapshot(overrides = {}) {
  return {
    heroes: {
      schemaVersion: 7,
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
        passiveAura: null,
        blocking: {
          blockCapacity: 2,
          active: true,
          blockedEnemyIds: ["enemy_10", "enemy_2"]
        },
        ...overrides
      }]
    }
  };
}

describe("R5.6A shared optional hero-blocking presentation", () => {
  it("detaches and freezes the exact authoritative v7 blocked-enemy assignment", () => {
    const source = blockingSnapshot();
    const projected = Renderer.projectHeroesPresentation(source);

    expect(projected).toEqual({ active: true, units: [source.heroes.units[0]] });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.units)).toBe(true);
    expect(Object.isFrozen(projected.units[0])).toBe(true);
    expect(Object.isFrozen(projected.units[0].blocking)).toBe(true);
    expect(Object.isFrozen(projected.units[0].blocking.blockedEnemyIds)).toBe(true);

    source.heroes.units[0].blocking.blockCapacity = 8;
    source.heroes.units[0].blocking.blockedEnemyIds.splice(0);
    expect(projected.units[0].blocking).toEqual({
      blockCapacity: 2,
      active: true,
      blockedEnemyIds: ["enemy_10", "enemy_2"]
    });
  });

  it("trusts engine-owned ids without deriving overlap, distance, route, or movement state", () => {
    const projected = Renderer.projectHeroesPresentation(blockingSnapshot({
      coord: { q: 0, r: 0 },
      movement: {
        targetCoord: { q: 9, r: 9 }, nextCoord: { q: 1, r: 0 }, edgeProgress: 0.5
      },
      blocking: {
        blockCapacity: 1,
        active: true,
        blockedEnemyIds: ["authoritative_far_enemy"]
      }
    }));

    expect(projected).toMatchObject({
      active: true,
      units: [{
        coord: { q: 0, r: 0 },
        blocking: {
          blockCapacity: 1,
          active: true,
          blockedEnemyIds: ["authoritative_far_enemy"]
        }
      }]
    });
  });

  it("keeps authoring opt-out on the literal legacy snapshot path instead of emitting v7 null", () => {
    const legacy = structuredClone(blockingSnapshot());
    legacy.heroes.schemaVersion = 6;
    legacy.heroes.units[0].passiveAura = {
      id: "command_link", label: "Command Link", radius: 3,
      active: false, affectedTowerIds: []
    };
    delete legacy.heroes.units[0].blocking;
    expect(Renderer.projectHeroesPresentation(legacy)).toMatchObject({
      active: true,
      units: [{ skills: null, passiveAura: expect.any(Object) }]
    });
    expect(Renderer.projectHeroesPresentation(blockingSnapshot({ blocking: null })))
      .toEqual({ active: false, units: [] });
  });

  it("accepts the closed capacity boundary and fails closed for malformed or future shapes", () => {
    const valid = blockingSnapshot().heroes.units[0];
    expect(Renderer.projectHeroesPresentation(blockingSnapshot({
      blocking: {
        blockCapacity: 64,
        active: true,
        blockedEnemyIds: Array.from({ length: 64 }, (_, index) => `enemy_${String(index).padStart(2, "0")}`)
      }
    })).active).toBe(true);

    const sparse = ["enemy_1", "enemy_2"];
    delete sparse[0];
    for (const blocking of [
      { blockCapacity: 0, active: true, blockedEnemyIds: [] },
      { blockCapacity: 65, active: true, blockedEnemyIds: [] },
      { blockCapacity: 1.5, active: true, blockedEnemyIds: [] },
      { blockCapacity: 1, active: true, blockedEnemyIds: ["enemy_1", "enemy_2"] },
      { blockCapacity: 2, active: true, blockedEnemyIds: ["enemy_2", "enemy_1"] },
      { blockCapacity: 2, active: true, blockedEnemyIds: ["enemy_1", "enemy_1"] },
      { blockCapacity: 2, active: true, blockedEnemyIds: sparse },
      { blockCapacity: 2, active: false, blockedEnemyIds: ["enemy_1"] },
      { blockCapacity: 2, active: true, blockedEnemyIds: [], extra: true },
      new Proxy(valid.blocking, { ownKeys() { throw new Error("hostile"); } })
    ]) {
      expect(Renderer.projectHeroesPresentation({
        heroes: { schemaVersion: 7, units: [{ ...valid, blocking }] }
      })).toEqual({ active: false, units: [] });
    }
    expect(Renderer.projectHeroesPresentation({
      heroes: { ...blockingSnapshot().heroes, schemaVersion: 8 }
    })).toEqual({ active: false, units: [] });
  });
});
