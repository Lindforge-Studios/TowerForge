import fs from "node:fs";
import { describe, expect, it } from "vitest";
import * as renderer from "./index.mjs";

function activeSnapshot(overrides = {}) {
  return {
    quests: {
      schemaVersion: 1,
      profileId: "daily_mix",
      entries: [
        { questId: "lava", label: "Lava finisher", kind: "kill_with_source", current: 2, target: 5, status: "active" },
        { questId: "shield", label: "Keep shields", kind: "preserve_shield", current: 3, target: 3, status: "completed" }
      ]
    },
    lastEvents: [{ type: "questCompleted", questId: "shield", kind: "preserve_shield" }],
    ...overrides
  };
}

describe("R10 shared quest presentation contract (RED)", () => {
  it("projects authoritative progress and one-frame completion/failure cues", () => {
    expect(renderer.projectQuestPresentation(activeSnapshot())).toEqual({
      schemaVersion: 1,
      profileId: "daily_mix",
      entries: [
        { questId: "lava", label: "Lava finisher", kind: "kill_with_source", current: 2, target: 5, status: "active", progress: 0.4 },
        { questId: "shield", label: "Keep shields", kind: "preserve_shield", current: 3, target: 3, status: "completed", progress: 1 }
      ],
      cues: [{ type: "completed", questId: "shield", kind: "preserve_shield" }]
    });
  });

  it("fails closed for absent/future/malformed/accessor/sparse and over-budget state", () => {
    expect(renderer.projectQuestPresentation({ lastEvents: [] })).toBeNull();
    expect(renderer.projectQuestPresentation(activeSnapshot({ quests: { schemaVersion: 2 } }))).toBeNull();
    expect(renderer.projectQuestPresentation(activeSnapshot({ quests: { schemaVersion: 1, profileId: "x", entries: new Array(1) } }))).toBeNull();
    expect(renderer.projectQuestPresentation(activeSnapshot({ quests: {
      schemaVersion: 1,
      profileId: "x",
      entries: Array.from({ length: 4 }, (_, index) => ({
        questId: `q${index}`, label: "Q", kind: "kill_with_source", current: 0, target: 1, status: "active"
      }))
    } }))).toBeNull();
    expect(renderer.projectQuestPresentation(activeSnapshot({
      quests: {
        schemaVersion: 1,
        profileId: "x",
        entries: [{
          questId: "shield",
          label: "Shield",
          kind: "preserve_shield",
          current: 1,
          target: 1,
          status: "failed"
        }]
      },
      lastEvents: []
    }))).toBeNull();
    expect(renderer.projectQuestPresentation(activeSnapshot({
      lastEvents: [{ type: "questCompleted", questId: "lava", kind: "kill_with_source" }]
    }))).toBeNull();
    let reads = 0;
    const accessor = activeSnapshot();
    Object.defineProperty(accessor.quests.entries[0], "current", { enumerable: true, get() { reads += 1; return 2; } });
    expect(renderer.projectQuestPresentation(accessor)).toBeNull();
    expect(reads).toBe(0);

    const hostileEntries = activeSnapshot();
    hostileEntries.quests.entries = new Proxy(hostileEntries.quests.entries, {
      getPrototypeOf() { throw new Error("hostile quest entries"); }
    });
    expect(() => renderer.projectQuestPresentation(hostileEntries)).not.toThrow();
    expect(renderer.projectQuestPresentation(hostileEntries)).toBeNull();

    const hostileEvents = activeSnapshot();
    hostileEvents.lastEvents = new Proxy(hostileEvents.lastEvents, {
      getPrototypeOf() { throw new Error("hostile quest events"); }
    });
    expect(() => renderer.projectQuestPresentation(hostileEvents)).not.toThrow();
    expect(renderer.projectQuestPresentation(hostileEvents)).toBeNull();
  });

  it("is exported and wired into both generated player templates without authoring rules", () => {
    const build = fs.readFileSync(new URL("../../cli/build.mjs", import.meta.url), "utf8");
    expect(renderer.projectQuestPresentation).toBeTypeOf("function");
    expect((build.match(/projectQuestPresentation/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(build).toMatch(/function playerTemplate[\s\S]*projectQuestPresentation[\s\S]*function phaserPlayerTemplate/);
    expect(build).toMatch(/function phaserPlayerTemplate[\s\S]*projectQuestPresentation/);
    expect(build).not.toMatch(/function projectQuest(?:Selection|Progress)|selectProceduralQuests/);
  });
});
