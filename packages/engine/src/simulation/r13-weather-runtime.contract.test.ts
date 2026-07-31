import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { WEATHER_LIMITS } from "../content/weather-mechanics.js";
import { DamageResolver } from "./damage.js";
import { computeCheckpointStateDigest } from "./checkpoint.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type Activation = "active" | "disabled" | "unselected" | "absent";

type WeatherEffect =
  | { readonly kind: "periodic_damage"; readonly target: "enemies"; readonly amount: number; readonly intervalUnits: number; readonly damageType?: string }
  | { readonly kind: "status"; readonly target: "enemies"; readonly intervalUnits: number; readonly status: { readonly stun?: number } }
  | { readonly kind: "visibility_range"; readonly multiplier: number }
  | { readonly kind: "enemy_speed"; readonly multiplier: number }
  | { readonly kind: "tower_fire_rate"; readonly multiplier: number };

interface FixtureOptions {
  readonly activation?: Activation;
  readonly effects?: Readonly<Record<string, WeatherEffect>>;
  readonly enemyHp?: number;
  readonly enemySpeed?: number;
  readonly towerDamage?: number;
  readonly towerFireRate?: number;
  readonly towerRange?: number;
  readonly topology?: "square" | "hex";
  readonly zoneTiles?: readonly { readonly q: number; readonly r: number }[];
}

interface WeatherOccurrenceContract {
  readonly waveIndex: number;
  readonly choiceId: "always";
  readonly weatherId: "storm";
  readonly zoneId: "field";
  readonly zone: { readonly kind: "all_map" };
  readonly elapsedUnits: number;
}

interface WeatherSnapshotContract {
  readonly schemaVersion: 1;
  readonly profileId: "storm_field";
  readonly active: WeatherOccurrenceContract | null;
}

function profile(
  effects: Readonly<Record<string, WeatherEffect>> = {},
  zoneTiles?: readonly { readonly q: number; readonly r: number }[]
): unknown {
  return {
    zones: { field: zoneTiles === undefined ? { kind: "all_map" } : { kind: "tiles", tiles: zoneTiles } },
    definitions: { storm: { label: "Storm", effects } },
    schedule: {
      calmWeight: 0,
      choices: { always: { weatherId: "storm", zoneId: "field", weight: 1 } }
    }
  };
}

function input(options: FixtureOptions = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const modulePresent = activation !== "absent";
  const selected = activation === "active" || activation === "disabled";
  const path = Array.from({ length: 12 }, (_, q) => ({ q, r: 1 }));
  return {
    balance: {
      defaultMissionId: "weather_lab",
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
      abilities: {},
      enemies: {
        subject: {
          id: "subject",
          label: "Subject",
          maxHp: options.enemyHp ?? 1_000,
          speed: options.enemySpeed ?? 0.01,
          reward: { coins: 7 },
          coinReward: 7,
          coreDamage: 1,
          color: 1
        }
      },
      towers: {
        subject: {
          id: "subject",
          label: "Subject",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: options.towerRange ?? 20,
          attack: {
            kind: "single",
            fireRate: options.towerFireRate ?? 1,
            damagePerStack: options.towerDamage ?? 10,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1
          }
        }
      },
      waveSets: {
        weather_waves: [
          {
            id: "wave_1",
            label: "Wave 1",
            groups: [{ enemyId: "subject", count: 1, spawnInterval: 0, startDelay: 0, routeId: "main" }]
          },
          {
            id: "wave_2",
            label: "Wave 2",
            groups: [{ enemyId: "subject", count: 1, spawnInterval: 0, startDelay: 0, routeId: "main" }]
          }
        ]
      },
      missions: {
        weather_lab: {
          id: "weather_lab",
          label: "Weather Lab",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 100,
          mapId: "lane",
          waveSetId: "weather_waves",
          buildTowerIds: ["subject"],
          abilityIds: [],
          ...(selected ? { mechanics: { profiles: { weather: "storm_field" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 12,
        height: 3,
        grid: options.topology === "hex"
          ? { kind: "hex", layout: "odd-r" }
          : { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 11, r: 1 },
        pathCenterline: path,
        pathRoutes: [{ id: "main", pathCenterline: path }],
        terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: modulePresent
        ? {
            weather: {
              schemaVersion: 1,
              enabled: activation !== "disabled",
              profiles: { storm_field: profile(options.effects, options.zoneTiles) }
            }
          }
        : {}
    } as unknown as GameContentInput["mechanics"],
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
      missionNodes: [{
        missionId: "weather_lab",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function content(options: FixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(input(options));
}

function game(options: FixtureOptions = {}, seed = "r13.5-weather-runtime"): TowerDefenseGame {
  return new TowerDefenseGame({ content: content(options), missionId: "weather_lab", seed });
}

function weatherSnapshot(subject: Readonly<TowerDefenseGame>): WeatherSnapshotContract | undefined {
  return (subject.getSnapshot() as unknown as { weather?: WeatherSnapshotContract }).weather;
}

function eventRows(subject: Readonly<TowerDefenseGame>, type: string): Array<Record<string, unknown>> {
  return (subject.lastEvents as unknown as Array<Record<string, unknown>>).filter((event) => event.type === type);
}

function startAndSpawn(subject: TowerDefenseGame): void {
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  expect(subject.enemies).toHaveLength(1);
}

function tickRepeated(subject: TowerDefenseGame, count: number, units = 0.2): void {
  for (let index = 0; index < count; index += 1) subject.tick(units);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R13.5 live Weather integration (RED)", () => {
  it("publishes one active occurrence and stable start/end events for every selected wave", () => {
    const subject = game({ enemyHp: 100, towerDamage: 1_000, towerFireRate: 10 });
    expect(subject.placeTower("subject", { q: 2, r: 0 })).toEqual({ ok: true });
    expect(weatherSnapshot(subject)).toEqual({ schemaVersion: 1, profileId: "storm_field", active: null });

    expect(subject.startNextWave()).toEqual({ ok: true });
    expect(weatherSnapshot(subject)).toEqual({
      schemaVersion: 1,
      profileId: "storm_field",
      active: {
        waveIndex: 0,
        choiceId: "always",
        weatherId: "storm",
        zoneId: "field",
        zone: { kind: "all_map" },
        elapsedUnits: 0
      }
    });
    expect(eventRows(subject, "weatherStarted")).toEqual([expect.objectContaining({
      type: "weatherStarted",
      profileId: "storm_field",
      waveIndex: 0,
      choiceId: "always",
      weatherId: "storm",
      zoneId: "field"
    })]);

    subject.tick(0);
    expect(subject.getSnapshot().waveState).toBe("between");
    expect(weatherSnapshot(subject)?.active).toBeNull();
    expect(eventRows(subject, "weatherEnded")).toEqual([expect.objectContaining({
      type: "weatherEnded", waveIndex: 0, choiceId: "always", reason: "wave_cleared"
    })]);

    expect(subject.startNextWave()).toEqual({ ok: true });
    expect(weatherSnapshot(subject)?.active).toMatchObject({ waveIndex: 1, choiceId: "always" });
    expect(eventRows(subject, "weatherStarted")).toHaveLength(1);
  });

  it("applies one periodic enemy DamagePacket at one crossed boundary and never settles it twice", () => {
    const resolve = vi.spyOn(DamageResolver, "resolve");
    const subject = game({
      effects: {
        acid: {
          kind: "periodic_damage",
          target: "enemies",
          amount: 10,
          intervalUnits: 0.2,
          damageType: "acid"
        }
      }
    });
    startAndSpawn(subject);

    subject.tick(0.2);

    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({
      amount: 10,
      damageType: "acid",
      source: {
        kind: "weather",
        profileId: "storm_field",
        weatherId: "storm",
        zoneId: "field",
        effectId: "acid"
      },
      target: { kind: "enemy", enemyId: "enemy_1", enemyTypeId: "subject" },
      tags: ["area", "over_time"]
    });
    expect(subject.enemies[0]?.hp).toBe(990);
    expect(eventRows(subject, "weatherEffectApplied")).toEqual([expect.objectContaining({
      type: "weatherEffectApplied",
      effectId: "acid",
      kind: "periodic_damage",
      applicationOrdinal: 1,
      affectedCount: 1
    })]);

    subject.tick(0);
    expect(resolve).toHaveBeenCalledOnce();
    expect(subject.enemies[0]?.hp).toBe(990);
  });

  it("applies the active zone enemy-speed multiplier before authoritative movement", () => {
    const slowed = game({
      enemySpeed: 1,
      effects: { blizzard_speed: { kind: "enemy_speed", multiplier: 0.5 } }
    });
    const legacy = game({ activation: "absent", enemySpeed: 1 });
    startAndSpawn(slowed);
    startAndSpawn(legacy);

    slowed.tick(0.2);
    legacy.tick(0.2);

    expect(slowed.enemies[0]?.pathProgress).toBeCloseTo(0.1, 10);
    expect(legacy.enemies[0]?.pathProgress).toBeCloseTo(0.2, 10);
  });

  it("applies the active zone tower fire-rate multiplier without changing tower definitions", () => {
    const effect = { storm_rate: { kind: "tower_fire_rate", multiplier: 2 } } as const;
    const activeContent = content({ effects: effect, enemyHp: 1_000, towerDamage: 10, towerFireRate: 1 });
    const legacyContent = content({ activation: "absent", enemyHp: 1_000, towerDamage: 10, towerFireRate: 1 });
    const active = new TowerDefenseGame({ content: activeContent, missionId: "weather_lab", seed: "fire-rate" });
    const legacy = new TowerDefenseGame({ content: legacyContent, missionId: "weather_lab", seed: "fire-rate" });
    const authoredAttack = structuredClone(activeContent.towers.subject!.attack);
    for (const subject of [active, legacy]) {
      expect(subject.placeTower("subject", { q: 2, r: 0 })).toEqual({ ok: true });
      startAndSpawn(subject);
      tickRepeated(subject, 3);
    }

    expect(active.enemies[0]?.hp).toBe(980);
    expect(legacy.enemies[0]?.hp).toBe(990);
    expect(activeContent.towers.subject!.attack).toEqual(authoredAttack);
  });

  it.each(["square", "hex"] as const)(
    "uses exact authored tile membership on the %s topology",
    (topology) => {
      const inside = game({
        topology,
        zoneTiles: [{ q: 0, r: 1 }],
        effects: { acid: { kind: "periodic_damage", target: "enemies", amount: 10, intervalUnits: 0.2 } }
      }, `tiles-inside-${topology}`);
      const outside = game({
        topology,
        zoneTiles: [{ q: 5, r: 1 }],
        effects: { acid: { kind: "periodic_damage", target: "enemies", amount: 10, intervalUnits: 0.2 } }
      }, `tiles-outside-${topology}`);
      startAndSpawn(inside);
      startAndSpawn(outside);

      inside.tick(0.2);
      outside.tick(0.2);

      expect(inside.enemies[0]?.hp).toBe(990);
      expect(outside.enemies[0]?.hp).toBe(1_000);
    }
  );

  it("applies status before movement and visibility range before target acquisition", () => {
    const status = game({
      enemySpeed: 1,
      effects: {
        stun: { kind: "status", target: "enemies", intervalUnits: 0.2, status: { stun: 1 } }
      }
    }, "weather-status");
    startAndSpawn(status);
    status.tick(0.2);
    expect(status.enemies[0]?.pathProgress).toBe(0);
    expect(eventRows(status, "weatherEffectApplied")).toEqual([
      expect.objectContaining({ kind: "status", effectId: "stun", affectedCount: 1 })
    ]);

    const obscured = game({
      enemySpeed: 0.01,
      towerRange: 3,
      towerDamage: 10,
      towerFireRate: 10,
      effects: { sand: { kind: "visibility_range", multiplier: 0.05 } }
    }, "weather-visibility");
    const clear = game({
      activation: "absent",
      enemySpeed: 0.01,
      towerRange: 3,
      towerDamage: 10,
      towerFireRate: 10
    }, "weather-visibility");
    for (const subject of [obscured, clear]) {
      expect(subject.placeTower("subject", { q: 2, r: 0 })).toEqual({ ok: true });
      startAndSpawn(subject);
      subject.tick(0.2);
    }
    expect(obscured.enemies[0]?.hp).toBe(1_000);
    expect(clear.enemies[0]?.hp).toBeLessThan(1_000);
  });

  it("restores active weather and matches continuous simulation with journal replay", () => {
    const subjectContent = content({
      effects: {
        acid: { kind: "periodic_damage", target: "enemies", amount: 10, intervalUnits: 0.2 }
      }
    });
    const continuous = new TowerDefenseGame({
      content: subjectContent,
      missionId: "weather_lab",
      seed: "weather-checkpoint-replay"
    });
    const session = new JournaledGameSession(continuous);
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0 })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });

    const checkpoint = continuous.createCheckpoint();
    expect((checkpoint.state as unknown as { weather?: unknown }).weather).toMatchObject({
      schemaVersion: 1,
      profileId: "storm_field",
      active: { waveIndex: 0, choiceId: "always", elapsedUnits: 0.2 },
      periodicOrdinals: { acid: 1 },
      rng: { initial: expect.any(Object), current: expect.any(Object) }
    });
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());

    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    restored.tick(0.2);
    const replay = replayGameCommandJournal({ content: subjectContent, journal: session.exportJournal() });
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
    expect(replay.stateDigest).toBe(continuous.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(continuous.getSnapshot());
  });

  it("rejects malformed/future checkpoint weather and mismatched active zone provenance", () => {
    const subjectContent = content({
      zoneTiles: [{ q: 0, r: 1 }],
      effects: { acid: { kind: "periodic_damage", target: "enemies", amount: 10, intervalUnits: 0.2 } }
    });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "weather_lab", seed: "weather-checkpoint-hostile" });
    startAndSpawn(subject);
    const checkpoint = structuredClone(subject.createCheckpoint()) as any;

    const future = structuredClone(checkpoint);
    future.state.weather.schemaVersion = 2;
    future.stateDigest = computeCheckpointStateDigest(
      future.contentDigest,
      future.identity,
      future.rng,
      future.state
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: future })).toThrow(/weather|schema|version/i);

    const mismatchedZone = structuredClone(checkpoint);
    mismatchedZone.state.weather.active.zone = { kind: "all_map" };
    mismatchedZone.stateDigest = computeCheckpointStateDigest(
      mismatchedZone.contentDigest,
      mismatchedZone.identity,
      mismatchedZone.rng,
      mismatchedZone.state
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: mismatchedZone }))
      .toThrow(/weather|zone|provenance/i);
  });

  it("rejects a re-signed active choice that is not the deterministic occurrence for its wave", () => {
    const subjectInput = input({
      effects: { acid: { kind: "periodic_damage", target: "enemies", amount: 10, intervalUnits: 0.2 } }
    }) as any;
    const weatherProfile = subjectInput.mechanics.modules.weather.profiles.storm_field;
    weatherProfile.definitions.alternate = {
      label: "Alternate",
      effects: { acid: { kind: "periodic_damage", target: "enemies", amount: 100, intervalUnits: 0.2 } }
    };
    weatherProfile.schedule.choices.alternate = {
      weatherId: "alternate", zoneId: "field", weight: 1
    };
    const subjectContent = createGameContentRegistry(subjectInput);
    const subject = new TowerDefenseGame({
      content: subjectContent, missionId: "weather_lab", seed: "weather-choice-provenance"
    });
    startAndSpawn(subject);
    const checkpoint = structuredClone(subject.createCheckpoint()) as any;
    const actualChoiceId = checkpoint.state.weather.active.choiceId;
    const forgedChoiceId = actualChoiceId === "always" ? "alternate" : "always";
    const forgedChoice = weatherProfile.schedule.choices[forgedChoiceId];
    checkpoint.state.weather.active.choiceId = forgedChoiceId;
    checkpoint.state.weather.active.weatherId = forgedChoice.weatherId;
    checkpoint.stateDigest = computeCheckpointStateDigest(
      checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, checkpoint.state
    );

    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint }))
      .toThrow(/weather.*(?:schedule|occurrence|choice|provenance)/i);
  });

  it("rejects re-signed active Weather state that diverges from the outer wave lifecycle", () => {
    const subjectContent = content({
      effects: { acid: { kind: "periodic_damage", target: "enemies", amount: 10, intervalUnits: 0.2 } }
    });
    const subject = new TowerDefenseGame({
      content: subjectContent, missionId: "weather_lab", seed: "weather-wave-provenance"
    });
    startAndSpawn(subject);
    const checkpoint = structuredClone(subject.createCheckpoint()) as any;
    const mutations: Array<(candidate: any) => void> = [
      (candidate) => { candidate.state.weather.active.waveIndex = 1; },
      (candidate) => {
        candidate.state.weather.active = null;
        candidate.state.weather.periodicOrdinals = {};
      }
    ];

    for (const mutate of mutations) {
      const candidate = structuredClone(checkpoint);
      mutate(candidate);
      candidate.stateDigest = computeCheckpointStateDigest(
        candidate.contentDigest, candidate.identity, candidate.rng, candidate.state
      );
      expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: candidate }))
        .toThrow(/weather.*(?:active|wave|lifecycle|provenance)/i);
    }
  });

  it("rejects re-signed Weather cursors that would repeat or suppress a settled application", () => {
    const subjectContent = content({
      effects: { acid: { kind: "periodic_damage", target: "enemies", amount: 10, intervalUnits: 0.2 } }
    });
    const subject = new TowerDefenseGame({
      content: subjectContent, missionId: "weather_lab", seed: "weather-cursor-provenance"
    });
    startAndSpawn(subject);
    subject.tick(0.2);
    expect(subject.enemies[0]?.hp).toBe(990);
    const checkpoint = structuredClone(subject.createCheckpoint()) as any;

    for (const forgedOrdinal of [0, 100]) {
      const candidate = structuredClone(checkpoint);
      candidate.state.weather.periodicOrdinals.acid = forgedOrdinal;
      candidate.stateDigest = computeCheckpointStateDigest(
        candidate.contentDigest, candidate.identity, candidate.rng, candidate.state
      );
      expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: candidate }))
        .toThrow(/weather.*(?:ordinal|cursor|application|provenance)/i);
    }
  });

  it("caps live periodic DamagePacket applications per tick and emits one diagnostic", () => {
    const subjectInput = input({
      effects: { acid: { kind: "periodic_damage", target: "enemies", amount: 10, intervalUnits: 0.2 } }
    }) as any;
    subjectInput.balance.waveSets.weather_waves[0].groups[0].count = WEATHER_LIMITS.applicationsPerTick + 1;
    const subject = new TowerDefenseGame({
      content: createGameContentRegistry(subjectInput),
      missionId: "weather_lab",
      seed: "weather-application-budget"
    });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.enemies).toHaveLength(WEATHER_LIMITS.applicationsPerTick + 1);
    subject.tick(0.2);

    expect({
      damaged: subject.enemies.filter((enemy) => enemy.hp === 990).length,
      diagnostics: eventRows(subject, "weatherBudgetExceeded").length
    }).toEqual({
      damaged: WEATHER_LIMITS.applicationsPerTick,
      diagnostics: 1
    });
  });

  it("reset clears active weather and periodic ordinals before the next run", () => {
    const subject = game({
      effects: { acid: { kind: "periodic_damage", target: "enemies", amount: 10, intervalUnits: 0.2 } }
    }, "weather-reset");
    startAndSpawn(subject);
    subject.tick(0.2);
    expect((subject.createCheckpoint().state as any).weather.periodicOrdinals).toEqual({ acid: 1 });

    subject.reset();

    expect(weatherSnapshot(subject)?.active).toBeNull();
    expect((subject.createCheckpoint().state as any).weather.periodicOrdinals).toEqual({});
    expect(subject.lastEvents.some((event) => String(event.type).startsWith("weather"))).toBe(false);
  });

  it.each(["absent", "disabled", "unselected"] as const)(
    "keeps %s Weather completely outside the legacy runtime shape",
    (activation) => {
      const subject = game({
        activation,
        effects: {
          acid: { kind: "periodic_damage", target: "enemies", amount: 10, intervalUnits: 0.2 },
          wind: { kind: "enemy_speed", multiplier: 0.5 }
        }
      });
      startAndSpawn(subject);
      subject.tick(0.2);

      expect(subject.getSnapshot()).not.toHaveProperty("weather");
      expect(subject.createCheckpoint().state).not.toHaveProperty("weather");
      expect(subject.enemies[0]).toMatchObject({ hp: 1_000, pathProgress: 0.002 });
      expect(subject.lastEvents.some((event) => String(event.type).startsWith("weather"))).toBe(false);
    }
  );
});
