const MAX_UNITS = 1;
const MAX_ID_BYTES = 128;
const MAX_LABEL_BYTES = 128;
const MAX_COORDINATE = 1_000_000;
const MAX_DURABILITY = 1_000_000_000_000;
const MAX_ABILITY_COOLDOWN = 86_400;
const MAX_ABILITY_RANGE = 65_536;
const MAX_SKILL_POINTS = 65_536;
const MAX_SKILL_NODES = 32;
const MAX_SKILL_REQUIREMENTS = 8;
const MAX_DESCRIPTION_BYTES = 512;

const INACTIVE = Object.freeze({ active: false, units: Object.freeze([]) });

function ownData(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function exactRecord(value, allowedKeys) {
  if (value === null || typeof value !== "object") return null;
  let prototype;
  let descriptors;
  try {
    if (Array.isArray(value)) return null;
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(descriptors).length > 0) return null;
  const keys = Object.keys(descriptors);
  if (keys.length !== allowedKeys.length || keys.some((key) => !allowedKeys.includes(key))) return null;
  const detached = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
  }
  return detached;
}

function denseArray(value, maximum) {
  let descriptors;
  try {
    if (!Array.isArray(value)) return null;
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) return null;
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
  if (Reflect.ownKeys(descriptors).some((key) => (
    key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)
  ))) return null;
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    result.push(descriptor.value);
  }
  return result;
}

function boundedText(value, maximumBytes) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return null;
  try {
    return new TextEncoder().encode(value).length <= maximumBytes ? value : null;
  } catch {
    return null;
  }
}

function coordinate(value) {
  const coord = exactRecord(value, ["q", "r"]);
  if (!coord || !Number.isSafeInteger(coord.q) || !Number.isSafeInteger(coord.r)
    || coord.q < 0 || coord.r < 0 || coord.q > MAX_COORDINATE || coord.r > MAX_COORDINATE) return null;
  return Object.freeze({ q: coord.q, r: coord.r });
}

function nullableCoordinate(value) {
  return value === null ? null : coordinate(value);
}

function movement(value) {
  const record = exactRecord(value, ["targetCoord", "nextCoord", "edgeProgress"]);
  if (!record) return null;
  const targetCoord = nullableCoordinate(record.targetCoord);
  const nextCoord = nullableCoordinate(record.nextCoord);
  const edgeProgress = record.edgeProgress;
  if ((record.targetCoord !== null && !targetCoord)
    || (record.nextCoord !== null && !nextCoord)
    || typeof edgeProgress !== "number" || !Number.isFinite(edgeProgress)
    || edgeProgress < 0 || edgeProgress >= 1
    || (nextCoord === null && edgeProgress !== 0)
    || (targetCoord === null && nextCoord !== null)) return null;
  return Object.freeze({ targetCoord, nextCoord, edgeProgress });
}

function boundedDurabilityNumber(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value)
    && value >= minimum && value <= maximum ? value : null;
}

function durability(value) {
  const record = exactRecord(value, ["hp", "maxHp", "shield", "defeated"]);
  if (!record) return null;
  const maxHp = boundedDurabilityNumber(record.maxHp, Number.MIN_VALUE, MAX_DURABILITY);
  const hp = maxHp === null ? null : boundedDurabilityNumber(record.hp, 0, maxHp);
  if (hp === null || maxHp === null || typeof record.defeated !== "boolean"
    || record.defeated !== (hp === 0)) return null;
  let shield = null;
  if (record.shield !== null) {
    const shieldRecord = exactRecord(record.shield, ["current", "capacity"]);
    if (!shieldRecord) return null;
    const capacity = boundedDurabilityNumber(shieldRecord.capacity, Number.MIN_VALUE, MAX_DURABILITY);
    const current = capacity === null ? null : boundedDurabilityNumber(shieldRecord.current, 0, capacity);
    if (capacity === null || current === null) return null;
    shield = Object.freeze({ current, capacity });
  }
  if (hp < maxHp && shield !== null && shield.current > 0) return null;
  return Object.freeze({ hp, maxHp, shield, defeated: record.defeated });
}

function mana(value) {
  const record = exactRecord(value, ["current", "max", "regenerationPerUnit"]);
  if (!record) return null;
  const max = boundedDurabilityNumber(record.max, Number.MIN_VALUE, MAX_DURABILITY);
  const current = max === null ? null : boundedDurabilityNumber(record.current, 0, max);
  const regenerationPerUnit = boundedDurabilityNumber(
    record.regenerationPerUnit, 0, MAX_DURABILITY
  );
  if (max === null || current === null || regenerationPerUnit === null) return null;
  return Object.freeze({ current, max, regenerationPerUnit });
}

function activeAbility(value, projectedMana, projectedDurability) {
  const record = exactRecord(value, [
    "id", "label", "target", "manaCost", "cooldown", "cooldownRemaining",
    "range", "damage", "ready"
  ]);
  if (!record) return null;
  const id = boundedText(record.id, MAX_ID_BYTES);
  const label = boundedText(record.label, MAX_LABEL_BYTES);
  const manaCost = boundedDurabilityNumber(record.manaCost, Number.MIN_VALUE, projectedMana.max);
  const cooldown = boundedDurabilityNumber(record.cooldown, 0, MAX_ABILITY_COOLDOWN);
  const cooldownRemaining = cooldown === null
    ? null
    : boundedDurabilityNumber(record.cooldownRemaining, 0, cooldown);
  const range = Number.isSafeInteger(record.range) && record.range >= 0 && record.range <= MAX_ABILITY_RANGE
    ? record.range
    : null;
  const damage = boundedDurabilityNumber(record.damage, Number.MIN_VALUE, MAX_DURABILITY);
  if (!id || !label || record.target !== "enemy" || manaCost === null || cooldown === null
    || cooldownRemaining === null || range === null || damage === null
    || typeof record.ready !== "boolean") return null;
  const expectedReady = !projectedDurability.defeated
    && projectedMana.current >= manaCost
    && cooldownRemaining === 0;
  if (record.ready !== expectedReady) return null;
  return Object.freeze({
    id, label, target: "enemy", manaCost, cooldown, cooldownRemaining, range, damage,
    ready: record.ready
  });
}

function skillIdList(value) {
  const source = denseArray(value, MAX_SKILL_REQUIREMENTS);
  if (!source) return null;
  const ids = [];
  const seen = new Set();
  for (const value of source) {
    const id = boundedText(value, MAX_ID_BYTES);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return Object.freeze(ids);
}

function skills(value) {
  const record = exactRecord(value, [
    "availablePoints", "startingPoints", "pointsPerInterwave", "maximumEarnablePoints",
    "managementAvailable", "nodes"
  ]);
  if (!record || typeof record.managementAvailable !== "boolean") return null;
  for (const field of ["availablePoints", "startingPoints", "pointsPerInterwave", "maximumEarnablePoints"]) {
    if (!Number.isSafeInteger(record[field]) || record[field] < 0 || record[field] > MAX_SKILL_POINTS) {
      return null;
    }
  }
  if (record.availablePoints > record.maximumEarnablePoints
    || record.startingPoints > record.maximumEarnablePoints) return null;
  const sourceNodes = denseArray(record.nodes, MAX_SKILL_NODES);
  if (!sourceNodes) return null;
  const projectedNodes = [];
  const ids = new Set();
  for (const value of sourceNodes) {
    const node = exactRecord(value, [
      "id", "label", "description", "cost", "requiresSkillIds", "missingRequirementIds",
      "unlocked", "unlockable"
    ]);
    if (!node) return null;
    const id = boundedText(node.id, MAX_ID_BYTES);
    const label = boundedText(node.label, MAX_LABEL_BYTES);
    const description = boundedText(node.description, MAX_DESCRIPTION_BYTES);
    const requiresSkillIds = skillIdList(node.requiresSkillIds);
    const missingRequirementIds = skillIdList(node.missingRequirementIds);
    if (!id || !label || !description || !requiresSkillIds || !missingRequirementIds
      || ids.has(id) || !Number.isSafeInteger(node.cost) || node.cost < 1
      || node.cost > MAX_SKILL_POINTS || typeof node.unlocked !== "boolean"
      || typeof node.unlockable !== "boolean") return null;
    const required = new Set(requiresSkillIds);
    if (missingRequirementIds.some((requirementId) => !required.has(requirementId))) return null;
    if (node.unlocked && missingRequirementIds.length > 0) return null;
    // Unlockability is authoritative gameplay state. Presentation validates only impossible
    // combinations and must not reconstruct phase, liveness, prerequisite, or point rules.
    if (node.unlocked && node.unlockable) return null;
    ids.add(id);
    projectedNodes.push(Object.freeze({
      id, label, description, cost: node.cost, requiresSkillIds, missingRequirementIds,
      unlocked: node.unlocked, unlockable: node.unlockable
    }));
  }
  for (const node of projectedNodes) {
    if (node.requiresSkillIds.some((requirementId) => !ids.has(requirementId))) return null;
  }
  return Object.freeze({
    availablePoints: record.availablePoints,
    startingPoints: record.startingPoints,
    pointsPerInterwave: record.pointsPerInterwave,
    maximumEarnablePoints: record.maximumEarnablePoints,
    managementAvailable: record.managementAvailable,
    nodes: Object.freeze(projectedNodes)
  });
}

/**
 * Project only the authoritative optional engine snapshot. Invalid/future/untrusted shapes fail
 * closed to the same inactive sentinel; renderers never reconstruct a hero from mechanics data.
 */
export function projectHeroesPresentation(snapshot) {
  const value = ownData(snapshot, "heroes");
  if (value === undefined || value === null) return INACTIVE;
  const section = exactRecord(value, ["schemaVersion", "units"]);
  if (!section || (section.schemaVersion !== 1 && section.schemaVersion !== 2
    && section.schemaVersion !== 3 && section.schemaVersion !== 4
    && section.schemaVersion !== 5)) return INACTIVE;
  const authoredUnits = denseArray(section.units, MAX_UNITS);
  if (!authoredUnits || authoredUnits.length !== 1) return INACTIVE;
  const units = [];
  const ids = new Set();
  const definitionIds = new Set();
  for (const value of authoredUnits) {
    const unit = exactRecord(value, section.schemaVersion === 1
      ? ["id", "definitionId", "label", "coord"]
      : section.schemaVersion === 2
        ? ["id", "definitionId", "label", "coord", "movement"]
        : section.schemaVersion === 3
          ? ["id", "definitionId", "label", "coord", "movement", "durability"]
          : section.schemaVersion === 4
            ? ["id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility"]
            : ["id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility", "skills"]);
    if (!unit) return INACTIVE;
    const id = boundedText(unit.id, MAX_ID_BYTES);
    const definitionId = boundedText(unit.definitionId, MAX_ID_BYTES);
    const label = boundedText(unit.label, MAX_LABEL_BYTES);
    const coord = coordinate(unit.coord);
    if (!id || !definitionId || id !== definitionId || !label || !coord
      || ids.has(id) || definitionIds.has(definitionId)) return INACTIVE;
    ids.add(id);
    definitionIds.add(definitionId);
    if (section.schemaVersion === 1) {
      units.push(Object.freeze({ id, definitionId, label, coord }));
      continue;
    }
    const projectedMovement = movement(unit.movement);
    if (!projectedMovement) return INACTIVE;
    if (section.schemaVersion === 2) {
      units.push(Object.freeze({ id, definitionId, label, coord, movement: projectedMovement }));
      continue;
    }
    const projectedDurability = durability(unit.durability);
    if (!projectedDurability) return INACTIVE;
    if (section.schemaVersion === 3) {
      units.push(Object.freeze({
        id, definitionId, label, coord, movement: projectedMovement, durability: projectedDurability
      }));
      continue;
    }
    const projectedMana = mana(unit.mana);
    const projectedAbility = projectedMana
      ? activeAbility(unit.activeAbility, projectedMana, projectedDurability)
      : null;
    if (!projectedMana || !projectedAbility) return INACTIVE;
    if (section.schemaVersion === 4) {
      units.push(Object.freeze({
        id, definitionId, label, coord, movement: projectedMovement, durability: projectedDurability,
        mana: projectedMana, activeAbility: projectedAbility
      }));
      continue;
    }
    const projectedSkills = skills(unit.skills);
    if (!projectedSkills) return INACTIVE;
    units.push(Object.freeze({
      id, definitionId, label, coord, movement: projectedMovement, durability: projectedDurability,
      mana: projectedMana, activeAbility: projectedAbility, skills: projectedSkills
    }));
  }
  return Object.freeze({ active: true, units: Object.freeze(units) });
}

/** Convert one detached presentation unit into a renderer point without pathfinding. */
export function projectHeroPresentationPoint(hero, coordToPoint) {
  if (typeof coordToPoint !== "function") return undefined;
  try {
    const current = coordinate(ownData(hero, "coord"));
    if (!current) return undefined;
    const currentPoint = coordToPoint(current);
    if (!currentPoint || !Number.isFinite(currentPoint.x) || !Number.isFinite(currentPoint.y)) return undefined;
    const authoredMovement = ownData(hero, "movement");
    if (authoredMovement === undefined) return { x: currentPoint.x, y: currentPoint.y };
    const projectedMovement = movement(authoredMovement);
    if (!projectedMovement) return undefined;
    if (projectedMovement.nextCoord === null) return { x: currentPoint.x, y: currentPoint.y };
    const nextPoint = coordToPoint(projectedMovement.nextCoord);
    if (!nextPoint || !Number.isFinite(nextPoint.x) || !Number.isFinite(nextPoint.y)) return undefined;
    const progress = projectedMovement.edgeProgress;
    return {
      x: currentPoint.x + (nextPoint.x - currentPoint.x) * progress,
      y: currentPoint.y + (nextPoint.y - currentPoint.y) * progress
    };
  } catch {
    return undefined;
  }
}

/** Presentation-only hit test; returns an authoritative snapshot unit id or null. */
export function hitTestHeroesPresentation(presentation, point, coordToPoint, radius = 0) {
  if (!presentation?.active || !Array.isArray(presentation.units)
    || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || !Number.isFinite(radius) || radius < 0) return null;
  for (const hero of presentation.units) {
    const projected = projectHeroPresentationPoint(hero, coordToPoint);
    if (!projected) continue;
    const dx = projected.x - point.x;
    const dy = projected.y - point.y;
    if (dx * dx + dy * dy <= radius * radius) return hero.id;
  }
  return null;
}

/**
 * Select a live authoritative enemy for presentation targeting. A finite radius performs a
 * pointer hit-test; null selects the nearest live enemy for keyboard targeting. Equal distances
 * use binary enemy id order so browser/locale/input ordering cannot affect the command envelope.
 */
export function selectHeroAbilityEnemy(enemies, point, enemyToPoint, radius = null) {
  const authoredEnemies = denseArray(enemies, 16_384);
  if (!authoredEnemies || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || typeof enemyToPoint !== "function"
    || (radius !== null && (!Number.isFinite(radius) || radius < 0))) return null;
  let best = null;
  let bestDistanceSquared = Infinity;
  for (const enemy of authoredEnemies) {
    const id = boundedText(ownData(enemy, "id"), MAX_ID_BYTES);
    const hp = ownData(enemy, "hp");
    if (!id || typeof hp !== "number" || !Number.isFinite(hp) || hp <= 0) continue;
    let projected;
    try { projected = enemyToPoint(enemy); } catch { continue; }
    if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) continue;
    const dx = projected.x - point.x;
    const dy = projected.y - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (radius !== null && distanceSquared > radius * radius) continue;
    if (distanceSquared < bestDistanceSquared
      || (distanceSquared === bestDistanceSquared && (best === null || id < best))) {
      best = id;
      bestDistanceSquared = distanceSquared;
    }
  }
  return best;
}
