import type { GameContentRegistry } from "../content/registry.js";
import { type GameCheckpointV1 } from "../simulation/checkpoint.js";
import type { GameSeed } from "../simulation/rng.js";
import { type GameCommand } from "../simulation/command-internal.js";
import type { ActionResult, GameSnapshot } from "../simulation/types.js";
import { type MatchPlayerV1 } from "./match-session.js";
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
    readonly players: readonly {
        readonly id: string;
        readonly nextSequence: number;
    }[];
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
    readonly entries: readonly ({
        readonly sequence: number;
        readonly kind: "command";
        readonly envelope: AsymmetricMatchCommandEnvelopeV1;
        readonly checksum: string;
    } | {
        readonly sequence: number;
        readonly kind: "tick";
        readonly tick: number;
        readonly checksum: string;
    })[];
}
type RejectionCode = "envelope_invalid" | "match_mismatch" | "player_unknown" | "sequence_duplicate" | "sequence_out_of_order" | "match_sequence_duplicate" | "match_sequence_out_of_order" | "tick_mismatch" | "tick_owned_by_session" | "send_not_authored" | "insufficient_resources";
export type AsymmetricDispatchResultV1 = Readonly<{
    ok: true;
    acceptedSequence: number;
    acceptedMatchSequence: number;
    lanePlayerId: string;
    sendId: string;
    targetPlayerId: string;
    checksum: string;
}> | Readonly<ActionResult & {
    acceptedSequence: number;
    acceptedMatchSequence: number;
    lanePlayerId: string;
    checksum: string;
}> | Readonly<{
    ok: false;
    code: RejectionCode;
    expectedSequence?: number;
    expectedMatchSequence?: number;
}>;
export declare class AsymmetricMatchSession {
    readonly matchId: string;
    readonly mode: "asymmetric_send_vs_build";
    readonly profileId: string;
    readonly fixedTickUnits: number;
    readonly players: readonly MatchPlayerV1[];
    private readonly content;
    private readonly profile;
    private readonly games;
    private readonly initialCheckpoints;
    private readonly nextSequenceByPlayer;
    private readonly entries;
    private mutableTick;
    private mutableNextMatchSequence;
    private constructor();
    static create(options: {
        readonly schemaVersion: 1;
        readonly matchId: string;
        readonly profileId: string;
        readonly content: GameContentRegistry;
        readonly missionId: string;
        readonly fixedTickUnits: number;
        readonly seed?: GameSeed;
        readonly players: readonly MatchPlayerV1[];
    }): AsymmetricMatchSession;
    private stateChecksum;
    dispatch(value: unknown): AsymmetricDispatchResultV1;
    advanceTick(): Readonly<{
        ok: true;
        tick: number;
        checksum: string;
    }>;
    getSnapshot(): AsymmetricMatchSnapshotV1;
    exportJournal(): AsymmetricMatchJournalV1;
    private assertJournalCapacity;
    static restore(content: GameContentRegistry, journal: AsymmetricMatchJournalV1): AsymmetricMatchSession;
}
export declare function replayAsymmetricMatchJournal(options: {
    readonly content: GameContentRegistry;
    readonly journal: AsymmetricMatchJournalV1;
}): Readonly<{
    session: AsymmetricMatchSession;
    entriesReplayed: number;
    checksum: string;
}>;
export {};
