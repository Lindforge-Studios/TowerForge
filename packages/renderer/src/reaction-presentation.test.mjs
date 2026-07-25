import { describe, expect, it } from "vitest";
import * as Presentation from "./combat-presentation.mjs";

function reactionState(enemies = {}) {
  return { schemaVersion: 1, exposures: { enemies } };
}

function exposureEvent(overrides = {}) {
  return {
    type: "enemyExposureChanged",
    enemyId: "enemy-1",
    enemyTypeId: "grunt",
    exposureId: "fire",
    previousStacks: 0,
    currentStacks: 1,
    previousRemaining: 0,
    remaining: 4,
    cause: "damage",
    ...overrides
  };
}

function reactionEvent(overrides = {}) {
  return {
    type: "enemyReactionTriggered",
    reactionId: "shatter_fire_into_ice",
    originEnemyId: "enemy-1",
    originEnemyTypeId: "grunt",
    originCoord: { q: 3, r: 4 },
    triggerDamageType: "fire",
    depth: 1,
    scheduledTargetIds: ["enemy-1"],
    ...overrides
  };
}

describe("R1.5 shared reaction presentation projection", () => {
  it("projects at most eight binary-sorted exposure badges with an overflow count", () => {
    expect(typeof Presentation.resolveExposurePresentation).toBe("function");
    if (typeof Presentation.resolveExposurePresentation !== "function") return;
    const exposures = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
      `exposure_${String(11 - index).padStart(2, "0")}`,
      { stacks: index + 1, remaining: 20 - index }
    ]));
    const result = Presentation.resolveExposurePresentation({
      reactions: reactionState({ "enemy-1": exposures })
    }, "enemy-1");
    expect(result.entries).toHaveLength(8);
    expect(result.entries.map((entry) => entry.exposureId)).toEqual([
      "exposure_00", "exposure_01", "exposure_02", "exposure_03",
      "exposure_04", "exposure_05", "exposure_06", "exposure_07"
    ]);
    expect(result.overflowCount).toBe(4);
  });

  it("projects detached exposure and bounded reaction cues without gameplay definitions", () => {
    expect(typeof Presentation.projectExposurePresentationCues).toBe("function");
    expect(typeof Presentation.projectReactionPresentationCues).toBe("function");
    if (
      typeof Presentation.projectExposurePresentationCues !== "function"
      || typeof Presentation.projectReactionPresentationCues !== "function"
    ) return;
    const snapshot = {
      reactions: reactionState(),
      lastEvents: [exposureEvent(), ...Array.from({ length: 40 }, (_, index) => reactionEvent({
        reactionId: `reaction_${String(index).padStart(2, "0")}`,
        scheduledTargetIds: [`enemy-${index}`]
      }))]
    };
    expect(Presentation.projectExposurePresentationCues(snapshot)).toEqual([{
      kind: "exposure",
      runtimeId: "enemy-1",
      enemyTypeId: "grunt",
      exposureId: "fire",
      cause: "damage",
      previousStacks: 0,
      currentStacks: 1,
      previousRemaining: 0,
      remaining: 4
    }]);
    const cues = Presentation.projectReactionPresentationCues(snapshot);
    expect(cues).toHaveLength(32);
    expect(cues[0]).toMatchObject({
      kind: "reaction",
      reactionId: "reaction_00",
      originEnemyId: "enemy-1",
      originCoord: { q: 3, r: 4 },
      targetEnemyIds: ["enemy-0"]
    });
    cues[0].originCoord.q = 999;
    cues[0].targetEnemyIds.push("mutated");
    expect(snapshot.lastEvents[1].originCoord.q).toBe(3);
    expect(snapshot.lastEvents[1].scheduledTargetIds).toEqual(["enemy-0"]);
  });

  it("[verifier] collects up to 32 exposure cues from the bounded event window", () => {
    expect(typeof Presentation.projectExposurePresentationCues).toBe("function");
    if (typeof Presentation.projectExposurePresentationCues !== "function") return;
    const snapshot = {
      reactions: reactionState(),
      lastEvents: [
        ...Array.from({ length: 40 }, (_, index) => ({
          type: "enemyHit", towerId: "tower-1", enemyId: `enemy-${index}`, damage: 1
        })),
        exposureEvent()
      ]
    };

    expect(Presentation.projectExposurePresentationCues(snapshot)).toEqual([
      expect.objectContaining({ kind: "exposure", runtimeId: "enemy-1", exposureId: "fire" })
    ]);
  });

  it("[verifier] presents a valid multi-effect reaction event with more than 64 scheduled targets", () => {
    expect(typeof Presentation.projectReactionPresentationCues).toBe("function");
    if (typeof Presentation.projectReactionPresentationCues !== "function") return;
    const scheduledTargetIds = Array.from({ length: 65 }, (_, index) => `enemy-${index + 1}`);

    expect(Presentation.projectReactionPresentationCues({
      reactions: reactionState(),
      lastEvents: [reactionEvent({ scheduledTargetIds })]
    })).toEqual([expect.objectContaining({
      reactionId: "shatter_fire_into_ice",
      targetEnemyIds: scheduledTargetIds
    })]);
  });

  it("fails closed for explicit future/malformed state and never invokes accessors", () => {
    const resolve = Presentation.resolveExposurePresentation;
    const project = Presentation.projectReactionPresentationCues;
    expect(typeof resolve).toBe("function");
    expect(typeof project).toBe("function");
    if (typeof resolve !== "function" || typeof project !== "function") return;
    expect(resolve({ reactions: { schemaVersion: 2, exposures: { enemies: {} } } }, "enemy-1"))
      .toEqual({ entries: [], overflowCount: 0 });
    expect(project({ reactions: { schemaVersion: 2 }, lastEvents: [reactionEvent()] })).toEqual([]);
    expect(project({ lastEvents: [reactionEvent()] })).toEqual([expect.objectContaining({
      kind: "reaction",
      reactionId: "shatter_fire_into_ice",
      originEnemyId: "enemy-1",
      targetEnemyIds: ["enemy-1"]
    })]);

    const event = {};
    Object.defineProperty(event, "type", {
      enumerable: true,
      get() { throw new Error("projection must not invoke accessors"); }
    });
    expect(() => project({ reactions: reactionState(), lastEvents: [event] })).not.toThrow();
    expect(project({ reactions: reactionState(), lastEvents: [event] })).toEqual([]);
  });
});
