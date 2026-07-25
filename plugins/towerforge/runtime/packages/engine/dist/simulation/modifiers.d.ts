export declare const MODIFIER_TARGETS: readonly ["damage"];
export declare const MODIFIER_STAGE_ORDER: readonly ["tower_upgrade", "meta", "run", "spatial", "temporary"];
export declare const MODIFIER_OPERATION_ORDER: readonly ["flat", "additive_ratio", "multiplier"];
export declare const MAX_MODIFIERS_PER_RESOLUTION = 64;
export type ModifierTarget = (typeof MODIFIER_TARGETS)[number];
export type ModifierStage = (typeof MODIFIER_STAGE_ORDER)[number];
export type ModifierOperation = (typeof MODIFIER_OPERATION_ORDER)[number];
/**
 * A bounded, data-only modifier. The closed target and operation allowlists make
 * authored modifiers deterministic and safe to validate without executable code.
 */
export interface ModifierSpec {
    readonly id: string;
    readonly target: ModifierTarget;
    readonly stage: ModifierStage;
    readonly operation: ModifierOperation;
    readonly value: number;
}
export interface ModifierTraceStep {
    readonly id: string;
    readonly stage: ModifierStage;
    readonly operation: ModifierOperation;
    readonly operand: number;
    readonly before: number;
    readonly after: number;
}
export interface ModifierResolution {
    readonly baseValue: number;
    readonly target: ModifierTarget;
    readonly value: number;
    readonly trace: readonly ModifierTraceStep[];
}
/**
 * Resolves modifiers using the stable contract
 * stage -> operation -> binary id. Additive ratios in one stage are all
 * anchored to the value immediately after that stage's flat modifiers.
 */
export declare function resolveModifiers(baseValue: number, target: ModifierTarget, modifiers: readonly ModifierSpec[]): ModifierResolution;
