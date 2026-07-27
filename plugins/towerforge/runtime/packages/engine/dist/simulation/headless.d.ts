import { type GameContentRegistry } from "../content/registry.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { ActionResult, GameSnapshot, HexCoord, MissionAbilityId, TowerTargetMode } from "./types.js";
import type { TowerScriptJson } from "../scripting/types.js";
/** @deprecated Use the versioned GameCommand public contract. */
export type SimulationAction = {
    type: "tick";
    units: number;
} | {
    type: "startWave";
} | {
    type: "placeTower";
    towerTypeId: string;
    coord: HexCoord;
} | {
    type: "moveTower";
    towerId: string;
    coord: HexCoord;
} | {
    type: "sellTower";
    towerId: string;
} | {
    type: "upgradeTower";
    towerId: string;
} | {
    type: "setTargetMode";
    towerId: string;
    mode: TowerTargetMode;
} | {
    type: "useAbility";
    abilityId: MissionAbilityId;
    center: HexCoord;
} | {
    type: "moveHero";
    heroId: string;
    target: HexCoord;
} | {
    type: "emitSignal";
    signal: string;
    payload?: TowerScriptJson;
};
export interface SimulationActionResult {
    action: SimulationAction;
    result: ActionResult;
    snapshot: GameSnapshot;
}
export interface HeadlessMissionRunOptions {
    content: GameContentRegistry;
    missionId: string;
    actions?: SimulationAction[];
    tickStep?: number;
}
export interface HeadlessMissionRunResult {
    game: TowerDefenseGame;
    snapshot: GameSnapshot;
    actionResults: SimulationActionResult[];
}
/** @deprecated Use dispatchGameCommand with a versioned GameCommand. */
export declare function applySimulationAction(game: TowerDefenseGame, action: SimulationAction): ActionResult;
export declare function tickHeadless(game: TowerDefenseGame, units: number, step?: number): void;
export declare function runHeadlessMission(options: HeadlessMissionRunOptions): HeadlessMissionRunResult;
