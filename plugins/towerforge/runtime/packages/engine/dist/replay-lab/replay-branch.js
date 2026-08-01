import { decodeGameCommandJournal, JournaledGameSession } from "../simulation/journal.js";
import { replayGameCommandJournal } from "../simulation/replay.js";
import { canonicalStringify, getSimulationContentDigest } from "../simulation/stable-digest.js";
import { replayArchiveContentV1, replayLabDomainDigestV1 } from "./replay-archive.js";
const BRANCH_DIGEST_DOMAIN = "towerforge:replay-branch:v1\u0000";
function objectDescriptors(value, context) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error(`${context} must be a plain object.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error(`${context} rejects symbol fields.`);
    }
    for (const descriptor of Object.values(descriptors)) {
        if (!("value" in descriptor) || !descriptor.enumerable) {
            throw new Error(`${context} fields must be enumerable data properties.`);
        }
    }
    return descriptors;
}
function data(descriptors, key, context) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error(`${context} field "${key}" must be an enumerable data property.`);
    }
    return descriptor.value;
}
function requireExact(descriptors, keys, context) {
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new Error(`${context} contains missing or unsupported fields.`);
    }
}
function deepFreezeJson(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreezeJson(child);
        Object.freeze(value);
    }
    return value;
}
function parentPrefix(journal, sequence) {
    return {
        ...journal,
        entries: journal.entries.slice(0, sequence)
    };
}
function assertArchiveContent(content, archive) {
    if (!replayArchiveContentV1(archive)) {
        throw new Error("Replay branch requires an engine-decoded parent archive.");
    }
    if (archive.contentDigest !== getSimulationContentDigest(content)) {
        throw new Error("Replay branch parent content digest provenance mismatch.");
    }
}
function commandItems(value) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error("Replay branch commands must be a plain array.");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error("Replay branch commands reject symbol fields.");
    }
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 100_000
        || Object.keys(descriptors).length !== length + 1) {
        throw new Error("Replay branch commands are sparse or exceed the entry limit.");
    }
    const result = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new Error("Replay branch commands must contain enumerable data entries.");
        }
        result.push(descriptor.value);
    }
    return result;
}
function digestPayload(branch) {
    return replayLabDomainDigestV1("tf-replay-branch-v1", BRANCH_DIGEST_DOMAIN, canonicalStringify(branch, { maxBytes: 72 * 1_024 * 1_024, maxNodes: 6_600_000 }));
}
function validateBranch(options) {
    assertArchiveContent(options.content, options.archive);
    const context = "Replay branch";
    const descriptors = objectDescriptors(options.branch, context);
    const schemaVersion = data(descriptors, "schemaVersion", context);
    if (schemaVersion !== 1)
        throw new Error("Replay branch schema version is unsupported.");
    requireExact(descriptors, [
        "schemaVersion",
        "parentArchiveDigest",
        "forkSequence",
        "journalSuffix",
        "branchDigest"
    ], context);
    const parentArchiveDigest = data(descriptors, "parentArchiveDigest", context);
    if (parentArchiveDigest !== options.archive.archiveDigest) {
        throw new Error("Replay branch parent archive digest provenance mismatch.");
    }
    const forkSequence = data(descriptors, "forkSequence", context);
    if (!Number.isSafeInteger(forkSequence) || forkSequence < 0
        || forkSequence > options.archive.journal.entries.length) {
        throw new Error("Replay branch fork sequence is outside the parent range.");
    }
    const journalSuffix = decodeGameCommandJournal({
        content: options.content,
        journal: data(descriptors, "journalSuffix", context)
    });
    const parent = replayGameCommandJournal({
        content: options.content,
        journal: parentPrefix(options.archive.journal, forkSequence)
    });
    if (canonicalStringify(journalSuffix.initialCheckpoint)
        !== canonicalStringify(parent.game.createCheckpoint())) {
        throw new Error("Replay branch journal suffix checkpoint does not match its fork provenance.");
    }
    const branchWithoutDigest = {
        schemaVersion: 1,
        parentArchiveDigest: parentArchiveDigest,
        forkSequence: forkSequence,
        journalSuffix
    };
    const branchDigest = data(descriptors, "branchDigest", context);
    if (branchDigest !== digestPayload(branchWithoutDigest)) {
        throw new Error("Replay branch digest mismatch.");
    }
    return deepFreezeJson({ ...branchWithoutDigest, branchDigest: branchDigest });
}
export function createReplayBranchV1(options) {
    assertArchiveContent(options.content, options.archive);
    if (!Number.isSafeInteger(options.forkSequence) || options.forkSequence < 0
        || options.forkSequence > options.archive.journal.entries.length) {
        throw new Error("Replay branch fork sequence is outside the parent range.");
    }
    const commands = commandItems(options.commands);
    const prefix = replayGameCommandJournal({
        content: options.content,
        journal: parentPrefix(options.archive.journal, options.forkSequence)
    });
    const session = new JournaledGameSession(prefix.game);
    for (let index = 0; index < commands.length; index += 1) {
        session.dispatch(commands[index]);
        if (session.getAcceptedTail().entryCount !== index + 1) {
            throw new Error(`Replay branch command ${index} is invalid and was not journaled.`);
        }
    }
    const journalSuffix = session.exportJournal();
    const branchWithoutDigest = {
        schemaVersion: 1,
        parentArchiveDigest: options.archive.archiveDigest,
        forkSequence: options.forkSequence,
        journalSuffix
    };
    return deepFreezeJson({
        ...branchWithoutDigest,
        branchDigest: digestPayload(branchWithoutDigest)
    });
}
export function replayReplayBranchV1(options) {
    const branch = validateBranch(options);
    const replay = replayGameCommandJournal({ content: options.content, journal: branch.journalSuffix });
    return Object.freeze({
        branchDigest: branch.branchDigest,
        stateDigest: replay.stateDigest,
        entriesReplayed: replay.entriesReplayed
    });
}
function parentStateDigestAt(archive, sequence) {
    if (sequence <= 0 || archive.journal.entries.length === 0) {
        return archive.journal.initialCheckpoint.stateDigest;
    }
    return archive.journal.entries[Math.min(sequence, archive.journal.entries.length) - 1].postStateDigest;
}
function branchStateDigestAt(branch, sequence) {
    if (sequence <= branch.forkSequence)
        return "";
    const localSequence = Math.min(sequence - branch.forkSequence, branch.journalSuffix.entries.length);
    if (localSequence <= 0)
        return branch.journalSuffix.initialCheckpoint.stateDigest;
    return branch.journalSuffix.entries[localSequence - 1].postStateDigest;
}
export function diagnoseReplayBranchDivergenceV1(options) {
    const branch = validateBranch(options);
    // Full replay first proves every suffix result/digest before diagnostics are exposed.
    replayGameCommandJournal({ content: options.content, journal: branch.journalSuffix });
    const parentFinal = options.archive.journal.entries.length;
    const branchFinal = branch.forkSequence + branch.journalSuffix.entries.length;
    const final = Math.max(parentFinal, branchFinal);
    for (let sequence = branch.forkSequence + 1; sequence <= final; sequence += 1) {
        const parentDigest = parentStateDigestAt(options.archive, sequence);
        const branchDigest = branchStateDigestAt(branch, sequence);
        const parentEntry = options.archive.journal.entries[sequence - 1];
        const branchEntry = branch.journalSuffix.entries[sequence - branch.forkSequence - 1];
        const commandDiffers = parentEntry !== undefined && branchEntry !== undefined
            && canonicalStringify(parentEntry.command) !== canonicalStringify(branchEntry.command);
        if (sequence > parentFinal || sequence > branchFinal || commandDiffers || parentDigest !== branchDigest) {
            return Object.freeze({
                schemaVersion: 1,
                divergent: true,
                firstDivergentSequence: sequence,
                parentStateDigest: parentDigest,
                branchStateDigest: branchDigest || branch.journalSuffix.initialCheckpoint.stateDigest
            });
        }
    }
    return Object.freeze({ schemaVersion: 1, divergent: false });
}
