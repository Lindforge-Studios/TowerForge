import { describe, expect, it } from "vitest";
import { projectMacroEconomyPresentation } from "./macro-economy-presentation.mjs";

const snapshot = {
  macroEconomy: {
    schemaVersion: 1,
    profileId: "local",
    managementAllowed: true,
    ritualAllowed: true,
    quoteCurrencyId: "coins",
    market: { lastPriceWaveIndex: 0, commodities: [{ id: "ore", label: "Ore", quote: 11, holding: 2, pendingNetDemand: 0 }] },
    deposits: [],
    depositProducts: [{ id: "short", label: "Short", currencyId: "coins", durationClearedWaves: 2, interestBasisPoints: 500, minAmount: 10, maxAmount: 100 }],
    altars: [{ id: "forge", label: "Forge", coord: { q: 0, r: 0 }, radius: 2, minTowers: 1, maxTowers: 1, towerTypeIds: [], effects: [{ kind: "grant_resource", resourceId: "coins", amount: 1 }] }]
  }
};

describe("R15 macro-economy renderer projection", () => {
  it("projects authoritative management data without deriving prices or settlement", () => {
    expect(projectMacroEconomyPresentation(snapshot)).toMatchObject({ active: true, profileId: "local", managementAllowed: true, ritualAllowed: true, commodities: [{ id: "ore", quote: 11, holding: 2 }], depositProducts: [{ id: "short" }], altars: [{ id: "forge" }] });
  });

  it("keeps absent state inert and rejects accessors", () => {
    expect(projectMacroEconomyPresentation({})).toMatchObject({ active: false });
    const hostile = structuredClone(snapshot);
    Object.defineProperty(hostile.macroEconomy, "market", { enumerable: true, get: () => snapshot.macroEconomy.market });
    expect(projectMacroEconomyPresentation(hostile)).toBeUndefined();
  });
});
