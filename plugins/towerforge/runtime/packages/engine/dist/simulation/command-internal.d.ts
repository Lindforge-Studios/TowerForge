import type { TowerScriptJson } from "../scripting/types.js";
import type { TowerDefenseGame } from "./TowerDefenseGame.js";
import { type ActionResult, type GridCoord, type MissionAbilityId, type TowerTargetMode } from "./types.js";
export declare const GAME_COMMAND_SCHEMA_VERSION: 1;
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
export type GameCommand = GameCommandV1;
export declare function invalidGameCommandResult(): ActionResult;
/**
 * Strict descriptor-safe parser shared by direct dispatch and command journals.
 * The returned command is a detached canonical data object.
 */
export declare function parseGameCommand(input: unknown): GameCommandV1 | undefined;
/** Execute a command that has already passed the strict parser exactly once. */
export declare function executeParsedGameCommand(game: TowerDefenseGame, command: GameCommandV1): ActionResult;
