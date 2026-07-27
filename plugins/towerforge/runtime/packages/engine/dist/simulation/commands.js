import { executeParsedGameCommand, invalidGameCommandResult, parseGameCommand } from "./command-internal.js";
export { GAME_COMMAND_SCHEMA_VERSION, GAME_COMMAND_SUPPORTED_SCHEMA_VERSIONS } from "./command-internal.js";
/** Validate and dispatch one deterministic simulation command. Invalid input never mutates the game. */
export function dispatchGameCommand(game, input) {
    let command;
    try {
        command = parseGameCommand(input);
    }
    catch {
        return invalidGameCommandResult();
    }
    return command
        ? executeParsedGameCommand(game, command)
        : invalidGameCommandResult();
}
