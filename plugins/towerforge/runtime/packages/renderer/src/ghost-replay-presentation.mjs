export const GHOST_REPLAY_PRESENTATION_LIMITS = Object.freeze({ towers: 4_096, enemies: 4_096 });

const INACTIVE = Object.freeze({
  active: false,
  ghost: false,
  towers: Object.freeze([]),
  enemies: Object.freeze([])
});

function ownData(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function recordDescriptors(value) {
  try {
    if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
      return undefined;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
      if (!("value" in descriptor) || descriptor.enumerable !== true) return undefined;
    }
    return descriptors;
  } catch {
    return undefined;
  }
}

function descriptorData(descriptors, key) {
  const descriptor = descriptors?.[key];
  return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
}

function arrayWindow(value, limit) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    if (Object.getOwnPropertySymbols(value).length > 0) return undefined;
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const values = [];
    for (let index = 0; index < Math.min(length, limit); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      values.push(descriptor.value);
    }
    return { length, values };
  } catch {
    return undefined;
  }
}

function id(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integer(value) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function towerRow(value) {
  const descriptors = recordDescriptors(value);
  const coordDescriptors = recordDescriptors(descriptorData(descriptors, "coord"));
  const towerId = id(descriptorData(descriptors, "id"));
  const typeId = id(descriptorData(descriptors, "typeId"));
  const q = integer(descriptorData(coordDescriptors, "q"));
  const r = integer(descriptorData(coordDescriptors, "r"));
  if (towerId === undefined || typeId === undefined || q === undefined || r === undefined) return undefined;
  return Object.freeze({ id: towerId, typeId, coord: Object.freeze({ q, r }) });
}

function enemyRow(value) {
  const descriptors = recordDescriptors(value);
  const enemyId = id(descriptorData(descriptors, "id"));
  const typeId = id(descriptorData(descriptors, "typeId"));
  const hp = finite(descriptorData(descriptors, "hp"));
  const maxHp = finite(descriptorData(descriptors, "maxHp"));
  const pathProgress = finite(descriptorData(descriptors, "pathProgress"));
  if (enemyId === undefined || typeId === undefined || hp === undefined || maxHp === undefined
    || pathProgress === undefined) return undefined;
  return Object.freeze({ id: enemyId, typeId, hp, maxHp, pathProgress });
}

function rows(value, projector, limit) {
  const source = arrayWindow(value, limit);
  if (!source) return undefined;
  const projected = [];
  for (const value of source.values) {
    const row = projector(value);
    if (!row) return undefined;
    projected.push(row);
  }
  projected.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return { rows: Object.freeze(projected), sourceLength: source.length };
}

export function projectGhostReplayPresentation(frame) {
  const ghost = ownData(frame, "ghost");
  if (ghost !== true) return INACTIVE;
  if (ownData(frame, "schemaVersion") !== 1) return undefined;
  const sequence = integer(ownData(frame, "sequence"));
  const stateDigest = ownData(frame, "stateDigest");
  const snapshot = ownData(frame, "snapshot");
  if (sequence === undefined || sequence < 0 || typeof stateDigest !== "string"
    || !/^tf-state-v1:[0-9a-f]{16}$/.test(stateDigest) || snapshot === undefined) return undefined;
  const coreHp = finite(ownData(snapshot, "coreHp"));
  const maxCoreHp = finite(ownData(snapshot, "maxCoreHp"));
  const sourceTowers = ownData(snapshot, "towers");
  const sourceEnemies = ownData(snapshot, "enemies");
  if (coreHp === undefined || maxCoreHp === undefined) return undefined;
  const projectedTowers = rows(sourceTowers, towerRow, GHOST_REPLAY_PRESENTATION_LIMITS.towers);
  const projectedEnemies = rows(sourceEnemies, enemyRow, GHOST_REPLAY_PRESENTATION_LIMITS.enemies);
  if (!projectedTowers || !projectedEnemies) return undefined;
  return Object.freeze({
    active: true,
    ghost: true,
    sequence,
    stateDigest,
    coreHp,
    maxCoreHp,
    towers: projectedTowers.rows,
    enemies: projectedEnemies.rows,
    towerOverflow: projectedTowers.sourceLength - projectedTowers.rows.length,
    enemyOverflow: projectedEnemies.sourceLength - projectedEnemies.rows.length
  });
}
