import { describe, expect, it } from "vitest";
import {
  PLAYER_PROFILE_LIMITS,
  PLAYER_PROFILE_SCHEMA_VERSION,
  UnsupportedPlayerProfileVersionError,
  createEmptyPlayerProfile,
  decodePlayerProfile,
  getPlayerProfileLaunchOptions,
  parsePlayerProfileJson,
  serializePlayerProfile,
  validateGameContentRegistry
} from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "../content/registry.js";

function profileInput(): GameContentInput {
  const mission = (id: string, waveSetId: string, starCount: number) => ({
    id,
    label: id,
    description: "",
    startingCoreHp: 20,
    startingResources: { coins: 20 },
    prepTimeUnits: 1,
    mapId: "lane",
    waveSetId,
    buildTowerIds: [] as string[],
    abilityIds: [] as string[],
    objectives: {
      victory: [{ id: "clear", kind: "clearWaves" as const }],
      stars: Array.from({ length: starCount }, (_, index) => ({
        id: `star_${index + 1}`,
        label: `Star ${index + 1}`,
        kind: "coreHpAtLeast" as const,
        amount: index + 1
      }))
    }
  });
  return {
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
          id: "grunt", label: "Grunt", maxHp: 10, speed: 1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 0x778899
        }
      },
      towers: {},
      waveSets: {
        alpha_waves: [{ id: "a1", label: "A1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        beta_waves: [{ id: "b1", label: "B1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }]
      },
      missions: {
        alpha: mission("alpha", "alpha_waves", 2),
        beta: mission("beta", "beta_waves", 1)
      },
      defaultDifficultyId: "normal",
      difficulties: [
        { id: "normal", label: "Normal" },
        { id: "hard", label: "Hard", enemyHpMultiplier: 1.2 }
      ],
      metaProgression: {
        currencies: [
          { id: "crystals", label: "Crystals" },
          { id: "dust", label: "Dust" }
        ],
        upgrades: {
          focus: {
            id: "focus", label: "Focus", maxLevel: 3,
            costs: [{ crystals: 1 }, { crystals: 2 }, { crystals: 3 }],
            effects: [{ kind: "towerDamage", multiplierPerLevel: 0.1 }]
          },
          shield: {
            id: "shield", label: "Shield", maxLevel: 2,
            costs: [{ dust: 1 }, { dust: 2 }],
            effects: [{ kind: "coreHp", amountPerLevel: 1 }]
          }
        },
        rewardsByMission: {}
      }
    },
    maps: {
      lane: {
        id: "lane", width: 5, height: 3, defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 4, r: 1 },
        pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    worldMap: {
      width: 100,
      height: 100,
      regions: [{
        id: "region", label: "Region", description: "",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        accent: "#778899", biome: "test", connections: []
      }],
      missionNodes: ["alpha", "beta"].map((missionId, index) => ({
        missionId, regionId: "region", x: 30 + index * 30, y: 50,
        difficulty: 1 as const, unlockRequiresMissionIds: []
      }))
    }
  };
}

function createContent(): GameContentRegistry {
  return createGameContentRegistry(profileInput());
}

function validProfile() {
  return {
    version: 2 as const,
    clearedMissionIds: ["beta", "alpha"],
    starsByMission: { alpha: 2, beta: 1 },
    metaResources: { crystals: 5, dust: 1.5 },
    upgradeLevels: { focus: 2, shield: 1 },
    selectedDifficultyId: "hard"
  };
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function warningText(warnings: readonly unknown[]): string {
  return warnings.map((warning) => {
    if (!warning || typeof warning !== "object") return String(warning);
    const record = warning as Record<string, unknown>;
    return `${String(record.code)} ${String(record.path)} ${String(record.message)}`;
  }).join("\n");
}

describe("PlayerProfileV2 codec", () => {
  it("publishes an independent schema v2 and bounded codec limits", () => {
    expect(PLAYER_PROFILE_SCHEMA_VERSION).toBe(2);
    expect(PLAYER_PROFILE_LIMITS).toEqual({
      jsonBytes: 1 * 1_024 * 1_024,
      collectionEntries: 10_000,
      warnings: 1_000
    });
    expect(Object.isFrozen(PLAYER_PROFILE_LIMITS)).toBe(true);
  });

  it("creates the canonical deeply immutable empty profile from authored content", () => {
    const profile = createEmptyPlayerProfile(createContent());
    expect(profile).toEqual({
      version: 2,
      clearedMissionIds: [],
      starsByMission: {},
      metaResources: { crystals: 0, dust: 0 },
      upgradeLevels: { focus: 0, shield: 0 },
      selectedDifficultyId: "normal"
    });
    expect(profile).not.toHaveProperty("schemaVersion");
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.clearedMissionIds)).toBe(true);
    expect(Object.isFrozen(profile.starsByMission)).toBe(true);
    expect(Object.isFrozen(profile.metaResources)).toBe(true);
    expect(Object.isFrozen(profile.upgradeLevels)).toBe(true);
  });

  it("decodes valid v2 as a detached deeply immutable value without diagnostics", () => {
    const content = createContent();
    const contentBefore = JSON.stringify(content);
    const input = jsonClone(validProfile());
    const decoded = decodePlayerProfile(input, content);

    expect(decoded).toEqual({ profile: validProfile(), source: "v2", migrations: [], warnings: [] });
    expect(decoded.profile).not.toBe(input);
    expect(decoded.profile.clearedMissionIds).not.toBe(input.clearedMissionIds);
    expect(decoded.profile.metaResources).not.toBe(input.metaResources);
    expect(Object.isFrozen(decoded.profile)).toBe(true);
    expect(Object.isFrozen(decoded.profile.clearedMissionIds)).toBe(true);
    expect(Object.isFrozen(decoded.migrations)).toBe(true);
    expect(Object.isFrozen(decoded.warnings)).toBe(true);

    (input.clearedMissionIds as string[]).push("unknown");
    (input.metaResources as Record<string, number>).crystals = 999;
    expect(decoded.profile).toEqual(validProfile());
    expect(JSON.stringify(content)).toBe(contentBefore);
  });

  it("serializes canonically and parses back through the same v2 decoder", () => {
    const content = createContent();
    const profile = decodePlayerProfile(validProfile(), content).profile;
    const serialized = serializePlayerProfile(profile);
    expect(serialized).not.toContain("\n");
    expect(JSON.parse(serialized)).toEqual(profile);
    expect(serializePlayerProfile(profile)).toBe(serialized);

    const parsed = parsePlayerProfileJson(serialized, content);
    expect(parsed).toEqual({ profile, source: "v2", migrations: [], warnings: [] });
    expect(parsed.profile).not.toBe(profile);
    expect(Object.isFrozen(parsed.profile)).toBe(true);
  });

  it("migrates a raw cleared-mission array with an explicit migration id", () => {
    const decoded = decodePlayerProfile(["beta", "alpha"], createContent());
    expect(decoded.source).toBe("legacy-array");
    expect(decoded.migrations).toEqual([expect.objectContaining({
      id: "legacy-clears-array-to-profile-v2",
      description: expect.any(String)
    })]);
    expect(decoded.profile).toEqual({
      version: 2,
      clearedMissionIds: ["beta", "alpha"],
      starsByMission: {},
      metaResources: { crystals: 0, dust: 0 },
      upgradeLevels: { focus: 0, shield: 0 },
      selectedDifficultyId: "normal"
    });
  });

  it("migrates unversioned and version-1 legacy objects without exposing a public V1 type", () => {
    for (const version of [undefined, 1]) {
      const legacy = {
        ...(version === undefined ? {} : { version }),
        clearedMissionIds: ["alpha"],
        starsByMission: { alpha: 1 },
        metaResources: { crystals: 7, dust: 2 },
        upgradeLevels: { focus: 2, shield: 1 },
        selectedDifficultyId: "hard"
      };
      const decoded = decodePlayerProfile(legacy, createContent());
      expect(decoded.source).toBe("legacy-object");
      expect(decoded.migrations).toEqual([expect.objectContaining({
        id: "legacy-object-to-profile-v2",
        description: expect.any(String)
      })]);
      expect(decoded.profile).toEqual({ ...validProfile(), clearedMissionIds: ["alpha"], starsByMission: { alpha: 1 }, metaResources: { crystals: 7, dust: 2 } });
    }
  });

  it("filters unknown ids and duplicate clears while returning structured diagnostics", () => {
    const content = createContent();
    const contentBefore = JSON.stringify(content);
    const input = {
      clearedMissionIds: ["alpha", "missing", "alpha", "beta"],
      starsByMission: { alpha: 2, missing: 9 },
      metaResources: { crystals: 3, missing_currency: 8 },
      upgradeLevels: { focus: 1, missing_upgrade: 2 },
      selectedDifficultyId: "hard",
      extraRoot: true
    };
    const inputBefore = jsonClone(input);
    const decoded = decodePlayerProfile(input, content);

    expect(decoded.profile).toEqual({
      version: 2,
      clearedMissionIds: ["alpha", "beta"],
      starsByMission: { alpha: 2 },
      metaResources: { crystals: 3, dust: 0 },
      upgradeLevels: { focus: 1, shield: 0 },
      selectedDifficultyId: "hard"
    });
    const warnings = warningText(decoded.warnings);
    expect(warnings).toMatch(/duplicate.*alpha/i);
    expect(warnings).toMatch(/unknown.*missing/i);
    expect(warnings).toMatch(/extra.*extraRoot|extraRoot.*drop/i);
    for (const warning of decoded.warnings) {
      expect(warning).toEqual(expect.objectContaining({ code: expect.any(String), path: expect.any(String), message: expect.any(String) }));
    }
    expect(input).toEqual(inputBefore);
    expect(JSON.stringify(content)).toBe(contentBefore);
  });

  it("normalizes finite nonnegative resources and integer-clamped upgrades and stars", () => {
    const directCases = [
      [{ crystals: -5, dust: Number.NaN }, { crystals: 0, dust: 0 }],
      [{ crystals: Number.POSITIVE_INFINITY, dust: 2.5 }, { crystals: 0, dust: 2.5 }]
    ] as const;
    for (const [metaResources, expectedResources] of directCases) {
      const decoded = decodePlayerProfile({
        version: 2,
        clearedMissionIds: ["alpha", "beta"],
        starsByMission: { alpha: 99, beta: 0.9 },
        metaResources,
        upgradeLevels: { focus: 99.9, shield: -3 },
        selectedDifficultyId: "hard"
      }, createContent());
      expect(decoded.profile.metaResources).toEqual(expectedResources);
      expect(decoded.profile.upgradeLevels).toEqual({ focus: 3, shield: 0 });
      expect(decoded.profile.starsByMission).toEqual({ alpha: 2, beta: 0 });
      expect(decoded.warnings.length).toBeGreaterThan(0);
    }
  });

  it("falls back to authored default difficulty with a warning", () => {
    const input = { ...validProfile(), selectedDifficultyId: "nightmare" };
    const decoded = decodePlayerProfile(input, createContent());
    expect(decoded.profile.selectedDifficultyId).toBe("normal");
    expect(warningText(decoded.warnings)).toMatch(/difficulty.*nightmare|nightmare.*difficulty/i);
  });

  it("diagnoses non-coercible JSON objects without leaking ToPrimitive TypeErrors", () => {
    const nonCoercible = () => ({ toString: null, valueOf: null });
    const decoded = decodePlayerProfile({
      ...validProfile(),
      clearedMissionIds: [nonCoercible()],
      selectedDifficultyId: nonCoercible()
    }, createContent());
    expect(decoded.profile.clearedMissionIds).toEqual([]);
    expect(decoded.profile.selectedDifficultyId).toBe("normal");
    expect(warningText(decoded.warnings)).toMatch(/unknown.*mission|mission.*drop/i);
    expect(warningText(decoded.warnings)).toMatch(/difficulty.*default/i);

    let error: unknown;
    try {
      decodePlayerProfile({ ...validProfile(), version: nonCoercible() }, createContent());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/profile.*version|version.*profile/i);
  });

  it("fails closed on a future version with a typed error carrying the unsupported version", () => {
    let error: unknown;
    try {
      decodePlayerProfile({ ...validProfile(), version: 3 }, createContent());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UnsupportedPlayerProfileVersionError);
    expect(error).toMatchObject({
      code: "UNSUPPORTED_PLAYER_PROFILE_VERSION",
      version: 3
    });
  });

  it("rejects malformed explicit versions instead of guessing a migration", () => {
    for (const version of ["2", 0, -1, 1.5, null]) {
      expect(() => decodePlayerProfile({ ...validProfile(), version }, createContent())).toThrow(/profile.*version|version.*profile/i);
    }
  });

  it("rejects accessors without invoking them", () => {
    let rootReads = 0;
    const root = { ...validProfile() } as Record<string, unknown>;
    Object.defineProperty(root, "version", {
      enumerable: true,
      get() {
        rootReads += 1;
        return 2;
      }
    });
    expect(() => decodePlayerProfile(root, createContent())).toThrow(/accessor|data propert/i);
    expect(rootReads).toBe(0);

    let nestedReads = 0;
    const nested = { ...validProfile(), metaResources: {} as Record<string, unknown> };
    Object.defineProperty(nested.metaResources, "crystals", {
      enumerable: true,
      get() {
        nestedReads += 1;
        return 5;
      }
    });
    expect(() => decodePlayerProfile(nested, createContent())).toThrow(/accessor|data propert/i);
    expect(nestedReads).toBe(0);
  });

  it("rejects symbols, prototype pollution keys, exotic objects, sparse arrays, and cycles", () => {
    const symbolProfile = { ...validProfile(), [Symbol("unsafe")]: true };
    const polluted = JSON.parse(`{"version":2,"clearedMissionIds":[],"starsByMission":{},"metaResources":{},"upgradeLevels":{},"selectedDifficultyId":"normal","__proto__":{"polluted":true}}`) as unknown;
    const exoticRoot = new Map([["version", 2]]);
    const exoticNested = { ...validProfile(), metaResources: Object.assign(Object.create({ inherited: true }), { crystals: 1 }) };
    const sparse = ["alpha", , "beta"];
    const cyclic = { ...validProfile() } as Record<string, unknown>;
    cyclic.self = cyclic;

    for (const unsafe of [symbolProfile, polluted, exoticRoot, exoticNested, sparse, cyclic]) {
      expect(() => decodePlayerProfile(unsafe, createContent())).toThrow(/symbol|prototype|unsafe|sparse|cycle|canonical/i);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("round-trips prototype-shaped authored ids without accepting root pollution fields", () => {
    const input = profileInput();
    input.balance.metaProgression = {
      currencies: [{ id: "__proto__", label: "Prototype crystals" }],
      upgrades: {},
      rewardsByMission: {}
    };
    Object.defineProperty(input.balance.metaProgression.upgrades, "constructor", {
      value: {
        id: "constructor",
        label: "Constructor focus",
        maxLevel: 1,
        costs: [{}],
        effects: [{ kind: "coreHp", amountPerLevel: 1 }]
      },
      enumerable: true,
      configurable: true,
      writable: true
    });
    const content = createGameContentRegistry(input);
    expect(validateGameContentRegistry(content).ok).toBe(true);

    const profile = createEmptyPlayerProfile(content);
    expect(Object.prototype.hasOwnProperty.call(profile.metaResources, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(profile.upgradeLevels, "constructor")).toBe(true);

    const serialized = serializePlayerProfile(profile);
    const decoded = parsePlayerProfileJson(serialized, content);
    expect(decoded.profile).toEqual(profile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const pollutedRoot = JSON.parse(`{"__proto__":{"polluted":true}}`) as unknown;
    expect(() => decodePlayerProfile(pollutedRoot, content)).toThrow(/prototype|unsafe/i);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects oversized JSON and collections within explicit public budgets", () => {
    const oversizedJson = { ...validProfile(), ignored: "x".repeat(PLAYER_PROFILE_LIMITS.jsonBytes) };
    expect(() => decodePlayerProfile(oversizedJson, createContent())).toThrow(/profile|bytes|budget|large|limit/i);

    const oversizedClears = Array.from(
      { length: PLAYER_PROFILE_LIMITS.collectionEntries + 1 },
      () => "alpha"
    );
    expect(() => decodePlayerProfile(oversizedClears, createContent())).toThrow(/profile|entries|budget|large|limit/i);
  });

  it("parses JSON safely and rejects malformed or oversized source text", () => {
    expect(() => parsePlayerProfileJson("{not-json", createContent())).toThrow(/json|profile/i);
    const oversized = `{"ignored":"${"x".repeat(PLAYER_PROFILE_LIMITS.jsonBytes)}"}`;
    expect(() => parsePlayerProfileJson(oversized, createContent())).toThrow(/profile|bytes|budget|large|limit/i);
  });

  it("derives exact detached TowerDefenseGame launch options without project schema metadata", () => {
    const profile = decodePlayerProfile(validProfile(), createContent()).profile;
    const options = getPlayerProfileLaunchOptions(profile);
    expect(options).toEqual({
      difficultyId: "hard",
      metaUpgradeLevels: { focus: 2, shield: 1 }
    });
    expect(Object.keys(options)).toEqual(["difficultyId", "metaUpgradeLevels"]);
    expect(options).not.toHaveProperty("schemaVersion");
    expect(options.metaUpgradeLevels).not.toBe(profile.upgradeLevels);
    (options.metaUpgradeLevels as Record<string, number>).focus = 0;
    expect(profile.upgradeLevels.focus).toBe(2);
  });
});
