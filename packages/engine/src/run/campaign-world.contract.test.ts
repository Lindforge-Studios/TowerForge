import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createCampaignRun,
  createEmptyPlayerProfile,
  createGameContentRegistry,
  validateGameContentRegistry,
  type CampaignRunV1,
  type GameContentInput,
  type GameContentRegistry,
  type PlayerProfileV3,
  type WorldMapCatalog
} from "../index.js";

type CampaignApi = {
  normalizeLegacyWorldCampaignV1(worldMap: WorldMapCatalog): unknown;
  resolveWorldCampaign(content: GameContentRegistry): unknown;
  validateCampaignRunAgainstContent(run: CampaignRunV1, content: GameContentRegistry): unknown;
  getAvailableCampaignNodeIds(run: CampaignRunV1, content: GameContentRegistry): readonly string[];
  recordCampaignBattleVictory(
    run: CampaignRunV1,
    profile: PlayerProfileV3,
    content: GameContentRegistry,
    nodeId: string,
    earnedStars: number
  ): unknown;
};

function api(): CampaignApi {
  const exports = Engine as unknown as Partial<CampaignApi>;
  expect(exports.normalizeLegacyWorldCampaignV1).toBeTypeOf("function");
  expect(exports.resolveWorldCampaign).toBeTypeOf("function");
  expect(exports.validateCampaignRunAgainstContent).toBeTypeOf("function");
  expect(exports.getAvailableCampaignNodeIds).toBeTypeOf("function");
  expect(exports.recordCampaignBattleVictory).toBeTypeOf("function");
  return exports as CampaignApi;
}

function battleNode(
  id: string,
  missionId: string,
  nextNodeIds: readonly string[],
  type: "battle" | "elite" | "boss" = "battle"
) {
  return { id, type, missionId, regionId: "region", x: 10, y: 10, difficulty: 1 as const, nextNodeIds };
}

function structuralNode(id: string, nextNodeIds: readonly string[], type: "merchant" | "event" = "event") {
  return { id, type, label: id, regionId: "region", x: 20, y: 20, difficulty: 2 as const, nextNodeIds };
}

function authoredCampaign() {
  return {
    schemaVersion: 1,
    rogueliteProfileId: "run",
    entryNodeIds: ["battle_start"],
    nodes: [
      battleNode("battle_start", "start", ["event_offer", "elite_frost"]),
      structuralNode("event_offer", ["boss_end"]),
      battleNode("elite_frost", "elite", ["boss_end"], "elite"),
      battleNode("boss_end", "boss", [], "boss")
    ]
  };
}

function input(options: {
  enabled?: boolean;
  selected?: boolean;
  profileCampaign?: unknown;
  campaign?: unknown;
  schemaVersion?: number;
} = {}): GameContentInput {
  const selected = options.selected ?? true;
  const mission = (id: string, waveSetId: string) => ({
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
      stars: [
        { id: "star_1", label: "One", kind: "coreHpAtLeast" as const, amount: 1 },
        { id: "star_2", label: "Two", kind: "coreHpAtLeast" as const, amount: 2 }
      ]
    },
    ...(selected ? { mechanics: { profiles: { roguelite: "run" } } } : {})
  });
  const result = {
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
          id: "grunt", label: "Grunt", maxHp: 1, speed: 1,
          reward: { coins: 0 }, coinReward: 0, coreDamage: 1, color: 0x778899
        }
      },
      towers: {},
      waveSets: Object.fromEntries(["start", "elite", "boss"].map((id) => [id, [{
        id: `${id}_wave`, label: id,
        groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
      }]])),
      missions: {
        start: mission("start", "start"),
        elite: mission("elite", "elite"),
        boss: mission("boss", "boss")
      },
      metaProgression: {
        currencies: [{ id: "shards", label: "Shards" }],
        upgrades: {},
        rewardsByMission: {
          start: { firstClear: { shards: 3 }, repeatClear: {}, perStar: { shards: 1 } }
        }
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
    mechanics: {
      schemaVersion: 1,
      modules: {
        roguelite: {
          schemaVersion: options.schemaVersion ?? 4,
          enabled: options.enabled ?? true,
          profiles: {
            run: {
              synergies: {},
              ...(options.profileCampaign === undefined
                ? { campaign: { schemaVersion: 1 } }
                : options.profileCampaign === null ? {} : { campaign: options.profileCampaign })
            }
          }
        }
      }
    },
    worldMap: {
      width: 100,
      height: 100,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#778899",
        bounds: { x: 0, y: 0, width: 100, height: 100 }, connections: []
      }],
      missionNodes: [
        { missionId: "start", regionId: "region", x: 10, y: 10, difficulty: 1, unlockRequiresMissionIds: [] },
        { missionId: "elite", regionId: "region", x: 20, y: 20, difficulty: 2, unlockRequiresMissionIds: ["start"] },
        { missionId: "boss", regionId: "region", x: 30, y: 30, difficulty: 3, unlockRequiresMissionIds: ["start", "elite"] }
      ],
      campaign: options.campaign ?? authoredCampaign()
    }
  };
  return result as unknown as GameContentInput;
}

function content(options: Parameters<typeof input>[0] = {}): GameContentRegistry {
  return createGameContentRegistry(input(options));
}

function issueText(value: GameContentRegistry): string {
  return validateGameContentRegistry(value).issues
    .map((issue) => `${issue.severity}:${issue.fieldPath}:${issue.message}`)
    .join("\n");
}

function reverseAuthoredOrder(value: GameContentInput): GameContentInput {
  const cloned = structuredClone(value) as GameContentInput & {
    worldMap: WorldMapCatalog & { campaign: ReturnType<typeof authoredCampaign> };
  };
  [...cloned.worldMap.campaign.entryNodeIds].reverse().forEach((nodeId, index) => {
    (cloned.worldMap.campaign.entryNodeIds as string[])[index] = nodeId;
  });
  [...cloned.worldMap.campaign.nodes].reverse().forEach((node, index) => {
    (cloned.worldMap.campaign.nodes as Array<ReturnType<typeof battleNode> | ReturnType<typeof structuralNode>>)[index] = node;
  });
  for (const node of cloned.worldMap.campaign.nodes) {
    (node as unknown as { nextNodeIds: string[] }).nextNodeIds = [...node.nextNodeIds].reverse();
  }
  return cloned;
}

function statefulCampaignRunProxy(first: CampaignRunV1, substituted: object): {
  readonly proxy: CampaignRunV1;
  readonly descriptorPasses: () => number;
  readonly valueReads: () => number;
} {
  let descriptorPasses = 0;
  let valueReads = 0;
  let active: object = first;
  const proxy = new Proxy({ ...first }, {
    ownKeys() {
      active = descriptorPasses === 0 ? first : substituted;
      descriptorPasses += 1;
      return Reflect.ownKeys(active);
    },
    getOwnPropertyDescriptor(_target, key) {
      return Reflect.getOwnPropertyDescriptor(active, key);
    },
    get() {
      valueReads += 1;
      throw new Error("ordinary proxy value read");
    }
  }) as CampaignRunV1;
  return { proxy, descriptorPasses: () => descriptorPasses, valueReads: () => valueReads };
}

describe("R4.4A campaign authoring and graph contracts", () => {
  it("publishes exact roguelite v4 and bounded world campaign v1 descriptors", () => {
    const descriptor = (Engine as unknown as Record<string, unknown>).ROGUELITE_MECHANICS_SCHEMA as Record<string, any>;
    expect(descriptor).toMatchObject({
      schemaVersion: 4,
      supportedModuleSchemaVersions: [1, 2, 3, 4],
      profileVersions: {
        4: {
          requiredFields: ["synergies"],
          optionalFields: ["artifacts", "draft", "campaign"],
          additionalProperties: false
        }
      },
      campaign: {
        requiredFields: ["schemaVersion"],
        optionalFields: [],
        additionalProperties: false,
        supportedSchemaVersions: [1]
      }
    });
    expect((Engine as unknown as Record<string, any>).WORLD_CAMPAIGN_SCHEMA).toMatchObject({
      supportedSchemaVersions: [1],
      nodeTypes: ["battle", "elite", "merchant", "event", "boss"],
      limits: {
        jsonBytes: 1_048_576,
        nodes: 1_024,
        edges: 8_192,
        entryNodes: 64,
        idUtf8Bytes: 128,
        labelUtf8Bytes: 256
      }
    });
  });

  it("normalizes legacy mission nodes read-only into deterministic battle nodes and reversed unlock edges", () => {
    const legacy = structuredClone(input().worldMap) as WorldMapCatalog & { campaign?: unknown };
    delete legacy.campaign;
    const before = structuredClone(legacy);
    const normalized = api().normalizeLegacyWorldCampaignV1(legacy);
    expect(normalized).toEqual({
      schemaVersion: 1,
      source: "legacy",
      rogueliteProfileId: null,
      entryNodeIds: ["start"],
      nodes: [
        { id: "boss", type: "battle", missionId: "boss", regionId: "region", x: 30, y: 30, difficulty: 3, nextNodeIds: [] },
        { id: "elite", type: "battle", missionId: "elite", regionId: "region", x: 20, y: 20, difficulty: 2, nextNodeIds: ["boss"] },
        { id: "start", type: "battle", missionId: "start", regionId: "region", x: 10, y: 10, difficulty: 1, nextNodeIds: ["boss", "elite"] }
      ]
    });
    expect(legacy).toEqual(before);
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  it("activates only an enabled, selected v4 profile with an exact campaign marker and matching authored graph", () => {
    const active = content();
    expect(validateGameContentRegistry(active).ok).toBe(true);
    expect(api().resolveWorldCampaign(active)).toMatchObject({
      schemaVersion: 1,
      source: "authored",
      rogueliteProfileId: "run",
      entryNodeIds: ["battle_start"]
    });

    for (const inactive of [
      content({ enabled: false }),
      content({ selected: false }),
      content({ profileCampaign: null }),
      content({ schemaVersion: 3, profileCampaign: null })
    ]) {
      expect(api().resolveWorldCampaign(inactive)).toBeUndefined();
      const run = createCampaignRun("seed");
      expect(api().getAvailableCampaignNodeIds(run, inactive)).toEqual([]);
      expect(Object.isFrozen(api().getAvailableCampaignNodeIds(run, inactive))).toBe(true);
    }
  });

  it("keeps structurally valid inactive graph reference defects as warnings", () => {
    const registry = content({
      enabled: false,
      campaign: {
        ...authoredCampaign(),
        entryNodeIds: ["inactive"],
        nodes: [{
          ...battleNode("inactive", "missing_mission", []),
          regionId: "missing_region"
        }]
      }
    });
    const result = validateGameContentRegistry(registry);
    expect(result.ok).toBe(true);
    expect(result.issues.some((issue) => (
      issue.severity === "warning" && /missing_mission|missing_region/i.test(`${issue.fieldPath}:${issue.message}`)
    ))).toBe(true);
    expect(api().resolveWorldCampaign(registry)).toBeUndefined();
  });

  it("keeps an unselected v4 campaign semantically inactive even when its marker is enabled", () => {
    const registry = content({
      selected: false,
      campaign: {
        ...authoredCampaign(),
        entryNodeIds: ["inactive"],
        nodes: [{
          ...battleNode("inactive", "missing_mission", []),
          regionId: "missing_region"
        }]
      }
    });
    const result = validateGameContentRegistry(registry);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", fieldPath: expect.stringMatching(/campaign.*regionId/) }),
      expect.objectContaining({ severity: "warning", fieldPath: expect.stringMatching(/campaign.*missionId/) })
    ]));
    expect(api().resolveWorldCampaign(registry)).toBeUndefined();
  });

  it("fails closed on malformed/future markers, closed shapes, invalid graph references, cycles, and unreachable nodes", () => {
    const invalidCases: readonly [string, Parameters<typeof input>[0], RegExp][] = [
      ["future marker", { profileCampaign: { schemaVersion: 2 } }, /campaign.*schema|version/i],
      ["extra marker field", { profileCampaign: { schemaVersion: 1, future: true } }, /campaign.*future|unsupported|unknown/i],
      ["future graph", { campaign: { ...authoredCampaign(), schemaVersion: 2 } }, /campaign.*schema|version/i],
      ["duplicate node", { campaign: { ...authoredCampaign(), nodes: [battleNode("same", "start", []), battleNode("same", "elite", [])], entryNodeIds: ["same"] } }, /duplicate.*node|node.*duplicate/i],
      ["unknown entry", { campaign: { ...authoredCampaign(), entryNodeIds: ["missing"] } }, /entry.*missing|unknown.*entry/i],
      ["unknown edge", { campaign: { ...authoredCampaign(), nodes: [battleNode("battle_start", "start", ["missing"])] } }, /nextNodeIds.*missing|unknown.*node/i],
      ["self edge", { campaign: { ...authoredCampaign(), nodes: [battleNode("battle_start", "start", ["battle_start"])] } }, /self|cycle/i],
      ["cycle", { campaign: { ...authoredCampaign(), nodes: [battleNode("battle_start", "start", ["boss_end"]), battleNode("boss_end", "boss", ["battle_start"], "boss")] } }, /cycle/i],
      ["unreachable", { campaign: { ...authoredCampaign(), nodes: [...authoredCampaign().nodes, structuralNode("orphan", [])] } }, /orphan|reachable/i],
      ["unknown region", { campaign: { ...authoredCampaign(), nodes: [structuralNode("event", [])].map((node) => ({ ...node, regionId: "missing" })), entryNodeIds: ["event"] } }, /region.*missing|unknown.*region/i],
      ["unknown mission", { campaign: { ...authoredCampaign(), nodes: [battleNode("battle", "missing", [])], entryNodeIds: ["battle"] } }, /mission.*missing|unknown.*mission/i]
    ];
    for (const [label, options, expected] of invalidCases) {
      const result = validateGameContentRegistry(content(options));
      expect(result.ok, `${label}\n${issueText(content(options))}`).toBe(false);
      expect(issueText(content(options)), label).toMatch(expected);
      expect(api().resolveWorldCampaign(content(options)), label).toBeUndefined();
    }
  });

  it("enforces node, edge, entry, id, and label budgets before exposing an active campaign", () => {
    const tooManyNodes = Array.from({ length: 1_025 }, (_, index) => structuralNode(`n_${index}`, index === 1_024 ? [] : [`n_${index + 1}`]));
    const edgeNodes = Array.from({ length: 130 }, (_, index) => structuralNode(
      `e_${index}`,
      Array.from({ length: 130 - index - 1 }, (_unused, offset) => `e_${index + offset + 1}`)
    ));
    const cases: readonly [string, unknown, RegExp][] = [
      ["nodes", { ...authoredCampaign(), entryNodeIds: ["n_0"], nodes: tooManyNodes }, /node.*1.?024|budget|limit/i],
      ["edges", { ...authoredCampaign(), entryNodeIds: ["e_0"], nodes: edgeNodes }, /edge.*8.?192|budget|limit/i],
      ["entries", { ...authoredCampaign(), entryNodeIds: Array.from({ length: 65 }, (_, index) => `i_${index}`), nodes: Array.from({ length: 65 }, (_, index) => structuralNode(`i_${index}`, [])) }, /entr.*64|budget|limit/i],
      ["id", { ...authoredCampaign(), entryNodeIds: ["x".repeat(129)], nodes: [structuralNode("x".repeat(129), [])] }, /id.*128|byte|limit/i],
      ["label", { ...authoredCampaign(), entryNodeIds: ["event"], nodes: [{ ...structuralNode("event", []), label: "я".repeat(129) }] }, /label.*256|byte|limit/i]
    ];
    for (const [label, campaign, expected] of cases) {
      const registry = content({ campaign });
      const result = validateGameContentRegistry(registry);
      expect(result.ok, `${label}\n${issueText(registry)}`).toBe(false);
      expect(issueText(registry), label).toMatch(expected);
      expect(api().resolveWorldCampaign(registry), label).toBeUndefined();
    }
  });

  it("normalizes authored order and graph queries independently of object/array source order", () => {
    const first = content();
    const second = createGameContentRegistry(reverseAuthoredOrder(input()));
    expect(api().resolveWorldCampaign(second)).toEqual(api().resolveWorldCampaign(first));
    expect(api().getAvailableCampaignNodeIds(createCampaignRun("seed"), second))
      .toEqual(api().getAvailableCampaignNodeIds(createCampaignRun("seed"), first));
  });
});

describe("R4.4A CampaignRunV1 content semantics and reducers", () => {
  it("captures each hostile CampaignRun once and uses only the detached value", () => {
    const registry = content();
    const first = structuredClone(createCampaignRun("seed")) as CampaignRunV1;
    const substituted = { ...first, version: 2, nodeId: "boss_end" };

    const validationSubject = statefulCampaignRunProxy(first, substituted);
    let validation: any;
    try {
      validation = api().validateCampaignRunAgainstContent(validationSubject.proxy, registry);
    } catch (cause) {
      throw new Error("validation recaptured the hostile run", { cause });
    }
    expect(validation).toMatchObject({ ok: true, code: "valid", run: first });
    expect(validation.run === validationSubject.proxy).toBe(false);
    expect(Object.isFrozen(validation.run)).toBe(true);
    expect(validationSubject.descriptorPasses()).toBe(1);
    expect(validationSubject.valueReads()).toBe(0);

    const availabilitySubject = statefulCampaignRunProxy(first, substituted);
    let available: readonly string[];
    try {
      available = api().getAvailableCampaignNodeIds(availabilitySubject.proxy, registry);
    } catch (cause) {
      throw new Error("availability recaptured the hostile run", { cause });
    }
    expect(available).toEqual(["battle_start"]);
    expect(availabilitySubject.descriptorPasses()).toBe(1);
    expect(availabilitySubject.valueReads()).toBe(0);

    const victorySubject = statefulCampaignRunProxy(first, substituted);
    let victory: any;
    try {
      victory = api().recordCampaignBattleVictory(
        victorySubject.proxy,
        createEmptyPlayerProfile(registry),
        registry,
        "battle_start",
        2
      );
    } catch (cause) {
      throw new Error("victory recaptured the hostile run", { cause });
    }
    expect(victory).toMatchObject({
      ok: true,
      code: "campaign_battle_recorded",
      run: { ...first, nodeId: "battle_start" }
    });
    expect(victorySubject.descriptorPasses()).toBe(1);
    expect(victorySubject.valueReads()).toBe(0);
  });

  it("validates the unchanged v1 document against the active campaign and rejects unknown progress", () => {
    const registry = content();
    const run = createCampaignRun("seed");
    expect(api().validateCampaignRunAgainstContent(run, registry)).toMatchObject({
      ok: true,
      code: "valid",
      run,
      campaign: { source: "authored", rogueliteProfileId: "run" }
    });
    const forged = { ...run, nodeId: "unknown_node" } as CampaignRunV1;
    expect(api().validateCampaignRunAgainstContent(forged, registry)).toEqual({
      ok: false,
      code: "unknown_node",
      run: forged
    });
    expect(api().getAvailableCampaignNodeIds(forged, registry)).toEqual([]);
  });

  it("returns binary-sorted entry/direct-successor choices and never mutates the run or authored graph", () => {
    const registry = content();
    const fresh = createCampaignRun("seed");
    const progressed = { ...fresh, nodeId: "battle_start" } as CampaignRunV1;
    const before = structuredClone(registry.worldMap);
    expect(api().getAvailableCampaignNodeIds(fresh, registry)).toEqual(["battle_start"]);
    expect(api().getAvailableCampaignNodeIds(progressed, registry)).toEqual(["elite_frost", "event_offer"]);
    expect(Object.isFrozen(api().getAvailableCampaignNodeIds(progressed, registry))).toBe(true);
    expect(registry.worldMap).toEqual(before);
    expect(fresh.nodeId).toBeNull();
  });

  it("records one available battle victory into separate immutable run/profile documents", () => {
    const registry = content();
    const run = createCampaignRun("seed");
    const profile = createEmptyPlayerProfile(registry);
    const result = api().recordCampaignBattleVictory(run, profile, registry, "battle_start", 2) as any;
    expect(result).toMatchObject({
      ok: true,
      code: "campaign_battle_recorded",
      nodeId: "battle_start",
      run: { ...run, nodeId: "battle_start" },
      profile: {
        version: 3,
        clearedMissionIds: ["start"],
        starsByMission: { start: 2 },
        metaResources: { shards: 5 }
      },
      newlyAvailableNodeIds: ["elite_frost", "event_offer"]
    });
    expect(result.run).not.toBe(run);
    expect(result.profile).not.toBe(profile);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.run)).toBe(true);
    expect(Object.isFrozen(result.profile)).toBe(true);
    expect(run.nodeId).toBeNull();
    expect(profile.clearedMissionIds).toEqual([]);

    expect(api().recordCampaignBattleVictory(result.run, result.profile, registry, "battle_start", 2)).toEqual({
      ok: false,
      code: "node_not_available",
      run: result.run,
      profile: result.profile
    });
  });

  it("keeps inactive, unavailable, structural-node, and profile failures atomic", () => {
    const active = content();
    const run = createCampaignRun("seed");
    const profile = createEmptyPlayerProfile(active);
    const cases: readonly [string, GameContentRegistry, string, number, string][] = [
      ["inactive", content({ enabled: false }), "battle_start", 1, "campaign_inactive"],
      ["unavailable", active, "boss_end", 1, "node_not_available"],
      ["structural", active, "event_offer", 1, "node_not_available"],
      ["profile reducer", active, "battle_start", 3, "invalid_earned_stars"]
    ];
    for (const [label, registry, nodeId, stars, code] of cases) {
      const result = api().recordCampaignBattleVictory(run, profile, registry, nodeId, stars);
      expect(result, label).toEqual({ ok: false, code, run, profile });
    }

    const afterStart = { ...run, nodeId: "battle_start" } as CampaignRunV1;
    expect(api().recordCampaignBattleVictory(afterStart, profile, active, "event_offer", 0)).toEqual({
      ok: false,
      code: "node_type_not_implemented",
      run: afterStart,
      profile
    });
  });
});
