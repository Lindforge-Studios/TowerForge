import type { GameSeed } from "../simulation/rng.js";
export declare const CAMPAIGN_RUN_SCHEMA_VERSION: 1;
export declare const CAMPAIGN_RUN_LIMITS: Readonly<{
    jsonBytes: 1048576;
    collectionEntries: 10000;
    identifierCodeUnits: 256;
    seedCodeUnits: 4096;
    maxDepth: 8;
    maxNodes: 50000;
}>;
export interface CampaignRunDeckEntryV1 {
    readonly instanceId: string;
    readonly cardId: string;
}
export interface CampaignRunArtifactEntryV1 {
    readonly instanceId: string;
    readonly artifactId: string;
}
export interface CampaignRunV1 {
    readonly version: typeof CAMPAIGN_RUN_SCHEMA_VERSION;
    readonly seed: GameSeed;
    readonly nodeId: string | null;
    readonly deck: readonly CampaignRunDeckEntryV1[];
    readonly artifacts: readonly CampaignRunArtifactEntryV1[];
    readonly runResources: Readonly<Record<string, number>>;
}
export type CampaignRun = CampaignRunV1;
export type CampaignRunSource = "v1";
export interface CampaignRunMigration {
    readonly id: string;
    readonly description: string;
}
export interface DecodedCampaignRun {
    readonly run: CampaignRunV1;
    readonly source: CampaignRunSource;
    readonly migrations: readonly CampaignRunMigration[];
}
export declare class UnsupportedCampaignRunVersionError extends Error {
    readonly code: "UNSUPPORTED_CAMPAIGN_RUN_VERSION";
    readonly version: number;
    constructor(version: number);
}
export declare function createCampaignRun(seed: GameSeed): CampaignRunV1;
export declare function decodeCampaignRun(value: unknown): DecodedCampaignRun;
export declare function importCampaignRun(source: string): DecodedCampaignRun;
export declare function exportCampaignRun(run: CampaignRunV1): string;
