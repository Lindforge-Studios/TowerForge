import {
  ROGUELITE_DAMAGE_MODIFIER_RESERVE,
  resolveActiveRogueliteMechanics,
  rogueliteSynergyWorstCaseModifierCount
} from "../content/roguelite-mechanics.js";
import type { GameContentRegistry } from "../content/registry.js";
import {
  activeHeroAuraModifierReserve,
  heroPassiveAuraModifierIdV6,
  resolveActiveHeroesMechanics,
  type HeroesProfileV6
} from "../content/heroes-mechanics.js";
import { resolveActiveHighGroundMechanics } from "../content/elevation-mechanics.js";
import type { SynergyModifierV1 } from "../content/roguelite-mechanics.js";

export interface CampaignBattleDeckEntry {
  readonly cardId: string;
}

/**
 * Upper bound for one tower's run-stage modifier fan-in during a campaign battle.
 * The same policy guards preparation, direct construction, and checkpoint restore.
 */
export function campaignBattleRogueliteWorstCaseModifierCount(
  deck: readonly CampaignBattleDeckEntry[],
  content: GameContentRegistry,
  missionId: string
): number {
  const active = resolveActiveRogueliteMechanics(content, missionId);
  if (!active) return 0;
  const mission = content.missions[missionId];
  if (!mission) return 0;
  let maximum = 0;
  for (const towerTypeId of mission.buildTowerIds) {
    const tags = new Set(active.towerTagsByTypeId[towerTypeId] ?? []);
    let count = rogueliteSynergyWorstCaseModifierCount(active.synergies);
    const matchingDraftEffects = (cardId: string): number => {
      if (!active.draft || !Object.prototype.hasOwnProperty.call(active.draft.definitions, cardId)) return 0;
      const definition = active.draft.definitions[cardId];
      if (!definition) return 0;
      return definition.effects.filter((effect) => (
        effect.scope.kind === "all_towers"
        || (effect.scope.kind === "tower_type" && effect.scope.towerTypeId === towerTypeId)
        || (effect.scope.kind === "tower_tag" && tags.has(effect.scope.tag))
      )).length;
    };
    for (const entry of deck) count += matchingDraftEffects(entry.cardId);
    const localWorstPerChoice = Object.keys(active.draft?.definitions ?? {}).reduce(
      (worst, cardId) => Math.max(worst, matchingDraftEffects(cardId)),
      0
    );
    count += Math.max(0, mission.waves.length - 1) * localWorstPerChoice;
    for (const slot of active.artifacts?.towerSlots[towerTypeId] ?? []) {
      count += Object.values(active.artifacts?.definitions ?? {}).reduce((worst, definition) => (
        definition.slotType === slot.slotType ? Math.max(worst, definition.modifiers.length) : worst
      ), 0);
    }
    count += ROGUELITE_DAMAGE_MODIFIER_RESERVE.total;
    maximum = Math.max(maximum, count);
  }
  return maximum;
}

/** Shared run + reserved stages + selected passive-aura upper bound. */
export function campaignBattleWorstCaseModifierCount(
  deck: readonly CampaignBattleDeckEntry[],
  content: GameContentRegistry,
  missionId: string
): number {
  return campaignBattleRogueliteWorstCaseModifierCount(deck, content, missionId)
    + activeHeroAuraModifierReserve(content, missionId);
}

export interface HeroAuraDamageFinitePreflightOptions {
  readonly deck?: readonly CampaignBattleDeckEntry[];
  /** Structurally normalized profile used to diagnose inactive/unselected authoring as a warning. */
  readonly heroesProfile?: HeroesProfileV6;
}

export type HeroAuraDamageFinitePreflightResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly towerTypeId: string;
      readonly fieldPath: string;
      readonly message: string;
    };

interface DamageStageBound {
  flat: number;
  additiveRatio: number;
  multiplier: number;
  maximumMultiplierPrefix: number;
}

function emptyStageBound(): DamageStageBound {
  return { flat: 0, additiveRatio: 0, multiplier: 1, maximumMultiplierPrefix: 1 };
}

function addExactModifier(bound: DamageStageBound, modifier: SynergyModifierV1): void {
  if (modifier.operation === "flat") bound.flat += Math.abs(modifier.value);
  else if (modifier.operation === "additive_ratio") bound.additiveRatio += Math.abs(modifier.value);
  else {
    bound.multiplier *= Math.abs(modifier.value);
    bound.maximumMultiplierPrefix = Math.max(bound.maximumMultiplierPrefix, bound.multiplier);
  }
}

interface OrderedDamageBoundModifier {
  readonly id: string;
  readonly modifier: SynergyModifierV1;
}

function operationOrder(operation: SynergyModifierV1["operation"]): number {
  return operation === "flat" ? 0 : operation === "additive_ratio" ? 1 : 2;
}

function exactModifierBound(modifiers: readonly OrderedDamageBoundModifier[]): DamageStageBound {
  const bound = emptyStageBound();
  const ordered = [...modifiers].sort((left, right) => (
    operationOrder(left.modifier.operation) - operationOrder(right.modifier.operation)
    || binaryCompare(left.id, right.id)
  ));
  for (const entry of ordered) addExactModifier(bound, entry.modifier);
  return bound;
}

function addStageBound(target: DamageStageBound, source: DamageStageBound): void {
  target.flat += source.flat;
  target.additiveRatio += source.additiveRatio;
  // Separate Roguelite sources can interleave after runtime binary-ID sorting (artifact, draft,
  // synergy). Their final products may contain a later zero, so compose their non-reducing prefix
  // envelopes independently of the authoring traversal order.
  target.maximumMultiplierPrefix *= source.maximumMultiplierPrefix;
  target.multiplier *= source.multiplier;
}

function mergeOptionalChoice(target: DamageStageBound, choices: readonly DamageStageBound[]): void {
  addStageBound(target, {
    flat: choices.reduce((maximum, choice) => Math.max(maximum, choice.flat), 0),
    additiveRatio: choices.reduce((maximum, choice) => Math.max(maximum, choice.additiveRatio), 0),
    multiplier: choices.reduce((maximum, choice) => Math.max(maximum, choice.multiplier), 1),
    maximumMultiplierPrefix: choices.reduce(
      (maximum, choice) => Math.max(maximum, choice.maximumMultiplierPrefix),
      1
    )
  });
}

function applyStageBound(value: number, bound: DamageStageBound): number {
  let next = Math.abs(value) + bound.flat;
  if (!Number.isFinite(next)) return Number.POSITIVE_INFINITY;
  const additive = next * bound.additiveRatio;
  if (!Number.isFinite(additive)) return Number.POSITIVE_INFINITY;
  next += additive;
  if (!Number.isFinite(next)) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(next * bound.maximumMultiplierPrefix)) return Number.POSITIVE_INFINITY;
  next *= bound.multiplier;
  return next;
}

function binaryCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function indexedModifierBounds(
  prefix: string,
  modifiers: readonly SynergyModifierV1[]
): readonly OrderedDamageBoundModifier[] {
  return modifiers.map((modifier, index) => ({
    id: `${prefix}:modifier:${String(index).padStart(2, "0")}`,
    modifier
  }));
}

interface ImmediateTowerDamageCandidate {
  readonly amount: number;
  readonly aoe: boolean;
}

function towerImmediateDamageAmounts(
  content: GameContentRegistry,
  towerTypeId: string
): readonly ImmediateTowerDamageCandidate[] {
  const tower = content.towers[towerTypeId];
  if (!tower) return [];
  const attack = tower.attack;
  switch (attack.kind) {
    case "single":
      return [{ amount: attack.damagePerStack * attack.maxStacks * (attack.chain
        ? Math.max(1, Math.pow(Math.abs(attack.chain.damageFalloff), attack.chain.maxJumps))
        : 1), aoe: false }];
    case "pulse":
      return [{ amount: attack.pulseDamage, aoe: true }];
    case "sniper":
    case "antiair":
      return [{ amount: attack.damage, aoe: false }];
    case "splash":
      return [
        { amount: attack.damage, aoe: false },
        { amount: attack.splashDamage, aoe: false }
      ];
    case "pipeline": {
      const aoe = attack.delivery.kind === "area" || attack.delivery.kind === "aura";
      const deliveryMultiplier = attack.delivery.kind === "area"
        ? Math.max(1, Math.abs(attack.delivery.secondaryMultiplier ?? 1))
        : attack.delivery.kind === "chain"
          ? Math.max(1, Math.pow(Math.abs(attack.delivery.damageFalloff ?? 1), attack.delivery.maxJumps))
          : 1;
      return attack.effects.flatMap((effect) => effect.kind === "damage"
        ? [effect.amount, ...(effect.amountByLevel ?? [])]
          .map((amount) => ({ amount: amount * deliveryMultiplier, aoe }))
        : []);
    }
    case "support":
    case "support_buff":
      return [];
  }
}

function maximumMetaTowerDamageMultiplier(content: GameContentRegistry): number {
  let bound = 1;
  for (const upgrade of Object.values(content.metaProgression?.upgrades ?? {})) {
    for (const effect of upgrade.effects) {
      if (effect.kind === "towerDamage") {
        bound += Math.abs(effect.multiplierPerLevel) * upgrade.maxLevel;
      }
    }
  }
  return bound;
}

function rogueliteRunDamageBound(
  content: GameContentRegistry,
  missionId: string,
  towerTypeId: string,
  deck: readonly CampaignBattleDeckEntry[]
): DamageStageBound {
  const active = resolveActiveRogueliteMechanics(content, missionId);
  if (!active) return emptyStageBound();
  const result = emptyStageBound();
  const synergies = Object.entries(active.synergies).sort(([left], [right]) => binaryCompare(
    `${left.length}:${left}`,
    `${right.length}:${right}`
  ));
  for (const [synergyId, synergy] of synergies) {
    const tierModifiers = (tier: (typeof synergy.tiers)[number]): readonly OrderedDamageBoundModifier[] => (
      indexedModifierBounds(
        `roguelite:synergy:${synergyId.length}:${synergyId}:tier:${tier.requiredCount}`,
        tier.modifiers
      )
    );
    const tierBounds = synergy.tiers.map((tier) => exactModifierBound(tierModifiers(tier)));
    if ((synergy.tierMode ?? "highest") === "cumulative") {
      addStageBound(result, exactModifierBound(synergy.tiers.flatMap(tierModifiers)));
    } else {
      mergeOptionalChoice(result, tierBounds);
    }
  }
  for (const [slotIndex, slot] of (active.artifacts?.towerSlots[towerTypeId] ?? []).entries()) {
    mergeOptionalChoice(result, Object.entries(active.artifacts?.definitions ?? {})
      .filter(([, definition]) => definition.slotType === slot.slotType)
      .map(([artifactId, definition]) => exactModifierBound(indexedModifierBounds(
        `roguelite:artifact-choice:${slotIndex}:${artifactId.length}:${artifactId}`,
        definition.modifiers
      ))));
  }
  const tags = new Set(active.towerTagsByTypeId[towerTypeId] ?? []);
  const cardModifiers = (
    cardId: string,
    identity: string
  ): readonly OrderedDamageBoundModifier[] | undefined => {
    const definition = active.draft?.definitions[cardId];
    if (!definition) return undefined;
    return indexedModifierBounds(identity, definition.effects.filter((effect) => (
      effect.scope.kind === "all_towers"
      || (effect.scope.kind === "tower_type" && effect.scope.towerTypeId === towerTypeId)
      || (effect.scope.kind === "tower_tag" && tags.has(effect.scope.tag))
    )).map((effect) => effect.modifier));
  };
  const carriedModifiers = deck.flatMap((entry, index) => cardModifiers(
    entry.cardId,
    `roguelite:draft:${index + 1}:campaign:${entry.cardId.length}:${entry.cardId}`
  ) ?? []);
  addStageBound(result, exactModifierBound(carriedModifiers));
  const localChoices = Object.keys(active.draft?.definitions ?? {})
    .map((cardId) => cardModifiers(
      cardId,
      `roguelite:draft:local:${cardId.length}:${cardId}`
    ))
    .filter((modifiers): modifiers is readonly OrderedDamageBoundModifier[] => modifiers !== undefined)
    .map(exactModifierBound);
  const maximumLocalSelections = Math.max(0, (content.missions[missionId]?.waves.length ?? 0) - 1);
  for (let index = 0; index < maximumLocalSelections; index += 1) {
    mergeOptionalChoice(result, localChoices);
  }
  return result;
}

/**
 * Conservative finite upper bound for every authored immediate tower packet that can receive the
 * selected v6 aura. No-aura projects return immediately and retain legacy runtime/preflight timing.
 */
export function preflightHeroAuraDamageFinite(
  content: GameContentRegistry,
  missionId: string,
  options: HeroAuraDamageFinitePreflightOptions = {}
): HeroAuraDamageFinitePreflightResult {
  const active = resolveActiveHeroesMechanics(content, missionId);
  const profile = options.heroesProfile ?? (active?.schemaVersion === 6 ? active : undefined);
  if (!profile) return Object.freeze({ ok: true });
  const definition = profile.definitions[profile.selectedHeroId];
  const aura = definition?.passiveAura;
  if (!aura) return Object.freeze({ ok: true });
  const highGround = resolveActiveHighGroundMechanics(content, missionId);
  const metaBound = exactModifierBound([{
    id: "legacy-meta-tower-damage",
    modifier: {
      target: "damage",
      operation: "multiplier",
      value: maximumMetaTowerDamageMultiplier(content)
    }
  }]);
  const failure = (towerTypeId: string): HeroAuraDamageFinitePreflightResult => Object.freeze({
    ok: false as const,
    towerTypeId,
    fieldPath: `towers.${towerTypeId}.attack.damage`,
    message: `Hero passive aura can overflow finite tower damage for tower "${towerTypeId}".`
  });
  for (const towerTypeId of content.missions[missionId]?.buildTowerIds ?? []) {
    const runBound = rogueliteRunDamageBound(content, missionId, towerTypeId, options.deck ?? []);
    for (const candidate of towerImmediateDamageAmounts(content, towerTypeId)) {
      let value = applyStageBound(candidate.amount, metaBound);
      if (!Number.isFinite(value)) return failure(towerTypeId);
      value = applyStageBound(value, runBound);
      if (!Number.isFinite(value)) return failure(towerTypeId);
      const spatialModifiers: OrderedDamageBoundModifier[] = [];
      if (highGround) {
        spatialModifiers.push({
          id: "elevation:high-ground:damage",
          modifier: {
            target: "damage",
            operation: "additive_ratio",
            value: Math.abs(
              highGround.maximumEffectiveElevationDelta
                * highGround.damageBonusBasisPointsPerElevation / 10_000
            )
          }
        });
      }
      aura.effects.forEach((effect, effectIndex) => spatialModifiers.push({
        id: heroPassiveAuraModifierIdV6(profile.selectedHeroId, aura.id, effectIndex),
        modifier: effect.modifier
      }));
      if (candidate.aoe) {
        spatialModifiers.push({
          id: "legacy-spatial-sunlight-aoe",
          modifier: {
            target: "damage",
            operation: "multiplier",
            value: Math.max(
              1,
              Math.abs(content.missions[missionId]?.sunlight?.aoeDamageMultiplier ?? 1)
            )
          }
        });
      }
      value = applyStageBound(value, exactModifierBound(spatialModifiers));
      if (!Number.isFinite(value)) return failure(towerTypeId);
    }
  }
  return Object.freeze({ ok: true });
}
