import { describe, expect, it } from "vitest";
import {
  computeHighGroundPairModifiers,
  type ActiveHighGroundMechanics
} from "./high-ground.js";

const profile = Object.freeze({
  profileId: "plateau",
  maximumEffectiveElevationDelta: 3,
  rangeBonusPerElevation: 2,
  damageBonusBasisPointsPerElevation: 1_250
}) satisfies ActiveHighGroundMechanics;

describe("R3.3 pure deterministic high-ground pair math", () => {
  it.each([
    ["uphill", 5, 3, {
      rawDelta: 2,
      effectiveDelta: 2,
      rangeBonus: 4,
      damageBonusBasisPoints: 2_500
    }],
    ["capped uphill", 100, 0, {
      rawDelta: 100,
      effectiveDelta: 3,
      rangeBonus: 6,
      damageBonusBasisPoints: 3_750
    }],
    ["equal", -4, -4, {
      rawDelta: 0,
      effectiveDelta: 0,
      rangeBonus: 0,
      damageBonusBasisPoints: 0
    }],
    ["downhill", -5, -2, {
      rawDelta: -3,
      effectiveDelta: 0,
      rangeBonus: 0,
      damageBonusBasisPoints: 0
    }],
    ["negative authored elevations", -2, -5, {
      rawDelta: 3,
      effectiveDelta: 3,
      rangeBonus: 6,
      damageBonusBasisPoints: 3_750
    }]
  ])("computes the exact %s pair result", (_label, sourceElevation, targetElevation, expected) => {
    expect(computeHighGroundPairModifiers(sourceElevation, targetElevation, profile)).toEqual(expected);
  });

  it.each([
    [undefined, 0],
    [0, undefined],
    [undefined, undefined]
  ])("fails closed when either elevation lookup is undefined (%s, %s)", (sourceElevation, targetElevation) => {
    expect(computeHighGroundPairModifiers(sourceElevation, targetElevation, profile)).toMatchObject({
      effectiveDelta: 0,
      rangeBonus: 0,
      damageBonusBasisPoints: 0
    });
  });

  it("uses integer basis points and leaves the frozen inputs untouched", () => {
    const exact = Object.freeze({
      profileId: "exact",
      maximumEffectiveElevationDelta: 64,
      rangeBonusPerElevation: 1,
      damageBonusBasisPointsPerElevation: 1_562
    }) satisfies ActiveHighGroundMechanics;
    const before = JSON.stringify(exact);

    expect(computeHighGroundPairModifiers(64, 0, exact)).toEqual({
      rawDelta: 64,
      effectiveDelta: 64,
      rangeBonus: 64,
      damageBonusBasisPoints: 99_968
    });
    expect(JSON.stringify(exact)).toBe(before);
  });
});
