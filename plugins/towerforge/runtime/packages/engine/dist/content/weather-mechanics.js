import { resolveCapabilitySet } from "./mechanics.js";
import { SeededRng } from "../simulation/rng.js";
export const WEATHER_LIMITS = Object.freeze({
    zones: 64,
    tilesPerZone: 4_096,
    tilesAcrossProfile: 16_384,
    definitions: 64,
    effectsPerDefinition: 16,
    effectsAcrossProfile: 512,
    scheduleChoices: 256,
    scheduledWaves: 4_096,
    idUtf8Bytes: 128,
    labelUtf8Bytes: 256,
    weight: 1_000_000,
    intervalUnits: 1_000_000_000,
    damage: 1_000_000_000_000,
    minimumMultiplier: 0.05,
    maximumMultiplier: 20,
    targetInspectionsPerTick: 16_384,
    applicationsPerTick: 4_096
});
export const WEATHER_MECHANICS_SCHEMA = Object.freeze({
    schemaVersion: 1,
    moduleId: "weather",
    supportedModuleSchemaVersions: Object.freeze([1]),
    profile: Object.freeze({
        requiredFields: Object.freeze(["zones", "definitions", "schedule"]),
        optionalFields: Object.freeze([]),
        additionalProperties: false
    }),
    zoneKinds: Object.freeze(["all_map", "tiles"]),
    effectKinds: Object.freeze([
        "periodic_damage", "status", "visibility_range", "enemy_speed", "tower_fire_rate"
    ]),
    limits: WEATHER_LIMITS
});
export class WeatherProfileValidationError extends Error {
}
function utf8Bytes(value) { return new TextEncoder().encode(value).length; }
function record(value, path, maximum) {
    let prototype;
    let descriptors;
    try {
        if (value === null || typeof value !== "object" || Array.isArray(value))
            throw new Error();
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        throw new WeatherProfileValidationError(`${path} must be safely inspectable plain own data.`);
    }
    if (prototype !== Object.prototype && prototype !== null) {
        throw new WeatherProfileValidationError(`${path} must be a plain object.`);
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new WeatherProfileValidationError(`${path} rejects symbol fields.`);
    }
    const keys = Object.keys(descriptors);
    if (maximum !== undefined && keys.length > maximum) {
        throw new WeatherProfileValidationError(`${path} exceeds the limit of ${maximum}.`);
    }
    const result = Object.create(null);
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new WeatherProfileValidationError(`${path}.${key} must be an enumerable own data field.`);
        }
        Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
    }
    return result;
}
function closed(value, required, optional, path) {
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key))
            throw new WeatherProfileValidationError(`${path} is closed; unknown field "${key}".`);
    }
    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            throw new WeatherProfileValidationError(`${path}.${key} is required.`);
        }
    }
}
function id(value, path) {
    if (typeof value !== "string" || value.length === 0 || value !== value.trim()
        || /[\u0000-\u001f\u007f]/.test(value) || utf8Bytes(value) > WEATHER_LIMITS.idUtf8Bytes) {
        throw new WeatherProfileValidationError(`${path} must be a safe bounded UTF-8 identifier.`);
    }
    return value;
}
function label(value, path) {
    if (typeof value !== "string" || value.length === 0 || value !== value.trim()
        || /[\u0000-\u001f\u007f]/.test(value) || utf8Bytes(value) > WEATHER_LIMITS.labelUtf8Bytes) {
        throw new WeatherProfileValidationError(`${path} must be a safe bounded UTF-8 label.`);
    }
    return value;
}
function integer(value, path, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new WeatherProfileValidationError(`${path} must be an integer in ${minimum}..${maximum}.`);
    }
    return value;
}
function finite(value, path, minimum, maximum, inclusiveMinimum = true) {
    if (typeof value !== "number" || !Number.isFinite(value)
        || (inclusiveMinimum ? value < minimum : value <= minimum) || value > maximum) {
        throw new WeatherProfileValidationError(`${path} must be finite in the supported range.`);
    }
    return value;
}
function denseArray(value, path, maximum) {
    let descriptors;
    try {
        if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
            throw new Error();
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        throw new WeatherProfileValidationError(`${path} must be a dense plain array.`);
    }
    const length = descriptors.length?.value;
    const indexKeys = Object.keys(descriptors).filter((key) => key !== "length");
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum
        || indexKeys.length !== length || Object.getOwnPropertySymbols(descriptors).length > 0
        || indexKeys.some((key) => !/^(0|[1-9]\d*)$/.test(key))) {
        throw new WeatherProfileValidationError(`${path} must be a bounded dense array.`);
    }
    const result = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new WeatherProfileValidationError(`${path}[${index}] must be own data.`);
        }
        result.push(descriptor.value);
    }
    return result;
}
function normalizeCoord(value, path) {
    const coord = record(value, path);
    closed(coord, ["q", "r"], [], path);
    return Object.freeze({
        q: integer(coord.q, `${path}.q`, -1_000_000, 1_000_000),
        r: integer(coord.r, `${path}.r`, -1_000_000, 1_000_000)
    });
}
function normalizeZone(value, path) {
    const zone = record(value, path);
    if (zone.kind === "all_map") {
        closed(zone, ["kind"], [], path);
        return Object.freeze({ kind: "all_map" });
    }
    if (zone.kind !== "tiles")
        throw new WeatherProfileValidationError(`${path}.kind is unsupported.`);
    closed(zone, ["kind", "tiles"], [], path);
    const tiles = denseArray(zone.tiles, `${path}.tiles`, WEATHER_LIMITS.tilesPerZone)
        .map((entry, index) => normalizeCoord(entry, `${path}.tiles[${index}]`))
        .sort((left, right) => left.q - right.q || left.r - right.r);
    if (tiles.length === 0)
        throw new WeatherProfileValidationError(`${path}.tiles must not be empty.`);
    const keys = tiles.map((tile) => `${tile.q},${tile.r}`);
    if (new Set(keys).size !== keys.length)
        throw new WeatherProfileValidationError(`${path}.tiles must be unique.`);
    return Object.freeze({ kind: "tiles", tiles: Object.freeze(tiles) });
}
function normalizeStatus(value, path) {
    const status = record(value, path);
    closed(status, [], ["slow", "stun", "poison", "slowAffectsClasses"], path);
    const result = {};
    if (status.slow !== undefined) {
        const slow = record(status.slow, `${path}.slow`);
        closed(slow, ["factor", "duration"], [], `${path}.slow`);
        result.slow = Object.freeze({
            factor: finite(slow.factor, `${path}.slow.factor`, WEATHER_LIMITS.minimumMultiplier, 1),
            duration: finite(slow.duration, `${path}.slow.duration`, 0, WEATHER_LIMITS.intervalUnits, false)
        });
    }
    if (status.stun !== undefined)
        result.stun = finite(status.stun, `${path}.stun`, 0, WEATHER_LIMITS.intervalUnits, false);
    if (status.poison !== undefined) {
        const poison = record(status.poison, `${path}.poison`);
        closed(poison, ["dps", "duration"], [], `${path}.poison`);
        result.poison = Object.freeze({
            dps: finite(poison.dps, `${path}.poison.dps`, 0, WEATHER_LIMITS.damage, false),
            duration: finite(poison.duration, `${path}.poison.duration`, 0, WEATHER_LIMITS.intervalUnits, false)
        });
    }
    if (status.slowAffectsClasses !== undefined) {
        const entries = denseArray(status.slowAffectsClasses, `${path}.slowAffectsClasses`, 2);
        const classes = entries.map((entry, index) => {
            if (entry !== "ground" && entry !== "flying")
                throw new WeatherProfileValidationError(`${path}.slowAffectsClasses[${index}] is unsupported.`);
            return entry;
        });
        if (new Set(classes).size !== classes.length)
            throw new WeatherProfileValidationError(`${path}.slowAffectsClasses must be unique.`);
        result.slowAffectsClasses = classes;
        Object.freeze(result.slowAffectsClasses);
    }
    if (Object.keys(result).length === 0)
        throw new WeatherProfileValidationError(`${path} must contain a status effect.`);
    return Object.freeze(result);
}
function normalizeEffect(value, path) {
    const effect = record(value, path);
    if (effect.kind === "periodic_damage") {
        closed(effect, ["kind", "target", "amount", "intervalUnits"], ["damageType"], path);
        if (effect.target !== "enemies")
            throw new WeatherProfileValidationError(`${path}.target is unsupported.`);
        return Object.freeze({
            kind: "periodic_damage", target: "enemies",
            amount: finite(effect.amount, `${path}.amount`, 0, WEATHER_LIMITS.damage),
            intervalUnits: finite(effect.intervalUnits, `${path}.intervalUnits`, 0, WEATHER_LIMITS.intervalUnits, false),
            ...(effect.damageType === undefined ? {} : { damageType: id(effect.damageType, `${path}.damageType`) })
        });
    }
    if (effect.kind === "status") {
        closed(effect, ["kind", "target", "intervalUnits", "status"], [], path);
        if (effect.target !== "enemies")
            throw new WeatherProfileValidationError(`${path}.target is unsupported.`);
        return Object.freeze({
            kind: "status", target: "enemies",
            intervalUnits: finite(effect.intervalUnits, `${path}.intervalUnits`, 0, WEATHER_LIMITS.intervalUnits, false),
            status: normalizeStatus(effect.status, `${path}.status`)
        });
    }
    if (effect.kind === "visibility_range" || effect.kind === "enemy_speed" || effect.kind === "tower_fire_rate") {
        closed(effect, ["kind", "multiplier"], [], path);
        return Object.freeze({
            kind: effect.kind,
            multiplier: finite(effect.multiplier, `${path}.multiplier`, WEATHER_LIMITS.minimumMultiplier, WEATHER_LIMITS.maximumMultiplier)
        });
    }
    throw new WeatherProfileValidationError(`${path}.kind is unsupported.`);
}
/** Parse Weather v1 as canonical detached deeply frozen own data. */
export function normalizeWeatherProfileV1(value) {
    const profile = record(value, "weather profile");
    closed(profile, ["zones", "definitions", "schedule"], [], "weather profile");
    const zoneInput = record(profile.zones, "weather profile.zones", WEATHER_LIMITS.zones);
    const zoneIds = Object.keys(zoneInput).sort();
    if (zoneIds.length === 0)
        throw new WeatherProfileValidationError("weather profile.zones must not be empty.");
    const zones = Object.create(null);
    let totalTiles = 0;
    for (const zoneId of zoneIds) {
        id(zoneId, "weather zone id");
        const path = `weather profile.zones.${zoneId}`;
        const zone = normalizeZone(zoneInput[zoneId], path);
        totalTiles += zone.kind === "tiles" ? zone.tiles.length : 0;
        if (totalTiles > WEATHER_LIMITS.tilesAcrossProfile)
            throw new WeatherProfileValidationError("weather profile tiles exceed the total limit.");
        Object.defineProperty(zones, zoneId, { value: zone, enumerable: true });
    }
    const definitionInput = record(profile.definitions, "weather profile.definitions", WEATHER_LIMITS.definitions);
    const definitionIds = Object.keys(definitionInput).sort();
    if (definitionIds.length === 0)
        throw new WeatherProfileValidationError("weather profile.definitions must not be empty.");
    const definitions = Object.create(null);
    let totalEffects = 0;
    for (const weatherId of definitionIds) {
        id(weatherId, "weather definition id");
        const path = `weather profile.definitions.${weatherId}`;
        const definition = record(definitionInput[weatherId], path);
        closed(definition, ["label", "effects"], [], path);
        const effectInput = record(definition.effects, `${path}.effects`, WEATHER_LIMITS.effectsPerDefinition);
        const effectIds = Object.keys(effectInput).sort();
        const effects = Object.create(null);
        const scalarKinds = new Set();
        for (const effectId of effectIds) {
            id(effectId, "weather effect id");
            const normalized = normalizeEffect(effectInput[effectId], `${path}.effects.${effectId}`);
            if (normalized.kind === "visibility_range" || normalized.kind === "enemy_speed" || normalized.kind === "tower_fire_rate") {
                if (scalarKinds.has(normalized.kind))
                    throw new WeatherProfileValidationError(`${path}.effects duplicates ${normalized.kind}.`);
                scalarKinds.add(normalized.kind);
            }
            Object.defineProperty(effects, effectId, { value: normalized, enumerable: true });
            totalEffects += 1;
        }
        if (totalEffects > WEATHER_LIMITS.effectsAcrossProfile)
            throw new WeatherProfileValidationError("weather effects exceed the total limit.");
        Object.defineProperty(definitions, weatherId, { value: Object.freeze({
                label: label(definition.label, `${path}.label`), effects: Object.freeze(effects)
            }), enumerable: true });
    }
    const scheduleInput = record(profile.schedule, "weather profile.schedule");
    closed(scheduleInput, ["calmWeight", "choices"], [], "weather profile.schedule");
    const calmWeight = integer(scheduleInput.calmWeight, "weather profile.schedule.calmWeight", 0, WEATHER_LIMITS.weight);
    const choiceInput = record(scheduleInput.choices, "weather profile.schedule.choices", WEATHER_LIMITS.scheduleChoices);
    const choiceIds = Object.keys(choiceInput).sort();
    const choices = Object.create(null);
    let totalWeight = calmWeight;
    for (const choiceId of choiceIds) {
        id(choiceId, "weather schedule choice id");
        const path = `weather profile.schedule.choices.${choiceId}`;
        const choice = record(choiceInput[choiceId], path);
        closed(choice, ["weatherId", "zoneId", "weight"], [], path);
        const weatherId = id(choice.weatherId, `${path}.weatherId`);
        const zoneId = id(choice.zoneId, `${path}.zoneId`);
        if (!Object.prototype.hasOwnProperty.call(definitions, weatherId))
            throw new WeatherProfileValidationError(`${path} references missing weather "${weatherId}".`);
        if (!Object.prototype.hasOwnProperty.call(zones, zoneId))
            throw new WeatherProfileValidationError(`${path} references missing zone "${zoneId}".`);
        const weight = integer(choice.weight, `${path}.weight`, 0, WEATHER_LIMITS.weight);
        totalWeight += weight;
        if (totalWeight > 0xffff_ffff)
            throw new WeatherProfileValidationError("weather schedule total weight exceeds uint32.");
        Object.defineProperty(choices, choiceId, { value: Object.freeze({ weatherId, zoneId, weight }), enumerable: true });
    }
    if (totalWeight <= 0)
        throw new WeatherProfileValidationError("weather schedule needs positive total weight.");
    return Object.freeze({
        zones: Object.freeze(zones), definitions: Object.freeze(definitions),
        schedule: Object.freeze({ calmWeight, choices: Object.freeze(choices) })
    });
}
function scheduleSeed(seed, missionId) {
    if ((typeof seed !== "string" && typeof seed !== "number")
        || (typeof seed === "number" && (!Number.isSafeInteger(seed) || !Number.isFinite(seed)))) {
        throw new WeatherProfileValidationError("weather schedule seed is invalid.");
    }
    const payload = String(seed);
    return `towerforge:weather:v1|${typeof seed === "number" ? "n" : "s"}:${payload.length}:${payload}|m:${missionId.length}:${missionId}`;
}
/** Deterministically choose zero or one weather occurrence for every authored wave. */
export function createWeatherScheduleV1(profileInput, optionsInput) {
    const profile = normalizeWeatherProfileV1(profileInput);
    const options = record(optionsInput, "weather schedule options");
    closed(options, ["seed", "missionId", "waveCount"], [], "weather schedule options");
    const missionId = id(options.missionId, "weather schedule missionId");
    const waveCount = integer(options.waveCount, "weather schedule waveCount", 0, WEATHER_LIMITS.scheduledWaves);
    const rng = new SeededRng(scheduleSeed(options.seed, missionId));
    const initial = rng.exportState();
    const choiceIds = Object.keys(profile.schedule.choices);
    const totalWeight = profile.schedule.calmWeight
        + choiceIds.reduce((total, choiceId) => total + profile.schedule.choices[choiceId].weight, 0);
    const occurrences = [];
    for (let waveIndex = 0; waveIndex < waveCount; waveIndex += 1) {
        let cursor = rng.nextInt(totalWeight);
        if (cursor < profile.schedule.calmWeight) {
            occurrences.push(null);
            continue;
        }
        cursor -= profile.schedule.calmWeight;
        let selected;
        for (const choiceId of choiceIds) {
            const weight = profile.schedule.choices[choiceId].weight;
            if (cursor < weight) {
                selected = choiceId;
                break;
            }
            cursor -= weight;
        }
        if (selected === undefined) {
            occurrences.push(null);
            continue;
        }
        const choice = profile.schedule.choices[selected];
        occurrences.push(Object.freeze({
            waveIndex, choiceId: selected, weatherId: choice.weatherId, zoneId: choice.zoneId,
            zone: profile.zones[choice.zoneId]
        }));
    }
    return Object.freeze({
        schemaVersion: 1,
        rng: Object.freeze({ initial, current: rng.exportState() }),
        occurrences: Object.freeze(occurrences)
    });
}
function validateSchedule(value) {
    const schedule = record(value, "weather schedule");
    closed(schedule, ["schemaVersion", "rng", "occurrences"], [], "weather schedule");
    if (schedule.schemaVersion !== 1)
        throw new WeatherProfileValidationError("weather schedule schema version is unsupported.");
    const occurrenceInput = denseArray(schedule.occurrences, "weather schedule.occurrences", WEATHER_LIMITS.scheduledWaves);
    const rng = record(schedule.rng, "weather schedule.rng");
    closed(rng, ["initial", "current"], [], "weather schedule.rng");
    const initial = SeededRng.fromState(rng.initial).exportState();
    const current = SeededRng.fromState(rng.current).exportState();
    const occurrences = occurrenceInput.map((entry, index) => {
        if (entry === null)
            return null;
        const occurrence = record(entry, `weather schedule.occurrences[${index}]`);
        closed(occurrence, ["waveIndex", "choiceId", "weatherId", "zoneId", "zone"], [], `weather schedule.occurrences[${index}]`);
        const waveIndex = integer(occurrence.waveIndex, `weather schedule.occurrences[${index}].waveIndex`, 0, WEATHER_LIMITS.scheduledWaves - 1);
        if (waveIndex !== index)
            throw new WeatherProfileValidationError(`weather schedule.occurrences[${index}] waveIndex is non-canonical.`);
        return Object.freeze({
            waveIndex,
            choiceId: id(occurrence.choiceId, `weather schedule.occurrences[${index}].choiceId`),
            weatherId: id(occurrence.weatherId, `weather schedule.occurrences[${index}].weatherId`),
            zoneId: id(occurrence.zoneId, `weather schedule.occurrences[${index}].zoneId`),
            zone: normalizeZone(occurrence.zone, `weather schedule.occurrences[${index}].zone`)
        });
    });
    return Object.freeze({
        schemaVersion: 1,
        rng: Object.freeze({ initial, current }),
        occurrences: Object.freeze(occurrences)
    });
}
export function createWeatherRuntimeV1(scheduleInput) {
    validateSchedule(scheduleInput);
    return Object.freeze({ schemaVersion: 1, active: null, periodicOrdinals: Object.freeze({}) });
}
export function weatherPeriodicDueOrdinalV1(elapsedUnits, intervalUnits) {
    const elapsed = finite(elapsedUnits, "weather elapsedUnits", 0, WEATHER_LIMITS.intervalUnits);
    const interval = finite(intervalUnits, "weather intervalUnits", 0, WEATHER_LIMITS.intervalUnits, false);
    const boundaryTolerance = Number.EPSILON * Math.max(Math.abs(elapsed), interval) * 4;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor((elapsed + boundaryTolerance) / interval));
}
/** Advance only Weather timing; entity lookup and gameplay application remain caller-owned. */
export function advanceWeatherRuntimeV1(profileInput, scheduleInput, runtimeInput, inputValue) {
    const profile = normalizeWeatherProfileV1(profileInput);
    const schedule = validateSchedule(scheduleInput);
    const runtime = record(runtimeInput, "weather runtime");
    closed(runtime, ["schemaVersion", "active", "periodicOrdinals"], [], "weather runtime");
    if (runtime.schemaVersion !== 1)
        throw new WeatherProfileValidationError("weather runtime schema version is unsupported.");
    const input = record(inputValue, "weather advance input");
    closed(input, ["waveIndex", "elapsedUnits", "waveActive"], [], "weather advance input");
    const waveIndex = integer(input.waveIndex, "weather advance input.waveIndex", 0, WEATHER_LIMITS.scheduledWaves - 1);
    const elapsedUnits = finite(input.elapsedUnits, "weather advance input.elapsedUnits", 0, WEATHER_LIMITS.intervalUnits);
    if (typeof input.waveActive !== "boolean")
        throw new WeatherProfileValidationError("weather advance input.waveActive must be boolean.");
    const transitions = [];
    const dueEffects = [];
    let active;
    if (runtime.active === null)
        active = null;
    else {
        const activeInput = record(runtime.active, "weather runtime.active");
        closed(activeInput, ["waveIndex", "choiceId", "weatherId", "zoneId", "zone", "elapsedUnits"], [], "weather runtime.active");
        active = Object.freeze({
            waveIndex: integer(activeInput.waveIndex, "weather runtime.active.waveIndex", 0, WEATHER_LIMITS.scheduledWaves - 1),
            choiceId: id(activeInput.choiceId, "weather runtime.active.choiceId"),
            weatherId: id(activeInput.weatherId, "weather runtime.active.weatherId"),
            zoneId: id(activeInput.zoneId, "weather runtime.active.zoneId"),
            zone: normalizeZone(activeInput.zone, "weather runtime.active.zone"),
            elapsedUnits: finite(activeInput.elapsedUnits, "weather runtime.active.elapsedUnits", 0, WEATHER_LIMITS.intervalUnits)
        });
    }
    let ordinals = record(runtime.periodicOrdinals, "weather runtime.periodicOrdinals");
    for (const [effectId, ordinal] of Object.entries(ordinals)) {
        id(effectId, "weather runtime periodic effect id");
        integer(ordinal, `weather runtime.periodicOrdinals.${effectId}`, 0, Number.MAX_SAFE_INTEGER);
    }
    if (active === null) {
        if (Object.keys(ordinals).length !== 0) {
            throw new WeatherProfileValidationError("weather runtime periodic cursor provenance is invalid without an active occurrence.");
        }
    }
    else {
        const occurrence = schedule.occurrences[active.waveIndex];
        if (!occurrence
            || active.choiceId !== occurrence.choiceId
            || active.weatherId !== occurrence.weatherId
            || active.zoneId !== occurrence.zoneId
            || JSON.stringify(active.zone) !== JSON.stringify(occurrence.zone)) {
            throw new WeatherProfileValidationError("weather runtime active occurrence provenance is invalid.");
        }
        const definition = profile.definitions[active.weatherId];
        if (!definition)
            throw new WeatherProfileValidationError("weather runtime references missing definition.");
        const expectedOrdinals = {};
        for (const effectId of Object.keys(definition.effects)) {
            const effect = definition.effects[effectId];
            if (effect.kind === "periodic_damage" || effect.kind === "status") {
                expectedOrdinals[effectId] = weatherPeriodicDueOrdinalV1(active.elapsedUnits, effect.intervalUnits);
            }
        }
        const actualKeys = Object.keys(ordinals).sort();
        const expectedKeys = Object.keys(expectedOrdinals).sort();
        if (actualKeys.length !== expectedKeys.length
            || actualKeys.some((effectId, index) => effectId !== expectedKeys[index]
                || ordinals[effectId] !== expectedOrdinals[effectId])) {
            throw new WeatherProfileValidationError("weather runtime periodic cursor provenance is non-canonical.");
        }
    }
    if ((!input.waveActive || active?.waveIndex !== waveIndex) && active !== null) {
        transitions.push(Object.freeze({
            kind: "ended", waveIndex: active.waveIndex, choiceId: active.choiceId,
            weatherId: active.weatherId, zoneId: active.zoneId,
            reason: input.waveActive ? "wave_changed" : "wave_cleared"
        }));
        active = null;
        ordinals = {};
    }
    const occurrence = schedule.occurrences[waveIndex] ?? null;
    if (input.waveActive && active === null && occurrence !== null) {
        active = Object.freeze({ ...occurrence, elapsedUnits: 0 });
        ordinals = {};
        transitions.push(Object.freeze({
            kind: "started", waveIndex, choiceId: occurrence.choiceId,
            weatherId: occurrence.weatherId, zoneId: occurrence.zoneId
        }));
    }
    if (input.waveActive && active !== null) {
        if (elapsedUnits < active.elapsedUnits)
            throw new WeatherProfileValidationError("weather elapsedUnits cannot move backwards.");
        const definition = profile.definitions[active.weatherId];
        if (!definition)
            throw new WeatherProfileValidationError("weather runtime references missing definition.");
        const nextOrdinals = {};
        for (const effectId of Object.keys(definition.effects)) {
            const effect = definition.effects[effectId];
            if (effect.kind !== "periodic_damage" && effect.kind !== "status")
                continue;
            const previous = integer(ordinals[effectId] ?? 0, `weather runtime.periodicOrdinals.${effectId}`, 0, Number.MAX_SAFE_INTEGER);
            const due = weatherPeriodicDueOrdinalV1(elapsedUnits, effect.intervalUnits);
            for (let ordinal = previous + 1; ordinal <= due; ordinal += 1) {
                if (dueEffects.length >= WEATHER_LIMITS.applicationsPerTick)
                    break;
                dueEffects.push(Object.freeze({
                    waveIndex, choiceId: active.choiceId, weatherId: active.weatherId, zoneId: active.zoneId,
                    effectId, applicationOrdinal: ordinal, effect
                }));
            }
            // Consume the complete elapsed-time range even when bounded output drops overflow. This
            // makes the cursor canonical and prevents checkpoint restore from replaying old effects.
            nextOrdinals[effectId] = due;
        }
        ordinals = nextOrdinals;
        active = Object.freeze({ ...active, elapsedUnits });
    }
    return Object.freeze({
        runtime: Object.freeze({ schemaVersion: 1, active, periodicOrdinals: Object.freeze(ordinals) }),
        transitions: Object.freeze(transitions), dueEffects: Object.freeze(dueEffects)
    });
}
export function resolveActiveWeatherMechanics(content, missionId) {
    const mission = content.missions[missionId];
    const capability = mission ? resolveCapabilitySet(content.mechanics, mission.mechanics).weather : undefined;
    if (!mission || !capability?.active || !capability.profileId)
        return undefined;
    const module = content.mechanics.modules.weather;
    if (!module || module.schemaVersion !== 1 || module.enabled !== true)
        return undefined;
    const profile = module.profiles[capability.profileId];
    if (profile === undefined)
        return undefined;
    try {
        return Object.freeze({ schemaVersion: 1, profileId: capability.profileId, ...normalizeWeatherProfileV1(profile) });
    }
    catch {
        return undefined;
    }
}
