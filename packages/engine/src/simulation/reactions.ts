import { REACTION_LIMITS } from "../content/mechanics.js";

export interface ExposureDefinitionV1 {
  readonly label: string;
  readonly duration: number;
  readonly maxStacks: number;
}

export interface ExposureApplicationDefinitionV1 {
  readonly exposureId: string;
  readonly stacks?: number;
}

export type ReactionRequirementV1 =
  | { readonly kind: "exposure"; readonly exposureId: string; readonly minStacks?: number; readonly consume?: "none" | "one" | "all" }
  | { readonly kind: "status"; readonly statusId: "poison" | "slow" | "stun"; readonly consume?: "none" | "clear" }
  | { readonly kind: "terrain_tag"; readonly tag: string };

export type ReactionDamageAmountV1 =
  | { readonly kind: "flat"; readonly value: number }
  | { readonly kind: "source_after_modifiers"; readonly multiplier: number };

export type ReactionDamageTargetV1 =
  | { readonly kind: "primary" }
  | { readonly kind: "radius"; readonly radius: number; readonly maxTargets: number }
  | { readonly kind: "terrain_tag"; readonly tag: string; readonly maxTargets: number };

export interface ReactionDamageEffectV1 {
  readonly kind: "damage";
  readonly amount: ReactionDamageAmountV1;
  readonly damageType: string;
  readonly target: ReactionDamageTargetV1;
  readonly allowReactions?: boolean;
}

export interface ReactionDefinitionV1 {
  readonly label: string;
  readonly trigger: { readonly damageTypes: readonly string[] };
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
  readonly originCoord: { readonly q: number; readonly r: number };
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
    readonly originCoord: { readonly q: number; readonly r: number };
    readonly damageType: string;
    readonly afterModifiers: number;
    readonly resolvedFinalAmount: number;
    readonly depth: number;
    readonly sourceKind: "tower" | "ability" | "tower_script" | "status" | "enemy" | "leak" | "reaction" | "weather";
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
    readonly coord: { readonly q: number; readonly r: number };
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
  readonly consumptions: readonly (
    | { readonly kind: "exposure"; readonly reactionId: string; readonly enemyId: string; readonly exposureId: string; readonly stacks: "one" | "all" }
    | { readonly kind: "status"; readonly reactionId: string; readonly enemyId: string; readonly statusId: "poison" | "slow" | "stun" }
  )[];
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

function binary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function emptyPlan(): ReactionPlannerOutput {
  return deepFreeze({
    consumptions: [], exposureApplications: [], triggers: [], secondaryPlans: [], diagnostics: []
  });
}

/**
 * Pure deterministic reaction planner. It observes a captured pre-HP state and returns only
 * mutations/events/secondary packets; the game owns all state mutation and damage settlement.
 */
export function planReactions(input: ReactionPlannerInput): ReactionPlannerOutput {
  const { primary } = input;
  const eligibleSource = primary.sourceKind === "tower"
    || primary.sourceKind === "ability"
    || primary.sourceKind === "tower_script"
    || (primary.sourceKind === "reaction" && primary.allowReactions);
  if (!eligibleSource || primary.tags.includes("over_time") || !(primary.resolvedFinalAmount > 0)) {
    return emptyPlan();
  }

  const profile = input.profile as unknown as ActiveReactionsMechanics;
  const definitions = profile.exposures?.definitions ?? {};
  const applicationBindings = profile.exposures?.applications?.damageTypes ?? {};
  const reactions = profile.reactions ?? {};
  const consumptions: Array<ReactionPlannerOutput["consumptions"][number]> = [];
  const triggers: Array<ReactionPlannerOutput["triggers"][number]> = [];
  const secondaryPlans: Array<ReactionPlannerOutput["secondaryPlans"][number]> = [];
  const diagnostics: Array<ReactionPlannerOutput["diagnostics"][number]> = [];
  const reservedExposure = new Map<string, number>();
  const reservedStatus = new Set<string>();
  let suppressApplications = false;
  let remainingPackets = Math.max(0, input.budget.secondaryPacketsRemaining);
  let depthDropped = 0;
  let packetDropped = 0;

  for (const reactionId of Object.keys(reactions).sort(binary)) {
    const reaction = reactions[reactionId]!;
    if (!reaction.trigger.damageTypes.includes(primary.damageType)) continue;
    const requirements = reaction.requirements ?? [];
    let matches = true;
    for (const requirement of requirements) {
      if (requirement.kind === "exposure") {
        const available = Math.max(0, (primary.exposures[requirement.exposureId]?.stacks ?? 0)
          - (reservedExposure.get(requirement.exposureId) ?? 0));
        if (available < (requirement.minStacks ?? 1)) matches = false;
      } else if (requirement.kind === "status") {
        if (!(requirement.statusId in primary.statuses) || reservedStatus.has(requirement.statusId)) matches = false;
      } else if (!primary.terrainTags.includes(requirement.tag)) {
        matches = false;
      }
      if (!matches) break;
    }
    if (!matches) continue;

    for (const requirement of requirements) {
      if (requirement.kind === "exposure" && requirement.consume && requirement.consume !== "none") {
        const current = primary.exposures[requirement.exposureId]?.stacks ?? 0;
        const amount = requirement.consume === "all" ? current : 1;
        reservedExposure.set(requirement.exposureId, (reservedExposure.get(requirement.exposureId) ?? 0) + amount);
        consumptions.push({
          kind: "exposure", reactionId, enemyId: primary.rootEnemyId,
          exposureId: requirement.exposureId, stacks: requirement.consume
        });
      } else if (requirement.kind === "status" && requirement.consume === "clear") {
        reservedStatus.add(requirement.statusId);
        consumptions.push({
          kind: "status", reactionId, enemyId: primary.rootEnemyId, statusId: requirement.statusId
        });
      }
    }

    suppressApplications ||= reaction.suppressTriggerExposureApplications === true;
    const reactionPlans: Array<ReactionPlannerOutput["secondaryPlans"][number]> = [];
    for (const effectId of Object.keys(reaction.effects).sort(binary)) {
      const effect = reaction.effects[effectId]!;
      let targets: string[];
      if (effect.target.kind === "primary") {
        targets = primary.aliveAfterPrimary ? [primary.rootEnemyId] : [];
      } else if (effect.target.kind === "radius") {
        const target = effect.target;
        targets = input.candidates
          .filter((candidate) => candidate.alive && candidate.enemyId !== primary.rootEnemyId)
          .filter((candidate) => candidate.topologyDistance <= target.radius)
          .sort((left, right) => left.topologyDistance - right.topologyDistance || binary(left.enemyId, right.enemyId))
          .slice(0, target.maxTargets)
          .map((candidate) => candidate.enemyId);
      } else {
        const target = effect.target;
        targets = input.candidates
          .filter((candidate) => candidate.alive && candidate.enemyId !== primary.rootEnemyId)
          .filter((candidate) => candidate.terrainTags.includes(target.tag))
          .sort((left, right) => left.topologyDistance - right.topologyDistance || binary(left.enemyId, right.enemyId))
          .slice(0, target.maxTargets)
          .map((candidate) => candidate.enemyId);
      }
      const amount = effect.amount.kind === "flat"
        ? effect.amount.value
        : primary.afterModifiers * effect.amount.multiplier;
      for (const targetEnemyId of targets) {
        reactionPlans.push({
          reactionId, effectId, targetEnemyId, amount, damageType: effect.damageType,
          depth: primary.depth + 1,
          tags: effect.target.kind === "primary" ? ["reaction"] : ["reaction", "area"],
          allowReactions: effect.allowReactions === true
        });
      }
    }
    let admitted: Array<ReactionPlannerOutput["secondaryPlans"][number]>;
    if (reactionPlans.length > 0 && primary.depth >= REACTION_LIMITS.maxDepth) {
      admitted = [];
      depthDropped += reactionPlans.length;
    } else {
      admitted = reactionPlans.slice(0, remainingPackets);
      packetDropped += reactionPlans.length - admitted.length;
      remainingPackets -= admitted.length;
    }
    triggers.push({
      reactionId,
      originEnemyId: primary.rootEnemyId,
      originEnemyTypeId: primary.rootEnemyTypeId,
      originCoord: { ...primary.originCoord },
      triggerDamageType: primary.damageType,
      depth: primary.depth,
      scheduledTargetIds: [...new Set(admitted.map((plan) => plan.targetEnemyId))]
    });
    secondaryPlans.push(...admitted);
  }

  if (depthDropped > 0) diagnostics.push({
    rootEnemyId: primary.rootEnemyId, rootEnemyTypeId: primary.rootEnemyTypeId,
    budget: "depth", limit: REACTION_LIMITS.maxDepth, dropped: depthDropped
  });
  if (packetDropped > 0) diagnostics.push({
    rootEnemyId: primary.rootEnemyId, rootEnemyTypeId: primary.rootEnemyTypeId,
    budget: "secondary_packets", limit: REACTION_LIMITS.secondaryPacketsPerRoot, dropped: packetDropped
  });

  const exposureApplications: Array<ReactionPlannerOutput["exposureApplications"][number]> = [];
  if (primary.aliveAfterPrimary && !suppressApplications) {
    let available = Math.max(0, input.budget.liveExposuresRemaining);
    let dropped = 0;
    for (const application of applicationBindings[primary.damageType] ?? []) {
      const definition = definitions[application.exposureId];
      if (!definition) continue;
      const createsLiveExposure = primary.exposures[application.exposureId] === undefined;
      if (createsLiveExposure && available <= 0) {
        dropped += 1;
        continue;
      }
      exposureApplications.push({
        enemyId: primary.rootEnemyId,
        exposureId: application.exposureId,
        stacks: application.stacks ?? 1,
        duration: definition.duration,
        maxStacks: definition.maxStacks,
        cause: "damage"
      });
      if (createsLiveExposure) available -= 1;
    }
    if (dropped > 0) {
      diagnostics.push({
        rootEnemyId: primary.rootEnemyId,
        rootEnemyTypeId: primary.rootEnemyTypeId,
        budget: "live_exposures",
        limit: REACTION_LIMITS.runtimeExposureApplications,
        dropped
      });
    }
  }

  return deepFreeze({ consumptions, exposureApplications, triggers, secondaryPlans, diagnostics });
}
