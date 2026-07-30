import { canonicalStringify } from "../simulation/stable-digest.js";
export const TOWER_SCRIPT_TRACE_SCHEMA_VERSION = 2;
const MIN_TRACE_ENTRIES = 1;
const MAX_TRACE_ENTRIES = 16_384;
const MIN_TRACE_BYTES = 1_024;
const MAX_TRACE_BYTES = 16 * 1024 * 1024;
function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const first = value.charCodeAt(index);
        if (first <= 0x7f)
            bytes += 1;
        else if (first <= 0x7ff)
            bytes += 2;
        else if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length
            && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
            bytes += 4;
            index += 1;
        }
        else
            bytes += 3;
    }
    return bytes;
}
function jsonClone(value) {
    if (value === undefined)
        return value;
    return JSON.parse(canonicalStringify(value, {
        maxDepth: 64,
        maxNodes: 100_000,
        maxBytes: 2 * 1024 * 1024
    }));
}
export function createTowerScriptTraceCollector(options) {
    const maxEntries = options?.maxEntries;
    if (!Number.isInteger(maxEntries) || maxEntries < MIN_TRACE_ENTRIES || maxEntries > MAX_TRACE_ENTRIES) {
        throw new Error(`TowerScript trace maxEntries must be an integer ${MIN_TRACE_ENTRIES}..${MAX_TRACE_ENTRIES}.`);
    }
    const maxBytes = options.maxBytes ?? Math.min(MAX_TRACE_BYTES, Math.max(256 * 1024, maxEntries * 4_096));
    if (!Number.isInteger(maxBytes) || maxBytes < MIN_TRACE_BYTES || maxBytes > MAX_TRACE_BYTES) {
        throw new Error(`TowerScript trace maxBytes must be an integer ${MIN_TRACE_BYTES}..${MAX_TRACE_BYTES}.`);
    }
    let nextSequence = 0;
    let entries = [];
    let entryBytes = [];
    let retainedBytes = 0;
    let nextActionOccurrence = 0;
    let phaseTotals = {
        event: 0,
        binding: 0,
        handler: 0,
        condition: 0,
        behavior: 0,
        transition: 0,
        action: 0,
        state_diff: 0,
        diagnostic: 0
    };
    let pauseSequence;
    let pauseBeforeSequence;
    let pauseAfterSequence;
    if (options.pauseAfterAction !== undefined
        && (!Number.isInteger(options.pauseAfterAction) || options.pauseAfterAction < 0 || options.pauseAfterAction >= MAX_TRACE_ENTRIES)) {
        throw new Error("TowerScript trace pauseAfterAction is outside the trace budget.");
    }
    if (options.pauseBefore !== undefined
        && (!Number.isInteger(options.pauseBefore.occurrence)
            || options.pauseBefore.occurrence < 0
            || options.pauseBefore.occurrence >= MAX_TRACE_ENTRIES)) {
        throw new Error("TowerScript trace pauseBefore occurrence is outside the trace budget.");
    }
    if (options.pauseAfter !== undefined
        && (!Number.isInteger(options.pauseAfter.occurrence)
            || options.pauseAfter.occurrence < 0
            || options.pauseAfter.occurrence >= MAX_TRACE_ENTRIES)) {
        throw new Error("TowerScript trace pauseAfter occurrence is outside the trace budget.");
    }
    return Object.freeze({
        maxEntries,
        maxBytes,
        record(input) {
            const actionOrdinal = input.phase === "action" ? nextActionOccurrence : undefined;
            const phaseOrdinal = phaseTotals[input.phase];
            const serialized = canonicalStringify({
                ...input,
                actionsBefore: nextActionOccurrence,
                ...(actionOrdinal === undefined ? {} : { actionOrdinal }),
                phaseOrdinal,
                schemaVersion: TOWER_SCRIPT_TRACE_SCHEMA_VERSION,
                sequence: nextSequence
            }, { maxDepth: 64, maxNodes: 100_000, maxBytes: 2 * 1024 * 1024 });
            const entry = Object.freeze(JSON.parse(serialized));
            const bytes = utf8ByteLength(serialized);
            nextSequence += 1;
            entries.push(entry);
            entryBytes.push(bytes);
            retainedBytes += bytes;
            phaseTotals[input.phase] += 1;
            if (options.pauseBefore?.phase === input.phase
                && options.pauseBefore.occurrence === phaseOrdinal) {
                pauseBeforeSequence = entry.sequence;
            }
            if (options.pauseAfter?.phase === input.phase
                && options.pauseAfter.occurrence === phaseOrdinal) {
                pauseAfterSequence = entry.sequence;
            }
            if (entry.phase === "action") {
                if (options.pauseAfterAction === nextActionOccurrence)
                    pauseSequence = entry.sequence;
                nextActionOccurrence += 1;
            }
            while (entries.length > maxEntries || retainedBytes > maxBytes) {
                entries.shift();
                retainedBytes -= entryBytes.shift() ?? 0;
            }
            return entry;
        },
        clear() {
            entries = [];
            entryBytes = [];
            retainedBytes = 0;
            nextSequence = 0;
            nextActionOccurrence = 0;
            phaseTotals = {
                event: 0,
                binding: 0,
                handler: 0,
                condition: 0,
                behavior: 0,
                transition: 0,
                action: 0,
                state_diff: 0,
                diagnostic: 0
            };
            pauseSequence = undefined;
            pauseBeforeSequence = undefined;
            pauseAfterSequence = undefined;
        },
        getSnapshot() {
            const detached = jsonClone(entries);
            return Object.freeze({
                schemaVersion: TOWER_SCRIPT_TRACE_SCHEMA_VERSION,
                maxEntries,
                maxBytes,
                retainedBytes,
                droppedEntries: nextSequence - entries.length,
                totalEntries: nextSequence,
                totalActions: nextActionOccurrence,
                phaseTotals: Object.freeze({ ...phaseTotals }),
                entries: Object.freeze(detached.map((entry) => Object.freeze(entry)))
            });
        },
        shouldPauseAfterAction(sequence) {
            return pauseSequence === sequence;
        },
        shouldPauseBeforeEntry(sequence) {
            return pauseBeforeSequence === sequence;
        },
        shouldPauseAfterEntry(sequence) {
            return pauseAfterSequence === sequence;
        }
    });
}
/** Debugger-only control flow. The runtime must never convert it to a gameplay diagnostic. */
export class TowerScriptTracePauseError extends Error {
    code = "TOWER_SCRIPT_TRACE_PAUSE";
    traceSequence;
    /** @deprecated Use traceSequence. */
    actionSequence;
    constructor(traceSequence) {
        super(`TowerScript debug replay paused at trace ${traceSequence}.`);
        this.name = "TowerScriptTracePauseError";
        this.traceSequence = traceSequence;
        this.actionSequence = traceSequence;
    }
}
function pointerToken(value) {
    return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function sameJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
export function diffTowerScriptState(before, after) {
    const changes = [];
    const visit = (left, right, path, hasLeft, hasRight) => {
        if (!hasLeft) {
            changes.push(Object.freeze({ op: "add", path, after: jsonClone(right) }));
            return;
        }
        if (!hasRight) {
            changes.push(Object.freeze({ op: "remove", path, before: jsonClone(left) }));
            return;
        }
        if (isRecord(left) && isRecord(right)) {
            const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
            for (const key of keys) {
                visit(left[key], right[key], `${path}/${pointerToken(key)}`, Object.hasOwn(left, key), Object.hasOwn(right, key));
            }
            return;
        }
        if (!sameJson(left, right)) {
            changes.push(Object.freeze({
                op: "replace",
                path,
                before: jsonClone(left),
                after: jsonClone(right)
            }));
        }
    };
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
        visit(before[key], after[key], `/${pointerToken(key)}`, Object.hasOwn(before, key), Object.hasOwn(after, key));
    }
    return Object.freeze(changes);
}
