export interface ExposureDefinitionV1 {
    readonly label: string;
    readonly duration: number;
    readonly maxStacks: number;
}
export interface ExposureApplicationDefinitionV1 {
    readonly exposureId: string;
    readonly stacks?: number;
}
export type ReactionRequirementV1 = {
    readonly kind: "exposure";
    readonly exposureId: string;
    readonly minStacks?: number;
    readonly consume?: "none" | "one" | "all";
} | {
    readonly kind: "status";
    readonly statusId: "poison" | "slow" | "stun";
    readonly consume?: "none" | "clear";
} | {
    readonly kind: "terrain_tag";
    readonly tag: string;
};
export type ReactionDamageAmountV1 = {
    readonly kind: "flat";
    readonly value: number;
} | {
    readonly kind: "source_after_modifiers";
    readonly multiplier: number;
};
export type ReactionDamageTargetV1 = {
    readonly kind: "primary";
} | {
    readonly kind: "radius";
    readonly radius: number;
    readonly maxTargets: number;
} | {
    readonly kind: "terrain_tag";
    readonly tag: string;
    readonly maxTargets: number;
};
export interface ReactionDamageEffectV1 {
    readonly kind: "damage";
    readonly amount: ReactionDamageAmountV1;
    readonly damageType: string;
    readonly target: ReactionDamageTargetV1;
    readonly allowReactions?: boolean;
}
export interface ReactionDefinitionV1 {
    readonly label: string;
    readonly trigger: {
        readonly damageTypes: readonly string[];
    };
    readonly requirements?: readonly ReactionRequirementV1[];
    readonly suppressTriggerExposureApplications?: boolean;
    readonly effects: Readonly<Record<string, ReactionDamageEffectV1>>;
}
export interface ActiveReactionsMechanics {
    readonly schemaVersion: 1;
    readonly exposures: {
        readonly definitions: Readonly<Record<string, ExposureDefinitionV1>>;
        readonly applications: {
            readonly damageTypes: Readonly<Record<string, readonly ExposureApplicationDefinitionV1[]>>;
        };
    };
    readonly reactions: Readonly<Record<string, ReactionDefinitionV1>>;
}
export interface ExposureRuntimeStateV1 {
    readonly stacks: number;
    readonly remaining: number;
}
export interface ReactionStateV1 {
    readonly schemaVersion: 1;
    readonly exposures: {
        readonly enemies: Readonly<Record<string, Readonly<Record<string, ExposureRuntimeStateV1>>>>;
    };
}
export type EnemyExposureChangeCause = "damage" | "consume" | "expiration" | "script";
export interface EnemyExposureChangedEvent {
    readonly type: "enemyExposureChanged";
    readonly enemyId: string;
    readonly enemyTypeId: string;
    readonly exposureId: string;
    readonly previousStacks: number;
    readonly currentStacks: number;
    readonly previousRemaining: number;
    readonly remaining: number;
    readonly cause: EnemyExposureChangeCause;
}
export interface EnemyReactionTriggeredEvent {
    readonly type: "enemyReactionTriggered";
    readonly reactionId: string;
    readonly originEnemyId: string;
    readonly originEnemyTypeId: string;
    readonly originCoord: {
        readonly q: number;
        readonly r: number;
    };
    readonly triggerDamageType: string;
    readonly depth: number;
    readonly scheduledTargetIds: readonly string[];
}
export interface ReactionBudgetExceededEvent {
    readonly type: "reactionBudgetExceeded";
    readonly rootEnemyId: string;
    readonly rootEnemyTypeId: string;
    readonly budget: "depth" | "secondary_packets" | "live_exposures";
    readonly limit: number;
    readonly dropped: number;
}
export interface ReactionPlannerInput {
    readonly profile: Readonly<Record<string, unknown>> | ActiveReactionsMechanics;
    readonly primary: {
        readonly rootEnemyId: string;
        readonly rootEnemyTypeId: string;
        readonly originCoord: {
            readonly q: number;
            readonly r: number;
        };
        readonly damageType: string;
        readonly afterModifiers: number;
        readonly resolvedFinalAmount: number;
        readonly depth: number;
        readonly sourceKind: "tower" | "ability" | "tower_script" | "status" | "enemy" | "leak" | "reaction";
        readonly tags: readonly string[];
        readonly allowReactions: boolean;
        readonly aliveAfterPrimary: boolean;
        readonly exposures: Readonly<Record<string, ExposureRuntimeStateV1>>;
        readonly statuses: Readonly<Record<string, unknown>>;
        readonly terrainTags: readonly string[];
    };
    readonly candidates: readonly {
        readonly enemyId: string;
        readonly enemyTypeId: string;
        readonly coord: {
            readonly q: number;
            readonly r: number;
        };
        readonly topologyDistance: number;
        readonly alive: boolean;
        readonly terrainTags: readonly string[];
    }[];
    readonly budget: {
        readonly secondaryPacketsRemaining: number;
        readonly liveExposuresRemaining: number;
    };
}
export interface ReactionPlannerOutput {
    readonly consumptions: readonly ({
        readonly kind: "exposure";
        readonly reactionId: string;
        readonly enemyId: string;
        readonly exposureId: string;
        readonly stacks: "one" | "all";
    } | {
        readonly kind: "status";
        readonly reactionId: string;
        readonly enemyId: string;
        readonly statusId: "poison" | "slow" | "stun";
    })[];
    readonly exposureApplications: readonly {
        readonly enemyId: string;
        readonly exposureId: string;
        readonly stacks: number;
        readonly duration: number;
        readonly maxStacks: number;
        readonly cause: "damage";
    }[];
    readonly triggers: readonly Omit<EnemyReactionTriggeredEvent, "type">[];
    readonly secondaryPlans: readonly {
        readonly reactionId: string;
        readonly effectId: string;
        readonly targetEnemyId: string;
        readonly amount: number;
        readonly damageType: string;
        readonly depth: number;
        readonly tags: readonly ("reaction" | "area")[];
        readonly allowReactions: boolean;
    }[];
    readonly diagnostics: readonly Omit<ReactionBudgetExceededEvent, "type">[];
}
/**
 * Pure deterministic reaction planner. It observes a captured pre-HP state and returns only
 * mutations/events/secondary packets; the game owns all state mutation and damage settlement.
 */
export declare function planReactions(input: ReactionPlannerInput): ReactionPlannerOutput;
