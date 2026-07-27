import { TOWER_TARGET_MODES } from "./types.js";
export const GAME_COMMAND_SCHEMA_VERSION = 6;
export const GAME_COMMAND_SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1, 2, 3, 4, 5, 6]);
const MAX_PAYLOAD_DEPTH = 32;
const MAX_PAYLOAD_NODES = 4_096;
const MAX_PAYLOAD_BYTES = 64 * 1_024;
const SAFE_SIGNAL_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
export function invalidGameCommandResult() {
    return {
        ok: false,
        reason: "Invalid game command.",
        reasonKey: "reason.invalidGameCommand"
    };
}
function snapshotPlainDataFields(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        return undefined;
    const fields = new Map();
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string")
            return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
            return undefined;
        fields.set(key, descriptor.value);
    }
    return fields;
}
function hasClosedFields(fields, requiredKeys, optionalKeys = []) {
    const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
    return requiredKeys.every((key) => fields.has(key))
        && [...fields.keys()].every((key) => allowedKeys.has(key));
}
function isTrimmedId(value) {
    return typeof value === "string" && value.length > 0 && value === value.trim();
}
function isBoundedCommandId(value) {
    return isTrimmedId(value) && utf8ByteLength(value) <= 128;
}
function isCommandId(schemaVersion, value) {
    return schemaVersion === 1 ? isTrimmedId(value) : isBoundedCommandId(value);
}
function canonicalNumber(value) {
    return Object.is(value, -0) ? 0 : value;
}
function parseCoord(value) {
    const fields = snapshotPlainDataFields(value);
    if (!fields || !hasClosedFields(fields, ["q", "r"]))
        return undefined;
    const q = fields.get("q");
    const r = fields.get("r");
    if (typeof q !== "number" || !Number.isFinite(q) || !Number.isInteger(q))
        return undefined;
    if (typeof r !== "number" || !Number.isFinite(r) || !Number.isInteger(r))
        return undefined;
    return { q: canonicalNumber(q), r: canonicalNumber(r) };
}
function isTowerTargetMode(value) {
    return typeof value === "string" && TOWER_TARGET_MODES.includes(value);
}
function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit <= 0x7f) {
            bytes += 1;
        }
        else if (codeUnit <= 0x7ff) {
            bytes += 2;
        }
        else if (codeUnit >= 0xd800
            && codeUnit <= 0xdbff
            && index + 1 < value.length
            && value.charCodeAt(index + 1) >= 0xdc00
            && value.charCodeAt(index + 1) <= 0xdfff) {
            bytes += 4;
            index += 1;
        }
        else {
            bytes += 3;
        }
    }
    return bytes;
}
function cloneJsonSafePayload(value) {
    let nodes = 0;
    const ancestors = new Set();
    const visit = (candidate, depth) => {
        nodes += 1;
        if (nodes > MAX_PAYLOAD_NODES || depth > MAX_PAYLOAD_DEPTH)
            return { ok: false };
        if (candidate === null || typeof candidate === "boolean" || typeof candidate === "string") {
            return { ok: true, value: candidate };
        }
        if (typeof candidate === "number") {
            return Number.isFinite(candidate)
                ? { ok: true, value: canonicalNumber(candidate) }
                : { ok: false };
        }
        if (typeof candidate !== "object" || ancestors.has(candidate))
            return { ok: false };
        ancestors.add(candidate);
        try {
            if (Array.isArray(candidate)) {
                if (Object.getPrototypeOf(candidate) !== Array.prototype)
                    return { ok: false };
                const descriptors = new Map();
                for (const key of Reflect.ownKeys(candidate)) {
                    const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
                    if (!descriptor)
                        return { ok: false };
                    descriptors.set(key, descriptor);
                }
                const lengthDescriptor = descriptors.get("length");
                if (!lengthDescriptor || !("value" in lengthDescriptor))
                    return { ok: false };
                const length = lengthDescriptor.value;
                if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0)
                    return { ok: false };
                if (descriptors.size !== length + 1)
                    return { ok: false };
                const clone = [];
                for (let index = 0; index < length; index += 1) {
                    const key = String(index);
                    const descriptor = descriptors.get(key);
                    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
                        return { ok: false };
                    const child = visit(descriptor.value, depth + 1);
                    if (!child.ok)
                        return child;
                    clone.push(child.value);
                }
                return { ok: true, value: clone };
            }
            const fields = snapshotPlainDataFields(candidate);
            if (!fields)
                return { ok: false };
            const clone = {};
            for (const [key, childValue] of fields) {
                const child = visit(childValue, depth + 1);
                if (!child.ok)
                    return child;
                Object.defineProperty(clone, key, {
                    value: child.value,
                    enumerable: true,
                    configurable: true,
                    writable: true
                });
            }
            return { ok: true, value: clone };
        }
        finally {
            ancestors.delete(candidate);
        }
    };
    const result = visit(value, 0);
    if (!result.ok)
        return undefined;
    const serialized = JSON.stringify(result.value);
    return serialized !== undefined && utf8ByteLength(serialized) <= MAX_PAYLOAD_BYTES
        ? result.value
        : undefined;
}
/**
 * Strict descriptor-safe parser shared by direct dispatch and command journals.
 * The returned command is a detached canonical data object.
 */
export function parseGameCommand(input) {
    const fields = snapshotPlainDataFields(input);
    if (!fields)
        return undefined;
    const schemaVersion = fields.get("schemaVersion");
    const type = fields.get("type");
    if ((schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4
        && schemaVersion !== 5 && schemaVersion !== 6)
        || typeof type !== "string")
        return undefined;
    if (type === "tick") {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "units"]))
            return undefined;
        const units = fields.get("units");
        if (typeof units !== "number" || !Number.isFinite(units) || units < 0)
            return undefined;
        const canonicalUnits = canonicalNumber(units);
        return { schemaVersion, type, units: canonicalUnits };
    }
    if (type === "startWave") {
        if (!hasClosedFields(fields, ["schemaVersion", "type"]))
            return undefined;
        return { schemaVersion, type };
    }
    if (type === "placeTower") {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "towerTypeId", "coord"]))
            return undefined;
        const towerTypeId = fields.get("towerTypeId");
        const coord = parseCoord(fields.get("coord"));
        if (!isCommandId(schemaVersion, towerTypeId) || !coord)
            return undefined;
        return { schemaVersion, type, towerTypeId, coord };
    }
    if (type === "moveTower") {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "towerId", "coord"]))
            return undefined;
        const towerId = fields.get("towerId");
        const coord = parseCoord(fields.get("coord"));
        if (!isCommandId(schemaVersion, towerId) || !coord)
            return undefined;
        return { schemaVersion, type, towerId, coord };
    }
    if (type === "sellTower") {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "towerId"]))
            return undefined;
        const towerId = fields.get("towerId");
        if (!isCommandId(schemaVersion, towerId))
            return undefined;
        return { schemaVersion, type, towerId };
    }
    if (type === "upgradeTower") {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "towerId"], ["branchId"]))
            return undefined;
        const towerId = fields.get("towerId");
        if (!isCommandId(schemaVersion, towerId))
            return undefined;
        if (!fields.has("branchId"))
            return { schemaVersion, type, towerId };
        const branchId = fields.get("branchId");
        if (!isCommandId(schemaVersion, branchId))
            return undefined;
        return { schemaVersion, type, towerId, branchId };
    }
    if (type === "setTargetMode") {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "towerId", "mode"]))
            return undefined;
        const towerId = fields.get("towerId");
        const mode = fields.get("mode");
        if (!isCommandId(schemaVersion, towerId) || !isTowerTargetMode(mode))
            return undefined;
        return { schemaVersion, type, towerId, mode };
    }
    if (type === "useAbility") {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "abilityId", "center"]))
            return undefined;
        const abilityId = fields.get("abilityId");
        const center = parseCoord(fields.get("center"));
        if (!isCommandId(schemaVersion, abilityId) || !center)
            return undefined;
        return { schemaVersion, type, abilityId, center };
    }
    if (type === "emitSignal") {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "signal"], ["payload"]))
            return undefined;
        const signal = fields.get("signal");
        if (!isCommandId(schemaVersion, signal) || !SAFE_SIGNAL_RE.test(signal))
            return undefined;
        if (!fields.has("payload")) {
            return { schemaVersion, type, signal };
        }
        const payload = cloneJsonSafePayload(fields.get("payload"));
        if (payload === undefined)
            return undefined;
        return { schemaVersion, type, signal, payload };
    }
    if (schemaVersion >= 2 && (type === "socketArtifact" || type === "unsocketArtifact")) {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "artifactInstanceId", "towerId", "slotId"])) {
            return undefined;
        }
        const artifactInstanceId = fields.get("artifactInstanceId");
        const towerId = fields.get("towerId");
        const slotId = fields.get("slotId");
        if (!isBoundedCommandId(artifactInstanceId)
            || !isBoundedCommandId(towerId)
            || !isBoundedCommandId(slotId))
            return undefined;
        return { schemaVersion, type, artifactInstanceId, towerId, slotId };
    }
    if (schemaVersion >= 3 && type === "chooseDraftOption") {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "offerId", "cardId"]))
            return undefined;
        const offerId = fields.get("offerId");
        const cardId = fields.get("cardId");
        if (!isBoundedCommandId(offerId) || !isBoundedCommandId(cardId))
            return undefined;
        return { schemaVersion, type, offerId, cardId };
    }
    if (schemaVersion >= 4 && type === "moveHero") {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "heroId", "target"]))
            return undefined;
        const heroId = fields.get("heroId");
        const target = parseCoord(fields.get("target"));
        if (!isBoundedCommandId(heroId) || !target)
            return undefined;
        return { schemaVersion, type, heroId, target };
    }
    if (schemaVersion >= 5 && type === "useHeroAbility") {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "heroId", "abilityId", "targetEnemyId"]))
            return undefined;
        const heroId = fields.get("heroId");
        const abilityId = fields.get("abilityId");
        const targetEnemyId = fields.get("targetEnemyId");
        if (!isBoundedCommandId(heroId) || !isBoundedCommandId(abilityId) || !isBoundedCommandId(targetEnemyId)) {
            return undefined;
        }
        return { schemaVersion, type, heroId, abilityId, targetEnemyId };
    }
    if (schemaVersion === 6 && type === "unlockHeroSkill") {
        if (!hasClosedFields(fields, ["schemaVersion", "type", "heroId", "skillId"]))
            return undefined;
        const heroId = fields.get("heroId");
        const skillId = fields.get("skillId");
        if (!isBoundedCommandId(heroId) || !isBoundedCommandId(skillId))
            return undefined;
        return { schemaVersion: 6, type, heroId, skillId };
    }
    return undefined;
}
/** Execute a command that has already passed the strict parser exactly once. */
export function executeParsedGameCommand(game, command) {
    switch (command.type) {
        case "tick":
            game.tick(command.units);
            return { ok: true };
        case "startWave":
            return game.startNextWave();
        case "placeTower":
            return game.placeTower(command.towerTypeId, command.coord);
        case "moveTower":
            return game.moveTower(command.towerId, command.coord);
        case "sellTower":
            return game.sellTower(command.towerId);
        case "upgradeTower":
            return game.upgradeTower(command.towerId, command.branchId);
        case "setTargetMode":
            return game.setTowerTargetMode(command.towerId, command.mode);
        case "useAbility":
            return game.useAbility(command.abilityId, command.center);
        case "emitSignal":
            return game.emitScriptSignal(command.signal, command.payload);
        case "socketArtifact":
            return game.socketArtifact(command.artifactInstanceId, command.towerId, command.slotId);
        case "unsocketArtifact":
            return game.unsocketArtifact(command.artifactInstanceId, command.towerId, command.slotId);
        case "chooseDraftOption":
            return game.chooseDraftOption(command.offerId, command.cardId);
        case "moveHero":
            return game.moveHero(command.heroId, command.target);
        case "useHeroAbility":
            return game.useHeroAbility(command.heroId, command.abilityId, command.targetEnemyId);
        case "unlockHeroSkill":
            return game.unlockHeroSkill(command.heroId, command.skillId);
    }
}
