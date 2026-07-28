import type { TowerScriptDiagnostic, TowerScriptJson } from "../scripting/types.js";
import type { EnemyState, DirectorSnapshotV1, GameEvent, GameSnapshot, ResourceBag, RuntimeTerrainOverride, TowerState, WaveState } from "./types.js";
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
export interface ArtifactCheckpointInventoryEntryV1 {
    readonly instanceId: string;
    readonly artifactId: string;
}
export interface ArtifactCheckpointStateV1 {
    readonly schemaVersion: 1;
    readonly rng: {
        readonly initial: SeededRngStateV1;
        readonly current: SeededRngStateV1;
    };
    readonly nextInstanceSequence: number;
    readonly inventory: readonly ArtifactCheckpointInventoryEntryV1[];
}
export interface ArtifactCheckpointSocketRefV2 {
    readonly towerId: string;
    readonly slotId: string;
}
export interface ArtifactCheckpointInventoryEntryV2 extends ArtifactCheckpointInventoryEntryV1 {
    readonly socket: ArtifactCheckpointSocketRefV2 | null;
}
export interface ArtifactCheckpointStateV2 {
    readonly schemaVersion: 2;
    readonly rng: {
        readonly initial: SeededRngStateV1;
        readonly current: SeededRngStateV1;
    };
    readonly nextInstanceSequence: number;
    readonly inventory: readonly ArtifactCheckpointInventoryEntryV2[];
}
export interface ArtifactCheckpointStateV3 {
    readonly schemaVersion: 3;
    readonly rng: ArtifactCheckpointStateV2["rng"];
    readonly nextInstanceSequence: number;
    readonly inventory: readonly ArtifactCheckpointInventoryEntryV2[];
}
export type ArtifactCheckpointState = ArtifactCheckpointStateV1 | ArtifactCheckpointStateV2 | ArtifactCheckpointStateV3;
export interface DraftCheckpointPendingOfferV1 {
    readonly offerId: string;
    readonly afterWaveIndex: number;
    readonly poolId: string;
    readonly cardIds: readonly [string, string, string];
}
export interface DraftCheckpointSelectionV1 {
    readonly sequence: number;
    readonly offerId: string;
    readonly cardId: string;
}
export interface DraftCheckpointSelectionV2 extends DraftCheckpointSelectionV1 {
    readonly instanceId: string;
}
export interface DraftCheckpointStateV1 {
    readonly schemaVersion: 1;
    readonly rng: {
        readonly initial: SeededRngStateV1;
        readonly current: SeededRngStateV1;
    };
    readonly nextOfferSequence: number;
    readonly pendingOffer: DraftCheckpointPendingOfferV1 | null;
    readonly selections: readonly DraftCheckpointSelectionV1[];
}
export interface DraftCheckpointStateV2 {
    readonly schemaVersion: 2;
    readonly rng: DraftCheckpointStateV1["rng"];
    readonly nextOfferSequence: number;
    readonly pendingOffer: DraftCheckpointPendingOfferV1 | null;
    readonly selections: readonly DraftCheckpointSelectionV2[];
}
export type DraftCheckpointState = DraftCheckpointStateV1 | DraftCheckpointStateV2;
export interface CampaignBattleCheckpointStateV1 {
    readonly schemaVersion: 1;
    readonly launchId: string;
    readonly nodeId: string;
    readonly maxNewArtifactInstances: number;
    readonly deck: readonly {
        readonly instanceId: string;
        readonly cardId: string;
    }[];
    readonly artifacts: readonly {
        readonly instanceId: string;
        readonly artifactId: string;
    }[];
}
export interface HeroesCheckpointStateV1 {
    readonly schemaVersion: 1;
    readonly unit: {
        readonly definitionId: string;
        readonly currentCoord: Readonly<{
            q: number;
            r: number;
        }>;
        readonly targetCoord: Readonly<{
            q: number;
            r: number;
        }> | null;
        readonly nextCoord: Readonly<{
            q: number;
            r: number;
        }> | null;
        readonly edgeProgress: number;
    };
}
export interface HeroesCheckpointStateV2 {
    readonly schemaVersion: 2;
    readonly unit: HeroesCheckpointStateV1["unit"] & {
        readonly hp: number;
        readonly shieldCurrent: number;
    };
}
export interface HeroesCheckpointStateV3 {
    readonly schemaVersion: 3;
    readonly unit: HeroesCheckpointStateV2["unit"] & {
        readonly mana: number;
        readonly abilityCooldownRemaining: number;
    };
}
export interface HeroesCheckpointStateV4 {
    readonly schemaVersion: 4;
    readonly unit: HeroesCheckpointStateV3["unit"] & {
        readonly skillPoints: number;
        readonly unlockedSkillIds: readonly string[];
    };
}
export interface LogisticsCheckpointStateV1 {
    readonly schemaVersion: 1;
    readonly ammunition: {
        readonly inventories: readonly {
            readonly towerId: string;
            readonly amount: number;
        }[];
    };
}
export interface LogisticsCheckpointStateV2 {
    readonly schemaVersion: 2;
    readonly ammunition: {
        readonly inventories: readonly {
            readonly towerId: string;
            readonly amount: number;
        }[];
    } | null;
    readonly supply: {
        readonly producers: readonly {
            readonly towerId: string;
            readonly amount: number;
            readonly productionProgress: number;
            readonly transferProgress: number;
        }[];
        readonly storages: readonly {
            readonly towerId: string;
            readonly amount: number;
            readonly transferProgress: number;
        }[];
    } | null;
}
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
    readonly artifacts?: ArtifactCheckpointState;
    readonly draft?: DraftCheckpointState;
    readonly campaignBattle?: CampaignBattleCheckpointStateV1;
    readonly heroes?: HeroesCheckpointStateV1 | HeroesCheckpointStateV2 | HeroesCheckpointStateV3 | HeroesCheckpointStateV4;
    readonly logistics?: LogisticsCheckpointStateV1 | LogisticsCheckpointStateV2;
    readonly director?: DirectorSnapshotV1;
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
