import { createTowerScriptTraceCollector, TowerScriptTracePauseError } from "../scripting/trace.js";
import { cloneCheckpointJson } from "./checkpoint.js";
import { dispatchGameCommand } from "./commands.js";
import { JournaledGameSession } from "./journal.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
export const TOWER_SCRIPT_DEBUG_SCHEMA_VERSION = 1;
const MAX_CHECKPOINT_RING_CAPACITY = 2_048;
function cloneCommand(value) {
    return cloneCheckpointJson(value);
}
function isTickCommand(command) {
    return command.type === "tick";
}
/**
 * Authoring-only deterministic wrapper. The live game always advances through
 * the existing JournaledGameSession; inspection frames are replayed separately.
 */
export class TowerScriptDebugSession {
    content;
    initialCheckpoint;
    checkpointRingCapacity;
    traceMaxEntries;
    mutableGame;
    journalSession;
    traceCollector;
    journalEntryCount = 0;
    commandRecords = [];
    replayCheckpointPruneCursor = 0;
    checkpointRing = [];
    currentTick = 0;
    stepPositions = {
        tick: 0,
        event: 0,
        handler: 0,
        action: 0
    };
    constructor(options) {
        if (!Number.isInteger(options.checkpointRingCapacity)
            || options.checkpointRingCapacity < 1
            || options.checkpointRingCapacity > MAX_CHECKPOINT_RING_CAPACITY) {
            throw new Error(`TowerScript debugger checkpoint ring capacity must be 1..${MAX_CHECKPOINT_RING_CAPACITY}.`);
        }
        this.content = options.content;
        this.checkpointRingCapacity = options.checkpointRingCapacity;
        this.traceMaxEntries = options.trace?.maxEntries;
        const checkpoint = options.initial instanceof TowerDefenseGame
            ? options.initial.createCheckpoint()
            : options.initial;
        // fromCheckpoint validates engine/content/checkpoint envelopes before map construction.
        const validated = TowerDefenseGame.validateCheckpoint({ content: this.content, checkpoint });
        this.initialCheckpoint = cloneCheckpointJson(validated);
        this.resetRuntime([]);
    }
    get game() {
        return this.mutableGame;
    }
    dispatch(input) {
        const preCheckpoint = this.traceCollector ? this.mutableGame.createCheckpoint() : undefined;
        const beforeTrace = this.traceCollector?.getSnapshot();
        const traceStart = beforeTrace?.totalEntries ?? 0;
        const actionStart = beforeTrace?.totalActions ?? 0;
        const phaseStart = {
            event: beforeTrace?.phaseTotals.event ?? 0,
            handler: beforeTrace?.phaseTotals.handler ?? 0
        };
        const result = this.journalSession.dispatch(input);
        const acceptedTail = this.journalSession.getAcceptedTail();
        if (acceptedTail.entryCount === this.journalEntryCount)
            return result;
        if (acceptedTail.entryCount !== this.journalEntryCount + 1 || acceptedTail.entry === undefined) {
            throw new Error("TowerScript debugger journal tail advanced unexpectedly.");
        }
        this.journalEntryCount = acceptedTail.entryCount;
        const journalEntry = acceptedTail.entry;
        const command = cloneCommand(journalEntry.command);
        if (isTickCommand(command))
            this.currentTick += 1;
        const postCheckpoint = this.mutableGame.createCheckpoint();
        const afterTrace = this.traceCollector?.getSnapshot();
        const traceEnd = afterTrace?.totalEntries ?? traceStart;
        const actionEnd = afterTrace?.totalActions ?? actionStart;
        const phaseEnd = {
            event: afterTrace?.phaseTotals.event ?? phaseStart.event,
            handler: afterTrace?.phaseTotals.handler ?? phaseStart.handler
        };
        const hasRetainedTraceRange = this.traceCollector !== undefined && traceEnd > traceStart;
        this.commandRecords.push(Object.freeze({
            command,
            ...(hasRetainedTraceRange && preCheckpoint ? { preCheckpoint } : {}),
            ...(hasRetainedTraceRange ? { postCheckpoint } : {}),
            traceStart,
            traceEnd,
            actionStart,
            actionEnd,
            phaseStart: Object.freeze(phaseStart),
            phaseEnd: Object.freeze(phaseEnd),
            tick: this.currentTick
        }));
        if (isTickCommand(command))
            this.pushCheckpoint(postCheckpoint);
        this.pruneReplayCheckpoints();
        this.resetStepPositions();
        return result;
    }
    getTrace() {
        return this.traceCollector?.getSnapshot() ?? null;
    }
    exportJournal() {
        return this.journalSession.exportJournal();
    }
    getCheckpointRing() {
        const oldest = this.checkpointRing[0]?.tick ?? this.currentTick;
        const newest = this.checkpointRing.at(-1)?.tick ?? this.currentTick;
        return Object.freeze({
            capacity: this.checkpointRingCapacity,
            size: this.checkpointRing.length,
            oldestTick: oldest,
            newestTick: newest
        });
    }
    step(mode) {
        if (!this.traceCollector)
            throw new Error("TowerScript debug trace is not enabled.");
        const candidates = this.stepCandidates(mode);
        const position = this.stepPositions[mode];
        const entry = candidates[position];
        if (!entry)
            return null;
        this.stepPositions[mode] = position + 1;
        const frame = this.previewFrame(mode, entry);
        return Object.freeze({
            schemaVersion: TOWER_SCRIPT_DEBUG_SCHEMA_VERSION,
            mode,
            cursor: Object.freeze({
                schemaVersion: TOWER_SCRIPT_DEBUG_SCHEMA_VERSION,
                mode,
                sequence: position,
                traceSequence: entry.sequence
            }),
            traceEntry: cloneCommand(entry),
            snapshot: frame.snapshot,
            stateDigest: frame.stateDigest,
            live: false
        });
    }
    resume() {
        this.resetStepPositions();
        return Object.freeze({ ok: true, stateDigest: this.mutableGame.getStateDigest() });
    }
    rewindTicks(ticks) {
        const targetTick = this.currentTick - ticks;
        const oldestTick = this.checkpointRing[0]?.tick ?? this.currentTick;
        if (!Number.isInteger(ticks) || ticks <= 0 || targetTick < 0) {
            return Object.freeze({
                ok: false,
                reasonKey: "debug.rewind_out_of_range",
                oldestTick,
                currentTick: this.currentTick
            });
        }
        const target = this.checkpointRing.find((entry) => entry.tick === targetTick);
        if (!target) {
            return Object.freeze({
                ok: false,
                reasonKey: "debug.rewind_out_of_range",
                oldestTick,
                currentTick: this.currentTick
            });
        }
        // Validate the retained checkpoint itself before reconstructing the branch.
        const retained = TowerDefenseGame.validateCheckpoint({ content: this.content, checkpoint: target.checkpoint });
        const commands = this.commandRecords.slice(0, target.commandCount).map((record) => cloneCommand(record.command));
        this.resetRuntime(commands);
        if (this.mutableGame.getStateDigest() !== retained.stateDigest) {
            throw new Error("TowerScript debugger rewind digest mismatch.");
        }
        return Object.freeze({
            ok: true,
            ticksRewound: ticks,
            currentTick: this.currentTick,
            stateDigest: this.mutableGame.getStateDigest()
        });
    }
    resetRuntime(commands) {
        this.traceCollector = this.traceMaxEntries === undefined
            ? undefined
            : createTowerScriptTraceCollector({ maxEntries: this.traceMaxEntries });
        this.mutableGame = TowerDefenseGame.fromCheckpoint({
            content: this.content,
            checkpoint: this.initialCheckpoint,
            towerScriptTrace: this.traceCollector
        });
        this.journalSession = new JournaledGameSession(this.mutableGame);
        this.journalEntryCount = 0;
        this.commandRecords = [];
        this.replayCheckpointPruneCursor = 0;
        this.currentTick = 0;
        this.checkpointRing = [{ tick: 0, commandCount: 0, checkpoint: this.mutableGame.createCheckpoint() }];
        for (const command of commands)
            this.dispatch(command);
        this.resetStepPositions();
    }
    pushCheckpoint(checkpoint) {
        this.checkpointRing.push({
            tick: this.currentTick,
            commandCount: this.commandRecords.length,
            checkpoint: cloneCheckpointJson(checkpoint)
        });
        if (this.checkpointRing.length > this.checkpointRingCapacity) {
            this.checkpointRing.splice(0, this.checkpointRing.length - this.checkpointRingCapacity);
        }
    }
    resetStepPositions() {
        this.stepPositions.tick = 0;
        this.stepPositions.event = 0;
        this.stepPositions.handler = 0;
        this.stepPositions.action = 0;
    }
    pruneReplayCheckpoints() {
        const trace = this.traceCollector?.getSnapshot();
        if (!trace)
            return;
        const oldestRetainedSequence = trace.entries[0]?.sequence ?? trace.totalEntries;
        while (this.replayCheckpointPruneCursor < this.commandRecords.length) {
            const record = this.commandRecords[this.replayCheckpointPruneCursor];
            if (record.traceEnd > oldestRetainedSequence)
                break;
            if (record.preCheckpoint || record.postCheckpoint) {
                this.commandRecords[this.replayCheckpointPruneCursor] = Object.freeze({
                    command: record.command,
                    traceStart: record.traceStart,
                    traceEnd: record.traceEnd,
                    actionStart: record.actionStart,
                    actionEnd: record.actionEnd,
                    phaseStart: record.phaseStart,
                    phaseEnd: record.phaseEnd,
                    tick: record.tick
                });
            }
            this.replayCheckpointPruneCursor += 1;
        }
    }
    stepCandidates(mode) {
        const trace = this.traceCollector.getSnapshot();
        if (mode === "event")
            return trace.entries.filter((entry) => entry.phase === "event");
        if (mode === "handler")
            return trace.entries.filter((entry) => entry.phase === "handler");
        if (mode === "action")
            return trace.entries.filter((entry) => entry.phase === "action");
        const bySequence = new Map(trace.entries.map((entry) => [entry.sequence, entry]));
        const ticks = [];
        for (const record of this.commandRecords) {
            if (!isTickCommand(record.command))
                continue;
            const within = [...bySequence.values()].filter((entry) => (entry.sequence >= record.traceStart && entry.sequence < record.traceEnd));
            const candidate = [...within].reverse().find((entry) => entry.phase === "state_diff") ?? within.at(-1);
            if (candidate)
                ticks.push(candidate);
        }
        return ticks;
    }
    previewAction(entry) {
        const record = this.recordForEntry(entry);
        if (!record)
            throw new Error("TowerScript debug action cursor is outside retained command history.");
        if (entry.actionOrdinal === undefined)
            throw new Error("TowerScript debug action cursor has no stable ordinal.");
        const actionOccurrence = entry.actionOrdinal - record.actionStart;
        if (actionOccurrence < 0 || actionOccurrence >= record.actionEnd - record.actionStart) {
            throw new Error("TowerScript debug action cursor is invalid.");
        }
        return this.previewAfterAction(record, actionOccurrence);
    }
    previewFrame(mode, entry) {
        const record = this.recordForEntry(entry);
        if (!record)
            throw new Error("TowerScript debug cursor is outside retained command history.");
        if (mode === "tick")
            return this.checkpointFrame(record.postCheckpoint, "tick");
        if (mode === "action")
            return this.previewAction(entry);
        return this.previewBeforePhase(record, entry, mode);
    }
    recordForEntry(entry) {
        return this.commandRecords.find((candidate) => (entry.sequence >= candidate.traceStart && entry.sequence < candidate.traceEnd));
    }
    checkpointFrame(checkpoint, mode) {
        if (!checkpoint)
            throw new Error(`TowerScript debug ${mode} cursor checkpoint is no longer retained.`);
        const replay = TowerDefenseGame.fromCheckpoint({ content: this.content, checkpoint });
        return { snapshot: replay.getSnapshot(), stateDigest: replay.getStateDigest() };
    }
    previewAfterAction(record, actionOccurrence) {
        const actionCount = record.actionEnd - record.actionStart;
        if (actionOccurrence === actionCount - 1)
            return this.checkpointFrame(record.postCheckpoint, "action");
        if (!record.preCheckpoint)
            throw new Error("TowerScript debug action cursor checkpoint is no longer retained.");
        const replayTrace = createTowerScriptTraceCollector({
            maxEntries: this.traceMaxEntries ?? 256,
            pauseAfterAction: actionOccurrence
        });
        const replay = TowerDefenseGame.fromCheckpoint({
            content: this.content,
            checkpoint: record.preCheckpoint,
            towerScriptTrace: replayTrace
        });
        let paused = false;
        try {
            dispatchGameCommand(replay, record.command);
        }
        catch (error) {
            if (!(error instanceof TowerScriptTracePauseError))
                throw error;
            paused = true;
        }
        if (!paused)
            throw new Error("TowerScript debug replay did not reach the requested action cursor.");
        return { snapshot: replay.getSnapshot(), stateDigest: replay.getStateDigest() };
    }
    previewBeforePhase(record, entry, phase) {
        const occurrence = entry.phaseOrdinal - record.phaseStart[phase];
        if (occurrence < 0 || occurrence >= record.phaseEnd[phase] - record.phaseStart[phase]) {
            throw new Error(`TowerScript debug ${phase} cursor has an invalid stable ordinal.`);
        }
        if (!record.preCheckpoint)
            throw new Error(`TowerScript debug ${phase} cursor checkpoint is no longer retained.`);
        const replayTrace = createTowerScriptTraceCollector({
            maxEntries: this.traceMaxEntries ?? 256,
            pauseBefore: { phase, occurrence }
        });
        const replay = TowerDefenseGame.fromCheckpoint({
            content: this.content,
            checkpoint: record.preCheckpoint,
            towerScriptTrace: replayTrace
        });
        let paused = false;
        try {
            dispatchGameCommand(replay, record.command);
        }
        catch (error) {
            if (!(error instanceof TowerScriptTracePauseError))
                throw error;
            paused = true;
        }
        if (!paused)
            throw new Error(`TowerScript debug replay did not reach the requested ${phase} cursor.`);
        return { snapshot: replay.getSnapshot(), stateDigest: replay.getStateDigest() };
    }
}
