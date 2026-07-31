import { type ModifierSpec, type ModifierTraceStep } from "./modifiers.js";
import { type MarkConsumePolicy } from "../content/mechanics.js";
import type { ArmorMatrixContext } from "../content/combat-mechanics.js";
export type DamageSourceRef = {
    readonly kind: "tower";
    readonly towerId?: string;
    readonly towerTypeId: string;
} | {
    readonly kind: "ability";
    readonly abilityId: string;
} | {
    readonly kind: "tower_script";
    readonly scriptId: string;
} | {
    readonly kind: "status";
    readonly statusId: string;
} | {
    readonly kind: "reaction";
    readonly reactionId: string;
} | {
    readonly kind: "weather";
    readonly profileId: string;
    readonly weatherId: string;
    readonly zoneId: string;
    readonly effectId: string;
} | {
    readonly kind: "enemy";
    readonly enemyId: string;
    readonly enemyTypeId: string;
} | {
    readonly kind: "leak";
    readonly enemyId: string;
    readonly enemyTypeId: string;
};
export type DamageTargetRef = {
    readonly kind: "enemy";
    readonly enemyId: string;
    readonly enemyTypeId: string;
    readonly componentId?: string;
} | {
    readonly kind: "tower";
    readonly towerId: string;
    readonly towerTypeId: string;
} | {
    readonly kind: "hero";
    readonly heroId: string;
    readonly heroDefinitionId: string;
} | {
    readonly kind: "map_object";
    readonly objectId: string;
    readonly definitionId: string;
} | {
    readonly kind: "core";
};
export declare const DAMAGE_TAGS: readonly ["area", "over_time", "armor_piercing", "reaction"];
export type DamageTag = (typeof DAMAGE_TAGS)[number];
export interface DamagePacket {
    readonly amount: number;
    readonly damageType?: string;
    readonly source: DamageSourceRef;
    readonly target: DamageTargetRef;
    readonly tags?: readonly DamageTag[];
    readonly modifiers?: readonly ModifierSpec[];
}
export interface LegacyPierceOnlyDefense {
    readonly kind: "pierce_only";
    /** Whether this particular packet already satisfied the legacy piercing rule. */
    readonly bypassed: boolean;
    /** Maximum damage allowed through when the legacy armor is not bypassed. */
    readonly chipDamage: number;
}
/** @deprecated Use LegacyPierceOnlyDefense. */
export type LegacyPierceOnlyArmorContext = LegacyPierceOnlyDefense;
export interface DamageResolutionContext {
    readonly armorMatrix?: ArmorMatrixContext;
    readonly resistances?: Readonly<Record<string, number>>;
    readonly legacyArmor?: LegacyPierceOnlyDefense;
    readonly marks?: readonly ActiveMarkDamageContext[];
}
export interface ActiveMarkDamageContext {
    readonly markId: string;
    readonly stacks: number;
    readonly multiplier: number;
    readonly consumePolicy: MarkConsumePolicy;
    readonly damageTypes?: readonly string[];
}
export interface MarkDamageTraceStep {
    readonly markId: string;
    readonly stacks: number;
    readonly multiplier: number;
    readonly effectiveMultiplier: number;
    readonly before: number;
    readonly after: number;
    readonly consumePolicy: MarkConsumePolicy;
}
export interface DamageResolution {
    readonly requestedAmount: number;
    readonly modifierTrace: readonly ModifierTraceStep[];
    readonly afterModifiers: number;
    readonly markTrace?: readonly MarkDamageTraceStep[];
    readonly afterMarks?: number;
    readonly armorTypeId?: string;
    readonly armorMultiplier?: number;
    readonly afterArmor?: number;
    readonly resistanceMultiplier: number;
    readonly afterResistance: number;
    readonly finalAmount: number;
    readonly blockedByArmor: boolean;
}
/** Stateless shared damage pipeline. Entity mutation, shields, deaths and rewards stay outside it. */
export declare class DamageResolver {
    static resolve(packet: DamagePacket, context?: DamageResolutionContext): DamageResolution;
}
/** Validate and normalize every closed DamagePacket field without mutating an entity. */
export declare function validateDamagePacket(packet: DamagePacket): void;
