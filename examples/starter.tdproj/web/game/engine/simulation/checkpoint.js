import { canonicalStringify, stableDigest } from "./stable-digest.js";
export const GAME_CHECKPOINT_SCHEMA_VERSION = 1;
export const SIMULATION_ENGINE_VERSION = "towerforge-sim-v2";
export function checkpointObjectDescriptors(value, context) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error(`${context} must be a plain object.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error(`${context} rejects symbol keys.`);
    }
    return descriptors;
}
export function checkpointDataField(descriptors, key, context) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error(`${context} field "${key}" must be an enumerable own data property.`);
    }
    return descriptor.value;
}
export function requireExactCheckpointKeys(descriptors, expectedKeys, context) {
    const actualKeys = Object.keys(descriptors);
    if (actualKeys.length !== expectedKeys.length || expectedKeys.some((key) => !actualKeys.includes(key))) {
        throw new Error(`${context} contains missing or unsupported fields.`);
    }
}
export function inspectCheckpointEnvelope(value) {
    const descriptors = checkpointObjectDescriptors(value, "Game checkpoint");
    const schemaVersion = checkpointDataField(descriptors, "schemaVersion", "Game checkpoint");
    if (schemaVersion !== GAME_CHECKPOINT_SCHEMA_VERSION) {
        throw new Error(`Unsupported game checkpoint schema version "${String(schemaVersion)}".`);
    }
    const engineVersion = checkpointDataField(descriptors, "engineVersion", "Game checkpoint");
    if (engineVersion !== SIMULATION_ENGINE_VERSION) {
        throw new Error(`Unsupported simulation engine version "${String(engineVersion)}".`);
    }
    const expectedKeys = ["schemaVersion", "engineVersion", "contentDigest", "identity", "rng", "state", "stateDigest"];
    requireExactCheckpointKeys(descriptors, expectedKeys, "Game checkpoint envelope");
    return descriptors;
}
/** Descriptor-safe detached JSON clone. Unsupported values and accessors are rejected. */
export function cloneCheckpointJson(value) {
    return JSON.parse(canonicalStringify(value));
}
export function computeCheckpointStateDigest(contentDigest, identity, rng, state) {
    return stableDigest({
        schemaVersion: GAME_CHECKPOINT_SCHEMA_VERSION,
        engineVersion: SIMULATION_ENGINE_VERSION,
        contentDigest,
        identity,
        rng,
        state
    });
}
