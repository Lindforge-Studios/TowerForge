import type { GameContentRegistry } from "../content/registry.js";
export interface CampaignBattleDeckEntry {
    readonly cardId: string;
}
/**
 * Upper bound for one tower's run-stage modifier fan-in during a campaign battle.
 * The same policy guards preparation, direct construction, and checkpoint restore.
 */
export declare function campaignBattleWorstCaseModifierCount(deck: readonly CampaignBattleDeckEntry[], content: GameContentRegistry, missionId: string): number;
