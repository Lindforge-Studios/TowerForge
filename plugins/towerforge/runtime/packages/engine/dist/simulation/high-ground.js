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
export function computeHighGroundPairModifiers(sourceElevation, targetElevation, profile) {
    if (!Number.isSafeInteger(sourceElevation) || !Number.isSafeInteger(targetElevation)) {
        return NO_HIGH_GROUND;
    }
    const rawDelta = sourceElevation - targetElevation;
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
