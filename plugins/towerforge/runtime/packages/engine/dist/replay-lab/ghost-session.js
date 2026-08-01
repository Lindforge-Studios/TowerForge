import { executeParsedGameCommand } from "../simulation/command-internal.js";
import { normalizeGameCommandJournalResult } from "../simulation/journal-result-internal.js";
import { GameCommandReplayDivergenceError, GameCommandReplayExecutionError, replayGameCommandJournal } from "../simulation/replay.js";
import { canonicalStringify } from "../simulation/stable-digest.js";
import { replayArchiveContentV1 } from "./replay-archive.js";
export const GHOST_REPLAY_LIMITS = Object.freeze({
    maximumCachedFrames: 256
});
function deepFreezeJson(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreezeJson(child);
        Object.freeze(value);
    }
    return value;
}
function journalPrefix(journal, sequence) {
    return {
        ...journal,
        entries: journal.entries.slice(0, sequence)
    };
}
export function createGhostReplaySessionV1(options) {
    const content = replayArchiveContentV1(options.archive);
    if (!content) {
        throw new Error("Ghost replay requires an engine-decoded replay archive.");
    }
    const journal = options.archive.journal;
    const finalSequence = journal.entries.length;
    const frames = new Map();
    let currentSequence = 0;
    const initialReplay = () => replayGameCommandJournal({
        content,
        journal: journalPrefix(journal, 0)
    });
    let liveGame;
    let liveSequence;
    let liveStateDigest;
    const resetLiveRuntime = () => {
        const replay = initialReplay();
        liveGame = replay.game;
        liveSequence = 0;
        liveStateDigest = replay.stateDigest;
    };
    resetLiveRuntime();
    const advanceLiveRuntime = () => {
        const entry = journal.entries[liveSequence];
        if (!entry)
            return;
        let actualResult;
        try {
            actualResult = normalizeGameCommandJournalResult(executeParsedGameCommand(liveGame, entry.command));
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
            liveStateDigest = liveGame.getStateDigest();
        }
        catch (cause) {
            throw new GameCommandReplayExecutionError(entry.sequence, cause);
        }
        if (liveStateDigest !== entry.postStateDigest) {
            throw new GameCommandReplayDivergenceError({
                kind: "postStateDigest",
                sequence: entry.sequence,
                expected: entry.postStateDigest,
                actual: liveStateDigest
            });
        }
        liveSequence += 1;
    };
    const positionLiveRuntime = (sequence) => {
        if (sequence < liveSequence)
            resetLiveRuntime();
        while (liveSequence < sequence)
            advanceLiveRuntime();
    };
    const frameAt = (sequence) => {
        if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > finalSequence) {
            throw new Error(`Ghost replay sequence is outside the range 0..${finalSequence}.`);
        }
        const cached = frames.get(sequence);
        if (cached) {
            frames.delete(sequence);
            frames.set(sequence, cached);
            return cached;
        }
        positionLiveRuntime(sequence);
        // getSnapshot() is trusted engine-owned data and may contain explicit
        // optional `undefined` presentation fields that are valid for a snapshot
        // but outside canonical checkpoint JSON. structuredClone detaches those
        // fields without invoking project-authored accessors; deepFreeze then makes
        // the Ghost envelope read-only.
        const snapshot = deepFreezeJson(structuredClone(liveGame.getSnapshot()));
        const frame = Object.freeze({
            schemaVersion: 1,
            ghost: true,
            sequence,
            stateDigest: liveStateDigest,
            snapshot
        });
        frames.set(sequence, frame);
        while (frames.size > GHOST_REPLAY_LIMITS.maximumCachedFrames) {
            const oldest = frames.keys().next().value;
            if (oldest === undefined)
                break;
            frames.delete(oldest);
        }
        return frame;
    };
    const session = {
        seek(sequence) {
            const frame = frameAt(sequence);
            currentSequence = sequence;
            return frame;
        },
        advance() {
            const sequence = Math.min(finalSequence, currentSequence + 1);
            const frame = frameAt(sequence);
            currentSequence = sequence;
            return frame;
        },
        final() {
            const frame = frameAt(finalSequence);
            currentSequence = finalSequence;
            return frame;
        }
    };
    return Object.freeze(session);
}
