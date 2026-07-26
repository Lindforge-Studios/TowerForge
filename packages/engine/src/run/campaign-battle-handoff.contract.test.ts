import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  CAMPAIGN_RUN_LIMITS,
  CAMPAIGN_RUN_SCHEMA_VERSION,
  computeCheckpointStateDigest,
  GAME_CHECKPOINT_SCHEMA_VERSION,
  GAME_COMMAND_SCHEMA_VERSION,
  PLAYER_PROFILE_SCHEMA_VERSION,
  TowerDefenseGame,
  createCampaignRun,
  createEmptyPlayerProfile,
  createGameContentRegistry,
  decodeCampaignRun,
  exportCampaignRun,
  serializePlayerProfile,
  type CampaignRunV1,
  type GameContentInput,
  type GameContentRegistry,
  type GameSeed,
  type PlayerProfileV3
} from "../index.js";

type CampaignBattleFailureCode =
  | "campaign_inactive"
  | "campaign_handoff_inactive"
  | "invalid_run"
  | "node_not_available"
  | "node_type_not_implemented"
  | "modifier_budget_exceeded"
  | "battle_context_mismatch"
  | "battle_not_victorious"
  | "run_capacity_exceeded";

interface CampaignBattleLaunch {
  readonly launchId: string;
  readonly battleSeed: GameSeed;
  readonly missionId: string;
  readonly loadout: Readonly<{
    deck: CampaignRunV1["deck"];
    artifacts: CampaignRunV1["artifacts"];
  }>;
}

type CampaignBattlePreparationResult = Readonly<
  | {
      ok: false;
      code: CampaignBattleFailureCode;
      run: CampaignRunV1;
    }
  | {
      ok: true;
      code: "campaign_battle_prepared";
      nodeId: string;
      missionId: string;
      launchId: string;
      battleSeed: GameSeed;
      run: CampaignRunV1;
      launch: CampaignBattleLaunch;
      game: TowerDefenseGame;
    }
>;

type CampaignBattleSettlementResult = Readonly<
  | {
      ok: false;
      code: CampaignBattleFailureCode;
      run: CampaignRunV1;
      profile: PlayerProfileV3;
    }
  | {
      ok: true;
      code: "campaign_battle_settled";
      nodeId: string;
      run: CampaignRunV1;
      profile: PlayerProfileV3;
      newlyAvailableNodeIds: readonly string[];
    }
>;

type CampaignBattleApi = {
  prepareCampaignBattle(
    run: CampaignRunV1,
    content: GameContentRegistry,
    nodeId: string
  ): CampaignBattlePreparationResult;
  settleCampaignBattleVictory(
    run: CampaignRunV1,
    profile: PlayerProfileV3,
    content: GameContentRegistry,
    nodeId: string,
    earnedStars: number,
    game: TowerDefenseGame
  ): CampaignBattleSettlementResult;
};

function api(): CampaignBattleApi {
  return Engine as unknown as CampaignBattleApi;
}

function card(label: string, value?: number): Record<string, unknown> {
  return {
    label,
    effects: value === undefined ? [] : [{
      kind: "modifier",
      scope: { kind: "all_towers" },
      modifier: { target: "damage", operation: "additive_ratio", value }
    }]
  };
}

function campaignNode(
  id: string,
  missionId: string,
  nextNodeIds: readonly string[],
  type: "battle" | "boss" = "battle"
): Record<string, unknown> {
  return { id, type, missionId, regionId: "region", x: 1, y: 1, difficulty: 1, nextNodeIds };
}

function campaignInput(options: {
  active?: boolean;
  reverse?: boolean;
  markerVersion?: 1 | 2;
} = {}): GameContentInput {
  const active = options.active ?? true;
  const reverse = options.reverse ?? false;
  const markerVersion = options.markerVersion ?? 2;
  const definitions = reverse
    ? {
        blank: card("Blank", 0),
        bloom: card("Bloom", 0.4),
        storm: card("Storm", 0.3),
        frost: card("Frost", 0.2),
        ember: card("Ember", 0.5)
      }
    : {
        ember: card("Ember", 0.5),
        frost: card("Frost", 0.2),
        storm: card("Storm", 0.3),
        bloom: card("Bloom", 0.4),
        blank: card("Blank", 0)
      };
  const poolEntries = reverse
    ? ["bloom", "storm", "frost", "ember"]
    : ["ember", "frost", "storm", "bloom"];
  const nodes = [
    campaignNode("battle_start", "battle", ["boss_end"]),
    {
      id: "event_offer",
      type: "event",
      label: "Event",
      regionId: "region",
      x: 2,
      y: 2,
      difficulty: 1,
      nextNodeIds: [],
      choices: [{ id: "gift", label: "Gift", costs: {}, grants: { credits: 1 } }]
    },
    campaignNode("boss_end", "boss", [], "boss")
  ];
  if (reverse) nodes.reverse();

  const mission = (id: string) => ({
    id,
    label: id,
    description: "",
    startingCoreHp: 20,
    startingResources: { coins: 100 },
    prepTimeUnits: 2,
    mapId: "lane",
    waveSetId: "run",
    buildTowerIds: ["cannon"],
    abilityIds: ["strike"],
    ...(active ? { mechanics: { profiles: { roguelite: "run" } } } : {})
  });

  return {
    balance: {
      defaultMissionId: "battle",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 2,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor",
          label: "Floor",
          buildable: true,
          walkable: true,
          groundSpeedMultiplier: 1,
          tags: []
        }
      },
      abilities: {
        strike: {
          id: "strike",
          label: "Strike",
          cooldown: 0,
          duration: 0,
          radius: 1,
          effects: [{ kind: "damage", amount: 100 }]
        }
      },
      enemies: {
        boss: {
          id: "boss",
          label: "Boss",
          maxHp: 100,
          speed: 0.01,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 1
        }
      },
      towers: {
        cannon: {
          id: "cannon",
          label: "Cannon",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 10,
          attack: {
            kind: "single",
            fireRate: 4,
            damagePerStack: 2,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1
          }
        }
      },
      waveSets: {
        run: [1, 2].map((number) => ({
          id: `wave_${number}`,
          label: `Wave ${number}`,
          groups: [{ enemyId: "boss", count: 1, spawnInterval: 1, startDelay: 0 }]
        }))
      },
      missions: {
        battle: mission("battle"),
        boss: mission("boss")
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 8,
        height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 7, r: 1 },
        pathCenterline: Array.from({ length: 8 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    ...(active ? {
      mechanics: {
        schemaVersion: 1,
        modules: {
          roguelite: {
            schemaVersion: 4,
            enabled: true,
            profiles: {
              run: {
                synergies: {},
                artifacts: {
                  definitions: {
                    scope: { label: "Scope", slotType: "scope", modifiers: [] },
                    vault: { label: "Vault", slotType: "scope", modifiers: [] }
                  },
                  towerSlots: {
                    cannon: [{ slotId: "optic", slotType: "scope" }]
                  },
                  bossLootTables: {
                    boss: { rolls: 1, entries: [{ artifactId: "scope", weight: 1 }] }
                  }
                },
                draft: {
                  definitions,
                  pools: {
                    default: { entries: poolEntries.map((cardId) => ({ cardId, weight: 1 })) }
                  },
                  defaultPoolId: "default"
                },
                campaign: { schemaVersion: markerVersion }
              }
            }
          }
        }
      }
    } : {}),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        biome: "test",
        accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        connections: []
      }],
      missionNodes: [
        { missionId: "battle", regionId: "region", x: 1, y: 1, difficulty: 1, unlockRequiresMissionIds: [] },
        { missionId: "boss", regionId: "region", x: 3, y: 3, difficulty: 1, unlockRequiresMissionIds: ["battle"] }
      ],
      ...(active ? {
        campaign: {
          schemaVersion: 2,
          rogueliteProfileId: "run",
          runResources: { credits: { label: "Credits" } },
          entryNodeIds: ["battle_start", "event_offer"],
          nodes
        }
      } : {})
    }
  } as unknown as GameContentInput;
}

function content(options: Parameters<typeof campaignInput>[0] = {}): GameContentRegistry {
  return createGameContentRegistry(campaignInput(options));
}

function run(overrides: Partial<CampaignRunV1> = {}): CampaignRunV1 {
  return decodeCampaignRun({
    ...createCampaignRun("campaign-battle-seed"),
    deck: [{ instanceId: "card_1", cardId: "ember" }],
    artifacts: [{ instanceId: "artifact_1", artifactId: "scope" }],
    runResources: { credits: 0 },
    ...overrides
  }).run;
}

function snapshotDraft(subject: TowerDefenseGame): {
  pendingOffer: null | {
    offerId: string;
    options: Array<{ cardId: string; label: string }>;
  };
} {
  return (subject.getSnapshot() as unknown as {
    roguelite: { draft: {
      pendingOffer: null | { offerId: string; options: Array<{ cardId: string; label: string }> };
    } };
  }).roguelite.draft;
}

function killCurrentWave(subject: TowerDefenseGame): void {
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  expect(subject.useAbility("strike", { q: 0, r: 1 })).toEqual({ ok: true });
  subject.tick(0);
}

function finishTwoWaveBattle(subject: TowerDefenseGame): string {
  killCurrentWave(subject);
  const pending = snapshotDraft(subject).pendingOffer;
  expect(pending).not.toBeNull();
  const picked = pending!.options[0]!.cardId;
  expect(subject.chooseDraftOption(pending!.offerId, picked)).toEqual({ ok: true });
  killCurrentWave(subject);
  expect(subject.getSnapshot().outcome).toBe("victory");
  return picked;
}

describe("R4.4C campaign-to-battle handoff contract", () => {
  it("keeps the legacy constructor and all existing version domains unchanged", () => {
    const legacyContent = content({ active: false });
    const legacy = new TowerDefenseGame({ content: legacyContent, missionId: "battle", seed: "legacy" });
    const checkpoint = legacy.createCheckpoint();

    expect(CAMPAIGN_RUN_SCHEMA_VERSION).toBe(1);
    expect(GAME_CHECKPOINT_SCHEMA_VERSION).toBe(1);
    expect(GAME_COMMAND_SCHEMA_VERSION).toBe(4);
    expect(PLAYER_PROFILE_SCHEMA_VERSION).toBe(3);
    expect(checkpoint.schemaVersion).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(checkpoint.state, "campaignBattle")).toBe(false);
    expect(legacy.getSnapshot().roguelite).toBeUndefined();
  });

  it("publishes separate prepare and settle entry points instead of changing CampaignRunV1", () => {
    expect((Engine as unknown as Partial<CampaignBattleApi>).prepareCampaignBattle).toBeTypeOf("function");
    expect((Engine as unknown as Partial<CampaignBattleApi>).settleCampaignBattleVictory).toBeTypeOf("function");
    expect(Object.keys(createCampaignRun("schema"))).toEqual([
      "version", "seed", "nodeId", "deck", "artifacts", "runResources"
    ]);
  });

  it("keeps marker v1 active but explicitly outside the v2 handoff protocol", () => {
    const registry = content({ markerVersion: 1 });
    expect(api().prepareCampaignBattle(run(), registry, "battle_start")).toMatchObject({
      ok: false,
      code: "campaign_handoff_inactive"
    });
    const direct = new TowerDefenseGame({ content: registry, missionId: "battle", seed: "marker-v1" });
    expect(direct.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(direct.canSocketArtifact("artifact_1", "tower_1", "optic")).toMatchObject({
      ok: false,
      reasonKey: "reason.artifactBetweenWavesOnly"
    });
  });

  it("hydrates portable deck and artifact state, derives the seed, and survives checkpoint restore", () => {
    const registry = content();
    const portable = run();
    const prepared = api().prepareCampaignBattle(portable, registry, "battle_start");
    expect(prepared).toMatchObject({
      ok: true,
      code: "campaign_battle_prepared",
      nodeId: "battle_start",
      missionId: "battle",
      run: portable
    });
    if (!prepared.ok) throw new Error(prepared.code);

    const checkpoint = prepared.game.createCheckpoint() as typeof prepared.game extends never ? never : ReturnType<TowerDefenseGame["createCheckpoint"]> & {
      state: ReturnType<TowerDefenseGame["createCheckpoint"]>["state"] & {
        campaignBattle?: { schemaVersion: 1; nodeId: string; deck: CampaignRunV1["deck"] };
      };
    };
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.state.campaignBattle).toMatchObject({
      schemaVersion: 1,
      nodeId: "battle_start",
      deck: portable.deck
    });
    expect(checkpoint.state.artifacts).toMatchObject({
      inventory: portable.artifacts,
      nextInstanceSequence: 2
    });
    expect(Object.prototype.hasOwnProperty.call(checkpoint, "campaignRun")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(checkpoint.state, "runResources")).toBe(false);

    const restored = TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint });
    expect(restored.getStateDigest()).toBe(prepared.game.getStateDigest());
    expect(restored.getSnapshot()).toEqual(prepared.game.getSnapshot());

    expect(restored.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(restored.socketArtifact("artifact_1", "tower_1", "optic")).toEqual({ ok: true });
    expect(restored.startNextWave()).toEqual({ ok: true });
    restored.tick(0);
    let hit = restored.getSnapshot().lastEvents.find((event) => event.type === "enemyHit");
    for (let attempt = 0; attempt < 8 && !hit; attempt += 1) {
      restored.tick(0.25);
      hit = restored.getSnapshot().lastEvents.find((event) => event.type === "enemyHit");
    }
    expect(hit).toMatchObject({ type: "enemyHit", damage: 3 });
  });

  it("is deterministic across authored source order and does not use Math.random", () => {
    const originalRandom = Math.random;
    Math.random = () => { throw new Error("Math.random must not be used"); };
    try {
      const portable = run();
      const first = api().prepareCampaignBattle(portable, content(), "battle_start");
      const second = api().prepareCampaignBattle(portable, content({ reverse: true }), "battle_start");
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.battleSeed).toBe(second.battleSeed);
      expect(first.game.getSnapshot().roguelite).toEqual(second.game.getSnapshot().roguelite);
    } finally {
      Math.random = originalRandom;
    }
  });

  it("atomically settles new draft picks, loot, profile clear, and graph advancement with stable ids", () => {
    const registry = content();
    const portable = run();
    const prepared = api().prepareCampaignBattle(portable, registry, "battle_start");
    if (!prepared.ok) throw new Error(prepared.code);
    const picked = finishTwoWaveBattle(prepared.game);

    const profile = createEmptyPlayerProfile(registry);
    const settled = api().settleCampaignBattleVictory(
      portable,
      profile,
      registry,
      "battle_start",
      0,
      prepared.game
    );
    expect(settled).toMatchObject({ ok: true, code: "campaign_battle_settled", nodeId: "battle_start" });
    if (!settled.ok) throw new Error(settled.code);
    expect(settled.run.nodeId).toBe("battle_start");
    expect(settled.run.seed).toBe(portable.seed);
    expect(settled.run.runResources).toEqual(portable.runResources);
    expect(settled.run.deck[0]).toEqual({ instanceId: "card_1", cardId: "ember" });
    expect(settled.run.deck[1]).toMatchObject({ cardId: picked });
    expect(settled.run.deck[1]!.instanceId).toMatch(/^campaign:[^:]+:card:[1-9]\d*$/);
    expect(settled.run.artifacts[0]).toEqual({ instanceId: "artifact_1", artifactId: "scope" });
    expect(settled.run.artifacts.slice(1)).toHaveLength(2);
    for (const artifact of settled.run.artifacts.slice(1)) {
      expect(artifact).toMatchObject({ artifactId: "scope" });
      expect(artifact.instanceId).toMatch(/^campaign:[^:]+:artifact:[1-9]\d*$/);
    }
    expect(settled.newlyAvailableNodeIds).toEqual(["boss_end"]);
    expect(settled.profile.clearedMissionIds).toContain("battle");
    expect(exportCampaignRun(settled.run)).toBe(
      exportCampaignRun(api().settleCampaignBattleVictory(
        portable,
        profile,
        registry,
        "battle_start",
        0,
        prepared.game
      ).run)
    );
    expect(api().settleCampaignBattleVictory(
      settled.run,
      settled.profile,
      registry,
      "battle_start",
      0,
      prepared.game
    )).toMatchObject({ ok: false, code: "node_not_available" });
  });

  it("rejects unavailable/structural nodes, unbound games, and unfinished battles without mutation", () => {
    const registry = content();
    const portable = run();
    const bytes = exportCampaignRun(portable);

    expect(api().prepareCampaignBattle(portable, registry, "boss_end")).toMatchObject({
      ok: false,
      code: "node_not_available"
    });
    expect(api().prepareCampaignBattle(portable, registry, "event_offer")).toMatchObject({
      ok: false,
      code: "node_type_not_implemented"
    });
    const prepared = api().prepareCampaignBattle(portable, registry, "battle_start");
    if (!prepared.ok) throw new Error(prepared.code);
    expect(api().settleCampaignBattleVictory(
      portable, createEmptyPlayerProfile(registry), registry, "battle_start", 0, prepared.game
    )).toMatchObject({
      ok: false,
      code: "battle_not_victorious"
    });
    const unbound = new TowerDefenseGame({ content: registry, missionId: "battle", seed: portable.seed });
    expect(api().settleCampaignBattleVictory(
      portable, createEmptyPlayerProfile(registry), registry, "battle_start", 0, unbound
    )).toMatchObject({
      ok: false,
      code: "battle_context_mismatch"
    });
    expect(exportCampaignRun(portable)).toBe(bytes);
  });

  it("fails closed on prototype-key card and artifact ids at validation, loadout, and checkpoint boundaries", () => {
    const registry = content();
    expect(api().prepareCampaignBattle(run({
      deck: [{ instanceId: "hostile_card", cardId: "__proto__" }]
    }), registry, "battle_start")).toMatchObject({ ok: false, code: "unknown_card" });
    expect(api().prepareCampaignBattle(run({
      artifacts: [{ instanceId: "hostile_artifact", artifactId: "constructor" }]
    }), registry, "battle_start")).toMatchObject({ ok: false, code: "unknown_artifact" });

    expect(() => new TowerDefenseGame({
      content: registry,
      missionId: "battle",
      seed: "hostile-loadout",
      campaignBattle: {
        schemaVersion: 1,
        launchId: "0123456789abcdef",
        nodeId: "battle_start",
        maxNewArtifactInstances: 0,
        deck: [{ instanceId: "hostile_card", cardId: "__proto__" }],
        artifacts: []
      }
    })).toThrow(/cardId entry 0 is invalid/i);

    const prepared = api().prepareCampaignBattle(run(), registry, "battle_start");
    if (!prepared.ok) throw new Error(prepared.code);
    const checkpoint = structuredClone(prepared.game.createCheckpoint()) as any;
    Object.defineProperty(checkpoint.state.campaignBattle.deck[0], "cardId", {
      value: "__proto__", enumerable: true, configurable: true, writable: true
    });
    checkpoint.stateDigest = computeCheckpointStateDigest(
      checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, checkpoint.state
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint })).toThrow(/campaign cardId entry is invalid/i);

    const emptyId = structuredClone(prepared.game.createCheckpoint()) as any;
    emptyId.state.campaignBattle.deck[0].instanceId = "";
    emptyId.stateDigest = computeCheckpointStateDigest(
      emptyId.contentDigest, emptyId.identity, emptyId.rng, emptyId.state
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint: emptyId }))
      .toThrow(/campaign cardId entry is invalid/i);
  });

  it("rejects forged campaign loot identities, unreachable drops, and over-budget restored decks", () => {
    const registry = content();
    const prepared = api().prepareCampaignBattle(run(), registry, "battle_start");
    if (!prepared.ok) throw new Error(prepared.code);
    finishTwoWaveBattle(prepared.game);

    const forgedLoot = structuredClone(prepared.game.createCheckpoint()) as any;
    forgedLoot.state.artifacts.inventory[1].instanceId = `campaign:${prepared.launchId}:artifact:9999`;
    forgedLoot.state.artifacts.inventory[1].artifactId = "vault";
    forgedLoot.stateDigest = computeCheckpointStateDigest(
      forgedLoot.contentDigest, forgedLoot.identity, forgedLoot.rng, forgedLoot.state
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint: forgedLoot }))
      .toThrow(/artifact inventory has an invalid|unreachable/i);

    const overBudget = structuredClone(prepared.game.createCheckpoint()) as any;
    overBudget.state.campaignBattle.deck = Array.from({ length: 61 }, (_, index) => ({
      instanceId: `restored_card_${index + 1}`,
      cardId: "ember"
    }));
    overBudget.stateDigest = computeCheckpointStateDigest(
      overBudget.contentDigest, overBudget.identity, overBudget.rng, overBudget.state
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint: overBudget }))
      .toThrow(/modifier budget/i);

    const aggregateOverflow = structuredClone(prepared.game.createCheckpoint()) as any;
    aggregateOverflow.state.campaignBattle.artifacts = Array.from({ length: 9_998 }, (_, index) => ({
      instanceId: `carried_artifact_${index + 1}`,
      artifactId: "scope"
    }));
    aggregateOverflow.state.artifacts.inventory = [
      ...aggregateOverflow.state.campaignBattle.artifacts.map((entry: any) => ({ ...entry, socket: null })),
      {
        instanceId: `campaign:${prepared.launchId}:artifact:9999`,
        artifactId: "scope",
        socket: null
      }
    ];
    aggregateOverflow.state.artifacts.nextInstanceSequence = 10_000;
    aggregateOverflow.stateDigest = computeCheckpointStateDigest(
      aggregateOverflow.contentDigest,
      aggregateOverflow.identity,
      aggregateOverflow.rng,
      aggregateOverflow.state
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint: aggregateOverflow }))
      .toThrow(/aggregate CampaignRun collection limit/i);
  });

  it("binds settlement to the exact validated campaign graph used at preparation", () => {
    const source = campaignInput();
    const before = createGameContentRegistry(source);
    const portable = run();
    const prepared = api().prepareCampaignBattle(portable, before, "battle_start");
    if (!prepared.ok) throw new Error(prepared.code);
    finishTwoWaveBattle(prepared.game);

    const changedSource = structuredClone(source) as any;
    const start = changedSource.worldMap.campaign.nodes.find((node: any) => node.id === "battle_start");
    start.nextNodeIds = ["event_offer", "boss_end"];
    const changed = createGameContentRegistry(changedSource);
    expect(api().settleCampaignBattleVictory(
      portable,
      createEmptyPlayerProfile(changed),
      changed,
      "battle_start",
      0,
      prepared.game
    )).toMatchObject({ ok: false, code: "battle_context_mismatch" });
  });

  it("canonicalizes successor order in launch bindings and settlement results", () => {
    const firstSource = campaignInput() as any;
    firstSource.worldMap.campaign.nodes.find((node: any) => node.id === "battle_start").nextNodeIds = [
      "event_offer", "boss_end"
    ];
    const secondSource = structuredClone(firstSource);
    secondSource.worldMap.campaign.nodes.find((node: any) => node.id === "battle_start").nextNodeIds.reverse();
    const portable = run();
    const first = api().prepareCampaignBattle(portable, createGameContentRegistry(firstSource), "battle_start");
    const secondContent = createGameContentRegistry(secondSource);
    const second = api().prepareCampaignBattle(portable, secondContent, "battle_start");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.launchId).toBe(second.launchId);
    finishTwoWaveBattle(second.game);
    const settled = api().settleCampaignBattleVictory(
      portable,
      createEmptyPlayerProfile(secondContent),
      secondContent,
      "battle_start",
      0,
      second.game
    );
    expect(settled.ok).toBe(true);
    if (settled.ok) expect(settled.newlyAvailableNodeIds).toEqual(["boss_end", "event_offer"]);
  });

  it("fails closed before runtime construction when persisted cards exceed the shared modifier budget", () => {
    const portable = run({
      // 61 carried modifiers + one worst-case local draft modifier + the
      // shared three-slot resolver reserve must fail before construction.
      deck: Array.from({ length: 61 }, (_, index) => ({
        instanceId: `card_${index + 1}`,
        cardId: "ember"
      }))
    });
    const before = exportCampaignRun(portable);
    expect(api().prepareCampaignBattle(portable, content(), "battle_start")).toMatchObject({
      ok: false,
      code: "modifier_budget_exceeded"
    });
    expect(exportCampaignRun(portable)).toBe(before);
  });

  it("returns a closed capacity failure before a required battle handoff can exceed CampaignRun entries", () => {
    const portable = run({
      deck: [],
      // The current battle and its reachable boss each have one draft choice,
      // so the remaining DAG path needs two aggregate slots, not just one.
      artifacts: Array.from({ length: CAMPAIGN_RUN_LIMITS.collectionEntries - 2 }, (_, index) => ({
        instanceId: `stored_artifact_${index}`,
        artifactId: "scope"
      }))
    });
    const before = exportCampaignRun(portable);
    const prepared = api().prepareCampaignBattle(portable, content(), "battle_start");
    expect(prepared).toMatchObject({
      ok: false,
      code: "run_capacity_exceeded"
    });
    expect(exportCampaignRun(portable)).toBe(before);
  });

  it("caps current-battle loot so the settled run can still launch every reserved successor draft", () => {
    const registry = content();
    const portable = run({
      deck: [],
      artifacts: Array.from({ length: CAMPAIGN_RUN_LIMITS.collectionEntries - 4 }, (_, index) => ({
        instanceId: `stored_artifact_${index}`,
        artifactId: "scope"
      }))
    });
    const prepared = api().prepareCampaignBattle(portable, registry, "battle_start");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    finishTwoWaveBattle(prepared.game);
    const settled = api().settleCampaignBattleVictory(
      portable,
      createEmptyPlayerProfile(registry),
      registry,
      "battle_start",
      0,
      prepared.game
    );
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.run.artifacts).toHaveLength(CAMPAIGN_RUN_LIMITS.collectionEntries - 3);
    expect(api().prepareCampaignBattle(settled.run, registry, "boss_end").ok).toBe(true);
  });

  it("captures hostile run data without invoking accessors and reports invalid_run", () => {
    let reads = 0;
    const hostile = {
      ...run(),
      get seed() {
        reads += 1;
        throw new Error("hostile getter");
      }
    } as unknown as CampaignRunV1;
    expect(api().prepareCampaignBattle(hostile, content(), "battle_start")).toMatchObject({
      ok: false,
      code: "invalid_run"
    });
    expect(reads).toBe(0);
  });
});
