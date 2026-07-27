import type { GameContentRegistry } from "../content/registry.js";
import { executeParsedGameCommand } from "./command-internal.js";
import { cloneCheckpointJson } from "./checkpoint.js";
import {
  decodeGameCommandJournal,
  type GameCommandJournalResultV1,
  type GameCommandJournal
} from "./journal.js";
import { normalizeGameCommandJournalResult } from "./journal-result-internal.js";
import { canonicalStringify } from "./stable-digest.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

export type GameCommandReplayDivergenceKind = "result" | "postStateDigest";

type GameCommandReplayDivergenceDetails =
  | {
      readonly kind: "result";
      readonly sequence: number;
      readonly expected: GameCommandJournalResultV1;
      readonly actual: GameCommandJournalResultV1;
    }
  | {
      readonly kind: "postStateDigest";
      readonly sequence: number;
      readonly expected: string;
      readonly actual: string;
    };

function detachedFrozenResult(
  value: GameCommandJournalResultV1
): GameCommandJournalResultV1 {
  const clone = cloneCheckpointJson(value) as {
    ok: boolean;
    reasonKey?: string;
    reasonParams?: Record<string, string | number>;
  };
  if (clone.reasonParams) Object.freeze(clone.reasonParams);
  return Object.freeze(clone);
}

export class GameCommandReplayDivergenceError extends Error {
  readonly code = "GAME_COMMAND_REPLAY_DIVERGENCE" as const;
  readonly kind: GameCommandReplayDivergenceKind;
  readonly sequence: number;
  readonly expected: GameCommandJournalResultV1 | string;
  readonly actual: GameCommandJournalResultV1 | string;

  constructor(details: GameCommandReplayDivergenceDetails) {
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
  readonly code = "GAME_COMMAND_REPLAY_EXECUTION_FAILED" as const;
  readonly sequence: number;
  override readonly cause: unknown;

  constructor(sequence: number, cause: unknown) {
    super(`Game command replay execution failed at sequence ${sequence}.`, { cause });
    this.name = "GameCommandReplayExecutionError";
    this.sequence = sequence;
    this.cause = cause;
    Object.freeze(this);
  }
}

export interface GameCommandReplayResult {
  readonly game: TowerDefenseGame;
  readonly entriesReplayed: number;
  readonly stateDigest: string;
}

/**
 * Validate a complete journal before creating a map, then replay each already
 * canonical command exactly once while checking result before post-state digest.
 */
export function replayGameCommandJournal(options: {
  content: GameContentRegistry;
  journal: GameCommandJournal;
}): GameCommandReplayResult {
  const journal = decodeGameCommandJournal(options);
  const game = TowerDefenseGame.fromCheckpoint({
    content: options.content,
    checkpoint: journal.initialCheckpoint
  });
  let stateDigest = journal.initialCheckpoint.stateDigest;

  for (const entry of journal.entries) {
    let actualResult: GameCommandJournalResultV1;
    try {
      actualResult = normalizeGameCommandJournalResult(
        executeParsedGameCommand(game, entry.command)
      );
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
      stateDigest = game.getStateDigest();
    } catch (cause) {
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
