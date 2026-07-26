import type { GameContentRegistry } from "./registry.js";
import { type MovementProfileV1 } from "./navigation-mechanics.js";
import type { ModifierOperation, ModifierTarget } from "../simulation/modifiers.js";
/** Closed structural budgets for the first opt-in hero roster schema. */
export declare const HEROES_LIMITS: Readonly<{
    definitions: 32;
    idUtf8Bytes: 128;
    labelUtf8Bytes: 128;
}>;
/** Closed budgets for the independently optional v5 hero skill-tree extension. */
export declare const HERO_SKILL_TREE_LIMITS: Readonly<{
    descriptionUtf8Bytes: 512;
    nodes: 32;
    prerequisitesPerNode: 8;
    effectsPerNode: 4;
    effectsPerTree: 32;
    points: 65536;
}>;
/** Closed budgets for the independently optional v6 passive tower-damage aura. */
export declare const HERO_PASSIVE_AURA_LIMITS: Readonly<{
    radius: 65536;
    effectsPerAura: 4;
    flatAbsoluteValue: 1000000000000;
    additiveRatioMinimum: -1;
    additiveRatioMaximum: 1000;
    multiplierMinimum: 0;
    multiplierMaximum: 1000;
}>;
/** Closed budgets for the independently optional v7 dynamic-enemy hold. */
export declare const HERO_BLOCKING_LIMITS: Readonly<{
    blockCapacity: 64;
    movementProfileIds: 32;
}>;
export interface HeroUnitDefinitionV1 {
    readonly label: string;
    readonly spawn: "core";
}
export interface HeroesProfileV1 {
    readonly selectedHeroId: string;
    readonly definitions: Readonly<Record<string, HeroUnitDefinitionV1>>;
}
export interface ActiveHeroesMechanicsV1 extends HeroesProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export interface HeroMovementDefinitionV2 {
    readonly movementProfileId: string;
    readonly speed: number;
}
export interface HeroUnitDefinitionV2 {
    readonly label: string;
    readonly spawn: "core";
    readonly movement: HeroMovementDefinitionV2;
}
export interface HeroesProfileV2 {
    readonly selectedHeroId: string;
    readonly definitions: Readonly<Record<string, HeroUnitDefinitionV2>>;
    readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
}
export interface ActiveHeroesMechanicsV2 extends HeroesProfileV2 {
    readonly schemaVersion: 2;
    readonly profileId: string;
}
export interface HeroShieldDefinitionV3 {
    readonly capacity: number;
}
export interface HeroDurabilityDefinitionV3 {
    readonly maxHp: number;
    readonly shield: HeroShieldDefinitionV3 | null;
}
export interface HeroUnitDefinitionV3 extends HeroUnitDefinitionV2 {
    readonly durability: HeroDurabilityDefinitionV3;
}
export interface HeroesProfileV3 {
    readonly selectedHeroId: string;
    readonly definitions: Readonly<Record<string, HeroUnitDefinitionV3>>;
    readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
}
export interface ActiveHeroesMechanicsV3 extends HeroesProfileV3 {
    readonly schemaVersion: 3;
    readonly profileId: string;
}
export interface HeroManaDefinitionV4 {
    readonly max: number;
    readonly starting: number;
    readonly regenerationPerUnit: number;
}
export interface HeroActiveAbilityDefinitionV4 {
    readonly id: string;
    readonly label: string;
    readonly target: "enemy";
    readonly manaCost: number;
    readonly cooldown: number;
    readonly range: number;
    readonly damage: number;
}
export interface HeroUnitDefinitionV4 extends HeroUnitDefinitionV3 {
    readonly mana: HeroManaDefinitionV4;
    readonly activeAbility: HeroActiveAbilityDefinitionV4;
}
export interface HeroesProfileV4 {
    readonly selectedHeroId: string;
    readonly definitions: Readonly<Record<string, HeroUnitDefinitionV4>>;
    readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
}
export interface ActiveHeroesMechanicsV4 extends HeroesProfileV4 {
    readonly schemaVersion: 4;
    readonly profileId: string;
}
export interface HeroSkillPointsDefinitionV5 {
    readonly starting: number;
    readonly perInterwave: number;
}
export interface HeroSkillModifierEffectV5 {
    readonly kind: "modifier";
    readonly scope: "hero_ability_damage";
    readonly modifier: {
        readonly target: ModifierTarget;
        readonly operation: ModifierOperation;
        readonly value: number;
    };
}
export interface HeroSkillNodeDefinitionV5 {
    readonly label: string;
    readonly description: string;
    readonly cost: number;
    readonly requires: readonly string[];
    readonly effects: readonly HeroSkillModifierEffectV5[];
}
export interface HeroSkillTreeDefinitionV5 {
    readonly points: HeroSkillPointsDefinitionV5;
    readonly nodes: Readonly<Record<string, HeroSkillNodeDefinitionV5>>;
}
export interface HeroUnitDefinitionV5 extends HeroUnitDefinitionV4 {
    readonly skillTree: HeroSkillTreeDefinitionV5 | null;
}
export interface HeroesProfileV5 {
    readonly selectedHeroId: string;
    readonly definitions: Readonly<Record<string, HeroUnitDefinitionV5>>;
    readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
}
export interface ActiveHeroesMechanicsV5 extends HeroesProfileV5 {
    readonly schemaVersion: 5;
    readonly profileId: string;
}
export interface HeroPassiveAuraModifierEffectV6 {
    readonly kind: "modifier";
    readonly scope: "tower_damage";
    readonly modifier: {
        readonly target: "damage";
        readonly operation: ModifierOperation;
        readonly value: number;
    };
}
export interface HeroPassiveAuraDefinitionV6 {
    readonly id: string;
    readonly label: string;
    readonly radius: number;
    readonly effects: readonly HeroPassiveAuraModifierEffectV6[];
}
export interface HeroUnitDefinitionV6 extends HeroUnitDefinitionV5 {
    readonly passiveAura: HeroPassiveAuraDefinitionV6 | null;
}
export interface HeroesProfileV6 {
    readonly selectedHeroId: string;
    readonly definitions: Readonly<Record<string, HeroUnitDefinitionV6>>;
    readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
}
export interface ActiveHeroesMechanicsV6 extends HeroesProfileV6 {
    readonly schemaVersion: 6;
    readonly profileId: string;
}
export interface HeroBlockingDefinitionV7 {
    readonly blockCapacity: number;
    readonly movementProfileIds: readonly string[];
}
export interface HeroUnitDefinitionV7 extends HeroUnitDefinitionV6 {
    readonly blocking: HeroBlockingDefinitionV7 | null;
}
export interface HeroesProfileV7 {
    readonly selectedHeroId: string;
    readonly definitions: Readonly<Record<string, HeroUnitDefinitionV7>>;
    readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
}
export interface ActiveHeroesMechanicsV7 extends HeroesProfileV7 {
    readonly schemaVersion: 7;
    readonly profileId: string;
}
export type ActiveHeroesMechanics = ActiveHeroesMechanicsV1 | ActiveHeroesMechanicsV2 | ActiveHeroesMechanicsV3 | ActiveHeroesMechanicsV4 | ActiveHeroesMechanicsV5 | ActiveHeroesMechanicsV6 | ActiveHeroesMechanicsV7;
/** Capability-aware authoring descriptor shared by Studio and MCP. */
export declare const HEROES_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 7;
    moduleId: "heroes";
    supportedModuleSchemaVersions: readonly [1, 2, 3, 4, 5, 6, 7];
    profile: Readonly<{
        requiredFields: readonly ["selectedHeroId", "definitions"];
        optionalFields: readonly [];
        additionalProperties: false;
    }>;
    definition: Readonly<{
        requiredFields: readonly ["label", "spawn"];
        optionalFields: readonly [];
        additionalProperties: false;
        spawnValues: readonly ["core"];
    }>;
    versions: Readonly<{
        1: Readonly<{
            profile: Readonly<{
                requiredFields: readonly ["selectedHeroId", "definitions"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            definition: Readonly<{
                requiredFields: readonly ["label", "spawn"];
                optionalFields: readonly [];
                additionalProperties: false;
                spawnValues: readonly ["core"];
            }>;
        }>;
        2: Readonly<{
            profile: Readonly<{
                requiredFields: readonly ["selectedHeroId", "definitions", "movementProfiles"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            definition: Readonly<{
                requiredFields: readonly ["label", "spawn", "movement"];
                optionalFields: readonly [];
                additionalProperties: false;
                spawnValues: readonly ["core"];
            }>;
            movement: Readonly<{
                requiredFields: readonly ["movementProfileId", "speed"];
                optionalFields: readonly [];
                additionalProperties: false;
                speed: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 20;
                }>;
            }>;
            movementProfile: Readonly<{
                requiredFields: readonly ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"];
                optionalFields: readonly ["terrainCosts"];
                additionalProperties: false;
                label: Readonly<{
                    minLength: 1;
                    maxLength: 128;
                }>;
                terrainModeValues: readonly ["respect_walkable", "ignore_walkable"];
                towerOccupancyValues: readonly ["blocked", "ignored"];
                defaultTerrainCost: Readonly<{
                    integer: true;
                    minimum: 1;
                    maximum: 1000000;
                    nullable: true;
                }>;
                terrainCosts: Readonly<{
                    maximumEntries: 256;
                    values: Readonly<{
                        integer: true;
                        minimum: 1;
                        maximum: 1000000;
                        nullable: true;
                    }>;
                }>;
            }>;
        }>;
        3: Readonly<{
            profile: Readonly<{
                requiredFields: readonly ["selectedHeroId", "definitions", "movementProfiles"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            definition: Readonly<{
                requiredFields: readonly ["label", "spawn", "movement", "durability"];
                optionalFields: readonly [];
                additionalProperties: false;
                spawnValues: readonly ["core"];
            }>;
            movement: Readonly<{
                requiredFields: readonly ["movementProfileId", "speed"];
                optionalFields: readonly [];
                additionalProperties: false;
                speed: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 20;
                }>;
            }>;
            movementProfile: Readonly<{
                requiredFields: readonly ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"];
                optionalFields: readonly ["terrainCosts"];
                additionalProperties: false;
                label: Readonly<{
                    minLength: 1;
                    maxLength: 128;
                }>;
                terrainModeValues: readonly ["respect_walkable", "ignore_walkable"];
                towerOccupancyValues: readonly ["blocked", "ignored"];
                defaultTerrainCost: Readonly<{
                    integer: true;
                    minimum: 1;
                    maximum: 1000000;
                    nullable: true;
                }>;
                terrainCosts: Readonly<{
                    maximumEntries: 256;
                    values: Readonly<{
                        integer: true;
                        minimum: 1;
                        maximum: 1000000;
                        nullable: true;
                    }>;
                }>;
            }>;
            durability: Readonly<{
                requiredFields: readonly ["maxHp", "shield"];
                optionalFields: readonly [];
                additionalProperties: false;
                maxHp: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            shield: Readonly<{
                nullable: true;
                requiredFields: readonly ["capacity"];
                optionalFields: readonly [];
                additionalProperties: false;
                capacity: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
        }>;
        4: Readonly<{
            profile: Readonly<{
                requiredFields: readonly ["selectedHeroId", "definitions", "movementProfiles"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            definition: Readonly<{
                requiredFields: readonly ["label", "spawn", "movement", "durability", "mana", "activeAbility"];
                optionalFields: readonly [];
                additionalProperties: false;
                spawnValues: readonly ["core"];
            }>;
            movement: Readonly<{
                requiredFields: readonly ["movementProfileId", "speed"];
                optionalFields: readonly [];
                additionalProperties: false;
                speed: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 20;
                }>;
            }>;
            movementProfile: Readonly<{
                requiredFields: readonly ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"];
                optionalFields: readonly ["terrainCosts"];
                additionalProperties: false;
                label: Readonly<{
                    minLength: 1;
                    maxLength: 128;
                }>;
                terrainModeValues: readonly ["respect_walkable", "ignore_walkable"];
                towerOccupancyValues: readonly ["blocked", "ignored"];
                defaultTerrainCost: Readonly<{
                    integer: true;
                    minimum: 1;
                    maximum: 1000000;
                    nullable: true;
                }>;
                terrainCosts: Readonly<{
                    maximumEntries: 256;
                    values: Readonly<{
                        integer: true;
                        minimum: 1;
                        maximum: 1000000;
                        nullable: true;
                    }>;
                }>;
            }>;
            durability: Readonly<{
                requiredFields: readonly ["maxHp", "shield"];
                optionalFields: readonly [];
                additionalProperties: false;
                maxHp: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            shield: Readonly<{
                nullable: true;
                requiredFields: readonly ["capacity"];
                optionalFields: readonly [];
                additionalProperties: false;
                capacity: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            mana: Readonly<{
                requiredFields: readonly ["max", "starting", "regenerationPerUnit"];
                optionalFields: readonly [];
                additionalProperties: false;
                max: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
                starting: Readonly<{
                    minimum: 0;
                    maximumFrom: "mana.max";
                }>;
                regenerationPerUnit: Readonly<{
                    minimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            activeAbility: Readonly<{
                requiredFields: readonly ["id", "label", "target", "manaCost", "cooldown", "range", "damage"];
                optionalFields: readonly [];
                additionalProperties: false;
                targetValues: readonly ["enemy"];
                manaCost: Readonly<{
                    exclusiveMinimum: 0;
                    maximumFrom: "mana.max";
                }>;
                cooldown: Readonly<{
                    minimum: 0;
                    maximum: 86400;
                }>;
                range: Readonly<{
                    integer: true;
                    minimum: 0;
                    maximum: 65536;
                }>;
                damage: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
        }>;
        5: Readonly<{
            profile: Readonly<{
                requiredFields: readonly ["selectedHeroId", "definitions", "movementProfiles"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            definition: Readonly<{
                requiredFields: readonly ["label", "spawn", "movement", "durability", "mana", "activeAbility", "skillTree"];
                optionalFields: readonly [];
                additionalProperties: false;
                spawnValues: readonly ["core"];
            }>;
            movement: Readonly<{
                requiredFields: readonly ["movementProfileId", "speed"];
                optionalFields: readonly [];
                additionalProperties: false;
                speed: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 20;
                }>;
            }>;
            movementProfile: Readonly<{
                requiredFields: readonly ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"];
                optionalFields: readonly ["terrainCosts"];
                additionalProperties: false;
                label: Readonly<{
                    minLength: 1;
                    maxLength: 128;
                }>;
                terrainModeValues: readonly ["respect_walkable", "ignore_walkable"];
                towerOccupancyValues: readonly ["blocked", "ignored"];
                defaultTerrainCost: Readonly<{
                    integer: true;
                    minimum: 1;
                    maximum: 1000000;
                    nullable: true;
                }>;
                terrainCosts: Readonly<{
                    maximumEntries: 256;
                    values: Readonly<{
                        integer: true;
                        minimum: 1;
                        maximum: 1000000;
                        nullable: true;
                    }>;
                }>;
            }>;
            durability: Readonly<{
                requiredFields: readonly ["maxHp", "shield"];
                optionalFields: readonly [];
                additionalProperties: false;
                maxHp: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            shield: Readonly<{
                nullable: true;
                requiredFields: readonly ["capacity"];
                optionalFields: readonly [];
                additionalProperties: false;
                capacity: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            mana: Readonly<{
                requiredFields: readonly ["max", "starting", "regenerationPerUnit"];
                optionalFields: readonly [];
                additionalProperties: false;
                max: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
                starting: Readonly<{
                    minimum: 0;
                    maximumFrom: "mana.max";
                }>;
                regenerationPerUnit: Readonly<{
                    minimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            activeAbility: Readonly<{
                requiredFields: readonly ["id", "label", "target", "manaCost", "cooldown", "range", "damage"];
                optionalFields: readonly [];
                additionalProperties: false;
                targetValues: readonly ["enemy"];
                manaCost: Readonly<{
                    exclusiveMinimum: 0;
                    maximumFrom: "mana.max";
                }>;
                cooldown: Readonly<{
                    minimum: 0;
                    maximum: 86400;
                }>;
                range: Readonly<{
                    integer: true;
                    minimum: 0;
                    maximum: 65536;
                }>;
                damage: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            skillTree: Readonly<{
                nullable: true;
                requiredFields: readonly ["points", "nodes"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            skillPoints: Readonly<{
                requiredFields: readonly ["starting", "perInterwave"];
                optionalFields: readonly [];
                additionalProperties: false;
                starting: Readonly<{
                    integer: true;
                    minimum: 0;
                    maximum: 65536;
                }>;
                perInterwave: Readonly<{
                    integer: true;
                    minimum: 0;
                    maximum: 65536;
                }>;
            }>;
            skillNode: Readonly<{
                requiredFields: readonly ["label", "description", "cost", "requires", "effects"];
                optionalFields: readonly [];
                additionalProperties: false;
                cost: Readonly<{
                    integer: true;
                    minimum: 1;
                    maximum: 65536;
                }>;
            }>;
            skillEffect: Readonly<{
                requiredFields: readonly ["kind", "scope", "modifier"];
                optionalFields: readonly [];
                additionalProperties: false;
                kindValues: readonly ["modifier"];
                scopeValues: readonly ["hero_ability_damage"];
            }>;
            skillModifier: Readonly<{
                requiredFields: readonly ["target", "operation", "value"];
                optionalFields: readonly [];
                additionalProperties: false;
                targetValues: readonly ["damage"];
                operationValues: readonly ["flat", "additive_ratio", "multiplier"];
            }>;
        }>;
        6: Readonly<{
            profile: Readonly<{
                requiredFields: readonly ["selectedHeroId", "definitions", "movementProfiles"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            definition: Readonly<{
                requiredFields: readonly ["label", "spawn", "movement", "durability", "mana", "activeAbility", "skillTree", "passiveAura"];
                optionalFields: readonly [];
                additionalProperties: false;
                spawnValues: readonly ["core"];
            }>;
            movement: Readonly<{
                requiredFields: readonly ["movementProfileId", "speed"];
                optionalFields: readonly [];
                additionalProperties: false;
                speed: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 20;
                }>;
            }>;
            movementProfile: Readonly<{
                requiredFields: readonly ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"];
                optionalFields: readonly ["terrainCosts"];
                additionalProperties: false;
                label: Readonly<{
                    minLength: 1;
                    maxLength: 128;
                }>;
                terrainModeValues: readonly ["respect_walkable", "ignore_walkable"];
                towerOccupancyValues: readonly ["blocked", "ignored"];
                defaultTerrainCost: Readonly<{
                    integer: true;
                    minimum: 1;
                    maximum: 1000000;
                    nullable: true;
                }>;
                terrainCosts: Readonly<{
                    maximumEntries: 256;
                    values: Readonly<{
                        integer: true;
                        minimum: 1;
                        maximum: 1000000;
                        nullable: true;
                    }>;
                }>;
            }>;
            durability: Readonly<{
                requiredFields: readonly ["maxHp", "shield"];
                optionalFields: readonly [];
                additionalProperties: false;
                maxHp: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            shield: Readonly<{
                nullable: true;
                requiredFields: readonly ["capacity"];
                optionalFields: readonly [];
                additionalProperties: false;
                capacity: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            mana: Readonly<{
                requiredFields: readonly ["max", "starting", "regenerationPerUnit"];
                optionalFields: readonly [];
                additionalProperties: false;
                max: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
                starting: Readonly<{
                    minimum: 0;
                    maximumFrom: "mana.max";
                }>;
                regenerationPerUnit: Readonly<{
                    minimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            activeAbility: Readonly<{
                requiredFields: readonly ["id", "label", "target", "manaCost", "cooldown", "range", "damage"];
                optionalFields: readonly [];
                additionalProperties: false;
                targetValues: readonly ["enemy"];
                manaCost: Readonly<{
                    exclusiveMinimum: 0;
                    maximumFrom: "mana.max";
                }>;
                cooldown: Readonly<{
                    minimum: 0;
                    maximum: 86400;
                }>;
                range: Readonly<{
                    integer: true;
                    minimum: 0;
                    maximum: 65536;
                }>;
                damage: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            skillTree: Readonly<{
                nullable: true;
                requiredFields: readonly ["points", "nodes"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            skillPoints: Readonly<{
                requiredFields: readonly ["starting", "perInterwave"];
                optionalFields: readonly [];
                additionalProperties: false;
                starting: Readonly<{
                    integer: true;
                    minimum: 0;
                    maximum: 65536;
                }>;
                perInterwave: Readonly<{
                    integer: true;
                    minimum: 0;
                    maximum: 65536;
                }>;
            }>;
            skillNode: Readonly<{
                requiredFields: readonly ["label", "description", "cost", "requires", "effects"];
                optionalFields: readonly [];
                additionalProperties: false;
                cost: Readonly<{
                    integer: true;
                    minimum: 1;
                    maximum: 65536;
                }>;
            }>;
            skillEffect: Readonly<{
                requiredFields: readonly ["kind", "scope", "modifier"];
                optionalFields: readonly [];
                additionalProperties: false;
                kindValues: readonly ["modifier"];
                scopeValues: readonly ["hero_ability_damage"];
            }>;
            skillModifier: Readonly<{
                requiredFields: readonly ["target", "operation", "value"];
                optionalFields: readonly [];
                additionalProperties: false;
                targetValues: readonly ["damage"];
                operationValues: readonly ["flat", "additive_ratio", "multiplier"];
            }>;
            passiveAura: Readonly<{
                nullable: true;
                requiredFields: readonly ["id", "label", "radius", "effects"];
                optionalFields: readonly [];
                additionalProperties: false;
                radius: Readonly<{
                    integer: true;
                    minimum: 0;
                    maximum: 65536;
                }>;
                effects: Readonly<{
                    minimumItems: 1;
                    maximumItems: 4;
                }>;
            }>;
            passiveAuraEffect: Readonly<{
                requiredFields: readonly ["kind", "scope", "modifier"];
                optionalFields: readonly [];
                additionalProperties: false;
                kindValues: readonly ["modifier"];
                scopeValues: readonly ["tower_damage"];
            }>;
            passiveAuraModifier: Readonly<{
                requiredFields: readonly ["target", "operation", "value"];
                optionalFields: readonly [];
                additionalProperties: false;
                targetValues: readonly ["damage"];
                operationValues: readonly ["flat", "additive_ratio", "multiplier"];
                valueByOperation: Readonly<{
                    flat: Readonly<{
                        minimum: number;
                        maximum: 1000000000000;
                    }>;
                    additive_ratio: Readonly<{
                        minimum: -1;
                        maximum: 1000;
                    }>;
                    multiplier: Readonly<{
                        minimum: 0;
                        maximum: 1000;
                    }>;
                }>;
            }>;
        }>;
        7: Readonly<{
            profile: Readonly<{
                requiredFields: readonly ["selectedHeroId", "definitions", "movementProfiles"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            definition: Readonly<{
                requiredFields: readonly ["label", "spawn", "movement", "durability", "mana", "activeAbility", "skillTree", "passiveAura", "blocking"];
                optionalFields: readonly [];
                additionalProperties: false;
                spawnValues: readonly ["core"];
            }>;
            movement: Readonly<{
                requiredFields: readonly ["movementProfileId", "speed"];
                optionalFields: readonly [];
                additionalProperties: false;
                speed: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 20;
                }>;
            }>;
            movementProfile: Readonly<{
                requiredFields: readonly ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"];
                optionalFields: readonly ["terrainCosts"];
                additionalProperties: false;
                label: Readonly<{
                    minLength: 1;
                    maxLength: 128;
                }>;
                terrainModeValues: readonly ["respect_walkable", "ignore_walkable"];
                towerOccupancyValues: readonly ["blocked", "ignored"];
                defaultTerrainCost: Readonly<{
                    integer: true;
                    minimum: 1;
                    maximum: 1000000;
                    nullable: true;
                }>;
                terrainCosts: Readonly<{
                    maximumEntries: 256;
                    values: Readonly<{
                        integer: true;
                        minimum: 1;
                        maximum: 1000000;
                        nullable: true;
                    }>;
                }>;
            }>;
            durability: Readonly<{
                requiredFields: readonly ["maxHp", "shield"];
                optionalFields: readonly [];
                additionalProperties: false;
                maxHp: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            shield: Readonly<{
                nullable: true;
                requiredFields: readonly ["capacity"];
                optionalFields: readonly [];
                additionalProperties: false;
                capacity: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            mana: Readonly<{
                requiredFields: readonly ["max", "starting", "regenerationPerUnit"];
                optionalFields: readonly [];
                additionalProperties: false;
                max: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
                starting: Readonly<{
                    minimum: 0;
                    maximumFrom: "mana.max";
                }>;
                regenerationPerUnit: Readonly<{
                    minimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            activeAbility: Readonly<{
                requiredFields: readonly ["id", "label", "target", "manaCost", "cooldown", "range", "damage"];
                optionalFields: readonly [];
                additionalProperties: false;
                targetValues: readonly ["enemy"];
                manaCost: Readonly<{
                    exclusiveMinimum: 0;
                    maximumFrom: "mana.max";
                }>;
                cooldown: Readonly<{
                    minimum: 0;
                    maximum: 86400;
                }>;
                range: Readonly<{
                    integer: true;
                    minimum: 0;
                    maximum: 65536;
                }>;
                damage: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 1000000000000;
                }>;
            }>;
            skillTree: Readonly<{
                nullable: true;
                requiredFields: readonly ["points", "nodes"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            skillPoints: Readonly<{
                requiredFields: readonly ["starting", "perInterwave"];
                optionalFields: readonly [];
                additionalProperties: false;
                starting: Readonly<{
                    integer: true;
                    minimum: 0;
                    maximum: 65536;
                }>;
                perInterwave: Readonly<{
                    integer: true;
                    minimum: 0;
                    maximum: 65536;
                }>;
            }>;
            skillNode: Readonly<{
                requiredFields: readonly ["label", "description", "cost", "requires", "effects"];
                optionalFields: readonly [];
                additionalProperties: false;
                cost: Readonly<{
                    integer: true;
                    minimum: 1;
                    maximum: 65536;
                }>;
            }>;
            skillEffect: Readonly<{
                requiredFields: readonly ["kind", "scope", "modifier"];
                optionalFields: readonly [];
                additionalProperties: false;
                kindValues: readonly ["modifier"];
                scopeValues: readonly ["hero_ability_damage"];
            }>;
            skillModifier: Readonly<{
                requiredFields: readonly ["target", "operation", "value"];
                optionalFields: readonly [];
                additionalProperties: false;
                targetValues: readonly ["damage"];
                operationValues: readonly ["flat", "additive_ratio", "multiplier"];
            }>;
            passiveAura: Readonly<{
                nullable: true;
                requiredFields: readonly ["id", "label", "radius", "effects"];
                optionalFields: readonly [];
                additionalProperties: false;
                radius: Readonly<{
                    integer: true;
                    minimum: 0;
                    maximum: 65536;
                }>;
                effects: Readonly<{
                    minimumItems: 1;
                    maximumItems: 4;
                }>;
            }>;
            passiveAuraEffect: Readonly<{
                requiredFields: readonly ["kind", "scope", "modifier"];
                optionalFields: readonly [];
                additionalProperties: false;
                kindValues: readonly ["modifier"];
                scopeValues: readonly ["tower_damage"];
            }>;
            passiveAuraModifier: Readonly<{
                requiredFields: readonly ["target", "operation", "value"];
                optionalFields: readonly [];
                additionalProperties: false;
                targetValues: readonly ["damage"];
                operationValues: readonly ["flat", "additive_ratio", "multiplier"];
                valueByOperation: Readonly<{
                    flat: Readonly<{
                        minimum: number;
                        maximum: 1000000000000;
                    }>;
                    additive_ratio: Readonly<{
                        minimum: -1;
                        maximum: 1000;
                    }>;
                    multiplier: Readonly<{
                        minimum: 0;
                        maximum: 1000;
                    }>;
                }>;
            }>;
            blocking: Readonly<{
                nullable: true;
                requiredFields: readonly ["blockCapacity", "movementProfileIds"];
                optionalFields: readonly [];
                additionalProperties: false;
                blockCapacity: Readonly<{
                    integer: true;
                    minimum: 1;
                    maximum: 64;
                }>;
                movementProfileIds: Readonly<{
                    minimumItems: 1;
                    maximumItems: 32;
                    uniqueItems: true;
                    itemUtf8Bytes: 128;
                }>;
            }>;
            limits: Readonly<{
                blockCapacity: Readonly<{
                    minimum: 1;
                    maximum: 64;
                }>;
                movementProfileIds: 32;
            }>;
        }>;
    }>;
    limits: Readonly<{
        definitions: 32;
        idUtf8Bytes: 128;
        labelUtf8Bytes: 128;
    }>;
    runtimeSnapshot: Readonly<{
        path: "snapshot.heroes";
        schemaVersions: readonly [1, 2, 3, 4, 5, 6, 7];
        optionalUnlessActive: true;
        versions: Readonly<{
            1: Readonly<{
                unitFields: readonly ["id", "definitionId", "label", "coord"];
            }>;
            2: Readonly<{
                unitFields: readonly ["id", "definitionId", "label", "coord", "movement"];
                movementFields: readonly ["targetCoord", "nextCoord", "edgeProgress"];
            }>;
            3: Readonly<{
                unitFields: readonly ["id", "definitionId", "label", "coord", "movement", "durability"];
                movementFields: readonly ["targetCoord", "nextCoord", "edgeProgress"];
                durabilityFields: readonly ["hp", "maxHp", "shield", "defeated"];
            }>;
            4: Readonly<{
                unitFields: readonly ["id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility"];
                movementFields: readonly ["targetCoord", "nextCoord", "edgeProgress"];
                durabilityFields: readonly ["hp", "maxHp", "shield", "defeated"];
                manaFields: readonly ["current", "max", "regenerationPerUnit"];
                activeAbilityFields: readonly ["id", "label", "target", "manaCost", "cooldown", "cooldownRemaining", "range", "damage", "ready"];
            }>;
            5: Readonly<{
                unitFields: readonly ["id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility", "skills"];
                movementFields: readonly ["targetCoord", "nextCoord", "edgeProgress"];
                durabilityFields: readonly ["hp", "maxHp", "shield", "defeated"];
                manaFields: readonly ["current", "max", "regenerationPerUnit"];
                activeAbilityFields: readonly ["id", "label", "target", "manaCost", "cooldown", "cooldownRemaining", "range", "damage", "ready"];
                skillsFields: readonly ["availablePoints", "startingPoints", "pointsPerInterwave", "maximumEarnablePoints", "managementAvailable", "nodes"];
            }>;
            6: Readonly<{
                unitFields: readonly ["id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility", "skills", "passiveAura"];
                movementFields: readonly ["targetCoord", "nextCoord", "edgeProgress"];
                durabilityFields: readonly ["hp", "maxHp", "shield", "defeated"];
                manaFields: readonly ["current", "max", "regenerationPerUnit"];
                activeAbilityFields: readonly ["id", "label", "target", "manaCost", "cooldown", "cooldownRemaining", "range", "damage", "ready"];
                skillsNullable: true;
                passiveAuraFields: readonly ["id", "label", "radius", "active", "affectedTowerIds"];
            }>;
            7: Readonly<{
                unitFields: readonly ["id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility", "skills", "passiveAura", "blocking"];
                movementFields: readonly ["targetCoord", "nextCoord", "edgeProgress"];
                durabilityFields: readonly ["hp", "maxHp", "shield", "defeated"];
                manaFields: readonly ["current", "max", "regenerationPerUnit"];
                activeAbilityFields: readonly ["id", "label", "target", "manaCost", "cooldown", "cooldownRemaining", "range", "damage", "ready"];
                skillsNullable: true;
                passiveAuraNullable: true;
                blockingFields: readonly ["blockCapacity", "active", "blockedEnemyIds"];
            }>;
        }>;
    }>;
}>;
export declare class HeroesProfileValidationError extends Error {
    readonly fieldPath: string;
    constructor(fieldPath: string, message: string);
}
/** Stable collision-safe runtime id for one authored skill modifier. */
export declare function heroSkillModifierIdV5(skillId: string, effectIndex: number): string;
/** Stable collision-safe runtime id for one selected hero aura modifier. */
export declare function heroPassiveAuraModifierIdV6(heroDefinitionId: string, auraId: string, effectIndex: number): string;
/** Normalize the closed structural shape. The selected-definition reference is semantic. */
export declare function normalizeHeroesProfileV1(input: unknown, root?: string): HeroesProfileV1;
/** Normalize the closed R5.1B movement-enabled profile without activating navigation. */
export declare function normalizeHeroesProfileV2(input: unknown, root?: string): HeroesProfileV2;
/** Normalize the closed R5.2A durability profile while retaining the v2 movement contract. */
export declare function normalizeHeroesProfileV3(input: unknown, root?: string): HeroesProfileV3;
/** Normalize the closed R5.3A single targeted active-ability profile. */
export declare function normalizeHeroesProfileV4(input: unknown, root?: string): HeroesProfileV4;
/** Normalize the closed nullable R5.4A battle-local skill-tree profile. */
export declare function normalizeHeroesProfileV5(input: unknown, root?: string): HeroesProfileV5;
/** Normalize the closed nullable R5.5A passive tower-damage aura profile. */
export declare function normalizeHeroesProfileV6(input: unknown, root?: string): HeroesProfileV6;
/** Normalize the closed nullable R5.6A dynamic-enemy blocking profile. */
export declare function normalizeHeroesProfileV7(input: unknown, root?: string): HeroesProfileV7;
/** Reserve only the modifiers of the selected, non-null active v6 aura. */
export declare function activeHeroAuraModifierReserve(content: GameContentRegistry, missionId: string): number;
export interface HeroSkillTreeSemanticIssueV5 {
    readonly fieldPath: string;
    readonly message: string;
}
/** Validate graph references and mission-dependent point budgets after structural normalization. */
export declare function validateHeroSkillTreeSemanticsV5(profile: HeroesProfileV5, root?: string, missionWaveCounts?: readonly number[]): readonly HeroSkillTreeSemanticIssueV5[];
/** Resolve a detached profile only when the mission genuinely selected a supported heroes version. */
export declare function resolveActiveHeroesMechanics(content: GameContentRegistry, missionId: string): ActiveHeroesMechanics | undefined;
