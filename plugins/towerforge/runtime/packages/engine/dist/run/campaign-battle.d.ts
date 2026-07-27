import type { GameContentRegistry } from "../content/registry.js";
import { type PlayerProfileFailureCode, type PlayerProfileV3 } from "../profile/player-profile.js";
import { TowerDefenseGame, type CampaignBattleLoadoutV1 } from "../simulation/TowerDefenseGame.js";
import { type CampaignRunV1 } from "./campaign-run.js";
export type CampaignBattleFailureCode = "campaign_inactive" | "campaign_handoff_inactive" | "invalid_run" | "unknown_node" | "unknown_card" | "unknown_artifact" | "unknown_run_resource" | "invalid_run_resource" | "node_not_available" | "node_type_not_implemented" | "modifier_budget_exceeded" | "battle_context_mismatch" | "battle_not_victorious" | "run_capacity_exceeded" | "invalid_profile" | PlayerProfileFailureCode;
export interface CampaignBattleLaunchV1 {
    readonly launchId: string;
    readonly battleSeed: string;
    readonly missionId: string;
    readonly loadout: CampaignBattleLoadoutV1;
}
export type CampaignBattlePreparationResult = Readonly<{
    ok: false;
    code: CampaignBattleFailureCode;
    run: CampaignRunV1;
} | {
    ok: true;
    code: "campaign_battle_prepared";
    nodeId: string;
    missionId: string;
    launchId: string;
    battleSeed: string;
    run: CampaignRunV1;
    launch: CampaignBattleLaunchV1;
    game: TowerDefenseGame;
}>;
export type CampaignBattleSettlementResult = Readonly<{
    ok: false;
    code: CampaignBattleFailureCode;
    run: CampaignRunV1;
    profile: PlayerProfileV3;
} | {
    ok: true;
    code: "campaign_battle_settled";
    nodeId: string;
    run: CampaignRunV1;
    profile: PlayerProfileV3;
    newlyAvailableNodeIds: readonly string[];
}>;
export declare function prepareCampaignBattle(run: CampaignRunV1, content: GameContentRegistry, nodeId: string): CampaignBattlePreparationResult;
export declare function settleCampaignBattleVictory(run: CampaignRunV1, profile: PlayerProfileV3, content: GameContentRegistry, nodeId: string, earnedStars: number, game: TowerDefenseGame): CampaignBattleSettlementResult;
