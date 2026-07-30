import { dispatchGameCommand } from "./commands.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { createGridTopology } from "./topology.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
export const PERSONA_QA_PERSONA_IDS = Object.freeze([
    "aggressive_rush",
    "greedy_economy",
    "turtle_shield"
]);
export const PERSONA_QA_LIMITS = Object.freeze({
    missionIds: 32,
    seeds: 64,
    personaIds: PERSONA_QA_PERSONA_IDS.length,
    totalRuns: 1_024,
    totalTicks: 2_000_000,
    simSeconds: 3_600,
    minimumTickStep: 0.05,
    maximumTickStep: 0.2,
    dimensionValueUtf8Bytes: 256,
    mapCells: 65_536,
    buildPassesPerDecision: 80,
    upgradesPerTowerPerDecision: 4
});
function compareBinary(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function ownDataFields(value, label) {
    try {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
            throw new Error(`${label} must be a plain data object.`);
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new Error(`${label} must be a plain data object.`);
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.getOwnPropertySymbols(descriptors).length > 0) {
            throw new Error(`${label} rejects symbol fields.`);
        }
        const fields = new Map();
        for (const key of Object.keys(descriptors)) {
            const descriptor = descriptors[key];
            if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
                throw new Error(`${label} requires enumerable own data fields.`);
            }
            fields.set(key, descriptor.value);
        }
        return fields;
    }
    catch (error) {
        if (error instanceof Error && error.message.startsWith(label))
            throw error;
        throw new Error(`${label} must be readable plain own data.`);
    }
}
function requireClosedFields(fields, expected, label) {
    if (fields.size !== expected.length || expected.some((key) => !fields.has(key))) {
        throw new Error(`${label} must contain exactly: ${expected.join(", ")}.`);
    }
}
function utf8Bytes(value) {
    return new TextEncoder().encode(value).length;
}
function normalizeStringList(value, label, limit, allowed) {
    try {
        if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
            || value.length < 1 || value.length > limit) {
            throw new Error(`${label} must contain 1..${limit} strings.`);
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.getOwnPropertySymbols(descriptors).length > 0
            || Object.keys(descriptors).some((key) => key !== "length" && !/^(0|[1-9]\d*)$/.test(key))
            || Object.keys(descriptors).filter((key) => key !== "length").length !== value.length) {
            throw new Error(`${label} must be a dense plain array.`);
        }
        const normalized = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
                throw new Error(`${label} must contain own data entries.`);
            }
            const entry = descriptor.value;
            if (typeof entry !== "string" || entry.length === 0 || entry !== entry.trim()
                || /[\u0000-\u001f\u007f]/.test(entry)
                || utf8Bytes(entry) > PERSONA_QA_LIMITS.dimensionValueUtf8Bytes) {
                throw new Error(`${label} entries must be bounded non-empty strings without control characters.`);
            }
            if (allowed && !allowed.has(entry)) {
                throw new Error(`Unknown or unsupported persona "${entry}".`);
            }
            normalized.push(entry);
        }
        if (new Set(normalized).size !== normalized.length) {
            throw new Error(`${label} entries must be unique.`);
        }
        normalized.sort(compareBinary);
        return Object.freeze(normalized);
    }
    catch (error) {
        if (error instanceof Error && (error.message.startsWith(label)
            || /persona/i.test(error.message)))
            throw error;
        throw new Error(`${label} must be a readable dense plain array.`);
    }
}
function normalizePositiveNumber(value, label, minimum, maximum) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`Persona QA ${label} must be within ${minimum}..${maximum}.`);
    }
    return Object.is(value, -0) ? 0 : value;
}
function normalizeRequest(input) {
    const fields = ownDataFields(input, "Persona QA request");
    requireClosedFields(fields, [
        "schemaVersion",
        "missionIds",
        "seeds",
        "personaIds",
        "simSeconds",
        "tickStep"
    ], "Persona QA request");
    if (fields.get("schemaVersion") !== 1) {
        throw new Error(`Unsupported Persona QA request schema version "${String(fields.get("schemaVersion"))}".`);
    }
    const missionIds = normalizeStringList(fields.get("missionIds"), "Persona QA missionIds", PERSONA_QA_LIMITS.missionIds);
    const seeds = normalizeStringList(fields.get("seeds"), "Persona QA seeds", PERSONA_QA_LIMITS.seeds);
    const personaIds = normalizeStringList(fields.get("personaIds"), "Persona QA personaIds", PERSONA_QA_LIMITS.personaIds, new Set(PERSONA_QA_PERSONA_IDS));
    const simSeconds = normalizePositiveNumber(fields.get("simSeconds"), "simSeconds", 0.05, PERSONA_QA_LIMITS.simSeconds);
    const tickStep = normalizePositiveNumber(fields.get("tickStep"), "tickStep", PERSONA_QA_LIMITS.minimumTickStep, PERSONA_QA_LIMITS.maximumTickStep);
    if (missionIds.length * seeds.length * personaIds.length > PERSONA_QA_LIMITS.totalRuns) {
        throw new Error(`Persona QA matrix exceeds the ${PERSONA_QA_LIMITS.totalRuns}-run budget.`);
    }
    const runCount = missionIds.length * seeds.length * personaIds.length;
    if (Math.ceil(simSeconds / tickStep) * runCount > PERSONA_QA_LIMITS.totalTicks) {
        throw new Error(`Persona QA matrix exceeds the ${PERSONA_QA_LIMITS.totalTicks}-tick budget.`);
    }
    return Object.freeze({ schemaVersion: 1, missionIds, seeds, personaIds, simSeconds, tickStep });
}
function canonicalRegistry(content) {
    const towers = Object.fromEntries(Object.entries(content.towers).sort(([left], [right]) => compareBinary(left, right)));
    const missions = Object.fromEntries(Object.entries(content.missions)
        .sort(([left], [right]) => compareBinary(left, right))
        .map(([id, mission]) => [id, {
            ...mission,
            buildTowerIds: [...mission.buildTowerIds].sort(compareBinary)
        }]));
    return { ...content, towers, missions };
}
function towerCost(type) {
    return Object.values(type.cost).reduce((sum, amount) => sum + (amount ?? 0), 0);
}
function attackPower(type) {
    const attack = type.attack;
    switch (attack.kind) {
        case "single": return attack.fireRate * attack.damagePerStack * Math.max(1, attack.startingStacks);
        case "pulse": return attack.pulseRate * (attack.pulseDamage + attack.dotDamagePerUnit * attack.dotDuration);
        case "sniper": return attack.damage / Math.max(attack.interval, 0.000_001);
        case "antiair": return attack.fireRate * attack.damage * Math.max(...attack.maxTargetsByLevel);
        case "splash": return (attack.damage + attack.splashDamage) / Math.max(attack.interval, 0.000_001);
        case "pipeline": {
            const damage = attack.effects.reduce((sum, effect) => effect.kind === "damage" ? sum + effect.amount : sum, 0);
            return damage / Math.max(attack.interval, 0.000_001);
        }
        case "support":
        case "support_buff":
            return 0;
    }
}
function economyYield(type) {
    if (type.attack.kind !== "pipeline")
        return 0;
    return type.attack.effects.reduce((total, effect) => {
        if (effect.kind !== "resource")
            return total;
        return total + Object.values(effect.resources).reduce((sum, amount) => sum + (amount ?? 0), 0);
    }, 0);
}
function rankTowerIds(content, missionId, personaId) {
    const mission = content.missions[missionId];
    const ids = [...new Set(mission.buildTowerIds.filter((id) => content.towers[id]))];
    return Object.freeze(ids.sort((leftId, rightId) => {
        const left = content.towers[leftId];
        const right = content.towers[rightId];
        if (personaId === "greedy_economy") {
            return economyYield(right) - economyYield(left)
                || towerCost(left) - towerCost(right)
                || compareBinary(leftId, rightId);
        }
        if (personaId === "turtle_shield") {
            const leftDurability = (left.maxHp ?? 0) + (left.attack.kind.startsWith("support") ? 1_000 : 0);
            const rightDurability = (right.maxHp ?? 0) + (right.attack.kind.startsWith("support") ? 1_000 : 0);
            return rightDurability - leftDurability
                || towerCost(left) - towerCost(right)
                || compareBinary(leftId, rightId);
        }
        const leftEfficiency = attackPower(left) / Math.max(1, towerCost(left));
        const rightEfficiency = attackPower(right) / Math.max(1, towerCost(right));
        return rightEfficiency - leftEfficiency
            || towerCost(left) - towerCost(right)
            || compareBinary(leftId, rightId);
    }));
}
function placementComparator(snapshot, personaId) {
    const distance = createGridTopology(snapshot.grid).distance;
    const distanceToPath = (coord) => snapshot.pathCenterline.reduce((best, point) => Math.min(best, distance(coord, point)), Number.POSITIVE_INFINITY);
    const tie = (left, right) => left.r - right.r || left.q - right.q;
    if (personaId === "turtle_shield") {
        return (left, right) => distance(left, snapshot.coreCoord) - distance(right, snapshot.coreCoord) || tie(left, right);
    }
    if (personaId === "greedy_economy") {
        return (left, right) => distanceToPath(right) - distanceToPath(left) || tie(left, right);
    }
    return (left, right) => distanceToPath(left) - distanceToPath(right) || tie(left, right);
}
function command(controller, input) {
    return controller.dispatch(input);
}
function buildForPersona(controller, towerIds, personaId) {
    let accepted = 0;
    for (let pass = 0; pass < PERSONA_QA_LIMITS.buildPassesPerDecision; pass += 1) {
        let built = false;
        const snapshot = controller.game.getSnapshot();
        if (snapshot.outcome !== "playing")
            break;
        const tiles = snapshot.tiles
            .filter((tile) => tile.terrain === "buildable" && !tile.occupiedBy)
            .sort(placementComparator(snapshot, personaId));
        for (const towerTypeId of towerIds) {
            for (const tile of tiles) {
                if (command(controller, {
                    schemaVersion: 6,
                    type: "placeTower",
                    towerTypeId,
                    coord: { q: tile.q, r: tile.r }
                })) {
                    accepted += 1;
                    built = true;
                    break;
                }
            }
        }
        if (!built)
            break;
    }
    if (personaId !== "aggressive_rush") {
        const towerIdsToUpgrade = controller.game.getSnapshot().towers.map((tower) => tower.id).sort(compareBinary);
        for (const towerId of towerIdsToUpgrade) {
            for (let attempt = 0; attempt < PERSONA_QA_LIMITS.upgradesPerTowerPerDecision; attempt += 1) {
                if (!command(controller, { schemaVersion: 6, type: "upgradeTower", towerId }))
                    break;
                accepted += 1;
            }
        }
    }
    return accepted;
}
function executePersona(content, missionId, seed, personaId, simSeconds, tickStep, journaled = false) {
    const game = new TowerDefenseGame({ content, missionId, seed });
    const journalSession = journaled ? new JournaledGameSession(game) : undefined;
    const controller = {
        game,
        dispatch: journalSession
            ? (input) => journalSession.dispatch(input).ok
            : (input) => dispatchGameCommand(game, input).ok
    };
    const towerIds = rankTowerIds(content, missionId, personaId);
    let acceptedCommandCount = buildForPersona(controller, towerIds, personaId);
    if (command(controller, { schemaVersion: 6, type: "startWave" }))
        acceptedCommandCount += 1;
    let elapsed = 0;
    let nextBuildAt = personaId === "aggressive_rush" ? 0.5 : personaId === "greedy_economy" ? 1 : 2;
    while (elapsed < simSeconds && game.getSnapshot().outcome === "playing") {
        const units = Math.min(tickStep, simSeconds - elapsed);
        if (command(controller, { schemaVersion: 6, type: "tick", units }))
            acceptedCommandCount += 1;
        elapsed += units;
        if (elapsed + Number.EPSILON >= nextBuildAt) {
            acceptedCommandCount += buildForPersona(controller, towerIds, personaId);
            nextBuildAt += personaId === "aggressive_rush" ? 0.5 : personaId === "greedy_economy" ? 1 : 2;
        }
    }
    const snapshot = game.getSnapshot();
    const run = Object.freeze({
        missionId,
        seed,
        personaId,
        outcome: snapshot.outcome,
        stateDigest: game.getStateDigest(),
        coreHpRemaining: snapshot.maxCoreHp > 0 ? Math.max(0, snapshot.coreHp) / snapshot.maxCoreHp : 0,
        towersBuilt: snapshot.towers.length,
        leaks: snapshot.leakCount,
        elapsed: Math.round(elapsed * 1_000_000) / 1_000_000,
        acceptedCommandCount
    });
    return Object.freeze({
        run,
        finalSnapshot: snapshot,
        ...(journalSession ? { journal: journalSession.exportJournal() } : {})
    });
}
function assertSelectedMapBudgets(content, missionIds) {
    for (const missionId of missionIds) {
        const mission = content.missions[missionId];
        if (!mission)
            throw new Error(`Unknown Persona QA mission "${missionId}".`);
        const map = content.maps[mission.mapId];
        if (!map || !Number.isSafeInteger(map.width) || !Number.isSafeInteger(map.height)
            || map.width <= 0 || map.height <= 0
            || map.width > Math.floor(PERSONA_QA_LIMITS.mapCells / map.height)) {
            throw new Error(`Persona QA map cell budget exceeded for mission "${missionId}"; maximum is ${PERSONA_QA_LIMITS.mapCells}.`);
        }
    }
}
/**
 * Run the fixed R10 player-persona matrix in the pure engine.
 *
 * The input is validated and detached before any simulation starts. Ordering of authored tower
 * records, mission build lists, and request dimensions cannot influence a report.
 */
export function runPersonaQaSuiteV1(content, input) {
    const request = normalizeRequest(input);
    for (const missionId of request.missionIds) {
        if (!content.missions[missionId])
            throw new Error(`Unknown Persona QA mission "${missionId}".`);
    }
    assertSelectedMapBudgets(content, request.missionIds);
    const canonicalContent = canonicalRegistry(content);
    const runs = [];
    for (const missionId of request.missionIds) {
        for (const seed of request.seeds) {
            for (const personaId of request.personaIds) {
                runs.push(executePersona(canonicalContent, missionId, seed, personaId, request.simSeconds, request.tickStep).run);
            }
        }
    }
    return Object.freeze({
        schemaVersion: 1,
        status: "completed",
        missionIds: request.missionIds,
        seeds: request.seeds,
        personaIds: request.personaIds,
        runs: Object.freeze(runs)
    });
}
/**
 * Produce an audit proof for one fixed persona case without changing the compact batch report.
 * The exact policy command stream is recorded once and replayed by the canonical journal runtime.
 */
export function provePersonaQaReplayV1(content, input) {
    const request = normalizeRequest(input);
    if (request.missionIds.length !== 1 || request.seeds.length !== 1 || request.personaIds.length !== 1) {
        throw new Error("Persona QA replay proof requires exactly one mission, seed, and persona.");
    }
    assertSelectedMapBudgets(content, request.missionIds);
    const canonicalContent = canonicalRegistry(content);
    const executed = executePersona(canonicalContent, request.missionIds[0], request.seeds[0], request.personaIds[0], request.simSeconds, request.tickStep, true);
    const journal = executed.journal;
    const replay = replayGameCommandJournal({ content: canonicalContent, journal });
    const proof = {
        run: executed.run,
        journalEntryCount: journal.entries.length,
        continuousStateDigest: executed.run.stateDigest,
        replayStateDigest: replay.stateDigest,
        snapshotEquivalent: JSON.stringify(executed.finalSnapshot) === JSON.stringify(replay.game.getSnapshot())
    };
    return Object.freeze(proof);
}
