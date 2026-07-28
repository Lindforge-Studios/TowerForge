import type { GameContentRegistry } from "../content/registry.js";
import {
  MULTIPLAYER_LIMITS,
  resolveActiveMultiplayerMechanics,
  type ActiveMultiplayerMechanicsV2,
  type MultiplayerProfileV2,
  type MultiplayerSendDefinitionV2
} from "../content/multiplayer-mechanics.js";
import {
  cloneCheckpointJson,
  computeCheckpointStateDigest,
  type GameCheckpointV1
} from "../simulation/checkpoint.js";
import type { GameSeed } from "../simulation/rng.js";
import {
  executeParsedGameCommand,
  parseGameCommand,
  type GameCommand
} from "../simulation/command-internal.js";
import { canonicalStringify, stableDigest } from "../simulation/stable-digest.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";
import type { ActionResult, GameSnapshot, ResourceBag } from "../simulation/types.js";
import { MATCH_PROTOCOL_VERSION, type MatchPlayerV1 } from "./match-session.js";

export interface SendEnemyCommandV1 {
  readonly schemaVersion: 1;
  readonly type: "sendEnemy";
  readonly sendId: string;
}

export interface AsymmetricMatchCommandEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly matchId: string;
  readonly playerId: string;
  readonly sequence: number;
  readonly matchSequence: number;
  readonly applyTick: number;
  readonly command: SendEnemyCommandV1 | GameCommand;
}

export interface AsymmetricMatchSnapshotV1 {
  readonly schemaVersion: 1;
  readonly protocolVersion: 1;
  readonly matchId: string;
  readonly mode: "asymmetric_send_vs_build";
  readonly profileId: string;
  readonly tick: number;
  readonly fixedTickUnits: number;
  readonly nextMatchSequence: number;
  readonly checksum: string;
  readonly players: readonly { readonly id: string; readonly nextSequence: number }[];
  readonly lanes: Readonly<Record<string, GameSnapshot>>;
}

export interface AsymmetricMatchJournalV1 {
  readonly schemaVersion: 1;
  readonly protocolVersion: 1;
  readonly matchId: string;
  readonly mode: "asymmetric_send_vs_build";
  readonly profileId: string;
  readonly fixedTickUnits: number;
  readonly players: readonly MatchPlayerV1[];
  readonly initialCheckpoints: Readonly<Record<string, GameCheckpointV1>>;
  readonly entries: readonly (
    | { readonly sequence: number; readonly kind: "command"; readonly envelope: AsymmetricMatchCommandEnvelopeV1; readonly checksum: string }
    | { readonly sequence: number; readonly kind: "tick"; readonly tick: number; readonly checksum: string }
  )[];
}

type RejectionCode =
  | "envelope_invalid"
  | "match_mismatch"
  | "player_unknown"
  | "sequence_duplicate"
  | "sequence_out_of_order"
  | "match_sequence_duplicate"
  | "match_sequence_out_of_order"
  | "tick_mismatch"
  | "tick_owned_by_session"
  | "send_not_authored"
  | "insufficient_resources";

export type AsymmetricDispatchResultV1 =
  | Readonly<{ ok: true; acceptedSequence: number; acceptedMatchSequence: number; lanePlayerId: string; sendId: string; targetPlayerId: string; checksum: string }>
  | Readonly<ActionResult & { acceptedSequence: number; acceptedMatchSequence: number; lanePlayerId: string; checksum: string }>
  | Readonly<{ ok: false; code: RejectionCode; expectedSequence?: number; expectedMatchSequence?: number }>;

type ActiveAsymmetricMultiplayerMechanicsV2 = ActiveMultiplayerMechanicsV2 & MultiplayerProfileV2;

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim()
    && new TextEncoder().encode(value).length <= MULTIPLAYER_LIMITS.idUtf8Bytes;
}

function ownDataObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    if (Array.isArray(value)) return undefined;
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    return undefined;
  }
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (Object.getOwnPropertySymbols(descriptors).length > 0) return undefined;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

function exact(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function normalizeEnvelope(value: unknown): AsymmetricMatchCommandEnvelopeV1 | undefined {
  const envelope = ownDataObject(value);
  if (!envelope || !exact(envelope, ["schemaVersion", "matchId", "playerId", "sequence", "matchSequence", "applyTick", "command"])) return undefined;
  if (envelope.schemaVersion !== 1 || !validId(envelope.matchId) || !validId(envelope.playerId)
    || typeof envelope.sequence !== "number" || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0
    || typeof envelope.matchSequence !== "number" || !Number.isSafeInteger(envelope.matchSequence) || envelope.matchSequence < 0
    || typeof envelope.applyTick !== "number" || !Number.isSafeInteger(envelope.applyTick) || envelope.applyTick < 0) return undefined;
  const custom = ownDataObject(envelope.command);
  let command: SendEnemyCommandV1 | GameCommand | undefined;
  if (custom && exact(custom, ["schemaVersion", "type", "sendId"])
    && custom.schemaVersion === 1 && custom.type === "sendEnemy" && validId(custom.sendId)) {
    command = Object.freeze({ schemaVersion: 1, type: "sendEnemy", sendId: custom.sendId });
  } else {
    try {
      command = parseGameCommand(envelope.command);
    } catch {
      command = undefined;
    }
  }
  if (!command) return undefined;
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

function normalizeAsymmetricJournal(input: unknown): AsymmetricMatchJournalV1 {
  const journal = cloneCheckpointJson(input) as unknown as AsymmetricMatchJournalV1;
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

function defineOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: false, writable: false });
}

function sortedPlayers(players: readonly MatchPlayerV1[]): readonly MatchPlayerV1[] {
  if (!Array.isArray(players) || players.length !== 2) throw new Error("Asymmetric matches require exactly two players.");
  const ids = players.map((player) => {
    const candidate = ownDataObject(player);
    if (!candidate || !exact(candidate, ["id"]) || !validId(candidate.id)) throw new Error("Invalid asymmetric player.");
    return candidate.id;
  });
  if (ids[0] === ids[1]) throw new Error("Asymmetric players must be unique.");
  return Object.freeze(ids.sort().map((id) => Object.freeze({ id })));
}

function checksum(payload: unknown): string {
  return stableDigest(payload).replace(/^tf-state-v1:/, "tf-match-v1:");
}

function withState(checkpoint: GameCheckpointV1, state: GameCheckpointV1["state"]): GameCheckpointV1 {
  return {
    ...checkpoint,
    state,
    stateDigest: computeCheckpointStateDigest(checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, state)
  };
}

function applyResourceExchange(
  resources: Readonly<ResourceBag>,
  definition: MultiplayerSendDefinitionV2
): Readonly<ResourceBag> | undefined {
  for (const [resourceId, amount] of Object.entries(definition.cost)) {
    if ((resources[resourceId] ?? 0) < amount) return undefined;
  }
  const next: ResourceBag = { ...resources };
  for (const [resourceId, amount] of Object.entries(definition.cost)) next[resourceId] = (next[resourceId] ?? 0) - amount;
  for (const [resourceId, amount] of Object.entries(definition.income)) {
    const value = (next[resourceId] ?? 0) + amount;
    if (!Number.isFinite(value) || value > MULTIPLAYER_LIMITS.maximumResourceAmount) return undefined;
    next[resourceId] = value;
  }
  return next;
}

export class AsymmetricMatchSession {
  readonly matchId: string;
  readonly mode = "asymmetric_send_vs_build" as const;
  readonly profileId: string;
  readonly fixedTickUnits: number;
  readonly players: readonly MatchPlayerV1[];

  private readonly content: GameContentRegistry;
  private readonly profile: ActiveAsymmetricMultiplayerMechanicsV2;
  private readonly games = new Map<string, TowerDefenseGame>();
  private readonly initialCheckpoints: Readonly<Record<string, GameCheckpointV1>>;
  private readonly nextSequenceByPlayer = new Map<string, number>();
  private readonly entries: AsymmetricMatchJournalV1["entries"][number][] = [];
  private mutableTick = 0;
  private mutableNextMatchSequence = 0;

  private constructor(options: {
    matchId: string;
    profileId: string;
    fixedTickUnits: number;
    players: readonly MatchPlayerV1[];
    content: GameContentRegistry;
    profile: ActiveAsymmetricMultiplayerMechanicsV2;
    initialCheckpoints: Readonly<Record<string, GameCheckpointV1>>;
  }) {
    this.matchId = options.matchId;
    this.profileId = options.profileId;
    this.fixedTickUnits = options.fixedTickUnits;
    this.players = options.players;
    this.content = options.content;
    this.profile = options.profile;
    this.initialCheckpoints = cloneCheckpointJson(options.initialCheckpoints);
    for (const player of this.players) {
      const checkpoint = this.initialCheckpoints[player.id];
      if (!checkpoint) throw new Error(`Missing initial checkpoint for player "${player.id}".`);
      this.games.set(player.id, TowerDefenseGame.fromCheckpoint({ content: this.content, checkpoint }));
      this.nextSequenceByPlayer.set(player.id, 0);
    }
  }

  static create(options: {
    readonly schemaVersion: 1;
    readonly matchId: string;
    readonly profileId: string;
    readonly content: GameContentRegistry;
    readonly missionId: string;
    readonly fixedTickUnits: number;
    readonly seed?: GameSeed;
    readonly players: readonly MatchPlayerV1[];
  }): AsymmetricMatchSession {
    if (options.schemaVersion !== 1 || !validId(options.matchId) || !validId(options.profileId) || !validId(options.missionId)) {
      throw new Error("Invalid asymmetric match identity.");
    }
    const profile = resolveActiveMultiplayerMechanics(options.content, options.missionId);
    if (!profile || profile.schemaVersion !== 2 || profile.mode !== "asymmetric_send_vs_build"
      || profile.profileId !== options.profileId || profile.fixedTickUnits !== options.fixedTickUnits) {
      throw new Error("The selected asymmetric multiplayer profile is not active.");
    }
    const players = sortedPlayers(options.players);
    const initial: Record<string, GameCheckpointV1> = {};
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

  private stateChecksum(): string {
    return checksum({
      protocolVersion: MATCH_PROTOCOL_VERSION,
      matchId: this.matchId,
      mode: this.mode,
      profileId: this.profileId,
      tick: this.mutableTick,
      fixedTickUnits: this.fixedTickUnits,
      nextMatchSequence: this.mutableNextMatchSequence,
      players: this.players.map((player) => ({ id: player.id, nextSequence: this.nextSequenceByPlayer.get(player.id) ?? 0 })),
      lanes: this.players.map((player) => ({ playerId: player.id, stateDigest: this.games.get(player.id)!.getStateDigest() }))
    });
  }

  dispatch(value: unknown): AsymmetricDispatchResultV1 {
    const envelope = normalizeEnvelope(value);
    if (!envelope) return Object.freeze({ ok: false, code: "envelope_invalid" });
    if (envelope.matchId !== this.matchId) return Object.freeze({ ok: false, code: "match_mismatch" });
    const expected = this.nextSequenceByPlayer.get(envelope.playerId);
    if (expected === undefined) return Object.freeze({ ok: false, code: "player_unknown" });
    if (envelope.sequence < expected) return Object.freeze({ ok: false, code: "sequence_duplicate", expectedSequence: expected });
    if (envelope.sequence > expected) return Object.freeze({ ok: false, code: "sequence_out_of_order", expectedSequence: expected });
    if (envelope.matchSequence < this.mutableNextMatchSequence) return Object.freeze({
      ok: false, code: "match_sequence_duplicate", expectedMatchSequence: this.mutableNextMatchSequence
    });
    if (envelope.matchSequence > this.mutableNextMatchSequence) return Object.freeze({
      ok: false, code: "match_sequence_out_of_order", expectedMatchSequence: this.mutableNextMatchSequence
    });
    if (envelope.applyTick !== this.mutableTick) return Object.freeze({ ok: false, code: "tick_mismatch" });
    if (envelope.command.type === "tick") return Object.freeze({ ok: false, code: "tick_owned_by_session" });
    if (envelope.command.type !== "sendEnemy") {
      this.assertJournalCapacity();
      const lane = this.games.get(envelope.playerId)!;
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
        kind: "command" as const,
        envelope: cloneCheckpointJson(envelope),
        checksum: result.checksum
      }));
      return result;
    }
    const definition = this.profile.sendPool[envelope.command.sendId];
    if (!definition) return Object.freeze({ ok: false, code: "send_not_authored" });

    const targetPlayer = this.players.find((player) => player.id !== envelope.playerId)!;
    const sender = this.games.get(envelope.playerId)!;
    const target = this.games.get(targetPlayer.id)!;
    const senderCheckpoint = sender.createCheckpoint();
    const targetCheckpoint = target.createCheckpoint();
    const resources = applyResourceExchange(senderCheckpoint.state.resources, definition);
    if (!resources) return Object.freeze({ ok: false, code: "insufficient_resources" });
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
      ok: true as const,
      acceptedSequence: envelope.sequence,
      acceptedMatchSequence: envelope.matchSequence,
      lanePlayerId: envelope.playerId,
      sendId: envelope.command.sendId,
      targetPlayerId: targetPlayer.id,
      checksum: this.stateChecksum()
    });
    this.entries.push(Object.freeze({
      sequence: this.entries.length,
      kind: "command" as const,
      envelope: cloneCheckpointJson(envelope),
      checksum: result.checksum
    }));
    return result;
  }

  advanceTick(): Readonly<{ ok: true; tick: number; checksum: string }> {
    this.assertJournalCapacity();
    for (const player of this.players) this.games.get(player.id)!.tick(this.fixedTickUnits);
    this.mutableTick += 1;
    const result = Object.freeze({ ok: true as const, tick: this.mutableTick, checksum: this.stateChecksum() });
    this.entries.push(Object.freeze({ sequence: this.entries.length, kind: "tick" as const, tick: this.mutableTick, checksum: result.checksum }));
    return result;
  }

  getSnapshot(): AsymmetricMatchSnapshotV1 {
    const lanes: Record<string, GameSnapshot> = {};
    for (const player of this.players) defineOwn(lanes, player.id, this.games.get(player.id)!.getSnapshot());
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

  exportJournal(): AsymmetricMatchJournalV1 {
    if (this.entries.length > MULTIPLAYER_LIMITS.journalEntries) throw new Error("Asymmetric match journal limit exceeded.");
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

  private assertJournalCapacity(): void {
    if (this.entries.length >= MULTIPLAYER_LIMITS.journalEntries) {
      throw new Error("Asymmetric match journal capacity is exhausted.");
    }
  }

  static restore(content: GameContentRegistry, journal: AsymmetricMatchJournalV1): AsymmetricMatchSession {
    journal = normalizeAsymmetricJournal(journal);
    const players = sortedPlayers(journal.players);
    const checkpointRecord = ownDataObject(journal.initialCheckpoints);
    if (!checkpointRecord || !exact(checkpointRecord, players.map((player) => player.id))) {
      throw new Error("Asymmetric journal lane checkpoints do not match its players.");
    }
    const first = players[0];
    if (!first) throw new Error("Asymmetric journal has no players.");
    const firstCheckpoint = journal.initialCheckpoints[first.id];
    const missionId = firstCheckpoint?.identity.missionId;
    if (!missionId) throw new Error("Asymmetric journal has no initial lane checkpoint.");
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

export function replayAsymmetricMatchJournal(options: {
  readonly content: GameContentRegistry;
  readonly journal: AsymmetricMatchJournalV1;
}): Readonly<{ session: AsymmetricMatchSession; entriesReplayed: number; checksum: string }> {
  const journal = normalizeAsymmetricJournal(options.journal);
  const session = AsymmetricMatchSession.restore(options.content, journal);
  for (let index = 0; index < journal.entries.length; index += 1) {
    const entry = journal.entries[index]!;
    if (entry.sequence !== index) throw new Error(`Asymmetric journal sequence diverged at ${index}.`);
    const actual = entry.kind === "command" ? session.dispatch(entry.envelope) : session.advanceTick();
    if (!("checksum" in actual) || actual.checksum !== entry.checksum) throw new Error(`Asymmetric journal checksum diverged at ${index}.`);
  }
  return Object.freeze({ session, entriesReplayed: journal.entries.length, checksum: session.getSnapshot().checksum });
}
