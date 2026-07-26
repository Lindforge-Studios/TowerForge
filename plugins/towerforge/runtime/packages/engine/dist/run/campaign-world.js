import { resolveActiveRogueliteMechanics } from "../content/roguelite-mechanics.js";
import { recordPlayerMissionClear } from "../profile/player-profile.js";
import { decodeCampaignRun } from "./campaign-run.js";
export const WORLD_CAMPAIGN_SCHEMA = Object.freeze({
    supportedSchemaVersions: Object.freeze([1]),
    nodeTypes: Object.freeze(["battle", "elite", "merchant", "event", "boss"]),
    limits: Object.freeze({
        jsonBytes: 1_048_576,
        nodes: 1_024,
        edges: 8_192,
        entryNodes: 64,
        idUtf8Bytes: 128,
        labelUtf8Bytes: 256
    })
});
const WORLD_CAMPAIGN_LIMITS = WORLD_CAMPAIGN_SCHEMA.limits;
const ROOT_FIELDS = Object.freeze(["schemaVersion", "rogueliteProfileId", "entryNodeIds", "nodes"]);
const BATTLE_NODE_FIELDS = Object.freeze([
    "id", "type", "missionId", "regionId", "x", "y", "difficulty", "nextNodeIds"
]);
const STRUCTURAL_NODE_FIELDS = Object.freeze([
    "id", "type", "label", "regionId", "x", "y", "difficulty", "nextNodeIds"
]);
const BATTLE_NODE_TYPES = new Set(["battle", "elite", "boss"]);
const STRUCTURAL_NODE_TYPES = new Set(["merchant", "event"]);
export class WorldCampaignValidationError extends Error {
    fieldPath;
    constructor(fieldPath, message) {
        super(message);
        this.name = "WorldCampaignValidationError";
        this.fieldPath = fieldPath;
    }
}
function binaryCompare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function isBattleNode(node) {
    return node.type === "battle" || node.type === "elite" || node.type === "boss";
}
function utf8ByteLength(value) {
    let bytes = 0;
    for (const character of value) {
        const point = character.codePointAt(0);
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    return bytes;
}
function jsonStringByteLength(value) {
    let bytes = 2;
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit === 0x22 || codeUnit === 0x5c || codeUnit === 0x08 || codeUnit === 0x09
            || codeUnit === 0x0a || codeUnit === 0x0c || codeUnit === 0x0d) {
            bytes += 2;
        }
        else if (codeUnit < 0x20 || (codeUnit >= 0xd800 && codeUnit <= 0xdfff)) {
            const next = value.charCodeAt(index + 1);
            if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
                bytes += 4;
                index += 1;
            }
            else {
                bytes += 6;
            }
        }
        else if (codeUnit <= 0x7f)
            bytes += 1;
        else if (codeUnit <= 0x7ff)
            bytes += 2;
        else
            bytes += 3;
    }
    return bytes;
}
/** Detach hostile authored data without invoking accessors, iterators, or serialization hooks. */
function captureCampaignInput(value) {
    const ancestors = new WeakSet();
    let bytes = 0;
    let visited = 0;
    const maximumVisited = WORLD_CAMPAIGN_LIMITS.edges * 4 + WORLD_CAMPAIGN_LIMITS.nodes * 16 + 1_024;
    const addBytes = (amount) => {
        bytes += amount;
        if (bytes > WORLD_CAMPAIGN_LIMITS.jsonBytes) {
            throw new WorldCampaignValidationError("worldMap.campaign", `World campaign exceeds the ${WORLD_CAMPAIGN_LIMITS.jsonBytes} byte limit.`);
        }
    };
    const visit = (current, path, depth) => {
        visited += 1;
        if (visited > maximumVisited || depth > 12) {
            throw new WorldCampaignValidationError(path, "World campaign exceeds its structural budget.");
        }
        if (current === null) {
            addBytes(4);
            return null;
        }
        if (typeof current === "string") {
            addBytes(jsonStringByteLength(current));
            return current;
        }
        if (typeof current === "number" || typeof current === "boolean") {
            addBytes(String(current).length);
            return current;
        }
        if (typeof current !== "object") {
            throw new WorldCampaignValidationError(path, `World campaign rejects ${typeof current} values.`);
        }
        if (ancestors.has(current))
            throw new WorldCampaignValidationError(path, "World campaign rejects cyclic data.");
        let prototype;
        let descriptors;
        try {
            prototype = Object.getPrototypeOf(current);
            descriptors = Object.getOwnPropertyDescriptors(current);
        }
        catch {
            throw new WorldCampaignValidationError(path, "World campaign data could not be inspected safely.");
        }
        ancestors.add(current);
        try {
            if (Array.isArray(current)) {
                if (prototype !== Array.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) {
                    throw new WorldCampaignValidationError(path, "World campaign arrays must be plain own-data arrays.");
                }
                const lengthDescriptor = descriptors.length;
                const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
                if (!Number.isSafeInteger(length) || length < 0 || length > WORLD_CAMPAIGN_LIMITS.edges + 1) {
                    throw new WorldCampaignValidationError(path, "World campaign array exceeds its item limit.");
                }
                const keys = Reflect.ownKeys(descriptors).filter((key) => key !== "length");
                if (keys.length !== length) {
                    throw new WorldCampaignValidationError(path, "World campaign arrays must be dense and contain no extra fields.");
                }
                const result = [];
                addBytes(2);
                for (let index = 0; index < length; index += 1) {
                    const descriptor = descriptors[String(index)];
                    if (!descriptor?.enumerable || !("value" in descriptor)) {
                        throw new WorldCampaignValidationError(`${path}[${index}]`, "World campaign arrays reject sparse entries and accessors.");
                    }
                    addBytes(index === 0 ? 0 : 1);
                    result.push(visit(descriptor.value, `${path}[${index}]`, depth + 1));
                }
                return result;
            }
            if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(descriptors).length > 0) {
                throw new WorldCampaignValidationError(path, "World campaign objects must be plain own-data objects.");
            }
            const result = Object.create(null);
            addBytes(2);
            let index = 0;
            for (const key of Object.keys(descriptors).sort(binaryCompare)) {
                const descriptor = descriptors[key];
                if (!descriptor?.enumerable || !("value" in descriptor)) {
                    throw new WorldCampaignValidationError(`${path}.${key}`, "World campaign fields must be enumerable own data.");
                }
                addBytes((index === 0 ? 0 : 1) + jsonStringByteLength(key) + 1);
                Object.defineProperty(result, key, {
                    value: visit(descriptor.value, `${path}.${key}`, depth + 1),
                    enumerable: true
                });
                index += 1;
            }
            return result;
        }
        finally {
            ancestors.delete(current);
        }
    };
    return visit(value, "worldMap.campaign", 0);
}
function fields(value, path, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new WorldCampaignValidationError(path, `${label} must be a plain object.`);
    }
    const result = new Map();
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!descriptor.enumerable || !("value" in descriptor)) {
            throw new WorldCampaignValidationError(`${path}.${key}`, `${label} fields must be enumerable own data.`);
        }
        result.set(key, descriptor.value);
    }
    return result;
}
function exactFields(actual, expected, path, label) {
    for (const key of actual.keys()) {
        if (!expected.includes(key)) {
            throw new WorldCampaignValidationError(`${path}.${key}`, `${label} contains unknown field "${key}".`);
        }
    }
    for (const key of expected) {
        if (!actual.has(key))
            throw new WorldCampaignValidationError(`${path}.${key}`, `${label} field "${key}" is required.`);
    }
}
function denseArray(value, path, maximum, label) {
    if (!Array.isArray(value))
        throw new WorldCampaignValidationError(path, `${label} must be an array.`);
    if (value.length > maximum) {
        throw new WorldCampaignValidationError(path, `${label} exceeds the ${maximum} item limit.`);
    }
    return value;
}
function boundedId(value, path, label) {
    if (typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > WORLD_CAMPAIGN_LIMITS.idUtf8Bytes) {
        throw new WorldCampaignValidationError(path, `${label} must be non-empty and no longer than ${WORLD_CAMPAIGN_LIMITS.idUtf8Bytes} UTF-8 bytes.`);
    }
    return value;
}
function boundedLabel(value, path) {
    if (typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > WORLD_CAMPAIGN_LIMITS.labelUtf8Bytes) {
        throw new WorldCampaignValidationError(path, `Campaign node label must be non-empty and no longer than ${WORLD_CAMPAIGN_LIMITS.labelUtf8Bytes} UTF-8 bytes.`);
    }
    return value;
}
function finiteCoordinate(value, path) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new WorldCampaignValidationError(path, "Campaign node coordinate must be finite.");
    }
    return Object.is(value, -0) ? 0 : value;
}
function difficulty(value, path) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 5) {
        throw new WorldCampaignValidationError(path, "Campaign node difficulty must be an integer from 1 to 5.");
    }
    return value;
}
function idArray(value, path, maximum, label) {
    const source = denseArray(value, path, maximum, label);
    const seen = new Set();
    const result = [];
    for (let index = 0; index < source.length; index += 1) {
        const id = boundedId(source[index], `${path}[${index}]`, `${label} id`);
        if (seen.has(id))
            throw new WorldCampaignValidationError(`${path}[${index}]`, `${label} contains duplicate id "${id}".`);
        seen.add(id);
        result.push(id);
    }
    result.sort(binaryCompare);
    return Object.freeze(result);
}
function freezeCampaign(fieldsToFreeze) {
    return Object.freeze({
        schemaVersion: 1,
        source: fieldsToFreeze.source,
        rogueliteProfileId: fieldsToFreeze.rogueliteProfileId,
        entryNodeIds: fieldsToFreeze.entryNodeIds,
        nodes: fieldsToFreeze.nodes
    });
}
function validateGraphTopology(entryNodeIds, nodes) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const entryNodeId of entryNodeIds) {
        if (!byId.has(entryNodeId)) {
            throw new WorldCampaignValidationError("worldMap.campaign.entryNodeIds", `Campaign entry references unknown node "${entryNodeId}".`);
        }
    }
    for (const node of nodes) {
        for (const nextNodeId of node.nextNodeIds) {
            if (!byId.has(nextNodeId)) {
                throw new WorldCampaignValidationError(`worldMap.campaign.nodes.${node.id}.nextNodeIds`, `Campaign nextNodeIds references unknown node "${nextNodeId}".`);
            }
            if (nextNodeId === node.id) {
                throw new WorldCampaignValidationError(`worldMap.campaign.nodes.${node.id}.nextNodeIds`, `Campaign node "${node.id}" cannot have a self edge.`);
            }
        }
    }
    const indegree = new Map(nodes.map((node) => [node.id, 0]));
    for (const node of nodes) {
        for (const nextNodeId of node.nextNodeIds)
            indegree.set(nextNodeId, (indegree.get(nextNodeId) ?? 0) + 1);
    }
    const ready = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort(binaryCompare);
    let visited = 0;
    while (ready.length > 0) {
        const id = ready.shift();
        visited += 1;
        for (const nextNodeId of byId.get(id).nextNodeIds) {
            const next = (indegree.get(nextNodeId) ?? 0) - 1;
            indegree.set(nextNodeId, next);
            if (next === 0) {
                ready.push(nextNodeId);
                ready.sort(binaryCompare);
            }
        }
    }
    if (visited !== nodes.length) {
        throw new WorldCampaignValidationError("worldMap.campaign.nodes", "World campaign graph contains a cycle.");
    }
    const reachable = new Set();
    const pending = [...entryNodeIds];
    while (pending.length > 0) {
        const id = pending.shift();
        if (reachable.has(id))
            continue;
        reachable.add(id);
        pending.push(...byId.get(id).nextNodeIds);
    }
    const unreachable = nodes.map((node) => node.id).filter((id) => !reachable.has(id)).sort(binaryCompare);
    if (unreachable.length > 0) {
        throw new WorldCampaignValidationError(`worldMap.campaign.nodes.${unreachable[0]}`, `Campaign node "${unreachable[0]}" is not reachable from an entry node.`);
    }
}
/** Validate, normalize, sort, and deeply freeze an authored campaign graph. */
export function normalizeAuthoredWorldCampaignV1(value, content) {
    const captured = captureCampaignInput(value);
    const root = fields(captured, "worldMap.campaign", "World campaign");
    exactFields(root, ROOT_FIELDS, "worldMap.campaign", "World campaign");
    if (root.get("schemaVersion") !== 1) {
        throw new WorldCampaignValidationError("worldMap.campaign.schemaVersion", "World campaign schema version is unsupported; only version 1 is supported.");
    }
    const rogueliteProfileId = boundedId(root.get("rogueliteProfileId"), "worldMap.campaign.rogueliteProfileId", "Roguelite profile id");
    const entryNodeIds = idArray(root.get("entryNodeIds"), "worldMap.campaign.entryNodeIds", WORLD_CAMPAIGN_LIMITS.entryNodes, "Campaign entry nodes");
    if (entryNodeIds.length === 0) {
        throw new WorldCampaignValidationError("worldMap.campaign.entryNodeIds", "World campaign needs at least one entry node.");
    }
    const authoredNodes = denseArray(root.get("nodes"), "worldMap.campaign.nodes", WORLD_CAMPAIGN_LIMITS.nodes, "Campaign nodes");
    if (authoredNodes.length === 0) {
        throw new WorldCampaignValidationError("worldMap.campaign.nodes", "World campaign needs at least one node.");
    }
    const seenNodeIds = new Set();
    let edgeCount = 0;
    const nodes = authoredNodes.map((valueAtNode, index) => {
        const path = `worldMap.campaign.nodes[${index}]`;
        const node = fields(valueAtNode, path, "Campaign node");
        const nodeType = node.get("type");
        const isBattle = typeof nodeType === "string" && BATTLE_NODE_TYPES.has(nodeType);
        const isStructural = typeof nodeType === "string" && STRUCTURAL_NODE_TYPES.has(nodeType);
        if (!isBattle && !isStructural) {
            throw new WorldCampaignValidationError(`${path}.type`, `Campaign node type "${String(nodeType)}" is unsupported.`);
        }
        exactFields(node, isBattle ? BATTLE_NODE_FIELDS : STRUCTURAL_NODE_FIELDS, path, "Campaign node");
        const id = boundedId(node.get("id"), `${path}.id`, "Campaign node id");
        if (seenNodeIds.has(id)) {
            throw new WorldCampaignValidationError(`${path}.id`, `Campaign contains duplicate node id "${id}".`);
        }
        seenNodeIds.add(id);
        const nextNodeIds = idArray(node.get("nextNodeIds"), `${path}.nextNodeIds`, WORLD_CAMPAIGN_LIMITS.edges, "Campaign nextNodeIds");
        edgeCount += nextNodeIds.length;
        if (edgeCount > WORLD_CAMPAIGN_LIMITS.edges) {
            throw new WorldCampaignValidationError(`${path}.nextNodeIds`, `World campaign edge count exceeds the ${WORLD_CAMPAIGN_LIMITS.edges} edge limit.`);
        }
        const common = {
            id,
            regionId: boundedId(node.get("regionId"), `${path}.regionId`, "Campaign region id"),
            x: finiteCoordinate(node.get("x"), `${path}.x`),
            y: finiteCoordinate(node.get("y"), `${path}.y`),
            difficulty: difficulty(node.get("difficulty"), `${path}.difficulty`),
            nextNodeIds
        };
        if (isBattle) {
            return Object.freeze({
                ...common,
                type: nodeType,
                missionId: boundedId(node.get("missionId"), `${path}.missionId`, "Campaign mission id")
            });
        }
        return Object.freeze({
            ...common,
            type: nodeType,
            label: boundedLabel(node.get("label"), `${path}.label`)
        });
    }).sort((left, right) => binaryCompare(left.id, right.id));
    validateGraphTopology(entryNodeIds, nodes);
    if (content) {
        const regionIds = new Set(content.worldMap.regions.map((region) => region.id));
        for (const node of nodes) {
            if (!regionIds.has(node.regionId)) {
                throw new WorldCampaignValidationError(`worldMap.campaign.nodes.${node.id}.regionId`, `Campaign node "${node.id}" references unknown region "${node.regionId}".`);
            }
            if (!isBattleNode(node))
                continue;
            const mission = content.missions[node.missionId];
            if (!mission) {
                throw new WorldCampaignValidationError(`worldMap.campaign.nodes.${node.id}.missionId`, `Campaign node "${node.id}" references unknown mission "${node.missionId}".`);
            }
            if (mission.mechanics?.profiles?.roguelite !== rogueliteProfileId) {
                throw new WorldCampaignValidationError(`worldMap.campaign.nodes.${node.id}.missionId`, `Campaign mission "${node.missionId}" does not select roguelite profile "${rogueliteProfileId}".`);
            }
        }
    }
    return freezeCampaign({
        source: "authored",
        rogueliteProfileId,
        entryNodeIds,
        nodes: Object.freeze(nodes)
    });
}
/** Read-only compatibility projection of legacy mission unlock requirements into forward edges. */
export function normalizeLegacyWorldCampaignV1(worldMap) {
    let descriptors;
    try {
        descriptors = Object.getOwnPropertyDescriptors(worldMap);
    }
    catch {
        throw new WorldCampaignValidationError("worldMap", "Legacy world map could not be inspected safely.");
    }
    const missionNodesDescriptor = descriptors.missionNodes;
    if (!missionNodesDescriptor?.enumerable || !("value" in missionNodesDescriptor)) {
        throw new WorldCampaignValidationError("worldMap.missionNodes", "Legacy missionNodes must be enumerable own data.");
    }
    const detached = captureCampaignInput(missionNodesDescriptor.value);
    const authoredNodes = denseArray(detached, "worldMap.missionNodes", WORLD_CAMPAIGN_LIMITS.nodes, "Legacy mission nodes");
    const legacy = authoredNodes.map((value, index) => {
        const path = `worldMap.missionNodes[${index}]`;
        const node = fields(value, path, "Legacy mission node");
        return {
            id: boundedId(node.get("missionId"), `${path}.missionId`, "Legacy mission id"),
            regionId: boundedId(node.get("regionId"), `${path}.regionId`, "Legacy region id"),
            x: finiteCoordinate(node.get("x"), `${path}.x`),
            y: finiteCoordinate(node.get("y"), `${path}.y`),
            difficulty: difficulty(node.get("difficulty"), `${path}.difficulty`),
            requirements: idArray(node.get("unlockRequiresMissionIds"), `${path}.unlockRequiresMissionIds`, WORLD_CAMPAIGN_LIMITS.edges, "Legacy unlock requirements")
        };
    });
    const byId = new Map();
    for (const node of legacy) {
        if (byId.has(node.id)) {
            throw new WorldCampaignValidationError("worldMap.missionNodes", `Legacy world map contains duplicate mission node "${node.id}".`);
        }
        byId.set(node.id, node);
    }
    const nextById = new Map([...byId.keys()].map((id) => [id, []]));
    let edgeCount = 0;
    for (const node of legacy) {
        for (const requiredId of node.requirements) {
            if (!byId.has(requiredId)) {
                throw new WorldCampaignValidationError(`worldMap.missionNodes.${node.id}.unlockRequiresMissionIds`, `Legacy mission node "${node.id}" references unknown requirement "${requiredId}".`);
            }
            nextById.get(requiredId).push(node.id);
            edgeCount += 1;
            if (edgeCount > WORLD_CAMPAIGN_LIMITS.edges) {
                throw new WorldCampaignValidationError("worldMap.missionNodes", "Legacy mission graph exceeds the edge limit.");
            }
        }
    }
    const nodes = legacy.map((node) => Object.freeze({
        id: node.id,
        type: "battle",
        missionId: node.id,
        regionId: node.regionId,
        x: node.x,
        y: node.y,
        difficulty: node.difficulty,
        nextNodeIds: Object.freeze(nextById.get(node.id).sort(binaryCompare))
    })).sort((left, right) => binaryCompare(left.id, right.id));
    const entryNodeIds = Object.freeze(legacy
        .filter((node) => node.requirements.length === 0)
        .map((node) => node.id)
        .sort(binaryCompare));
    if (nodes.length > 0)
        validateGraphTopology(entryNodeIds, nodes);
    return freezeCampaign({
        source: "legacy",
        rogueliteProfileId: null,
        entryNodeIds,
        nodes: Object.freeze(nodes)
    });
}
function activeCampaignProfile(content, profileId) {
    for (const missionId of Object.keys(content.missions).sort(binaryCompare)) {
        const active = resolveActiveRogueliteMechanics(content, missionId);
        if (active?.schemaVersion === 4 && active.profileId === profileId && active.campaign?.schemaVersion === 1)
            return active;
    }
    return undefined;
}
/** Resolve only a genuinely active authored v4 campaign; legacy content remains capability-inert. */
export function resolveWorldCampaign(content) {
    try {
        const descriptor = Object.getOwnPropertyDescriptor(content.worldMap, "campaign");
        if (!descriptor?.enumerable || !("value" in descriptor) || descriptor.value === undefined)
            return undefined;
        const normalized = normalizeAuthoredWorldCampaignV1(descriptor.value, content);
        return normalized.rogueliteProfileId !== null && activeCampaignProfile(content, normalized.rogueliteProfileId)
            ? normalized
            : undefined;
    }
    catch {
        return undefined;
    }
}
function validateCapturedCampaignRunAgainstContent(run, content) {
    const campaign = resolveWorldCampaign(content);
    if (!campaign)
        return Object.freeze({ ok: false, code: "campaign_inactive", run });
    if (run.nodeId !== null && !campaign.nodes.some((node) => node.id === run.nodeId)) {
        return Object.freeze({ ok: false, code: "unknown_node", run });
    }
    const profile = activeCampaignProfile(content, campaign.rogueliteProfileId);
    if (!profile)
        return Object.freeze({ ok: false, code: "campaign_inactive", run });
    if (run.deck.some((entry) => !profile.draft?.definitions[entry.cardId])) {
        return Object.freeze({ ok: false, code: "unknown_card", run });
    }
    if (run.artifacts.some((entry) => !profile.artifacts?.definitions[entry.artifactId])) {
        return Object.freeze({ ok: false, code: "unknown_artifact", run });
    }
    return Object.freeze({ ok: true, code: "valid", run, campaign });
}
function availableCampaignNodeIds(run, campaign) {
    if (run.nodeId === null)
        return Object.freeze([...campaign.entryNodeIds]);
    const current = campaign.nodes.find((node) => node.id === run.nodeId);
    return Object.freeze([...(current?.nextNodeIds ?? [])].sort(binaryCompare));
}
function advanceCapturedCampaignRun(run, nodeId) {
    return Object.freeze({
        version: run.version,
        seed: run.seed,
        nodeId,
        deck: run.deck,
        artifacts: run.artifacts,
        runResources: run.runResources
    });
}
/** Validate the unchanged CampaignRunV1 codec document against currently active authored content. */
export function validateCampaignRunAgainstContent(run, content) {
    let captured;
    try {
        captured = decodeCampaignRun(run).run;
    }
    catch {
        return Object.freeze({ ok: false, code: "invalid_run", run });
    }
    return validateCapturedCampaignRunAgainstContent(captured, content);
}
/** Return binary-sorted entries or direct successors; it never evaluates merchant/event gameplay. */
export function getAvailableCampaignNodeIds(run, content) {
    let captured;
    try {
        captured = decodeCampaignRun(run).run;
    }
    catch {
        return Object.freeze([]);
    }
    const validation = validateCapturedCampaignRunAgainstContent(captured, content);
    if (!validation.ok)
        return Object.freeze([]);
    return availableCampaignNodeIds(captured, validation.campaign);
}
/** Atomically apply a graph-available battle result to separate immutable run and profile documents. */
export function recordCampaignBattleVictory(run, profile, content, nodeId, earnedStars) {
    let captured;
    try {
        captured = decodeCampaignRun(run).run;
    }
    catch {
        return Object.freeze({
            ok: false,
            code: "invalid_run",
            run,
            profile
        });
    }
    const fail = (code) => Object.freeze({
        ok: false,
        code,
        run: captured,
        profile
    });
    const validation = validateCapturedCampaignRunAgainstContent(captured, content);
    if (!validation.ok)
        return fail(validation.code);
    if (!availableCampaignNodeIds(captured, validation.campaign).includes(nodeId))
        return fail("node_not_available");
    const node = validation.campaign.nodes.find((candidate) => candidate.id === nodeId);
    if (!isBattleNode(node))
        return fail("node_type_not_implemented");
    let profileResult;
    try {
        profileResult = recordPlayerMissionClear(profile, content, node.missionId, earnedStars);
    }
    catch {
        return fail("invalid_profile");
    }
    if (!profileResult.ok)
        return fail(profileResult.code);
    const nextRun = advanceCapturedCampaignRun(captured, nodeId);
    const newlyAvailableNodeIds = availableCampaignNodeIds(nextRun, validation.campaign);
    return Object.freeze({
        ok: true,
        code: "campaign_battle_recorded",
        nodeId,
        run: nextRun,
        profile: profileResult.profile,
        newlyAvailableNodeIds
    });
}
