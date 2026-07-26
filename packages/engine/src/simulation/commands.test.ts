import { describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import type { TowerScriptJson } from "../scripting/types.js";
import { dispatchGameCommand, type GameCommand, type GameCommandV1 } from "./commands.js";
import {
  applySimulationAction,
  runHeadlessMission,
  type SimulationAction
} from "./headless.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { ActionResult } from "./types.js";

const COMMAND_FIXTURE: GameContentInput = {
  balance: {
    defaultMissionId: "commands",
    constants: {
      timeUnitSeconds: 1,
      startingCoreHp: 20,
      startingCoins: 100,
      startingResources: { coins: 100 },
      prepTimeUnits: 5,
      moveTowerCost: { coins: 1 },
      waterGroundSpeedFactor: 0.5,
      pathWaterCooldownUnits: 10,
      pathWaterDurationUnits: 5,
      pathWaterRadius: 1,
      pathWaterGroundSpeedFactor: 0.5
    },
    abilities: {
      strike: { id: "strike", label: "Strike", cooldown: 4, duration: 0, radius: 2, damage: 3 }
    },
    enemies: {
      grunt: {
        id: "grunt",
        label: "Grunt",
        maxHp: 10,
        speed: 1,
        reward: { coins: 1 },
        coinReward: 1,
        coreDamage: 1,
        color: 0x889966
      }
    },
    towers: {
      pelter: {
        id: "pelter",
        label: "Pelter",
        cost: { coins: 5 },
        footprintRadius: 0,
        range: 6,
        attack: {
          kind: "single",
          fireRate: 1,
          damagePerStack: 2,
          startingStacks: 1,
          maxStacks: 3,
          upgradeCost: 2
        }
      },
      marksman: {
        id: "marksman",
        label: "Marksman",
        cost: { coins: 5 },
        footprintRadius: 0,
        range: 8,
        attack: { kind: "sniper", interval: 1, damage: 2, targetPriority: "first" }
      }
    },
    waveSets: {
      one: [{ id: "wave_1", label: "Wave 1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }]
    },
    missions: {
      commands: {
        id: "commands",
        label: "Commands",
        description: "",
        startingCoreHp: 20,
        startingResources: { coins: 100 },
        prepTimeUnits: 5,
        mapId: "lane",
        waveSetId: "one",
        buildTowerIds: ["pelter", "marksman"],
        abilityIds: ["strike"]
      }
    }
  },
  maps: {
    lane: {
      id: "lane",
      width: 7,
      height: 3,
      defaultTerrain: "buildable",
      spawnCoord: { q: 0, r: 1 },
      coreCoord: { q: 6, r: 1 },
      pathCenterline: Array.from({ length: 7 }, (_, q) => ({ q, r: 1 })),
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
      accent: "#889966",
      biome: "test",
      connections: []
    }],
    missionNodes: [{
      missionId: "commands",
      regionId: "region",
      x: 50,
      y: 50,
      difficulty: 1,
      unlockRequiresMissionIds: []
    }]
  }
};

function createCommandGame(): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "commands",
    content: createGameContentRegistry(COMMAND_FIXTURE)
  });
}

function expectEquivalent(
  command: GameCommandV1,
  invokeLegacy: (game: TowerDefenseGame) => ActionResult,
  arrange: (game: TowerDefenseGame) => void = () => undefined
): void {
  const legacy = createCommandGame();
  const commanded = createCommandGame();
  arrange(legacy);
  arrange(commanded);

  expect(dispatchGameCommand(commanded, command)).toEqual(invokeLegacy(legacy));
  expect(commanded.getSnapshot()).toEqual(legacy.getSnapshot());
}

type KeysOfUnion<T> = T extends T ? keyof T : never;
type AssertNever<T extends never> = T;
type ForbiddenEnvelopeKeys = Extract<
  KeysOfUnion<GameCommandV1>,
  "timestamp" | "random" | "network" | "player" | "playerId"
>;
type NoTransportEnvelopeInGameCommand = AssertNever<ForbiddenEnvelopeKeys>;

// This assignment is intentionally compile-time coverage for the stable public alias.
const publicCommandAlias: GameCommand = { schemaVersion: 1, type: "startWave" };
const noTransportEnvelope: NoTransportEnvelopeInGameCommand = undefined as never;
void publicCommandAlias;
void noTransportEnvelope;

describe("GameCommandV1", () => {
  it("is a schemaVersion 1 union covering every legacy simulation command", () => {
    const commands = [
      { schemaVersion: 1, type: "tick", units: 0.25 },
      { schemaVersion: 1, type: "startWave" },
      { schemaVersion: 1, type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 } },
      { schemaVersion: 1, type: "moveTower", towerId: "tower_1", coord: { q: 2, r: 0 } },
      { schemaVersion: 1, type: "sellTower", towerId: "tower_1" },
      { schemaVersion: 1, type: "upgradeTower", towerId: "tower_1" },
      { schemaVersion: 1, type: "setTargetMode", towerId: "tower_1", mode: "strongest" },
      { schemaVersion: 1, type: "useAbility", abilityId: "strike", center: { q: 3, r: 1 } },
      { schemaVersion: 1, type: "emitSignal", signal: "external.test", payload: { nested: [null, true, 2, "ok"] } }
    ] satisfies GameCommandV1[];

    expect(commands.map((command) => command.type)).toEqual([
      "tick",
      "startWave",
      "placeTower",
      "moveTower",
      "sellTower",
      "upgradeTower",
      "setTargetMode",
      "useAbility",
      "emitSignal"
    ]);
  });

  it("dispatches every command exactly like the corresponding existing game method", () => {
    expectEquivalent(
      { schemaVersion: 1, type: "tick", units: 0.25 },
      (game) => {
        game.tick(0.25);
        return { ok: true };
      }
    );
    expectEquivalent(
      { schemaVersion: 1, type: "startWave" },
      (game) => game.startNextWave()
    );
    expectEquivalent(
      { schemaVersion: 1, type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 } },
      (game) => game.placeTower("pelter", { q: 1, r: 0 })
    );
    expectEquivalent(
      { schemaVersion: 1, type: "moveTower", towerId: "tower_1", coord: { q: 2, r: 0 } },
      (game) => game.moveTower("tower_1", { q: 2, r: 0 }),
      (game) => {
        expect(game.placeTower("pelter", { q: 1, r: 0 }).ok).toBe(true);
      }
    );
    expectEquivalent(
      { schemaVersion: 1, type: "sellTower", towerId: "tower_1" },
      (game) => game.sellTower("tower_1"),
      (game) => {
        expect(game.placeTower("pelter", { q: 1, r: 0 }).ok).toBe(true);
      }
    );
    expectEquivalent(
      { schemaVersion: 1, type: "upgradeTower", towerId: "tower_1" },
      (game) => game.upgradeTower("tower_1"),
      (game) => {
        expect(game.placeTower("pelter", { q: 1, r: 0 }).ok).toBe(true);
      }
    );
    expectEquivalent(
      { schemaVersion: 1, type: "setTargetMode", towerId: "tower_1", mode: "strongest" },
      (game) => game.setTowerTargetMode("tower_1", "strongest"),
      (game) => {
        expect(game.placeTower("marksman", { q: 1, r: 0 }).ok).toBe(true);
      }
    );
    expectEquivalent(
      { schemaVersion: 1, type: "useAbility", abilityId: "strike", center: { q: 3, r: 1 } },
      (game) => game.useAbility("strike", { q: 3, r: 1 })
    );
    expectEquivalent(
      { schemaVersion: 1, type: "emitSignal", signal: "external.test", payload: { nested: [null, true, 2, "ok"] } },
      (game) => game.emitScriptSignal("external.test", { nested: [null, true, 2, "ok"] })
    );
  });

  it("never throws and rejects future, unknown, malformed, or transport-enveloped input without mutation", () => {
    const malformed: unknown[] = [
      null,
      undefined,
      true,
      "startWave",
      [],
      {},
      { schemaVersion: 4, type: "startWave" },
      { schemaVersion: 2, type: "placeTower", towerTypeId: "x".repeat(129), coord: { q: 1, r: 0 } },
      { schemaVersion: 1, type: "futureCommand" },
      { schemaVersion: 1, type: "startWave", timestamp: 123 },
      { schemaVersion: 1, type: "tick" },
      { schemaVersion: 1, type: "tick", units: -0.01 },
      { schemaVersion: 1, type: "tick", units: Number.NaN },
      { schemaVersion: 1, type: "tick", units: Number.POSITIVE_INFINITY },
      { schemaVersion: 1, type: "placeTower", towerTypeId: " ", coord: { q: 1, r: 0 } },
      { schemaVersion: 1, type: "placeTower", towerTypeId: "pelter", coord: { q: 1.5, r: 0 } },
      { schemaVersion: 1, type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: Number.NaN } },
      { schemaVersion: 1, type: "moveTower", towerId: "\t", coord: { q: 2, r: 0 } },
      { schemaVersion: 1, type: "sellTower", towerId: "" },
      { schemaVersion: 1, type: "upgradeTower", towerId: "  " },
      { schemaVersion: 1, type: "setTargetMode", towerId: "tower_1", mode: "random" },
      { schemaVersion: 1, type: "useAbility", abilityId: "\n", center: { q: 3, r: 1 } },
      { schemaVersion: 1, type: "useAbility", abilityId: "strike", center: { q: Infinity, r: 1 } },
      { schemaVersion: 1, type: "emitSignal", signal: " " }
    ];
    const game = createCommandGame();

    for (const input of malformed) {
      const before = game.getSnapshot();
      let result: ActionResult | undefined;
      expect(() => {
        result = dispatchGameCommand(game, input);
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      expect(game.getSnapshot()).toEqual(before);
    }
  });

  it("does not invoke accessors and dispatches a detached canonical command instead of the untrusted input", () => {
    let schemaReads = 0;
    const accessorCommand = { type: "tick", units: 0.1 } as Record<string, unknown>;
    Object.defineProperty(accessorCommand, "schemaVersion", {
      enumerable: true,
      get() {
        schemaReads += 1;
        return 1;
      }
    });
    expect(dispatchGameCommand(createCommandGame(), accessorCommand).ok).toBe(false);
    expect(schemaReads).toBe(0);

    let unitReads = 0;
    const proxyCommand = new Proxy(
      { schemaVersion: 1, type: "tick", units: 0.1 },
      {
        get(target, property, receiver) {
          if (property === "units") {
            unitReads += 1;
            return unitReads < 4 ? 0.1 : Number.NaN;
          }
          return Reflect.get(target, property, receiver);
        }
      }
    );
    let dispatchedUnits: number | undefined;
    const fakeGame = {
      tick(units: number) {
        dispatchedUnits = units;
      }
    } as unknown as TowerDefenseGame;

    expect(dispatchGameCommand(fakeGame, proxyCommand)).toEqual({ ok: true });
    expect(dispatchedUnits).toBe(0.1);
  });

  it("propagates exceptions raised by a validated engine command instead of misclassifying partial mutation", () => {
    const failure = new Error("engine failure after mutation");
    let mutated = false;
    const fakeGame = {
      tick() {
        mutated = true;
        throw failure;
      }
    } as unknown as TowerDefenseGame;

    expect(() => dispatchGameCommand(fakeGame, { schemaVersion: 1, type: "tick", units: 0.1 })).toThrow(failure);
    expect(mutated).toBe(true);
  });

  it("accepts JSON-safe TowerScript payloads, including an omitted payload", () => {
    const game = createCommandGame();
    const payloads: Array<TowerScriptJson | undefined> = [
      undefined,
      null,
      true,
      false,
      "text",
      0,
      1.25,
      [null, false, "nested", 4],
      { object: { nested: [1, 2, 3] } }
    ];

    for (const payload of payloads) {
      const command = payload === undefined
        ? { schemaVersion: 1 as const, type: "emitSignal" as const, signal: "external.test" }
        : { schemaVersion: 1 as const, type: "emitSignal" as const, signal: "external.test", payload };
      expect(dispatchGameCommand(game, command)).toEqual({ ok: true });
    }
  });

  it("rejects unsafe, cyclic, over-depth, and over-budget TowerScript payloads without mutation", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    let overDepth: unknown = null;
    for (let depth = 0; depth < 100; depth += 1) overDepth = [overDepth];

    const customPrototype = Object.create({ inherited: true }) as Record<string, unknown>;
    customPrototype.value = 1;

    const payloads: unknown[] = [
      { value: undefined },
      { value: () => 1 },
      { value: Symbol("unsafe") },
      { value: BigInt(1) },
      Number.NaN,
      Number.POSITIVE_INFINITY,
      cyclic,
      new Date(0),
      new Map([["key", "value"]]),
      customPrototype,
      overDepth,
      Array.from({ length: 10_000 }, () => null)
    ];
    const game = createCommandGame();

    for (const payload of payloads) {
      const before = game.getSnapshot();
      let result: ActionResult | undefined;
      expect(() => {
        result = dispatchGameCommand(game, {
          schemaVersion: 1,
          type: "emitSignal",
          signal: "external.test",
          payload
        });
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      expect(game.getSnapshot()).toEqual(before);
    }
  });

  it("enforces the 64 KiB signal payload limit in UTF-8 bytes at ASCII and multibyte boundaries", () => {
    const game = createCommandGame();
    expect(dispatchGameCommand(game, {
      schemaVersion: 1,
      type: "emitSignal",
      signal: "external.test",
      payload: "a".repeat(65_534)
    })).toEqual({ ok: true }); // two JSON quote bytes make exactly 65,536

    for (const payload of [
      "a".repeat(65_535),
      "ж".repeat(32_768),
      "😀".repeat(16_384)
    ]) {
      const before = game.getSnapshot();
      expect(dispatchGameCommand(game, {
        schemaVersion: 1,
        type: "emitSignal",
        signal: "external.test",
        payload
      }).ok).toBe(false);
      expect(game.getSnapshot()).toEqual(before);
    }
  });
});

describe("legacy SimulationAction compatibility", () => {
  it("keeps the adapter callable with its existing unversioned shape", () => {
    const game = createCommandGame();
    const action: SimulationAction = { type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 } };

    expect(applySimulationAction(game, action)).toEqual({ ok: true });
    expect(game.getSnapshot().towers).toHaveLength(1);
  });

  it("keeps runHeadlessMission tickStep subdivision semantics unchanged", () => {
    const tickSpy = vi.spyOn(TowerDefenseGame.prototype, "tick");
    runHeadlessMission({
      content: createGameContentRegistry(COMMAND_FIXTURE),
      missionId: "commands",
      actions: [{ type: "tick", units: 1 }],
      tickStep: 0.25
    });

    expect(tickSpy.mock.calls.map(([units]) => units)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});
