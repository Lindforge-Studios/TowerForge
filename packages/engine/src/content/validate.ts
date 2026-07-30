import { ABILITY_IDS, ATTACK_KIND_IDS } from "./schema-descriptor.js";
import type { GameContentRegistry } from "./registry.js";
import { TOWER_TARGET_MODES } from "../simulation/types.js";
import { coordKey } from "../simulation/hex.js";
import { createGridTopology, normalizeGridDefinition } from "../simulation/topology.js";
import { validateTowerScriptDefinitions } from "../scripting/validate.js";
import { TOWER_SCRIPT_LIMITS } from "../scripting/schema-descriptor.js";
import type { TowerScriptDefinition } from "../scripting/types.js";
import { ARMOR_MATRIX_LIMITS, MARK_LIMITS, MECHANICS_MODULE_IDS, REACTION_LIMITS, SHIELD_LIMITS } from "./mechanics.js";
import {
  NAVIGATION_LIMITS,
  NavigationProfileValidationError,
  normalizeNavigationProfileV1,
  resolveActiveNavigationMechanics,
  type DynamicFlowNavigationProfileV1
} from "./navigation-mechanics.js";
import {
  GridElevationValidationError,
  inspectGridElevationOverrides,
  normalizeGridElevationOverrides
} from "../simulation/map.js";
import { HIGH_GROUND_LIMITS, LINE_OF_SIGHT_LIMITS } from "./elevation-mechanics.js";
import {
  PHYSICS_LIMITS,
  inspectOwnDataEffect,
  parseDisplacementEffectV1,
  resolveActivePhysicsMechanics
} from "./physics-mechanics.js";
import {
  TERRAFORMING_LIMITS,
  TerraformingProfileValidationError,
  normalizeTerraformingProfileV1
} from "./terraforming-mechanics.js";
import {
  ROGUELITE_SYNERGY_LIMITS,
  ROGUELITE_DRAFT_LIMITS,
  RogueliteProfileValidationError,
  assertRogueliteV2ModifierBudget,
  assertRogueliteV3ModifierBudget,
  normalizeRogueliteProfileV1,
  normalizeRogueliteProfileV2,
  normalizeRogueliteProfileV3,
  normalizeRogueliteProfileV4,
  normalizeTowerTagsV1
} from "./roguelite-mechanics.js";
import {
  HeroesProfileValidationError,
  normalizeHeroesProfileV1,
  normalizeHeroesProfileV2,
  normalizeHeroesProfileV3,
  normalizeHeroesProfileV4,
  normalizeHeroesProfileV5,
  normalizeHeroesProfileV6,
  normalizeHeroesProfileV7,
  validateHeroSkillTreeSemanticsV5,
  type HeroesProfileV1,
  type HeroesProfileV2,
  type HeroesProfileV3,
  type HeroesProfileV4,
  type HeroesProfileV5,
  type HeroesProfileV6,
  type HeroesProfileV7
} from "./heroes-mechanics.js";
import {
  LogisticsProfileValidationError,
  normalizeLogisticsProfileV1,
  normalizeLogisticsProfileV2,
  normalizeLogisticsProfileV3,
  type LogisticsAmmunitionDefinitionV2,
  type LogisticsSupplyDefinitionV3
} from "./logistics-mechanics.js";
import {
  DirectorProfileValidationError,
  normalizeDirectorProfileV1
} from "./director-mechanics.js";
import {
  MultiplayerProfileValidationError,
  normalizeMultiplayerProfileV1,
  normalizeMultiplayerProfileV2
} from "./multiplayer-mechanics.js";
import {
  normalizeAuthoredWorldCampaign,
  WorldCampaignValidationError
} from "../run/campaign-world.js";
import {
  campaignBattleRogueliteWorstCaseModifierCount,
  preflightHeroAuraDamageFinite
} from "../run/campaign-battle-policy.js";
import { MAX_MODIFIERS_PER_RESOLUTION } from "../simulation/modifiers.js";

/**
 * `code` is a STABLE, machine-branchable identifier — derived automatically from
 * `entityKind`+`fieldPath` (see `deriveValidationCode`) unless a call site overrides it, so every
 * issue gets one for free. `hint`/`expected`/`got` are populated where cheap/curated (not every
 * call site); the MCP `explain_validation` tool looks a `code` up against a small curated map and
 * falls back to the issue's own `message` when no curated hint exists yet.
 *
 * CAVEAT: `code` is a COARSE grouping key, not a guaranteed-unique one. It upper-cases the whole
 * derivation input, so two field paths that differ only by case in an author-defined id segment
 * (e.g. a currency cost bag for currencies "gem_shards" vs "GEM_SHARDS") derive the SAME code. A
 * caller that needs to distinguish two issues precisely should key on `fieldPath` (which embeds
 * the literal id and is always distinct), not `code` alone.
 */
export interface ValidationIssue {
  severity: "error" | "warning";
  entityKind: string;
  entityId: string;
  fieldPath: string;
  message: string;
  code: string;
  hint?: string;
  expected?: string;
  got?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** Derives a stable code like "TOWER_ATTACK_SLOWFACTOR" from entityKind + fieldPath. See the
 *  ValidationIssue.code caveat above — this is a coarse key, not a unique one. */
export function deriveValidationCode(entityKind: string, fieldPath: string): string {
  return `${entityKind}_${fieldPath}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function validateNavigationReferences(
  profile: DynamicFlowNavigationProfileV1,
  root: string,
  content: GameContentRegistry,
  report: (fieldPath: string, message: string) => void
): void {
  if (!Object.prototype.hasOwnProperty.call(profile.movementProfiles, profile.defaultMovementProfileId)) {
    report(
      `${root}.defaultMovementProfileId`,
      `Navigation defaultMovementProfileId references unknown movement profile "${profile.defaultMovementProfileId}".`
    );
  }
  for (const enemyId of Object.keys(profile.enemyMovementProfiles ?? {}).sort()) {
    const movementProfileId = profile.enemyMovementProfiles![enemyId]!;
    if (!Object.prototype.hasOwnProperty.call(content.enemies, enemyId)) {
      report(
        `${root}.enemyMovementProfiles.${enemyId}`,
        `Navigation assignment references unknown enemy "${enemyId}".`
      );
    }
    if (!Object.prototype.hasOwnProperty.call(profile.movementProfiles, movementProfileId)) {
      report(
        `${root}.enemyMovementProfiles.${enemyId}`,
        `Navigation assignment references unknown movement profile "${movementProfileId}".`
      );
    }
  }
  for (const movementProfileId of Object.keys(profile.movementProfiles).sort()) {
    const movementProfile = profile.movementProfiles[movementProfileId]!;
    for (const terrainId of Object.keys(movementProfile.terrainCosts ?? {}).sort()) {
      if (!Object.prototype.hasOwnProperty.call(content.terrainTypes, terrainId)) {
        report(
          `${root}.movementProfiles.${movementProfileId}.terrainCosts.${terrainId}`,
          `Navigation terrainCosts references unknown terrain "${terrainId}".`
        );
      }
    }
  }
}

interface IssueExtra {
  code?: string;
  hint?: string;
  expected?: string;
  got?: string;
}

export function validateGameContentRegistry(content: GameContentRegistry): ValidationResult {
  const issues: ValidationIssue[] = [];

  const missionIds = new Set(Object.keys(content.missions));
  const mapIds = new Set(Object.keys(content.maps));
  const enemyIds = new Set(Object.keys(content.enemies));
  const towerIds = new Set(Object.keys(content.towers));
  const abilityIds = new Set(Object.keys(content.abilities));
  const waveSetIds = new Set(Object.keys(content.waveSets));
  const regionIds = new Set(content.worldMap.regions.map((r) => r.id));

  const err = (entityKind: string, entityId: string, fieldPath: string, message: string, extra: IssueExtra = {}) => {
    issues.push({ severity: "error", entityKind, entityId, fieldPath, message, code: extra.code ?? deriveValidationCode(entityKind, fieldPath), hint: extra.hint, expected: extra.expected, got: extra.got });
  };
  const warn = (entityKind: string, entityId: string, fieldPath: string, message: string, extra: IssueExtra = {}) => {
    issues.push({ severity: "warning", entityKind, entityId, fieldPath, message, code: extra.code ?? deriveValidationCode(entityKind, fieldPath), hint: extra.hint, expected: extra.expected, got: extra.got });
  };
  const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const inspectedEnemyResistances = new Map<string, Record<string, number> | undefined>();
  const authoredMarkIds = new Set<string>();
  const terraformingTransitionIdsByProfile = new Map<string, Set<string>>();
  const activeTerraformingTransitionIdsByMission = new Map<string, Set<string>>();
  const activeMarkIds = new Set<string>();
  const markIdsByProfile = new Map<string, Set<string>>();
  const activeMarkIdsByMission = new Map<string, Set<string>>();
  let hasAuthoredMarks = false;
  const inspectEnemyResistances = (
    enemyId: string,
    value: unknown
  ): Record<string, number> | undefined => {
    if (inspectedEnemyResistances.has(enemyId)) return inspectedEnemyResistances.get(enemyId);
    if (value === undefined) {
      inspectedEnemyResistances.set(enemyId, undefined);
      return undefined;
    }
    let prototype: object | null;
    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    try {
      prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
      descriptors = value !== null && typeof value === "object"
        ? Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>
        : {};
    } catch {
      err("enemy", enemyId, "resistances", `Enemy "${enemyId}" resistances could not be inspected safely.`);
      inspectedEnemyResistances.set(enemyId, undefined);
      return undefined;
    }
    if (
      value === null
      || typeof value !== "object"
      || Array.isArray(value)
      || (prototype !== Object.prototype && prototype !== null)
    ) {
      err("enemy", enemyId, "resistances", `Enemy "${enemyId}" resistances must be a plain object with own data fields.`);
      inspectedEnemyResistances.set(enemyId, undefined);
      return undefined;
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
      err("enemy", enemyId, "resistances", `Enemy "${enemyId}" resistances must not contain symbol fields.`);
    }
    const detached: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const damageTypeId of Object.keys(descriptors)) {
      const descriptor = descriptors[damageTypeId];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        err(
          "enemy",
          enemyId,
          `resistances.${damageTypeId}`,
          `Enemy "${enemyId}" resistance "${damageTypeId}" must be an enumerable own data property.`
        );
        continue;
      }
      const multiplier = descriptor.value;
      if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier < 0) {
        err(
          "enemy",
          enemyId,
          `resistances.${damageTypeId}`,
          `Enemy "${enemyId}" resistance "${damageTypeId}" must be a finite non-negative number.`
        );
        continue;
      }
      Object.defineProperty(detached, damageTypeId, { value: multiplier, enumerable: true });
    }
    inspectedEnemyResistances.set(enemyId, detached);
    return detached;
  };

  const validateCombatMechanics = () => {
    const inspectDataRecord = (
      value: unknown,
      entityId: string,
      fieldPath: string,
      label: string
    ): Record<string, unknown> | undefined => {
      if (value === null || typeof value !== "object") {
        err("mechanics", entityId, fieldPath, `${label} must be a plain object with own data fields.`);
        return undefined;
      }
      let descriptors: PropertyDescriptorMap;
      let prototype: object | null;
      let array: boolean;
      try {
        array = Array.isArray(value);
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value) as PropertyDescriptorMap;
      } catch {
        err("mechanics", entityId, fieldPath, `${label} fields could not be inspected safely.`);
        return undefined;
      }
      if (array || prototype !== Object.prototype) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain object with own data fields.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("mechanics", entityId, fieldPath, `${label} must not contain symbol fields.`);
      }
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `${label} field "${key}" must be an enumerable own data property.`);
          continue;
        }
        Object.defineProperty(result, key, {
          value: descriptor.value,
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      return result;
    };
    type PropertyDescriptorMap = Record<PropertyKey, PropertyDescriptor>;
    const reportUnknownKeys = (
      value: Record<string, unknown>,
      allowed: readonly string[],
      entityId: string,
      fieldPath: string
    ) => {
      const allowedKeys = new Set(allowed);
      for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `Unknown mechanics field "${key}".`);
        }
      }
    };

    const catalog = inspectDataRecord(content.mechanics, "catalog", "root", "Mechanics catalog");
    if (!catalog) return;
    reportUnknownKeys(catalog, ["schemaVersion", "modules"], "catalog", "root");
    if (catalog.schemaVersion !== 1) {
      err("mechanics", "catalog", "schemaVersion", "Mechanics catalog schemaVersion must be 1.");
    }
    const modules = inspectDataRecord(catalog.modules, "catalog", "modules", "Mechanics modules");
    if (!modules) return;
    const knownModuleIds = new Set<string>(MECHANICS_MODULE_IDS);
    for (const moduleId of Object.keys(modules)) {
      if (!knownModuleIds.has(moduleId)) {
        err("mechanics", moduleId, `modules.${moduleId}`, `Unknown mechanics module "${moduleId}".`);
      }
    }

    const module = modules.combat === undefined
      ? undefined
      : inspectDataRecord(modules.combat, "combat", "modules.combat", "Combat mechanics module");
    if (!module) return;
    reportUnknownKeys(module, ["schemaVersion", "enabled", "profiles"], "combat", "modules.combat");
    const combatSchemaVersion = module.schemaVersion;
    if (combatSchemaVersion !== 1 && combatSchemaVersion !== 2 && combatSchemaVersion !== 3) {
      err(
        "mechanics",
        "combat",
        "modules.combat.schemaVersion",
        "Combat mechanics module schemaVersion must be supported version 1, 2, or 3; future versions are rejected."
      );
    }
    if (typeof module.enabled !== "boolean") {
      err("mechanics", "combat", "modules.combat.enabled", "Combat mechanics module enabled must be boolean.");
    }
    const profiles = inspectDataRecord(module.profiles, "combat", "modules.combat.profiles", "Combat mechanics profiles");
    if (!profiles) return;

    const selectedProfileIds = new Set<string>();
    for (const [missionId, mission] of Object.entries(content.missions)) {
      const missionRecord = inspectDataRecord(mission, missionId, "root", `Mission "${missionId}"`);
      if (!missionRecord || missionRecord.mechanics === undefined) continue;
      const selection = inspectDataRecord(missionRecord.mechanics, missionId, "mechanics", "Mission mechanics selection");
      if (!selection || selection.profiles === undefined) continue;
      const selections = inspectDataRecord(selection.profiles, missionId, "mechanics.profiles", "Mission mechanics profiles");
      const profileId = selections?.combat;
      if (typeof profileId !== "string") continue;
      selectedProfileIds.add(profileId);
      if (module.enabled === true && !Object.prototype.hasOwnProperty.call(profiles, profileId)) {
        err(
          "mission",
          missionId,
          "mechanics.profiles.combat",
          `Mission "${missionId}" selects missing combat profile "${profileId}".`
        );
      }
    }

    const semanticIssue = (active: boolean, profileId: string, fieldPath: string, message: string) => {
      (active ? err : warn)("mechanics", profileId, fieldPath, message);
    };
    const validateBoundedNumber = (
      value: unknown,
      max: number,
      allowZero: boolean,
      active: boolean,
      profileId: string,
      fieldPath: string
    ) => {
      if (typeof value !== "number") {
        err("mechanics", profileId, fieldPath, `${fieldPath} must be an own numeric data field.`);
        return;
      }
      const minimumValid = allowZero ? value >= 0 : value > 0;
      if (!Number.isFinite(value) || !minimumValid || value > max) {
        semanticIssue(active, profileId, fieldPath, `${fieldPath} is outside the supported shield range.`);
      }
    };

    for (const profileId of Object.keys(profiles)) {
      const rootPath = `modules.combat.profiles.${profileId}`;
      const profile = inspectDataRecord(profiles[profileId], profileId, rootPath, `Combat profile "${profileId}"`);
      if (!profile) continue;
      const active = module.enabled === true && selectedProfileIds.has(profileId);
      if (combatSchemaVersion === 3) markIdsByProfile.set(profileId, new Set());
      reportUnknownKeys(
        profile,
        combatSchemaVersion === 1
          ? ["shields"]
          : combatSchemaVersion === 2
            ? ["shields", "damageTypes", "armorTypes", "armorAssignments"]
            : ["shields", "damageTypes", "armorTypes", "armorAssignments", "marks"],
        profileId,
        rootPath
      );

      if (profile.shields !== undefined) {
        const shields = inspectDataRecord(profile.shields, profileId, `${rootPath}.shields`, "Combat shields");
        if (shields) {
          reportUnknownKeys(shields, ["enemies", "towers"], profileId, `${rootPath}.shields`);
          for (const targetKind of ["enemies", "towers"] as const) {
            if (shields[targetKind] === undefined) continue;
            const definitionsPath = `${rootPath}.shields.${targetKind}`;
            const definitions = inspectDataRecord(shields[targetKind], profileId, definitionsPath, `${targetKind} shields`);
            if (!definitions) continue;
            for (const targetId of Object.keys(definitions)) {
              const definitionPath = `${definitionsPath}.${targetId}`;
              const definition = inspectDataRecord(definitions[targetId], profileId, definitionPath, `Shield "${targetId}"`);
              if (!definition) continue;
              reportUnknownKeys(definition, ["capacity", "regeneration"], profileId, definitionPath);
              validateBoundedNumber(definition.capacity, SHIELD_LIMITS.capacity, false, active, profileId, `${definitionPath}.capacity`);
              if (definition.regeneration !== undefined) {
                const regenerationPath = `${definitionPath}.regeneration`;
                const regeneration = inspectDataRecord(definition.regeneration, profileId, regenerationPath, "Shield regeneration");
                if (regeneration) {
                  reportUnknownKeys(regeneration, ["ratePerUnit", "delayAfterDamage"], profileId, regenerationPath);
                  validateBoundedNumber(regeneration.ratePerUnit, SHIELD_LIMITS.ratePerUnit, false, active, profileId, `${regenerationPath}.ratePerUnit`);
                  if (regeneration.delayAfterDamage !== undefined) {
                    validateBoundedNumber(regeneration.delayAfterDamage, SHIELD_LIMITS.delayAfterDamage, true, active, profileId, `${regenerationPath}.delayAfterDamage`);
                  }
                }
              }
              if (targetKind === "enemies") {
                if (!enemyIds.has(targetId)) semanticIssue(active, profileId, definitionPath, `Shield references unknown enemy "${targetId}".`);
              } else if (!towerIds.has(targetId)) {
                semanticIssue(active, profileId, definitionPath, `Shield references unknown tower "${targetId}".`);
              } else {
                const tower = content.towers[targetId];
                if (typeof tower?.maxHp !== "number" || !Number.isFinite(tower.maxHp) || tower.maxHp <= 0) {
                  semanticIssue(active, profileId, definitionPath, `Tower "${targetId}" must define maxHp > 0 because only destructible towers can be shielded.`);
                }
              }
            }
          }
        }
      }

      if (combatSchemaVersion !== 2 && combatSchemaVersion !== 3) continue;

      const damageTypesPath = `${rootPath}.damageTypes`;
      const damageTypes = profile.damageTypes === undefined
        ? undefined
        : inspectDataRecord(profile.damageTypes, profileId, damageTypesPath, "Combat damage types");
      const damageTypeIds = new Set<string>();
      if (damageTypes) {
        if (Object.keys(damageTypes).length > ARMOR_MATRIX_LIMITS.damageTypes) {
          err(
            "mechanics",
            profileId,
            damageTypesPath,
            `Combat damage types exceed the maximum limit of ${ARMOR_MATRIX_LIMITS.damageTypes}.`
          );
        }
        for (const damageTypeId of Object.keys(damageTypes)) {
          const definitionPath = `${damageTypesPath}.${damageTypeId}`;
          if (damageTypeId.trim().length === 0) {
            err("mechanics", profileId, definitionPath, "Damage type ids must be non-empty.");
          }
          damageTypeIds.add(damageTypeId);
          const definition = inspectDataRecord(
            damageTypes[damageTypeId],
            profileId,
            definitionPath,
            `Damage type "${damageTypeId}"`
          );
          if (!definition) continue;
          reportUnknownKeys(definition, ["label"], profileId, definitionPath);
          if (
            typeof definition.label !== "string"
            || definition.label.length === 0
            || definition.label.length > ARMOR_MATRIX_LIMITS.labelLength
          ) {
            err(
              "mechanics",
              profileId,
              `${definitionPath}.label`,
              `Damage type label must contain 1..${ARMOR_MATRIX_LIMITS.labelLength} characters.`
            );
          }
        }
      }

      const armorTypesPath = `${rootPath}.armorTypes`;
      const armorTypes = profile.armorTypes === undefined
        ? undefined
        : inspectDataRecord(profile.armorTypes, profileId, armorTypesPath, "Combat armor types");
      const armorTypeIds = new Set<string>();
      let matrixEntryCount = 0;
      if (armorTypes) {
        if (Object.keys(armorTypes).length > ARMOR_MATRIX_LIMITS.armorTypes) {
          err(
            "mechanics",
            profileId,
            armorTypesPath,
            `Combat armor types exceed the maximum limit of ${ARMOR_MATRIX_LIMITS.armorTypes}.`
          );
        }
        for (const armorTypeId of Object.keys(armorTypes)) {
          const definitionPath = `${armorTypesPath}.${armorTypeId}`;
          if (armorTypeId.trim().length === 0) {
            err("mechanics", profileId, definitionPath, "Armor type ids must be non-empty.");
          }
          armorTypeIds.add(armorTypeId);
          const definition = inspectDataRecord(
            armorTypes[armorTypeId],
            profileId,
            definitionPath,
            `Armor type "${armorTypeId}"`
          );
          if (!definition) continue;
          reportUnknownKeys(definition, ["label", "defaultMultiplier", "multipliers"], profileId, definitionPath);
          if (
            typeof definition.label !== "string"
            || definition.label.length === 0
            || definition.label.length > ARMOR_MATRIX_LIMITS.labelLength
          ) {
            err(
              "mechanics",
              profileId,
              `${definitionPath}.label`,
              `Armor type label must contain 1..${ARMOR_MATRIX_LIMITS.labelLength} characters.`
            );
          }
          if (definition.defaultMultiplier !== undefined) {
            validateBoundedNumber(
              definition.defaultMultiplier,
              ARMOR_MATRIX_LIMITS.multiplier,
              true,
              active,
              profileId,
              `${definitionPath}.defaultMultiplier`
            );
          }
          const multipliersPath = `${definitionPath}.multipliers`;
          const multipliers = inspectDataRecord(
            definition.multipliers,
            profileId,
            multipliersPath,
            `Armor type "${armorTypeId}" multipliers`
          );
          if (!multipliers) continue;
          matrixEntryCount += Object.keys(multipliers).length;
          for (const damageTypeId of Object.keys(multipliers)) {
            const multiplierPath = `${multipliersPath}.${damageTypeId}`;
            validateBoundedNumber(
              multipliers[damageTypeId],
              ARMOR_MATRIX_LIMITS.multiplier,
              true,
              active,
              profileId,
              multiplierPath
            );
            if (!damageTypeIds.has(damageTypeId)) {
              semanticIssue(
                active,
                profileId,
                multiplierPath,
                `Armor matrix references unknown damage type "${damageTypeId}".`
              );
            }
          }
        }
        if (matrixEntryCount > ARMOR_MATRIX_LIMITS.matrixEntries) {
          err(
            "mechanics",
            profileId,
            armorTypesPath,
            `Armor matrix exceeds the maximum limit of ${ARMOR_MATRIX_LIMITS.matrixEntries} entries.`
          );
        }
      }

      if (profile.armorAssignments !== undefined) {
        const assignmentsPath = `${rootPath}.armorAssignments`;
        const assignments = inspectDataRecord(
          profile.armorAssignments,
          profileId,
          assignmentsPath,
          "Combat armor assignments"
        );
        if (assignments) {
          reportUnknownKeys(assignments, ["enemies"], profileId, assignmentsPath);
          if (assignments.enemies !== undefined) {
            const enemiesPath = `${assignmentsPath}.enemies`;
            const enemyAssignments = inspectDataRecord(
              assignments.enemies,
              profileId,
              enemiesPath,
              "Combat enemy armor assignments"
            );
            if (enemyAssignments) {
              if (Object.keys(enemyAssignments).length > ARMOR_MATRIX_LIMITS.assignments) {
                err(
                  "mechanics",
                  profileId,
                  enemiesPath,
                  `Combat enemy armor assignments exceed the maximum limit of ${ARMOR_MATRIX_LIMITS.assignments}.`
                );
              }
              if (Object.keys(enemyAssignments).length > 0 && !damageTypeIds.has("physical")) {
                semanticIssue(
                  active,
                  profileId,
                  `${damageTypesPath}.physical`,
                  "Enemy armor assignments require the implicit physical damage type to be declared."
                );
              }
              for (const enemyId of Object.keys(enemyAssignments)) {
                const assignmentPath = `${enemiesPath}.${enemyId}`;
                const armorTypeId = enemyAssignments[enemyId];
                if (typeof armorTypeId !== "string" || armorTypeId.trim().length === 0) {
                  err("mechanics", profileId, assignmentPath, "Enemy armor assignment must be a non-empty armor type id.");
                  continue;
                }
                if (!enemyIds.has(enemyId)) {
                  semanticIssue(active, profileId, assignmentPath, `Armor assignment references unknown enemy "${enemyId}".`);
                } else if (active) {
                  const resistances = inspectEnemyResistances(enemyId, content.enemies[enemyId]?.resistances);
                  for (const damageTypeId of Object.keys(resistances ?? {})) {
                    if (!damageTypeIds.has(damageTypeId)) {
                      semanticIssue(
                        true,
                        profileId,
                        `enemies.${enemyId}.resistances.${damageTypeId}`,
                        `Enemy "${enemyId}" resistance references unknown damage type "${damageTypeId}".`
                      );
                    }
                  }
                }
                if (!armorTypeIds.has(armorTypeId)) {
                  semanticIssue(
                    active,
                    profileId,
                    assignmentPath,
                    `Armor assignment references unknown armor type "${armorTypeId}".`
                  );
                }
              }
            }
          }
        }
      }

      if (combatSchemaVersion === 3 && profile.marks !== undefined) {
        hasAuthoredMarks = true;
        const marksPath = `${rootPath}.marks`;
        const marks = inspectDataRecord(profile.marks, profileId, marksPath, "Combat marks");
        if (marks) {
          reportUnknownKeys(marks, ["definitions", "bindings"], profileId, marksPath);
          if (!Object.prototype.hasOwnProperty.call(marks, "definitions")) {
            err("mechanics", profileId, `${marksPath}.definitions`, "Combat marks definitions catalog is required.");
          }
          const definitionsPath = `${marksPath}.definitions`;
          const definitions = Object.prototype.hasOwnProperty.call(marks, "definitions")
            ? inspectDataRecord(marks.definitions, profileId, definitionsPath, "Combat mark definitions")
            : undefined;
          const definitionMaxStacks = new Map<string, number>();
          if (definitions) {
            if (Object.keys(definitions).length > MARK_LIMITS.definitions) {
              err(
                "mechanics",
                profileId,
                definitionsPath,
                `Combat mark definitions exceed the maximum limit of ${MARK_LIMITS.definitions}.`
              );
            }
            for (const markId of Object.keys(definitions)) {
              const definitionPath = `${definitionsPath}.${markId}`;
              if (markId.trim().length === 0) {
                err("mechanics", profileId, definitionPath, "Mark ids must be non-empty.");
              }
              authoredMarkIds.add(markId);
              markIdsByProfile.get(profileId)?.add(markId);
              if (active) activeMarkIds.add(markId);
              const definition = inspectDataRecord(
                definitions[markId],
                profileId,
                definitionPath,
                `Mark "${markId}"`
              );
              if (!definition) continue;
              reportUnknownKeys(
                definition,
                ["label", "duration", "maxStacks", "multiplier", "consumePolicy", "damageTypes"],
                profileId,
                definitionPath
              );
              for (const field of ["label", "duration", "maxStacks", "multiplier", "consumePolicy"] as const) {
                if (!Object.prototype.hasOwnProperty.call(definition, field)) {
                  err("mechanics", profileId, `${definitionPath}.${field}`, `Mark field "${field}" is required.`);
                }
              }
              if (
                typeof definition.label !== "string"
                || definition.label.length === 0
                || definition.label.length > MARK_LIMITS.labelLength
              ) {
                err(
                  "mechanics",
                  profileId,
                  `${definitionPath}.label`,
                  `Mark label must contain 1..${MARK_LIMITS.labelLength} characters.`
                );
              }
              const validateMarkNumber = (
                field: "duration" | "maxStacks" | "multiplier",
                maximum: number,
                integerOnly = false,
                greaterThanOne = false
              ) => {
                const value = definition[field];
                if (typeof value !== "number") {
                  err("mechanics", profileId, `${definitionPath}.${field}`, `Mark ${field} must be a numeric own data field.`);
                  return;
                }
                if (
                  !Number.isFinite(value)
                  || (greaterThanOne ? value <= 1 : value <= 0)
                  || value > maximum
                  || (integerOnly && !Number.isSafeInteger(value))
                ) {
                  semanticIssue(active, profileId, `${definitionPath}.${field}`, `Mark ${field} is outside the supported range.`);
                  return;
                }
                if (field === "maxStacks") definitionMaxStacks.set(markId, value);
              };
              validateMarkNumber("duration", MARK_LIMITS.duration);
              validateMarkNumber("maxStacks", MARK_LIMITS.maxStacks, true);
              validateMarkNumber("multiplier", MARK_LIMITS.multiplier, false, true);
              if (
                definition.consumePolicy !== "retain"
                && definition.consumePolicy !== "consume_one"
                && definition.consumePolicy !== "consume_all"
              ) {
                semanticIssue(
                  active,
                  profileId,
                  `${definitionPath}.consumePolicy`,
                  "Mark consumePolicy must be retain, consume_one, or consume_all."
                );
              }
              if (definition.damageTypes !== undefined) {
                const damageTypesFieldPath = `${definitionPath}.damageTypes`;
                if (!Array.isArray(definition.damageTypes)) {
                  err("mechanics", profileId, damageTypesFieldPath, "Mark damageTypes must be an array.");
                } else if (definition.damageTypes.length === 0) {
                  semanticIssue(active, profileId, damageTypesFieldPath, "Mark damageTypes must contain at least one damage type when authored.");
                } else if (definition.damageTypes.length > MARK_LIMITS.filterDamageTypes) {
                  err(
                    "mechanics",
                    profileId,
                    damageTypesFieldPath,
                    `Mark damageTypes exceed the maximum limit of ${MARK_LIMITS.filterDamageTypes}.`
                  );
                } else {
                  const seenDamageTypes = new Set<string>();
                  for (let index = 0; index < definition.damageTypes.length; index += 1) {
                    const descriptor = Object.getOwnPropertyDescriptor(definition.damageTypes, String(index));
                    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
                      err(
                        "mechanics",
                        profileId,
                        `${damageTypesFieldPath}[${index}]`,
                        "Mark damage type filter entries must be enumerable own data properties."
                      );
                      continue;
                    }
                    const damageTypeId = descriptor.value;
                    if (typeof damageTypeId !== "string" || !damageTypeIds.has(damageTypeId)) {
                      semanticIssue(
                        active,
                        profileId,
                        damageTypesFieldPath,
                        `Mark references unknown damage type "${String(damageTypeId)}".`
                      );
                    } else if (seenDamageTypes.has(damageTypeId)) {
                      semanticIssue(
                        active,
                        profileId,
                        `${damageTypesFieldPath}[${index}]`,
                        `Mark damageTypes contains duplicate damage type "${damageTypeId}".`
                      );
                    } else {
                      seenDamageTypes.add(damageTypeId);
                    }
                  }
                }
              }
            }
          }

          if (marks.bindings !== undefined) {
            const bindingsPath = `${marksPath}.bindings`;
            const bindings = inspectDataRecord(marks.bindings, profileId, bindingsPath, "Combat mark bindings");
            if (bindings) {
              reportUnknownKeys(bindings, ["towers", "abilities", "towerScripts"], profileId, bindingsPath);
              let sourceBindingCount = 0;
              const knownSources = {
                towers: towerIds,
                abilities: abilityIds,
                towerScripts: new Set(Object.keys(content.scripts))
              } as const;
              for (const groupName of ["towers", "abilities", "towerScripts"] as const) {
                if (bindings[groupName] === undefined) continue;
                const groupPath = `${bindingsPath}.${groupName}`;
                const sources = inspectDataRecord(
                  bindings[groupName],
                  profileId,
                  groupPath,
                  `Combat mark ${groupName} bindings`
                );
                if (!sources) continue;
                sourceBindingCount += Object.keys(sources).length;
                for (const sourceId of Object.keys(sources)) {
                  const sourcePath = `${groupPath}.${sourceId}`;
                  if (!knownSources[groupName].has(sourceId)) {
                    semanticIssue(
                      active,
                      profileId,
                      sourcePath,
                      `Mark binding references unknown ${groupName === "towerScripts" ? "script" : groupName.slice(0, -1)} "${sourceId}".`
                    );
                  }
                  const applications = sources[sourceId];
                  if (!Array.isArray(applications)) {
                    err("mechanics", profileId, sourcePath, "Mark source binding must be an array.");
                    continue;
                  }
                  if (applications.length > MARK_LIMITS.applicationsPerSource) {
                    err(
                      "mechanics",
                      profileId,
                      sourcePath,
                      `Mark source binding exceeds the maximum limit of ${MARK_LIMITS.applicationsPerSource} applications.`
                    );
                    continue;
                  }
                  const seenApplicationMarkIds = new Set<string>();
                  for (let index = 0; index < applications.length; index += 1) {
                    const descriptor = Object.getOwnPropertyDescriptor(applications, String(index));
                    const applicationPath = `${sourcePath}[${index}]`;
                    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
                      err("mechanics", profileId, applicationPath, "Mark application must be an enumerable own data property.");
                      continue;
                    }
                    const application = inspectDataRecord(
                      descriptor.value,
                      profileId,
                      applicationPath,
                      "Mark application"
                    );
                    if (!application) continue;
                    reportUnknownKeys(application, ["markId", "stacks"], profileId, applicationPath);
                    const markId = application.markId;
                    if (typeof markId !== "string" || markId.trim().length === 0) {
                      err("mechanics", profileId, `${applicationPath}.markId`, "Mark application markId is required.");
                      continue;
                    }
                    if (!definitions || !Object.prototype.hasOwnProperty.call(definitions, markId)) {
                      semanticIssue(active, profileId, applicationPath, `Mark application references unknown mark "${markId}".`);
                    }
                    if (seenApplicationMarkIds.has(markId)) {
                      semanticIssue(
                        active,
                        profileId,
                        `${applicationPath}.markId`,
                        `Mark application duplicates mark "${markId}" for the same source.`
                      );
                    } else {
                      seenApplicationMarkIds.add(markId);
                    }
                    if (application.stacks !== undefined) {
                      const stacks = application.stacks;
                      if (typeof stacks !== "number") {
                        err("mechanics", profileId, `${applicationPath}.stacks`, "Mark application stacks must be numeric.");
                      } else if (!Number.isSafeInteger(stacks) || stacks <= 0) {
                        semanticIssue(active, profileId, applicationPath, "Mark application stacks must be a positive integer.");
                      } else {
                        const maximum = definitionMaxStacks.get(markId);
                        if (maximum !== undefined && stacks > maximum) {
                          semanticIssue(
                            active,
                            profileId,
                            applicationPath,
                            `Mark application stacks exceed maxStacks for "${markId}".`
                          );
                        }
                      }
                    }
                  }
                }
              }
              if (sourceBindingCount > MARK_LIMITS.sourceBindings) {
                err(
                  "mechanics",
                  profileId,
                  bindingsPath,
                  `Combat mark bindings exceed the maximum limit of ${MARK_LIMITS.sourceBindings} sources.`
                );
              }
            }
          }
        }
      }

      if (active && damageTypes !== undefined) {
        const selectedTowerIds = new Set(
          Object.values(content.missions)
            .filter((mission) => mission.mechanics?.profiles?.combat === profileId)
            .flatMap((mission) => mission.buildTowerIds)
        );
        for (const towerId of selectedTowerIds) {
          const attack = content.towers[towerId]?.attack;
          if (!attack || typeof attack !== "object") continue;
          const damageType = (attack as { damageType?: unknown }).damageType;
          if (typeof damageType === "string" && !damageTypeIds.has(damageType)) {
            err(
              "tower",
              towerId,
              "attack.damageType",
              `Tower "${towerId}" references unknown damage type "${damageType}".`
            );
          }
          if (attack.kind !== "pipeline" || !Array.isArray(attack.effects)) continue;
          for (let index = 0; index < attack.effects.length; index += 1) {
            const effect = attack.effects[index];
            if (!effect || effect.kind !== "damage" || typeof effect.damageType !== "string") continue;
            if (!damageTypeIds.has(effect.damageType)) {
              err(
                "tower",
                towerId,
                `attack.effects[${index}].damageType`,
                `Tower "${towerId}" pipeline effect references unknown damage type "${effect.damageType}".`
              );
            }
          }
        }
      }
    }

    if (module.enabled === true && combatSchemaVersion === 3) {
      for (const [missionId, mission] of Object.entries(content.missions)) {
        const profileId = mission.mechanics?.profiles?.combat;
        const profileMarkIds = typeof profileId === "string" ? markIdsByProfile.get(profileId) : undefined;
        if (profileMarkIds !== undefined) {
          activeMarkIdsByMission.set(missionId, new Set(profileMarkIds));
        }
      }
    }
  };

  validateCombatMechanics();

  const validateReactionsMechanics = () => {
    type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;
    const inspect = (
      value: unknown,
      entityId: string,
      fieldPath: string,
      label: string
    ): Record<string, unknown> | undefined => {
      let prototype: object | null;
      let descriptors: DescriptorMap;
      try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
          ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
          : {};
      } catch {
        err("mechanics", entityId, fieldPath, `${label} could not be inspected safely.`);
        return undefined;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain object with own data fields.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("mechanics", entityId, fieldPath, `${label} contains unsupported symbol fields.`);
      }
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `${label} field "${key}" must be an enumerable own data field.`);
          continue;
        }
        Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
      }
      return result;
    };
    const inspectArray = (
      value: unknown,
      entityId: string,
      fieldPath: string,
      label: string,
      maximum: number
    ): unknown[] | undefined => {
      let prototype: object | null;
      let descriptors: DescriptorMap;
      try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
          ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
          : {};
      } catch {
        err("mechanics", entityId, fieldPath, `${label} array could not be inspected safely.`);
        return undefined;
      }
      if (!Array.isArray(value) || prototype !== Array.prototype) {
        err("mechanics", entityId, fieldPath, `${label} must be an array with own data fields.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("mechanics", entityId, fieldPath, `${label} array contains unsupported symbol fields.`);
      }
      const lengthDescriptor = descriptors.length;
      const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maximum) {
        err("mechanics", entityId, fieldPath, `${label} array exceeds the maximum limit ${maximum}.`);
        return undefined;
      }
      const detached = new Array<unknown>(length);
      let indexedFieldCount = 0;
      for (const key of Object.keys(descriptors)) {
        if (key === "length") continue;
        const descriptor = descriptors[key];
        const index = /^(0|[1-9][0-9]*)$/.test(key) ? Number(key) : -1;
        if (index < 0 || index >= length || String(index) !== key) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `${label} array contains unsupported non-index field "${key}".`);
          continue;
        }
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          err("mechanics", entityId, `${fieldPath}[${index}]`, `${label} array item must be an enumerable own data field.`);
          continue;
        }
        detached[index] = descriptor.value;
        indexedFieldCount += 1;
      }
      if (indexedFieldCount !== length) {
        err("mechanics", entityId, fieldPath, `${label} array must not contain holes or accessor items.`);
      }
      return detached;
    };
    const utf8ByteLength = (value: string): number => {
      let bytes = 0;
      for (const character of value) {
        const point = character.codePointAt(0)!;
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      }
      return bytes;
    };
    const requireBoundedAuthoredId = (
      value: string,
      entityId: string,
      fieldPath: string,
      label: string
    ): void => {
      if (value.length === 0 || utf8ByteLength(value) > REACTION_LIMITS.idTagUtf8Bytes) {
        err(
          "mechanics",
          entityId,
          fieldPath,
          `${label} must contain 1..${REACTION_LIMITS.idTagUtf8Bytes} UTF-8 bytes.`
        );
      }
    };
    const unknown = (value: Record<string, unknown>, allowed: readonly string[], entityId: string, path: string) => {
      for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) err("mechanics", entityId, `${path}.${key}`, `Unknown unsupported closed reactions field "${key}".`);
      }
    };
    const mechanics = inspect(content.mechanics, "reactions", "mechanics", "Mechanics catalog");
    const modules = mechanics && inspect(mechanics.modules, "reactions", "mechanics.modules", "Mechanics modules");
    const module = modules?.reactions === undefined
      ? undefined
      : inspect(modules.reactions, "reactions", "modules.reactions", "Reactions module");
    if (!module) return;
    unknown(module, ["schemaVersion", "enabled", "profiles"], "reactions", "modules.reactions");
    if (module.schemaVersion !== 1) {
      err("mechanics", "reactions", "modules.reactions.schemaVersion", "Reactions future or unsupported schema version; only version 1 is supported.");
    }
    if (typeof module.enabled !== "boolean") {
      err("mechanics", "reactions", "modules.reactions.enabled", "Reactions enabled must be boolean.");
    }
    const profiles = inspect(module.profiles, "reactions", "modules.reactions.profiles", "Reactions profiles");
    if (!profiles) return;
    const selectedByProfile = new Map<string, string[]>();
    for (const [missionId, mission] of Object.entries(content.missions)) {
      const profileId = mission.mechanics?.profiles?.reactions;
      if (typeof profileId !== "string") continue;
      const missions = selectedByProfile.get(profileId) ?? [];
      missions.push(missionId);
      selectedByProfile.set(profileId, missions);
      if (module.enabled === true && module.schemaVersion === 1 && !Object.prototype.hasOwnProperty.call(profiles, profileId)) {
        err("mission", missionId, "mechanics.profiles.reactions", `Mission selects missing reactions profile "${profileId}".`);
      }
      if (module.enabled === true && module.schemaVersion === 1) {
        const combatProfileId = mission.mechanics?.profiles?.combat;
        const combatModule = content.mechanics.modules.combat;
        if (
          typeof combatProfileId !== "string"
          || !combatModule
          || combatModule.enabled !== true
          || (combatModule.schemaVersion !== 2 && combatModule.schemaVersion !== 3)
          || !Object.prototype.hasOwnProperty.call(combatModule.profiles, combatProfileId)
        ) {
          err(
            "mission",
            missionId,
            "mechanics.profiles.reactions.dependency",
            "dependency_missing: active reactions require an active combat v2 or v3 profile."
          );
        }
      }
    }

    for (const profileId of Object.keys(profiles)) {
      const root = `modules.reactions.profiles.${profileId}`;
      const profile = inspect(profiles[profileId], profileId, root, `Reactions profile "${profileId}"`);
      if (!profile) continue;
      unknown(profile, ["exposures", "reactions"], profileId, root);
      if (!Object.prototype.hasOwnProperty.call(profile, "reactions")) {
        err("mechanics", profileId, `${root}.reactions`, "Reactions profile requires a reactions record.");
      }
      const active = module.enabled === true && module.schemaVersion === 1 && (selectedByProfile.get(profileId)?.length ?? 0) > 0;
      const semantic = (path: string, message: string) => (active ? err : warn)("mechanics", profileId, path, message);
      const combatModule = content.mechanics.modules.combat;
      const selectedCombatProfileIds = (selectedByProfile.get(profileId) ?? [])
        .map((missionId) => content.missions[missionId]?.mechanics?.profiles?.combat)
        .filter((value): value is string => typeof value === "string");
      const fallbackCombatProfileId = Object.prototype.hasOwnProperty.call(combatModule?.profiles ?? {}, profileId)
        ? profileId
        : Object.keys(combatModule?.profiles ?? {})[0];
      const damageTypes = new Set<string>();
      for (const combatProfileId of [...selectedCombatProfileIds, ...(fallbackCombatProfileId ? [fallbackCombatProfileId] : [])]) {
        const combatProfile = combatModule?.profiles[combatProfileId] as { damageTypes?: unknown } | undefined;
        const authored = combatProfile?.damageTypes;
        if (authored && typeof authored === "object" && !Array.isArray(authored)) Object.keys(authored).forEach((id) => damageTypes.add(id));
      }

      const exposureIds = new Set<string>();
      const exposureMaxStacks = new Map<string, number>();
      if (profile.exposures !== undefined) {
        const exposures = inspect(profile.exposures, profileId, `${root}.exposures`, "Reactions exposures");
        if (exposures) {
          unknown(exposures, ["definitions", "applications"], profileId, `${root}.exposures`);
          const definitions = exposures.definitions === undefined
            ? undefined
            : inspect(exposures.definitions, profileId, `${root}.exposures.definitions`, "Exposure definitions");
          if (definitions) {
            if (Object.keys(definitions).length > REACTION_LIMITS.exposureDefinitions) {
              err("mechanics", profileId, `${root}.exposures.definitions`, `Exposure definitions exceed maximum limit ${REACTION_LIMITS.exposureDefinitions}.`);
            }
            for (const exposureId of Object.keys(definitions)) {
              requireBoundedAuthoredId(
                exposureId,
                profileId,
                `${root}.exposures.definitions.${exposureId}`,
                "Exposure id"
              );
              exposureIds.add(exposureId);
              const path = `${root}.exposures.definitions.${exposureId}`;
              const definition = inspect(definitions[exposureId], profileId, path, `Exposure "${exposureId}"`);
              if (!definition) continue;
              unknown(definition, ["label", "duration", "maxStacks"], profileId, path);
              if (typeof definition.label !== "string" || definition.label.length === 0 || definition.label.length > REACTION_LIMITS.labelLength) {
                err("mechanics", profileId, `${path}.label`, "Exposure label is outside the supported range.");
              }
              if (typeof definition.duration !== "number" || !Number.isFinite(definition.duration) || definition.duration <= 0 || definition.duration > REACTION_LIMITS.duration) {
                err("mechanics", profileId, `${path}.duration`, "Exposure duration must be a positive number in the supported range.");
              }
              if (typeof definition.maxStacks !== "number" || !Number.isSafeInteger(definition.maxStacks) || definition.maxStacks <= 0 || definition.maxStacks > REACTION_LIMITS.maxStacks) {
                err("mechanics", profileId, `${path}.maxStacks`, "Exposure maxStacks must be a positive integer in the supported stack range.");
              } else exposureMaxStacks.set(exposureId, definition.maxStacks);
            }
          }
          if (exposures.applications !== undefined) {
            const applicationsPath = `${root}.exposures.applications`;
            const applications = inspect(exposures.applications, profileId, applicationsPath, "Exposure applications");
            if (applications) {
              unknown(applications, ["damageTypes"], profileId, applicationsPath);
              const bindingsPath = `${applicationsPath}.damageTypes`;
              const bindings = applications.damageTypes === undefined
                ? undefined
                : inspect(applications.damageTypes, profileId, bindingsPath, "Exposure damage type applications");
              if (bindings) {
                if (Object.keys(bindings).length > REACTION_LIMITS.damageTypeApplicationBindings) {
                  err(
                    "mechanics",
                    profileId,
                    bindingsPath,
                    `Exposure damage type applications exceed the maximum binding budget ${REACTION_LIMITS.damageTypeApplicationBindings}.`
                  );
                }
                for (const damageTypeId of Object.keys(bindings)) {
                  const bindingPath = `${bindingsPath}.${damageTypeId}`;
                  if (!damageTypes.has(damageTypeId)) {
                    semantic(bindingPath, `Exposure application references unknown damage type "${damageTypeId}"${active ? "." : " while inactive."}`);
                  }
                  const values = inspectArray(
                    bindings[damageTypeId],
                    profileId,
                    bindingPath,
                    "Exposure applications",
                    REACTION_LIMITS.applicationsPerDamageType
                  );
                  if (!values) continue;
                  for (let index = 0; index < values.length; index += 1) {
                    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
                    const applicationPath = `${bindingPath}[${index}]`;
                    const application = descriptor?.enumerable && "value" in descriptor
                      ? inspect(descriptor.value, profileId, applicationPath, "Exposure application")
                      : undefined;
                    if (!application) {
                      err("mechanics", profileId, applicationPath, "Exposure application must be an enumerable own data field.");
                      continue;
                    }
                    unknown(application, ["exposureId", "stacks"], profileId, applicationPath);
                    if (typeof application.exposureId !== "string" || !exposureIds.has(application.exposureId)) {
                      semantic(`${applicationPath}.exposureId`, `Exposure application references unknown exposure "${String(application.exposureId)}"${active ? "." : " while inactive."}`);
                    }
                    if (application.stacks !== undefined) {
                      const maximum = typeof application.exposureId === "string"
                        ? exposureMaxStacks.get(application.exposureId)
                        : undefined;
                      if (
                        typeof application.stacks !== "number"
                        || !Number.isSafeInteger(application.stacks)
                        || application.stacks <= 0
                        || (maximum !== undefined && application.stacks > maximum)
                      ) {
                        err("mechanics", profileId, `${applicationPath}.stacks`, "Exposure application stacks must be a positive integer within maxStacks.");
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      const reactions = profile.reactions === undefined
        ? undefined
        : inspect(profile.reactions, profileId, `${root}.reactions`, "Reaction definitions");
      if (!reactions) continue;
      if (Object.keys(reactions).length > REACTION_LIMITS.reactionDefinitions) {
        err("mechanics", profileId, `${root}.reactions`, `Reaction definitions exceed maximum budget limit ${REACTION_LIMITS.reactionDefinitions}.`);
      }
      let totalEffects = 0;
      for (const reactionId of Object.keys(reactions)) {
        const path = `${root}.reactions.${reactionId}`;
        requireBoundedAuthoredId(reactionId, profileId, path, "Reaction id");
        const reaction = inspect(reactions[reactionId], profileId, path, `Reaction "${reactionId}"`);
        if (!reaction) continue;
        unknown(reaction, ["label", "trigger", "requirements", "suppressTriggerExposureApplications", "effects"], profileId, path);
        if (
          reaction.suppressTriggerExposureApplications !== undefined
          && typeof reaction.suppressTriggerExposureApplications !== "boolean"
        ) {
          err(
            "mechanics",
            profileId,
            `${path}.suppressTriggerExposureApplications`,
            "Reaction suppressTriggerExposureApplications must be boolean."
          );
        }
        const trigger = inspect(reaction.trigger, profileId, `${path}.trigger`, "Reaction trigger");
        if (trigger) {
          unknown(trigger, ["damageTypes"], profileId, `${path}.trigger`);
          const triggerDamageTypes = inspectArray(
            trigger.damageTypes,
            profileId,
            `${path}.trigger.damageTypes`,
            "Reaction trigger damageTypes",
            256
          );
          if (!triggerDamageTypes || triggerDamageTypes.length === 0) {
            err("mechanics", profileId, `${path}.trigger.damageTypes`, "Reaction trigger damageTypes must be a non-empty unique array.");
          } else {
            const seen = new Set<string>();
            for (let index = 0; index < triggerDamageTypes.length; index += 1) {
              const damageType = triggerDamageTypes[index];
              if (typeof damageType !== "string") {
                err("mechanics", profileId, `${path}.trigger.damageTypes[${index}]`, "Reaction trigger damage type must be a string.");
              } else if (seen.has(damageType)) {
                err("mechanics", profileId, `${path}.trigger.damageTypes[${index}]`, `Reaction trigger damageTypes contains duplicate non-unique id "${damageType}".`);
              } else {
                seen.add(damageType);
                if (!damageTypes.has(damageType)) semantic(`${path}.trigger.damageTypes[${index}]`, `Reaction references unknown damage type "${damageType}"${active ? "." : " while inactive."}`);
              }
            }
          }
        }
        if (reaction.requirements !== undefined) {
          const requirements = inspectArray(
            reaction.requirements,
            profileId,
            `${path}.requirements`,
            "Reaction requirements",
            REACTION_LIMITS.requirementsPerReaction
          );
          if (requirements) {
            const seen = new Set<string>();
            for (let index = 0; index < requirements.length; index += 1) {
              const requirement = inspect(requirements[index], profileId, `${path}.requirements[${index}]`, "Reaction requirement");
              if (!requirement) continue;
              const requirementPath = `${path}.requirements[${index}]`;
              if (requirement.kind === "exposure") {
                unknown(requirement, ["kind", "exposureId", "minStacks", "consume"], profileId, requirementPath);
                if (typeof requirement.exposureId !== "string" || !exposureIds.has(requirement.exposureId)) {
                  semantic(`${requirementPath}.exposureId`, `Reaction references unknown exposure "${String(requirement.exposureId)}"${active ? "." : " while inactive."}`);
                }
                if (
                  requirement.minStacks !== undefined
                  && (
                    typeof requirement.minStacks !== "number"
                    || !Number.isSafeInteger(requirement.minStacks)
                    || requirement.minStacks <= 0
                    || (typeof requirement.exposureId === "string"
                      && exposureMaxStacks.has(requirement.exposureId)
                      && requirement.minStacks > exposureMaxStacks.get(requirement.exposureId)!)
                  )
                ) {
                  err("mechanics", profileId, `${requirementPath}.minStacks`, "Exposure requirement minStacks must be a positive integer within maxStacks.");
                }
                if (requirement.consume !== undefined && !["none", "one", "all"].includes(String(requirement.consume))) {
                  err("mechanics", profileId, `${requirementPath}.consume`, "Exposure requirement consume must be none, one, or all.");
                }
              } else if (requirement.kind === "status") {
                unknown(requirement, ["kind", "statusId", "consume"], profileId, requirementPath);
                if (requirement.statusId !== "poison" && requirement.statusId !== "slow" && requirement.statusId !== "stun") {
                  err("mechanics", profileId, `${requirementPath}.statusId`, "Status requirement statusId must be poison, slow, or stun.");
                }
                if (requirement.consume !== undefined && requirement.consume !== "none" && requirement.consume !== "clear") {
                  err("mechanics", profileId, `${requirementPath}.consume`, "Status requirement consume must be none or clear.");
                }
              } else if (requirement.kind === "terrain_tag") {
                unknown(requirement, ["kind", "tag"], profileId, requirementPath);
                if (typeof requirement.tag !== "string" || requirement.tag.length === 0) {
                  err("mechanics", profileId, `${requirementPath}.tag`, "Terrain requirement tag must be a non-empty string.");
                } else {
                  requireBoundedAuthoredId(requirement.tag, profileId, `${requirementPath}.tag`, "Terrain requirement tag");
                }
              } else {
                err("mechanics", profileId, `${requirementPath}.kind`, `Unsupported reaction requirement kind "${String(requirement.kind)}".`);
              }
              const key = requirement.kind === "exposure"
                ? `exposure:${String(requirement.exposureId)}`
                : requirement.kind === "status"
                  ? `status:${String(requirement.statusId)}`
                  : `terrain_tag:${String(requirement.tag)}`;
              if (seen.has(key)) err("mechanics", profileId, `${path}.requirements[${index}]`, `Reaction requirements duplicate ${key}.`);
              seen.add(key);
            }
          }
        }
        const effects = inspect(reaction.effects, profileId, `${path}.effects`, "Reaction effects");
        if (!effects) continue;
        totalEffects += Object.keys(effects).length;
        if (Object.keys(effects).length > REACTION_LIMITS.effectsPerReaction) {
          err("mechanics", profileId, `${path}.effects`, `Reaction effects exceed maximum ${REACTION_LIMITS.effectsPerReaction}.`);
        }
        for (const effectId of Object.keys(effects)) {
          const effectPath = `${path}.effects.${effectId}`;
          requireBoundedAuthoredId(effectId, profileId, effectPath, "Reaction effect id");
          const effect = inspect(effects[effectId], profileId, effectPath, "Reaction effect");
          if (!effect) continue;
          unknown(effect, ["kind", "amount", "damageType", "target", "allowReactions"], profileId, effectPath);
          if (effect.kind !== "damage") {
            err("mechanics", profileId, `${effectPath}.kind`, "Reaction effect kind must be damage.");
          }
          if (effect.allowReactions !== undefined && typeof effect.allowReactions !== "boolean") {
            err("mechanics", profileId, `${effectPath}.allowReactions`, "Reaction effect allowReactions must be boolean.");
          }
          if (typeof effect.damageType !== "string" || !damageTypes.has(effect.damageType)) {
            semantic(`${effectPath}.damageType`, `Reaction effect references unknown damage type "${String(effect.damageType)}"${active ? "." : " while inactive."}`);
          }
          const amount = inspect(effect.amount, profileId, `${effectPath}.amount`, "Reaction effect amount");
          if (amount?.kind === "flat") {
            unknown(amount, ["kind", "value"], profileId, `${effectPath}.amount`);
            if (typeof amount.value !== "number" || !Number.isFinite(amount.value) || amount.value <= 0 || amount.value > REACTION_LIMITS.flatDamage) {
              err("mechanics", profileId, `${effectPath}.amount.value`, "Reaction flat damage must be a positive finite number in range.");
            }
          } else if (amount?.kind === "source_after_modifiers") {
            unknown(amount, ["kind", "multiplier"], profileId, `${effectPath}.amount`);
            if (typeof amount.multiplier !== "number" || !Number.isFinite(amount.multiplier) || amount.multiplier <= 0 || amount.multiplier > REACTION_LIMITS.sourceMultiplier) {
              err("mechanics", profileId, `${effectPath}.amount.multiplier`, "Reaction source multiplier must be a positive finite number in range.");
            }
          } else if (amount) {
            err("mechanics", profileId, `${effectPath}.amount.kind`, `Unsupported reaction amount kind "${String(amount.kind)}".`);
          }
          const target = inspect(effect.target, profileId, `${effectPath}.target`, "Reaction effect target");
          if (target?.kind === "primary") {
            unknown(target, ["kind"], profileId, `${effectPath}.target`);
          } else if (target?.kind === "radius") {
            unknown(target, ["kind", "radius", "maxTargets"], profileId, `${effectPath}.target`);
            if (
              typeof target.radius !== "number"
              || !Number.isSafeInteger(target.radius)
              || target.radius <= 0
              || target.radius > REACTION_LIMITS.radius
            ) {
              err(
                "mechanics",
                profileId,
                `${effectPath}.target.radius`,
                `Reaction radius must be a positive integer in range 1..${REACTION_LIMITS.radius}.`
              );
            }
            if (typeof target.maxTargets !== "number" || !Number.isSafeInteger(target.maxTargets) || target.maxTargets <= 0 || target.maxTargets > REACTION_LIMITS.targetsPerEffect) {
              err("mechanics", profileId, `${effectPath}.target.maxTargets`, "Reaction maxTargets must be a positive integer in range.");
            }
          } else if (target?.kind === "terrain_tag") {
            unknown(target, ["kind", "tag", "maxTargets"], profileId, `${effectPath}.target`);
            if (typeof target.tag !== "string" || target.tag.length === 0) {
              err("mechanics", profileId, `${effectPath}.target.tag`, "Reaction terrain target tag must be non-empty.");
            } else {
              requireBoundedAuthoredId(target.tag, profileId, `${effectPath}.target.tag`, "Reaction terrain target tag");
            }
            if (typeof target.maxTargets !== "number" || !Number.isSafeInteger(target.maxTargets) || target.maxTargets <= 0 || target.maxTargets > REACTION_LIMITS.targetsPerEffect) {
              err("mechanics", profileId, `${effectPath}.target.maxTargets`, "Reaction maxTargets must be a positive integer in range.");
            }
          } else if (target) {
            err("mechanics", profileId, `${effectPath}.target.kind`, `Unsupported reaction target kind "${String(target.kind)}".`);
          }
        }
      }
      if (totalEffects > REACTION_LIMITS.totalReactionEffects) {
        err("mechanics", profileId, `${root}.reactions`, `Reaction effects exceed total maximum budget ${REACTION_LIMITS.totalReactionEffects}.`);
      }
    }
  };

  validateReactionsMechanics();

  const validateNavigationMechanics = () => {
    type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;
    const inspect = (
      value: unknown,
      entityId: string,
      fieldPath: string,
      label: string
    ): Record<string, unknown> | undefined => {
      let prototype: object | null;
      let descriptors: DescriptorMap;
      try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
          ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
          : {};
      } catch {
        err("mechanics", entityId, fieldPath, `${label} could not be inspected safely.`);
        return undefined;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain object with own data fields.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("mechanics", entityId, fieldPath, `${label} must not contain symbol fields.`);
      }
      const detached: Record<string, unknown> = {};
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          err(
            "mechanics",
            entityId,
            `${fieldPath}.${key}`,
            `${label}.${key} must be an enumerable own data field.`
          );
          continue;
        }
        Object.defineProperty(detached, key, {
          value: descriptor.value,
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      return detached;
    };
    const unknownFields = (
      value: Record<string, unknown>,
      allowed: readonly string[],
      entityId: string,
      fieldPath: string
    ) => {
      const allowedFields = new Set(allowed);
      for (const key of Object.keys(value)) {
        if (!allowedFields.has(key)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `Unknown closed navigation field "${key}".`);
        }
      }
    };
    const inspectDenseArray = (
      value: unknown,
      entityId: string,
      fieldPath: string,
      label: string
    ): readonly unknown[] | undefined => {
      let prototype: object | null;
      let descriptors: DescriptorMap;
      try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
          ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
          : {};
      } catch {
        err("map", entityId, fieldPath, `${label} could not be inspected safely.`);
        return undefined;
      }
      if (!Array.isArray(value) || prototype !== Array.prototype) {
        err("map", entityId, fieldPath, `${label} must be an ordinary dense array.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("map", entityId, fieldPath, `${label} must not contain symbol fields.`);
        return undefined;
      }
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) {
        err("map", entityId, fieldPath, `${label} has an invalid length.`);
        return undefined;
      }
      const length = lengthDescriptor.value as number;
      const values: unknown[] = [];
      for (const key of Object.keys(descriptors)) {
        if (key === "length") continue;
        const descriptor = descriptors[key];
        if (
          !/^(0|[1-9]\d*)$/.test(key)
          || Number(key) >= length
          || !descriptor
          || !descriptor.enumerable
          || !("value" in descriptor)
        ) {
          err("map", entityId, `${fieldPath}.${key}`, `${label} contains a sparse or non-data field.`);
          return undefined;
        }
        values[Number(key)] = descriptor.value;
      }
      if (Object.keys(descriptors).length !== length + 1 || values.length !== length) {
        err("map", entityId, fieldPath, `${label} must not be sparse.`);
        return undefined;
      }
      return values;
    };
    const utf8Bytes = (value: string): number => {
      let bytes = 0;
      for (const character of value) {
        const point = character.codePointAt(0)!;
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      }
      return bytes;
    };
    const selectedNavigationProfile = (mission: unknown): string | undefined => {
      const missionRecord = inspect(mission, "navigation", "missions", "Mission");
      if (!missionRecord || missionRecord.mechanics === undefined) return undefined;
      const mechanics = inspect(missionRecord.mechanics, "navigation", "mission.mechanics", "Mission mechanics");
      if (!mechanics || mechanics.profiles === undefined) return undefined;
      const profiles = inspect(mechanics.profiles, "navigation", "mission.mechanics.profiles", "Mission mechanics profiles");
      if (!profiles) return undefined;
      return typeof profiles.navigation === "string" ? profiles.navigation : undefined;
    };
    const validateActiveMissionBudgets = (
      profile: DynamicFlowNavigationProfileV1,
      profileId: string,
      missionId: string
    ): void => {
      const mission = Object.prototype.hasOwnProperty.call(content.missions, missionId)
        ? content.missions[missionId]
        : undefined;
      if (!mission || typeof mission.mapId !== "string") return;
      const mapId = mission.mapId;
      const authoredMap = Object.prototype.hasOwnProperty.call(content.maps, mapId)
        ? content.maps[mapId]
        : undefined;
      const map = inspect(authoredMap, missionId, `maps.${mapId}`, "Active dynamic navigation map");
      if (!map) return;

      const width = map.width;
      const height = map.height;
      let cellCount: number | undefined;
      if (Number.isSafeInteger(width) && (width as number) > 0 && Number.isSafeInteger(height) && (height as number) > 0) {
        const product = (width as number) * (height as number);
        if (Number.isSafeInteger(product)) cellCount = product;
      }
      if (cellCount !== undefined && cellCount > NAVIGATION_LIMITS.activeMapCells) {
        err(
          "mission",
          missionId,
          `maps.${mapId}.navigation.cells`,
          `Active dynamic navigation map dimensions contain ${cellCount} cells, exceeding the `
          + `${NAVIGATION_LIMITS.activeMapCells} cell budget.`
        );
      }

      let routes: readonly unknown[] | undefined;
      if (map.pathRoutes !== undefined) {
        const authoredRoutes = inspectDenseArray(
          map.pathRoutes,
          mapId,
          `maps.${mapId}.pathRoutes`,
          "Active dynamic navigation pathRoutes"
        );
        if (!authoredRoutes) return;
        if (authoredRoutes.length > 0) routes = authoredRoutes;
      }
      if (routes === undefined) {
        routes = [{ id: "main", pathCenterline: map.pathCenterline }];
      }

      if (routes.length > NAVIGATION_LIMITS.routeEndpointPairs) {
        err(
          "mission",
          missionId,
          `maps.${mapId}.pathRoutes`,
          `Active dynamic navigation endpoint routes exceed the `
          + `${NAVIGATION_LIMITS.routeEndpointPairs} route endpoint-pair budget.`
        );
      }

      const uniqueGoals = new Set<string>();
      for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
        const routePath = `maps.${mapId}.pathRoutes[${routeIndex}]`;
        const route = inspect(routes[routeIndex], mapId, routePath, "Active dynamic navigation route");
        if (!route) continue;
        const centerline = inspectDenseArray(
          route.pathCenterline,
          mapId,
          `${routePath}.pathCenterline`,
          "Active dynamic navigation route centerline"
        );
        if (!centerline || centerline.length === 0) continue;
        const endpoint = inspect(
          centerline[centerline.length - 1],
          mapId,
          `${routePath}.pathCenterline[${centerline.length - 1}]`,
          "Active dynamic navigation goal coordinate"
        );
        if (!endpoint || !Number.isSafeInteger(endpoint.q) || !Number.isSafeInteger(endpoint.r)) continue;
        uniqueGoals.add(`${endpoint.q as number},${endpoint.r as number}`);
      }
      if (uniqueGoals.size > NAVIGATION_LIMITS.uniqueGoals) {
        err(
          "mission",
          missionId,
          `maps.${mapId}.pathRoutes.goals`,
          `Active dynamic navigation goals exceed the ${NAVIGATION_LIMITS.uniqueGoals} unique-goal budget.`
        );
      }

      const movementProfileCount = Object.keys(profile.movementProfiles).length;
      const profileGoalPairs = movementProfileCount * uniqueGoals.size;
      const pairPath = `modules.navigation.profiles.${profileId}.movementProfiles`;
      if (!Number.isSafeInteger(profileGoalPairs) || profileGoalPairs > NAVIGATION_LIMITS.cachedProfileGoalPairs) {
        err(
          "mission",
          missionId,
          pairPath,
          `Active dynamic navigation profile-goal field pair product ${profileGoalPairs} exceeds the `
          + `${NAVIGATION_LIMITS.cachedProfileGoalPairs} cached-pair budget for map "${mapId}".`
        );
      }
      if (cellCount !== undefined) {
        const materializedCells = cellCount * profileGoalPairs;
        if (
          !Number.isSafeInteger(materializedCells)
          || materializedCells > NAVIGATION_LIMITS.materializedFieldCells
        ) {
          err(
            "mission",
            missionId,
            `maps.${mapId}.navigation.materializedFieldCells`,
            `Active dynamic navigation fields materialize ${materializedCells} cells, exceeding the `
            + `${NAVIGATION_LIMITS.materializedFieldCells} field-cell budget.`
          );
        }
      }
    };
    const validateActiveTerrainBudgets = (profileId: string): void => {
      const root = `modules.navigation.profiles.${profileId}.terrainTypes`;
      const terrainTypes = inspect(
        content.terrainTypes,
        profileId,
        root,
        "Active dynamic navigation terrain types"
      );
      if (!terrainTypes) return;
      const terrainIds = Object.keys(terrainTypes);
      if (terrainIds.length > NAVIGATION_LIMITS.terrainDefinitions) {
        err(
          "mechanics",
          profileId,
          root,
          `Active dynamic navigation terrain definitions exceed the `
          + `${NAVIGATION_LIMITS.terrainDefinitions} definition budget.`
        );
      }

      let totalTags = 0;
      for (const terrainId of terrainIds.sort()) {
        const definitionPath = `${root}.${terrainId}`;
        if (terrainId.length === 0 || utf8Bytes(terrainId) > NAVIGATION_LIMITS.idUtf8Bytes) {
          err(
            "mechanics",
            profileId,
            `${definitionPath}.id`,
            `Active dynamic navigation terrain id must contain `
            + `1..${NAVIGATION_LIMITS.idUtf8Bytes} UTF-8 bytes.`
          );
        }
        const definition = inspect(
          terrainTypes[terrainId],
          profileId,
          definitionPath,
          "Active dynamic navigation terrain definition"
        );
        if (!definition) continue;
        if (
          typeof definition.label === "string"
          && definition.label.length > NAVIGATION_LIMITS.labelLength
        ) {
          err(
            "mechanics",
            profileId,
            `${definitionPath}.label`,
            `Active dynamic navigation terrain label exceeds the `
            + `${NAVIGATION_LIMITS.labelLength} character budget.`
          );
        }
        const tags = inspectDenseArray(
          definition.tags,
          profileId,
          `${definitionPath}.tags`,
          "Active dynamic navigation terrain tags"
        );
        if (!tags) continue;
        if (tags.length > NAVIGATION_LIMITS.terrainTagsPerDefinition) {
          err(
            "mechanics",
            profileId,
            `${definitionPath}.tags`,
            `Active dynamic navigation terrain tags exceed the `
            + `${NAVIGATION_LIMITS.terrainTagsPerDefinition} tag-per-definition budget.`
          );
        }
        totalTags += tags.length;
        for (let index = 0; index < tags.length; index += 1) {
          const tag = tags[index];
          if (typeof tag === "string" && utf8Bytes(tag) > NAVIGATION_LIMITS.terrainTagUtf8Bytes) {
            err(
              "mechanics",
              profileId,
              `${definitionPath}.tags[${index}]`,
              `Active dynamic navigation terrain tag exceeds the `
              + `${NAVIGATION_LIMITS.terrainTagUtf8Bytes} UTF-8 byte budget.`
            );
          }
        }
      }
      if (totalTags > NAVIGATION_LIMITS.terrainTagsAcrossDefinitions) {
        err(
          "mechanics",
          profileId,
          root,
          `Active dynamic navigation terrain tags exceed the `
          + `${NAVIGATION_LIMITS.terrainTagsAcrossDefinitions} total-tag budget.`
        );
      }
    };

    const catalog = inspect(content.mechanics, "navigation", "mechanics", "Mechanics catalog");
    if (!catalog) return;
    const modules = inspect(catalog.modules, "navigation", "mechanics.modules", "Mechanics modules");
    if (!modules) return;
    const missionSelections = new Map<string, string>();
    for (const [missionId, mission] of Object.entries(content.missions)) {
      const selected = selectedNavigationProfile(mission);
      if (selected !== undefined) missionSelections.set(missionId, selected);
    }
    if (modules.navigation === undefined) {
      for (const [missionId, profileId] of missionSelections) {
        warn(
          "mission",
          missionId,
          "mechanics.profiles.navigation",
          `Mission selects navigation profile "${profileId}" from a missing inactive module.`
        );
      }
      return;
    }
    const module = inspect(
      modules.navigation,
      "navigation",
      "modules.navigation",
      "Navigation mechanics module"
    );
    if (!module) return;
    unknownFields(module, ["schemaVersion", "enabled", "profiles"], "navigation", "modules.navigation");
    if (module.schemaVersion !== 1) {
      err(
        "mechanics",
        "navigation",
        "modules.navigation.schemaVersion",
        "Navigation future or unsupported schemaVersion; only version 1 is supported."
      );
    }
    if (typeof module.enabled !== "boolean") {
      err(
        "mechanics",
        "navigation",
        "modules.navigation.enabled",
        "Navigation mechanics enabled must be boolean."
      );
    }
    const profiles = inspect(
      module.profiles,
      "navigation",
      "modules.navigation.profiles",
      "Navigation mechanics profiles"
    );
    if (!profiles) return;
    const profileIds = Object.keys(profiles);
    if (profileIds.length > NAVIGATION_LIMITS.movementProfiles) {
      err(
        "mechanics",
        "navigation",
        "modules.navigation.profiles",
        `Navigation profiles exceed the maximum limit ${NAVIGATION_LIMITS.movementProfiles}.`
      );
    }

    const selectedProfileIds = new Set<string>();
    const activeMissionIdsByProfile = new Map<string, string[]>();
    for (const [missionId, selected] of missionSelections) {
      if (!Object.prototype.hasOwnProperty.call(profiles, selected)) {
        const report = module.enabled === true && module.schemaVersion === 1 ? err : warn;
        report(
          "mission",
          missionId,
          "mechanics.profiles.navigation",
          `Mission selects missing navigation profile "${selected}"${report === warn ? " from an inactive module" : ""}.`
        );
      }
      if (module.enabled === true && module.schemaVersion === 1) {
        selectedProfileIds.add(selected);
        const missionIds = activeMissionIdsByProfile.get(selected) ?? [];
        missionIds.push(missionId);
        activeMissionIdsByProfile.set(selected, missionIds);
      }
    }

    for (const profileId of profileIds.sort()) {
      const root = `modules.navigation.profiles.${profileId}`;
      if (profileId.length === 0 || utf8Bytes(profileId) > NAVIGATION_LIMITS.idUtf8Bytes) {
        err(
          "mechanics",
          profileId,
          root,
          `Navigation profile id must contain 1..${NAVIGATION_LIMITS.idUtf8Bytes} UTF-8 bytes.`
        );
      }
      let profile;
      try {
        profile = normalizeNavigationProfileV1(profiles[profileId]);
      } catch (error) {
        const relativePath = error instanceof NavigationProfileValidationError
          ? error.fieldPath.replace(/^profile(?=\.|$)/, "")
          : "";
        const message = error instanceof Error
          ? error.message
          : "Navigation profile could not be inspected safely.";
        err("mechanics", profileId, `${root}${relativePath}`, message);
        continue;
      }
      if (profile.mode !== "dynamic_flow") continue;
      const active = selectedProfileIds.has(profileId);
      const semantic = (fieldPath: string, message: string) => {
        (active ? err : warn)("mechanics", profileId, fieldPath, message);
      };
      validateNavigationReferences(profile, root, content, semantic);
      if (active) {
        validateActiveTerrainBudgets(profileId);
        for (const missionId of activeMissionIdsByProfile.get(profileId) ?? []) {
          validateActiveMissionBudgets(profile, profileId, missionId);
        }
      }
    }
  };

  validateNavigationMechanics();

  const validateElevationMechanics = () => {
    type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;
    const inspect = (
      value: unknown,
      entityId: string,
      fieldPath: string,
      label: string
    ): Record<string, unknown> | undefined => {
      let prototype: object | null;
      let descriptors: DescriptorMap;
      try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
          ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
          : {};
      } catch {
        err("mechanics", entityId, fieldPath, `${label} could not be inspected safely.`);
        return undefined;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain object with own data fields.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("mechanics", entityId, fieldPath, `${label} must not contain symbol fields.`);
      }
      const detached: Record<string, unknown> = {};
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `${label}.${key} must be an enumerable own data field.`);
          continue;
        }
        Object.defineProperty(detached, key, {
          value: descriptor.value,
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      return detached;
    };
    const unknownFields = (
      value: Record<string, unknown>,
      allowed: readonly string[],
      entityId: string,
      fieldPath: string
    ): void => {
      for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `Unknown closed elevation field "${key}".`);
        }
      }
    };

    const catalog = inspect(content.mechanics, "elevation", "mechanics", "Mechanics catalog");
    if (!catalog) return;
    const modules = inspect(catalog.modules, "elevation", "mechanics.modules", "Mechanics modules");
    if (!modules) return;
    const missionSelections = new Map<string, string>();
    for (const [missionId, mission] of Object.entries(content.missions)) {
      const selected = mission.mechanics?.profiles?.elevation;
      if (typeof selected === "string") missionSelections.set(missionId, selected);
    }
    if (modules.elevation === undefined) {
      for (const [missionId, profileId] of missionSelections) {
        warn(
          "mission",
          missionId,
          "mechanics.profiles.elevation",
          `Mission selects elevation profile "${profileId}" from a missing inactive module.`
        );
      }
      return;
    }
    const module = inspect(
      modules.elevation,
      "elevation",
      "modules.elevation",
      "Elevation mechanics module"
    );
    if (!module) return;
    unknownFields(module, ["schemaVersion", "enabled", "profiles"], "elevation", "modules.elevation");
    if (module.schemaVersion !== 1 && module.schemaVersion !== 2 && module.schemaVersion !== 3) {
      err(
        "mechanics",
        "elevation",
        "modules.elevation.schemaVersion",
        "Elevation future or unsupported schemaVersion; only versions 1, 2, and 3 are supported."
      );
    }
    if (typeof module.enabled !== "boolean") {
      err("mechanics", "elevation", "modules.elevation.enabled", "Elevation mechanics enabled must be boolean.");
    }
    const profiles = inspect(
      module.profiles,
      "elevation",
      "modules.elevation.profiles",
      "Elevation mechanics profiles"
    );
    if (!profiles) return;
    for (const [missionId, profileId] of missionSelections) {
      if (!Object.prototype.hasOwnProperty.call(profiles, profileId)) {
        const report = module.enabled === true
          && (module.schemaVersion === 1 || module.schemaVersion === 2 || module.schemaVersion === 3)
          ? err
          : warn;
        report(
          "mission",
          missionId,
          "mechanics.profiles.elevation",
          `Mission selects missing elevation profile "${profileId}"${report === warn ? " from an inactive module" : ""}.`
        );
      }
    }
    for (const profileId of Object.keys(profiles).sort()) {
      const root = `modules.elevation.profiles.${profileId}`;
      const profile = inspect(profiles[profileId], profileId, root, `Elevation profile "${profileId}"`);
      if (!profile) continue;
      if (module.schemaVersion === 1) {
        unknownFields(profile, [], profileId, root);
        continue;
      }
      if (module.schemaVersion !== 2 && module.schemaVersion !== 3) continue;
      unknownFields(
        profile,
        module.schemaVersion === 3 ? ["lineOfSight", "highGround"] : ["lineOfSight"],
        profileId,
        root
      );
      if (module.schemaVersion === 3 && Object.prototype.hasOwnProperty.call(profile, "highGround")) {
        const highGroundPath = `${root}.highGround`;
        const highGround = inspect(
          profile.highGround,
          profileId,
          highGroundPath,
          `Elevation profile "${profileId}" highGround`
        );
        if (highGround) {
          const fields = [
            "maximumEffectiveElevationDelta",
            "rangeBonusPerElevation",
            "damageBonusBasisPointsPerElevation"
          ] as const;
          unknownFields(highGround, fields, profileId, highGroundPath);
          const values = Object.fromEntries(fields.map((field) => [field, highGround[field]])) as Record<typeof fields[number], unknown>;
          for (const field of fields) {
            if (!Object.prototype.hasOwnProperty.call(highGround, field)) {
              err("mechanics", profileId, `${highGroundPath}.${field}`, `highGround.${field} is required.`);
            }
          }
          const maximumDelta = values.maximumEffectiveElevationDelta;
          const rangeBonus = values.rangeBonusPerElevation;
          const damageBonus = values.damageBonusBasisPointsPerElevation;
          const maximumDeltaValid = Number.isSafeInteger(maximumDelta)
            && (maximumDelta as number) >= 1
            && (maximumDelta as number) <= HIGH_GROUND_LIMITS.maximumEffectiveElevationDelta;
          const rangeBonusValid = Number.isSafeInteger(rangeBonus)
            && (rangeBonus as number) >= 0
            && (rangeBonus as number) <= HIGH_GROUND_LIMITS.rangeBonusPerElevation;
          const damageBonusValid = Number.isSafeInteger(damageBonus)
            && (damageBonus as number) >= 0
            && (damageBonus as number) <= HIGH_GROUND_LIMITS.damageBonusBasisPointsPerElevation;
          if (Object.prototype.hasOwnProperty.call(highGround, fields[0]) && !maximumDeltaValid) {
            err("mechanics", profileId, `${highGroundPath}.${fields[0]}`, `highGround.${fields[0]} must be a safe integer from 1 through ${HIGH_GROUND_LIMITS.maximumEffectiveElevationDelta}.`);
          }
          if (Object.prototype.hasOwnProperty.call(highGround, fields[1]) && !rangeBonusValid) {
            err("mechanics", profileId, `${highGroundPath}.${fields[1]}`, `highGround.${fields[1]} must be a safe integer from 0 through ${HIGH_GROUND_LIMITS.rangeBonusPerElevation}.`);
          }
          if (Object.prototype.hasOwnProperty.call(highGround, fields[2]) && !damageBonusValid) {
            err("mechanics", profileId, `${highGroundPath}.${fields[2]}`, `highGround.${fields[2]} must be a safe integer from 0 through ${HIGH_GROUND_LIMITS.damageBonusBasisPointsPerElevation}.`);
          }
          if (maximumDeltaValid && rangeBonusValid && damageBonusValid) {
            const maximum = maximumDelta as number;
            const range = rangeBonus as number;
            const damage = damageBonus as number;
            if (range === 0 && damage === 0) {
              err("mechanics", profileId, highGroundPath, "highGround must configure at least one positive range or damage bonus.");
            }
            if (maximum * range > HIGH_GROUND_LIMITS.totalRangeBonus) {
              err("mechanics", profileId, highGroundPath, `highGround total range bonus exceeds ${HIGH_GROUND_LIMITS.totalRangeBonus}.`);
            }
            if (maximum * damage > HIGH_GROUND_LIMITS.totalDamageBonusBasisPoints) {
              err("mechanics", profileId, highGroundPath, `highGround total damage bonus exceeds ${HIGH_GROUND_LIMITS.totalDamageBonusBasisPoints} basis points.`);
            }
          }
        }
      }
      if (!Object.prototype.hasOwnProperty.call(profile, "lineOfSight")) continue;
      const lineOfSight = inspect(
        profile.lineOfSight,
        profileId,
        `${root}.lineOfSight`,
        `Elevation profile "${profileId}" lineOfSight`
      );
      if (!lineOfSight) continue;
      unknownFields(lineOfSight, ["terrainBlockerTags"], profileId, `${root}.lineOfSight`);
      if (!Object.prototype.hasOwnProperty.call(lineOfSight, "terrainBlockerTags")) {
        err(
          "mechanics",
          profileId,
          `${root}.lineOfSight.terrainBlockerTags`,
          "lineOfSight.terrainBlockerTags is required."
        );
        continue;
      }
      const rawTags = lineOfSight.terrainBlockerTags;
      let tagDescriptors: Record<PropertyKey, PropertyDescriptor>;
      let ordinaryArray = false;
      try {
        ordinaryArray = Array.isArray(rawTags) && Object.getPrototypeOf(rawTags) === Array.prototype;
        tagDescriptors = Object.getOwnPropertyDescriptors(rawTags) as unknown as Record<PropertyKey, PropertyDescriptor>;
      } catch {
        err(
          "mechanics",
          profileId,
          `${root}.lineOfSight.terrainBlockerTags`,
          "terrainBlockerTags could not be inspected safely."
        );
        continue;
      }
      if (!ordinaryArray) {
        err(
          "mechanics",
          profileId,
          `${root}.lineOfSight.terrainBlockerTags`,
          "terrainBlockerTags must be an ordinary dense array of unique strings."
        );
        continue;
      }
      const lengthValue = tagDescriptors.length?.value;
      if (!Number.isSafeInteger(lengthValue) || (lengthValue as number) < 0) {
        err(
          "mechanics",
          profileId,
          `${root}.lineOfSight.terrainBlockerTags`,
          "terrainBlockerTags must expose a safe array length."
        );
        continue;
      }
      const tagCount = lengthValue as number;
      if (tagCount > LINE_OF_SIGHT_LIMITS.terrainBlockerTags) {
        err(
          "mechanics",
          profileId,
          `${root}.lineOfSight.terrainBlockerTags`,
          `terrainBlockerTags exceed the ${LINE_OF_SIGHT_LIMITS.terrainBlockerTags} tag budget.`
        );
        continue;
      }
      const hasExtraTagFields = Reflect.ownKeys(tagDescriptors).some((key) => {
        if (key === "length") return false;
        if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)) return true;
        const index = Number(key);
        return !Number.isSafeInteger(index) || index >= tagCount;
      });
      if (hasExtraTagFields) {
        err(
          "mechanics",
          profileId,
          `${root}.lineOfSight.terrainBlockerTags`,
          "terrainBlockerTags must not contain extra string or symbol fields."
        );
        continue;
      }
      const utf8Bytes = (value: string): number => {
        let bytes = 0;
        for (let index = 0; index < value.length; index += 1) {
          const code = value.charCodeAt(index);
          if (code <= 0x7f) bytes += 1;
          else if (code <= 0x7ff) bytes += 2;
          else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
            const next = value.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index += 1; }
            else bytes += 3;
          } else bytes += 3;
        }
        return bytes;
      };
      const tags: string[] = [];
      const seenTags = new Set<string>();
      for (let index = 0; index < tagCount; index += 1) {
        const descriptor = tagDescriptors[String(index)];
        const fieldPath = `${root}.lineOfSight.terrainBlockerTags[${index}]`;
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          err("mechanics", profileId, fieldPath, "terrainBlockerTags must be dense own data items; accessors are not allowed.");
          continue;
        }
        const tag = descriptor.value;
        if (typeof tag !== "string" || tag.length === 0
          || utf8Bytes(tag) > LINE_OF_SIGHT_LIMITS.terrainTagUtf8Bytes) {
          err(
            "mechanics",
            profileId,
            fieldPath,
            `Terrain blocker tag must contain 1..${LINE_OF_SIGHT_LIMITS.terrainTagUtf8Bytes} UTF-8 bytes.`
          );
          continue;
        }
        if (seenTags.has(tag)) {
          err("mechanics", profileId, fieldPath, `Duplicate terrain blocker tag "${tag}".`);
          continue;
        }
        seenTags.add(tag);
        tags.push(tag);
      }

      const authoredTerrainTags = new Set<string>();
      for (const terrain of Object.values(content.terrainTypes)) {
        for (const tag of terrain.tags) authoredTerrainTags.add(tag);
      }
      const selectedByActiveMission = module.enabled === true
        && [...missionSelections.values()].some((selectedProfileId) => selectedProfileId === profileId);
      const reportUnknown = selectedByActiveMission ? err : warn;
      for (const tag of tags) {
        if (!authoredTerrainTags.has(tag)) {
          reportUnknown(
            "mechanics",
            profileId,
            `${root}.lineOfSight.terrainBlockerTags`,
            `Terrain blocker tag "${tag}" is unknown to authored terrain definitions${selectedByActiveMission ? "" : " in this inactive profile"}.`
          );
        }
      }
    }

    const activeLineOfSightMissionIds = module.enabled === true
      && (module.schemaVersion === 2 || module.schemaVersion === 3)
      ? [...missionSelections.entries()]
        .filter(([, profileId]) => {
          const profile = profiles[profileId];
          return profile !== null && typeof profile === "object"
            && Object.prototype.hasOwnProperty.call(profile, "lineOfSight");
        })
        .map(([missionId]) => missionId)
      : [];
    if (activeLineOfSightMissionIds.length === 0) return;

    const terrainIds = Object.keys(content.terrainTypes);
    if (terrainIds.length > LINE_OF_SIGHT_LIMITS.terrainDefinitions) {
      err(
        "mechanics",
        "elevation",
        "terrainTypes",
        `Active line-of-sight terrain definitions exceed the ${LINE_OF_SIGHT_LIMITS.terrainDefinitions} definition budget.`
      );
    }
    let totalTerrainTags = 0;
    for (const terrainId of terrainIds) {
      const tags = content.terrainTypes[terrainId]?.tags ?? [];
      totalTerrainTags += tags.length;
      if (tags.length > LINE_OF_SIGHT_LIMITS.terrainTagsPerDefinition) {
        err(
          "terrain",
          terrainId,
          "tags",
          `Active line-of-sight terrain tags exceed the ${LINE_OF_SIGHT_LIMITS.terrainTagsPerDefinition} tag-per-definition budget.`
        );
      }
    }
    if (totalTerrainTags > LINE_OF_SIGHT_LIMITS.terrainTagsAcrossDefinitions) {
      err(
        "mechanics",
        "elevation",
        "terrainTypes.tags",
        `Active line-of-sight terrain tags exceed the ${LINE_OF_SIGHT_LIMITS.terrainTagsAcrossDefinitions} aggregate tag budget.`
      );
    }
    for (const missionId of activeLineOfSightMissionIds) {
      const mission = content.missions[missionId];
      const map = mission ? content.maps[mission.mapId] : undefined;
      if (map && map.width * map.height > LINE_OF_SIGHT_LIMITS.activeMapCells) {
        err(
          "map",
          map.id,
          "dimensions",
          `Active line-of-sight map cell count exceeds the ${LINE_OF_SIGHT_LIMITS.activeMapCells} cell budget.`
        );
      }
    }
  };

  validateElevationMechanics();

  const validatePhysicsMechanics = () => {
    type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;
    const inspect = (
      value: unknown,
      entityId: string,
      fieldPath: string,
      label: string
    ): Record<string, unknown> | undefined => {
      let prototype: object | null;
      let descriptors: DescriptorMap;
      try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
          ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
          : {};
      } catch {
        err("mechanics", entityId, fieldPath, `${label} could not be inspected safely.`);
        return undefined;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain object with own data fields.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("mechanics", entityId, fieldPath, `${label} must not contain symbol fields.`);
      }
      const detached: Record<string, unknown> = {};
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `${label}.${key} must be an enumerable own data field; accessors are not allowed.`);
          continue;
        }
        Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
      }
      return detached;
    };
    const unknownFields = (
      value: Record<string, unknown>,
      allowed: readonly string[],
      entityId: string,
      fieldPath: string
    ): void => {
      for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `Unknown unsupported closed physics field "${key}".`);
        }
      }
    };
    const utf8Bytes = (value: string): number => {
      let bytes = 0;
      for (const character of value) {
        const point = character.codePointAt(0)!;
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      }
      return bytes;
    };
    const inspectStringArray = (
      value: unknown,
      maximum: number,
      entityId: string,
      fieldPath: string,
      label: string
    ): string[] | undefined => {
      let prototype: object | null;
      let descriptors: DescriptorMap;
      try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
          ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
          : {};
      } catch {
        err("mechanics", entityId, fieldPath, `${label} could not be inspected safely.`);
        return undefined;
      }
      if (!Array.isArray(value) || prototype !== Array.prototype) {
        err("mechanics", entityId, fieldPath, `${label} must be an ordinary dense array.`);
        return undefined;
      }
      const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : undefined;
      if (!Number.isSafeInteger(length) || length < 0) {
        err("mechanics", entityId, fieldPath, `${label} must expose a safe array length.`);
        return undefined;
      }
      if (length > maximum) {
        err("mechanics", entityId, fieldPath, `${label} exceeds the maximum limit of ${maximum} items.`);
        return undefined;
      }
      const extra = Reflect.ownKeys(descriptors).some((key) => {
        if (key === "length") return false;
        return typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length;
      });
      if (extra) {
        err("mechanics", entityId, fieldPath, `${label} must be a dense own-data array without extra fields.`);
        return undefined;
      }
      const result: string[] = [];
      const seen = new Set<string>();
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        const itemPath = `${fieldPath}[${index}]`;
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          err("mechanics", entityId, itemPath, `${label} must be dense own data; sparse entries or accessors are not allowed.`);
          continue;
        }
        const item = descriptor.value;
        if (typeof item !== "string" || item.length === 0) {
          err("mechanics", entityId, itemPath, `${label} entries must be non-empty strings.`);
          continue;
        }
        if (utf8Bytes(item) > PHYSICS_LIMITS.idOrTagUtf8Bytes) {
          err("mechanics", entityId, itemPath, `${label} entries must contain at most ${PHYSICS_LIMITS.idOrTagUtf8Bytes} UTF-8 bytes.`);
          continue;
        }
        if (seen.has(item)) {
          err("mechanics", entityId, itemPath, `${label} contains duplicate value "${item}".`);
          continue;
        }
        seen.add(item);
        result.push(item);
      }
      return result;
    };

    const catalog = inspect(content.mechanics, "physics", "mechanics", "Mechanics catalog");
    if (!catalog) return;
    const modules = inspect(catalog.modules, "physics", "mechanics.modules", "Mechanics modules");
    if (!modules) return;
    const selections = new Map<string, string>();
    for (const [missionId, mission] of Object.entries(content.missions)) {
      const selected = mission.mechanics?.profiles?.physics;
      if (typeof selected === "string") selections.set(missionId, selected);
    }
    if (modules.physics === undefined) {
      for (const [missionId, profileId] of selections) {
        warn("mission", missionId, "mechanics.profiles.physics", `Mission selects physics profile "${profileId}" from a missing inactive module.`);
      }
      return;
    }
    const module = inspect(modules.physics, "physics", "modules.physics", "Physics mechanics module");
    if (!module) return;
    unknownFields(module, ["schemaVersion", "enabled", "profiles"], "physics", "modules.physics");
    if (module.schemaVersion !== 1) {
      err("mechanics", "physics", "modules.physics.schemaVersion", "Physics future or unsupported schemaVersion; only version 1 is supported.");
    }
    if (typeof module.enabled !== "boolean") {
      err("mechanics", "physics", "modules.physics.enabled", "Physics mechanics enabled must be boolean.");
    }
    const profiles = inspect(module.profiles, "physics", "modules.physics.profiles", "Physics mechanics profiles");
    if (!profiles) return;
    for (const [missionId, profileId] of selections) {
      if (Object.prototype.hasOwnProperty.call(profiles, profileId)) continue;
      const active = module.enabled === true && module.schemaVersion === 1;
      (active ? err : warn)(
        "mission",
        missionId,
        "mechanics.profiles.physics",
        `Mission selects missing physics profile "${profileId}"${active ? "" : " from an inactive module"}.`
      );
    }
    for (const profileId of Object.keys(profiles).sort()) {
      const root = `modules.physics.profiles.${profileId}`;
      const profile = inspect(profiles[profileId], profileId, root, `Physics profile "${profileId}"`);
      if (!profile) continue;
      unknownFields(profile, [
        "displacementImmuneEnemyTypeIds",
        "fallImmuneEnemyTypeIds",
        "fallHazardTerrainTags"
      ], profileId, root);
      const active = module.enabled === true
        && module.schemaVersion === 1
        && [...selections.values()].includes(profileId);
      for (const field of ["displacementImmuneEnemyTypeIds", "fallImmuneEnemyTypeIds"] as const) {
        if (!Object.prototype.hasOwnProperty.call(profile, field)) continue;
        const values = inspectStringArray(
          profile[field],
          PHYSICS_LIMITS.immuneEnemyTypeIds,
          profileId,
          `${root}.${field}`,
          `Physics ${field}`
        );
        for (const enemyId of values ?? []) {
          if (enemyIds.has(enemyId)) continue;
          (active ? err : warn)(
            "mechanics",
            profileId,
            `${root}.${field}`,
            `Physics ${field} references unknown enemy "${enemyId}"${active ? "" : " in this inactive profile"}.`
          );
        }
      }
      if (Object.prototype.hasOwnProperty.call(profile, "fallHazardTerrainTags")) {
        inspectStringArray(
          profile.fallHazardTerrainTags,
          PHYSICS_LIMITS.fallHazardTerrainTags,
          profileId,
          `${root}.fallHazardTerrainTags`,
          "Physics fallHazardTerrainTags"
        );
      }
    }
  };

  validatePhysicsMechanics();

  const validateHeroesMechanics = () => {
    type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;
    const inspect = (
      value: unknown,
      entityId: string,
      fieldPath: string,
      label: string
    ): Record<string, unknown> | undefined => {
      let prototype: object | null;
      let descriptors: DescriptorMap;
      let array = false;
      try {
        array = value !== null && typeof value === "object" && Array.isArray(value);
        if (value !== null && typeof value === "object" && !array) {
          prototype = Object.getPrototypeOf(value);
          descriptors = Object.getOwnPropertyDescriptors(value) as DescriptorMap;
          array = Array.isArray(value);
        } else {
          prototype = null;
          descriptors = {};
        }
      } catch {
        err("mechanics", entityId, fieldPath, `${label} could not be inspected safely.`);
        return undefined;
      }
      if (value === null || typeof value !== "object" || array || prototype !== Object.prototype) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain own-data object.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("mechanics", entityId, fieldPath, `${label} must not contain symbol fields.`);
      }
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `${label} fields must be enumerable own data.`);
          continue;
        }
        Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
      }
      return result;
    };
    const unknownFields = (
      value: Record<string, unknown>,
      allowed: readonly string[],
      entityId: string,
      fieldPath: string
    ) => {
      const allowlist = new Set(allowed);
      for (const key of Object.keys(value)) {
        if (!allowlist.has(key)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `Unknown heroes mechanics field "${key}".`);
        }
      }
    };
    const utf8Bytes = (value: string): number => {
      let bytes = 0;
      for (const character of value) {
        const point = character.codePointAt(0)!;
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      }
      return bytes;
    };
    const validateActiveHeroTerrainBudgets = (profileId: string): void => {
      const root = `modules.heroes.profiles.${profileId}.terrainTypes`;
      const terrainTypes = inspect(
        content.terrainTypes,
        profileId,
        root,
        "Active hero movement terrain types"
      );
      if (!terrainTypes) return;
      const terrainIds = Object.keys(terrainTypes).sort();
      if (terrainIds.length > NAVIGATION_LIMITS.terrainDefinitions) {
        err(
          "mechanics",
          profileId,
          root,
          `Active hero movement terrain definitions exceed the ${NAVIGATION_LIMITS.terrainDefinitions} definition budget.`
        );
      }

      let totalTags = 0;
      for (const terrainId of terrainIds) {
        const definitionPath = `${root}.${terrainId}`;
        if (terrainId.length === 0 || utf8Bytes(terrainId) > NAVIGATION_LIMITS.idUtf8Bytes) {
          err(
            "mechanics",
            profileId,
            `${definitionPath}.id`,
            `Active hero movement terrain id must contain 1..${NAVIGATION_LIMITS.idUtf8Bytes} UTF-8 bytes.`
          );
        }
        const definition = inspect(
          terrainTypes[terrainId],
          profileId,
          definitionPath,
          "Active hero movement terrain definition"
        );
        if (!definition) continue;
        if (typeof definition.label === "string" && definition.label.length > NAVIGATION_LIMITS.labelLength) {
          err(
            "mechanics",
            profileId,
            `${definitionPath}.label`,
            `Active hero movement terrain label exceeds the ${NAVIGATION_LIMITS.labelLength} character budget.`
          );
        }
        if (!Array.isArray(definition.tags)) continue;
        const tags = definition.tags;
        if (tags.length > NAVIGATION_LIMITS.terrainTagsPerDefinition) {
          err(
            "mechanics",
            profileId,
            `${definitionPath}.tags`,
            `Active hero movement terrain tags exceed the ${NAVIGATION_LIMITS.terrainTagsPerDefinition} tag-per-definition budget.`
          );
        }
        totalTags += tags.length;
        for (let index = 0; index < tags.length; index += 1) {
          const tag = tags[index];
          if (typeof tag === "string" && utf8Bytes(tag) > NAVIGATION_LIMITS.terrainTagUtf8Bytes) {
            err(
              "mechanics",
              profileId,
              `${definitionPath}.tags[${index}]`,
              `Active hero movement terrain tag exceeds the ${NAVIGATION_LIMITS.terrainTagUtf8Bytes} UTF-8 byte budget.`
            );
          }
        }
      }
      if (totalTags > NAVIGATION_LIMITS.terrainTagsAcrossDefinitions) {
        err(
          "mechanics",
          profileId,
          root,
          `Active hero movement terrain tags exceed the ${NAVIGATION_LIMITS.terrainTagsAcrossDefinitions} total-tag budget.`
        );
      }
    };
    const validateActiveHeroMapBudget = (profileId: string, missionId: string): void => {
      const mission = content.missions[missionId];
      if (!mission || typeof mission.mapId !== "string") return;
      const mapId = mission.mapId;
      const map = content.maps[mapId];
      if (!map) return;
      const hasSafePositiveDimensions = Number.isSafeInteger(map.width) && map.width > 0
        && Number.isSafeInteger(map.height) && map.height > 0;
      const cellCount = hasSafePositiveDimensions ? map.width * map.height : undefined;
      if (cellCount !== undefined && !Number.isSafeInteger(cellCount)) {
        err(
          "mission",
          missionId,
          `maps.${mapId}.heroes.cells`,
          `Active hero movement map cell product must be a safe integer within the `
          + `${NAVIGATION_LIMITS.activeMapCells} cell budget for profile "${profileId}".`
        );
      } else if (cellCount !== undefined && cellCount > NAVIGATION_LIMITS.activeMapCells) {
        err(
          "mission",
          missionId,
          `maps.${mapId}.heroes.cells`,
          `Active hero movement map dimensions contain ${cellCount} cells, exceeding the `
          + `${NAVIGATION_LIMITS.activeMapCells} cell budget for profile "${profileId}".`
        );
      }
    };

    const catalog = inspect(content.mechanics, "heroes", "mechanics", "Mechanics catalog");
    if (!catalog) return;
    const modules = inspect(catalog.modules, "heroes", "mechanics.modules", "Mechanics modules");
    if (!modules) return;
    const selections = new Map<string, string>();
    for (const [missionId, mission] of Object.entries(content.missions)) {
      const profileId = mission.mechanics?.profiles?.heroes;
      if (typeof profileId === "string") selections.set(missionId, profileId);
    }
    if (modules.heroes === undefined) {
      for (const [missionId, profileId] of selections) {
        warn(
          "mission",
          missionId,
          "mechanics.profiles.heroes",
          `Mission selects heroes profile "${profileId}" from a missing inactive module.`
        );
      }
      return;
    }
    const module = inspect(modules.heroes, "heroes", "modules.heroes", "Heroes mechanics module");
    if (!module) return;
    unknownFields(module, ["schemaVersion", "enabled", "profiles"], "heroes", "modules.heroes");
    if (module.schemaVersion !== 1 && module.schemaVersion !== 2 && module.schemaVersion !== 3
      && module.schemaVersion !== 4 && module.schemaVersion !== 5 && module.schemaVersion !== 6
      && module.schemaVersion !== 7) {
      err(
        "mechanics",
        "heroes",
        "modules.heroes.schemaVersion",
        "Heroes future or unsupported schemaVersion; only versions 1, 2, 3, 4, 5, 6 and 7 are supported."
      );
    }
    if (typeof module.enabled !== "boolean") {
      err("mechanics", "heroes", "modules.heroes.enabled", "Heroes mechanics enabled must be boolean.");
    }
    const profiles = inspect(module.profiles, "heroes", "modules.heroes.profiles", "Heroes mechanics profiles");
    if (!profiles) return;
    for (const [missionId, profileId] of selections) {
      if (Object.prototype.hasOwnProperty.call(profiles, profileId)) continue;
      const active = module.enabled === true
        && (module.schemaVersion === 1 || module.schemaVersion === 2 || module.schemaVersion === 3
          || module.schemaVersion === 4 || module.schemaVersion === 5 || module.schemaVersion === 6
          || module.schemaVersion === 7);
      (active ? err : warn)(
        "mission",
        missionId,
        "mechanics.profiles.heroes",
        `Mission selects missing heroes profile "${profileId}"${active ? "" : " from an inactive module"}.`
      );
    }
    const selectedProfileIds = new Set(selections.values());
    for (const profileId of Object.keys(profiles).sort()) {
      const root = `modules.heroes.profiles.${profileId}`;
      let profile: HeroesProfileV1 | HeroesProfileV2 | HeroesProfileV3 | HeroesProfileV4 | HeroesProfileV5
        | HeroesProfileV6 | HeroesProfileV7;
      try {
        profile = module.schemaVersion === 7
          ? normalizeHeroesProfileV7(profiles[profileId], root)
          : module.schemaVersion === 6
            ? normalizeHeroesProfileV6(profiles[profileId], root)
          : module.schemaVersion === 5
            ? normalizeHeroesProfileV5(profiles[profileId], root)
          : module.schemaVersion === 4
            ? normalizeHeroesProfileV4(profiles[profileId], root)
          : module.schemaVersion === 3
          ? normalizeHeroesProfileV3(profiles[profileId], root)
          : module.schemaVersion === 2
            ? normalizeHeroesProfileV2(profiles[profileId], root)
            : normalizeHeroesProfileV1(profiles[profileId], root);
      } catch (error) {
        err(
          "mechanics",
          profileId,
          error instanceof HeroesProfileValidationError ? error.fieldPath : root,
          error instanceof Error ? error.message : `Heroes profile "${profileId}" is invalid.`
        );
        continue;
      }
      const selectedExists = Object.prototype.hasOwnProperty.call(profile.definitions, profile.selectedHeroId);
      const active = module.enabled === true
        && (module.schemaVersion === 1 || module.schemaVersion === 2 || module.schemaVersion === 3
          || module.schemaVersion === 4 || module.schemaVersion === 5 || module.schemaVersion === 6
          || module.schemaVersion === 7)
        && selectedProfileIds.has(profileId);
      if (module.schemaVersion === 2 || module.schemaVersion === 3 || module.schemaVersion === 4
        || module.schemaVersion === 5 || module.schemaVersion === 6 || module.schemaVersion === 7) {
        const v2 = profile as HeroesProfileV2 | HeroesProfileV3 | HeroesProfileV4 | HeroesProfileV5
          | HeroesProfileV6 | HeroesProfileV7;
        const semantic = (fieldPath: string, message: string): void => {
          (active ? err : warn)("mechanics", profileId, fieldPath, message);
        };
        for (const [heroId, definition] of Object.entries(v2.definitions)) {
          const movementProfileId = definition.movement.movementProfileId;
          if (Object.prototype.hasOwnProperty.call(v2.movementProfiles, movementProfileId)) continue;
          semantic(
            `${root}.definitions.${heroId}.movement.movementProfileId`,
            `Hero movement profile "${movementProfileId}" is missing${active ? "" : " in this inactive or unselected profile"}.`
          );
        }
        for (const [movementProfileId, movementProfile] of Object.entries(v2.movementProfiles)) {
          for (const terrainId of Object.keys(movementProfile.terrainCosts ?? {})) {
            if (Object.prototype.hasOwnProperty.call(content.terrainTypes, terrainId)) continue;
            semantic(
              `${root}.movementProfiles.${movementProfileId}.terrainCosts.${terrainId}`,
              `Hero movement terrain cost references unknown terrain "${terrainId}"`
              + `${active ? "." : " in this inactive or unselected profile."}`
            );
          }
        }
        if (active) {
          validateActiveHeroTerrainBudgets(profileId);
          for (const [missionId, selectedProfileId] of selections) {
            if (selectedProfileId === profileId) validateActiveHeroMapBudget(profileId, missionId);
          }
        }
        if (module.schemaVersion === 5 || module.schemaVersion === 6 || module.schemaVersion === 7) {
          const selectedWaveCounts = [...selections]
            .filter(([, selectedProfileId]) => selectedProfileId === profileId)
            .map(([missionId]) => content.missions[missionId]?.waves.length ?? 0);
          for (const issue of validateHeroSkillTreeSemanticsV5(
            profile as HeroesProfileV5 | HeroesProfileV6 | HeroesProfileV7,
            root,
            selectedWaveCounts
          )) {
            semantic(issue.fieldPath, issue.message);
          }
        }
        if ((module.schemaVersion === 6 || module.schemaVersion === 7) && selectedExists) {
          const auraProfile = profile as HeroesProfileV6 | HeroesProfileV7;
          const aura = auraProfile.definitions[auraProfile.selectedHeroId]
            ?.passiveAura;
          if (aura) {
            const selectedMissionIds = [...selections]
              .filter(([, selectedProfileId]) => selectedProfileId === profileId)
              .map(([missionId]) => missionId);
            const candidateMissionIds = selectedMissionIds.length > 0
              ? selectedMissionIds
              : Object.keys(content.missions).sort();
            for (const missionId of candidateMissionIds) {
              const total = campaignBattleRogueliteWorstCaseModifierCount([], content, missionId)
                + aura.effects.length;
              if (total > MAX_MODIFIERS_PER_RESOLUTION) {
                semantic(
                  `${root}.definitions.${profile.selectedHeroId}.passiveAura.effects`,
                  `Hero passive aura exceeds the shared ${MAX_MODIFIERS_PER_RESOLUTION}-modifier damage budget `
                    + `for mission "${missionId}".`
                );
              }
              const numeric = preflightHeroAuraDamageFinite(content, missionId, {
                heroesProfile: auraProfile
              });
              if (!numeric.ok) {
                semantic(
                  `${root}.definitions.${profile.selectedHeroId}.passiveAura.effects`,
                  numeric.message
                );
              }
            }
          }
        }
        if (module.schemaVersion === 7 && selectedExists) {
          const v7 = profile as HeroesProfileV7;
          const selectedMissionIds = [...selections]
            .filter(([, selectedProfileId]) => selectedProfileId === profileId)
            .map(([missionId]) => missionId)
            .sort();
          for (const [heroId, definition] of Object.entries(v7.definitions)) {
            const blocking = definition.blocking;
            if (blocking === null) continue;
            const blockingRoot = `${root}.definitions.${heroId}.blocking.movementProfileIds`;
            const heroSelected = heroId === v7.selectedHeroId;
            const dependencyActive = active && heroSelected && selectedMissionIds.length > 0;
            const report = dependencyActive ? err : warn;
            const candidateMissionIds = selectedMissionIds.length > 0
              ? selectedMissionIds
              : Object.keys(content.missions).sort();
            let checkedDynamicProfile = false;
            for (const missionId of candidateMissionIds) {
              let navigation: ReturnType<typeof resolveActiveNavigationMechanics>;
              try {
                navigation = resolveActiveNavigationMechanics(content, missionId);
              } catch {
                navigation = undefined;
              }
              if (navigation?.mode !== "dynamic_flow") {
                if (heroSelected) {
                  report(
                    "mechanics",
                    profileId,
                    blockingRoot,
                    `Hero blocking requires an active dynamic_flow Navigation dependency for mission "${missionId}".`
                  );
                }
                continue;
              }
              checkedDynamicProfile = true;
              for (const movementProfileId of blocking.movementProfileIds) {
                if (Object.prototype.hasOwnProperty.call(navigation.movementProfiles, movementProfileId)) continue;
                report(
                  "mechanics",
                  profileId,
                  blockingRoot,
                  `Hero blocking movement profile "${movementProfileId}" is missing from mission "${missionId}" Navigation.`
                );
              }
            }
            if (!heroSelected && !checkedDynamicProfile) {
              warn(
                "mechanics",
                profileId,
                blockingRoot,
                "Unselected hero blocking references cannot be resolved without an active dynamic_flow Navigation profile."
              );
            }
          }
        }
      }
      if (!selectedExists) {
        (active ? err : warn)(
          "mechanics",
          profileId,
          `${root}.selectedHeroId`,
          `Heroes selectedHeroId "${profile.selectedHeroId}" references a missing definition${active ? "" : " in this inactive or unselected profile"}.`
        );
        continue;
      }
    }
  };

  validateHeroesMechanics();

  const validateLogisticsMechanics = () => {
    const ownRecord = (
      value: unknown,
      entityId: string,
      fieldPath: string,
      label: string
    ): Record<string, unknown> | undefined => {
      let prototype: object | null;
      let descriptors: Record<PropertyKey, PropertyDescriptor>;
      try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
          ? Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>
          : {};
      } catch {
        err("mechanics", entityId, fieldPath, `${label} could not be inspected safely.`);
        return undefined;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)
        || (prototype !== Object.prototype && prototype !== null)) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain object with own data fields.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("mechanics", entityId, fieldPath, `${label} must not contain symbol fields.`);
      }
      const detached = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          err(
            "mechanics",
            entityId,
            `${fieldPath}.${key}`,
            `${label} field "${key}" must be an enumerable own data field; accessors are not allowed.`
          );
          continue;
        }
        detached[key] = descriptor.value;
      }
      return detached;
    };
    const catalog = ownRecord(content.mechanics, "logistics", "mechanics", "Mechanics catalog");
    const modules = catalog
      ? ownRecord(catalog.modules, "logistics", "mechanics.modules", "Mechanics modules")
      : undefined;
    if (!modules) return;
    const selectedByProfile = new Map<string, string[]>();
    for (const [missionId, mission] of Object.entries(content.missions)) {
      const selected = mission.mechanics?.profiles?.logistics;
      if (typeof selected !== "string") continue;
      const missionIds = selectedByProfile.get(selected) ?? [];
      missionIds.push(missionId);
      selectedByProfile.set(selected, missionIds);
    }
    if (modules.logistics === undefined) {
      for (const [profileId, missionIds] of selectedByProfile) {
        for (const missionId of missionIds) {
          warn(
            "mission",
            missionId,
            "mechanics.profiles.logistics",
            `Mission selects logistics profile "${profileId}" from a missing inactive module.`
          );
        }
      }
      return;
    }
    const module = ownRecord(
      modules.logistics,
      "logistics",
      "modules.logistics",
      "Logistics mechanics module"
    );
    if (!module) return;
    for (const key of Object.keys(module)) {
      if (!["schemaVersion", "enabled", "profiles"].includes(key)) {
        err("mechanics", "logistics", `modules.logistics.${key}`, `Logistics module is closed; unknown field "${key}".`);
      }
    }
    const supported = module.schemaVersion === 1 || module.schemaVersion === 2 || module.schemaVersion === 3;
    if (!supported) {
      err(
        "mechanics",
        "logistics",
        "modules.logistics.schemaVersion",
        "Logistics future or unsupported schemaVersion; only versions 1, 2, and 3 are supported."
      );
    }
    if (typeof module.enabled !== "boolean") {
      err("mechanics", "logistics", "modules.logistics.enabled", "Logistics mechanics enabled must be boolean.");
    }
    const profiles = ownRecord(
      module.profiles,
      "logistics",
      "modules.logistics.profiles",
      "Logistics mechanics profiles"
    );
    if (!profiles || !supported) return;
    for (const [profileId, missionIds] of selectedByProfile) {
      if (Object.prototype.hasOwnProperty.call(profiles, profileId)) continue;
      for (const missionId of missionIds) {
        (module.enabled === true ? err : warn)(
          "mission",
          missionId,
          "mechanics.profiles.logistics",
          `Mission selects missing logistics profile "${profileId}"${module.enabled === true ? "" : " from an inactive module"}.`
        );
      }
    }
    for (const profileId of Object.keys(profiles).sort()) {
      const root = `modules.logistics.profiles.${profileId}`;
      let profile;
      try {
        profile = module.schemaVersion === 1
          ? normalizeLogisticsProfileV1(profiles[profileId])
          : module.schemaVersion === 2
            ? normalizeLogisticsProfileV2(profiles[profileId])
            : normalizeLogisticsProfileV3(profiles[profileId]);
      } catch (error) {
        const relative = error instanceof LogisticsProfileValidationError
          ? error.fieldPath.replace(/^profile(?=\.|$)/, "")
          : "";
        err(
          "mechanics",
          profileId,
          `${root}${relative}`,
          error instanceof Error ? error.message : "Logistics profile could not be inspected safely."
        );
        continue;
      }
      const active = module.enabled === true && (selectedByProfile.get(profileId)?.length ?? 0) > 0;
      const semantic = active ? err : warn;
      if (profile.power !== null) {
        const roles = [
          ["generators", profile.power.generators],
          ["relays", profile.power.relays],
          ["consumers", profile.power.consumers]
        ] as const;
        for (const [role, definitions] of roles) {
          for (const towerTypeId of Object.keys(definitions)) {
            const tower = Object.prototype.hasOwnProperty.call(content.towers, towerTypeId)
              ? content.towers[towerTypeId]
              : undefined;
            if (!tower) {
              semantic(
                "mechanics",
                profileId,
                `${root}.power.${role}.${towerTypeId}`,
                `Logistics ${role.slice(0, -1)} references unknown tower type "${towerTypeId}"`
                  + `${active ? "." : " in this inactive or unselected profile."}`
              );
              continue;
            }
            if (role === "consumers" && ![
              "single", "pulse", "sniper", "antiair", "splash", "pipeline"
            ].includes(tower.attack.kind)) {
              semantic(
                "mechanics",
                profileId,
                `${root}.power.consumers.${towerTypeId}`,
                `Logistics consumer tower "${towerTypeId}" must use a fire-capable attack; `
                  + `passive ${tower.attack.kind} is unsupported${active ? "." : " in this inactive profile."}`
              );
            }
          }
        }
      }
      const profileAmmunition = "ammunition" in profile
        ? profile.ammunition as LogisticsAmmunitionDefinitionV2 | null
        : undefined;
      if (profileAmmunition) {
        for (const [towerTypeId, inventory] of Object.entries(profileAmmunition.towerInventories)) {
          const path = `${root}.ammunition.towerInventories.${towerTypeId}`;
          if (!Object.prototype.hasOwnProperty.call(profileAmmunition.types, inventory.ammoTypeId)) {
            semantic(
              "mechanics",
              profileId,
              `${path}.ammoTypeId`,
              `Logistics ammunition inventory references unknown ammunition type "${inventory.ammoTypeId}"`
                + `${active ? "." : " in this inactive or unselected profile."}`
            );
          }
          const tower = Object.prototype.hasOwnProperty.call(content.towers, towerTypeId)
            ? content.towers[towerTypeId]
            : undefined;
          if (!tower) {
            semantic(
              "mechanics",
              profileId,
              path,
              `Logistics ammunition inventory references unknown tower type "${towerTypeId}"`
                + `${active ? "." : " in this inactive or unselected profile."}`
            );
          } else if (!["single", "pulse", "sniper", "antiair", "splash", "pipeline"].includes(tower.attack.kind)) {
            semantic(
              "mechanics",
              profileId,
              path,
              `Logistics ammunition tower "${towerTypeId}" must use a fire-capable attack; `
                + `passive ${tower.attack.kind} is unsupported${active ? "." : " in this inactive profile."}`
            );
          }
        }
      }
      const profileSupply = "supply" in profile
        ? profile.supply as LogisticsSupplyDefinitionV3 | null
        : undefined;
      if (profileSupply && profileAmmunition) {
        for (const [recipeId, recipe] of Object.entries(profileSupply.productionRecipes)) {
          if (!Object.prototype.hasOwnProperty.call(profileAmmunition.types, recipe.ammoTypeId)) {
            semantic(
              "mechanics",
              profileId,
              `${root}.supply.productionRecipes.${recipeId}.ammoTypeId`,
              `Logistics production recipe references unknown ammunition type "${recipe.ammoTypeId}"`
                + `${active ? "." : " in this inactive or unselected profile."}`
            );
          }
        }
        for (const [towerTypeId, producer] of Object.entries(profileSupply.producers)) {
          const path = `${root}.supply.producers.${towerTypeId}`;
          if (!Object.prototype.hasOwnProperty.call(profileSupply.productionRecipes, producer.recipeId)) {
            semantic(
              "mechanics",
              profileId,
              `${path}.recipeId`,
              `Logistics producer references unknown production recipe "${producer.recipeId}"`
                + `${active ? "." : " in this inactive or unselected profile."}`
            );
          }
          if (!Object.prototype.hasOwnProperty.call(content.towers, towerTypeId)) {
            semantic(
              "mechanics",
              profileId,
              path,
              `Logistics producer references unknown tower type "${towerTypeId}"`
                + `${active ? "." : " in this inactive or unselected profile."}`
            );
          }
        }
        for (const [towerTypeId, storage] of Object.entries(profileSupply.storages)) {
          const path = `${root}.supply.storages.${towerTypeId}`;
          if (!Object.prototype.hasOwnProperty.call(profileAmmunition.types, storage.ammoTypeId)) {
            semantic(
              "mechanics",
              profileId,
              `${path}.ammoTypeId`,
              `Logistics storage references unknown ammunition type "${storage.ammoTypeId}"`
                + `${active ? "." : " in this inactive or unselected profile."}`
            );
          }
          if (!Object.prototype.hasOwnProperty.call(content.towers, towerTypeId)) {
            semantic(
              "mechanics",
              profileId,
              path,
              `Logistics storage references unknown tower type "${towerTypeId}"`
                + `${active ? "." : " in this inactive or unselected profile."}`
            );
          }
        }
      }
    }
  };

  validateLogisticsMechanics();

  const validateTerraformingMechanics = () => {
    type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;
    const inspect = (
      value: unknown,
      entityId: string,
      fieldPath: string,
      label: string
    ): Record<string, unknown> | undefined => {
      let prototype: object | null;
      let descriptors: DescriptorMap;
      try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
          ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
          : {};
      } catch {
        err("mechanics", entityId, fieldPath, `${label} could not be inspected safely.`);
        return undefined;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain object with enumerable own data fields.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("mechanics", entityId, fieldPath, `${label} must not contain symbol fields.`);
      }
      const detached: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          err(
            "mechanics",
            entityId,
            `${fieldPath}.${key}`,
            `${label}.${key} must be an enumerable own data field; accessors are not allowed.`
          );
          continue;
        }
        Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
      }
      return detached;
    };
    const unknownFields = (
      value: Record<string, unknown>,
      allowed: readonly string[],
      entityId: string,
      fieldPath: string
    ): void => {
      for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
          err(
            "mechanics",
            entityId,
            `${fieldPath}.${key}`,
            `Terraforming object is closed; unknown field "${key}" is not allowed.`
          );
        }
      }
    };

    const catalog = inspect(content.mechanics, "terraforming", "mechanics", "Mechanics catalog");
    if (!catalog) return;
    const modules = inspect(catalog.modules, "terraforming", "mechanics.modules", "Mechanics modules");
    if (!modules) return;
    const selections = new Map<string, string>();
    for (const [missionId, mission] of Object.entries(content.missions)) {
      const selected = mission.mechanics?.profiles?.terraforming;
      if (typeof selected === "string") selections.set(missionId, selected);
    }
    if (modules.terraforming === undefined) {
      for (const [missionId, profileId] of selections) {
        warn(
          "mission",
          missionId,
          "mechanics.profiles.terraforming",
          `Mission selects terraforming profile "${profileId}" from a missing inactive module.`
        );
      }
      return;
    }
    const module = inspect(
      modules.terraforming,
      "terraforming",
      "modules.terraforming",
      "Terraforming mechanics module"
    );
    if (!module) return;
    unknownFields(module, ["schemaVersion", "enabled", "profiles"], "terraforming", "modules.terraforming");
    if (module.schemaVersion !== 1) {
      err(
        "mechanics",
        "terraforming",
        "modules.terraforming.schemaVersion",
        "Terraforming future or unsupported schemaVersion; only version 1 is supported."
      );
    }
    if (typeof module.enabled !== "boolean") {
      err(
        "mechanics",
        "terraforming",
        "modules.terraforming.enabled",
        "Terraforming mechanics enabled must be boolean."
      );
    }
    const profiles = inspect(
      module.profiles,
      "terraforming",
      "modules.terraforming.profiles",
      "Terraforming mechanics profiles"
    );
    if (!profiles) return;
    for (const [missionId, profileId] of selections) {
      if (Object.prototype.hasOwnProperty.call(profiles, profileId)) continue;
      const activeModule = module.enabled === true && module.schemaVersion === 1;
      (activeModule ? err : warn)(
        "mission",
        missionId,
        "mechanics.profiles.terraforming",
        `Mission selects missing terraforming profile "${profileId}"${activeModule ? "" : " from an inactive module"}.`
      );
    }

    const terrainIds = new Set(Object.keys(content.terrainTypes));
    const terrainTags = new Set<string>();
    for (const terrain of Object.values(content.terrainTypes)) {
      for (const tag of terrain.tags) terrainTags.add(tag);
    }
    for (const profileId of Object.keys(profiles).sort()) {
      const root = `modules.terraforming.profiles.${profileId}`;
      let profile;
      try {
        profile = normalizeTerraformingProfileV1(profiles[profileId]);
      } catch (error) {
        const relativePath = error instanceof TerraformingProfileValidationError
          ? error.fieldPath.replace(/^profile(?=\.|$)/, "")
          : "";
        const message = error instanceof Error
          ? error.message
          : "Terraforming profile could not be inspected safely.";
        err("mechanics", profileId, `${root}${relativePath}`, message);
        continue;
      }
      const selectedMissionIds = [...selections.entries()]
        .filter(([, selectedProfileId]) => selectedProfileId === profileId)
        .map(([missionId]) => missionId);
      const activeMissionIds = selectedMissionIds.filter((missionId) => (
        content.missions[missionId]?.capabilities.terraforming.active === true
      ));
      const inactiveMissionIds = selectedMissionIds.filter((missionId) => (
        content.missions[missionId]?.capabilities.terraforming.active !== true
      ));
      const active = activeMissionIds.length > 0;
      const semantic = active ? err : warn;
      const transitionIds = new Set<string>();
      for (const [transitionId, transition] of Object.entries(profile.terrainTransitions ?? {})) {
        transitionIds.add(transitionId);
        const transitionPath = `${root}.terrainTransitions.${transitionId}`;
        if (!terrainIds.has(transition.toTerrainId)) {
          semantic(
            "mechanics",
            profileId,
            `${transitionPath}.toTerrainId`,
            `Terraforming transition "${transitionId}" references unknown terrain "${transition.toTerrainId}"${active ? "" : " in this inactive profile"}.`
          );
        }
        for (const tag of transition.fromTerrainTags) {
          if (terrainTags.has(tag)) continue;
          semantic(
            "mechanics",
            profileId,
            `${transitionPath}.fromTerrainTags`,
            `Terraforming transition "${transitionId}" references unknown terrain tag "${tag}"${active ? "" : " in this inactive profile"}.`
          );
        }
      }
      terraformingTransitionIdsByProfile.set(profileId, transitionIds);
      if (profile.elevation) {
        for (const missionId of activeMissionIds) {
          if (content.missions[missionId]?.capabilities.elevation.active) continue;
          err(
            "mechanics",
            profileId,
            `${root}.elevation`,
            `Active terraforming elevation policy requires an active elevation capability for mission "${missionId}".`
          );
        }
        for (const missionId of inactiveMissionIds) {
          if (content.missions[missionId]?.capabilities.elevation.active) continue;
          warn(
            "mechanics",
            profileId,
            `${root}.elevation`,
            `Terraforming elevation dependency is inactive for mission "${missionId}" because terraforming is not active.`
          );
        }
      }
    }
    for (const [missionId, mission] of Object.entries(content.missions)) {
      const capability = mission.capabilities.terraforming;
      if (!capability.active || capability.profileId === undefined) continue;
      activeTerraformingTransitionIdsByMission.set(
        missionId,
        new Set(terraformingTransitionIdsByProfile.get(capability.profileId) ?? [])
      );
    }
  };

  validateTerraformingMechanics();

  const validateRogueliteMechanics = () => {
    const own = (value: unknown, key: string): unknown => {
      if (value === null || typeof value !== "object") return undefined;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
      } catch {
        return undefined;
      }
    };
    const record = (
      value: unknown,
      entityId: string,
      fieldPath: string,
      label: string
    ): Record<string, unknown> | undefined => {
      let prototype: object | null;
      let descriptors: Record<PropertyKey, PropertyDescriptor>;
      try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
          ? Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>
          : {};
      } catch {
        err("mechanics", entityId, fieldPath, `${label} could not be inspected safely.`);
        return undefined;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)
        || (prototype !== Object.prototype && prototype !== null)) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain own-data object.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("mechanics", entityId, fieldPath, `${label} must not contain symbol fields.`);
      }
      const detached = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `${label} fields must be enumerable own data.`);
          continue;
        }
        Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
      }
      return detached;
    };

    const towerTags = new Map<string, readonly string[]>();
    const allTags = new Set<string>();
    let taggedTowerTypes = 0;
    let totalTowerTagRefs = 0;
    for (const towerId of Object.keys(content.towers).sort()) {
      const tower = content.towers[towerId]!;
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(tower, "tags");
      } catch {
        err("tower", towerId, `towers.${towerId}.tags`, `Tower "${towerId}" tags could not be inspected safely.`);
        continue;
      }
      if (descriptor && (!descriptor.enumerable || !("value" in descriptor))) {
        err("tower", towerId, `towers.${towerId}.tags`, `Tower "${towerId}" tags must be enumerable own data.`);
        continue;
      }
      try {
        const tags = normalizeTowerTagsV1(descriptor && "value" in descriptor ? descriptor.value : undefined, `towers.${towerId}.tags`);
        towerTags.set(towerId, tags);
        if (tags.length > 0) taggedTowerTypes += 1;
        totalTowerTagRefs += tags.length;
        tags.forEach((tag) => allTags.add(tag));
      } catch (error) {
        const fieldPath = error instanceof RogueliteProfileValidationError
          ? error.fieldPath
          : `towers.${towerId}.tags`;
        err("tower", towerId, fieldPath, error instanceof Error ? error.message : "Tower tags are invalid.");
      }
    }
    if (taggedTowerTypes > ROGUELITE_SYNERGY_LIMITS.towerTypesWithTags) {
      err("mechanics", "roguelite", "towers.tags", "Too many tower types define synergy tags.");
    }
    if (totalTowerTagRefs > ROGUELITE_SYNERGY_LIMITS.totalTowerTagRefs) {
      err("mechanics", "roguelite", "towers.tags", "Tower synergy tag references exceed the aggregate budget.");
    }

    const selections = new Map<string, string>();
    for (const [missionId, mission] of Object.entries(content.missions)) {
      const selected = mission.mechanics?.profiles?.roguelite;
      if (typeof selected === "string") selections.set(missionId, selected);
    }
    const modules = record(own(content.mechanics, "modules"), "roguelite", "mechanics.modules", "Mechanics modules");
    if (!modules) return;
    const moduleValue = own(modules, "roguelite");
    if (moduleValue === undefined) {
      for (const [missionId, profileId] of selections) {
        warn(
          "mission",
          missionId,
          "mechanics.profiles.roguelite",
          `Mission selects roguelite profile "${profileId}" from a missing inactive module.`
        );
      }
      return;
    }
    const module = record(moduleValue, "roguelite", "modules.roguelite", "Roguelite mechanics module");
    if (!module) return;
    for (const key of Object.keys(module)) {
      if (!["schemaVersion", "enabled", "profiles"].includes(key)) {
        err("mechanics", "roguelite", `modules.roguelite.${key}`, `Roguelite module is closed; unknown field "${key}".`);
      }
    }
    const supportedVersion = module.schemaVersion === 1 || module.schemaVersion === 2
      || module.schemaVersion === 3 || module.schemaVersion === 4;
    if (!supportedVersion) {
      err("mechanics", "roguelite", "modules.roguelite.schemaVersion", "Roguelite future or unsupported schemaVersion; only versions 1, 2, 3, and 4 are supported.");
    }
    if (typeof module.enabled !== "boolean") {
      err("mechanics", "roguelite", "modules.roguelite.enabled", "Roguelite mechanics enabled must be boolean.");
    }
    const profiles = record(module.profiles, "roguelite", "modules.roguelite.profiles", "Roguelite mechanics profiles");
    if (!profiles) return;
    for (const [missionId, profileId] of selections) {
      if (Object.prototype.hasOwnProperty.call(profiles, profileId)) continue;
      const active = module.enabled === true && supportedVersion;
      (active ? err : warn)(
        "mission",
        missionId,
        "mechanics.profiles.roguelite",
        `Mission selects missing roguelite profile "${profileId}"${active ? "" : " from an inactive module"}.`
      );
    }
    // Future profiles are intentionally opaque. Studio preserves them read-only, while
    // validation reports only the unsupported module version instead of guessing their shape.
    if (!supportedVersion) return;
    for (const profileId of Object.keys(profiles).sort()) {
      const root = `modules.roguelite.profiles.${profileId}`;
      let profile:
        | ReturnType<typeof normalizeRogueliteProfileV1>
        | ReturnType<typeof normalizeRogueliteProfileV2>
        | ReturnType<typeof normalizeRogueliteProfileV3>
        | ReturnType<typeof normalizeRogueliteProfileV4>;
      try {
        profile = module.schemaVersion === 4
          ? normalizeRogueliteProfileV4(profiles[profileId])
          : module.schemaVersion === 3
            ? normalizeRogueliteProfileV3(profiles[profileId])
          : module.schemaVersion === 2
            ? normalizeRogueliteProfileV2(profiles[profileId])
            : normalizeRogueliteProfileV1(profiles[profileId]);
      } catch (error) {
        const relativePath = error instanceof RogueliteProfileValidationError
          ? error.fieldPath.replace(/^profile(?=\.|$)/, "")
          : "";
        err("mechanics", profileId, `${root}${relativePath}`, error instanceof Error ? error.message : "Roguelite profile is invalid.");
        continue;
      }
      const selectedMissionIds = [...selections.entries()]
        .filter(([, selectedProfileId]) => selectedProfileId === profileId)
        .map(([missionId]) => missionId);
      const activeMissionIds = selectedMissionIds.filter((missionId) => (
        content.missions[missionId]?.capabilities.roguelite.active === true
      ));
      for (const [synergyId, synergy] of Object.entries(profile.synergies)) {
        if (!allTags.has(synergy.tag)) {
          (activeMissionIds.length > 0 ? err : warn)(
            "mechanics",
            profileId,
            `${root}.synergies.${synergyId}.tag`,
            `Synergy "${synergyId}" references unknown tower tag "${synergy.tag}"${activeMissionIds.length > 0 ? "" : " in this inactive profile"}.`
          );
          continue;
        }
        for (const missionId of activeMissionIds) {
          const reachable = content.missions[missionId]!.buildTowerIds.some((towerId) => (
            towerTags.get(towerId)?.includes(synergy.tag)
          ));
          if (!reachable) {
            warn(
              "mechanics",
              profileId,
              `${root}.synergies.${synergyId}.tag`,
              `Synergy tag "${synergy.tag}" exists but no tagged tower is buildable in mission "${missionId}".`
            );
          }
        }
      }
      const semantic = activeMissionIds.length > 0 ? err : warn;
      const artifacts = "artifacts" in profile ? profile.artifacts : undefined;
      if (artifacts) {
        try {
          assertRogueliteV2ModifierBudget({ synergies: profile.synergies, artifacts });
        } catch (error) {
          semantic(
            "mechanics",
            profileId,
            `${root}.synergies`,
            error instanceof Error ? error.message : "Roguelite artifact modifier budget is invalid."
          );
        }
      }
      const slotTypes = new Set<string>();
      for (const [towerTypeId, slots] of Object.entries(artifacts?.towerSlots ?? {})) {
        slots.forEach((slot) => slotTypes.add(slot.slotType));
        if (Object.prototype.hasOwnProperty.call(content.towers, towerTypeId)) continue;
        semantic(
          "mechanics",
          profileId,
          `${root}.artifacts.towerSlots.${towerTypeId}`,
          `Artifact tower slots reference unknown tower type "${towerTypeId}"${activeMissionIds.length > 0 ? "" : " in this inactive profile"}.`
        );
      }
      const referencedArtifacts = new Set<string>();
      for (const [enemyTypeId, table] of Object.entries(artifacts?.bossLootTables ?? {})) {
        if (!Object.prototype.hasOwnProperty.call(content.enemies, enemyTypeId)) {
          semantic(
            "mechanics",
            profileId,
            `${root}.artifacts.bossLootTables.${enemyTypeId}`,
            `Artifact boss loot table references unknown enemy type "${enemyTypeId}"${activeMissionIds.length > 0 ? "" : " in this inactive profile"}.`
          );
        }
        for (const entry of table.entries) {
          referencedArtifacts.add(entry.artifactId);
          if (Object.prototype.hasOwnProperty.call(artifacts?.definitions ?? {}, entry.artifactId)) continue;
          semantic(
            "mechanics",
            profileId,
            `${root}.artifacts.bossLootTables.${enemyTypeId}.entries.${entry.artifactId}`,
            `Artifact loot entry references unknown artifact "${entry.artifactId}"${activeMissionIds.length > 0 ? "" : " in this inactive profile"}.`
          );
        }
      }
      for (const [artifactId, definition] of Object.entries(artifacts?.definitions ?? {})) {
        if (!slotTypes.has(definition.slotType)) {
          warn(
            "mechanics",
            profileId,
            `${root}.artifacts.definitions.${artifactId}.slotType`,
            `Artifact "${artifactId}" uses slot type "${definition.slotType}" that is not declared by any tower slot.`
          );
        }
        if (!referencedArtifacts.has(artifactId)) {
          warn(
            "mechanics",
            profileId,
            `${root}.artifacts.definitions.${artifactId}`,
            `Artifact "${artifactId}" is not referenced by any boss loot table.`
          );
        }
      }
      for (const missionId of activeMissionIds) {
        const authoredEnemyIds = new Set(
          content.missions[missionId]!.waves.flatMap((wave) => wave.groups.map((group) => group.enemyId))
        );
        for (const enemyTypeId of Object.keys(artifacts?.bossLootTables ?? {})) {
          if (authoredEnemyIds.has(enemyTypeId)) continue;
          warn(
            "mechanics",
            profileId,
            `${root}.artifacts.bossLootTables.${enemyTypeId}`,
            `Loot-bearing enemy "${enemyTypeId}" does not appear in mission "${missionId}" waves.`
          );
        }
      }

      const draft = "draft" in profile ? profile.draft : undefined;
      if (draft) {
        if (!Object.prototype.hasOwnProperty.call(draft.pools, draft.defaultPoolId)) {
          semantic(
            "mechanics",
            profileId,
            `${root}.draft.defaultPoolId`,
            `Draft defaultPoolId references missing pool "${draft.defaultPoolId}"${activeMissionIds.length > 0 ? "" : " in this inactive profile"}.`
          );
        }
        for (const [poolId, pool] of Object.entries(draft.pools)) {
          for (const entry of pool.entries) {
            if (Object.prototype.hasOwnProperty.call(draft.definitions, entry.cardId)) continue;
            semantic(
              "mechanics",
              profileId,
              `${root}.draft.pools.${poolId}.entries.${entry.cardId}`,
              `Draft pool entry references missing card "${entry.cardId}"${activeMissionIds.length > 0 ? "" : " in this inactive profile"}.`
            );
          }
        }
        for (const [cardId, definition] of Object.entries(draft.definitions)) {
          definition.effects.forEach((effect, effectIndex) => {
            const scopePath = `${root}.draft.definitions.${cardId}.effects[${effectIndex}].scope`;
            if (effect.scope.kind === "tower_type"
              && !Object.prototype.hasOwnProperty.call(content.towers, effect.scope.towerTypeId)) {
              semantic(
                "mechanics",
                profileId,
                `${scopePath}.towerTypeId`,
                `Draft modifier references missing tower type "${effect.scope.towerTypeId}"${activeMissionIds.length > 0 ? "" : " in this inactive profile"}.`
              );
            }
            if (effect.scope.kind === "tower_tag" && !allTags.has(effect.scope.tag)) {
              semantic(
                "mechanics",
                profileId,
                `${scopePath}.tag`,
                `Draft modifier references missing tower tag "${effect.scope.tag}"${activeMissionIds.length > 0 ? "" : " in this inactive profile"}.`
              );
            }
          });
        }
      }
      if (module.schemaVersion === 3 || module.schemaVersion === 4) {
        for (const missionId of activeMissionIds) {
          const mission = content.missions[missionId];
          if (draft && mission && Math.max(0, mission.waves.length - 1) > ROGUELITE_DRAFT_LIMITS.selections) {
            semantic(
              "mission",
              missionId,
              `missions.${missionId}.mechanics.profiles.roguelite.draft`,
              `Draft mission can require more than ${ROGUELITE_DRAFT_LIMITS.selections} interwave selections.`
            );
          }
          try {
            assertRogueliteV3ModifierBudget(
              profile as ReturnType<typeof normalizeRogueliteProfileV3>,
              content,
              missionId
            );
          } catch (error) {
            semantic(
              "mechanics",
              profileId,
              root,
              error instanceof Error ? error.message : "Roguelite v3 modifier budget is invalid."
            );
          }
        }
      }
    }
  };

  validateRogueliteMechanics();

  const validateDirectorMechanics = () => {
    const inspect = (value: unknown, entityId: string, fieldPath: string, label: string) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain object.`);
        return undefined;
      }
      let prototype: object | null;
      let descriptors: Record<PropertyKey, PropertyDescriptor>;
      try {
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
      } catch {
        err("mechanics", entityId, fieldPath, `${label} could not be inspected safely.`);
        return undefined;
      }
      if (prototype !== Object.prototype && prototype !== null) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain object.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("mechanics", entityId, fieldPath, `${label} must not contain symbol fields.`);
      }
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `${label} fields must be enumerable own data properties.`);
          continue;
        }
        Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
      }
      return result;
    };
    const modules = inspect(content.mechanics.modules, "director", "mechanics.modules", "Mechanics modules");
    const moduleValue = modules?.director;
    if (moduleValue === undefined) return;
    const module = inspect(moduleValue, "director", "modules.director", "Director module");
    if (!module) return;
    const allowedModuleFields = new Set(["schemaVersion", "enabled", "profiles"]);
    for (const key of Object.keys(module)) {
      if (!allowedModuleFields.has(key)) {
        err("mechanics", "director", `modules.director.${key}`, `Director module is closed; unsupported field "${key}".`);
      }
    }
    for (const key of allowedModuleFields) {
      if (!Object.prototype.hasOwnProperty.call(module, key)) {
        err("mechanics", "director", `modules.director.${key}`, `Director module field "${key}" is required.`);
      }
    }
    if (typeof module.enabled !== "boolean") {
      err("mechanics", "director", "modules.director.enabled", "Director enabled must be boolean.");
    }
    const profiles = inspect(module.profiles, "director", "modules.director.profiles", "Director profiles");
    if (module.schemaVersion !== 1) {
      err(
        "mechanics",
        "director",
        "modules.director.schemaVersion",
        `Director mechanics schemaVersion ${String(module.schemaVersion)} is unsupported; supported schemaVersion is 1.`
      );
      return;
    }
    if (!profiles) return;
    const selectedByProfile = new Map<string, string[]>();
    for (const [missionId, mission] of Object.entries(content.missions)) {
      const selected = mission.mechanics?.profiles?.director;
      if (typeof selected !== "string") continue;
      const ids = selectedByProfile.get(selected) ?? [];
      ids.push(missionId);
      selectedByProfile.set(selected, ids);
      if (!Object.prototype.hasOwnProperty.call(profiles, selected)) {
        (module.enabled === true ? err : warn)(
          "mission",
          missionId,
          `missions.${missionId}.mechanics.profiles.director`,
          `Mission "${missionId}" selects unknown Director profile "${selected}".`
        );
      }
    }
    for (const profileId of Object.keys(profiles).sort()) {
      const root = `modules.director.profiles.${profileId}`;
      let profile;
      try {
        profile = normalizeDirectorProfileV1(profiles[profileId]);
      } catch (error) {
        err(
          "mechanics",
          profileId,
          root,
          error instanceof DirectorProfileValidationError || error instanceof Error
            ? error.message
            : "Director profile is invalid."
        );
        continue;
      }
      const active = module.enabled === true && (selectedByProfile.get(profileId)?.length ?? 0) > 0;
      const semantic = active ? err : warn;
      for (const counterId of Object.keys(profile.counterPool).sort()) {
        const counter = profile.counterPool[counterId]!;
        for (let index = 0; index < counter.groups.length; index += 1) {
          const group = counter.groups[index]!;
          if (!enemyIds.has(group.enemyId)) {
            semantic(
              "mechanics",
              profileId,
              `${root}.counterPool.${counterId}.groups[${index}].enemyId`,
              `Director counter "${counterId}" references unknown enemy "${group.enemyId}".`
            );
          }
          if (group.routeId !== undefined) {
            for (const missionId of selectedByProfile.get(profileId) ?? []) {
              const routes = content.maps[content.missions[missionId]?.mapId ?? ""]?.pathRoutes ?? [];
              if (!routes.some((route) => route.id === group.routeId)) {
                semantic(
                  "mechanics",
                  profileId,
                  `${root}.counterPool.${counterId}.groups[${index}].routeId`,
                  `Director counter "${counterId}" references unknown route "${group.routeId}" for mission "${missionId}".`
                );
              }
            }
          }
        }
      }
    }
  };

  validateDirectorMechanics();

  const validateMultiplayerMechanics = () => {
    const inspect = (value: unknown, entityId: string, fieldPath: string, label: string) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain object.`);
        return undefined;
      }
      let prototype: object | null;
      let descriptors: Record<PropertyKey, PropertyDescriptor>;
      try {
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
      } catch {
        err("mechanics", entityId, fieldPath, `${label} could not be inspected safely.`);
        return undefined;
      }
      if (prototype !== Object.prototype && prototype !== null) {
        err("mechanics", entityId, fieldPath, `${label} must be a plain object.`);
        return undefined;
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        err("mechanics", entityId, fieldPath, `${label} must not contain symbol fields.`);
      }
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          err("mechanics", entityId, `${fieldPath}.${key}`, `${label} fields must be enumerable own data properties.`);
          continue;
        }
        Object.defineProperty(result, key, {
          value: descriptor.value,
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      return result;
    };
    const catalog = inspect(content.mechanics, "multiplayer", "mechanics", "Mechanics catalog");
    const modules = catalog
      ? inspect(catalog.modules, "multiplayer", "mechanics.modules", "Mechanics modules")
      : undefined;
    const moduleValue = modules?.multiplayer;
    if (moduleValue === undefined) return;
    const module = inspect(moduleValue, "multiplayer", "modules.multiplayer", "Multiplayer module");
    if (!module) return;
    const allowedModuleFields = new Set(["schemaVersion", "enabled", "profiles"]);
    for (const key of Object.keys(module)) {
      if (!allowedModuleFields.has(key)) {
        err(
          "mechanics",
          "multiplayer",
          `modules.multiplayer.${key}`,
          `Multiplayer module is closed; unsupported field "${key}".`
        );
      }
    }
    if (module.schemaVersion !== 1 && module.schemaVersion !== 2) {
      err(
        "mechanics",
        "multiplayer",
        "modules.multiplayer.schemaVersion",
        "Multiplayer future or unsupported schemaVersion; only versions 1 and 2 are supported."
      );
    }
    if (typeof module.enabled !== "boolean") {
      err("mechanics", "multiplayer", "modules.multiplayer.enabled", "Multiplayer enabled must be boolean.");
    }
    const profiles = inspect(
      module.profiles,
      "multiplayer",
      "modules.multiplayer.profiles",
      "Multiplayer profiles"
    );
    if (!profiles || (module.schemaVersion !== 1 && module.schemaVersion !== 2)) return;

    const selectedByProfile = new Map<string, string[]>();
    for (const [missionId, mission] of Object.entries(content.missions)) {
      const profileId = mission.mechanics?.profiles?.multiplayer;
      if (typeof profileId !== "string") continue;
      const missions = selectedByProfile.get(profileId) ?? [];
      missions.push(missionId);
      selectedByProfile.set(profileId, missions);
      if (!Object.prototype.hasOwnProperty.call(profiles, profileId)) {
        (module.enabled === true ? err : warn)(
          "mission",
          missionId,
          "mechanics.profiles.multiplayer",
          `Mission selects missing multiplayer profile "${profileId}"${module.enabled === true ? "." : " from an inactive module."}`
        );
      }
    }

    for (const profileId of Object.keys(profiles).sort()) {
      const root = `modules.multiplayer.profiles.${profileId}`;
      const active = module.enabled === true && (selectedByProfile.get(profileId)?.length ?? 0) > 0;
      try {
        const normalized = module.schemaVersion === 1
          ? normalizeMultiplayerProfileV1(profiles[profileId])
          : normalizeMultiplayerProfileV2(profiles[profileId]);
        if (normalized.mode === "local_coop") {
          if (normalized.ownership.routes === "partitioned") {
            for (const missionId of selectedByProfile.get(profileId) ?? []) {
              const mission = content.missions[missionId];
              const routeCount = mission ? content.maps[mission.mapId]?.pathRoutes?.length ?? 0 : 0;
              if (routeCount < normalized.maxPlayers) {
                (active ? err : warn)(
                  "mechanics",
                  profileId,
                  `${root}.ownership.routes`,
                  `Partitioned co-op requires at least ${normalized.maxPlayers} authored routes for mission "${missionId}".`
                );
              }
            }
          }
        }
        if (normalized.mode === "asymmetric_send_vs_build") for (const [sendId, send] of Object.entries(normalized.sendPool)) {
            if (!Object.prototype.hasOwnProperty.call(content.enemies, send.enemyTypeId)) {
              (active ? err : warn)(
                "mechanics",
                profileId,
                `${root}.sendPool.${sendId}.enemyTypeId`,
                `Multiplayer send references unknown enemy "${send.enemyTypeId}".`
              );
            }
            if (send.routeId !== undefined) {
              for (const missionId of selectedByProfile.get(profileId) ?? []) {
                const mission = content.missions[missionId];
                const routes = mission ? content.maps[mission.mapId]?.pathRoutes ?? [] : [];
                if (!routes.some((route) => route.id === send.routeId)) {
                  (active ? err : warn)(
                    "mechanics",
                    profileId,
                    `${root}.sendPool.${sendId}.routeId`,
                    `Multiplayer send references unknown route "${send.routeId}" for mission "${missionId}".`
                  );
                }
              }
            }
        }
      } catch (error) {
        const relative = error instanceof MultiplayerProfileValidationError
          ? error.fieldPath.replace(/^profile(?=\.|$)/, "")
          : "";
        const report = error instanceof MultiplayerProfileValidationError && !error.structural && !active
          ? warn
          : err;
        report(
          "mechanics",
          profileId,
          `${root}${relative}`,
          error instanceof Error ? error.message : "Multiplayer profile could not be inspected safely."
        );
      }
    }
  };

  validateMultiplayerMechanics();

  // Source cardinality limits are relevant only to gameplay surfaces that can actually be
  // reached from a mission with a genuinely active physics capability. Structural inspection
  // below remains unconditional for every authored effect.
  const activePhysicsAbilityIds = new Set<string>();
  const activePhysicsTowerIds = new Set<string>();
  for (const mission of Object.values(content.missions)) {
    if (!resolveActivePhysicsMechanics(content, mission.id)) continue;
    mission.abilityIds.forEach((abilityId) => activePhysicsAbilityIds.add(abilityId));
    const pending = [...mission.buildTowerIds];
    while (pending.length > 0) {
      const towerId = pending.shift()!;
      if (activePhysicsTowerIds.has(towerId)) continue;
      activePhysicsTowerIds.add(towerId);
      const tower = content.towers[towerId];
      if (tower?.attack.kind === "support") pending.push(...tower.attack.unlocksTowerIds);
    }
  }

  const requireFinite = (
    value: unknown,
    entityKind: string,
    entityId: string,
    fieldPath: string,
    opts: { positive?: boolean; allowNegative?: boolean } = {}
  ) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      err(entityKind, entityId, fieldPath, `${fieldPath} must be a finite number (got ${JSON.stringify(value)}).`, {
        expected: "finite number",
        got: JSON.stringify(value)
      });
      return false;
    }
    if (!opts.allowNegative && (opts.positive ? value <= 0 : value < 0)) {
      const expected = opts.positive ? "> 0" : ">= 0";
      err(entityKind, entityId, fieldPath, `${fieldPath} must be ${expected} (got ${value}).`, { expected, got: String(value) });
      return false;
    }
    return true;
  };

  // Currencies — the declared spendable set; "coins" is required as the primary currency.
  const currencyIds = new Set<string>();
  for (const currency of content.currencies ?? []) {
    if (!currency || typeof currency.id !== "string" || currency.id.length === 0) {
      err("currency", "?", "id", `A currency is missing a valid id.`);
      continue;
    }
    if (currencyIds.has(currency.id)) {
      err("currency", currency.id, "id", `Duplicate currency id "${currency.id}".`);
    }
    if (!/^[A-Za-z0-9_]+$/.test(currency.id)) {
      err("currency", currency.id, "id", `Currency id "${currency.id}" must be alphanumeric/underscore.`);
    }
    currencyIds.add(currency.id);
    if (typeof currency.label !== "string" || currency.label.length === 0) {
      err("currency", currency.id, "label", `Currency "${currency.id}" needs a non-empty label.`);
    }
  }
  if (!currencyIds.has("coins")) {
    err("currency", "coins", "id", `A "coins" currency is required as the primary currency.`);
    currencyIds.add("coins");
  }

  const allMissionIds = [...missionIds].sort();
  const applicableMissionIdsForScript = (script: TowerScriptDefinition): Set<string> => {
    const applicable = new Set<string>();
    const addAllMissions = () => allMissionIds.forEach((missionId) => applicable.add(missionId));
    for (const binding of Array.isArray(script.bindings) ? script.bindings : []) {
      if (!binding || typeof binding !== "object") continue;
      const ids = Array.isArray(binding.ids)
        ? new Set(binding.ids.filter((id): id is string => typeof id === "string"))
        : undefined;
      if (binding.scope === "global" || binding.scope === "enemy" || binding.scope === "terrain") {
        // Enemy and terrain contexts can be introduced dynamically by typed TowerScript actions,
        // so static validation deliberately uses the conservative all-missions scope.
        addAllMissions();
        continue;
      }
      for (const [missionId, mission] of Object.entries(content.missions)) {
        const applies = binding.scope === "mission"
          ? ids === undefined || ids.has(missionId)
          : binding.scope === "map"
            ? ids === undefined || ids.has(mission.mapId)
            : binding.scope === "wave"
              ? ids === undefined || ids.has(mission.waveSetId)
              : binding.scope === "tower"
                ? mission.buildTowerIds.some((towerId) => ids === undefined || ids.has(towerId))
                : binding.scope === "ability"
                  ? mission.abilityIds.some((abilityId) => ids === undefined || ids.has(abilityId))
                  : false;
        if (applies) applicable.add(missionId);
      }
    }
    return applicable;
  };

  interface ScriptMarkReference {
    scriptId: string;
    fieldPath: string;
    markId: string;
  }
  interface ScriptTerraformingTransitionReference {
    scriptId: string;
    fieldPath: string;
    transitionId: string;
  }
  const markReferences: ScriptMarkReference[] = [];
  const terraformingTransitionReferences: ScriptTerraformingTransitionReference[] = [];
  const ownDataField = (value: unknown, key: string): { value: unknown } | undefined => {
    if (value === null || typeof value !== "object") return undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable && "value" in descriptor ? { value: descriptor.value } : undefined;
    } catch {
      return undefined;
    }
  };
  const denseOwnDataItems = (value: unknown): readonly unknown[] | undefined => {
    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    let prototype: object | null;
    try {
      prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
      descriptors = value !== null && typeof value === "object"
        ? Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>
        : {};
    } catch {
      return undefined;
    }
    if (!Array.isArray(value) || prototype !== Array.prototype) return undefined;
    const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : undefined;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    if (Reflect.ownKeys(descriptors).some((key) => {
      if (key === "length") return false;
      return typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length;
    })) return undefined;
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !("value" in descriptor)) return undefined;
      result.push(descriptor.value);
    }
    return result;
  };
  const collectTerraformingTransitionReferences = (
    scriptKey: string,
    script: unknown
  ): void => {
    const authoredScriptId = ownDataField(script, "id")?.value;
    const scriptId = typeof authoredScriptId === "string" ? authoredScriptId : scriptKey;
    const handlers = ownDataField(script, "handlers")?.value;
    if (handlers === null || typeof handlers !== "object" || Array.isArray(handlers)) return;
    let handlerDescriptors: Record<PropertyKey, PropertyDescriptor>;
    try {
      handlerDescriptors = Object.getOwnPropertyDescriptors(handlers) as Record<PropertyKey, PropertyDescriptor>;
    } catch {
      return;
    }
    for (const eventName of Object.keys(handlerDescriptors)) {
      const eventDescriptor = handlerDescriptors[eventName];
      if (!eventDescriptor?.enumerable || !("value" in eventDescriptor)) continue;
      const handlerItems = denseOwnDataItems(eventDescriptor.value);
      if (!handlerItems) continue;
      handlerItems.forEach((handler, handlerIndex) => {
        const actionItems = denseOwnDataItems(ownDataField(handler, "actions")?.value);
        if (!actionItems) return;
        actionItems.forEach((action, actionIndex) => {
          if (ownDataField(action, "action")?.value !== "terraformTiles") return;
          const operationItems = denseOwnDataItems(ownDataField(action, "operations")?.value);
          if (!operationItems) return;
          operationItems.forEach((operation, operationIndex) => {
            if (ownDataField(operation, "kind")?.value !== "set_terrain") return;
            const transitionId = ownDataField(operation, "transitionId")?.value;
            if (typeof transitionId !== "string") return;
            terraformingTransitionReferences.push({
              scriptId,
              fieldPath: `handlers.${eventName}[${handlerIndex}].actions[${actionIndex}].operations[${operationIndex}].transitionId`,
              transitionId
            });
          });
        });
      });
    }
  };
  const authoredExposureIds = new Set<string>();
  const authoredReactionIds = new Set<string>();
  const reactionModule = content.mechanics.modules.reactions;
  if (reactionModule?.profiles && typeof reactionModule.profiles === "object") {
    for (const profile of Object.values(reactionModule.profiles)) {
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) continue;
      try {
        const profileDescriptors = Object.getOwnPropertyDescriptors(profile);
        const exposureDescriptor = profileDescriptors.exposures;
        const reactionsDescriptor = profileDescriptors.reactions;
        if (exposureDescriptor?.enumerable && "value" in exposureDescriptor) {
          const exposureDescriptors = Object.getOwnPropertyDescriptors(exposureDescriptor.value as object);
          const definitionsDescriptor = exposureDescriptors.definitions;
          if (definitionsDescriptor?.enumerable && "value" in definitionsDescriptor && definitionsDescriptor.value && typeof definitionsDescriptor.value === "object") {
            Object.keys(Object.getOwnPropertyDescriptors(definitionsDescriptor.value as object)).forEach((id) => authoredExposureIds.add(id));
          }
        }
        if (reactionsDescriptor?.enumerable && "value" in reactionsDescriptor && reactionsDescriptor.value && typeof reactionsDescriptor.value === "object") {
          Object.keys(Object.getOwnPropertyDescriptors(reactionsDescriptor.value as object)).forEach((id) => authoredReactionIds.add(id));
        }
      } catch {
        // Descriptor-safe mechanics validation above already reports hostile shapes.
      }
    }
  }
  const applicableMissionIdsByScript = new Map<string, Set<string>>();
  const activeMissionIdsByScript = new Map<string, Set<string>>();
  for (const [scriptKey, script] of Object.entries(content.scripts as Record<string, TowerScriptDefinition>)) {
    collectTerraformingTransitionReferences(scriptKey, script);
    const scriptId = typeof script?.id === "string" ? script.id : scriptKey;
    const applicableMissionIds = applicableMissionIdsForScript(script);
    applicableMissionIdsByScript.set(scriptId, applicableMissionIds);
    const activeMissionIds = new Set(
      [...applicableMissionIds].filter((missionId) => activeMarkIdsByMission.has(missionId))
    );
    activeMissionIdsByScript.set(scriptId, activeMissionIds);
    if (!script?.handlers || typeof script.handlers !== "object" || Array.isArray(script.handlers)) continue;
    for (const [eventName, handlers] of Object.entries(script.handlers)) {
      if (!Array.isArray(handlers)) continue;
      handlers.forEach((handler, handlerIndex) => {
        if (!handler || !Array.isArray(handler.actions)) return;
        handler.actions.forEach((action, actionIndex) => {
          if (!action || typeof action !== "object" || Array.isArray(action)) return;
          let descriptors: Record<PropertyKey, PropertyDescriptor>;
          try {
            descriptors = Object.getOwnPropertyDescriptors(action) as Record<PropertyKey, PropertyDescriptor>;
          } catch {
            return;
          }
          const actionDescriptor = descriptors.action;
          const markIdDescriptor = descriptors.markId;
          const actionKind = actionDescriptor?.enumerable && "value" in actionDescriptor
            ? actionDescriptor.value
            : undefined;
          const markId = markIdDescriptor?.enumerable && "value" in markIdDescriptor
            ? markIdDescriptor.value
            : undefined;
          if (
            (actionKind !== "applyEnemyMark" && actionKind !== "clearEnemyMark")
            || typeof markId !== "string"
          ) return;
          markReferences.push({
            scriptId,
            fieldPath: `handlers.${eventName}[${handlerIndex}].actions[${actionIndex}].markId`,
            markId
          });
        });
      });
    }
  }

  for (const issue of validateTowerScriptDefinitions(
    content.scripts as Record<string, TowerScriptDefinition>,
    {
      missionIds,
      mapIds,
      waveSetIds,
      towerIds,
      enemyIds,
      abilityIds,
      currencyIds,
      terrainIds: new Set(Object.keys(content.terrainTypes)),
      // The generic TowerScript validator checks project-wide authorship. Mission/profile
      // activation is classified immediately below without making inactive modules blocking.
      markIds: authoredMarkIds,
      exposureIds: authoredExposureIds,
      reactionIds: authoredReactionIds
    }
  )) {
    if (/^Unknown mark /i.test(issue.message)) {
      const activeMissionIds = activeMissionIdsByScript.get(issue.scriptId)
        ?? new Set(activeMarkIdsByMission.keys());
      if (activeMissionIds.size === 0 && hasAuthoredMarks) {
        warn("script", issue.scriptId, issue.fieldPath, issue.message);
      } else {
        err("script", issue.scriptId, issue.fieldPath, issue.message);
      }
    } else {
      err("script", issue.scriptId, issue.fieldPath, issue.message);
    }
  }

  const scriptedTargetingOwners = new Map<string, string>();
  const allTowerIds = Object.keys(content.towers).sort();
  for (const script of Object.values(content.scripts).sort((left, right) => left.id.localeCompare(right.id))) {
    if (!script || script.enabled === false || script.schemaVersion !== 7) continue;
    let rawTrees: readonly unknown[] | undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(script, "behaviorTrees");
      rawTrees = descriptor?.enumerable && "value" in descriptor && Array.isArray(descriptor.value)
        ? descriptor.value
        : undefined;
    } catch {
      rawTrees = undefined;
    }
    rawTrees?.forEach((rawTree, treeIndex) => {
      try {
        if (!rawTree || typeof rawTree !== "object" || Array.isArray(rawTree)) return;
        const fields = Object.getOwnPropertyDescriptors(rawTree);
        const idDescriptor = fields.id;
        const bindingsDescriptor = fields.bindings;
        const treeId = idDescriptor?.enumerable && "value" in idDescriptor && typeof idDescriptor.value === "string"
          ? idDescriptor.value
          : String(treeIndex);
        const bindings = bindingsDescriptor?.enumerable && "value" in bindingsDescriptor && Array.isArray(bindingsDescriptor.value)
          ? bindingsDescriptor.value as readonly unknown[]
          : undefined;
        bindings?.forEach((rawBinding, bindingIndex) => {
          if (!rawBinding || typeof rawBinding !== "object" || Array.isArray(rawBinding)) return;
          const bindingFields = Object.getOwnPropertyDescriptors(rawBinding);
          const scope = bindingFields.scope;
          if (!scope?.enumerable || !("value" in scope) || scope.value !== "tower") return;
          const idsDescriptor = bindingFields.ids;
          const selectedTowerIds = idsDescriptor?.enumerable && "value" in idsDescriptor && Array.isArray(idsDescriptor.value)
            ? idsDescriptor.value.filter((id): id is string => typeof id === "string")
            : allTowerIds;
          for (const towerId of selectedTowerIds) {
            const tower = content.towers[towerId];
            if (!tower) continue;
            const unsupported = tower.attack.kind === "support"
              || tower.attack.kind === "support_buff"
              || tower.attack.kind === "pulse"
              || (tower.attack.kind === "pipeline" && tower.attack.delivery.kind === "aura");
            const path = `behaviorTrees[${treeIndex}].bindings[${bindingIndex}]`;
            if (unsupported) {
              err("script", script.id, path, `Behavior Tree targeting is not supported by tower "${towerId}" attack kind/delivery.`);
              continue;
            }
            const owner = scriptedTargetingOwners.get(towerId);
            const nextOwner = `${script.id}:${treeId}`;
            if (owner && owner !== nextOwner) {
              err("script", script.id, path, `Tower "${towerId}" has overlapping Behavior Tree targeting owners "${owner}" and "${nextOwner}".`);
            } else scriptedTargetingOwners.set(towerId, nextOwner);
          }
        });
      } catch {
        // The descriptor-safe scripting validator above owns hostile-shape diagnostics.
      }
    });
  }

  const transitionIdUtf8Bytes = (value: string): number => {
    let bytes = 0;
    for (const character of value) {
      const point = character.codePointAt(0)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    return bytes;
  };
  for (const reference of terraformingTransitionReferences) {
    if (reference.transitionId.length === 0
      || transitionIdUtf8Bytes(reference.transitionId) > TERRAFORMING_LIMITS.idOrTagUtf8Bytes) continue;
    const applicableMissionIds = applicableMissionIdsByScript.get(reference.scriptId) ?? new Set<string>();
    const activeMissionIds = [...applicableMissionIds]
      .filter((missionId) => activeTerraformingTransitionIdsByMission.has(missionId))
      .sort();
    const missingActiveMissionIds = activeMissionIds.filter((missionId) => (
      !activeTerraformingTransitionIdsByMission.get(missionId)?.has(reference.transitionId)
    ));
    if (missingActiveMissionIds.length > 0) {
      err(
        "script",
        reference.scriptId,
        reference.fieldPath,
        `Unknown terraforming transition "${reference.transitionId}" for active applicable mission profile(s): ${missingActiveMissionIds.join(", ")}.`
      );
    }
    const inactiveMissionIds = [...applicableMissionIds]
      .filter((missionId) => !activeTerraformingTransitionIdsByMission.has(missionId))
      .sort();
    if (activeMissionIds.length === 0 && applicableMissionIds.size > 0) {
      warn(
        "script",
        reference.scriptId,
        reference.fieldPath,
        `Terraforming transition "${reference.transitionId}" is not active in any applicable mission; its profile is inactive or unselected.`
      );
    } else if (inactiveMissionIds.length > 0) {
      warn(
        "script",
        reference.scriptId,
        reference.fieldPath,
        `Terraforming transition "${reference.transitionId}" also applies to inactive or unselected mission(s): ${inactiveMissionIds.join(", ")}.`
      );
    }
  }

  const safeTowerScriptId = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
  for (const reference of markReferences) {
    if (!safeTowerScriptId.test(reference.markId) || !authoredMarkIds.has(reference.markId)) continue;
    if (!activeMarkIds.has(reference.markId)) {
      warn(
        "script",
        reference.scriptId,
        reference.fieldPath,
        `Mark "${reference.markId}" is authored only by an inactive or unselected combat profile for this script scope.`
      );
      continue;
    }
    const applicableMissionIds = applicableMissionIdsByScript.get(reference.scriptId) ?? new Set<string>();
    const activeMissionIds = activeMissionIdsByScript.get(reference.scriptId) ?? new Set<string>();
    if (activeMissionIds.size === 0) {
      if (applicableMissionIds.size > 0) {
        warn(
          "script",
          reference.scriptId,
          reference.fieldPath,
          `Mark "${reference.markId}" is not active in any mission applicable to this script scope.`
        );
      }
      continue;
    }
    const missingMissionIds = [...activeMissionIds]
      .filter((missionId) => !activeMarkIdsByMission.get(missionId)?.has(reference.markId))
      .sort();
    if (missingMissionIds.length > 0) {
      err(
        "script",
        reference.scriptId,
        reference.fieldPath,
        `Mark "${reference.markId}" is not active for applicable mission profile(s): ${missingMissionIds.join(", ")}.`
      );
    }
    const inactiveMissionIds = [...applicableMissionIds]
      .filter((missionId) => !activeMarkIdsByMission.has(missionId))
      .sort();
    if (inactiveMissionIds.length > 0) {
      warn(
        "script",
        reference.scriptId,
        reference.fieldPath,
        `Mark "${reference.markId}" also applies to legacy or inactive combat mission(s): ${inactiveMissionIds.join(", ")}.`
      );
    }
  }

  /** Validate a resource bag: every key must be a declared currency, every amount a finite number >= 0. */
  const validateBag = (
    bag: unknown,
    entityKind: string,
    entityId: string,
    fieldPath: string
  ) => {
    if (bag === undefined || bag === null) return;
    if (typeof bag !== "object") {
      err(entityKind, entityId, fieldPath, `${fieldPath} must be an object.`);
      return;
    }
    for (const [id, amount] of Object.entries(bag as Record<string, unknown>)) {
      if (!currencyIds.has(id)) {
        err(entityKind, entityId, `${fieldPath}.${id}`, `Unknown currency "${id}" — declare it in balance.currencies.`);
      }
      requireFinite(amount, entityKind, entityId, `${fieldPath}.${id}`);
    }
  };

  // Difficulty and persistent progression are launch-time/player-profile data. They are validated
  // here because they share the canonical balance contract, but the simulation never owns storage.
  const difficultyIds = new Set<string>();
  const rawDifficulties: unknown = content.difficulties;
  const difficulties = Array.isArray(rawDifficulties) ? rawDifficulties : [];
  if (!Array.isArray(rawDifficulties)) {
    err("difficulty", "?", "difficulties", "difficulties must be an array.");
  }
  for (const difficulty of difficulties) {
    if (!difficulty?.id || typeof difficulty.id !== "string") {
      err("difficulty", "?", "id", "Difficulty needs a non-empty id.");
      continue;
    }
    if (difficultyIds.has(difficulty.id)) err("difficulty", difficulty.id, "id", `Duplicate difficulty id "${difficulty.id}".`);
    difficultyIds.add(difficulty.id);
    if (typeof difficulty.label !== "string" || !difficulty.label.trim()) err("difficulty", difficulty.id, "label", `Difficulty "${difficulty.id}" needs a label.`);
    for (const field of ["enemyHpMultiplier", "enemySpeedMultiplier", "startingResourceMultiplier", "coreHpMultiplier"] as const) {
      if (difficulty[field] !== undefined) requireFinite(difficulty[field], "difficulty", difficulty.id, field, { positive: true });
    }
    for (const field of ["enemyRewardMultiplier", "coreDamageMultiplier"] as const) {
      if (difficulty[field] !== undefined) requireFinite(difficulty[field], "difficulty", difficulty.id, field);
    }
  }
  if (!difficultyIds.has(content.defaultDifficultyId)) {
    err("difficulty", content.defaultDifficultyId, "defaultDifficultyId", `Default difficulty "${content.defaultDifficultyId}" is not defined.`);
  }

  const rawMetaProgression: unknown = content.metaProgression;
  const metaProgression = isRecord(rawMetaProgression) ? rawMetaProgression : undefined;
  if (!metaProgression) {
    err("metaProgression", "?", "root", "metaProgression must be an object.");
  }

  const rawMetaCurrencies = metaProgression?.currencies;
  const metaCurrencies = Array.isArray(rawMetaCurrencies) ? rawMetaCurrencies : [];
  if (rawMetaCurrencies !== undefined && !Array.isArray(rawMetaCurrencies)) {
    err("metaProgression", "?", "currencies", "metaProgression.currencies must be an array.");
  }
  const metaCurrencyIds = new Set<string>();
  for (const currency of metaCurrencies) {
    if (!currency?.id || typeof currency.id !== "string" || !/^[A-Za-z0-9_]+$/.test(currency.id)) {
      err("metaCurrency", currency?.id ?? "?", "id", "Meta currency id must be alphanumeric/underscore.");
      continue;
    }
    if (metaCurrencyIds.has(currency.id)) err("metaCurrency", currency.id, "id", `Duplicate meta currency id "${currency.id}".`);
    metaCurrencyIds.add(currency.id);
    if (typeof currency.label !== "string" || !currency.label.trim()) err("metaCurrency", currency.id, "label", `Meta currency "${currency.id}" needs a label.`);
  }
  const validateMetaBag = (bag: unknown, entityKind: string, entityId: string, fieldPath: string) => {
    if (bag === undefined) return;
    if (!bag || typeof bag !== "object" || Array.isArray(bag)) {
      err(entityKind, entityId, fieldPath, `${fieldPath} must be an object.`);
      return;
    }
    for (const [currencyId, amount] of Object.entries(bag)) {
      if (!metaCurrencyIds.has(currencyId)) err(entityKind, entityId, `${fieldPath}.${currencyId}`, `Unknown meta currency "${currencyId}".`);
      requireFinite(amount, entityKind, entityId, `${fieldPath}.${currencyId}`);
    }
  };
  const rawMetaUpgrades = metaProgression?.upgrades;
  const metaUpgrades = isRecord(rawMetaUpgrades) ? rawMetaUpgrades : {};
  if (rawMetaUpgrades !== undefined && !isRecord(rawMetaUpgrades)) {
    err("metaProgression", "?", "upgrades", "metaProgression.upgrades must be an object keyed by upgrade ID.");
  }
  for (const [upgradeId, upgrade] of Object.entries(metaUpgrades)) {
    if (!isRecord(upgrade)) {
      err("metaUpgrade", upgradeId, "root", `Meta upgrade "${upgradeId}" must be an object.`);
      continue;
    }
    if (upgrade.id !== upgradeId) err("metaUpgrade", upgradeId, "id", `Meta upgrade key "${upgradeId}" has mismatched id "${upgrade.id}".`);
    if (typeof upgrade.label !== "string" || !upgrade.label.trim()) err("metaUpgrade", upgradeId, "label", `Meta upgrade "${upgradeId}" needs a label.`);
    const maxLevel = upgrade.maxLevel;
    if (typeof maxLevel !== "number" || !Number.isInteger(maxLevel) || maxLevel <= 0) err("metaUpgrade", upgradeId, "maxLevel", "maxLevel must be a positive integer.");
    if (!Array.isArray(upgrade.costs) || upgrade.costs.length !== maxLevel) {
      err("metaUpgrade", upgradeId, "costs", `Meta upgrade "${upgradeId}" must define one cost per level.`);
    } else upgrade.costs.forEach((cost, index) => validateMetaBag(cost, "metaUpgrade", upgradeId, `costs[${index}]`));
    if (!Array.isArray(upgrade.effects) || upgrade.effects.length === 0) {
      err("metaUpgrade", upgradeId, "effects", `Meta upgrade "${upgradeId}" needs at least one effect.`);
    } else upgrade.effects.forEach((effect, index) => {
      const base = `effects[${index}]`;
      if (!isRecord(effect)) {
        err("metaUpgrade", upgradeId, base, `${base} must be an effect object.`);
        return;
      }
      if (effect.kind === "towerDamage" || effect.kind === "towerFireRate") {
        requireFinite(effect.multiplierPerLevel, "metaUpgrade", upgradeId, `${base}.multiplierPerLevel`);
      } else if (effect.kind === "startingResource") {
        if (typeof effect.resourceId !== "string" || !currencyIds.has(effect.resourceId)) err("metaUpgrade", upgradeId, `${base}.resourceId`, `Unknown runtime currency "${String(effect.resourceId)}".`);
        requireFinite(effect.amountPerLevel, "metaUpgrade", upgradeId, `${base}.amountPerLevel`);
      } else if (effect.kind === "coreHp") {
        requireFinite(effect.amountPerLevel, "metaUpgrade", upgradeId, `${base}.amountPerLevel`);
      } else {
        err("metaUpgrade", upgradeId, `${base}.kind`, `Unsupported meta upgrade effect "${String((effect as { kind?: unknown }).kind)}".`);
      }
    });
  }
  const rawMetaRewards = metaProgression?.rewardsByMission;
  const metaRewards = isRecord(rawMetaRewards) ? rawMetaRewards : {};
  if (rawMetaRewards !== undefined && !isRecord(rawMetaRewards)) {
    err("metaProgression", "?", "rewardsByMission", "metaProgression.rewardsByMission must be an object keyed by mission ID.");
  }
  for (const [missionId, reward] of Object.entries(metaRewards)) {
    if (!isRecord(reward)) {
      err("metaReward", missionId, "root", `Meta reward for "${missionId}" must be an object.`);
      continue;
    }
    if (!missionIds.has(missionId)) err("metaReward", missionId, "missionId", `Meta reward references unknown mission "${missionId}".`);
    validateMetaBag(reward.firstClear, "metaReward", missionId, "firstClear");
    validateMetaBag(reward.repeatClear, "metaReward", missionId, "repeatClear");
    validateMetaBag(reward.perStar, "metaReward", missionId, "perStar");
  }

  const validateTargetClasses = (value: unknown, entityKind: string, entityId: string, fieldPath: string) => {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.length === 0) {
      err(entityKind, entityId, fieldPath, `${fieldPath} must be a non-empty array containing "ground" and/or "flying".`, {
        expected: '("ground" | "flying")[]', got: JSON.stringify(value)
      });
      return;
    }
    const seen = new Set<string>();
    for (const targetClass of value) {
      if (targetClass !== "ground" && targetClass !== "flying") {
        err(entityKind, entityId, fieldPath, `${fieldPath} contains unknown target class ${JSON.stringify(targetClass)}.`, {
          expected: '"ground" or "flying"', got: JSON.stringify(targetClass)
        });
      } else if (seen.has(targetClass)) {
        err(entityKind, entityId, fieldPath, `${fieldPath} contains duplicate target class "${targetClass}".`);
      }
      seen.add(String(targetClass));
    }
  };

  // Constants resource bags
  validateBag(content.constants?.startingResources, "registry", "constants", "startingResources");
  validateBag(content.constants?.moveTowerCost, "registry", "constants", "moveTowerCost");

  // Default mission
  if (!missionIds.has(content.defaultMissionId)) {
    err("registry", "root", "defaultMissionId", `Default mission "${content.defaultMissionId}" is not defined.`);
  }

  /** Shared by a tower's attack.statusOnHit and an ability's {kind:"status"} effect — one status vocabulary, one validator. */
  const validateStatusEffectSpec = (
    spec: { stun?: unknown; slow?: { factor?: unknown; duration?: unknown }; poison?: { dps?: unknown; duration?: unknown }; slowAffectsClasses?: unknown },
    entityKind: string,
    entityId: string,
    fieldPath: string
  ) => {
    validateTargetClasses(spec.slowAffectsClasses, entityKind, entityId, `${fieldPath}.slowAffectsClasses`);
    if (spec.stun !== undefined) requireFinite(spec.stun, entityKind, entityId, `${fieldPath}.stun`, { positive: true });
    if (spec.slow) {
      if (requireFinite(spec.slow.factor, entityKind, entityId, `${fieldPath}.slow.factor`, { positive: true }) && (spec.slow.factor as number) >= 1) {
        err(entityKind, entityId, `${fieldPath}.slow.factor`, `${fieldPath}.slow.factor must be < 1.`, {
          expected: "0 < factor < 1",
          got: String(spec.slow.factor),
          hint: "slow.factor multiplies speed (0.5 = half speed) — it must be strictly less than 1, or the enemy wouldn't actually slow down."
        });
      }
      requireFinite(spec.slow.duration, entityKind, entityId, `${fieldPath}.slow.duration`, { positive: true });
    }
    if (spec.poison) {
      requireFinite(spec.poison.dps, entityKind, entityId, `${fieldPath}.poison.dps`, { positive: true });
      requireFinite(spec.poison.duration, entityKind, entityId, `${fieldPath}.poison.duration`, { positive: true });
    }
  };

  const validateDisplacementEffect = (
    effectValue: unknown,
    entityKind: string,
    entityId: string,
    fieldPath: string
  ): boolean => {
    const inspected = inspectOwnDataEffect(effectValue);
    if (!inspected.ok) {
      err(
        entityKind,
        entityId,
        fieldPath,
        "Displacement effect must be a plain own-data object with enumerable data properties; accessors and inherited fields are not inspected."
      );
      return false;
    }
    const effect = inspected.record;
    const allowed = new Set(["kind", "mode", "distance", "stopAtBlocker"]);
    for (const key of Object.keys(effect)) {
      if (!allowed.has(key)) {
        err(entityKind, entityId, `${fieldPath}.${key}`, `Displacement effect is closed and does not support field "${key}".`);
      }
    }
    if (effect.mode !== "push" && effect.mode !== "pull") {
      err(entityKind, entityId, `${fieldPath}.mode`, "Displacement mode must be push or pull.");
    }
    if (!Number.isSafeInteger(effect.distance)
      || (effect.distance as number) < 1
      || (effect.distance as number) > PHYSICS_LIMITS.displacementDistance) {
      err(
        entityKind,
        entityId,
        `${fieldPath}.distance`,
        `Displacement distance must be a positive safe integer no greater than ${PHYSICS_LIMITS.displacementDistance}.`
      );
    }
    if (typeof effect.stopAtBlocker !== "boolean") {
      err(entityKind, entityId, `${fieldPath}.stopAtBlocker`, "Displacement stopAtBlocker must be boolean.");
    }
    return parseDisplacementEffectV1(effect) !== undefined;
  };

  // Abilities — `path_water`/`strike`/`freeze` are engine-implemented presets (schema-descriptor.ts
  // is the single source of truth for their required fields); any OTHER id is a custom,
  // author-defined ability and must declare `effects` (a composition of the same damage/status
  // primitives a tower attack can carry). An id may also be one of the three presets AND declare
  // `effects` — that explicit composition then overrides the built-in behavior.
  const PRESET_ABILITY_IDS = new Set<string>(ABILITY_IDS);
  for (const [abilityId, ability] of Object.entries(content.abilities)) {
    if (!ability) continue;
    const isPreset = PRESET_ABILITY_IDS.has(abilityId);
    const hasEffects = Array.isArray(ability.effects) && ability.effects.length > 0;
    if (!isPreset && !hasEffects) {
      err(
        "ability",
        abilityId,
        "id",
        `Unknown ability "${abilityId}" — declare "effects" for a custom ability, or use a preset id (${ABILITY_IDS.join(", ")}).`,
        {
          expected: `a preset id (${ABILITY_IDS.join(", ")}) or an "effects" array`,
          got: abilityId,
          hint: 'Any ability id is valid once it declares effects: [{kind:"damage", amount} | {kind:"status", status:{stun|slow|poison}}] — call describe_schema for the exact shape.'
        }
      );
      continue;
    }
    requireFinite(ability.cooldown, "ability", abilityId, "cooldown");
    requireFinite(ability.radius, "ability", abilityId, "radius", { positive: true });
    if (hasEffects) {
      let displacementEffectCount = 0;
      ability.effects!.forEach((effect, i) => {
        const inspected = inspectOwnDataEffect(effect);
        if (!inspected.ok) {
          err(
            "ability",
            abilityId,
            `effects[${i}]`,
            `${abilityId} effects[${i}] must be a plain own-data object with enumerable data properties; accessors and inherited fields are not inspected.`
          );
          return;
        }
        const record = inspected.record;
        if (inspected.kind === "damage") {
          requireFinite(record.amount, "ability", abilityId, `effects[${i}].amount`, { positive: true });
        } else if (inspected.kind === "status") {
          validateStatusEffectSpec((record.status ?? {}) as Parameters<typeof validateStatusEffectSpec>[0], "ability", abilityId, `effects[${i}].status`);
        } else if (inspected.kind === "displacement") {
          displacementEffectCount += 1;
          if (
            activePhysicsAbilityIds.has(abilityId)
            && displacementEffectCount === PHYSICS_LIMITS.displacementEffectsPerSource + 1
          ) {
            err(
              "ability",
              abilityId,
              `effects[${i}]`,
              `Active physics ability sources support at most ${PHYSICS_LIMITS.displacementEffectsPerSource} displacement effects.`
            );
          }
          validateDisplacementEffect(record, "ability", abilityId, `effects[${i}]`);
        } else {
          err("ability", abilityId, `effects[${i}].kind`, `${abilityId} effects[${i}].kind must be "damage", "status", or "displacement".`);
        }
      });
    } else {
      // No explicit effects: falls back to the built-in preset, which needs its own legacy fields.
      if (abilityId === "path_water" || abilityId === "freeze") {
        requireFinite(ability.duration, "ability", abilityId, "duration", { positive: true });
      }
      if (abilityId === "strike") {
        requireFinite(ability.damage, "ability", abilityId, "damage", { positive: true });
      }
      if (abilityId === "freeze" && ability.stunDuration !== undefined) {
        requireFinite(ability.stunDuration, "ability", abilityId, "stunDuration", { positive: true });
      }
    }
  }

  // Terrain registry
  for (const [terrainId, terrain] of Object.entries(content.terrainTypes)) {
    if (terrain.id !== terrainId) err("terrain", terrainId, "id", `Terrain key "${terrainId}" has mismatched id "${terrain.id}".`);
    if (!terrain.label.trim()) err("terrain", terrainId, "label", `Terrain "${terrainId}" needs a non-empty label.`);
    if (typeof terrain.buildable !== "boolean") err("terrain", terrainId, "buildable", "buildable must be boolean.");
    if (typeof terrain.walkable !== "boolean") err("terrain", terrainId, "walkable", "walkable must be boolean.");
    requireFinite(terrain.groundSpeedMultiplier, "terrain", terrainId, "groundSpeedMultiplier");
    if (!Array.isArray(terrain.tags) || terrain.tags.some((tag) => typeof tag !== "string")) {
      err("terrain", terrainId, "tags", "tags must be an array of strings.");
    }
  }

  // Maps
  for (const [mapId, map] of Object.entries(content.maps)) {
    if (map.id !== mapId) {
      err("map", mapId, "id", `Map "${mapId}" has mismatched id "${map.id}".`);
    }
    const widthValid = Number.isSafeInteger(map.width) && map.width > 0;
    const heightValid = Number.isSafeInteger(map.height) && map.height > 0;
    if (!widthValid) err("map", mapId, "width", `Map "${mapId}" width must be a positive safe integer.`);
    if (!heightValid) err("map", mapId, "height", `Map "${mapId}" height must be a positive safe integer.`);
    if (widthValid && heightValid) {
      try {
        normalizeGridElevationOverrides(inspectGridElevationOverrides(map), map.width, map.height);
      } catch (error) {
        const fieldPath = error instanceof GridElevationValidationError
          ? error.fieldPath
          : "elevationOverrides";
        err(
          "map",
          mapId,
          fieldPath,
          error instanceof Error ? error.message : "Elevation overrides are invalid."
        );
      }
    }
    if (map.pathCenterline.length < 2) {
      err("map", mapId, "pathCenterline", `Map "${mapId}" needs at least two path centerline points.`);
    }
    const grid = normalizeGridDefinition(map.grid);
    const topology = createGridTopology(grid);
    if (map.grid && map.grid.kind === "hex" && map.grid.layout !== "odd-r") {
      err("map", mapId, "grid.layout", `Map "${mapId}" uses unsupported hex layout "${String(map.grid.layout)}".`);
    }
    if (map.grid && map.grid.kind === "square" && map.grid.adjacency !== "cardinal") {
      err("map", mapId, "grid.adjacency", `Map "${mapId}" uses unsupported square adjacency "${String(map.grid.adjacency)}".`);
    }
    const routes = map.pathRoutes?.length ? map.pathRoutes : [{ id: "main", pathCenterline: map.pathCenterline }];
    const overrideTerrain = new Map(map.terrainOverrides.map((entry) => [coordKey(entry), entry.terrain]));
    const terrainAt = (coord: { q: number; r: number }) => {
      if (coordKey(coord) === coordKey(map.spawnCoord)) return content.terrainTypes.spawn;
      if (coordKey(coord) === coordKey(map.coreCoord)) return content.terrainTypes.core;
      return content.terrainTypes[overrideTerrain.get(coordKey(coord)) ?? map.defaultTerrain];
    };
    if (!content.terrainTypes[map.defaultTerrain]) err("map", mapId, "defaultTerrain", `Unknown terrain "${map.defaultTerrain}".`);
    for (const [index, override] of map.terrainOverrides.entries()) {
      if (!content.terrainTypes[override.terrain]) err("map", mapId, `terrainOverrides[${index}].terrain`, `Unknown terrain "${override.terrain}".`);
    }
    for (const route of routes) {
      if (!route.id) err("map", mapId, "pathRoutes", `Map "${mapId}" has a path route without an id.`);
      if (route.pathCenterline.length < 2) {
        err("map", mapId, `pathRoutes.${route.id}`, `Map "${mapId}" route "${route.id}" needs at least 2 centerline points.`);
      }
      route.pathCenterline.forEach((coord, index) => {
        if (terrainAt(coord)?.walkable === false) {
          err("map", mapId, `pathRoutes.${route.id}[${index}]`, `Route "${route.id}" crosses non-walkable terrain at ${coord.q},${coord.r}.`);
        }
        const next = route.pathCenterline[index + 1];
        if (next && !topology.directionBetween(coord, next)) {
          err(
            "map",
            mapId,
            `pathRoutes.${route.id}[${index + 1}]`,
            `Route "${route.id}" contains a non-adjacent ${grid.kind} segment ${coord.q},${coord.r} -> ${next.q},${next.r}.`
          );
        }
      });
    }
    const allCoords = [map.spawnCoord, map.coreCoord, ...map.pathCenterline, ...(map.pathRoutes ?? []).flatMap((r) => r.pathCenterline), ...map.terrainOverrides];
    for (const coord of allCoords) {
      if (!coord || !Number.isFinite(coord.q) || !Number.isFinite(coord.r)) {
        err("map", mapId, "coords", `Map "${mapId}" has a malformed coord ${JSON.stringify(coord)}.`);
      } else if (coord.q < 0 || coord.r < 0 || coord.q >= map.width || coord.r >= map.height) {
        err("map", mapId, "coords", `Map "${mapId}" has out-of-bounds coord ${coord.q},${coord.r}.`);
      }
    }
  }

  // Wave sets
  for (const [waveSetId, waves] of Object.entries(content.waveSets)) {
    if (waves.length === 0) {
      err("waveSet", waveSetId, "waves", `Wave set "${waveSetId}" has no waves.`);
    }
    for (const wave of waves) {
      for (const group of wave.groups) {
        if (!enemyIds.has(group.enemyId)) {
          err("wave", wave.id, "groups.enemyId", `Wave "${wave.id}" references unknown enemy "${group.enemyId}".`);
        }
        requireFinite(group.count, "wave", wave.id, "groups.count", { positive: true });
        requireFinite(group.spawnInterval, "wave", wave.id, "groups.spawnInterval");
        requireFinite(group.startDelay, "wave", wave.id, "groups.startDelay");
      }
    }
  }

  // Towers
  const knownAttackKinds = new Set<string>(ATTACK_KIND_IDS);
  for (const [towerId, tower] of Object.entries(content.towers)) {
    if (tower.id !== towerId) err("tower", towerId, "id", `Tower key "${towerId}" has mismatched id "${tower.id}".`);
    requireFinite(tower.footprintRadius, "tower", towerId, "footprintRadius");
    const footprintShape = (tower as { footprintShape?: unknown }).footprintShape;
    if (footprintShape !== undefined && footprintShape !== "radius" && footprintShape !== "compact-4") {
      err("tower", towerId, "footprintShape", `Tower "${towerId}" has unsupported footprint shape ${JSON.stringify(footprintShape)}.`, {
        expected: '"radius" or "compact-4"',
        got: JSON.stringify(footprintShape)
      });
    }
    if (footprintShape === "compact-4" && (!Number.isInteger(tower.footprintRadius) || tower.footprintRadius < 1)) {
      err("tower", towerId, "footprintRadius", `Tower "${towerId}" needs footprintRadius >= 1 for compact-4.`, {
        expected: "integer >= 1",
        got: String(tower.footprintRadius)
      });
    }
    requireFinite(tower.range, "tower", towerId, "range", { positive: true });
    if (tower.maxHp !== undefined) requireFinite(tower.maxHp, "tower", towerId, "maxHp", { positive: true });
    validateBag(tower.cost, "tower", towerId, "cost");
    if (tower.upgradeBranches !== undefined) {
      if (!Array.isArray(tower.upgradeBranches) || tower.upgradeBranches.length === 0) {
        err("tower", towerId, "upgradeBranches", `Tower "${towerId}" upgradeBranches must be a non-empty array.`);
      } else {
        const branchIds = new Set<string>();
        tower.upgradeBranches.forEach((branch, index) => {
          const base = `upgradeBranches[${index}]`;
          if (!branch || typeof branch !== "object" || Array.isArray(branch)) {
            err("tower", towerId, base, `Tower "${towerId}" branch must be an object.`);
            return;
          }
          if (typeof branch.id !== "string" || branch.id.length === 0 || branch.id !== branch.id.trim()) {
            err("tower", towerId, `${base}.id`, `Tower "${towerId}" branch needs a non-empty trimmed id.`);
          } else if (branchIds.has(branch.id)) {
            err("tower", towerId, `${base}.id`, `Tower "${towerId}" has duplicate branch id "${branch.id}".`);
          } else {
            branchIds.add(branch.id);
          }
          if (typeof branch.label !== "string" || branch.label.length === 0) {
            err("tower", towerId, `${base}.label`, `Tower "${towerId}" branch needs a non-empty label.`);
          }
          if (branch.description !== undefined && typeof branch.description !== "string") {
            err("tower", towerId, `${base}.description`, `Tower "${towerId}" branch description must be a string.`);
          }
          if (typeof branch.targetTowerId !== "string" || !towerIds.has(branch.targetTowerId)) {
            err("tower", towerId, `${base}.targetTowerId`, `Tower "${towerId}" branch references unknown tower "${String(branch.targetTowerId)}".`);
          } else if (branch.targetTowerId === towerId) {
            err("tower", towerId, `${base}.targetTowerId`, `Tower "${towerId}" branch target must differ from its base type.`);
          } else {
            const target = content.towers[branch.targetTowerId];
            if (target && (target.footprintRadius !== tower.footprintRadius || target.footprintShape !== tower.footprintShape)) {
              err("tower", towerId, `${base}.targetTowerId`, `Tower "${towerId}" branch target must preserve its footprint.`);
            }
          }
          validateBag(branch.cost, "tower", towerId, `${base}.cost`);
        });
      }
    }
    if (tower.requiresAuraFrom && !towerIds.has(tower.requiresAuraFrom)) {
      err("tower", towerId, "requiresAuraFrom", `Tower "${towerId}" requires unknown aura tower "${tower.requiresAuraFrom}".`);
    }

    // Guard against untyped/agent-authored JSON that omits "attack" entirely (TowerType's TS
    // shape declares it required, but a validator's whole job is checking data that may not match
    // that contract) — report ONE clear issue and move on, rather than letting every attack-shaped
    // access below (upgradeCosts, the kind switch, damageType, statusOnHit) throw on undefined.
    const rawAttack: unknown = tower.attack;
    if (!rawAttack || typeof rawAttack !== "object" || Array.isArray(rawAttack)) {
      err("tower", towerId, "attack", `Tower "${towerId}" is missing an "attack" object.`, {
        expected: "an attack object with a kind",
        got: JSON.stringify(rawAttack),
        hint: 'Every tower needs attack: { kind, ... }. Call describe_schema for the exact required fields per kind.'
      });
      continue;
    }
    if (!knownAttackKinds.has((tower.attack as { kind?: string }).kind ?? "")) {
      err("tower", towerId, "attack.kind", `Tower "${towerId}" has unknown attack.kind "${(tower.attack as { kind?: string }).kind}".`, {
        expected: [...knownAttackKinds].join("|"),
        got: String((tower.attack as { kind?: string }).kind),
        hint: `attack.kind must be one of the engine-implemented kinds: ${[...knownAttackKinds].join(", ")}. Call describe_schema to see each kind's required fields.`
      });
    }
    const attack = tower.attack;
    if (Array.isArray((attack as { upgradeCosts?: unknown[] }).upgradeCosts)) {
      (attack as { upgradeCosts: unknown[] }).upgradeCosts.forEach((uc, i) =>
        validateBag(uc, "tower", towerId, `attack.upgradeCosts[${i}]`)
      );
    }
    switch (attack.kind) {
      case "single":
        requireFinite(attack.fireRate, "tower", towerId, "attack.fireRate", { positive: true });
        requireFinite(attack.damagePerStack, "tower", towerId, "attack.damagePerStack", { positive: true });
        requireFinite(attack.maxStacks, "tower", towerId, "attack.maxStacks", { positive: true });
        if (attack.chain) {
          requireFinite(attack.chain.maxJumps, "tower", towerId, "attack.chain.maxJumps", { positive: true });
          requireFinite(attack.chain.jumpRadius, "tower", towerId, "attack.chain.jumpRadius", { positive: true });
          requireFinite(attack.chain.damageFalloff, "tower", towerId, "attack.chain.damageFalloff", { positive: true });
        }
        break;
      case "pulse":
        requireFinite(attack.pulseRate, "tower", towerId, "attack.pulseRate", { positive: true });
        requireFinite(attack.pulseDamage, "tower", towerId, "attack.pulseDamage");
        requireFinite(attack.dotDamagePerUnit, "tower", towerId, "attack.dotDamagePerUnit");
        break;
      case "sniper":
        requireFinite(attack.interval, "tower", towerId, "attack.interval", { positive: true });
        requireFinite(attack.damage, "tower", towerId, "attack.damage", { positive: true });
        if (attack.targetPriority !== undefined && !(TOWER_TARGET_MODES as readonly string[]).includes(attack.targetPriority)) {
          err("tower", towerId, "attack.targetPriority", `Tower "${towerId}" has unknown targetPriority "${attack.targetPriority}".`, {
            expected: TOWER_TARGET_MODES.join("|"),
            got: String(attack.targetPriority)
          });
        }
        break;
      case "antiair":
        requireFinite(attack.fireRate, "tower", towerId, "attack.fireRate", { positive: true });
        requireFinite(attack.damage, "tower", towerId, "attack.damage", { positive: true });
        if (!Array.isArray(attack.maxTargetsByLevel)) {
          err("tower", towerId, "attack.maxTargetsByLevel", `Tower "${towerId}" antiair must define maxTargetsByLevel.`);
        }
        if (!Array.isArray(attack.upgradeCosts)) {
          err("tower", towerId, "attack.upgradeCosts", `Tower "${towerId}" antiair must define upgradeCosts.`);
        }
        break;
      case "splash":
        requireFinite(attack.interval, "tower", towerId, "attack.interval", { positive: true });
        requireFinite(attack.damage, "tower", towerId, "attack.damage", { positive: true });
        requireFinite(attack.splashDamage, "tower", towerId, "attack.splashDamage");
        requireFinite(attack.armoredChipDamage, "tower", towerId, "attack.armoredChipDamage");
        requireFinite(attack.splashRadius, "tower", towerId, "attack.splashRadius");
        if (requireFinite(attack.slowFactor, "tower", towerId, "attack.slowFactor", { positive: true }) && attack.slowFactor >= 1) {
          err("tower", towerId, "attack.slowFactor", `Tower "${towerId}" slowFactor must be < 1 (got ${attack.slowFactor}).`, {
            expected: "0 < slowFactor < 1",
            got: String(attack.slowFactor),
            hint: "slowFactor multiplies speed (0.5 = half speed) — it must be strictly less than 1, or the enemy wouldn't actually slow down."
          });
        }
        requireFinite(attack.slowDuration, "tower", towerId, "attack.slowDuration", { positive: true });
        break;
      case "support":
        requireFinite(attack.auraRadius, "tower", towerId, "attack.auraRadius", { positive: true });
        for (const unlockId of attack.unlocksTowerIds) {
          if (!towerIds.has(unlockId)) err("tower", towerId, "attack.unlocksTowerIds", `Tower "${towerId}" unlocks unknown tower "${unlockId}".`);
        }
        break;
      case "support_buff":
        requireFinite(attack.auraRadius, "tower", towerId, "attack.auraRadius", { positive: true });
        if (!Array.isArray(attack.fireRateMultiplierByLevel) || attack.fireRateMultiplierByLevel.length !== 3) {
          err("tower", towerId, "attack.fireRateMultiplierByLevel", `Tower "${towerId}" support_buff must have 3 fireRateMultiplierByLevel values.`);
        }
        for (const affectedId of attack.affectsTowerIds) {
          if (!towerIds.has(affectedId)) err("tower", towerId, "attack.affectsTowerIds", `Tower "${towerId}" affects unknown tower "${affectedId}".`);
        }
        break;
      case "pipeline": {
        requireFinite(attack.interval, "tower", towerId, "attack.interval", { positive: true });
        if (attack.minRange !== undefined) {
          if (requireFinite(attack.minRange, "tower", towerId, "attack.minRange") && attack.minRange >= tower.range) {
            err("tower", towerId, "attack.minRange", `Tower "${towerId}" attack.minRange must be less than range.`, {
              expected: `0 <= minRange < ${tower.range}`,
              got: String(attack.minRange)
            });
          }
        }
        if (attack.intervalByLevel !== undefined) {
          if (!Array.isArray(attack.intervalByLevel) || attack.intervalByLevel.length === 0) err("tower", towerId, "attack.intervalByLevel", "attack.intervalByLevel must be a non-empty number array.");
          else attack.intervalByLevel.forEach((value, index) => requireFinite(value, "tower", towerId, `attack.intervalByLevel[${index}]`, { positive: true }));
        }
        if (attack.rangeByLevel !== undefined) {
          if (!Array.isArray(attack.rangeByLevel) || attack.rangeByLevel.length === 0) err("tower", towerId, "attack.rangeByLevel", "attack.rangeByLevel must be a non-empty number array.");
          else attack.rangeByLevel.forEach((value, index) => requireFinite(value, "tower", towerId, `attack.rangeByLevel[${index}]`, { positive: true }));
        }
        validateTargetClasses(attack.targeting?.classes, "tower", towerId, "attack.targeting.classes");
        if (attack.targeting?.mode !== undefined && !(TOWER_TARGET_MODES as readonly string[]).includes(attack.targeting.mode)) {
          err("tower", towerId, "attack.targeting.mode", `Unknown target mode "${attack.targeting.mode}".`);
        }
        if (attack.targeting?.maxTargets !== undefined && (!Number.isInteger(attack.targeting.maxTargets) || attack.targeting.maxTargets <= 0)) {
          err("tower", towerId, "attack.targeting.maxTargets", "attack.targeting.maxTargets must be a positive integer.");
        }
        if (!attack.delivery || typeof attack.delivery !== "object") {
          err("tower", towerId, "attack.delivery", "Pipeline attack needs a delivery object.");
        } else if (attack.delivery.kind === "cone") {
          if (
            !requireFinite(attack.delivery.angleDegrees, "tower", towerId, "attack.delivery.angleDegrees", { positive: true })
            || attack.delivery.angleDegrees > 360
          ) {
            if (typeof attack.delivery.angleDegrees === "number" && Number.isFinite(attack.delivery.angleDegrees) && attack.delivery.angleDegrees > 360) {
              err("tower", towerId, "attack.delivery.angleDegrees", "Cone angleDegrees must be <= 360.");
            }
          }
        } else if (attack.delivery.kind === "area") {
          requireFinite(attack.delivery.radius, "tower", towerId, "attack.delivery.radius", { positive: true });
          if (attack.delivery.secondaryMultiplier !== undefined) requireFinite(attack.delivery.secondaryMultiplier, "tower", towerId, "attack.delivery.secondaryMultiplier");
        } else if (attack.delivery.kind === "chain") {
          if (!Number.isInteger(attack.delivery.maxJumps) || attack.delivery.maxJumps <= 0) err("tower", towerId, "attack.delivery.maxJumps", "maxJumps must be a positive integer.");
          requireFinite(attack.delivery.jumpRadius, "tower", towerId, "attack.delivery.jumpRadius", { positive: true });
          if (attack.delivery.damageFalloff !== undefined) requireFinite(attack.delivery.damageFalloff, "tower", towerId, "attack.delivery.damageFalloff", { positive: true });
        } else if (!["single", "multi", "aura"].includes(attack.delivery.kind)) {
          err("tower", towerId, "attack.delivery.kind", `Unsupported pipeline delivery "${String((attack.delivery as { kind?: unknown }).kind)}".`);
        }
        if (!Array.isArray(attack.effects) || attack.effects.length === 0) {
          err("tower", towerId, "attack.effects", "Pipeline attack needs at least one effect.");
        } else {
          let displacementEffectCount = 0;
          attack.effects.forEach((effect, index) => {
            const base = `attack.effects[${index}]`;
            const inspected = inspectOwnDataEffect(effect);
            if (!inspected.ok) {
              err(
                "tower",
                towerId,
                base,
                "Each pipeline effect must be a plain own-data object with enumerable data properties; accessors and inherited fields are not inspected."
              );
              return;
            }
            const record = inspected.record;
            if (inspected.kind === "damage") {
              requireFinite(record.amount, "tower", towerId, `${base}.amount`);
              if (record.damageType !== undefined && (!record.damageType || typeof record.damageType !== "string")) err("tower", towerId, `${base}.damageType`, "damageType must be a non-empty string.");
              if (record.armorPiercing !== undefined && typeof record.armorPiercing !== "boolean") err("tower", towerId, `${base}.armorPiercing`, "armorPiercing must be a boolean.");
              if (record.amountByLevel !== undefined) {
                if (!Array.isArray(record.amountByLevel) || record.amountByLevel.length === 0) err("tower", towerId, `${base}.amountByLevel`, "amountByLevel must be a non-empty number array.");
                else record.amountByLevel.forEach((value, level) => requireFinite(value, "tower", towerId, `${base}.amountByLevel[${level}]`));
              }
            } else if (inspected.kind === "status") {
              validateStatusEffectSpec((record.status ?? {}) as Parameters<typeof validateStatusEffectSpec>[0], "tower", towerId, `${base}.status`);
            } else if (inspected.kind === "resource") {
              validateBag(record.resources, "tower", towerId, `${base}.resources`);
            } else if (inspected.kind === "displacement") {
              displacementEffectCount += 1;
              if (
                activePhysicsTowerIds.has(towerId)
                && displacementEffectCount === PHYSICS_LIMITS.displacementEffectsPerSource + 1
              ) {
                err(
                  "tower",
                  towerId,
                  base,
                  `Active physics tower sources support at most ${PHYSICS_LIMITS.displacementEffectsPerSource} displacement effects.`
                );
              }
              validateDisplacementEffect(record, "tower", towerId, base);
            } else {
              err("tower", towerId, `${base}.kind`, `Unsupported tower effect "${String(inspected.kind)}".`);
            }
          });
        }
        break;
      }
    }
    const damageType = (attack as { damageType?: unknown }).damageType;
    if (damageType !== undefined && (typeof damageType !== "string" || damageType.length === 0)) {
      err("tower", towerId, "attack.damageType", `Tower "${towerId}" damageType must be a non-empty string.`);
    }
    const onHit = (attack as { statusOnHit?: { stun?: unknown; slow?: { factor?: unknown; duration?: unknown }; poison?: { dps?: unknown; duration?: unknown } } }).statusOnHit;
    if (onHit) {
      validateStatusEffectSpec(onHit, "tower", towerId, "attack.statusOnHit");
    }
    validateTargetClasses((attack as { affectsClasses?: unknown }).affectsClasses, "tower", towerId, "attack.affectsClasses");
  }

  // Enemies
  for (const [enemyId, enemy] of Object.entries(content.enemies)) {
    if (enemy.id !== enemyId) err("enemy", enemyId, "id", `Enemy key "${enemyId}" has mismatched id "${enemy.id}".`);
    requireFinite(enemy.maxHp, "enemy", enemyId, "maxHp", { positive: true });
    requireFinite(enemy.speed, "enemy", enemyId, "speed", { positive: true });
    requireFinite(enemy.coreDamage, "enemy", enemyId, "coreDamage", { positive: true });
    requireFinite(enemy.coinReward, "enemy", enemyId, "coinReward");
    if (enemy.tags !== undefined) {
      if (!Array.isArray(enemy.tags)
        || Object.getPrototypeOf(enemy.tags) !== Array.prototype
        || enemy.tags.length > TOWER_SCRIPT_LIMITS.enemyTagsPerDefinition
        || enemy.tags.some((tag) => typeof tag !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(tag))
        || new Set(enemy.tags).size !== enemy.tags.length) {
        err(
          "enemy",
          enemyId,
          "tags",
          `Enemy tags must be a dense unique safe-id array with at most ${TOWER_SCRIPT_LIMITS.enemyTagsPerDefinition} entries.`
        );
      }
    }
    inspectEnemyResistances(enemyId, enemy.resistances);
    if (enemy.towerDisrupt) {
      requireFinite(enemy.towerDisrupt.interval, "enemy", enemyId, "towerDisrupt.interval", { positive: true });
      requireFinite(enemy.towerDisrupt.radius, "enemy", enemyId, "towerDisrupt.radius", { positive: true });
      requireFinite(enemy.towerDisrupt.duration, "enemy", enemyId, "towerDisrupt.duration", { positive: true });
      if (enemy.towerDisrupt.telegraphLead !== undefined) {
        if (
          requireFinite(enemy.towerDisrupt.telegraphLead, "enemy", enemyId, "towerDisrupt.telegraphLead", { positive: true })
          && enemy.towerDisrupt.telegraphLead > enemy.towerDisrupt.interval
        ) {
          err("enemy", enemyId, "towerDisrupt.telegraphLead", "towerDisrupt.telegraphLead must be <= interval.");
        }
      }
      if (
        enemy.towerDisrupt.telegraphKind !== undefined
        && !["hussar_charge", "cossack_channel", "musketeer_aim"].includes(enemy.towerDisrupt.telegraphKind)
      ) {
        err("enemy", enemyId, "towerDisrupt.telegraphKind", `Unknown disruption telegraph kind "${String(enemy.towerDisrupt.telegraphKind)}".`);
      }
      if (enemy.towerDisrupt.maxTargets !== undefined && (!Number.isInteger(enemy.towerDisrupt.maxTargets) || enemy.towerDisrupt.maxTargets <= 0)) {
        err("enemy", enemyId, "towerDisrupt.maxTargets", "towerDisrupt.maxTargets must be a positive integer.");
      }
    }
    if (enemy.towerAttack) {
      requireFinite(enemy.towerAttack.interval, "enemy", enemyId, "towerAttack.interval", { positive: true });
      requireFinite(enemy.towerAttack.damage, "enemy", enemyId, "towerAttack.damage", { positive: true });
      requireFinite(enemy.towerAttack.range, "enemy", enemyId, "towerAttack.range", { positive: true });
    }
    validateBag(enemy.reward, "enemy", enemyId, "reward");
    if (enemy.spawnOnDeath) {
      if (!enemyIds.has(enemy.spawnOnDeath.enemyId)) {
        err("enemy", enemyId, "spawnOnDeath.enemyId", `Enemy "${enemyId}" spawnOnDeath references unknown enemy "${enemy.spawnOnDeath.enemyId}".`);
      }
      requireFinite(enemy.spawnOnDeath.count, "enemy", enemyId, "spawnOnDeath.count", { positive: true });
    }
    if (enemy.phaseSpawns) {
      for (const phase of enemy.phaseSpawns) {
        if (!enemyIds.has(phase.enemyId)) {
          err("enemy", enemyId, "phaseSpawns.enemyId", `Enemy "${enemyId}" phaseSpawn references unknown enemy "${phase.enemyId}".`);
        }
      }
    }
    if (enemy.armor && enemy.armor.kind !== "pierce_only") {
      err("enemy", enemyId, "armor.kind", `Enemy "${enemyId}" armor kind "${enemy.armor.kind}" is not supported.`);
    }
  }

  // Missions
  for (const [missionId, mission] of Object.entries(content.missions)) {
    if (!mapIds.has(mission.mapId)) {
      err("mission", missionId, "mapId", `Mission "${missionId}" references unknown map "${mission.mapId}".`);
    }
    if (!waveSetIds.has(mission.waveSetId)) {
      err("mission", missionId, "waveSetId", `Mission "${missionId}" references unknown wave set "${mission.waveSetId}".`);
    }
    const missionMap = content.maps[mission.mapId];
    const missionWaveSet = content.waveSets[mission.waveSetId] ?? [];
    if (missionMap) {
      const routeIds = new Set((missionMap.pathRoutes ?? []).map((route) => route.id));
      for (const wave of missionWaveSet) {
        for (const group of wave.groups) {
          if (group.routeId && !routeIds.has(group.routeId)) {
            err(
              "wave",
              wave.id,
              "groups.routeId",
              `Wave "${wave.id}" routeId "${group.routeId}" is not present on mission "${missionId}" map "${mission.mapId}".`
            );
          }
        }
      }
    }
    for (const towerId of mission.buildTowerIds) {
      if (!towerIds.has(towerId)) {
        err("mission", missionId, "buildTowerIds", `Mission "${missionId}" lists unknown tower "${towerId}".`);
      }
    }
    for (const abilityId of mission.abilityIds) {
      if (!abilityIds.has(abilityId)) {
        err("mission", missionId, "abilityIds", `Mission "${missionId}" lists unknown ability "${abilityId}".`);
      }
    }
    requireFinite(mission.startingCoreHp, "mission", missionId, "startingCoreHp", { positive: true });
    requireFinite(mission.prepTimeUnits, "mission", missionId, "prepTimeUnits");
    validateBag(mission.startingResources, "mission", missionId, "startingResources");
    if (mission.economy) {
      validateBag(mission.economy.perWaveStart, "mission", missionId, "economy.perWaveStart");
      validateBag(mission.economy.perWaveClear, "mission", missionId, "economy.perWaveClear");
      validateBag(mission.economy.passivePerTimeUnit, "mission", missionId, "economy.passivePerTimeUnit");
      validateBag(mission.economy.interestCap, "mission", missionId, "economy.interestCap");
      validateBag(mission.economy.earlyStartBonusPerUnit, "mission", missionId, "economy.earlyStartBonusPerUnit");
      if (mission.economy.interestRate !== undefined) {
        requireFinite(mission.economy.interestRate, "mission", missionId, "economy.interestRate");
        if (mission.economy.interestRate > 1) {
          warn("mission", missionId, "economy.interestRate", `Mission "${missionId}" grants more than 100% interest per wave.`);
        }
      }
      if (mission.economy.sellRefundRatio !== undefined) {
        const valid = requireFinite(mission.economy.sellRefundRatio, "mission", missionId, "economy.sellRefundRatio");
        if (valid && mission.economy.sellRefundRatio > 1) {
          err("mission", missionId, "economy.sellRefundRatio", `economy.sellRefundRatio must be between 0 and 1 (got ${mission.economy.sellRefundRatio}).`, { expected: "0..1", got: String(mission.economy.sellRefundRatio) });
        }
      }
    }
    if (mission.objectives) {
      const objectiveIds = new Set<string>();
      const registerId = (id: unknown, fieldPath: string) => {
        if (typeof id !== "string" || !id.trim()) {
          err("mission", missionId, fieldPath, `${fieldPath} must be a non-empty string.`);
          return;
        }
        if (objectiveIds.has(id)) err("mission", missionId, fieldPath, `Objective id "${id}" is duplicated.`);
        objectiveIds.add(id);
      };
      if (!Array.isArray(mission.objectives.victory)) {
        err("mission", missionId, "objectives.victory", "objectives.victory must be an array.");
      } else {
        if (mission.objectives.victory.length === 0) {
          warn("mission", missionId, "objectives.victory", "No authored victory objectives; the runtime will default to clearWaves.");
        }
        mission.objectives.victory.forEach((objective, index) => {
          const base = `objectives.victory[${index}]`;
          registerId(objective?.id, `${base}.id`);
          if (!objective || !["clearWaves", "surviveSeconds", "killCount", "accumulateResource"].includes(objective.kind)) {
            err("mission", missionId, `${base}.kind`, `Unsupported victory objective kind "${String(objective?.kind)}".`);
            return;
          }
          if (objective.kind === "surviveSeconds") requireFinite(objective.seconds, "mission", missionId, `${base}.seconds`, { positive: true });
          if (objective.kind === "killCount") {
            requireFinite(objective.count, "mission", missionId, `${base}.count`, { positive: true });
            if (objective.enemyTypeId && !enemyIds.has(objective.enemyTypeId)) err("mission", missionId, `${base}.enemyTypeId`, `Unknown enemy "${objective.enemyTypeId}".`);
          }
          if (objective.kind === "accumulateResource") {
            if (!currencyIds.has(objective.resourceId)) err("mission", missionId, `${base}.resourceId`, `Unknown currency "${objective.resourceId}".`);
            requireFinite(objective.amount, "mission", missionId, `${base}.amount`, { positive: true });
          }
        });
      }
      if (mission.objectives.failure !== undefined && !Array.isArray(mission.objectives.failure)) {
        err("mission", missionId, "objectives.failure", "objectives.failure must be an array.");
      } else {
        (mission.objectives.failure ?? []).forEach((condition, index) => {
          const base = `objectives.failure[${index}]`;
          registerId(condition?.id, `${base}.id`);
          if (!condition || !["maxLeaks", "timeLimit"].includes(condition.kind)) {
            err("mission", missionId, `${base}.kind`, `Unsupported failure condition kind "${String(condition?.kind)}".`);
            return;
          }
          if (condition.kind === "maxLeaks") requireFinite(condition.maxLeaks, "mission", missionId, `${base}.maxLeaks`);
          if (condition.kind === "timeLimit") requireFinite(condition.seconds, "mission", missionId, `${base}.seconds`, { positive: true });
        });
      }
      if (mission.objectives.stars !== undefined && !Array.isArray(mission.objectives.stars)) {
        err("mission", missionId, "objectives.stars", "objectives.stars must be an array.");
      } else {
        (mission.objectives.stars ?? []).forEach((star, index) => {
          const base = `objectives.stars[${index}]`;
          registerId(star?.id, `${base}.id`);
          if (!star || !["coreHpAtLeast", "maxLeaks", "timeAtMost", "resourceAtLeast"].includes(star.kind)) {
            err("mission", missionId, `${base}.kind`, `Unsupported star condition kind "${String(star?.kind)}".`);
            return;
          }
          if (typeof star.label !== "string" || !star.label.trim()) err("mission", missionId, `${base}.label`, "Star label must be non-empty.");
          if (star.kind === "coreHpAtLeast") requireFinite(star.amount, "mission", missionId, `${base}.amount`);
          if (star.kind === "maxLeaks") requireFinite(star.maxLeaks, "mission", missionId, `${base}.maxLeaks`);
          if (star.kind === "timeAtMost") requireFinite(star.seconds, "mission", missionId, `${base}.seconds`, { positive: true });
          if (star.kind === "resourceAtLeast") {
            if (!currencyIds.has(star.resourceId)) err("mission", missionId, `${base}.resourceId`, `Unknown currency "${star.resourceId}".`);
            requireFinite(star.amount, "mission", missionId, `${base}.amount`, { positive: true });
          }
        });
      }
    }
    if (mission.buildTowerIds.length === 0) {
      warn("mission", missionId, "buildTowerIds", `Mission "${missionId}" has no towers available to build.`);
    }
  }

  // World map
  for (const region of content.worldMap.regions) {
    for (const connectionId of region.connections) {
      if (!regionIds.has(connectionId)) {
        err("worldMap", region.id, "connections", `Region "${region.id}" connects to unknown region "${connectionId}".`);
      }
    }
  }
  const nodeCounts = new Map<string, number>();
  for (const node of content.worldMap.missionNodes) {
    if (!missionIds.has(node.missionId)) {
      err("worldMap", node.missionId, "missionId", `World map node references unknown mission "${node.missionId}".`);
    }
    if (!regionIds.has(node.regionId)) {
      err("worldMap", node.missionId, "regionId", `Mission node "${node.missionId}" references unknown region "${node.regionId}".`);
    }
    for (const requiredId of node.unlockRequiresMissionIds) {
      if (!missionIds.has(requiredId)) {
        err("worldMap", node.missionId, "unlockRequiresMissionIds", `Mission "${node.missionId}" requires unknown mission "${requiredId}".`);
      }
    }
    if (node.unlockRequiresMissionIds.includes(node.missionId)) {
      err("worldMap", node.missionId, "unlockRequiresMissionIds", `Mission "${node.missionId}" cannot require itself.`);
    }
    nodeCounts.set(node.missionId, (nodeCounts.get(node.missionId) ?? 0) + 1);
  }
  for (const missionId of missionIds) {
    const count = nodeCounts.get(missionId) ?? 0;
    if (count === 0) warn("worldMap", missionId, "missionNodes", `Mission "${missionId}" has no world map node.`);
    else if (count > 1) err("worldMap", missionId, "missionNodes", `Mission "${missionId}" has ${count} world map nodes (expected 1).`);
  }

  // Campaign reachability: with fresh progress a mission unlocks only when all its requirements are
  // (transitively) clearable. Flag any gated mission that can never be reached (a cycle, or a campaign
  // with no starting mission) — otherwise the player would be stuck on a permanently-locked default.
  const reqByMission = new Map<string, string[]>();
  for (const node of content.worldMap.missionNodes) {
    if (missionIds.has(node.missionId)) {
      reqByMission.set(node.missionId, node.unlockRequiresMissionIds.filter((r) => missionIds.has(r)));
    }
  }
  const reachable = new Set<string>();
  for (const missionId of missionIds) {
    if (!reqByMission.has(missionId)) reachable.add(missionId); // no node → always unlocked
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [missionId, reqs] of reqByMission) {
      if (!reachable.has(missionId) && reqs.every((r) => reachable.has(r))) {
        reachable.add(missionId);
        grew = true;
      }
    }
  }
  for (const missionId of reqByMission.keys()) {
    if (!reachable.has(missionId)) {
      err("worldMap", missionId, "unlockRequiresMissionIds", `Mission "${missionId}" can never be unlocked (an unlock requirement is itself locked — check for a cycle or a missing starting mission).`);
    }
  }

  let campaignDescriptor: PropertyDescriptor | undefined;
  try {
    campaignDescriptor = Object.getOwnPropertyDescriptor(content.worldMap, "campaign");
  } catch {
    err("worldMap", "campaign", "campaign", "World campaign could not be inspected safely.");
  }
  if (campaignDescriptor && (!campaignDescriptor.enumerable || !("value" in campaignDescriptor))) {
    err("worldMap", "campaign", "campaign", "World campaign must be enumerable own data.");
  } else if (campaignDescriptor && "value" in campaignDescriptor && campaignDescriptor.value !== undefined) {
    try {
      const campaign = normalizeAuthoredWorldCampaign(campaignDescriptor.value);
      let active = false;
      try {
        const modules = Object.getOwnPropertyDescriptor(content.mechanics, "modules");
        const roguelite = modules?.enumerable && "value" in modules
          ? Object.getOwnPropertyDescriptor(modules.value as object, "roguelite")
          : undefined;
        const module = roguelite?.enumerable && "value" in roguelite
          ? roguelite.value as Record<string, unknown>
          : undefined;
        const moduleSchemaVersion = module
          ? Object.getOwnPropertyDescriptor(module, "schemaVersion")
          : undefined;
        const moduleEnabled = module
          ? Object.getOwnPropertyDescriptor(module, "enabled")
          : undefined;
        const profiles = module
          ? Object.getOwnPropertyDescriptor(module, "profiles")
          : undefined;
        const profile = profiles?.enumerable && "value" in profiles
          ? Object.getOwnPropertyDescriptor(profiles.value as object, campaign.rogueliteProfileId!)
          : undefined;
        const marker = profile?.enumerable && "value" in profile
          ? Object.getOwnPropertyDescriptor(profile.value as object, "campaign")
          : undefined;
        const markerVersion = marker?.enumerable && "value" in marker
          ? Object.getOwnPropertyDescriptor(marker.value as object, "schemaVersion")
          : undefined;
        const selectedByMission = Object.keys(content.missions).some((missionId) => (
          content.missions[missionId]?.mechanics?.profiles?.roguelite === campaign.rogueliteProfileId
        ));
        active = moduleSchemaVersion?.enumerable === true
          && "value" in moduleSchemaVersion
          && moduleSchemaVersion.value === 4
          && moduleEnabled?.enumerable === true
          && "value" in moduleEnabled
          && moduleEnabled.value === true
          && markerVersion?.enumerable === true
          && "value" in markerVersion
          && markerVersion.value === 1
          && selectedByMission;
      } catch {
        active = false;
      }
      const semantic = active ? err : warn;
      for (const node of campaign.nodes) {
        if (!regionIds.has(node.regionId)) {
          semantic(
            "worldMap",
            "campaign",
            `campaign.nodes.${node.id}.regionId`,
            `Campaign node "${node.id}" references unknown region "${node.regionId}"${active ? "" : " in this inactive campaign"}.`
          );
        }
        if ("missionId" in node) {
          const mission = content.missions[node.missionId];
          if (!mission) {
            semantic(
              "worldMap",
              "campaign",
              `campaign.nodes.${node.id}.missionId`,
              `Campaign node "${node.id}" references unknown mission "${node.missionId}"${active ? "" : " in this inactive campaign"}.`
            );
          } else if (mission.mechanics?.profiles?.roguelite !== campaign.rogueliteProfileId) {
            semantic(
              "worldMap",
              "campaign",
              `campaign.nodes.${node.id}.missionId`,
              `Campaign mission "${node.missionId}" does not select roguelite profile "${campaign.rogueliteProfileId}"${active ? "" : " in this inactive campaign"}.`
            );
          }
        } else if (campaign.schemaVersion === 2 && "choices" in node) {
          for (const choice of node.choices) {
            for (const [bagName, bag] of [["costs", choice.costs], ["grants", choice.grants]] as const) {
              for (const resourceId of Object.keys(bag)) {
                if (Object.prototype.hasOwnProperty.call(campaign.runResources, resourceId)) continue;
                semantic(
                  "worldMap",
                  "campaign",
                  `campaign.nodes.${node.id}.choices.${choice.id}.${bagName}.${resourceId}`,
                  `Campaign choice "${choice.id}" references undeclared run resource "${resourceId}"${active ? "" : " in this inactive campaign"}.`
                );
              }
            }
          }
        }
      }
    } catch (error) {
      err(
        "worldMap",
        "campaign",
        error instanceof WorldCampaignValidationError ? error.fieldPath.replace(/^worldMap\./, "") : "campaign",
        error instanceof Error ? error.message : "World campaign is invalid."
      );
    }
  }

  return {
    ok: issues.filter((i) => i.severity === "error").length === 0,
    issues
  };
}

/** Alias of validateGameContentRegistry — validates all cross-references and numeric guards in a content registry. */
export function validateProject(content: GameContentRegistry): ValidationResult {
  return validateGameContentRegistry(content);
}
