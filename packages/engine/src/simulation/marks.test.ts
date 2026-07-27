import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { validateGameContentRegistry } from "../content/validate.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { DamageResolver } from "./damage.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type ConsumePolicy = "retain" | "consume_one" | "consume_all";

interface RuntimeMarkDefinitionFixture {
  label: string;
  duration: number;
  maxStacks: number;
  multiplier: number;
  consumePolicy: ConsumePolicy;
  damageTypes?: string[];
}

interface RuntimeMarkApplicationFixture {
  markId: string;
  stacks?: number;
}

interface RuntimeMarkProfileFixture {
  shields?: { enemies?: Record<string, { capacity: number }> };
  damageTypes?: Record<string, { label: string }>;
  armorTypes?: Record<string, {
    label: string;
    defaultMultiplier?: number;
    multipliers: Record<string, number>;
  }>;
  armorAssignments?: { enemies?: Record<string, string> };
  marks?: {
    definitions?: Record<string, RuntimeMarkDefinitionFixture>;
    bindings?: {
      towers?: Record<string, RuntimeMarkApplicationFixture[]>;
      abilities?: Record<string, RuntimeMarkApplicationFixture[]>;
      towerScripts?: Record<string, RuntimeMarkApplicationFixture[]>;
    };
  };
}

interface RuntimeOptions {
  definition?: Partial<RuntimeMarkDefinitionFixture>;
  bindings?: NonNullable<RuntimeMarkProfileFixture["marks"]>["bindings"];
  shieldCapacity?: number;
  armorPhysicalMultiplier?: number;
  enemyResistance?: number;
  enemyHp?: number;
  enemyCount?: number;
  moduleVersion?: 1 | 2 | 3;
  enabled?: boolean;
  selected?: boolean;
  authorMechanics?: boolean;
  activeEmpty?: boolean;
}

interface MarkStateFixture {
  stacks: number;
  remaining: number;
}

interface CombatStateV2Fixture {
  schemaVersion: 2;
  shields: {
    enemies: Record<string, { current: number; capacity: number; regenerationDelayRemaining: number }>;
    towers: Record<string, { current: number; capacity: number; regenerationDelayRemaining: number }>;
  };
  marks: {
    enemies: Record<string, Record<string, MarkStateFixture>>;
  };
}

const CENTER = { q: 0, r: 1 } as const;

function ability(id: string, effects: NonNullable<GameContentInput["balance"]["abilities"][string]>["effects"]) {
  return { id, label: id, cooldown: 1, duration: 0, radius: 5, effects };
}

function runtimeInput(options: RuntimeOptions = {}): GameContentInput {
  const definition: RuntimeMarkDefinitionFixture = {
    label: "Exposed",
    duration: 20,
    maxStacks: 3,
    multiplier: 1.5,
    consumePolicy: "retain",
    ...options.definition
  };
  const bindings = options.bindings ?? {
    towers: { igniter: [{ markId: "exposed", stacks: 1 }] },
    abilities: {
      marker: [{ markId: "exposed", stacks: 2 }],
      marker_b: [{ markId: "exposed", stacks: 2 }],
      lethal: [{ markId: "exposed", stacks: 1 }]
    },
    towerScripts: { damage_script: [{ markId: "exposed", stacks: 1 }] }
  };
  const profile: RuntimeMarkProfileFixture = options.activeEmpty
    ? {}
    : {
        ...(options.shieldCapacity === undefined
          ? {}
          : { shields: { enemies: { grunt: { capacity: options.shieldCapacity } } } }),
        damageTypes: {
          physical: { label: "Physical" },
          fire: { label: "Fire" }
        },
        ...(options.armorPhysicalMultiplier === undefined
          ? {}
          : {
              armorTypes: {
                plated: {
                  label: "Plated",
                  defaultMultiplier: 1,
                  multipliers: { physical: options.armorPhysicalMultiplier, fire: 1 }
                }
              },
              armorAssignments: { enemies: { grunt: "plated" } }
            }),
        marks: {
          definitions: { exposed: definition },
          bindings
        }
      };
  const abilityIds = ["marker", "marker_b", "hit_a", "hit_b", "hit_c", "lethal", "poisoner"];
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "marks",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {
        marker: ability("marker", [{ kind: "damage", amount: 1 }]),
        marker_b: ability("marker_b", [{ kind: "damage", amount: 1 }]),
        hit_a: ability("hit_a", [{ kind: "damage", amount: 10 }]),
        hit_b: ability("hit_b", [{ kind: "damage", amount: 10 }]),
        hit_c: ability("hit_c", [{ kind: "damage", amount: 10 }]),
        lethal: ability("lethal", [{ kind: "damage", amount: 1_000 }]),
        poisoner: ability("poisoner", [{
          kind: "status",
          status: { poison: { dps: 10, duration: 1 } }
        }])
      },
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: options.enemyHp ?? 500,
          speed: 0.01,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 1,
          ...(options.enemyResistance === undefined
            ? {}
            : { resistances: { physical: options.enemyResistance, fire: 1 } })
        }
      },
      towers: {
        igniter: {
          id: "igniter",
          label: "Igniter",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 5,
          attack: {
            kind: "single",
            fireRate: 0.1,
            damagePerStack: 2,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1,
            damageType: "fire"
          }
        },
        sprayer: {
          id: "sprayer",
          label: "Sprayer",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 5,
          attack: {
            kind: "pulse",
            pulseRate: 0.1,
            pulseDamage: 1,
            dotDamagePerUnit: 10,
            dotDuration: 2
          }
        }
      },
      waveSets: {
        one: [{
          id: "one",
          label: "One",
          groups: [{
            enemyId: "grunt",
            count: options.enemyCount ?? 1,
            spawnInterval: 0,
            startDelay: 0
          }]
        }]
      },
      missions: {
        marks: {
          id: "marks",
          label: "Marks",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: ["igniter", "sprayer"],
          abilityIds,
          ...((options.selected ?? true) ? { mechanics: { profiles: { combat: "marked" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 12,
        height: 3,
        defaultTerrain: "buildable",
        spawnCoord: CENTER,
        coreCoord: { q: 11, r: 1 },
        pathCenterline: Array.from({ length: 12 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    scripts: {
      damage_script: {
        schemaVersion: 1,
        id: "damage_script",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: [{
            when: { $op: "eq", args: [{ $get: "event.signal" }, "damage"] },
            actions: [{ action: "damageEnemy", target: "allEnemies", amount: 10 }]
          }]
        }
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        accent: "#fff",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "marks",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
  if (options.authorMechanics ?? true) {
    input.mechanics = {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: options.moduleVersion ?? 3,
          enabled: options.enabled ?? true,
          profiles: { marked: profile }
        }
      }
    } as unknown as GameContentInput["mechanics"];
  }
  return input;
}

function createContent(options: RuntimeOptions = {}) {
  const content = createGameContentRegistry(runtimeInput(options));
  expect(validateGameContentRegistry(content)).toMatchObject({ ok: true });
  return content;
}

function createGame(options: RuntimeOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "marks",
    content: createContent(options),
    seed: "mark-contract"
  });
}

function spawn(game: TowerDefenseGame): void {
  expect(game.startNextWave().ok).toBe(true);
  game.tick(0.01);
  expect(game.getSnapshot().enemies.length).toBeGreaterThan(0);
}

function combat(game: TowerDefenseGame): CombatStateV2Fixture | undefined {
  return (game.getSnapshot() as unknown as { combat?: CombatStateV2Fixture }).combat;
}

function markState(game: TowerDefenseGame, enemyId = "enemy_1"): MarkStateFixture | undefined {
  return combat(game)?.marks.enemies[enemyId]?.exposed;
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resign(checkpoint: GameCheckpointV1): void {
  (checkpoint as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

afterEach(() => vi.restoreAllMocks());

describe("active combat marks", () => {
  it.each([
    ["retain", "retain", 2],
    ["consume one", "consume_one", 1],
    ["consume all", "consume_all", undefined]
  ] as const)("implements %s consumption after a matching positive hit", (_label, consumePolicy, expectedStacks) => {
    const game = createGame({ definition: { consumePolicy } });
    spawn(game);
    expect(game.useAbility("marker", CENTER).ok).toBe(true);
    expect(markState(game)).toEqual({ stacks: 2, remaining: 20 });

    expect(game.useAbility("hit_a", CENTER).ok).toBe(true);
    if (expectedStacks === undefined) {
      expect(markState(game)).toBeUndefined();
      expect(game.getSnapshot()).not.toHaveProperty("combat");
    } else {
      expect(markState(game)?.stacks).toBe(expectedStacks);
    }
  });

  it("clamps reapplication to maxStacks and refreshes the full duration", () => {
    const game = createGame();
    spawn(game);
    expect(game.useAbility("marker", CENTER).ok).toBe(true);
    game.tick(0.2);
    expect(markState(game)?.remaining).toBeCloseTo(19.8, 8);

    expect(game.useAbility("marker_b", CENTER).ok).toBe(true);
    expect(markState(game)).toEqual({ stacks: 3, remaining: 20 });
    expect(game.lastEvents).toContainEqual(expect.objectContaining({
      type: "enemyMarkChanged",
      previousStacks: 2,
      currentStacks: 3,
      previousRemaining: expect.closeTo(19.8, 8),
      remaining: 20
    }));
  });

  it("does not assign or emit when a reapplication changes neither capped stacks nor full duration", () => {
    const game = createGame({
      bindings: {
        abilities: {
          marker: [{ markId: "exposed", stacks: 3 }],
          marker_b: [{ markId: "exposed", stacks: 1 }]
        }
      }
    });
    spawn(game);

    expect(game.useAbility("marker", CENTER).ok).toBe(true);
    const eventCountBeforeNoOp = game.lastEvents.filter((event) => event.type === "enemyMarkChanged").length;
    expect(game.useAbility("marker_b", CENTER).ok).toBe(true);
    expect(markState(game)).toEqual({ stacks: 3, remaining: 20 });
    expect(game.lastEvents.filter((event) => event.type === "enemyMarkChanged")).toHaveLength(eventCountBeforeNoOp);
  });

  it("keeps marks at tick zero and removes them exactly at the expiry boundary", () => {
    const game = createGame({ definition: { duration: 0.2 } });
    spawn(game);
    expect(game.useAbility("marker", CENTER).ok).toBe(true);

    game.tick(0);
    expect(markState(game)).toEqual({ stacks: 2, remaining: 0.2 });
    game.tick(0.199);
    expect(markState(game)?.remaining).toBeCloseTo(0.001, 8);
    game.tick(0.001);
    expect(markState(game)).toBeUndefined();
    expect(game.getSnapshot()).not.toHaveProperty("combat");
  });

  it("applies a direct binding after resolution even when a shield absorbs all damage", () => {
    const game = createGame({ shieldCapacity: 10 });
    spawn(game);
    expect(game.useAbility("marker", CENTER).ok).toBe(true);

    expect(game.getSnapshot().enemies[0]?.hp).toBe(500);
    expect(combat(game)).toEqual({
      schemaVersion: 2,
      shields: {
        enemies: {
          enemy_1: { current: 9, capacity: 10, regenerationDelayRemaining: 0 }
        },
        towers: {}
      },
      marks: {
        enemies: {
          enemy_1: { exposed: { stacks: 2, remaining: 20 } }
        }
      }
    });
  });

  it.each(["ability", "tower", "tower_script"] as const)(
    "applies a configured %s source binding after its first successful direct packet",
    (source) => {
      const bindings = source === "ability"
        ? { abilities: { marker: [{ markId: "exposed" }] } }
        : source === "tower"
          ? { towers: { igniter: [{ markId: "exposed" }] } }
          : { towerScripts: { damage_script: [{ markId: "exposed" }] } };
      const game = createGame({ bindings });
      if (source === "tower") expect(game.placeTower("igniter", { q: 1, r: 0 }).ok).toBe(true);
      spawn(game);
      if (source === "ability") expect(game.useAbility("marker", CENTER).ok).toBe(true);
      if (source === "tower_script") expect(game.emitScriptSignal("damage").ok).toBe(true);

      expect(markState(game)).toEqual({ stacks: 1, remaining: 20 });
    }
  );

  it("consumes a matching mark when the shield absorbs the entire vulnerable hit", () => {
    const game = createGame({ shieldCapacity: 100, definition: { consumePolicy: "consume_all" } });
    spawn(game);
    expect(game.useAbility("marker", CENTER).ok).toBe(true);
    expect(markState(game)).toBeDefined();

    expect(game.useAbility("hit_a", CENTER).ok).toBe(true);
    expect(game.getSnapshot().enemies[0]?.hp).toBe(500);
    expect(markState(game)).toBeUndefined();
    expect(combat(game)?.shields.enemies.enemy_1?.current).toBe(79);
  });

  it("consumes a matching mark on positive afterModifiers even when armor makes final damage zero", () => {
    const game = createGame({
      armorPhysicalMultiplier: 0,
      definition: { consumePolicy: "consume_all", damageTypes: ["physical"] },
      bindings: { towers: { igniter: [{ markId: "exposed" }] } }
    });
    expect(game.placeTower("igniter", { q: 1, r: 0 }).ok).toBe(true);
    spawn(game);
    game.tick(0.05);
    expect(markState(game)?.stacks).toBe(1);
    expect(markState(game)?.remaining).toBeCloseTo(19.95, 8);
    expect(game.sellTower("tower_1").ok).toBe(true);
    const hpBefore = game.getSnapshot().enemies[0]!.hp;

    const spy = vi.spyOn(DamageResolver, "resolve");
    expect(game.useAbility("hit_a", CENTER).ok).toBe(true);
    const resolution = spy.mock.results.at(-1)?.value as unknown as Record<string, unknown>;
    expect(resolution).toMatchObject({ afterModifiers: 10, afterMarks: 15, afterArmor: 0, finalAmount: 0 });
    expect(game.getSnapshot().enemies[0]?.hp).toBe(hpBefore);
    expect(markState(game)).toBeUndefined();
  });

  it("does not apply a direct binding when armor makes the source packet finalAmount zero", () => {
    const game = createGame({
      armorPhysicalMultiplier: 0,
      bindings: { abilities: { marker: [{ markId: "exposed" }] } }
    });
    spawn(game);
    expect(game.useAbility("marker", CENTER).ok).toBe(true);
    expect(game.getSnapshot().enemies[0]?.hp).toBe(500);
    expect(markState(game)).toBeUndefined();
    expect(game.getSnapshot()).not.toHaveProperty("combat");
  });

  it("routes tower, ability, TowerScript and poison/DoT through the same matching mark stage", () => {
    const game = createGame();
    spawn(game);
    expect(game.useAbility("marker", CENTER).ok).toBe(true);
    const spy = vi.spyOn(DamageResolver, "resolve");

    expect(game.useAbility("hit_a", CENTER).ok).toBe(true);
    expect(game.emitScriptSignal("damage").ok).toBe(true);
    expect(game.useAbility("poisoner", CENTER).ok).toBe(true);
    game.tick(0.1);
    expect(game.placeTower("igniter", { q: 1, r: 0 }).ok).toBe(true);
    game.tick(0.05);

    const matchingCalls = spy.mock.calls.map(([packet], index) => ({
      source: packet.source.kind,
      result: spy.mock.results[index]?.value as unknown as Record<string, unknown>
    })).filter(({ source }) => ["ability", "tower_script", "status", "tower"].includes(source));
    for (const source of ["ability", "tower_script", "status", "tower"] as const) {
      const call = matchingCalls.find((candidate) => candidate.source === source);
      expect(call, `missing ${source} damage`).toBeDefined();
      expect(call?.result.markTrace).toEqual([expect.objectContaining({ markId: "exposed", stacks: expect.any(Number) })]);
      expect(call?.result.afterMarks).toBeGreaterThan(call?.result.afterModifiers as number);
    }
  });

  it("lets status/DoT benefit and consume existing marks but never auto-applies a source binding", () => {
    const game = createGame({
      definition: { consumePolicy: "consume_all" },
      bindings: { abilities: { marker: [{ markId: "exposed" }] } }
    });
    spawn(game);
    expect(game.useAbility("poisoner", CENTER).ok).toBe(true);
    game.tick(0.1);
    expect(markState(game)).toBeUndefined();

    expect(game.useAbility("marker", CENTER).ok).toBe(true);
    expect(markState(game)).toBeDefined();
    game.tick(0.1);
    expect(markState(game)).toBeUndefined();
  });

  it("does not reapply a tower binding from that tower's over-time packet", () => {
    const game = createGame({
      definition: { consumePolicy: "consume_all" },
      bindings: { towers: { sprayer: [{ markId: "exposed" }] } }
    });
    expect(game.placeTower("sprayer", { q: 1, r: 0 }).ok).toBe(true);
    spawn(game);
    expect(markState(game)).toEqual({ stacks: 1, remaining: 20 });
    expect(game.sellTower("tower_1").ok).toBe(true);

    game.tick(0.1);
    expect(markState(game)).toBeUndefined();
  });

  it("does not apply a direct binding to a lethally damaged target and settles death/reward once", () => {
    const game = createGame({ enemyHp: 20 });
    spawn(game);
    expect(game.useAbility("lethal", CENTER).ok).toBe(true);
    expect(game.getSnapshot().enemies[0]?.hp).toBe(0);
    expect(markState(game)).toBeUndefined();

    game.tick(0);
    expect(game.getSnapshot().killCount).toBe(1);
    expect(game.coins).toBe(101);
    expect(game.lastEvents.filter((event) => event.type === "enemyKilled")).toHaveLength(1);
    game.tick(0);
    expect(game.getSnapshot().killCount).toBe(1);
    expect(game.coins).toBe(101);
    expect(game.lastEvents.filter((event) => event.type === "enemyKilled")).toHaveLength(0);
  });
});

describe("mark snapshot, checkpoint and replay contracts", () => {
  it("uses combat state v2 for any v3 shield or mark state, preserves old shield-only v1, and omits empty state", () => {
    const marked = createGame();
    spawn(marked);
    expect(marked.getSnapshot()).not.toHaveProperty("combat");
    expect(marked.useAbility("marker", CENTER).ok).toBe(true);
    expect(combat(marked)?.schemaVersion).toBe(2);
    expect(marked.createCheckpoint().state.combat).toEqual(combat(marked));

    const v3Shield = createGame({ shieldCapacity: 5 });
    spawn(v3Shield);
    expect(combat(v3Shield)).toMatchObject({ schemaVersion: 2, marks: { enemies: {} } });

    const v1Input = runtimeInput({ moduleVersion: 1, shieldCapacity: 5 });
    const v1Module = v1Input.mechanics!.modules.combat as unknown as { profiles: Record<string, unknown> };
    v1Module.profiles.marked = { shields: { enemies: { grunt: { capacity: 5 } } } };
    const v1Content = createGameContentRegistry(v1Input);
    expect(validateGameContentRegistry(v1Content)).toMatchObject({ ok: true, issues: [] });
    const v1Shield = new TowerDefenseGame({ missionId: "marks", content: v1Content, seed: "v1-shield" });
    spawn(v1Shield);
    expect((v1Shield.getSnapshot() as unknown as { combat?: { schemaVersion: number } }).combat?.schemaVersion).toBe(1);

    const variants = [
      runtimeInput({ authorMechanics: false, selected: false }),
      runtimeInput({ activeEmpty: true }),
      runtimeInput({ activeEmpty: true, enabled: false }),
      runtimeInput({ activeEmpty: true, selected: false })
    ].map((input) => {
      // This comparison intentionally uses a mechanics-independent tower. The regular fixture's
      // authored `fire` damageType requires an active v2+ damageTypes catalog and would make an
      // otherwise empty active profile invalid for an unrelated cross-reference reason.
      delete (input.balance.towers.igniter!.attack as { damageType?: string }).damageType;
      const content = createGameContentRegistry(input);
      expect(validateGameContentRegistry(content).ok).toBe(true);
      const game = new TowerDefenseGame({ missionId: "marks", content, seed: "marks-legacy" });
      spawn(game);
      expect(game.getSnapshot()).not.toHaveProperty("combat");
      expect(game.createCheckpoint().state).not.toHaveProperty("combat");
      return game.getSnapshot();
    });
    for (const snapshot of variants.slice(1)) expect(snapshot).toEqual(variants[0]);
  });

  it("round-trips live marks without changing outer checkpoint/simulation versions and continues deterministically", () => {
    const content = createContent({ definition: { consumePolicy: "consume_one" } });
    const continuous = new TowerDefenseGame({ missionId: "marks", content, seed: "marks-checkpoint" });
    spawn(continuous);
    expect(continuous.useAbility("marker", CENTER).ok).toBe(true);
    const checkpoint = jsonRoundTrip(continuous.createCheckpoint());

    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.engineVersion).toBe("towerforge-sim-v2");
    expect((checkpoint.state.combat as unknown as CombatStateV2Fixture).schemaVersion).toBe(2);
    const restored = TowerDefenseGame.fromCheckpoint({ content, checkpoint });
    expect(restored.getSnapshot()).toEqual(continuous.getSnapshot());

    expect(continuous.useAbility("hit_a", CENTER).ok).toBe(true);
    expect(restored.useAbility("hit_a", CENTER).ok).toBe(true);
    continuous.tick(0.2);
    restored.tick(0.2);
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
    expect(restored.getSnapshot()).toEqual(continuous.getSnapshot());
  });

  it.each([
    ["future combat schema", (combatState: CombatStateV2Fixture) => {
      (combatState as { schemaVersion: number }).schemaVersion = 3;
    }],
    ["zero stacks", (combatState: CombatStateV2Fixture) => {
      combatState.marks.enemies.enemy_1!.exposed!.stacks = 0;
    }],
    ["stacks above definition", (combatState: CombatStateV2Fixture) => {
      combatState.marks.enemies.enemy_1!.exposed!.stacks = 4;
    }],
    ["remaining above duration", (combatState: CombatStateV2Fixture) => {
      combatState.marks.enemies.enemy_1!.exposed!.remaining = 21;
    }],
    ["unknown mark", (combatState: CombatStateV2Fixture) => {
      combatState.marks.enemies.enemy_1!.ghost = { stacks: 1, remaining: 1 };
    }],
    ["unknown enemy", (combatState: CombatStateV2Fixture) => {
      combatState.marks.enemies.enemy_404 = { exposed: { stacks: 1, remaining: 1 } };
    }]
  ] as const)("rejects digest-valid malformed mark checkpoint state: %s", (_label, mutate) => {
    const content = createContent();
    const game = new TowerDefenseGame({ missionId: "marks", content, seed: "marks-malformed" });
    spawn(game);
    expect(game.useAbility("marker", CENTER).ok).toBe(true);
    const checkpoint = jsonRoundTrip(game.createCheckpoint());
    mutate(checkpoint.state.combat as unknown as CombatStateV2Fixture);
    resign(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint })).toThrow(/combat|mark|stack|remaining|enemy|version/i);
  });

  it("rejects mark-state content mismatch and runtime application budget overflow", () => {
    const content = createContent();
    const game = new TowerDefenseGame({ missionId: "marks", content, seed: "marks-mismatch" });
    spawn(game);
    expect(game.useAbility("marker", CENTER).ok).toBe(true);
    const checkpoint = jsonRoundTrip(game.createCheckpoint());

    const changedInput = runtimeInput({ definition: { duration: 21 } });
    const changedContent = createGameContentRegistry(changedInput);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: changedContent, checkpoint })).toThrow(/content.*digest|digest.*content/i);

    const definitions = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [
      `mark_${index}`,
      {
        label: `Mark ${index}`,
        duration: 1,
        maxStacks: 1,
        multiplier: 2,
        consumePolicy: "retain" as const
      }
    ]));
    const budgetInput = runtimeInput({
      enemyCount: 65,
      bindings: {},
      activeEmpty: false
    });
    const budgetProfile = (budgetInput.mechanics!.modules.combat as unknown as {
      profiles: { marked: RuntimeMarkProfileFixture };
    }).profiles.marked;
    budgetProfile.marks = { definitions, bindings: {} };
    const budgetContent = createGameContentRegistry(budgetInput);
    expect(validateGameContentRegistry(budgetContent)).toMatchObject({ ok: true, issues: [] });
    const budgetGame = new TowerDefenseGame({ missionId: "marks", content: budgetContent, seed: "mark-budget" });
    spawn(budgetGame);
    expect(budgetGame.getSnapshot().enemies).toHaveLength(65);
    const oversized = jsonRoundTrip(budgetGame.createCheckpoint());
    const markRecords = Object.fromEntries(oversized.state.enemies.map((enemy) => [
      enemy.id,
      Object.fromEntries(Object.keys(definitions).map((markId) => [markId, { stacks: 1, remaining: 1 }]))
    ]));
    (oversized.state as unknown as { combat: CombatStateV2Fixture }).combat = {
      schemaVersion: 2,
      shields: { enemies: {}, towers: {} },
      marks: { enemies: markRecords }
    };
    resign(oversized);
    expect(() => TowerDefenseGame.fromCheckpoint({
      content: budgetContent,
      checkpoint: oversized
    })).toThrow(/mark|application|16384|budget|limit|exceed/i);
  });

  it("replays mark application and consumption to the continuous digest", () => {
    const content = createContent({ definition: { consumePolicy: "consume_one" } });
    const session = new JournaledGameSession(new TowerDefenseGame({
      missionId: "marks",
      content,
      seed: "marks-journal"
    }));
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" }).ok).toBe(true);
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.01 }).ok).toBe(true);
    expect(session.dispatch({ schemaVersion: 1, type: "useAbility", abilityId: "marker", center: CENTER }).ok).toBe(true);
    expect(session.dispatch({ schemaVersion: 1, type: "useAbility", abilityId: "hit_a", center: CENTER }).ok).toBe(true);

    const journal = session.exportJournal();
    const replay = replayGameCommandJournal({ content, journal: jsonRoundTrip(journal) });
    expect(replay.entriesReplayed).toBe(4);
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
    expect(markState(replay.game)?.stacks).toBe(1);
  });
});
