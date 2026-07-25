const SHIELD_CHANGE_TYPES = new Set(["enemyShieldChanged", "towerShieldChanged"]);
const SHIELD_CHANGE_CAUSES = new Set(["damage", "regeneration", "script"]);
const MARK_CHANGE_CAUSES = new Set(["application", "consume", "expiration", "script"]);
const EXPOSURE_CHANGE_CAUSES = new Set(["damage", "consume", "expiration", "script"]);
const MAX_PRESENTATION_EVENTS = 256;
const MAX_PRESENTATION_COORDINATE = 1_000_000;
const MAX_PRESENTED_MARKS_PER_ENEMY = 8;
const MAX_MARK_STACKS = 256;
const MAX_MARK_REMAINING = 1_000_000_000;
const MAX_PRESENTED_EXPOSURES_PER_ENEMY = 8;
const MAX_REACTION_CUES = 32;
const MAX_EXPOSURE_STACKS = 256;
const MAX_EXPOSURE_REMAINING = 1_000_000_000;
const MAX_REACTION_DEPTH = 4;
const MAX_REACTION_TARGETS = 256;

function objectLike(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownData(value, key) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return null;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return null;
  }
  return descriptor && "value" in descriptor ? descriptor : null;
}

function ownDataValue(value, key) {
  return ownData(value, key)?.value;
}

function combatSnapshot(snapshot, supportedSchemaVersions) {
  if (!objectLike(snapshot)) return null;
  const combat = ownDataValue(snapshot, "combat");
  if (!objectLike(combat) || !supportedSchemaVersions.includes(ownDataValue(combat, "schemaVersion"))) return null;
  return combat;
}

function combatShields(snapshot) {
  const combat = combatSnapshot(snapshot, [1, 2]);
  if (!combat) return null;
  const shields = ownDataValue(combat, "shields");
  return objectLike(shields) ? shields : null;
}

function shieldEventSchemaAllowed(snapshot) {
  if (!objectLike(snapshot)) return false;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(snapshot, "combat");
  } catch {
    return false;
  }
  // A terminal event may be rendered after the entity and optional combat
  // section have already left the snapshot. An explicitly present combat
  // section must still be a supported v1/v2 snapshot so future schemas fail
  // closed rather than being interpreted by an older renderer.
  if (descriptor === undefined) return true;
  if (!("value" in descriptor)) return false;
  return combatShields(snapshot) !== null;
}

function shieldRecord(snapshot, kind) {
  const shields = combatShields(snapshot);
  if (!shields) return null;
  const key = kind === "enemy" ? "enemies" : kind === "tower" ? "towers" : null;
  if (!key) return null;
  const record = ownDataValue(shields, key);
  return objectLike(record) ? record : null;
}

function markEventSchemaAllowed(snapshot) {
  if (!objectLike(snapshot)) return false;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(snapshot, "combat");
  } catch {
    return false;
  }
  // Expiration/consumption may remove the last mark and therefore the optional
  // combat section in the same presentation frame. If combat is present, only
  // the v2 runtime state may authorize mark cues.
  if (descriptor === undefined) return true;
  if (!("value" in descriptor)) return false;
  return combatSnapshot(snapshot, [2]) !== null;
}

function markEnemyRecord(snapshot) {
  const combat = combatSnapshot(snapshot, [2]);
  if (!combat) return null;
  const marks = ownDataValue(combat, "marks");
  if (!objectLike(marks)) return null;
  const enemies = ownDataValue(marks, "enemies");
  return objectLike(enemies) ? enemies : null;
}

function reactionSnapshot(snapshot) {
  if (!objectLike(snapshot)) return null;
  const reactions = ownDataValue(snapshot, "reactions");
  if (!objectLike(reactions) || ownDataValue(reactions, "schemaVersion") !== 1) return null;
  const exposures = ownDataValue(reactions, "exposures");
  const enemies = objectLike(exposures) ? ownDataValue(exposures, "enemies") : null;
  return objectLike(enemies) ? reactions : null;
}

function reactionEnemyRecord(snapshot) {
  const reactions = reactionSnapshot(snapshot);
  if (!reactions) return null;
  return ownDataValue(ownDataValue(reactions, "exposures"), "enemies");
}

function reactionEventSchemaAllowed(snapshot) {
  if (!objectLike(snapshot)) return false;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(snapshot, "reactions");
  } catch {
    return false;
  }
  return descriptor === undefined || ("value" in descriptor && reactionSnapshot(snapshot) !== null);
}

/**
 * Project the optional combat snapshot into a renderer-only shield view.
 *
 * The projection deliberately reads own data descriptors instead of ordinary
 * property access. Runtime ids such as "__proto__" therefore remain valid,
 * inherited entries are ignored, and untrusted accessor properties are never
 * invoked by the renderer.
 */
export function resolveShieldPresentation(snapshot, kind, runtimeId) {
  if (typeof runtimeId !== "string") return null;
  const record = shieldRecord(snapshot, kind);
  if (!record) return null;
  const value = ownDataValue(record, runtimeId);
  if (!objectLike(value)) return null;

  const current = ownDataValue(value, "current");
  const capacity = ownDataValue(value, "capacity");
  const regenerationDelayRemaining = ownDataValue(value, "regenerationDelayRemaining");
  if (
    !Number.isFinite(current)
    || !Number.isFinite(capacity)
    || capacity <= 0
    || !Number.isFinite(regenerationDelayRemaining)
    || regenerationDelayRemaining < 0
  ) {
    return null;
  }

  return {
    current,
    capacity,
    ratio: Math.max(0, Math.min(1, current / capacity)),
    regenerationDelayRemaining
  };
}

/**
 * Project combat-v2 mark state into a bounded renderer-only badge model.
 * Filtering, stacking, duration and damage multiplication remain engine rules.
 */
export function resolveMarkPresentation(snapshot, enemyId) {
  const empty = { entries: [], overflowCount: 0 };
  if (typeof enemyId !== "string") return empty;
  const enemies = markEnemyRecord(snapshot);
  if (!enemies) return empty;
  const markRecord = ownDataValue(enemies, enemyId);
  if (!objectLike(markRecord)) return empty;

  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(markRecord);
  } catch {
    return empty;
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) return empty;

  const valid = [];
  for (const markId of Object.keys(descriptors).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
    const descriptor = descriptors[markId];
    if (!descriptor || !("value" in descriptor) || !objectLike(descriptor.value) || markId.length === 0) continue;
    const stacks = finiteOwnNumber(descriptor.value, "stacks");
    const remaining = finiteOwnNumber(descriptor.value, "remaining");
    if (
      stacks === null
      || !Number.isSafeInteger(stacks)
      || stacks < 1
      || stacks > MAX_MARK_STACKS
      || remaining === null
      || remaining <= 0
      || remaining > MAX_MARK_REMAINING
    ) continue;
    valid.push({ markId, stacks, remaining });
  }
  return {
    entries: valid.slice(0, MAX_PRESENTED_MARKS_PER_ENEMY),
    overflowCount: Math.max(0, valid.length - MAX_PRESENTED_MARKS_PER_ENEMY)
  };
}

/** Project reactions-v1 exposure state into bounded renderer-only badges. */
export function resolveExposurePresentation(snapshot, enemyId) {
  const empty = { entries: [], overflowCount: 0 };
  if (typeof enemyId !== "string") return empty;
  const enemies = reactionEnemyRecord(snapshot);
  if (!objectLike(enemies)) return empty;
  const exposureRecord = ownDataValue(enemies, enemyId);
  if (!objectLike(exposureRecord)) return empty;

  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(exposureRecord);
  } catch {
    return empty;
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) return empty;
  const entries = [];
  for (const exposureId of Object.keys(descriptors).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
    const descriptor = descriptors[exposureId];
    if (!descriptor || !("value" in descriptor) || !objectLike(descriptor.value) || exposureId.length === 0) continue;
    const stacks = finiteOwnNumber(descriptor.value, "stacks");
    const remaining = finiteOwnNumber(descriptor.value, "remaining");
    if (
      stacks === null
      || !Number.isSafeInteger(stacks)
      || stacks < 1
      || stacks > MAX_EXPOSURE_STACKS
      || remaining === null
      || remaining <= 0
      || remaining > MAX_EXPOSURE_REMAINING
    ) continue;
    entries.push({ exposureId, stacks, remaining });
  }
  return {
    entries: entries.slice(0, MAX_PRESENTED_EXPOSURES_PER_ENEMY),
    overflowCount: Math.max(0, entries.length - MAX_PRESENTED_EXPOSURES_PER_ENEMY)
  };
}

function finiteOwnNumber(value, key) {
  const result = ownDataValue(value, key);
  return Number.isFinite(result) ? result : null;
}

function projectCoordinate(value) {
  if (!objectLike(value)) return null;
  const q = finiteOwnNumber(value, "q");
  const r = finiteOwnNumber(value, "r");
  if (
    q === null
    || r === null
    || !Number.isSafeInteger(q)
    || !Number.isSafeInteger(r)
    || q < 0
    || r < 0
    || q > MAX_PRESENTATION_COORDINATE
    || r > MAX_PRESENTATION_COORDINATE
  ) {
    return null;
  }
  return { q, r };
}

/** Safely detach the snapshot spawn coordinate for presentation fallbacks. */
export function projectSnapshotSpawnCoord(snapshot) {
  if (!objectLike(snapshot)) return null;
  return projectCoordinate(ownDataValue(snapshot, "spawnCoord"));
}

function safeArrayLength(value, maximum = MAX_PRESENTATION_EVENTS) {
  if (!Array.isArray(value)) return 0;
  const length = ownDataValue(value, "length");
  return Number.isSafeInteger(length) && length >= 0
    ? Math.min(length, maximum)
    : 0;
}

/**
 * Safely project the legacy events consumed by the Canvas renderer. This keeps
 * shield events with accessors from reaching the pre-existing direct event
 * reader before the shield-specific projection gets a chance to reject them.
 */
export function projectLegacyPresentationEvents(snapshot) {
  if (!objectLike(snapshot)) return [];
  const events = ownDataValue(snapshot, "lastEvents");
  const length = safeArrayLength(events);
  const projected = [];
  for (let index = 0; index < length; index += 1) {
    const event = ownDataValue(events, String(index));
    if (!objectLike(event)) continue;
    const type = ownDataValue(event, "type");
    if (type === "enemyHit") {
      const enemyId = ownDataValue(event, "enemyId");
      const damage = finiteOwnNumber(event, "damage");
      if (typeof enemyId === "string" && damage !== null) projected.push({ type, enemyId, damage });
    } else if (type === "enemyKilled") {
      const enemyId = ownDataValue(event, "enemyId");
      const enemyTypeId = ownDataValue(event, "enemyTypeId");
      if (typeof enemyId === "string" && typeof enemyTypeId === "string") {
        projected.push({ type, enemyId, enemyTypeId });
      }
    } else if (type === "towerFired") {
      const towerId = ownDataValue(event, "towerId");
      const enemyId = ownDataValue(event, "enemyId");
      if (typeof towerId === "string") {
        projected.push({ type, towerId, ...(typeof enemyId === "string" ? { enemyId } : {}) });
      }
    } else if (type === "enemyLeaked") {
      projected.push({ type });
    } else if (type === "towerPlaced") {
      const towerId = ownDataValue(event, "towerId");
      const coord = projectCoordinate(ownDataValue(event, "coord"));
      if (typeof towerId === "string" && coord) projected.push({ type, towerId, coord });
    }
  }
  return projected;
}

/**
 * Return a bounded, validated view of shield-change events for transient
 * renderer cues. Invalid entries are skipped and no gameplay state is changed.
 */
export function projectShieldPresentationCues(snapshot) {
  if (!shieldEventSchemaAllowed(snapshot)) return [];
  const events = ownDataValue(snapshot, "lastEvents");
  const length = safeArrayLength(events);
  const cues = [];
  for (let index = 0; index < length; index += 1) {
    const event = ownDataValue(events, String(index));
    if (!objectLike(event)) continue;
    const type = ownDataValue(event, "type");
    if (!SHIELD_CHANGE_TYPES.has(type)) continue;
    const cause = ownDataValue(event, "cause");
    if (!SHIELD_CHANGE_CAUSES.has(cause)) continue;
    const kind = type === "enemyShieldChanged" ? "enemy" : "tower";
    const runtimeId = ownDataValue(event, kind === "enemy" ? "enemyId" : "towerId");
    const previous = finiteOwnNumber(event, "previous");
    const current = finiteOwnNumber(event, "current");
    const capacity = finiteOwnNumber(event, "capacity");
    const amount = finiteOwnNumber(event, "amount");
    if (
      typeof runtimeId !== "string"
      || previous === null
      || current === null
      || capacity === null
      || capacity <= 0
      || amount === null
      || amount < 0
    ) {
      continue;
    }
    cues.push({
      kind,
      runtimeId,
      cause,
      change: cause === "damage" && previous > 0 && current <= 0 ? "break" : cause,
      previous,
      current,
      capacity,
      amount
    });
  }
  return cues;
}

/** Return bounded, detached combat-v2 mark state-change cues for renderers. */
export function projectMarkPresentationCues(snapshot) {
  if (!markEventSchemaAllowed(snapshot)) return [];
  const events = ownDataValue(snapshot, "lastEvents");
  const length = safeArrayLength(events);
  const cues = [];
  for (let index = 0; index < length; index += 1) {
    const event = ownDataValue(events, String(index));
    if (!objectLike(event) || ownDataValue(event, "type") !== "enemyMarkChanged") continue;
    const runtimeId = ownDataValue(event, "enemyId");
    const enemyTypeId = ownDataValue(event, "enemyTypeId");
    const markId = ownDataValue(event, "markId");
    const cause = ownDataValue(event, "cause");
    const previousStacks = finiteOwnNumber(event, "previousStacks");
    const currentStacks = finiteOwnNumber(event, "currentStacks");
    const previousRemaining = finiteOwnNumber(event, "previousRemaining");
    const remaining = finiteOwnNumber(event, "remaining");
    if (
      typeof runtimeId !== "string"
      || typeof enemyTypeId !== "string"
      || typeof markId !== "string"
      || runtimeId.length === 0
      || enemyTypeId.length === 0
      || markId.length === 0
      || !MARK_CHANGE_CAUSES.has(cause)
      || previousStacks === null
      || currentStacks === null
      || !Number.isSafeInteger(previousStacks)
      || !Number.isSafeInteger(currentStacks)
      || previousStacks < 0
      || currentStacks < 0
      || previousStacks > MAX_MARK_STACKS
      || currentStacks > MAX_MARK_STACKS
      || previousRemaining === null
      || remaining === null
      || previousRemaining < 0
      || remaining < 0
      || previousRemaining > MAX_MARK_REMAINING
      || remaining > MAX_MARK_REMAINING
    ) continue;
    cues.push({
      kind: "enemy",
      runtimeId,
      enemyTypeId,
      markId,
      cause,
      previousStacks,
      currentStacks,
      previousRemaining,
      remaining
    });
  }
  return cues;
}

/** Return bounded, detached reactions-v1 exposure state-change cues. */
export function projectExposurePresentationCues(snapshot) {
  if (!reactionEventSchemaAllowed(snapshot)) return [];
  const events = ownDataValue(snapshot, "lastEvents");
  const length = safeArrayLength(events);
  const cues = [];
  for (let index = 0; index < length && cues.length < MAX_REACTION_CUES; index += 1) {
    const event = ownDataValue(events, String(index));
    if (!objectLike(event) || ownDataValue(event, "type") !== "enemyExposureChanged") continue;
    const runtimeId = ownDataValue(event, "enemyId");
    const enemyTypeId = ownDataValue(event, "enemyTypeId");
    const exposureId = ownDataValue(event, "exposureId");
    const cause = ownDataValue(event, "cause");
    const previousStacks = finiteOwnNumber(event, "previousStacks");
    const currentStacks = finiteOwnNumber(event, "currentStacks");
    const previousRemaining = finiteOwnNumber(event, "previousRemaining");
    const remaining = finiteOwnNumber(event, "remaining");
    if (
      typeof runtimeId !== "string" || runtimeId.length === 0
      || typeof enemyTypeId !== "string" || enemyTypeId.length === 0
      || typeof exposureId !== "string" || exposureId.length === 0
      || !EXPOSURE_CHANGE_CAUSES.has(cause)
      || previousStacks === null || currentStacks === null
      || !Number.isSafeInteger(previousStacks) || !Number.isSafeInteger(currentStacks)
      || previousStacks < 0 || currentStacks < 0
      || previousStacks > MAX_EXPOSURE_STACKS || currentStacks > MAX_EXPOSURE_STACKS
      || previousRemaining === null || remaining === null
      || previousRemaining < 0 || remaining < 0
      || previousRemaining > MAX_EXPOSURE_REMAINING || remaining > MAX_EXPOSURE_REMAINING
    ) continue;
    cues.push({
      kind: "exposure",
      runtimeId,
      enemyTypeId,
      exposureId,
      cause,
      previousStacks,
      currentStacks,
      previousRemaining,
      remaining
    });
  }
  return cues;
}

/** Return at most 32 detached reaction-trigger cues; gameplay definitions stay in the engine. */
export function projectReactionPresentationCues(snapshot) {
  if (!reactionEventSchemaAllowed(snapshot)) return [];
  const events = ownDataValue(snapshot, "lastEvents");
  const length = safeArrayLength(events);
  const cues = [];
  for (let index = 0; index < length && cues.length < MAX_REACTION_CUES; index += 1) {
    const event = ownDataValue(events, String(index));
    if (!objectLike(event) || ownDataValue(event, "type") !== "enemyReactionTriggered") continue;
    const reactionId = ownDataValue(event, "reactionId");
    const originEnemyId = ownDataValue(event, "originEnemyId");
    const originEnemyTypeId = ownDataValue(event, "originEnemyTypeId");
    const triggerDamageType = ownDataValue(event, "triggerDamageType");
    const originCoord = projectCoordinate(ownDataValue(event, "originCoord"));
    const depth = finiteOwnNumber(event, "depth");
    const targets = ownDataValue(event, "scheduledTargetIds");
    const targetLength = safeArrayLength(targets, MAX_REACTION_TARGETS);
    const targetEnemyIds = [];
    let validTargets = Array.isArray(targets) && targetLength === ownDataValue(targets, "length");
    for (let targetIndex = 0; validTargets && targetIndex < targetLength; targetIndex += 1) {
      const targetId = ownDataValue(targets, String(targetIndex));
      if (typeof targetId !== "string" || targetId.length === 0) validTargets = false;
      else targetEnemyIds.push(targetId);
    }
    if (
      typeof reactionId !== "string" || reactionId.length === 0
      || typeof originEnemyId !== "string" || originEnemyId.length === 0
      || typeof originEnemyTypeId !== "string" || originEnemyTypeId.length === 0
      || typeof triggerDamageType !== "string" || triggerDamageType.length === 0
      || !originCoord
      || depth === null || !Number.isSafeInteger(depth) || depth < 0 || depth > MAX_REACTION_DEPTH
      || !validTargets
    ) continue;
    cues.push({
      kind: "reaction",
      reactionId,
      originEnemyId,
      originEnemyTypeId,
      originCoord,
      triggerDamageType,
      depth,
      targetEnemyIds
    });
  }
  return cues;
}
