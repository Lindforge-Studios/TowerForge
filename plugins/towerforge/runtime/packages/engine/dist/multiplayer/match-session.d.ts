import type { GameContentRegistry } from "../content/registry.js";
import { type MultiplayerOwnershipV1 } from "../content/multiplayer-mechanics.js";
import { type GameCommand } from "../simulation/command-internal.js";
import { type GameCheckpointV1 } from "../simulation/checkpoint.js";
import type { GameSeed } from "../simulation/rng.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";
import type { ActionResult, GameSnapshot, ResourceBag } from "../simulation/types.js";
export declare const MATCH_PROTOCOL_VERSION: 1;
export declare const MATCH_COMMAND_JOURNAL_SCHEMA_VERSION: 1;
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
    readonly code: "envelope_invalid" | "match_mismatch" | "player_unknown" | "sequence_duplicate" | "sequence_out_of_order" | "match_sequence_duplicate" | "match_sequence_out_of_order" | "tick_mismatch" | "tick_owned_by_session" | "entity_not_owned";
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
    readonly frames: readonly {
        readonly tick: number;
        readonly checksum: string;
    }[];
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
export type MatchCommandJournalEntryV1 = MatchCommandJournalCommandEntryV1 | MatchCommandJournalTickEntryV1;
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
export declare class MatchSession {
    readonly matchId: string;
    readonly mode: "local_coop";
    readonly profileId: string;
    readonly fixedTickUnits: number;
    readonly players: readonly MatchPlayerV1[];
    readonly ownership: MultiplayerOwnershipV1;
    private journaledGame;
    private readonly initialCheckpoint;
    private readonly nextSequenceByPlayer;
    private readonly towerOwnerById;
    private readonly resourcesByPlayer;
    private readonly routeOwnerById;
    private readonly entries;
    private readonly checksumTimeline;
    private mutableTick;
    private mutableNextMatchSequence;
    private constructor();
    get game(): Readonly<TowerDefenseGame>;
    static create(options: MatchSessionCreateOptionsV1): MatchSession;
    static restore(options: {
        readonly content: GameContentRegistry;
        readonly journal: MatchCommandJournalV1;
    }): MatchSession;
    get currentTick(): number;
    private stateChecksum;
    private replaceGameResources;
    private activatePlayerResources;
    private captureAndCanonicalizePlayerResources;
    private recordCurrentTickChecksum;
    private assertJournalCapacity;
    dispatch(input: unknown): MatchDispatchResultV1;
    advanceTick(): Readonly<{
        ok: true;
        tick: number;
        units: number;
        checksum: string;
    }>;
    getSnapshot(): MatchSnapshotV1;
    exportJournal(): MatchCommandJournalV1;
    exportChecksumTimeline(): MatchChecksumTimelineV1;
}
export interface MatchReplayResultV1 {
    readonly session: MatchSession;
    readonly entriesReplayed: number;
    readonly checksum: string;
}
/** Replay one detached local co-op match journal and fail on the first checksum divergence. */
export declare function replayMatchCommandJournal(options: {
    readonly content: GameContentRegistry;
    readonly journal: MatchCommandJournalV1;
}): MatchReplayResultV1;
