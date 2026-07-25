export declare const SEEDED_RNG_STATE_SCHEMA_VERSION: 1;
export declare const SEEDED_RNG_ALGORITHM: "xoshiro128ss";
export declare const SEED_EXPANSION_VERSION: 1;
export type GameSeed = string | number;
export interface SeededRngStateV1 {
    readonly schemaVersion: typeof SEEDED_RNG_STATE_SCHEMA_VERSION;
    readonly algorithm: typeof SEEDED_RNG_ALGORITHM;
    readonly words: readonly [number, number, number, number];
}
/** A deterministic, serializable xoshiro128** random number generator. */
export declare class SeededRng {
    private words;
    constructor(seed: GameSeed);
    static fromState(state: SeededRngStateV1): SeededRng;
    nextUint32(): number;
    nextInt(maxExclusive: number): number;
    exportState(): SeededRngStateV1;
}
