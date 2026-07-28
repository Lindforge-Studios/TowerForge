import { MULTIPLAYER_LIMITS, resolveActiveMultiplayerMechanics } from "../content/multiplayer-mechanics.js";
import { cloneCheckpointJson, computeCheckpointStateDigest } from "../simulation/checkpoint.js";
import { executeParsedGameCommand, parseGameCommand } from "../simulation/command-internal.js";
import { canonicalStringify, stableDigest } from "../simulation/stable-digest.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";
import { MATCH_PROTOCOL_VERSION } from "./match-session.js";
function validId(value) {
    return typeof value === "string" && value.length > 0 && value === value.trim()
        && new TextEncoder().encode(value).length <= MULTIPLAYER_LIMITS.idUtf8Bytes;
}
function ownDataObject(value) {
    if (value === null || typeof value !== "object")
        return undefined;
    let prototype;
    let descriptors;
    try {
        if (Array.isArray(value))
            return undefined;
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        return undefined;
    }
    if (prototype !== Object.prototype && prototype !== null)
        return undefined;
    if (Object.getOwnPropertySymbols(descriptors).length > 0)
        return undefined;
    const result = Object.create(null);
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
            return undefined;
        Object.defineProperty(result, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
    }
    return result;
}
function exact(record, keys) {
    return Object.keys(record).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}
function normalizeEnvelope(value) {
    const envelope = ownDataObject(value);
    if (!envelope || !exact(envelope, ["schemaVersion", "matchId", "playerId", "sequence", "matchSequence", "applyTick", "command"]))
        return undefined;
    if (envelope.schemaVersion !== 1 || !validId(envelope.matchId) || !validId(envelope.playerId)
        || typeof envelope.sequence !== "number" || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0
        || typeof envelope.matchSequence !== "number" || !Number.isSafeInteger(envelope.matchSequence) || envelope.matchSequence < 0
        || typeof envelope.applyTick !== "number" || !Number.isSafeInteger(envelope.applyTick) || envelope.applyTick < 0)
        return undefined;
    const custom = ownDataObject(envelope.command);
    let command;
    if (custom && exact(custom, ["schemaVersion", "type", "sendId"])
        && custom.schemaVersion === 1 && custom.type === "sendEnemy" && validId(custom.sendId)) {
        command = Object.freeze({ schemaVersion: 1, type: "sendEnemy", sendId: custom.sendId });
    }
    else {
        try {
            command = parseGameCommand(envelope.command);
        }
        catch {
            command = undefined;
        }
    }
    if (!command)
        return undefined;
    return Object.freeze({
        schemaVersion: 1,
        matchId: envelope.matchId,
        playerId: envelope.playerId,
        sequence: envelope.sequence,
        matchSequence: envelope.matchSequence,
        applyTick: envelope.applyTick,
        command
    });
}
function normalizeAsymmetricJournal(input) {
    const journal = cloneCheckpointJson(input);
    const fields = ownDataObject(journal);
    if (!fields || !exact(fields, [
        "schemaVersion", "protocolVersion", "matchId", "mode", "profileId", "fixedTickUnits",
        "players", "initialCheckpoints", "entries"
    ]) || journal.schemaVersion !== 1 || journal.protocolVersion !== 1
        || journal.mode !== "asymmetric_send_vs_build" || !validId(journal.matchId) || !validId(journal.profileId)
        || typeof journal.fixedTickUnits !== "number" || !Number.isFinite(journal.fixedTickUnits)
        || journal.fixedTickUnits <= 0 || !Array.isArray(journal.entries)
        || journal.entries.length > MULTIPLAYER_LIMITS.journalEntries) {
        throw new Error("Unsupported or malformed asymmetric match journal.");
    }
    for (let index = 0; index < journal.entries.length; index += 1) {
        const entry = journal.entries[index];
        const entryFields = ownDataObject(entry);
        if (!entryFields || entry?.sequence !== index
            || typeof entry.checksum !== "string" || !/^tf-match-v1:[0-9a-f]{16}$/.test(entry.checksum)) {
            throw new Error(`Malformed asymmetric journal entry at ${index}.`);
        }
        if (entry.kind === "command") {
            if (!exact(entryFields, ["sequence", "kind", "envelope", "checksum"])) {
                throw new Error(`Malformed asymmetric command journal entry at ${index}.`);
            }
            const envelope = normalizeEnvelope(entry.envelope);
            if (!envelope || envelope.matchId !== journal.matchId) {
                throw new Error(`Malformed asymmetric command envelope at ${index}.`);
            }
            continue;
        }
        if (entry.kind === "tick") {
            if (!exact(entryFields, ["sequence", "kind", "tick", "checksum"])
                || !Number.isSafeInteger(entry.tick) || entry.tick < 1) {
                throw new Error(`Malformed asymmetric tick journal entry at ${index}.`);
            }
            continue;
        }
        throw new Error(`Unsupported asymmetric journal entry kind at ${index}.`);
    }
    return journal;
}
function defineOwn(target, key, value) {
    Object.defineProperty(target, key, { value, enumerable: true, configurable: false, writable: false });
}
function sortedPlayers(players) {
    if (!Array.isArray(players) || players.length !== 2)
        throw new Error("Asymmetric matches require exactly two players.");
    const ids = players.map((player) => {
        const candidate = ownDataObject(player);
        if (!candidate || !exact(candidate, ["id"]) || !validId(candidate.id))
            throw new Error("Invalid asymmetric player.");
        return candidate.id;
    });
    if (ids[0] === ids[1])
        throw new Error("Asymmetric players must be unique.");
    return Object.freeze(ids.sort().map((id) => Object.freeze({ id })));
}
function checksum(payload) {
    return stableDigest(payload).replace(/^tf-state-v1:/, "tf-match-v1:");
}
function withState(checkpoint, state) {
    return {
        ...checkpoint,
        state,
        stateDigest: computeCheckpointStateDigest(checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, state)
    };
}
function applyResourceExchange(resources, definition) {
    for (const [resourceId, amount] of Object.entries(definition.cost)) {
        if ((resources[resourceId] ?? 0) < amount)
            return undefined;
    }
    const next = { ...resources };
    for (const [resourceId, amount] of Object.entries(definition.cost))
        next[resourceId] = (next[resourceId] ?? 0) - amount;
    for (const [resourceId, amount] of Object.entries(definition.income)) {
        const value = (next[resourceId] ?? 0) + amount;
        if (!Number.isFinite(value) || value > MULTIPLAYER_LIMITS.maximumResourceAmount)
            return undefined;
        next[resourceId] = value;
    }
    return next;
}
export class AsymmetricMatchSession {
    matchId;
    mode = "asymmetric_send_vs_build";
    profileId;
    fixedTickUnits;
    players;
    content;
    profile;
    games = new Map();
    initialCheckpoints;
    nextSequenceByPlayer = new Map();
    entries = [];
    mutableTick = 0;
    mutableNextMatchSequence = 0;
    constructor(options) {
        this.matchId = options.matchId;
        this.profileId = options.profileId;
        this.fixedTickUnits = options.fixedTickUnits;
        this.players = options.players;
        this.content = options.content;
        this.profile = options.profile;
        this.initialCheckpoints = cloneCheckpointJson(options.initialCheckpoints);
        for (const player of this.players) {
            const checkpoint = this.initialCheckpoints[player.id];
            if (!checkpoint)
                throw new Error(`Missing initial checkpoint for player "${player.id}".`);
            this.games.set(player.id, TowerDefenseGame.fromCheckpoint({ content: this.content, checkpoint }));
            this.nextSequenceByPlayer.set(player.id, 0);
        }
    }
    static create(options) {
        if (options.schemaVersion !== 1 || !validId(options.matchId) || !validId(options.profileId) || !validId(options.missionId)) {
            throw new Error("Invalid asymmetric match identity.");
        }
        const profile = resolveActiveMultiplayerMechanics(options.content, options.missionId);
        if (!profile || profile.schemaVersion !== 2 || profile.mode !== "asymmetric_send_vs_build"
            || profile.profileId !== options.profileId || profile.fixedTickUnits !== options.fixedTickUnits) {
            throw new Error("The selected asymmetric multiplayer profile is not active.");
        }
        const players = sortedPlayers(options.players);
        const initial = {};
        for (const player of players) {
            const game = new TowerDefenseGame({
                content: options.content,
                missionId: options.missionId,
                seed: stableDigest({
                    schemaVersion: 1,
                    domain: "asymmetric_lane_seed",
                    sourceSeed: options.seed ?? "towerforge",
                    playerId: player.id
                })
            });
            defineOwn(initial, player.id, game.createCheckpoint());
        }
        return new AsymmetricMatchSession({
            matchId: options.matchId,
            profileId: options.profileId,
            fixedTickUnits: options.fixedTickUnits,
            players,
            content: options.content,
            profile,
            initialCheckpoints: initial
        });
    }
    stateChecksum() {
        return checksum({
            protocolVersion: MATCH_PROTOCOL_VERSION,
            matchId: this.matchId,
            mode: this.mode,
            profileId: this.profileId,
            tick: this.mutableTick,
            fixedTickUnits: this.fixedTickUnits,
            nextMatchSequence: this.mutableNextMatchSequence,
            players: this.players.map((player) => ({ id: player.id, nextSequence: this.nextSequenceByPlayer.get(player.id) ?? 0 })),
            lanes: this.players.map((player) => ({ playerId: player.id, stateDigest: this.games.get(player.id).getStateDigest() }))
        });
    }
    dispatch(value) {
        const envelope = normalizeEnvelope(value);
        if (!envelope)
            return Object.freeze({ ok: false, code: "envelope_invalid" });
        if (envelope.matchId !== this.matchId)
            return Object.freeze({ ok: false, code: "match_mismatch" });
        const expected = this.nextSequenceByPlayer.get(envelope.playerId);
        if (expected === undefined)
            return Object.freeze({ ok: false, code: "player_unknown" });
        if (envelope.sequence < expected)
            return Object.freeze({ ok: false, code: "sequence_duplicate", expectedSequence: expected });
        if (envelope.sequence > expected)
            return Object.freeze({ ok: false, code: "sequence_out_of_order", expectedSequence: expected });
        if (envelope.matchSequence < this.mutableNextMatchSequence)
            return Object.freeze({
                ok: false, code: "match_sequence_duplicate", expectedMatchSequence: this.mutableNextMatchSequence
            });
        if (envelope.matchSequence > this.mutableNextMatchSequence)
            return Object.freeze({
                ok: false, code: "match_sequence_out_of_order", expectedMatchSequence: this.mutableNextMatchSequence
            });
        if (envelope.applyTick !== this.mutableTick)
            return Object.freeze({ ok: false, code: "tick_mismatch" });
        if (envelope.command.type === "tick")
            return Object.freeze({ ok: false, code: "tick_owned_by_session" });
        if (envelope.command.type !== "sendEnemy") {
            this.assertJournalCapacity();
            const lane = this.games.get(envelope.playerId);
            const action = executeParsedGameCommand(lane, envelope.command);
            this.nextSequenceByPlayer.set(envelope.playerId, expected + 1);
            this.mutableNextMatchSequence += 1;
            const result = Object.freeze({
                ...action,
                acceptedSequence: envelope.sequence,
                acceptedMatchSequence: envelope.matchSequence,
                lanePlayerId: envelope.playerId,
                checksum: this.stateChecksum()
            });
            this.entries.push(Object.freeze({
                sequence: this.entries.length,
                kind: "command",
                envelope: cloneCheckpointJson(envelope),
                checksum: result.checksum
            }));
            return result;
        }
        const definition = this.profile.sendPool[envelope.command.sendId];
        if (!definition)
            return Object.freeze({ ok: false, code: "send_not_authored" });
        const targetPlayer = this.players.find((player) => player.id !== envelope.playerId);
        const sender = this.games.get(envelope.playerId);
        const target = this.games.get(targetPlayer.id);
        const senderCheckpoint = sender.createCheckpoint();
        const targetCheckpoint = target.createCheckpoint();
        const resources = applyResourceExchange(senderCheckpoint.state.resources, definition);
        if (!resources)
            return Object.freeze({ ok: false, code: "insufficient_resources" });
        this.assertJournalCapacity();
        const senderCandidate = withState(senderCheckpoint, { ...senderCheckpoint.state, resources });
        const queued = [
            ...targetCheckpoint.state.spawnQueue,
            {
                at: targetCheckpoint.state.missionElapsed + definition.spawnDelayUnits,
                enemyId: definition.enemyTypeId,
                ...(definition.routeId === undefined ? {} : { routeId: definition.routeId })
            }
        ].sort((left, right) => left.at - right.at
            || (left.enemyId < right.enemyId ? -1 : left.enemyId > right.enemyId ? 1 : 0)
            || ((left.routeId ?? "") < (right.routeId ?? "") ? -1 : (left.routeId ?? "") > (right.routeId ?? "") ? 1 : 0));
        const targetCandidate = withState(targetCheckpoint, { ...targetCheckpoint.state, spawnQueue: queued });
        // Construct both candidates before publishing either lane: validation failure is an atomic rollback.
        const senderGame = TowerDefenseGame.fromCheckpoint({ content: this.content, checkpoint: senderCandidate });
        const targetGame = TowerDefenseGame.fromCheckpoint({ content: this.content, checkpoint: targetCandidate });
        this.games.set(envelope.playerId, senderGame);
        this.games.set(targetPlayer.id, targetGame);
        this.nextSequenceByPlayer.set(envelope.playerId, expected + 1);
        this.mutableNextMatchSequence += 1;
        const result = Object.freeze({
            ok: true,
            acceptedSequence: envelope.sequence,
            acceptedMatchSequence: envelope.matchSequence,
            lanePlayerId: envelope.playerId,
            sendId: envelope.command.sendId,
            targetPlayerId: targetPlayer.id,
            checksum: this.stateChecksum()
        });
        this.entries.push(Object.freeze({
            sequence: this.entries.length,
            kind: "command",
            envelope: cloneCheckpointJson(envelope),
            checksum: result.checksum
        }));
        return result;
    }
    advanceTick() {
        this.assertJournalCapacity();
        for (const player of this.players)
            this.games.get(player.id).tick(this.fixedTickUnits);
        this.mutableTick += 1;
        const result = Object.freeze({ ok: true, tick: this.mutableTick, checksum: this.stateChecksum() });
        this.entries.push(Object.freeze({ sequence: this.entries.length, kind: "tick", tick: this.mutableTick, checksum: result.checksum }));
        return result;
    }
    getSnapshot() {
        const lanes = {};
        for (const player of this.players)
            defineOwn(lanes, player.id, this.games.get(player.id).getSnapshot());
        return Object.freeze({
            schemaVersion: 1,
            protocolVersion: 1,
            matchId: this.matchId,
            mode: this.mode,
            profileId: this.profileId,
            tick: this.mutableTick,
            fixedTickUnits: this.fixedTickUnits,
            nextMatchSequence: this.mutableNextMatchSequence,
            checksum: this.stateChecksum(),
            players: Object.freeze(this.players.map((player) => Object.freeze({ id: player.id, nextSequence: this.nextSequenceByPlayer.get(player.id) ?? 0 }))),
            lanes: Object.freeze(lanes)
        });
    }
    exportJournal() {
        if (this.entries.length > MULTIPLAYER_LIMITS.journalEntries)
            throw new Error("Asymmetric match journal limit exceeded.");
        return cloneCheckpointJson({
            schemaVersion: 1,
            protocolVersion: 1,
            matchId: this.matchId,
            mode: this.mode,
            profileId: this.profileId,
            fixedTickUnits: this.fixedTickUnits,
            players: this.players,
            initialCheckpoints: this.initialCheckpoints,
            entries: this.entries
        });
    }
    assertJournalCapacity() {
        if (this.entries.length >= MULTIPLAYER_LIMITS.journalEntries) {
            throw new Error("Asymmetric match journal capacity is exhausted.");
        }
    }
    static restore(content, journal) {
        journal = normalizeAsymmetricJournal(journal);
        const players = sortedPlayers(journal.players);
        const checkpointRecord = ownDataObject(journal.initialCheckpoints);
        if (!checkpointRecord || !exact(checkpointRecord, players.map((player) => player.id))) {
            throw new Error("Asymmetric journal lane checkpoints do not match its players.");
        }
        const first = players[0];
        if (!first)
            throw new Error("Asymmetric journal has no players.");
        const firstCheckpoint = journal.initialCheckpoints[first.id];
        const missionId = firstCheckpoint?.identity.missionId;
        if (!missionId)
            throw new Error("Asymmetric journal has no initial lane checkpoint.");
        const identity = canonicalStringify(firstCheckpoint.identity);
        for (const player of players) {
            const checkpoint = journal.initialCheckpoints[player.id];
            if (!checkpoint || checkpoint.contentDigest !== firstCheckpoint.contentDigest
                || checkpoint.engineVersion !== firstCheckpoint.engineVersion
                || canonicalStringify(checkpoint.identity) !== identity) {
                throw new Error("Asymmetric journal lane checkpoint identity is inconsistent.");
            }
        }
        const profile = resolveActiveMultiplayerMechanics(content, missionId);
        if (!profile || profile.schemaVersion !== 2 || profile.mode !== "asymmetric_send_vs_build"
            || profile.profileId !== journal.profileId) {
            throw new Error("Asymmetric journal profile is unavailable.");
        }
        if (journal.fixedTickUnits !== profile.fixedTickUnits) {
            throw new Error("Asymmetric journal tick interval differs from the authored profile.");
        }
        return new AsymmetricMatchSession({
            matchId: journal.matchId,
            profileId: journal.profileId,
            fixedTickUnits: journal.fixedTickUnits,
            players,
            content,
            profile,
            initialCheckpoints: journal.initialCheckpoints
        });
    }
}
export function replayAsymmetricMatchJournal(options) {
    const journal = normalizeAsymmetricJournal(options.journal);
    const session = AsymmetricMatchSession.restore(options.content, journal);
    for (let index = 0; index < journal.entries.length; index += 1) {
        const entry = journal.entries[index];
        if (entry.sequence !== index)
            throw new Error(`Asymmetric journal sequence diverged at ${index}.`);
        const actual = entry.kind === "command" ? session.dispatch(entry.envelope) : session.advanceTick();
        if (!("checksum" in actual) || actual.checksum !== entry.checksum)
            throw new Error(`Asymmetric journal checksum diverged at ${index}.`);
    }
    return Object.freeze({ session, entriesReplayed: journal.entries.length, checksum: session.getSnapshot().checksum });
}
