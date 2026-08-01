import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";

const profile = (order: "forward" | "reverse" = "forward") => ({
  quoteCurrencyId: "coins",
  commodities: Object.fromEntries((order === "forward"
    ? ["crystal", "ore"]
    : ["ore", "crystal"]).map((id) => [id, {
    label: id,
    basePrice: id === "ore" ? 10 : 20,
    minPrice: 1,
    maxPrice: 100,
    trendPerWave: id === "ore" ? 0.5 : -0.25,
    volatility: 0.2,
    demandElasticity: 0.1
  }])),
  deposits: {},
  altars: {}
});

type Api = {
  normalizeMacroEconomyProfileV1?: (value: unknown) => unknown;
  createMarketRuntimeV1?: (profile: unknown, seed: string) => unknown;
  advanceMarketWaveV1?: (profile: unknown, runtime: unknown, waveIndex: number) => unknown;
};

const api = Engine as Api;

describe("R15.1 deterministic local market contract (RED)", () => {
  it("normalizes a closed bounded profile and rejects accessors, sparse data and overflow", () => {
    expect(api.normalizeMacroEconomyProfileV1).toBeTypeOf("function");
    const normalize = api.normalizeMacroEconomyProfileV1!;
    expect(normalize(profile())).toMatchObject({ quoteCurrencyId: "coins" });
    expect(() => normalize({ ...profile(), hidden: true })).toThrow(/closed|unknown/i);

    const accessor = { ...profile() };
    Object.defineProperty(accessor, "commodities", { enumerable: true, get: () => profile().commodities });
    expect(() => normalize(accessor)).toThrow(/data|accessor|plain/i);

    const sparse = Array(2);
    sparse[1] = "ore";
    expect(() => normalize({ ...profile(), commodities: sparse })).toThrow(/object|record|plain/i);

    const commodities = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`c${index}`, {
      label: `c${index}`, basePrice: 1, minPrice: 1, maxPrice: 2,
      trendPerWave: 0, volatility: 0, demandElasticity: 0
    }]));
    expect(() => normalize({ ...profile(), commodities })).toThrow(/32|limit|commodities/i);

    const symbolEffects = [{ kind: "grant_resource", resourceId: "coins", amount: 1 }];
    Object.defineProperty(symbolEffects, Symbol("hidden"), { value: true, enumerable: true });
    expect(() => normalize({
      ...profile(),
      altars: {
        symbol: {
          label: "Symbol", coord: { q: 0, r: 0 }, radius: 1, minTowers: 1, maxTowers: 1,
          towerTypeIds: [], effects: symbolEffects
        }
      }
    })).toThrow(/symbol|dense|extra/i);

    expect(() => normalize({
      ...profile(),
      altars: {
        unsafe: {
          label: "Unsafe", coord: { q: 0, r: 0 }, radius: 1, minTowers: 1, maxTowers: 1,
          towerTypeIds: [], effects: [{ kind: "temporary_tower_modifier", stat: "fire_rate", multiplier: 0, duration: 1 }]
        }
      }
    })).toThrow(/multiplier/i);
  });

  it("uses a separate deterministic seed domain and is invariant to authored record order", () => {
    expect(api.createMarketRuntimeV1).toBeTypeOf("function");
    expect(api.advanceMarketWaveV1).toBeTypeOf("function");
    const normalize = api.normalizeMacroEconomyProfileV1!;
    const create = api.createMarketRuntimeV1!;
    const advance = api.advanceMarketWaveV1!;
    const leftProfile = normalize(profile("forward"));
    const rightProfile = normalize(profile("reverse"));
    const left = advance(leftProfile, create(leftProfile, "seed:market-domain"), 0);
    const right = advance(rightProfile, create(rightProfile, "seed:market-domain"), 0);
    expect(left).toEqual(right);
    expect(left).toEqual(advance(leftProfile, create(leftProfile, "seed:market-domain"), 0));
  });

  it("defers current-wave net demand until the next price step", () => {
    const normalize = api.normalizeMacroEconomyProfileV1!;
    const create = api.createMarketRuntimeV1!;
    const advance = api.advanceMarketWaveV1!;
    const normalized = normalize(profile());
    const initial = create(normalized, "market-demand");
    const traded = {
      ...(initial as Record<string, unknown>),
      pendingNetDemand: { crystal: 0, ore: 5 }
    };
    expect((initial as { quotes: { ore: number } }).quotes.ore).toBe(10);
    expect((traded as unknown as { quotes: { ore: number } }).quotes.ore).toBe(10);
    const next = advance(normalized, traded, 0) as {
      quotes: { ore: number };
      pendingNetDemand: { ore: number };
    };
    expect(next.quotes.ore).not.toBe(10);
    expect(next.pendingNetDemand.ore).toBe(0);
  });
});
