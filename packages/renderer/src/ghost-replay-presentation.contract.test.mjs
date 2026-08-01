import { describe, expect, it } from "vitest";
import * as renderer from "./index.mjs";

const frame = {
  schemaVersion: 1,
  ghost: true,
  sequence: 7,
  stateDigest: "tf-state-v1:0123456789abcdef",
  snapshot: {
    coreHp: 9,
    maxCoreHp: 10,
    towers: [
      { id: "tower-z", typeId: "cannon", coord: { q: 2, r: 0 } },
      { id: "tower-a", typeId: "pelter", coord: { q: 1, r: 0 } }
    ],
    enemies: [
      { id: "enemy-z", typeId: "grunt", hp: 3, maxHp: 10, pathProgress: 2 },
      { id: "enemy-a", typeId: "grunt", hp: 8, maxHp: 10, pathProgress: 1 }
    ]
  }
};

describe("R16.2 shared ghost replay presentation contract (RED)", () => {
  it("projects one detached binary-stable overlay from the immutable engine envelope", () => {
    expect(renderer.GHOST_REPLAY_PRESENTATION_LIMITS).toEqual({ towers: 4_096, enemies: 4_096 });
    expect(renderer.projectGhostReplayPresentation).toBeTypeOf("function");
    const source = structuredClone(frame);
    const projected = renderer.projectGhostReplayPresentation(source);
    expect(projected).toEqual({
      active: true,
      ghost: true,
      sequence: 7,
      stateDigest: frame.stateDigest,
      coreHp: 9,
      maxCoreHp: 10,
      towers: [
        { id: "tower-a", typeId: "pelter", coord: { q: 1, r: 0 } },
        { id: "tower-z", typeId: "cannon", coord: { q: 2, r: 0 } }
      ],
      enemies: [
        { id: "enemy-a", typeId: "grunt", hp: 8, maxHp: 10, pathProgress: 1 },
        { id: "enemy-z", typeId: "grunt", hp: 3, maxHp: 10, pathProgress: 2 }
      ],
      towerOverflow: 0,
      enemyOverflow: 0
    });
    source.snapshot.towers[0].coord.q = 99;
    expect(projected.towers[1].coord.q).toBe(2);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.towers)).toBe(true);
    expect(Object.isFrozen(projected.towers[0].coord)).toBe(true);
  });

  it("fails closed and truncates oversized authoritative rows without mutating input", () => {
    expect(renderer.projectGhostReplayPresentation({})).toEqual({ active: false, ghost: false, towers: [], enemies: [] });
    const hostile = structuredClone(frame);
    Object.defineProperty(hostile, "snapshot", { enumerable: true, get() { throw new Error("must not run"); } });
    expect(() => renderer.projectGhostReplayPresentation(hostile)).not.toThrow();
    expect(renderer.projectGhostReplayPresentation(hostile)).toBeUndefined();

    const oversized = structuredClone(frame);
    oversized.snapshot.towers = Array.from({ length: 4_098 }, (_, index) => ({
      id: `tower-${String(index).padStart(5, "0")}`,
      typeId: "pelter",
      coord: { q: index, r: 0 }
    }));
    const projected = renderer.projectGhostReplayPresentation(oversized);
    expect(projected.towers).toHaveLength(4_096);
    expect(projected.towerOverflow).toBe(2);
    expect(oversized.snapshot.towers).toHaveLength(4_098);
  });

  it("fails closed on nested hostile proxies and applies the row budget before traversal or sorting", () => {
    const hostileRow = structuredClone(frame);
    hostileRow.snapshot.towers[0] = new Proxy(hostileRow.snapshot.towers[0], {
      getOwnPropertyDescriptor() { throw new Error("nested row trap must stay contained"); }
    });
    expect(() => renderer.projectGhostReplayPresentation(hostileRow)).not.toThrow();
    expect(renderer.projectGhostReplayPresentation(hostileRow)).toBeUndefined();

    const hostileArray = structuredClone(frame);
    hostileArray.snapshot.enemies = new Proxy(hostileArray.snapshot.enemies, {
      getPrototypeOf() { return Array.prototype; },
      get(target, property, receiver) {
        if (property === "length") throw new Error("hostile length trap must stay contained");
        return Reflect.get(target, property, receiver);
      }
    });
    expect(() => renderer.projectGhostReplayPresentation(hostileArray)).not.toThrow();
    expect(renderer.projectGhostReplayPresentation(hostileArray)).toBeUndefined();

    let inspectedRows = 0;
    const bounded = structuredClone(frame);
    const rows = Array.from({ length: 4_098 }, (_, index) => ({
      id: `tower-${String(index).padStart(5, "0")}`,
      typeId: "pelter",
      coord: { q: index, r: 0 }
    }));
    bounded.snapshot.towers = new Proxy(rows, {
      getPrototypeOf() { return Array.prototype; },
      getOwnPropertyDescriptor(target, property) {
        if (/^\d+$/.test(String(property))) {
          inspectedRows += 1;
          if (Number(property) >= renderer.GHOST_REPLAY_PRESENTATION_LIMITS.towers) {
            throw new Error("row traversal exceeded the public presentation budget");
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
    });
    let projected;
    expect(() => { projected = renderer.projectGhostReplayPresentation(bounded); }).not.toThrow();
    expect(projected.towers).toHaveLength(renderer.GHOST_REPLAY_PRESENTATION_LIMITS.towers);
    expect(projected.towerOverflow).toBe(2);
    expect(inspectedRows).toBe(renderer.GHOST_REPLAY_PRESENTATION_LIMITS.towers);
  });
});
