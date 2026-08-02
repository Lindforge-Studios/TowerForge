import { describe, expect, it } from "vitest";
import {
  PLAYER_SESSION_SAVE_SCHEMA_VERSION,
  createRotatingPlayerSessionStore,
  parsePlayerSessionSaveV1,
  serializePlayerSessionSaveV1
} from "./player-session-store.mjs";

function save(id = "tutorial_01", savedAt = "2026-08-02T00:00:00.000Z") {
  return {
    schemaVersion: 1,
    activeMissionId: id,
    checkpoint: { schemaVersion: 1, engineVersion: "towerforge-sim-v2", opaque: "checkpoint" },
    journalSuffix: [{ sequence: 0, command: { schemaVersion: 8, type: "startWave" } }],
    contentDigest: "a".repeat(64),
    capabilityDigest: "tf-capabilities-v1:0123456789abcdef",
    savedAt
  };
}

class AsyncStorage {
  constructor() { this.values = new Map(); this.calls = []; }
  async getItem(key) { this.calls.push(["getItem", key]); return this.values.get(key) ?? null; }
  async setItem(key, value) { this.calls.push(["setItem", key, value]); this.values.set(key, value); }
  async removeItem(key) { this.calls.push(["removeItem", key]); this.values.delete(key); }
}

describe("PlayerSessionSaveV1 and two-slot store (RED)", () => {
  it("round-trips the closed save envelope without changing engine version domains", () => {
    expect(PLAYER_SESSION_SAVE_SCHEMA_VERSION).toBe(1);
    const subject = save();
    expect(parsePlayerSessionSaveV1(serializePlayerSessionSaveV1(subject))).toEqual(subject);
    expect(subject.checkpoint.schemaVersion).toBe(1);
    expect(subject.journalSuffix[0].command.schemaVersion).toBe(8);
  });

  it.each([
    ["future", JSON.stringify({ ...save(), schemaVersion: 2 })],
    ["unknown field", JSON.stringify({ ...save(), token: "secret" })],
    ["corrupt", '{"schemaVersion":1'],
    ["missing checkpoint", JSON.stringify({ ...save(), checkpoint: undefined })],
    ["invalid digest", JSON.stringify({ ...save(), contentDigest: "short" })],
    ["missing capability digest", JSON.stringify({ ...save(), capabilityDigest: undefined })],
    ["invalid capability digest", JSON.stringify({ ...save(), capabilityDigest: "capabilities-ish" })]
  ])("rejects %s save data", (_label, raw) => {
    expect(() => parsePlayerSessionSaveV1(raw)).toThrow();
  });

  it("rotates atomically through two slots and validates the selected save before restore", async () => {
    const storage = new AsyncStorage();
    const restored = [];
    const store = createRotatingPlayerSessionStore({
      storage, baseKey: "towerforge:session:test",
      codec: { parse: parsePlayerSessionSaveV1, serialize: serializePlayerSessionSaveV1 },
      restore(value) { restored.push(value.activeMissionId); return { missionId: value.activeMissionId }; }
    });
    await store.save(save("one", "2026-08-02T00:00:00.000Z"));
    await store.save(save("two", "2026-08-02T00:01:00.000Z"));
    await store.save(save("three", "2026-08-02T00:02:00.000Z"));
    expect(storage.values.get("towerforge:session:test:head")).toBe("0");
    expect(storage.values.has("towerforge:session:test:slot-0")).toBe(true);
    expect(storage.values.has("towerforge:session:test:slot-1")).toBe(true);
    const loaded = await store.loadLatest();
    expect(loaded).toMatchObject({ code: "session_loaded", slot: 0, restored: { missionId: "three" } });
    expect(restored).toEqual(["three"]);
  });

  it("falls back to the previous complete slot when the head is corrupt and never returns partial data", async () => {
    const storage = new AsyncStorage();
    const store = createRotatingPlayerSessionStore({
      storage, baseKey: "towerforge:session:test",
      codec: { parse: parsePlayerSessionSaveV1, serialize: serializePlayerSessionSaveV1 },
      restore(value) { if (value.activeMissionId === "broken") throw new Error("restore failed"); return value.activeMissionId; }
    });
    await store.save(save("safe"));
    await store.save(save("broken"));
    expect(await store.loadLatest()).toMatchObject({ code: "session_loaded", slot: 0, restored: "safe" });
    storage.values.set("towerforge:session:test:slot-0", "not-json");
    const result = await store.loadLatest();
    expect(result.code).toBe("session_corrupt");
    expect(result).not.toHaveProperty("save");
    expect(result).not.toHaveProperty("restored");
  });

  it.each([
    [
      "missing",
      { ...save(), capabilityDigest: undefined },
      "session_capability_missing"
    ],
    [
      "mismatching",
      { ...save(), capabilityDigest: "tf-capabilities-v1:fedcba9876543210" },
      "session_capability_mismatch"
    ]
  ])("rejects a %s capability digest before restore with a stable code", async (_label, candidate, code) => {
    const storage = new AsyncStorage();
    storage.values.set("towerforge:session:test:head", "0");
    storage.values.set("towerforge:session:test:slot-0", JSON.stringify(candidate));
    const restored = [];
    const store = createRotatingPlayerSessionStore({
      storage,
      baseKey: "towerforge:session:test",
      expectedCapabilityDigest: "tf-capabilities-v1:0123456789abcdef",
      codec: { parse: parsePlayerSessionSaveV1, serialize: serializePlayerSessionSaveV1 },
      restore(value) { restored.push(value); return value.activeMissionId; }
    });

    expect(await store.loadLatest()).toEqual({ code });
    expect(restored).toEqual([]);
  });

  it("resolves the expected capability digest from the detached save before restore", async () => {
    const storage = new AsyncStorage();
    const expectedCalls = [];
    const restored = [];
    const store = createRotatingPlayerSessionStore({
      storage,
      baseKey: "towerforge:session:test",
      expectedCapabilityDigest(value) {
        expectedCalls.push(value.activeMissionId);
        return value.activeMissionId === "mission_2"
          ? "tf-capabilities-v1:2222222222222222"
          : "tf-capabilities-v1:1111111111111111";
      },
      codec: { parse: parsePlayerSessionSaveV1, serialize: serializePlayerSessionSaveV1 },
      restore(value) { restored.push(value.activeMissionId); return value.activeMissionId; }
    });
    await store.save({
      ...save("mission_2"),
      capabilityDigest: "tf-capabilities-v1:2222222222222222"
    });

    expect(await store.loadLatest()).toMatchObject({
      code: "session_loaded",
      restored: "mission_2"
    });
    expect(expectedCalls).toEqual(["mission_2"]);
    expect(restored).toEqual(["mission_2"]);
  });
});
