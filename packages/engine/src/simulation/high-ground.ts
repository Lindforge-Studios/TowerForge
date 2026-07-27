import type { ElevationHighGroundProfileV3 } from "../content/elevation-mechanics.js";

/** Mission-selected, validated high-ground profile used by the simulation. */
export type ActiveHighGroundMechanics = ElevationHighGroundProfileV3 & {
  readonly profileId: string;
};

export interface HighGroundPairModifiers {
  readonly rawDelta: number;
  readonly effectiveDelta: number;
  readonly rangeBonus: number;
  readonly damageBonusBasisPoints: number;
}

const NO_HIGH_GROUND = Object.freeze({
  rawDelta: 0,
  effectiveDelta: 0,
  rangeBonus: 0,
  damageBonusBasisPoints: 0
});

/**
 * Compute pair-local high-ground modifiers using integer arithmetic only.
 * Undefined or non-integral elevations fail closed so hostile map-shaped input
 * cannot create a partial bonus at runtime.
 */
export function computeHighGroundPairModifiers(
  sourceElevation: number | undefined,
  targetElevation: number | undefined,
  profile: ActiveHighGroundMechanics
): HighGroundPairModifiers {
  if (!Number.isSafeInteger(sourceElevation) || !Number.isSafeInteger(targetElevation)) {
    return NO_HIGH_GROUND;
  }
  const rawDelta = (sourceElevation as number) - (targetElevation as number);
  if (rawDelta <= 0) {
    return Object.freeze({ ...NO_HIGH_GROUND, rawDelta });
  }
  const effectiveDelta = Math.min(rawDelta, profile.maximumEffectiveElevationDelta);
  return Object.freeze({
    rawDelta,
    effectiveDelta,
    rangeBonus: effectiveDelta * profile.rangeBonusPerElevation,
    damageBonusBasisPoints: effectiveDelta * profile.damageBonusBasisPointsPerElevation
  });
}
