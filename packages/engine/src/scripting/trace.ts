import type {
  TowerScriptAction,
  TowerScriptDiagnostic,
  TowerScriptEventName,
  TowerScriptJson
} from "./types.js";
import { canonicalStringify } from "../simulation/stable-digest.js";

export const TOWER_SCRIPT_TRACE_SCHEMA_VERSION = 1 as const;

export type TowerScriptTracePhase =
  | "event"
  | "binding"
  | "handler"
  | "condition"
  | "action"
  | "state_diff"
  | "diagnostic";

export type TowerScriptStateChangeV1 = Readonly<{
  op: "add" | "remove" | "replace";
  path: string;
  before?: TowerScriptJson;
  after?: TowerScriptJson;
}>;

interface TowerScriptTraceEntryBaseV1 {
  readonly schemaVersion: typeof TOWER_SCRIPT_TRACE_SCHEMA_VERSION;
  readonly sequence: number;
  readonly parentSequence?: number;
  readonly phase: TowerScriptTracePhase;
  readonly eventName?: TowerScriptEventName;
  readonly scriptId?: string;
  readonly bindingIndex?: number;
  readonly contextId?: string;
  readonly handlerId?: string;
  readonly handlerIndex?: number;
  readonly actionIndex?: number;
  /** Absolute action occurrence before this entry, stable across bounded eviction. */
  readonly actionsBefore?: number;
  /** Absolute action occurrence of an action entry, stable across bounded eviction. */
  readonly actionOrdinal?: number;
  /** Absolute occurrence within this phase, stable across bounded eviction. */
  readonly phaseOrdinal: number;
}

export type TowerScriptTraceEntryV1 = Readonly<TowerScriptTraceEntryBaseV1 & {
  readonly event?: Readonly<Record<string, TowerScriptJson>>;
  readonly scope?: string;
  readonly result?: boolean;
  readonly action?: TowerScriptAction;
  readonly changes?: readonly TowerScriptStateChangeV1[];
  readonly diagnostic?: TowerScriptDiagnostic;
}>;

export interface TowerScriptTraceSnapshotV1 {
  readonly schemaVersion: typeof TOWER_SCRIPT_TRACE_SCHEMA_VERSION;
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly retainedBytes: number;
  readonly droppedEntries: number;
  readonly totalEntries: number;
  readonly totalActions: number;
  readonly phaseTotals: Readonly<Record<TowerScriptTracePhase, number>>;
  readonly entries: readonly TowerScriptTraceEntryV1[];
}

export interface TowerScriptTraceCollector {
  readonly maxEntries: number;
  readonly maxBytes: number;
  record(entry: Omit<TowerScriptTraceEntryV1, "schemaVersion" | "sequence" | "actionsBefore" | "actionOrdinal" | "phaseOrdinal">): TowerScriptTraceEntryV1;
  clear(): void;
  getSnapshot(): TowerScriptTraceSnapshotV1;
  /** Internal debugger control-flow check; ordinary collectors always return false. */
  shouldPauseAfterAction(sequence: number): boolean;
  /** Internal debugger control-flow check for pre-event/pre-handler boundaries. */
  shouldPauseBeforeEntry(sequence: number): boolean;
}

const MIN_TRACE_ENTRIES = 1;
const MAX_TRACE_ENTRIES = 16_384;
const MIN_TRACE_BYTES = 1_024;
const MAX_TRACE_BYTES = 16 * 1024 * 1024;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first <= 0x7f) bytes += 1;
    else if (first <= 0x7ff) bytes += 2;
    else if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function jsonClone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(canonicalStringify(value, {
    maxDepth: 64,
    maxNodes: 100_000,
    maxBytes: 2 * 1024 * 1024
  })) as T;
}

export function createTowerScriptTraceCollector(options: {
  readonly maxEntries: number;
  readonly maxBytes?: number;
  /** Zero-based action occurrence inside one replayed command. */
  readonly pauseAfterAction?: number;
  /** Zero-based phase occurrence inside one replayed command. */
  readonly pauseBefore?: Readonly<{ phase: "event" | "handler"; occurrence: number }>;
}): TowerScriptTraceCollector {
  const maxEntries = options?.maxEntries;
  if (!Number.isInteger(maxEntries) || maxEntries < MIN_TRACE_ENTRIES || maxEntries > MAX_TRACE_ENTRIES) {
    throw new Error(`TowerScript trace maxEntries must be an integer ${MIN_TRACE_ENTRIES}..${MAX_TRACE_ENTRIES}.`);
  }
  const maxBytes = options.maxBytes ?? Math.min(MAX_TRACE_BYTES, Math.max(256 * 1024, maxEntries * 4_096));
  if (!Number.isInteger(maxBytes) || maxBytes < MIN_TRACE_BYTES || maxBytes > MAX_TRACE_BYTES) {
    throw new Error(`TowerScript trace maxBytes must be an integer ${MIN_TRACE_BYTES}..${MAX_TRACE_BYTES}.`);
  }
  let nextSequence = 0;
  let entries: TowerScriptTraceEntryV1[] = [];
  let entryBytes: number[] = [];
  let retainedBytes = 0;
  let nextActionOccurrence = 0;
  let phaseTotals: Record<TowerScriptTracePhase, number> = {
    event: 0,
    binding: 0,
    handler: 0,
    condition: 0,
    action: 0,
    state_diff: 0,
    diagnostic: 0
  };
  let pauseSequence: number | undefined;
  let pauseBeforeSequence: number | undefined;
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

  return Object.freeze({
    maxEntries,
    maxBytes,
    record(input: Omit<TowerScriptTraceEntryV1, "schemaVersion" | "sequence" | "actionsBefore" | "actionOrdinal" | "phaseOrdinal">) {
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
      const entry = Object.freeze(JSON.parse(serialized)) as TowerScriptTraceEntryV1;
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
      if (entry.phase === "action") {
        if (options.pauseAfterAction === nextActionOccurrence) pauseSequence = entry.sequence;
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
        action: 0,
        state_diff: 0,
        diagnostic: 0
      };
      pauseSequence = undefined;
      pauseBeforeSequence = undefined;
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
    shouldPauseAfterAction(sequence: number) {
      return pauseSequence === sequence;
    },
    shouldPauseBeforeEntry(sequence: number) {
      return pauseBeforeSequence === sequence;
    }
  });
}

/** Debugger-only control flow. The runtime must never convert it to a gameplay diagnostic. */
export class TowerScriptTracePauseError extends Error {
  readonly code = "TOWER_SCRIPT_TRACE_PAUSE" as const;
  readonly actionSequence: number;

  constructor(actionSequence: number) {
    super(`TowerScript debug replay paused after action trace ${actionSequence}.`);
    this.name = "TowerScriptTracePauseError";
    this.actionSequence = actionSequence;
  }
}

function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isRecord(value: TowerScriptJson | undefined): value is { [key: string]: TowerScriptJson } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameJson(left: TowerScriptJson | undefined, right: TowerScriptJson | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function diffTowerScriptState(
  before: Readonly<Record<string, TowerScriptJson>>,
  after: Readonly<Record<string, TowerScriptJson>>
): readonly TowerScriptStateChangeV1[] {
  const changes: TowerScriptStateChangeV1[] = [];
  const visit = (left: TowerScriptJson | undefined, right: TowerScriptJson | undefined, path: string, hasLeft: boolean, hasRight: boolean): void => {
    if (!hasLeft) {
      changes.push(Object.freeze({ op: "add", path, after: jsonClone(right as TowerScriptJson) }));
      return;
    }
    if (!hasRight) {
      changes.push(Object.freeze({ op: "remove", path, before: jsonClone(left as TowerScriptJson) }));
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
        before: jsonClone(left as TowerScriptJson),
        after: jsonClone(right as TowerScriptJson)
      }));
    }
  };
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const key of keys) {
    visit(before[key], after[key], `/${pointerToken(key)}`, Object.hasOwn(before, key), Object.hasOwn(after, key));
  }
  return Object.freeze(changes);
}
