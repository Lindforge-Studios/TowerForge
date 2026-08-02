import { describe, expect, it } from "vitest";
import * as playerActions from "./player-actions.mjs";
import {
  createRotatingPlayerSessionStore,
  parsePlayerSessionSaveV1,
  serializePlayerSessionSaveV1
} from "./player-session-store.mjs";

describe("R18 verifier repair regressions (RED)", () => {
  it("serializes concurrent saves so an older slow write cannot overwrite a newer call", async () => {
    const storage = new ControlledSlowStorage();
    const store = createRotatingPlayerSessionStore({
      storage,
      baseKey: "towerforge:session:concurrent",
      codec: { parse: parsePlayerSessionSaveV1, serialize: serializePlayerSessionSaveV1 },
      restore: (value) => value.activeMissionId
    });

    const older = store.save(save("older", "2026-08-02T00:00:00.000Z"));
    await storage.olderSlotWriteStarted;
    const newer = store.save(save("newer", "2026-08-02T00:01:00.000Z"));
    await Promise.resolve();
    storage.releaseOlderSlotWrite();
    await Promise.all([older, newer]);

    expect(await store.loadLatest()).toMatchObject({ code: "session_loaded", restored: "newer" });
    expect(storage.values.get("towerforge:session:concurrent:head")).toBe("1");
    expect(JSON.parse(storage.values.get("towerforge:session:concurrent:slot-0")).activeMissionId).toBe("older");
    expect(JSON.parse(storage.values.get("towerforge:session:concurrent:slot-1")).activeMissionId).toBe("newer");
  });

  it("constructs one complete registry in which every default descriptor id is invokable", async () => {
    expect(playerActions.createPlayerActionRegistry).toBeTypeOf("function");
    const descriptors = playerActions.createDefaultPlayerActionDescriptors();
    const calls = [];
    const handlers = Object.fromEntries(descriptors.map(({ id }) => [id, async (payload) => {
      calls.push({ id, payload });
      return Object.freeze({ ok: true, id });
    }]));
    const registry = playerActions.createPlayerActionRegistry({ descriptors, handlers });

    expect(registry.descriptors.map(({ id }) => id)).toEqual(descriptors.map(({ id }) => id));
    for (const descriptor of descriptors) {
      await expect(registry.invoke(descriptor.id, { marker: descriptor.id })).resolves.toEqual({ ok: true, id: descriptor.id });
    }
    expect(calls.map(({ id }) => id)).toEqual(descriptors.map(({ id }) => id));
    expect(registry.invoke("unknown-action", {})).toEqual({ ok: false, code: "unsupported_player_action" });
  });
});

class ControlledSlowStorage {
  constructor() {
    this.values = new Map();
    this.olderSlotWriteStarted = new Promise((resolve) => { this.markOlderSlotWriteStarted = resolve; });
    this.olderSlotWriteGate = new Promise((resolve) => { this.releaseOlderSlotWrite = resolve; });
  }

  async getItem(key) {
    return this.values.get(key) ?? null;
  }

  async setItem(key, value) {
    if (key.endsWith(":slot-0") && JSON.parse(value).activeMissionId === "older") {
      this.markOlderSlotWriteStarted();
      await this.olderSlotWriteGate;
    }
    this.values.set(key, value);
  }

  async removeItem(key) {
    this.values.delete(key);
  }
}

function save(activeMissionId, savedAt) {
  return {
    schemaVersion: 1,
    activeMissionId,
    checkpoint: { schemaVersion: 1, engineVersion: "towerforge-sim-v2", opaque: activeMissionId },
    journalSuffix: [],
    contentDigest: "a".repeat(64),
    savedAt
  };
}
