import { executeParsedGameCommand } from "../simulation/command-internal.js";
import { normalizeGameCommandJournalResult } from "../simulation/journal-result-internal.js";
import {
  GameCommandReplayDivergenceError,
  GameCommandReplayExecutionError,
  replayGameCommandJournal
} from "../simulation/replay.js";
import { canonicalStringify } from "../simulation/stable-digest.js";
import type { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";
import type { GameSnapshot } from "../simulation/types.js";
import type { GameCommandJournal } from "../simulation/journal.js";
import {
  replayArchiveContentV1,
  type DecodedReplayArchiveV1
} from "./replay-archive.js";

export const GHOST_REPLAY_LIMITS = Object.freeze({
  maximumCachedFrames: 256
});

export interface GhostReplayFrameV1 {
  readonly schemaVersion: 1;
  readonly ghost: true;
  /** Number of journal entries replayed into this frame, in the inclusive range 0..N. */
  readonly sequence: number;
  readonly stateDigest: string;
  readonly snapshot: GameSnapshot;
}

export interface GhostReplaySessionV1 {
  seek(sequence: number): GhostReplayFrameV1;
  advance(): GhostReplayFrameV1;
  final(): GhostReplayFrameV1;
}

function deepFreezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function journalPrefix(journal: GameCommandJournal, sequence: number): GameCommandJournal {
  return {
    ...journal,
    entries: journal.entries.slice(0, sequence)
  } as GameCommandJournal;
}

export function createGhostReplaySessionV1(options: {
  readonly archive: DecodedReplayArchiveV1;
}): GhostReplaySessionV1 {
  const content = replayArchiveContentV1(options.archive);
  if (!content) {
    throw new Error("Ghost replay requires an engine-decoded replay archive.");
  }
  const journal = options.archive.journal;
  const finalSequence = journal.entries.length;
  const frames = new Map<number, GhostReplayFrameV1>();
  let currentSequence = 0;

  const initialReplay = () => replayGameCommandJournal({
    content,
    journal: journalPrefix(journal, 0)
  });
  let liveGame: TowerDefenseGame;
  let liveSequence: number;
  let liveStateDigest: string;

  const resetLiveRuntime = (): void => {
    const replay = initialReplay();
    liveGame = replay.game;
    liveSequence = 0;
    liveStateDigest = replay.stateDigest;
  };
  resetLiveRuntime();

  const advanceLiveRuntime = (): void => {
    const entry = journal.entries[liveSequence];
    if (!entry) return;
    let actualResult;
    try {
      actualResult = normalizeGameCommandJournalResult(executeParsedGameCommand(liveGame, entry.command));
    } catch (cause) {
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
    } catch (cause) {
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

  const positionLiveRuntime = (sequence: number): void => {
    if (sequence < liveSequence) resetLiveRuntime();
    while (liveSequence < sequence) advanceLiveRuntime();
  };

  const frameAt = (sequence: number): GhostReplayFrameV1 => {
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
      schemaVersion: 1 as const,
      ghost: true as const,
      sequence,
      stateDigest: liveStateDigest,
      snapshot
    });
    frames.set(sequence, frame);
    while (frames.size > GHOST_REPLAY_LIMITS.maximumCachedFrames) {
      const oldest = frames.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      frames.delete(oldest);
    }
    return frame;
  };

  const session: GhostReplaySessionV1 = {
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
