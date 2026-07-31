import type { CampaignRunV2 } from "../run/campaign-run.js";
import type { GameContentRegistry } from "./registry.js";
export declare const ARSENAL_LIMITS: Readonly<{
    modules: 512;
    blueprints: 512;
    craftingRecipes: 512;
    compatibilityTags: 32;
    footprintCells: 64;
    patternCells: 9;
    idCodeUnits: 256;
    labelCodeUnits: 256;
    multiplier: 100;
}>;
export declare const ARSENAL_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 1;
    moduleId: "arsenal";
    supportedModuleSchemaVersions: readonly [1];
    profile: {
        requiredFields: readonly ["modules", "blueprints", "craftingRecipes"];
        optionalFields: readonly [];
        additionalProperties: boolean;
    };
    moduleCategories: readonly ["base", "barrel", "core"];
    module: {
        requiredFields: readonly ["label", "category", "compatibilityTags", "modifiers"];
        additionalProperties: boolean;
    };
    blueprint: {
        requiredFields: readonly ["compatibilityTags", "footprint", "defaultModules"];
        additionalProperties: boolean;
    };
    craftingRecipe: {
        requiredFields: readonly ["outputArtifactId", "allowRotations", "pattern"];
        board: string;
        additionalProperties: boolean;
    };
    limits: Readonly<{
        modules: 512;
        blueprints: 512;
        craftingRecipes: 512;
        compatibilityTags: 32;
        footprintCells: 64;
        patternCells: 9;
        idCodeUnits: 256;
        labelCodeUnits: 256;
        multiplier: 100;
    }>;
}>;
export type ArsenalModuleCategoryV1 = "base" | "barrel" | "core";
export interface ArsenalModuleDefinitionV1 {
    readonly label: string;
    readonly category: ArsenalModuleCategoryV1;
    readonly compatibilityTags: readonly string[];
    readonly modifiers: {
        readonly damageMultiplier: number;
        readonly rangeMultiplier: number;
        readonly durabilityMultiplier: number;
    };
}
export interface ArsenalModuleLoadoutV1 {
    readonly base: string;
    readonly barrel: string;
    readonly core: string;
}
export interface ArsenalBlueprintDefinitionV1 {
    readonly compatibilityTags: readonly string[];
    readonly footprint: readonly {
        readonly q: number;
        readonly r: number;
    }[];
    readonly defaultModules: ArsenalModuleLoadoutV1;
}
export interface ArsenalCraftingRecipeV1 {
    readonly outputArtifactId: string;
    readonly allowRotations: boolean;
    readonly pattern: readonly {
        readonly x: number;
        readonly y: number;
        readonly artifactId: string;
    }[];
}
export interface ArsenalProfileV1 {
    readonly modules: Readonly<Record<string, ArsenalModuleDefinitionV1>>;
    readonly blueprints: Readonly<Record<string, ArsenalBlueprintDefinitionV1>>;
    readonly craftingRecipes: Readonly<Record<string, ArsenalCraftingRecipeV1>>;
}
export interface ActiveArsenalMechanicsV1 extends ArsenalProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export interface CompiledArsenalTowerV1 {
    readonly schemaVersion: 1;
    readonly towerTypeId: string;
    readonly modules: ArsenalModuleLoadoutV1;
    readonly footprint: readonly {
        readonly q: number;
        readonly r: number;
    }[];
    readonly damageMultiplier: number;
    readonly rangeMultiplier: number;
    readonly durabilityMultiplier: number;
}
export interface CraftCampaignGemRequestV1 {
    readonly recipeId: string;
    readonly outputInstanceId: string;
    readonly cells: readonly {
        readonly x: number;
        readonly y: number;
        readonly artifactInstanceId: string;
    }[];
}
export type CraftCampaignGemResultV1 = Readonly<{
    ok: true;
    run: CampaignRunV2;
    consumedInstanceIds: readonly string[];
    outputInstanceId: string;
} | {
    ok: false;
    run: CampaignRunV2;
    code: "invalid_request" | "recipe_not_found" | "artifact_not_owned" | "pattern_mismatch" | "duplicate_instance";
}>;
export declare class ArsenalProfileValidationError extends Error {
}
export declare function normalizeArsenalProfileV1(value: unknown): ArsenalProfileV1;
export declare function compileArsenalBlueprintV1(profile: ArsenalProfileV1, towerTypeId: string, loadout?: ArsenalModuleLoadoutV1): CompiledArsenalTowerV1;
export declare function craftCampaignGemV1(run: CampaignRunV2, profile: ArsenalProfileV1, request: CraftCampaignGemRequestV1): CraftCampaignGemResultV1;
export declare function resolveActiveArsenalMechanics(content: GameContentRegistry, missionId: string): ActiveArsenalMechanicsV1 | undefined;
