import type { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { ActionResult } from "./types.js";
export { GAME_COMMAND_SCHEMA_VERSION, type GameCommand, type GameCommandV1 } from "./command-internal.js";
/** Validate and dispatch one deterministic simulation command. Invalid input never mutates the game. */
export declare function dispatchGameCommand(game: TowerDefenseGame, input: unknown): ActionResult;
