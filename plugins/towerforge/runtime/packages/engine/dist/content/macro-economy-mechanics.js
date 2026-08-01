import { resolveCapabilitySet } from "./mechanics.js";
import { SeededRng } from "../simulation/rng.js";
import { resolveActiveArsenalMechanics } from "./arsenal-mechanics.js";
import { resolveActiveWeatherMechanics } from "./weather-mechanics.js";
export const MACRO_ECONOMY_LIMITS = Object.freeze({
    commodities: 32,
    deposits: 32,
    altars: 32,
    effectsPerRitual: 16,
    towerTypesPerRitual: 64,
    activeDeposits: 1_024,
    temporaryModifiers: 1_024,
    sequence: 1_000_000_000,
    temporaryMultiplierProduct: 1e100,
    idCodeUnits: 128,
    seedDomainCodeUnits: 4096,
    labelCodeUnits: 256,
    price: 1_000_000_000,
    amount: 1_000_000_000_000,
    durationWaves: 10_000,
    basisPoints: 1_000_000,
    radius: 128
});
export const MACRO_ECONOMY_MECHANICS_SCHEMA = Object.freeze({
    schemaVersion: 1,
    moduleId: "macroEconomy",
    supportedModuleSchemaVersions: [1],
    profile: {
        requiredFields: ["quoteCurrencyId", "commodities", "deposits", "altars"],
        additionalProperties: false
    },
    commodity: {
        requiredFields: ["label", "basePrice", "minPrice", "maxPrice", "trendPerWave", "volatility", "demandElasticity"],
        additionalProperties: false
    },
    limits: MACRO_ECONOMY_LIMITS
});
export class MacroEconomyProfileValidationError extends Error {
}
function dataFields(value, path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new MacroEconomyProfileValidationError(`${path} must be a plain object.`);
    }
    let descriptors;
    try {
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        throw new MacroEconomyProfileValidationError(`${path} must expose own data safely.`);
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new MacroEconomyProfileValidationError(`${path} rejects symbol keys.`);
    }
    const result = new Map();
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable || !("value" in descriptor)) {
            throw new MacroEconomyProfileValidationError(`${path}.${key} must be enumerable own data.`);
        }
        result.set(key, descriptor.value);
    }
    return result;
}
function closed(fields, required, path) {
    const allowed = new Set(required);
    if (required.some((key) => !fields.has(key))) {
        throw new MacroEconomyProfileValidationError(`${path} has a missing required field.`);
    }
    for (const key of fields.keys()) {
        if (!allowed.has(key))
            throw new MacroEconomyProfileValidationError(`${path} is closed; unknown field "${key}".`);
    }
}
function boundedId(value, path) {
    if (typeof value !== "string" || value.length === 0 || value !== value.trim()
        || value.length > MACRO_ECONOMY_LIMITS.idCodeUnits) {
        throw new MacroEconomyProfileValidationError(`${path} must be a non-empty bounded identifier.`);
    }
    return value;
}
function boundedLabel(value, path) {
    if (typeof value !== "string" || value.length === 0 || value.length > MACRO_ECONOMY_LIMITS.labelCodeUnits) {
        throw new MacroEconomyProfileValidationError(`${path} must be a non-empty bounded label.`);
    }
    return value;
}
function finite(value, path, minimum, maximum, integer = false) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum
        || (integer && !Number.isSafeInteger(value))) {
        throw new MacroEconomyProfileValidationError(`${path} must be a finite${integer ? " integer" : ""} number in ${minimum}..${maximum}.`);
    }
    return Object.is(value, -0) ? 0 : value;
}
function denseArray(value, path, maximum) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
        throw new MacroEconomyProfileValidationError(`${path} must be a plain array with at most ${maximum} entries.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0
        || Object.keys(descriptors).length !== value.length + 1) {
        throw new MacroEconomyProfileValidationError(`${path} must be a dense array without extra fields.`);
    }
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new MacroEconomyProfileValidationError(`${path}[${index}] must be enumerable own data.`);
        }
    }
    return value;
}
function ownRecord(value, path, maximum, parse) {
    const source = dataFields(value, path);
    if (source.size > maximum)
        throw new MacroEconomyProfileValidationError(`${path} exceeds limit ${maximum}.`);
    const result = Object.create(null);
    for (const id of [...source.keys()].sort()) {
        boundedId(id, `${path} id`);
        Object.defineProperty(result, id, { value: parse(source.get(id), id), enumerable: true });
    }
    return Object.freeze(result);
}
function normalizeEffect(value, path) {
    const source = dataFields(value, path);
    const kind = source.get("kind");
    if (kind === "grant_resource") {
        closed(source, ["kind", "resourceId", "amount"], path);
        return Object.freeze({ kind, resourceId: boundedId(source.get("resourceId"), `${path}.resourceId`), amount: finite(source.get("amount"), `${path}.amount`, 0, MACRO_ECONOMY_LIMITS.amount) });
    }
    if (kind === "damage_enemies") {
        closed(source, ["kind", "damageTypeId", "amount", "radius"], path);
        return Object.freeze({ kind, damageTypeId: boundedId(source.get("damageTypeId"), `${path}.damageTypeId`), amount: finite(source.get("amount"), `${path}.amount`, 0, MACRO_ECONOMY_LIMITS.amount), radius: finite(source.get("radius"), `${path}.radius`, 0, MACRO_ECONOMY_LIMITS.radius) });
    }
    if (kind === "apply_status") {
        closed(source, ["kind", "status", "duration", "radius", "magnitude"], path);
        const status = source.get("status");
        if (status !== "slow" && status !== "stun" && status !== "poison")
            throw new MacroEconomyProfileValidationError(`${path}.status is unsupported.`);
        return Object.freeze({ kind, status, duration: finite(source.get("duration"), `${path}.duration`, 0, MACRO_ECONOMY_LIMITS.amount), radius: finite(source.get("radius"), `${path}.radius`, 0, MACRO_ECONOMY_LIMITS.radius), magnitude: finite(source.get("magnitude"), `${path}.magnitude`, 0, MACRO_ECONOMY_LIMITS.amount) });
    }
    if (kind === "temporary_tower_modifier") {
        closed(source, ["kind", "stat", "multiplier", "duration"], path);
        const stat = source.get("stat");
        if (stat !== "damage" && stat !== "range" && stat !== "fire_rate")
            throw new MacroEconomyProfileValidationError(`${path}.stat is unsupported.`);
        return Object.freeze({ kind, stat, multiplier: finite(source.get("multiplier"), `${path}.multiplier`, 0.000001, 100), duration: finite(source.get("duration"), `${path}.duration`, 0.000001, MACRO_ECONOMY_LIMITS.amount) });
    }
    throw new MacroEconomyProfileValidationError(`${path}.kind is unsupported.`);
}
export function normalizeMacroEconomyProfileV1(value) {
    const source = dataFields(value, "macroEconomy profile");
    closed(source, ["quoteCurrencyId", "commodities", "deposits", "altars"], "macroEconomy profile");
    const commodities = ownRecord(source.get("commodities"), "macroEconomy profile.commodities", MACRO_ECONOMY_LIMITS.commodities, (entry, id) => {
        const item = dataFields(entry, `macroEconomy profile.commodities.${id}`);
        closed(item, ["label", "basePrice", "minPrice", "maxPrice", "trendPerWave", "volatility", "demandElasticity"], `macroEconomy profile.commodities.${id}`);
        const minPrice = finite(item.get("minPrice"), `${id}.minPrice`, 0.000001, MACRO_ECONOMY_LIMITS.price);
        const maxPrice = finite(item.get("maxPrice"), `${id}.maxPrice`, minPrice, MACRO_ECONOMY_LIMITS.price);
        return Object.freeze({
            label: boundedLabel(item.get("label"), `${id}.label`),
            basePrice: finite(item.get("basePrice"), `${id}.basePrice`, minPrice, maxPrice),
            minPrice,
            maxPrice,
            trendPerWave: finite(item.get("trendPerWave"), `${id}.trendPerWave`, -MACRO_ECONOMY_LIMITS.price, MACRO_ECONOMY_LIMITS.price),
            volatility: finite(item.get("volatility"), `${id}.volatility`, 0, 10),
            demandElasticity: finite(item.get("demandElasticity"), `${id}.demandElasticity`, 0, MACRO_ECONOMY_LIMITS.price)
        });
    });
    const deposits = ownRecord(source.get("deposits"), "macroEconomy profile.deposits", MACRO_ECONOMY_LIMITS.deposits, (entry, id) => {
        const item = dataFields(entry, `macroEconomy profile.deposits.${id}`);
        closed(item, ["label", "currencyId", "durationClearedWaves", "interestBasisPoints", "minAmount", "maxAmount"], `macroEconomy profile.deposits.${id}`);
        const minAmount = finite(item.get("minAmount"), `${id}.minAmount`, 0, MACRO_ECONOMY_LIMITS.amount);
        return Object.freeze({ label: boundedLabel(item.get("label"), `${id}.label`), currencyId: boundedId(item.get("currencyId"), `${id}.currencyId`), durationClearedWaves: finite(item.get("durationClearedWaves"), `${id}.durationClearedWaves`, 1, MACRO_ECONOMY_LIMITS.durationWaves, true), interestBasisPoints: finite(item.get("interestBasisPoints"), `${id}.interestBasisPoints`, 0, MACRO_ECONOMY_LIMITS.basisPoints, true), minAmount, maxAmount: finite(item.get("maxAmount"), `${id}.maxAmount`, minAmount, MACRO_ECONOMY_LIMITS.amount) });
    });
    const altars = ownRecord(source.get("altars"), "macroEconomy profile.altars", MACRO_ECONOMY_LIMITS.altars, (entry, id) => {
        const item = dataFields(entry, `macroEconomy profile.altars.${id}`);
        closed(item, ["label", "coord", "radius", "minTowers", "maxTowers", "towerTypeIds", "effects"], `macroEconomy profile.altars.${id}`);
        const coord = dataFields(item.get("coord"), `${id}.coord`);
        closed(coord, ["q", "r"], `${id}.coord`);
        const minTowers = finite(item.get("minTowers"), `${id}.minTowers`, 1, 64, true);
        const towerTypeIds = denseArray(item.get("towerTypeIds"), `${id}.towerTypeIds`, MACRO_ECONOMY_LIMITS.towerTypesPerRitual).map((typeId, index) => boundedId(typeId, `${id}.towerTypeIds[${index}]`));
        if (new Set(towerTypeIds).size !== towerTypeIds.length)
            throw new MacroEconomyProfileValidationError(`${id}.towerTypeIds contains duplicates.`);
        const effects = denseArray(item.get("effects"), `${id}.effects`, MACRO_ECONOMY_LIMITS.effectsPerRitual).map((effect, index) => normalizeEffect(effect, `${id}.effects[${index}]`));
        if (effects.length === 0)
            throw new MacroEconomyProfileValidationError(`${id}.effects cannot be empty.`);
        return Object.freeze({ label: boundedLabel(item.get("label"), `${id}.label`), coord: Object.freeze({ q: finite(coord.get("q"), `${id}.coord.q`, -1_000_000, 1_000_000, true), r: finite(coord.get("r"), `${id}.coord.r`, -1_000_000, 1_000_000, true) }), radius: finite(item.get("radius"), `${id}.radius`, 0, MACRO_ECONOMY_LIMITS.radius), minTowers, maxTowers: finite(item.get("maxTowers"), `${id}.maxTowers`, minTowers, 64, true), towerTypeIds: Object.freeze(towerTypeIds), effects: Object.freeze(effects) });
    });
    return Object.freeze({ quoteCurrencyId: boundedId(source.get("quoteCurrencyId"), "macroEconomy profile.quoteCurrencyId"), commodities, deposits, altars });
}
function canonicalMarketNumber(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
}
export function createMarketRuntimeV1(profile, seedDomain) {
    if (typeof seedDomain !== "string" || seedDomain.length === 0
        || seedDomain.length > MACRO_ECONOMY_LIMITS.seedDomainCodeUnits) {
        throw new MacroEconomyProfileValidationError("market seed domain must be a non-empty bounded string.");
    }
    const entries = Object.keys(profile.commodities).sort().map((id) => [id, profile.commodities[id].basePrice]);
    const zeros = Object.fromEntries(entries.map(([id]) => [id, 0]));
    return Object.freeze({ schemaVersion: 1, seedDomain, lastPriceWaveIndex: -1, quotes: Object.freeze(Object.fromEntries(entries)), holdings: Object.freeze({ ...zeros }), pendingNetDemand: Object.freeze({ ...zeros }) });
}
export function advanceMarketWaveV1(profile, runtime, waveIndex) {
    if (!Number.isSafeInteger(waveIndex) || waveIndex < 0 || waveIndex <= runtime.lastPriceWaveIndex)
        throw new Error("Market wave index must advance monotonically.");
    const quotes = {};
    const pending = {};
    for (const commodityId of Object.keys(profile.commodities).sort()) {
        const definition = profile.commodities[commodityId];
        const rng = new SeededRng(`${runtime.seedDomain}|macroEconomy.market.v1|${waveIndex}|${commodityId}`);
        const shockUnit = (rng.nextUint32() / 0xffff_ffff) * 2 - 1;
        const previous = runtime.quotes[commodityId] ?? definition.basePrice;
        const demand = runtime.pendingNetDemand[commodityId] ?? 0;
        const next = previous + definition.trendPerWave + previous * definition.volatility * shockUnit + demand * definition.demandElasticity;
        quotes[commodityId] = canonicalMarketNumber(Math.max(definition.minPrice, Math.min(definition.maxPrice, next)));
        pending[commodityId] = 0;
    }
    return Object.freeze({ schemaVersion: 1, seedDomain: runtime.seedDomain, lastPriceWaveIndex: waveIndex, quotes: Object.freeze(quotes), holdings: Object.freeze({ ...runtime.holdings }), pendingNetDemand: Object.freeze(pending) });
}
/** Pure conservative proof shared by live ritual preflight and checkpoint restore. */
export function preflightMacroEconomyDerivedStatsV1(content, missionId, metaUpgradeLevels, temporaryModifiers) {
    const arsenal = resolveActiveArsenalMechanics(content, missionId);
    const weather = resolveActiveWeatherMechanics(content, missionId);
    const product = (stat) => temporaryModifiers
        .filter((modifier) => modifier.stat === stat)
        .reduce((value, modifier) => value * modifier.multiplier, 1);
    const weatherMaximum = (kind) => (Object.values(weather?.definitions ?? {}).reduce((maximum, definition) => {
        const value = Object.values(definition.effects).reduce((current, effect) => (effect.kind === kind ? current * effect.multiplier : current), 1);
        return Math.max(maximum, value);
    }, 1));
    let fireRateMetaMultiplier = 1;
    for (const [upgradeId, upgrade] of Object.entries(content.metaProgression.upgrades)) {
        const level = Math.max(0, Math.min(upgrade.maxLevel, Math.floor(metaUpgradeLevels[upgradeId] ?? 0)));
        for (const effect of upgrade.effects) {
            if (effect.kind === "towerFireRate")
                fireRateMetaMultiplier += effect.multiplierPerLevel * level;
        }
    }
    fireRateMetaMultiplier = Math.max(0.05, fireRateMetaMultiplier);
    const supportFireRate = Object.values(content.towers).reduce((maximum, tower) => (tower.attack.kind === "support_buff"
        ? Math.max(maximum, ...tower.attack.fireRateMultiplierByLevel)
        : maximum), 1);
    const compatibleArsenalRange = (towerTypeId) => {
        const blueprint = arsenal?.blueprints[towerTypeId];
        if (!arsenal || !blueprint)
            return 1;
        return ["base", "barrel", "core"].reduce((result, category) => {
            const maximum = Object.values(arsenal.modules)
                .filter((definition) => definition.category === category
                && (definition.compatibilityTags.length === 0
                    || definition.compatibilityTags.some((tag) => blueprint.compatibilityTags.includes(tag))))
                .reduce((value, definition) => Math.max(value, definition.modifiers.rangeMultiplier), 0);
            return result * maximum;
        }, 1);
    };
    const rangeRitual = product("range");
    const fireRateRitual = product("fire_rate");
    const visibilityWeather = weatherMaximum("visibility_range");
    const fireRateWeather = weatherMaximum("tower_fire_rate");
    for (const towerTypeId of Object.keys(content.towers).sort()) {
        const tower = content.towers[towerTypeId];
        const attack = tower.attack;
        const baseRange = Math.max(tower.range, ...(attack.kind === "sniper" ? attack.rangeByLevel ?? [] : []), ...(attack.kind === "support" ? attack.auraRadiusByLevel ?? [attack.auraRadius] : []), ...(attack.kind === "support_buff" ? [attack.auraRadius] : []), ...(attack.kind === "pipeline" ? attack.rangeByLevel ?? [] : []));
        if (!Number.isFinite(baseRange * compatibleArsenalRange(towerTypeId) * rangeRitual * visibilityWeather)) {
            return Object.freeze({ ok: false, towerTypeId, stat: "range" });
        }
        const nativeRate = attack.kind === "single" || attack.kind === "antiair"
            ? attack.fireRate
            : attack.kind === "pulse"
                ? Math.max(attack.pulseRate, ...(attack.pulseRateByLevel ?? []))
                : attack.kind === "sniper" || attack.kind === "splash" || attack.kind === "pipeline"
                    ? 1 / Math.min(attack.interval, ...(attack.kind === "splash" || attack.kind === "pipeline"
                        ? attack.intervalByLevel ?? []
                        : []))
                    : 0;
        if (!Number.isFinite(nativeRate * fireRateMetaMultiplier * supportFireRate * fireRateWeather * fireRateRitual)) {
            return Object.freeze({ ok: false, towerTypeId, stat: "fire_rate" });
        }
    }
    return Object.freeze({ ok: true });
}
export function resolveActiveMacroEconomyMechanics(content, missionId) {
    const mission = content.missions[missionId];
    const capability = mission ? resolveCapabilitySet(content.mechanics, mission.mechanics).macroEconomy : undefined;
    const module = content.mechanics.modules.macroEconomy;
    if (!mission || !capability?.active || !capability.profileId || !module || module.schemaVersion !== 1 || module.enabled !== true)
        return undefined;
    const profile = module.profiles[capability.profileId];
    if (profile === undefined)
        return undefined;
    try {
        return Object.freeze({ schemaVersion: 1, profileId: capability.profileId, ...normalizeMacroEconomyProfileV1(profile) });
    }
    catch {
        return undefined;
    }
}
