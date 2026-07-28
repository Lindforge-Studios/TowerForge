import { cloneCheckpointJson } from "../simulation/checkpoint.js";
import { canonicalStringify, stableDigest } from "../simulation/stable-digest.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";
import { MULTIPLAYER_LIMITS } from "../content/multiplayer-mechanics.js";
import { MATCH_PROTOCOL_VERSION, replayMatchCommandJournal } from "./match-session.js";
function validId(value) {
    return typeof value === "string" && value.length > 0 && value === value.trim()
        && new TextEncoder().encode(value).length <= MULTIPLAYER_LIMITS.idUtf8Bytes;
}
function challengeChecksum(payload) {
    return stableDigest(payload).replace(/^tf-state-v1:/, "tf-challenge-v1:");
}
/** Bind a replayable local match to the published challenge seed and final checksum. */
export function createOfflineChallengeV1(options) {
    if (!validId(options.challengeId))
        throw new Error("Offline challenge id is invalid.");
    const payload = {
        schemaVersion: 1,
        challengeId: options.challengeId,
        seed: options.seed,
        journal: options.session.exportJournal(),
        expectedChecksum: options.session.getSnapshot().checksum
    };
    return cloneCheckpointJson({ ...payload, checksum: challengeChecksum(payload) });
}
export function replayOfflineChallengeV1(options) {
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
    return Object.freeze({ verified: true, checksum: replay.checksum, session: replay.session });
}
/** Export the authoritative engine checkpoint plus the accepted protocol journal. */
export function createMatchReconnectBundleV1(session) {
    return cloneCheckpointJson({
        schemaVersion: 1,
        protocolVersion: MATCH_PROTOCOL_VERSION,
        checkpoint: session.game.createCheckpoint(),
        acceptedJournal: session.exportJournal(),
        checksum: session.getSnapshot().checksum
    });
}
/** Restore via deterministic journal replay and verify its current checkpoint before continuing. */
export function restoreMatchReconnectBundleV1(options) {
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
/** Return the earliest unequal or missing fixed-tick checksum frame. */
export function diagnoseMatchDesyncV1(local, remote) {
    if (local.schemaVersion !== 1 || remote.schemaVersion !== 1)
        throw new Error("Unsupported checksum timeline.");
    const validate = (timeline) => {
        if (!Array.isArray(timeline.frames))
            throw new Error("Checksum timeline frames must be an array.");
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
                schemaVersion: 1,
                divergent: true,
                firstDivergentTick: tick,
                ...(localChecksum === undefined ? {} : { localChecksum }),
                ...(remoteChecksum === undefined ? {} : { remoteChecksum })
            });
        }
    }
    return Object.freeze({ schemaVersion: 1, divergent: false });
}
