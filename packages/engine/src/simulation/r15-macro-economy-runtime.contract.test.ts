import { describe, expect, it } from "vitest";
import {
  GAME_COMMAND_JOURNAL_SCHEMA_VERSION,
  GAME_COMMAND_SCHEMA_VERSION,
  JournaledGameSession,
  TowerDefenseGame,
  computeCheckpointStateDigest,
  createGameContentRegistry,
  dispatchGameCommand,
  replayGameCommandJournal,
  validateGameContentRegistry,
  type GameCommandV8,
  type GameContentInput
} from "../index.js";

function refreshCheckpointDigest(checkpoint: any): void {
  checkpoint.stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

function input(active = true): GameContentInput {
  return {
    balance: {
      defaultMissionId: "market",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 1000, startingResources: { coins: 1000 },
        prepTimeUnits: 5, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 10, pathWaterDurationUnits: 5, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: { grunt: { id: "grunt", label: "Grunt", maxHp: 10, speed: 0.1, reward: { coins: 0 }, coinReward: 0, coreDamage: 1, color: 0x889966 } },
      towers: {
        cannon: { id: "cannon", label: "Cannon", cost: { coins: 10 }, footprintRadius: 0, range: 10, attack: { kind: "single", fireRate: 10, damagePerStack: 100, startingStacks: 1, maxStacks: 1, upgradeCost: 1 } }
      },
      waveSets: { two: [
        { id: "wave_1", label: "Wave 1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 0, startDelay: 0 }] },
        { id: "wave_2", label: "Wave 2", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 0, startDelay: 0 }] }
      ] },
      missions: {
        market: {
          id: "market", label: "Market", description: "", startingCoreHp: 20, startingResources: { coins: 1000 }, prepTimeUnits: 5,
          mapId: "lane", waveSetId: "two", buildTowerIds: ["cannon"], abilityIds: [],
          ...(active ? { mechanics: { profiles: { macroEconomy: "local" } } } : {})
        }
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: active ? {
        macroEconomy: {
          schemaVersion: 1, enabled: true,
          profiles: {
            local: {
              quoteCurrencyId: "coins",
              commodities: { ore: { label: "Ore", basePrice: 10, minPrice: 5, maxPrice: 30, trendPerWave: 0, volatility: 0.1, demandElasticity: 0.5 } },
              deposits: { short: { label: "Short", currencyId: "coins", durationClearedWaves: 1, interestBasisPoints: 500, minAmount: 10, maxAmount: 500 } },
              altars: {
                forge: {
                  label: "Forge", coord: { q: 1, r: 0 }, radius: 2, minTowers: 1, maxTowers: 2, towerTypeIds: ["cannon"],
                  effects: [{ kind: "grant_resource", resourceId: "coins", amount: 50 }]
                }
              }
            }
          }
        }
      } : {}
    },
    maps: { lane: { id: "lane", width: 7, height: 3, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 6, r: 1 }, pathCenterline: Array.from({ length: 7 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: [] } },
    worldMap: { width: 100, height: 100, regions: [{ id: "region", label: "Region", description: "", bounds: { x: 0, y: 0, width: 100, height: 100 }, accent: "#889966", biome: "test", connections: [] }], missionNodes: [{ missionId: "market", regionId: "region", x: 50, y: 50, difficulty: 1, unlockRequiresMissionIds: [] }] }
  };
}

const runUntilBetween = (game: TowerDefenseGame): void => {
  for (let index = 0; index < 100 && game.getSnapshot().waveState !== "between"; index += 1) game.tick(0.2);
};

describe("R15 macro-economy runtime contract", () => {
  it("publishes GameCommand/Journal v8 and defers trade demand to wave clear", () => {
    expect(GAME_COMMAND_SCHEMA_VERSION).toBe(8);
    expect(GAME_COMMAND_JOURNAL_SCHEMA_VERSION).toBe(8);
    const game = new TowerDefenseGame({ content: createGameContentRegistry(input()), missionId: "market", seed: "market" });
    expect(game.getSnapshot().macroEconomy?.market.commodities[0]).toMatchObject({ id: "ore", quote: 10, holding: 0 });
    expect(dispatchGameCommand(game, { schemaVersion: 8, type: "buyCommodity", commodityId: "ore", quantity: 2 })).toEqual({ ok: true });
    expect(game.getSnapshot().macroEconomy?.market.commodities[0]).toMatchObject({ quote: 10, holding: 2, pendingNetDemand: 2 });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(game.startNextWave()).toEqual({ ok: true });
    expect(dispatchGameCommand(game, { schemaVersion: 8, type: "sellCommodity", commodityId: "ore", quantity: 1 })).toMatchObject({ ok: false, reasonKey: "reason.macroEconomyManagementUnavailable" });
    runUntilBetween(game);
    expect(game.getSnapshot().macroEconomy?.market.commodities[0]?.pendingNetDemand).toBe(0);
    expect(game.getSnapshot().macroEconomy?.market.lastPriceWaveIndex).toBe(0);
  });

  it("locks a deposit and settles principal plus basis-point interest exactly at maturity", () => {
    const game = new TowerDefenseGame({ content: createGameContentRegistry(input()), missionId: "market", seed: "deposit" });
    const before = game.getSnapshot().resources.coins!;
    expect(dispatchGameCommand(game, { schemaVersion: 8, type: "openDeposit", depositId: "short", amount: 100 })).toEqual({ ok: true });
    expect(game.getSnapshot().resources.coins).toBe(before - 100);
    expect(game.getSnapshot().macroEconomy?.deposits).toHaveLength(1);
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(game.startNextWave()).toEqual({ ok: true });
    runUntilBetween(game);
    expect(game.getSnapshot().macroEconomy?.deposits).toEqual([]);
    expect(game.getSnapshot().resources.coins).toBe(before - 10 + 5);
    expect(game.getSnapshot().lastEvents.filter((event) => event.type === "depositMatured")).toHaveLength(1);
  });

  it("preflights a ritual atomically and destroys each selected tower once", () => {
    const game = new TowerDefenseGame({ content: createGameContentRegistry(input()), missionId: "market" });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    const before = game.getStateDigest();
    expect(dispatchGameCommand(game, { schemaVersion: 8, type: "performRitual", altarId: "forge", towerIds: ["missing"] })).toMatchObject({ ok: false, reasonKey: "reason.ritualTowerInvalid" });
    expect(game.getStateDigest()).toBe(before);
    const coins = game.getSnapshot().resources.coins!;
    expect(dispatchGameCommand(game, { schemaVersion: 8, type: "performRitual", altarId: "forge", towerIds: ["tower_1"] })).toEqual({ ok: true });
    expect(game.getSnapshot().towers).toEqual([]);
    expect(game.getSnapshot().resources.coins).toBe(coins + 50);
  });

  it("allows combat rituals and routes damage, status, and temporary modifiers through shared engine paths", () => {
    const authored = input() as any;
    authored.balance.towers.cannon.attack.damagePerStack = 0.01;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.radius = 20;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.effects = [
      { kind: "damage_enemies", damageTypeId: "physical", amount: 3, radius: 20 },
      { kind: "apply_status", status: "poison", duration: 2, radius: 20, magnitude: 1 },
      { kind: "temporary_tower_modifier", stat: "damage", multiplier: 2, duration: 2 }
    ];
    const game = new TowerDefenseGame({ content: createGameContentRegistry(authored), missionId: "market", seed: "combat-ritual" });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(game.placeTower("cannon", { q: 4, r: 0 })).toEqual({ ok: true });
    expect(game.startNextWave()).toEqual({ ok: true });
    for (let index = 0; index < 10 && game.getSnapshot().enemies.length === 0; index += 1) game.tick(0.01);
    const before = game.getSnapshot();
    expect(before.macroEconomy).toMatchObject({ managementAllowed: false, ritualAllowed: true });
    expect(before.enemies).toHaveLength(1);
    expect(dispatchGameCommand(game, { schemaVersion: 8, type: "performRitual", altarId: "forge", towerIds: ["tower_1"] })).toEqual({ ok: true });
    const after = game.getSnapshot();
    expect(after.towers.map((tower) => tower.id)).toEqual(["tower_2"]);
    expect(after.enemies[0]!.hp).toBeCloseTo(before.enemies[0]!.hp - 3, 6);
    expect(after.enemies[0]!.statuses?.poison).toMatchObject({ dps: 1, remaining: 2 });
    expect(game.createCheckpoint().state.macroEconomy?.temporaryModifiers).toHaveLength(1);
    expect(after.lastEvents.filter((event) => event.type === "ritualPerformed")).toHaveLength(1);
  });

  it("round-trips active state through checkpoint and a v8 journal", () => {
    const content = createGameContentRegistry(input());
    const session = new JournaledGameSession(new TowerDefenseGame({ content, missionId: "market", seed: "journal" }));
    const buy: GameCommandV8 = { schemaVersion: 8, type: "buyCommodity", commodityId: "ore", quantity: 3 };
    expect(session.dispatch(buy)).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 8, type: "openDeposit", depositId: "short", amount: 50 })).toEqual({ ok: true });
    const restored = TowerDefenseGame.fromCheckpoint({ content, checkpoint: session.game.createCheckpoint() });
    expect(restored.getStateDigest()).toBe(session.game.getStateDigest());
    expect(replayGameCommandJournal({ content, journal: session.exportJournal() }).game.getStateDigest()).toBe(session.game.getStateDigest());
  });

  it("round-trips negative pending demand and rejects incomplete or foreign market provenance", () => {
    const content = createGameContentRegistry(input());
    const game = new TowerDefenseGame({ content, missionId: "market", seed: "market-checkpoint" });
    expect(dispatchGameCommand(game, { schemaVersion: 8, type: "buyCommodity", commodityId: "ore", quantity: 2 })).toEqual({ ok: true });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(game.startNextWave()).toEqual({ ok: true });
    runUntilBetween(game);
    expect(dispatchGameCommand(game, { schemaVersion: 8, type: "sellCommodity", commodityId: "ore", quantity: 1 })).toEqual({ ok: true });

    const checkpoint = game.createCheckpoint();
    const macroEconomy = checkpoint.state.macroEconomy!;
    expect(macroEconomy.market.pendingNetDemand).toEqual({ ore: -1 });
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint })).not.toThrow();

    const incompleteQuotes = structuredClone(checkpoint);
    (incompleteQuotes.state.macroEconomy!.market as { quotes: Record<string, number> }).quotes = {};
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: incompleteQuotes })).toThrow(/quotes/i);

    const foreignSeed = structuredClone(checkpoint);
    (foreignSeed.state.macroEconomy!.market as { seedDomain: string }).seedDomain = "foreign";
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: foreignSeed })).toThrow(/provenance/i);
  });

  it("keeps disabled legacy state free of optional macro-economy data", () => {
    const content = createGameContentRegistry(input(false));
    expect(validateGameContentRegistry(content).ok).toBe(true);
    const game = new TowerDefenseGame({ content, missionId: "market", seed: "legacy" });
    expect(game.getSnapshot().macroEconomy).toBeUndefined();
    for (const field of ["activeMacroEconomy", "macroEconomyMarket", "macroEconomyDeposits", "nextMacroEconomyDepositSequence", "nextMacroEconomyRitualSequence", "ritualTemporaryModifiers"]) {
      expect(Object.prototype.hasOwnProperty.call(game, field)).toBe(false);
    }
    expect(Object.prototype.hasOwnProperty.call(game.createCheckpoint().state, "macroEconomy")).toBe(false);
    const restored = TowerDefenseGame.fromCheckpoint({ content, checkpoint: game.createCheckpoint() });
    for (const field of ["activeMacroEconomy", "macroEconomyMarket", "macroEconomyDeposits", "nextMacroEconomyDepositSequence", "nextMacroEconomyRitualSequence", "ritualTemporaryModifiers"]) {
      expect(Object.prototype.hasOwnProperty.call(restored, field)).toBe(false);
    }
    expect(restored.getSnapshot().macroEconomy).toBeUndefined();
    const before = game.getStateDigest();
    expect(dispatchGameCommand(game, { schemaVersion: 8, type: "buyCommodity", commodityId: "ore", quantity: 1 })).toMatchObject({ ok: false, reasonKey: "reason.macroEconomyUnavailable" });
    expect(game.getStateDigest()).toBe(before);
  });

  it("rejects malformed direct management calls before any resource or market mutation", () => {
    const game = new TowerDefenseGame({ content: createGameContentRegistry(input()), missionId: "market", seed: "invalid-direct" });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    const before = game.getStateDigest();
    expect(game.buyCommodity("ore", Number.NaN)).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    expect(game.sellCommodity("ore", -1)).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    expect(game.openDeposit("short", Number.POSITIVE_INFINITY)).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    expect(game.performRitual("forge", ["tower_1", "tower_1"])).toMatchObject({ ok: false });
    expect(game.performRitual("forge", null as any)).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    const sparse: string[] = [];
    sparse.length = 1;
    expect(game.performRitual("forge", sparse)).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    const accessor: string[] = [];
    Object.defineProperty(accessor, "0", { enumerable: true, get: () => "tower_1" });
    accessor.length = 1;
    expect(game.performRitual("forge", accessor)).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    const revocable = Proxy.revocable(["tower_1"], {});
    revocable.revoke();
    expect(game.performRitual("forge", revocable.proxy)).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });

    const symbolIds = ["tower_1"];
    Object.defineProperty(symbolIds, Symbol("hidden"), { value: true, enumerable: true });
    expect(game.performRitual("forge", symbolIds)).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    expect(dispatchGameCommand(game, {
      schemaVersion: 8, type: "performRitual", altarId: "forge", towerIds: symbolIds
    })).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    expect(game.getStateDigest()).toBe(before);
  });

  it("canonicalizes ritual selection and enemy effect order", () => {
    const authored = input() as any;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.effects = [
      { kind: "damage_enemies", damageTypeId: "physical", amount: 1, radius: 20 },
      { kind: "temporary_tower_modifier", stat: "damage", multiplier: 2, duration: 2 }
    ];
    const make = () => new TowerDefenseGame({ content: createGameContentRegistry(authored), missionId: "market", seed: "canonical" });
    const left = make();
    const right = make();
    for (const game of [left, right]) {
      expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
      expect(game.placeTower("cannon", { q: 2, r: 0 })).toEqual({ ok: true });
    }
    expect(left.performRitual("forge", ["tower_2", "tower_1"])).toEqual({ ok: true });
    expect(right.performRitual("forge", ["tower_1", "tower_2"])).toEqual({ ok: true });
    expect(left.getSnapshot()).toEqual(right.getSnapshot());
    expect(left.getStateDigest()).toBe(right.getStateDigest());
  });

  it("rejects forged deposit and ritual modifier checkpoint provenance", () => {
    const authored = input() as any;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.effects = [
      { kind: "temporary_tower_modifier", stat: "damage", multiplier: 2, duration: 2 }
    ];
    const content = createGameContentRegistry(authored);
    const game = new TowerDefenseGame({ content, missionId: "market", seed: "provenance" });
    expect(game.openDeposit("short", 20)).toEqual({ ok: true });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(game.performRitual("forge", ["tower_1"])).toEqual({ ok: true });
    const checkpoint = game.createCheckpoint();

    const forgedDeposit = structuredClone(checkpoint) as any;
    forgedDeposit.state.macroEconomy.deposits[0].maturityClearedWave += 1;
    refreshCheckpointDigest(forgedDeposit);
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: forgedDeposit })).toThrow(/deposit.*provenance|maturity/i);

    const forgedModifier = structuredClone(checkpoint) as any;
    forgedModifier.state.macroEconomy.temporaryModifiers[0].multiplier = 3;
    refreshCheckpointDigest(forgedModifier);
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: forgedModifier })).toThrow(/modifier.*provenance/i);

    const reusedSequence = structuredClone(checkpoint) as any;
    reusedSequence.state.macroEconomy.nextDepositSequence = 1;
    refreshCheckpointDigest(reusedSequence);
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: reusedSequence })).toThrow(/deposit.*sequence|provenance/i);
  });

  it("rejects unsafe temporary modifier accumulation before sacrificing towers", () => {
    const authored = input() as any;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.maxTowers = 2;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.radius = 20;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.effects = Array.from({ length: 16 }, (_, index) => ({
      kind: "temporary_tower_modifier", stat: "damage", multiplier: index === 0 ? 100 : 2, duration: 100
    }));
    const game = new TowerDefenseGame({ content: createGameContentRegistry(authored), missionId: "market", seed: "modifier-budget" });
    for (let index = 0; index < 6; index += 1) expect(game.placeTower("cannon", { q: 1 + index, r: 0 })).toEqual({ ok: true });
    for (const towerId of ["tower_1", "tower_2", "tower_3", "tower_4"]) {
      expect(game.performRitual("forge", [towerId])).toEqual({ ok: true });
    }
    const before = game.getStateDigest();
    expect(game.performRitual("forge", ["tower_5"])).toMatchObject({ ok: false, reasonKey: "reason.ritualModifierLimitReached" });
    expect(game.getStateDigest()).toBe(before);
    expect(game.getSnapshot().towers.some((tower) => tower.id === "tower_5")).toBe(true);
  });

  it("resets every active Macro-Economy state to its deterministic initial value", () => {
    const authored = input() as any;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.effects = [
      { kind: "temporary_tower_modifier", stat: "damage", multiplier: 2, duration: 100 }
    ];
    const content = createGameContentRegistry(authored);
    const game = new TowerDefenseGame({ content, missionId: "market", seed: "reset-economy" });
    expect(game.buyCommodity("ore", 2)).toEqual({ ok: true });
    expect(game.openDeposit("short", 20)).toEqual({ ok: true });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(game.performRitual("forge", ["tower_1"])).toEqual({ ok: true });
    game.reset();
    const economy = game.getSnapshot().macroEconomy!;
    expect(economy.market).toMatchObject({ lastPriceWaveIndex: -1 });
    expect(economy.market.commodities[0]).toMatchObject({ holding: 0, pendingNetDemand: 0 });
    expect(economy.deposits).toEqual([]);
    expect(game.createCheckpoint().state.macroEconomy).toMatchObject({
      nextDepositSequence: 1, nextRitualSequence: 1, temporaryModifiers: []
    });
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: game.createCheckpoint() })).not.toThrow();
  });

  it("rejects a finite modifier product beyond the derived-stat safety ceiling", () => {
    const authored = input() as any;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.radius = 20;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.maxTowers = 1;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.effects = Array.from({ length: 14 }, () => ({
      kind: "temporary_tower_modifier", stat: "range", multiplier: 100, duration: 100
    }));
    const game = new TowerDefenseGame({ content: createGameContentRegistry(authored), missionId: "market", seed: "derived-overflow" });
    for (let index = 1; index <= 3; index += 1) {
      expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
      expect(game.performRitual("forge", [`tower_${index}`])).toEqual({ ok: true });
    }
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    const before = game.getStateDigest();
    expect(game.performRitual("forge", ["tower_4"])).toMatchObject({ ok: false, reasonKey: "reason.ritualModifierLimitReached" });
    expect(game.getStateDigest()).toBe(before);
  });

  it("rejects a ritual whose finite multiplier would overflow authored tower damage", () => {
    const authored = input() as any;
    authored.balance.towers.cannon.attack.damagePerStack = 1e308;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.radius = 20;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.maxTowers = 1;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.effects = [
      { kind: "temporary_tower_modifier", stat: "damage", multiplier: 100, duration: 100 }
    ];
    const content = createGameContentRegistry(authored);
    expect(validateGameContentRegistry(content).ok).toBe(true);
    const game = new TowerDefenseGame({ content, missionId: "market", seed: "derived-damage-overflow" });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(game.placeTower("cannon", { q: 3, r: 0 })).toEqual({ ok: true });
    const before = game.getStateDigest();
    expect(game.performRitual("forge", ["tower_1"])).toMatchObject({
      ok: false, reasonKey: "reason.ritualModifierLimitReached"
    });
    expect(game.getStateDigest()).toBe(before);
    expect(() => {
      game.startNextWave();
      game.tick(0.2);
    }).not.toThrow();
  });

  it("preflights every engine-placeable tower type, not only the mission palette", () => {
    const authored = input() as any;
    authored.balance.towers.nuke = {
      ...authored.balance.towers.cannon,
      id: "nuke",
      label: "Nuke",
      attack: { ...authored.balance.towers.cannon.attack, damagePerStack: 1e308 }
    };
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.radius = 20;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.maxTowers = 1;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.effects = [
      { kind: "temporary_tower_modifier", stat: "damage", multiplier: 100, duration: 100 }
    ];
    const content = createGameContentRegistry(authored);
    expect(validateGameContentRegistry(content).ok).toBe(true);
    const game = new TowerDefenseGame({ content, missionId: "market", seed: "unlisted-tower-overflow" });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(game.placeTower("nuke", { q: 3, r: 0 })).toEqual({ ok: true });
    const before = game.getStateDigest();
    expect(game.performRitual("forge", ["tower_1"])).toMatchObject({
      ok: false, reasonKey: "reason.ritualModifierLimitReached"
    });
    expect(game.getStateDigest()).toBe(before);
  });

  it.each(["range", "fire_rate"] as const)(
    "rejects checkpoint-restored %s modifiers whose authored composition is non-finite",
    (stat) => {
      const authored = input() as any;
      if (stat === "range") authored.balance.towers.cannon.range = 1e308;
      else authored.balance.towers.cannon.attack.fireRate = 1e308;
      authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.effects = [
        { kind: "temporary_tower_modifier", stat, multiplier: 100, duration: 100 }
      ];
      const content = createGameContentRegistry(authored);
      expect(validateGameContentRegistry(content).ok).toBe(true);
      const game = new TowerDefenseGame({ content, missionId: "market", seed: `restore-${stat}-overflow` });
      const checkpoint = structuredClone(game.createCheckpoint()) as any;
      checkpoint.state.macroEconomy.nextRitualSequence = 2;
      checkpoint.state.macroEconomy.temporaryModifiers = [{
        id: "ritual_modifier_1_0", ritualSequence: 1, altarId: "forge", effectIndex: 0,
        stat, multiplier: 100, remaining: 100
      }];
      refreshCheckpointDigest(checkpoint);
      expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint })).toThrow(/macroEconomy.*derived|derived.*stat/i);
    }
  );

  it("preflights pulse DoT damage before accepting a combat ritual", () => {
    const authored = input() as any;
    authored.balance.towers.cannon.attack = {
      kind: "pulse", pulseRate: 100, pulseDamage: 0.01,
      dotDamagePerUnit: 1e308, dotDuration: 100
    };
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.radius = 20;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.maxTowers = 1;
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.effects = [
      { kind: "temporary_tower_modifier", stat: "damage", multiplier: 100, duration: 100 }
    ];
    const content = createGameContentRegistry(authored);
    expect(validateGameContentRegistry(content).ok).toBe(true);
    const game = new TowerDefenseGame({ content, missionId: "market", seed: "pulse-dot-overflow" });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(game.startNextWave()).toEqual({ ok: true });
    game.tick(0.2);
    const before = game.getStateDigest();
    expect(game.performRitual("forge", ["tower_1"])).toMatchObject({
      ok: false, reasonKey: "reason.ritualModifierLimitReached"
    });
    expect(game.getStateDigest()).toBe(before);
  });

  it("rejects checkpoint-restored damage modifiers that overflow pulse DoT", () => {
    const authored = input() as any;
    authored.balance.towers.cannon.attack = {
      kind: "pulse", pulseRate: 1, pulseDamage: 1,
      dotDamagePerUnit: 1e308, dotDuration: 100
    };
    authored.mechanics.modules.macroEconomy.profiles.local.altars.forge.effects = [
      { kind: "temporary_tower_modifier", stat: "damage", multiplier: 100, duration: 100 }
    ];
    const content = createGameContentRegistry(authored);
    expect(validateGameContentRegistry(content).ok).toBe(true);
    const checkpoint = structuredClone(new TowerDefenseGame({
      content, missionId: "market", seed: "restore-pulse-dot-overflow"
    }).createCheckpoint()) as any;
    checkpoint.state.macroEconomy.nextRitualSequence = 2;
    checkpoint.state.macroEconomy.temporaryModifiers = [{
      id: "ritual_modifier_1_0", ritualSequence: 1, altarId: "forge", effectIndex: 0,
      stat: "damage", multiplier: 100, remaining: 100
    }];
    refreshCheckpointDigest(checkpoint);
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint })).toThrow(/macroEconomy.*derived|derived.*damage/i);
  });

  it("rejects sequence checkpoints without headroom for a following command", () => {
    const content = createGameContentRegistry(input());
    const game = new TowerDefenseGame({ content, missionId: "market", seed: "sequence-headroom" });
    const checkpoint = game.createCheckpoint();
    for (const field of ["nextDepositSequence", "nextRitualSequence"] as const) {
      const forged = structuredClone(checkpoint) as any;
      forged.state.macroEconomy[field] = Number.MAX_SAFE_INTEGER;
      refreshCheckpointDigest(forged);
      expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: forged })).toThrow(/sequence/i);
    }
  });
});
