import type { GameContentRegistry, WorldCampaignDefinition, WorldCampaignDefinitionV1, WorldCampaignDefinitionV2, WorldCampaignNodeV1, WorldCampaignNodeV2, WorldCampaignRunResourceDefinitionV2, WorldMapCatalog } from "../content/registry.js";
import { type PlayerProfileFailureCode, type PlayerProfileV3 } from "../profile/player-profile.js";
import { type CampaignRunV1 } from "./campaign-run.js";
export declare const WORLD_CAMPAIGN_SCHEMA: Readonly<{
    supportedSchemaVersions: readonly [1, 2];
    nodeTypes: readonly ["battle", "elite", "merchant", "event", "boss"];
    limits: Readonly<{
        jsonBytes: 1048576;
        nodes: 1024;
        edges: 8192;
        entryNodes: 64;
        idUtf8Bytes: 128;
        labelUtf8Bytes: 256;
        runResources: 256;
        choicesPerNode: 16;
        resourceEntriesPerBag: 16;
        totalChoices: 4096;
        totalResourceEntries: 8192;
        resourceAmount: 1000000000;
        runResourceBalance: number;
    }>;
    versions: Readonly<{
        1: Readonly<{
            structuralNodes: Readonly<{
                choices: false;
            }>;
        }>;
        2: Readonly<{
            root: Readonly<{
                requiredFields: readonly ["schemaVersion", "rogueliteProfileId", "runResources", "entryNodeIds", "nodes"];
            }>;
            structuralNodes: Readonly<{
                requiredFields: readonly ["id", "type", "label", "regionId", "x", "y", "difficulty", "nextNodeIds", "choices"];
                choice: Readonly<{
                    requiredFields: readonly ["id", "label", "costs", "grants"];
                    optionalFields: readonly [];
                    additionalProperties: false;
                }>;
            }>;
        }>;
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
export type ResolvedWorldCampaignNodeV2 = WorldCampaignNodeV2;
export interface ResolvedWorldCampaignV2 {
    readonly schemaVersion: 2;
    readonly source: "authored";
    readonly rogueliteProfileId: string;
    readonly runResources: Readonly<Record<string, WorldCampaignRunResourceDefinitionV2>>;
    readonly entryNodeIds: readonly string[];
    readonly nodes: readonly ResolvedWorldCampaignNodeV2[];
}
export type ResolvedWorldCampaign = ResolvedWorldCampaignV1 | ResolvedWorldCampaignV2;
/** Validate, normalize, sort, and deeply freeze an authored v1 campaign graph. */
export declare function normalizeAuthoredWorldCampaignV1(value: unknown, content?: GameContentRegistry): ResolvedWorldCampaignV1;
/** Validate, normalize, sort, and deeply freeze an authored v2 campaign graph. */
export declare function normalizeAuthoredWorldCampaignV2(value: unknown, content?: GameContentRegistry): ResolvedWorldCampaignV2;
/** Dispatch an authored graph without mutating or migrating either version. */
export declare function normalizeAuthoredWorldCampaign(value: unknown, content?: GameContentRegistry): ResolvedWorldCampaignV1 | ResolvedWorldCampaignV2;
/** Read-only compatibility projection of legacy mission unlock requirements into forward edges. */
export declare function normalizeLegacyWorldCampaignV1(worldMap: WorldMapCatalog): ResolvedWorldCampaignV1;
/** Resolve only a genuinely active authored v4 campaign; legacy content remains capability-inert. */
export declare function resolveWorldCampaign(content: GameContentRegistry): ResolvedWorldCampaign | undefined;
export type CampaignRunContentValidationResult = Readonly<{
    ok: true;
    code: "valid";
    run: CampaignRunV1;
    campaign: ResolvedWorldCampaign;
} | {
    ok: false;
    code: "campaign_inactive" | "invalid_run" | "unknown_node" | "unknown_card" | "unknown_artifact" | "unknown_run_resource" | "invalid_run_resource";
    run: CampaignRunV1;
}>;
/** Validate the unchanged CampaignRunV1 codec document against currently active authored content. */
export declare function validateCampaignRunAgainstContent(run: CampaignRunV1, content: GameContentRegistry): CampaignRunContentValidationResult;
/** Return binary-sorted entries or direct successors; it never evaluates merchant/event gameplay. */
export declare function getAvailableCampaignNodeIds(run: CampaignRunV1, content: GameContentRegistry): readonly string[];
export type CampaignBattleVictoryFailureCode = "campaign_inactive" | "invalid_run" | "unknown_node" | "unknown_card" | "unknown_artifact" | "unknown_run_resource" | "invalid_run_resource" | "node_not_available" | "node_type_not_implemented" | "invalid_profile" | PlayerProfileFailureCode;
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
export type CampaignStructuralChoiceFailureCode = "campaign_inactive" | "invalid_run" | "unknown_node" | "unknown_card" | "unknown_artifact" | "unknown_run_resource" | "invalid_run_resource" | "node_not_available" | "node_type_not_implemented" | "unknown_choice" | "insufficient_run_resources" | "resource_overflow";
export type CampaignStructuralChoiceResult = Readonly<{
    ok: false;
    code: CampaignStructuralChoiceFailureCode;
    run: CampaignRunV1;
} | {
    ok: true;
    code: "campaign_structural_choice_resolved";
    nodeId: string;
    choiceId: string;
    run: CampaignRunV1;
    newlyAvailableNodeIds: readonly string[];
}>;
/** Atomically pay and grant one authored v2 merchant/event choice, then advance the run. */
export declare function resolveCampaignStructuralChoice(run: CampaignRunV1, content: GameContentRegistry, nodeId: string, choiceId: string): CampaignStructuralChoiceResult;
/** Author-facing input alias retained separately from the normalized runtime shape. */
export type AuthoredWorldCampaignV1 = WorldCampaignDefinitionV1;
export type AuthoredWorldCampaignV2 = WorldCampaignDefinitionV2;
export type AuthoredWorldCampaign = WorldCampaignDefinition;
