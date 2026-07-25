import type { GameContentRegistry } from "../content/registry.js";
export declare const PLAYER_PROFILE_SCHEMA_VERSION: 2;
export declare const PLAYER_PROFILE_LIMITS: Readonly<{
    jsonBytes: number;
    collectionEntries: 10000;
    warnings: 1000;
}>;
export interface PlayerProfileV2 {
    readonly version: typeof PLAYER_PROFILE_SCHEMA_VERSION;
    readonly clearedMissionIds: readonly string[];
    readonly starsByMission: Readonly<Record<string, number>>;
    readonly metaResources: Readonly<Record<string, number>>;
    readonly upgradeLevels: Readonly<Record<string, number>>;
    readonly selectedDifficultyId: string;
}
export interface PlayerProfileMigration {
    readonly id: string;
    readonly description: string;
}
export interface PlayerProfileWarning {
    readonly code: string;
    readonly path: string;
    readonly message: string;
}
export type PlayerProfileSource = "v2" | "legacy-array" | "legacy-object";
export interface DecodedPlayerProfile {
    readonly profile: PlayerProfileV2;
    readonly source: PlayerProfileSource;
    readonly migrations: readonly PlayerProfileMigration[];
    readonly warnings: readonly PlayerProfileWarning[];
}
export interface PlayerProfileLaunchOptions {
    readonly difficultyId: string;
    readonly metaUpgradeLevels: Record<string, number>;
}
export type PlayerProfileFailureCode = "unknown_difficulty" | "unknown_upgrade" | "upgrade_max_level" | "insufficient_meta_resources" | "invalid_upgrade_cost" | "unknown_mission" | "invalid_earned_stars" | "invalid_mission_reward";
export interface PlayerProfileFailure {
    readonly ok: false;
    readonly code: PlayerProfileFailureCode;
    readonly profile: PlayerProfileV2;
}
export type PlayerDifficultySelectionResult = PlayerProfileFailure | {
    readonly ok: true;
    readonly code: "difficulty_selected" | "difficulty_unchanged";
    readonly profile: PlayerProfileV2;
};
export type PlayerMetaUpgradePurchaseResult = PlayerProfileFailure | {
    readonly ok: true;
    readonly code: "upgrade_purchased";
    readonly profile: PlayerProfileV2;
    readonly upgradeId: string;
    readonly previousLevel: number;
    readonly newLevel: number;
};
export type PlayerMissionClearResult = (PlayerProfileFailure & {
    readonly grantedResources?: never;
    readonly newlyUnlockedMissionIds?: never;
}) | {
    readonly ok: true;
    readonly code: "mission_clear_recorded";
    readonly profile: PlayerProfileV2;
    readonly missionId: string;
    readonly firstClear: boolean;
    readonly previousStars: number;
    /** Stars achieved by this clear; the profile keeps the greater historical best. */
    readonly earnedStars: number;
    readonly grantedResources: Readonly<Record<string, number>>;
    readonly newlyUnlockedMissionIds: readonly string[];
};
export declare class UnsupportedPlayerProfileVersionError extends Error {
    readonly code: "UNSUPPORTED_PLAYER_PROFILE_VERSION";
    readonly version: number;
    constructor(version: number);
}
export declare function createEmptyPlayerProfile(content: GameContentRegistry): PlayerProfileV2;
export declare function decodePlayerProfile(value: unknown, content: GameContentRegistry): DecodedPlayerProfile;
export declare function parsePlayerProfileJson(source: string, content: GameContentRegistry): DecodedPlayerProfile;
export declare function serializePlayerProfile(profile: PlayerProfileV2): string;
export declare function getPlayerProfileLaunchOptions(profile: PlayerProfileV2): PlayerProfileLaunchOptions;
export declare function selectPlayerDifficulty(profile: PlayerProfileV2, content: GameContentRegistry, difficultyId: string): PlayerDifficultySelectionResult;
export declare function purchasePlayerMetaUpgrade(profile: PlayerProfileV2, content: GameContentRegistry, upgradeId: string): PlayerMetaUpgradePurchaseResult;
export declare function isPlayerMissionUnlocked(profile: PlayerProfileV2, content: GameContentRegistry, missionId: string): boolean;
export declare function newlyUnlockedPlayerMissionIds(profile: PlayerProfileV2, content: GameContentRegistry, clearedMissionId: string): readonly string[];
export declare function recordPlayerMissionClear(profile: PlayerProfileV2, content: GameContentRegistry, missionId: string, earnedStars: number): PlayerMissionClearResult;
