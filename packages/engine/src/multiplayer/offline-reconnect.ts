import type { GameContentRegistry } from "../content/registry.js";
import { cloneCheckpointJson, type GameCheckpointV1 } from "../simulation/checkpoint.js";
import type { GameSeed } from "../simulation/rng.js";
import { canonicalStringify, stableDigest } from "../simulation/stable-digest.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";
import {
  MULTIPLAYER_LIMITS
} from "../content/multiplayer-mechanics.js";
import {
  MATCH_PROTOCOL_VERSION,
  type MatchChecksumTimelineV1,
  type MatchCommandJournalV1,
  MatchSession,
  replayMatchCommandJournal
} from "./match-session.js";

export interface OfflineChallengeV1 {
  readonly schemaVersion: 1;
  readonly challengeId: string;
  readonly seed: GameSeed;
  readonly journal: MatchCommandJournalV1;
  readonly expectedChecksum: string;
  readonly checksum: string;
}

export interface MatchReconnectBundleV1 {
  readonly schemaVersion: 1;
  readonly protocolVersion: 1;
  readonly checkpoint: GameCheckpointV1;
  readonly acceptedJournal: MatchCommandJournalV1;
  readonly checksum: string;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim()
    && new TextEncoder().encode(value).length <= MULTIPLAYER_LIMITS.idUtf8Bytes;
}

function challengeChecksum(payload: Omit<OfflineChallengeV1, "checksum">): string {
  return stableDigest(payload).replace(/^tf-state-v1:/, "tf-challenge-v1:");
}

/** Bind a replayable local match to the published challenge seed and final checksum. */
export function createOfflineChallengeV1(options: {
  readonly challengeId: string;
  readonly seed: GameSeed;
  readonly session: MatchSession;
}): OfflineChallengeV1 {
  if (!validId(options.challengeId)) throw new Error("Offline challenge id is invalid.");
  const payload = {
    schemaVersion: 1 as const,
    challengeId: options.challengeId,
    seed: options.seed,
    journal: options.session.exportJournal(),
    expectedChecksum: options.session.getSnapshot().checksum
  };
  return cloneCheckpointJson({ ...payload, checksum: challengeChecksum(payload) });
}

export function replayOfflineChallengeV1(options: {
  readonly content: GameContentRegistry;
  readonly challenge: OfflineChallengeV1;
}): Readonly<{ verified: true; checksum: string; session: MatchSession }> {
  const challenge = cloneCheckpointJson(options.challenge);
  const { checksum, ...payload } = challenge;
  if (challenge.schemaVersion !== 1 || !validId(challenge.challengeId)
    || checksum !== challengeChecksum(payload)) {
    throw new Error("Offline challenge checksum is invalid.");
  }
  const seededInitial = new TowerDefenseGame({
    content: options.content,
    missionId: challenge.journal.initialCheckpoint.identity.missionId,
    seed: challenge.seed
  }).createCheckpoint();
  if (canonicalStringify(seededInitial) !== canonicalStringify(challenge.journal.initialCheckpoint)) {
    throw new Error("Offline challenge seed does not match its complete initial checkpoint.");
  }
  const replay = replayMatchCommandJournal({ content: options.content, journal: challenge.journal });
  if (replay.checksum !== challenge.expectedChecksum) {
    throw new Error("Offline challenge replay diverged from its expected checksum.");
  }
  return Object.freeze({ verified: true as const, checksum: replay.checksum, session: replay.session });
}

/** Export the authoritative engine checkpoint plus the accepted protocol journal. */
export function createMatchReconnectBundleV1(session: MatchSession): MatchReconnectBundleV1 {
  return cloneCheckpointJson({
    schemaVersion: 1,
    protocolVersion: MATCH_PROTOCOL_VERSION,
    checkpoint: session.game.createCheckpoint(),
    acceptedJournal: session.exportJournal(),
    checksum: session.getSnapshot().checksum
  });
}

/** Restore via deterministic journal replay and verify its current checkpoint before continuing. */
export function restoreMatchReconnectBundleV1(options: {
  readonly content: GameContentRegistry;
  readonly bundle: MatchReconnectBundleV1;
}): MatchSession {
  const bundle = cloneCheckpointJson(options.bundle);
  if (bundle.schemaVersion !== 1 || bundle.protocolVersion !== MATCH_PROTOCOL_VERSION) {
    throw new Error("Unsupported reconnect bundle.");
  }
  const replay = replayMatchCommandJournal({ content: options.content, journal: bundle.acceptedJournal });
  if (replay.checksum !== bundle.checksum
    || canonicalStringify(replay.session.game.createCheckpoint()) !== canonicalStringify(bundle.checkpoint)) {
    throw new Error("Reconnect checkpoint and accepted journal diverged.");
  }
  return replay.session;
}

export interface MatchDesyncDiagnosticV1 {
  readonly schemaVersion: 1;
  readonly divergent: boolean;
  readonly firstDivergentTick?: number;
  readonly localChecksum?: string;
  readonly remoteChecksum?: string;
}

/** Return the earliest unequal or missing fixed-tick checksum frame. */
export function diagnoseMatchDesyncV1(
  local: MatchChecksumTimelineV1,
  remote: MatchChecksumTimelineV1
): MatchDesyncDiagnosticV1 {
  if (local.schemaVersion !== 1 || remote.schemaVersion !== 1) throw new Error("Unsupported checksum timeline.");
  const validate = (timeline: MatchChecksumTimelineV1) => {
    if (!Array.isArray(timeline.frames)) throw new Error("Checksum timeline frames must be an array.");
    for (let index = 0; index < timeline.frames.length; index += 1) {
      const frame = timeline.frames[index];
      if (!frame || frame.tick !== index || !/^tf-match-v1:[0-9a-f]{16}$/.test(frame.checksum)) {
        throw new Error("Checksum timeline must be contiguous, canonical and checksummed.");
      }
    }
  };
  validate(local);
  validate(remote);
  const localByTick = new Map(local.frames.map((frame) => [frame.tick, frame.checksum]));
  const remoteByTick = new Map(remote.frames.map((frame) => [frame.tick, frame.checksum]));
  const ticks = [...new Set([...localByTick.keys(), ...remoteByTick.keys()])].sort((left, right) => left - right);
  for (const tick of ticks) {
    const localChecksum = localByTick.get(tick);
    const remoteChecksum = remoteByTick.get(tick);
    if (localChecksum !== remoteChecksum) {
      return Object.freeze({
        schemaVersion: 1 as const,
        divergent: true,
        firstDivergentTick: tick,
        ...(localChecksum === undefined ? {} : { localChecksum }),
        ...(remoteChecksum === undefined ? {} : { remoteChecksum })
      });
    }
  }
  return Object.freeze({ schemaVersion: 1 as const, divergent: false });
}
