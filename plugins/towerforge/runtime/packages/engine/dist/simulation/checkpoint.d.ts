import type { TowerScriptDiagnostic, TowerScriptJson } from "../scripting/types.js";
import type { EnemyState, GameEvent, GameSnapshot, ResourceBag, RuntimeTerrainOverride, TowerState, WaveState } from "./types.js";
import type { SeededRngStateV1 } from "./rng.js";
import type { CombatState } from "./shields.js";
import type { ReactionStateV1 } from "./reactions.js";
export declare const GAME_CHECKPOINT_SCHEMA_VERSION: 1;
export declare const SIMULATION_ENGINE_VERSION: "towerforge-sim-v2";
export interface GameCheckpointIdentityV1 {
    readonly missionId: string;
    readonly difficultyId: string;
    readonly metaUpgradeLevels: Readonly<Record<string, number>>;
}
export interface CheckpointSpawnItemV1 {
    readonly at: number;
    readonly enemyId: string;
    readonly routeId?: string;
}
export interface RuntimeElevationOverrideV1 {
    readonly q: number;
    readonly r: number;
    readonly elevation: number;
}
export interface TerraformingCheckpointStateV1 {
    readonly schemaVersion: 1;
    readonly runtimeElevationOverrides: readonly RuntimeElevationOverrideV1[];
}
export interface TerraformingTerrainExpiryEntryV2 {
    readonly layer: "terrain";
    readonly order: number;
    readonly q: number;
    readonly r: number;
    readonly appliedTerrain: string;
    readonly previousOverride: {
        readonly terrain: string;
        readonly source: "script" | "ability";
    } | null;
}
export interface TerraformingElevationExpiryEntryV2 {
    readonly layer: "elevation";
    readonly order: number;
    readonly q: number;
    readonly r: number;
    readonly appliedElevation: number;
    readonly previousElevationOverride: number | null;
}
export type TerraformingExpiryEntryV2 = TerraformingTerrainExpiryEntryV2 | TerraformingElevationExpiryEntryV2;
export interface TerraformingExpiryGroupV2 {
    readonly sequence: number;
    readonly remaining: number;
    readonly entries: readonly TerraformingExpiryEntryV2[];
}
export interface TerraformingCheckpointStateV2 {
    readonly schemaVersion: 2;
    readonly runtimeElevationOverrides: readonly RuntimeElevationOverrideV1[];
    readonly nextExpiryGroupSequence: number;
    readonly pendingExpiryGroups: readonly TerraformingExpiryGroupV2[];
}
export type TerraformingCheckpointState = TerraformingCheckpointStateV1 | TerraformingCheckpointStateV2;
/** Authoritative mutable simulation state. Map occupancy and water cues are rebuilt derivatives. */
export interface GameCheckpointStateV1 {
    readonly coreHp: number;
    readonly resources: Readonly<ResourceBag>;
    readonly waveIndex: number;
    readonly startedWaveCount: number;
    readonly waveState: WaveState;
    readonly prepRemaining: number;
    readonly outcome: GameSnapshot["outcome"];
    readonly enemies: readonly EnemyState[];
    readonly towers: readonly TowerState[];
    readonly lastEvents: readonly GameEvent[];
    readonly enemyCounter: number;
    readonly towerCounter: number;
    readonly clearedWaveCount: number;
    readonly killCount: number;
    readonly leakCount: number;
    readonly killCountByEnemyType: Readonly<Record<string, number>>;
    readonly completedObjectiveIds: readonly string[];
    readonly earnedStarIds: readonly string[];
    readonly spawnQueue: readonly CheckpointSpawnItemV1[];
    readonly missionElapsed: number;
    readonly nextWaveStartAt: number | null;
    readonly abilityCooldowns: Readonly<Record<string, number>>;
    readonly runtimeTerrainOverrides: readonly RuntimeTerrainOverride[];
    readonly terraforming?: TerraformingCheckpointState;
    readonly scriptValues: Readonly<Record<string, Record<string, Record<string, TowerScriptJson>>>>;
    readonly scriptDiagnostics: readonly TowerScriptDiagnostic[];
    readonly scriptHandlerLastRun: Readonly<Record<string, number>>;
    readonly scriptEventCursor: number;
    readonly scriptActionsRemaining: number;
    readonly scriptTerrainChangesRemaining: number;
    readonly scriptSignalDepth: number;
    readonly combat?: CombatState;
    readonly reactions?: ReactionStateV1;
}
export interface GameCheckpointV1 {
    readonly schemaVersion: typeof GAME_CHECKPOINT_SCHEMA_VERSION;
    readonly engineVersion: typeof SIMULATION_ENGINE_VERSION;
    readonly contentDigest: string;
    readonly identity: GameCheckpointIdentityV1;
    readonly rng: {
        readonly initial: SeededRngStateV1;
        readonly current: SeededRngStateV1;
    };
    readonly state: GameCheckpointStateV1;
    readonly stateDigest: string;
}
export type CheckpointDescriptorMap = Record<PropertyKey, PropertyDescriptor>;
export declare function checkpointObjectDescriptors(value: unknown, context: string): CheckpointDescriptorMap;
export declare function checkpointDataField(descriptors: CheckpointDescriptorMap, key: string, context: string): unknown;
export declare function requireExactCheckpointKeys(descriptors: CheckpointDescriptorMap, expectedKeys: readonly string[], context: string): void;
export declare function inspectCheckpointEnvelope(value: unknown): CheckpointDescriptorMap;
/** Descriptor-safe detached JSON clone. Unsupported values and accessors are rejected. */
export declare function cloneCheckpointJson<T>(value: T): T;
export declare function computeCheckpointStateDigest(contentDigest: string, identity: GameCheckpointIdentityV1, rng: {
    readonly initial: SeededRngStateV1;
    readonly current: SeededRngStateV1;
}, state: GameCheckpointStateV1): string;
