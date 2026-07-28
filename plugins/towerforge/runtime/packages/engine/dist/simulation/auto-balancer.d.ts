export interface AutoBalanceCandidateV1 {
    readonly id: string;
    readonly patch: Readonly<Record<string, unknown>>;
}
export interface AutoBalanceBatchRequestV1 {
    readonly baselineScore: number;
    readonly candidates: readonly AutoBalanceCandidateV1[];
    readonly seeds: readonly string[];
    readonly strategyIds: readonly string[];
    readonly evaluate: (run: {
        readonly candidateId: string;
        readonly seed: string;
        readonly strategyId: string;
    }) => number;
    readonly isCancelled?: () => boolean;
}
export declare function runAutoBalancerBatch(request: AutoBalanceBatchRequestV1): Readonly<{
    schemaVersion: 1;
    status: "cancelled";
    evaluatedRuns: number;
    proposals: readonly never[];
}> | Readonly<{
    schemaVersion: 1;
    status: "completed";
    evaluatedRuns: number;
    proposals: readonly Readonly<{
        id: string;
        rank: number;
        patch: Readonly<Record<string, unknown>>;
        evidence: Readonly<{
            improvement: number;
            seeds: readonly string[];
            strategyIds: readonly string[];
            runCount: number;
            baselineScore: number;
            candidateScore: number;
        }>;
    }>[];
}>;
export declare const AUTO_BALANCER_LIMITS: Readonly<{
    candidates: 32;
    seeds: 64;
    strategies: 32;
    totalCandidateRuns: 4096;
    idUtf8Bytes: 128;
    dimensionValueUtf8Bytes: 256;
    patchBytes: number;
}>;
