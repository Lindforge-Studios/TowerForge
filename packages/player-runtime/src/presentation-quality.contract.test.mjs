import { describe, expect, it } from "vitest";
import { resolvePlayerPresentationQualityV1 } from "./presentation-quality.mjs";

describe("R18 player presentation quality", () => {
  it("returns closed bounded profiles that reduce DPR, pixels and FPS without gameplay fields", () => {
    const viewport = { width: 3440, height: 1440 };
    const low = resolvePlayerPresentationQualityV1("low", viewport);
    const balanced = resolvePlayerPresentationQualityV1("balanced", viewport);
    const high = resolvePlayerPresentationQualityV1("high", viewport);

    expect(Object.keys(low)).toEqual([
      "schemaVersion", "quality", "maxDevicePixelRatio", "pixelBudget", "resolution", "targetFps"
    ]);
    expect(low.maxDevicePixelRatio).toBeLessThan(balanced.maxDevicePixelRatio);
    expect(balanced.maxDevicePixelRatio).toBeLessThan(high.maxDevicePixelRatio);
    expect(low.pixelBudget).toBeLessThan(balanced.pixelBudget);
    expect(balanced.pixelBudget).toBeLessThan(high.pixelBudget);
    expect(low.targetFps).toBeLessThan(balanced.targetFps);
    expect(balanced.targetFps).toBeLessThan(high.targetFps);
    expect(low.resolution).toBeGreaterThanOrEqual(0.5);
    expect(high.resolution).toBeLessThanOrEqual(1);
    expect(Object.isFrozen(low)).toBe(true);
  });

  it("uses auto as a safe fallback and rejects malformed viewport dimensions", () => {
    expect(resolvePlayerPresentationQualityV1("future", { width: 1920, height: 1080 }).quality).toBe("auto");
    expect(() => resolvePlayerPresentationQualityV1("low", { width: 0, height: 1080 })).toThrow(/viewport/);
    expect(() => resolvePlayerPresentationQualityV1("low", { width: 1920, height: Number.NaN })).toThrow(/viewport/);
  });
});
