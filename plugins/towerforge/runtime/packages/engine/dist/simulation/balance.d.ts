import { type GameContentRegistry } from "../content/registry.js";
import type { GameSnapshot } from "./types.js";
import type { GameSeed } from "./rng.js";
/**
 * Simulation-driven balance analysis.
 *
 * The engine is deterministic for a given seed. Legacy sweeps keep seed 0 and vary the *player
 * strategy* (which towers, upgrades); R7 callers may additionally pin another seed and a strategy
 * subset. We aggregate win-rate, surviving core HP, and tower usage into an actionable balance
 * report — the substrate an AI co-designer (or a human) drives in an
 * author → simulate → diagnose → patch loop.
 */
export interface BalanceStrategy {
    id: string;
    label: string;
    towerIds: string[];
    upgrade: boolean;
    placement: "near_path" | "far_path" | "near_core";
    rebuildInterval: number;
}
export interface StrategyResult {
    strategyId: string;
    label: string;
    strategy: BalanceStrategy;
    outcome: GameSnapshot["outcome"];
    win: boolean;
    coreHpRemaining: number;
    towersBuilt: number;
    leaks: number;
    elapsed: number;
    towerCounts: Record<string, number>;
    /** Present only for explicitly seeded sweeps; omitted to preserve the legacy report shape. */
    seed?: GameSeed;
}
export interface BalanceFlag {
    severity: "error" | "warning" | "info";
    code: string;
    entityId?: string;
    message: string;
    suggestion?: string;
}
export interface MissionBalance {
    missionId: string;
    label: string;
    strategyCount: number;
    winRate: number;
    avgCoreHpRemaining: number;
    avgClearTime: number | null;
    soloWinners: string[];
    towerUsage: Record<string, {
        built: number;
        inWins: number;
    }>;
    results: StrategyResult[];
    flags: BalanceFlag[];
}
export interface BalanceReport {
    missions: MissionBalance[];
    summary: {
        missions: number;
        winnable: number;
        flagged: number;
    };
    generatedWith: {
        strategiesPerMission: number;
        simSeconds: number;
        tickStep: number;
        seed?: GameSeed;
    };
}
export interface BalanceSweepOptions {
    missionIds?: string[];
    simSeconds?: number;
    tickStep?: number;
    maxStrategies?: number;
    /** Optional deterministic simulation seed. Omitted legacy sweeps continue to use seed 0. */
    seed?: GameSeed;
    /** Optional allowlist of generated strategy ids, evaluated in canonical strategy order. */
    strategyIds?: string[];
}
export declare function runBalanceSweep(content: GameContentRegistry, options?: BalanceSweepOptions): BalanceReport;
