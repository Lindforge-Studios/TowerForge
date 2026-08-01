import type { TowerDefenseGame } from "./TowerDefenseGame.js";
import {
  executeParsedGameCommand,
  invalidGameCommandResult,
  parseGameCommand,
  type GameCommand
} from "./command-internal.js";
import type { ActionResult } from "./types.js";

export {
  GAME_COMMAND_SCHEMA_VERSION,
  GAME_COMMAND_SUPPORTED_SCHEMA_VERSIONS,
  type GameCommand,
  type GameCommandV1,
  type GameCommandV2,
  type GameCommandV3,
  type GameCommandV4,
  type GameCommandV5,
  type GameCommandV6,
  type GameCommandV7,
  type GameCommandV8
} from "./command-internal.js";

/** Validate and dispatch one deterministic simulation command. Invalid input never mutates the game. */
export function dispatchGameCommand(game: TowerDefenseGame, input: unknown): ActionResult {
  let command: GameCommand | undefined;
  try {
    command = parseGameCommand(input);
  } catch {
    return invalidGameCommandResult();
  }
  return command
    ? executeParsedGameCommand(game, command)
    : invalidGameCommandResult();
}
