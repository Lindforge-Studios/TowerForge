const MAX_ROWS = 512;
const MAX_OPTIONS = 512;
const MAX_RECIPES = 512;
const MAX_PATTERN = 9;
const MAX_TEXT = 256;

const INACTIVE = Object.freeze({ active: false, profileId: null, managementAllowed: false, towers: Object.freeze([]), craftingRecipes: Object.freeze([]) });

function record(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  let descriptors;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { return null; }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) return null;
  const names = Object.keys(descriptors);
  if (names.length !== keys.length || keys.some((key) => !names.includes(key))) return null;
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function array(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) return null;
  let descriptors;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { return null; }
  if (Object.keys(descriptors).length !== value.length + 1) return null;
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    result.push(descriptor.value);
  }
  return result;
}

function text(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT ? value : null;
}

function options(value) {
  const entries = array(value, MAX_OPTIONS);
  if (!entries) return null;
  const seen = new Set();
  const projected = [];
  for (const value of entries) {
    const entry = record(value, ["id", "label"]);
    const id = entry && text(entry.id);
    const label = entry && text(entry.label);
    if (!id || !label || seen.has(id)) return null;
    seen.add(id);
    projected.push(Object.freeze({ id, label }));
  }
  return Object.freeze(projected);
}

export function projectArsenalPresentation(snapshot) {
  if (snapshot === undefined || snapshot === null || !("arsenal" in snapshot)) return INACTIVE;
  const section = record(snapshot.arsenal, ["schemaVersion", "profileId", "managementAllowed", "towers", "craftingRecipes"]);
  if (!section || section.schemaVersion !== 1 || typeof section.managementAllowed !== "boolean") return undefined;
  const profileId = text(section.profileId);
  const rows = array(section.towers, MAX_ROWS);
  const recipes = array(section.craftingRecipes, MAX_RECIPES);
  if (!profileId || !rows || !recipes) return undefined;
  const towerIds = new Set();
  const towers = [];
  for (const value of rows) {
    const row = record(value, ["towerId", "schemaVersion", "towerTypeId", "modules", "footprint", "damageMultiplier", "rangeMultiplier", "durabilityMultiplier", "availableModules"]);
    const towerId = row && text(row.towerId);
    const towerTypeId = row && text(row.towerTypeId);
    const modules = row && record(row.modules, ["base", "barrel", "core"]);
    const available = row && record(row.availableModules, ["base", "barrel", "core"]);
    const base = modules && text(modules.base);
    const barrel = modules && text(modules.barrel);
    const core = modules && text(modules.core);
    const availableModules = available && {
      base: options(available.base), barrel: options(available.barrel), core: options(available.core)
    };
    if (!towerId || !towerTypeId || towerIds.has(towerId) || row.schemaVersion !== 1
      || !base || !barrel || !core || !availableModules?.base || !availableModules.barrel || !availableModules.core
      || ![row.damageMultiplier, row.rangeMultiplier, row.durabilityMultiplier].every((entry) => typeof entry === "number" && Number.isFinite(entry))) return undefined;
    towerIds.add(towerId);
    towers.push(Object.freeze({
      towerId, towerTypeId,
      modules: Object.freeze({ base, barrel, core }),
      availableModules: Object.freeze(availableModules),
      damageMultiplier: row.damageMultiplier,
      rangeMultiplier: row.rangeMultiplier,
      durabilityMultiplier: row.durabilityMultiplier
    }));
  }
  const recipeIds = new Set();
  const craftingRecipes = [];
  for (const value of recipes) {
    const recipe = record(value, ["id", "outputArtifactId", "allowRotations", "pattern"]);
    const id = recipe && text(recipe.id);
    const outputArtifactId = recipe && text(recipe.outputArtifactId);
    const pattern = recipe && array(recipe.pattern, MAX_PATTERN);
    if (!id || !outputArtifactId || recipeIds.has(id) || typeof recipe.allowRotations !== "boolean" || !pattern || pattern.length === 0) return undefined;
    const cells = pattern.map((value) => {
      const cell = record(value, ["x", "y", "artifactId"]);
      return cell && Number.isSafeInteger(cell.x) && cell.x >= 0 && cell.x <= 2
        && Number.isSafeInteger(cell.y) && cell.y >= 0 && cell.y <= 2 && text(cell.artifactId)
        ? Object.freeze({ x: cell.x, y: cell.y, artifactId: cell.artifactId }) : null;
    });
    if (cells.some((cell) => cell === null)) return undefined;
    recipeIds.add(id);
    craftingRecipes.push(Object.freeze({ id, outputArtifactId, allowRotations: recipe.allowRotations, pattern: Object.freeze(cells) }));
  }
  return Object.freeze({ active: true, profileId, managementAllowed: section.managementAllowed, towers: Object.freeze(towers), craftingRecipes: Object.freeze(craftingRecipes) });
}
