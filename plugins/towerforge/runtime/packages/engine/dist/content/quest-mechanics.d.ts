import type { GameContentRegistry } from "./registry.js";
import type { GameSeed } from "../simulation/rng.js";
export declare const QUEST_LIMITS: Readonly<{
    selectionCount: 3;
    definitions: 256;
    weight: 1000000;
    count: 1000000;
    waves: 10000;
    idUtf8Bytes: 128;
    labelUtf8Bytes: 256;
}>;
export declare const QUEST_SOURCE_KINDS: readonly ["tower", "ability", "tower_script", "status", "reaction"];
export declare const QUEST_SHIELD_SCOPES: readonly ["tower", "hero", "any"];
export type QuestSourceKindV1 = (typeof QUEST_SOURCE_KINDS)[number];
export type QuestShieldScopeV1 = (typeof QUEST_SHIELD_SCOPES)[number];
export interface QuestKillWithSourceObjectiveV1 {
    readonly kind: "kill_with_source";
    readonly count: number;
    readonly source: {
        readonly kind: QuestSourceKindV1;
        readonly id: string;
    };
}
export interface QuestPreserveShieldObjectiveV1 {
    readonly kind: "preserve_shield";
    readonly waves: number;
    readonly scope: QuestShieldScopeV1;
}
export type QuestObjectiveV1 = QuestKillWithSourceObjectiveV1 | QuestPreserveShieldObjectiveV1;
export interface QuestDefinitionV1 {
    readonly label: string;
    readonly weight: number;
    readonly objective: QuestObjectiveV1;
}
export interface QuestProfileV1 {
    readonly selectionCount: number;
    readonly definitions: Readonly<Record<string, QuestDefinitionV1>>;
}
export interface ActiveQuestMechanicsV1 extends QuestProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export interface QuestSelectionV1 {
    readonly questId: string;
    readonly definition: QuestDefinitionV1;
}
export declare class QuestProfileValidationError extends Error {
}
/** Parse a closed quest profile into detached, binary-ordered, deeply frozen own data. */
export declare function normalizeQuestProfileV1(value: unknown): QuestProfileV1;
/** Deterministic weighted sampling without replacement over a canonical eligible set. */
export declare function selectProceduralQuestsV1(profileInput: QuestProfileV1, options: {
    readonly seed: GameSeed;
    readonly eligibleDefinitionIds?: readonly string[];
}): readonly QuestSelectionV1[];
export declare function resolveActiveQuestMechanics(content: GameContentRegistry, missionId: string): ActiveQuestMechanicsV1 | undefined;
