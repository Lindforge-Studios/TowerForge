import type { GameContentRegistry } from "../content/registry.js";
import {
  MULTIPLAYER_LIMITS,
  resolveActiveMultiplayerMechanics,
  type MultiplayerOwnershipV1
} from "../content/multiplayer-mechanics.js";
/* towerforge-optional:macroEconomy:start */
import { resolveActiveMacroEconomyMechanics } from "../content/macro-economy-mechanics.js";
/* towerforge-optional:macroEconomy:end */
import {
  parseGameCommand,
  type GameCommand
} from "../simulation/command-internal.js";
import {
  cloneCheckpointJson,
  computeCheckpointStateDigest,
  type GameCheckpointV1
} from "../simulation/checkpoint.js";
import { JournaledGameSession } from "../simulation/journal.js";
import type { GameSeed } from "../simulation/rng.js";
import { canonicalStringify, stableDigest } from "../simulation/stable-digest.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";
import type { ActionResult, GameSnapshot, ResourceBag } from "../simulation/types.js";

export const MATCH_PROTOCOL_VERSION = 1 as const;
export const MATCH_COMMAND_JOURNAL_SCHEMA_VERSION = 1 as const;

export interface MatchPlayerV1 {
  readonly id: string;
}

export interface MatchSessionCreateOptionsV1 {
  readonly schemaVersion: 1;
  readonly mode: "local_coop";
  readonly matchId: string;
  readonly profileId: string;
  readonly fixedTickUnits: number;
  readonly content: GameContentRegistry;
  readonly missionId: string;
  readonly seed?: GameSeed;
  readonly players: readonly MatchPlayerV1[];
}

export interface MatchCommandEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly matchId: string;
  readonly playerId: string;
  readonly sequence: number;
  readonly matchSequence: number;
  readonly applyTick: number;
  readonly command: GameCommand;
}

export interface MatchCommandAcceptedResultV1 extends ActionResult {
  readonly acceptedSequence: number;
  readonly acceptedMatchSequence: number;
  readonly checksum: string;
}

export interface MatchProtocolRejectionV1 {
  readonly ok: false;
  readonly code:
    | "envelope_invalid"
    | "match_mismatch"
    | "player_unknown"
    | "sequence_duplicate"
    | "sequence_out_of_order"
    | "match_sequence_duplicate"
    | "match_sequence_out_of_order"
    | "tick_mismatch"
    | "tick_owned_by_session"
    | "entity_not_owned";
  readonly expectedSequence?: number;
  readonly expectedMatchSequence?: number;
  readonly ownerPlayerId?: string;
}

export type MatchDispatchResultV1 = MatchCommandAcceptedResultV1 | MatchProtocolRejectionV1;

export interface MatchSnapshotV1 {
  readonly schemaVersion: 1;
  readonly protocolVersion: 1;
  readonly matchId: string;
  readonly mode: "local_coop";
  readonly profileId: string;
  readonly tick: number;
  readonly fixedTickUnits: number;
  readonly nextMatchSequence: number;
  readonly checksum: string;
  readonly gameStateDigest: string;
  readonly players: readonly {
    readonly id: string;
    readonly nextSequence: number;
    readonly resources?: Readonly<ResourceBag>;
  }[];
  readonly towerOwnership: readonly {
    readonly towerId: string;
    readonly playerId: string;
  }[];
  readonly routeOwnership: readonly {
    readonly routeId: string;
    readonly playerId: string;
  }[];
  readonly game: GameSnapshot;
}

export interface MatchChecksumTimelineV1 {
  readonly schemaVersion: 1;
  readonly frames: readonly { readonly tick: number; readonly checksum: string }[];
}

export interface MatchCommandJournalCommandEntryV1 {
  readonly sequence: number;
  readonly kind: "command";
  readonly envelope: MatchCommandEnvelopeV1;
  readonly checksum: string;
}

export interface MatchCommandJournalTickEntryV1 {
  readonly sequence: number;
  readonly kind: "tick";
  readonly tick: number;
  readonly units: number;
  readonly checksum: string;
}

export type MatchCommandJournalEntryV1 =
  | MatchCommandJournalCommandEntryV1
  | MatchCommandJournalTickEntryV1;

export interface MatchCommandJournalV1 {
  readonly schemaVersion: 1;
  readonly protocolVersion: 1;
  readonly matchId: string;
  readonly mode: "local_coop";
  readonly profileId: string;
  readonly fixedTickUnits: number;
  readonly players: readonly MatchPlayerV1[];
  readonly ownership: MultiplayerOwnershipV1;
  readonly initialCheckpoint: GameCheckpointV1;
  readonly entries: readonly MatchCommandJournalEntryV1[];
}

type DataFields = Map<string, unknown>;

function inspectDataFields(value: unknown): DataFields | undefined {
  if (value === null || typeof value !== "object") return undefined;
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    if (Array.isArray(value)) return undefined;
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return undefined;
  }
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const result = new Map<string, unknown>();
  for (const key of keys) {
    if (typeof key !== "string") return undefined;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return undefined;
    }
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    result.set(key, descriptor.value);
  }
  return result;
}

function exactFields(fields: DataFields, expected: readonly string[]): boolean {
  if (fields.size !== expected.length) return false;
  return expected.every((field) => fields.has(field));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function validId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && utf8ByteLength(value) <= MULTIPLAYER_LIMITS.idUtf8Bytes;
}

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePlayers(value: readonly MatchPlayerV1[], maximum: number): readonly MatchPlayerV1[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 2 || value.length > maximum) {
    throw new Error(`Match players must contain 2..${maximum} entries.`);
  }
  const seen = new Set<string>();
  const players = value.map((candidate) => {
    const fields = inspectDataFields(candidate);
    if (!fields || !exactFields(fields, ["id"]) || !validId(fields.get("id"))) {
      throw new Error("Match player must contain one bounded id data field.");
    }
    const id = fields.get("id") as string;
    if (seen.has(id)) throw new Error(`Duplicate match player "${id}".`);
    seen.add(id);
    return Object.freeze({ id });
  }).sort((left, right) => compareBinary(left.id, right.id));
  return Object.freeze(players);
}

function matchChecksum(payload: Readonly<Record<string, unknown>>): string {
  return stableDigest(payload).replace(/^tf-state-v1:/, "tf-match-v1:");
}

function protocolRejection(
  code: MatchProtocolRejectionV1["code"],
  details: Pick<MatchProtocolRejectionV1, "expectedSequence" | "expectedMatchSequence" | "ownerPlayerId"> = {}
): MatchProtocolRejectionV1 {
  return Object.freeze({
    ok: false,
    code,
    ...(details.expectedSequence === undefined ? {} : { expectedSequence: details.expectedSequence }),
    ...(details.expectedMatchSequence === undefined ? {} : { expectedMatchSequence: details.expectedMatchSequence }),
    ...(details.ownerPlayerId === undefined ? {} : { ownerPlayerId: details.ownerPlayerId })
  });
}

function normalizeEnvelope(input: unknown): MatchCommandEnvelopeV1 | undefined {
  const fields = inspectDataFields(input);
  if (!fields || !exactFields(fields, [
    "schemaVersion", "matchId", "playerId", "sequence", "matchSequence", "applyTick", "command"
  ])) return undefined;
  if (fields.get("schemaVersion") !== 1
    || !validId(fields.get("matchId"))
    || !validId(fields.get("playerId"))) return undefined;
  const sequence = fields.get("sequence");
  const matchSequence = fields.get("matchSequence");
  const applyTick = fields.get("applyTick");
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0
    || typeof matchSequence !== "number" || !Number.isSafeInteger(matchSequence) || matchSequence < 0
    || typeof applyTick !== "number" || !Number.isSafeInteger(applyTick) || applyTick < 0) {
    return undefined;
  }
  let command: GameCommand | undefined;
  try {
    command = parseGameCommand(fields.get("command"));
  } catch {
    command = undefined;
  }
  if (!command) return undefined;
  return Object.freeze({
    schemaVersion: 1 as const,
    matchId: fields.get("matchId") as string,
    playerId: fields.get("playerId") as string,
    sequence,
    matchSequence,
    applyTick,
    command
  });
}

function normalizeMatchCommandJournal(input: unknown): MatchCommandJournalV1 {
  const journal = cloneCheckpointJson(input) as unknown as MatchCommandJournalV1;
  const fields = inspectDataFields(journal);
  if (!fields || !exactFields(fields, [
    "schemaVersion", "protocolVersion", "matchId", "mode", "profileId", "fixedTickUnits",
    "players", "ownership", "initialCheckpoint", "entries"
  ]) || journal.schemaVersion !== 1 || journal.protocolVersion !== 1 || journal.mode !== "local_coop"
    || !validId(journal.matchId) || !validId(journal.profileId)
    || typeof journal.fixedTickUnits !== "number" || !Number.isFinite(journal.fixedTickUnits)
    || journal.fixedTickUnits <= 0 || !Array.isArray(journal.entries)
    || journal.entries.length > MULTIPLAYER_LIMITS.journalEntries) {
    throw new Error("Unsupported or malformed match command journal.");
  }
  for (let index = 0; index < journal.entries.length; index += 1) {
    const entry = journal.entries[index];
    const entryFields = inspectDataFields(entry);
    if (!entryFields || entry?.sequence !== index
      || typeof entry.checksum !== "string" || !/^tf-match-v1:[0-9a-f]{16}$/.test(entry.checksum)) {
      throw new Error(`Malformed match journal entry at ${index}.`);
    }
    if (entry.kind === "command") {
      if (!exactFields(entryFields, ["sequence", "kind", "envelope", "checksum"])) {
        throw new Error(`Malformed match command journal entry at ${index}.`);
      }
      const envelope = normalizeEnvelope(entry.envelope);
      if (!envelope || envelope.matchId !== journal.matchId) {
        throw new Error(`Malformed match command envelope at ${index}.`);
      }
      continue;
    }
    if (entry.kind === "tick") {
      if (!exactFields(entryFields, ["sequence", "kind", "tick", "units", "checksum"])
        || !Number.isSafeInteger(entry.tick) || entry.tick < 1
        || entry.units !== journal.fixedTickUnits) {
        throw new Error(`Malformed match tick journal entry at ${index}.`);
      }
      continue;
    }
    throw new Error(`Unsupported match journal entry kind at ${index}.`);
  }
  return journal;
}

function durableResult(result: MatchDispatchResultV1): MatchDispatchResultV1 {
  if (!result.ok) return Object.freeze({ ...result });
  const reasonParams = result.reasonParams === undefined
    ? undefined
    : Object.freeze(Object.fromEntries(
        Object.entries(result.reasonParams)
          .filter((entry): entry is [string, string | number] => (
            typeof entry[1] === "string" || typeof entry[1] === "number"
          ))
      ));
  const { reasonParams: _reasonParams, ...withoutReasonParams } = result;
  void _reasonParams;
  return Object.freeze({
    ...withoutReasonParams,
    ...(reasonParams === undefined ? {} : { reasonParams })
  });
}

export class MatchSession {
  readonly matchId: string;
  readonly mode = "local_coop" as const;
  readonly profileId: string;
  readonly fixedTickUnits: number;
  readonly players: readonly MatchPlayerV1[];
  readonly ownership: MultiplayerOwnershipV1;

  private journaledGame: JournaledGameSession;
  private readonly initialCheckpoint: GameCheckpointV1;
  private readonly nextSequenceByPlayer = new Map<string, number>();
  private readonly towerOwnerById = new Map<string, string>();
  private readonly resourcesByPlayer = new Map<string, Readonly<ResourceBag>>();
  private readonly routeOwnerById = new Map<string, string>();
  private readonly entries: MatchCommandJournalEntryV1[] = [];
  private readonly checksumTimeline: { tick: number; checksum: string }[] = [];
  private mutableTick = 0;
  private mutableNextMatchSequence = 0;

  private constructor(options: {
    readonly matchId: string;
    readonly profileId: string;
    readonly fixedTickUnits: number;
    readonly players: readonly MatchPlayerV1[];
    readonly ownership: MultiplayerOwnershipV1;
    readonly game: TowerDefenseGame;
    readonly initialCheckpoint?: GameCheckpointV1;
  }) {
    this.matchId = options.matchId;
    this.profileId = options.profileId;
    this.fixedTickUnits = options.fixedTickUnits;
    this.players = options.players;
    this.ownership = options.ownership;
    this.journaledGame = new JournaledGameSession(options.game);
    this.initialCheckpoint = cloneCheckpointJson(options.initialCheckpoint ?? options.game.createCheckpoint());
    for (const player of this.players) {
      this.nextSequenceByPlayer.set(player.id, 0);
      if (this.ownership.resources === "partitioned") {
        this.resourcesByPlayer.set(player.id, Object.freeze({ ...options.game.getSnapshot().resources }));
      }
    }
    if (this.ownership.routes === "partitioned") {
      const routeIds = options.game.getSnapshot().pathRoutes.map((route) => route.id).sort(compareBinary);
      routeIds.forEach((routeId, index) => this.routeOwnerById.set(routeId, this.players[index % this.players.length]!.id));
    }
    this.checksumTimeline.push({ tick: 0, checksum: this.stateChecksum() });
  }

  get game(): Readonly<TowerDefenseGame> {
    return this.journaledGame.game;
  }

  static create(options: MatchSessionCreateOptionsV1): MatchSession {
    if (options.schemaVersion !== 1 || options.mode !== "local_coop" || !validId(options.matchId)
      || !validId(options.profileId) || !validId(options.missionId)) {
      throw new Error("Invalid MatchSession v1 identity.");
    }
    const profile = resolveActiveMultiplayerMechanics(options.content, options.missionId);
    if (!profile || profile.profileId !== options.profileId || profile.mode !== options.mode) {
      throw new Error("The selected multiplayer profile is not active for this mission.");
    }
    if (options.fixedTickUnits !== profile.fixedTickUnits) {
      throw new Error("Match fixedTickUnits must equal the active authored profile.");
    }
    /* towerforge-optional:macroEconomy:start */
    if (profile.ownership.resources === "partitioned"
      && resolveActiveMacroEconomyMechanics(options.content, options.missionId)) {
      throw new Error("Macro-economy v1 multiplayer requires shared resources.");
    }
    /* towerforge-optional:macroEconomy:end */
    const players = normalizePlayers(options.players, profile.maxPlayers);
    const game = new TowerDefenseGame({
      content: options.content,
      missionId: options.missionId,
      seed: options.seed
    });
    if (profile.ownership.routes === "partitioned" && game.getSnapshot().pathRoutes.length < players.length) {
      throw new Error("Partitioned co-op requires at least one authored route per player.");
    }
    return new MatchSession({
      matchId: options.matchId,
      profileId: options.profileId,
      fixedTickUnits: profile.fixedTickUnits,
      players,
      ownership: profile.ownership,
      game
    });
  }

  static restore(options: {
    readonly content: GameContentRegistry;
    readonly journal: MatchCommandJournalV1;
  }): MatchSession {
    const journal = normalizeMatchCommandJournal(options.journal);
    const profile = resolveActiveMultiplayerMechanics(
      options.content,
      journal.initialCheckpoint.identity.missionId
    );
    if (!profile || profile.mode !== "local_coop"
      || profile.profileId !== journal.profileId || profile.fixedTickUnits !== journal.fixedTickUnits
      || canonicalStringify(profile.ownership) !== canonicalStringify(journal.ownership)) {
      throw new Error("Match journal differs from its active authored local co-op profile.");
    }
    /* towerforge-optional:macroEconomy:start */
    if (profile.ownership.resources === "partitioned"
      && resolveActiveMacroEconomyMechanics(options.content, journal.initialCheckpoint.identity.missionId)) {
      throw new Error("Macro-economy v1 multiplayer requires shared resources.");
    }
    /* towerforge-optional:macroEconomy:end */
    const game = TowerDefenseGame.fromCheckpoint({
      content: options.content,
      checkpoint: journal.initialCheckpoint
    });
    const session = new MatchSession({
      matchId: journal.matchId,
      profileId: journal.profileId,
      fixedTickUnits: journal.fixedTickUnits,
      players: normalizePlayers(journal.players, profile.maxPlayers),
      ownership: Object.freeze(cloneCheckpointJson(journal.ownership)),
      game,
      initialCheckpoint: journal.initialCheckpoint
    });
    if (session.ownership.routes === "partitioned" && session.routeOwnerById.size < session.players.length) {
      throw new Error("Partitioned co-op journal does not provide one authored route per player.");
    }
    return session;
  }

  get currentTick(): number {
    return this.mutableTick;
  }

  private stateChecksum(): string {
    return matchChecksum({
      protocolVersion: MATCH_PROTOCOL_VERSION,
      matchId: this.matchId,
      mode: this.mode,
      profileId: this.profileId,
      tick: this.mutableTick,
      fixedTickUnits: this.fixedTickUnits,
      nextMatchSequence: this.mutableNextMatchSequence,
      gameStateDigest: this.game.getStateDigest(),
      players: this.players.map((player) => ({
        id: player.id,
        nextSequence: this.nextSequenceByPlayer.get(player.id) ?? 0,
        ...(this.ownership.resources === "partitioned"
          ? { resources: this.resourcesByPlayer.get(player.id) ?? {} }
          : {})
      })),
      towerOwnership: [...this.towerOwnerById.entries()]
        .sort(([left], [right]) => compareBinary(left, right))
        .map(([towerId, playerId]) => ({ towerId, playerId })),
      routeOwnership: [...this.routeOwnerById.entries()]
        .sort(([left], [right]) => compareBinary(left, right))
        .map(([routeId, playerId]) => ({ routeId, playerId }))
    });
  }

  private replaceGameResources(resources: Readonly<ResourceBag>): void {
    const checkpoint = this.game.createCheckpoint();
    const state = { ...checkpoint.state, resources: { ...resources } };
    const candidate: GameCheckpointV1 = {
      ...checkpoint,
      state,
      stateDigest: computeCheckpointStateDigest(checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, state)
    };
    this.journaledGame = new JournaledGameSession(TowerDefenseGame.fromCheckpoint({
      content: this.game.content,
      checkpoint: candidate
    }));
  }

  private activatePlayerResources(playerId: string): void {
    if (this.ownership.resources !== "partitioned") return;
    const resources = this.resourcesByPlayer.get(playerId);
    if (!resources) throw new Error(`Partitioned resources are missing for player "${playerId}".`);
    this.replaceGameResources(resources);
  }

  private captureAndCanonicalizePlayerResources(playerId: string): void {
    if (this.ownership.resources !== "partitioned") return;
    this.resourcesByPlayer.set(playerId, Object.freeze({ ...this.game.getSnapshot().resources }));
    const canonicalPlayer = this.players[0]!;
    if (playerId !== canonicalPlayer.id) this.replaceGameResources(this.resourcesByPlayer.get(canonicalPlayer.id)!);
  }

  private recordCurrentTickChecksum(checksum: string): void {
    const last = this.checksumTimeline[this.checksumTimeline.length - 1];
    if (last?.tick === this.mutableTick) last.checksum = checksum;
    else this.checksumTimeline.push({ tick: this.mutableTick, checksum });
  }

  private assertJournalCapacity(): void {
    if (this.entries.length >= MULTIPLAYER_LIMITS.journalEntries) {
      throw new Error("Match command journal capacity is exhausted.");
    }
  }

  dispatch(input: unknown): MatchDispatchResultV1 {
    const envelope = normalizeEnvelope(input);
    if (!envelope) return protocolRejection("envelope_invalid");
    if (envelope.matchId !== this.matchId) return protocolRejection("match_mismatch");
    const expectedSequence = this.nextSequenceByPlayer.get(envelope.playerId);
    if (expectedSequence === undefined) return protocolRejection("player_unknown");
    if (envelope.sequence < expectedSequence) {
      return protocolRejection("sequence_duplicate", { expectedSequence });
    }
    if (envelope.sequence > expectedSequence) {
      return protocolRejection("sequence_out_of_order", { expectedSequence });
    }
    if (envelope.matchSequence < this.mutableNextMatchSequence) {
      return protocolRejection("match_sequence_duplicate", { expectedMatchSequence: this.mutableNextMatchSequence });
    }
    if (envelope.matchSequence > this.mutableNextMatchSequence) {
      return protocolRejection("match_sequence_out_of_order", { expectedMatchSequence: this.mutableNextMatchSequence });
    }
    if (envelope.applyTick !== this.mutableTick) return protocolRejection("tick_mismatch");
    if (envelope.command.type === "tick") return protocolRejection("tick_owned_by_session");

    const towerId = "towerId" in envelope.command ? envelope.command.towerId : undefined;
    if (this.ownership.towerControl === "owner_only" && typeof towerId === "string") {
      const ownerPlayerId = this.towerOwnerById.get(towerId);
      if (ownerPlayerId !== undefined && ownerPlayerId !== envelope.playerId) {
        return protocolRejection("entity_not_owned", { ownerPlayerId });
      }
    }
    /* towerforge-optional:macroEconomy:start */
    if (this.ownership.towerControl === "owner_only" && envelope.command.type === "performRitual") {
      for (const ritualTowerId of envelope.command.towerIds) {
        const ownerPlayerId = this.towerOwnerById.get(ritualTowerId);
        if (ownerPlayerId !== undefined && ownerPlayerId !== envelope.playerId) {
          return protocolRejection("entity_not_owned", { ownerPlayerId });
        }
      }
    }
    /* towerforge-optional:macroEconomy:end */

    this.assertJournalCapacity();
    this.activatePlayerResources(envelope.playerId);
    const towerIdsBefore = envelope.command.type === "placeTower"
      ? new Set(this.game.getSnapshot().towers.map((tower) => tower.id))
      : undefined;
    const result = this.journaledGame.dispatch(envelope.command);
    if (result.ok && envelope.command.type === "placeTower" && towerIdsBefore) {
      const created = this.game.getSnapshot().towers.find((tower) => !towerIdsBefore.has(tower.id));
      if (!created) throw new Error("Accepted tower placement did not create exactly one tower.");
      this.towerOwnerById.set(created.id, envelope.playerId);
    }
    if (result.ok && envelope.command.type === "sellTower") {
      this.towerOwnerById.delete(envelope.command.towerId);
    }
    /* towerforge-optional:macroEconomy:start */
    if (result.ok && envelope.command.type === "performRitual") {
      for (const ritualTowerId of envelope.command.towerIds) this.towerOwnerById.delete(ritualTowerId);
    }
    /* towerforge-optional:macroEconomy:end */
    this.captureAndCanonicalizePlayerResources(envelope.playerId);
    this.nextSequenceByPlayer.set(envelope.playerId, expectedSequence + 1);
    this.mutableNextMatchSequence += 1;
    const checksum = this.stateChecksum();
    this.recordCurrentTickChecksum(checksum);
    const accepted = durableResult({
      ...result,
      acceptedSequence: envelope.sequence,
      acceptedMatchSequence: envelope.matchSequence,
      checksum
    }) as MatchCommandAcceptedResultV1;
    this.entries.push(Object.freeze({
      sequence: this.entries.length,
      kind: "command" as const,
      envelope: cloneCheckpointJson(envelope),
      checksum
    }));
    return accepted;
  }

  advanceTick(): Readonly<{ ok: true; tick: number; units: number; checksum: string }> {
    this.assertJournalCapacity();
    const resourcesBefore = this.ownership.resources === "partitioned"
      ? { ...this.game.getSnapshot().resources }
      : undefined;
    const result = this.journaledGame.dispatch({
      schemaVersion: 6,
      type: "tick",
      units: this.fixedTickUnits
    });
    if (!result.ok) throw new Error("The session-owned fixed tick was rejected by the simulation.");
    if (resourcesBefore) {
      const resourcesAfter = this.game.getSnapshot().resources;
      const resourceIds = [...new Set([
        ...Object.keys(resourcesBefore),
        ...Object.keys(resourcesAfter),
        ...[...this.resourcesByPlayer.values()].flatMap((resources) => Object.keys(resources))
      ])].sort(compareBinary);
      const delta = Object.fromEntries(resourceIds.map((resourceId) => [
        resourceId,
        (resourcesAfter[resourceId] ?? 0) - (resourcesBefore[resourceId] ?? 0)
      ]));
      for (const player of this.players) {
        const current = this.resourcesByPlayer.get(player.id)!;
        this.resourcesByPlayer.set(player.id, Object.freeze(Object.fromEntries(resourceIds.map((resourceId) => [
          resourceId,
          (current[resourceId] ?? 0) + (delta[resourceId] ?? 0)
        ]))));
      }
    }
    this.mutableTick += 1;
    const checksum = this.stateChecksum();
    this.recordCurrentTickChecksum(checksum);
    this.entries.push(Object.freeze({
      sequence: this.entries.length,
      kind: "tick" as const,
      tick: this.mutableTick,
      units: this.fixedTickUnits,
      checksum
    }));
    return Object.freeze({ ok: true as const, tick: this.mutableTick, units: this.fixedTickUnits, checksum });
  }

  getSnapshot(): MatchSnapshotV1 {
    const gameStateDigest = this.game.getStateDigest();
    const players = this.players.map((player) => Object.freeze({
      id: player.id,
      nextSequence: this.nextSequenceByPlayer.get(player.id) ?? 0,
      ...(this.ownership.resources === "partitioned"
        ? { resources: Object.freeze({ ...this.resourcesByPlayer.get(player.id) }) }
        : {})
    }));
    const towerOwnership = [...this.towerOwnerById.entries()]
      .sort(([left], [right]) => compareBinary(left, right))
      .map(([towerId, playerId]) => Object.freeze({ towerId, playerId }));
    const routeOwnership = [...this.routeOwnerById.entries()]
      .sort(([left], [right]) => compareBinary(left, right))
      .map(([routeId, playerId]) => Object.freeze({ routeId, playerId }));
    return Object.freeze({
      schemaVersion: 1 as const,
      protocolVersion: MATCH_PROTOCOL_VERSION,
      matchId: this.matchId,
      mode: this.mode,
      profileId: this.profileId,
      tick: this.mutableTick,
      fixedTickUnits: this.fixedTickUnits,
      nextMatchSequence: this.mutableNextMatchSequence,
      checksum: this.stateChecksum(),
      gameStateDigest,
      players: Object.freeze(players),
      towerOwnership: Object.freeze(towerOwnership),
      routeOwnership: Object.freeze(routeOwnership),
      game: this.game.getSnapshot()
    });
  }

  exportJournal(): MatchCommandJournalV1 {
    if (this.entries.length > MULTIPLAYER_LIMITS.journalEntries) {
      throw new Error("Match command journal entry limit exceeded.");
    }
    return cloneCheckpointJson({
      schemaVersion: MATCH_COMMAND_JOURNAL_SCHEMA_VERSION,
      protocolVersion: MATCH_PROTOCOL_VERSION,
      matchId: this.matchId,
      mode: this.mode,
      profileId: this.profileId,
      fixedTickUnits: this.fixedTickUnits,
      players: this.players,
      ownership: this.ownership,
      initialCheckpoint: this.initialCheckpoint,
      entries: this.entries
    });
  }


  exportChecksumTimeline(): MatchChecksumTimelineV1 {
    return cloneCheckpointJson({ schemaVersion: 1, frames: this.checksumTimeline });
  }
}

export interface MatchReplayResultV1 {
  readonly session: MatchSession;
  readonly entriesReplayed: number;
  readonly checksum: string;
}

/** Replay one detached local co-op match journal and fail on the first checksum divergence. */
export function replayMatchCommandJournal(options: {
  readonly content: GameContentRegistry;
  readonly journal: MatchCommandJournalV1;
}): MatchReplayResultV1 {
  const journal = normalizeMatchCommandJournal(options.journal);
  const session = MatchSession.restore({ content: options.content, journal });
  for (let index = 0; index < journal.entries.length; index += 1) {
    const entry = journal.entries[index]!;
    if (entry.sequence !== index) throw new Error(`Match journal sequence diverged at ${index}.`);
    const actual = entry.kind === "command"
      ? session.dispatch(entry.envelope)
      : session.advanceTick();
    if (!("checksum" in actual) || actual.checksum !== entry.checksum) {
      throw new Error(`Match journal checksum diverged at ${index}.`);
    }
  }
  const checksum = session.getSnapshot().checksum;
  return Object.freeze({ session, entriesReplayed: journal.entries.length, checksum });
}
