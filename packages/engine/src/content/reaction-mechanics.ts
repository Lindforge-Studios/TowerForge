import type { GameContentRegistry } from "./registry.js";
import { REACTION_LIMITS, resolveCapabilitySet } from "./mechanics.js";
import { resolveActiveCombatMechanics } from "./combat-mechanics.js";
import type {
  ActiveReactionsMechanics,
  ExposureApplicationDefinitionV1,
  ExposureDefinitionV1,
  ReactionDamageEffectV1,
  ReactionDefinitionV1,
  ReactionRequirementV1
} from "../simulation/reactions.js";

function empty<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = value !== null && typeof value === "object"
      ? Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>
      : {};
  } catch {
    throw new Error(`${label} could not be inspected safely.`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
    throw new Error(`${label} must be a plain object with own data fields.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) throw new Error(`${label} contains unsupported symbol fields.`);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new Error(`${label}.${key} must be an enumerable own data field.`);
    }
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label} contains an unsupported field.`);
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty id.`);
  return value;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function boundedId(value: unknown, label: string): string {
  const result = id(value, label);
  if (utf8ByteLength(result) > REACTION_LIMITS.idTagUtf8Bytes) {
    throw new Error(`${label} exceeds the ${REACTION_LIMITS.idTagUtf8Bytes} byte limit.`);
  }
  return result;
}

function boundedLabel(value: unknown, label: string): string {
  const result = id(value, label);
  if (result.length > REACTION_LIMITS.labelLength) {
    throw new Error(`${label} exceeds the ${REACTION_LIMITS.labelLength} character limit.`);
  }
  return result;
}

function bounded(value: unknown, maximum: number, label: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > maximum || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`${label} is outside the supported range.`);
  }
  return value;
}

function ownArray(value: unknown, label: string, maximum: number): readonly unknown[] {
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Array.isArray(value) ? Object.getPrototypeOf(value) : null;
    descriptors = Array.isArray(value)
      ? Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>
      : {};
  } catch {
    throw new Error(`${label} could not be inspected as an authored array.`);
  }
  if (!Array.isArray(value) || prototype !== Array.prototype || value.length > maximum) {
    throw new Error(`${label} must be a bounded array.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new Error(`${label} contains unsupported symbol fields.`);
  }
  const expectedKeys = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
  const actualKeys = Object.keys(descriptors);
  if (actualKeys.length !== expectedKeys.size || actualKeys.some((key) => !expectedKeys.has(key))) {
    throw new Error(`${label} contains a sparse index or unsupported non-index field.`);
  }
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new Error(`${label}[${index}] must be an enumerable own data field.`);
    }
    result.push(descriptor.value);
  }
  return result;
}

export function normalizeReactionsProfileV1(
  value: unknown,
  damageTypeIds: ReadonlySet<string>
): ActiveReactionsMechanics {
  const profile = record(value, "Active reactions profile");
  keys(profile, ["exposures", "reactions"], "Active reactions profile");
  const exposuresValue = profile.exposures === undefined ? {} : record(profile.exposures, "Active reactions exposures");
  keys(exposuresValue, ["definitions", "applications"], "Active reactions exposures");
  const rawDefinitions = exposuresValue.definitions === undefined
    ? {}
    : record(exposuresValue.definitions, "Active exposure definitions");
  if (Object.keys(rawDefinitions).length > REACTION_LIMITS.exposureDefinitions) throw new Error("Active exposure definition budget exceeded.");
  const definitions = empty<ExposureDefinitionV1>();
  for (const exposureId of Object.keys(rawDefinitions).sort()) {
    boundedId(exposureId, "Exposure id");
    const definition = record(rawDefinitions[exposureId], `Exposure ${exposureId}`);
    keys(definition, ["label", "duration", "maxStacks"], `Exposure ${exposureId}`);
    const label = id(definition.label, `Exposure ${exposureId} label`);
    if (label.length > REACTION_LIMITS.labelLength) throw new Error(`Exposure ${exposureId} label is too long.`);
    Object.defineProperty(definitions, exposureId, {
      value: Object.freeze({
        label,
        duration: bounded(definition.duration, REACTION_LIMITS.duration, `Exposure ${exposureId} duration`),
        maxStacks: bounded(definition.maxStacks, REACTION_LIMITS.maxStacks, `Exposure ${exposureId} maxStacks`, true)
      }), enumerable: true
    });
  }
  const applicationsValue = exposuresValue.applications === undefined
    ? {}
    : record(exposuresValue.applications, "Active exposure applications");
  keys(applicationsValue, ["damageTypes"], "Active exposure applications");
  const rawDamageTypes = applicationsValue.damageTypes === undefined
    ? {}
    : record(applicationsValue.damageTypes, "Active exposure damage type applications");
  if (Object.keys(rawDamageTypes).length > REACTION_LIMITS.damageTypeApplicationBindings) {
    throw new Error(
      `Exposure damage type application bindings exceed the ${REACTION_LIMITS.damageTypeApplicationBindings} binding budget.`
    );
  }
  const applications = empty<readonly ExposureApplicationDefinitionV1[]>();
  let applicationCount = 0;
  for (const damageTypeId of Object.keys(rawDamageTypes).sort()) {
    if (!damageTypeIds.has(damageTypeId)) throw new Error(`Exposure application references unknown damage type "${damageTypeId}".`);
    const entries = ownArray(rawDamageTypes[damageTypeId], `Exposure applications ${damageTypeId}`, REACTION_LIMITS.applicationsPerDamageType);
    applicationCount += entries.length;
    const seen = new Set<string>();
    Object.defineProperty(applications, damageTypeId, {
      value: Object.freeze(entries.map((entry, index) => {
        const application = record(entry, `Exposure application ${damageTypeId}[${index}]`);
        keys(application, ["exposureId", "stacks"], `Exposure application ${damageTypeId}[${index}]`);
        const exposureId = id(application.exposureId, "Exposure application exposureId");
        if (!Object.prototype.hasOwnProperty.call(definitions, exposureId)) throw new Error(`Exposure application references unknown exposure "${exposureId}".`);
        if (seen.has(exposureId)) throw new Error(`Exposure application duplicates exposure "${exposureId}".`);
        seen.add(exposureId);
        const stacks = application.stacks === undefined ? undefined : bounded(application.stacks, definitions[exposureId]!.maxStacks, "Exposure application stacks", true);
        return Object.freeze({ exposureId, ...(stacks === undefined ? {} : { stacks }) });
      })), enumerable: true
    });
  }
  if (applicationCount > REACTION_LIMITS.totalExposureApplications) throw new Error("Exposure application budget exceeded.");

  if (!Object.prototype.hasOwnProperty.call(profile, "reactions")) {
    throw new Error("Active reactions profile requires a reactions record.");
  }
  const rawReactions = record(profile.reactions, "Active reaction definitions");
  if (Object.keys(rawReactions).length > REACTION_LIMITS.reactionDefinitions) throw new Error("Active reaction definition budget exceeded.");
  const reactions = empty<ReactionDefinitionV1>();
  let effectCount = 0;
  for (const reactionId of Object.keys(rawReactions).sort()) {
    boundedId(reactionId, "Reaction id");
    const raw = record(rawReactions[reactionId], `Reaction ${reactionId}`);
    keys(raw, ["label", "trigger", "requirements", "suppressTriggerExposureApplications", "effects"], `Reaction ${reactionId}`);
    if (raw.suppressTriggerExposureApplications !== undefined && typeof raw.suppressTriggerExposureApplications !== "boolean") {
      throw new Error(`Reaction ${reactionId} suppressTriggerExposureApplications must be boolean.`);
    }
    const trigger = record(raw.trigger, `Reaction ${reactionId} trigger`);
    keys(trigger, ["damageTypes"], `Reaction ${reactionId} trigger`);
    const triggerTypes = ownArray(trigger.damageTypes, `Reaction ${reactionId} trigger damageTypes`, 256).map((entry) => id(entry, "Reaction trigger damage type"));
    if (triggerTypes.length === 0 || new Set(triggerTypes).size !== triggerTypes.length) throw new Error(`Reaction ${reactionId} trigger damageTypes must be non-empty and unique.`);
    for (const damageTypeId of triggerTypes) if (!damageTypeIds.has(damageTypeId)) throw new Error(`Reaction ${reactionId} references unknown damage type "${damageTypeId}".`);
    const rawRequirements = raw.requirements === undefined ? [] : ownArray(raw.requirements, `Reaction ${reactionId} requirements`, REACTION_LIMITS.requirementsPerReaction);
    const requirementKeys = new Set<string>();
    const requirements: ReactionRequirementV1[] = rawRequirements.map((entry, index) => {
      const requirement = record(entry, `Reaction ${reactionId} requirement ${index}`);
      const kind = requirement.kind;
      let normalized: ReactionRequirementV1;
      let duplicateKey: string;
      if (kind === "exposure") {
        keys(requirement, ["kind", "exposureId", "minStacks", "consume"], `Reaction ${reactionId} exposure requirement`);
        const exposureId = id(requirement.exposureId, "Reaction exposureId");
        if (!Object.prototype.hasOwnProperty.call(definitions, exposureId)) throw new Error(`Reaction ${reactionId} references unknown exposure "${exposureId}".`);
        const minStacks = requirement.minStacks === undefined ? undefined : bounded(requirement.minStacks, definitions[exposureId]!.maxStacks, "Reaction minStacks", true);
        const consume = requirement.consume;
        if (consume !== undefined && consume !== "none" && consume !== "one" && consume !== "all") throw new Error("Reaction exposure consume is unsupported.");
        normalized = Object.freeze({ kind, exposureId, ...(minStacks === undefined ? {} : { minStacks }), ...(consume === undefined ? {} : { consume }) });
        duplicateKey = `${kind}:${exposureId}`;
      } else if (kind === "status") {
        keys(requirement, ["kind", "statusId", "consume"], `Reaction ${reactionId} status requirement`);
        if (requirement.statusId !== "poison" && requirement.statusId !== "slow" && requirement.statusId !== "stun") throw new Error("Reaction statusId is unsupported.");
        if (requirement.consume !== undefined && requirement.consume !== "none" && requirement.consume !== "clear") throw new Error("Reaction status consume is unsupported.");
        normalized = Object.freeze({ kind, statusId: requirement.statusId, ...(requirement.consume === undefined ? {} : { consume: requirement.consume }) });
        duplicateKey = `${kind}:${requirement.statusId}`;
      } else if (kind === "terrain_tag") {
        keys(requirement, ["kind", "tag"], `Reaction ${reactionId} terrain requirement`);
        const tag = boundedId(requirement.tag, "Reaction terrain tag");
        normalized = Object.freeze({ kind, tag });
        duplicateKey = `${kind}:${tag}`;
      } else {
        throw new Error(`Reaction ${reactionId} requirement kind is unsupported.`);
      }
      if (requirementKeys.has(duplicateKey)) throw new Error(`Reaction ${reactionId} requirements duplicate ${duplicateKey}.`);
      requirementKeys.add(duplicateKey);
      return normalized;
    });
    const rawEffects = record(raw.effects, `Reaction ${reactionId} effects`);
    if (Object.keys(rawEffects).length > REACTION_LIMITS.effectsPerReaction) throw new Error(`Reaction ${reactionId} effect budget exceeded.`);
    effectCount += Object.keys(rawEffects).length;
    const effects = empty<ReactionDamageEffectV1>();
    for (const effectId of Object.keys(rawEffects).sort()) {
      boundedId(effectId, `Reaction ${reactionId} effect id`);
      const effect = record(rawEffects[effectId], `Reaction ${reactionId} effect ${effectId}`);
      keys(effect, ["kind", "amount", "damageType", "target", "allowReactions"], `Reaction ${reactionId} effect ${effectId}`);
      if (effect.kind !== "damage") throw new Error("Reaction effect kind must be damage.");
      const damageType = id(effect.damageType, "Reaction effect damageType");
      if (!damageTypeIds.has(damageType)) throw new Error(`Reaction effect references unknown damage type "${damageType}".`);
      const amount = record(effect.amount, `Reaction ${reactionId} effect amount`);
      let normalizedAmount: ReactionDamageEffectV1["amount"];
      if (amount.kind === "flat") {
        keys(amount, ["kind", "value"], "Reaction flat amount");
        normalizedAmount = Object.freeze({ kind: "flat", value: bounded(amount.value, REACTION_LIMITS.flatDamage, "Reaction flat damage") });
      } else if (amount.kind === "source_after_modifiers") {
        keys(amount, ["kind", "multiplier"], "Reaction source amount");
        normalizedAmount = Object.freeze({ kind: "source_after_modifiers", multiplier: bounded(amount.multiplier, REACTION_LIMITS.sourceMultiplier, "Reaction source multiplier") });
      } else throw new Error("Reaction amount kind is unsupported.");
      const target = record(effect.target, `Reaction ${reactionId} effect target`);
      let normalizedTarget: ReactionDamageEffectV1["target"];
      if (target.kind === "primary") {
        keys(target, ["kind"], "Reaction primary target");
        normalizedTarget = Object.freeze({ kind: "primary" });
      } else if (target.kind === "radius") {
        keys(target, ["kind", "radius", "maxTargets"], "Reaction radius target");
        normalizedTarget = Object.freeze({ kind: "radius", radius: bounded(target.radius, REACTION_LIMITS.radius, "Reaction radius", true), maxTargets: bounded(target.maxTargets, REACTION_LIMITS.targetsPerEffect, "Reaction maxTargets", true) });
      } else if (target.kind === "terrain_tag") {
        keys(target, ["kind", "tag", "maxTargets"], "Reaction terrain target");
        normalizedTarget = Object.freeze({ kind: "terrain_tag", tag: boundedId(target.tag, "Reaction terrain target tag"), maxTargets: bounded(target.maxTargets, REACTION_LIMITS.targetsPerEffect, "Reaction maxTargets", true) });
      } else throw new Error("Reaction target kind is unsupported.");
      if (effect.allowReactions !== undefined && typeof effect.allowReactions !== "boolean") throw new Error("Reaction allowReactions must be boolean.");
      Object.defineProperty(effects, effectId, { value: Object.freeze({ kind: "damage", amount: normalizedAmount, damageType, target: normalizedTarget, ...(effect.allowReactions === undefined ? {} : { allowReactions: effect.allowReactions }) }), enumerable: true });
    }
    Object.defineProperty(reactions, reactionId, { value: Object.freeze({
      label: boundedLabel(raw.label, `Reaction ${reactionId} label`),
      trigger: Object.freeze({ damageTypes: Object.freeze(triggerTypes) }),
      ...(requirements.length === 0 ? {} : { requirements: Object.freeze(requirements) }),
      ...(raw.suppressTriggerExposureApplications === undefined ? {} : { suppressTriggerExposureApplications: raw.suppressTriggerExposureApplications === true }),
      effects: Object.freeze(effects)
    }), enumerable: true });
  }
  if (effectCount > REACTION_LIMITS.totalReactionEffects) throw new Error("Reaction total effect budget exceeded.");
  return Object.freeze({
    schemaVersion: 1,
    exposures: Object.freeze({ definitions: Object.freeze(definitions), applications: Object.freeze({ damageTypes: Object.freeze(applications) }) }),
    reactions: Object.freeze(reactions)
  });
}

export function resolveActiveReactionsMechanics(
  content: GameContentRegistry,
  missionId: string
): ActiveReactionsMechanics | undefined {
  const mission = content.missions[missionId];
  if (!mission) return undefined;
  const capability = resolveCapabilitySet(content.mechanics, mission.mechanics).reactions;
  if (!capability.active || capability.profileId === undefined) return undefined;
  const combat = resolveActiveCombatMechanics(content, missionId);
  if (!combat || combat.schemaVersion < 2) return undefined;
  const module = content.mechanics.modules.reactions;
  if (!module || module.schemaVersion !== 1) return undefined;
  const profile = module.profiles[capability.profileId];
  if (profile === undefined) return undefined;
  return normalizeReactionsProfileV1(profile, new Set(Object.keys(combat.damageTypes)));
}
