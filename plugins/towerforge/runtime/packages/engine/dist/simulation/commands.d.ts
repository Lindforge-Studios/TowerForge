import type { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { ActionResult } from "./types.js";
export { GAME_COMMAND_SCHEMA_VERSION, GAME_COMMAND_SUPPORTED_SCHEMA_VERSIONS, type GameCommand, type GameCommandV1, type GameCommandV2, type GameCommandV3, type GameCommandV4 } from "./command-internal.js";
/** Validate and dispatch one deterministic simulation command. Invalid input never mutates the game. */
export declare function dispatchGameCommand(game: TowerDefenseGame, input: unknown): ActionResult;
