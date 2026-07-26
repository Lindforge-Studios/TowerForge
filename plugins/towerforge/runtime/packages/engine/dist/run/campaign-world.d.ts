import type { GameContentRegistry, WorldCampaignDefinitionV1, WorldCampaignNodeV1, WorldMapCatalog } from "../content/registry.js";
import { type PlayerProfileFailureCode, type PlayerProfileV3 } from "../profile/player-profile.js";
import { type CampaignRunV1 } from "./campaign-run.js";
export declare const WORLD_CAMPAIGN_SCHEMA: Readonly<{
    supportedSchemaVersions: readonly [1];
    nodeTypes: readonly ["battle", "elite", "merchant", "event", "boss"];
    limits: Readonly<{
        jsonBytes: 1048576;
        nodes: 1024;
        edges: 8192;
        entryNodes: 64;
        idUtf8Bytes: 128;
        labelUtf8Bytes: 256;
    }>;
}>;
export declare class WorldCampaignValidationError extends Error {
    readonly fieldPath: string;
    constructor(fieldPath: string, message: string);
}
export type ResolvedWorldCampaignNodeV1 = WorldCampaignNodeV1;
export interface ResolvedWorldCampaignV1 {
    readonly schemaVersion: 1;
    readonly source: "authored" | "legacy";
    readonly rogueliteProfileId: string | null;
    readonly entryNodeIds: readonly string[];
    readonly nodes: readonly ResolvedWorldCampaignNodeV1[];
}
/** Validate, normalize, sort, and deeply freeze an authored campaign graph. */
export declare function normalizeAuthoredWorldCampaignV1(value: unknown, content?: GameContentRegistry): ResolvedWorldCampaignV1;
/** Read-only compatibility projection of legacy mission unlock requirements into forward edges. */
export declare function normalizeLegacyWorldCampaignV1(worldMap: WorldMapCatalog): ResolvedWorldCampaignV1;
/** Resolve only a genuinely active authored v4 campaign; legacy content remains capability-inert. */
export declare function resolveWorldCampaign(content: GameContentRegistry): ResolvedWorldCampaignV1 | undefined;
export type CampaignRunContentValidationResult = Readonly<{
    ok: true;
    code: "valid";
    run: CampaignRunV1;
    campaign: ResolvedWorldCampaignV1;
} | {
    ok: false;
    code: "campaign_inactive" | "invalid_run" | "unknown_node" | "unknown_card" | "unknown_artifact";
    run: CampaignRunV1;
}>;
/** Validate the unchanged CampaignRunV1 codec document against currently active authored content. */
export declare function validateCampaignRunAgainstContent(run: CampaignRunV1, content: GameContentRegistry): CampaignRunContentValidationResult;
/** Return binary-sorted entries or direct successors; it never evaluates merchant/event gameplay. */
export declare function getAvailableCampaignNodeIds(run: CampaignRunV1, content: GameContentRegistry): readonly string[];
export type CampaignBattleVictoryFailureCode = "campaign_inactive" | "invalid_run" | "unknown_node" | "unknown_card" | "unknown_artifact" | "node_not_available" | "node_type_not_implemented" | "invalid_profile" | PlayerProfileFailureCode;
export type CampaignBattleVictoryResult = Readonly<{
    ok: false;
    code: CampaignBattleVictoryFailureCode;
    run: CampaignRunV1;
    profile: PlayerProfileV3;
} | {
    ok: true;
    code: "campaign_battle_recorded";
    nodeId: string;
    run: CampaignRunV1;
    profile: PlayerProfileV3;
    newlyAvailableNodeIds: readonly string[];
}>;
/** Atomically apply a graph-available battle result to separate immutable run and profile documents. */
export declare function recordCampaignBattleVictory(run: CampaignRunV1, profile: PlayerProfileV3, content: GameContentRegistry, nodeId: string, earnedStars: number): CampaignBattleVictoryResult;
/** Author-facing input alias retained separately from the normalized runtime shape. */
export type AuthoredWorldCampaignV1 = WorldCampaignDefinitionV1;
