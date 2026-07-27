import { executeParsedGameCommand, invalidGameCommandResult, parseGameCommand } from "./command-internal.js";
import { cloneCheckpointJson, checkpointDataField, checkpointObjectDescriptors, requireExactCheckpointKeys, SIMULATION_ENGINE_VERSION } from "./checkpoint.js";
import { canonicalJsonMetrics, canonicalStringify, getSimulationContentDigest } from "./stable-digest.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import { GAME_COMMAND_JOURNAL_RESULT_LIMITS_INTERNAL, normalizeGameCommandJournalResult } from "./journal-result-internal.js";
export const GAME_COMMAND_JOURNAL_SCHEMA_VERSION = 6;
export const GAME_COMMAND_JOURNAL_SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1, 2, 3, 4, 5, 6]);
export const GAME_COMMAND_JOURNAL_LIMITS = Object.freeze({
    entries: 100_000,
    totalBytes: 64 * 1_024 * 1_024,
    resultBytes: GAME_COMMAND_JOURNAL_RESULT_LIMITS_INTERNAL.resultBytes,
    reasonParams: GAME_COMMAND_JOURNAL_RESULT_LIMITS_INTERNAL.reasonParams
});
const STATE_DIGEST_RE = /^tf-state-v1:[0-9a-f]{16}$/;
const GAME_COMMAND_JOURNAL_MAX_NODES = GAME_COMMAND_JOURNAL_LIMITS.entries * 64 + 100_000;
function journalArrayItems(value, context) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error(`${context} must be a plain array.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error(`${context} rejects symbol keys.`);
    }
    const lengthDescriptor = descriptors["length"];
    if (!lengthDescriptor || !("value" in lengthDescriptor)) {
        throw new Error(`${context} length must be a data property.`);
    }
    const length = lengthDescriptor.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
        throw new Error(`${context} length is invalid.`);
    }
    const elementKeys = Object.keys(descriptors).filter((key) => key !== "length");
    if (elementKeys.length !== length) {
        throw new Error(`${context} rejects sparse arrays or extra fields.`);
    }
    const items = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new Error(`${context} entries must be enumerable data properties.`);
        }
        items.push(descriptor.value);
    }
    return items;
}
function journalCanonicalMetrics(value) {
    return canonicalJsonMetrics(value, {
        maxBytes: GAME_COMMAND_JOURNAL_LIMITS.totalBytes,
        maxNodes: GAME_COMMAND_JOURNAL_MAX_NODES
    });
}
function assertJournalTotalBudget(value) {
    journalCanonicalMetrics(value);
}
function journalEntryCanonicalMetrics(entry) {
    return canonicalJsonMetrics(entry, {
        maxBytes: GAME_COMMAND_JOURNAL_LIMITS.totalBytes,
        maxNodes: GAME_COMMAND_JOURNAL_MAX_NODES
    });
}
function decodeResult(value) {
    const descriptors = checkpointObjectDescriptors(value, "Game command journal result");
    const ok = checkpointDataField(descriptors, "ok", "Game command journal result");
    if (typeof ok !== "boolean") {
        throw new Error("Game command journal result ok field must be boolean.");
    }
    if (ok) {
        requireExactCheckpointKeys(descriptors, ["ok"], "Game command journal successful result");
        const result = { ok: true };
        canonicalStringify(result, { maxBytes: GAME_COMMAND_JOURNAL_LIMITS.resultBytes });
        return result;
    }
    const allowed = new Set(["ok", "reasonKey", "reasonParams"]);
    if (Object.keys(descriptors).some((key) => !allowed.has(key))) {
        throw new Error("Game command journal result contains an unsupported field.");
    }
    const result = { ok: false };
    if (Object.prototype.hasOwnProperty.call(descriptors, "reasonKey")) {
        const reasonKey = checkpointDataField(descriptors, "reasonKey", "Game command journal result");
        if (typeof reasonKey !== "string" || reasonKey.length === 0 || reasonKey !== reasonKey.trim()) {
            throw new Error("Game command journal result has an invalid reason key.");
        }
        result.reasonKey = reasonKey;
    }
    if (Object.prototype.hasOwnProperty.call(descriptors, "reasonParams")) {
        const reasonParams = checkpointDataField(descriptors, "reasonParams", "Game command journal result");
        const normalized = normalizeGameCommandJournalResult({
            ok: false,
            reasonParams: reasonParams
        });
        if (!normalized.reasonParams) {
            throw new Error("Game command journal result must omit empty reason params.");
        }
        result.reasonParams = normalized.reasonParams;
    }
    canonicalStringify(value, { maxBytes: GAME_COMMAND_JOURNAL_LIMITS.resultBytes });
    return result;
}
function detachedJournal(initialCheckpoint, contentDigest, entries, schemaVersion) {
    const common = {
        engineVersion: SIMULATION_ENGINE_VERSION,
        contentDigest,
        initialCheckpoint: cloneCheckpointJson(initialCheckpoint),
        entries: entries.map((entry) => ({
            sequence: entry.sequence,
            command: cloneCheckpointJson(entry.command),
            result: cloneCheckpointJson(entry.result),
            postStateDigest: entry.postStateDigest
        }))
    };
    if (schemaVersion === 1) {
        return {
            schemaVersion: 1,
            ...common,
            entries: common.entries
        };
    }
    if (schemaVersion === 2) {
        return { schemaVersion: 2, ...common, entries: common.entries };
    }
    if (schemaVersion === 3) {
        return { schemaVersion: 3, ...common, entries: common.entries };
    }
    if (schemaVersion === 4) {
        return { schemaVersion: 4, ...common, entries: common.entries };
    }
    if (schemaVersion === 5) {
        return { schemaVersion: 5, ...common, entries: common.entries };
    }
    return { schemaVersion: 6, ...common };
}
/**
 * Owns the command boundary around one simulation instance. Any mutation that
 * bypasses dispatch makes the journal ambiguous, so the session faults closed.
 */
export class JournaledGameSession {
    game;
    mutableGame;
    initialCheckpoint;
    contentDigest;
    entries = [];
    journalSchemaVersion = 1;
    journalEnvelopeBytes;
    journalEnvelopeNodes;
    journalEntryBytes = 0;
    journalEntryNodes = 0;
    expectedStateDigest;
    faulted = false;
    constructor(game) {
        this.mutableGame = game;
        this.game = game;
        this.initialCheckpoint = game.createCheckpoint();
        this.contentDigest = this.initialCheckpoint.contentDigest;
        this.expectedStateDigest = this.initialCheckpoint.stateDigest;
        const envelope = journalCanonicalMetrics(detachedJournal(this.initialCheckpoint, this.contentDigest, [], 1));
        this.journalEnvelopeBytes = envelope.bytes;
        this.journalEnvelopeNodes = envelope.nodes;
    }
    assertHealthy() {
        if (this.faulted) {
            throw new Error("Game command journal session is faulted.");
        }
    }
    fault(message) {
        this.faulted = true;
        throw new Error(`Game command journal session fault: ${message}`);
    }
    assertExpectedState() {
        this.assertHealthy();
        let actualDigest;
        try {
            actualDigest = this.mutableGame.getStateDigest();
        }
        catch {
            this.fault("unable to verify simulation state digest.");
        }
        if (actualDigest !== this.expectedStateDigest) {
            this.fault("out-of-band simulation mutation changed the state digest.");
        }
    }
    assertLiveCapacity(command) {
        if (this.entries.length >= GAME_COMMAND_JOURNAL_LIMITS.entries) {
            this.fault("entry limit exceeded.");
        }
        // Reserve the entire per-result allowance before simulation execution. This
        // makes capacity rejection mutation-free even when the eventual result is
        // close to its maximum encoded size.
        const capacityProbe = {
            sequence: this.entries.length,
            command,
            result: {
                ok: false,
                reasonKey: "x".repeat(GAME_COMMAND_JOURNAL_LIMITS.resultBytes)
            },
            postStateDigest: "tf-state-v1:0000000000000000"
        };
        try {
            const probe = journalEntryCanonicalMetrics(capacityProbe);
            this.assertIncrementalCapacity(probe);
        }
        catch {
            this.fault("total byte capacity would be exceeded.");
        }
    }
    assertIncrementalCapacity(metrics) {
        const separatorBytes = this.entries.length;
        if (this.journalEnvelopeBytes + this.journalEntryBytes + metrics.bytes + separatorBytes
            > GAME_COMMAND_JOURNAL_LIMITS.totalBytes) {
            throw new Error("Game command journal total byte capacity would be exceeded.");
        }
        if (this.journalEnvelopeNodes + this.journalEntryNodes + metrics.nodes
            > GAME_COMMAND_JOURNAL_MAX_NODES) {
            throw new Error("Game command journal total node capacity would be exceeded.");
        }
    }
    refreshJournalEnvelope() {
        const envelope = journalCanonicalMetrics(detachedJournal(this.initialCheckpoint, this.contentDigest, [], this.journalSchemaVersion));
        this.journalEnvelopeBytes = envelope.bytes;
        this.journalEnvelopeNodes = envelope.nodes;
    }
    dispatch(input) {
        this.assertExpectedState();
        let command;
        try {
            command = parseGameCommand(input);
        }
        catch {
            return invalidGameCommandResult();
        }
        if (!command)
            return invalidGameCommandResult();
        if (command.schemaVersion > this.journalSchemaVersion) {
            this.journalSchemaVersion = command.schemaVersion;
            this.refreshJournalEnvelope();
        }
        this.assertLiveCapacity(command);
        let result;
        try {
            result = executeParsedGameCommand(this.mutableGame, command);
        }
        catch (error) {
            this.faulted = true;
            throw error;
        }
        let postStateDigest;
        let durableResult;
        try {
            postStateDigest = this.mutableGame.getStateDigest();
            durableResult = normalizeGameCommandJournalResult(result);
            const entry = {
                sequence: this.entries.length,
                command,
                result: durableResult,
                postStateDigest
            };
            const entryMetrics = journalEntryCanonicalMetrics(entry);
            this.assertIncrementalCapacity(entryMetrics);
            this.entries.push(entry);
            this.journalEntryBytes += entryMetrics.bytes;
            this.journalEntryNodes += entryMetrics.nodes;
            this.expectedStateDigest = postStateDigest;
        }
        catch (error) {
            this.faulted = true;
            throw error;
        }
        return result;
    }
    /**
     * O(1) view used by deterministic wrappers that already own this session.
     * It detaches only the latest accepted entry; complete journal cloning and
     * budget validation remain exclusive to explicit exportJournal() calls.
     */
    getAcceptedTail() {
        this.assertExpectedState();
        const entry = this.entries.at(-1);
        return Object.freeze({
            entryCount: this.entries.length,
            ...(entry === undefined ? {} : {
                entry: Object.freeze({
                    sequence: entry.sequence,
                    command: cloneCheckpointJson(entry.command),
                    result: cloneCheckpointJson(entry.result),
                    postStateDigest: entry.postStateDigest
                })
            })
        });
    }
    exportJournal() {
        this.assertExpectedState();
        const journal = detachedJournal(this.initialCheckpoint, this.contentDigest, this.entries, this.journalSchemaVersion);
        assertJournalTotalBudget(journal);
        return journal;
    }
}
/**
 * Validate a journal as closed, bounded, detached data. Commands are decoded but
 * deliberately never executed; replay is a separate contract.
 */
export function decodeGameCommandJournal(options) {
    const descriptors = checkpointObjectDescriptors(options.journal, "Game command journal");
    const schemaVersion = checkpointDataField(descriptors, "schemaVersion", "Game command journal");
    if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4
        && schemaVersion !== 5 && schemaVersion !== 6) {
        throw new Error(`Unsupported game command journal schema version "${String(schemaVersion)}".`);
    }
    const engineVersion = checkpointDataField(descriptors, "engineVersion", "Game command journal");
    if (engineVersion !== SIMULATION_ENGINE_VERSION) {
        throw new Error(`Unsupported game command journal engine version "${String(engineVersion)}".`);
    }
    requireExactCheckpointKeys(descriptors, ["schemaVersion", "engineVersion", "contentDigest", "initialCheckpoint", "entries"], "Game command journal");
    const rawEntries = checkpointDataField(descriptors, "entries", "Game command journal");
    const entryValues = journalArrayItems(rawEntries, "Game command journal entries");
    if (entryValues.length > GAME_COMMAND_JOURNAL_LIMITS.entries) {
        throw new Error("Game command journal entries exceed the entry limit.");
    }
    assertJournalTotalBudget(options.journal);
    const contentDigest = checkpointDataField(descriptors, "contentDigest", "Game command journal");
    if (typeof contentDigest !== "string" || contentDigest !== getSimulationContentDigest(options.content)) {
        throw new Error("Game command journal content digest mismatch.");
    }
    const initialCheckpoint = TowerDefenseGame.validateCheckpoint({
        content: options.content,
        checkpoint: checkpointDataField(descriptors, "initialCheckpoint", "Game command journal")
    });
    if (initialCheckpoint.contentDigest !== contentDigest) {
        throw new Error("Game command journal and initial checkpoint content digests differ.");
    }
    const entries = [];
    for (let index = 0; index < entryValues.length; index += 1) {
        const entryDescriptors = checkpointObjectDescriptors(entryValues[index], `Game command journal entry ${index}`);
        requireExactCheckpointKeys(entryDescriptors, ["sequence", "command", "result", "postStateDigest"], `Game command journal entry ${index}`);
        const sequence = checkpointDataField(entryDescriptors, "sequence", `Game command journal entry ${index}`);
        if (sequence !== index) {
            throw new Error(`Game command journal sequence must be contiguous at entry ${index}.`);
        }
        const rawCommand = checkpointDataField(entryDescriptors, "command", `Game command journal entry ${index}`);
        let command;
        try {
            command = parseGameCommand(rawCommand);
        }
        catch {
            command = undefined;
        }
        if (!command) {
            throw new Error(`Game command journal entry ${index} contains an invalid command.`);
        }
        if (schemaVersion === 1 && command.schemaVersion !== 1) {
            throw new Error(`Game command journal v1 entry ${index} must contain a v1 command.`);
        }
        if (schemaVersion === 2 && command.schemaVersion > 2) {
            throw new Error(`Game command journal v2 entry ${index} cannot contain a later command.`);
        }
        if (schemaVersion === 3 && command.schemaVersion > 3) {
            throw new Error(`Game command journal v3 entry ${index} cannot contain a later command.`);
        }
        if (schemaVersion === 4 && command.schemaVersion > 4) {
            throw new Error(`Game command journal v4 entry ${index} cannot contain a later command.`);
        }
        if (schemaVersion === 5 && command.schemaVersion > 5) {
            throw new Error(`Game command journal v5 entry ${index} cannot contain a later command.`);
        }
        const result = decodeResult(checkpointDataField(entryDescriptors, "result", `Game command journal entry ${index}`));
        const postStateDigest = checkpointDataField(entryDescriptors, "postStateDigest", `Game command journal entry ${index}`);
        if (typeof postStateDigest !== "string" || !STATE_DIGEST_RE.test(postStateDigest)) {
            throw new Error(`Game command journal entry ${index} has an invalid state digest.`);
        }
        entries.push({ sequence: index, command, result, postStateDigest });
    }
    const decoded = detachedJournal(initialCheckpoint, contentDigest, entries, schemaVersion);
    assertJournalTotalBudget(decoded);
    return decoded;
}
