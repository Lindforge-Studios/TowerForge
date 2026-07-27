import { executeParsedGameCommand } from "./command-internal.js";
import { cloneCheckpointJson } from "./checkpoint.js";
import { decodeGameCommandJournal } from "./journal.js";
import { normalizeGameCommandJournalResult } from "./journal-result-internal.js";
import { canonicalStringify } from "./stable-digest.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
function detachedFrozenResult(value) {
    const clone = cloneCheckpointJson(value);
    if (clone.reasonParams)
        Object.freeze(clone.reasonParams);
    return Object.freeze(clone);
}
export class GameCommandReplayDivergenceError extends Error {
    code = "GAME_COMMAND_REPLAY_DIVERGENCE";
    kind;
    sequence;
    expected;
    actual;
    constructor(details) {
        super(`Game command replay diverged at sequence ${details.sequence}: ${details.kind}.`);
        this.name = "GameCommandReplayDivergenceError";
        this.kind = details.kind;
        this.sequence = details.sequence;
        this.expected = typeof details.expected === "string"
            ? details.expected
            : detachedFrozenResult(details.expected);
        this.actual = typeof details.actual === "string"
            ? details.actual
            : detachedFrozenResult(details.actual);
        Object.freeze(this);
    }
}
export class GameCommandReplayExecutionError extends Error {
    code = "GAME_COMMAND_REPLAY_EXECUTION_FAILED";
    sequence;
    cause;
    constructor(sequence, cause) {
        super(`Game command replay execution failed at sequence ${sequence}.`, { cause });
        this.name = "GameCommandReplayExecutionError";
        this.sequence = sequence;
        this.cause = cause;
        Object.freeze(this);
    }
}
/**
 * Validate a complete journal before creating a map, then replay each already
 * canonical command exactly once while checking result before post-state digest.
 */
export function replayGameCommandJournal(options) {
    const journal = decodeGameCommandJournal(options);
    const game = TowerDefenseGame.fromCheckpoint({
        content: options.content,
        checkpoint: journal.initialCheckpoint
    });
    let stateDigest = journal.initialCheckpoint.stateDigest;
    for (const entry of journal.entries) {
        let actualResult;
        try {
            actualResult = normalizeGameCommandJournalResult(executeParsedGameCommand(game, entry.command));
        }
        catch (cause) {
            throw new GameCommandReplayExecutionError(entry.sequence, cause);
        }
        if (canonicalStringify(actualResult) !== canonicalStringify(entry.result)) {
            throw new GameCommandReplayDivergenceError({
                kind: "result",
                sequence: entry.sequence,
                expected: entry.result,
                actual: actualResult
            });
        }
        try {
            stateDigest = game.getStateDigest();
        }
        catch (cause) {
            throw new GameCommandReplayExecutionError(entry.sequence, cause);
        }
        if (stateDigest !== entry.postStateDigest) {
            throw new GameCommandReplayDivergenceError({
                kind: "postStateDigest",
                sequence: entry.sequence,
                expected: entry.postStateDigest,
                actual: stateDigest
            });
        }
    }
    return Object.freeze({
        game,
        entriesReplayed: journal.entries.length,
        stateDigest
    });
}
