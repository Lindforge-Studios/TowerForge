const DEFAULT_MAX_DEPTH = 128;
const DEFAULT_MAX_NODES = 1_000_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const FNV1A_64_OFFSET = 0xcbf29ce484222325n;
const FNV1A_64_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;
function checkedBudget(name, value, fallback) {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < 0) {
        throw new Error(`${name} must be a non-negative safe integer.`);
    }
    return resolved;
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
        else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length) {
            const trailing = value.charCodeAt(index + 1);
            if (trailing >= 0xdc00 && trailing <= 0xdfff) {
                bytes += 4;
                index += 1;
            }
            else {
                // This follows the UTF-8 replacement behavior used for lone surrogates.
                bytes += 3;
            }
        }
        else {
            bytes += 3;
        }
    }
    return bytes;
}
/**
 * Serialize the strict JSON value subset used by deterministic simulation state.
 *
 * Unlike JSON.stringify, this function never coerces, drops, or invokes values.
 * Object properties are read from own data descriptors and sorted by binary
 * UTF-16 order so integer-like keys do not receive special enumeration order.
 */
export function canonicalStringify(value, options = {}) {
    const maxDepth = checkedBudget("maxDepth", options.maxDepth, DEFAULT_MAX_DEPTH);
    const maxNodes = checkedBudget("maxNodes", options.maxNodes, DEFAULT_MAX_NODES);
    const maxBytes = checkedBudget("maxBytes", options.maxBytes, DEFAULT_MAX_BYTES);
    const ancestors = new WeakSet();
    const output = [];
    let nodes = 0;
    let bytes = 0;
    const emit = (chunk) => {
        bytes += utf8ByteLength(chunk);
        if (bytes > maxBytes) {
            throw new Error(`Canonical serialization exceeds the ${maxBytes} byte budget.`);
        }
        output.push(chunk);
    };
    const visit = (current, depth) => {
        if (depth > maxDepth) {
            throw new Error(`Canonical serialization exceeds the maximum depth of ${maxDepth}.`);
        }
        nodes += 1;
        if (nodes > maxNodes) {
            throw new Error(`Canonical serialization exceeds the ${maxNodes} node budget.`);
        }
        if (current === null) {
            emit("null");
            return;
        }
        switch (typeof current) {
            case "string":
                emit(JSON.stringify(current));
                return;
            case "boolean":
                emit(current ? "true" : "false");
                return;
            case "number":
                if (!Number.isFinite(current)) {
                    throw new Error("Canonical serialization rejects non-finite numbers.");
                }
                emit(Object.is(current, -0) ? "0" : JSON.stringify(current));
                return;
            case "undefined":
            case "function":
            case "symbol":
            case "bigint":
                throw new Error(`Canonical serialization rejects unsupported ${typeof current} values.`);
            case "object":
                break;
            default:
                throw new Error("Canonical serialization received an unsupported value.");
        }
        if (ancestors.has(current)) {
            throw new Error("Canonical serialization rejects cyclic values.");
        }
        ancestors.add(current);
        try {
            if (Array.isArray(current)) {
                if (Object.getPrototypeOf(current) !== Array.prototype) {
                    throw new Error("Canonical serialization accepts plain arrays only.");
                }
                const descriptors = Object.getOwnPropertyDescriptors(current);
                if (Object.getOwnPropertySymbols(descriptors).length > 0) {
                    throw new Error("Canonical serialization rejects symbol keys.");
                }
                const lengthDescriptor = descriptors["length"];
                if (!lengthDescriptor || !("value" in lengthDescriptor)) {
                    throw new Error("Canonical serialization requires an array length data property.");
                }
                const lengthValue = lengthDescriptor.value;
                if (typeof lengthValue !== "number" || !Number.isSafeInteger(lengthValue) || lengthValue < 0) {
                    throw new Error("Canonical serialization requires a non-negative integer array length.");
                }
                const length = lengthValue;
                const ownKeys = Object.keys(descriptors).filter((key) => key !== "length");
                if (ownKeys.length !== length) {
                    throw new Error("Canonical serialization rejects sparse arrays or arrays with extra properties.");
                }
                emit("[");
                for (let index = 0; index < length; index += 1) {
                    if (index > 0)
                        emit(",");
                    const descriptor = descriptors[String(index)];
                    if (!descriptor) {
                        throw new Error("Canonical serialization rejects sparse arrays.");
                    }
                    if (!("value" in descriptor)) {
                        throw new Error("Canonical serialization rejects accessor properties.");
                    }
                    if (!descriptor.enumerable) {
                        throw new Error("Canonical serialization rejects non-enumerable array elements.");
                    }
                    visit(descriptor.value, depth + 1);
                }
                emit("]");
                return;
            }
            if (Object.getPrototypeOf(current) !== Object.prototype) {
                throw new Error("Canonical serialization accepts plain objects only.");
            }
            const descriptors = Object.getOwnPropertyDescriptors(current);
            if (Object.getOwnPropertySymbols(descriptors).length > 0) {
                throw new Error("Canonical serialization rejects symbol keys.");
            }
            const keys = Object.keys(descriptors).sort();
            for (const descriptor of Object.values(descriptors)) {
                if (!("value" in descriptor)) {
                    throw new Error("Canonical serialization rejects accessor properties.");
                }
                if (!descriptor.enumerable) {
                    throw new Error("Canonical serialization rejects non-enumerable object properties.");
                }
            }
            emit("{");
            for (let index = 0; index < keys.length; index += 1) {
                if (index > 0)
                    emit(",");
                const key = keys[index];
                const descriptor = descriptors[key];
                emit(JSON.stringify(key));
                emit(":");
                visit(descriptor.value, depth + 1);
            }
            emit("}");
        }
        finally {
            ancestors.delete(current);
        }
    };
    visit(value, 0);
    return output.join("");
}
function hashUtf8(value) {
    let hash = FNV1A_64_OFFSET;
    const consume = (byte) => {
        hash ^= BigInt(byte);
        hash = (hash * FNV1A_64_PRIME) & UINT64_MASK;
    };
    for (let index = 0; index < value.length; index += 1) {
        const first = value.charCodeAt(index);
        let codePoint = first;
        if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
            const second = value.charCodeAt(index + 1);
            if (second >= 0xdc00 && second <= 0xdfff) {
                codePoint = 0x10000 + ((first - 0xd800) << 10) + second - 0xdc00;
                index += 1;
            }
            else {
                codePoint = 0xfffd;
            }
        }
        else if (first >= 0xdc00 && first <= 0xdfff) {
            codePoint = 0xfffd;
        }
        if (codePoint <= 0x7f) {
            consume(codePoint);
        }
        else if (codePoint <= 0x7ff) {
            consume(0xc0 | (codePoint >> 6));
            consume(0x80 | (codePoint & 0x3f));
        }
        else if (codePoint <= 0xffff) {
            consume(0xe0 | (codePoint >> 12));
            consume(0x80 | ((codePoint >> 6) & 0x3f));
            consume(0x80 | (codePoint & 0x3f));
        }
        else {
            consume(0xf0 | (codePoint >> 18));
            consume(0x80 | ((codePoint >> 12) & 0x3f));
            consume(0x80 | ((codePoint >> 6) & 0x3f));
            consume(0x80 | (codePoint & 0x3f));
        }
    }
    return hash.toString(16).padStart(16, "0");
}
export function stableDigest(value, options) {
    return `tf-state-v1:${hashUtf8(canonicalStringify(value, options))}`;
}
const EXCLUDED_CONTENT_DOMAINS = new Set([
    "visuals",
    "storyComics",
    "storySeenStoragePrefix",
    "battleBackgrounds",
    "battleBackgroundPlaceholderMissionIds",
    "battleBackgroundFallbackMissionId",
    "worldMap"
]);
const REQUIRED_SIMULATION_CONTENT_DOMAINS = [
    "constants",
    "currencies",
    "defaultDifficultyId",
    "difficulties",
    "metaProgression",
    "terrainTypes",
    "defaultMissionId",
    "abilities",
    "enemies",
    "towers",
    "waveSets",
    "missions",
    "maps",
    "scripts",
    "mechanics"
];
function defineProjectedProperty(target, key, value) {
    Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
    });
}
function plainObjectDescriptors(value, context) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error(`${context} must be a plain object.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error(`${context} rejects symbol keys.`);
    }
    return descriptors;
}
function projectArray(value, context, projectItem) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error(`${context} must be a plain array.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error(`${context} rejects symbol keys.`);
    }
    const lengthDescriptor = descriptors["length"];
    if (!lengthDescriptor || !("value" in lengthDescriptor)) {
        throw new Error(`${context} length must be a data property.`);
    }
    const lengthValue = lengthDescriptor.value;
    if (typeof lengthValue !== "number" || !Number.isSafeInteger(lengthValue) || lengthValue < 0) {
        throw new Error(`${context} length must be a non-negative integer.`);
    }
    const keys = Object.keys(descriptors).filter((key) => key !== "length");
    if (keys.length !== lengthValue) {
        throw new Error(`${context} rejects sparse arrays or extra array properties.`);
    }
    const projected = [];
    for (let index = 0; index < lengthValue; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new Error(`${context} elements must be enumerable data properties.`);
        }
        projected.push(projectItem(descriptor.value));
    }
    return projected;
}
function projectRecord(value, context, projectValue) {
    const descriptors = plainObjectDescriptors(value, context);
    const projected = {};
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!("value" in descriptor) || !descriptor.enumerable) {
            throw new Error(`${context} entry "${key}" must be an enumerable data property.`);
        }
        defineProjectedProperty(projected, key, projectValue(descriptor.value));
    }
    return projected;
}
function projectDefinition(value, context, omittedFields, replacements = {}) {
    const descriptors = plainObjectDescriptors(value, context);
    const projected = {};
    for (const key of Object.keys(descriptors)) {
        if (omittedFields.has(key))
            continue;
        const descriptor = descriptors[key];
        if (!("value" in descriptor) || !descriptor.enumerable) {
            throw new Error(`${context} field "${key}" must be an enumerable data property.`);
        }
        const replacement = Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : undefined;
        defineProjectedProperty(projected, key, replacement ? replacement(descriptor.value) : descriptor.value);
    }
    return projected;
}
const OMIT_LABEL = new Set(["label"]);
const OMIT_LABEL_COLOR = new Set(["label", "color"]);
const OMIT_LABEL_DESCRIPTION = new Set(["label", "description"]);
const OMIT_MISSION_PRESENTATION = new Set(["label", "description", "mapFactory"]);
const projectCurrencyDefinition = (value) => projectDefinition(value, "Currency definition", OMIT_LABEL_COLOR);
const projectDifficultyDefinition = (value) => projectDefinition(value, "Difficulty definition", OMIT_LABEL_DESCRIPTION);
const projectTerrainDefinition = (value) => projectDefinition(value, "Terrain definition", OMIT_LABEL);
const projectAbilityDefinition = (value) => projectDefinition(value, "Ability definition", OMIT_LABEL);
const projectEnemyDefinition = (value) => projectDefinition(value, "Enemy definition", OMIT_LABEL_COLOR);
const projectTowerDefinition = (value) => projectDefinition(value, "Tower definition", OMIT_LABEL);
const projectWaveDefinition = (value) => projectDefinition(value, "Wave definition", OMIT_LABEL);
const projectObjectiveDefinition = (value) => projectDefinition(value, "Mission objective definition", OMIT_LABEL);
function projectMetaProgression(value) {
    return projectDefinition(value, "Meta progression", new Set(), {
        currencies: (currencies) => projectArray(currencies, "Meta currencies", projectCurrencyDefinition),
        upgrades: (upgrades) => projectRecord(upgrades, "Meta upgrades", (upgrade) => projectDefinition(upgrade, "Meta upgrade definition", OMIT_LABEL_DESCRIPTION))
    });
}
function projectObjectives(value) {
    return projectDefinition(value, "Mission objectives", new Set(), {
        victory: (objectives) => projectArray(objectives, "Victory objectives", projectObjectiveDefinition),
        failure: (objectives) => projectArray(objectives, "Failure objectives", projectObjectiveDefinition),
        stars: (objectives) => projectArray(objectives, "Star objectives", projectObjectiveDefinition)
    });
}
function projectMissionDefinition(value) {
    return projectDefinition(value, "Mission definition", OMIT_MISSION_PRESENTATION, {
        waves: (waves) => projectArray(waves, "Mission waves", projectWaveDefinition),
        abilities: (abilities) => projectArray(abilities, "Mission abilities", projectAbilityDefinition),
        objectives: projectObjectives
    });
}
function projectMissions(value) {
    return projectRecord(value, "Simulation missions", projectMissionDefinition);
}
function projectKnownDomain(key, value) {
    switch (key) {
        case "currencies":
            return projectArray(value, "Currencies", projectCurrencyDefinition);
        case "difficulties":
            return projectArray(value, "Difficulties", projectDifficultyDefinition);
        case "metaProgression":
            return projectMetaProgression(value);
        case "terrainTypes":
            return projectRecord(value, "Terrain types", projectTerrainDefinition);
        case "abilities":
            return projectRecord(value, "Abilities", projectAbilityDefinition);
        case "enemies":
            return projectRecord(value, "Enemies", projectEnemyDefinition);
        case "towers":
            return projectRecord(value, "Towers", projectTowerDefinition);
        case "waveSets":
            return projectRecord(value, "Wave sets", (waves) => projectArray(waves, "Wave set", projectWaveDefinition));
        case "missions":
            return projectMissions(value);
        default:
            return value;
    }
}
/**
 * Digest every registry domain that can affect deterministic simulation.
 * Presentation-only data and the derived map factory closure are intentionally
 * excluded. The projection is rebuilt on every call because registries are mutable.
 */
export function getSimulationContentDigest(content) {
    const descriptors = Object.getOwnPropertyDescriptors(content);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error("Simulation content registry rejects symbol keys.");
    }
    for (const key of REQUIRED_SIMULATION_CONTENT_DOMAINS) {
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor)) {
            throw new Error(`Simulation content domain "${key}" must be an own data property.`);
        }
    }
    const simulationContent = {};
    for (const key of Object.keys(descriptors)) {
        if (EXCLUDED_CONTENT_DOMAINS.has(key))
            continue;
        const descriptor = descriptors[key];
        if (!("value" in descriptor)) {
            throw new Error(`Simulation content domain "${key}" must be an own data property.`);
        }
        defineProjectedProperty(simulationContent, key, projectKnownDomain(key, descriptor.value));
    }
    return `tf-content-v1:${hashUtf8(canonicalStringify(simulationContent))}`;
}
