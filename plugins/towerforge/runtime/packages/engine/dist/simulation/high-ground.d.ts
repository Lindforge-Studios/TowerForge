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
/**
 * Compute pair-local high-ground modifiers using integer arithmetic only.
 * Undefined or non-integral elevations fail closed so hostile map-shaped input
 * cannot create a partial bonus at runtime.
 */
export declare function computeHighGroundPairModifiers(sourceElevation: number | undefined, targetElevation: number | undefined, profile: ActiveHighGroundMechanics): HighGroundPairModifiers;
