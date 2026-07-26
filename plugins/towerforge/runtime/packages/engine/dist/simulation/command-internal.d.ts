import type { TowerScriptJson } from "../scripting/types.js";
import type { TowerDefenseGame } from "./TowerDefenseGame.js";
import { type ActionResult, type GridCoord, type MissionAbilityId, type TowerTargetMode } from "./types.js";
export declare const GAME_COMMAND_SCHEMA_VERSION: 2;
export declare const GAME_COMMAND_SUPPORTED_SCHEMA_VERSIONS: readonly [1, 2];
export type GameCommandV1 = {
    readonly schemaVersion: 1;
    readonly type: "tick";
    readonly units: number;
} | {
    readonly schemaVersion: 1;
    readonly type: "startWave";
} | {
    readonly schemaVersion: 1;
    readonly type: "placeTower";
    readonly towerTypeId: string;
    readonly coord: Readonly<GridCoord>;
} | {
    readonly schemaVersion: 1;
    readonly type: "moveTower";
    readonly towerId: string;
    readonly coord: Readonly<GridCoord>;
} | {
    readonly schemaVersion: 1;
    readonly type: "sellTower";
    readonly towerId: string;
} | {
    readonly schemaVersion: 1;
    readonly type: "upgradeTower";
    readonly towerId: string;
} | {
    readonly schemaVersion: 1;
    readonly type: "setTargetMode";
    readonly towerId: string;
    readonly mode: TowerTargetMode;
} | {
    readonly schemaVersion: 1;
    readonly type: "useAbility";
    readonly abilityId: MissionAbilityId;
    readonly center: Readonly<GridCoord>;
} | {
    readonly schemaVersion: 1;
    readonly type: "emitSignal";
    readonly signal: string;
    readonly payload?: TowerScriptJson;
};
export type GameCommandV2 = {
    readonly schemaVersion: 2;
    readonly type: "tick";
    readonly units: number;
} | {
    readonly schemaVersion: 2;
    readonly type: "startWave";
} | {
    readonly schemaVersion: 2;
    readonly type: "placeTower";
    readonly towerTypeId: string;
    readonly coord: Readonly<GridCoord>;
} | {
    readonly schemaVersion: 2;
    readonly type: "moveTower";
    readonly towerId: string;
    readonly coord: Readonly<GridCoord>;
} | {
    readonly schemaVersion: 2;
    readonly type: "sellTower";
    readonly towerId: string;
} | {
    readonly schemaVersion: 2;
    readonly type: "upgradeTower";
    readonly towerId: string;
} | {
    readonly schemaVersion: 2;
    readonly type: "setTargetMode";
    readonly towerId: string;
    readonly mode: TowerTargetMode;
} | {
    readonly schemaVersion: 2;
    readonly type: "useAbility";
    readonly abilityId: MissionAbilityId;
    readonly center: Readonly<GridCoord>;
} | {
    readonly schemaVersion: 2;
    readonly type: "emitSignal";
    readonly signal: string;
    readonly payload?: TowerScriptJson;
} | {
    readonly schemaVersion: 2;
    readonly type: "socketArtifact";
    readonly artifactInstanceId: string;
    readonly towerId: string;
    readonly slotId: string;
} | {
    readonly schemaVersion: 2;
    readonly type: "unsocketArtifact";
    readonly artifactInstanceId: string;
    readonly towerId: string;
    readonly slotId: string;
};
export type GameCommand = GameCommandV1 | GameCommandV2;
export declare function invalidGameCommandResult(): ActionResult;
/**
 * Strict descriptor-safe parser shared by direct dispatch and command journals.
 * The returned command is a detached canonical data object.
 */
export declare function parseGameCommand(input: unknown): GameCommand | undefined;
/** Execute a command that has already passed the strict parser exactly once. */
export declare function executeParsedGameCommand(game: TowerDefenseGame, command: GameCommand): ActionResult;
