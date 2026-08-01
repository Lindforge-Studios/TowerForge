import type { GameContentRegistry } from "./registry.js";
export declare const MACRO_ECONOMY_LIMITS: Readonly<{
    commodities: 32;
    deposits: 32;
    altars: 32;
    effectsPerRitual: 16;
    towerTypesPerRitual: 64;
    activeDeposits: 1024;
    temporaryModifiers: 1024;
    sequence: 1000000000;
    temporaryMultiplierProduct: 1e+100;
    idCodeUnits: 128;
    seedDomainCodeUnits: 4096;
    labelCodeUnits: 256;
    price: 1000000000;
    amount: 1000000000000;
    durationWaves: 10000;
    basisPoints: 1000000;
    radius: 128;
}>;
export declare const MACRO_ECONOMY_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 1;
    moduleId: "macroEconomy";
    supportedModuleSchemaVersions: readonly [1];
    profile: {
        requiredFields: readonly ["quoteCurrencyId", "commodities", "deposits", "altars"];
        additionalProperties: boolean;
    };
    commodity: {
        requiredFields: readonly ["label", "basePrice", "minPrice", "maxPrice", "trendPerWave", "volatility", "demandElasticity"];
        additionalProperties: boolean;
    };
    limits: Readonly<{
        commodities: 32;
        deposits: 32;
        altars: 32;
        effectsPerRitual: 16;
        towerTypesPerRitual: 64;
        activeDeposits: 1024;
        temporaryModifiers: 1024;
        sequence: 1000000000;
        temporaryMultiplierProduct: 1e+100;
        idCodeUnits: 128;
        seedDomainCodeUnits: 4096;
        labelCodeUnits: 256;
        price: 1000000000;
        amount: 1000000000000;
        durationWaves: 10000;
        basisPoints: 1000000;
        radius: 128;
    }>;
}>;
export interface MacroEconomyCommodityDefinitionV1 {
    readonly label: string;
    readonly basePrice: number;
    readonly minPrice: number;
    readonly maxPrice: number;
    readonly trendPerWave: number;
    readonly volatility: number;
    readonly demandElasticity: number;
}
export interface MacroEconomyDepositDefinitionV1 {
    readonly label: string;
    readonly currencyId: string;
    readonly durationClearedWaves: number;
    readonly interestBasisPoints: number;
    readonly minAmount: number;
    readonly maxAmount: number;
}
export type MacroEconomyRitualEffectV1 = {
    readonly kind: "grant_resource";
    readonly resourceId: string;
    readonly amount: number;
} | {
    readonly kind: "damage_enemies";
    readonly damageTypeId: string;
    readonly amount: number;
    readonly radius: number;
} | {
    readonly kind: "apply_status";
    readonly status: "slow" | "stun" | "poison";
    readonly duration: number;
    readonly radius: number;
    readonly magnitude: number;
} | {
    readonly kind: "temporary_tower_modifier";
    readonly stat: "damage" | "range" | "fire_rate";
    readonly multiplier: number;
    readonly duration: number;
};
export interface MacroEconomyAltarDefinitionV1 {
    readonly label: string;
    readonly coord: {
        readonly q: number;
        readonly r: number;
    };
    readonly radius: number;
    readonly minTowers: number;
    readonly maxTowers: number;
    readonly towerTypeIds: readonly string[];
    readonly effects: readonly MacroEconomyRitualEffectV1[];
}
export interface MacroEconomyProfileV1 {
    readonly quoteCurrencyId: string;
    readonly commodities: Readonly<Record<string, MacroEconomyCommodityDefinitionV1>>;
    readonly deposits: Readonly<Record<string, MacroEconomyDepositDefinitionV1>>;
    readonly altars: Readonly<Record<string, MacroEconomyAltarDefinitionV1>>;
}
export interface ActiveMacroEconomyMechanicsV1 extends MacroEconomyProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export interface MacroEconomyTemporaryModifierInputV1 {
    readonly stat: "damage" | "range" | "fire_rate";
    readonly multiplier: number;
}
export type MacroEconomyDerivedStatPreflightV1 = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly towerTypeId: string;
    readonly stat: "range" | "fire_rate";
};
export interface MacroEconomyMarketRuntimeV1 {
    readonly schemaVersion: 1;
    readonly seedDomain: string;
    readonly lastPriceWaveIndex: number;
    readonly quotes: Readonly<Record<string, number>>;
    readonly holdings: Readonly<Record<string, number>>;
    readonly pendingNetDemand: Readonly<Record<string, number>>;
}
export declare class MacroEconomyProfileValidationError extends Error {
}
export declare function normalizeMacroEconomyProfileV1(value: unknown): MacroEconomyProfileV1;
export declare function createMarketRuntimeV1(profile: MacroEconomyProfileV1, seedDomain: string): MacroEconomyMarketRuntimeV1;
export declare function advanceMarketWaveV1(profile: MacroEconomyProfileV1, runtime: MacroEconomyMarketRuntimeV1, waveIndex: number): MacroEconomyMarketRuntimeV1;
/** Pure conservative proof shared by live ritual preflight and checkpoint restore. */
export declare function preflightMacroEconomyDerivedStatsV1(content: GameContentRegistry, missionId: string, metaUpgradeLevels: Readonly<Record<string, number>>, temporaryModifiers: readonly MacroEconomyTemporaryModifierInputV1[]): MacroEconomyDerivedStatPreflightV1;
export declare function resolveActiveMacroEconomyMechanics(content: GameContentRegistry, missionId: string): ActiveMacroEconomyMechanicsV1 | undefined;
