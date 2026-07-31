import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WEATHER_LIMITS,
  WeatherProfileValidationError,
  advanceWeatherRuntimeV1,
  createWeatherRuntimeV1,
  createWeatherScheduleV1,
  normalizeWeatherProfileV1
} from "./weather-mechanics.js";

function profile(order: "normal" | "reversed" = "normal"): unknown {
  const zones = order === "normal"
    ? { field: { kind: "all_map" }, gate: { kind: "tiles", tiles: [{ q: 2, r: 1 }, { q: 1, r: 1 }] } }
    : { gate: { kind: "tiles", tiles: [{ q: 1, r: 1 }, { q: 2, r: 1 }] }, field: { kind: "all_map" } };
  const effects = order === "normal"
    ? {
        acid: { kind: "periodic_damage", target: "enemies", amount: 4, intervalUnits: 0.2, damageType: "acid" },
        wind: { kind: "enemy_speed", multiplier: 0.8 }
      }
    : {
        wind: { kind: "enemy_speed", multiplier: 0.8 },
        acid: { kind: "periodic_damage", target: "enemies", amount: 4, intervalUnits: 0.2, damageType: "acid" }
      };
  const choices = order === "normal"
    ? {
        acid_gate: { weatherId: "storm", zoneId: "gate", weight: 3 },
        storm_field: { weatherId: "storm", zoneId: "field", weight: 2 }
      }
    : {
        storm_field: { weatherId: "storm", zoneId: "field", weight: 2 },
        acid_gate: { weatherId: "storm", zoneId: "gate", weight: 3 }
      };
  return {
    zones,
    definitions: { storm: { label: "Storm", effects } },
    schedule: { calmWeight: 1, choices }
  };
}

afterEach(() => vi.restoreAllMocks());

describe("R13.5 pure Weather v1 contracts (RED)", () => {
  it("normalizes closed own data into canonical detached frozen records", () => {
    const input = profile() as any;
    const normalized = normalizeWeatherProfileV1(input);
    input.zones.gate.tiles[0].q = 99;
    expect(Object.keys(normalized.zones)).toEqual(["field", "gate"]);
    expect(normalized.zones.gate).toEqual({ kind: "tiles", tiles: [{ q: 1, r: 1 }, { q: 2, r: 1 }] });
    expect(Object.keys(normalized.definitions.storm!.effects)).toEqual(["acid", "wind"]);
    expect(Object.keys(normalized.schedule.choices)).toEqual(["acid_gate", "storm_field"]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.zones.gate)).toBe(true);
  });

  it("rejects accessors, proxies, sparse arrays, cycles and unknown fields without executing traps", () => {
    let reads = 0;
    const accessor = profile() as any;
    Object.defineProperty(accessor, "zones", { enumerable: true, get: () => { reads += 1; return {}; } });
    expect(() => normalizeWeatherProfileV1(accessor)).toThrow(WeatherProfileValidationError);
    expect(reads).toBe(0);
    expect(() => normalizeWeatherProfileV1(new Proxy(profile() as object, { ownKeys: () => { throw new Error("trap"); } })))
      .toThrow(WeatherProfileValidationError);
    const sparse = profile() as any;
    sparse.zones.gate.tiles = new Array(2);
    expect(() => normalizeWeatherProfileV1(sparse)).toThrow(/dense|tile/i);
    const cyclic = profile() as any;
    cyclic.schedule.extra = cyclic;
    expect(() => normalizeWeatherProfileV1(cyclic)).toThrow(/closed|unknown/i);
  });

  it("enforces cross references, identifier safety and structural budgets", () => {
    const unknown = profile() as any;
    unknown.schedule.choices.acid_gate.zoneId = "missing";
    expect(() => normalizeWeatherProfileV1(unknown)).toThrow(/zone|missing|reference/i);
    const unsafe = profile() as any;
    unsafe.schedule.choices[" bad"] = unsafe.schedule.choices.acid_gate;
    expect(() => normalizeWeatherProfileV1(unsafe)).toThrow(/identifier|id|UTF-8/i);
    const tooMany = profile() as any;
    tooMany.zones = Object.fromEntries(Array.from({ length: WEATHER_LIMITS.zones + 1 }, (_, index) => [
      `z_${index}`, { kind: "all_map" }
    ]));
    expect(() => normalizeWeatherProfileV1(tooMany)).toThrow(/limit|zones/i);
  });

  it("creates an order-invariant seeded per-wave schedule in a separate RNG domain", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("host RNG"); });
    const left = createWeatherScheduleV1(normalizeWeatherProfileV1(profile("normal")), {
      seed: "root", missionId: "weather_lab", waveCount: 64
    });
    const right = createWeatherScheduleV1(normalizeWeatherProfileV1(profile("reversed")), {
      seed: "root", missionId: "weather_lab", waveCount: 64
    });
    expect(right).toEqual(left);
    expect(left.schemaVersion).toBe(1);
    expect(left.occurrences).toHaveLength(64);
    expect(left.occurrences.some((entry) => entry === null)).toBe(true);
    expect(random).not.toHaveBeenCalled();
  });

  it("advances start, first interval boundary and wave end without hidden simulation work", () => {
    const normalized = normalizeWeatherProfileV1({
      zones: { field: { kind: "all_map" } },
      definitions: { storm: { label: "Storm", effects: {
        acid: { kind: "periodic_damage", target: "enemies", amount: 4, intervalUnits: 0.2 }
      } } },
      schedule: { calmWeight: 0, choices: { always: { weatherId: "storm", zoneId: "field", weight: 1 } } }
    });
    const schedule = createWeatherScheduleV1(normalized, { seed: 7, missionId: "weather_lab", waveCount: 1 });
    const initial = createWeatherRuntimeV1(schedule);
    const started = advanceWeatherRuntimeV1(normalized, schedule, initial, {
      waveIndex: 0, elapsedUnits: 0, waveActive: true
    });
    expect(started.transitions).toEqual([expect.objectContaining({ kind: "started", choiceId: "always" })]);
    expect(started.dueEffects).toEqual([]);
    const due = advanceWeatherRuntimeV1(normalized, schedule, started.runtime, {
      waveIndex: 0, elapsedUnits: 0.2, waveActive: true
    });
    expect(due.dueEffects).toEqual([expect.objectContaining({ effectId: "acid", applicationOrdinal: 1 })]);
    const ended = advanceWeatherRuntimeV1(normalized, schedule, due.runtime, {
      waveIndex: 0, elapsedUnits: 0.2, waveActive: false
    });
    expect(ended.transitions).toEqual([expect.objectContaining({ kind: "ended", reason: "wave_cleared" })]);
  });

  it("rejects malformed/future schedule and runtime inputs instead of repairing them", () => {
    const normalized = normalizeWeatherProfileV1(profile());
    expect(() => createWeatherScheduleV1(normalized, { seed: "x", missionId: "weather_lab", waveCount: 4097 }))
      .toThrow(/wave|limit/i);
    const schedule = createWeatherScheduleV1(normalized, { seed: "x", missionId: "weather_lab", waveCount: 1 });
    expect(() => createWeatherRuntimeV1({ ...schedule, schemaVersion: 2 } as any)).toThrow(/schema|version/i);
  });

  it("rejects hostile nested schedule occurrences and runtime active state without executing accessors", () => {
    const normalized = normalizeWeatherProfileV1(profile());
    const schedule = createWeatherScheduleV1(normalized, { seed: "x", missionId: "weather_lab", waveCount: 1 });
    let occurrenceReads = 0;
    const hostileOccurrence = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostileOccurrence, "waveIndex", {
      enumerable: true,
      get: () => { occurrenceReads += 1; return 0; }
    });
    const hostileSchedule = {
      ...schedule,
      occurrences: [hostileOccurrence]
    };

    expect(() => createWeatherRuntimeV1(hostileSchedule as any)).toThrow(WeatherProfileValidationError);
    expect(occurrenceReads).toBe(0);

    const initial = createWeatherRuntimeV1(schedule);
    let activeReads = 0;
    const hostileActive = new Proxy({}, {
      get: () => { activeReads += 1; return 0; }
    });
    expect(() => advanceWeatherRuntimeV1(normalized, schedule, {
      ...initial,
      active: hostileActive as any
    }, {
      waveIndex: 0,
      elapsedUnits: 0,
      waveActive: true
    })).toThrow(WeatherProfileValidationError);
    expect(activeReads).toBe(0);
  });

  it("advances a capped periodic backlog without repeating already emitted ordinals", () => {
    const normalized = normalizeWeatherProfileV1({
      zones: { field: { kind: "all_map" } },
      definitions: { storm: { label: "Storm", effects: {
        acid: { kind: "periodic_damage", target: "enemies", amount: 1, intervalUnits: 1 }
      } } },
      schedule: { calmWeight: 0, choices: { always: { weatherId: "storm", zoneId: "field", weight: 1 } } }
    });
    const schedule = createWeatherScheduleV1(normalized, { seed: "budget", missionId: "weather_lab", waveCount: 1 });
    const started = advanceWeatherRuntimeV1(normalized, schedule, createWeatherRuntimeV1(schedule), {
      waveIndex: 0,
      elapsedUnits: 0,
      waveActive: true
    });
    const first = advanceWeatherRuntimeV1(normalized, schedule, started.runtime, {
      waveIndex: 0,
      elapsedUnits: WEATHER_LIMITS.applicationsPerTick + 904,
      waveActive: true
    });
    expect(first.dueEffects).toHaveLength(WEATHER_LIMITS.applicationsPerTick);
    expect(first.dueEffects.at(-1)?.applicationOrdinal).toBe(WEATHER_LIMITS.applicationsPerTick);

    const second = advanceWeatherRuntimeV1(normalized, schedule, first.runtime, {
      waveIndex: 0,
      elapsedUnits: WEATHER_LIMITS.applicationsPerTick + 904,
      waveActive: true
    });
    expect(second.dueEffects).toHaveLength(904);
    expect(second.dueEffects[0]?.applicationOrdinal).toBe(WEATHER_LIMITS.applicationsPerTick + 1);
    expect(second.dueEffects.at(-1)?.applicationOrdinal).toBe(WEATHER_LIMITS.applicationsPerTick + 904);

    const settled = advanceWeatherRuntimeV1(normalized, schedule, second.runtime, {
      waveIndex: 0,
      elapsedUnits: WEATHER_LIMITS.applicationsPerTick + 904,
      waveActive: true
    });
    expect(settled.dueEffects).toHaveLength(0);
  });
});
