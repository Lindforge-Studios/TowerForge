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
    ["invalid digest", JSON.stringify({ ...save(), contentDigest: "short" })]
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
});
