import { describe, expect, it } from "vitest";
import {
  projectLegacyPresentationEvents,
  projectSnapshotSpawnCoord,
  projectShieldPresentationCues,
  resolveShieldPresentation
} from "./combat-presentation.mjs";
import * as CombatPresentation from "./combat-presentation.mjs";

// Project schemas currently require positive integer map dimensions but do not
// publish a dimension ceiling. Keep presentation-only detached coordinates
// within a local one-million-cell axis budget (also matching the engine's
// default stable-digest node budget) so malformed snapshots cannot create
// unbounded Canvas/Phaser geometry.
const MAX_PRESENTATION_COORDINATE = 1_000_000;

function combatV1() {
  return {
    schemaVersion: 1,
    shields: { enemies: {}, towers: {} }
  };
}

function combatV2({ enemies = {} } = {}) {
  return {
    schemaVersion: 2,
    shields: { enemies: {}, towers: {} },
    marks: { enemies }
  };
}

function snapshot(events, combat = combatV1()) {
  return { combat, lastEvents: events };
}

function shieldEvent({
  type = "enemyShieldChanged",
  runtimeId = "enemy-1",
  cause = "damage",
  previous = 10,
  current = 6,
  capacity = 10,
  amount = 4
} = {}) {
  return {
    type,
    ...(type === "towerShieldChanged" ? { towerId: runtimeId } : { enemyId: runtimeId }),
    cause,
    previous,
    current,
    capacity,
    amount
  };
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

describe("projectShieldPresentationCues", () => {
  it("projects a terminal shield event after combat state is removed", () => {
    expect(projectShieldPresentationCues({
      lastEvents: [shieldEvent({ runtimeId: "removed", previous: 5, current: 0, amount: 5 })]
    })).toEqual([{
      kind: "enemy",
      runtimeId: "removed",
      cause: "damage",
      change: "break",
      previous: 5,
      current: 0,
      capacity: 10,
      amount: 5
    }]);
  });

  it("projects damage, break, regeneration and script cues without inventing gameplay fields", () => {
    const result = projectShieldPresentationCues(snapshot([
      shieldEvent(),
      shieldEvent({ runtimeId: "enemy-broken", previous: 3, current: 0, amount: 3 }),
      shieldEvent({ runtimeId: "enemy-regenerating", cause: "regeneration", previous: 4, current: 5, amount: 1 }),
      shieldEvent({
        type: "towerShieldChanged",
        runtimeId: "tower-scripted",
        cause: "script",
        previous: 0,
        current: 8,
        capacity: 12,
        amount: 8
      })
    ]));

    expect(result).toEqual([
      {
        kind: "enemy", runtimeId: "enemy-1", cause: "damage", change: "damage",
        previous: 10, current: 6, capacity: 10, amount: 4
      },
      {
        kind: "enemy", runtimeId: "enemy-broken", cause: "damage", change: "break",
        previous: 3, current: 0, capacity: 10, amount: 3
      },
      {
        kind: "enemy", runtimeId: "enemy-regenerating", cause: "regeneration", change: "regeneration",
        previous: 4, current: 5, capacity: 10, amount: 1
      },
      {
        kind: "tower", runtimeId: "tower-scripted", cause: "script", change: "script",
        previous: 0, current: 8, capacity: 12, amount: 8
      }
    ]);
  });

  it("accepts v2 shield state but fails closed for future schemas, malformed events and accessor-backed input", () => {
    const v2Combat = combatV2();
    v2Combat.shields.enemies["enemy-1"] = {
      current: 4,
      capacity: 10,
      regenerationDelayRemaining: 0
    };
    expect(resolveShieldPresentation({ combat: v2Combat }, "enemy", "enemy-1"))
      .toEqual({ current: 4, capacity: 10, ratio: 0.4, regenerationDelayRemaining: 0 });
    expect(projectShieldPresentationCues(snapshot([shieldEvent()], v2Combat))).toHaveLength(1);

    const futureCombat = { schemaVersion: 3, shields: { enemies: {}, towers: {} } };
    expect(projectShieldPresentationCues(snapshot([shieldEvent()], futureCombat))).toEqual([]);

    const malformed = [
      null,
      shieldEvent({ type: "futureShieldChanged" }),
      shieldEvent({ cause: "future-cause" }),
      shieldEvent({ runtimeId: null }),
      shieldEvent({ capacity: 0 }),
      shieldEvent({ amount: -1 }),
      shieldEvent({ current: Number.NaN })
    ];
    expect(projectShieldPresentationCues(snapshot(malformed))).toEqual([]);

    const accessorEvent = {};
    Object.defineProperty(accessorEvent, "type", {
      enumerable: true,
      get() { throw new Error("presentation projection must not invoke event accessors"); }
    });
    expect(() => projectShieldPresentationCues(snapshot([accessorEvent]))).not.toThrow();
    expect(projectShieldPresentationCues(snapshot([accessorEvent]))).toEqual([]);

    const accessorSnapshot = { combat: combatV1() };
    Object.defineProperty(accessorSnapshot, "lastEvents", {
      enumerable: true,
      get() { throw new Error("presentation projection must not invoke snapshot accessors"); }
    });
    expect(() => projectShieldPresentationCues(accessorSnapshot)).not.toThrow();
    expect(projectShieldPresentationCues(accessorSnapshot)).toEqual([]);
  });

  it("processes at most 256 events per snapshot", () => {
    const events = Array.from({ length: 300 }, (_, index) => shieldEvent({ runtimeId: `enemy-${index}` }));
    const result = projectShieldPresentationCues(snapshot(events));

    expect(result).toHaveLength(256);
    expect(result[0].runtimeId).toBe("enemy-0");
    expect(result[255].runtimeId).toBe("enemy-255");
    expect(result.some((cue) => cue.runtimeId === "enemy-256")).toBe(false);
  });

  it("does not mutate a frozen snapshot and returns detached cue objects", () => {
    const input = deepFreeze(snapshot([
      shieldEvent(),
      shieldEvent({ type: "towerShieldChanged", runtimeId: "tower-1", cause: "script" })
    ]));
    const before = JSON.stringify(input);

    const result = projectShieldPresentationCues(input);
    expect(JSON.stringify(input)).toBe(before);

    result[0].current = 999;
    result.push({ kind: "enemy", runtimeId: "detached" });
    expect(input.lastEvents[0].current).toBe(6);
    expect(input.lastEvents).toHaveLength(2);
  });
});

describe("combat v2 mark presentation", () => {
  it("projects bounded enemy mark badges in binary id order with an overflow count", () => {
    const resolve = CombatPresentation.resolveMarkPresentation;
    expect(typeof resolve).toBe("function");
    if (typeof resolve !== "function") return;

    const marks = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
      `mark_${String(11 - index).padStart(2, "0")}`,
      { stacks: index + 1, remaining: 20 - index }
    ]));
    const result = resolve({ combat: combatV2({ enemies: { "enemy-1": marks } }) }, "enemy-1");

    expect(result.entries).toHaveLength(8);
    expect(result.entries.map((entry) => entry.markId)).toEqual([
      "mark_00", "mark_01", "mark_02", "mark_03",
      "mark_04", "mark_05", "mark_06", "mark_07"
    ]);
    expect(result.entries[0]).toEqual({ markId: "mark_00", stacks: 12, remaining: 9 });
    expect(result.overflowCount).toBe(4);
  });

  it("projects a terminal enemyMarkChanged cue even after optional combat state is removed", () => {
    const project = CombatPresentation.projectMarkPresentationCues;
    expect(typeof project).toBe("function");
    if (typeof project !== "function") return;

    expect(project({
      lastEvents: [{
        type: "enemyMarkChanged",
        enemyId: "enemy-removed",
        enemyTypeId: "grunt",
        markId: "exposed",
        previousStacks: 1,
        currentStacks: 0,
        previousRemaining: 2,
        remaining: 0,
        cause: "expiration"
      }]
    })).toEqual([{
      kind: "enemy",
      runtimeId: "enemy-removed",
      enemyTypeId: "grunt",
      markId: "exposed",
      cause: "expiration",
      previousStacks: 1,
      currentStacks: 0,
      previousRemaining: 2,
      remaining: 0
    }]);
  });

  it("rejects mark events under v1/future combat schemas and bounds event projection", () => {
    const project = CombatPresentation.projectMarkPresentationCues;
    expect(typeof project).toBe("function");
    if (typeof project !== "function") return;

    const event = {
      type: "enemyMarkChanged",
      enemyId: "enemy-1",
      enemyTypeId: "grunt",
      markId: "exposed",
      previousStacks: 0,
      currentStacks: 1,
      previousRemaining: 0,
      remaining: 3,
      cause: "application"
    };
    expect(project({ combat: combatV1(), lastEvents: [event] })).toEqual([]);
    expect(project({ combat: { schemaVersion: 3 }, lastEvents: [event] })).toEqual([]);
    expect(project({ combat: combatV2(), lastEvents: Array.from({ length: 300 }, () => event) }))
      .toHaveLength(256);
  });
});

describe("projectLegacyPresentationEvents", () => {
  it("safely projects a detached tower placement coordinate for terminal shield fallback", () => {
    const coord = { q: 3, r: 4 };
    const projected = projectLegacyPresentationEvents({
      lastEvents: [{ type: "towerPlaced", towerId: "tower-1", coord }]
    });
    expect(projected).toEqual([{
      type: "towerPlaced",
      towerId: "tower-1",
      coord: { q: 3, r: 4 }
    }]);
    expect(projected[0].coord).not.toBe(coord);

    const accessorEvent = { type: "towerPlaced", towerId: "tower-accessor" };
    Object.defineProperty(accessorEvent, "coord", {
      enumerable: true,
      get() { throw new Error("legacy presentation must not invoke placement accessors"); }
    });
    expect(() => projectLegacyPresentationEvents({ lastEvents: [accessorEvent] })).not.toThrow();
    expect(projectLegacyPresentationEvents({ lastEvents: [accessorEvent] })).toEqual([]);
  });

  it("processes only the first 256 array entries without invoking accessors in the tail", () => {
    const events = new Array(300);
    events[0] = { type: "enemyHit", enemyId: "enemy-1", damage: 3 };
    events[2] = { type: "towerFired", towerId: "tower-1" };
    events[255] = { type: "enemyLeaked" };
    let tailGetterReads = 0;
    Object.defineProperty(events, "256", {
      enumerable: true,
      configurable: true,
      get() {
        tailGetterReads += 1;
        throw new Error("legacy presentation must not invoke accessors beyond its event budget");
      }
    });
    events[299] = { type: "enemyKilled", enemyId: "tail", enemyTypeId: "crawler" };

    expect(projectLegacyPresentationEvents({ lastEvents: events })).toEqual([
      { type: "enemyHit", enemyId: "enemy-1", damage: 3 },
      { type: "towerFired", towerId: "tower-1" },
      { type: "enemyLeaked" }
    ]);
    expect(tailGetterReads).toBe(0);
  });
});

describe("bounded presentation coordinates", () => {
  it("accepts and detaches non-negative integer coordinates at the local presentation bound", () => {
    const coord = { q: MAX_PRESENTATION_COORDINATE, r: 0 };
    const projected = projectSnapshotSpawnCoord({ spawnCoord: coord });
    expect(projected).toEqual(coord);
    expect(projected).not.toBe(coord);
  });

  it.each([
    ["fractional", { q: 1.5, r: 2 }],
    ["unsafe integer", { q: Number.MAX_SAFE_INTEGER + 1, r: 2 }],
    ["over local budget", { q: MAX_PRESENTATION_COORDINATE + 1, r: 2 }],
    ["negative", { q: -1, r: 2 }]
  ])("rejects a %s snapshot spawn coordinate", (_label, coord) => {
    expect(projectSnapshotSpawnCoord({ spawnCoord: coord })).toBeNull();
  });

  it.each([
    ["fractional", { q: 2, r: 3.25 }],
    ["unsafe integer", { q: 2, r: Number.MIN_SAFE_INTEGER - 1 }],
    ["over local budget", { q: 2, r: MAX_PRESENTATION_COORDINATE + 1 }],
    ["negative", { q: 2, r: -1 }]
  ])("rejects a towerPlaced event with a %s coordinate", (_label, coord) => {
    expect(projectLegacyPresentationEvents({
      lastEvents: [{ type: "towerPlaced", towerId: "tower-1", coord }]
    })).toEqual([]);
  });

  it("does not invoke snapshot or coordinate accessors while rejecting them", () => {
    let accessorReads = 0;
    const coord = { r: 1 };
    Object.defineProperty(coord, "q", {
      enumerable: true,
      get() {
        accessorReads += 1;
        throw new Error("coordinate accessor must not be invoked");
      }
    });
    const spawnSnapshot = {};
    Object.defineProperty(spawnSnapshot, "spawnCoord", {
      enumerable: true,
      get() {
        accessorReads += 1;
        throw new Error("snapshot accessor must not be invoked");
      }
    });

    expect(() => projectSnapshotSpawnCoord(spawnSnapshot)).not.toThrow();
    expect(projectSnapshotSpawnCoord(spawnSnapshot)).toBeNull();
    expect(() => projectLegacyPresentationEvents({
      lastEvents: [{ type: "towerPlaced", towerId: "tower-1", coord }]
    })).not.toThrow();
    expect(projectLegacyPresentationEvents({
      lastEvents: [{ type: "towerPlaced", towerId: "tower-1", coord }]
    })).toEqual([]);
    expect(accessorReads).toBe(0);
  });
});
