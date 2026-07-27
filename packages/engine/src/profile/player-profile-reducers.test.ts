import { describe, expect, it } from "vitest";
import {
  createEmptyPlayerProfile,
  createGameContentRegistry,
  decodePlayerProfile,
  isPlayerMissionUnlocked,
  newlyUnlockedPlayerMissionIds,
  parsePlayerProfileJson,
  purchasePlayerMetaUpgrade,
  recordPlayerMissionClear,
  selectPlayerDifficulty,
  serializePlayerProfile,
  validateGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry,
  type PlayerProfileV3
} from "../index.js";

function reducerInput(options: {
  reverseRewardKeys?: boolean;
  invalidUpgradeCost?: boolean;
  invalidMissionReward?: boolean;
} = {}): GameContentInput {
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
  const rewardBag = (crystal: number, dust: number): Record<string, number> => options.reverseRewardKeys
    ? { dust, crystal }
    : { crystal, dust };

  return {
    balance: {
      defaultMissionId: "start",
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
        start_waves: [{ id: "start_wave", label: "Start", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        branch_waves: [{ id: "branch_wave", label: "Branch", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        boss_waves: [{ id: "boss_wave", label: "Boss", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        hidden_waves: [{ id: "hidden_wave", label: "Hidden", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }]
      },
      missions: {
        start: mission("start", "start_waves", 3),
        branch: mission("branch", "branch_waves", 2),
        boss: mission("boss", "boss_waves", 1),
        hidden: mission("hidden", "hidden_waves", 0)
      },
      defaultDifficultyId: "normal",
      difficulties: [
        { id: "normal", label: "Normal" },
        { id: "hard", label: "Hard", enemyHpMultiplier: 1.25 }
      ],
      metaProgression: {
        currencies: [
          { id: "crystal", label: "Crystal" },
          { id: "dust", label: "Dust" }
        ],
        upgrades: {
          focus: {
            id: "focus",
            label: "Focus",
            maxLevel: 2,
            costs: [
              options.invalidUpgradeCost ? { crystal: -2, dust: 3 } : { crystal: 2, dust: 3 },
              { crystal: 5, dust: 1 }
            ],
            effects: [{ kind: "towerDamage", multiplierPerLevel: 0.1 }]
          }
        },
        rewardsByMission: {
          start: {
            firstClear: options.invalidMissionReward ? rewardBag(-3, 1) : rewardBag(3, 1),
            repeatClear: rewardBag(1, 1),
            perStar: rewardBag(2, 2)
          }
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 5,
        height: 3,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 4, r: 1 },
        pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 1 })),
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
      missionNodes: [
        { missionId: "start", regionId: "region", x: 20, y: 50, difficulty: 1, unlockRequiresMissionIds: [] },
        { missionId: "branch", regionId: "region", x: 50, y: 50, difficulty: 2, unlockRequiresMissionIds: ["start"] },
        { missionId: "boss", regionId: "region", x: 80, y: 50, difficulty: 3, unlockRequiresMissionIds: ["start", "branch"] }
      ]
    }
  };
}

function createContent(options: Parameters<typeof reducerInput>[0] = {}): GameContentRegistry {
  return createGameContentRegistry(reducerInput(options));
}

function createProfile(
  content: GameContentRegistry,
  overrides: Partial<Omit<PlayerProfileV3, "version">> = {}
): PlayerProfileV3 {
  const empty = createEmptyPlayerProfile(content);
  return decodePlayerProfile({ ...empty, ...overrides }, content).profile;
}

function expectDeeplyFrozenProfile(profile: PlayerProfileV3): void {
  expect(Object.isFrozen(profile)).toBe(true);
  expect(Object.isFrozen(profile.clearedMissionIds)).toBe(true);
  expect(Object.isFrozen(profile.starsByMission)).toBe(true);
  expect(Object.isFrozen(profile.metaResources)).toBe(true);
  expect(Object.isFrozen(profile.upgradeLevels)).toBe(true);
}

function expectFailureUnchanged(
  result: { readonly ok: boolean; readonly code: string; readonly profile: PlayerProfileV3 },
  profile: PlayerProfileV3,
  code: string
): void {
  const before = serializePlayerProfile(profile);
  expect(result).toEqual({ ok: false, code, profile });
  expect(Object.isFrozen(result)).toBe(true);
  expect(result.profile).toBe(profile);
  expect(serializePlayerProfile(result.profile)).toBe(before);
}

describe("player profile reducers", () => {
  it("selects an authored difficulty, reports an idempotent selection, and rejects an unknown id", () => {
    const content = createContent();
    const profile = createEmptyPlayerProfile(content);

    const selected = selectPlayerDifficulty(profile, content, "hard");
    expect(selected).toEqual({
      ok: true,
      code: "difficulty_selected",
      profile: { ...profile, selectedDifficultyId: "hard" }
    });
    expect(Object.isFrozen(selected)).toBe(true);
    expect(selected.profile).not.toBe(profile);
    expectDeeplyFrozenProfile(selected.profile);

    const unchanged = selectPlayerDifficulty(selected.profile, content, "hard");
    expect(unchanged).toEqual({ ok: true, code: "difficulty_unchanged", profile: selected.profile });
    expect(Object.isFrozen(unchanged)).toBe(true);

    expectFailureUnchanged(
      selectPlayerDifficulty(selected.profile, content, "nightmare"),
      selected.profile,
      "unknown_difficulty"
    );
  });

  it("runs every profile reducer/query from one detached snapshot without ordinary proxy reads", () => {
    const content = createContent();
    const original = createProfile(content, {
      clearedMissionIds: ["start"],
      starsByMission: { start: 1 },
      metaResources: { crystal: 20, dust: 20 }
    });
    const cases: readonly [string, (profile: PlayerProfileV3) => unknown][] = [
      ["select difficulty", (profile) => selectPlayerDifficulty(profile, content, "hard")],
      ["purchase upgrade", (profile) => purchasePlayerMetaUpgrade(profile, content, "focus")],
      ["mission clear", (profile) => recordPlayerMissionClear(profile, content, "start", 2)],
      ["mission unlock", (profile) => isPlayerMissionUnlocked(profile, content, "branch")],
      ["new unlocks", (profile) => newlyUnlockedPlayerMissionIds(profile, content, "start")]
    ];

    for (const [label, invoke] of cases) {
      let valueReads = 0;
      const proxy = new Proxy({ ...original } as PlayerProfileV3, {
        get() {
          valueReads += 1;
          throw new Error(`ordinary profile read reached for ${label}`);
        }
      });

      expect(() => invoke(proxy), label).not.toThrow();
      expect(valueReads, label).toBe(0);
    }
  });

  it("purchases a multi-currency upgrade atomically and returns a detached immutable success", () => {
    const content = createContent();
    const shortOnDust = createProfile(content, { metaResources: { crystal: 10, dust: 2 } });
    expectFailureUnchanged(
      purchasePlayerMetaUpgrade(shortOnDust, content, "focus"),
      shortOnDust,
      "insufficient_meta_resources"
    );

    const profile = createProfile(content, { metaResources: { crystal: 10, dust: 4 } });
    const purchased = purchasePlayerMetaUpgrade(profile, content, "focus");
    expect(purchased).toEqual({
      ok: true,
      code: "upgrade_purchased",
      profile: {
        ...profile,
        metaResources: { crystal: 8, dust: 1 },
        upgradeLevels: { focus: 1 }
      },
      upgradeId: "focus",
      previousLevel: 0,
      newLevel: 1
    });
    expect(Object.isFrozen(purchased)).toBe(true);
    expect(purchased.profile).not.toBe(profile);
    expect(purchased.profile.metaResources).not.toBe(profile.metaResources);
    expect(purchased.profile.upgradeLevels).not.toBe(profile.upgradeLevels);
    expectDeeplyFrozenProfile(purchased.profile);
    expect(profile.metaResources).toEqual({ crystal: 10, dust: 4 });
    expect(profile.upgradeLevels).toEqual({ focus: 0 });
  });

  it("rejects unknown and max-level upgrades without changing a serialized byte", () => {
    const content = createContent();
    const profile = createProfile(content, {
      metaResources: { crystal: 100, dust: 100 },
      upgradeLevels: { focus: 2 }
    });

    expectFailureUnchanged(purchasePlayerMetaUpgrade(profile, content, "missing"), profile, "unknown_upgrade");
    expectFailureUnchanged(purchasePlayerMetaUpgrade(profile, content, "focus"), profile, "upgrade_max_level");
  });

  it("rejects an invalid authored upgrade cost and content validation diagnoses the negative amount", () => {
    const content = createContent({ invalidUpgradeCost: true });
    const validation = validateGameContentRegistry(content);
    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityKind: "metaUpgrade",
        entityId: "focus",
        fieldPath: "costs[0].crystal",
        severity: "error"
      })
    ]));

    const profile = createProfile(content, { metaResources: { crystal: 10, dust: 10 } });
    expectFailureUnchanged(
      purchasePlayerMetaUpgrade(profile, content, "focus"),
      profile,
      "invalid_upgrade_cost"
    );
  });

  it("evaluates start, gated, missing-node, unknown, and multiple-dependency mission unlocks", () => {
    const content = createContent();
    const fresh = createEmptyPlayerProfile(content);
    expect(isPlayerMissionUnlocked(fresh, content, "start")).toBe(true);
    expect(isPlayerMissionUnlocked(fresh, content, "branch")).toBe(false);
    expect(isPlayerMissionUnlocked(fresh, content, "boss")).toBe(false);
    expect(isPlayerMissionUnlocked(fresh, content, "hidden")).toBe(true);
    expect(isPlayerMissionUnlocked(fresh, content, "missing")).toBe(false);

    const afterStart = createProfile(content, { clearedMissionIds: ["start"] });
    expect(isPlayerMissionUnlocked(afterStart, content, "branch")).toBe(true);
    expect(isPlayerMissionUnlocked(afterStart, content, "boss")).toBe(false);
    expect(newlyUnlockedPlayerMissionIds(afterStart, content, "start")).toEqual(["branch"]);

    const afterBoth = createProfile(content, { clearedMissionIds: ["start", "branch"] });
    expect(isPlayerMissionUnlocked(afterBoth, content, "boss")).toBe(true);
    expect(newlyUnlockedPlayerMissionIds(afterBoth, content, "branch")).toEqual(["boss"]);
  });

  it("records a first clear, grants first-clear and per-star rewards, and reports newly unlocked missions", () => {
    const content = createContent();
    const profile = createEmptyPlayerProfile(content);
    const recorded = recordPlayerMissionClear(profile, content, "start", 2);

    expect(recorded).toEqual({
      ok: true,
      code: "mission_clear_recorded",
      profile: {
        ...profile,
        clearedMissionIds: ["start"],
        starsByMission: { start: 2 },
        metaResources: { crystal: 7, dust: 5 }
      },
      missionId: "start",
      firstClear: true,
      previousStars: 0,
      earnedStars: 2,
      grantedResources: { crystal: 7, dust: 5 },
      newlyUnlockedMissionIds: ["branch"]
    });
    expect(Object.isFrozen(recorded)).toBe(true);
    expect(Object.isFrozen(recorded.grantedResources)).toBe(true);
    expect(Object.isFrozen(recorded.newlyUnlockedMissionIds)).toBe(true);
    expect(recorded.profile).not.toBe(profile);
    expectDeeplyFrozenProfile(recorded.profile);
    expect(profile).toEqual(createEmptyPlayerProfile(content));
  });

  it("grants repeat-clear rewards plus only the positive best-star delta", () => {
    const content = createContent();
    const first = recordPlayerMissionClear(createEmptyPlayerProfile(content), content, "start", 1);
    expect(first.ok).toBe(true);

    const repeated = recordPlayerMissionClear(first.profile, content, "start", 3);
    expect(repeated).toEqual({
      ok: true,
      code: "mission_clear_recorded",
      profile: {
        ...first.profile,
        starsByMission: { start: 3 },
        metaResources: { crystal: 10, dust: 8 }
      },
      missionId: "start",
      firstClear: false,
      previousStars: 1,
      earnedStars: 3,
      grantedResources: { crystal: 5, dust: 5 },
      newlyUnlockedMissionIds: []
    });
  });

  it("treats historical stars without a clear marker as a first clear and rewards only the positive star delta", () => {
    const content = createContent();
    const profile = createProfile(content, {
      clearedMissionIds: [],
      starsByMission: { start: 3 },
      metaResources: { crystal: 10, dust: 10 }
    });

    const recorded = recordPlayerMissionClear(profile, content, "start", 1);

    expect(recorded).toEqual({
      ok: true,
      code: "mission_clear_recorded",
      profile: {
        ...profile,
        clearedMissionIds: ["start"],
        starsByMission: { start: 3 },
        metaResources: { crystal: 13, dust: 11 }
      },
      missionId: "start",
      firstClear: true,
      previousStars: 3,
      earnedStars: 1,
      grantedResources: { crystal: 3, dust: 1 },
      newlyUnlockedMissionIds: ["branch"]
    });
    expect(serializePlayerProfile(recorded.profile)).toBe(
      '{"clearedMissionIds":["start"],"metaResources":{"crystal":13,"dust":11},"selectedDifficultyId":"normal","starsByMission":{"start":3},"upgradeLevels":{"focus":0},"version":3}'
    );
  });

  it("keeps the best star count and grants no extra per-star reward for a lower repeat result", () => {
    const content = createContent();
    const profile = createProfile(content, {
      clearedMissionIds: ["start"],
      starsByMission: { start: 3 },
      metaResources: { crystal: 20, dust: 20 }
    });
    const repeated = recordPlayerMissionClear(profile, content, "start", 1);

    expect(repeated).toEqual({
      ok: true,
      code: "mission_clear_recorded",
      profile: {
        ...profile,
        starsByMission: { start: 3 },
        metaResources: { crystal: 21, dust: 21 }
      },
      missionId: "start",
      firstClear: false,
      previousStars: 3,
      earnedStars: 1,
      grantedResources: { crystal: 1, dust: 1 },
      newlyUnlockedMissionIds: []
    });
  });

  it("rejects an unknown mission with the exact original profile", () => {
    const content = createContent();
    const profile = createEmptyPlayerProfile(content);
    expectFailureUnchanged(
      recordPlayerMissionClear(profile, content, "missing", 0),
      profile,
      "unknown_mission"
    );
  });

  it("rejects non-integer, non-finite, negative, and over-authored earned star counts", () => {
    const content = createContent();
    const profile = createEmptyPlayerProfile(content);
    for (const invalidStars of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 4]) {
      expectFailureUnchanged(
        recordPlayerMissionClear(profile, content, "start", invalidStars),
        profile,
        "invalid_earned_stars"
      );
    }
  });

  it("rejects an invalid mission reward and content validation diagnoses the negative amount", () => {
    const content = createContent({ invalidMissionReward: true });
    const validation = validateGameContentRegistry(content);
    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityKind: "metaReward",
        entityId: "start",
        fieldPath: "firstClear.crystal",
        severity: "error"
      })
    ]));

    const profile = createEmptyPlayerProfile(content);
    expectFailureUnchanged(
      recordPlayerMissionClear(profile, content, "start", 1),
      profile,
      "invalid_mission_reward"
    );
  });

  it("reports newly unlocked missions in authored mission order even when world-map nodes are reordered", () => {
    const input = reducerInput();
    const [startNode, branchNode, bossNode] = input.worldMap.missionNodes;
    input.worldMap.missionNodes = [
      startNode!,
      { ...bossNode!, unlockRequiresMissionIds: ["start"] },
      branchNode!
    ];
    const content = createGameContentRegistry(input);
    const afterStart = createProfile(content, { clearedMissionIds: ["start"] });

    expect(Object.keys(content.missions)).toEqual(["start", "branch", "boss", "hidden"]);
    expect(content.worldMap.missionNodes.map((node) => node.missionId)).toEqual(["start", "boss", "branch"]);
    expect(newlyUnlockedPlayerMissionIds(afterStart, content, "start")).toEqual(["branch", "boss"]);
  });

  it("uses own properties for prototype-shaped currency and mission ids and preserves a serializable profile", () => {
    const input = reducerInput();
    const prototypeMission = { ...input.balance.missions.start!, id: "__proto__" };
    input.balance.defaultMissionId = "__proto__";
    input.balance.missions = Object.fromEntries([["__proto__", prototypeMission]]);
    input.balance.metaProgression = {
      currencies: [{ id: "__proto__", label: "Prototype crystals" }],
      upgrades: {},
      rewardsByMission: Object.fromEntries([[
        "__proto__",
        { firstClear: Object.fromEntries([["__proto__", 4]]) }
      ]])
    };
    input.worldMap.missionNodes = [{
      ...input.worldMap.missionNodes[0]!,
      missionId: "__proto__",
      unlockRequiresMissionIds: []
    }];
    const content = createGameContentRegistry(input);
    const profile = Object.freeze({
      version: 3,
      clearedMissionIds: Object.freeze([] as string[]),
      starsByMission: Object.freeze({}),
      metaResources: Object.freeze({}),
      upgradeLevels: Object.freeze({}),
      selectedDifficultyId: "normal"
    }) satisfies PlayerProfileV3;

    const recorded = recordPlayerMissionClear(profile, content, "__proto__", 1);

    expect(recorded.ok).toBe(true);
    expect(recorded.profile.clearedMissionIds).toEqual(["__proto__"]);
    expect(Object.prototype.hasOwnProperty.call(recorded.profile.starsByMission, "__proto__")).toBe(true);
    expect(recorded.profile.starsByMission["__proto__"]).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(recorded.profile.metaResources, "__proto__")).toBe(true);
    expect(recorded.profile.metaResources["__proto__"]).toBe(4);
    const serialized = serializePlayerProfile(recorded.profile);
    expect(parsePlayerProfileJson(serialized, content).profile).toEqual(recorded.profile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("uses own properties for a constructor-shaped upgrade id", () => {
    const input = reducerInput();
    input.balance.metaProgression = {
      currencies: [{ id: "crystal", label: "Crystal" }],
      upgrades: Object.fromEntries([["constructor", {
        id: "constructor",
        label: "Constructor focus",
        maxLevel: 1,
        costs: [{ crystal: 2 }],
        effects: [{ kind: "coreHp", amountPerLevel: 1 }]
      }]]),
      rewardsByMission: {}
    };
    const content = createGameContentRegistry(input);
    const profile = Object.freeze({
      version: 3,
      clearedMissionIds: Object.freeze([] as string[]),
      starsByMission: Object.freeze({}),
      metaResources: Object.freeze({ crystal: 4 }),
      upgradeLevels: Object.freeze({}),
      selectedDifficultyId: "normal"
    }) satisfies PlayerProfileV3;

    const purchased = purchasePlayerMetaUpgrade(profile, content, "constructor");

    expect(purchased).toEqual({
      ok: true,
      code: "upgrade_purchased",
      profile: {
        ...profile,
        metaResources: { crystal: 2 },
        upgradeLevels: Object.fromEntries([["constructor", 1]])
      },
      upgradeId: "constructor",
      previousLevel: 0,
      newLevel: 1
    });
    expect(Object.prototype.hasOwnProperty.call(purchased.profile.upgradeLevels, "constructor")).toBe(true);
    const serialized = serializePlayerProfile(purchased.profile);
    expect(parsePlayerProfileJson(serialized, content).profile).toEqual(purchased.profile);
  });

  it("rejects a structurally typed profile with non-finite resources before an upgrade mutation", () => {
    const content = createContent();
    const profile = Object.freeze({
      ...createEmptyPlayerProfile(content),
      metaResources: Object.freeze({ crystal: Number.POSITIVE_INFINITY, dust: 10 })
    }) as PlayerProfileV3;
    const contentBefore = JSON.stringify(content);
    const resourceEntriesBefore = Object.entries(profile.metaResources);
    const invoke = (): string => {
      try {
        purchasePlayerMetaUpgrade(profile, content, "focus");
        return "NO_THROW";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };

    const firstError = invoke();
    expect(firstError).toBe("Player profile metaResources contains an invalid value.");
    expect(invoke()).toBe(firstError);
    expect(Object.entries(profile.metaResources)).toEqual(resourceEntriesBefore);
    expect(profile.metaResources.crystal).toBe(Number.POSITIVE_INFINITY);
    expect(profile.upgradeLevels.focus).toBe(0);
    expect(JSON.stringify(content)).toBe(contentBefore);
  });

  it("rejects a structurally typed profile with negative historical stars before clear rewards", () => {
    const content = createContent();
    const profile = Object.freeze({
      ...createEmptyPlayerProfile(content),
      starsByMission: Object.freeze({ start: -1 }),
      metaResources: Object.freeze({ crystal: 10, dust: 10 })
    }) as PlayerProfileV3;
    const profileBefore = JSON.stringify(profile);
    const contentBefore = JSON.stringify(content);
    const invoke = (): string => {
      try {
        recordPlayerMissionClear(profile, content, "start", 1);
        return "NO_THROW";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };

    const firstError = invoke();
    expect(firstError).toBe("Player profile starsByMission contains an invalid value.");
    expect(invoke()).toBe(firstError);
    expect(JSON.stringify(profile)).toBe(profileBefore);
    expect(JSON.stringify(content)).toBe(contentBefore);
  });

  it("is deterministic across reordered reward records and leaves both content registries unchanged", () => {
    const content = createContent();
    const reordered = createContent({ reverseRewardKeys: true });
    const contentBefore = JSON.stringify(content);
    const reorderedBefore = JSON.stringify(reordered);
    const profile = createProfile(content, { metaResources: { crystal: 20, dust: 20 } });
    const reorderedProfile = createProfile(reordered, { metaResources: { crystal: 20, dust: 20 } });

    const purchased = purchasePlayerMetaUpgrade(profile, content, "focus");
    const reorderedPurchase = purchasePlayerMetaUpgrade(reorderedProfile, reordered, "focus");
    expect(serializePlayerProfile(purchased.profile)).toBe(serializePlayerProfile(reorderedPurchase.profile));

    const recorded = recordPlayerMissionClear(purchased.profile, content, "start", 2);
    const reorderedRecord = recordPlayerMissionClear(reorderedPurchase.profile, reordered, "start", 2);
    expect(recorded).toEqual(reorderedRecord);
    expect(serializePlayerProfile(recorded.profile)).toBe(serializePlayerProfile(reorderedRecord.profile));
    expect(JSON.stringify(content)).toBe(contentBefore);
    expect(JSON.stringify(reordered)).toBe(reorderedBefore);
  });
});
