import { describe, expect, it } from "vitest";
import {
  PLAYER_ACTION_DESCRIPTOR_SCHEMA_VERSION,
  PLAYER_PREFERENCES_SCHEMA_VERSION,
  PLAYER_SESSION_SAVE_SCHEMA_VERSION,
  createDefaultPlayerActionDescriptors,
  createDefaultPlayerPreferences,
  createRotatingPlayerSessionStore,
  parsePlayerPreferencesV1,
  parsePlayerSessionSaveV1,
  serializePlayerPreferencesV1,
  serializePlayerSessionSaveV1
} from "./index.mjs";

function sessionSave(activeMissionId, savedAt) {
  return {
    schemaVersion: 1,
    activeMissionId,
    checkpoint: { schemaVersion: 1, engineVersion: "towerforge-sim-v2", opaque: "checkpoint" },
    journalSuffix: [{ sequence: 0, command: { schemaVersion: 8, type: "startWave" } }],
    contentDigest: "a".repeat(64),
    savedAt
  };
}

class MemoryStorage {
  values = new Map();
  async getItem(key) { return this.values.get(key) ?? null; }
  async setItem(key, value) { this.values.set(key, value); }
  async removeItem(key) { this.values.delete(key); }
}

describe("R18 shared generated-player runtime contracts (RED)", () => {
  it("publishes one immutable action-descriptor registry for desktop and gameplay controls", () => {
    expect(PLAYER_ACTION_DESCRIPTOR_SCHEMA_VERSION).toBe(1);
    const descriptors = createDefaultPlayerActionDescriptors();
    expect(Object.isFrozen(descriptors)).toBe(true);
    expect(descriptors.every(Object.isFrozen)).toBe(true);
    const ids = descriptors.map((descriptor) => descriptor.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      "pause", "cameraPan", "cameraZoom", "cameraReset", "fullscreen",
      "startWave", "placeTower", "upgradeTower", "sellTower", "setTargetMode",
      "useAbility", "useHeroAbility", "socketArtifact", "unsocketArtifact", "configureTowerModules"
    ]));
  });

  it("round-trips closed preferences and rejects future, unknown and corrupt records", () => {
    expect(PLAYER_PREFERENCES_SCHEMA_VERSION).toBe(1);
    const defaults = createDefaultPlayerPreferences();
    expect(Object.isFrozen(defaults)).toBe(true);
    expect(parsePlayerPreferencesV1(serializePlayerPreferencesV1(defaults))).toEqual(defaults);
    for (const raw of [
      JSON.stringify({ ...defaults, schemaVersion: 2 }),
      JSON.stringify({ ...defaults, accessToken: "must-not-survive" }),
      '{"schemaVersion":1',
      "null"
    ]) {
      expect(() => parsePlayerPreferencesV1(raw)).toThrow();
    }
  });

  it("round-trips the closed session envelope and rejects future or corrupt saves", () => {
    expect(PLAYER_SESSION_SAVE_SCHEMA_VERSION).toBe(1);
    const subject = sessionSave("tutorial_01", "2026-08-02T00:00:00.000Z");
    expect(parsePlayerSessionSaveV1(serializePlayerSessionSaveV1(subject))).toEqual(subject);
    for (const raw of [
      JSON.stringify({ ...subject, schemaVersion: 2 }),
      JSON.stringify({ ...subject, credential: "must-not-survive" }),
      JSON.stringify({ ...subject, contentDigest: "short" }),
      '{"schemaVersion":1'
    ]) {
      expect(() => parsePlayerSessionSaveV1(raw)).toThrow();
    }
  });

  it("rotates two slots and falls back to the previous complete save", async () => {
    const storage = new MemoryStorage();
    const store = createRotatingPlayerSessionStore({
      storage,
      baseKey: "towerforge:session:r18",
      codec: { parse: parsePlayerSessionSaveV1, serialize: serializePlayerSessionSaveV1 },
      restore(value) {
        if (value.activeMissionId === "broken") throw new Error("restore failed");
        return value.activeMissionId;
      }
    });
    await store.save(sessionSave("safe", "2026-08-02T00:00:00.000Z"));
    await store.save(sessionSave("broken", "2026-08-02T00:01:00.000Z"));
    expect(storage.values.has("towerforge:session:r18:slot-0")).toBe(true);
    expect(storage.values.has("towerforge:session:r18:slot-1")).toBe(true);
    expect(await store.loadLatest()).toMatchObject({ code: "session_loaded", restored: "safe" });
    storage.values.set("towerforge:session:r18:slot-0", "not-json");
    const result = await store.loadLatest();
    expect(result).toEqual(expect.objectContaining({ code: "session_corrupt" }));
    expect(result).not.toHaveProperty("save");
  });
});
