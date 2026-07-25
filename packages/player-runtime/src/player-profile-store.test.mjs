import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  createEmptyPlayerProfile,
  createGameContentRegistry,
  parsePlayerProfileJson,
  serializePlayerProfile
} from "../../engine/dist/index.js";
import {
  PLAYER_PROFILE_STORAGE_PREFIX,
  createPlayerProfileStore,
  derivePlayerProfileStorageKey
} from "./player-profile-store.mjs";

function createContent() {
  return createGameContentRegistry({
    balance: {
      defaultMissionId: "alpha",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 20,
        startingResources: { coins: 20 },
        prepTimeUnits: 1,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 5,
        pathWaterDurationUnits: 3,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 10,
          speed: 1,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 0x778899
        }
      },
      towers: {},
      waveSets: {
        alpha_waves: [{
          id: "wave",
          label: "Wave",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        alpha: {
          id: "alpha",
          label: "Alpha",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 20 },
          prepTimeUnits: 1,
          mapId: "lane",
          waveSetId: "alpha_waves",
          buildTowerIds: [],
          abilityIds: [],
          objectives: {
            victory: [{ id: "clear", kind: "clearWaves" }],
            stars: [{ id: "star", label: "Star", kind: "coreHpAtLeast", amount: 1 }]
          }
        }
      },
      defaultDifficultyId: "normal",
      difficulties: [{ id: "normal", label: "Normal" }],
      metaProgression: {
        currencies: [{ id: "crystals", label: "Crystals" }],
        upgrades: {},
        rewardsByMission: {}
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 2,
        height: 1,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 0 },
        coreCoord: { q: 1, r: 0 },
        pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    worldMap: {
      width: 100,
      height: 100,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        accent: "#778899",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "alpha",
        regionId: "region",
        x: 50,
        y: 50,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  });
}

const codec = Object.freeze({
  createEmptyPlayerProfile,
  parsePlayerProfileJson,
  serializePlayerProfile
});

class RecordingStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.calls = [];
    this.failRead = undefined;
    this.failWrite = undefined;
    this.failRemove = undefined;
  }

  getItem(key) {
    this.calls.push(["getItem", key]);
    if (this.failRead) throw this.failRead;
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.calls.push(["setItem", key, value]);
    if (this.failWrite) throw this.failWrite;
    this.values.set(key, value);
  }

  removeItem(key) {
    this.calls.push(["removeItem", key]);
    if (this.failRemove) throw this.failRemove;
    this.values.delete(key);
  }
}

function createStore(storage, key = `${PLAYER_PROFILE_STORAGE_PREFIX}test`) {
  return createPlayerProfileStore({ storage, key, content: createContent(), codec });
}

function expectFrozenProfile(profile) {
  expect(Object.isFrozen(profile)).toBe(true);
  expect(Object.isFrozen(profile.clearedMissionIds)).toBe(true);
  expect(Object.isFrozen(profile.starsByMission)).toBe(true);
  expect(Object.isFrozen(profile.metaResources)).toBe(true);
  expect(Object.isFrozen(profile.upgradeLevels)).toBe(true);
}

function expectSafeResult(result, secret) {
  expect(Object.isFrozen(result)).toBe(true);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(result).not.toHaveProperty("raw");
  expect(result).not.toHaveProperty("error");
  expect(result).not.toHaveProperty("cause");
  expect(result).not.toHaveProperty("message");
}

describe("player profile storage identity", () => {
  it("publishes the runtime through its bare workspace package boundary", async () => {
    const publicRuntime = await import("@towerforge/player-runtime");

    expect(publicRuntime.PLAYER_PROFILE_STORAGE_PREFIX).toBe(PLAYER_PROFILE_STORAGE_PREFIX);
    expect(publicRuntime.derivePlayerProfileStorageKey).toBe(derivePlayerProfileStorageKey);
    expect(publicRuntime.createPlayerProfileStore).toBe(createPlayerProfileStore);

    execFileSync(process.execPath, [
      "--input-type=module",
      "--eval",
      'await import("@towerforge/player-runtime");'
    ], { cwd: process.cwd(), stdio: "pipe" });
  });

  it("preserves the exact legacy key derivation without normalization or suffixes", () => {
    expect(PLAYER_PROFILE_STORAGE_PREFIX).toBe("towerforge:progress:");
    expect(derivePlayerProfileStorageKey({ appId: "com.example.game", manifestName: "Named" }))
      .toBe("towerforge:progress:com.example.game");
    expect(derivePlayerProfileStorageKey({ appId: "", manifestName: "A Game" }))
      .toBe("towerforge:progress:A Game");
    expect(derivePlayerProfileStorageKey({ manifestName: "" }))
      .toBe("towerforge:progress:game");
    expect(derivePlayerProfileStorageKey({ appId: "  raw/id  ", manifestName: "ignored" }))
      .toBe("towerforge:progress:  raw/id  ");
  });

  it("derives scope only from own data properties without invoking accessors", () => {
    const inherited = Object.create({ appId: "inherited-app", manifestName: "inherited-name" });
    expect(derivePlayerProfileStorageKey(inherited)).toBe("towerforge:progress:game");

    let getterInvocations = 0;
    const manifestFallback = {};
    Object.defineProperties(manifestFallback, {
      appId: {
        enumerable: true,
        get() {
          getterInvocations += 1;
          return "accessor-app";
        }
      },
      manifestName: { enumerable: true, value: "own manifest" }
    });
    expect(derivePlayerProfileStorageKey(manifestFallback)).toBe("towerforge:progress:own manifest");

    const defaultFallback = {};
    Object.defineProperties(defaultFallback, {
      appId: { enumerable: true, value: "" },
      manifestName: {
        enumerable: true,
        get() {
          getterInvocations += 1;
          return "accessor-name";
        }
      }
    });
    expect(derivePlayerProfileStorageKey(defaultFallback)).toBe("towerforge:progress:game");
    expect(getterInvocations).toBe(0);
  });

  it("ignores inherited or accessor keys and never resets their victim profile", () => {
    const victimKey = `${PLAYER_PROFILE_STORAGE_PREFIX}victim`;
    const ownDerivedKey = `${PLAYER_PROFILE_STORAGE_PREFIX}safe-app`;
    const defaultKey = `${PLAYER_PROFILE_STORAGE_PREFIX}game`;
    const content = createContent();

    const inheritedStorage = new RecordingStorage({
      [victimKey]: "victim-inherited",
      [ownDerivedKey]: "safe"
    });
    const inheritedOptions = Object.create({ key: victimKey });
    Object.defineProperties(inheritedOptions, {
      storage: { enumerable: true, value: inheritedStorage },
      content: { enumerable: true, value: content },
      codec: { enumerable: true, value: codec },
      appId: { enumerable: true, value: "safe-app" }
    });
    const inheritedResult = createPlayerProfileStore(inheritedOptions).reset();

    expect(inheritedResult.code).toBe("profile_reset");
    expect(inheritedStorage.calls).toEqual([["removeItem", ownDerivedKey]]);
    expect(inheritedStorage.values.get(victimKey)).toBe("victim-inherited");

    let keyGetterInvocations = 0;
    const accessorStorage = new RecordingStorage({
      [victimKey]: "victim-accessor",
      [defaultKey]: "default"
    });
    const accessorOptions = { storage: accessorStorage, content, codec };
    Object.defineProperty(accessorOptions, "key", {
      enumerable: true,
      get() {
        keyGetterInvocations += 1;
        return victimKey;
      }
    });
    const accessorResult = createPlayerProfileStore(accessorOptions).reset();

    expect(accessorResult.code).toBe("profile_reset");
    expect(accessorStorage.calls).toEqual([["removeItem", defaultKey]]);
    expect(accessorStorage.values.get(victimKey)).toBe("victim-accessor");
    expect(keyGetterInvocations).toBe(0);
  });

  it("is an injected browser-neutral adapter with frozen public objects", () => {
    const store = createStore(new RecordingStorage());
    expect(Object.isFrozen(store)).toBe(true);

    const source = fs.readFileSync(new URL("./player-profile-store.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(?:window|localStorage|document)\b/);
    expect(source).not.toMatch(/(?:from\s+|import\s*)["']node:/);
    expect(source).not.toMatch(/\b(?:Date|Math\.random)\b/);
  });
});

describe("player profile load contract", () => {
  it.each([
    ["missing", {}, "profile_missing"],
    ["corrupt", { value: "{private-corrupt" }, "profile_corrupt"],
    ["future", { value: JSON.stringify({ version: 7, private: "future-secret" }) }, "profile_version_unsupported"]
  ])("loads %s data with one read and no implicit mutation", (_label, fixture, code) => {
    const key = `${PLAYER_PROFILE_STORAGE_PREFIX}load`;
    const initial = fixture.value === undefined ? {} : { [key]: fixture.value };
    const storage = new RecordingStorage(initial);
    const result = createStore(storage, key).load();

    expect(result.code).toBe(code);
    expectFrozenProfile(result.profile);
    expect(storage.calls).toEqual([["getItem", key]]);
    expect(storage.values.get(key)).toBe(fixture.value);
    expectSafeResult(result, fixture.value ?? "never-present-secret");
    if (code === "profile_version_unsupported") {
      expect(result.unsupportedVersion).toBe(7);
      expect(Number.isSafeInteger(result.unsupportedVersion)).toBe(true);
    }
  });

  it.each([
    ["current v2", (content) => serializePlayerProfile(createEmptyPlayerProfile(content)), "profile_loaded", "v2"],
    ["legacy array", () => JSON.stringify(["alpha"]), "profile_migrated", "legacy-array"],
    ["unversioned legacy", () => JSON.stringify({ clearedMissionIds: ["alpha"] }), "profile_migrated", "legacy-object"],
    ["version 1 legacy", () => JSON.stringify({ version: 1, clearedMissionIds: ["alpha"] }), "profile_migrated", "legacy-object"]
  ])("loads %s through the engine codec without auto-saving", (_label, makeRaw, code, source) => {
    const content = createContent();
    const key = `${PLAYER_PROFILE_STORAGE_PREFIX}codec`;
    const raw = makeRaw(content);
    const storage = new RecordingStorage({ [key]: raw });
    const store = createPlayerProfileStore({ storage, key, content, codec });
    const result = store.load();

    expect(result).toMatchObject({ code, source });
    expect(result.migrations).toBeDefined();
    expect(result.warnings).toBeDefined();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.migrations)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
    expectFrozenProfile(result.profile);
    expect(storage.calls).toEqual([["getItem", key]]);
    expect(storage.values.get(key)).toBe(raw);
  });

  it("returns a playable empty profile when no storage port exists", () => {
    const result = createStore(undefined).load();
    expect(result.code).toBe("storage_unavailable");
    expect(result.profile).toEqual(createEmptyPlayerProfile(createContent()));
    expect(Object.isFrozen(result)).toBe(true);
    expectFrozenProfile(result.profile);
  });

  it("treats a non-string Storage value as a contained read failure", () => {
    const key = `${PLAYER_PROFILE_STORAGE_PREFIX}non-string`;
    const storage = new RecordingStorage({ [key]: 42 });
    const result = createStore(storage, key).load();

    expect(result.code).toBe("storage_read_failed");
    expect(result.profile).toEqual(createEmptyPlayerProfile(createContent()));
    expect(storage.calls).toEqual([["getItem", key]]);
    expect(storage.values.get(key)).toBe(42);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("contains an oversized payload as corrupt data without rewriting or leaking it", () => {
    const key = `${PLAYER_PROFILE_STORAGE_PREFIX}oversized`;
    const secret = "oversize-private-token";
    const raw = `${secret}${"x".repeat(1_048_577)}`;
    const storage = new RecordingStorage({ [key]: raw });
    const result = createStore(storage, key).load();

    expect(result.code).toBe("profile_corrupt");
    expect(result.profile).toEqual(createEmptyPlayerProfile(createContent()));
    expect(storage.calls).toEqual([["getItem", key]]);
    expect(storage.values.get(key)).toBe(raw);
    expectSafeResult(result, secret);
  });

  it("contains read failures and does not leak thrown error details", () => {
    const storage = new RecordingStorage();
    storage.failRead = new Error("private-read-token");
    const result = createStore(storage).load();

    expect(result.code).toBe("storage_read_failed");
    expect(storage.calls).toEqual([["getItem", `${PLAYER_PROFILE_STORAGE_PREFIX}test`]]);
    expectFrozenProfile(result.profile);
    expectSafeResult(result, "private-read-token");
  });
});

describe("player profile explicit save contract", () => {
  it("serializes before storage access and rejects invalid profiles without any calls", () => {
    const storage = new RecordingStorage();
    const result = createStore(storage).save({ version: 2, private: "invalid-save-token" });

    expect(result.code).toBe("profile_invalid");
    expect(storage.calls).toEqual([]);
    expectSafeResult(result, "invalid-save-token");
  });

  it("preflights once and refuses to overwrite a future profile", () => {
    const key = `${PLAYER_PROFILE_STORAGE_PREFIX}future`;
    const raw = JSON.stringify({ version: 4, private: "future-save-token" });
    const storage = new RecordingStorage({ [key]: raw });
    const result = createStore(storage, key).save(createEmptyPlayerProfile(createContent()));

    expect(result.code).toBe("profile_version_unsupported");
    expect(result.unsupportedVersion).toBe(4);
    expect(storage.calls).toEqual([["getItem", key]]);
    expect(storage.values.get(key)).toBe(raw);
    expectSafeResult(result, "future-save-token");
  });

  it.each(["legacy", "corrupt"])("explicitly replaces existing %s bytes with canonical v2", (kind) => {
    const content = createContent();
    const key = `${PLAYER_PROFILE_STORAGE_PREFIX}${kind}`;
    const oldRaw = kind === "legacy" ? JSON.stringify(["alpha"]) : "{corrupt";
    const profile = createEmptyPlayerProfile(content);
    const canonical = serializePlayerProfile(profile);
    const storage = new RecordingStorage({ [key]: oldRaw });
    const store = createPlayerProfileStore({ storage, key, content, codec });
    const result = store.save(profile);

    expect(result.code).toBe("profile_saved");
    expect(storage.calls).toEqual([["getItem", key], ["setItem", key, canonical]]);
    expect(storage.values.get(key)).toBe(canonical);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("preflights missing and current-v2 data and writes identical canonical bytes for reordered profiles", () => {
    const content = createContent();
    const key = `${PLAYER_PROFILE_STORAGE_PREFIX}canonical`;
    const storage = new RecordingStorage();
    const store = createPlayerProfileStore({ storage, key, content, codec });
    const profile = createEmptyPlayerProfile(content);
    const reordered = {
      selectedDifficultyId: profile.selectedDifficultyId,
      upgradeLevels: { ...profile.upgradeLevels },
      metaResources: { ...profile.metaResources },
      starsByMission: { ...profile.starsByMission },
      clearedMissionIds: [...profile.clearedMissionIds],
      version: profile.version
    };

    const missingResult = store.save(profile);
    const firstBytes = storage.values.get(key);
    const currentResult = store.save(reordered);
    const secondBytes = storage.values.get(key);

    expect(missingResult.code).toBe("profile_saved");
    expect(currentResult.code).toBe("profile_saved");
    expect(storage.calls).toEqual([
      ["getItem", key],
      ["setItem", key, firstBytes],
      ["getItem", key],
      ["setItem", key, secondBytes]
    ]);
    expect(firstBytes).toBe(serializePlayerProfile(profile));
    expect(secondBytes).toBe(firstBytes);
    expect(Object.isFrozen(missingResult)).toBe(true);
    expect(Object.isFrozen(currentResult)).toBe(true);
  });

  it.each([
    ["read", "storage_read_failed"],
    ["write", "storage_write_failed"]
  ])("contains storage %s failures without leaking details", (phase, code) => {
    const storage = new RecordingStorage();
    storage[phase === "read" ? "failRead" : "failWrite"] = new Error(`private-${phase}-token`);
    const result = createStore(storage).save(createEmptyPlayerProfile(createContent()));

    expect(result.code).toBe(code);
    expect(storage.calls.map(([method]) => method)).toEqual(phase === "read" ? ["getItem"] : ["getItem", "setItem"]);
    expectSafeResult(result, `private-${phase}-token`);
  });

  it("reports unavailable storage without browser-global fallback", () => {
    const result = createStore(undefined).save(createEmptyPlayerProfile(createContent()));
    expect(result.code).toBe("storage_unavailable");
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe("player profile reset contract", () => {
  it.each(["{corrupt", JSON.stringify({ version: 9 })])("removes only the exact profile key, including protected or corrupt data", (raw) => {
    const key = `${PLAYER_PROFILE_STORAGE_PREFIX}exact`;
    const storyKey = `story_seen_exact:intro`;
    const otherProfileKey = `${PLAYER_PROFILE_STORAGE_PREFIX}other`;
    const storage = new RecordingStorage({ [key]: raw, [storyKey]: "1", [otherProfileKey]: "other" });
    const result = createStore(storage, key).reset();

    expect(result.code).toBe("profile_reset");
    expect(storage.calls).toEqual([["removeItem", key]]);
    expect(storage.values.has(key)).toBe(false);
    expect(storage.values.get(storyKey)).toBe("1");
    expect(storage.values.get(otherProfileKey)).toBe("other");
    expectFrozenProfile(result.profile);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    [undefined, "storage_unavailable"],
    ["throw", "storage_remove_failed"]
  ])("contains unavailable/remove failure while returning a playable frozen profile", (mode, code) => {
    const storage = mode === "throw" ? new RecordingStorage() : undefined;
    if (storage) storage.failRemove = new Error("private-remove-token");
    const result = createStore(storage).reset();

    expect(result.code).toBe(code);
    expectFrozenProfile(result.profile);
    expectSafeResult(result, "private-remove-token");
  });
});
