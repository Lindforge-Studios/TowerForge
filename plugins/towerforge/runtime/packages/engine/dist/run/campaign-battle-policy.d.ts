import type { GameContentRegistry } from "../content/registry.js";
import { type HeroesProfileV6 } from "../content/heroes-mechanics.js";
export interface CampaignBattleDeckEntry {
    readonly cardId: string;
}
/**
 * Upper bound for one tower's run-stage modifier fan-in during a campaign battle.
 * The same policy guards preparation, direct construction, and checkpoint restore.
 */
export declare function campaignBattleRogueliteWorstCaseModifierCount(deck: readonly CampaignBattleDeckEntry[], content: GameContentRegistry, missionId: string): number;
/** Shared run + reserved stages + selected passive-aura upper bound. */
export declare function campaignBattleWorstCaseModifierCount(deck: readonly CampaignBattleDeckEntry[], content: GameContentRegistry, missionId: string): number;
export interface HeroAuraDamageFinitePreflightOptions {
    readonly deck?: readonly CampaignBattleDeckEntry[];
    /** Structurally normalized profile used to diagnose inactive/unselected authoring as a warning. */
    readonly heroesProfile?: HeroesProfileV6;
}
export type HeroAuraDamageFinitePreflightResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly towerTypeId: string;
    readonly fieldPath: string;
    readonly message: string;
};
/**
 * Conservative finite upper bound for every authored immediate tower packet that can receive the
 * selected v6 aura. No-aura projects return immediately and retain legacy runtime/preflight timing.
 */
export declare function preflightHeroAuraDamageFinite(content: GameContentRegistry, missionId: string, options?: HeroAuraDamageFinitePreflightOptions): HeroAuraDamageFinitePreflightResult;
