import { describe, expect, it } from "vitest";
import { validateMonetizationHookV1 } from "./index.mjs";

function placement(index, kind = "banner", surface = "bottom") {
  return { id: `placement_${index}`, kind, surface };
}

describe("R17.4 MonetizationHookV1 host-only contract (RED)", () => {
  it("accepts only the three host-injected placement kinds and bounded surfaces", () => {
    const hook = {
      schemaVersion: 1,
      placements: [
        placement(1, "banner", "top"),
        placement(2, "interstitial", "between_waves"),
        placement(3, "purchase_link", "menu")
      ]
    };
    expect(validateMonetizationHookV1(hook)).toEqual(hook);
  });

  it("rejects future versions, duplicates, a seventeenth placement and sparse arrays", () => {
    const valid = { schemaVersion: 1, placements: [placement(1)] };
    expect(() => validateMonetizationHookV1({ ...valid, schemaVersion: 2 })).toThrow(/schema|version|monetization/i);
    expect(() => validateMonetizationHookV1({ ...valid, placements: [placement(1), placement(1)] }))
      .toThrow(/duplicate|placement|id/i);
    expect(() => validateMonetizationHookV1({
      ...valid,
      placements: Array.from({ length: 17 }, (_, index) => placement(index))
    })).toThrow(/16|limit|placement/i);
    expect(() => validateMonetizationHookV1({ ...valid, placements: new Array(1) }))
      .toThrow(/sparse|placement|array/i);
  });

  it("rejects gameplay rewards, payment material, embedded URLs, telemetry and arbitrary host code", () => {
    const forbidden = [
      { ...placement(1), reward: { coins: 100 } },
      { ...placement(1), paymentKey: "sk_test_forbidden" },
      { ...placement(1, "purchase_link", "menu"), url: "https://payments.example.invalid" },
      { ...placement(1), telemetry: true },
      { ...placement(1), script: "alert(1)" },
      { ...placement(1), kind: "rewarded" }
    ];
    for (const value of forbidden) {
      expect(() => validateMonetizationHookV1({ schemaVersion: 1, placements: [value] }))
        .toThrow(/unsupported|placement|reward|payment|url|telemetry|kind/i);
    }
  });

  it("does not execute placement accessors", () => {
    let reads = 0;
    const hostile = placement(1);
    Object.defineProperty(hostile, "kind", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("monetization accessor executed");
      }
    });
    expect(() => validateMonetizationHookV1({ schemaVersion: 1, placements: [hostile] }))
      .toThrow(/accessor|own data|placement|inspect/i);
    expect(reads).toBe(0);
  });
});
