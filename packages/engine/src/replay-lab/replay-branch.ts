import type { GameContentRegistry } from "../content/registry.js";
import type { GameCommand } from "../simulation/command-internal.js";
import { cloneCheckpointJson } from "../simulation/checkpoint.js";
import {
  decodeGameCommandJournal,
  JournaledGameSession,
  type GameCommandJournal
} from "../simulation/journal.js";
import { replayGameCommandJournal } from "../simulation/replay.js";
import { canonicalStringify, getSimulationContentDigest } from "../simulation/stable-digest.js";
import {
  replayArchiveContentV1,
  replayLabDomainDigestV1,
  type DecodedReplayArchiveV1
} from "./replay-archive.js";

const BRANCH_DIGEST_DOMAIN = "towerforge:replay-branch:v1\u0000";

export interface ReplayBranchV1 {
  readonly schemaVersion: 1;
  readonly parentArchiveDigest: string;
  readonly forkSequence: number;
  readonly journalSuffix: GameCommandJournal;
  readonly branchDigest: string;
}

export interface ReplayBranchResultV1 {
  readonly branchDigest: string;
  readonly stateDigest: string;
  readonly entriesReplayed: number;
}

export type ReplayBranchDivergenceV1 =
  | Readonly<{ schemaVersion: 1; divergent: false }>
  | Readonly<{
      schemaVersion: 1;
      divergent: true;
      firstDivergentSequence: number;
      parentStateDigest: string;
      branchStateDigest: string;
    }>;

type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;

function objectDescriptors(value: unknown, context: string): DescriptorMap {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${context} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as DescriptorMap;
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

function data(descriptors: DescriptorMap, key: string, context: string): unknown {
  const descriptor = descriptors[key];
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new Error(`${context} field "${key}" must be an enumerable data property.`);
  }
  return descriptor.value;
}

function requireExact(descriptors: DescriptorMap, keys: readonly string[], context: string): void {
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${context} contains missing or unsupported fields.`);
  }
}

function deepFreezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function parentPrefix(journal: GameCommandJournal, sequence: number): GameCommandJournal {
  return {
    ...journal,
    entries: journal.entries.slice(0, sequence)
  } as GameCommandJournal;
}

function assertArchiveContent(
  content: GameContentRegistry,
  archive: DecodedReplayArchiveV1
): void {
  if (!replayArchiveContentV1(archive)) {
    throw new Error("Replay branch requires an engine-decoded parent archive.");
  }
  if (archive.contentDigest !== getSimulationContentDigest(content)) {
    throw new Error("Replay branch parent content digest provenance mismatch.");
  }
}

function commandItems(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error("Replay branch commands must be a plain array.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as DescriptorMap;
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new Error("Replay branch commands reject symbol fields.");
  }
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 100_000
    || Object.keys(descriptors).length !== length + 1) {
    throw new Error("Replay branch commands are sparse or exceed the entry limit.");
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("Replay branch commands must contain enumerable data entries.");
    }
    result.push(descriptor.value);
  }
  return result;
}

function digestPayload(branch: Omit<ReplayBranchV1, "branchDigest">): string {
  return replayLabDomainDigestV1(
    "tf-replay-branch-v1",
    BRANCH_DIGEST_DOMAIN,
    canonicalStringify(branch, { maxBytes: 72 * 1_024 * 1_024, maxNodes: 6_600_000 })
  );
}

function validateBranch(options: {
  readonly content: GameContentRegistry;
  readonly archive: DecodedReplayArchiveV1;
  readonly branch: unknown;
}): ReplayBranchV1 {
  assertArchiveContent(options.content, options.archive);
  const context = "Replay branch";
  const descriptors = objectDescriptors(options.branch, context);
  const schemaVersion = data(descriptors, "schemaVersion", context);
  if (schemaVersion !== 1) throw new Error("Replay branch schema version is unsupported.");
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
  if (!Number.isSafeInteger(forkSequence) || (forkSequence as number) < 0
    || (forkSequence as number) > options.archive.journal.entries.length) {
    throw new Error("Replay branch fork sequence is outside the parent range.");
  }
  const journalSuffix = decodeGameCommandJournal({
    content: options.content,
    journal: data(descriptors, "journalSuffix", context) as GameCommandJournal
  });
  const parent = replayGameCommandJournal({
    content: options.content,
    journal: parentPrefix(options.archive.journal, forkSequence as number)
  });
  if (canonicalStringify(journalSuffix.initialCheckpoint)
    !== canonicalStringify(parent.game.createCheckpoint())) {
    throw new Error("Replay branch journal suffix checkpoint does not match its fork provenance.");
  }
  const branchWithoutDigest = {
    schemaVersion: 1 as const,
    parentArchiveDigest: parentArchiveDigest as string,
    forkSequence: forkSequence as number,
    journalSuffix
  };
  const branchDigest = data(descriptors, "branchDigest", context);
  if (branchDigest !== digestPayload(branchWithoutDigest)) {
    throw new Error("Replay branch digest mismatch.");
  }
  return deepFreezeJson({ ...branchWithoutDigest, branchDigest: branchDigest as string });
}

export function createReplayBranchV1(options: {
  readonly content: GameContentRegistry;
  readonly archive: DecodedReplayArchiveV1;
  readonly forkSequence: number;
  readonly commands: readonly GameCommand[];
}): ReplayBranchV1 {
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
    schemaVersion: 1 as const,
    parentArchiveDigest: options.archive.archiveDigest,
    forkSequence: options.forkSequence,
    journalSuffix
  };
  return deepFreezeJson({
    ...branchWithoutDigest,
    branchDigest: digestPayload(branchWithoutDigest)
  });
}

export function replayReplayBranchV1(options: {
  readonly content: GameContentRegistry;
  readonly archive: DecodedReplayArchiveV1;
  readonly branch: unknown;
}): ReplayBranchResultV1 {
  const branch = validateBranch(options);
  const replay = replayGameCommandJournal({ content: options.content, journal: branch.journalSuffix });
  return Object.freeze({
    branchDigest: branch.branchDigest,
    stateDigest: replay.stateDigest,
    entriesReplayed: replay.entriesReplayed
  });
}

function parentStateDigestAt(archive: DecodedReplayArchiveV1, sequence: number): string {
  if (sequence <= 0 || archive.journal.entries.length === 0) {
    return archive.journal.initialCheckpoint.stateDigest;
  }
  return archive.journal.entries[Math.min(sequence, archive.journal.entries.length) - 1]!.postStateDigest;
}

function branchStateDigestAt(branch: ReplayBranchV1, sequence: number): string {
  if (sequence <= branch.forkSequence) return "";
  const localSequence = Math.min(
    sequence - branch.forkSequence,
    branch.journalSuffix.entries.length
  );
  if (localSequence <= 0) return branch.journalSuffix.initialCheckpoint.stateDigest;
  return branch.journalSuffix.entries[localSequence - 1]!.postStateDigest;
}

export function diagnoseReplayBranchDivergenceV1(options: {
  readonly content: GameContentRegistry;
  readonly archive: DecodedReplayArchiveV1;
  readonly branch: unknown;
}): ReplayBranchDivergenceV1 {
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
        schemaVersion: 1 as const,
        divergent: true as const,
        firstDivergentSequence: sequence,
        parentStateDigest: parentDigest,
        branchStateDigest: branchDigest || branch.journalSuffix.initialCheckpoint.stateDigest
      });
    }
  }
  return Object.freeze({ schemaVersion: 1 as const, divergent: false as const });
}
