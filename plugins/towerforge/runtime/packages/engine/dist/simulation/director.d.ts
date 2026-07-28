import type { DirectorConditionV1, DirectorProfileV1 } from "../content/director-mechanics.js";
import type { WaveDefinition, WaveGroup } from "./types.js";
export interface DirectorDefenseAnalysisV1 {
    readonly damageShares: Readonly<Record<string, number>>;
    readonly coverageRatios: Readonly<Record<string, number>>;
    readonly movementLayerShares: Readonly<Record<string, number>>;
    readonly logisticsBrownoutRatio: number;
}
export interface DirectorPolicyRequestV1 {
    readonly nextWaveIndex: number;
    readonly nextWave: WaveDefinition;
    readonly analysis: DirectorDefenseAnalysisV1;
    readonly recentCounterIds: readonly string[];
}
export interface DirectorWavePlanV1 {
    readonly schemaVersion: 1;
    readonly nextWaveIndex: number;
    readonly authoredWaveId: string;
    readonly decision: {
        readonly counterId: string;
        readonly threatCost: number;
        readonly reason: DirectorConditionV1 & {
            readonly observed: number;
        };
        readonly addedGroups: readonly WaveGroup[];
    };
    readonly wave: Readonly<Omit<WaveDefinition, "groups"> & {
        readonly groups: readonly WaveGroup[];
    }>;
}
/** Pure authored-pool-only policy. It never mutates the authored wave or request. */
export declare function planDirectorWaveV1(profile: DirectorProfileV1, request: DirectorPolicyRequestV1): DirectorWavePlanV1 | undefined;
