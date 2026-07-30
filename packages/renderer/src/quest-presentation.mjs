const INVALID = Symbol("invalid");
const QUEST_LIMIT = 3;
const EVENT_LIMIT = 64;
const QUEST_KINDS = new Set(["kill_with_source", "preserve_shield"]);
const QUEST_STATUSES = new Set(["active", "completed", "failed"]);

function ownData(record, key) {
  if (record === null || typeof record !== "object") return INVALID;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : INVALID;
  } catch {
    return INVALID;
  }
}

function denseArray(value, maximum) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = descriptors.length;
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum
      || Object.getOwnPropertySymbols(descriptors).length > 0
      || Object.keys(descriptors).length !== length + 1) return undefined;
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return undefined;
  }
}

function boundedString(value, maximumBytes) {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  try { return new TextEncoder().encode(value).length <= maximumBytes ? value : undefined; }
  catch { return undefined; }
}

function projectEntry(value, previousQuestId) {
  const questId = boundedString(ownData(value, "questId"), 128);
  const label = boundedString(ownData(value, "label"), 256);
  const kind = ownData(value, "kind");
  const current = ownData(value, "current");
  const target = ownData(value, "target");
  const status = ownData(value, "status");
  if (questId === undefined || label === undefined || !QUEST_KINDS.has(kind) || !QUEST_STATUSES.has(status)
    || !Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(target) || target < 1
    || current > target || (previousQuestId !== undefined && previousQuestId >= questId)) return undefined;
  if ((status === "active" && current >= target) || (status === "completed" && current !== target)
    || (status === "failed" && (kind !== "preserve_shield" || current >= target))) return undefined;
  return Object.freeze({ questId, label, kind, current, target, status, progress: current / target });
}

function projectCue(value, questEntries) {
  const eventType = ownData(value, "type");
  if (eventType !== "questCompleted" && eventType !== "questFailed") return undefined;
  const questId = boundedString(ownData(value, "questId"), 128);
  const kind = ownData(value, "kind");
  const entry = questId === undefined ? undefined : questEntries.get(questId);
  const expectedStatus = eventType === "questCompleted" ? "completed" : "failed";
  if (questId === undefined || !QUEST_KINDS.has(kind) || entry?.kind !== kind
    || entry.status !== expectedStatus) return null;
  return Object.freeze({
    type: eventType === "questCompleted" ? "completed" : "failed",
    questId,
    kind
  });
}

/** Project the optional authoritative quest snapshot for Canvas, Phaser, and Studio players. */
export function projectQuestPresentation(snapshot) {
  const quests = ownData(snapshot, "quests");
  if (quests === INVALID) return null;
  const schemaVersion = ownData(quests, "schemaVersion");
  const profileId = boundedString(ownData(quests, "profileId"), 128);
  const values = denseArray(ownData(quests, "entries"), QUEST_LIMIT);
  if (schemaVersion !== 1 || profileId === undefined || values === undefined) return null;
  const entries = [];
  let previousQuestId;
  for (const value of values) {
    const entry = projectEntry(value, previousQuestId);
    if (!entry) return null;
    entries.push(entry);
    previousQuestId = entry.questId;
  }
  const questEntries = new Map(entries.map((entry) => [entry.questId, entry]));
  const eventValues = denseArray(ownData(snapshot, "lastEvents"), EVENT_LIMIT);
  if (eventValues === undefined) return null;
  const cues = [];
  for (const value of eventValues) {
    const cue = projectCue(value, questEntries);
    if (cue === null) return null;
    if (cue) cues.push(cue);
  }
  return Object.freeze({
    schemaVersion: 1,
    profileId,
    entries: Object.freeze(entries),
    cues: Object.freeze(cues)
  });
}
