import type { CampaignRunV2 } from "../run/campaign-run.js";
import type { GameContentRegistry } from "./registry.js";
import { resolveCapabilitySet } from "./mechanics.js";

export const ARSENAL_LIMITS = Object.freeze({
  modules: 512,
  blueprints: 512,
  craftingRecipes: 512,
  compatibilityTags: 32,
  footprintCells: 64,
  patternCells: 9,
  idCodeUnits: 256,
  labelCodeUnits: 256,
  multiplier: 100
});

export const ARSENAL_MECHANICS_SCHEMA = Object.freeze({
  schemaVersion: 1,
  moduleId: "arsenal",
  supportedModuleSchemaVersions: [1] as const,
  profile: { requiredFields: ["modules", "blueprints", "craftingRecipes"] as const, optionalFields: [] as const, additionalProperties: false },
  moduleCategories: ["base", "barrel", "core"] as const,
  module: { requiredFields: ["label", "category", "compatibilityTags", "modifiers"] as const, additionalProperties: false },
  blueprint: { requiredFields: ["compatibilityTags", "footprint", "defaultModules"] as const, additionalProperties: false },
  craftingRecipe: { requiredFields: ["outputArtifactId", "allowRotations", "pattern"] as const, board: "3x3", additionalProperties: false },
  limits: ARSENAL_LIMITS
});

export type ArsenalModuleCategoryV1 = "base" | "barrel" | "core";

export interface ArsenalModuleDefinitionV1 {
  readonly label: string;
  readonly category: ArsenalModuleCategoryV1;
  readonly compatibilityTags: readonly string[];
  readonly modifiers: {
    readonly damageMultiplier: number;
    readonly rangeMultiplier: number;
    readonly durabilityMultiplier: number;
  };
}

export interface ArsenalModuleLoadoutV1 {
  readonly base: string;
  readonly barrel: string;
  readonly core: string;
}

export interface ArsenalBlueprintDefinitionV1 {
  readonly compatibilityTags: readonly string[];
  readonly footprint: readonly { readonly q: number; readonly r: number }[];
  readonly defaultModules: ArsenalModuleLoadoutV1;
}

export interface ArsenalCraftingRecipeV1 {
  readonly outputArtifactId: string;
  readonly allowRotations: boolean;
  readonly pattern: readonly { readonly x: number; readonly y: number; readonly artifactId: string }[];
}

export interface ArsenalProfileV1 {
  readonly modules: Readonly<Record<string, ArsenalModuleDefinitionV1>>;
  readonly blueprints: Readonly<Record<string, ArsenalBlueprintDefinitionV1>>;
  readonly craftingRecipes: Readonly<Record<string, ArsenalCraftingRecipeV1>>;
}

export interface ActiveArsenalMechanicsV1 extends ArsenalProfileV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
}

export interface CompiledArsenalTowerV1 {
  readonly schemaVersion: 1;
  readonly towerTypeId: string;
  readonly modules: ArsenalModuleLoadoutV1;
  readonly footprint: readonly { readonly q: number; readonly r: number }[];
  readonly damageMultiplier: number;
  readonly rangeMultiplier: number;
  readonly durabilityMultiplier: number;
}

export interface CraftCampaignGemRequestV1 {
  readonly recipeId: string;
  readonly outputInstanceId: string;
  readonly cells: readonly { readonly x: number; readonly y: number; readonly artifactInstanceId: string }[];
}

export type CraftCampaignGemResultV1 = Readonly<
  | { ok: true; run: CampaignRunV2; consumedInstanceIds: readonly string[]; outputInstanceId: string }
  | { ok: false; run: CampaignRunV2; code: "invalid_request" | "recipe_not_found" | "artifact_not_owned" | "pattern_mismatch" | "duplicate_instance" }
>;

export class ArsenalProfileValidationError extends Error {}

type Fields = ReadonlyMap<string, unknown>;

function fields(value: unknown, path: string): Fields {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ArsenalProfileValidationError(`${path} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new ArsenalProfileValidationError(`${path} rejects symbol keys.`);
  }
  const result = new Map<string, unknown>();
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw new ArsenalProfileValidationError(`${path}.${key} must be enumerable own data.`);
    }
    result.set(key, descriptor.value);
  }
  return result;
}

function closed(value: Fields, required: readonly string[], path: string): void {
  const allowed = new Set(required);
  if (required.some((key) => !value.has(key))) {
    throw new ArsenalProfileValidationError(`${path} has a missing required field.`);
  }
  for (const key of value.keys()) {
    if (!allowed.has(key)) throw new ArsenalProfileValidationError(`${path} is closed; unknown field "${key}".`);
  }
}

function array(value: unknown, path: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    throw new ArsenalProfileValidationError(`${path} must be a plain array with at most ${maximum} entries.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1) {
    throw new ArsenalProfileValidationError(`${path} must be a dense array without extra fields.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new ArsenalProfileValidationError(`${path}[${index}] must be enumerable own data.`);
    }
  }
  return value;
}

function id(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > ARSENAL_LIMITS.idCodeUnits) {
    throw new ArsenalProfileValidationError(`${path} must be a non-empty bounded identifier.`);
  }
  return value;
}

function number(value: unknown, path: string, minimum: number, maximum: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum
    || (integer && !Number.isSafeInteger(value))) {
    throw new ArsenalProfileValidationError(`${path} must be a finite${integer ? " integer" : ""} number in ${minimum}..${maximum}.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  const values = array(value, path, ARSENAL_LIMITS.compatibilityTags).map((entry, index) => id(entry, `${path}[${index}]`));
  if (new Set(values).size !== values.length) throw new ArsenalProfileValidationError(`${path} contains duplicate tags.`);
  return Object.freeze(values);
}

function ownRecord<T>(input: unknown, path: string, maximum: number, parse: (value: unknown, key: string) => T): Readonly<Record<string, T>> {
  const source = fields(input, path);
  if (source.size > maximum) throw new ArsenalProfileValidationError(`${path} exceeds ${maximum} entries.`);
  const result = Object.create(null) as Record<string, T>;
  for (const key of [...source.keys()].sort()) {
    id(key, `${path} id`);
    Object.defineProperty(result, key, { value: parse(source.get(key), key), enumerable: true });
  }
  return Object.freeze(result);
}

function normalizeLoadout(value: unknown, path: string): ArsenalModuleLoadoutV1 {
  const source = fields(value, path);
  closed(source, ["base", "barrel", "core"], path);
  return Object.freeze({
    base: id(source.get("base"), `${path}.base`),
    barrel: id(source.get("barrel"), `${path}.barrel`),
    core: id(source.get("core"), `${path}.core`)
  });
}

export function normalizeArsenalProfileV1(value: unknown): ArsenalProfileV1 {
  const source = fields(value, "arsenal profile");
  closed(source, ["modules", "blueprints", "craftingRecipes"], "arsenal profile");
  const modules = ownRecord(source.get("modules"), "arsenal profile.modules", ARSENAL_LIMITS.modules, (entry, moduleId) => {
    const item = fields(entry, `arsenal profile.modules.${moduleId}`);
    closed(item, ["label", "category", "compatibilityTags", "modifiers"], `arsenal profile.modules.${moduleId}`);
    const category = item.get("category");
    if (category !== "base" && category !== "barrel" && category !== "core") {
      throw new ArsenalProfileValidationError(`arsenal profile.modules.${moduleId}.category is unsupported.`);
    }
    const modifiers = fields(item.get("modifiers"), `arsenal profile.modules.${moduleId}.modifiers`);
    closed(modifiers, ["damageMultiplier", "rangeMultiplier", "durabilityMultiplier"], `arsenal profile.modules.${moduleId}.modifiers`);
    return Object.freeze({
      label: id(item.get("label"), `arsenal profile.modules.${moduleId}.label`),
      category,
      compatibilityTags: stringArray(item.get("compatibilityTags"), `arsenal profile.modules.${moduleId}.compatibilityTags`),
      modifiers: Object.freeze({
        damageMultiplier: number(modifiers.get("damageMultiplier"), `arsenal profile.modules.${moduleId}.modifiers.damageMultiplier`, 0, ARSENAL_LIMITS.multiplier),
        rangeMultiplier: number(modifiers.get("rangeMultiplier"), `arsenal profile.modules.${moduleId}.modifiers.rangeMultiplier`, 0, ARSENAL_LIMITS.multiplier),
        durabilityMultiplier: number(modifiers.get("durabilityMultiplier"), `arsenal profile.modules.${moduleId}.modifiers.durabilityMultiplier`, 0, ARSENAL_LIMITS.multiplier)
      })
    });
  });
  const blueprints = ownRecord(source.get("blueprints"), "arsenal profile.blueprints", ARSENAL_LIMITS.blueprints, (entry, towerTypeId) => {
    const item = fields(entry, `arsenal profile.blueprints.${towerTypeId}`);
    closed(item, ["compatibilityTags", "footprint", "defaultModules"], `arsenal profile.blueprints.${towerTypeId}`);
    const footprint = array(item.get("footprint"), `arsenal profile.blueprints.${towerTypeId}.footprint`, ARSENAL_LIMITS.footprintCells);
    if (footprint.length === 0) throw new ArsenalProfileValidationError(`arsenal profile.blueprints.${towerTypeId}.footprint cannot be empty.`);
    return Object.freeze({
      compatibilityTags: stringArray(item.get("compatibilityTags"), `arsenal profile.blueprints.${towerTypeId}.compatibilityTags`),
      footprint: Object.freeze(footprint.map((cell, index) => {
        const coord = fields(cell, `arsenal profile.blueprints.${towerTypeId}.footprint[${index}]`);
        closed(coord, ["q", "r"], `arsenal profile.blueprints.${towerTypeId}.footprint[${index}]`);
        return Object.freeze({
          q: number(coord.get("q"), `footprint[${index}].q`, -64, 64, true),
          r: number(coord.get("r"), `footprint[${index}].r`, -64, 64, true)
        });
      })),
      defaultModules: normalizeLoadout(item.get("defaultModules"), `arsenal profile.blueprints.${towerTypeId}.defaultModules`)
    });
  });
  const craftingRecipes = ownRecord(source.get("craftingRecipes"), "arsenal profile.craftingRecipes", ARSENAL_LIMITS.craftingRecipes, (entry, recipeId) => {
    const item = fields(entry, `arsenal profile.craftingRecipes.${recipeId}`);
    closed(item, ["outputArtifactId", "allowRotations", "pattern"], `arsenal profile.craftingRecipes.${recipeId}`);
    if (typeof item.get("allowRotations") !== "boolean") throw new ArsenalProfileValidationError(`arsenal recipe ${recipeId}.allowRotations must be boolean.`);
    const pattern = array(item.get("pattern"), `arsenal profile.craftingRecipes.${recipeId}.pattern`, ARSENAL_LIMITS.patternCells);
    if (pattern.length === 0) throw new ArsenalProfileValidationError(`arsenal recipe ${recipeId}.pattern cannot be empty.`);
    const seen = new Set<string>();
    const normalized = pattern.map((cell, index) => {
      const data = fields(cell, `arsenal profile.craftingRecipes.${recipeId}.pattern[${index}]`);
      closed(data, ["x", "y", "artifactId"], `arsenal profile.craftingRecipes.${recipeId}.pattern[${index}]`);
      const value = Object.freeze({
        x: number(data.get("x"), `pattern[${index}].x`, 0, 2, true),
        y: number(data.get("y"), `pattern[${index}].y`, 0, 2, true),
        artifactId: id(data.get("artifactId"), `pattern[${index}].artifactId`)
      });
      const key = `${value.x},${value.y}`;
      if (seen.has(key)) throw new ArsenalProfileValidationError(`arsenal recipe ${recipeId} repeats cell ${key}.`);
      seen.add(key);
      return value;
    });
    return Object.freeze({
      outputArtifactId: id(item.get("outputArtifactId"), `arsenal profile.craftingRecipes.${recipeId}.outputArtifactId`),
      allowRotations: item.get("allowRotations") as boolean,
      pattern: Object.freeze(normalized)
    });
  });
  return Object.freeze({ modules, blueprints, craftingRecipes });
}

function compatible(definition: ArsenalModuleDefinitionV1, blueprint: ArsenalBlueprintDefinitionV1): boolean {
  return definition.compatibilityTags.length === 0
    || definition.compatibilityTags.some((tag) => blueprint.compatibilityTags.includes(tag));
}

export function compileArsenalBlueprintV1(
  profile: ArsenalProfileV1,
  towerTypeId: string,
  loadout?: ArsenalModuleLoadoutV1
): CompiledArsenalTowerV1 {
  const blueprint = profile.blueprints[towerTypeId];
  if (!blueprint) throw new ArsenalProfileValidationError(`Arsenal blueprint for tower "${towerTypeId}" was not found.`);
  const selected = loadout ?? blueprint.defaultModules;
  const categories = ["base", "barrel", "core"] as const;
  const definitions = categories.map((category) => {
    const moduleId = selected[category];
    const definition = profile.modules[moduleId];
    if (!definition || definition.category !== category || !compatible(definition, blueprint)) {
      throw new ArsenalProfileValidationError(`Arsenal ${category} module "${moduleId}" is missing, has the wrong category, or is incompatible.`);
    }
    return definition;
  });
  const product = (key: keyof ArsenalModuleDefinitionV1["modifiers"]): number => (
    definitions.reduce((value, definition) => value * definition.modifiers[key], 1)
  );
  return Object.freeze({
    schemaVersion: 1,
    towerTypeId,
    modules: Object.freeze({ ...selected }),
    footprint: Object.freeze(blueprint.footprint.map((cell) => Object.freeze({ ...cell }))),
    damageMultiplier: product("damageMultiplier"),
    rangeMultiplier: product("rangeMultiplier"),
    durabilityMultiplier: product("durabilityMultiplier")
  });
}

function normalizedPattern(cells: readonly { readonly x: number; readonly y: number; readonly artifactId: string }[]): string {
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  return cells.map((cell) => `${cell.x - minX},${cell.y - minY}:${cell.artifactId}`).sort().join("|");
}

function rotatePattern(cells: readonly { readonly x: number; readonly y: number; readonly artifactId: string }[]): readonly { x: number; y: number; artifactId: string }[] {
  return cells.map((cell) => ({ x: 2 - cell.y, y: cell.x, artifactId: cell.artifactId }));
}

export function craftCampaignGemV1(
  run: CampaignRunV2,
  profile: ArsenalProfileV1,
  request: CraftCampaignGemRequestV1
): CraftCampaignGemResultV1 {
  const fail = (code: Exclude<CraftCampaignGemResultV1, { ok: true }>["code"]): CraftCampaignGemResultV1 => Object.freeze({ ok: false, code, run });
  let cells: readonly { x: number; y: number; artifactInstanceId: string }[];
  try {
    id(request.recipeId, "craft request.recipeId");
    id(request.outputInstanceId, "craft request.outputInstanceId");
    const input = array(request.cells, "craft request.cells", ARSENAL_LIMITS.patternCells);
    cells = input.map((cell, index) => {
      const data = fields(cell, `craft request.cells[${index}]`);
      closed(data, ["x", "y", "artifactInstanceId"], `craft request.cells[${index}]`);
      return {
        x: number(data.get("x"), `craft request.cells[${index}].x`, 0, 2, true),
        y: number(data.get("y"), `craft request.cells[${index}].y`, 0, 2, true),
        artifactInstanceId: id(data.get("artifactInstanceId"), `craft request.cells[${index}].artifactInstanceId`)
      };
    });
  } catch {
    return fail("invalid_request");
  }
  const recipe = profile.craftingRecipes[request.recipeId];
  if (!recipe) return fail("recipe_not_found");
  const instanceIds = cells.map((cell) => cell.artifactInstanceId);
  if (new Set(instanceIds).size !== instanceIds.length || run.artifacts.some((entry) => entry.instanceId === request.outputInstanceId)) {
    return fail("duplicate_instance");
  }
  const owned = new Map(run.artifacts.map((entry) => [entry.instanceId, entry.artifactId] as const));
  if (instanceIds.some((instanceId) => !owned.has(instanceId))) return fail("artifact_not_owned");
  const candidate = normalizedPattern(cells.map((cell) => ({ ...cell, artifactId: owned.get(cell.artifactInstanceId)! })));
  const patterns = [recipe.pattern];
  if (recipe.allowRotations) {
    for (let index = 0; index < 3; index += 1) patterns.push(rotatePattern(patterns[patterns.length - 1]!));
  }
  if (!patterns.some((pattern) => normalizedPattern(pattern) === candidate)) return fail("pattern_mismatch");
  const consumed = new Set(instanceIds);
  const next: CampaignRunV2 = Object.freeze({
    ...run,
    deck: Object.freeze(run.deck.map((entry) => Object.freeze({ ...entry }))),
    artifacts: Object.freeze([
      ...run.artifacts.filter((entry) => !consumed.has(entry.instanceId)).map((entry) => Object.freeze({ ...entry })),
      Object.freeze({ instanceId: request.outputInstanceId, artifactId: recipe.outputArtifactId })
    ]),
    runResources: Object.freeze({ ...run.runResources }),
    arsenal: Object.freeze({
      moduleInventory: Object.freeze(run.arsenal.moduleInventory.map((entry) => Object.freeze({ ...entry })))
    })
  });
  return Object.freeze({ ok: true, run: next, consumedInstanceIds: Object.freeze([...instanceIds]), outputInstanceId: request.outputInstanceId });
}

export function resolveActiveArsenalMechanics(content: GameContentRegistry, missionId: string): ActiveArsenalMechanicsV1 | undefined {
  const mission = content.missions[missionId];
  const capability = mission ? resolveCapabilitySet(content.mechanics, mission.mechanics).arsenal : undefined;
  const module = content.mechanics.modules.arsenal;
  if (!mission || !capability?.active || !capability.profileId || !module || module.schemaVersion !== 1 || module.enabled !== true) return undefined;
  const profile = module.profiles[capability.profileId];
  if (profile === undefined) return undefined;
  try {
    return Object.freeze({ schemaVersion: 1, profileId: capability.profileId, ...normalizeArsenalProfileV1(profile) });
  } catch {
    return undefined;
  }
}
