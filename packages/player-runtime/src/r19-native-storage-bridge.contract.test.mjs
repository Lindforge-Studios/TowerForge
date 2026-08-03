import { describe, expect, it } from "vitest";
import {
  createRotatingPlayerSessionStore,
  parsePlayerSessionSaveV1,
  serializePlayerSessionSaveV1
} from "./player-session-store.mjs";
import { createNativeStorageBridgeV1 } from "./native-storage-bridge.mjs";

const BASE_KEY = "towerforge:session:r19-native";

function session(id, savedAt) {
  return {
    schemaVersion: 1,
    activeMissionId: id,
    checkpoint: {
      schemaVersion: 1,
      engineVersion: "towerforge-sim-v2",
      stateDigest: `digest:${id}`
    },
    journalSuffix: [],
    contentDigest: "a".repeat(64),
    capabilityDigest: "tf-capabilities-v1:0123456789abcdef",
    savedAt
  };
}

class BrowserStorage {
  constructor() { this.values = new Map(); }
  async getItem(key) { return this.values.get(key) ?? null; }
  async setItem(key, value) { this.values.set(key, value); }
  async removeItem(key) { this.values.delete(key); }
}

function createNativeBackend() {
  const state = { head: null, slots: [null, null], failCommand: null, calls: [] };
  const invoke = async (command, args = {}) => {
    state.calls.push([command, args]);
    if (state.failCommand === command) throw new Error(`interrupted:${command}`);
    if (command === "player_session_read_head") return state.head;
    if (command === "player_session_read_slot") return state.slots[args.slot] ?? null;
    if (command === "player_session_write_slot") { state.slots[args.slot] = args.value; return null; }
    if (command === "player_session_write_head") { state.head = String(args.slot); return null; }
    if (command === "player_session_remove_slot") { state.slots[args.slot] = null; return null; }
    if (command === "player_session_remove_head") { state.head = null; return null; }
    throw new Error(`unexpected native command: ${command}`);
  };
  return { state, invoke };
}

function rotatingStore(storage) {
  return createRotatingPlayerSessionStore({
    storage,
    baseKey: BASE_KEY,
    codec: { parse: parsePlayerSessionSaveV1, serialize: serializePlayerSessionSaveV1 },
    restore(value) {
      return {
        missionId: value.activeMissionId,
        digest: value.checkpoint.stateDigest
      };
    }
  });
}

describe("R19.2 NativeStorageBridgeV1 (RED)", () => {
  it("maps the rotating store keys onto the closed native command allowlist without forwarding a key or path", async () => {
    const native = createNativeBackend();
    const storage = createNativeStorageBridgeV1({ invoke: native.invoke, baseKey: BASE_KEY });

    await storage.setItem(`${BASE_KEY}:slot-0`, "slot-zero");
    await storage.setItem(`${BASE_KEY}:head`, "0");
    expect(await storage.getItem(`${BASE_KEY}:head`)).toBe("0");
    expect(await storage.getItem(`${BASE_KEY}:slot-0`)).toBe("slot-zero");
    await storage.removeItem(`${BASE_KEY}:slot-0`);
    await storage.removeItem(`${BASE_KEY}:head`);

    expect(native.state.calls.map(([command]) => command)).toEqual([
      "player_session_write_slot",
      "player_session_write_head",
      "player_session_read_head",
      "player_session_read_slot",
      "player_session_remove_slot",
      "player_session_remove_head"
    ]);
    for (const [, args] of native.state.calls) {
      expect(args).not.toHaveProperty("key");
      expect(args).not.toHaveProperty("path");
      expect(Object.keys(args).every((key) => ["slot", "value"].includes(key))).toBe(true);
    }
  });

  it.each([
    ["slot write", "player_session_write_slot"],
    ["head commit", "player_session_write_head"]
  ])("recovers the prior committed slot after an interrupted %s", async (_label, failCommand) => {
    const native = createNativeBackend();
    const firstStore = rotatingStore(createNativeStorageBridgeV1({ invoke: native.invoke, baseKey: BASE_KEY }));
    await firstStore.save(session("safe", "2026-08-03T00:00:00.000Z"));

    native.state.failCommand = failCommand;
    await expect(firstStore.save(session("interrupted", "2026-08-03T00:01:00.000Z"))).rejects.toThrow(/interrupted/);
    native.state.failCommand = null;

    const restartedStore = rotatingStore(createNativeStorageBridgeV1({ invoke: native.invoke, baseKey: BASE_KEY }));
    expect(await restartedStore.loadLatest()).toMatchObject({
      code: "session_loaded",
      restored: { missionId: "safe", digest: "digest:safe" }
    });
  });

  it("restores the same detached simulation digest through browser and native rotating stores", async () => {
    const browser = rotatingStore(new BrowserStorage());
    const nativeBackend = createNativeBackend();
    const native = rotatingStore(createNativeStorageBridgeV1({ invoke: nativeBackend.invoke, baseKey: BASE_KEY }));
    const saves = [
      session("tutorial_01", "2026-08-03T00:00:00.000Z"),
      session("mission_02", "2026-08-03T00:01:00.000Z")
    ];
    for (const value of saves) {
      await browser.save(value);
      await native.save(value);
    }

    expect(await native.loadLatest()).toEqual(await browser.loadLatest());
  });

  it("rejects every key outside the configured head and two slots before invoking native code", async () => {
    const native = createNativeBackend();
    const storage = createNativeStorageBridgeV1({ invoke: native.invoke, baseKey: BASE_KEY });

    await expect(storage.getItem(`${BASE_KEY}:slot-2`)).rejects.toThrow(/key|slot|supported/i);
    await expect(storage.setItem("../../outside", "secret")).rejects.toThrow(/key|supported/i);
    await expect(storage.removeItem(`${BASE_KEY}:other`)).rejects.toThrow(/key|supported/i);
    expect(native.state.calls).toEqual([]);
  });
});
