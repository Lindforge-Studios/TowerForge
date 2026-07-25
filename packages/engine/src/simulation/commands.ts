import type { TowerDefenseGame } from "./TowerDefenseGame.js";
import {
  executeParsedGameCommand,
  invalidGameCommandResult,
  parseGameCommand,
  type GameCommandV1
} from "./command-internal.js";
import type { ActionResult } from "./types.js";

export {
  GAME_COMMAND_SCHEMA_VERSION,
  type GameCommand,
  type GameCommandV1
} from "./command-internal.js";

/** Validate and dispatch one deterministic simulation command. Invalid input never mutates the game. */
export function dispatchGameCommand(game: TowerDefenseGame, input: unknown): ActionResult {
  let command: GameCommandV1 | undefined;
  try {
    command = parseGameCommand(input);
  } catch {
    return invalidGameCommandResult();
  }
  return command
    ? executeParsedGameCommand(game, command)
    : invalidGameCommandResult();
}
