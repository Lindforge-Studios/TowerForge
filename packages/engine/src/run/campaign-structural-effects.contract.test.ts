import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createCampaignRun,
  createEmptyPlayerProfile,
  createGameContentRegistry,
  decodeCampaignRun,
  exportCampaignRun,
  importCampaignRun,
  recordCampaignBattleVictory,
  serializePlayerProfile,
  validateGameContentRegistry,
  type CampaignRunV1,
  type GameContentInput,
  type GameContentRegistry
} from "../index.js";

type StructuralChoiceResult = Readonly<{
  ok: boolean;
  code: string;
  nodeId?: string;
  choiceId?: string;
  run: CampaignRunV1;
  newlyAvailableNodeIds?: readonly string[];
}>;

type StructuralChoiceApi = {
  normalizeAuthoredWorldCampaignV2(value: unknown, content?: GameContentRegistry): unknown;
  resolveCampaignStructuralChoice(
    run: CampaignRunV1,
    content: GameContentRegistry,
    nodeId: string,
    choiceId: string
  ): StructuralChoiceResult;
};

function requiredApi<K extends keyof StructuralChoiceApi>(name: K): StructuralChoiceApi[K] {
  const candidate = (Engine as unknown as Partial<StructuralChoiceApi>)[name];
  expect(candidate, `Engine must export ${name}`).toBeTypeOf("function");
  return candidate as StructuralChoiceApi[K];
}

function ownResourceBag(entries: readonly (readonly [string, number])[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [resourceId, amount] of entries) {
    Object.defineProperty(result, resourceId, {
      value: amount,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return result;
}

function runResourceCatalog(): Record<string, { label: string }> {
  const result: Record<string, { label: string }> = {};
  for (const [id, label] of [
    ["coins", "Coins"],
    ["relics", "Relics"],
    ["__proto__", "Prototype token"]
  ] as const) {
    Object.defineProperty(result, id, {
      value: { label },
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return result;
}

function card(label: string, value: number): Record<string, unknown> {
  return {
    label,
    effects: [{
      kind: "modifier",
      scope: { kind: "all_towers" },
      modifier: { target: "damage", operation: "additive_ratio", value }
    }]
  };
}

function choice(
  id: string,
  costs: Record<string, number>,
  grants: Record<string, number>,
  label = id
) {
  return { id, label, costs, grants };
}

function battleNode(id: string, missionId: string, nextNodeIds: readonly string[], type: "battle" | "boss" = "battle") {
  return { id, type, missionId, regionId: "region", x: 10, y: 10, difficulty: 1 as const, nextNodeIds };
}

function structuralNode(
  id: string,
  nextNodeIds: readonly string[],
  choices: readonly ReturnType<typeof choice>[],
  type: "merchant" | "event" = "event"
) {
  return { id, type, label: id, regionId: "region", x: 20, y: 20, difficulty: 2 as const, nextNodeIds, choices };
}

function campaignV2() {
  return {
    schemaVersion: 2,
    rogueliteProfileId: "run",
    runResources: runResourceCatalog(),
    entryNodeIds: ["battle_start"],
    nodes: [
      battleNode("battle_start", "start", ["event_offer"]),
      structuralNode("event_offer", ["merchant_shop"], [
        choice("gift", {}, { coins: 5 }),
        choice("prototype_gift", {}, ownResourceBag([["__proto__", 2]]))
      ]),
      structuralNode("merchant_shop", ["boss_end"], [
        choice("buy_relic", { coins: 3 }, { relics: 1 }),
        choice("spend_all", { coins: 5 }, { relics: 1 }),
        choice("self_financing_forbidden", { coins: 100 }, { coins: 100 })
      ], "merchant"),
      battleNode("boss_end", "boss", [], "boss")
    ]
  };
}

function campaignV1() {
  return {
    schemaVersion: 1,
    rogueliteProfileId: "run",
    entryNodeIds: ["battle_start"],
    nodes: [
      battleNode("battle_start", "start", ["event_offer"]),
      {
        id: "event_offer", type: "event", label: "event_offer", regionId: "region",
        x: 20, y: 20, difficulty: 2 as const, nextNodeIds: ["boss_end"]
      },
      battleNode("boss_end", "boss", [], "boss")
    ]
  };
}

function input(options: {
  campaign?: unknown;
  enabled?: boolean;
  selected?: boolean;
} = {}): GameContentInput {
  const selected = options.selected ?? true;
  const mission = (id: string) => ({
    id,
    label: id,
    description: "",
    startingCoreHp: 20,
    startingResources: { coins: 20 },
    prepTimeUnits: 1,
    mapId: "lane",
    waveSetId: id,
    buildTowerIds: [] as string[],
    abilityIds: [] as string[],
    mechanics: selected ? { profiles: { roguelite: "run" } } : undefined,
    objectives: {
      victory: [{ id: "clear", kind: "clearWaves" as const }],
      stars: [{ id: "star", label: "Star", kind: "coreHpAtLeast" as const, amount: 1 }]
    }
  });
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
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
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
      waveSets: {
        start: [{ id: "start", label: "Start", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        boss: [{ id: "boss", label: "Boss", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }]
      },
      missions: { start: mission("start"), boss: mission("boss") },
      metaProgression: {
        currencies: [{ id: "shards", label: "Shards" }],
        upgrades: {},
        rewardsByMission: {
          start: { firstClear: { shards: 3 }, repeatClear: {}, perStar: { shards: 1 } },
          boss: { firstClear: { shards: 7 }, repeatClear: {}, perStar: { shards: 1 } }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 2, height: 1, defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 1, r: 0 },
        pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }], pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        roguelite: {
          schemaVersion: 4,
          enabled: options.enabled ?? true,
          profiles: {
            run: {
              synergies: {},
              artifacts: {
                definitions: {
                  scope: { label: "Scope", slotType: "optic", modifiers: [] }
                },
                towerSlots: {},
                bossLootTables: {}
              },
              draft: {
                definitions: {
                  ember: card("Ember", 0.1),
                  frost: card("Frost", 0.2),
                  storm: card("Storm", 0.3),
                  bloom: card("Bloom", 0.4)
                },
                pools: {
                  default: {
                    entries: ["ember", "frost", "storm", "bloom"].map((cardId) => ({ cardId, weight: 1 }))
                  }
                },
                defaultPoolId: "default"
              },
              campaign: { schemaVersion: 1 }
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
        { missionId: "boss", regionId: "region", x: 30, y: 30, difficulty: 2, unlockRequiresMissionIds: ["start"] }
      ],
      campaign: options.campaign ?? campaignV2()
    }
  } as unknown as GameContentInput;
}

function content(options: Parameters<typeof input>[0] = {}): GameContentRegistry {
  return createGameContentRegistry(input(options));
}

function progressedRun(
  nodeId: string,
  runResources: Record<string, number> = {},
  withPortableEntries = false
): CampaignRunV1 {
  return decodeCampaignRun({
    ...createCampaignRun("campaign-seed"),
    nodeId,
    deck: withPortableEntries ? [{ instanceId: "card_instance_1", cardId: "ember" }] : [],
    artifacts: withPortableEntries ? [{ instanceId: "artifact_instance_1", artifactId: "scope" }] : [],
    runResources
  }).run;
}

function reverseV2SourceOrder(): unknown {
  const graph = structuredClone(campaignV2()) as any;
  graph.entryNodeIds.reverse();
  graph.nodes.reverse();
  for (const node of graph.nodes) {
    node.nextNodeIds.reverse();
    if ("choices" in node) {
      node.choices.reverse();
      for (const option of node.choices) {
        option.costs = Object.fromEntries(Object.entries(option.costs).reverse());
        option.grants = Object.fromEntries(Object.entries(option.grants).reverse());
      }
    }
  }
  return graph;
}

function statefulRunProxy(first: CampaignRunV1, substituted: CampaignRunV1): {
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

describe("R4.4B WorldCampaign v2 structural transaction authoring", () => {
  it("publishes the independent v2 graph grammar and bounded resource-effect limits", () => {
    expect((Engine as unknown as Record<string, any>).WORLD_CAMPAIGN_SCHEMA).toMatchObject({
      supportedSchemaVersions: [1, 2],
      limits: {
        runResources: 256,
        choicesPerNode: 16,
        resourceEntriesPerBag: 16,
        totalChoices: 4_096,
        totalResourceEntries: 8_192,
        resourceAmount: 1_000_000_000,
        runResourceBalance: Number.MAX_SAFE_INTEGER
      },
      versions: {
        1: { structuralNodes: { choices: false } },
        2: {
          root: {
            requiredFields: ["schemaVersion", "rogueliteProfileId", "runResources", "entryNodeIds", "nodes"]
          },
          structuralNodes: {
            requiredFields: ["id", "type", "label", "regionId", "x", "y", "difficulty", "nextNodeIds", "choices"],
            choice: {
              requiredFields: ["id", "label", "costs", "grants"],
              optionalFields: [],
              additionalProperties: false
            }
          }
        }
      }
    });
  });

  it("keeps authored v1 active and presentation-only without migrating its bytes", () => {
    const registry = content({ campaign: campaignV1() });
    expect(validateGameContentRegistry(registry).ok).toBe(true);
    expect(Engine.resolveWorldCampaign(registry)).toMatchObject({
      schemaVersion: 1,
      source: "authored",
      rogueliteProfileId: "run"
    });
    const portable = exportCampaignRun(createCampaignRun("legacy-v1"));
    expect(exportCampaignRun(importCampaignRun(portable).run)).toBe(portable);
  });

  it("normalizes, detaches, binary-sorts, and deeply freezes an exact v2 graph", () => {
    const normalize = requiredApi("normalizeAuthoredWorldCampaignV2");
    const source = reverseV2SourceOrder();
    const before = structuredClone(source);
    const normalized = normalize(source, content()) as any;
    expect(normalized).toMatchObject({
      schemaVersion: 2,
      source: "authored",
      rogueliteProfileId: "run",
      entryNodeIds: ["battle_start"]
    });
    expect(normalized.nodes.map((node: { id: string }) => node.id))
      .toEqual(["battle_start", "boss_end", "event_offer", "merchant_shop"]);
    expect(normalized.nodes.find((node: { id: string }) => node.id === "event_offer").choices
      .map((option: { id: string }) => option.id))
      .toEqual(["gift", "prototype_gift"]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.nodes)).toBe(true);
    expect(Object.isFrozen(normalized.nodes[2].choices[0].grants)).toBe(true);
    expect(source).toEqual(before);
  });

  it("normalizes independently of authored node, choice, edge, and resource-key order", () => {
    const normalize = requiredApi("normalizeAuthoredWorldCampaignV2");
    expect(normalize(reverseV2SourceOrder(), content())).toEqual(normalize(campaignV2(), content()));
  });

  it("activates v2 through the unchanged opt-in roguelite v4 campaign marker", () => {
    const registry = content();
    expect(validateGameContentRegistry(registry).ok).toBe(true);
    expect(Engine.resolveWorldCampaign(registry)).toMatchObject({
      schemaVersion: 2,
      source: "authored",
      rogueliteProfileId: "run"
    });
    for (const inactive of [content({ enabled: false }), content({ selected: false })]) {
      expect(validateGameContentRegistry(inactive).ok).toBe(true);
      expect(Engine.resolveWorldCampaign(inactive)).toBeUndefined();
    }
  });

  it("rejects malformed, undeclared, over-budget, and future effects before activation", () => {
    const cases: readonly (readonly [string, unknown])[] = [
      ["empty choices", { ...campaignV2(), nodes: [structuralNode("event", [], [])], entryNodeIds: ["event"] }],
      ["all-zero choice", {
        ...campaignV2(),
        nodes: [structuralNode("event", [], [choice("bad", { coins: 0 }, { relics: 0 })])],
        entryNodeIds: ["event"]
      }],
      ["amount cap", {
        ...campaignV2(),
        nodes: [structuralNode("event", [], [choice("bad", {}, { coins: 1_000_000_001 })])],
        entryNodeIds: ["event"]
      }],
      ["undeclared resource", {
        ...campaignV2(),
        nodes: [structuralNode("event", [], [choice("bad", {}, { missing: 1 })])],
        entryNodeIds: ["event"]
      }],
      ["extra choice field", {
        ...campaignV2(),
        nodes: [structuralNode("event", [], [{ ...choice("bad", {}, { coins: 1 }), future: true } as any])],
        entryNodeIds: ["event"]
      }],
      ["future graph", { ...campaignV2(), schemaVersion: 3 }]
    ];
    for (const [label, campaign] of cases) {
      const registry = content({ campaign });
      const result = validateGameContentRegistry(registry);
      expect(result.ok, label).toBe(false);
      expect(Engine.resolveWorldCampaign(registry), label).toBeUndefined();
    }
  });
});

describe("R4.4B structural-node run-resource reducer", () => {
  it("records battle rewards once, grants an event once, and never mutates the persistent profile", () => {
    const registry = content();
    const profile = createEmptyPlayerProfile(registry);
    const battle = recordCampaignBattleVictory(createCampaignRun("campaign-seed"), profile, registry, "battle_start", 1);
    expect(battle).toMatchObject({ ok: true, code: "campaign_battle_recorded" });
    if (!battle.ok) throw new Error(battle.code);
    const profileBytes = serializePlayerProfile(battle.profile);
    const resolveChoice = requiredApi("resolveCampaignStructuralChoice");
    const event = resolveChoice(battle.run, registry, "event_offer", "gift");
    expect(event).toMatchObject({
      ok: true,
      code: "campaign_structural_choice_resolved",
      nodeId: "event_offer",
      choiceId: "gift",
      run: { nodeId: "event_offer", runResources: { coins: 5 } },
      newlyAvailableNodeIds: ["merchant_shop"]
    });
    expect(serializePlayerProfile(battle.profile)).toBe(profileBytes);
    expect(resolveChoice(event.run, registry, "event_offer", "gift")).toEqual({
      ok: false,
      code: "node_not_available",
      run: event.run
    });
    expect(serializePlayerProfile(battle.profile)).toBe(profileBytes);
  });

  it("checks every merchant cost against the pre-effect balance and applies cost plus reward atomically", () => {
    const resolveChoice = requiredApi("resolveCampaignStructuralChoice");
    const registry = content();
    const affordable = progressedRun("event_offer", { coins: 5 });
    expect(resolveChoice(affordable, registry, "merchant_shop", "buy_relic")).toMatchObject({
      ok: true,
      run: { nodeId: "merchant_shop", runResources: { coins: 2, relics: 1 } },
      newlyAvailableNodeIds: ["boss_end"]
    });
    expect(resolveChoice(affordable, registry, "merchant_shop", "spend_all")).toMatchObject({
      ok: true,
      run: { nodeId: "merchant_shop", runResources: { relics: 1 } }
    });

    const insufficient = progressedRun("event_offer", { coins: 1 });
    expect(resolveChoice(insufficient, registry, "merchant_shop", "buy_relic")).toEqual({
      ok: false,
      code: "insufficient_run_resources",
      run: insufficient
    });
    expect(exportCampaignRun(insufficient)).toBe(exportCampaignRun(progressedRun("event_offer", { coins: 1 })));

    const cannotSelfFinance = progressedRun("event_offer", { coins: 0 });
    expect(resolveChoice(cannotSelfFinance, registry, "merchant_shop", "self_financing_forbidden")).toEqual({
      ok: false,
      code: "insufficient_run_resources",
      run: cannotSelfFinance
    });
  });

  it("preserves deck/artifact order and returns a canonical portable v1 run", () => {
    const resolveChoice = requiredApi("resolveCampaignStructuralChoice");
    const before = progressedRun("battle_start", {}, true);
    const result = resolveChoice(before, content(), "event_offer", "gift");
    expect(result.ok).toBe(true);
    expect(result.run.seed).toBe(before.seed);
    expect(result.run.deck).toEqual(before.deck);
    expect(result.run.artifacts).toEqual(before.artifacts);
    expect(result.run.version).toBe(1);
    const exported = exportCampaignRun(result.run);
    expect(exportCampaignRun(importCampaignRun(exported).run)).toBe(exported);
    expect(Engine.validateCampaignRunAgainstContent(importCampaignRun(exported).run, content())).toMatchObject({ ok: true });
  });

  it("captures a hostile run exactly once and never uses ordinary proxy property reads", () => {
    const resolveChoice = requiredApi("resolveCampaignStructuralChoice");
    const first = structuredClone(progressedRun("battle_start"));
    const substituted = structuredClone(progressedRun("merchant_shop", { coins: 999 }));
    const subject = statefulRunProxy(first, substituted);
    const result = resolveChoice(subject.proxy, content(), "event_offer", "gift");
    expect(result).toMatchObject({ ok: true, run: { nodeId: "event_offer", runResources: { coins: 5 } } });
    expect(result.run === subject.proxy).toBe(false);
    expect(subject.descriptorPasses()).toBe(1);
    expect(subject.valueReads()).toBe(0);
  });

  it("keeps prototype-looking resource IDs inert own data and fails balance overflow atomically", () => {
    const resolveChoice = requiredApi("resolveCampaignStructuralChoice");
    const prototypeResult = resolveChoice(progressedRun("battle_start"), content(), "event_offer", "prototype_gift");
    expect(prototypeResult.ok).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(prototypeResult.run.runResources, "__proto__")).toBe(true);
    expect(prototypeResult.run.runResources.__proto__).toBe(2);
    expect(Object.getPrototypeOf(prototypeResult.run.runResources)).toBe(Object.prototype);

    const overflowing = progressedRun("battle_start", { coins: Number.MAX_SAFE_INTEGER });
    expect(resolveChoice(overflowing, content(), "event_offer", "gift")).toEqual({
      ok: false,
      code: "resource_overflow",
      run: overflowing
    });
  });

  it("rejects unknown choices, battle nodes, and invalid run resources without changing bytes", () => {
    const resolveChoice = requiredApi("resolveCampaignStructuralChoice");
    const run = progressedRun("battle_start");
    const bytes = exportCampaignRun(run);
    expect(resolveChoice(run, content(), "event_offer", "missing")).toEqual({
      ok: false,
      code: "unknown_choice",
      run
    });
    expect(resolveChoice(createCampaignRun("campaign-seed"), content(), "battle_start", "gift")).toEqual({
      ok: false,
      code: "node_type_not_implemented",
      run: createCampaignRun("campaign-seed")
    });
    const malformed = {
      ...structuredClone(createCampaignRun("campaign-seed")),
      version: 2
    } as unknown as CampaignRunV1;
    expect(resolveChoice(malformed, content(), "event_offer", "gift")).toEqual({
      ok: false,
      code: "invalid_run",
      run: malformed
    });
    const unknownResource = progressedRun("battle_start", { missing: 1 });
    expect(Engine.validateCampaignRunAgainstContent(unknownResource, content())).toEqual({
      ok: false,
      code: "unknown_run_resource",
      run: unknownResource
    });
    expect(resolveChoice(unknownResource, content(), "event_offer", "gift")).toEqual({
      ok: false,
      code: "unknown_run_resource",
      run: unknownResource
    });
    const fractionalResource = progressedRun("battle_start", { coins: 0.5 });
    expect(Engine.validateCampaignRunAgainstContent(fractionalResource, content())).toEqual({
      ok: false,
      code: "invalid_run_resource",
      run: fractionalResource
    });
    expect(resolveChoice(fractionalResource, content(), "event_offer", "gift")).toEqual({
      ok: false,
      code: "invalid_run_resource",
      run: fractionalResource
    });
    expect(exportCampaignRun(run)).toBe(bytes);
  });

  it("fails closed when a structural grant would exceed the CampaignRun aggregate budget", () => {
    const resolveChoice = requiredApi("resolveCampaignStructuralChoice");
    const fullRun = decodeCampaignRun({
      ...createCampaignRun("campaign-seed"),
      nodeId: "battle_start",
      deck: Array.from({ length: 10_000 }, (_, index) => ({
        instanceId: `c${index}`,
        cardId: "ember"
      }))
    }).run;
    const before = exportCampaignRun(fullRun);
    expect(resolveChoice(fullRun, content(), "event_offer", "gift")).toEqual({
      ok: false,
      code: "resource_overflow",
      run: fullRun
    });
    expect(exportCampaignRun(fullRun)).toBe(before);
  });
});
