import { SeededRng } from "../simulation/rng.js";
import { resolveCapabilitySet } from "./mechanics.js";
export const QUEST_LIMITS = Object.freeze({
    selectionCount: 3,
    definitions: 256,
    weight: 1_000_000,
    count: 1_000_000,
    waves: 10_000,
    idUtf8Bytes: 128,
    labelUtf8Bytes: 256
});
export const QUEST_SOURCE_KINDS = Object.freeze([
    "tower", "ability", "tower_script", "status", "reaction"
]);
export const QUEST_SHIELD_SCOPES = Object.freeze(["tower", "hero", "any"]);
export class QuestProfileValidationError extends Error {
}
function utf8Bytes(value) {
    return new TextEncoder().encode(value).length;
}
function dataRecord(value, path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new QuestProfileValidationError(`${path} must be a plain object.`);
    }
    let prototype;
    let descriptors;
    try {
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        throw new QuestProfileValidationError(`${path} could not be inspected safely.`);
    }
    if (prototype !== Object.prototype && prototype !== null) {
        throw new QuestProfileValidationError(`${path} must be a plain object with no custom prototype.`);
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new QuestProfileValidationError(`${path} rejects symbol fields.`);
    }
    const result = Object.create(null);
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new QuestProfileValidationError(`${path}.${key} must be an enumerable own data property; accessors are forbidden.`);
        }
        Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
    }
    return result;
}
function closed(record, fields, path) {
    const expected = new Set(fields);
    for (const key of Object.keys(record)) {
        if (!expected.has(key))
            throw new QuestProfileValidationError(`${path} is closed; unknown field "${key}".`);
    }
    for (const key of fields) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
            throw new QuestProfileValidationError(`${path}.${key} is required.`);
        }
    }
}
function boundedString(value, path, maxBytes) {
    if (typeof value !== "string" || value.length === 0 || value !== value.trim()
        || /[\u0000-\u001f\u007f]/.test(value) || utf8Bytes(value) > maxBytes) {
        throw new QuestProfileValidationError(`${path} must be a bounded non-empty UTF-8 string of at most ${maxBytes} bytes.`);
    }
    return value;
}
function boundedInteger(value, path, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new QuestProfileValidationError(`${path} must be an integer in ${minimum}..${maximum}.`);
    }
    return value;
}
function normalizeObjective(value, path) {
    const objective = dataRecord(value, path);
    if (objective.kind === "kill_with_source") {
        closed(objective, ["kind", "count", "source"], path);
        const source = dataRecord(objective.source, `${path}.source`);
        closed(source, ["kind", "id"], `${path}.source`);
        if (typeof source.kind !== "string" || !QUEST_SOURCE_KINDS.includes(source.kind)) {
            throw new QuestProfileValidationError(`${path}.source.kind is unsupported.`);
        }
        return Object.freeze({
            kind: "kill_with_source",
            count: boundedInteger(objective.count, `${path}.count`, 1, QUEST_LIMITS.count),
            source: Object.freeze({
                kind: source.kind,
                id: boundedString(source.id, `${path}.source.id`, QUEST_LIMITS.idUtf8Bytes)
            })
        });
    }
    if (objective.kind === "preserve_shield") {
        closed(objective, ["kind", "waves", "scope"], path);
        if (typeof objective.scope !== "string" || !QUEST_SHIELD_SCOPES.includes(objective.scope)) {
            throw new QuestProfileValidationError(`${path}.scope is unsupported.`);
        }
        return Object.freeze({
            kind: "preserve_shield",
            waves: boundedInteger(objective.waves, `${path}.waves`, 1, QUEST_LIMITS.waves),
            scope: objective.scope
        });
    }
    throw new QuestProfileValidationError(`${path}.kind is unsupported.`);
}
/** Parse a closed quest profile into detached, binary-ordered, deeply frozen own data. */
export function normalizeQuestProfileV1(value) {
    const profile = dataRecord(value, "quest profile");
    closed(profile, ["selectionCount", "definitions"], "quest profile");
    const definitionsInput = dataRecord(profile.definitions, "quest profile.definitions");
    const definitionIds = Object.keys(definitionsInput).sort();
    if (definitionIds.length === 0 || definitionIds.length > QUEST_LIMITS.definitions) {
        throw new QuestProfileValidationError(`quest profile.definitions must contain 1..${QUEST_LIMITS.definitions} definitions.`);
    }
    const selectionCount = boundedInteger(profile.selectionCount, "quest profile.selectionCount", 1, QUEST_LIMITS.selectionCount);
    const definitions = Object.create(null);
    for (const questId of definitionIds) {
        boundedString(questId, "quest definition id", QUEST_LIMITS.idUtf8Bytes);
        const path = `quest profile.definitions.${questId}`;
        const definition = dataRecord(definitionsInput[questId], path);
        closed(definition, ["label", "weight", "objective"], path);
        Object.defineProperty(definitions, questId, {
            value: Object.freeze({
                label: boundedString(definition.label, `${path}.label`, QUEST_LIMITS.labelUtf8Bytes),
                weight: boundedInteger(definition.weight, `${path}.weight`, 1, QUEST_LIMITS.weight),
                objective: normalizeObjective(definition.objective, `${path}.objective`)
            }),
            enumerable: true
        });
    }
    return Object.freeze({ selectionCount, definitions: Object.freeze(definitions) });
}
function questSelectionSeed(seed) {
    if (typeof seed === "number" && (!Number.isSafeInteger(seed) || !Number.isFinite(seed))) {
        throw new QuestProfileValidationError("Quest selection seed must be a string or finite safe integer.");
    }
    if (typeof seed !== "number" && typeof seed !== "string") {
        throw new QuestProfileValidationError("Quest selection seed must be a string or finite safe integer.");
    }
    return `towerforge:quests:v1:${typeof seed === "number" ? `n:${seed}` : `s:${seed}`}`;
}
function normalizeSelectionOptions(value) {
    const options = dataRecord(value, "quest selection options");
    for (const key of Object.keys(options)) {
        if (key !== "seed" && key !== "eligibleDefinitionIds") {
            throw new QuestProfileValidationError(`quest selection options is closed; unknown field "${key}".`);
        }
    }
    if (!Object.prototype.hasOwnProperty.call(options, "seed")) {
        throw new QuestProfileValidationError("quest selection options.seed is required.");
    }
    const seed = options.seed;
    questSelectionSeed(seed);
    if (!Object.prototype.hasOwnProperty.call(options, "eligibleDefinitionIds")) {
        return Object.freeze({ seed: seed });
    }
    const valueIds = options.eligibleDefinitionIds;
    let descriptors;
    try {
        if (!Array.isArray(valueIds) || Object.getPrototypeOf(valueIds) !== Array.prototype) {
            throw new Error();
        }
        descriptors = Object.getOwnPropertyDescriptors(valueIds);
    }
    catch {
        throw new QuestProfileValidationError("quest selection options.eligibleDefinitionIds must be a dense plain array.");
    }
    const arrayLength = descriptors.length?.value;
    if (!Number.isSafeInteger(arrayLength) || arrayLength < 0
        || Object.getOwnPropertySymbols(descriptors).length > 0
        || arrayLength > QUEST_LIMITS.definitions
        || Object.keys(descriptors).some((key) => key !== "length" && !/^(0|[1-9]\d*)$/.test(key))
        || Object.keys(descriptors).filter((key) => key !== "length").length !== arrayLength) {
        throw new QuestProfileValidationError("quest selection options.eligibleDefinitionIds must be a bounded dense plain array.");
    }
    const ids = [];
    for (let index = 0; index < arrayLength; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new QuestProfileValidationError("quest selection options.eligibleDefinitionIds entries must be own data.");
        }
        ids.push(boundedString(descriptor.value, `quest selection options.eligibleDefinitionIds[${index}]`, QUEST_LIMITS.idUtf8Bytes));
    }
    if (new Set(ids).size !== ids.length) {
        throw new QuestProfileValidationError("eligibleDefinitionIds must be unique.");
    }
    return Object.freeze({ seed: seed, eligibleDefinitionIds: Object.freeze(ids) });
}
/** Deterministic weighted sampling without replacement over a canonical eligible set. */
export function selectProceduralQuestsV1(profileInput, options) {
    const profile = normalizeQuestProfileV1(profileInput);
    const normalizedOptions = normalizeSelectionOptions(options);
    const allowed = normalizedOptions.eligibleDefinitionIds === undefined
        ? undefined
        : new Set(normalizedOptions.eligibleDefinitionIds);
    const candidates = Object.keys(profile.definitions)
        .filter((questId) => allowed === undefined || allowed.has(questId))
        .map((questId) => ({ questId, definition: profile.definitions[questId] }));
    if (allowed) {
        const unknown = [...allowed].filter((questId) => !Object.prototype.hasOwnProperty.call(profile.definitions, questId)).sort();
        if (unknown.length > 0)
            throw new QuestProfileValidationError(`Unknown eligible quest id "${unknown[0]}".`);
    }
    const rng = new SeededRng(questSelectionSeed(normalizedOptions.seed));
    const selected = [];
    while (candidates.length > 0 && selected.length < profile.selectionCount) {
        const totalWeight = candidates.reduce((total, candidate) => total + candidate.definition.weight, 0);
        let cursor = rng.nextInt(totalWeight);
        let selectedIndex = 0;
        for (let index = 0; index < candidates.length; index += 1) {
            if (cursor < candidates[index].definition.weight) {
                selectedIndex = index;
                break;
            }
            cursor -= candidates[index].definition.weight;
        }
        const [entry] = candidates.splice(selectedIndex, 1);
        selected.push(Object.freeze({ questId: entry.questId, definition: entry.definition }));
    }
    selected.sort((left, right) => left.questId < right.questId ? -1 : left.questId > right.questId ? 1 : 0);
    return Object.freeze(selected);
}
export function resolveActiveQuestMechanics(content, missionId) {
    const mission = content.missions[missionId];
    const capability = mission ? resolveCapabilitySet(content.mechanics, mission.mechanics).quests : undefined;
    if (!mission || !capability?.active || !capability.profileId)
        return undefined;
    const module = content.mechanics.modules.quests;
    if (!module || module.schemaVersion !== 1 || module.enabled !== true)
        return undefined;
    const profile = module.profiles[capability.profileId];
    if (profile === undefined)
        return undefined;
    try {
        return Object.freeze({
            schemaVersion: 1,
            profileId: capability.profileId,
            ...normalizeQuestProfileV1(profile)
        });
    }
    catch {
        return undefined;
    }
}
