import { GridMap, type GridMapDefinition } from "../simulation/map.js";
import type { TowerScriptDefinition } from "../scripting/types.js";
import { type CapabilitySet, type MechanicsCatalog, type MissionMechanicsSelection } from "./mechanics.js";
import type { CurrencyDefinition, DifficultyDefinition, EnemyType, MetaProgressionDefinition, MissionAbilityDefinition, MissionAbilityId, MissionDefinition, MissionEconomyDefinition, MissionObjectivesDefinition, MissionSunlightDefinition, ResourceBag, TerrainTypeDefinition, TowerType, WaveDefinition } from "../simulation/types.js";
export declare const DEFAULT_CURRENCIES: CurrencyDefinition[];
export interface WorldRegionDefinition {
    id: string;
    label: string;
    description: string;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    accent: string;
    biome: string;
    connections: string[];
}
export interface WorldMissionNode {
    missionId: string;
    regionId: string;
    x: number;
    y: number;
    difficulty: 1 | 2 | 3 | 4 | 5;
    unlockRequiresMissionIds: string[];
}
export type WorldCampaignNodeType = "battle" | "elite" | "merchant" | "event" | "boss";
export interface WorldCampaignNodeBaseV1 {
    readonly id: string;
    readonly type: WorldCampaignNodeType;
    readonly regionId: string;
    readonly x: number;
    readonly y: number;
    readonly difficulty: 1 | 2 | 3 | 4 | 5;
    readonly nextNodeIds: readonly string[];
}
export interface WorldCampaignBattleNodeV1 extends WorldCampaignNodeBaseV1 {
    readonly type: "battle" | "elite" | "boss";
    readonly missionId: string;
}
export interface WorldCampaignStructuralNodeV1 extends WorldCampaignNodeBaseV1 {
    readonly type: "merchant" | "event";
    readonly label: string;
}
export type WorldCampaignNodeV1 = WorldCampaignBattleNodeV1 | WorldCampaignStructuralNodeV1;
/** Optional authored graph. Its absence preserves the legacy mission-node campaign unchanged. */
export interface WorldCampaignDefinitionV1 {
    readonly schemaVersion: 1;
    readonly rogueliteProfileId: string;
    readonly entryNodeIds: readonly string[];
    readonly nodes: readonly WorldCampaignNodeV1[];
}
export interface WorldCampaignRunResourceDefinitionV2 {
    readonly label: string;
}
export interface WorldCampaignStructuralChoiceV2 {
    readonly id: string;
    readonly label: string;
    readonly costs: Readonly<Record<string, number>>;
    readonly grants: Readonly<Record<string, number>>;
}
export interface WorldCampaignStructuralNodeV2 extends WorldCampaignNodeBaseV1 {
    readonly type: "merchant" | "event";
    readonly label: string;
    readonly choices: readonly WorldCampaignStructuralChoiceV2[];
}
export type WorldCampaignNodeV2 = WorldCampaignBattleNodeV1 | WorldCampaignStructuralNodeV2;
/** Version 2 adds declared run resources and atomic merchant/event choices. */
export interface WorldCampaignDefinitionV2 {
    readonly schemaVersion: 2;
    readonly rogueliteProfileId: string;
    readonly runResources: Readonly<Record<string, WorldCampaignRunResourceDefinitionV2>>;
    readonly entryNodeIds: readonly string[];
    readonly nodes: readonly WorldCampaignNodeV2[];
}
export type WorldCampaignDefinition = WorldCampaignDefinitionV1 | WorldCampaignDefinitionV2;
export interface WorldMapCatalog {
    width: number;
    height: number;
    regions: WorldRegionDefinition[];
    missionNodes: WorldMissionNode[];
    campaign?: WorldCampaignDefinition;
}
export interface GameBalanceConstants {
    timeUnitSeconds: number;
    startingCoreHp: number;
    startingCoins: number;
    startingResources: ResourceBag;
    prepTimeUnits: number;
    moveTowerCost: ResourceBag;
    waterGroundSpeedFactor: number;
    pathWaterCooldownUnits: number;
    pathWaterDurationUnits: number;
    pathWaterRadius: number;
    pathWaterGroundSpeedFactor: number;
}
export interface MissionDataDefinition {
    id: string;
    label: string;
    description: string;
    availability?: "playable" | "comingSoon";
    countsTowardProgress?: boolean;
    startingCoreHp: number;
    startingResources: ResourceBag;
    prepTimeUnits: number;
    mapId: string;
    waveSetId: string;
    buildTowerIds: string[];
    abilityIds?: MissionAbilityId[];
    economy?: MissionEconomyDefinition;
    objectives?: MissionObjectivesDefinition;
    sunlight?: MissionSunlightDefinition;
    mechanics?: MissionMechanicsSelection;
}
export interface MissionContentDefinition extends MissionDefinition {
    mapId: string;
    waveSetId: string;
    buildTowerIds: string[];
    abilityIds: MissionAbilityId[];
    mapFactory: () => GridMap;
    mechanics?: MissionMechanicsSelection;
    readonly capabilities: CapabilitySet;
}
export interface GameBalanceData {
    constants: GameBalanceConstants;
    currencies?: CurrencyDefinition[];
    defaultDifficultyId?: string;
    difficulties?: DifficultyDefinition[];
    metaProgression?: MetaProgressionDefinition;
    terrainTypes?: Record<string, Partial<TerrainTypeDefinition>>;
    defaultMissionId: string;
    abilities: Partial<Record<MissionAbilityId, MissionAbilityDefinition>>;
    enemies: Record<string, EnemyType>;
    towers: Record<string, TowerType>;
    waveSets: Record<string, WaveDefinition[]>;
    missions: Record<string, MissionDataDefinition>;
}
export interface StoryComicPanel {
    text: string;
    speaker?: string;
    spriteId?: string;
}
export interface StoryComicDefinition {
    id?: string;
    missionId: string;
    title?: string;
    trigger?: "beforeMission" | "afterVictory";
    replay?: "once" | "always";
    panels: StoryComicPanel[];
}
export interface BattleBackgroundDefinition {
    missionId?: string;
    color?: string;
    spriteId?: string;
    opacity?: number;
}
export interface GameContentRegistry {
    constants: GameBalanceConstants;
    currencies: CurrencyDefinition[];
    defaultDifficultyId: string;
    difficulties: DifficultyDefinition[];
    metaProgression: MetaProgressionDefinition;
    terrainTypes: Record<string, TerrainTypeDefinition>;
    defaultMissionId: string;
    abilities: Partial<Record<MissionAbilityId, MissionAbilityDefinition>>;
    enemies: Record<string, EnemyType>;
    towers: Record<string, TowerType>;
    waveSets: Record<string, WaveDefinition[]>;
    missions: Record<string, MissionContentDefinition>;
    maps: Record<string, GridMapDefinition>;
    scripts: Record<string, TowerScriptDefinition>;
    mechanics: MechanicsCatalog;
    worldMap: WorldMapCatalog;
    visuals: unknown;
    storyComics: Record<string, StoryComicDefinition>;
    storySeenStoragePrefix: string;
    battleBackgrounds: Record<string, BattleBackgroundDefinition>;
    battleBackgroundPlaceholderMissionIds: readonly string[];
    battleBackgroundFallbackMissionId: string;
}
export interface GameContentInput {
    balance: GameBalanceData;
    maps: Record<string, GridMapDefinition>;
    worldMap: WorldMapCatalog;
    scripts?: Record<string, TowerScriptDefinition>;
    mechanics?: MechanicsCatalog;
    visuals?: unknown;
    storyComics?: {
        seenStoragePrefix: string;
        comics: Record<string, StoryComicDefinition>;
    };
    battleBackgrounds?: {
        fallbackMissionId: string;
        placeholderMissionIds: string[];
        definitions: Record<string, BattleBackgroundDefinition>;
    };
}
export declare function createGameContentRegistry(options: GameContentInput): GameContentRegistry;
