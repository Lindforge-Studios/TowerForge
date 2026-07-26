import { MARK_LIMITS, REACTION_LIMITS } from "../content/mechanics.js";
import { resolveActiveCombatMechanics, resolveEnemyArmorMatrix } from "../content/combat-mechanics.js";
import { resolveActiveReactionsMechanics } from "../content/reaction-mechanics.js";
import { NAVIGATION_LIMITS, resolveActiveNavigationMechanics } from "../content/navigation-mechanics.js";
import { LINE_OF_SIGHT_LIMITS, resolveActiveElevationMechanics, resolveActiveHighGroundMechanics, resolveActiveLineOfSightMechanics } from "../content/elevation-mechanics.js";
import { PHYSICS_LIMITS, inspectOwnDataEffect, parseDisplacementEffectV1, resolveActivePhysicsMechanics } from "../content/physics-mechanics.js";
import { TERRAFORMING_LIMITS, resolveActiveTerraformingMechanics } from "../content/terraforming-mechanics.js";
import { ROGUELITE_ARTIFACT_INVENTORY_LIMIT, ROGUELITE_DAMAGE_MODIFIER_RESERVE, ROGUELITE_DRAFT_LIMITS, deriveRogueliteSynergyStateV1, rogueliteSynergyWorstCaseModifierCount, resolveActiveRogueliteMechanics } from "../content/roguelite-mechanics.js";
import { activeHeroAuraModifierReserve, heroPassiveAuraModifierIdV6, heroSkillModifierIdV5, resolveActiveHeroesMechanics } from "../content/heroes-mechanics.js";
import { CAMPAIGN_RUN_LIMITS } from "../run/campaign-run.js";
import { campaignBattleWorstCaseModifierCount, preflightHeroAuraDamageFinite } from "../run/campaign-battle-policy.js";
import { evaluateTowerScriptExpression } from "../scripting/expression.js";
import { TOWER_SCRIPT_EVENTS, TOWER_SCRIPT_EVENT_FIELDS, TOWER_SCRIPT_LIMITS } from "../scripting/schema-descriptor.js";
import { coordKey } from "./hex.js";
import { GridMap } from "./map.js";
import { computeHighGroundPairModifiers } from "./high-ground.js";
import { NavigationResolver } from "./navigation-runtime.js";
import { NavigationFieldLookupCache } from "./navigation-movement.js";
import { buildNavigationField } from "./navigation-field.js";
import { planDynamicTerraformingNavigation } from "./terraforming-navigation.js";
import { collectDynamicTerraformingSpawnProvenance } from "./navigation-reachability.js";
import { DynamicTerraformingSafetyBudgetError } from "./terraforming-navigation-budget.js";
import { prepareDynamicTerraformingSafetySet } from "./terraforming-navigation-safety.js";
import { advanceTerraformExpiryGroups, buildTerraformingSnapshot, countTerraformExpiryOwnership, terraformExpiryTargetKey } from "./terraforming-expiry.js";
import { normalizeNavigationAnalysisRequestV1 } from "./navigation-analysis.js";
import { analyzeLineOfSightTargets, normalizeLineOfSightAnalysisRequestV1, traceLineOfSight } from "./line-of-sight.js";
import { DamageResolver } from "./damage.js";
import { MAX_MODIFIERS_PER_RESOLUTION } from "./modifiers.js";
import { GAME_CHECKPOINT_SCHEMA_VERSION, SIMULATION_ENGINE_VERSION, checkpointDataField, checkpointObjectDescriptors, cloneCheckpointJson, computeCheckpointStateDigest, inspectCheckpointEnvelope, requireExactCheckpointKeys } from "./checkpoint.js";
import { SeededRng } from "./rng.js";
import { canonicalStringify, getSimulationContentDigest, stableDigest } from "./stable-digest.js";
import { planReactions } from "./reactions.js";
import { TOWER_TARGET_MODES } from "./types.js";
import { createGridTopology, normalizeGridDefinition } from "./topology.js";
import { planTileDisplacement } from "./displacement.js";
function emptyDataRecord() {
    return Object.create(null);
}
function compareBinary(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function sameGridCoord(left, right) {
    return left.q === right.q && left.r === right.r;
}
function cloneExposureStates(source, canonical = false, plain = false) {
    const cloned = plain ? {} : emptyDataRecord();
    const exposureIds = Object.keys(source);
    if (canonical)
        exposureIds.sort();
    for (const exposureId of exposureIds) {
        Object.defineProperty(cloned, exposureId, {
            value: { ...source[exposureId] },
            enumerable: true,
            configurable: true,
            writable: true
        });
    }
    return cloned;
}
function cloneEnemyExposureStates(source, canonical = false, plain = false) {
    const cloned = plain ? {} : emptyDataRecord();
    const enemyIds = Object.keys(source);
    if (canonical)
        enemyIds.sort();
    for (const enemyId of enemyIds) {
        Object.defineProperty(cloned, enemyId, {
            value: cloneExposureStates(source[enemyId], canonical, plain),
            enumerable: true,
            configurable: true,
            writable: true
        });
    }
    return cloned;
}
const INVALID_SHIELD_RESTORE_MESSAGE = "TowerScript action is invalid for the current shield target.";
const EMPTY_FROZEN_ARRAY = Object.freeze([]);
class TowerScriptInvalidActionError extends Error {
    constructor(message = INVALID_SHIELD_RESTORE_MESSAGE) {
        super(message);
        this.name = "TowerScriptInvalidActionError";
    }
}
class TowerScriptTerraformingError extends Error {
    code;
    reasonKey;
    constructor(code, reasonKey, message) {
        super(message);
        this.code = code;
        this.reasonKey = reasonKey;
        this.name = "TowerScriptTerraformingError";
    }
}
const NATIVE_MAP_PROTOTYPE = Map.prototype;
const NATIVE_MAP_GET = Map.prototype.get;
const NATIVE_MAP_SET = Map.prototype.set;
const NATIVE_MAP_HAS = Map.prototype.has;
const NATIVE_MAP_ENTRIES = Map.prototype.entries;
const NATIVE_MAP_SIZE_GETTER = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;
const NATIVE_MAP_ITERATOR_PROTOTYPE = Object.getPrototypeOf(Reflect.apply(NATIVE_MAP_ENTRIES, new Map(), []));
const NATIVE_MAP_ITERATOR_NEXT = Object.getOwnPropertyDescriptor(NATIVE_MAP_ITERATOR_PROTOTYPE, "next")?.value;
const NATIVE_MAP_INTRINSIC_KEYS = Object.freeze([
    "get", "set", "has", "delete", "clear", "entries", "values", "size", Symbol.iterator
]);
function snapshotPropertyDescriptor(key, descriptor) {
    return Object.freeze("value" in descriptor
        ? {
            key,
            configurable: Boolean(descriptor.configurable),
            enumerable: Boolean(descriptor.enumerable),
            writable: Boolean(descriptor.writable),
            value: descriptor.value
        }
        : {
            key,
            configurable: Boolean(descriptor.configurable),
            enumerable: Boolean(descriptor.enumerable),
            get: descriptor.get,
            set: descriptor.set
        });
}
function capturePropertyDescriptorShape(value) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Object.freeze(Reflect.ownKeys(descriptors).map((key) => snapshotPropertyDescriptor(key, descriptors[key])));
}
const PINNED_GRID_MAP_PROTOTYPE = GridMap.prototype;
const PINNED_GRID_MAP_PROTOTYPE_SHAPE = capturePropertyDescriptorShape(PINNED_GRID_MAP_PROTOTYPE);
const PINNED_GRID_MAP_OWN_KEYS = Object.freeze([
    "id", "width", "height", "grid", "topology", "tiles", "pathCenterline", "pathRoutes",
    "spawnCoord", "coreCoord", "definition", "baseTerrainByCoord"
]);
const NATIVE_MAP_INTRINSIC_SHAPE = Object.freeze(NATIVE_MAP_INTRINSIC_KEYS.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(NATIVE_MAP_PROTOTYPE, key);
    if (!descriptor)
        throw new Error(`Missing native Map intrinsic ${String(key)}.`);
    return snapshotPropertyDescriptor(key, descriptor);
}));
function descriptorMatchesSnapshot(actual, expected) {
    if (!actual)
        return false;
    if (Boolean(actual.configurable) !== expected.configurable
        || Boolean(actual.enumerable) !== expected.enumerable)
        return false;
    if ("value" in actual) {
        return Object.prototype.hasOwnProperty.call(expected, "value")
            && Boolean(actual.writable) === expected.writable
            && actual.value === expected.value;
    }
    return !Object.prototype.hasOwnProperty.call(expected, "value")
        && actual.get === expected.get
        && actual.set === expected.set;
}
function assertPinnedNativeMapIntrinsics() {
    if (Map.prototype !== NATIVE_MAP_PROTOTYPE) {
        throw new Error("Derived map integrity rejected a changed native Map prototype.");
    }
    for (const expected of NATIVE_MAP_INTRINSIC_SHAPE) {
        if (!descriptorMatchesSnapshot(Object.getOwnPropertyDescriptor(NATIVE_MAP_PROTOTYPE, expected.key), expected)) {
            throw new Error(`Derived map integrity rejected changed Map intrinsic ${String(expected.key)}.`);
        }
    }
    const nextDescriptor = Object.getOwnPropertyDescriptor(NATIVE_MAP_ITERATOR_PROTOTYPE, "next");
    if (!nextDescriptor || nextDescriptor.value !== NATIVE_MAP_ITERATOR_NEXT) {
        throw new Error("Derived map integrity rejected a changed Map iterator intrinsic.");
    }
}
function assertPinnedGridMapSurface(map) {
    if (Object.getPrototypeOf(map) !== PINNED_GRID_MAP_PROTOTYPE) {
        throw new Error("Derived map integrity rejected a changed GridMap prototype identity.");
    }
    const prototypeDescriptors = Object.getOwnPropertyDescriptors(PINNED_GRID_MAP_PROTOTYPE);
    if (Reflect.ownKeys(prototypeDescriptors).length !== PINNED_GRID_MAP_PROTOTYPE_SHAPE.length
        || PINNED_GRID_MAP_PROTOTYPE_SHAPE.some((expected) => (!descriptorMatchesSnapshot(prototypeDescriptors[expected.key], expected)))) {
        throw new Error("Derived map integrity rejected changed GridMap prototype methods.");
    }
    const ownDescriptors = Object.getOwnPropertyDescriptors(map);
    const ownKeys = Reflect.ownKeys(ownDescriptors);
    if (ownKeys.length !== PINNED_GRID_MAP_OWN_KEYS.length
        || ownKeys.some((key) => typeof key !== "string" || !PINNED_GRID_MAP_OWN_KEYS.includes(key))) {
        throw new Error("Derived map integrity rejected a GridMap own method shadow or accessor.");
    }
    for (const key of PINNED_GRID_MAP_OWN_KEYS) {
        const descriptor = ownDescriptors[key];
        if (!descriptor
            || !("value" in descriptor)
            || !descriptor.enumerable
            || !descriptor.configurable
            || !descriptor.writable) {
            throw new Error(`Derived map integrity rejected GridMap own descriptor ${key}.`);
        }
    }
}
const SCRIPT_GAME_EVENT_NAMES = new Set([
    "towerPlaced", "towerSold", "towerMoved", "towerUpgraded", "towerDestroyed", "towerTargetModeChanged",
    "towerFired", "towerResourcesGranted", "towerShieldChanged", "enemyHit", "enemyShieldChanged", "enemyMarkChanged", "enemyKilled", "enemyLeaked", "enemySpawnedOnDeath",
    "enemyExposureChanged", "enemyReactionTriggered",
    "enemyPhaseSpawned", "waveStarted", "waveCleared", "resourcesGranted", "abilityUsed", "objectiveCompleted",
    "enemyEnteredTile", "terrainChanged", "elevationChanged", "objectiveFailed", "starEarned", "victory", "defeat"
]);
function artifactLootSeed(seed, missionId) {
    const seedType = typeof seed === "string" ? "s" : "n";
    const seedPayload = String(seed);
    return `towerforge:artifact-loot:v1|${seedType}:${seedPayload.length}:${seedPayload}|m:${missionId.length}:${missionId}`;
}
function waveDraftSeed(initialRngState, missionId) {
    const seedPayload = canonicalStringify(initialRngState);
    return `towerforge:wave-draft:v1|r:${seedPayload.length}:${seedPayload}|m:${missionId.length}:${missionId}`;
}
function sampleDraftOfferCardIds(draft, poolId, rng) {
    const pool = draft.pools[poolId];
    if (!pool || pool.entries.length < ROGUELITE_DRAFT_LIMITS.offerSize) {
        throw new Error("Draft offer pool is unavailable or too small.");
    }
    const remaining = pool.entries.map((entry) => ({ ...entry }));
    const selected = [];
    while (selected.length < ROGUELITE_DRAFT_LIMITS.offerSize) {
        const totalWeight = remaining.reduce((sum, entry) => sum + entry.weight, 0);
        let cursor = rng.nextInt(totalWeight);
        let selectedIndex = 0;
        for (let index = 0; index < remaining.length; index += 1) {
            const entry = remaining[index];
            if (cursor < entry.weight) {
                selectedIndex = index;
                break;
            }
            cursor -= entry.weight;
        }
        const [entry] = remaining.splice(selectedIndex, 1);
        if (!entry || !draft.definitions[entry.cardId]) {
            throw new Error("Active draft pool references an unavailable card.");
        }
        selected.push(entry.cardId);
    }
    return Object.freeze(selected);
}
function normalizeCampaignBattleLoadout(value, active, content, missionId) {
    if (active?.schemaVersion !== 4 || active.campaign?.schemaVersion !== 2) {
        throw new Error("Campaign battle handoff is inactive for this mission.");
    }
    const root = checkpointObjectDescriptors(value, "Campaign battle loadout");
    requireExactCheckpointKeys(root, ["schemaVersion", "launchId", "nodeId", "maxNewArtifactInstances", "deck", "artifacts"], "Campaign battle loadout");
    if (checkpointDataField(root, "schemaVersion", "Campaign battle loadout") !== 1) {
        throw new Error("Campaign battle loadout schema version is unsupported.");
    }
    const launchId = checkpointDataField(root, "launchId", "Campaign battle loadout");
    const nodeId = checkpointDataField(root, "nodeId", "Campaign battle loadout");
    const maxNewArtifactInstances = checkpointDataField(root, "maxNewArtifactInstances", "Campaign battle loadout");
    if (typeof launchId !== "string"
        || !/^[0-9a-f]{16}$/.test(launchId)
        || typeof nodeId !== "string"
        || nodeId.length === 0
        || nodeId.length > CAMPAIGN_RUN_LIMITS.identifierCodeUnits) {
        throw new Error("Campaign battle loadout identity is invalid.");
    }
    if (typeof maxNewArtifactInstances !== "number"
        || !Number.isSafeInteger(maxNewArtifactInstances)
        || maxNewArtifactInstances < 0
        || maxNewArtifactInstances > ROGUELITE_ARTIFACT_INVENTORY_LIMIT)
        throw new Error("Campaign battle artifact acquisition limit is invalid.");
    const normalizeEntries = (input, field, definitions) => {
        if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
            throw new Error("Campaign battle loadout collections must be plain arrays.");
        }
        const seen = new Set();
        return Object.freeze(input.map((entry, index) => {
            const descriptors = checkpointObjectDescriptors(entry, `Campaign battle ${field} entry`);
            requireExactCheckpointKeys(descriptors, ["instanceId", field], `Campaign battle ${field} entry`);
            const instanceId = checkpointDataField(descriptors, "instanceId", `Campaign battle ${field} entry`);
            const definitionId = checkpointDataField(descriptors, field, `Campaign battle ${field} entry`);
            if (typeof instanceId !== "string"
                || instanceId.length === 0
                || instanceId.length > 256
                || seen.has(instanceId)
                || typeof definitionId !== "string"
                || !definitions
                || !Object.prototype.hasOwnProperty.call(definitions, definitionId))
                throw new Error(`Campaign battle ${field} entry ${index} is invalid.`);
            seen.add(instanceId);
            return Object.freeze({ instanceId, [field]: definitionId });
        }));
    };
    const deck = normalizeEntries(checkpointDataField(root, "deck", "Campaign battle loadout"), "cardId", active.draft?.definitions);
    const artifacts = normalizeEntries(checkpointDataField(root, "artifacts", "Campaign battle loadout"), "artifactId", active.artifacts?.definitions);
    if (deck.length + artifacts.length > CAMPAIGN_RUN_LIMITS.collectionEntries) {
        throw new Error("Campaign battle loadout exceeds the aggregate CampaignRun collection limit.");
    }
    if (campaignBattleWorstCaseModifierCount(deck, content, missionId) > MAX_MODIFIERS_PER_RESOLUTION) {
        throw new Error("Campaign battle loadout exceeds the shared modifier budget.");
    }
    const numericPreflight = preflightHeroAuraDamageFinite(content, missionId, { deck });
    if (!numericPreflight.ok)
        throw new Error(numericPreflight.message);
    return Object.freeze({ schemaVersion: 1, launchId, nodeId, maxNewArtifactInstances, deck, artifacts });
}
export class TowerDefenseGame {
    content;
    mission;
    map;
    coreHp;
    resources;
    waveIndex = 0;
    startedWaveCount = 0;
    waveState = "ready";
    prepRemaining = 0;
    outcome = "playing";
    enemies = [];
    towers = [];
    lastEvents = [];
    currencies;
    difficulty;
    currencyIds;
    metaUpgradeLevels;
    maxCoreHp;
    towerDamageMultiplier;
    towerFireRateMetaMultiplier;
    activeCombatMechanics;
    activeReactionsMechanics;
    activeNavigationProfile;
    activeNavigationProfileId;
    activeElevation;
    activeLineOfSightProfile;
    activeHighGroundProfile;
    activePhysicsMechanics;
    activeTerraformingMechanics;
    activeRogueliteMechanics;
    activeHeroesMechanics;
    activeHeroPassiveAura;
    heroesSnapshotV1;
    heroStateV2;
    heroMovementField;
    heroMovementLookupCache = new NavigationFieldLookupCache();
    heroMovementDirty = false;
    rogueliteSnapshot;
    rogueliteDamageModifiers = Object.freeze([]);
    artifactDamageModifiersByTowerId = new Map();
    artifactInitialRngState;
    artifactRng;
    artifactInventory = [];
    nextArtifactInstanceSequence = 1;
    /** Preserve historic artifact checkpoint v1 until a socket assignment first changes. */
    artifactCheckpointForm = 0;
    draftInitialRngState;
    draftRng;
    nextDraftOfferSequence = 1;
    pendingDraftOffer = null;
    draftSelections = [];
    campaignBattle;
    campaignDeck = Object.freeze([]);
    navigationMandatoryPairs;
    navigationKnownPairs;
    navigationResolver;
    navigationFieldLookupCache;
    navigationEnemyFields;
    combatShieldDefinitions;
    enemyShields = {};
    towerShields = {};
    enemyMarks = {};
    enemyExposures = emptyDataRecord();
    enemyCounter = 0;
    towerCounter = 0;
    clearedWaveCount = 0;
    killCount = 0;
    leakCount = 0;
    killCountByEnemyType = {};
    completedObjectiveIds = new Set();
    earnedStarIds = new Set();
    spawnQueue = [];
    missionElapsed = 0;
    nextWaveStartAt = null;
    abilityCooldowns = {};
    temporaryWaterTiles = [];
    runtimeTerrainOverrides = new Map();
    runtimeElevationOverrides = new Map();
    pendingTerraformExpiryGroups = [];
    nextTerraformExpirySequence = 1;
    /** Preserve the nested checkpoint source form until native timed state is first committed. */
    terraformingCheckpointForm = 0;
    sunlightPathKeys;
    sunlightTilesSnapshot;
    directFlightLine;
    staticTilesSnapshot;
    staticPathCenterlineSnapshot;
    staticPathRoutesSnapshot;
    staticSpawnCoordSnapshot;
    staticCoreCoordSnapshot;
    staticElevationSnapshot;
    derivedMapIntegrityBaseline;
    scriptValues = {};
    scriptDiagnostics = [];
    scriptHandlerLastRun = {};
    scriptEventCursor = 0;
    scriptActionsRemaining = 0;
    scriptTerrainChangesRemaining = 0;
    scriptSignalDepth = 0;
    displacementStepAttemptsThisTick = 0;
    initialRngState;
    rng;
    constructor(options, internal = {}) {
        assertPinnedNativeMapIntrinsics();
        this.content = options.content;
        this.rng = new SeededRng(options.seed ?? 0);
        this.initialRngState = this.rng.exportState();
        // Currencies are content-defined; "coins" is always guaranteed as the primary (first) currency.
        // Dedupe and reorder defensively so the engine is correct even on content built without the loader.
        const declared = this.content.currencies?.length ? this.content.currencies : [{ id: "coins", label: "Coins" }];
        const seen = new Set();
        const ordered = [];
        for (const currency of declared) {
            if (currency && currency.id && !seen.has(currency.id)) {
                seen.add(currency.id);
                ordered.push(currency);
            }
        }
        if (!seen.has("coins"))
            ordered.unshift({ id: "coins", label: "Coins" });
        const coinsIndex = ordered.findIndex((c) => c.id === "coins");
        if (coinsIndex > 0)
            ordered.unshift(ordered.splice(coinsIndex, 1)[0]);
        this.currencies = ordered;
        this.currencyIds = this.currencies.map((c) => c.id);
        const missionId = options.missionId;
        const mission = this.content.missions[missionId];
        if (!mission) {
            throw new Error(`Mission "${missionId}" not found in content registry.`);
        }
        this.mission = mission;
        this.activeCombatMechanics = resolveActiveCombatMechanics(this.content, missionId);
        this.activeReactionsMechanics = resolveActiveReactionsMechanics(this.content, missionId);
        this.combatShieldDefinitions = this.activeCombatMechanics?.shields;
        this.map = this.mission.mapFactory();
        assertPinnedGridMapSurface(this.map);
        this.activeElevation = resolveActiveElevationMechanics(this.content, missionId) !== undefined;
        this.activeLineOfSightProfile = resolveActiveLineOfSightMechanics(this.content, missionId);
        this.activeHighGroundProfile = resolveActiveHighGroundMechanics(this.content, missionId);
        this.activePhysicsMechanics = resolveActivePhysicsMechanics(this.content, missionId);
        this.activeTerraformingMechanics = resolveActiveTerraformingMechanics(this.content, missionId);
        this.activeRogueliteMechanics = resolveActiveRogueliteMechanics(this.content, missionId);
        this.activeHeroesMechanics = resolveActiveHeroesMechanics(this.content, missionId);
        const passiveAuraDefinition = this.activeHeroesMechanics?.schemaVersion === 6
            ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId]
            : undefined;
        const passiveAura = passiveAuraDefinition?.passiveAura ?? undefined;
        this.activeHeroPassiveAura = passiveAura === undefined || passiveAura === null
            ? undefined
            : Object.freeze({
                definitionId: this.activeHeroesMechanics.selectedHeroId,
                aura: passiveAura,
                modifiers: Object.freeze(passiveAura.effects.map((effect, effectIndex) => Object.freeze({
                    id: heroPassiveAuraModifierIdV6(this.activeHeroesMechanics.selectedHeroId, passiveAura.id, effectIndex),
                    target: effect.modifier.target,
                    stage: "spatial",
                    operation: effect.modifier.operation,
                    value: effect.modifier.value
                })))
            });
        if (activeHeroAuraModifierReserve(this.content, missionId) > 0) {
            if (campaignBattleWorstCaseModifierCount([], this.content, missionId) > MAX_MODIFIERS_PER_RESOLUTION) {
                throw new Error("Active mission mechanics exceed the shared modifier budget.");
            }
            const numericPreflight = preflightHeroAuraDamageFinite(this.content, missionId);
            if (!numericPreflight.ok)
                throw new Error(numericPreflight.message);
        }
        if (this.activeHeroesMechanics?.schemaVersion === 1) {
            const definition = this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId];
            const coord = Object.freeze({ q: this.map.coreCoord.q, r: this.map.coreCoord.r });
            this.heroesSnapshotV1 = Object.freeze({
                schemaVersion: 1,
                units: Object.freeze([Object.freeze({
                        id: this.activeHeroesMechanics.selectedHeroId,
                        definitionId: this.activeHeroesMechanics.selectedHeroId,
                        label: definition.label,
                        coord
                    })])
            });
        }
        else {
            this.heroesSnapshotV1 = undefined;
        }
        if (this.activeHeroesMechanics?.schemaVersion === 2
            || this.activeHeroesMechanics?.schemaVersion === 3
            || this.activeHeroesMechanics?.schemaVersion === 4
            || this.activeHeroesMechanics?.schemaVersion === 5
            || this.activeHeroesMechanics?.schemaVersion === 6) {
            const durability = this.activeHeroesMechanics.schemaVersion === 3
                ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId].durability
                : this.activeHeroesMechanics.schemaVersion === 4 || this.activeHeroesMechanics.schemaVersion === 5
                    || this.activeHeroesMechanics.schemaVersion === 6
                    ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId].durability
                    : undefined;
            const mana = this.activeHeroesMechanics.schemaVersion === 4 || this.activeHeroesMechanics.schemaVersion === 5
                || this.activeHeroesMechanics.schemaVersion === 6
                ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId].mana
                : undefined;
            const skillTree = this.activeHeroesMechanics.schemaVersion === 5 || this.activeHeroesMechanics.schemaVersion === 6
                ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId].skillTree
                : null;
            this.heroStateV2 = {
                definitionId: this.activeHeroesMechanics.selectedHeroId,
                currentCoord: { q: this.map.coreCoord.q, r: this.map.coreCoord.r },
                targetCoord: null,
                nextCoord: null,
                edgeProgress: 0,
                ...(durability === undefined ? {} : {
                    hp: durability.maxHp,
                    shieldCurrent: durability.shield?.capacity ?? 0
                }),
                ...(mana === undefined ? {} : { mana: mana.starting, abilityCooldownRemaining: 0 }),
                ...(skillTree === null ? {} : {
                    skillPoints: skillTree.points.starting,
                    unlockedSkillIds: new Set()
                })
            };
        }
        if (options.campaignBattle !== undefined) {
            this.campaignBattle = normalizeCampaignBattleLoadout(options.campaignBattle, this.activeRogueliteMechanics, this.content, missionId);
            this.campaignDeck = this.campaignBattle.deck;
        }
        if (this.activeRogueliteMechanics?.artifacts) {
            this.artifactRng = new SeededRng(artifactLootSeed(options.seed ?? 0, missionId));
            this.artifactInitialRngState = this.artifactRng.exportState();
            this.artifactCheckpointForm = this.campaignBattle ? 3 : 1;
            this.artifactInventory = this.campaignBattle
                ? this.campaignBattle.artifacts.map((entry) => ({ ...entry, socket: null }))
                : [];
            this.nextArtifactInstanceSequence = this.artifactInventory.length + 1;
        }
        if (this.activeRogueliteMechanics?.draft) {
            this.draftRng = new SeededRng(waveDraftSeed(this.initialRngState, missionId));
            this.draftInitialRngState = this.draftRng.exportState();
        }
        this.rebuildRogueliteSynergies();
        this.terraformingCheckpointForm = this.activeTerraformingMechanics ? 2 : 0;
        this.map.useRuntimeElevationOverrides(this.runtimeElevationOverrides);
        const selectedNavigation = resolveActiveNavigationMechanics(this.content, missionId);
        if (selectedNavigation?.mode === "dynamic_flow") {
            this.activeNavigationProfileId = selectedNavigation.profileId;
            this.activeNavigationProfile = Object.freeze({
                mode: "dynamic_flow",
                defaultMovementProfileId: selectedNavigation.defaultMovementProfileId,
                movementProfiles: selectedNavigation.movementProfiles,
                ...(selectedNavigation.enemyMovementProfiles === undefined
                    ? {}
                    : { enemyMovementProfiles: selectedNavigation.enemyMovementProfiles })
            });
            this.navigationKnownPairs = this.buildNavigationWavePairs(this.activeNavigationProfile);
            this.navigationMandatoryPairs = this.buildNavigationMandatoryPairs(this.activeNavigationProfile);
            this.navigationResolver = this.createNavigationResolver([]);
            this.navigationFieldLookupCache = new NavigationFieldLookupCache();
            this.navigationEnemyFields = new Map();
        }
        else {
            this.activeNavigationProfileId = undefined;
            this.activeNavigationProfile = undefined;
            this.navigationKnownPairs = Object.freeze([]);
            this.navigationMandatoryPairs = Object.freeze([]);
            this.navigationResolver = undefined;
            this.navigationFieldLookupCache = undefined;
            this.navigationEnemyFields = undefined;
        }
        this.difficulty = this.content.difficulties.find((item) => item.id === options.difficultyId)
            ?? this.content.difficulties.find((item) => item.id === this.content.defaultDifficultyId)
            ?? { id: "normal", label: "Normal" };
        this.metaUpgradeLevels = this.normalizeMetaUpgradeLevels(options.metaUpgradeLevels ?? {});
        this.towerDamageMultiplier = Math.max(0, 1 + this.metaEffectTotal("towerDamage", "multiplierPerLevel"));
        this.towerFireRateMetaMultiplier = Math.max(0.05, 1 + this.metaEffectTotal("towerFireRate", "multiplierPerLevel"));
        this.directFlightLine = this.map.line(this.map.spawnCoord, this.map.coreCoord);
        const sunlight = this.buildSunlightTilesSnapshot();
        this.sunlightPathKeys = new Set(sunlight.map((tile) => this.routePathKey(tile.routeId, tile.pathOrder)));
        this.sunlightTilesSnapshot = sunlight;
        this.staticTilesSnapshot = [...this.map.tiles.values()].map(({ q, r, terrain }) => ({ q, r, terrain }));
        this.staticPathCenterlineSnapshot = this.map.pathCenterline.map((coord) => ({ ...coord }));
        this.staticPathRoutesSnapshot = this.map.pathRoutes.map((route) => ({
            id: route.id,
            pathCenterline: route.pathCenterline.map((coord) => ({ ...coord }))
        }));
        this.staticSpawnCoordSnapshot = { ...this.map.spawnCoord };
        this.staticCoreCoordSnapshot = { ...this.map.coreCoord };
        this.staticElevationSnapshot = this.activeElevation
            ? Object.freeze({
                schemaVersion: 1,
                defaultElevation: 0,
                overrides: Object.freeze(this.map.getElevationOverrides().map((entry) => Object.freeze({ ...entry })))
            })
            : undefined;
        this.derivedMapIntegrityBaseline = this.captureDerivedMapIntegrityBaseline();
        this.maxCoreHp = Math.max(1, this.mission.startingCoreHp * (this.difficulty.coreHpMultiplier ?? 1) + this.metaEffectTotal("coreHp", "amountPerLevel"));
        this.coreHp = this.maxCoreHp;
        this.resources = this.initialResources();
        this.initializeScripts();
        if (!internal.skipGameStarted) {
            this.beginScriptTransaction();
            this.runScriptEvent("gameStarted", { type: "gameStarted" });
            this.processScriptEvents();
        }
    }
    get coins() {
        return this.resources.coins ?? 0;
    }
    set coins(value) {
        this.resources.coins = value;
    }
    get towerTypes() {
        return this.content.towers;
    }
    get enemyTypes() {
        return this.content.enemies;
    }
    get waves() {
        return this.mission.waves;
    }
    reset() {
        this.rng = SeededRng.fromState(this.initialRngState);
        this.coreHp = this.maxCoreHp;
        this.resources = this.initialResources();
        this.waveIndex = 0;
        this.startedWaveCount = 0;
        this.waveState = "ready";
        this.prepRemaining = 0;
        this.outcome = "playing";
        for (const tower of this.towers) {
            this.map.clearOccupied(tower.id);
        }
        this.enemies = [];
        this.navigationEnemyFields?.clear();
        if (this.activeHeroesMechanics?.schemaVersion === 2
            || this.activeHeroesMechanics?.schemaVersion === 3
            || this.activeHeroesMechanics?.schemaVersion === 4
            || this.activeHeroesMechanics?.schemaVersion === 5
            || this.activeHeroesMechanics?.schemaVersion === 6) {
            const durability = this.activeHeroesMechanics.schemaVersion === 3
                ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId].durability
                : this.activeHeroesMechanics.schemaVersion === 4 || this.activeHeroesMechanics.schemaVersion === 5
                    || this.activeHeroesMechanics.schemaVersion === 6
                    ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId].durability
                    : undefined;
            const mana = this.activeHeroesMechanics.schemaVersion === 4 || this.activeHeroesMechanics.schemaVersion === 5
                || this.activeHeroesMechanics.schemaVersion === 6
                ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId].mana
                : undefined;
            const skillTree = this.activeHeroesMechanics.schemaVersion === 5 || this.activeHeroesMechanics.schemaVersion === 6
                ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId].skillTree
                : null;
            this.heroStateV2 = {
                definitionId: this.activeHeroesMechanics.selectedHeroId,
                currentCoord: { q: this.map.coreCoord.q, r: this.map.coreCoord.r },
                targetCoord: null,
                nextCoord: null,
                edgeProgress: 0,
                ...(durability === undefined ? {} : {
                    hp: durability.maxHp,
                    shieldCurrent: durability.shield?.capacity ?? 0
                }),
                ...(mana === undefined ? {} : { mana: mana.starting, abilityCooldownRemaining: 0 }),
                ...(skillTree === null ? {} : {
                    skillPoints: skillTree.points.starting,
                    unlockedSkillIds: new Set()
                })
            };
            this.heroMovementField = undefined;
            this.heroMovementDirty = false;
        }
        this.towers = [];
        this.artifactInventory = this.campaignBattle
            ? this.campaignBattle.artifacts.map((entry) => ({ ...entry, socket: null }))
            : [];
        this.nextArtifactInstanceSequence = this.artifactInventory.length + 1;
        this.artifactCheckpointForm = this.activeRogueliteMechanics?.artifacts ? (this.campaignBattle ? 3 : 1) : 0;
        if (this.artifactInitialRngState) {
            this.artifactRng = SeededRng.fromState(this.artifactInitialRngState);
        }
        this.nextDraftOfferSequence = 1;
        this.pendingDraftOffer = null;
        this.draftSelections = [];
        if (this.draftInitialRngState)
            this.draftRng = SeededRng.fromState(this.draftInitialRngState);
        this.rebuildRogueliteSynergies();
        this.enemyShields = {};
        this.towerShields = {};
        this.enemyMarks = {};
        this.lastEvents = [];
        if (this.activePhysicsMechanics)
            this.displacementStepAttemptsThisTick = 0;
        this.enemyCounter = 0;
        this.towerCounter = 0;
        this.clearedWaveCount = 0;
        this.killCount = 0;
        this.leakCount = 0;
        this.killCountByEnemyType = {};
        this.completedObjectiveIds.clear();
        this.earnedStarIds.clear();
        this.spawnQueue = [];
        this.missionElapsed = 0;
        this.nextWaveStartAt = null;
        this.abilityCooldowns = {};
        this.temporaryWaterTiles = [];
        this.runtimeTerrainOverrides.clear();
        this.runtimeElevationOverrides.clear();
        this.pendingTerraformExpiryGroups = [];
        this.nextTerraformExpirySequence = 1;
        this.map.useRuntimeElevationOverrides(this.runtimeElevationOverrides);
        this.map.restoreAllTerrain();
        this.initializeScripts();
        this.beginScriptTransaction();
        this.runScriptEvent("gameStarted", { type: "gameStarted" });
        this.processScriptEvents();
        for (const tile of this.map.tiles.values()) {
            delete tile.occupiedBy;
        }
        this.syncNavigationResolver();
    }
    startNextWave() {
        if (this.outcome !== "playing") {
            return this.fail("Mission already ended.", "reason.missionEnded");
        }
        if (this.pendingDraftOffer) {
            return this.fail("Choose a draft option before starting the next wave.", "reason.draftChoiceRequired");
        }
        if (this.activeRogueliteMechanics?.draft && this.startedWaveCount > this.clearedWaveCount) {
            return this.fail("The active wave must be cleared before drafting.", "reason.waveInProgress");
        }
        if (this.startedWaveCount >= this.mission.waves.length) {
            return this.fail("No waves left.", "reason.noWaves");
        }
        const earlyStartUnits = this.startedWaveCount > 0 ? this.getNextWaveRemaining() : 0;
        const result = this.startWave(this.startedWaveCount, this.missionElapsed, earlyStartUnits);
        if (result.ok)
            this.finishScriptedAction();
        return result;
    }
    canPlaceTower(typeId, coord) {
        const type = this.towerTypes[typeId];
        if (!type) {
            return this.fail("Unknown tower type.", "reason.unknownTower");
        }
        if (this.outcome !== "playing") {
            return this.fail("Mission already ended.", "reason.missionEnded");
        }
        if (!this.hasResources(type.cost)) {
            return this.fail(`Need ${this.formatCost(type.cost)}.`, "reason.needCost", this.costReasonParams(type.cost));
        }
        return this.canOccupyTowerFootprint(typeId, coord);
    }
    canPlaceTowerAnywhere(typeId) {
        const type = this.towerTypes[typeId];
        if (!type) {
            return this.fail("Unknown tower type.", "reason.unknownTower");
        }
        if (this.outcome !== "playing") {
            return this.fail("Mission already ended.", "reason.missionEnded");
        }
        if (!this.hasResources(type.cost)) {
            return this.fail(`Need ${this.formatCost(type.cost)}.`, "reason.needCost", this.costReasonParams(type.cost));
        }
        let firstReason = "No valid build space.";
        let firstReasonKey = "reason.noBuildSpace";
        let firstReasonParams;
        let navigationAnalyses = 0;
        for (const tile of this.map.tiles.values()) {
            if (this.navigationResolver
                && navigationAnalyses >= NAVIGATION_LIMITS.placementAnalysisCoordinates) {
                return this.fail("Dynamic navigation placement analysis budget exceeded.", "reason.navigationAnalysisBudgetExceeded", { limit: NAVIGATION_LIMITS.placementAnalysisCoordinates });
            }
            const result = this.canPlaceTower(typeId, tile);
            if (result.ok) {
                return { ok: true };
            }
            if (this.navigationResolver
                && (result.reasonKey === "reason.lastPathBlocked" || result.reasonKey === "reason.navigationUnavailable"))
                navigationAnalyses += 1;
            firstReason = result.reason ?? firstReason;
            firstReasonKey = result.reasonKey ?? firstReasonKey;
            firstReasonParams = result.reasonParams ?? firstReasonParams;
        }
        return { ok: false, reason: firstReason, reasonKey: firstReasonKey, reasonParams: firstReasonParams };
    }
    placeTower(typeId, coord) {
        const check = this.canPlaceTower(typeId, coord);
        if (!check.ok) {
            return check;
        }
        const type = this.towerTypes[typeId];
        if (!type) {
            return this.fail("Unknown tower type.", "reason.unknownTower");
        }
        const towerId = `tower_${++this.towerCounter}`;
        const attack = type.attack;
        const tower = {
            id: towerId,
            typeId,
            coord: this.cleanCoord(coord),
            footprint: this.map.tilesWithin(coord, type.footprintRadius).map(({ q, r }) => ({ q, r })),
            level: 1,
            targetMode: attack.kind === "sniper"
                ? (attack.targetPriority ?? "first")
                : (attack.kind === "pipeline"
                    ? (attack.targeting?.mode ?? "first")
                    : (attack.kind === "single" || attack.kind === "antiair" || attack.kind === "splash" ? "first" : undefined)),
            stacks: attack.kind === "single" ? attack.startingStacks : 0,
            cooldown: 0,
            investedResources: this.normalizeCost(type.cost),
            hp: typeof type.maxHp === "number" && type.maxHp > 0 ? type.maxHp : undefined
        };
        this.spendResources(type.cost);
        this.towers.push(tower);
        this.rebuildRogueliteSynergies();
        this.initializeTowerShield(tower);
        this.map.setOccupied(tower.footprint, towerId);
        this.syncNavigationOccupancy();
        const placedTile = this.map.getTile(coord);
        this.lastEvents.push({
            type: "towerPlaced",
            towerId,
            towerTypeId: typeId,
            coord: this.cleanCoord(coord),
            terrain: placedTile.terrain,
            terrainMetadata: this.terrainMetadata(placedTile.terrain)
        });
        this.finishScriptedAction();
        return { ok: true };
    }
    canMoveTower(towerId, coord) {
        const tower = this.towers.find((item) => item.id === towerId);
        if (!tower) {
            return this.fail("No tower selected.", "reason.noTowerSelected");
        }
        if (this.outcome !== "playing") {
            return this.fail("Mission already ended.", "reason.missionEnded");
        }
        const moveTowerCost = this.content.constants.moveTowerCost;
        if (!this.hasResources(moveTowerCost)) {
            return this.fail(`Need ${this.formatCost(moveTowerCost)}.`, "reason.needCost", this.costReasonParams(moveTowerCost));
        }
        const footprintCheck = this.canOccupyTowerFootprint(tower.typeId, coord, tower.id);
        if (!footprintCheck.ok) {
            return footprintCheck;
        }
        if (this.towerTypes[tower.typeId]?.attack.kind === "support" && !this.dependentsKeepSupportAfterMove(tower.id, coord)) {
            return this.fail("Dependent towers would lose this support aura.", "reason.dependentsLoseAura");
        }
        return { ok: true };
    }
    moveTower(towerId, coord) {
        const tower = this.towers.find((item) => item.id === towerId);
        if (!tower) {
            return this.fail("No tower selected.", "reason.noTowerSelected");
        }
        const check = this.canMoveTower(towerId, coord);
        if (!check.ok) {
            return check;
        }
        const from = this.cleanCoord(tower.coord);
        const type = this.towerTypes[tower.typeId];
        if (!type) {
            return this.fail("Unknown tower type.", "reason.unknownTower");
        }
        const footprint = this.map.tilesWithin(coord, type.footprintRadius).map(({ q, r }) => ({ q, r }));
        const moveTowerCost = this.content.constants.moveTowerCost;
        this.spendResources(moveTowerCost);
        this.map.clearOccupied(tower.id);
        tower.coord = this.cleanCoord(coord);
        tower.footprint = footprint;
        this.map.setOccupied(footprint, tower.id);
        this.syncNavigationOccupancy();
        this.lastEvents.push({ type: "towerMoved", towerId, from, to: this.cleanCoord(coord), cost: this.cloneResources(moveTowerCost) });
        this.finishScriptedAction();
        return { ok: true };
    }
    canUpgradeTower(towerId) {
        const tower = this.towers.find((item) => item.id === towerId);
        if (!tower) {
            return this.fail("No tower selected.", "reason.noTowerSelected");
        }
        const cost = this.getTowerUpgradeCost(tower);
        if (!cost) {
            return this.fail("Cluster is already full.", "reason.clusterFull");
        }
        if (!this.hasResources(cost)) {
            return this.fail(`Need ${this.formatCost(cost)}.`, "reason.needCost", this.costReasonParams(cost));
        }
        if (this.outcome !== "playing") {
            return this.fail("Mission already ended.", "reason.missionEnded");
        }
        return { ok: true };
    }
    getTowerUpgradeCost(towerOrId) {
        const tower = typeof towerOrId === "string" ? this.towers.find((item) => item.id === towerOrId) : towerOrId;
        if (!tower) {
            return null;
        }
        const type = this.towerTypes[tower.typeId];
        if (!type) {
            return null;
        }
        const attack = type.attack;
        if (attack.kind === "single") {
            return tower.stacks >= attack.maxStacks ? null : { coins: attack.upgradeCost };
        }
        const costs = "upgradeCosts" in attack ? attack.upgradeCosts : undefined;
        if (!costs) {
            return null;
        }
        return costs[tower.level - 1] ?? null;
    }
    upgradeTower(towerId) {
        const tower = this.towers.find((item) => item.id === towerId);
        if (!tower) {
            return this.fail("No tower selected.", "reason.noTowerSelected");
        }
        const check = this.canUpgradeTower(towerId);
        if (!check.ok) {
            return check;
        }
        const cost = this.getTowerUpgradeCost(tower);
        if (!cost) {
            return this.fail("Cluster is already full.", "reason.clusterFull");
        }
        const type = this.towerTypes[tower.typeId];
        if (!type) {
            return this.fail("Unknown tower type.", "reason.unknownTower");
        }
        this.spendResources(cost);
        this.addToBag(tower.investedResources, cost);
        if (type.attack.kind === "single") {
            tower.stacks += 1;
        }
        else {
            tower.level += 1;
        }
        this.lastEvents.push({ type: "towerUpgraded", towerId, level: tower.level, stacks: tower.stacks });
        this.finishScriptedAction();
        return { ok: true };
    }
    canSocketArtifact(artifactInstanceId, towerId, slotId) {
        const availability = this.artifactManagementAvailability();
        if (!availability.ok)
            return availability;
        const active = this.activeRogueliteMechanics;
        const artifacts = active?.artifacts;
        if (!active || !artifacts) {
            return this.fail("Artifacts are not available.", "reason.artifactsUnavailable");
        }
        const entry = this.artifactInventory.find((item) => item.instanceId === artifactInstanceId);
        if (!entry)
            return this.fail("Artifact is not owned.", "reason.artifactNotOwned");
        if (entry.socket)
            return this.fail("Artifact is already socketed.", "reason.artifactAlreadySocketed");
        const tower = this.towers.find((item) => item.id === towerId && (item.hp === undefined || item.hp > 0));
        if (!tower)
            return this.fail("Tower was not found.", "reason.artifactTowerNotFound");
        const slot = artifacts.towerSlots[tower.typeId]?.find((item) => item.slotId === slotId);
        if (!slot)
            return this.fail("Artifact slot was not found.", "reason.artifactSlotNotFound");
        const definition = artifacts.definitions[entry.artifactId];
        if (!definition || definition.slotType !== slot.slotType) {
            return this.fail("Artifact is incompatible with this slot.", "reason.artifactSlotIncompatible");
        }
        if (this.artifactInventory.some((item) => item.socket?.towerId === towerId && item.socket.slotId === slotId)) {
            return this.fail("Artifact slot is occupied.", "reason.artifactSlotOccupied");
        }
        const existingModifierCount = this.artifactInventory.reduce((sum, item) => {
            if (item.socket?.towerId !== towerId)
                return sum;
            return sum + (artifacts.definitions[item.artifactId]?.modifiers.length ?? 0);
        }, 0);
        const synergyWorstCase = rogueliteSynergyWorstCaseModifierCount(active.synergies);
        if (synergyWorstCase
            + existingModifierCount
            + definition.modifiers.length
            + ROGUELITE_DAMAGE_MODIFIER_RESERVE.total
            + activeHeroAuraModifierReserve(this.content, this.mission.id)
            > MAX_MODIFIERS_PER_RESOLUTION) {
            return this.fail("Artifact modifier budget is exceeded.", "reason.artifactModifierBudgetExceeded");
        }
        return { ok: true };
    }
    socketArtifact(artifactInstanceId, towerId, slotId) {
        const check = this.canSocketArtifact(artifactInstanceId, towerId, slotId);
        if (!check.ok)
            return check;
        const index = this.artifactInventory.findIndex((item) => item.instanceId === artifactInstanceId);
        const tower = this.towers.find((item) => item.id === towerId);
        if (index < 0 || !tower)
            return this.fail("Artifact socketing state changed.", "reason.artifactNotOwned");
        const previous = this.artifactInventory[index];
        this.artifactInventory[index] = { ...previous, socket: { towerId, slotId } };
        this.artifactCheckpointForm = this.campaignBattle ? 3 : 2;
        this.lastEvents.push({
            type: "artifactSocketed",
            artifactInstanceId,
            artifactId: previous.artifactId,
            towerId,
            towerTypeId: tower.typeId,
            slotId
        });
        this.rebuildRogueliteSynergies();
        this.finishScriptedAction();
        return { ok: true };
    }
    canUnsocketArtifact(artifactInstanceId, towerId, slotId) {
        const availability = this.artifactManagementAvailability();
        if (!availability.ok)
            return availability;
        const entry = this.artifactInventory.find((item) => item.instanceId === artifactInstanceId);
        if (!entry)
            return this.fail("Artifact is not owned.", "reason.artifactNotOwned");
        if (entry.socket?.towerId !== towerId || entry.socket.slotId !== slotId) {
            return this.fail("Artifact socket assignment changed.", "reason.artifactSocketMismatch");
        }
        return { ok: true };
    }
    unsocketArtifact(artifactInstanceId, towerId, slotId) {
        const check = this.canUnsocketArtifact(artifactInstanceId, towerId, slotId);
        if (!check.ok)
            return check;
        const entry = this.artifactInventory.find((item) => item.instanceId === artifactInstanceId);
        const tower = this.towers.find((item) => item.id === towerId);
        if (!entry || !tower)
            return this.fail("Artifact socket assignment changed.", "reason.artifactSocketMismatch");
        this.replaceArtifactSocket(entry.instanceId, null);
        this.artifactCheckpointForm = this.campaignBattle ? 3 : 2;
        this.lastEvents.push({
            type: "artifactUnsocketed",
            artifactInstanceId,
            artifactId: entry.artifactId,
            towerId,
            towerTypeId: tower.typeId,
            slotId,
            cause: "command"
        });
        this.rebuildRogueliteSynergies();
        this.finishScriptedAction();
        return { ok: true };
    }
    chooseDraftOption(offerId, cardId) {
        if (this.outcome !== "playing") {
            return this.fail("Mission already ended.", "reason.missionEnded");
        }
        const active = this.activeRogueliteMechanics;
        const offer = this.pendingDraftOffer;
        if (!active?.draft || !offer) {
            return this.fail("No draft choice is pending.", "reason.draftOptionUnavailable");
        }
        if (offer.offerId !== offerId || !offer.cardIds.includes(cardId)) {
            return this.fail("Draft option is unavailable.", "reason.draftOptionUnavailable");
        }
        if (!active.draft.definitions[cardId] || this.draftSelections.length >= ROGUELITE_DRAFT_LIMITS.selections) {
            return this.fail("Draft option is unavailable.", "reason.draftOptionUnavailable");
        }
        const sequence = this.draftSelections.length + 1;
        this.draftSelections.push(Object.freeze({
            sequence,
            offerId,
            cardId,
            ...(this.campaignBattle === undefined
                ? {}
                : { instanceId: `campaign:${this.campaignBattle.launchId}:card:${sequence}` })
        }));
        this.pendingDraftOffer = null;
        this.nextWaveStartAt = this.startedWaveCount < this.mission.waves.length
            ? this.missionElapsed + this.mission.prepTimeUnits
            : null;
        this.waveState = "between";
        this.syncPrepRemaining();
        this.rebuildRogueliteSynergies();
        return { ok: true };
    }
    getTowerSellRefund(towerOrId) {
        const tower = typeof towerOrId === "string" ? this.towers.find((item) => item.id === towerOrId) : towerOrId;
        if (!tower)
            return null;
        const ratio = this.mission.economy?.sellRefundRatio ?? 0.7;
        const refund = this.cloneResources({});
        for (const currencyId of this.currencyIds) {
            const invested = Number(tower.investedResources?.[currencyId]) || 0;
            refund[currencyId] = Math.floor(invested * ratio * 100 + 1e-9) / 100;
        }
        return refund;
    }
    canSellTower(towerId) {
        const tower = this.towers.find((item) => item.id === towerId);
        if (!tower)
            return this.fail("No tower selected.", "reason.noTowerSelected");
        if (this.outcome !== "playing")
            return this.fail("Mission already ended.", "reason.missionEnded");
        if (!this.dependentsKeepSupportAfterRemoval(towerId)) {
            return this.fail("Dependent towers still need this support aura.", "reason.dependentsLoseAura");
        }
        return { ok: true };
    }
    sellTower(towerId) {
        const tower = this.towers.find((item) => item.id === towerId);
        if (!tower)
            return this.fail("No tower selected.", "reason.noTowerSelected");
        const check = this.canSellTower(towerId);
        if (!check.ok)
            return check;
        const refund = this.getTowerSellRefund(tower) ?? this.cloneResources({});
        this.addResources(refund);
        this.autoUnsocketTowerArtifacts(tower, "tower_sold");
        this.destroyTower(towerId);
        this.lastEvents.push({ type: "towerSold", towerId, towerTypeId: tower.typeId, refund });
        this.finishScriptedAction();
        return { ok: true };
    }
    setTowerTargetMode(towerId, mode) {
        const tower = this.towers.find((item) => item.id === towerId);
        if (!tower) {
            return this.fail("No tower selected.", "reason.noTowerSelected");
        }
        if (!this.towerSupportsTargetMode(tower)) {
            return this.fail("This tower has no selectable target mode.", "reason.targetModeUnsupported");
        }
        if (!TOWER_TARGET_MODES.includes(mode)) {
            return this.fail("Unknown target mode.", "reason.targetModeUnknown", { mode });
        }
        tower.targetMode = mode;
        this.lastEvents.push({ type: "towerTargetModeChanged", towerId, mode });
        this.finishScriptedAction();
        return { ok: true };
    }
    usePathWaterAbility(center) {
        const ability = this.mission.abilities?.find((item) => item.id === "path_water");
        if (!ability) {
            return this.fail("Water spill is not available in this mission.", "reason.abilityUnavailable");
        }
        if (this.outcome !== "playing") {
            return this.fail("Mission already ended.", "reason.missionEnded");
        }
        const remaining = this.abilityCooldowns.path_water ?? 0;
        if (remaining > 0) {
            return this.fail("Water spill is still recharging.", "reason.abilityCooldown", { seconds: Math.ceil(remaining) });
        }
        const targetTile = this.map.getTile(center);
        if (!targetTile || this.map.getBaseTerrain(center) !== "path") {
            return this.fail("Water can only be poured onto the path.", "reason.abilityPathOnly");
        }
        const effectCoords = this.map
            .allPathCoords()
            .filter((coord) => this.map.distance(coord, center) <= ability.radius)
            .filter((coord) => this.map.getBaseTerrain(coord) === "path");
        if (effectCoords.length === 0) {
            return this.fail("Water can only be poured onto the path.", "reason.abilityPathOnly");
        }
        if (this.activeTerraformingMechanics) {
            return this.useActivePathWaterAbility(ability, center, effectCoords);
        }
        for (const coord of effectCoords) {
            const result = this.applyTerrainOverride(coord, "water", ability.duration, "ability");
            if (!result.ok)
                return result;
        }
        this.syncTemporaryWaterTiles();
        this.abilityCooldowns.path_water = ability.cooldown;
        this.lastEvents.push({
            type: "waterAbilityUsed",
            abilityId: ability.id,
            center: { ...center },
            coords: effectCoords.map((coord) => ({ ...coord })),
            duration: ability.duration
        });
        this.finishScriptedAction();
        return { ok: true };
    }
    useActivePathWaterAbility(ability, center, effectCoords) {
        if (effectCoords.length > TERRAFORMING_LIMITS.operationsPerBatch) {
            return this.fail(`Water spill exceeds the ${TERRAFORMING_LIMITS.operationsPerBatch} tile operation budget.`, "terraform.operation_budget_exceeded");
        }
        if (this.pendingTerraformExpiryGroups.length >= TERRAFORMING_LIMITS.pendingExpiryGroups) {
            return this.fail(`Terraform expiry groups exceed the ${TERRAFORMING_LIMITS.pendingExpiryGroups} group limit.`, "terraform.expiry_group_budget_exceeded");
        }
        if (!Number.isFinite(ability.duration)
            || ability.duration <= 0
            || ability.duration > TERRAFORMING_LIMITS.duration) {
            return this.fail(`Terraform duration must be finite and inside (0, ${TERRAFORMING_LIMITS.duration}].`, "terraform.duration_out_of_range");
        }
        if (!this.content.terrainTypes.water) {
            return this.fail('Terraform destination terrain "water" is unknown.', "terraform.invalid_operation");
        }
        for (const coord of effectCoords) {
            const existing = this.runtimeTerrainOverrides.get(coordKey(coord));
            if (this.isNativeTerraformTargetOwned("terrain", coord) || typeof existing?.expiresIn === "number") {
                return this.fail(`Terraform terrain target ${coordKey(coord)} is owned by a timed override.`, "terraform.target_owned");
            }
        }
        try {
            this.applyResolvedPersistentOperations(effectCoords.map((coord, order) => ({
                kind: "set_terrain",
                coord,
                directTerrainId: "water",
                terrainSource: "ability",
                order
            })), ability.duration);
        }
        catch (error) {
            if (!(error instanceof TowerScriptTerraformingError))
                throw error;
            return this.fail(error.message, error.reasonKey);
        }
        this.abilityCooldowns.path_water = ability.cooldown;
        this.lastEvents.push({
            type: "waterAbilityUsed",
            abilityId: ability.id,
            center: { ...center },
            coords: effectCoords.map((coord) => ({ ...coord })),
            duration: ability.duration
        });
        this.finishScriptedAction();
        return { ok: true };
    }
    /**
     * The `strike`/`freeze` engine presets, expressed as the same composable effects a custom
     * ability declares via `MissionAbilityDefinition.effects`. Returns undefined for any other id
     * (including `path_water`, which stays on its own bespoke tile-targeting handler below — its
     * validation/failure modes are tile-specific, not enemy-targeted).
     */
    builtinAbilityEffects(abilityId, ability) {
        if (abilityId === "strike") {
            return [{ kind: "damage", amount: Math.max(0, ability.damage ?? 0) }];
        }
        if (abilityId === "freeze") {
            return [{ kind: "status", status: { stun: ability.stunDuration ?? ability.duration } }];
        }
        return undefined;
    }
    displacementEffectRanks(effects) {
        const ranks = new Map();
        let displacementIndex = 0;
        effects.forEach((effect, index) => {
            const inspected = inspectOwnDataEffect(effect);
            if (!inspected.ok || inspected.kind !== "displacement")
                return;
            ranks.set(index, displacementIndex);
            displacementIndex += 1;
        });
        return ranks;
    }
    reserveDisplacementEffect(value, activationBudget, includeTickBudget) {
        if (!this.activePhysicsMechanics || !activationBudget)
            return undefined;
        const effect = parseDisplacementEffectV1(value);
        if (!effect)
            return undefined;
        const reserved = effect.distance;
        if (activationBudget.used + reserved > activationBudget.limit)
            return undefined;
        if (includeTickBudget
            && this.displacementStepAttemptsThisTick + reserved > PHYSICS_LIMITS.stepAttemptsPerTick)
            return undefined;
        activationBudget.used += reserved;
        if (includeTickBudget)
            this.displacementStepAttemptsThisTick += reserved;
        return effect;
    }
    safeAbilityEffectsForEvent(effects) {
        const safe = [];
        for (const value of effects) {
            const inspected = inspectOwnDataEffect(value);
            if (!inspected.ok)
                continue;
            if (inspected.kind === "displacement") {
                if (!this.activePhysicsMechanics)
                    continue;
                const effect = parseDisplacementEffectV1(inspected.record);
                if (effect)
                    safe.push(effect);
            }
            else if (inspected.kind === "damage" || inspected.kind === "status") {
                safe.push(inspected.record);
            }
        }
        return safe;
    }
    applyAbilityEffect(enemy, effectValue, abilityId, center, displacementAllowed, displacementBudget) {
        const inspected = inspectOwnDataEffect(effectValue);
        if (!inspected.ok)
            return;
        const effect = inspected.record;
        if (inspected.kind === "damage") {
            if (typeof effect.amount !== "number" || !Number.isFinite(effect.amount))
                return;
            this.applyResolvedEnemyDamage(enemy, Math.max(0, effect.amount), { kind: "ability", abilityId }, { tags: ["area"] }); // reward/removal handled by the next removeDeadEnemies() pass
        }
        else if (inspected.kind === "status") {
            if (!effect.status || typeof effect.status !== "object")
                return;
            this.applyStatusEffect(enemy, effect.status);
        }
        else if (inspected.kind === "displacement" && displacementAllowed) {
            const displacement = this.reserveDisplacementEffect(effect, displacementBudget, false);
            if (!displacement)
                return;
            this.applyDisplacementEffect(enemy, displacement, {
                sourceKind: "ability",
                sourceId: abilityId,
                sourceCoord: center
            });
        }
    }
    /**
     * Trigger a mission ability at a target coord. `path_water` routes to its own handler (a
     * tile effect, not enemy-targeted). Every other ability — `strike`/`freeze` presets or a
     * custom author-declared one — resolves to an `effects[]` composition applied to every enemy
     * within `radius` of `center`, via the shared applyAbilityEffect primitive. A custom ability
     * needs no engine code: declare `effects` on it and it just works.
     */
    useAbility(abilityId, center) {
        if (abilityId === "path_water") {
            return this.usePathWaterAbility(center);
        }
        const ability = this.mission.abilities?.find((item) => item.id === abilityId);
        if (!ability) {
            return this.fail("This ability is not available in this mission.", "reason.abilityUnavailable");
        }
        if (this.outcome !== "playing") {
            return this.fail("Mission already ended.", "reason.missionEnded");
        }
        const remaining = this.abilityCooldowns[abilityId] ?? 0;
        if (remaining > 0) {
            return this.fail("Ability is still recharging.", "reason.abilityCooldown", { seconds: Math.ceil(remaining) });
        }
        const effects = ability.effects ?? this.builtinAbilityEffects(abilityId, ability);
        if (!effects || effects.length === 0) {
            return this.fail("Unknown ability.", "reason.abilityUnavailable");
        }
        const targets = this.enemies.filter((enemy) => enemy.hp > 0 && this.map.distance(this.enemyCoord(enemy), center) <= ability.radius);
        const displacementRanks = this.activePhysicsMechanics
            ? this.displacementEffectRanks(effects)
            : undefined;
        const displacementBudget = this.activePhysicsMechanics
            ? { used: 0, limit: PHYSICS_LIMITS.stepAttemptsPerActivation }
            : undefined;
        const enemyIds = [];
        for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
            const enemy = targets[targetIndex];
            for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
                if (enemy.hp <= 0)
                    break;
                const displacementRank = displacementRanks?.get(effectIndex);
                this.applyAbilityEffect(enemy, effects[effectIndex], abilityId, center, displacementRank !== undefined && (targetIndex < PHYSICS_LIMITS.displacementTargetsPerActivation
                    && displacementRank < PHYSICS_LIMITS.displacementEffectsPerSource), displacementBudget);
            }
            enemyIds.push(enemy.id);
        }
        this.abilityCooldowns[abilityId] = ability.cooldown;
        this.lastEvents.push({
            type: "abilityUsed",
            abilityId,
            center: { ...center },
            enemyIds,
            effects: this.safeAbilityEffectsForEvent(effects)
        });
        this.finishScriptedAction();
        return { ok: true };
    }
    /**
     * Dispatch an author-defined event into TowerScript. This is the only custom event bridge:
     * callers provide JSON data, while scripts still receive no executable host capability.
     */
    emitScriptSignal(signal, payload = null) {
        if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(signal)) {
            return this.fail("Script signal must be a safe identifier.", "reason.invalidScriptSignal");
        }
        let serialized;
        try {
            serialized = JSON.stringify(payload);
        }
        catch {
            return this.fail("Script signal payload must be JSON-compatible.", "reason.invalidScriptPayload");
        }
        if (serialized === undefined || serialized.length > TOWER_SCRIPT_LIMITS.externalSignalPayloadBytes) {
            return this.fail("Script signal payload exceeds 64 KiB.", "reason.invalidScriptPayload");
        }
        const safePayload = JSON.parse(serialized);
        this.beginScriptTransaction();
        this.lastEvents.push({ type: "scriptSignal", scriptId: "external", signal, payload: safePayload });
        this.runScriptEvent("signal", { type: "signal", signal, payload: safePayload, sourceScriptId: "external" });
        this.processScriptEvents();
        this.stabilizeDynamicEnemyNavigation();
        return { ok: true };
    }
    getTowerIdAt(coord) {
        return this.map.occupiedTowerAt(coord);
    }
    /** Retarget the single opt-in v2 hero through a canonical shared flow field. */
    moveHero(heroId, target) {
        const profile = this.activeHeroesV2();
        const state = this.heroStateV2;
        if (!profile || !state) {
            return this.fail("Hero movement is not active.", "reason.heroMovementUnavailable");
        }
        if (this.outcome !== "playing") {
            return this.fail("Mission already ended.", "reason.missionEnded");
        }
        if (heroId !== state.definitionId) {
            return this.fail("Hero is unavailable.", "reason.heroUnavailable");
        }
        if (profile.schemaVersion >= 3 && (state.hp ?? 0) <= 0) {
            return this.fail("Hero is defeated.", "reason.heroDefeated");
        }
        if (!this.map.isInside(target)) {
            return this.fail("Hero target is outside the map.", "reason.tileOutsideMap");
        }
        if (sameGridCoord(state.currentCoord, target)) {
            state.targetCoord = null;
            state.nextCoord = null;
            state.edgeProgress = 0;
            this.heroMovementField = undefined;
            this.heroMovementDirty = false;
            return { ok: true };
        }
        let field;
        try {
            field = this.buildHeroMovementField(profile, target);
        }
        catch {
            return this.fail("Hero target is unreachable.", "reason.heroTargetUnreachable");
        }
        const currentCell = this.heroMovementLookupCache.get(field).get(state.currentCoord);
        if (!currentCell?.nextCoord) {
            return this.fail("Hero target is unreachable.", "reason.heroTargetUnreachable");
        }
        const preservesProgress = state.nextCoord !== null && sameGridCoord(state.nextCoord, currentCell.nextCoord);
        state.targetCoord = this.cleanCoord(target);
        state.nextCoord = this.cleanCoord(currentCell.nextCoord);
        state.edgeProgress = preservesProgress ? state.edgeProgress : 0;
        this.heroMovementField = field;
        this.heroMovementDirty = false;
        return { ok: true };
    }
    /** Use the single deterministic enemy-targeted ability authored by an active heroes v4 profile. */
    useHeroAbility(heroId, abilityId, targetEnemyId) {
        if (this.outcome !== "playing") {
            return this.fail("Mission already ended.", "reason.missionEnded");
        }
        const profile = this.activeHeroesMechanics;
        const state = this.heroStateV2;
        if ((profile?.schemaVersion !== 4 && profile?.schemaVersion !== 5 && profile?.schemaVersion !== 6) || !state) {
            return this.fail("Hero ability is not active.", "reason.heroAbilityUnavailable");
        }
        if (heroId !== state.definitionId) {
            return this.fail("Hero is unavailable.", "reason.heroUnavailable");
        }
        const definition = profile.definitions[state.definitionId];
        if (!definition || abilityId !== definition.activeAbility.id) {
            return this.fail("Hero ability is unavailable.", "reason.heroAbilityUnavailable");
        }
        if ((state.hp ?? 0) <= 0) {
            return this.fail("Hero is defeated.", "reason.heroDefeated");
        }
        const target = this.enemies.find((enemy) => enemy.id === targetEnemyId && enemy.hp > 0);
        if (!target) {
            return this.fail("Hero ability target is unavailable.", "reason.heroAbilityTargetUnavailable");
        }
        if (this.map.distance(state.currentCoord, this.enemyCoord(target)) > definition.activeAbility.range) {
            return this.fail("Hero ability target is out of range.", "reason.heroAbilityOutOfRange");
        }
        if ((state.mana ?? 0) < definition.activeAbility.manaCost) {
            return this.fail("Hero has insufficient mana.", "reason.heroManaInsufficient");
        }
        if ((state.abilityCooldownRemaining ?? 0) > 0) {
            return this.fail("Hero ability is recharging.", "reason.heroAbilityCooldown");
        }
        const previousMana = state.mana ?? 0;
        const applied = this.applyResolvedEnemyDamage(target, definition.activeAbility.damage, { kind: "ability", abilityId: definition.activeAbility.id }, profile.schemaVersion === 5 || profile.schemaVersion === 6
            ? { modifiers: this.heroAbilitySkillModifiers(profile, state) }
            : undefined);
        state.mana = previousMana - definition.activeAbility.manaCost;
        state.abilityCooldownRemaining = definition.activeAbility.cooldown;
        this.lastEvents.push({
            type: "heroAbilityUsed",
            heroId: state.definitionId,
            heroDefinitionId: state.definitionId,
            abilityId: definition.activeAbility.id,
            targetEnemyId: target.id,
            targetEnemyTypeId: target.typeId,
            previousMana,
            currentMana: state.mana,
            manaSpent: definition.activeAbility.manaCost,
            cooldownApplied: definition.activeAbility.cooldown,
            requestedDamage: definition.activeAbility.damage,
            resolvedDamage: applied.resolution.finalAmount,
            shieldAbsorbed: applied.shieldAbsorbed,
            hpDamage: applied.hpDamage
        });
        this.finishScriptedAction();
        return { ok: true };
    }
    /** Atomically spend battle-local points on one authored v5 hero skill. */
    unlockHeroSkill(heroId, skillId) {
        if (this.outcome !== "playing") {
            return this.fail("Mission already ended.", "reason.missionEnded");
        }
        const profile = this.activeHeroesMechanics;
        const state = this.heroStateV2;
        if ((profile?.schemaVersion !== 5 && profile?.schemaVersion !== 6) || !state) {
            return this.fail("Hero skill tree is unavailable.", "reason.heroSkillTreeUnavailable");
        }
        const definition = profile.definitions[state.definitionId];
        const tree = definition?.skillTree;
        if (!tree || state.skillPoints === undefined || !state.unlockedSkillIds) {
            return this.fail("Hero skill tree is unavailable.", "reason.heroSkillTreeUnavailable");
        }
        if (heroId !== state.definitionId) {
            return this.fail("Hero is unavailable.", "reason.heroUnavailable");
        }
        const skill = tree.nodes[skillId];
        if (!skill) {
            return this.fail("Hero skill is unavailable.", "reason.heroSkillUnavailable");
        }
        if (!this.heroSkillManagementAvailable()) {
            return this.fail("Hero skills can only be managed between waves.", "reason.heroSkillBetweenWavesOnly");
        }
        if ((state.hp ?? 0) <= 0) {
            return this.fail("Hero is defeated.", "reason.heroDefeated");
        }
        if (state.unlockedSkillIds.has(skillId)) {
            return this.fail("Hero skill is already unlocked.", "reason.heroSkillAlreadyUnlocked");
        }
        if (skill.requires.some((requiredId) => !state.unlockedSkillIds.has(requiredId))) {
            return this.fail("Hero skill prerequisites are not unlocked.", "reason.heroSkillPrerequisiteMissing");
        }
        if (state.skillPoints < skill.cost) {
            return this.fail("Hero skill points are insufficient.", "reason.heroSkillPointsInsufficient");
        }
        const previousPoints = state.skillPoints;
        state.skillPoints -= skill.cost;
        state.unlockedSkillIds.add(skillId);
        this.lastEvents.push({
            type: "heroSkillUnlocked",
            heroId: state.definitionId,
            heroDefinitionId: state.definitionId,
            skillId,
            cost: skill.cost,
            previousPoints,
            currentPoints: state.skillPoints
        });
        return { ok: true };
    }
    tick(deltaUnits) {
        this.lastEvents = [];
        if (this.activePhysicsMechanics)
            this.displacementStepAttemptsThisTick = 0;
        this.scriptEventCursor = 0;
        this.beginScriptTransaction();
        if (this.pendingDraftOffer)
            return;
        if (this.outcome !== "playing") {
            return;
        }
        const delta = Math.max(0, Math.min(deltaUnits, 0.2));
        this.updateAbilities(delta);
        this.advanceNativeTerraformingExpiry(delta);
        this.updateHeroAbility(delta);
        this.moveHeroUnit(delta);
        if (this.startedWaveCount > 0) {
            this.missionElapsed += delta;
            this.applyPassiveIncome(delta);
            this.startScheduledWaves();
            this.spawnDueEnemies();
            this.syncPrepRemaining();
        }
        this.updateShieldRegeneration(delta);
        this.updateEnemyMarks(delta);
        this.updateEnemyExposures(delta);
        this.updateEnemyStatuses(delta);
        this.moveEnemies(delta);
        this.applySunlightRegeneration(delta);
        this.applyHealAuras(delta);
        this.applyDotDamage(delta);
        this.updateTowerDisruptions(delta);
        this.updateEnemyTowerAttacks(delta);
        this.updateTowers(delta);
        this.triggerEnemyPhaseSpawns();
        this.removeDeadEnemies();
        this.processScriptEvents();
        if (this.outcome === "playing")
            this.runScriptEvent("tick", { type: "tick", delta });
        this.removeDeadEnemies();
        this.processScriptEvents();
        this.resolveWaveState();
        this.processScriptEvents();
        this.stabilizeDynamicEnemyNavigation();
        if (this.pendingDraftOffer)
            this.beginScriptTransaction();
    }
    getSnapshot() {
        return this.buildSnapshot(true);
    }
    getRenderSnapshot() {
        return this.buildSnapshot(false);
    }
    /** Export only the portable run-owned result; sockets and other battle state never cross missions. */
    exportCampaignBattleSettlement() {
        if (!this.campaignBattle || this.outcome !== "victory")
            return undefined;
        return Object.freeze({
            schemaVersion: 1,
            launchId: this.campaignBattle.launchId,
            nodeId: this.campaignBattle.nodeId,
            missionId: this.mission.id,
            deck: Object.freeze([
                ...this.campaignDeck.map((entry) => Object.freeze({ ...entry })),
                ...this.draftSelections.map((entry) => Object.freeze({
                    instanceId: entry.instanceId,
                    cardId: entry.cardId
                }))
            ]),
            artifacts: Object.freeze(this.artifactInventory.map((entry) => Object.freeze({
                instanceId: entry.instanceId,
                artifactId: entry.artifactId
            })))
        });
    }
    getCampaignBattleBinding() {
        if (!this.campaignBattle)
            return undefined;
        return Object.freeze({
            launchId: this.campaignBattle.launchId,
            nodeId: this.campaignBattle.nodeId,
            missionId: this.mission.id
        });
    }
    /** Pure, bounded diagnostics for active opt-in elevation v2 line of sight. */
    analyzeLineOfSight(request) {
        const profile = this.activeLineOfSightProfile;
        if (!profile)
            return undefined;
        return analyzeLineOfSightTargets(this.map, this.content.terrainTypes, profile, normalizeLineOfSightAnalysisRequestV1(request, this.map));
    }
    /** Pure, bounded diagnostics for active opt-in dynamic-flow navigation. */
    analyzeNavigation(request) {
        const profile = this.activeNavigationProfile;
        const profileId = this.activeNavigationProfileId;
        if (!profile || profileId === undefined)
            return undefined;
        const normalized = normalizeNavigationAnalysisRequestV1(request, {
            width: this.map.width,
            height: this.map.height,
            movementProfileIds: Object.keys(profile.movementProfiles),
            routeIds: this.map.pathRoutes.map((route) => route.id),
            towerTypeIds: Object.keys(this.towerTypes)
        });
        const budget = {
            used: 0,
            limit: NAVIGATION_LIMITS.placementAnalysisRelaxations,
            fields: new WeakSet()
        };
        const fields = this.buildNavigationAnalysisFields(normalized, budget);
        const placementContext = normalized.coordinates.length > 0
            ? this.createNavigationPlacementAnalysisContext(budget)
            : undefined;
        const placementRows = normalized.coordinates.map((coord) => {
            const result = this.canOccupyTowerFootprint(normalized.towerTypeId, coord, undefined, placementContext);
            const movementProfileId = result.reasonParams?.movementProfileId;
            const routeId = result.reasonParams?.routeId;
            return {
                coord: { q: coord.q, r: coord.r },
                ok: result.ok,
                ...(result.reasonKey === undefined ? {} : { reasonKey: result.reasonKey }),
                ...(typeof movementProfileId === "string" && typeof routeId === "string"
                    ? { blockingPair: { movementProfileId, routeId } }
                    : {})
            };
        });
        return {
            schemaVersion: 1,
            mode: "dynamic_flow",
            profileId,
            fields,
            placementRows
        };
    }
    createCheckpoint() {
        this.assertDerivedMapIntegrity();
        const identity = this.checkpointIdentity();
        const state = this.buildCheckpointState();
        const currentRng = this.rng.exportState();
        const contentDigest = getSimulationContentDigest(this.content);
        const rng = {
            initial: this.initialRngState,
            current: currentRng
        };
        const checkpoint = {
            schemaVersion: GAME_CHECKPOINT_SCHEMA_VERSION,
            engineVersion: SIMULATION_ENGINE_VERSION,
            contentDigest,
            identity,
            rng,
            state,
            stateDigest: computeCheckpointStateDigest(contentDigest, identity, rng, state)
        };
        return cloneCheckpointJson(checkpoint);
    }
    getStateDigest() {
        this.assertDerivedMapIntegrity();
        const identity = this.checkpointIdentity();
        return computeCheckpointStateDigest(getSimulationContentDigest(this.content), identity, { initial: this.initialRngState, current: this.rng.exportState() }, this.buildCheckpointState());
    }
    /**
     * Strictly validate and detach a checkpoint without constructing a map or
     * executing simulation behavior. Restore and journal decoders share this path.
     */
    static validateCheckpoint(options) {
        const descriptors = inspectCheckpointEnvelope(options.checkpoint);
        const expectedContentDigest = checkpointDataField(descriptors, "contentDigest", "Game checkpoint");
        if (typeof expectedContentDigest !== "string" || expectedContentDigest !== getSimulationContentDigest(options.content)) {
            throw new Error("Game checkpoint content digest mismatch.");
        }
        const identity = cloneCheckpointJson(checkpointDataField(descriptors, "identity", "Game checkpoint"));
        TowerDefenseGame.validateCheckpointIdentity(options.content, identity);
        const rngDescriptors = checkpointObjectDescriptors(checkpointDataField(descriptors, "rng", "Game checkpoint"), "Game checkpoint RNG");
        requireExactCheckpointKeys(rngDescriptors, ["initial", "current"], "Game checkpoint RNG");
        const initialRng = cloneCheckpointJson(checkpointDataField(rngDescriptors, "initial", "Game checkpoint RNG"));
        const currentRng = cloneCheckpointJson(checkpointDataField(rngDescriptors, "current", "Game checkpoint RNG"));
        for (const [label, rngState] of [["initial", initialRng], ["current", currentRng]]) {
            requireExactCheckpointKeys(checkpointObjectDescriptors(rngState, `Game checkpoint ${label} RNG state`), ["schemaVersion", "algorithm", "words"], `Game checkpoint ${label} RNG state`);
        }
        SeededRng.fromState(initialRng);
        SeededRng.fromState(currentRng);
        const rawState = checkpointDataField(descriptors, "state", "Game checkpoint");
        const rawStateDescriptors = checkpointObjectDescriptors(rawState, "Game checkpoint state");
        const rawEnemies = checkpointDataField(rawStateDescriptors, "enemies", "Game checkpoint state");
        if (Array.isArray(rawEnemies) && Object.getPrototypeOf(rawEnemies) === Array.prototype) {
            const selectedNavigation = resolveActiveNavigationMechanics(options.content, identity.missionId);
            const rawEnemyDescriptors = Object.getOwnPropertyDescriptors(rawEnemies);
            if (selectedNavigation?.mode === "dynamic_flow" && rawEnemies.length > NAVIGATION_LIMITS.liveEnemyStates) {
                let liveEnemyCount = 0;
                for (const key of Object.keys(rawEnemyDescriptors)) {
                    if (key === "length")
                        continue;
                    const enemyDescriptor = rawEnemyDescriptors[key];
                    if (!enemyDescriptor || !("value" in enemyDescriptor) || !enemyDescriptor.enumerable)
                        continue;
                    const rawEnemy = enemyDescriptor.value;
                    if (rawEnemy === null || typeof rawEnemy !== "object" || Array.isArray(rawEnemy))
                        continue;
                    const hpDescriptor = Object.getOwnPropertyDescriptor(rawEnemy, "hp");
                    if (hpDescriptor && "value" in hpDescriptor && hpDescriptor.enumerable && hpDescriptor.value > 0) {
                        liveEnemyCount += 1;
                        if (liveEnemyCount > NAVIGATION_LIMITS.liveEnemyStates) {
                            throw new Error("Game checkpoint live enemy navigation state budget is exceeded.");
                        }
                    }
                }
            }
            for (const key of Object.keys(rawEnemyDescriptors)) {
                if (key === "length")
                    continue;
                const enemyDescriptor = rawEnemyDescriptors[key];
                if (!enemyDescriptor || !("value" in enemyDescriptor) || !enemyDescriptor.enumerable)
                    continue;
                const rawEnemy = enemyDescriptor.value;
                if (rawEnemy === null || typeof rawEnemy !== "object" || Array.isArray(rawEnemy))
                    continue;
                const enemyDescriptors = Object.getOwnPropertyDescriptors(rawEnemy);
                if (!Object.prototype.hasOwnProperty.call(enemyDescriptors, "navigation"))
                    continue;
                const navigationValue = checkpointDataField(enemyDescriptors, "navigation", "Game checkpoint enemy navigation");
                const navigationDescriptors = checkpointObjectDescriptors(navigationValue, "Game checkpoint enemy navigation");
                for (const coordKey of ["currentCoord", "nextCoord"]) {
                    if (!Object.prototype.hasOwnProperty.call(navigationDescriptors, coordKey))
                        continue;
                    const coordDescriptors = checkpointObjectDescriptors(checkpointDataField(navigationDescriptors, coordKey, "Game checkpoint enemy navigation"), `Game checkpoint enemy navigation ${coordKey}`);
                    for (const axis of ["q", "r"]) {
                        checkpointDataField(coordDescriptors, axis, `Game checkpoint enemy navigation ${coordKey}`);
                    }
                }
            }
        }
        if (Object.prototype.hasOwnProperty.call(rawStateDescriptors, "reactions")) {
            const rawReactions = checkpointObjectDescriptors(checkpointDataField(rawStateDescriptors, "reactions", "Game checkpoint state"), "Game checkpoint reaction state");
            const rawExposures = checkpointObjectDescriptors(checkpointDataField(rawReactions, "exposures", "Game checkpoint reaction state"), "Game checkpoint reaction exposures");
            const rawEnemies = checkpointObjectDescriptors(checkpointDataField(rawExposures, "enemies", "Game checkpoint reaction exposures"), "Game checkpoint reaction exposure enemies");
            const enemyIds = Object.keys(rawEnemies);
            if (enemyIds.join("\u0000") !== [...enemyIds].sort().join("\u0000")) {
                throw new Error("Game checkpoint reaction enemy order is not canonical.");
            }
            for (const enemyId of enemyIds) {
                const rawEnemyExposures = checkpointObjectDescriptors(checkpointDataField(rawEnemies, enemyId, "Game checkpoint reaction exposure enemies"), `Game checkpoint reaction exposures for ${enemyId}`);
                const exposureIds = Object.keys(rawEnemyExposures);
                if (exposureIds.join("\u0000") !== [...exposureIds].sort().join("\u0000")) {
                    throw new Error("Game checkpoint exposure order is not canonical.");
                }
            }
        }
        const state = cloneCheckpointJson(rawState);
        TowerDefenseGame.validateCheckpointState(options.content, identity, state, initialRng);
        const expectedStateDigest = checkpointDataField(descriptors, "stateDigest", "Game checkpoint");
        if (typeof expectedStateDigest !== "string" ||
            expectedStateDigest !== computeCheckpointStateDigest(expectedContentDigest, identity, { initial: initialRng, current: currentRng }, state)) {
            throw new Error("Game checkpoint state digest mismatch; checkpoint may be tampered.");
        }
        return cloneCheckpointJson({
            schemaVersion: GAME_CHECKPOINT_SCHEMA_VERSION,
            engineVersion: SIMULATION_ENGINE_VERSION,
            contentDigest: expectedContentDigest,
            identity,
            rng: { initial: initialRng, current: currentRng },
            state,
            stateDigest: expectedStateDigest
        });
    }
    static fromCheckpoint(options) {
        const checkpoint = TowerDefenseGame.validateCheckpoint(options);
        const game = new TowerDefenseGame({
            content: options.content,
            missionId: checkpoint.identity.missionId,
            difficultyId: checkpoint.identity.difficultyId,
            metaUpgradeLevels: { ...checkpoint.identity.metaUpgradeLevels },
            seed: 0
        }, { skipGameStarted: true });
        game.restoreCheckpointState(checkpoint.state, checkpoint.rng.initial, checkpoint.rng.current);
        game.assertDerivedMapIntegrity();
        return game;
    }
    captureDerivedMapIntegrityBaseline() {
        const freezeCoord = (coord) => Object.freeze({ q: coord.q, r: coord.r });
        const freezeGrid = (grid) => Object.freeze({ ...grid });
        const mapDescriptors = Object.getOwnPropertyDescriptors(this.map);
        const baseTerrainDescriptor = mapDescriptors["baseTerrainByCoord"];
        const definitionDescriptor = mapDescriptors["definition"];
        if (!baseTerrainDescriptor || !("value" in baseTerrainDescriptor) || !(baseTerrainDescriptor.value instanceof Map)) {
            throw new Error("Derived map integrity baseline cannot read base terrain.");
        }
        if (!definitionDescriptor || !("value" in definitionDescriptor)) {
            throw new Error("Derived map integrity baseline cannot read the map definition.");
        }
        const baseTiles = Object.freeze([...this.map.tiles.values()].map((tile) => Object.freeze({
            q: tile.q,
            r: tile.r,
            terrain: tile.terrain
        })));
        const pathCenterline = Object.freeze(this.map.pathCenterline.map(freezeCoord));
        const pathRoutes = Object.freeze(this.map.pathRoutes.map((route) => Object.freeze({
            id: route.id,
            pathCenterline: Object.freeze(route.pathCenterline.map(freezeCoord))
        })));
        return Object.freeze({
            mapRef: this.map,
            tilesRef: this.map.tiles,
            baseTerrainRef: baseTerrainDescriptor.value,
            topologyRef: this.map.topology,
            gridRef: this.map.grid,
            topologyGridRef: this.map.topology.grid,
            mapOwnShape: capturePropertyDescriptorShape(this.map),
            mapPrototypeRef: PINNED_GRID_MAP_PROTOTYPE,
            mapPrototypeShape: PINNED_GRID_MAP_PROTOTYPE_SHAPE,
            definitionCanonical: canonicalStringify(definitionDescriptor.value),
            id: this.map.id,
            width: this.map.width,
            height: this.map.height,
            grid: freezeGrid(this.map.grid),
            topologyGrid: freezeGrid(this.map.topology.grid),
            topologyDirectionCount: this.map.topology.directionCount,
            topologyMethods: Object.freeze({
                neighbors: this.map.topology.neighbors,
                distance: this.map.topology.distance,
                line: this.map.topology.line,
                directionBetween: this.map.topology.directionBetween,
                tilesWithin: this.map.topology.tilesWithin,
                footprintSize: this.map.topology.footprintSize
            }),
            baseTiles,
            pathCenterline,
            pathRoutes,
            spawnCoord: freezeCoord(this.map.spawnCoord),
            coreCoord: freezeCoord(this.map.coreCoord)
        });
    }
    /**
     * Validate every mutable GridMap projection against authoritative game state.
     * This intentionally reads untrusted public structures through descriptors so
     * integrity checks never invoke a getter installed by a caller.
     */
    assertDerivedMapIntegrity() {
        const fail = (detail) => {
            throw new Error(`Derived map integrity is incoherent: ${detail}`);
        };
        const ownData = (value, prototype, context, inspectEveryField = true) => {
            if (value === null || typeof value !== "object")
                return fail(`${context} is not an object.`);
            let actualPrototype = null;
            let descriptors = {};
            try {
                actualPrototype = Object.getPrototypeOf(value);
                descriptors = Object.getOwnPropertyDescriptors(value);
            }
            catch {
                return fail(`${context} descriptors cannot be inspected.`);
            }
            if (actualPrototype !== prototype)
                return fail(`${context} has an unexpected prototype.`);
            if (Object.getOwnPropertySymbols(descriptors).length > 0)
                return fail(`${context} has symbol fields.`);
            if (inspectEveryField) {
                for (const [key, descriptor] of Object.entries(descriptors)) {
                    if (!("value" in descriptor))
                        return fail(`${context}.${key} must be a data property.`);
                    if (!descriptor.enumerable)
                        return fail(`${context}.${key} must be enumerable.`);
                }
            }
            return descriptors;
        };
        const field = (descriptors, key, context) => {
            const descriptor = descriptors[key];
            if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
                return fail(`${context}.${key} must be an enumerable data property.`);
            }
            return descriptor.value;
        };
        const exactKeys = (descriptors, keys, context) => {
            const actual = Object.keys(descriptors);
            if (actual.length !== keys.length || keys.some((key) => !actual.includes(key))) {
                fail(`${context} has missing or extra fields.`);
            }
        };
        const assertDescriptorShape = (descriptors, expected, context) => {
            const actualKeys = Reflect.ownKeys(descriptors);
            if (actualKeys.length !== expected.length
                || expected.some((snapshot) => !actualKeys.some((key) => Object.is(key, snapshot.key)))) {
                fail(`${context} own shape changed or has a method shadow.`);
            }
            for (const snapshot of expected) {
                if (!descriptorMatchesSnapshot(descriptors[snapshot.key], snapshot)) {
                    fail(`${context} descriptor for ${String(snapshot.key)} changed.`);
                }
            }
        };
        const nativeMapSize = (value, context) => {
            if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== NATIVE_MAP_PROTOTYPE) {
                return fail(`${context} is not a native Map.`);
            }
            if (Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).length > 0) {
                return fail(`${context} has unsupported own fields.`);
            }
            if (typeof NATIVE_MAP_SIZE_GETTER !== "function")
                return fail("native Map size intrinsic is unavailable.");
            try {
                const size = Reflect.apply(NATIVE_MAP_SIZE_GETTER, value, []);
                return typeof size === "number" && Number.isSafeInteger(size) && size >= 0
                    ? size
                    : fail(`${context} native size is invalid.`);
            }
            catch {
                return fail(`${context} native size cannot be inspected.`);
            }
        };
        const assertNativeMapIntrinsics = () => {
            if (Map.prototype !== NATIVE_MAP_PROTOTYPE)
                fail("native Map prototype identity changed.");
            for (const expected of NATIVE_MAP_INTRINSIC_SHAPE) {
                if (!descriptorMatchesSnapshot(Object.getOwnPropertyDescriptor(NATIVE_MAP_PROTOTYPE, expected.key), expected)) {
                    fail(`native Map prototype intrinsic ${String(expected.key)} changed.`);
                }
            }
            const nextDescriptor = Object.getOwnPropertyDescriptor(NATIVE_MAP_ITERATOR_PROTOTYPE, "next");
            if (!nextDescriptor || nextDescriptor.value !== NATIVE_MAP_ITERATOR_NEXT) {
                fail("native Map iterator intrinsic changed.");
            }
        };
        const arrayItems = (value, context) => {
            if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
                return fail(`${context} is not a plain array.`);
            }
            let descriptors;
            try {
                descriptors = Object.getOwnPropertyDescriptors(value);
            }
            catch {
                return fail(`${context} descriptors cannot be inspected.`);
            }
            if (Object.getOwnPropertySymbols(descriptors).length > 0)
                fail(`${context} has symbol fields.`);
            const lengthDescriptor = descriptors["length"];
            if (!lengthDescriptor || !("value" in lengthDescriptor))
                return fail(`${context} length is not a data property.`);
            const length = lengthDescriptor.value;
            if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
                return fail(`${context} length is invalid.`);
            }
            const keys = Object.keys(descriptors).filter((key) => key !== "length");
            if (keys.length !== length)
                fail(`${context} is sparse or has extra fields.`);
            const result = [];
            for (let index = 0; index < length; index += 1) {
                const descriptor = descriptors[String(index)];
                if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
                    return fail(`${context}[${index}] must be an enumerable data property.`);
                }
                result.push(descriptor.value);
            }
            return result;
        };
        const mapEntries = (value, context, expectedSize, maximumSize) => {
            const size = nativeMapSize(value, context);
            if (expectedSize !== undefined && size !== expectedSize)
                fail(`${context} native size changed.`);
            if (maximumSize !== undefined && size > maximumSize)
                fail(`${context} exceeds its native size budget.`);
            if (typeof NATIVE_MAP_ITERATOR_NEXT !== "function")
                return fail("native Map iterator is unavailable.");
            const iteratorNext = NATIVE_MAP_ITERATOR_NEXT;
            try {
                const iterator = Reflect.apply(NATIVE_MAP_ENTRIES, value, []);
                const entries = [];
                for (let index = 0; index < size; index += 1) {
                    const step = Reflect.apply(iteratorNext, iterator, []);
                    if (step.done)
                        return fail(`${context} ended before its native size.`);
                    entries.push(step.value);
                }
                const end = Reflect.apply(iteratorNext, iterator, []);
                if (!end.done)
                    return fail(`${context} exceeds its native size.`);
                return entries;
            }
            catch {
                return fail(`${context} entries cannot be inspected.`);
            }
        };
        const nativeMapGet = (map, key) => Reflect.apply(NATIVE_MAP_GET, map, [key]);
        const nativeMapSet = (map, key, value) => {
            Reflect.apply(NATIVE_MAP_SET, map, [key, value]);
        };
        const nativeMapHas = (map, key) => Reflect.apply(NATIVE_MAP_HAS, map, [key]);
        const coord = (value, context) => {
            const descriptors = ownData(value, Object.prototype, context);
            exactKeys(descriptors, ["q", "r"], context);
            const q = field(descriptors, "q", context);
            const r = field(descriptors, "r", context);
            if (typeof q !== "number" || !Number.isInteger(q) || typeof r !== "number" || !Number.isInteger(r)) {
                return fail(`${context} has invalid coordinates.`);
            }
            return { q, r };
        };
        const sameCoord = (actual, expected, context) => {
            if (actual.q !== expected.q || actual.r !== expected.r)
                fail(`${context} changed.`);
        };
        const grid = (value, expected, context) => {
            const descriptors = ownData(value, Object.prototype, context);
            const keys = expected.kind === "square" ? ["kind", "adjacency"] : ["kind", "layout"];
            exactKeys(descriptors, keys, context);
            if (field(descriptors, "kind", context) !== expected.kind)
                fail(`${context} kind changed.`);
            const variantKey = expected.kind === "square" ? "adjacency" : "layout";
            const expectedVariant = expected.kind === "square" ? expected.adjacency : expected.layout;
            if (field(descriptors, variantKey, context) !== expectedVariant)
                fail(`${context} descriptor changed.`);
        };
        const paths = (value, expected, context) => {
            const items = arrayItems(value, context);
            if (items.length !== expected.length)
                fail(`${context} length changed.`);
            for (let index = 0; index < items.length; index += 1) {
                sameCoord(coord(items[index], `${context}[${index}]`), expected[index], `${context}[${index}]`);
            }
        };
        const baseline = this.derivedMapIntegrityBaseline;
        const gameDescriptors = ownData(this, TowerDefenseGame.prototype, "game", false);
        const liveMap = field(gameDescriptors, "map", "game");
        if (liveMap !== baseline.mapRef)
            fail("map identity changed.");
        const mapDescriptors = ownData(liveMap, GridMap.prototype, "map", false);
        assertDescriptorShape(mapDescriptors, baseline.mapOwnShape, "map");
        if (Object.getPrototypeOf(liveMap) !== baseline.mapPrototypeRef)
            fail("map prototype identity changed.");
        assertDescriptorShape(Object.getOwnPropertyDescriptors(baseline.mapPrototypeRef), baseline.mapPrototypeShape, "map prototype");
        const liveDefinition = field(mapDescriptors, "definition", "map");
        try {
            if (canonicalStringify(liveDefinition) !== baseline.definitionCanonical) {
                fail("map definition changed and would alter clone behavior.");
            }
        }
        catch {
            fail("map definition is not canonical clone data.");
        }
        if (field(mapDescriptors, "id", "map") !== baseline.id)
            fail("map id changed.");
        if (field(mapDescriptors, "width", "map") !== baseline.width)
            fail("map width changed.");
        if (field(mapDescriptors, "height", "map") !== baseline.height)
            fail("map height changed.");
        const liveTiles = field(mapDescriptors, "tiles", "map");
        if (liveTiles !== baseline.tilesRef)
            fail("map tiles identity changed.");
        const baseTerrain = field(mapDescriptors, "baseTerrainByCoord", "map");
        if (baseTerrain !== baseline.baseTerrainRef)
            fail("map base terrain identity changed.");
        const runtimeOverrides = field(gameDescriptors, "runtimeTerrainOverrides", "game");
        const runtimeElevationOverrides = field(gameDescriptors, "runtimeElevationOverrides", "game");
        if (nativeMapSize(liveTiles, "map tiles") !== baseline.baseTiles.length) {
            fail("map tiles native size changed.");
        }
        if (nativeMapSize(baseTerrain, "map base terrain") !== baseline.baseTiles.length) {
            fail("map base terrain native size changed.");
        }
        if (nativeMapSize(runtimeOverrides, "runtime terrain overrides") > TOWER_SCRIPT_LIMITS.activeTerrainOverrides) {
            fail("runtime terrain overrides exceed the native size budget.");
        }
        if (nativeMapSize(runtimeElevationOverrides, "runtime elevation overrides") > TERRAFORMING_LIMITS.activeElevationOverrides) {
            fail("runtime elevation overrides exceed the native size budget.");
        }
        assertNativeMapIntrinsics();
        const liveGrid = field(mapDescriptors, "grid", "map");
        if (liveGrid !== baseline.gridRef)
            fail("map grid identity changed.");
        grid(liveGrid, baseline.grid, "map grid");
        const liveTopology = field(mapDescriptors, "topology", "map");
        if (liveTopology !== baseline.topologyRef)
            fail("map topology identity changed.");
        const topologyDescriptors = ownData(liveTopology, Object.prototype, "map topology");
        exactKeys(topologyDescriptors, [
            "grid", "directionCount", "neighbors", "distance", "line", "directionBetween", "tilesWithin", "footprintSize"
        ], "map topology");
        const topologyGrid = field(topologyDescriptors, "grid", "map topology");
        if (topologyGrid !== baseline.topologyGridRef)
            fail("topology grid identity changed.");
        grid(topologyGrid, baseline.topologyGrid, "topology grid");
        if (field(topologyDescriptors, "directionCount", "map topology") !== baseline.topologyDirectionCount) {
            fail("topology direction count changed.");
        }
        for (const [key, expected] of Object.entries(baseline.topologyMethods)) {
            if (field(topologyDescriptors, key, "map topology") !== expected)
                fail(`topology method ${key} changed.`);
        }
        paths(field(mapDescriptors, "pathCenterline", "map"), baseline.pathCenterline, "map pathCenterline");
        const routeValues = arrayItems(field(mapDescriptors, "pathRoutes", "map"), "map pathRoutes");
        if (routeValues.length !== baseline.pathRoutes.length)
            fail("map pathRoutes length changed.");
        for (let index = 0; index < routeValues.length; index += 1) {
            const routeDescriptors = ownData(routeValues[index], Object.prototype, `map pathRoutes[${index}]`);
            exactKeys(routeDescriptors, ["id", "pathCenterline"], `map pathRoutes[${index}]`);
            const expected = baseline.pathRoutes[index];
            if (field(routeDescriptors, "id", `map pathRoutes[${index}]`) !== expected.id) {
                fail(`map pathRoutes[${index}] id changed.`);
            }
            paths(field(routeDescriptors, "pathCenterline", `map pathRoutes[${index}]`), expected.pathCenterline, `map pathRoutes[${index}].pathCenterline`);
        }
        sameCoord(coord(field(mapDescriptors, "spawnCoord", "map"), "map spawnCoord"), baseline.spawnCoord, "map spawnCoord");
        sameCoord(coord(field(mapDescriptors, "coreCoord", "map"), "map coreCoord"), baseline.coreCoord, "map coreCoord");
        const expectedTiles = new Map();
        for (const tile of baseline.baseTiles)
            nativeMapSet(expectedTiles, coordKey(tile), { ...tile });
        const baseTerrainEntries = mapEntries(baseTerrain, "map base terrain", baseline.baseTiles.length);
        for (const [key, terrain] of baseTerrainEntries) {
            if (typeof key !== "string"
                || typeof terrain !== "string"
                || nativeMapGet(expectedTiles, key)?.terrain !== terrain) {
                fail("map base terrain changed.");
            }
        }
        const overrideEntries = mapEntries(runtimeOverrides, "runtime terrain overrides", undefined, TOWER_SCRIPT_LIMITS.activeTerrainOverrides);
        for (let index = 0; index < overrideEntries.length; index += 1) {
            const [key, value] = overrideEntries[index];
            if (typeof key !== "string")
                return fail(`runtime terrain override ${index} has a non-string key.`);
            const descriptors = ownData(value, Object.prototype, `runtime terrain override ${index}`);
            const allowedKeys = Object.prototype.hasOwnProperty.call(descriptors, "expiresIn")
                ? ["q", "r", "terrain", "source", "expiresIn"]
                : ["q", "r", "terrain", "source"];
            exactKeys(descriptors, allowedKeys, `runtime terrain override ${index}`);
            const overrideCoord = coord({
                q: field(descriptors, "q", `runtime terrain override ${index}`),
                r: field(descriptors, "r", `runtime terrain override ${index}`)
            }, `runtime terrain override ${index} coordinate`);
            if (coordKey(overrideCoord) !== key || !nativeMapHas(expectedTiles, key)) {
                fail(`runtime terrain override ${index} has an invalid coordinate key.`);
            }
            const terrain = field(descriptors, "terrain", `runtime terrain override ${index}`);
            const source = field(descriptors, "source", `runtime terrain override ${index}`);
            if (typeof terrain !== "string" || (source !== "script" && source !== "ability")) {
                return fail(`runtime terrain override ${index} is invalid.`);
            }
            if (allowedKeys.includes("expiresIn")) {
                const expiresIn = field(descriptors, "expiresIn", `runtime terrain override ${index}`);
                if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn < 0) {
                    fail(`runtime terrain override ${index} expiry is invalid.`);
                }
            }
            nativeMapGet(expectedTiles, key).terrain = terrain;
        }
        const elevationEntries = mapEntries(runtimeElevationOverrides, "runtime elevation overrides", undefined, TERRAFORMING_LIMITS.activeElevationOverrides);
        if (elevationEntries.length + overrideEntries.length > TERRAFORMING_LIMITS.activeOverridesCombined) {
            fail("runtime terraforming overrides exceed the combined native size budget.");
        }
        const expectedElevation = new Map(this.map.getElevationOverrides().map((entry) => [coordKey(entry), { ...entry }]));
        const elevationPolicy = this.activeTerraformingMechanics?.elevation;
        for (let index = 0; index < elevationEntries.length; index += 1) {
            const [key, value] = elevationEntries[index];
            if (typeof key !== "string")
                return fail(`runtime elevation override ${index} has a non-string key.`);
            const descriptors = ownData(value, Object.prototype, `runtime elevation override ${index}`);
            exactKeys(descriptors, ["q", "r", "elevation"], `runtime elevation override ${index}`);
            const overrideCoord = coord({
                q: field(descriptors, "q", `runtime elevation override ${index}`),
                r: field(descriptors, "r", `runtime elevation override ${index}`)
            }, `runtime elevation override ${index} coordinate`);
            if (coordKey(overrideCoord) !== key || !this.map.isInside(overrideCoord)) {
                fail(`runtime elevation override ${index} has an invalid coordinate key.`);
            }
            const elevation = field(descriptors, "elevation", `runtime elevation override ${index}`);
            const baseElevation = this.map.getBaseElevation(overrideCoord);
            if (!elevationPolicy
                || !Number.isSafeInteger(elevation)
                || elevation < elevationPolicy.minimum
                || elevation > elevationPolicy.maximum
                || elevation === baseElevation) {
                fail(`runtime elevation override ${index} is invalid.`);
            }
            nativeMapSet(expectedElevation, key, {
                q: overrideCoord.q,
                r: overrideCoord.r,
                elevation: elevation
            });
        }
        const effectiveElevation = this.map.getEffectiveElevationOverrides();
        const expectedEffectiveElevation = [...expectedElevation.values()]
            .filter((entry) => entry.elevation !== 0)
            .sort((left, right) => left.r - right.r || left.q - right.q);
        if (canonicalStringify(effectiveElevation) !== canonicalStringify(expectedEffectiveElevation)) {
            fail("map effective elevation is not backed by runtime elevation overrides.");
        }
        const checkpointForm = field(gameDescriptors, "terraformingCheckpointForm", "game");
        const pendingExpiryGroups = arrayItems(field(gameDescriptors, "pendingTerraformExpiryGroups", "game"), "pending terraforming expiry groups");
        const nextExpirySequence = field(gameDescriptors, "nextTerraformExpirySequence", "game");
        if ((checkpointForm !== 0 && checkpointForm !== 1 && checkpointForm !== 2)
            || (!this.activeTerraformingMechanics && checkpointForm !== 0)
            || (checkpointForm === 1 && !elevationPolicy)
            || (pendingExpiryGroups.length > 0 && checkpointForm !== 2)
            || !Number.isSafeInteger(nextExpirySequence)
            || nextExpirySequence < 1
            || pendingExpiryGroups.length > TERRAFORMING_LIMITS.pendingExpiryGroups) {
            fail("native terraforming checkpoint inventory is invalid.");
        }
        const ownedExpiryTargets = new Set();
        let ownedExpiryTerrain = 0;
        let ownedExpiryElevation = 0;
        let previousExpirySequence = 0;
        for (let groupIndex = 0; groupIndex < pendingExpiryGroups.length; groupIndex += 1) {
            const group = ownData(pendingExpiryGroups[groupIndex], Object.prototype, `pending terraforming expiry group ${groupIndex}`);
            exactKeys(group, ["sequence", "remaining", "targets"], `pending terraforming expiry group ${groupIndex}`);
            const sequence = field(group, "sequence", `pending terraforming expiry group ${groupIndex}`);
            const remaining = field(group, "remaining", `pending terraforming expiry group ${groupIndex}`);
            if (!Number.isSafeInteger(sequence)
                || sequence <= previousExpirySequence
                || sequence >= nextExpirySequence
                || typeof remaining !== "number"
                || !Number.isFinite(remaining)
                || remaining < 0
                || remaining > TERRAFORMING_LIMITS.duration) {
                fail(`pending terraforming expiry group ${groupIndex} sequence or remaining is invalid.`);
            }
            previousExpirySequence = sequence;
            const targets = arrayItems(field(group, "targets", `pending terraforming expiry group ${groupIndex}`), `pending terraforming expiry group ${groupIndex} targets`);
            if (targets.length < 1 || targets.length > TERRAFORMING_LIMITS.operationsPerBatch) {
                fail(`pending terraforming expiry group ${groupIndex} target budget is invalid.`);
            }
            let previousOrder = -1;
            for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
                const target = ownData(targets[targetIndex], Object.prototype, `pending terraforming expiry target ${groupIndex}:${targetIndex}`);
                const layer = field(target, "layer", `pending terraforming expiry target ${groupIndex}:${targetIndex}`);
                exactKeys(target, layer === "terrain"
                    ? ["layer", "q", "r", "order", "appliedTerrain", "previousOverride"]
                    : layer === "elevation"
                        ? ["layer", "q", "r", "order", "appliedElevation", "previousElevationOverride"]
                        : ["layer"], `pending terraforming expiry target ${groupIndex}:${targetIndex}`);
                if (layer !== "terrain" && layer !== "elevation") {
                    fail(`pending terraforming expiry target ${groupIndex}:${targetIndex} layer is invalid.`);
                }
                const order = field(target, "order", `pending terraforming expiry target ${groupIndex}:${targetIndex}`);
                const targetCoord = coord({
                    q: field(target, "q", `pending terraforming expiry target ${groupIndex}:${targetIndex}`),
                    r: field(target, "r", `pending terraforming expiry target ${groupIndex}:${targetIndex}`)
                }, `pending terraforming expiry target ${groupIndex}:${targetIndex} coordinate`);
                if (!Number.isSafeInteger(order)
                    || order < 0
                    || order > 63
                    || order <= previousOrder
                    || !this.map.isInside(targetCoord)) {
                    fail(`pending terraforming expiry target ${groupIndex}:${targetIndex} order or coordinate is invalid.`);
                }
                previousOrder = order;
                const key = coordKey(targetCoord);
                const ownershipKey = `${layer}:${key}`;
                if (ownedExpiryTargets.has(ownershipKey)) {
                    fail(`pending terraforming expiry target ${groupIndex}:${targetIndex} ownership is duplicated.`);
                }
                ownedExpiryTargets.add(ownershipKey);
                if (ownedExpiryTargets.size > TERRAFORMING_LIMITS.activeOverridesCombined) {
                    fail("pending terraforming expiry ownership exceeds the combined budget.");
                }
                if (layer === "terrain") {
                    ownedExpiryTerrain += 1;
                    const appliedTerrain = field(target, "appliedTerrain", `pending terraforming expiry terrain target ${groupIndex}:${targetIndex}`);
                    const projected = nativeMapGet(runtimeOverrides, key);
                    const previousValue = field(target, "previousOverride", `pending terraforming expiry terrain target ${groupIndex}:${targetIndex}`);
                    const authoredTerrain = nativeMapGet(baseTerrain, key);
                    const effectiveTerrain = projected?.terrain ?? authoredTerrain;
                    const validRuntimeSource = projected?.source === "script" || (projected?.source === "ability"
                        && this.activeTerraformingMechanics !== undefined
                        && this.mission.abilities?.some((ability) => ability.id === "path_water")
                        && appliedTerrain === "water"
                        && authoredTerrain === "path");
                    if (ownedExpiryTerrain > TERRAFORMING_LIMITS.activeTerrainOverrides
                        || typeof appliedTerrain !== "string"
                        || !Object.prototype.hasOwnProperty.call(this.content.terrainTypes, appliedTerrain)
                        || effectiveTerrain !== appliedTerrain
                        || (appliedTerrain === authoredTerrain && projected !== undefined)
                        || (appliedTerrain !== authoredTerrain && (!projected
                            || !validRuntimeSource
                            || projected.expiresIn !== undefined))) {
                        fail(`pending terraforming expiry terrain target ${groupIndex}:${targetIndex} projection is invalid.`);
                    }
                    if (previousValue === null) {
                        if (authoredTerrain === appliedTerrain) {
                            fail(`pending terraforming expiry terrain target ${groupIndex}:${targetIndex} before-image is invalid.`);
                        }
                    }
                    else {
                        const previousOverride = ownData(previousValue, Object.prototype, `pending terraforming expiry terrain before-image ${groupIndex}:${targetIndex}`);
                        exactKeys(previousOverride, ["terrain", "source"], `pending terraforming expiry terrain before-image ${groupIndex}:${targetIndex}`);
                        const previousTerrain = field(previousOverride, "terrain", "pending terraforming expiry terrain before-image");
                        const previousSource = field(previousOverride, "source", "pending terraforming expiry terrain before-image");
                        if (typeof previousTerrain !== "string"
                            || !Object.prototype.hasOwnProperty.call(this.content.terrainTypes, previousTerrain)
                            || (previousSource !== "script" && previousSource !== "ability")
                            || previousTerrain === appliedTerrain) {
                            fail(`pending terraforming expiry terrain target ${groupIndex}:${targetIndex} before-image is invalid.`);
                        }
                    }
                }
                else {
                    ownedExpiryElevation += 1;
                    const appliedElevation = field(target, "appliedElevation", `pending terraforming expiry elevation target ${groupIndex}:${targetIndex}`);
                    const previousElevation = field(target, "previousElevationOverride", `pending terraforming expiry elevation target ${groupIndex}:${targetIndex}`);
                    const projected = nativeMapGet(runtimeElevationOverrides, key);
                    const baseElevation = this.map.getBaseElevation(targetCoord);
                    const effectiveElevationValue = projected?.elevation ?? baseElevation;
                    if (ownedExpiryElevation > TERRAFORMING_LIMITS.activeElevationOverrides
                        || !elevationPolicy
                        || !Number.isSafeInteger(appliedElevation)
                        || effectiveElevationValue !== appliedElevation
                        || (appliedElevation === baseElevation && projected !== undefined)
                        || (appliedElevation !== baseElevation && !projected)
                        || (previousElevation === null && baseElevation === appliedElevation)
                        || (previousElevation !== null && (!Number.isSafeInteger(previousElevation)
                            || previousElevation < elevationPolicy.minimum
                            || previousElevation > elevationPolicy.maximum
                            || previousElevation === appliedElevation
                            || previousElevation === baseElevation))) {
                        fail(`pending terraforming expiry elevation target ${groupIndex}:${targetIndex} projection is invalid.`);
                    }
                }
            }
        }
        const expectedOccupancy = new Map();
        const towerValues = arrayItems(field(gameDescriptors, "towers", "game"), "game towers");
        const towerIds = new Set();
        for (let index = 0; index < towerValues.length; index += 1) {
            const towerDescriptors = ownData(towerValues[index], Object.prototype, `game tower ${index}`);
            const towerId = field(towerDescriptors, "id", `game tower ${index}`);
            if (typeof towerId !== "string" || towerId.length === 0 || towerIds.has(towerId)) {
                return fail(`game tower ${index} has an invalid or duplicate id.`);
            }
            towerIds.add(towerId);
            const footprint = arrayItems(field(towerDescriptors, "footprint", `game tower ${index}`), `game tower ${index} footprint`);
            for (let footprintIndex = 0; footprintIndex < footprint.length; footprintIndex += 1) {
                const footprintCoord = coord(footprint[footprintIndex], `game tower ${index} footprint ${footprintIndex}`);
                const key = coordKey(footprintCoord);
                if (!nativeMapHas(expectedTiles, key) || nativeMapHas(expectedOccupancy, key)) {
                    fail(`game tower ${index} footprint is outside or overlaps the map.`);
                }
                nativeMapSet(expectedOccupancy, key, towerId);
            }
        }
        const tileEntries = mapEntries(liveTiles, "map tiles", baseline.baseTiles.length);
        const seenTileKeys = new Set();
        for (let index = 0; index < tileEntries.length; index += 1) {
            const [key, value] = tileEntries[index];
            if (typeof key !== "string" || seenTileKeys.has(key))
                return fail(`map tile ${index} has an invalid key.`);
            seenTileKeys.add(key);
            const expected = nativeMapGet(expectedTiles, key);
            if (!expected)
                return fail(`map tile ${index} has an unexpected key.`);
            const expectedTowerId = nativeMapGet(expectedOccupancy, key);
            const tileDescriptors = ownData(value, Object.prototype, `map tile ${key}`);
            exactKeys(tileDescriptors, expectedTowerId === undefined ? ["q", "r", "terrain"] : ["q", "r", "terrain", "occupiedBy"], `map tile ${key}`);
            const liveCoord = coord({
                q: field(tileDescriptors, "q", `map tile ${key}`),
                r: field(tileDescriptors, "r", `map tile ${key}`)
            }, `map tile ${key} coordinate`);
            if (coordKey(liveCoord) !== key || liveCoord.q !== expected.q || liveCoord.r !== expected.r) {
                fail(`map tile ${key} coordinates changed.`);
            }
            if (field(tileDescriptors, "terrain", `map tile ${key}`) !== expected.terrain) {
                fail(`map tile ${key} terrain is not backed by a runtime override.`);
            }
            if (expectedTowerId !== undefined
                && field(tileDescriptors, "occupiedBy", `map tile ${key}`) !== expectedTowerId) {
                fail(`map tile ${key} occupancy does not match tower footprints.`);
            }
        }
    }
    checkpointIdentity() {
        return cloneCheckpointJson({
            missionId: this.mission.id,
            difficultyId: this.difficulty.id,
            metaUpgradeLevels: { ...this.metaUpgradeLevels }
        });
    }
    buildCombatState() {
        const cloneRecord = (record) => Object.fromEntries(Object.keys(record).sort().map((id) => {
            const state = record[id];
            return [id, {
                    current: state.current,
                    capacity: state.capacity,
                    regenerationDelayRemaining: state.regenerationDelayRemaining
                }];
        }));
        const enemies = cloneRecord(this.enemyShields);
        const towers = cloneRecord(this.towerShields);
        const markEnemies = Object.fromEntries(Object.keys(this.enemyMarks).sort().map((enemyId) => [
            enemyId,
            Object.fromEntries(Object.keys(this.enemyMarks[enemyId] ?? {}).sort().map((markId) => {
                const state = this.enemyMarks[enemyId][markId];
                return [markId, { stacks: state.stacks, remaining: state.remaining }];
            }))
        ]));
        const hasShields = Object.keys(enemies).length > 0 || Object.keys(towers).length > 0;
        const hasMarks = Object.keys(markEnemies).length > 0;
        if (!hasShields && !hasMarks)
            return undefined;
        if (this.activeCombatMechanics?.schemaVersion === 3) {
            return {
                schemaVersion: 2,
                shields: { enemies, towers },
                marks: { enemies: markEnemies }
            };
        }
        return {
            schemaVersion: 1,
            shields: { enemies, towers }
        };
    }
    buildReactionState() {
        const enemies = cloneEnemyExposureStates(this.enemyExposures, true, true);
        if (Object.keys(enemies).length === 0)
            return undefined;
        return { schemaVersion: 1, exposures: { enemies } };
    }
    consumeNavigationAnalysisField(field, budget) {
        if (budget.fields.has(field))
            return;
        budget.fields.add(field);
        const next = budget.used + field.stats.relaxations;
        if (!Number.isSafeInteger(next) || next > budget.limit) {
            throw new Error(`Navigation analysis relaxation budget limit ${budget.limit} exceeded.`);
        }
        budget.used = next;
    }
    buildNavigationAnalysisFields(request, budget) {
        const resolver = this.createNavigationResolver();
        const lookups = new NavigationFieldLookupCache();
        const movementProfileIds = new Set(request.movementProfileIds);
        const routeIds = new Set(request.routeIds);
        const pairs = this.navigationDiagnosticPairs().filter((pair) => (movementProfileIds.has(pair.movementProfileId) && routeIds.has(pair.routeId)));
        return this.buildNavigationFieldDiagnostics(this.groupNavigationDiagnosticPairs(pairs), (movementProfileId, routeId) => resolver.getField(movementProfileId, routeId), lookups, budget);
    }
    navigationDiagnosticPairs() {
        const pairs = new Map();
        for (const pair of [...this.navigationKnownPairs, ...this.navigationMandatoryPairs]) {
            pairs.set(JSON.stringify([pair.movementProfileId, pair.routeId]), pair);
        }
        for (const enemy of this.enemies) {
            if (!enemy.navigation || !enemy.routeId)
                continue;
            const route = this.resolveDynamicNavigationRoute(enemy.routeId);
            const source = route.pathCenterline[0];
            if (!source)
                continue;
            const pair = {
                movementProfileId: enemy.navigation.movementProfileId,
                routeId: route.id,
                source: { ...source }
            };
            pairs.set(JSON.stringify([pair.movementProfileId, pair.routeId]), pair);
        }
        return [...pairs.values()].sort((left, right) => (compareBinary(left.movementProfileId, right.movementProfileId)
            || compareBinary(left.routeId, right.routeId)));
    }
    groupNavigationDiagnosticPairs(pairs) {
        const grouped = new Map();
        for (const pair of pairs) {
            const route = this.resolveDynamicNavigationRoute(pair.routeId);
            const goal = route.pathCenterline.at(-1);
            if (!goal)
                continue;
            const key = JSON.stringify([pair.movementProfileId, goal.q, goal.r]);
            const group = grouped.get(key) ?? {
                movementProfileId: pair.movementProfileId,
                goal: { ...goal },
                routeIds: new Set()
            };
            group.routeIds.add(route.id);
            grouped.set(key, group);
        }
        return [...grouped.values()]
            .sort((left, right) => (compareBinary(left.movementProfileId, right.movementProfileId)
            || left.goal.r - right.goal.r
            || left.goal.q - right.goal.q));
    }
    buildNavigationFieldDiagnostics(groups, resolveField, lookups, budget) {
        const profile = this.activeNavigationProfile;
        if (!profile)
            return [];
        const terrainByCoord = this.navigationTerrainByCoord();
        const occupiedCoords = this.navigationOccupiedCoords();
        return groups
            .map((group) => {
            const routeIds = [...group.routeIds].sort(compareBinary);
            const field = resolveField(group.movementProfileId, routeIds[0]);
            if (budget)
                this.consumeNavigationAnalysisField(field, budget);
            const lookup = lookups.get(field);
            const reachableRouteIds = [];
            const unreachableRouteIds = [];
            for (const routeId of routeIds) {
                const source = this.resolveDynamicNavigationRoute(routeId).pathCenterline[0];
                (source && lookup.get(source) ? reachableRouteIds : unreachableRouteIds).push(routeId);
            }
            return {
                movementProfileId: group.movementProfileId,
                goal: { ...group.goal },
                routeIds,
                revision: stableDigest({
                    schemaVersion: 1,
                    grid: this.map.grid,
                    width: this.map.width,
                    height: this.map.height,
                    movementProfileId: group.movementProfileId,
                    goal: group.goal,
                    profile: profile.movementProfiles[group.movementProfileId],
                    terrainTypes: this.content.terrainTypes,
                    terrainByCoord,
                    occupiedCoords: profile.movementProfiles[group.movementProfileId]?.towerOccupancy === "blocked"
                        ? occupiedCoords
                        : []
                }),
                reachableTileCount: field.cells.length,
                reachableRouteIds,
                unreachableRouteIds
            };
        });
    }
    buildNavigationSnapshot() {
        if (!this.activeNavigationProfile || !this.navigationResolver || !this.navigationFieldLookupCache)
            return undefined;
        const fields = this.buildNavigationFieldDiagnostics(this.groupNavigationDiagnosticPairs(this.navigationDiagnosticPairs()), (movementProfileId, routeId) => (this.navigationResolver.peekField(movementProfileId, routeId)
            ?? this.navigationField(movementProfileId, routeId)), this.navigationFieldLookupCache);
        const stalledEnemyIds = this.enemies
            .filter((enemy) => enemy.hp > 0 && enemy.navigation && !enemy.navigation.nextCoord && !this.dynamicEnemyAtGoal(enemy))
            .map((enemy) => enemy.id)
            .sort(compareBinary);
        return { schemaVersion: 1, mode: "dynamic_flow", fields, stalledEnemyIds };
    }
    buildElevationSnapshot(copyStaticState) {
        if (!this.activeElevation)
            return undefined;
        if (!copyStaticState && this.runtimeElevationOverrides.size === 0)
            return this.staticElevationSnapshot;
        return {
            schemaVersion: 1,
            defaultElevation: 0,
            overrides: this.map.getEffectiveElevationOverrides()
        };
    }
    buildArtifactCheckpointState() {
        if (!this.activeRogueliteMechanics?.artifacts
            || !this.artifactInitialRngState
            || !this.artifactRng)
            return undefined;
        const base = {
            rng: {
                initial: this.artifactInitialRngState,
                current: this.artifactRng.exportState()
            },
            nextInstanceSequence: this.nextArtifactInstanceSequence
        };
        return this.artifactCheckpointForm === 3
            ? {
                schemaVersion: 3,
                ...base,
                inventory: this.artifactInventory.map((entry) => ({
                    instanceId: entry.instanceId,
                    artifactId: entry.artifactId,
                    socket: entry.socket === null ? null : { ...entry.socket }
                }))
            }
            : this.artifactCheckpointForm === 2
                ? {
                    schemaVersion: 2,
                    ...base,
                    inventory: this.artifactInventory.map((entry) => ({
                        instanceId: entry.instanceId,
                        artifactId: entry.artifactId,
                        socket: entry.socket === null ? null : { ...entry.socket }
                    }))
                }
                : {
                    schemaVersion: 1,
                    ...base,
                    inventory: this.artifactInventory.map((entry) => ({
                        instanceId: entry.instanceId,
                        artifactId: entry.artifactId
                    }))
                };
    }
    buildDraftCheckpointState() {
        if (!this.activeRogueliteMechanics?.draft || !this.draftInitialRngState || !this.draftRng)
            return undefined;
        return {
            schemaVersion: this.campaignBattle ? 2 : 1,
            rng: {
                initial: this.draftInitialRngState,
                current: this.draftRng.exportState()
            },
            nextOfferSequence: this.nextDraftOfferSequence,
            pendingOffer: this.pendingDraftOffer === null ? null : {
                offerId: this.pendingDraftOffer.offerId,
                afterWaveIndex: this.pendingDraftOffer.afterWaveIndex,
                poolId: this.pendingDraftOffer.poolId,
                cardIds: [...this.pendingDraftOffer.cardIds]
            },
            selections: this.draftSelections.map((selection) => ({ ...selection }))
        };
    }
    buildCheckpointState() {
        const enemies = this.enemies.map((enemy) => ({
            id: enemy.id,
            typeId: enemy.typeId,
            hp: enemy.hp,
            maxHp: enemy.maxHp,
            pathProgress: enemy.pathProgress,
            dotRemaining: enemy.dotRemaining,
            ...(enemy.dotDamagePerUnit === undefined ? {} : { dotDamagePerUnit: enemy.dotDamagePerUnit }),
            ...(enemy.dotSourceTowerTypeId === undefined ? {} : { dotSourceTowerTypeId: enemy.dotSourceTowerTypeId }),
            pathOffset: enemy.pathOffset,
            ...(enemy.routeId === undefined ? {} : { routeId: enemy.routeId }),
            ...(!this.activeNavigationProfile || enemy.navigation === undefined ? {} : {
                navigation: {
                    schemaVersion: enemy.navigation.schemaVersion,
                    movementProfileId: enemy.navigation.movementProfileId,
                    currentCoord: { ...enemy.navigation.currentCoord },
                    ...(enemy.navigation.nextCoord === undefined ? {} : { nextCoord: { ...enemy.navigation.nextCoord } }),
                    edgeProgress: enemy.navigation.edgeProgress,
                    stepsEntered: enemy.navigation.stepsEntered
                }
            }),
            ...(enemy.phaseSpawnsTriggered === undefined ? {} : { phaseSpawnsTriggered: [...enemy.phaseSpawnsTriggered] }),
            ...(enemy.statuses === undefined ? {} : {
                statuses: {
                    ...(enemy.statuses.slow === undefined ? {} : { slow: { ...enemy.statuses.slow } }),
                    ...(enemy.statuses.stun === undefined ? {} : { stun: { ...enemy.statuses.stun } }),
                    ...(enemy.statuses.poison === undefined ? {} : { poison: { ...enemy.statuses.poison } })
                }
            }),
            ...(enemy.disruptCooldown === undefined ? {} : { disruptCooldown: enemy.disruptCooldown }),
            ...(enemy.towerAttackCooldown === undefined ? {} : { towerAttackCooldown: enemy.towerAttackCooldown })
        }));
        const towers = this.towers.map((tower) => ({
            id: tower.id,
            typeId: tower.typeId,
            coord: { ...tower.coord },
            footprint: tower.footprint.map((coord) => ({ ...coord })),
            level: tower.level,
            ...(tower.targetMode === undefined ? {} : { targetMode: tower.targetMode }),
            stacks: tower.stacks,
            cooldown: tower.cooldown,
            investedResources: { ...tower.investedResources },
            ...(tower.disabledFor === undefined ? {} : { disabledFor: tower.disabledFor }),
            ...(tower.hp === undefined ? {} : { hp: tower.hp })
        }));
        const combat = this.buildCombatState();
        const reactions = this.buildReactionState();
        const artifacts = this.buildArtifactCheckpointState();
        const draft = this.buildDraftCheckpointState();
        const heroes = this.heroStateV2 === undefined
            ? undefined
            : (this.activeHeroesMechanics?.schemaVersion === 5 || this.activeHeroesMechanics?.schemaVersion === 6)
                && this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]?.skillTree !== null
                ? {
                    schemaVersion: 4,
                    unit: {
                        definitionId: this.heroStateV2.definitionId,
                        currentCoord: { ...this.heroStateV2.currentCoord },
                        targetCoord: this.heroStateV2.targetCoord === null ? null : { ...this.heroStateV2.targetCoord },
                        nextCoord: this.heroStateV2.nextCoord === null ? null : { ...this.heroStateV2.nextCoord },
                        edgeProgress: this.heroStateV2.edgeProgress,
                        hp: this.heroStateV2.hp ?? 0,
                        shieldCurrent: this.heroStateV2.shieldCurrent ?? 0,
                        mana: this.heroStateV2.mana ?? 0,
                        abilityCooldownRemaining: this.heroStateV2.abilityCooldownRemaining ?? 0,
                        skillPoints: this.heroStateV2.skillPoints ?? 0,
                        unlockedSkillIds: [...(this.heroStateV2.unlockedSkillIds ?? [])].sort(compareBinary)
                    }
                }
                : this.activeHeroesMechanics?.schemaVersion === 4
                    || ((this.activeHeroesMechanics?.schemaVersion === 5 || this.activeHeroesMechanics?.schemaVersion === 6)
                        && this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]?.skillTree === null)
                    ? {
                        schemaVersion: 3,
                        unit: {
                            definitionId: this.heroStateV2.definitionId,
                            currentCoord: { ...this.heroStateV2.currentCoord },
                            targetCoord: this.heroStateV2.targetCoord === null ? null : { ...this.heroStateV2.targetCoord },
                            nextCoord: this.heroStateV2.nextCoord === null ? null : { ...this.heroStateV2.nextCoord },
                            edgeProgress: this.heroStateV2.edgeProgress,
                            hp: this.heroStateV2.hp ?? 0,
                            shieldCurrent: this.heroStateV2.shieldCurrent ?? 0,
                            mana: this.heroStateV2.mana ?? 0,
                            abilityCooldownRemaining: this.heroStateV2.abilityCooldownRemaining ?? 0
                        }
                    }
                    : this.activeHeroesMechanics?.schemaVersion === 3
                        ? {
                            schemaVersion: 2,
                            unit: {
                                definitionId: this.heroStateV2.definitionId,
                                currentCoord: { ...this.heroStateV2.currentCoord },
                                targetCoord: this.heroStateV2.targetCoord === null ? null : { ...this.heroStateV2.targetCoord },
                                nextCoord: this.heroStateV2.nextCoord === null ? null : { ...this.heroStateV2.nextCoord },
                                edgeProgress: this.heroStateV2.edgeProgress,
                                hp: this.heroStateV2.hp ?? 0,
                                shieldCurrent: this.heroStateV2.shieldCurrent ?? 0
                            }
                        }
                        : {
                            schemaVersion: 1,
                            unit: {
                                definitionId: this.heroStateV2.definitionId,
                                currentCoord: { ...this.heroStateV2.currentCoord },
                                targetCoord: this.heroStateV2.targetCoord === null ? null : { ...this.heroStateV2.targetCoord },
                                nextCoord: this.heroStateV2.nextCoord === null ? null : { ...this.heroStateV2.nextCoord },
                                edgeProgress: this.heroStateV2.edgeProgress
                            }
                        };
        const runtimeElevationOverrides = [...this.runtimeElevationOverrides.values()]
            .sort((left, right) => left.r - right.r || left.q - right.q)
            .map((entry) => ({ q: entry.q, r: entry.r, elevation: entry.elevation }));
        const terraforming = this.terraformingCheckpointForm === 0
            ? undefined
            : this.terraformingCheckpointForm === 1
                ? {
                    schemaVersion: 1,
                    runtimeElevationOverrides
                }
                : {
                    schemaVersion: 2,
                    runtimeElevationOverrides,
                    nextExpiryGroupSequence: this.nextTerraformExpirySequence,
                    pendingExpiryGroups: this.pendingTerraformExpiryGroups.map((group) => ({
                        sequence: group.sequence,
                        remaining: group.remaining,
                        entries: group.targets.map((target) => target.layer === "terrain"
                            ? {
                                layer: "terrain",
                                order: target.order,
                                q: target.q,
                                r: target.r,
                                appliedTerrain: target.appliedTerrain,
                                previousOverride: target.previousOverride === null
                                    ? null
                                    : {
                                        terrain: target.previousOverride.terrain,
                                        source: target.previousOverride.source
                                    }
                            }
                            : {
                                layer: "elevation",
                                order: target.order,
                                q: target.q,
                                r: target.r,
                                appliedElevation: target.appliedElevation,
                                previousElevationOverride: target.previousElevationOverride
                            })
                    }))
                };
        const state = {
            coreHp: this.coreHp,
            resources: { ...this.resources },
            waveIndex: this.waveIndex,
            startedWaveCount: this.startedWaveCount,
            waveState: this.waveState,
            prepRemaining: this.prepRemaining,
            outcome: this.outcome,
            enemies,
            towers,
            lastEvents: this.lastEvents,
            enemyCounter: this.enemyCounter,
            towerCounter: this.towerCounter,
            clearedWaveCount: this.clearedWaveCount,
            killCount: this.killCount,
            leakCount: this.leakCount,
            killCountByEnemyType: { ...this.killCountByEnemyType },
            completedObjectiveIds: [...this.completedObjectiveIds].sort(),
            earnedStarIds: [...this.earnedStarIds].sort(),
            spawnQueue: this.spawnQueue.map((item) => ({
                at: item.at,
                enemyId: item.enemyId,
                ...(item.routeId === undefined ? {} : { routeId: item.routeId })
            })),
            missionElapsed: this.missionElapsed,
            nextWaveStartAt: this.nextWaveStartAt,
            abilityCooldowns: Object.fromEntries(Object.entries(this.abilityCooldowns).filter((entry) => typeof entry[1] === "number")),
            runtimeTerrainOverrides: [...this.runtimeTerrainOverrides.values()].map((entry) => ({
                q: entry.q,
                r: entry.r,
                terrain: entry.terrain,
                source: entry.source,
                ...(entry.expiresIn === undefined ? {} : { expiresIn: entry.expiresIn })
            })),
            ...(terraforming === undefined ? {} : { terraforming }),
            scriptValues: this.scriptValues,
            scriptDiagnostics: this.scriptDiagnostics.map((diagnostic) => ({
                scriptId: diagnostic.scriptId,
                ...(diagnostic.handlerId === undefined ? {} : { handlerId: diagnostic.handlerId }),
                event: diagnostic.event,
                code: diagnostic.code,
                message: diagnostic.message
            })),
            scriptHandlerLastRun: { ...this.scriptHandlerLastRun },
            scriptEventCursor: this.scriptEventCursor,
            scriptActionsRemaining: this.scriptActionsRemaining,
            scriptTerrainChangesRemaining: this.scriptTerrainChangesRemaining,
            scriptSignalDepth: this.scriptSignalDepth,
            ...(combat === undefined ? {} : { combat }),
            ...(reactions === undefined ? {} : { reactions }),
            ...(artifacts === undefined ? {} : { artifacts }),
            ...(draft === undefined ? {} : { draft }),
            ...(heroes === undefined ? {} : { heroes }),
            ...(this.campaignBattle === undefined ? {} : {
                campaignBattle: {
                    schemaVersion: 1,
                    launchId: this.campaignBattle.launchId,
                    nodeId: this.campaignBattle.nodeId,
                    maxNewArtifactInstances: this.campaignBattle.maxNewArtifactInstances,
                    deck: this.campaignBattle.deck.map((entry) => ({ ...entry })),
                    artifacts: this.campaignBattle.artifacts.map((entry) => ({ ...entry }))
                }
            })
        };
        return cloneCheckpointJson(state);
    }
    static validateCheckpointIdentity(content, identity) {
        const descriptors = checkpointObjectDescriptors(identity, "Game checkpoint identity");
        requireExactCheckpointKeys(descriptors, ["missionId", "difficultyId", "metaUpgradeLevels"], "Game checkpoint identity");
        const missionId = checkpointDataField(descriptors, "missionId", "Game checkpoint identity");
        const difficultyId = checkpointDataField(descriptors, "difficultyId", "Game checkpoint identity");
        const levelsValue = checkpointDataField(descriptors, "metaUpgradeLevels", "Game checkpoint identity");
        if (typeof missionId !== "string" || !Object.prototype.hasOwnProperty.call(content.missions, missionId)) {
            throw new Error("Game checkpoint identity references an unknown mission.");
        }
        if (typeof difficultyId !== "string" || !content.difficulties.some((item) => item.id === difficultyId)) {
            throw new Error("Game checkpoint identity references an unknown difficulty.");
        }
        const levelDescriptors = checkpointObjectDescriptors(levelsValue, "Game checkpoint meta upgrade levels");
        const authoredUpgradeIds = Object.keys(content.metaProgression.upgrades).sort();
        const checkpointUpgradeIds = Object.keys(levelDescriptors).sort();
        if (authoredUpgradeIds.length !== checkpointUpgradeIds.length ||
            authoredUpgradeIds.some((upgradeId, index) => upgradeId !== checkpointUpgradeIds[index])) {
            throw new Error("Game checkpoint identity has an unknown or missing meta upgrade.");
        }
        for (const upgradeId of checkpointUpgradeIds) {
            const level = checkpointDataField(levelDescriptors, upgradeId, "Game checkpoint meta upgrade levels");
            const upgrade = content.metaProgression.upgrades[upgradeId];
            if (!upgrade || typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > upgrade.maxLevel) {
                throw new Error(`Game checkpoint meta upgrade level for "${upgradeId}" is invalid.`);
            }
        }
    }
    static validateCheckpointState(content, identity, state, rootInitialRng) {
        const descriptors = checkpointObjectDescriptors(state, "Game checkpoint state");
        const required = [
            "coreHp", "resources", "waveIndex", "startedWaveCount", "waveState", "prepRemaining", "outcome",
            "enemies", "towers", "lastEvents", "enemyCounter", "towerCounter", "clearedWaveCount", "killCount",
            "leakCount", "killCountByEnemyType", "completedObjectiveIds", "earnedStarIds", "spawnQueue",
            "missionElapsed", "nextWaveStartAt", "abilityCooldowns", "runtimeTerrainOverrides", "scriptValues",
            "scriptDiagnostics", "scriptHandlerLastRun", "scriptEventCursor", "scriptActionsRemaining",
            "scriptTerrainChangesRemaining", "scriptSignalDepth"
        ];
        for (const key of required)
            checkpointDataField(descriptors, key, "Game checkpoint state");
        const checkpointTerraforming = resolveActiveTerraformingMechanics(content, identity.missionId);
        const checkpointRoguelite = resolveActiveRogueliteMechanics(content, identity.missionId);
        const checkpointHeroes = resolveActiveHeroesMechanics(content, identity.missionId);
        const mission = content.missions[identity.missionId];
        const requiresArtifactCheckpoint = checkpointRoguelite?.artifacts !== undefined;
        const requiresDraftCheckpoint = checkpointRoguelite?.draft !== undefined;
        const requiresElevationTerraformingCheckpoint = (resolveActiveElevationMechanics(content, identity.missionId) !== undefined
            && checkpointTerraforming?.elevation !== undefined);
        const hasTerraformingCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "terraforming");
        if (requiresElevationTerraformingCheckpoint && !hasTerraformingCheckpoint) {
            throw new Error("Game checkpoint terraforming state is missing.");
        }
        if (!checkpointTerraforming && hasTerraformingCheckpoint) {
            throw new Error("Game checkpoint terraforming state is unsupported for an inactive capability.");
        }
        if (hasTerraformingCheckpoint) {
            checkpointDataField(descriptors, "terraforming", "Game checkpoint state");
        }
        const hasArtifactCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "artifacts");
        if (requiresArtifactCheckpoint && !hasArtifactCheckpoint) {
            throw new Error("Game checkpoint artifact state is required for active roguelite v2.");
        }
        if (!requiresArtifactCheckpoint && hasArtifactCheckpoint) {
            throw new Error("Game checkpoint artifact state is unsupported for an inactive capability.");
        }
        if (hasArtifactCheckpoint)
            checkpointDataField(descriptors, "artifacts", "Game checkpoint state");
        const hasDraftCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "draft");
        if (requiresDraftCheckpoint && !hasDraftCheckpoint) {
            throw new Error("Game checkpoint draft state is required for active wave draft.");
        }
        if (!requiresDraftCheckpoint && hasDraftCheckpoint) {
            throw new Error("Game checkpoint draft state is unsupported for an inactive capability.");
        }
        if (hasDraftCheckpoint)
            checkpointDataField(descriptors, "draft", "Game checkpoint state");
        const hasCampaignBattleCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "campaignBattle");
        if (hasCampaignBattleCheckpoint)
            checkpointDataField(descriptors, "campaignBattle", "Game checkpoint state");
        const requiresHeroesCheckpoint = checkpointHeroes?.schemaVersion === 2
            || checkpointHeroes?.schemaVersion === 3
            || checkpointHeroes?.schemaVersion === 4
            || checkpointHeroes?.schemaVersion === 5
            || checkpointHeroes?.schemaVersion === 6;
        const hasHeroesCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "heroes");
        if (requiresHeroesCheckpoint && !hasHeroesCheckpoint) {
            throw new Error("Game checkpoint hero state is required for active moving heroes.");
        }
        if (!requiresHeroesCheckpoint && hasHeroesCheckpoint) {
            throw new Error("Game checkpoint hero state is unsupported for an inactive or static capability.");
        }
        if (hasHeroesCheckpoint)
            checkpointDataField(descriptors, "heroes", "Game checkpoint state");
        requireExactCheckpointKeys(descriptors, [
            ...required,
            ...(hasTerraformingCheckpoint ? ["terraforming"] : []),
            ...(Object.prototype.hasOwnProperty.call(descriptors, "combat") ? ["combat"] : []),
            ...(Object.prototype.hasOwnProperty.call(descriptors, "reactions") ? ["reactions"] : []),
            ...(hasArtifactCheckpoint ? ["artifacts"] : []),
            ...(hasDraftCheckpoint ? ["draft"] : []),
            ...(hasCampaignBattleCheckpoint ? ["campaignBattle"] : []),
            ...(hasHeroesCheckpoint ? ["heroes"] : [])
        ], "Game checkpoint state");
        const finite = (value, label, minimum = 0, maximum = Infinity) => {
            if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
                throw new Error(`Game checkpoint state ${label} is invalid.`);
            }
            return value;
        };
        const integer = (value, label, minimum = 0) => {
            const result = finite(value, label, minimum);
            if (!Number.isSafeInteger(result))
                throw new Error(`Game checkpoint state ${label} must be a safe integer.`);
            return result;
        };
        const array = (value, label) => {
            if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
                throw new Error(`Game checkpoint state ${label} must be an array.`);
            }
            return value;
        };
        const closed = (value, label, requiredKeys, optionalKeys = []) => {
            const result = checkpointObjectDescriptors(value, `Game checkpoint state ${label}`);
            for (const key of requiredKeys)
                checkpointDataField(result, key, `Game checkpoint state ${label}`);
            const allowed = new Set([...requiredKeys, ...optionalKeys]);
            if (Object.keys(result).some((key) => !allowed.has(key))) {
                throw new Error(`Game checkpoint state ${label} contains an unsupported field.`);
            }
            return result;
        };
        const stringValue = (value, label) => {
            if (typeof value !== "string")
                throw new Error(`Game checkpoint state ${label} must be a string.`);
            return value;
        };
        const own = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
        const recordNumbers = (value, label, allowedKeys, integersOnly = false) => {
            const entries = checkpointObjectDescriptors(value, `Game checkpoint state ${label}`);
            for (const key of Object.keys(entries)) {
                if (allowedKeys && !allowedKeys.has(key))
                    throw new Error(`Game checkpoint state ${label} references unknown id "${key}".`);
                const number = finite(checkpointDataField(entries, key, label), `${label}.${key}`);
                if (integersOnly && !Number.isInteger(number))
                    throw new Error(`Game checkpoint state ${label}.${key} must be an integer.`);
            }
        };
        const stringArray = (value, label, unique = false) => {
            const result = array(value, label).map((item) => stringValue(item, `${label} entry`));
            if (unique && new Set(result).size !== result.length) {
                throw new Error(`Game checkpoint state ${label} contains duplicate ids.`);
            }
            return result;
        };
        let campaignBattleState;
        if (hasCampaignBattleCheckpoint) {
            if (checkpointRoguelite?.schemaVersion !== 4 || checkpointRoguelite.campaign?.schemaVersion !== 2) {
                throw new Error("Game checkpoint campaign battle state is unsupported for an inactive handoff.");
            }
            const campaign = closed(state.campaignBattle, "campaign battle state", ["schemaVersion", "launchId", "nodeId", "maxNewArtifactInstances", "deck", "artifacts"]);
            if (checkpointDataField(campaign, "schemaVersion", "campaign battle state") !== 1) {
                throw new Error("Game checkpoint campaign battle state schema version is unsupported.");
            }
            const launchId = stringValue(checkpointDataField(campaign, "launchId", "campaign battle state"), "campaign launchId");
            const nodeId = stringValue(checkpointDataField(campaign, "nodeId", "campaign battle state"), "campaign nodeId");
            const maxNewArtifactInstances = integer(checkpointDataField(campaign, "maxNewArtifactInstances", "campaign battle state"), "campaign maxNewArtifactInstances");
            if (maxNewArtifactInstances > ROGUELITE_ARTIFACT_INVENTORY_LIMIT) {
                throw new Error("Game checkpoint campaign artifact acquisition limit is invalid.");
            }
            if (!/^[0-9a-f]{16}$/.test(launchId)
                || nodeId.length === 0
                || nodeId.length > CAMPAIGN_RUN_LIMITS.identifierCodeUnits) {
                throw new Error("Game checkpoint campaign battle identity is invalid.");
            }
            const normalizePortable = (value, field) => {
                const definitions = field === "cardId" ? checkpointRoguelite.draft?.definitions : checkpointRoguelite.artifacts?.definitions;
                const seen = new Set();
                return array(value, `campaign ${field} entries`).map((item) => {
                    const entry = closed(item, `campaign ${field} entry`, ["instanceId", field]);
                    const instanceId = stringValue(checkpointDataField(entry, "instanceId", `campaign ${field} entry`), `campaign ${field} instanceId`);
                    const definitionId = stringValue(checkpointDataField(entry, field, `campaign ${field} entry`), `campaign ${field}`);
                    if (instanceId.length === 0
                        || instanceId.length > CAMPAIGN_RUN_LIMITS.identifierCodeUnits
                        || seen.has(instanceId)
                        || !definitions
                        || !Object.prototype.hasOwnProperty.call(definitions, definitionId))
                        throw new Error(`Game checkpoint campaign ${field} entry is invalid.`);
                    seen.add(instanceId);
                    return { instanceId, [field]: definitionId };
                });
            };
            campaignBattleState = {
                schemaVersion: 1,
                launchId,
                nodeId,
                maxNewArtifactInstances,
                deck: normalizePortable(checkpointDataField(campaign, "deck", "campaign battle state"), "cardId"),
                artifacts: normalizePortable(checkpointDataField(campaign, "artifacts", "campaign battle state"), "artifactId")
            };
            if (campaignBattleState.deck.length + campaignBattleState.artifacts.length
                > CAMPAIGN_RUN_LIMITS.collectionEntries)
                throw new Error("Game checkpoint campaign loadout exceeds the aggregate CampaignRun collection limit.");
            if (campaignBattleWorstCaseModifierCount(campaignBattleState.deck, content, identity.missionId)
                > MAX_MODIFIERS_PER_RESOLUTION)
                throw new Error("Game checkpoint campaign loadout exceeds the shared modifier budget.");
            const numericPreflight = preflightHeroAuraDamageFinite(content, identity.missionId, {
                deck: campaignBattleState.deck
            });
            if (!numericPreflight.ok)
                throw new Error(numericPreflight.message);
        }
        let campaignArtifactInventoryCount = 0;
        let campaignDraftSelectionCount = 0;
        const artifactSockets = [];
        if (requiresArtifactCheckpoint) {
            const artifactState = state.artifacts;
            if (!artifactState)
                throw new Error("Game checkpoint artifact state is required.");
            const artifact = closed(artifactState, "artifact state", ["schemaVersion", "rng", "nextInstanceSequence", "inventory"]);
            const artifactSchemaVersion = checkpointDataField(artifact, "schemaVersion", "artifact state");
            if (artifactSchemaVersion !== 1 && artifactSchemaVersion !== 2 && artifactSchemaVersion !== 3) {
                throw new Error("Game checkpoint artifact state schema version is unsupported.");
            }
            if ((artifactSchemaVersion === 3) !== Boolean(campaignBattleState)) {
                throw new Error("Game checkpoint campaign artifact state and handoff context are inconsistent.");
            }
            const artifactRng = closed(checkpointDataField(artifact, "rng", "artifact state"), "artifact RNG", ["initial", "current"]);
            const artifactInitial = checkpointDataField(artifactRng, "initial", "artifact RNG");
            const artifactCurrent = checkpointDataField(artifactRng, "current", "artifact RNG");
            for (const [label, rngState] of [["initial", artifactInitial], ["current", artifactCurrent]]) {
                closed(rngState, `artifact ${label} RNG state`, ["schemaVersion", "algorithm", "words"]);
                SeededRng.fromState(rngState);
            }
            const inventory = array(checkpointDataField(artifact, "inventory", "artifact state"), "artifact inventory");
            if (campaignBattleState)
                campaignArtifactInventoryCount = inventory.length;
            if (inventory.length > ROGUELITE_ARTIFACT_INVENTORY_LIMIT) {
                throw new Error("Game checkpoint artifact inventory budget is exceeded.");
            }
            const reachableArtifactIds = new Set(Object.values(checkpointRoguelite.artifacts.bossLootTables)
                .flatMap((table) => table.entries.map((entry) => entry.artifactId)));
            const seenInstances = new Set();
            for (let index = 0; index < inventory.length; index += 1) {
                const entry = closed(inventory[index], "artifact inventory entry", artifactSchemaVersion === 2 || artifactSchemaVersion === 3
                    ? ["instanceId", "artifactId", "socket"]
                    : ["instanceId", "artifactId"]);
                const instanceId = stringValue(checkpointDataField(entry, "instanceId", "artifact inventory entry"), "artifact inventory instanceId");
                const artifactId = stringValue(checkpointDataField(entry, "artifactId", "artifact inventory entry"), "artifact inventory artifactId");
                const carriedArtifact = campaignBattleState?.artifacts[index];
                const validCampaignInstance = artifactSchemaVersion === 3 && (carriedArtifact
                    ? carriedArtifact.instanceId === instanceId && carriedArtifact.artifactId === artifactId
                    : instanceId === `campaign:${campaignBattleState.launchId}:artifact:${index + 1}`);
                if (seenInstances.has(instanceId)
                    || (artifactSchemaVersion !== 3 && instanceId !== `artifact_${index + 1}`)
                    || (artifactSchemaVersion === 3 && !validCampaignInstance)) {
                    throw new Error("Game checkpoint artifact inventory has an invalid or duplicate instance id.");
                }
                if (!checkpointRoguelite.artifacts.definitions[artifactId]) {
                    throw new Error("Game checkpoint artifact inventory references an unknown definition.");
                }
                if ((artifactSchemaVersion !== 3 || !carriedArtifact)
                    && !reachableArtifactIds.has(artifactId)) {
                    throw new Error("Game checkpoint artifact inventory references an artifact unreachable from authored loot tables.");
                }
                if (artifactSchemaVersion === 2 || artifactSchemaVersion === 3) {
                    const socketValue = checkpointDataField(entry, "socket", "artifact inventory entry");
                    if (socketValue !== null) {
                        const socket = closed(socketValue, "artifact socket", ["towerId", "slotId"]);
                        artifactSockets.push({
                            instanceId,
                            artifactId,
                            towerId: stringValue(checkpointDataField(socket, "towerId", "artifact socket"), "artifact socket towerId"),
                            slotId: stringValue(checkpointDataField(socket, "slotId", "artifact socket"), "artifact socket slotId")
                        });
                    }
                }
                seenInstances.add(instanceId);
            }
            if (artifactSchemaVersion === 3 && inventory.length < (campaignBattleState?.artifacts.length ?? 0)) {
                throw new Error("Game checkpoint campaign artifact inventory is missing carried entries.");
            }
            if (artifactSchemaVersion === 3
                && inventory.length - (campaignBattleState?.artifacts.length ?? 0) > (campaignBattleState?.maxNewArtifactInstances ?? 0))
                throw new Error("Game checkpoint campaign artifact acquisition limit is exceeded.");
            const nextInstanceSequence = integer(checkpointDataField(artifact, "nextInstanceSequence", "artifact state"), "artifact nextInstanceSequence", 1);
            if (nextInstanceSequence !== inventory.length + 1) {
                throw new Error("Game checkpoint artifact instance sequence is incoherent with inventory.");
            }
        }
        if (requiresDraftCheckpoint) {
            const draftDefinition = checkpointRoguelite?.draft;
            const draftState = state.draft;
            if (!draftDefinition || !draftState)
                throw new Error("Game checkpoint draft state is required.");
            const draft = closed(draftState, "draft state", ["schemaVersion", "rng", "nextOfferSequence", "pendingOffer", "selections"]);
            const draftSchemaVersion = checkpointDataField(draft, "schemaVersion", "draft state");
            if (draftSchemaVersion !== 1 && draftSchemaVersion !== 2) {
                throw new Error("Game checkpoint draft state schema version is unsupported.");
            }
            if ((draftSchemaVersion === 2) !== Boolean(campaignBattleState)) {
                throw new Error("Game checkpoint campaign draft state and handoff context are inconsistent.");
            }
            const draftRng = closed(checkpointDataField(draft, "rng", "draft state"), "draft RNG", ["initial", "current"]);
            const draftInitial = checkpointDataField(draftRng, "initial", "draft RNG");
            const draftCurrent = checkpointDataField(draftRng, "current", "draft RNG");
            for (const [label, rngState] of [["initial", draftInitial], ["current", draftCurrent]]) {
                closed(rngState, `draft ${label} RNG state`, ["schemaVersion", "algorithm", "words"]);
                SeededRng.fromState(rngState);
            }
            const expectedDraftInitial = new SeededRng(waveDraftSeed(rootInitialRng, identity.missionId)).exportState();
            if (canonicalStringify(draftInitial) !== canonicalStringify(expectedDraftInitial)) {
                throw new Error("Game checkpoint draft initial RNG does not match the simulation seed domain.");
            }
            const replayDraftRng = SeededRng.fromState(draftInitial);
            const selections = array(checkpointDataField(draft, "selections", "draft state"), "draft selections");
            if (campaignBattleState)
                campaignDraftSelectionCount = selections.length;
            if (selections.length > ROGUELITE_DRAFT_LIMITS.selections) {
                throw new Error("Game checkpoint draft selections exceed the selection budget.");
            }
            if (selections.length > Math.max(0, mission.waves.length - 1)) {
                throw new Error("Game checkpoint draft selections exceed the mission inter-wave opportunities.");
            }
            for (let index = 0; index < selections.length; index += 1) {
                const selection = closed(selections[index], "draft selection", draftSchemaVersion === 2 ? ["sequence", "offerId", "cardId", "instanceId"] : ["sequence", "offerId", "cardId"]);
                const sequence = integer(checkpointDataField(selection, "sequence", "draft selection"), "draft selection sequence", 1);
                const offerId = stringValue(checkpointDataField(selection, "offerId", "draft selection"), "draft selection offerId");
                const cardId = stringValue(checkpointDataField(selection, "cardId", "draft selection"), "draft selection cardId");
                const offeredCardIds = sampleDraftOfferCardIds(draftDefinition, draftDefinition.defaultPoolId, replayDraftRng);
                if (sequence !== index + 1
                    || offerId !== `draft_offer_${sequence}`
                    || !draftDefinition.definitions[cardId]
                    || !offeredCardIds.includes(cardId)) {
                    throw new Error("Game checkpoint draft selection sequence, offer, or card is invalid.");
                }
                if (draftSchemaVersion === 2) {
                    const instanceId = stringValue(checkpointDataField(selection, "instanceId", "draft selection"), "draft selection instanceId");
                    if (instanceId !== `campaign:${campaignBattleState.launchId}:card:${sequence}`) {
                        throw new Error("Game checkpoint campaign draft selection instance is invalid.");
                    }
                }
            }
            const pendingValue = checkpointDataField(draft, "pendingOffer", "draft state");
            if (pendingValue !== null) {
                const pending = closed(pendingValue, "draft pending offer", ["offerId", "afterWaveIndex", "poolId", "cardIds"]);
                const offerId = stringValue(checkpointDataField(pending, "offerId", "draft pending offer"), "draft offerId");
                const afterWaveIndex = integer(checkpointDataField(pending, "afterWaveIndex", "draft pending offer"), "draft afterWaveIndex");
                const poolId = stringValue(checkpointDataField(pending, "poolId", "draft pending offer"), "draft poolId");
                if (poolId !== draftDefinition.defaultPoolId) {
                    throw new Error("Game checkpoint draft pending offer must use the authored default pool.");
                }
                const cardIds = stringArray(checkpointDataField(pending, "cardIds", "draft pending offer"), "draft pending cardIds", true);
                const pool = draftDefinition.pools[poolId];
                const nextOfferSequence = integer(checkpointDataField(draft, "nextOfferSequence", "draft state"), "draft nextOfferSequence", 1);
                const expectedCardIds = sampleDraftOfferCardIds(draftDefinition, poolId, replayDraftRng);
                if (cardIds.length !== ROGUELITE_DRAFT_LIMITS.offerSize
                    || offerId !== `draft_offer_${nextOfferSequence - 1}`
                    || nextOfferSequence !== selections.length + 2
                    || afterWaveIndex !== state.clearedWaveCount - 1
                    || afterWaveIndex >= mission.waves.length - 1
                    || !pool
                    || cardIds.some((cardId) => (!draftDefinition.definitions[cardId]
                        || !pool.entries.some((entry) => entry.cardId === cardId)))
                    || cardIds.some((cardId, index) => cardId !== expectedCardIds[index])
                    || state.outcome !== "playing"
                    || state.waveState !== "between"
                    || state.startedWaveCount !== state.clearedWaveCount
                    || state.enemies.length !== 0
                    || state.spawnQueue.length !== 0
                    || state.nextWaveStartAt !== null
                    || state.prepRemaining !== 0
                    || state.scriptActionsRemaining !== TOWER_SCRIPT_LIMITS.actionsPerTransaction
                    || state.scriptTerrainChangesRemaining !== TOWER_SCRIPT_LIMITS.terrainChangesPerTransaction
                    || state.scriptSignalDepth !== 0) {
                    throw new Error("Game checkpoint draft pending offer is incoherent with authored cards or sequence.");
                }
            }
            else {
                const nextOfferSequence = integer(checkpointDataField(draft, "nextOfferSequence", "draft state"), "draft nextOfferSequence", 1);
                if (nextOfferSequence !== selections.length + 1) {
                    throw new Error("Game checkpoint draft offer sequence is incoherent with selections.");
                }
            }
            const pendingCount = pendingValue === null ? 0 : 1;
            const clearedDelta = state.clearedWaveCount - selections.length;
            const finalWaveCleared = state.clearedWaveCount === mission.waves.length;
            if ((pendingCount === 1 && (clearedDelta !== 1 || finalWaveCleared))
                || (pendingCount === 0 && (clearedDelta !== 0
                    && !(clearedDelta === 1 && (state.outcome !== "playing" || finalWaveCleared))))) {
                throw new Error("Game checkpoint draft phase is incoherent with cleared waves and terminal outcome.");
            }
            if (canonicalStringify(replayDraftRng.exportState()) !== canonicalStringify(draftCurrent)) {
                throw new Error("Game checkpoint draft RNG is incoherent with recorded offers and selections.");
            }
        }
        if (campaignBattleState
            && campaignBattleState.deck.length + campaignDraftSelectionCount + campaignArtifactInventoryCount
                > CAMPAIGN_RUN_LIMITS.collectionEntries)
            throw new Error("Game checkpoint campaign state exceeds the aggregate CampaignRun collection limit.");
        finite(state.coreHp, "coreHp");
        const currencyIds = new Set(content.currencies.map((currency) => currency.id));
        recordNumbers(state.resources, "resources", currencyIds);
        const waveIndex = integer(state.waveIndex, "waveIndex");
        const startedWaveCount = integer(state.startedWaveCount, "startedWaveCount");
        if (waveIndex >= Math.max(1, mission.waves.length) || startedWaveCount > mission.waves.length) {
            throw new Error("Game checkpoint state wave position is outside the mission.");
        }
        if (!(new Set(["ready", "spawning", "between", "complete"])).has(state.waveState)) {
            throw new Error("Game checkpoint state waveState is invalid.");
        }
        if (!(new Set(["playing", "victory", "defeat"])).has(state.outcome)) {
            throw new Error("Game checkpoint state outcome is invalid.");
        }
        finite(state.prepRemaining, "prepRemaining");
        finite(state.missionElapsed, "missionElapsed");
        if (state.nextWaveStartAt !== null)
            finite(state.nextWaveStartAt, "nextWaveStartAt");
        const enemyCounter = integer(state.enemyCounter, "enemyCounter");
        const towerCounter = integer(state.towerCounter, "towerCounter");
        integer(state.clearedWaveCount, "clearedWaveCount");
        integer(state.killCount, "killCount");
        integer(state.leakCount, "leakCount");
        const enemyTypeIds = new Set(Object.keys(content.enemies));
        const abilityIds = new Set((mission.abilities ?? []).map((ability) => ability.id));
        recordNumbers(state.killCountByEnemyType, "killCountByEnemyType", enemyTypeIds, true);
        recordNumbers(state.abilityCooldowns, "abilityCooldowns", abilityIds);
        recordNumbers(state.scriptHandlerLastRun, "scriptHandlerLastRun");
        const mapDefinition = content.maps[mission.mapId];
        if (!mapDefinition)
            throw new Error("Game checkpoint identity mission has no source map.");
        const admitsNativePathWater = checkpointTerraforming !== undefined
            && (mission.abilities ?? []).some((ability) => ability.id === "path_water")
            && content.terrainTypes.water !== undefined;
        const validCoord = (value, label) => {
            const coord = closed(value, label, ["q", "r"]);
            const q = checkpointDataField(coord, "q", label);
            const r = checkpointDataField(coord, "r", label);
            if (typeof q !== "number" || !Number.isInteger(q) || typeof r !== "number" || !Number.isInteger(r) ||
                q < 0 || q >= mapDefinition.width || r < 0 || r >= mapDefinition.height)
                throw new Error(`Game checkpoint state ${label} is outside the map.`);
            return { q, r };
        };
        const routeIds = new Set(mapDefinition.pathRoutes?.length ? mapDefinition.pathRoutes.map((route) => route.id) : ["main"]);
        const routeTracks = new Map(mapDefinition.pathRoutes?.length
            ? mapDefinition.pathRoutes.map((route) => [route.id, route.pathCenterline])
            : [["main", mapDefinition.pathCenterline]]);
        const topology = createGridTopology(normalizeGridDefinition(mapDefinition.grid));
        const directFlightTrack = topology.line(mapDefinition.spawnCoord, mapDefinition.coreCoord);
        const difficulty = content.difficulties.find((item) => item.id === identity.difficultyId);
        const selectedNavigation = resolveActiveNavigationMechanics(content, identity.missionId);
        const activeNavigationProfile = selectedNavigation?.mode === "dynamic_flow"
            ? {
                mode: "dynamic_flow",
                defaultMovementProfileId: selectedNavigation.defaultMovementProfileId,
                movementProfiles: selectedNavigation.movementProfiles,
                ...(selectedNavigation.enemyMovementProfiles === undefined
                    ? {}
                    : { enemyMovementProfiles: selectedNavigation.enemyMovementProfiles })
            }
            : undefined;
        const optionalRoute = (descriptors, label) => {
            if (!own(descriptors, "routeId"))
                return;
            const routeId = stringValue(checkpointDataField(descriptors, "routeId", label), `${label}.routeId`);
            if (!routeIds.has(routeId))
                throw new Error(`Game checkpoint state ${label} references an unknown route.`);
        };
        const optionalFinite = (object, key, label, minimum = 0, maximum = Infinity) => {
            if (own(object, key))
                finite(checkpointDataField(object, key, label), `${label}.${key}`, minimum, maximum);
        };
        const enemyIds = new Set();
        const navigationStates = [];
        let liveNavigationStates = 0;
        let maxEnemyId = 0;
        for (const value of array(state.enemies, "enemies")) {
            const enemy = closed(value, "enemy", [
                "id", "typeId", "hp", "maxHp", "pathProgress", "dotRemaining", "pathOffset"
            ], [
                "dotDamagePerUnit", "dotSourceTowerTypeId", "routeId", "phaseSpawnsTriggered", "statuses",
                "disruptCooldown", "towerAttackCooldown", "navigation"
            ]);
            const id = checkpointDataField(enemy, "id", "Game checkpoint enemy");
            const typeId = checkpointDataField(enemy, "typeId", "Game checkpoint enemy");
            if (typeof id !== "string" || enemyIds.has(id) || typeof typeId !== "string" ||
                !own(content.enemies, typeId)) {
                throw new Error("Game checkpoint state has an invalid or duplicate enemy identity.");
            }
            const idMatch = /^enemy_([1-9]\d*)$/.exec(id);
            if (!idMatch)
                throw new Error("Game checkpoint state enemy id is not an engine id.");
            const numericId = Number(idMatch[1]);
            if (!Number.isSafeInteger(numericId))
                throw new Error("Game checkpoint state enemy id suffix is unsafe.");
            maxEnemyId = Math.max(maxEnemyId, numericId);
            enemyIds.add(id);
            for (const key of ["hp", "maxHp", "pathProgress", "dotRemaining", "pathOffset"]) {
                finite(checkpointDataField(enemy, key, "Game checkpoint enemy"), `enemy.${key}`, key === "pathOffset" ? -Infinity : 0);
            }
            optionalFinite(enemy, "dotDamagePerUnit", "enemy");
            const enemyType = content.enemies[typeId];
            if (!enemyType)
                throw new Error("Game checkpoint enemy references an unknown type.");
            const maxHp = checkpointDataField(enemy, "maxHp", "enemy");
            const hp = checkpointDataField(enemy, "hp", "enemy");
            const expectedMaxHp = enemyType.maxHp * (difficulty.enemyHpMultiplier ?? 1);
            if (maxHp !== expectedMaxHp || typeof hp !== "number" || hp > expectedMaxHp) {
                throw new Error("Game checkpoint enemy hp or maxHp is inconsistent with authored content.");
            }
            if (own(enemy, "dotSourceTowerTypeId")) {
                const towerTypeId = stringValue(checkpointDataField(enemy, "dotSourceTowerTypeId", "enemy"), "enemy.dotSourceTowerTypeId");
                if (!own(content.towers, towerTypeId))
                    throw new Error("Game checkpoint enemy references an unknown dot tower type.");
            }
            const isFlying = enemyType.targetClass === "flying";
            const hasNavigation = own(enemy, "navigation");
            if (!activeNavigationProfile && hasNavigation) {
                throw new Error("Game checkpoint enemy navigation is unexpected for an inactive capability.");
            }
            if (activeNavigationProfile && !hasNavigation) {
                throw new Error("Game checkpoint active dynamic enemy navigation is missing.");
            }
            if (activeNavigationProfile && !own(enemy, "routeId")) {
                throw new Error("Game checkpoint active dynamic enemy route is missing.");
            }
            if (!activeNavigationProfile && isFlying && own(enemy, "routeId")) {
                throw new Error("Game checkpoint flying enemy must not carry a route.");
            }
            if (activeNavigationProfile || !isFlying)
                optionalRoute(enemy, "enemy");
            const routeId = own(enemy, "routeId")
                ? stringValue(checkpointDataField(enemy, "routeId", "enemy"), "enemy.routeId")
                : "main";
            const pathProgress = checkpointDataField(enemy, "pathProgress", "enemy");
            if (!activeNavigationProfile) {
                const track = enemyType.movementKind === "direct_flying"
                    ? directFlightTrack
                    : (routeTracks.get(routeId) ?? routeTracks.values().next().value ?? []);
                const maximumProgress = Math.max(0, track.length - 1 - 0.001);
                if (typeof pathProgress !== "number" || pathProgress > maximumProgress) {
                    throw new Error("Game checkpoint enemy progress is outside its resolved track.");
                }
            }
            if (activeNavigationProfile) {
                const navigation = closed(checkpointDataField(enemy, "navigation", "enemy"), "enemy navigation", ["schemaVersion", "movementProfileId", "currentCoord", "edgeProgress", "stepsEntered"], ["nextCoord"]);
                if (checkpointDataField(navigation, "schemaVersion", "enemy navigation") !== 1) {
                    throw new Error("Game checkpoint enemy navigation schema version is unsupported.");
                }
                const movementProfileId = stringValue(checkpointDataField(navigation, "movementProfileId", "enemy navigation"), "enemy navigation movement profile");
                const expectedMovementProfileId = activeNavigationProfile.enemyMovementProfiles?.[typeId]
                    ?? activeNavigationProfile.defaultMovementProfileId;
                if (!own(activeNavigationProfile.movementProfiles, movementProfileId)
                    || movementProfileId !== expectedMovementProfileId) {
                    throw new Error("Game checkpoint enemy navigation profile is invalid for its enemy type.");
                }
                const currentCoord = validCoord(checkpointDataField(navigation, "currentCoord", "enemy navigation"), "enemy navigation current coord");
                const nextCoord = own(navigation, "nextCoord")
                    ? validCoord(checkpointDataField(navigation, "nextCoord", "enemy navigation"), "enemy navigation next coord")
                    : undefined;
                const edgeProgress = finite(checkpointDataField(navigation, "edgeProgress", "enemy navigation"), "enemy navigation edge progress");
                if (edgeProgress >= 1) {
                    throw new Error("Game checkpoint enemy navigation edge progress must be in [0, 1).");
                }
                const stepsEntered = integer(checkpointDataField(navigation, "stepsEntered", "enemy navigation"), "enemy navigation steps entered");
                if (pathProgress !== stepsEntered + edgeProgress) {
                    throw new Error("Game checkpoint enemy navigation pathProgress mismatch.");
                }
                navigationStates.push({
                    enemyId: id,
                    routeId,
                    navigation: {
                        schemaVersion: 1,
                        movementProfileId,
                        currentCoord,
                        ...(nextCoord === undefined ? {} : { nextCoord }),
                        edgeProgress,
                        stepsEntered
                    }
                });
                if (typeof hp === "number" && hp > 0)
                    liveNavigationStates += 1;
            }
            optionalFinite(enemy, "disruptCooldown", "enemy");
            optionalFinite(enemy, "towerAttackCooldown", "enemy");
            if (own(enemy, "phaseSpawnsTriggered")) {
                const triggers = stringArray(checkpointDataField(enemy, "phaseSpawnsTriggered", "enemy"), "enemy.phaseSpawnsTriggered", true);
                const authoredTriggers = new Set((enemyType.phaseSpawns ?? []).map((phase) => `${phase.hpRatio}:${phase.enemyId}`));
                if (triggers.some((trigger) => !authoredTriggers.has(trigger))) {
                    throw new Error("Game checkpoint enemy has an unauthored phase trigger.");
                }
            }
            if (own(enemy, "statuses")) {
                const statuses = closed(checkpointDataField(enemy, "statuses", "enemy"), "enemy statuses", [], ["slow", "stun", "poison"]);
                if (own(statuses, "slow")) {
                    const slow = closed(checkpointDataField(statuses, "slow", "enemy statuses"), "enemy slow status", ["factor", "remaining"]);
                    finite(checkpointDataField(slow, "factor", "enemy slow status"), "enemy slow factor", 0, 1);
                    finite(checkpointDataField(slow, "remaining", "enemy slow status"), "enemy slow remaining");
                }
                if (own(statuses, "stun")) {
                    const stun = closed(checkpointDataField(statuses, "stun", "enemy statuses"), "enemy stun status", ["remaining"]);
                    finite(checkpointDataField(stun, "remaining", "enemy stun status"), "enemy stun remaining");
                }
                if (own(statuses, "poison")) {
                    const poison = closed(checkpointDataField(statuses, "poison", "enemy statuses"), "enemy poison status", ["dps", "remaining"]);
                    finite(checkpointDataField(poison, "dps", "enemy poison status"), "enemy poison dps");
                    finite(checkpointDataField(poison, "remaining", "enemy poison status"), "enemy poison remaining");
                }
            }
        }
        if (liveNavigationStates > NAVIGATION_LIMITS.liveEnemyStates) {
            throw new Error("Game checkpoint live enemy navigation state budget is exceeded.");
        }
        if (enemyCounter < maxEnemyId)
            throw new Error("Game checkpoint enemy counter is below a live enemy id.");
        const towerIds = new Set();
        const towerStateById = new Map();
        const occupiedCoords = new Set();
        let maxTowerId = 0;
        for (const value of array(state.towers, "towers")) {
            const tower = closed(value, "tower", [
                "id", "typeId", "coord", "footprint", "level", "stacks", "cooldown", "investedResources"
            ], ["targetMode", "disabledFor", "hp"]);
            const id = checkpointDataField(tower, "id", "Game checkpoint tower");
            const typeId = checkpointDataField(tower, "typeId", "Game checkpoint tower");
            if (typeof id !== "string" || towerIds.has(id) || typeof typeId !== "string" ||
                !own(content.towers, typeId)) {
                throw new Error("Game checkpoint state has an invalid or duplicate tower identity.");
            }
            const idMatch = /^tower_([1-9]\d*)$/.exec(id);
            if (!idMatch)
                throw new Error("Game checkpoint state tower id is not an engine id.");
            const numericId = Number(idMatch[1]);
            if (!Number.isSafeInteger(numericId))
                throw new Error("Game checkpoint state tower id suffix is unsafe.");
            maxTowerId = Math.max(maxTowerId, numericId);
            towerIds.add(id);
            const type = content.towers[typeId];
            if (!type)
                throw new Error("Game checkpoint tower references an unknown type.");
            const center = validCoord(checkpointDataField(tower, "coord", "Game checkpoint tower"), `tower ${id} coord`);
            integer(checkpointDataField(tower, "level", "tower"), "tower.level", 1);
            integer(checkpointDataField(tower, "stacks", "tower"), "tower.stacks");
            finite(checkpointDataField(tower, "cooldown", "tower"), "tower.cooldown");
            recordNumbers(checkpointDataField(tower, "investedResources", "tower"), "tower.investedResources", currencyIds);
            optionalFinite(tower, "disabledFor", "tower");
            const hp = own(tower, "hp")
                ? finite(checkpointDataField(tower, "hp", "tower"), "tower.hp", 0, type.maxHp ?? Infinity)
                : undefined;
            if ((typeof type.maxHp === "number" && type.maxHp > 0) !== own(tower, "hp")) {
                throw new Error("Game checkpoint tower hp does not match its tower type.");
            }
            towerStateById.set(id, hp === undefined ? { typeId } : { typeId, hp });
            if (own(tower, "targetMode")) {
                const mode = stringValue(checkpointDataField(tower, "targetMode", "tower"), "tower.targetMode");
                if (!TOWER_TARGET_MODES.includes(mode))
                    throw new Error("Game checkpoint tower target mode is invalid.");
            }
            const expectedFootprint = topology.tilesWithin(center, type.footprintRadius)
                .filter((coord) => coord.q >= 0 && coord.q < mapDefinition.width && coord.r >= 0 && coord.r < mapDefinition.height);
            const footprints = array(checkpointDataField(tower, "footprint", "Game checkpoint tower"), "tower footprint");
            if (footprints.length !== expectedFootprint.length || footprints.length === 0) {
                throw new Error("Game checkpoint tower footprint size is invalid.");
            }
            for (let index = 0; index < footprints.length; index += 1) {
                const coord = validCoord(footprints[index], `tower ${id} footprint`);
                const expected = expectedFootprint[index];
                if (!expected || coord.q !== expected.q || coord.r !== expected.r) {
                    throw new Error("Game checkpoint tower footprint is inconsistent with its coord and type.");
                }
                const key = coordKey(coord);
                if (occupiedCoords.has(key))
                    throw new Error("Game checkpoint tower footprints overlap.");
                occupiedCoords.add(key);
            }
        }
        if (towerCounter < maxTowerId)
            throw new Error("Game checkpoint tower counter is below a live tower id.");
        if (artifactSockets.length > 0) {
            if (!checkpointRoguelite?.artifacts) {
                throw new Error("Game checkpoint artifact sockets require active roguelite artifacts.");
            }
            const occupiedArtifactSlots = new Set();
            const artifactModifierCounts = new Map();
            for (const socket of artifactSockets) {
                const tower = towerStateById.get(socket.towerId);
                if (!tower || (tower.hp !== undefined && tower.hp <= 0)) {
                    throw new Error("Game checkpoint artifact socket references a missing or non-live tower.");
                }
                const slot = checkpointRoguelite.artifacts.towerSlots[tower.typeId]
                    ?.find((item) => item.slotId === socket.slotId);
                if (!slot)
                    throw new Error("Game checkpoint artifact socket references an unknown tower slot.");
                const definition = checkpointRoguelite.artifacts.definitions[socket.artifactId];
                if (!definition || definition.slotType !== slot.slotType) {
                    throw new Error("Game checkpoint artifact socket is incompatible with the authored slot.");
                }
                const assignmentKey = `${socket.towerId.length}:${socket.towerId}|${socket.slotId.length}:${socket.slotId}`;
                if (occupiedArtifactSlots.has(assignmentKey)) {
                    throw new Error("Game checkpoint artifact socket assignment is duplicated.");
                }
                occupiedArtifactSlots.add(assignmentKey);
                artifactModifierCounts.set(socket.towerId, (artifactModifierCounts.get(socket.towerId) ?? 0) + definition.modifiers.length);
            }
            const synergyWorstCase = rogueliteSynergyWorstCaseModifierCount(checkpointRoguelite.synergies);
            for (const artifactModifierCount of artifactModifierCounts.values()) {
                if (synergyWorstCase
                    + artifactModifierCount
                    + ROGUELITE_DAMAGE_MODIFIER_RESERVE.total
                    + activeHeroAuraModifierReserve(content, identity.missionId)
                    > MAX_MODIFIERS_PER_RESOLUTION) {
                    throw new Error("Game checkpoint artifact socket modifier budget is exceeded.");
                }
            }
        }
        const activeCombat = resolveActiveCombatMechanics(content, identity.missionId);
        const combatDefinitions = activeCombat?.shields;
        const expectedEnemyShields = new Map();
        const expectedTowerShields = new Map();
        if (combatDefinitions) {
            for (const enemy of state.enemies) {
                const definition = combatDefinitions.enemies[enemy.typeId];
                if (definition)
                    expectedEnemyShields.set(enemy.id, definition);
            }
            for (const tower of state.towers) {
                const definition = combatDefinitions.towers[tower.typeId];
                if (definition)
                    expectedTowerShields.set(tower.id, definition);
            }
        }
        const expectsShields = expectedEnemyShields.size > 0 || expectedTowerShields.size > 0;
        const hasCombat = own(descriptors, "combat");
        if (expectsShields && !hasCombat) {
            throw new Error("Game checkpoint combat shield state is missing.");
        }
        if (hasCombat) {
            if (!activeCombat)
                throw new Error("Game checkpoint combat state is unexpected for an inactive capability.");
            const rawCombat = checkpointObjectDescriptors(checkpointDataField(descriptors, "combat", "Game checkpoint state"), "Game checkpoint state combat");
            const combatSchemaVersion = checkpointDataField(rawCombat, "schemaVersion", "combat state");
            const expectedSchemaVersion = activeCombat.schemaVersion === 3 ? 2 : 1;
            if (combatSchemaVersion !== expectedSchemaVersion) {
                throw new Error("Game checkpoint combat schema version is invalid.");
            }
            const combat = closed(checkpointDataField(descriptors, "combat", "Game checkpoint state"), "combat state", combatSchemaVersion === 2 ? ["schemaVersion", "shields", "marks"] : ["schemaVersion", "shields"]);
            const shields = closed(checkpointDataField(combat, "shields", "combat state"), "combat shields", ["enemies", "towers"]);
            const validateShieldRecord = (value, label, expected) => {
                const record = checkpointObjectDescriptors(value, `Game checkpoint state ${label}`);
                const actualIds = Object.keys(record).sort();
                const expectedIds = [...expected.keys()].sort();
                if (actualIds.length !== expectedIds.length
                    || actualIds.some((id, index) => id !== expectedIds[index])) {
                    throw new Error(`Game checkpoint ${label} has a missing or extra shield target.`);
                }
                for (const id of actualIds) {
                    const definition = expected.get(id);
                    const shield = closed(checkpointDataField(record, id, label), `${label}.${id}`, ["current", "capacity", "regenerationDelayRemaining"]);
                    const capacity = checkpointDataField(shield, "capacity", label);
                    if (capacity !== definition.capacity) {
                        throw new Error(`Game checkpoint ${label}.${id} shield capacity differs from authored content.`);
                    }
                    finite(checkpointDataField(shield, "current", label), `${label}.${id}.current`, 0, definition.capacity);
                    finite(checkpointDataField(shield, "regenerationDelayRemaining", label), `${label}.${id}.regenerationDelayRemaining`, 0, definition.regeneration?.delayAfterDamage ?? 0);
                }
            };
            validateShieldRecord(checkpointDataField(shields, "enemies", "combat shields"), "enemy shields", expectedEnemyShields);
            validateShieldRecord(checkpointDataField(shields, "towers", "combat shields"), "tower shields", expectedTowerShields);
            let markApplicationCount = 0;
            if (combatSchemaVersion === 2) {
                const marks = closed(checkpointDataField(combat, "marks", "combat state"), "combat marks", ["enemies"]);
                const markEnemies = checkpointObjectDescriptors(checkpointDataField(marks, "enemies", "combat marks"), "Game checkpoint state combat mark enemies");
                for (const enemyId of Object.keys(markEnemies)) {
                    if (!enemyIds.has(enemyId)) {
                        throw new Error(`Game checkpoint combat marks reference unknown enemy "${enemyId}".`);
                    }
                    const enemyMarkRecord = checkpointObjectDescriptors(checkpointDataField(markEnemies, enemyId, "combat mark enemies"), `Game checkpoint state combat marks for ${enemyId}`);
                    const markIds = Object.keys(enemyMarkRecord);
                    if (markIds.length === 0)
                        throw new Error("Game checkpoint combat mark enemy record must not be empty.");
                    markApplicationCount += markIds.length;
                    if (markApplicationCount > MARK_LIMITS.runtimeApplications) {
                        throw new Error(`Game checkpoint mark applications exceed the ${MARK_LIMITS.runtimeApplications} limit.`);
                    }
                    for (const markId of markIds) {
                        const definition = activeCombat.marks.definitions[markId];
                        if (!definition)
                            throw new Error(`Game checkpoint combat state references unknown mark "${markId}".`);
                        const mark = closed(checkpointDataField(enemyMarkRecord, markId, `combat marks for ${enemyId}`), `combat mark ${enemyId}.${markId}`, ["stacks", "remaining"]);
                        integer(checkpointDataField(mark, "stacks", `combat mark ${markId}`), `combat mark ${markId}.stacks`, 1);
                        const stacks = checkpointDataField(mark, "stacks", `combat mark ${markId}`);
                        if (typeof stacks !== "number" || stacks > definition.maxStacks) {
                            throw new Error(`Game checkpoint combat mark "${markId}" stacks exceed its definition.`);
                        }
                        finite(checkpointDataField(mark, "remaining", `combat mark ${markId}`), `combat mark ${markId}.remaining`, Number.MIN_VALUE, definition.duration);
                    }
                }
            }
            if (!expectsShields && markApplicationCount === 0) {
                throw new Error("Game checkpoint empty combat state must be omitted.");
            }
        }
        const hasReactions = own(descriptors, "reactions");
        const activeReactions = resolveActiveReactionsMechanics(content, identity.missionId);
        if (hasReactions) {
            if (!activeReactions)
                throw new Error("Game checkpoint reaction state is unexpected for an inactive capability.");
            const reactionState = closed(checkpointDataField(descriptors, "reactions", "Game checkpoint state"), "reaction state", ["schemaVersion", "exposures"]);
            if (checkpointDataField(reactionState, "schemaVersion", "reaction state") !== 1) {
                throw new Error("Game checkpoint reaction state version is unsupported.");
            }
            const exposures = closed(checkpointDataField(reactionState, "exposures", "reaction state"), "reaction exposures", ["enemies"]);
            const exposureEnemies = checkpointObjectDescriptors(checkpointDataField(exposures, "enemies", "reaction exposures"), "Game checkpoint reaction exposure enemies");
            const enemyOrder = Object.keys(exposureEnemies);
            if (enemyOrder.length === 0 || enemyOrder.join("\u0000") !== [...enemyOrder].sort().join("\u0000")) {
                throw new Error("Game checkpoint reaction enemy order must be canonical and non-empty.");
            }
            let total = 0;
            for (const enemyId of enemyOrder) {
                if (!enemyIds.has(enemyId))
                    throw new Error(`Game checkpoint reaction state references unknown enemy "${enemyId}".`);
                const enemyExposureRecord = checkpointObjectDescriptors(checkpointDataField(exposureEnemies, enemyId, "reaction exposure enemies"), `Game checkpoint reaction exposures for ${enemyId}`);
                const exposureOrder = Object.keys(enemyExposureRecord);
                if (exposureOrder.length === 0 || exposureOrder.join("\u0000") !== [...exposureOrder].sort().join("\u0000")) {
                    throw new Error("Game checkpoint exposure order must be canonical and non-empty.");
                }
                total += exposureOrder.length;
                if (total > REACTION_LIMITS.runtimeExposureApplications)
                    throw new Error("Game checkpoint reaction exposure budget is exceeded.");
                for (const exposureId of exposureOrder) {
                    const definition = activeReactions.exposures.definitions[exposureId];
                    if (!definition)
                        throw new Error(`Game checkpoint references unknown exposure "${exposureId}".`);
                    const exposure = closed(checkpointDataField(enemyExposureRecord, exposureId, `reaction exposures for ${enemyId}`), `reaction exposure ${enemyId}.${exposureId}`, ["stacks", "remaining"]);
                    const stacks = integer(checkpointDataField(exposure, "stacks", exposureId), `reaction exposure ${exposureId}.stacks`, 1);
                    if (stacks > definition.maxStacks)
                        throw new Error("Game checkpoint reaction exposure stacks exceed definition.");
                    finite(checkpointDataField(exposure, "remaining", exposureId), `reaction exposure ${exposureId}.remaining`, Number.MIN_VALUE, definition.duration);
                }
            }
        }
        let previousSpawnAt = -Infinity;
        let spawnIndex = 0;
        for (const value of array(state.spawnQueue, "spawnQueue")) {
            const item = closed(value, "spawn item", ["at", "enemyId"], ["routeId"]);
            const at = finite(checkpointDataField(item, "at", "Game checkpoint spawn item"), "spawnQueue.at");
            if (at < previousSpawnAt || (spawnIndex === 0 && at < state.missionElapsed - 0.0001)) {
                throw new Error("Game checkpoint spawn queue order or due time is invalid.");
            }
            previousSpawnAt = at;
            spawnIndex += 1;
            const enemyId = checkpointDataField(item, "enemyId", "Game checkpoint spawn item");
            if (typeof enemyId !== "string" || !own(content.enemies, enemyId)) {
                throw new Error("Game checkpoint spawn queue references an unknown enemy.");
            }
            optionalRoute(item, "spawn item");
            if (!activeNavigationProfile && content.enemies[enemyId]?.targetClass === "flying" && own(item, "routeId")) {
                throw new Error("Game checkpoint flying spawn must not carry a route.");
            }
        }
        const authoredObjectiveIds = (mission.objectives?.victory?.length
            ? mission.objectives.victory.map((objective) => objective.id)
            : ["clear_waves"]);
        const authoredStarIds = (mission.objectives?.stars ?? []).map((star) => star.id);
        if (new Set(authoredObjectiveIds).size !== authoredObjectiveIds.length || new Set(authoredStarIds).size !== authoredStarIds.length) {
            throw new Error("Game checkpoint mission has duplicate authored objective or star ids.");
        }
        for (const [key, allowed] of [
            ["completedObjectiveIds", new Set(authoredObjectiveIds)],
            ["earnedStarIds", new Set(authoredStarIds)]
        ]) {
            const values = stringArray(state[key], key, true);
            if (values.some((value, index) => index > 0 && values[index - 1] > value)) {
                throw new Error(`Game checkpoint state ${key} is not in canonical order.`);
            }
            for (const value of values) {
                if (!allowed.has(value))
                    throw new Error(`Game checkpoint state ${key} references an unauthored objective or star.`);
            }
        }
        const validateScriptJson = (value, label, depth = 0) => {
            if (depth > 128)
                throw new Error(`Game checkpoint state ${label} exceeds the script JSON depth limit.`);
            if (value === null || typeof value === "string" || typeof value === "boolean")
                return;
            if (typeof value === "number") {
                finite(value, label, -Infinity);
                return;
            }
            if (Array.isArray(value)) {
                for (const item of array(value, label))
                    validateScriptJson(item, label, depth + 1);
                return;
            }
            const object = checkpointObjectDescriptors(value, `Game checkpoint state ${label}`);
            for (const key of Object.keys(object)) {
                validateScriptJson(checkpointDataField(object, key, label), `${label}.${key}`, depth + 1);
            }
        };
        const scriptValueRoot = checkpointObjectDescriptors(state.scriptValues, "Game checkpoint scriptValues");
        const authoredScriptIds = Object.keys(content.scripts).sort();
        const stateScriptIds = Object.keys(scriptValueRoot).sort();
        if (authoredScriptIds.length !== stateScriptIds.length ||
            authoredScriptIds.some((scriptId, index) => scriptId !== stateScriptIds[index]))
            throw new Error("Game checkpoint script values do not match authored scripts.");
        for (const scriptId of stateScriptIds) {
            if (!own(content.scripts, scriptId))
                throw new Error("Game checkpoint script values reference an unknown script.");
            const bindings = checkpointObjectDescriptors(checkpointDataField(scriptValueRoot, scriptId, "scriptValues"), `Game checkpoint script values for ${scriptId}`);
            for (const bindingKey of Object.keys(bindings)) {
                const bindingState = checkpointDataField(bindings, bindingKey, `script ${scriptId}`);
                const values = checkpointObjectDescriptors(bindingState, `Game checkpoint script binding ${scriptId}:${bindingKey}`);
                for (const key of Object.keys(values)) {
                    validateScriptJson(checkpointDataField(values, key, `script binding ${bindingKey}`), `script value ${scriptId}.${bindingKey}.${key}`);
                }
                canonicalStringify(bindingState, {
                    maxDepth: 64,
                    maxNodes: 100_000,
                    maxBytes: TOWER_SCRIPT_LIMITS.stateBytesPerBinding
                });
            }
        }
        const allowedTimerKeys = new Set();
        for (const scriptId of authoredScriptIds) {
            const script = content.scripts[scriptId];
            if (!script)
                continue;
            const bindingStates = checkpointObjectDescriptors(checkpointDataField(scriptValueRoot, scriptId, "scriptValues"), `Game checkpoint script values for ${scriptId}`);
            const timedHandlers = (script.handlers.tick ?? [])
                .map((handler, index) => ({ handler, handlerId: handler.id ?? String(index) }))
                .filter(({ handler }) => typeof handler.every === "number");
            for (const bindingKey of Object.keys(bindingStates)) {
                for (const { handlerId } of timedHandlers)
                    allowedTimerKeys.add(`${script.id}:${bindingKey}:${handlerId}`);
            }
        }
        const handlerTimers = checkpointObjectDescriptors(state.scriptHandlerLastRun, "Game checkpoint scriptHandlerLastRun");
        for (const key of Object.keys(handlerTimers)) {
            const lastRun = checkpointDataField(handlerTimers, key, "scriptHandlerLastRun");
            if (!allowedTimerKeys.has(key) || typeof lastRun !== "number" || lastRun > state.missionElapsed + 0.000001) {
                throw new Error("Game checkpoint script handler timer key or time is invalid.");
            }
        }
        const diagnosticCodes = new Set(["budget_exceeded", "invalid_expression", "invalid_action", "runtime_error"]);
        const scriptEvents = new Set(TOWER_SCRIPT_EVENTS);
        const validateDiagnostic = (value, label) => {
            const diagnostic = closed(value, label, ["scriptId", "event", "code", "message"], ["handlerId"]);
            const scriptId = stringValue(checkpointDataField(diagnostic, "scriptId", label), `${label}.scriptId`);
            if (scriptId !== "runtime" && !own(content.scripts, scriptId))
                throw new Error("Game checkpoint diagnostic references an unknown script.");
            const event = stringValue(checkpointDataField(diagnostic, "event", label), `${label}.event`);
            const code = stringValue(checkpointDataField(diagnostic, "code", label), `${label}.code`);
            stringValue(checkpointDataField(diagnostic, "message", label), `${label}.message`);
            if (!scriptEvents.has(event) || !diagnosticCodes.has(code))
                throw new Error("Game checkpoint script diagnostic is invalid.");
            if (own(diagnostic, "handlerId"))
                stringValue(checkpointDataField(diagnostic, "handlerId", label), `${label}.handlerId`);
        };
        const diagnostics = array(state.scriptDiagnostics, "scriptDiagnostics");
        if (diagnostics.length > TOWER_SCRIPT_LIMITS.retainedDiagnostics) {
            throw new Error("Game checkpoint retained script diagnostic limit is exceeded.");
        }
        for (const diagnostic of diagnostics) {
            validateDiagnostic(diagnostic, "script diagnostic");
        }
        const eventSchemas = {
            towerPlaced: { required: ["type", "towerId", "towerTypeId", "coord", "terrain", "terrainMetadata"] },
            towerSold: { required: ["type", "towerId", "towerTypeId", "refund"] },
            towerMoved: { required: ["type", "towerId", "from", "to", "cost"] },
            towerUpgraded: { required: ["type", "towerId", "level", "stacks"] },
            towerDisrupted: { required: ["type", "enemyId", "enemyTypeId", "towerIds", "duration"] },
            towerAttacked: { required: ["type", "enemyId", "enemyTypeId", "towerId", "damage"] },
            towerShieldChanged: {
                required: ["type", "towerId", "towerTypeId", "previous", "current", "capacity", "cause", "amount"],
                optional: ["overflowDamage"]
            },
            towerDestroyed: { required: ["type", "towerId", "towerTypeId", "enemyId"] },
            heroShieldChanged: {
                required: ["type", "heroId", "previous", "current", "capacity", "cause", "amount"],
                optional: ["overflowDamage"]
            },
            heroAttacked: {
                required: ["type", "enemyId", "enemyTypeId", "heroId", "damage", "shieldAbsorbed", "hpDamage"]
            },
            heroDefeated: { required: ["type", "heroId", "heroDefinitionId", "enemyId"] },
            heroAbilityUsed: {
                required: [
                    "type", "heroId", "heroDefinitionId", "abilityId", "targetEnemyId", "targetEnemyTypeId",
                    "previousMana", "currentMana", "manaSpent", "cooldownApplied", "requestedDamage", "resolvedDamage",
                    "shieldAbsorbed", "hpDamage"
                ]
            },
            heroSkillUnlocked: {
                required: [
                    "type", "heroId", "heroDefinitionId", "skillId", "cost", "previousPoints", "currentPoints"
                ]
            },
            heroSkillPointsGranted: {
                required: [
                    "type", "heroId", "heroDefinitionId", "waveIndex", "previousPoints", "currentPoints", "amount"
                ]
            },
            towerTargetModeChanged: { required: ["type", "towerId", "mode"] },
            enemyKilled: { required: ["type", "enemyId", "enemyTypeId", "coins", "resources"] },
            artifactDropped: {
                required: ["type", "enemyId", "enemyTypeId", "artifactInstanceId", "artifactId", "rollIndex"]
            },
            artifactSocketed: {
                required: ["type", "artifactInstanceId", "artifactId", "towerId", "towerTypeId", "slotId"]
            },
            artifactUnsocketed: {
                required: ["type", "artifactInstanceId", "artifactId", "towerId", "towerTypeId", "slotId", "cause"]
            },
            enemySpawnedOnDeath: { required: ["type", "parentEnemyId", "parentEnemyTypeId", "enemyTypeId", "enemyIds"] },
            enemyLeaked: { required: ["type", "enemyId", "enemyTypeId", "damage"] },
            enemyDisplacementResolved: {
                required: [
                    "type", "sourceKind", "sourceId", "sourceCoord", "enemyId", "enemyTypeId", "mode",
                    "requestedDistance", "movedDistance", "from", "to", "stopReason"
                ]
            },
            enemyFell: {
                required: [
                    "type", "sourceKind", "sourceId", "sourceCoord", "enemyId", "enemyTypeId",
                    "from", "to", "terrainTag"
                ]
            },
            waveStarted: { required: ["type", "waveIndex"] },
            waveCleared: { required: ["type", "waveIndex", "income", "interest"] },
            resourcesGranted: { required: ["type", "source", "waveIndex", "resources"] },
            objectiveCompleted: { required: ["type", "objectiveId", "kind"] },
            objectiveFailed: { required: ["type", "objectiveId", "kind"] },
            starEarned: { required: ["type", "starId"] },
            towerFired: { required: ["type", "towerId", "enemyId", "damage"] },
            enemyHit: { required: ["type", "towerId", "enemyId", "enemyTypeId", "damage"] },
            enemyShieldChanged: {
                required: ["type", "enemyId", "enemyTypeId", "previous", "current", "capacity", "cause", "amount"],
                optional: ["overflowDamage"]
            },
            enemyMarkChanged: {
                required: [
                    "type", "enemyId", "enemyTypeId", "markId", "previousStacks", "currentStacks",
                    "previousRemaining", "remaining", "cause"
                ]
            },
            enemyExposureChanged: {
                required: [
                    "type", "enemyId", "enemyTypeId", "exposureId", "previousStacks", "currentStacks",
                    "previousRemaining", "remaining", "cause"
                ]
            },
            enemyReactionTriggered: {
                required: [
                    "type", "reactionId", "originEnemyId", "originEnemyTypeId", "originCoord",
                    "triggerDamageType", "depth", "scheduledTargetIds"
                ]
            },
            reactionBudgetExceeded: {
                required: ["type", "rootEnemyId", "rootEnemyTypeId", "budget", "limit", "dropped"]
            },
            enemyArmorBlocked: { required: ["type", "towerId", "enemyId", "enemyTypeId", "rawDamage"] },
            enemyHealed: { required: ["type", "healerEnemyId", "targetEnemyId", "targetEnemyTypeId", "amount"] },
            enemyPhaseSpawned: { required: ["type", "parentEnemyId", "parentEnemyTypeId", "enemyTypeId", "enemyIds", "hpRatio"] },
            areaPulse: { required: ["type", "towerId", "enemyIds"] },
            towerResourcesGranted: { required: ["type", "towerId", "enemyId", "resources"] },
            waterAbilityUsed: { required: ["type", "abilityId", "center", "coords", "duration"] },
            abilityUsed: { required: ["type", "abilityId", "center", "enemyIds", "effects"] },
            enemyEnteredTile: { required: ["type", "enemyId", "enemyTypeId", "coord", "terrain", "terrainMetadata", "pathOrder"], optional: ["routeId"] },
            terrainChanged: { required: ["type", "coord", "fromTerrain", "toTerrain", "terrainMetadata", "source"] },
            elevationChanged: { required: ["type", "coord", "fromElevation", "toElevation", "source"] },
            scriptSignal: { required: ["type", "scriptId", "signal", "payload"] },
            scriptDiagnostic: { required: ["type", "diagnostic"] },
            victory: { required: ["type"] },
            defeat: { required: ["type"] }
        };
        const numericEventFields = new Set([
            "level", "stacks", "duration", "damage", "coins", "waveIndex", "rawDamage", "amount", "hpRatio", "pathOrder",
            "previous", "current", "capacity", "overflowDamage", "previousStacks", "currentStacks",
            "previousRemaining", "remaining",
            "depth", "limit", "dropped", "requestedDistance", "movedDistance", "fromElevation", "toElevation",
            "rollIndex", "shieldAbsorbed", "hpDamage", "previousMana", "currentMana", "manaSpent",
            "cooldownApplied", "requestedDamage", "resolvedDamage", "cost", "previousPoints", "currentPoints"
        ]);
        const stringEventFields = new Set([
            "towerId", "towerTypeId", "enemyId", "enemyTypeId", "parentEnemyId", "parentEnemyTypeId", "healerEnemyId",
            "targetEnemyId", "targetEnemyTypeId", "source", "objectiveId", "kind", "starId", "abilityId", "terrain",
            "fromTerrain", "toTerrain", "scriptId", "signal", "routeId", "mode", "cause", "markId",
            "exposureId", "reactionId", "originEnemyId", "originEnemyTypeId", "rootEnemyId", "rootEnemyTypeId",
            "triggerDamageType", "budget", "sourceKind", "sourceId", "stopReason", "terrainTag",
            "artifactInstanceId", "artifactId", "slotId", "heroId", "heroDefinitionId", "skillId"
        ]);
        const coordEventFields = new Set(["coord", "from", "to", "center", "originCoord", "sourceCoord"]);
        const bagEventFields = new Set(["refund", "cost", "resources", "income", "interest"]);
        const stringArrayEventFields = new Set(["towerIds", "enemyIds", "scheduledTargetIds"]);
        let retainedHeroAbilityState;
        let retainedHeroSkillPointState;
        for (const value of array(state.lastEvents, "lastEvents")) {
            const base = checkpointObjectDescriptors(value, "Game checkpoint last event");
            const type = stringValue(checkpointDataField(base, "type", "last event"), "last event type");
            const schema = eventSchemas[type];
            if (!schema)
                throw new Error(`Game checkpoint state last event type "${type}" is invalid.`);
            const event = closed(value, `last event ${type}`, schema.required, schema.optional ?? []);
            for (const key of Object.keys(event)) {
                if (key === "type")
                    continue;
                const field = checkpointDataField(event, key, `last event ${type}`);
                if (numericEventFields.has(key))
                    finite(field, `last event ${type}.${key}`, key === "fromElevation" || key === "toElevation" ? -Infinity : 0);
                else if (stringEventFields.has(key))
                    stringValue(field, `last event ${type}.${key}`);
                else if (coordEventFields.has(key))
                    validCoord(field, `last event ${type}.${key}`);
                else if (bagEventFields.has(key))
                    recordNumbers(field, `last event ${type}.${key}`, currencyIds);
                else if (stringArrayEventFields.has(key))
                    stringArray(field, `last event ${type}.${key}`);
                else if (key === "coords")
                    for (const coord of array(field, `last event ${type}.coords`))
                        validCoord(coord, `last event ${type}.coords`);
                else if (key === "terrainMetadata") {
                    const terrain = closed(field, "event terrain metadata", ["id", "label", "buildable", "walkable", "groundSpeedMultiplier", "tags"]);
                    stringValue(checkpointDataField(terrain, "id", "terrain metadata"), "terrain metadata id");
                    stringValue(checkpointDataField(terrain, "label", "terrain metadata"), "terrain metadata label");
                    if (typeof checkpointDataField(terrain, "buildable", "terrain metadata") !== "boolean" || typeof checkpointDataField(terrain, "walkable", "terrain metadata") !== "boolean") {
                        throw new Error("Game checkpoint event terrain metadata booleans are invalid.");
                    }
                    finite(checkpointDataField(terrain, "groundSpeedMultiplier", "terrain metadata"), "terrain speed");
                    stringArray(checkpointDataField(terrain, "tags", "terrain metadata"), "terrain tags");
                }
                else if (key === "diagnostic")
                    validateDiagnostic(field, "event script diagnostic");
                else if (key === "payload")
                    validateScriptJson(field, `last event ${type}.${key}`);
                else if (key === "effects") {
                    for (const effectValue of array(field, `last event ${type}.effects`)) {
                        const effectBase = checkpointObjectDescriptors(effectValue, "Game checkpoint ability event effect");
                        const kind = stringValue(checkpointDataField(effectBase, "kind", "ability event effect"), "ability event effect kind");
                        if (kind === "damage") {
                            const effect = closed(effectValue, "ability damage effect", ["kind", "amount"]);
                            finite(checkpointDataField(effect, "amount", "ability damage effect"), "ability damage amount");
                        }
                        else if (kind === "status") {
                            const effect = closed(effectValue, "ability status effect", ["kind", "status"]);
                            const status = closed(checkpointDataField(effect, "status", "ability status effect"), "ability status spec", [], ["stun", "slow", "poison", "slowAffectsClasses"]);
                            optionalFinite(status, "stun", "ability status spec");
                            if (own(status, "slow")) {
                                const slow = closed(checkpointDataField(status, "slow", "ability status spec"), "ability slow spec", ["factor", "duration"]);
                                finite(checkpointDataField(slow, "factor", "ability slow spec"), "ability slow factor", 0, 1);
                                finite(checkpointDataField(slow, "duration", "ability slow spec"), "ability slow duration");
                            }
                            if (own(status, "poison")) {
                                const poison = closed(checkpointDataField(status, "poison", "ability status spec"), "ability poison spec", ["dps", "duration"]);
                                finite(checkpointDataField(poison, "dps", "ability poison spec"), "ability poison dps");
                                finite(checkpointDataField(poison, "duration", "ability poison spec"), "ability poison duration");
                            }
                            if (own(status, "slowAffectsClasses")) {
                                const classes = stringArray(checkpointDataField(status, "slowAffectsClasses", "ability status spec"), "ability slow classes", true);
                                if (classes.some((item) => item !== "ground" && item !== "flying"))
                                    throw new Error("Game checkpoint ability slow class is invalid.");
                            }
                        }
                        else if (kind === "displacement") {
                            const effect = closed(effectValue, "ability displacement effect", ["kind", "mode", "distance", "stopAtBlocker"]);
                            const mode = stringValue(checkpointDataField(effect, "mode", "ability displacement effect"), "ability displacement mode");
                            const distance = checkpointDataField(effect, "distance", "ability displacement effect");
                            const stopAtBlocker = checkpointDataField(effect, "stopAtBlocker", "ability displacement effect");
                            if (mode !== "push" && mode !== "pull")
                                throw new Error("Game checkpoint ability displacement mode is invalid.");
                            if (!Number.isSafeInteger(distance) || distance < 1 || distance > 8) {
                                throw new Error("Game checkpoint ability displacement distance is invalid.");
                            }
                            if (typeof stopAtBlocker !== "boolean")
                                throw new Error("Game checkpoint ability displacement stopAtBlocker is invalid.");
                        }
                        else {
                            throw new Error("Game checkpoint ability event effect kind is invalid.");
                        }
                    }
                }
            }
            for (const key of ["enemyTypeId", "parentEnemyTypeId", "targetEnemyTypeId"]) {
                if (!own(event, key))
                    continue;
                const typeId = stringValue(checkpointDataField(event, key, type), `${type}.${key}`);
                if (!own(content.enemies, typeId))
                    throw new Error("Game checkpoint event references an unknown enemy type.");
            }
            if (own(event, "towerTypeId")) {
                const typeId = stringValue(checkpointDataField(event, "towerTypeId", type), `${type}.towerTypeId`);
                if (!own(content.towers, typeId))
                    throw new Error("Game checkpoint event references an unknown tower type.");
            }
            if (own(event, "abilityId") && type !== "heroAbilityUsed") {
                const abilityId = stringValue(checkpointDataField(event, "abilityId", type), `${type}.abilityId`);
                if (!abilityIds.has(abilityId))
                    throw new Error("Game checkpoint event references an unknown ability.");
            }
            if (type === "scriptSignal") {
                const scriptId = stringValue(checkpointDataField(event, "scriptId", type), "script signal scriptId");
                if (scriptId !== "external" && !own(content.scripts, scriptId))
                    throw new Error("Game checkpoint event references an unknown script.");
            }
            if (type === "enemyDisplacementResolved" || type === "enemyFell") {
                const sourceKind = checkpointDataField(event, "sourceKind", type);
                if (sourceKind !== "tower" && sourceKind !== "ability") {
                    throw new Error("Game checkpoint physics event sourceKind is invalid.");
                }
            }
            if (type === "elevationChanged") {
                if (!requiresElevationTerraformingCheckpoint) {
                    throw new Error("Game checkpoint elevationChanged event requires active terraforming elevation.");
                }
                const source = checkpointDataField(event, "source", type);
                const fromElevation = checkpointDataField(event, "fromElevation", type);
                const toElevation = checkpointDataField(event, "toElevation", type);
                if (source !== "script" && source !== "restore") {
                    throw new Error("Game checkpoint elevationChanged event source is invalid.");
                }
                if (!Number.isSafeInteger(fromElevation) || !Number.isSafeInteger(toElevation)
                    || fromElevation < TERRAFORMING_LIMITS.elevationMinimum
                    || fromElevation > TERRAFORMING_LIMITS.elevationMaximum
                    || toElevation < TERRAFORMING_LIMITS.elevationMinimum
                    || toElevation > TERRAFORMING_LIMITS.elevationMaximum) {
                    throw new Error("Game checkpoint elevationChanged event elevation is invalid.");
                }
            }
            if (type === "enemyDisplacementResolved") {
                const mode = checkpointDataField(event, "mode", type);
                const reason = checkpointDataField(event, "stopReason", type);
                const requested = checkpointDataField(event, "requestedDistance", type);
                const moved = checkpointDataField(event, "movedDistance", type);
                const reasons = new Set([
                    "completed", "same_source_target", "blocked", "atomic_blocked", "no_strict_neighbor",
                    "fall_hazard", "goal_blocked", "immune"
                ]);
                if (mode !== "push" && mode !== "pull")
                    throw new Error("Game checkpoint displacement event mode is invalid.");
                if (typeof reason !== "string" || !reasons.has(reason))
                    throw new Error("Game checkpoint displacement stop reason is invalid.");
                if (!Number.isSafeInteger(requested) || requested < 1 || requested > 8
                    || !Number.isSafeInteger(moved) || moved < 0 || moved > requested) {
                    throw new Error("Game checkpoint displacement event distance is invalid.");
                }
            }
            if (type === "heroShieldChanged" || type === "heroAttacked" || type === "heroDefeated") {
                if (checkpointHeroes?.schemaVersion !== 3 && checkpointHeroes?.schemaVersion !== 4
                    && checkpointHeroes?.schemaVersion !== 5 && checkpointHeroes?.schemaVersion !== 6) {
                    throw new Error("Game checkpoint hero event requires active hero durability.");
                }
                const selectedHeroId = checkpointHeroes.selectedHeroId;
                const durableDefinition = checkpointHeroes.definitions[selectedHeroId].durability;
                const heroId = stringValue(checkpointDataField(event, "heroId", type), `${type}.heroId`);
                if (heroId !== selectedHeroId) {
                    throw new Error("Game checkpoint hero event references an unavailable hero.");
                }
                const nearlyEqual = (left, right) => (Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right)));
                if (type === "heroShieldChanged") {
                    const definition = durableDefinition.shield;
                    if (!definition || checkpointDataField(event, "cause", type) !== "damage") {
                        throw new Error("Game checkpoint hero shield event cause or authored shield is invalid.");
                    }
                    const previous = finite(checkpointDataField(event, "previous", type), `${type}.previous`, 0, definition.capacity);
                    const current = finite(checkpointDataField(event, "current", type), `${type}.current`, 0, definition.capacity);
                    const capacity = finite(checkpointDataField(event, "capacity", type), `${type}.capacity`, 0, definition.capacity);
                    const amount = finite(checkpointDataField(event, "amount", type), `${type}.amount`, 0, definition.capacity);
                    if (capacity !== definition.capacity || current > previous || !nearlyEqual(previous - current, amount)) {
                        throw new Error("Game checkpoint hero shield event arithmetic or capacity is invalid.");
                    }
                    if (own(event, "overflowDamage")) {
                        const overflow = finite(checkpointDataField(event, "overflowDamage", type), `${type}.overflowDamage`, 0);
                        if (overflow <= 0 || current !== 0 || !nearlyEqual(previous, amount)) {
                            throw new Error("Game checkpoint hero shield overflow event is invalid.");
                        }
                    }
                }
                else if (type === "heroAttacked") {
                    const damage = finite(checkpointDataField(event, "damage", type), `${type}.damage`, 0);
                    const shieldAbsorbed = finite(checkpointDataField(event, "shieldAbsorbed", type), `${type}.shieldAbsorbed`, 0);
                    const hpDamage = finite(checkpointDataField(event, "hpDamage", type), `${type}.hpDamage`, 0);
                    const authoredShieldCapacity = durableDefinition.shield?.capacity ?? 0;
                    if (damage <= 0 || shieldAbsorbed > authoredShieldCapacity
                        || !nearlyEqual(damage, shieldAbsorbed + hpDamage)) {
                        throw new Error("Game checkpoint hero attack damage decomposition is invalid.");
                    }
                }
                else {
                    const definitionId = stringValue(checkpointDataField(event, "heroDefinitionId", type), `${type}.heroDefinitionId`);
                    if (definitionId !== selectedHeroId) {
                        throw new Error("Game checkpoint hero defeat event references an unavailable definition.");
                    }
                    const heroesState = closed(checkpointDataField(descriptors, "heroes", "Game checkpoint state"), "heroes", ["schemaVersion", "unit"]);
                    const skillTree = checkpointHeroes.schemaVersion === 5 || checkpointHeroes.schemaVersion === 6
                        ? checkpointHeroes.definitions[selectedHeroId].skillTree
                        : null;
                    const expectedDurabilityCheckpointVersion = (checkpointHeroes.schemaVersion === 5
                        || checkpointHeroes.schemaVersion === 6) && skillTree !== null
                        ? 4
                        : checkpointHeroes.schemaVersion === 4 || checkpointHeroes.schemaVersion === 5
                            || checkpointHeroes.schemaVersion === 6 ? 3 : 2;
                    if (checkpointDataField(heroesState, "schemaVersion", "heroes") !== expectedDurabilityCheckpointVersion) {
                        throw new Error("Game checkpoint hero defeat event requires durable hero state.");
                    }
                    const heroUnit = closed(checkpointDataField(heroesState, "unit", "heroes"), "hero unit", (checkpointHeroes.schemaVersion === 5 || checkpointHeroes.schemaVersion === 6) && skillTree !== null
                        ? [
                            "definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent",
                            "mana", "abilityCooldownRemaining", "skillPoints", "unlockedSkillIds"
                        ]
                        : checkpointHeroes.schemaVersion === 4 || checkpointHeroes.schemaVersion === 5
                            || checkpointHeroes.schemaVersion === 6
                            ? [
                                "definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent",
                                "mana", "abilityCooldownRemaining"
                            ]
                            : ["definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent"]);
                    const currentHp = finite(checkpointDataField(heroUnit, "hp", "hero unit"), "hero hp", 0, durableDefinition.maxHp);
                    if (currentHp !== 0) {
                        throw new Error("Game checkpoint hero defeat event requires zero hero HP.");
                    }
                }
            }
            if (type === "heroAbilityUsed") {
                if (checkpointHeroes?.schemaVersion !== 4 && checkpointHeroes?.schemaVersion !== 5
                    && checkpointHeroes?.schemaVersion !== 6) {
                    throw new Error("Game checkpoint hero ability event requires active hero abilities.");
                }
                const selectedHeroId = checkpointHeroes.selectedHeroId;
                const definition = checkpointHeroes.definitions[selectedHeroId];
                const heroId = stringValue(checkpointDataField(event, "heroId", type), `${type}.heroId`);
                const definitionId = stringValue(checkpointDataField(event, "heroDefinitionId", type), `${type}.heroDefinitionId`);
                const abilityId = stringValue(checkpointDataField(event, "abilityId", type), `${type}.abilityId`);
                const targetEnemyId = stringValue(checkpointDataField(event, "targetEnemyId", type), `${type}.targetEnemyId`);
                const targetEnemyTypeId = stringValue(checkpointDataField(event, "targetEnemyTypeId", type), `${type}.targetEnemyTypeId`);
                const targetEnemyState = state.enemies.find((enemy) => enemy.id === targetEnemyId);
                if (heroId !== selectedHeroId || definitionId !== selectedHeroId || abilityId !== definition.activeAbility.id
                    || !targetEnemyState || targetEnemyState.typeId !== targetEnemyTypeId || !own(content.enemies, targetEnemyTypeId)) {
                    throw new Error("Game checkpoint hero ability event references unavailable authored state.");
                }
                const previousMana = finite(checkpointDataField(event, "previousMana", type), `${type}.previousMana`, 0, definition.mana.max);
                const currentMana = finite(checkpointDataField(event, "currentMana", type), `${type}.currentMana`, 0, definition.mana.max);
                const manaSpent = finite(checkpointDataField(event, "manaSpent", type), `${type}.manaSpent`, 0, definition.mana.max);
                const cooldownApplied = finite(checkpointDataField(event, "cooldownApplied", type), `${type}.cooldownApplied`, 0, definition.activeAbility.cooldown);
                const requestedDamage = finite(checkpointDataField(event, "requestedDamage", type), `${type}.requestedDamage`, 0);
                const resolvedDamage = finite(checkpointDataField(event, "resolvedDamage", type), `${type}.resolvedDamage`, 0);
                const shieldAbsorbed = finite(checkpointDataField(event, "shieldAbsorbed", type), `${type}.shieldAbsorbed`, 0);
                const hpDamage = finite(checkpointDataField(event, "hpDamage", type), `${type}.hpDamage`, 0);
                const nearlyEqual = (left, right) => (Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right)));
                if (!nearlyEqual(previousMana - currentMana, manaSpent) || manaSpent !== definition.activeAbility.manaCost
                    || cooldownApplied !== definition.activeAbility.cooldown || requestedDamage !== definition.activeAbility.damage
                    || !nearlyEqual(resolvedDamage, shieldAbsorbed + hpDamage)) {
                    throw new Error("Game checkpoint hero ability event arithmetic is invalid.");
                }
                if (retainedHeroAbilityState
                    && !nearlyEqual(previousMana, retainedHeroAbilityState.currentMana)) {
                    throw new Error("Game checkpoint retained hero ability event mana chain is invalid.");
                }
                retainedHeroAbilityState = {
                    currentMana,
                    cooldownApplied,
                    manaMaximum: definition.mana.max,
                    cooldownMaximum: definition.activeAbility.cooldown
                };
            }
            if (type === "heroSkillUnlocked" || type === "heroSkillPointsGranted") {
                if (checkpointHeroes?.schemaVersion !== 5 && checkpointHeroes?.schemaVersion !== 6) {
                    throw new Error("Game checkpoint hero skill event requires active heroes v5.");
                }
                const selectedHeroId = checkpointHeroes.selectedHeroId;
                const tree = checkpointHeroes.definitions[selectedHeroId].skillTree;
                const heroId = stringValue(checkpointDataField(event, "heroId", type), `${type}.heroId`);
                const definitionId = stringValue(checkpointDataField(event, "heroDefinitionId", type), `${type}.heroDefinitionId`);
                const previousPoints = integer(checkpointDataField(event, "previousPoints", type), `${type}.previousPoints`);
                const currentPoints = integer(checkpointDataField(event, "currentPoints", type), `${type}.currentPoints`);
                if (!tree || heroId !== selectedHeroId || definitionId !== selectedHeroId) {
                    throw new Error("Game checkpoint hero skill event references unavailable authored state.");
                }
                if (retainedHeroSkillPointState && retainedHeroSkillPointState.currentPoints !== previousPoints) {
                    throw new Error("Game checkpoint retained hero skill point event chain is disconnected.");
                }
                const unlockedSkillIds = retainedHeroSkillPointState?.unlockedSkillIds ?? [];
                if (type === "heroSkillUnlocked") {
                    const skillId = stringValue(checkpointDataField(event, "skillId", type), `${type}.skillId`);
                    const cost = integer(checkpointDataField(event, "cost", type), `${type}.cost`, 1);
                    if (!tree.nodes[skillId] || tree.nodes[skillId].cost !== cost || previousPoints - cost !== currentPoints) {
                        throw new Error("Game checkpoint hero skill unlock event arithmetic is invalid.");
                    }
                    if (unlockedSkillIds.includes(skillId)) {
                        throw new Error("Game checkpoint retained hero skill event chain contains a duplicate unlock.");
                    }
                    unlockedSkillIds.push(skillId);
                }
                else {
                    const amount = integer(checkpointDataField(event, "amount", type), `${type}.amount`, 1);
                    const waveIndex = integer(checkpointDataField(event, "waveIndex", type), `${type}.waveIndex`);
                    if (amount !== tree.points.perInterwave || previousPoints + amount !== currentPoints
                        || waveIndex + 1 >= mission.waves.length) {
                        throw new Error("Game checkpoint hero skill point grant event arithmetic is invalid.");
                    }
                }
                retainedHeroSkillPointState = { currentPoints, unlockedSkillIds };
            }
            if ((type === "enemyShieldChanged" || type === "towerShieldChanged")) {
                const cause = checkpointDataField(event, "cause", type);
                if (cause !== "damage" && cause !== "regeneration" && cause !== "script") {
                    throw new Error("Game checkpoint shield event cause is invalid.");
                }
            }
            if (type === "enemyMarkChanged") {
                const cause = checkpointDataField(event, "cause", type);
                if (cause !== "application" && cause !== "consume" && cause !== "expiration" && cause !== "script") {
                    throw new Error("Game checkpoint mark event cause is invalid.");
                }
                const markId = stringValue(checkpointDataField(event, "markId", type), `${type}.markId`);
                const activeCombatMechanics = resolveActiveCombatMechanics(content, identity.missionId);
                const markDefinitions = activeCombatMechanics?.marks?.definitions;
                const markDefinition = markDefinitions && Object.prototype.hasOwnProperty.call(markDefinitions, markId)
                    ? markDefinitions[markId]
                    : undefined;
                if (!markDefinition)
                    throw new Error("Game checkpoint mark event references an unknown mark.");
                const previousStacks = integer(checkpointDataField(event, "previousStacks", type), `${type}.previousStacks`, 0);
                const currentStacks = integer(checkpointDataField(event, "currentStacks", type), `${type}.currentStacks`, 0);
                if (previousStacks > markDefinition.maxStacks || currentStacks > markDefinition.maxStacks) {
                    throw new Error("Game checkpoint mark event stacks exceed the mark definition.");
                }
                const previousRemaining = finite(checkpointDataField(event, "previousRemaining", type), `${type}.previousRemaining`, 0);
                const remaining = finite(checkpointDataField(event, "remaining", type), `${type}.remaining`, 0);
                if (previousRemaining > markDefinition.duration || remaining > markDefinition.duration) {
                    throw new Error("Game checkpoint mark event remaining duration exceeds the mark definition.");
                }
            }
            if (type === "enemyExposureChanged") {
                if (!activeReactions)
                    throw new Error("Game checkpoint exposure event requires active reactions.");
                const exposureId = stringValue(checkpointDataField(event, "exposureId", type), `${type}.exposureId`);
                const definition = activeReactions.exposures.definitions[exposureId];
                if (!definition)
                    throw new Error("Game checkpoint exposure event references an unknown exposure.");
                const cause = checkpointDataField(event, "cause", type);
                if (cause !== "damage" && cause !== "consume" && cause !== "expiration" && cause !== "script") {
                    throw new Error("Game checkpoint exposure event cause is invalid.");
                }
                const previousStacks = integer(checkpointDataField(event, "previousStacks", type), `${type}.previousStacks`);
                const currentStacks = integer(checkpointDataField(event, "currentStacks", type), `${type}.currentStacks`);
                if (previousStacks > definition.maxStacks || currentStacks > definition.maxStacks) {
                    throw new Error("Game checkpoint exposure event stacks exceed the exposure definition.");
                }
                const previousRemaining = finite(checkpointDataField(event, "previousRemaining", type), `${type}.previousRemaining`);
                const remaining = finite(checkpointDataField(event, "remaining", type), `${type}.remaining`);
                if (previousRemaining > definition.duration || remaining > definition.duration) {
                    throw new Error("Game checkpoint exposure event remaining exceeds the exposure definition.");
                }
            }
            if (type === "enemyReactionTriggered") {
                if (!activeReactions)
                    throw new Error("Game checkpoint reaction event requires active reactions.");
                const reactionId = stringValue(checkpointDataField(event, "reactionId", type), `${type}.reactionId`);
                if (!activeReactions.reactions[reactionId]) {
                    throw new Error("Game checkpoint reaction event references an unknown reaction.");
                }
                const triggerDamageType = stringValue(checkpointDataField(event, "triggerDamageType", type), `${type}.triggerDamageType`);
                if (!activeCombat?.damageTypes[triggerDamageType]) {
                    throw new Error("Game checkpoint reaction event references an unknown trigger damage type.");
                }
                integer(checkpointDataField(event, "depth", type), `${type}.depth`);
                if (checkpointDataField(event, "depth", type) > REACTION_LIMITS.maxDepth) {
                    throw new Error("Game checkpoint reaction event depth exceeds the runtime budget.");
                }
                const scheduledTargetIds = stringArray(checkpointDataField(event, "scheduledTargetIds", type), `${type}.scheduledTargetIds`, true);
                if (scheduledTargetIds.length > REACTION_LIMITS.secondaryPacketsPerRoot) {
                    throw new Error("Game checkpoint reaction event target list exceeds the per-root packet budget.");
                }
            }
            if (type === "reactionBudgetExceeded") {
                const budget = checkpointDataField(event, "budget", type);
                if (budget !== "depth" && budget !== "secondary_packets" && budget !== "live_exposures") {
                    throw new Error("Game checkpoint reaction budget event kind is unknown.");
                }
                const expectedLimit = budget === "depth"
                    ? REACTION_LIMITS.maxDepth
                    : budget === "secondary_packets"
                        ? REACTION_LIMITS.secondaryPacketsPerRoot
                        : REACTION_LIMITS.runtimeExposureApplications;
                if (checkpointDataField(event, "limit", type) !== expectedLimit) {
                    throw new Error("Game checkpoint reaction budget event limit is invalid.");
                }
                integer(checkpointDataField(event, "dropped", type), `${type}.dropped`, 1);
            }
            if (type === "artifactDropped") {
                if (!checkpointRoguelite?.artifacts || !state.artifacts) {
                    throw new Error("Game checkpoint artifact drop event requires active roguelite artifacts.");
                }
                const artifactId = stringValue(checkpointDataField(event, "artifactId", type), `${type}.artifactId`);
                const instanceId = stringValue(checkpointDataField(event, "artifactInstanceId", type), `${type}.artifactInstanceId`);
                const enemyTypeId = stringValue(checkpointDataField(event, "enemyTypeId", type), `${type}.enemyTypeId`);
                const rollIndex = integer(checkpointDataField(event, "rollIndex", type), `${type}.rollIndex`);
                const table = checkpointRoguelite.artifacts.bossLootTables[enemyTypeId];
                if (!checkpointRoguelite.artifacts.definitions[artifactId]
                    || !table
                    || !table.entries.some((entry) => entry.artifactId === artifactId)
                    || rollIndex >= table.rolls
                    || !state.artifacts.inventory.some((entry) => (entry.instanceId === instanceId && entry.artifactId === artifactId))) {
                    throw new Error("Game checkpoint artifact drop event is inconsistent with authored loot or inventory.");
                }
            }
            if (type === "artifactSocketed" || type === "artifactUnsocketed") {
                if (!checkpointRoguelite?.artifacts || state.artifacts?.schemaVersion !== 2) {
                    throw new Error("Game checkpoint artifact socket event requires artifact checkpoint v2.");
                }
                const artifactId = stringValue(checkpointDataField(event, "artifactId", type), `${type}.artifactId`);
                const instanceId = stringValue(checkpointDataField(event, "artifactInstanceId", type), `${type}.artifactInstanceId`);
                const towerTypeId = stringValue(checkpointDataField(event, "towerTypeId", type), `${type}.towerTypeId`);
                const towerId = stringValue(checkpointDataField(event, "towerId", type), `${type}.towerId`);
                const slotId = stringValue(checkpointDataField(event, "slotId", type), `${type}.slotId`);
                const towerIdMatch = /^tower_([1-9]\d*)$/.exec(towerId);
                const towerNumericId = towerIdMatch ? Number(towerIdMatch[1]) : Number.NaN;
                const currentTower = towerStateById.get(towerId);
                const definition = checkpointRoguelite.artifacts.definitions[artifactId];
                const slot = checkpointRoguelite.artifacts.towerSlots[towerTypeId]
                    ?.find((candidate) => candidate.slotId === slotId);
                if (!towerIdMatch
                    || !Number.isSafeInteger(towerNumericId)
                    || towerNumericId > towerCounter
                    || (currentTower !== undefined && currentTower.typeId !== towerTypeId)
                    || !own(content.towers, towerTypeId)
                    ||
                        !definition
                    || !slot
                    || definition.slotType !== slot.slotType
                    || !state.artifacts.inventory.some((entry) => (entry.instanceId === instanceId && entry.artifactId === artifactId))) {
                    throw new Error("Game checkpoint artifact socket event is inconsistent with inventory or authored slots.");
                }
                if (type === "artifactUnsocketed") {
                    const cause = checkpointDataField(event, "cause", type);
                    if (cause !== "command" && cause !== "tower_sold" && cause !== "tower_destroyed") {
                        throw new Error("Game checkpoint artifact unsocket event cause is invalid.");
                    }
                }
            }
            optionalRoute(event, `last event ${type}`);
        }
        if (retainedHeroAbilityState) {
            const heroesState = closed(checkpointDataField(descriptors, "heroes", "Game checkpoint state"), "heroes", ["schemaVersion", "unit"]);
            const retainedHeroesVersion = checkpointDataField(heroesState, "schemaVersion", "heroes");
            if (retainedHeroesVersion !== 3 && retainedHeroesVersion !== 4) {
                throw new Error("Game checkpoint hero ability event requires hero ability state.");
            }
            const heroUnit = closed(checkpointDataField(heroesState, "unit", "heroes"), "hero unit", [
                "definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent",
                "mana", "abilityCooldownRemaining",
                ...(retainedHeroesVersion === 4 ? ["skillPoints", "unlockedSkillIds"] : [])
            ]);
            const authoritativeMana = finite(checkpointDataField(heroUnit, "mana", "hero unit"), "hero mana", 0, retainedHeroAbilityState.manaMaximum);
            const authoritativeCooldown = finite(checkpointDataField(heroUnit, "abilityCooldownRemaining", "hero unit"), "hero ability cooldown", 0, retainedHeroAbilityState.cooldownMaximum);
            const nearlyEqual = (left, right) => (Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right)));
            if (!nearlyEqual(retainedHeroAbilityState.currentMana, authoritativeMana)
                || !nearlyEqual(retainedHeroAbilityState.cooldownApplied, authoritativeCooldown)) {
                throw new Error("Game checkpoint hero ability event does not match authoritative mana or cooldown state.");
            }
        }
        if (retainedHeroSkillPointState) {
            const heroesState = closed(checkpointDataField(descriptors, "heroes", "Game checkpoint state"), "heroes", ["schemaVersion", "unit"]);
            if (checkpointDataField(heroesState, "schemaVersion", "heroes") !== 4) {
                throw new Error("Game checkpoint hero skill events require nested heroes state v4.");
            }
            const heroUnit = closed(checkpointDataField(heroesState, "unit", "heroes"), "hero unit", [
                "definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent",
                "mana", "abilityCooldownRemaining", "skillPoints", "unlockedSkillIds"
            ]);
            const authoritativePoints = integer(checkpointDataField(heroUnit, "skillPoints", "hero unit"), "hero authoritative skill points");
            const authoritativeUnlockedSkillIds = stringArray(checkpointDataField(heroUnit, "unlockedSkillIds", "hero unit"), "hero authoritative unlocked skill ids", true);
            const tree = checkpointHeroes?.schemaVersion === 5 || checkpointHeroes?.schemaVersion === 6
                ? checkpointHeroes.definitions[checkpointHeroes.selectedHeroId].skillTree
                : null;
            if (!tree) {
                throw new Error("Game checkpoint retained hero skill event chain has no authored tree.");
            }
            const retainedUnlockSet = new Set(retainedHeroSkillPointState.unlockedSkillIds);
            const reconstructedUnlocks = new Set(authoritativeUnlockedSkillIds.filter((skillId) => !retainedUnlockSet.has(skillId)));
            for (const skillId of retainedHeroSkillPointState.unlockedSkillIds) {
                const node = tree.nodes[skillId];
                if (!node || reconstructedUnlocks.has(skillId)) {
                    throw new Error("Game checkpoint retained hero skill unlock chain contains an unavailable or duplicate skill.");
                }
                if (node.requires.some((requiredId) => !reconstructedUnlocks.has(requiredId))) {
                    throw new Error("Game checkpoint retained hero skill unlock chain violates prerequisite order.");
                }
                reconstructedUnlocks.add(skillId);
            }
            const reconstructedSkillIds = [...reconstructedUnlocks].sort(compareBinary);
            const authoritativeSkillIds = [...authoritativeUnlockedSkillIds].sort(compareBinary);
            if (retainedHeroSkillPointState.currentPoints !== authoritativePoints
                || reconstructedSkillIds.length !== authoritativeSkillIds.length
                || reconstructedSkillIds.some((skillId, index) => skillId !== authoritativeSkillIds[index])) {
                throw new Error("Game checkpoint retained hero skill event chain does not match authoritative state.");
            }
        }
        for (const value of array(state.runtimeTerrainOverrides, "runtimeTerrainOverrides")) {
            const override = closed(value, "terrain override", ["q", "r", "terrain", "source"], ["expiresIn"]);
            validCoord({
                q: checkpointDataField(override, "q", "terrain override"),
                r: checkpointDataField(override, "r", "terrain override")
            }, "terrain override");
            const terrain = checkpointDataField(override, "terrain", "Game checkpoint terrain override");
            const source = checkpointDataField(override, "source", "Game checkpoint terrain override");
            if (typeof terrain !== "string" || !own(content.terrainTypes, terrain) || (source !== "script" && source !== "ability")) {
                throw new Error("Game checkpoint terrain override is invalid.");
            }
            optionalFinite(override, "expiresIn", "terrain override");
        }
        const overrideKeys = state.runtimeTerrainOverrides.map((override) => coordKey(override));
        if (new Set(overrideKeys).size !== overrideKeys.length)
            throw new Error("Game checkpoint has duplicate terrain override coordinates.");
        if (overrideKeys.length > TOWER_SCRIPT_LIMITS.activeTerrainOverrides)
            throw new Error("Game checkpoint terrain override budget is exceeded.");
        const authoredTerrain = new Map(mapDefinition.terrainOverrides.map((override) => [coordKey(override), override.terrain]));
        const authoredTerrainAt = (coord) => {
            const key = coordKey(coord);
            if (key === coordKey(mapDefinition.spawnCoord))
                return "spawn";
            if (key === coordKey(mapDefinition.coreCoord))
                return "core";
            return authoredTerrain.get(key) ?? mapDefinition.defaultTerrain;
        };
        if (hasHeroesCheckpoint && (checkpointHeroes?.schemaVersion === 2
            || checkpointHeroes?.schemaVersion === 3
            || checkpointHeroes?.schemaVersion === 4
            || checkpointHeroes?.schemaVersion === 5
            || checkpointHeroes?.schemaVersion === 6)) {
            const heroes = closed(state.heroes, "heroes", ["schemaVersion", "unit"]);
            const heroSkillTree = checkpointHeroes.schemaVersion === 5 || checkpointHeroes.schemaVersion === 6
                ? checkpointHeroes.definitions[checkpointHeroes.selectedHeroId].skillTree
                : null;
            const expectedHeroCheckpointVersion = (checkpointHeroes.schemaVersion === 5
                || checkpointHeroes.schemaVersion === 6) && heroSkillTree !== null
                ? 4
                : checkpointHeroes.schemaVersion === 4 || checkpointHeroes.schemaVersion === 5
                    || checkpointHeroes.schemaVersion === 6
                    ? 3
                    : checkpointHeroes.schemaVersion === 3 ? 2 : 1;
            if (checkpointDataField(heroes, "schemaVersion", "heroes") !== expectedHeroCheckpointVersion) {
                throw new Error("Game checkpoint hero state schema version is unsupported.");
            }
            const unit = closed(checkpointDataField(heroes, "unit", "heroes"), "hero unit", (checkpointHeroes.schemaVersion === 5 || checkpointHeroes.schemaVersion === 6) && heroSkillTree !== null
                ? [
                    "definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent",
                    "mana", "abilityCooldownRemaining", "skillPoints", "unlockedSkillIds"
                ]
                : checkpointHeroes.schemaVersion === 4 || checkpointHeroes.schemaVersion === 5
                    || checkpointHeroes.schemaVersion === 6
                    ? [
                        "definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent",
                        "mana", "abilityCooldownRemaining"
                    ]
                    : checkpointHeroes.schemaVersion === 3
                        ? ["definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent"]
                        : ["definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress"]);
            const definitionId = stringValue(checkpointDataField(unit, "definitionId", "hero unit"), "hero definitionId");
            if (definitionId !== checkpointHeroes.selectedHeroId) {
                throw new Error("Game checkpoint hero state references an unavailable definition.");
            }
            const definition = checkpointHeroes.definitions[definitionId];
            const currentCoord = validCoord(checkpointDataField(unit, "currentCoord", "hero unit"), "hero currentCoord");
            const rawTarget = checkpointDataField(unit, "targetCoord", "hero unit");
            const rawNext = checkpointDataField(unit, "nextCoord", "hero unit");
            const targetCoord = rawTarget === null ? null : validCoord(rawTarget, "hero targetCoord");
            const nextCoord = rawNext === null ? null : validCoord(rawNext, "hero nextCoord");
            const edgeProgress = finite(checkpointDataField(unit, "edgeProgress", "hero unit"), "hero edgeProgress", 0, 0.999999999999);
            let heroHp;
            let heroShieldCurrent;
            if (checkpointHeroes.schemaVersion === 3 || checkpointHeroes.schemaVersion === 4
                || checkpointHeroes.schemaVersion === 5 || checkpointHeroes.schemaVersion === 6) {
                const durability = checkpointHeroes.definitions[definitionId].durability;
                heroHp = finite(checkpointDataField(unit, "hp", "hero unit"), "hero hp", 0, durability.maxHp);
                heroShieldCurrent = finite(checkpointDataField(unit, "shieldCurrent", "hero unit"), "hero shieldCurrent", 0, durability.shield?.capacity ?? 0);
                if (heroHp < durability.maxHp && heroShieldCurrent > 0) {
                    throw new Error("Game checkpoint hero durability state violates shield-first damage ordering.");
                }
            }
            if (checkpointHeroes.schemaVersion === 4 || checkpointHeroes.schemaVersion === 5
                || checkpointHeroes.schemaVersion === 6) {
                const activeDefinition = checkpointHeroes.definitions[definitionId];
                finite(checkpointDataField(unit, "mana", "hero unit"), "hero mana", 0, activeDefinition.mana.max);
                finite(checkpointDataField(unit, "abilityCooldownRemaining", "hero unit"), "hero ability cooldown", 0, activeDefinition.activeAbility.cooldown);
            }
            if ((checkpointHeroes.schemaVersion === 5 || checkpointHeroes.schemaVersion === 6)
                && heroSkillTree !== null) {
                const skillPoints = integer(checkpointDataField(unit, "skillPoints", "hero unit"), "hero skill points", 0);
                const unlockedSkillIds = stringArray(checkpointDataField(unit, "unlockedSkillIds", "hero unit"), "hero unlocked skill ids", true);
                if (unlockedSkillIds.length > Object.keys(heroSkillTree.nodes).length) {
                    throw new Error("Game checkpoint hero skill unlock count exceeds the authored tree.");
                }
                for (let index = 0; index < unlockedSkillIds.length; index += 1) {
                    const skillId = unlockedSkillIds[index];
                    if (!heroSkillTree.nodes[skillId]) {
                        throw new Error("Game checkpoint hero skill state references an unavailable skill.");
                    }
                    if (index > 0 && compareBinary(unlockedSkillIds[index - 1], skillId) >= 0) {
                        throw new Error("Game checkpoint hero skill ids must be unique and binary-canonical.");
                    }
                }
                const unlocked = new Set(unlockedSkillIds);
                for (const skillId of unlockedSkillIds) {
                    if (heroSkillTree.nodes[skillId].requires.some((requiredId) => !unlocked.has(requiredId))) {
                        throw new Error("Game checkpoint hero skill prerequisite state is invalid.");
                    }
                }
                const awardedInterwaves = Math.min(state.clearedWaveCount, Math.max(0, mission.waves.length - 1));
                const spentPoints = unlockedSkillIds.reduce((total, skillId) => total + heroSkillTree.nodes[skillId].cost, 0);
                const expectedPoints = heroSkillTree.points.starting
                    + heroSkillTree.points.perInterwave * awardedInterwaves
                    - spentPoints;
                if (skillPoints !== expectedPoints || expectedPoints < 0) {
                    throw new Error("Game checkpoint hero skill point accounting is invalid.");
                }
            }
            if (heroHp === 0 && (targetCoord !== null || nextCoord !== null || edgeProgress !== 0)) {
                throw new Error("Game checkpoint defeated hero must use canonical idle movement state.");
            }
            if (targetCoord === null) {
                if (nextCoord !== null || edgeProgress !== 0) {
                    throw new Error("Game checkpoint idle hero state must have null movement coordinates and zero progress.");
                }
            }
            else {
                if (sameGridCoord(currentCoord, targetCoord)) {
                    throw new Error("Game checkpoint hero at its target must use canonical idle state.");
                }
                const terrainByCoord = {};
                const runtimeTerrain = new Map(state.runtimeTerrainOverrides.map((override) => [coordKey(override), override.terrain]));
                for (let r = 0; r < mapDefinition.height; r += 1) {
                    for (let q = 0; q < mapDefinition.width; q += 1) {
                        const coord = { q, r };
                        terrainByCoord[coordKey(coord)] = runtimeTerrain.get(coordKey(coord)) ?? authoredTerrainAt(coord);
                    }
                }
                const movementProfileId = definition.movement.movementProfileId;
                const field = buildNavigationField({
                    grid: normalizeGridDefinition(mapDefinition.grid),
                    width: mapDefinition.width,
                    height: mapDefinition.height,
                    movementProfileId,
                    goal: targetCoord,
                    profile: checkpointHeroes.movementProfiles[movementProfileId],
                    terrainTypes: content.terrainTypes,
                    terrainByCoord,
                    occupiedCoords: state.towers.flatMap((tower) => tower.footprint.map((coord) => ({ q: coord.q, r: coord.r })))
                });
                const currentCell = new NavigationFieldLookupCache().get(field).get(currentCoord);
                if (!currentCell?.nextCoord) {
                    if (nextCoord !== null || edgeProgress !== 0) {
                        throw new Error("Game checkpoint stalled hero must have null nextCoord and zero progress.");
                    }
                }
                else if (!nextCoord || !sameGridCoord(nextCoord, currentCell.nextCoord)) {
                    throw new Error("Game checkpoint hero nextCoord is not the canonical field link.");
                }
            }
        }
        if (hasTerraformingCheckpoint) {
            const schemaProbe = checkpointObjectDescriptors(state.terraforming, "Game checkpoint state terraforming");
            const terraformingSchemaVersion = checkpointDataField(schemaProbe, "schemaVersion", "terraforming");
            if (terraformingSchemaVersion !== 1 && terraformingSchemaVersion !== 2) {
                throw new Error("Game checkpoint terraforming schema version is unsupported.");
            }
            if (terraformingSchemaVersion === 1 && !requiresElevationTerraformingCheckpoint) {
                throw new Error("Game checkpoint terraforming v1 requires active terraforming elevation.");
            }
            const terraforming = closed(state.terraforming, "terraforming", terraformingSchemaVersion === 1
                ? ["schemaVersion", "runtimeElevationOverrides"]
                : ["schemaVersion", "runtimeElevationOverrides", "nextExpiryGroupSequence", "pendingExpiryGroups"]);
            const values = array(checkpointDataField(terraforming, "runtimeElevationOverrides", "terraforming"), "terraforming.runtimeElevationOverrides");
            if (values.length > TERRAFORMING_LIMITS.activeElevationOverrides) {
                throw new Error("Game checkpoint elevation override budget is exceeded.");
            }
            if (values.length > 0 && !requiresElevationTerraformingCheckpoint) {
                throw new Error("Game checkpoint terraforming elevation overrides require active terraforming elevation.");
            }
            if (values.length + overrideKeys.length > TERRAFORMING_LIMITS.activeOverridesCombined) {
                throw new Error("Game checkpoint combined terraforming override budget is exceeded.");
            }
            const authoredElevation = new Map((mapDefinition.elevationOverrides ?? []).map((entry) => [coordKey(entry), entry.elevation]));
            const runtimeElevationProjection = new Map();
            let previous;
            for (let index = 0; index < values.length; index += 1) {
                const value = closed(values[index], `terraforming elevation override ${index}`, ["q", "r", "elevation"]);
                const overrideCoord = validCoord({
                    q: checkpointDataField(value, "q", "terraforming elevation override"),
                    r: checkpointDataField(value, "r", "terraforming elevation override")
                }, `terraforming elevation override ${index}`);
                if (previous
                    && (overrideCoord.r < previous.r || (overrideCoord.r === previous.r && overrideCoord.q <= previous.q))) {
                    throw new Error("Game checkpoint terraforming elevation overrides are not canonical or contain duplicates.");
                }
                previous = overrideCoord;
                const elevation = checkpointDataField(value, "elevation", "terraforming elevation override");
                const policy = checkpointTerraforming.elevation;
                if (!Number.isSafeInteger(elevation)
                    || elevation < TERRAFORMING_LIMITS.elevationMinimum
                    || elevation > TERRAFORMING_LIMITS.elevationMaximum
                    || elevation < policy.minimum
                    || elevation > policy.maximum) {
                    throw new Error("Game checkpoint terraforming elevation override is outside the active policy.");
                }
                const baseElevation = authoredElevation.get(coordKey(overrideCoord)) ?? 0;
                if (elevation === baseElevation) {
                    throw new Error("Game checkpoint terraforming elevation override must differ from authored elevation.");
                }
                runtimeElevationProjection.set(coordKey(overrideCoord), elevation);
            }
            if (terraformingSchemaVersion === 2) {
                const nextSequence = integer(checkpointDataField(terraforming, "nextExpiryGroupSequence", "terraforming"), "terraforming.nextExpiryGroupSequence", 1);
                const groups = array(checkpointDataField(terraforming, "pendingExpiryGroups", "terraforming"), "terraforming.pendingExpiryGroups");
                if (groups.length > TERRAFORMING_LIMITS.pendingExpiryGroups) {
                    throw new Error("Game checkpoint pending terraforming expiry group budget is exceeded.");
                }
                const runtimeTerrainProjection = new Map(state.runtimeTerrainOverrides.map((override) => [coordKey(override), override]));
                const ownedTargets = new Set();
                let ownedTerrain = 0;
                let ownedElevation = 0;
                let previousSequence = 0;
                for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
                    const group = closed(groups[groupIndex], `terraforming expiry group ${groupIndex}`, ["sequence", "remaining", "entries"]);
                    const sequence = integer(checkpointDataField(group, "sequence", "terraforming expiry group"), `terraforming expiry group ${groupIndex} sequence`, 1);
                    if (sequence <= previousSequence || sequence >= nextSequence) {
                        throw new Error("Game checkpoint terraforming expiry group sequence is not canonical.");
                    }
                    previousSequence = sequence;
                    finite(checkpointDataField(group, "remaining", "terraforming expiry group"), `terraforming expiry group ${groupIndex} remaining`, 0, TERRAFORMING_LIMITS.duration);
                    const entries = array(checkpointDataField(group, "entries", "terraforming expiry group"), `terraforming expiry group ${groupIndex} entries`);
                    if (entries.length < 1 || entries.length > TERRAFORMING_LIMITS.operationsPerBatch) {
                        throw new Error("Game checkpoint terraforming expiry group entry budget is exceeded.");
                    }
                    let previousOrder = -1;
                    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
                        const entryProbe = checkpointObjectDescriptors(entries[entryIndex], `Game checkpoint state terraforming expiry entry ${groupIndex}:${entryIndex}`);
                        const layer = checkpointDataField(entryProbe, "layer", "terraforming expiry entry");
                        const entry = closed(entries[entryIndex], `terraforming expiry entry ${groupIndex}:${entryIndex}`, layer === "terrain"
                            ? ["layer", "order", "q", "r", "appliedTerrain", "previousOverride"]
                            : layer === "elevation"
                                ? ["layer", "order", "q", "r", "appliedElevation", "previousElevationOverride"]
                                : ["layer"]);
                        if (layer !== "terrain" && layer !== "elevation") {
                            throw new Error("Game checkpoint terraforming expiry entry layer is unsupported.");
                        }
                        const order = integer(checkpointDataField(entry, "order", "terraforming expiry entry"), `terraforming expiry entry ${groupIndex}:${entryIndex} order`);
                        if (order > 63 || order <= previousOrder) {
                            throw new Error("Game checkpoint terraforming expiry entry order is not canonical.");
                        }
                        previousOrder = order;
                        const targetCoord = validCoord({
                            q: checkpointDataField(entry, "q", "terraforming expiry entry"),
                            r: checkpointDataField(entry, "r", "terraforming expiry entry")
                        }, `terraforming expiry entry ${groupIndex}:${entryIndex}`);
                        const coordValue = coordKey(targetCoord);
                        const ownershipKey = `${layer}:${coordValue}`;
                        if (ownedTargets.has(ownershipKey)) {
                            throw new Error("Game checkpoint terraforming expiry target ownership is duplicated.");
                        }
                        ownedTargets.add(ownershipKey);
                        if (ownedTargets.size > TERRAFORMING_LIMITS.activeOverridesCombined) {
                            throw new Error("Game checkpoint terraforming expiry ownership budget is exceeded.");
                        }
                        if (layer === "terrain") {
                            ownedTerrain += 1;
                            if (ownedTerrain > TERRAFORMING_LIMITS.activeTerrainOverrides) {
                                throw new Error("Game checkpoint terrain expiry ownership budget is exceeded.");
                            }
                            const appliedTerrain = checkpointDataField(entry, "appliedTerrain", "terraforming terrain expiry entry");
                            if (typeof appliedTerrain !== "string" || !own(content.terrainTypes, appliedTerrain)) {
                                throw new Error("Game checkpoint terraforming expiry applied terrain is unknown.");
                            }
                            const current = runtimeTerrainProjection.get(coordValue);
                            const baseTerrain = authoredTerrainAt(targetCoord);
                            const effectiveTerrain = current?.terrain ?? baseTerrain;
                            const validRuntimeSource = current?.source === "script" || (current?.source === "ability"
                                && admitsNativePathWater
                                && appliedTerrain === "water"
                                && baseTerrain === "path");
                            if (effectiveTerrain !== appliedTerrain
                                || (appliedTerrain === baseTerrain && current !== undefined)
                                || (appliedTerrain !== baseTerrain && (!current || !validRuntimeSource || current.expiresIn !== undefined))) {
                                throw new Error("Game checkpoint terraforming terrain expiry projection does not match runtime state.");
                            }
                            const previousValue = checkpointDataField(entry, "previousOverride", "terraforming terrain expiry entry");
                            if (previousValue === null) {
                                if (baseTerrain === appliedTerrain) {
                                    throw new Error("Game checkpoint terraforming terrain expiry before-image is invalid.");
                                }
                            }
                            else {
                                const previousOverride = closed(previousValue, "terraforming terrain expiry previous override", ["terrain", "source"]);
                                const previousTerrain = checkpointDataField(previousOverride, "terrain", "terraforming terrain expiry previous override");
                                const previousSource = checkpointDataField(previousOverride, "source", "terraforming terrain expiry previous override");
                                if (typeof previousTerrain !== "string"
                                    || !own(content.terrainTypes, previousTerrain)
                                    || (previousSource !== "script" && previousSource !== "ability")
                                    || previousTerrain === appliedTerrain) {
                                    throw new Error("Game checkpoint terraforming terrain expiry previous override is invalid.");
                                }
                            }
                        }
                        else {
                            ownedElevation += 1;
                            if (!requiresElevationTerraformingCheckpoint) {
                                throw new Error("Game checkpoint elevation expiry requires active terraforming elevation.");
                            }
                            if (ownedElevation > TERRAFORMING_LIMITS.activeElevationOverrides) {
                                throw new Error("Game checkpoint elevation expiry ownership budget is exceeded.");
                            }
                            const appliedElevation = checkpointDataField(entry, "appliedElevation", "terraforming elevation expiry entry");
                            const policy = checkpointTerraforming.elevation;
                            const baseElevation = authoredElevation.get(coordValue) ?? 0;
                            const currentElevation = runtimeElevationProjection.get(coordValue);
                            const effectiveElevation = currentElevation ?? baseElevation;
                            if (!Number.isSafeInteger(appliedElevation)
                                || appliedElevation < TERRAFORMING_LIMITS.elevationMinimum
                                || appliedElevation > TERRAFORMING_LIMITS.elevationMaximum
                                || appliedElevation < policy.minimum
                                || appliedElevation > policy.maximum
                                || effectiveElevation !== appliedElevation
                                || (appliedElevation === baseElevation && currentElevation !== undefined)
                                || (appliedElevation !== baseElevation && currentElevation === undefined)) {
                                throw new Error("Game checkpoint terraforming elevation expiry projection is invalid.");
                            }
                            const previousElevation = checkpointDataField(entry, "previousElevationOverride", "terraforming elevation expiry entry");
                            if (previousElevation === null) {
                                if (baseElevation === appliedElevation) {
                                    throw new Error("Game checkpoint terraforming elevation expiry before-image is invalid.");
                                }
                            }
                            else if (!Number.isSafeInteger(previousElevation)
                                || previousElevation < policy.minimum
                                || previousElevation > policy.maximum
                                || previousElevation === baseElevation
                                || previousElevation === appliedElevation) {
                                throw new Error("Game checkpoint terraforming elevation expiry previous override is invalid.");
                            }
                        }
                    }
                }
            }
        }
        if (activeNavigationProfile) {
            const authoredTerrain = new Map(mapDefinition.terrainOverrides.map((override) => [coordKey(override), override.terrain]));
            const runtimeTerrain = new Map(state.runtimeTerrainOverrides.map((override) => [coordKey(override), override.terrain]));
            const terrainByCoord = {};
            for (let r = 0; r < mapDefinition.height; r += 1) {
                for (let q = 0; q < mapDefinition.width; q += 1) {
                    const key = coordKey({ q, r });
                    let terrain = authoredTerrain.get(key) ?? mapDefinition.defaultTerrain;
                    if (key === coordKey(mapDefinition.spawnCoord))
                        terrain = "spawn";
                    if (key === coordKey(mapDefinition.coreCoord))
                        terrain = "core";
                    terrainByCoord[key] = runtimeTerrain.get(key) ?? terrain;
                }
            }
            const routes = mapDefinition.pathRoutes?.length
                ? mapDefinition.pathRoutes
                : [{ id: "main", pathCenterline: mapDefinition.pathCenterline }];
            const occupiedNavigationCoords = state.towers.flatMap((tower) => (tower.footprint.map((coord) => ({ q: coord.q, r: coord.r }))));
            const resolver = new NavigationResolver({
                grid: normalizeGridDefinition(mapDefinition.grid),
                width: mapDefinition.width,
                height: mapDefinition.height,
                profile: activeNavigationProfile,
                terrainTypes: content.terrainTypes,
                terrainByCoord,
                occupiedCoords: occupiedNavigationCoords,
                routes
            });
            const lookups = new NavigationFieldLookupCache();
            for (const entry of navigationStates) {
                const navigation = entry.navigation;
                const field = resolver.getField(navigation.movementProfileId, entry.routeId);
                const lookup = lookups.get(field);
                const currentCell = lookup.get(navigation.currentCoord);
                const atGoal = navigation.currentCoord.q === field.goal.q && navigation.currentCoord.r === field.goal.r;
                if (!currentCell) {
                    if (navigation.nextCoord !== undefined || navigation.edgeProgress !== 0) {
                        throw new Error("Game checkpoint enemy navigation stalled state must omit nextCoord and have zero edge progress.");
                    }
                    continue;
                }
                if (atGoal) {
                    if (navigation.nextCoord !== undefined || navigation.edgeProgress !== 0) {
                        throw new Error("Game checkpoint enemy navigation goal state must omit nextCoord and have zero edge progress.");
                    }
                    continue;
                }
                if (!navigation.nextCoord) {
                    throw new Error("Game checkpoint enemy navigation reachable non-goal state is missing nextCoord.");
                }
                if (!topology.directionBetween(navigation.currentCoord, navigation.nextCoord)) {
                    throw new Error("Game checkpoint enemy navigation nextCoord must be adjacent to currentCoord.");
                }
                const nextCell = lookup.get(navigation.nextCoord);
                if (!nextCell || nextCell.distance >= currentCell.distance) {
                    throw new Error("Game checkpoint enemy navigation nextCoord must strictly lower field distance.");
                }
                if (!currentCell.nextCoord
                    || navigation.nextCoord.q !== currentCell.nextCoord.q
                    || navigation.nextCoord.r !== currentCell.nextCoord.r) {
                    throw new Error("Game checkpoint enemy navigation nextCoord is not the canonical field link.");
                }
            }
        }
        const eventCursor = integer(state.scriptEventCursor, "scriptEventCursor");
        if (eventCursor > state.lastEvents.length)
            throw new Error("Game checkpoint script event cursor is invalid.");
        integer(state.scriptActionsRemaining, "scriptActionsRemaining", 0);
        if (state.scriptActionsRemaining > TOWER_SCRIPT_LIMITS.actionsPerTransaction)
            throw new Error("Game checkpoint action budget is invalid.");
        integer(state.scriptTerrainChangesRemaining, "scriptTerrainChangesRemaining", 0);
        if (state.scriptTerrainChangesRemaining > TOWER_SCRIPT_LIMITS.terrainChangesPerTransaction)
            throw new Error("Game checkpoint terrain budget is invalid.");
        integer(state.scriptSignalDepth, "scriptSignalDepth", 0);
        if (state.scriptSignalDepth > TOWER_SCRIPT_LIMITS.signalRecursionDepth)
            throw new Error("Game checkpoint signal depth is invalid.");
    }
    restoreCheckpointState(state, initialRng, currentRng) {
        this.coreHp = state.coreHp;
        this.resources = { ...state.resources };
        this.waveIndex = state.waveIndex;
        this.startedWaveCount = state.startedWaveCount;
        this.waveState = state.waveState;
        this.prepRemaining = state.prepRemaining;
        this.outcome = state.outcome;
        this.enemies = state.enemies.map((enemy) => ({
            ...enemy,
            ...(enemy.navigation === undefined ? {} : {
                navigation: {
                    ...enemy.navigation,
                    currentCoord: { ...enemy.navigation.currentCoord },
                    ...(enemy.navigation.nextCoord === undefined ? {} : { nextCoord: { ...enemy.navigation.nextCoord } })
                }
            })
        }));
        this.navigationEnemyFields?.clear();
        this.towers = [...state.towers];
        if (state.campaignBattle) {
            this.campaignBattle = Object.freeze({
                schemaVersion: 1,
                launchId: state.campaignBattle.launchId,
                nodeId: state.campaignBattle.nodeId,
                maxNewArtifactInstances: state.campaignBattle.maxNewArtifactInstances,
                deck: Object.freeze(state.campaignBattle.deck.map((entry) => Object.freeze({ ...entry }))),
                artifacts: Object.freeze(state.campaignBattle.artifacts.map((entry) => Object.freeze({ ...entry })))
            });
            this.campaignDeck = this.campaignBattle.deck;
        }
        else {
            this.campaignBattle = undefined;
            this.campaignDeck = Object.freeze([]);
        }
        if (this.activeRogueliteMechanics?.artifacts && state.artifacts) {
            const artifacts = state.artifacts;
            this.artifactInitialRngState = cloneCheckpointJson(artifacts.rng.initial);
            this.artifactRng = SeededRng.fromState(artifacts.rng.current);
            this.nextArtifactInstanceSequence = artifacts.nextInstanceSequence;
            this.artifactCheckpointForm = artifacts.schemaVersion;
            this.artifactInventory = artifacts.schemaVersion === 2 || artifacts.schemaVersion === 3
                ? artifacts.inventory.map((entry) => ({
                    instanceId: entry.instanceId,
                    artifactId: entry.artifactId,
                    socket: entry.socket === null ? null : { ...entry.socket }
                }))
                : artifacts.inventory.map((entry) => ({
                    instanceId: entry.instanceId,
                    artifactId: entry.artifactId,
                    socket: null
                }));
        }
        else {
            this.artifactInitialRngState = undefined;
            this.artifactRng = undefined;
            this.nextArtifactInstanceSequence = 1;
            this.artifactInventory = [];
            this.artifactCheckpointForm = 0;
        }
        if (this.activeRogueliteMechanics?.draft && state.draft) {
            this.draftInitialRngState = cloneCheckpointJson(state.draft.rng.initial);
            this.draftRng = SeededRng.fromState(state.draft.rng.current);
            this.nextDraftOfferSequence = state.draft.nextOfferSequence;
            this.pendingDraftOffer = state.draft.pendingOffer === null
                ? null
                : Object.freeze({
                    ...state.draft.pendingOffer,
                    cardIds: Object.freeze([...state.draft.pendingOffer.cardIds])
                });
            this.draftSelections = state.draft.selections.map((selection) => Object.freeze({ ...selection }));
        }
        else {
            this.draftInitialRngState = undefined;
            this.draftRng = undefined;
            this.nextDraftOfferSequence = 1;
            this.pendingDraftOffer = null;
            this.draftSelections = [];
        }
        this.rebuildRogueliteSynergies();
        this.lastEvents = [...state.lastEvents];
        this.enemyCounter = state.enemyCounter;
        this.towerCounter = state.towerCounter;
        this.clearedWaveCount = state.clearedWaveCount;
        this.killCount = state.killCount;
        this.leakCount = state.leakCount;
        this.killCountByEnemyType = { ...state.killCountByEnemyType };
        this.completedObjectiveIds = new Set(state.completedObjectiveIds);
        this.earnedStarIds = new Set(state.earnedStarIds);
        this.spawnQueue = state.spawnQueue.map((item) => ({ ...item }));
        this.missionElapsed = state.missionElapsed;
        this.nextWaveStartAt = state.nextWaveStartAt;
        this.abilityCooldowns = { ...state.abilityCooldowns };
        this.scriptValues = state.scriptValues;
        this.scriptDiagnostics = [...state.scriptDiagnostics];
        this.scriptHandlerLastRun = { ...state.scriptHandlerLastRun };
        this.scriptEventCursor = state.scriptEventCursor;
        this.scriptActionsRemaining = state.scriptActionsRemaining;
        this.scriptTerrainChangesRemaining = state.scriptTerrainChangesRemaining;
        this.scriptSignalDepth = state.scriptSignalDepth;
        this.enemyShields = Object.fromEntries(Object.entries(state.combat?.shields.enemies ?? {}).map(([id, shield]) => [id, { ...shield }]));
        this.towerShields = Object.fromEntries(Object.entries(state.combat?.shields.towers ?? {}).map(([id, shield]) => [id, { ...shield }]));
        this.enemyMarks = state.combat?.schemaVersion === 2
            ? Object.fromEntries(Object.entries(state.combat.marks.enemies).map(([enemyId, marks]) => [
                enemyId,
                Object.fromEntries(Object.entries(marks).map(([markId, mark]) => [markId, { ...mark }]))
            ]))
            : {};
        this.enemyExposures = cloneEnemyExposureStates(state.reactions?.exposures.enemies ?? {});
        this.initialRngState = cloneCheckpointJson(initialRng);
        this.rng = SeededRng.fromState(currentRng);
        this.map.restoreAllTerrain();
        for (const tile of this.map.tiles.values())
            delete tile.occupiedBy;
        this.runtimeTerrainOverrides = new Map();
        for (const override of state.runtimeTerrainOverrides) {
            const restored = { ...override };
            this.runtimeTerrainOverrides.set(coordKey(restored), restored);
            this.map.setTerrain(restored, restored.terrain);
        }
        this.runtimeElevationOverrides = new Map();
        for (const override of state.terraforming?.runtimeElevationOverrides ?? []) {
            const restored = { ...override };
            this.runtimeElevationOverrides.set(coordKey(restored), restored);
        }
        this.terraformingCheckpointForm = state.terraforming?.schemaVersion ?? 0;
        this.pendingTerraformExpiryGroups = state.terraforming?.schemaVersion === 2
            ? state.terraforming.pendingExpiryGroups.map((group) => ({
                sequence: group.sequence,
                remaining: group.remaining,
                targets: group.entries.map((entry) => entry.layer === "terrain"
                    ? {
                        layer: "terrain",
                        order: entry.order,
                        q: entry.q,
                        r: entry.r,
                        appliedTerrain: entry.appliedTerrain,
                        previousOverride: entry.previousOverride === null ? null : { ...entry.previousOverride }
                    }
                    : {
                        layer: "elevation",
                        order: entry.order,
                        q: entry.q,
                        r: entry.r,
                        appliedElevation: entry.appliedElevation,
                        previousElevationOverride: entry.previousElevationOverride
                    })
            }))
            : [];
        this.nextTerraformExpirySequence = state.terraforming?.schemaVersion === 2
            ? state.terraforming.nextExpiryGroupSequence
            : 1;
        this.map.useRuntimeElevationOverrides(this.runtimeElevationOverrides);
        for (const tower of this.towers)
            this.map.setOccupied(tower.footprint, tower.id);
        this.syncTemporaryWaterTiles();
        this.syncNavigationResolver();
        if ((this.activeHeroesMechanics?.schemaVersion === 2
            || this.activeHeroesMechanics?.schemaVersion === 3
            || this.activeHeroesMechanics?.schemaVersion === 4
            || this.activeHeroesMechanics?.schemaVersion === 5
            || this.activeHeroesMechanics?.schemaVersion === 6)
            && state.heroes) {
            this.heroStateV2 = {
                definitionId: state.heroes.unit.definitionId,
                currentCoord: { ...state.heroes.unit.currentCoord },
                targetCoord: state.heroes.unit.targetCoord === null ? null : { ...state.heroes.unit.targetCoord },
                nextCoord: state.heroes.unit.nextCoord === null ? null : { ...state.heroes.unit.nextCoord },
                edgeProgress: state.heroes.unit.edgeProgress,
                ...(state.heroes.schemaVersion === 2 || state.heroes.schemaVersion === 3
                    || state.heroes.schemaVersion === 4 ? {
                    hp: state.heroes.unit.hp,
                    shieldCurrent: state.heroes.unit.shieldCurrent
                } : {}),
                ...(state.heroes.schemaVersion === 3 || state.heroes.schemaVersion === 4 ? {
                    mana: state.heroes.unit.mana,
                    abilityCooldownRemaining: state.heroes.unit.abilityCooldownRemaining
                } : {}),
                ...(state.heroes.schemaVersion === 4 ? {
                    skillPoints: state.heroes.unit.skillPoints,
                    unlockedSkillIds: new Set(state.heroes.unit.unlockedSkillIds)
                } : {})
            };
            this.heroMovementField = this.heroStateV2.targetCoord === null
                ? undefined
                : this.buildHeroMovementField(this.activeHeroesMechanics, this.heroStateV2.targetCoord);
            this.heroMovementDirty = false;
        }
        if (this.navigationEnemyFields) {
            for (const enemy of this.enemies) {
                if (!enemy.navigation || !enemy.routeId)
                    continue;
                this.navigationEnemyFields.set(enemy.id, this.navigationField(enemy.navigation.movementProfileId, enemy.routeId));
            }
        }
    }
    buildSnapshot(copyStaticState) {
        const combat = this.buildCombatState();
        const reactions = this.buildReactionState();
        const navigation = this.buildNavigationSnapshot();
        const elevation = this.buildElevationSnapshot(copyStaticState);
        const terraforming = this.activeTerraformingMechanics
            ? buildTerraformingSnapshot(this.pendingTerraformExpiryGroups)
            : undefined;
        const roguelite = this.currentRogueliteSnapshot();
        const heroes = this.activeHeroesMechanics?.schemaVersion === 6
            && this.heroStateV2
            && this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].passiveAura !== null
            ? (() => {
                const state = this.heroStateV2;
                const definition = this.activeHeroesMechanics.definitions[state.definitionId];
                const tree = definition.skillTree;
                const unlocked = state.unlockedSkillIds ?? new Set();
                const managementAvailable = this.heroSkillManagementAvailable();
                const skills = tree === null
                    ? null
                    : Object.freeze({
                        availablePoints: state.skillPoints ?? 0,
                        startingPoints: tree.points.starting,
                        pointsPerInterwave: tree.points.perInterwave,
                        maximumEarnablePoints: tree.points.starting
                            + tree.points.perInterwave * Math.max(0, this.mission.waves.length - 1),
                        managementAvailable,
                        nodes: Object.freeze(Object.entries(tree.nodes).map(([skillId, node]) => {
                            const missingRequirementIds = node.requires.filter((requiredId) => !unlocked.has(requiredId));
                            const isUnlocked = unlocked.has(skillId);
                            return Object.freeze({
                                id: skillId,
                                label: node.label,
                                description: node.description,
                                cost: node.cost,
                                requiresSkillIds: Object.freeze([...node.requires]),
                                missingRequirementIds: Object.freeze(missingRequirementIds),
                                unlocked: isUnlocked,
                                unlockable: !isUnlocked
                                    && managementAvailable
                                    && (state.hp ?? 0) > 0
                                    && missingRequirementIds.length === 0
                                    && (state.skillPoints ?? 0) >= node.cost
                            });
                        }))
                    });
                const auraActive = this.heroPassiveAuraActive();
                return Object.freeze({
                    schemaVersion: 6,
                    units: Object.freeze([Object.freeze({
                            id: state.definitionId,
                            definitionId: state.definitionId,
                            label: definition.label,
                            coord: Object.freeze({ ...state.currentCoord }),
                            movement: Object.freeze({
                                targetCoord: state.targetCoord === null ? null : Object.freeze({ ...state.targetCoord }),
                                nextCoord: state.nextCoord === null ? null : Object.freeze({ ...state.nextCoord }),
                                edgeProgress: state.edgeProgress
                            }),
                            durability: Object.freeze({
                                hp: state.hp ?? 0,
                                maxHp: definition.durability.maxHp,
                                shield: definition.durability.shield === null
                                    ? null
                                    : Object.freeze({
                                        current: state.shieldCurrent ?? 0,
                                        capacity: definition.durability.shield.capacity
                                    }),
                                defeated: (state.hp ?? 0) <= 0
                            }),
                            mana: Object.freeze({
                                current: state.mana ?? 0,
                                max: definition.mana.max,
                                regenerationPerUnit: definition.mana.regenerationPerUnit
                            }),
                            activeAbility: Object.freeze({
                                ...definition.activeAbility,
                                cooldownRemaining: state.abilityCooldownRemaining ?? 0,
                                ready: (state.hp ?? 0) > 0
                                    && this.outcome === "playing"
                                    && (state.mana ?? 0) >= definition.activeAbility.manaCost
                                    && (state.abilityCooldownRemaining ?? 0) <= 0
                            }),
                            skills,
                            passiveAura: Object.freeze({
                                id: definition.passiveAura.id,
                                label: definition.passiveAura.label,
                                radius: definition.passiveAura.radius,
                                active: auraActive,
                                affectedTowerIds: auraActive ? this.heroPassiveAuraAffectedTowerIds() : Object.freeze([])
                            })
                        })])
                });
            })()
            : (this.activeHeroesMechanics?.schemaVersion === 5 || this.activeHeroesMechanics?.schemaVersion === 6)
                && this.heroStateV2
                && this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].skillTree !== null
                ? (() => {
                    const state = this.heroStateV2;
                    const definition = this.activeHeroesMechanics.schemaVersion === 5
                        || this.activeHeroesMechanics.schemaVersion === 6
                        ? this.activeHeroesMechanics.definitions[state.definitionId]
                        : undefined;
                    const tree = definition.skillTree;
                    const unlocked = state.unlockedSkillIds ?? new Set();
                    const managementAvailable = this.heroSkillManagementAvailable();
                    return Object.freeze({
                        schemaVersion: 5,
                        units: Object.freeze([Object.freeze({
                                id: state.definitionId,
                                definitionId: state.definitionId,
                                label: definition.label,
                                coord: Object.freeze({ ...state.currentCoord }),
                                movement: Object.freeze({
                                    targetCoord: state.targetCoord === null ? null : Object.freeze({ ...state.targetCoord }),
                                    nextCoord: state.nextCoord === null ? null : Object.freeze({ ...state.nextCoord }),
                                    edgeProgress: state.edgeProgress
                                }),
                                durability: Object.freeze({
                                    hp: state.hp ?? 0,
                                    maxHp: definition.durability.maxHp,
                                    shield: definition.durability.shield === null
                                        ? null
                                        : Object.freeze({
                                            current: state.shieldCurrent ?? 0,
                                            capacity: definition.durability.shield.capacity
                                        }),
                                    defeated: (state.hp ?? 0) <= 0
                                }),
                                mana: Object.freeze({
                                    current: state.mana ?? 0,
                                    max: definition.mana.max,
                                    regenerationPerUnit: definition.mana.regenerationPerUnit
                                }),
                                activeAbility: Object.freeze({
                                    ...definition.activeAbility,
                                    cooldownRemaining: state.abilityCooldownRemaining ?? 0,
                                    ready: (state.hp ?? 0) > 0
                                        && this.outcome === "playing"
                                        && (state.mana ?? 0) >= definition.activeAbility.manaCost
                                        && (state.abilityCooldownRemaining ?? 0) <= 0
                                }),
                                skills: Object.freeze({
                                    availablePoints: state.skillPoints ?? 0,
                                    startingPoints: tree.points.starting,
                                    pointsPerInterwave: tree.points.perInterwave,
                                    maximumEarnablePoints: tree.points.starting
                                        + tree.points.perInterwave * Math.max(0, this.mission.waves.length - 1),
                                    managementAvailable,
                                    nodes: Object.freeze(Object.entries(tree.nodes).map(([skillId, node]) => {
                                        const missingRequirementIds = node.requires.filter((requiredId) => !unlocked.has(requiredId));
                                        const isUnlocked = unlocked.has(skillId);
                                        return Object.freeze({
                                            id: skillId,
                                            label: node.label,
                                            description: node.description,
                                            cost: node.cost,
                                            requiresSkillIds: Object.freeze([...node.requires]),
                                            missingRequirementIds: Object.freeze(missingRequirementIds),
                                            unlocked: isUnlocked,
                                            unlockable: !isUnlocked
                                                && managementAvailable
                                                && (state.hp ?? 0) > 0
                                                && missingRequirementIds.length === 0
                                                && (state.skillPoints ?? 0) >= node.cost
                                        });
                                    }))
                                })
                            })])
                    });
                })()
                : (this.activeHeroesMechanics?.schemaVersion === 4
                    || ((this.activeHeroesMechanics?.schemaVersion === 5 || this.activeHeroesMechanics?.schemaVersion === 6)
                        && this.activeHeroesMechanics.definitions[this.heroStateV2?.definitionId ?? ""]?.skillTree === null))
                    && this.heroStateV2
                    ? Object.freeze({
                        schemaVersion: 4,
                        units: Object.freeze([Object.freeze({
                                id: this.heroStateV2.definitionId,
                                definitionId: this.heroStateV2.definitionId,
                                label: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].label,
                                coord: Object.freeze({ ...this.heroStateV2.currentCoord }),
                                movement: Object.freeze({
                                    targetCoord: this.heroStateV2.targetCoord === null
                                        ? null
                                        : Object.freeze({ ...this.heroStateV2.targetCoord }),
                                    nextCoord: this.heroStateV2.nextCoord === null
                                        ? null
                                        : Object.freeze({ ...this.heroStateV2.nextCoord }),
                                    edgeProgress: this.heroStateV2.edgeProgress
                                }),
                                durability: Object.freeze({
                                    hp: this.heroStateV2.hp ?? 0,
                                    maxHp: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].durability.maxHp,
                                    shield: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].durability.shield === null
                                        ? null
                                        : Object.freeze({
                                            current: this.heroStateV2.shieldCurrent ?? 0,
                                            capacity: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].durability.shield.capacity
                                        }),
                                    defeated: (this.heroStateV2.hp ?? 0) <= 0
                                }),
                                mana: Object.freeze({
                                    current: this.heroStateV2.mana ?? 0,
                                    max: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].mana.max,
                                    regenerationPerUnit: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].mana.regenerationPerUnit
                                }),
                                activeAbility: Object.freeze({
                                    ...this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].activeAbility,
                                    cooldownRemaining: this.heroStateV2.abilityCooldownRemaining ?? 0,
                                    ready: (this.heroStateV2.hp ?? 0) > 0
                                        && this.outcome === "playing"
                                        && (this.heroStateV2.mana ?? 0) >= this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].activeAbility.manaCost
                                        && (this.heroStateV2.abilityCooldownRemaining ?? 0) <= 0
                                })
                            })])
                    })
                    : this.activeHeroesMechanics?.schemaVersion === 3 && this.heroStateV2
                        ? Object.freeze({
                            schemaVersion: 3,
                            units: Object.freeze([Object.freeze({
                                    id: this.heroStateV2.definitionId,
                                    definitionId: this.heroStateV2.definitionId,
                                    label: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].label,
                                    coord: Object.freeze({ ...this.heroStateV2.currentCoord }),
                                    movement: Object.freeze({
                                        targetCoord: this.heroStateV2.targetCoord === null
                                            ? null
                                            : Object.freeze({ ...this.heroStateV2.targetCoord }),
                                        nextCoord: this.heroStateV2.nextCoord === null
                                            ? null
                                            : Object.freeze({ ...this.heroStateV2.nextCoord }),
                                        edgeProgress: this.heroStateV2.edgeProgress
                                    }),
                                    durability: Object.freeze({
                                        hp: this.heroStateV2.hp ?? 0,
                                        maxHp: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].durability.maxHp,
                                        shield: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].durability.shield === null
                                            ? null
                                            : Object.freeze({
                                                current: this.heroStateV2.shieldCurrent ?? 0,
                                                capacity: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].durability.shield.capacity
                                            }),
                                        defeated: (this.heroStateV2.hp ?? 0) <= 0
                                    })
                                })])
                        })
                        : this.activeHeroesMechanics?.schemaVersion === 2 && this.heroStateV2
                            ? Object.freeze({
                                schemaVersion: 2,
                                units: Object.freeze([Object.freeze({
                                        id: this.heroStateV2.definitionId,
                                        definitionId: this.heroStateV2.definitionId,
                                        label: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId].label,
                                        coord: Object.freeze({ ...this.heroStateV2.currentCoord }),
                                        movement: Object.freeze({
                                            targetCoord: this.heroStateV2.targetCoord === null
                                                ? null
                                                : Object.freeze({ ...this.heroStateV2.targetCoord }),
                                            nextCoord: this.heroStateV2.nextCoord === null
                                                ? null
                                                : Object.freeze({ ...this.heroStateV2.nextCoord }),
                                            edgeProgress: this.heroStateV2.edgeProgress
                                        })
                                    })])
                            })
                            : this.heroesSnapshotV1;
        return {
            mapId: this.map.id,
            grid: { ...this.map.grid },
            missionId: this.mission.id,
            missionLabel: this.mission.label,
            difficultyId: this.difficulty.id,
            difficultyLabel: this.difficulty.label,
            coreHp: this.coreHp,
            maxCoreHp: this.maxCoreHp,
            coins: this.coins,
            resources: this.cloneResources(this.resources),
            waveIndex: this.waveIndex,
            totalWaves: this.mission.waves.length,
            startedWaveCount: this.startedWaveCount,
            clearedWaveCount: this.clearedWaveCount,
            killCount: this.killCount,
            leakCount: this.leakCount,
            killCountByEnemyType: { ...this.killCountByEnemyType },
            objectiveProgress: this.buildObjectiveProgress(),
            stars: this.buildStarSnapshot(),
            missionElapsed: this.missionElapsed,
            waveState: this.waveState,
            prepRemaining: this.prepRemaining,
            nextWaveRemaining: this.getNextWaveRemaining(),
            nextWaveDelayUnits: this.mission.prepTimeUnits,
            enemies: this.enemies.map((enemy) => ({
                ...enemy,
                ...(enemy.navigation === undefined ? {} : {
                    navigation: {
                        ...enemy.navigation,
                        currentCoord: { ...enemy.navigation.currentCoord },
                        ...(enemy.navigation.nextCoord === undefined ? {} : { nextCoord: { ...enemy.navigation.nextCoord } })
                    }
                }),
                routeId: enemy.routeId,
                phaseSpawnsTriggered: enemy.phaseSpawnsTriggered ? [...enemy.phaseSpawnsTriggered] : undefined,
                statuses: enemy.statuses
                    ? {
                        ...(enemy.statuses.slow ? { slow: { ...enemy.statuses.slow } } : {}),
                        ...(enemy.statuses.stun ? { stun: { ...enemy.statuses.stun } } : {}),
                        ...(enemy.statuses.poison ? { poison: { ...enemy.statuses.poison } } : {})
                    }
                    : {}
            })),
            towers: this.towers.map((tower) => ({
                ...tower,
                coord: { ...tower.coord },
                footprint: tower.footprint.map((coord) => ({ ...coord }))
            })),
            tiles: copyStaticState || this.runtimeTerrainOverrides.size > 0
                ? [...this.map.tiles.values()].map((tile) => ({ ...tile }))
                : this.staticTilesSnapshot,
            abilities: this.buildAbilitySnapshot(),
            temporaryWaterTiles: this.temporaryWaterTiles.map((tile) => ({ ...tile })),
            terrainOverrides: [...this.runtimeTerrainOverrides.values()].map((entry) => ({ ...entry })),
            sunlightTiles: copyStaticState
                ? this.sunlightTilesSnapshot.map((tile) => ({ ...tile }))
                : this.sunlightTilesSnapshot,
            pathCenterline: copyStaticState
                ? this.map.pathCenterline.map((coord) => ({ ...coord }))
                : this.staticPathCenterlineSnapshot,
            pathRoutes: copyStaticState
                ? this.map.pathRoutes.map((route) => ({
                    id: route.id,
                    pathCenterline: route.pathCenterline.map((coord) => ({ ...coord }))
                }))
                : this.staticPathRoutesSnapshot,
            spawnCoord: copyStaticState ? { ...this.map.spawnCoord } : this.staticSpawnCoordSnapshot,
            coreCoord: copyStaticState ? { ...this.map.coreCoord } : this.staticCoreCoordSnapshot,
            outcome: this.outcome,
            ...(combat === undefined ? {} : { combat }),
            ...(reactions === undefined ? {} : { reactions }),
            ...(navigation === undefined ? {} : { navigation }),
            ...(elevation === undefined ? {} : { elevation }),
            ...(terraforming === undefined ? {} : { terraforming }),
            ...(roguelite === undefined ? {} : { roguelite }),
            ...(heroes === undefined ? {} : { heroes }),
            scriptState: {
                values: this.cloneScriptValues(),
                diagnostics: this.scriptDiagnostics.map((diagnostic) => ({ ...diagnostic }))
            },
            lastEvents: [...this.lastEvents]
        };
    }
    initializeScripts() {
        this.scriptValues = {};
        this.scriptDiagnostics = [];
        this.scriptHandlerLastRun = {};
        this.scriptEventCursor = 0;
        this.scriptActionsRemaining = 0;
        this.scriptSignalDepth = 0;
        for (const scriptId of Object.keys(this.content.scripts ?? {}).sort())
            this.scriptValues[scriptId] = {};
    }
    beginScriptTransaction() {
        this.scriptActionsRemaining = TOWER_SCRIPT_LIMITS.actionsPerTransaction;
        this.scriptTerrainChangesRemaining = TOWER_SCRIPT_LIMITS.terrainChangesPerTransaction;
        this.scriptSignalDepth = 0;
    }
    finishScriptedAction() {
        this.beginScriptTransaction();
        this.processScriptEvents();
        this.stabilizeDynamicEnemyNavigation();
    }
    processScriptEvents() {
        let processed = 0;
        while (this.scriptEventCursor < this.lastEvents.length && processed < TOWER_SCRIPT_LIMITS.eventsPerTransaction) {
            const event = this.lastEvents[this.scriptEventCursor++];
            processed += 1;
            if (!event || event.type === "scriptDiagnostic" || event.type === "scriptSignal")
                continue;
            if (SCRIPT_GAME_EVENT_NAMES.has(event.type)) {
                this.runScriptEvent(event.type, event);
            }
        }
        if (this.scriptEventCursor < this.lastEvents.length) {
            this.recordScriptDiagnostic({
                scriptId: "runtime",
                event: "tick",
                code: "budget_exceeded",
                message: `TowerScript event processing exceeded ${TOWER_SCRIPT_LIMITS.eventsPerTransaction} events in one transaction.`
            });
            this.scriptEventCursor = this.lastEvents.length;
        }
    }
    runScriptEvent(eventName, event) {
        for (const script of Object.values(this.content.scripts ?? {}).sort((a, b) => a.id.localeCompare(b.id))) {
            if (!script || script.enabled === false)
                continue;
            const handlers = script.handlers?.[eventName] ?? [];
            if (!Array.isArray(handlers) || handlers.length === 0)
                continue;
            const seenContexts = new Set();
            for (const binding of script.bindings ?? []) {
                for (const self of this.scriptContexts(binding, eventName, event)) {
                    const contextIdentity = `${self.scope}:${self.id}`;
                    if (seenContexts.has(contextIdentity))
                        continue;
                    seenContexts.add(contextIdentity);
                    const stateKey = contextIdentity;
                    const context = {
                        script,
                        binding,
                        self,
                        state: this.scriptStateFor(script, stateKey),
                        stateKey,
                        event,
                        eventName
                    };
                    handlers.forEach((handler, index) => this.runScriptHandler(context, handler, index));
                }
            }
        }
    }
    runScriptHandler(context, handler, handlerIndex) {
        const handlerId = handler.id ?? String(handlerIndex);
        try {
            if (context.eventName === "tick" && typeof handler.every === "number") {
                const timerKey = `${context.script.id}:${context.stateKey}:${handlerId}`;
                const lastRun = this.scriptHandlerLastRun[timerKey];
                if (lastRun !== undefined && this.missionElapsed - lastRun + 0.000001 < handler.every)
                    return;
                this.scriptHandlerLastRun[timerKey] = this.missionElapsed;
            }
            const expressionBudget = { remaining: TOWER_SCRIPT_LIMITS.expressionOperationsPerHandler };
            const root = this.scriptExpressionContext(context);
            if (handler.when !== undefined && !evaluateTowerScriptExpression(handler.when, root, expressionBudget))
                return;
            for (const action of handler.actions ?? []) {
                if (this.scriptActionsRemaining <= 0) {
                    this.scriptActionsRemaining = 0;
                    throw new Error("TowerScript action budget exceeded.");
                }
                this.scriptActionsRemaining -= 1;
                this.applyScriptAction(action, context, root, expressionBudget);
            }
        }
        catch (error) {
            const invalidAction = error instanceof TowerScriptInvalidActionError;
            const terraformingError = error instanceof TowerScriptTerraformingError ? error : undefined;
            const message = error instanceof Error ? error.message : String(error);
            this.recordScriptDiagnostic({
                scriptId: context.script.id,
                handlerId,
                event: context.eventName,
                code: terraformingError?.code ?? (invalidAction
                    ? "invalid_action"
                    : /budget exceeded/i.test(message) ? "budget_exceeded" : /expression|\$get|\$op|context path/i.test(message) ? "invalid_expression" : "runtime_error"),
                message,
                ...(terraformingError ? { reasonKey: terraformingError.reasonKey } : {})
            });
        }
    }
    scriptContexts(binding, eventName, event) {
        const accepts = (id) => !binding.ids || binding.ids.includes(id);
        if (binding.scope === "global")
            return [{ scope: "global", id: "global", value: { id: "global" } }];
        if (binding.scope === "mission") {
            return accepts(this.mission.id)
                ? [{
                        scope: "mission",
                        id: this.mission.id,
                        value: {
                            id: this.mission.id,
                            label: this.mission.label,
                            mapId: this.mission.mapId,
                            waveSetId: this.mission.waveSetId,
                            startingResources: { ...this.mission.startingResources },
                            waveCount: this.mission.waves.length
                        }
                    }]
                : [];
        }
        if (binding.scope === "map") {
            return accepts(this.mission.mapId)
                ? [{
                        scope: "map",
                        id: this.mission.mapId,
                        value: {
                            id: this.mission.mapId,
                            width: this.map.width,
                            height: this.map.height,
                            grid: { ...this.map.grid },
                            spawnCoord: { ...this.map.spawnCoord },
                            coreCoord: { ...this.map.coreCoord },
                            pathLength: this.map.pathCenterline.length,
                            routeIds: this.map.pathRoutes.map((route) => route.id)
                        }
                    }]
                : [];
        }
        if (binding.scope === "wave") {
            return accepts(this.mission.waveSetId)
                ? [{
                        scope: "wave",
                        id: this.mission.waveSetId,
                        value: {
                            id: this.mission.waveSetId,
                            currentIndex: this.waveIndex,
                            startedCount: this.startedWaveCount,
                            clearedCount: this.clearedWaveCount,
                            state: this.waveState,
                            totalCount: this.mission.waves.length
                        }
                    }]
                : [];
        }
        if (binding.scope === "ability") {
            const abilityId = typeof event.abilityId === "string" ? event.abilityId : null;
            if (!abilityId || !accepts(abilityId))
                return [];
            return [{ scope: "ability", id: abilityId, typeId: abilityId, value: { id: abilityId, ...(this.content.abilities[abilityId] ?? {}) } }];
        }
        if (binding.scope === "terrain") {
            const coordValue = event.coord ?? event.center ?? event.to;
            if (!coordValue || typeof coordValue !== "object")
                return [];
            const rawCoord = coordValue;
            if (!Number.isInteger(rawCoord.q) || !Number.isInteger(rawCoord.r))
                return [];
            const coord = { q: Number(rawCoord.q), r: Number(rawCoord.r) };
            const terrainId = typeof event.toTerrain === "string"
                ? event.toTerrain
                : typeof event.terrain === "string" ? event.terrain : this.map.getTile(coord)?.terrain;
            if (!terrainId || !accepts(terrainId))
                return [];
            return [{
                    scope: "terrain",
                    id: `${coord.q},${coord.r}`,
                    typeId: terrainId,
                    value: { ...this.terrainMetadata(terrainId), coord }
                }];
        }
        if (binding.scope === "tower") {
            const candidates = [];
            if (eventName === "tick") {
                for (const tower of this.towers)
                    if (accepts(tower.typeId))
                        candidates.push({ scope: "tower", id: tower.id, typeId: tower.typeId, value: tower });
                return candidates;
            }
            const towerIds = [event.towerId, ...(Array.isArray(event.towerIds) ? event.towerIds : [])].filter((value) => typeof value === "string");
            for (const towerId of towerIds) {
                const tower = this.towers.find((item) => item.id === towerId);
                const typeId = tower?.typeId ?? (typeof event.towerTypeId === "string" ? event.towerTypeId : undefined);
                if (typeId && accepts(typeId))
                    candidates.push({ scope: "tower", id: towerId, typeId, value: tower ? tower : { id: towerId, typeId } });
            }
            return candidates;
        }
        if (binding.scope === "enemy") {
            const candidates = [];
            if (eventName === "tick") {
                for (const enemy of this.enemies)
                    if (accepts(enemy.typeId))
                        candidates.push({ scope: "enemy", id: enemy.id, typeId: enemy.typeId, value: enemy });
                return candidates;
            }
            const enemyIds = [
                event.enemyId,
                event.targetEnemyId,
                ...(Array.isArray(event.enemyIds) ? event.enemyIds : [])
            ].filter((value) => typeof value === "string");
            for (const enemyId of enemyIds) {
                const enemy = this.enemies.find((item) => item.id === enemyId);
                const typeId = enemy?.typeId ?? (typeof event.enemyTypeId === "string" ? event.enemyTypeId : undefined);
                if (typeId && accepts(typeId))
                    candidates.push({ scope: "enemy", id: enemyId, typeId, value: enemy ? enemy : { id: enemyId, typeId } });
            }
            return candidates;
        }
        return [];
    }
    scriptStateFor(script, stateKey) {
        const scriptStates = this.scriptValues[script.id] ??= {};
        return scriptStates[stateKey] ??= this.cloneScriptJsonObject(script.initialState ?? {});
    }
    scriptExpressionContext(context) {
        return {
            event: context.event,
            self: context.self.value,
            state: context.state,
            game: {
                missionId: this.mission.id,
                mapId: this.mission.mapId,
                difficultyId: this.difficulty.id,
                elapsed: this.missionElapsed,
                waveIndex: this.waveIndex,
                startedWaveCount: this.startedWaveCount,
                clearedWaveCount: this.clearedWaveCount,
                killCount: this.killCount,
                leakCount: this.leakCount,
                coreHp: this.coreHp,
                maxCoreHp: this.maxCoreHp,
                resources: this.resources,
                enemyCount: this.enemies.length,
                towerCount: this.towers.length,
                outcome: this.outcome
            }
        };
    }
    applyScriptAction(action, context, root, budget) {
        const evaluate = (expression) => evaluateTowerScriptExpression(expression, root, budget);
        const numberValue = (expression, fallback = 0) => {
            const value = evaluate(expression);
            return typeof value === "number" && Number.isFinite(value) ? value : fallback;
        };
        if (action.action === "grantResource") {
            if (!this.currencyIds.includes(action.resourceId))
                throw new Error(`Unknown runtime currency "${action.resourceId}".`);
            const amount = numberValue(action.amount);
            this.resources[action.resourceId] = Math.max(0, Math.min(1e12, (this.resources[action.resourceId] ?? 0) + amount));
            return;
        }
        if (action.action === "damageCore") {
            this.applyResolvedCoreDamage(Math.max(0, numberValue(action.amount)), { kind: "tower_script", scriptId: context.script.id });
            if (this.coreHp <= 0 && this.outcome === "playing") {
                this.outcome = "defeat";
                this.lastEvents.push({ type: "defeat" });
            }
            return;
        }
        if (action.action === "healCore") {
            this.coreHp = Math.min(this.maxCoreHp, this.coreHp + Math.max(0, numberValue(action.amount)));
            return;
        }
        if (action.action === "damageEnemy" || action.action === "healEnemy") {
            const amount = Math.max(0, numberValue(action.amount));
            for (const enemy of this.resolveScriptEnemies(action.target, context)) {
                if (action.action === "damageEnemy") {
                    this.applyResolvedEnemyDamage(enemy, amount, { kind: "tower_script", scriptId: context.script.id });
                }
                else {
                    enemy.hp = Math.min(enemy.maxHp, enemy.hp + amount);
                }
            }
            return;
        }
        if (action.action === "restoreEnemyShield") {
            const amount = Math.max(0, numberValue(action.amount));
            let shieldTargetCount = 0;
            for (const enemy of this.resolveScriptEnemies(action.target, context)) {
                const shield = this.enemyShields[enemy.id];
                if (!shield)
                    continue;
                shieldTargetCount += 1;
                const previous = shield.current;
                shield.current = Math.min(shield.capacity, previous + amount);
                const restored = shield.current - previous;
                if (restored <= 0)
                    continue;
                this.lastEvents.push({
                    type: "enemyShieldChanged",
                    enemyId: enemy.id,
                    enemyTypeId: enemy.typeId,
                    previous,
                    current: shield.current,
                    capacity: shield.capacity,
                    cause: "script",
                    amount: restored
                });
            }
            if (shieldTargetCount === 0)
                throw new TowerScriptInvalidActionError();
            return;
        }
        if (action.action === "restoreTowerShield") {
            const amount = Math.max(0, numberValue(action.amount));
            let shieldTargetCount = 0;
            for (const tower of this.resolveScriptTowers(action.target, context)) {
                const shield = this.towerShields[tower.id];
                if (!shield)
                    continue;
                shieldTargetCount += 1;
                const previous = shield.current;
                shield.current = Math.min(shield.capacity, previous + amount);
                const restored = shield.current - previous;
                if (restored <= 0)
                    continue;
                this.lastEvents.push({
                    type: "towerShieldChanged",
                    towerId: tower.id,
                    towerTypeId: tower.typeId,
                    previous,
                    current: shield.current,
                    capacity: shield.capacity,
                    cause: "script",
                    amount: restored
                });
            }
            if (shieldTargetCount === 0)
                throw new TowerScriptInvalidActionError();
            return;
        }
        if (action.action === "applyEnemyMark") {
            const definition = this.activeCombatMechanics?.marks.definitions[action.markId];
            const stacks = action.stacks === undefined ? 1 : numberValue(action.stacks);
            if (!definition
                || !Number.isSafeInteger(stacks)
                || stacks <= 0
                || stacks > definition.maxStacks) {
                throw new TowerScriptInvalidActionError("TowerScript applyEnemyMark action has an invalid mark or stacks value.");
            }
            for (const enemy of this.resolveScriptEnemies(action.target, context)) {
                this.applyEnemyMark(enemy, action.markId, stacks, "script");
            }
            return;
        }
        if (action.action === "clearEnemyMark") {
            if (!this.activeCombatMechanics?.marks.definitions[action.markId]) {
                throw new TowerScriptInvalidActionError("TowerScript clearEnemyMark action references an inactive mark.");
            }
            for (const enemy of this.resolveScriptEnemies(action.target, context)) {
                this.clearEnemyMark(enemy, action.markId, "script");
            }
            return;
        }
        if (action.action === "applyEnemyExposure") {
            const definition = this.activeReactionsMechanics?.exposures.definitions[action.exposureId];
            const stacks = action.stacks === undefined ? 1 : numberValue(action.stacks);
            if (!definition || !Number.isSafeInteger(stacks) || stacks <= 0 || stacks > definition.maxStacks) {
                throw new TowerScriptInvalidActionError("TowerScript applyEnemyExposure action has an invalid exposure or stacks value.");
            }
            let liveExposureCount = Object.values(this.enemyExposures)
                .reduce((total, states) => total + Object.keys(states).length, 0);
            let dropped = 0;
            let firstDropped;
            for (const enemy of this.resolveScriptEnemies(action.target, context)) {
                const createsLiveExposure = this.enemyExposures[enemy.id]?.[action.exposureId] === undefined;
                if (createsLiveExposure && liveExposureCount >= REACTION_LIMITS.runtimeExposureApplications) {
                    dropped += 1;
                    firstDropped ??= enemy;
                    continue;
                }
                this.applyEnemyExposure(enemy, action.exposureId, stacks, definition.duration, definition.maxStacks, "script");
                if (createsLiveExposure)
                    liveExposureCount += 1;
            }
            if (dropped > 0 && firstDropped) {
                this.lastEvents.push({
                    type: "reactionBudgetExceeded",
                    rootEnemyId: firstDropped.id,
                    rootEnemyTypeId: firstDropped.typeId,
                    budget: "live_exposures",
                    limit: REACTION_LIMITS.runtimeExposureApplications,
                    dropped
                });
            }
            return;
        }
        if (action.action === "clearEnemyExposure") {
            if (!this.activeReactionsMechanics?.exposures.definitions[action.exposureId]) {
                throw new TowerScriptInvalidActionError("TowerScript clearEnemyExposure action references an inactive exposure.");
            }
            for (const enemy of this.resolveScriptEnemies(action.target, context)) {
                const states = this.enemyExposures[enemy.id];
                const previous = states?.[action.exposureId];
                if (!states || !previous)
                    continue;
                delete states[action.exposureId];
                if (Object.keys(states).length === 0)
                    delete this.enemyExposures[enemy.id];
                this.lastEvents.push({
                    type: "enemyExposureChanged", enemyId: enemy.id, enemyTypeId: enemy.typeId,
                    exposureId: action.exposureId, previousStacks: previous.stacks, currentStacks: 0,
                    previousRemaining: previous.remaining, remaining: 0, cause: "script"
                });
            }
            return;
        }
        if (action.action === "applyStatus") {
            for (const enemy of this.resolveScriptEnemies(action.target, context))
                this.applyStatusEffect(enemy, action.status);
            return;
        }
        if (action.action === "setTowerCooldown") {
            const value = Math.max(0, numberValue(action.value));
            for (const tower of this.resolveScriptTowers(action.target, context))
                tower.cooldown = value;
            return;
        }
        if (action.action === "addTowerStacks") {
            const amount = Math.trunc(numberValue(action.amount));
            for (const tower of this.resolveScriptTowers(action.target, context))
                tower.stacks = Math.max(0, Math.min(999, tower.stacks + amount));
            return;
        }
        if (action.action === "spawnEnemy") {
            const count = Math.max(0, Math.min(TOWER_SCRIPT_LIMITS.spawnedEnemiesPerAction, Math.trunc(action.count === undefined ? 1 : numberValue(action.count, 1))));
            const progress = Math.max(0, numberValue(action.pathProgress ?? 0));
            for (let index = 0; index < count; index += 1) {
                const enemy = this.createEnemyState(action.enemyTypeId, progress, 0, action.routeId);
                if (!enemy)
                    throw new Error(`Unknown enemy type "${action.enemyTypeId}".`);
                this.enemies.push(enemy);
            }
            return;
        }
        if (action.action === "setTileTerrain" || action.action === "restoreTileTerrain") {
            if (this.activeTerraformingMechanics) {
                this.applyActiveLegacyTerrainAction(action, context, evaluate);
                return;
            }
            if (this.scriptTerrainChangesRemaining <= 0) {
                this.scriptTerrainChangesRemaining = 0;
                throw new Error("TowerScript terrain change budget exceeded.");
            }
            this.scriptTerrainChangesRemaining -= 1;
            const coord = this.resolveScriptTileTarget(action.target, context, evaluate);
            if (!coord)
                throw new Error("TowerScript tile target did not resolve to an in-bounds integer coordinate.");
            if (action.action === "restoreTileTerrain") {
                this.restoreTerrainOverride(coord);
                return;
            }
            const duration = action.duration === undefined ? undefined : numberValue(action.duration);
            if (duration !== undefined && duration <= 0)
                throw new Error("setTileTerrain duration must be greater than zero.");
            const result = this.applyTerrainOverride(coord, action.terrainId, duration, "script");
            if (!result.ok)
                throw new Error(result.reason ?? "Unable to change tile terrain.");
            return;
        }
        if (action.action === "terraformTiles") {
            this.applyTerraformTilesAction(action, context, evaluate);
            return;
        }
        if (action.action === "setState") {
            const hadPrevious = Object.prototype.hasOwnProperty.call(context.state, action.key);
            const previous = context.state[action.key];
            context.state[action.key] = evaluate(action.value);
            try {
                this.assertScriptStateSize(context);
            }
            catch (error) {
                if (hadPrevious)
                    context.state[action.key] = previous;
                else
                    delete context.state[action.key];
                throw error;
            }
            return;
        }
        if (action.action === "incrementState") {
            const current = typeof context.state[action.key] === "number" ? context.state[action.key] : 0;
            const next = current + (action.amount === undefined ? 1 : numberValue(action.amount, 1));
            const hadPrevious = Object.prototype.hasOwnProperty.call(context.state, action.key);
            const previous = context.state[action.key];
            context.state[action.key] = Number.isFinite(next) ? Math.max(-1e12, Math.min(1e12, next)) : 0;
            try {
                this.assertScriptStateSize(context);
            }
            catch (error) {
                if (hadPrevious)
                    context.state[action.key] = previous;
                else
                    delete context.state[action.key];
                throw error;
            }
            return;
        }
        if (action.action === "emitSignal") {
            if (this.scriptSignalDepth >= TOWER_SCRIPT_LIMITS.signalRecursionDepth)
                throw new Error("TowerScript signal recursion budget exceeded.");
            const payload = action.payload === undefined ? null : evaluate(action.payload);
            this.lastEvents.push({ type: "scriptSignal", scriptId: context.script.id, signal: action.signal, payload });
            this.scriptSignalDepth += 1;
            this.runScriptEvent("signal", { type: "signal", signal: action.signal, payload, sourceScriptId: context.script.id });
            this.scriptSignalDepth -= 1;
        }
    }
    applyActiveLegacyTerrainAction(action, context, evaluate) {
        if (this.scriptTerrainChangesRemaining <= 0) {
            this.scriptTerrainChangesRemaining = 0;
            throw new TowerScriptTerraformingError("budget_exceeded", "terraform.operation_budget_exceeded", "TowerScript terraforming operation budget exceeded.");
        }
        this.scriptTerrainChangesRemaining -= 1;
        const timed = action.action === "setTileTerrain"
            && Object.prototype.hasOwnProperty.call(action, "duration");
        if (timed && this.pendingTerraformExpiryGroups.length >= TERRAFORMING_LIMITS.pendingExpiryGroups) {
            throw new TowerScriptTerraformingError("budget_exceeded", "terraform.expiry_group_budget_exceeded", `Terraform expiry groups exceed the ${TERRAFORMING_LIMITS.pendingExpiryGroups} group limit.`);
        }
        let duration;
        if (timed) {
            const resolvedDuration = evaluate(action.duration);
            if (typeof resolvedDuration !== "number" || !Number.isFinite(resolvedDuration)
                || resolvedDuration <= 0 || resolvedDuration > TERRAFORMING_LIMITS.duration) {
                throw new TowerScriptTerraformingError("invalid_action", "terraform.duration_out_of_range", `Terraform duration must be finite and inside (0, ${TERRAFORMING_LIMITS.duration}].`);
            }
            duration = resolvedDuration;
        }
        const coord = this.resolveTerraformTarget(action.target, context, evaluate);
        if (!coord) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Terraform tile target did not resolve to safe integer coordinates.");
        }
        if (!this.map.isInside(coord)) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.target_outside_map", `Terraform target ${coord.q},${coord.r} is outside the map.`);
        }
        if (action.action === "setTileTerrain" && !this.content.terrainTypes[action.terrainId]) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", `Terraform destination terrain "${action.terrainId}" is unknown.`);
        }
        const key = coordKey(coord);
        const existing = this.runtimeTerrainOverrides.get(key);
        if (this.isNativeTerraformTargetOwned("terrain", coord) || typeof existing?.expiresIn === "number") {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.target_owned", `Terraform terrain target ${key} is owned by a timed override.`);
        }
        const operation = action.action === "setTileTerrain"
            ? { kind: "set_terrain", coord, directTerrainId: action.terrainId, order: 0 }
            : { kind: "restore_terrain", coord, order: 0 };
        this.applyResolvedPersistentOperations([operation], duration);
    }
    resolveScriptTileTarget(target, context, evaluate) {
        if (target === "eventTile") {
            const value = context.event.coord ?? context.event.center ?? context.event.to;
            if (!value || typeof value !== "object")
                return undefined;
            const coord = value;
            if (!Number.isInteger(coord.q) || !Number.isInteger(coord.r))
                return undefined;
            const resolved = { q: Number(coord.q), r: Number(coord.r) };
            return this.map.isInside(resolved) ? resolved : undefined;
        }
        const q = evaluate(target.q);
        const r = evaluate(target.r);
        if (!Number.isInteger(q) || !Number.isInteger(r))
            return undefined;
        const coord = { q: Number(q), r: Number(r) };
        return this.map.isInside(coord) ? coord : undefined;
    }
    applyTerraformTilesAction(action, context, evaluate) {
        // Inactive projects retain the exact legacy path: the generic action slot was consumed by
        // the interpreter, but no terraforming field, expression, budget, or diagnostic is touched.
        if (!this.activeTerraformingMechanics)
            return;
        let actionPrototype;
        let actionDescriptors;
        try {
            actionPrototype = Object.getPrototypeOf(action);
            actionDescriptors = Object.getOwnPropertyDescriptors(action);
        }
        catch {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "terraformTiles action could not be inspected safely.");
        }
        const actionKeys = Reflect.ownKeys(actionDescriptors);
        const allowedActionKeys = new Set(["action", "operations", "duration"]);
        const actionDescriptor = actionDescriptors.action;
        const operationsDescriptor = actionDescriptors.operations;
        if (actionPrototype !== Object.prototype
            || actionKeys.some((key) => typeof key !== "string" || !allowedActionKeys.has(key))
            || !actionDescriptor
            || !operationsDescriptor
            || actionKeys.some((key) => {
                const descriptor = actionDescriptors[key];
                return !descriptor?.enumerable || !("value" in descriptor);
            })
            || actionDescriptor.value !== "terraformTiles") {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "terraformTiles must be an exact plain data action.");
        }
        const operationValues = this.inspectTerraformOperationArray(operationsDescriptor.value);
        const operationCount = operationValues.length;
        if (operationCount < 1) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "terraformTiles requires at least one operation.");
        }
        if (operationCount > this.scriptTerrainChangesRemaining) {
            // C1's public RED contract exhausts the remaining batch budget on a failed reservation.
            this.scriptTerrainChangesRemaining = 0;
            throw new TowerScriptTerraformingError("budget_exceeded", "terraform.operation_budget_exceeded", "TowerScript terraforming operation budget exceeded.");
        }
        this.scriptTerrainChangesRemaining -= operationCount;
        const operations = operationValues.map((value) => this.inspectTerraformOperation(value));
        const timed = Object.prototype.hasOwnProperty.call(actionDescriptors, "duration");
        if (timed && operations.some((operation) => (operation.kind === "restore_terrain" || operation.kind === "restore_elevation"))) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Timed terraforming batches support set operations only.");
        }
        if (timed && this.pendingTerraformExpiryGroups.length >= TERRAFORMING_LIMITS.pendingExpiryGroups) {
            throw new TowerScriptTerraformingError("budget_exceeded", "terraform.expiry_group_budget_exceeded", `Terraform expiry groups exceed the ${TERRAFORMING_LIMITS.pendingExpiryGroups} group limit.`);
        }
        let duration;
        if (timed) {
            const durationDescriptor = actionDescriptors.duration;
            const resolvedDuration = evaluate(durationDescriptor.value);
            if (typeof resolvedDuration !== "number" || !Number.isFinite(resolvedDuration)
                || resolvedDuration <= 0 || resolvedDuration > TERRAFORMING_LIMITS.duration) {
                throw new TowerScriptTerraformingError("invalid_action", "terraform.duration_out_of_range", `Terraform duration must be finite and inside (0, ${TERRAFORMING_LIMITS.duration}].`);
            }
            duration = resolvedDuration;
        }
        const hasElevationOperations = operations.some((operation) => (operation.kind === "set_elevation" || operation.kind === "restore_elevation"));
        if (hasElevationOperations && !this.activeElevation) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.elevation_dependency_missing", "Elevation terraforming requires an active elevation capability.");
        }
        if (hasElevationOperations && !this.activeTerraformingMechanics.elevation) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.elevation_policy_missing", "Elevation terraforming requires an active terraforming elevation policy.");
        }
        const resolvedOperations = operations.map((operation, order) => {
            const coord = this.resolveTerraformTarget(operation.target, context, evaluate);
            if (!coord) {
                throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Terraform tile target did not resolve to safe integer coordinates.");
            }
            if (operation.kind === "set_terrain") {
                return { kind: "set_terrain", coord, transitionId: operation.transitionId, order };
            }
            if (operation.kind === "restore_terrain")
                return { kind: "restore_terrain", coord, order };
            if (operation.kind === "restore_elevation")
                return { kind: "restore_elevation", coord, order };
            const elevation = (typeof operation.elevation === "number" && !Number.isFinite(operation.elevation)) ? Number.NaN : evaluate(operation.elevation);
            return {
                kind: "set_elevation",
                coord,
                elevation: typeof elevation === "number" ? elevation : Number.NaN,
                order
            };
        });
        const outside = resolvedOperations.find((operation) => !this.map.isInside(operation.coord));
        if (outside) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.target_outside_map", `Terraform target ${outside.coord.q},${outside.coord.r} is outside the map.`);
        }
        const targetKeys = new Set();
        for (const operation of resolvedOperations) {
            const layer = operation.kind === "set_terrain" || operation.kind === "restore_terrain"
                ? "terrain"
                : "elevation";
            const coordValue = coordKey(operation.coord);
            const key = `${layer}:${coordValue}`;
            if (targetKeys.has(key)) {
                throw new TowerScriptTerraformingError("invalid_action", "terraform.duplicate_target", `Terraform ${layer} target ${coordValue} is duplicated in the batch.`);
            }
            targetKeys.add(key);
            if (this.isNativeTerraformTargetOwned(layer, operation.coord)) {
                throw new TowerScriptTerraformingError("invalid_action", "terraform.target_owned", `Terraform ${layer} target ${coordValue} is owned by a timed batch.`);
            }
        }
        this.applyResolvedPersistentOperations(resolvedOperations, duration);
    }
    applyResolvedPersistentOperations(resolvedOperations, duration) {
        const terrainOperations = resolvedOperations.filter((operation) => (operation.kind === "set_terrain" || operation.kind === "restore_terrain"));
        const elevationOperations = resolvedOperations.filter((operation) => (operation.kind === "set_elevation" || operation.kind === "restore_elevation"));
        const terrainCandidate = terrainOperations.length > 0
            ? this.planPersistentTerrainCandidate(terrainOperations)
            : undefined;
        const elevationCandidate = elevationOperations.length > 0
            ? this.planPersistentElevationCandidate(elevationOperations)
            : undefined;
        const terrainOverrideCount = terrainCandidate?.overrides.size ?? this.runtimeTerrainOverrides.size;
        const elevationOverrideCount = elevationCandidate?.overrides.size ?? this.runtimeElevationOverrides.size;
        if (terrainOverrideCount + elevationOverrideCount > TERRAFORMING_LIMITS.activeOverridesCombined) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.override_budget_exceeded", `Terraform runtime overrides exceed the ${TERRAFORMING_LIMITS.activeOverridesCombined} combined limit.`);
        }
        if ((terrainCandidate?.events.length ?? 0) === 0
            && (elevationCandidate?.events.length ?? 0) === 0) {
            return;
        }
        const navigation = terrainCandidate && this.activeNavigationProfile
            ? this.planDynamicPersistentTerrainNavigation(terrainCandidate)
            : undefined;
        let expiryGroup;
        if (duration !== undefined) {
            const changedTerrainEvents = new Map((terrainCandidate?.events ?? []).map((event) => [event.order, event.event]));
            const changedElevationEvents = new Map((elevationCandidate?.events ?? []).map((event) => [event.order, event.event]));
            const targets = [];
            for (const operation of resolvedOperations) {
                const terrainEvent = changedTerrainEvents.get(operation.order);
                const elevationEvent = changedElevationEvents.get(operation.order);
                if (operation.kind === "set_terrain" && terrainEvent?.type === "terrainChanged") {
                    const previous = this.runtimeTerrainOverrides.get(coordKey(operation.coord));
                    targets.push({
                        layer: "terrain",
                        q: operation.coord.q,
                        r: operation.coord.r,
                        order: operation.order,
                        appliedTerrain: terrainEvent.toTerrain,
                        previousOverride: previous ? {
                            terrain: previous.terrain,
                            source: previous.source
                        } : null
                    });
                }
                else if (operation.kind === "set_elevation" && elevationEvent?.type === "elevationChanged") {
                    const previous = this.runtimeElevationOverrides.get(coordKey(operation.coord));
                    targets.push({
                        layer: "elevation",
                        q: operation.coord.q,
                        r: operation.coord.r,
                        order: operation.order,
                        appliedElevation: elevationEvent.toElevation,
                        previousElevationOverride: previous?.elevation ?? null
                    });
                }
            }
            if (targets.length > 0) {
                expiryGroup = {
                    sequence: this.nextTerraformExpirySequence,
                    remaining: duration,
                    targets
                };
            }
        }
        if (expiryGroup) {
            const owned = countTerraformExpiryOwnership(this.pendingTerraformExpiryGroups);
            const added = countTerraformExpiryOwnership([expiryGroup]);
            if (owned.terrain + added.terrain > TERRAFORMING_LIMITS.activeTerrainOverrides
                || owned.elevation + added.elevation > TERRAFORMING_LIMITS.activeElevationOverrides
                || owned.combined + added.combined > TERRAFORMING_LIMITS.activeOverridesCombined) {
                throw new TowerScriptTerraformingError("invalid_action", "terraform.override_budget_exceeded", "Terraform timed ownership exceeds the active per-layer or combined override limit.");
            }
        }
        this.publishPersistentTerraformCandidate(terrainCandidate, elevationCandidate, navigation);
        if (expiryGroup) {
            this.terraformingCheckpointForm = 2;
            this.pendingTerraformExpiryGroups.push(expiryGroup);
            this.nextTerraformExpirySequence += 1;
            this.syncTemporaryWaterTiles();
        }
    }
    isNativeTerraformTargetOwned(layer, coord) {
        const key = `${layer}:${coordKey(coord)}`;
        return this.pendingTerraformExpiryGroups.some((group) => (group.targets.some((target) => terraformExpiryTargetKey(target) === key)));
    }
    inspectTerraformOperationArray(value) {
        let prototype;
        let lengthDescriptor;
        try {
            if (!Array.isArray(value)) {
                throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Terraform operations must be an ordinary dense array.");
            }
            prototype = Object.getPrototypeOf(value);
            lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
        }
        catch {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Terraform operations could not be inspected safely.");
        }
        if (prototype !== Array.prototype) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Terraform operations must be an ordinary dense array.");
        }
        const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
        if (!Number.isSafeInteger(length) || length < 0) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Terraform operations array length is invalid.");
        }
        if (length > TERRAFORMING_LIMITS.operationsPerBatch) {
            this.scriptTerrainChangesRemaining = 0;
            throw new TowerScriptTerraformingError("budget_exceeded", "terraform.operation_budget_exceeded", `terraformTiles exceeds the ${TERRAFORMING_LIMITS.operationsPerBatch} operation budget.`);
        }
        let descriptors;
        try {
            descriptors = Object.getOwnPropertyDescriptors(value);
        }
        catch {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Terraform operations could not be inspected safely.");
        }
        const descriptorKeys = Reflect.ownKeys(descriptors);
        if (descriptorKeys.some((key) => {
            if (key === "length")
                return false;
            return typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length;
        }) || descriptorKeys.length - 1 !== length) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Terraform operations must be dense own data without extra fields.");
        }
        const result = [];
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)];
            if (!descriptor?.enumerable || !("value" in descriptor)) {
                throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Terraform operation entries must be enumerable own data.");
            }
            result.push(descriptor.value);
        }
        return result;
    }
    inspectTerraformOperation(value) {
        let prototype;
        let descriptors;
        try {
            prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
            descriptors = value !== null && typeof value === "object"
                ? Object.getOwnPropertyDescriptors(value)
                : {};
        }
        catch {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Terraform operation could not be inspected safely.");
        }
        if (value === null || typeof value !== "object" || Array.isArray(value)
            || prototype !== Object.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Terraform operation must be a plain own-data object.");
        }
        const fields = Object.create(null);
        for (const key of Object.keys(descriptors)) {
            const descriptor = descriptors[key];
            if (!descriptor?.enumerable || !("value" in descriptor)) {
                throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", `Terraform operation field "${key}" must be enumerable own data.`);
            }
            Object.defineProperty(fields, key, { value: descriptor.value, enumerable: true });
        }
        const kind = fields.kind;
        const allowed = kind === "set_terrain"
            ? ["kind", "target", "transitionId"]
            : kind === "restore_terrain"
                ? ["kind", "target"]
                : kind === "set_elevation"
                    ? ["kind", "target", "elevation"]
                    : kind === "restore_elevation"
                        ? ["kind", "target"]
                        : undefined;
        if (!allowed || Object.keys(fields).some((key) => !allowed.includes(key))
            || allowed.some((key) => !Object.prototype.hasOwnProperty.call(fields, key))) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "Terraform operation has an unknown kind, missing field, or extra field.");
        }
        if (kind === "set_terrain" && typeof fields.transitionId !== "string") {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", "set_terrain requires a transitionId string.");
        }
        return Object.freeze({ ...fields });
    }
    resolveTerraformTarget(target, context, evaluate) {
        if (target === "eventTile") {
            const value = context.event.coord ?? context.event.center ?? context.event.to;
            if (!value || typeof value !== "object")
                return undefined;
            const coord = value;
            return Number.isSafeInteger(coord.q) && Number.isSafeInteger(coord.r)
                ? { q: Number(coord.q), r: Number(coord.r) }
                : undefined;
        }
        let descriptors;
        let prototype;
        try {
            prototype = target !== null && typeof target === "object" ? Object.getPrototypeOf(target) : null;
            descriptors = target !== null && typeof target === "object"
                ? Object.getOwnPropertyDescriptors(target)
                : {};
        }
        catch {
            return undefined;
        }
        if (target === null || typeof target !== "object" || Array.isArray(target)
            || prototype !== Object.prototype || Object.getOwnPropertySymbols(descriptors).length > 0
            || Object.keys(descriptors).some((key) => key !== "q" && key !== "r"))
            return undefined;
        const qField = descriptors.q;
        const rField = descriptors.r;
        if (!qField?.enumerable || !("value" in qField) || !rField?.enumerable || !("value" in rField)) {
            return undefined;
        }
        const q = evaluate(qField.value);
        const r = evaluate(rField.value);
        return Number.isSafeInteger(q) && Number.isSafeInteger(r)
            ? { q: Number(q), r: Number(r) }
            : undefined;
    }
    planPersistentTerrainCandidate(operations) {
        const overrides = new Map();
        for (const [key, override] of this.runtimeTerrainOverrides)
            overrides.set(key, { ...override });
        const writes = [];
        const events = [];
        const effectiveTerrain = (coord) => (overrides.get(coordKey(coord))?.terrain ?? this.map.getBaseTerrain(coord));
        for (const operation of operations) {
            const key = coordKey(operation.coord);
            const currentTerrain = effectiveTerrain(operation.coord);
            const baseTerrain = this.map.getBaseTerrain(operation.coord);
            if (!currentTerrain || !baseTerrain) {
                throw new TowerScriptTerraformingError("invalid_action", "terraform.target_outside_map", `Terraform target ${key} is outside the map.`);
            }
            const existing = overrides.get(key);
            if (typeof existing?.expiresIn === "number") {
                throw new TowerScriptTerraformingError("invalid_action", "terraform.target_owned", `Terraform target ${key} is owned by a legacy timed override.`);
            }
            let nextTerrain;
            let eventSource;
            if (operation.previousTerrainOverride !== undefined) {
                nextTerrain = operation.previousTerrainOverride?.terrain ?? baseTerrain;
                eventSource = "restore";
                if (operation.previousTerrainOverride) {
                    overrides.set(key, { ...operation.previousTerrainOverride });
                }
                else {
                    overrides.delete(key);
                }
            }
            else if (operation.kind === "set_terrain") {
                if (operation.directTerrainId !== undefined) {
                    const destination = this.content.terrainTypes[operation.directTerrainId];
                    if (!destination) {
                        throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", `Terraform destination terrain "${operation.directTerrainId}" is unknown.`);
                    }
                    nextTerrain = destination.id;
                }
                else {
                    const transition = this.activeTerraformingMechanics.terrainTransitions[operation.transitionId];
                    if (!transition) {
                        throw new TowerScriptTerraformingError("invalid_action", "terraform.transition_missing", `Terraform transition "${operation.transitionId}" is not active.`);
                    }
                    const destination = this.content.terrainTypes[transition.toTerrainId];
                    if (!destination) {
                        throw new TowerScriptTerraformingError("invalid_action", "terraform.invalid_operation", `Terraform transition destination "${transition.toTerrainId}" is unknown.`);
                    }
                    const sourceTags = this.terrainMetadata(currentTerrain).tags;
                    if (!transition.fromTerrainTags.some((tag) => sourceTags.includes(tag))) {
                        throw new TowerScriptTerraformingError("invalid_action", "terraform.transition_source_tag_mismatch", `Terraform transition "${operation.transitionId}" does not admit terrain "${currentTerrain}".`);
                    }
                    nextTerrain = destination.id;
                }
                eventSource = operation.terrainSource ?? "script";
                if (currentTerrain !== nextTerrain) {
                    if (nextTerrain === baseTerrain)
                        overrides.delete(key);
                    else
                        overrides.set(key, {
                            q: operation.coord.q,
                            r: operation.coord.r,
                            terrain: nextTerrain,
                            source: operation.terrainSource ?? "script"
                        });
                }
            }
            else {
                nextTerrain = baseTerrain;
                eventSource = "restore";
                if (currentTerrain !== nextTerrain)
                    overrides.delete(key);
            }
            if (currentTerrain !== nextTerrain) {
                const coord = { q: operation.coord.q, r: operation.coord.r };
                writes.push({ coord, terrain: nextTerrain });
                events.push({
                    order: operation.order,
                    event: {
                        type: "terrainChanged",
                        coord: { ...coord },
                        fromTerrain: currentTerrain,
                        toTerrain: nextTerrain,
                        terrainMetadata: this.terrainMetadata(nextTerrain),
                        source: eventSource
                    }
                });
            }
        }
        if (overrides.size > TERRAFORMING_LIMITS.activeTerrainOverrides) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.override_budget_exceeded", `Terraform terrain overrides exceed the ${TERRAFORMING_LIMITS.activeTerrainOverrides} entry limit.`);
        }
        if (events.length > 0 && !this.activeNavigationProfile) {
            const routes = [...this.map.pathRoutes].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
            const baselineAvailable = routes.every((route) => route.pathCenterline.every((coord) => {
                const terrain = this.map.getTile(coord)?.terrain;
                return terrain !== undefined && this.terrainMetadata(terrain).walkable;
            }));
            const candidateAvailable = routes.every((route) => route.pathCenterline.every((coord) => {
                const terrain = effectiveTerrain(coord);
                return terrain !== undefined && this.terrainMetadata(terrain).walkable;
            }));
            if (!candidateAvailable) {
                throw new TowerScriptTerraformingError("invalid_action", baselineAvailable ? "terraform.last_authored_route_blocked" : "terraform.authored_route_unavailable", baselineAvailable
                    ? "Terraforming would block an authored route."
                    : "Authored routes remain unavailable after terraforming.");
            }
        }
        return { overrides, writes, events };
    }
    planPersistentElevationCandidate(operations) {
        const policy = this.activeTerraformingMechanics?.elevation;
        if (!policy) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.elevation_policy_missing", "Elevation terraforming requires an active policy.");
        }
        const overrides = new Map();
        for (const [key, override] of this.runtimeElevationOverrides)
            overrides.set(key, { ...override });
        const writes = [];
        const events = [];
        for (const operation of operations) {
            const key = coordKey(operation.coord);
            const currentElevation = overrides.get(key)?.elevation ?? this.map.getBaseElevation(operation.coord);
            const baseElevation = this.map.getBaseElevation(operation.coord);
            if (currentElevation === undefined || baseElevation === undefined) {
                throw new TowerScriptTerraformingError("invalid_action", "terraform.target_outside_map", `Terraform target ${key} is outside the map.`);
            }
            let nextElevation;
            let source;
            if (operation.previousElevationOverride !== undefined) {
                nextElevation = operation.previousElevationOverride?.elevation ?? baseElevation;
                source = "restore";
                if (operation.previousElevationOverride) {
                    overrides.set(key, { ...operation.previousElevationOverride });
                }
                else {
                    overrides.delete(key);
                }
            }
            else if (operation.kind === "set_elevation") {
                nextElevation = operation.elevation;
                if (!Number.isSafeInteger(nextElevation)
                    || nextElevation < TERRAFORMING_LIMITS.elevationMinimum
                    || nextElevation > TERRAFORMING_LIMITS.elevationMaximum
                    || nextElevation < policy.minimum
                    || nextElevation > policy.maximum) {
                    throw new TowerScriptTerraformingError("invalid_action", "terraform.elevation_out_of_range", "Terraform elevation must be a safe integer inside the active elevation policy.");
                }
                if (Math.abs(nextElevation - currentElevation) > policy.maximumDeltaPerOperation) {
                    throw new TowerScriptTerraformingError("invalid_action", "terraform.elevation_delta_exceeded", "Terraform elevation change exceeds the active per-operation delta.");
                }
                source = "script";
                if (nextElevation === baseElevation)
                    overrides.delete(key);
                else
                    overrides.set(key, {
                        q: operation.coord.q,
                        r: operation.coord.r,
                        elevation: nextElevation
                    });
            }
            else {
                nextElevation = baseElevation;
                source = "restore";
                overrides.delete(key);
            }
            if (currentElevation !== nextElevation) {
                const coord = { q: operation.coord.q, r: operation.coord.r };
                writes.push({ coord, elevation: nextElevation });
                events.push({
                    order: operation.order,
                    event: {
                        type: "elevationChanged",
                        coord: { ...coord },
                        fromElevation: currentElevation,
                        toElevation: nextElevation,
                        source
                    }
                });
            }
        }
        if (overrides.size > TERRAFORMING_LIMITS.activeElevationOverrides) {
            throw new TowerScriptTerraformingError("invalid_action", "terraform.override_budget_exceeded", `Terraform elevation overrides exceed the ${TERRAFORMING_LIMITS.activeElevationOverrides} entry limit.`);
        }
        return { overrides, writes, events };
    }
    planDynamicPersistentTerrainNavigation(candidate) {
        const profile = this.activeNavigationProfile;
        if (!profile)
            throw new Error("Dynamic terraforming navigation requires an active profile.");
        const routes = this.map.pathRoutes;
        const reachableTerrainIds = new Set([...this.map.tiles.values()].map((tile) => tile.terrain));
        if (this.mission.abilities?.some((ability) => ability.id === "path_water")
            && this.content.terrainTypes.water
            && this.map.allPathCoords().some((coord) => this.map.getBaseTerrain(coord) === "path"))
            reachableTerrainIds.add("water");
        const transitionTerrainById = Object.fromEntries(Object.keys(this.activeTerraformingMechanics.terrainTransitions)
            .sort(compareBinary)
            .map((transitionId) => [
            transitionId,
            this.activeTerraformingMechanics.terrainTransitions[transitionId].toTerrainId
        ]));
        let safetySet;
        try {
            const spawnGraph = collectDynamicTerraformingSpawnProvenance({
                profile,
                routes,
                waves: this.mission.waves,
                enemyTypes: this.content.enemies,
                scripts: this.content.scripts,
                mission: {
                    id: this.mission.id,
                    mapId: this.mission.mapId,
                    waveSetId: this.mission.waveSetId,
                    buildTowerIds: this.mission.buildTowerIds ?? Object.keys(this.content.towers),
                    abilityIds: this.mission.abilityIds ?? Object.keys(this.content.abilities)
                },
                initialReachableTerrainIds: [...reachableTerrainIds].sort(compareBinary),
                terraformTransitionTerrainById: transitionTerrainById
            });
            safetySet = prepareDynamicTerraformingSafetySet({
                profile,
                routes,
                spawnProvenance: spawnGraph.spawnProvenance,
                spawnObligations: spawnGraph.spawnObligations,
                enemies: this.enemies,
                mapCellCount: this.map.width * this.map.height
            });
        }
        catch (error) {
            if (error instanceof DynamicTerraformingSafetyBudgetError) {
                throw new TowerScriptTerraformingError("budget_exceeded", "terraform.solver_budget_exceeded", error.message);
            }
            throw error;
        }
        const occupiedCoords = this.navigationOccupiedCoords();
        const navigation = planDynamicTerraformingNavigation({
            profile,
            routes,
            enemies: this.enemies,
            safetySet,
            baselineResolver: this.createNavigationResolver(occupiedCoords),
            candidateResolver: this.createNavigationResolver(occupiedCoords, this.navigationTerrainByCoordForOverrides(candidate.overrides))
        });
        if (!navigation.candidateAvailable) {
            throw new TowerScriptTerraformingError("invalid_action", navigation.baselineAvailable
                ? "terraform.last_path_blocked"
                : "terraform.navigation_unavailable", navigation.baselineAvailable
                ? "Terraforming would block the last dynamic path."
                : "Dynamic paths remain unavailable after terraforming.");
        }
        return navigation;
    }
    publishPersistentTerraformCandidate(terrainCandidate, elevationCandidate, navigation) {
        if (terrainCandidate) {
            for (const write of terrainCandidate.writes)
                this.map.setTerrain(write.coord, write.terrain);
            this.runtimeTerrainOverrides = terrainCandidate.overrides;
            this.revalidateHeroMovementAfterMapMutation();
        }
        if (elevationCandidate) {
            this.runtimeElevationOverrides = elevationCandidate.overrides;
            this.map.useRuntimeElevationOverrides(this.runtimeElevationOverrides);
        }
        if (navigation) {
            this.navigationResolver = navigation.candidateResolver;
            this.navigationFieldLookupCache = navigation.candidateLookupCache;
            this.navigationEnemyFields = navigation.candidateEnemyFields;
            const rebinds = new Map(navigation.enemyRebinds.map((rebind) => [rebind.enemyId, rebind]));
            for (const enemy of this.enemies) {
                const rebind = rebinds.get(enemy.id);
                if (!rebind)
                    continue;
                enemy.navigation = rebind.navigation;
                enemy.pathProgress = rebind.pathProgress;
            }
        }
        this.syncTemporaryWaterTiles();
        const events = [
            ...(terrainCandidate?.events ?? []),
            ...(elevationCandidate?.events ?? [])
        ].sort((left, right) => left.order - right.order);
        this.lastEvents.push(...events.map((entry) => entry.event));
    }
    applyTerrainOverride(coord, terrainId, duration, source) {
        const terrain = this.content.terrainTypes[terrainId];
        if (!terrain)
            return this.fail(`Unknown terrain "${terrainId}".`, "reason.unknownTerrain", { terrainId });
        if (!terrain.walkable && this.map.isPathCoord(coord)) {
            return this.fail("An active route cannot be changed to non-walkable terrain.", "reason.routeMustRemainWalkable");
        }
        const tile = this.map.getTile(coord);
        if (!tile)
            return this.fail("Tile is outside the map.", "reason.tileOutsideMap");
        const key = coordKey(coord);
        if (this.activeTerraformingMechanics && this.isNativeTerraformTargetOwned("terrain", coord)) {
            return this.fail(`Terraform terrain target ${key} is owned by a timed batch.`, "terraform.target_owned");
        }
        if (!this.runtimeTerrainOverrides.has(key) && this.runtimeTerrainOverrides.size >= TOWER_SCRIPT_LIMITS.activeTerrainOverrides) {
            return this.fail(`Active terrain override limit (${TOWER_SCRIPT_LIMITS.activeTerrainOverrides}) exceeded.`, "reason.terrainOverrideLimit");
        }
        const fromTerrain = tile.terrain;
        const existing = this.runtimeTerrainOverrides.get(key);
        const expiresIn = duration === undefined ? undefined : Math.max(duration, existing?.expiresIn ?? 0);
        this.runtimeTerrainOverrides.set(key, { q: coord.q, r: coord.r, terrain: terrainId, source, ...(expiresIn === undefined ? {} : { expiresIn }) });
        this.map.setTerrain(coord, terrainId);
        this.syncNavigationTerrain();
        if (fromTerrain !== terrainId) {
            this.lastEvents.push({
                type: "terrainChanged",
                coord: { ...coord },
                fromTerrain,
                toTerrain: terrainId,
                terrainMetadata: this.terrainMetadata(terrainId),
                source
            });
        }
        return { ok: true };
    }
    restoreTerrainOverride(coord) {
        return this.restoreTerrainOverrideByKey(coordKey(coord));
    }
    restoreTerrainOverrideByKey(key) {
        const existing = this.runtimeTerrainOverrides.get(key);
        if (!existing)
            return false;
        const tile = this.map.getTile(existing);
        const fromTerrain = tile?.terrain ?? existing.terrain;
        this.runtimeTerrainOverrides.delete(key);
        this.map.restoreTerrain(existing);
        this.syncNavigationTerrain();
        const toTerrain = this.map.getTile(existing)?.terrain ?? fromTerrain;
        if (fromTerrain !== toTerrain) {
            this.lastEvents.push({
                type: "terrainChanged",
                coord: { q: existing.q, r: existing.r },
                fromTerrain,
                toTerrain,
                terrainMetadata: this.terrainMetadata(toTerrain),
                source: "restore"
            });
        }
        return true;
    }
    syncTemporaryWaterTiles() {
        const legacy = [...this.runtimeTerrainOverrides.values()]
            .filter((entry) => entry.source === "ability" && entry.terrain === "water" && typeof entry.expiresIn === "number")
            .map((entry) => ({ q: entry.q, r: entry.r, expiresIn: entry.expiresIn }));
        if (!this.activeTerraformingMechanics) {
            this.temporaryWaterTiles = legacy;
            return;
        }
        const native = [...this.pendingTerraformExpiryGroups]
            .sort((left, right) => left.sequence - right.sequence)
            .flatMap((group) => group.remaining <= 0
            ? []
            : [...group.targets]
                .sort((left, right) => left.order - right.order)
                .flatMap((target) => {
                if (target.layer !== "terrain" || target.appliedTerrain !== "water")
                    return [];
                const override = this.runtimeTerrainOverrides.get(coordKey(target));
                if (!override || override.source !== "ability" || override.terrain !== "water")
                    return [];
                return [{ q: target.q, r: target.r, expiresIn: group.remaining }];
            }));
        const seen = new Set();
        this.temporaryWaterTiles = [...legacy, ...native].filter((entry) => {
            const key = coordKey(entry);
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    }
    terrainMetadata(terrainId) {
        return this.content.terrainTypes[terrainId] ?? {
            id: terrainId,
            label: terrainId,
            buildable: false,
            walkable: false,
            groundSpeedMultiplier: 1,
            tags: []
        };
    }
    resolveScriptEnemies(target, context) {
        if (target === "allEnemies")
            return this.enemies.filter((enemy) => enemy.hp > 0);
        const id = target === "self" && context.self.scope === "enemy"
            ? context.self.id
            : target === "eventEnemy" && typeof context.event.enemyId === "string" ? context.event.enemyId : null;
        const enemy = id ? this.enemies.find((item) => item.id === id && item.hp > 0) : undefined;
        return enemy ? [enemy] : [];
    }
    resolveScriptTowers(target, context) {
        if (target === "allTowers")
            return [...this.towers];
        const id = target === "self" && context.self.scope === "tower"
            ? context.self.id
            : target === "eventTower" && typeof context.event.towerId === "string" ? context.event.towerId : null;
        const tower = id ? this.towers.find((item) => item.id === id) : undefined;
        return tower ? [tower] : [];
    }
    assertScriptStateSize(context) {
        try {
            canonicalStringify(context.state, {
                maxDepth: 64,
                maxNodes: 100_000,
                maxBytes: TOWER_SCRIPT_LIMITS.stateBytesPerBinding
            });
        }
        catch {
            throw new Error(`TowerScript state for ${context.stateKey} exceeds the canonical JSON limit.`);
        }
    }
    recordScriptDiagnostic(diagnostic) {
        this.scriptDiagnostics.push(diagnostic);
        if (this.scriptDiagnostics.length > TOWER_SCRIPT_LIMITS.retainedDiagnostics)
            this.scriptDiagnostics.shift();
        this.lastEvents.push({ type: "scriptDiagnostic", diagnostic });
    }
    cloneScriptJsonObject(value) {
        return JSON.parse(JSON.stringify(value));
    }
    cloneScriptValues() {
        return JSON.parse(JSON.stringify(this.scriptValues));
    }
    enemyCoord(enemy) {
        if (enemy.navigation) {
            const coord = enemy.navigation.edgeProgress >= 0.5 && enemy.navigation.nextCoord
                ? enemy.navigation.nextCoord
                : enemy.navigation.currentCoord;
            return { q: coord.q, r: coord.r };
        }
        const track = this.enemyTrack(enemy);
        const index = Math.min(Math.round(enemy.pathProgress), track.length - 1);
        return track[index] ?? { q: 0, r: 0 };
    }
    coordEquals(left, right) {
        return left.q === right.q && left.r === right.r;
    }
    /** Resolve one opt-in displacement effect without adding persistent physics state. */
    applyDisplacementEffect(enemy, effectValue, source) {
        const profile = this.activePhysicsMechanics;
        if (!profile || enemy.hp <= 0)
            return;
        const effect = parseDisplacementEffectV1(effectValue);
        if (!effect)
            return;
        const from = this.enemyCoord(enemy);
        const sourceCoord = { ...source.sourceCoord };
        const emitResolved = (to, movedDistance, stopReason) => {
            this.lastEvents.push({
                type: "enemyDisplacementResolved",
                sourceKind: source.sourceKind,
                sourceId: source.sourceId,
                sourceCoord,
                enemyId: enemy.id,
                enemyTypeId: enemy.typeId,
                mode: effect.mode,
                requestedDistance: effect.distance,
                movedDistance,
                from: { ...from },
                to: { ...to },
                stopReason
            });
        };
        if (this.enemyTargetClass(enemy) === "flying"
            || profile.displacementImmuneEnemyTypeIds.includes(enemy.typeId)) {
            emitResolved(from, 0, "immune");
            return;
        }
        let goalBlocked = false;
        let fallTag;
        let applyPlanPosition;
        let classifyCandidate;
        if (enemy.navigation && this.activeNavigationProfile && enemy.routeId) {
            const navigation = enemy.navigation;
            const field = this.navigationField(navigation.movementProfileId, enemy.routeId);
            const lookup = this.navigationFieldLookupCache?.get(field);
            if (!lookup)
                return;
            const goal = this.resolveDynamicNavigationRoute(enemy.routeId).pathCenterline.at(-1);
            classifyCandidate = (candidate) => {
                const tile = this.map.getTile(candidate);
                if (!tile)
                    return "blocked";
                if (goal && this.coordEquals(candidate, goal)) {
                    goalBlocked = true;
                    return "blocked";
                }
                const tag = profile.fallHazardTerrainTags.find((candidateTag) => (this.terrainMetadata(tile.terrain).tags.includes(candidateTag)));
                if (tag) {
                    if (profile.fallImmuneEnemyTypeIds.includes(enemy.typeId))
                        return "blocked";
                    fallTag = tag;
                    return "fall_hazard";
                }
                return lookup.get(candidate) ? "open" : "blocked";
            };
            applyPlanPosition = (to, fell, steps) => {
                const destination = fell ? (steps.at(-2) ?? from) : to;
                const cell = lookup.get(destination);
                navigation.currentCoord = { ...destination };
                if (cell?.nextCoord)
                    navigation.nextCoord = { ...cell.nextCoord };
                else
                    delete navigation.nextCoord;
                navigation.edgeProgress = 0;
                enemy.pathProgress = navigation.stepsEntered;
            };
        }
        else {
            const track = this.enemyTrack(enemy);
            const anchorIndex = Math.min(Math.round(enemy.pathProgress), Math.max(0, track.length - 1));
            let currentIndex = anchorIndex;
            const indicesByCoord = new Map();
            for (let index = 0; index < track.length; index += 1) {
                const coord = track[index];
                const key = coordKey(coord);
                const indices = indicesByCoord.get(key) ?? [];
                indices.push(index);
                indicesByCoord.set(key, indices);
            }
            classifyCandidate = (candidate) => {
                const currentCoord = track[currentIndex];
                const currentIndices = currentCoord ? indicesByCoord.get(coordKey(currentCoord)) : undefined;
                if (!currentCoord || currentIndices?.length !== 1)
                    return "blocked";
                const indices = indicesByCoord.get(coordKey(candidate));
                if (!indices || indices.length !== 1)
                    return "blocked";
                const candidateIndex = indices[0];
                if (candidateIndex === track.length - 1) {
                    goalBlocked = true;
                    return "blocked";
                }
                if (Math.abs(candidateIndex - currentIndex) !== 1
                    || this.map.distance(currentCoord, candidate) !== 1)
                    return "blocked";
                const tile = this.map.getTile(candidate);
                if (!tile)
                    return "blocked";
                const tag = profile.fallHazardTerrainTags.find((candidateTag) => (this.terrainMetadata(tile.terrain).tags.includes(candidateTag)));
                if (tag) {
                    if (profile.fallImmuneEnemyTypeIds.includes(enemy.typeId))
                        return "blocked";
                    fallTag = tag;
                    currentIndex = candidateIndex;
                    return "fall_hazard";
                }
                if (tile.occupiedBy || !this.terrainMetadata(tile.terrain).walkable)
                    return "blocked";
                currentIndex = candidateIndex;
                return "open";
            };
            applyPlanPosition = (to) => {
                const indices = indicesByCoord.get(coordKey(to));
                if (indices?.length === 1)
                    enemy.pathProgress = indices[0];
            };
        }
        const plan = planTileDisplacement({
            topology: this.map.topology,
            sourceCoord,
            targetCoord: from,
            effect,
            classifyCandidate
        });
        if (plan.movedDistance > 0 || plan.fell) {
            applyPlanPosition(plan.to, plan.fell, plan.steps);
        }
        const stopReason = goalBlocked ? "goal_blocked" : plan.stopReason;
        emitResolved(plan.to, plan.movedDistance, stopReason);
        if (!plan.fell || !fallTag)
            return;
        enemy.hp = 0;
        this.lastEvents.push({
            type: "enemyFell",
            sourceKind: source.sourceKind,
            sourceId: source.sourceId,
            sourceCoord,
            enemyId: enemy.id,
            enemyTypeId: enemy.typeId,
            from: { ...plan.from },
            to: { ...plan.to },
            terrainTag: fallTag
        });
    }
    navigationMovementProfileId(typeId) {
        const profile = this.activeNavigationProfile;
        if (!profile)
            throw new Error("Dynamic enemy navigation requires an active profile.");
        return profile.enemyMovementProfiles?.[typeId] ?? profile.defaultMovementProfileId;
    }
    activeHeroesV2() {
        return this.activeHeroesMechanics?.schemaVersion === 2
            || this.activeHeroesMechanics?.schemaVersion === 3
            || this.activeHeroesMechanics?.schemaVersion === 4
            || this.activeHeroesMechanics?.schemaVersion === 5
            || this.activeHeroesMechanics?.schemaVersion === 6
            ? this.activeHeroesMechanics
            : undefined;
    }
    heroSkillManagementAvailable() {
        if (this.outcome !== "playing" || this.enemies.length > 0 || this.spawnQueue.length > 0)
            return false;
        const setup = this.waveState === "ready" && this.startedWaveCount === 0;
        const interwave = this.waveState === "between"
            && this.startedWaveCount > 0
            && this.startedWaveCount < this.mission.waves.length;
        return setup || interwave;
    }
    heroAbilitySkillModifiers(profile, state) {
        const tree = profile.definitions[state.definitionId]?.skillTree;
        if (!tree || !state.unlockedSkillIds)
            return Object.freeze([]);
        const modifiers = [];
        for (const skillId of [...state.unlockedSkillIds].sort(compareBinary)) {
            const node = tree.nodes[skillId];
            if (!node)
                continue;
            for (let effectIndex = 0; effectIndex < node.effects.length; effectIndex += 1) {
                const effect = node.effects[effectIndex];
                modifiers.push(Object.freeze({
                    id: heroSkillModifierIdV5(skillId, effectIndex),
                    target: effect.modifier.target,
                    stage: "run",
                    operation: effect.modifier.operation,
                    value: effect.modifier.value
                }));
            }
        }
        return Object.freeze(modifiers);
    }
    heroPassiveAuraActive() {
        const cached = this.activeHeroPassiveAura;
        const state = this.heroStateV2;
        return cached !== undefined
            && state !== undefined
            && state.definitionId === cached.definitionId
            && this.outcome === "playing"
            && (state.hp ?? 0) > 0;
    }
    heroPassiveAuraAffectedTowerIds() {
        const cached = this.activeHeroPassiveAura;
        if (!cached)
            return EMPTY_FROZEN_ARRAY;
        const state = this.heroStateV2;
        if (!state || !this.heroPassiveAuraActive())
            return EMPTY_FROZEN_ARRAY;
        return Object.freeze(this.towers
            .filter((tower) => (tower.hp === undefined || tower.hp > 0)
            && this.map.distance(state.currentCoord, tower.coord) <= cached.aura.radius)
            .map((tower) => tower.id)
            .sort(compareBinary));
    }
    heroPassiveAuraModifiersForTower(tower) {
        const cached = this.activeHeroPassiveAura;
        if (!cached)
            return EMPTY_FROZEN_ARRAY;
        const state = this.heroStateV2;
        if (!state || !this.heroPassiveAuraActive()
            || (tower.hp !== undefined && tower.hp <= 0)
            || this.map.distance(state.currentCoord, tower.coord) > cached.aura.radius) {
            return EMPTY_FROZEN_ARRAY;
        }
        return cached.modifiers;
    }
    buildHeroMovementField(profile, target) {
        const definition = profile.definitions[profile.selectedHeroId];
        const movementProfileId = definition.movement.movementProfileId;
        return buildNavigationField({
            grid: this.map.grid,
            width: this.map.width,
            height: this.map.height,
            movementProfileId,
            goal: { q: target.q, r: target.r },
            profile: profile.movementProfiles[movementProfileId],
            terrainTypes: this.content.terrainTypes,
            terrainByCoord: this.navigationTerrainByCoord(),
            occupiedCoords: this.navigationOccupiedCoords()
        });
    }
    stabilizeHeroMovement() {
        const profile = this.activeHeroesV2();
        const state = this.heroStateV2;
        if (!profile || !state || !this.heroMovementDirty)
            return;
        this.heroMovementDirty = false;
        if (state.targetCoord === null) {
            state.nextCoord = null;
            state.edgeProgress = 0;
            this.heroMovementField = undefined;
            return;
        }
        let field;
        try {
            field = this.buildHeroMovementField(profile, state.targetCoord);
        }
        catch {
            state.nextCoord = null;
            state.edgeProgress = 0;
            this.heroMovementField = undefined;
            return;
        }
        const cell = this.heroMovementLookupCache.get(field).get(state.currentCoord);
        const canonicalNext = cell?.nextCoord;
        if (!canonicalNext) {
            state.nextCoord = null;
            state.edgeProgress = 0;
            this.heroMovementField = field;
            return;
        }
        const preservesProgress = state.nextCoord !== null && sameGridCoord(state.nextCoord, canonicalNext);
        state.nextCoord = this.cleanCoord(canonicalNext);
        state.edgeProgress = preservesProgress ? state.edgeProgress : 0;
        this.heroMovementField = field;
    }
    moveHeroUnit(delta) {
        const profile = this.activeHeroesV2();
        const state = this.heroStateV2;
        if (!profile || !state)
            return;
        if (profile.schemaVersion >= 3 && (state.hp ?? 0) <= 0)
            return;
        this.stabilizeHeroMovement();
        if (state.targetCoord === null || !this.heroMovementField)
            return;
        const definition = profile.definitions[state.definitionId];
        if (!definition)
            return;
        const lookup = this.heroMovementLookupCache.get(this.heroMovementField);
        let movementBudget = Math.max(0, definition.movement.speed * delta * 1_000);
        let entered = 0;
        while (entered < NAVIGATION_LIMITS.activeMapCells) {
            if (state.targetCoord === null)
                break;
            if (sameGridCoord(state.currentCoord, state.targetCoord)) {
                state.targetCoord = null;
                state.nextCoord = null;
                state.edgeProgress = 0;
                this.heroMovementField = undefined;
                break;
            }
            const cell = lookup.get(state.currentCoord);
            if (!cell?.nextCoord) {
                state.nextCoord = null;
                state.edgeProgress = 0;
                break;
            }
            state.nextCoord = this.cleanCoord(cell.nextCoord);
            const enteredCost = lookup.enteredCost(cell);
            if (enteredCost === undefined || movementBudget <= 0)
                break;
            const remainingCost = (1 - state.edgeProgress) * enteredCost;
            if (movementBudget + 1e-9 < remainingCost) {
                state.edgeProgress = Math.min(0.999999999999, state.edgeProgress + movementBudget / enteredCost);
                break;
            }
            movementBudget = Math.max(0, movementBudget - remainingCost);
            state.currentCoord = this.cleanCoord(cell.nextCoord);
            state.edgeProgress = 0;
            entered += 1;
        }
        if (state.targetCoord !== null && sameGridCoord(state.currentCoord, state.targetCoord)) {
            state.targetCoord = null;
            state.nextCoord = null;
            state.edgeProgress = 0;
            this.heroMovementField = undefined;
        }
    }
    updateHeroAbility(delta) {
        const profile = this.activeHeroesMechanics;
        const state = this.heroStateV2;
        if ((profile?.schemaVersion !== 4 && profile?.schemaVersion !== 5 && profile?.schemaVersion !== 6)
            || !state || (state.hp ?? 0) <= 0)
            return;
        const definition = profile.definitions[state.definitionId];
        if (!definition)
            return;
        state.mana = Math.min(definition.mana.max, (state.mana ?? 0) + definition.mana.regenerationPerUnit * delta);
        state.abilityCooldownRemaining = Math.max(0, (state.abilityCooldownRemaining ?? 0) - delta);
    }
    navigationField(movementProfileId, routeId) {
        const resolver = this.navigationResolver;
        if (!resolver)
            throw new Error("Dynamic enemy navigation requires an active resolver.");
        return resolver.getField(movementProfileId, routeId);
    }
    createEnemyNavigationState(enemyId, typeId, routeId, pathProgress) {
        const movementProfileId = this.navigationMovementProfileId(typeId);
        const route = this.resolveDynamicNavigationRoute(routeId);
        const source = route.pathCenterline[0] ?? route.pathCenterline.at(-1);
        if (!source)
            throw new Error(`Dynamic navigation route "${route.id}" has no endpoint.`);
        const field = this.navigationField(movementProfileId, route.id);
        const lookup = this.navigationFieldLookupCache?.get(field);
        if (!lookup)
            throw new Error("Dynamic enemy navigation lookup cache is unavailable.");
        const state = {
            schemaVersion: 1,
            movementProfileId,
            currentCoord: { q: source.q, r: source.r },
            edgeProgress: 0,
            stepsEntered: 0
        };
        let remainingSteps = Math.min(NAVIGATION_LIMITS.activeMapCells, Math.max(0, Math.floor(Number.isFinite(pathProgress) ? pathProgress : 0)));
        while (remainingSteps > 0) {
            const cell = lookup.get(state.currentCoord);
            if (!cell?.nextCoord)
                break;
            state.currentCoord = { q: cell.nextCoord.q, r: cell.nextCoord.r };
            state.stepsEntered += 1;
            remainingSteps -= 1;
        }
        const cell = lookup.get(state.currentCoord);
        if (cell?.nextCoord) {
            state.nextCoord = { q: cell.nextCoord.q, r: cell.nextCoord.r };
            state.edgeProgress = Math.max(0, Math.min(0.999999999999, pathProgress - Math.floor(pathProgress)));
        }
        this.navigationEnemyFields?.set(enemyId, field);
        return state;
    }
    createDynamicChildEnemyState(parent, typeId, routeId, pathOffset, forwardSteps) {
        const child = this.createEnemyState(typeId, 0, pathOffset, routeId);
        if (!child || !parent.navigation || !child.navigation || !child.routeId)
            return child;
        const field = this.navigationField(child.navigation.movementProfileId, child.routeId);
        const lookup = this.navigationFieldLookupCache?.get(field);
        if (!lookup)
            return child;
        let currentCoord = { ...parent.navigation.currentCoord };
        let stepsEntered = parent.navigation.stepsEntered;
        let cell = lookup.get(currentCoord);
        const parentEdgeIsCanonical = Boolean(parent.navigation.nextCoord
            && cell?.nextCoord
            && parent.navigation.nextCoord.q === cell.nextCoord.q
            && parent.navigation.nextCoord.r === cell.nextCoord.r);
        let edgeProgress = parentEdgeIsCanonical ? parent.navigation.edgeProgress : 0;
        let remaining = Math.max(0, Number.isFinite(forwardSteps) ? forwardSteps : 0);
        let traversed = 0;
        while (cell?.nextCoord && edgeProgress + remaining >= 1 && traversed < NAVIGATION_LIMITS.activeMapCells) {
            const needed = 1 - edgeProgress;
            remaining = Math.max(0, remaining - needed);
            currentCoord = { q: cell.nextCoord.q, r: cell.nextCoord.r };
            stepsEntered += 1;
            edgeProgress = 0;
            traversed += 1;
            cell = lookup.get(currentCoord);
        }
        if (cell?.nextCoord)
            edgeProgress = Math.min(0.999999999999, edgeProgress + remaining);
        else
            edgeProgress = 0;
        child.navigation = {
            schemaVersion: 1,
            movementProfileId: child.navigation.movementProfileId,
            currentCoord,
            ...(cell?.nextCoord ? { nextCoord: { q: cell.nextCoord.q, r: cell.nextCoord.r } } : {}),
            edgeProgress,
            stepsEntered
        };
        child.pathProgress = stepsEntered + edgeProgress;
        this.navigationEnemyFields?.set(child.id, field);
        return child;
    }
    stabilizeDynamicEnemyNavigation() {
        if (!this.activeNavigationProfile || !this.navigationResolver)
            return;
        for (const enemy of this.enemies) {
            const routeId = this.resolveDynamicNavigationRoute(enemy.routeId).id;
            enemy.routeId = routeId;
            if (!enemy.navigation) {
                enemy.navigation = this.createEnemyNavigationState(enemy.id, enemy.typeId, routeId, enemy.pathProgress);
                enemy.pathProgress = enemy.navigation.stepsEntered + enemy.navigation.edgeProgress;
                continue;
            }
            const movementProfileId = this.navigationMovementProfileId(enemy.typeId);
            const installedField = this.navigationEnemyFields?.get(enemy.id);
            if (installedField
                && this.navigationResolver.isFieldCurrent(installedField, movementProfileId, routeId))
                continue;
            const field = this.navigationField(movementProfileId, routeId);
            if (installedField === field)
                continue;
            const lookup = this.navigationFieldLookupCache?.get(field);
            const cell = lookup?.get(enemy.navigation.currentCoord);
            const edgeRemainsCanonical = Boolean(enemy.navigation.nextCoord
                && cell?.nextCoord
                && enemy.navigation.nextCoord.q === cell.nextCoord.q
                && enemy.navigation.nextCoord.r === cell.nextCoord.r
                && lookup?.enteredCost(cell) !== undefined);
            enemy.navigation = {
                schemaVersion: 1,
                movementProfileId,
                currentCoord: { ...enemy.navigation.currentCoord },
                ...(cell?.nextCoord ? { nextCoord: { q: cell.nextCoord.q, r: cell.nextCoord.r } } : {}),
                edgeProgress: edgeRemainsCanonical ? enemy.navigation.edgeProgress : 0,
                stepsEntered: enemy.navigation.stepsEntered
            };
            enemy.pathProgress = enemy.navigation.stepsEntered + enemy.navigation.edgeProgress;
            this.navigationEnemyFields?.set(enemy.id, field);
        }
    }
    startWave(waveIndex, startedAt, earlyStartUnits = 0) {
        const wave = this.mission.waves[waveIndex];
        if (!wave) {
            return this.fail("No waves left.", "reason.noWaves");
        }
        this.waveIndex = waveIndex;
        this.startedWaveCount = Math.max(this.startedWaveCount, waveIndex + 1);
        this.waveState = "spawning";
        this.spawnQueue.push(...this.buildSpawnQueue(wave, startedAt));
        this.spawnQueue.sort((a, b) => a.at - b.at);
        this.nextWaveStartAt = this.activeRogueliteMechanics?.draft
            ? null
            : this.startedWaveCount < this.mission.waves.length ? startedAt + this.mission.prepTimeUnits : null;
        this.syncPrepRemaining();
        const waveStartIncome = this.normalizeCost(this.mission.economy?.perWaveStart ?? {});
        if (this.bagHasValue(waveStartIncome)) {
            this.addResources(waveStartIncome);
            this.lastEvents.push({ type: "resourcesGranted", source: "waveStart", waveIndex, resources: waveStartIncome });
        }
        if (earlyStartUnits > 0) {
            const bonus = this.scaleBag(this.mission.economy?.earlyStartBonusPerUnit ?? {}, earlyStartUnits);
            if (this.bagHasValue(bonus)) {
                this.addResources(bonus);
                this.lastEvents.push({ type: "resourcesGranted", source: "earlyStart", waveIndex, resources: bonus });
            }
        }
        this.lastEvents.push({ type: "waveStarted", waveIndex });
        return { ok: true };
    }
    startScheduledWaves() {
        if (this.pendingDraftOffer)
            return;
        while (this.nextWaveStartAt !== null &&
            this.startedWaveCount < this.mission.waves.length &&
            this.missionElapsed + 0.0001 >= this.nextWaveStartAt) {
            const scheduledAt = this.nextWaveStartAt;
            this.startWave(this.startedWaveCount, scheduledAt);
        }
    }
    buildSpawnQueue(wave = this.mission.waves[this.waveIndex], baseAt = 0) {
        const queue = [];
        if (!wave) {
            return queue;
        }
        for (const group of wave.groups) {
            for (let i = 0; i < group.count; i += 1) {
                queue.push({
                    at: baseAt + group.startDelay + i * group.spawnInterval,
                    enemyId: group.enemyId,
                    routeId: group.routeId
                });
            }
        }
        return queue.sort((a, b) => a.at - b.at);
    }
    spawnDueEnemies() {
        let consumed = 0;
        while (consumed < this.spawnQueue.length && (this.spawnQueue[consumed]?.at ?? Infinity) <= this.missionElapsed + 0.0001) {
            const item = this.spawnQueue[consumed];
            if (item) {
                const enemy = this.createEnemyState(item.enemyId, 0, 0, item.routeId);
                if (enemy) {
                    this.enemies.push(enemy);
                }
            }
            consumed += 1;
        }
        if (consumed > 0) {
            this.spawnQueue.splice(0, consumed);
        }
    }
    createEnemyState(typeId, pathProgress, pathOffset, routeId) {
        const type = this.enemyTypes[typeId];
        if (!type) {
            return null;
        }
        const resolvedRouteId = this.activeNavigationProfile
            ? this.resolveDynamicNavigationRoute(routeId).id
            : this.enemyTargetClassByType(typeId) === "ground" ? this.resolveRouteId(routeId) : undefined;
        const trackEnd = Math.max(0, this.enemyTrackForType(typeId, resolvedRouteId).length - 1);
        const enemy = {
            id: `enemy_${++this.enemyCounter}`,
            typeId,
            hp: type.maxHp * (this.difficulty.enemyHpMultiplier ?? 1),
            maxHp: type.maxHp * (this.difficulty.enemyHpMultiplier ?? 1),
            pathProgress: Math.max(0, Math.min(pathProgress, Math.max(0, trackEnd - 0.001))),
            dotRemaining: 0,
            pathOffset,
            routeId: resolvedRouteId,
            phaseSpawnsTriggered: type.phaseSpawns?.length ? [] : undefined,
            statuses: {}
        };
        if (this.activeNavigationProfile && resolvedRouteId) {
            enemy.navigation = this.createEnemyNavigationState(enemy.id, typeId, resolvedRouteId, pathProgress);
            enemy.pathProgress = enemy.navigation.stepsEntered + enemy.navigation.edgeProgress;
        }
        this.initializeEnemyShield(enemy);
        return enemy;
    }
    initializeEnemyShield(enemy) {
        const definition = this.combatShieldDefinitions?.enemies[enemy.typeId];
        if (!definition)
            return;
        this.enemyShields[enemy.id] = {
            current: definition.capacity,
            capacity: definition.capacity,
            regenerationDelayRemaining: 0
        };
    }
    initializeTowerShield(tower) {
        const definition = this.combatShieldDefinitions?.towers[tower.typeId];
        if (!definition)
            return;
        this.towerShields[tower.id] = {
            current: definition.capacity,
            capacity: definition.capacity,
            regenerationDelayRemaining: 0
        };
    }
    runtimeMarkApplicationCount() {
        let count = 0;
        for (const marks of Object.values(this.enemyMarks))
            count += Object.keys(marks).length;
        return count;
    }
    applyEnemyMark(enemy, markId, stacks, cause) {
        const definition = this.activeCombatMechanics?.marks.definitions[markId];
        if (!definition || enemy.hp <= 0 || !Number.isSafeInteger(stacks) || stacks <= 0 || stacks > definition.maxStacks) {
            return false;
        }
        const enemyMarkState = this.enemyMarks[enemy.id] ??= {};
        const previous = enemyMarkState[markId];
        if (!previous && this.runtimeMarkApplicationCount() >= MARK_LIMITS.runtimeApplications) {
            throw new Error(`Runtime mark applications exceed the ${MARK_LIMITS.runtimeApplications} limit.`);
        }
        const previousStacks = previous?.stacks ?? 0;
        const previousRemaining = previous?.remaining ?? 0;
        const currentStacks = Math.min(definition.maxStacks, previousStacks + stacks);
        if (currentStacks === previousStacks && definition.duration === previousRemaining)
            return false;
        enemyMarkState[markId] = { stacks: currentStacks, remaining: definition.duration };
        this.lastEvents.push({
            type: "enemyMarkChanged",
            enemyId: enemy.id,
            enemyTypeId: enemy.typeId,
            markId,
            previousStacks,
            currentStacks,
            previousRemaining,
            remaining: definition.duration,
            cause
        });
        return true;
    }
    clearEnemyMark(enemy, markId, cause, consumedStacks) {
        const enemyMarkState = this.enemyMarks[enemy.id];
        const previous = enemyMarkState?.[markId];
        if (!enemyMarkState || !previous)
            return false;
        const currentStacks = consumedStacks === undefined ? 0 : Math.max(0, previous.stacks - consumedStacks);
        const remaining = currentStacks > 0 ? previous.remaining : 0;
        if (currentStacks > 0)
            enemyMarkState[markId] = { stacks: currentStacks, remaining };
        else
            delete enemyMarkState[markId];
        if (Object.keys(enemyMarkState).length === 0)
            delete this.enemyMarks[enemy.id];
        this.lastEvents.push({
            type: "enemyMarkChanged",
            enemyId: enemy.id,
            enemyTypeId: enemy.typeId,
            markId,
            previousStacks: previous.stacks,
            currentStacks,
            previousRemaining: previous.remaining,
            remaining,
            cause
        });
        return true;
    }
    updateEnemyMarks(delta) {
        if (delta <= 0)
            return;
        for (const enemy of this.enemies) {
            const marks = this.enemyMarks[enemy.id];
            if (!marks)
                continue;
            for (const markId of Object.keys(marks).sort()) {
                const state = marks[markId];
                if (!state)
                    continue;
                const remaining = Math.max(0, state.remaining - delta);
                if (remaining <= 1e-9)
                    this.clearEnemyMark(enemy, markId, "expiration");
                else
                    marks[markId] = { stacks: state.stacks, remaining };
            }
        }
    }
    activeMarkDamageContext(enemy) {
        const states = this.enemyMarks[enemy.id];
        if (!states)
            return undefined;
        return Object.keys(states).sort().flatMap((markId) => {
            const state = states[markId];
            const definition = this.activeCombatMechanics?.marks.definitions[markId];
            if (!state || !definition)
                return [];
            return [{
                    markId,
                    stacks: state.stacks,
                    multiplier: definition.multiplier,
                    consumePolicy: definition.consumePolicy,
                    ...(definition.damageTypes === undefined ? {} : { damageTypes: definition.damageTypes })
                }];
        });
    }
    consumeResolvedMarks(enemy, resolution) {
        if (resolution.afterModifiers <= 0)
            return;
        for (const step of resolution.markTrace ?? []) {
            if (step.consumePolicy === "retain")
                continue;
            this.clearEnemyMark(enemy, step.markId, "consume", step.consumePolicy === "consume_one" ? 1 : undefined);
        }
    }
    applySourceMarkBindings(enemy, packet, resolution) {
        if (enemy.hp <= 0
            || resolution.finalAmount <= 0
            || packet.tags?.includes("over_time")
            || !this.activeCombatMechanics)
            return;
        const source = packet.source;
        const applications = source.kind === "tower"
            ? this.activeCombatMechanics.marks.bindings.towers[source.towerTypeId]
            : source.kind === "ability"
                ? this.activeCombatMechanics.marks.bindings.abilities[source.abilityId]
                : source.kind === "tower_script"
                    ? this.activeCombatMechanics.marks.bindings.towerScripts[source.scriptId]
                    : undefined;
        for (const application of applications ?? []) {
            this.applyEnemyMark(enemy, application.markId, application.stacks ?? 1, "application");
        }
    }
    updateShieldRegeneration(delta) {
        if (delta <= 0 || !this.combatShieldDefinitions)
            return;
        const regenerate = (state, definition, emitFull) => {
            const regeneration = definition.regeneration;
            if (!regeneration || state.current >= state.capacity)
                return;
            let available = delta;
            if (state.regenerationDelayRemaining > 0) {
                const consumed = Math.min(available, state.regenerationDelayRemaining);
                state.regenerationDelayRemaining = Math.max(0, state.regenerationDelayRemaining - consumed);
                available -= consumed;
            }
            if (available <= 0)
                return;
            const previous = state.current;
            state.current = Math.min(state.capacity, state.current + regeneration.ratePerUnit * available);
            if (previous < state.capacity && state.current === state.capacity) {
                emitFull(previous, state.current - previous);
            }
        };
        for (const enemy of this.enemies) {
            const state = this.enemyShields[enemy.id];
            const definition = this.combatShieldDefinitions.enemies[enemy.typeId];
            if (!state || !definition)
                continue;
            regenerate(state, definition, (previous, amount) => {
                this.lastEvents.push({
                    type: "enemyShieldChanged",
                    enemyId: enemy.id,
                    enemyTypeId: enemy.typeId,
                    previous,
                    current: state.current,
                    capacity: state.capacity,
                    cause: "regeneration",
                    amount
                });
            });
        }
        for (const tower of this.towers) {
            const state = this.towerShields[tower.id];
            const definition = this.combatShieldDefinitions.towers[tower.typeId];
            if (!state || !definition)
                continue;
            regenerate(state, definition, (previous, amount) => {
                this.lastEvents.push({
                    type: "towerShieldChanged",
                    towerId: tower.id,
                    towerTypeId: tower.typeId,
                    previous,
                    current: state.current,
                    capacity: state.capacity,
                    cause: "regeneration",
                    amount
                });
            });
        }
    }
    advanceNativeTerraformingExpiry(delta) {
        if (!this.activeTerraformingMechanics || this.pendingTerraformExpiryGroups.length === 0)
            return;
        const advanced = advanceTerraformExpiryGroups(this.pendingTerraformExpiryGroups, delta);
        const due = advanced
            .filter((group) => group.remaining === 0)
            .sort((left, right) => left.sequence - right.sequence);
        if (due.length === 0) {
            this.pendingTerraformExpiryGroups = [...advanced];
            this.syncTemporaryWaterTiles();
            return;
        }
        const operations = [];
        let order = 0;
        for (const group of due) {
            for (const target of [...group.targets].sort((left, right) => left.order - right.order)) {
                const coord = { q: target.q, r: target.r };
                if (target.layer === "terrain") {
                    operations.push({
                        kind: "restore_terrain",
                        coord,
                        order: order++,
                        previousTerrainOverride: target.previousOverride
                            ? { q: target.q, r: target.r, ...target.previousOverride }
                            : null
                    });
                }
                else {
                    operations.push({
                        kind: "restore_elevation",
                        coord,
                        order: order++,
                        previousElevationOverride: target.previousElevationOverride === null
                            ? null
                            : { q: target.q, r: target.r, elevation: target.previousElevationOverride }
                    });
                }
            }
        }
        const terrainOperations = operations.filter((operation) => operation.kind === "restore_terrain");
        const elevationOperations = operations.filter((operation) => operation.kind === "restore_elevation");
        try {
            const terrainCandidate = terrainOperations.length > 0
                ? this.planPersistentTerrainCandidate(terrainOperations)
                : undefined;
            const elevationCandidate = elevationOperations.length > 0
                ? this.planPersistentElevationCandidate(elevationOperations)
                : undefined;
            const navigation = terrainCandidate && this.activeNavigationProfile
                ? this.planDynamicPersistentTerrainNavigation(terrainCandidate)
                : undefined;
            this.publishPersistentTerraformCandidate(terrainCandidate, elevationCandidate, navigation);
            const dueSequences = new Set(due.map((group) => group.sequence));
            this.pendingTerraformExpiryGroups = advanced.filter((group) => !dueSequences.has(group.sequence));
            this.syncTemporaryWaterTiles();
        }
        catch (error) {
            if (!(error instanceof TowerScriptTerraformingError))
                throw error;
            // Expiry safety failures are retryable state, not script failures. Retain every due group
            // at zero and retry on tick(0) without emitting diagnostics or partial events.
            this.pendingTerraformExpiryGroups = [...advanced];
            this.syncTemporaryWaterTiles();
        }
    }
    updateAbilities(delta) {
        for (const ability of this.mission.abilities ?? []) {
            const remaining = this.abilityCooldowns[ability.id] ?? 0;
            this.abilityCooldowns[ability.id] = Math.max(0, remaining - delta);
        }
        for (const [key, override] of this.runtimeTerrainOverrides) {
            if (override.expiresIn === undefined)
                continue;
            override.expiresIn = Math.max(0, override.expiresIn - delta);
            if (override.expiresIn <= 0)
                this.restoreTerrainOverrideByKey(key);
        }
        this.syncTemporaryWaterTiles();
    }
    updateEnemyStatuses(delta) {
        for (const enemy of this.enemies) {
            const statuses = enemy.statuses;
            if (!statuses) {
                continue;
            }
            if (statuses.slow) {
                statuses.slow.remaining = Math.max(0, statuses.slow.remaining - delta);
                if (statuses.slow.remaining <= 0)
                    delete statuses.slow;
            }
            if (statuses.stun) {
                statuses.stun.remaining = Math.max(0, statuses.stun.remaining - delta);
                if (statuses.stun.remaining <= 0)
                    delete statuses.stun;
            }
            if (statuses.poison) {
                // Damage-over-time; death + reward is handled by the later removeDeadEnemies() pass.
                if (enemy.hp > 0) {
                    this.applyResolvedEnemyDamage(enemy, statuses.poison.dps * delta, { kind: "status", statusId: "poison" }, { tags: ["over_time"] });
                }
                statuses.poison.remaining = Math.max(0, statuses.poison.remaining - delta);
                if (statuses.poison.remaining <= 0)
                    delete statuses.poison;
            }
        }
    }
    buildAbilitySnapshot() {
        const abilities = {};
        for (const ability of this.mission.abilities ?? []) {
            const cooldownRemaining = Math.max(0, this.abilityCooldowns[ability.id] ?? 0);
            abilities[ability.id] = {
                id: ability.id,
                label: ability.label,
                cooldown: ability.cooldown,
                cooldownRemaining,
                duration: ability.duration,
                radius: ability.radius,
                ready: cooldownRemaining <= 0 && this.outcome === "playing"
            };
        }
        return abilities;
    }
    buildSunlightTilesSnapshot() {
        const sunlight = this.mission.sunlight;
        if (!sunlight) {
            return [];
        }
        const tiles = [];
        for (const pathOrder of sunlight.pathOrders ?? []) {
            const coord = this.map.pathCenterline[pathOrder];
            if (coord) {
                tiles.push({ ...coord, pathOrder, routeId: this.defaultRouteId() });
            }
        }
        for (const tile of sunlight.pathTiles ?? []) {
            const route = this.map.pathRouteById(tile.routeId);
            const coord = route?.pathCenterline[tile.pathOrder];
            if (coord && route) {
                tiles.push({ ...coord, pathOrder: tile.pathOrder, routeId: route.id });
            }
        }
        return tiles.sort((a, b) => {
            const route = (a.routeId ?? "").localeCompare(b.routeId ?? "");
            return route || a.pathOrder - b.pathOrder;
        });
    }
    moveEnemies(delta) {
        if (this.activeNavigationProfile) {
            this.moveDynamicEnemies(delta);
            return;
        }
        for (const enemy of this.enemies) {
            // An enemy killed between ticks (by an ability) or earlier this tick is pending removal by
            // removeDeadEnemies() — it must not keep advancing, or it can reach the core and "leak"
            // (deal core damage + forfeit its kill reward) despite already being dead.
            if (enemy.hp <= 0) {
                continue;
            }
            const type = this.enemyTypes[enemy.typeId];
            if (!type) {
                continue;
            }
            const trackEnd = this.enemyTrack(enemy).length - 1;
            const desiredOffset = this.enemyTargetClass(enemy) === "ground" ? this.enemyAvoidanceOffset(enemy) : 0;
            enemy.pathOffset += (desiredOffset - enemy.pathOffset) * Math.min(1, delta * 6);
            const avoidanceSpeedFactor = Math.abs(desiredOffset) > 0.05 ? 0.82 : 1;
            const terrainSpeedFactor = this.enemyTerrainSpeedFactor(enemy);
            const statusSpeedFactor = this.enemyStatusSpeedFactor(enemy);
            const previousPathOrder = Math.floor(enemy.pathProgress);
            enemy.pathProgress += type.speed * (this.difficulty.enemySpeedMultiplier ?? 1) * avoidanceSpeedFactor * terrainSpeedFactor * statusSpeedFactor * delta;
            const track = this.enemyTrack(enemy);
            const enteredThrough = Math.min(Math.floor(enemy.pathProgress), track.length - 1);
            for (let pathOrder = previousPathOrder + 1; pathOrder <= enteredThrough; pathOrder += 1) {
                const coord = track[pathOrder];
                const tile = coord ? this.map.getTile(coord) : undefined;
                if (!coord || !tile)
                    continue;
                this.lastEvents.push({
                    type: "enemyEnteredTile",
                    enemyId: enemy.id,
                    enemyTypeId: enemy.typeId,
                    coord: { ...coord },
                    terrain: tile.terrain,
                    terrainMetadata: this.terrainMetadata(tile.terrain),
                    ...(enemy.routeId === undefined ? {} : { routeId: enemy.routeId }),
                    pathOrder
                });
            }
            if (enemy.pathProgress >= trackEnd) {
                enemy.hp = 0;
                const coreDamage = type.coreDamage * (this.difficulty.coreDamageMultiplier ?? 1);
                this.applyResolvedCoreDamage(coreDamage, { kind: "leak", enemyId: enemy.id, enemyTypeId: enemy.typeId });
                this.lastEvents.push({
                    type: "enemyLeaked",
                    enemyId: enemy.id,
                    enemyTypeId: enemy.typeId,
                    damage: coreDamage
                });
                this.leakCount += 1;
                if (this.coreHp <= 0 && this.outcome === "playing") {
                    this.outcome = "defeat";
                    this.lastEvents.push({ type: "defeat" });
                }
            }
        }
    }
    moveDynamicEnemies(delta) {
        this.stabilizeDynamicEnemyNavigation();
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0 || !enemy.navigation || !enemy.routeId)
                continue;
            const type = this.enemyTypes[enemy.typeId];
            if (!type)
                continue;
            const field = this.navigationField(enemy.navigation.movementProfileId, enemy.routeId);
            const lookup = this.navigationFieldLookupCache?.get(field);
            if (!lookup)
                continue;
            let movementBudget = Math.max(0, type.speed
                * (this.difficulty.enemySpeedMultiplier ?? 1)
                * this.enemyStatusSpeedFactor(enemy)
                * delta
                * 1_000);
            let entered = 0;
            while (entered < NAVIGATION_LIMITS.activeMapCells) {
                const navigation = enemy.navigation;
                const cell = lookup.get(navigation.currentCoord);
                if (!cell) {
                    delete navigation.nextCoord;
                    navigation.edgeProgress = 0;
                    enemy.pathProgress = navigation.stepsEntered;
                    break;
                }
                if (!cell.nextCoord) {
                    delete navigation.nextCoord;
                    navigation.edgeProgress = 0;
                    enemy.pathProgress = navigation.stepsEntered;
                    if (cell.distance === 0)
                        this.leakDynamicEnemy(enemy, type);
                    break;
                }
                navigation.nextCoord = { q: cell.nextCoord.q, r: cell.nextCoord.r };
                const enteredCost = lookup.enteredCost(cell);
                if (enteredCost === undefined || movementBudget <= 0) {
                    enemy.pathProgress = navigation.stepsEntered + navigation.edgeProgress;
                    break;
                }
                const remainingCost = (1 - navigation.edgeProgress) * enteredCost;
                if (movementBudget + 1e-9 < remainingCost) {
                    navigation.edgeProgress = Math.min(0.999999999999, navigation.edgeProgress + movementBudget / enteredCost);
                    enemy.pathProgress = navigation.stepsEntered + navigation.edgeProgress;
                    break;
                }
                movementBudget = Math.max(0, movementBudget - remainingCost);
                navigation.currentCoord = { q: cell.nextCoord.q, r: cell.nextCoord.r };
                navigation.edgeProgress = 0;
                navigation.stepsEntered += 1;
                enemy.pathProgress = navigation.stepsEntered;
                entered += 1;
                const tile = this.map.getTile(navigation.currentCoord);
                if (tile) {
                    this.lastEvents.push({
                        type: "enemyEnteredTile",
                        enemyId: enemy.id,
                        enemyTypeId: enemy.typeId,
                        coord: { ...navigation.currentCoord },
                        terrain: tile.terrain,
                        terrainMetadata: this.terrainMetadata(tile.terrain),
                        routeId: enemy.routeId,
                        pathOrder: navigation.stepsEntered
                    });
                }
            }
        }
    }
    leakDynamicEnemy(enemy, type) {
        if (enemy.hp <= 0)
            return;
        enemy.hp = 0;
        const coreDamage = type.coreDamage * (this.difficulty.coreDamageMultiplier ?? 1);
        this.applyResolvedCoreDamage(coreDamage, { kind: "leak", enemyId: enemy.id, enemyTypeId: enemy.typeId });
        this.lastEvents.push({
            type: "enemyLeaked",
            enemyId: enemy.id,
            enemyTypeId: enemy.typeId,
            damage: coreDamage
        });
        this.leakCount += 1;
        if (this.coreHp <= 0 && this.outcome === "playing") {
            this.outcome = "defeat";
            this.lastEvents.push({ type: "defeat" });
        }
    }
    applyDotDamage(delta) {
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0 || enemy.dotRemaining <= 0) {
                continue;
            }
            if (this.isInsideAnyPulse(enemy)) {
                continue;
            }
            enemy.dotRemaining = Math.max(0, enemy.dotRemaining - delta);
            const sourceTowerTypeId = enemy.dotSourceTowerTypeId ?? this.firstPulseTowerTypeId();
            const damagePerUnit = enemy.dotDamagePerUnit ?? this.pulseDotDamagePerUnit(sourceTowerTypeId);
            const baseDamage = Math.max(0, damagePerUnit) * delta;
            this.applyResolvedTowerDamage(sourceTowerTypeId ?? "", enemy, baseDamage, { aoe: true, overTime: true });
            if (enemy.dotRemaining <= 0) {
                delete enemy.dotDamagePerUnit;
                delete enemy.dotSourceTowerTypeId;
            }
        }
    }
    isPulseTower(tower) {
        return this.towerTypes[tower.typeId]?.attack.kind === "pulse";
    }
    firstPulseTowerTypeId() {
        for (const [typeId, type] of Object.entries(this.towerTypes)) {
            if (type.attack.kind === "pulse") {
                return typeId;
            }
        }
        return undefined;
    }
    pulseDotDamagePerUnit(towerTypeId) {
        if (!towerTypeId) {
            return 0;
        }
        const attack = this.towerTypes[towerTypeId]?.attack;
        return attack?.kind === "pulse" ? attack.dotDamagePerUnit : 0;
    }
    applySunlightRegeneration(delta) {
        const regenPerUnit = this.mission.sunlight?.regenPerUnit ?? 0;
        if (regenPerUnit <= 0 || this.sunlightPathKeys.size === 0) {
            return;
        }
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0 || enemy.hp >= enemy.maxHp || !this.isEnemyInSunlight(enemy)) {
                continue;
            }
            enemy.hp = Math.min(enemy.maxHp, enemy.hp + regenPerUnit * delta);
        }
    }
    applyHealAuras(delta) {
        const healByTargetId = new Map();
        for (const healer of this.enemies) {
            if (healer.hp <= 0) {
                continue;
            }
            const aura = this.enemyTypes[healer.typeId]?.healAura;
            if (!aura || aura.radius <= 0 || aura.healPerUnit <= 0) {
                continue;
            }
            const healerCoord = this.enemyCoord(healer);
            for (const target of this.enemies) {
                if (target.hp <= 0 || target.hp >= target.maxHp) {
                    continue;
                }
                if (!aura.includeSelf && target.id === healer.id) {
                    continue;
                }
                if (this.map.distance(healerCoord, this.enemyCoord(target)) > aura.radius) {
                    continue;
                }
                const previous = healByTargetId.get(target.id);
                const amount = aura.healPerUnit * delta;
                if (previous && aura.stacks !== false) {
                    previous.amount += amount;
                }
                else if (!previous) {
                    healByTargetId.set(target.id, { amount, healerId: healer.id });
                }
            }
        }
        for (const [targetId, heal] of healByTargetId) {
            const target = this.enemies.find((enemy) => enemy.id === targetId);
            if (!target || target.hp <= 0 || target.hp >= target.maxHp) {
                continue;
            }
            const previousHp = target.hp;
            target.hp = Math.min(target.maxHp, target.hp + heal.amount);
            const amount = target.hp - previousHp;
            if (amount > 0.0001) {
                this.lastEvents.push({
                    type: "enemyHealed",
                    healerEnemyId: heal.healerId,
                    targetEnemyId: target.id,
                    targetEnemyTypeId: target.typeId,
                    amount
                });
            }
        }
    }
    /** Boss pattern: enemies with `towerDisrupt` periodically silence towers within radius. */
    updateTowerDisruptions(delta) {
        if (this.towers.length === 0) {
            return;
        }
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0) {
                continue;
            }
            const disrupt = this.enemyTypes[enemy.typeId]?.towerDisrupt;
            if (!disrupt || disrupt.interval <= 0 || disrupt.duration <= 0) {
                continue;
            }
            enemy.disruptCooldown = (enemy.disruptCooldown ?? disrupt.interval) - delta;
            if (enemy.disruptCooldown > 0) {
                continue;
            }
            enemy.disruptCooldown = disrupt.interval;
            const center = this.enemyCoord(enemy);
            const disabledTowerIds = [];
            for (const tower of this.towers) {
                if (this.map.distance(center, tower.coord) <= disrupt.radius) {
                    tower.disabledFor = Math.max(tower.disabledFor ?? 0, disrupt.duration);
                    disabledTowerIds.push(tower.id);
                }
            }
            if (disabledTowerIds.length > 0) {
                this.lastEvents.push({ type: "towerDisrupted", enemyId: enemy.id, enemyTypeId: enemy.typeId, towerIds: disabledTowerIds, duration: disrupt.duration });
            }
        }
    }
    /** Boss pattern: enemies with `towerAttack` damage the nearest durable tower or opt-in durable hero. */
    updateEnemyTowerAttacks(delta) {
        const durableHero = (this.activeHeroesMechanics?.schemaVersion === 3
            || this.activeHeroesMechanics?.schemaVersion === 4
            || this.activeHeroesMechanics?.schemaVersion === 5
            || this.activeHeroesMechanics?.schemaVersion === 6)
            && this.heroStateV2
            && (this.heroStateV2.hp ?? 0) > 0
            ? this.heroStateV2
            : undefined;
        if (this.towers.length === 0 && !durableHero) {
            return;
        }
        const destroyedIds = [];
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0) {
                continue;
            }
            const attack = this.enemyTypes[enemy.typeId]?.towerAttack;
            if (!attack || attack.interval <= 0 || attack.damage <= 0) {
                continue;
            }
            enemy.towerAttackCooldown = (enemy.towerAttackCooldown ?? attack.interval) - delta;
            if (enemy.towerAttackCooldown > 0) {
                continue;
            }
            enemy.towerAttackCooldown = attack.interval;
            const center = this.enemyCoord(enemy);
            let target = null;
            let best = Infinity;
            for (const tower of this.towers) {
                if (typeof tower.hp !== "number" || tower.hp <= 0)
                    continue; // indestructible or already downed this tick
                const dist = this.map.distance(center, tower.coord);
                const stableV3Tie = (this.activeHeroesMechanics?.schemaVersion === 3
                    || this.activeHeroesMechanics?.schemaVersion === 4
                    || this.activeHeroesMechanics?.schemaVersion === 5
                    || this.activeHeroesMechanics?.schemaVersion === 6)
                    && dist === best
                    && target !== null
                    && tower.id < target.id;
                if (dist <= attack.range && (dist < best || stableV3Tie)) {
                    best = dist;
                    target = tower;
                }
            }
            const heroDistance = durableHero ? this.map.distance(center, durableHero.currentCoord) : Infinity;
            if (durableHero && (durableHero.hp ?? 0) > 0 && heroDistance <= attack.range && heroDistance < best) {
                const previousHp = durableHero.hp ?? 0;
                const application = this.applyResolvedHeroDamage(durableHero, attack.damage, { kind: "enemy", enemyId: enemy.id, enemyTypeId: enemy.typeId });
                this.lastEvents.push({
                    type: "heroAttacked",
                    enemyId: enemy.id,
                    enemyTypeId: enemy.typeId,
                    heroId: durableHero.definitionId,
                    damage: application.resolution.finalAmount,
                    shieldAbsorbed: application.shieldAbsorbed,
                    hpDamage: application.hpDamage
                });
                if (previousHp > 0 && (durableHero.hp ?? 0) <= 0) {
                    durableHero.targetCoord = null;
                    durableHero.nextCoord = null;
                    durableHero.edgeProgress = 0;
                    this.heroMovementField = undefined;
                    this.heroMovementDirty = false;
                    this.lastEvents.push({
                        type: "heroDefeated",
                        heroId: durableHero.definitionId,
                        heroDefinitionId: durableHero.definitionId,
                        enemyId: enemy.id
                    });
                }
            }
            else if (target) {
                const application = this.applyResolvedTowerEntityDamage(target, attack.damage, { kind: "enemy", enemyId: enemy.id, enemyTypeId: enemy.typeId });
                this.lastEvents.push({
                    type: "towerAttacked",
                    enemyId: enemy.id,
                    enemyTypeId: enemy.typeId,
                    towerId: target.id,
                    damage: application.resolution.finalAmount
                });
                if ((target.hp ?? 0) <= 0) {
                    destroyedIds.push(target.id);
                    this.autoUnsocketTowerArtifacts(target, "tower_destroyed");
                    this.lastEvents.push({ type: "towerDestroyed", towerId: target.id, towerTypeId: target.typeId, enemyId: enemy.id });
                }
            }
        }
        for (const id of destroyedIds)
            this.destroyTower(id);
    }
    artifactManagementAvailability() {
        if (!this.activeRogueliteMechanics?.artifacts) {
            return this.fail("Artifacts are not available.", "reason.artifactsUnavailable");
        }
        if (this.outcome !== "playing")
            return this.fail("Mission already ended.", "reason.missionEnded");
        const campaignPreparation = Boolean(this.campaignBattle
            && this.waveState === "ready"
            && this.startedWaveCount === 0
            && this.enemies.length === 0
            && this.spawnQueue.length === 0);
        const interwave = this.waveState === "between"
            && this.startedWaveCount > 0
            && this.startedWaveCount < this.mission.waves.length
            && this.enemies.length === 0
            && this.spawnQueue.length === 0;
        if (!campaignPreparation && !interwave) {
            return this.fail("Artifacts can only be managed between waves.", "reason.artifactBetweenWavesOnly");
        }
        return { ok: true };
    }
    replaceArtifactSocket(instanceId, socket) {
        const index = this.artifactInventory.findIndex((item) => item.instanceId === instanceId);
        if (index < 0)
            return;
        this.artifactInventory[index] = { ...this.artifactInventory[index], socket };
    }
    autoUnsocketTowerArtifacts(tower, cause) {
        const assignments = this.artifactInventory
            .filter((entry) => entry.socket?.towerId === tower.id)
            .sort((left, right) => (compareBinary(left.socket.slotId, right.socket.slotId)
            || compareBinary(left.instanceId, right.instanceId)));
        for (const entry of assignments) {
            const slotId = entry.socket.slotId;
            this.replaceArtifactSocket(entry.instanceId, null);
            this.artifactCheckpointForm = this.campaignBattle ? 3 : 2;
            this.lastEvents.push({
                type: "artifactUnsocketed",
                artifactInstanceId: entry.instanceId,
                artifactId: entry.artifactId,
                towerId: tower.id,
                towerTypeId: tower.typeId,
                slotId,
                cause
            });
        }
    }
    destroyTower(towerId) {
        const index = this.towers.findIndex((tower) => tower.id === towerId);
        if (index < 0)
            return;
        this.map.clearOccupied(towerId); // free the footprint tiles for rebuilding
        this.towers.splice(index, 1);
        this.rebuildRogueliteSynergies();
        delete this.towerShields[towerId];
        this.syncNavigationOccupancy();
    }
    rebuildRogueliteSynergies() {
        if (!this.activeRogueliteMechanics) {
            this.rogueliteSnapshot = undefined;
            this.rogueliteDamageModifiers = Object.freeze([]);
            this.artifactDamageModifiersByTowerId = new Map();
            return;
        }
        const active = this.activeRogueliteMechanics;
        const derived = deriveRogueliteSynergyStateV1(active, this.towers);
        let artifactSnapshot;
        if (active.artifacts) {
            const artifacts = active.artifacts;
            const towerById = new Map(this.towers.map((tower) => [tower.id, tower]));
            const artifactBySlot = new Map();
            const damageModifiersByTowerId = new Map();
            for (const entry of this.artifactInventory) {
                if (!entry.socket)
                    continue;
                artifactBySlot.set(`${entry.socket.towerId.length}:${entry.socket.towerId}|${entry.socket.slotId.length}:${entry.socket.slotId}`, entry.instanceId);
                const definition = artifacts.definitions[entry.artifactId];
                if (!definition)
                    throw new Error(`Artifact inventory references unknown definition "${entry.artifactId}".`);
                const modifiers = damageModifiersByTowerId.get(entry.socket.towerId) ?? [];
                definition.modifiers.forEach((modifier, modifierIndex) => {
                    modifiers.push(Object.freeze({
                        id: `roguelite:artifact:${entry.instanceId.length}:${entry.instanceId}:modifier:${String(modifierIndex).padStart(2, "0")}`,
                        target: modifier.target,
                        stage: "run",
                        operation: modifier.operation,
                        value: modifier.value
                    }));
                });
                damageModifiersByTowerId.set(entry.socket.towerId, modifiers);
            }
            this.artifactDamageModifiersByTowerId = new Map([...damageModifiersByTowerId].map(([towerId, modifiers]) => [towerId, Object.freeze(modifiers)]));
            artifactSnapshot = Object.freeze({
                inventory: Object.freeze(this.artifactInventory.map((entry) => {
                    const definition = artifacts.definitions[entry.artifactId];
                    if (!definition)
                        throw new Error(`Artifact inventory references unknown definition "${entry.artifactId}".`);
                    const tower = entry.socket === null ? undefined : towerById.get(entry.socket.towerId);
                    if (entry.socket !== null && !tower) {
                        throw new Error(`Artifact socket references missing tower "${entry.socket.towerId}".`);
                    }
                    return Object.freeze({
                        instanceId: entry.instanceId,
                        artifactId: entry.artifactId,
                        label: definition.label,
                        slotType: definition.slotType,
                        socket: entry.socket === null ? null : Object.freeze({
                            towerId: entry.socket.towerId,
                            towerTypeId: tower.typeId,
                            slotId: entry.socket.slotId
                        })
                    });
                })),
                towerSlots: Object.freeze([...this.towers]
                    .sort((left, right) => compareBinary(left.id, right.id))
                    .flatMap((tower) => {
                    const slots = artifacts.towerSlots[tower.typeId];
                    if (!slots?.length)
                        return [];
                    return [Object.freeze({
                            towerId: tower.id,
                            towerTypeId: tower.typeId,
                            slots: Object.freeze(slots.map((slot) => Object.freeze({
                                slotId: slot.slotId,
                                slotType: slot.slotType,
                                artifactInstanceId: artifactBySlot.get(`${tower.id.length}:${tower.id}|${slot.slotId.length}:${slot.slotId}`) ?? null
                            })))
                        })];
                })),
                management: this.artifactManagementSnapshot()
            });
        }
        else {
            this.artifactDamageModifiersByTowerId = new Map();
        }
        if (active.draft) {
            const selectionCounts = new Map();
            for (const selection of [...this.campaignDeck, ...this.draftSelections]) {
                const definition = active.draft.definitions[selection.cardId];
                if (!definition)
                    throw new Error(`Draft selection references unknown card "${selection.cardId}".`);
                const previous = selectionCounts.get(selection.cardId);
                selectionCounts.set(selection.cardId, {
                    label: definition.label,
                    count: (previous?.count ?? 0) + 1
                });
            }
            const pendingOffer = this.pendingDraftOffer === null ? null : Object.freeze({
                offerId: this.pendingDraftOffer.offerId,
                afterWaveIndex: this.pendingDraftOffer.afterWaveIndex,
                poolId: this.pendingDraftOffer.poolId,
                options: Object.freeze(this.pendingDraftOffer.cardIds.map((cardId) => {
                    const definition = active.draft.definitions[cardId];
                    if (!definition)
                        throw new Error(`Draft offer references unknown card "${cardId}".`);
                    return Object.freeze({ cardId, label: definition.label });
                }))
            });
            this.rogueliteSnapshot = Object.freeze({
                schemaVersion: 4,
                synergies: derived.snapshot.synergies,
                draft: Object.freeze({
                    pendingOffer,
                    selections: Object.freeze([...selectionCounts].map(([cardId, value]) => Object.freeze({
                        cardId,
                        label: value.label,
                        count: value.count
                    })))
                }),
                ...(artifactSnapshot === undefined ? {} : { artifacts: artifactSnapshot })
            });
        }
        else if (artifactSnapshot) {
            this.rogueliteSnapshot = Object.freeze({
                schemaVersion: 3,
                synergies: derived.snapshot.synergies,
                artifacts: artifactSnapshot
            });
        }
        else {
            this.rogueliteSnapshot = derived.snapshot;
        }
        this.rogueliteDamageModifiers = derived.damageModifiers;
    }
    currentRogueliteSnapshot() {
        const snapshot = this.rogueliteSnapshot;
        if (snapshot?.schemaVersion === 3) {
            return Object.freeze({
                schemaVersion: 3,
                synergies: snapshot.synergies,
                artifacts: Object.freeze({
                    inventory: snapshot.artifacts.inventory,
                    towerSlots: snapshot.artifacts.towerSlots,
                    management: this.artifactManagementSnapshot()
                })
            });
        }
        if (snapshot?.schemaVersion === 4 && snapshot.artifacts) {
            return Object.freeze({
                schemaVersion: 4,
                synergies: snapshot.synergies,
                draft: snapshot.draft,
                artifacts: Object.freeze({
                    inventory: snapshot.artifacts.inventory,
                    towerSlots: snapshot.artifacts.towerSlots,
                    management: this.artifactManagementSnapshot()
                })
            });
        }
        return snapshot;
    }
    artifactManagementSnapshot() {
        const result = this.artifactManagementAvailability();
        if (result.ok)
            return Object.freeze({ allowed: true });
        if (!result.reasonKey)
            throw new Error("Artifact management failure is missing a reason key.");
        return Object.freeze({ allowed: false, reasonKey: result.reasonKey });
    }
    updateTowers(delta) {
        for (const tower of this.towers) {
            const type = this.towerTypes[tower.typeId];
            if (!type) {
                continue;
            }
            if (tower.disabledFor && tower.disabledFor > 0) {
                tower.disabledFor = Math.max(0, tower.disabledFor - delta); // silenced by an enemy disrupt pulse
                continue;
            }
            tower.cooldown -= delta;
            const fireRateMultiplier = this.towerFireRateMultiplier(tower);
            if (type.attack.kind === "single") {
                this.updateSingleTower(tower, type.attack.fireRate * fireRateMultiplier, type.attack.damagePerStack, type.attack.chain);
            }
            else if (type.attack.kind === "pulse") {
                this.updatePulseTower(tower, this.towerPulseRate(tower) * fireRateMultiplier, type.attack.pulseDamage, type.attack.dotDuration, type.attack.dotDamagePerUnit);
            }
            else if (type.attack.kind === "sniper") {
                this.updateSniperTower(tower, type.attack.interval / fireRateMultiplier, type.attack.damage);
            }
            else if (type.attack.kind === "antiair") {
                this.updateAntiAirTower(tower, type.attack.fireRate * fireRateMultiplier, type.attack.damage);
            }
            else if (type.attack.kind === "splash") {
                this.updateSplashTower(tower, fireRateMultiplier);
            }
            else if (type.attack.kind === "pipeline") {
                this.updatePipelineTower(tower, type.attack, fireRateMultiplier);
            }
        }
    }
    updateSingleTower(tower, fireRate, damagePerStack, chain) {
        const interval = 1 / fireRate;
        let shots = 0;
        while (tower.cooldown <= 0 && shots < 4) {
            const target = this.findSingleTarget(tower);
            if (!target) {
                tower.cooldown = 0;
                return;
            }
            const damage = tower.stacks * damagePerStack;
            this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.id, damage });
            const applied = this.applyTowerDamage(tower, target, damage);
            if (chain && applied > 0) {
                this.propagateChain(tower, target, damage, chain);
            }
            tower.cooldown += interval;
            shots += 1;
        }
    }
    /**
     * Chain delivery: propagate a landed hit hop-by-hop to the nearest not-yet-hit ground enemy
     * within `jumpRadius` of the LAST-hit enemy (not the origin — a true chain, not a fixed-radius
     * splash), for up to `maxJumps` extra hits, each scaled by `damageFalloff^hop`. Deterministic:
     * ties broken by enemy id. Reuses applyTowerDamage so resistances/armor/statusOnHit apply to
     * every hop exactly as they would to a primary hit.
     */
    propagateChain(tower, originTarget, baseDamage, chain) {
        const alreadyHit = new Set([originTarget.id]);
        let current = originTarget;
        for (let hop = 1; hop <= chain.maxJumps; hop += 1) {
            const fromCoord = this.enemyCoord(current);
            let next;
            let bestDistance = Infinity;
            for (const enemy of this.enemies) {
                if (enemy.hp <= 0 || alreadyHit.has(enemy.id) || this.enemyTargetClass(enemy) !== "ground") {
                    continue;
                }
                const distance = this.map.distance(fromCoord, this.enemyCoord(enemy));
                if (distance > chain.jumpRadius) {
                    continue;
                }
                if (!next || distance < bestDistance || (distance === bestDistance && enemy.id < next.id)) {
                    next = enemy;
                    bestDistance = distance;
                }
            }
            if (!next) {
                return;
            }
            alreadyHit.add(next.id);
            const hopDamage = baseDamage * Math.pow(chain.damageFalloff, hop);
            this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: next.id, damage: hopDamage });
            this.applyTowerDamage(tower, next, hopDamage);
            current = next;
        }
    }
    updatePulseTower(tower, pulseRate, pulseDamage, dotDuration, dotDamagePerUnit) {
        const interval = 1 / pulseRate;
        let pulses = 0;
        while (tower.cooldown <= 0 && pulses < 3) {
            let targets = this.enemies.filter((enemy) => enemy.hp > 0 && this.enemyTargetClass(enemy) === "ground" && this.enemyInTowerAcquisitionRange(tower, enemy));
            if (this.activeLineOfSightProfile) {
                targets = targets
                    .sort((left, right) => this.compareTargets(tower, left, right))
                    .slice(0, LINE_OF_SIGHT_LIMITS.candidatesPerAcquisition)
                    .filter((enemy) => this.towerHasLineOfSight(tower, enemy));
            }
            if (targets.length === 0) {
                tower.cooldown = 0;
                return;
            }
            for (const target of targets) {
                const damage = this.applyTowerDamage(tower, target, pulseDamage, { aoe: true });
                if (damage > 0) {
                    target.dotRemaining = dotDuration;
                    target.dotDamagePerUnit = dotDamagePerUnit;
                    target.dotSourceTowerTypeId = tower.typeId;
                }
            }
            this.lastEvents.push({ type: "areaPulse", towerId: tower.id, enemyIds: targets.map((target) => target.id) });
            tower.cooldown += interval;
            pulses += 1;
        }
    }
    updateSniperTower(tower, interval, damage) {
        let shots = 0;
        while (tower.cooldown <= 0 && shots < 2) {
            const target = this.findSniperTarget(tower);
            if (!target) {
                tower.cooldown = 0;
                return;
            }
            this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.id, damage });
            this.applyTowerDamage(tower, target, damage);
            tower.cooldown += interval;
            shots += 1;
        }
    }
    updateAntiAirTower(tower, fireRate, damage) {
        const interval = 1 / fireRate;
        let volleys = 0;
        while (tower.cooldown <= 0 && volleys < 3) {
            const targets = this.findAntiAirTargets(tower);
            if (targets.length === 0) {
                tower.cooldown = 0;
                return;
            }
            for (const target of targets) {
                this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.id, damage });
                this.applyTowerDamage(tower, target, damage);
            }
            tower.cooldown += interval;
            volleys += 1;
        }
    }
    updateSplashTower(tower, fireRateMultiplier = 1) {
        const type = this.towerTypes[tower.typeId];
        if (!type || type.attack.kind !== "splash") {
            return;
        }
        const attack = type.attack;
        const interval = this.slipperyJackInterval(tower) / fireRateMultiplier;
        let shots = 0;
        while (tower.cooldown <= 0 && shots < 3) {
            const target = this.findSplashTarget(tower);
            if (!target) {
                tower.cooldown = 0;
                return;
            }
            const targetCoord = this.enemyCoord(target);
            const targets = this.enemies.filter((enemy) => enemy.hp > 0 &&
                (attack.affectsClasses ?? ["ground"]).includes(this.enemyTargetClass(enemy)) &&
                this.map.distance(this.enemyCoord(enemy), targetCoord) <= attack.splashRadius);
            this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.id, damage: attack.damage });
            for (const enemy of targets) {
                this.applyTowerDamage(tower, enemy, enemy.id === target.id ? attack.damage : attack.splashDamage);
                this.applySlow(enemy, attack.slowFactor, attack.slowDuration, attack.affectsClasses);
            }
            tower.cooldown += interval;
            shots += 1;
        }
    }
    updatePipelineTower(tower, attack, fireRateMultiplier) {
        const levelIndex = Math.max(0, tower.level - 1);
        const baseInterval = attack.intervalByLevel?.[Math.min(levelIndex, attack.intervalByLevel.length - 1)] ?? attack.interval;
        const interval = baseInterval / Math.max(0.05, fireRateMultiplier);
        const displacementRanks = this.activePhysicsMechanics
            ? this.displacementEffectRanks(attack.effects)
            : undefined;
        let activations = 0;
        while (tower.cooldown <= 0 && activations < 4) {
            const targets = this.pipelineTargets(tower, attack);
            if (targets.length === 0) {
                tower.cooldown = 0;
                return;
            }
            const displacementBudget = this.activePhysicsMechanics
                ? { used: 0, limit: PHYSICS_LIMITS.stepAttemptsPerActivation }
                : undefined;
            for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
                const target = targets[targetIndex];
                const expectedDamage = attack.effects.reduce((sum, effect) => {
                    const inspected = inspectOwnDataEffect(effect);
                    if (!inspected.ok || inspected.kind !== "damage")
                        return sum;
                    const record = inspected.record;
                    if (typeof record.amount !== "number" || !Number.isFinite(record.amount))
                        return sum;
                    const amountByLevel = Array.isArray(record.amountByLevel) ? record.amountByLevel : undefined;
                    const amount = amountByLevel?.[Math.min(levelIndex, amountByLevel.length - 1)] ?? record.amount;
                    if (typeof amount !== "number" || !Number.isFinite(amount))
                        return sum;
                    return sum + amount * target.damageMultiplier;
                }, 0);
                this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.enemy.id, damage: expectedDamage });
                for (let effectIndex = 0; effectIndex < attack.effects.length; effectIndex += 1) {
                    if (target.enemy.hp <= 0)
                        break;
                    const displacementRank = displacementRanks?.get(effectIndex);
                    this.applyPipelineEffect(tower, target.enemy, attack.effects[effectIndex], target.damageMultiplier, levelIndex, attack.delivery.kind === "area" || attack.delivery.kind === "aura", displacementRank !== undefined && (targetIndex < PHYSICS_LIMITS.displacementTargetsPerActivation
                        && displacementRank < PHYSICS_LIMITS.displacementEffectsPerSource), displacementBudget);
                }
            }
            tower.cooldown += interval;
            activations += 1;
        }
    }
    pipelineTargets(tower, attack) {
        const classes = attack.targeting?.classes?.length ? attack.targeting.classes : ["ground"];
        const sortedInRange = this.enemies
            .filter((enemy) => enemy.hp > 0 && classes.includes(this.enemyTargetClass(enemy)) && this.enemyInTowerAcquisitionRange(tower, enemy))
            .sort((left, right) => this.compareTargets(tower, left, right));
        const inRange = this.activeLineOfSightProfile
            ? sortedInRange
                .slice(0, LINE_OF_SIGHT_LIMITS.candidatesPerAcquisition)
                .filter((enemy) => this.towerHasLineOfSight(tower, enemy))
            : sortedInRange;
        if (attack.delivery.kind === "aura")
            return inRange.map((enemy) => ({ enemy, damageMultiplier: 1 }));
        const primaryLimit = attack.delivery.kind === "single" ? 1 : Math.max(1, attack.targeting?.maxTargets ?? 1);
        const primaries = inRange.slice(0, primaryLimit);
        if (attack.delivery.kind === "single" || attack.delivery.kind === "multi") {
            return primaries.map((enemy) => ({ enemy, damageMultiplier: 1 }));
        }
        const delivered = new Map();
        for (const primary of primaries) {
            delivered.set(primary.id, { enemy: primary, damageMultiplier: 1 });
            if (attack.delivery.kind === "area") {
                const multiplier = Math.max(0, attack.delivery.secondaryMultiplier ?? 1);
                const center = this.enemyCoord(primary);
                for (const enemy of this.enemies) {
                    if (enemy.hp <= 0 || !classes.includes(this.enemyTargetClass(enemy)) || this.map.distance(center, this.enemyCoord(enemy)) > attack.delivery.radius)
                        continue;
                    const nextMultiplier = enemy.id === primary.id ? 1 : multiplier;
                    const current = delivered.get(enemy.id);
                    if (!current || nextMultiplier > current.damageMultiplier)
                        delivered.set(enemy.id, { enemy, damageMultiplier: nextMultiplier });
                }
            }
            else if (attack.delivery.kind === "chain") {
                const delivery = attack.delivery;
                let current = primary;
                const visited = new Set([primary.id]);
                for (let hop = 1; hop <= delivery.maxJumps; hop += 1) {
                    const center = this.enemyCoord(current);
                    const next = this.enemies
                        .filter((enemy) => enemy.hp > 0 && !visited.has(enemy.id) && classes.includes(this.enemyTargetClass(enemy)) && this.map.distance(center, this.enemyCoord(enemy)) <= delivery.jumpRadius)
                        .sort((left, right) => this.map.distance(center, this.enemyCoord(left)) - this.map.distance(center, this.enemyCoord(right)) || left.id.localeCompare(right.id))[0];
                    if (!next)
                        break;
                    visited.add(next.id);
                    const damageMultiplier = Math.pow(delivery.damageFalloff ?? 1, hop);
                    const existing = delivered.get(next.id);
                    if (!existing || damageMultiplier > existing.damageMultiplier)
                        delivered.set(next.id, { enemy: next, damageMultiplier });
                    current = next;
                }
            }
        }
        return [...delivered.values()];
    }
    applyPipelineEffect(tower, enemy, effectValue, deliveryMultiplier, levelIndex, aoe, displacementAllowed, displacementBudget) {
        const inspected = inspectOwnDataEffect(effectValue);
        if (!inspected.ok)
            return;
        const effect = inspected.record;
        if (inspected.kind === "damage") {
            if (typeof effect.amount !== "number" || !Number.isFinite(effect.amount))
                return;
            const amountByLevel = Array.isArray(effect.amountByLevel) ? effect.amountByLevel : undefined;
            const amount = amountByLevel?.[Math.min(levelIndex, amountByLevel.length - 1)] ?? effect.amount;
            if (typeof amount !== "number" || !Number.isFinite(amount))
                return;
            this.applyTowerDamage(tower, enemy, amount * deliveryMultiplier, {
                aoe,
                damageType: typeof effect.damageType === "string" ? effect.damageType : undefined,
                armorPiercing: typeof effect.armorPiercing === "boolean" ? effect.armorPiercing : undefined,
                applyLegacyStatus: false
            });
        }
        else if (inspected.kind === "status") {
            if (!effect.status || typeof effect.status !== "object")
                return;
            this.applyStatusEffect(enemy, effect.status);
        }
        else if (inspected.kind === "resource") {
            if (!effect.resources || typeof effect.resources !== "object")
                return;
            const resources = this.normalizeCost(effect.resources);
            this.addResources(resources);
            this.lastEvents.push({ type: "towerResourcesGranted", towerId: tower.id, enemyId: enemy.id, resources });
        }
        else if (inspected.kind === "displacement" && displacementAllowed) {
            const displacement = this.reserveDisplacementEffect(effect, displacementBudget, true);
            if (!displacement)
                return;
            this.applyDisplacementEffect(enemy, displacement, {
                sourceKind: "tower",
                sourceId: tower.id,
                sourceCoord: tower.coord
            });
        }
    }
    findSingleTarget(tower) {
        return this.selectTargets(tower, "ground", 1)[0];
    }
    findSniperTarget(tower) {
        return this.selectTargets(tower, "ground", 1)[0];
    }
    findAntiAirTargets(tower) {
        const type = this.towerTypes[tower.typeId];
        const attack = type?.attack.kind === "antiair" ? type.attack : undefined;
        if (!attack) {
            return [];
        }
        const limit = attack.maxTargetsByLevel[Math.min(tower.level, attack.maxTargetsByLevel.length) - 1] ?? 1;
        return this.selectTargets(tower, "flying", limit);
    }
    findSplashTarget(tower) {
        return this.selectTargets(tower, "ground", 1)[0];
    }
    towerSupportsTargetMode(tower) {
        const kind = this.towerTypes[tower.typeId]?.attack.kind;
        return kind === "single" || kind === "sniper" || kind === "antiair" || kind === "splash" || kind === "pipeline";
    }
    selectTargets(tower, targetClass, limit) {
        const sorted = this.enemies
            .filter((enemy) => enemy.hp > 0 && this.enemyTargetClass(enemy) === targetClass && this.enemyInTowerAcquisitionRange(tower, enemy))
            .sort((left, right) => this.compareTargets(tower, left, right));
        if (!this.activeLineOfSightProfile)
            return sorted.slice(0, Math.max(0, limit));
        return sorted
            .slice(0, LINE_OF_SIGHT_LIMITS.candidatesPerAcquisition)
            .filter((enemy) => this.towerHasLineOfSight(tower, enemy))
            .slice(0, Math.max(0, limit));
    }
    towerHasLineOfSight(tower, enemy) {
        const profile = this.activeLineOfSightProfile;
        if (!profile)
            return true;
        return traceLineOfSight(this.map, this.content.terrainTypes, profile.terrainBlockerTags, tower.coord, this.enemyCoord(enemy)).row.visible;
    }
    compareTargets(tower, left, right) {
        if (this.activeNavigationProfile)
            return this.compareDynamicTargets(tower, left, right);
        const mode = tower.targetMode ?? "first";
        const leftProgress = this.enemyRouteProgressRatio(left);
        const rightProgress = this.enemyRouteProgressRatio(right);
        const leftDistance = this.map.distance(tower.coord, this.enemyCoord(left));
        const rightDistance = this.map.distance(tower.coord, this.enemyCoord(right));
        let result = 0;
        if (mode === "last")
            result = leftProgress - rightProgress;
        else if (mode === "closest")
            result = leftDistance - rightDistance;
        else if (mode === "furthest")
            result = rightDistance - leftDistance;
        else if (mode === "strongest" || mode === "largest_hp")
            result = right.hp - left.hp || rightProgress - leftProgress;
        else if (mode === "weakest")
            result = left.hp - right.hp || rightProgress - leftProgress;
        else if (mode === "fastest_ahead") {
            result = Number(this.hasPierceOnlyArmor(right)) - Number(this.hasPierceOnlyArmor(left)) || rightProgress - leftProgress;
        }
        else
            result = rightProgress - leftProgress;
        return result || left.id.localeCompare(right.id);
    }
    compareDynamicTargets(tower, left, right) {
        const mode = tower.targetMode ?? "first";
        const leftRemaining = this.dynamicEnemyRemainingCost(left);
        const rightRemaining = this.dynamicEnemyRemainingCost(right);
        const compareRemaining = leftRemaining === rightRemaining
            ? 0
            : leftRemaining < rightRemaining ? -1 : 1;
        const leftDistance = this.map.distance(tower.coord, this.enemyCoord(left));
        const rightDistance = this.map.distance(tower.coord, this.enemyCoord(right));
        let result = 0;
        if (mode === "last")
            result = -compareRemaining;
        else if (mode === "closest")
            result = leftDistance - rightDistance;
        else if (mode === "furthest")
            result = rightDistance - leftDistance;
        else if (mode === "strongest" || mode === "largest_hp")
            result = right.hp - left.hp || compareRemaining;
        else if (mode === "weakest")
            result = left.hp - right.hp || compareRemaining;
        else if (mode === "fastest_ahead") {
            result = Number(this.hasPierceOnlyArmor(right)) - Number(this.hasPierceOnlyArmor(left)) || compareRemaining;
        }
        else
            result = compareRemaining;
        return result || compareBinary(left.id, right.id);
    }
    dynamicEnemyRemainingCost(enemy) {
        if (!enemy.navigation || !enemy.routeId || !this.navigationFieldLookupCache)
            return Number.POSITIVE_INFINITY;
        const field = this.navigationField(enemy.navigation.movementProfileId, enemy.routeId);
        return this.navigationFieldLookupCache.get(field).remainingCost(enemy.navigation);
    }
    enemyInRange(tower, enemy, range) {
        return this.map.distance(tower.coord, this.enemyCoord(enemy)) <= range;
    }
    highGroundPair(tower, enemy) {
        const profile = this.activeHighGroundProfile;
        if (!profile)
            return undefined;
        return computeHighGroundPairModifiers(this.map.elevationAt(tower.coord), this.map.elevationAt(this.enemyCoord(enemy)), profile);
    }
    enemyInTowerAcquisitionRange(tower, enemy) {
        const rangeBonus = this.highGroundPair(tower, enemy)?.rangeBonus ?? 0;
        return this.enemyInRange(tower, enemy, this.towerRange(tower) + rangeBonus);
    }
    towerRange(tower) {
        const type = this.towerTypes[tower.typeId];
        if (!type) {
            return 0;
        }
        const attack = type.attack;
        const levelIndex = Math.max(0, tower.level - 1);
        if (attack.kind === "sniper") {
            return attack.rangeByLevel?.[Math.min(levelIndex, attack.rangeByLevel.length - 1)] ?? type.range;
        }
        if (attack.kind === "support") {
            return attack.auraRadiusByLevel?.[Math.min(levelIndex, attack.auraRadiusByLevel.length - 1)] ?? attack.auraRadius;
        }
        if (attack.kind === "support_buff") {
            return attack.auraRadius;
        }
        if (attack.kind === "pipeline") {
            return attack.rangeByLevel?.[Math.min(levelIndex, attack.rangeByLevel.length - 1)] ?? type.range;
        }
        return type.range;
    }
    slipperyJackInterval(tower) {
        const type = this.towerTypes[tower.typeId];
        if (!type || type.attack.kind !== "splash") {
            return 1;
        }
        const levelIndex = Math.max(0, tower.level - 1);
        return type.attack.intervalByLevel?.[Math.min(levelIndex, type.attack.intervalByLevel.length - 1)] ?? type.attack.interval;
    }
    towerPulseRate(tower) {
        const type = this.towerTypes[tower.typeId];
        if (!type || type.attack.kind !== "pulse") {
            return 1;
        }
        const levelIndex = Math.max(0, tower.level - 1);
        return type.attack.pulseRateByLevel?.[Math.min(levelIndex, type.attack.pulseRateByLevel.length - 1)] ?? type.attack.pulseRate;
    }
    enemyTrack(enemy) {
        return this.enemyTrackForType(enemy.typeId, enemy.routeId);
    }
    enemyTrackForType(typeId, routeId) {
        return this.enemyTypes[typeId]?.movementKind === "direct_flying"
            ? this.directFlightLine
            : (this.map.pathRouteById(routeId)?.pathCenterline ?? this.map.pathCenterline);
    }
    enemyTargetClass(enemy) {
        return this.enemyTargetClassByType(enemy.typeId);
    }
    enemyTargetClassByType(typeId) {
        return this.enemyTypes[typeId]?.targetClass ?? "ground";
    }
    enemyTerrainSpeedFactor(enemy) {
        const type = this.enemyTypes[enemy.typeId];
        if (!type || type.movementKind === "direct_flying" || type.ignoresWaterSlow || this.enemyTargetClass(enemy) !== "ground") {
            return 1;
        }
        const coord = this.enemyCoord(enemy);
        const terrainId = this.map.getTile(coord)?.terrain;
        const staticFactor = terrainId ? this.terrainMetadata(terrainId).groundSpeedMultiplier : 1;
        const temporaryFactor = this.isTemporaryWaterTile(coord) ? this.content.constants.pathWaterGroundSpeedFactor : 1;
        return Math.min(staticFactor, temporaryFactor);
    }
    enemyStatusSpeedFactor(enemy) {
        if ((enemy.statuses?.stun?.remaining ?? 0) > 0) {
            return 0; // stunned enemies are frozen in place
        }
        const slow = enemy.statuses?.slow;
        if (!slow || slow.remaining <= 0) {
            return 1;
        }
        return Math.min(1, Math.max(0.05, slow.factor));
    }
    isEnemyInSunlight(enemy) {
        if (this.sunlightPathKeys.size === 0 || this.enemyTargetClass(enemy) !== "ground") {
            return false;
        }
        if (enemy.navigation) {
            const coord = this.enemyCoord(enemy);
            return this.sunlightTilesSnapshot.some((tile) => tile.q === coord.q && tile.r === coord.r);
        }
        const track = this.enemyTrack(enemy);
        const order = Math.min(Math.round(enemy.pathProgress), track.length - 1);
        return this.sunlightPathKeys.has(this.routePathKey(enemy.routeId, order));
    }
    applyResolvedEnemyDamage(enemy, amount, source, options = {}) {
        const armorMatrix = resolveEnemyArmorMatrix(this.activeCombatMechanics, enemy.typeId);
        const resistances = this.activeCombatMechanics?.enemyResistances[enemy.typeId];
        const marks = this.activeMarkDamageContext(enemy);
        const context = {
            ...(options.context ?? {}),
            ...(resistances === undefined ? {} : { resistances }),
            ...(armorMatrix === undefined ? {} : { armorMatrix }),
            ...(marks === undefined ? {} : { marks })
        };
        return this.resolveAndApplyDamage({
            amount,
            source,
            target: { kind: "enemy", enemyId: enemy.id, enemyTypeId: enemy.typeId },
            ...(options.damageType === undefined ? {} : { damageType: options.damageType }),
            ...(options.tags?.length ? { tags: options.tags } : {}),
            ...(options.modifiers?.length ? { modifiers: options.modifiers } : {})
        }, Object.keys(context).length === 0 ? undefined : context, { kind: "enemy", enemy }, options.reactionRuntime);
    }
    applyResolvedCoreDamage(amount, source) {
        return this.resolveAndApplyDamage({ amount, source, target: { kind: "core" } }, undefined, { kind: "core" });
    }
    applyResolvedTowerEntityDamage(tower, amount, source) {
        return this.resolveAndApplyDamage({
            amount,
            source,
            target: { kind: "tower", towerId: tower.id, towerTypeId: tower.typeId }
        }, undefined, { kind: "tower", tower });
    }
    applyResolvedHeroDamage(hero, amount, source) {
        return this.resolveAndApplyDamage({
            amount,
            source,
            target: {
                kind: "hero",
                heroId: hero.definitionId,
                heroDefinitionId: hero.definitionId
            }
        }, undefined, { kind: "hero", hero });
    }
    resolveAndApplyDamage(packet, context, mutableTarget, reactionRuntime) {
        const targetMatches = mutableTarget.kind === "core"
            ? packet.target.kind === "core"
            : mutableTarget.kind === "enemy"
                ? packet.target.kind === "enemy"
                    && packet.target.enemyId === mutableTarget.enemy.id
                    && packet.target.enemyTypeId === mutableTarget.enemy.typeId
                : mutableTarget.kind === "tower"
                    ? packet.target.kind === "tower"
                        && packet.target.towerId === mutableTarget.tower.id
                        && packet.target.towerTypeId === mutableTarget.tower.typeId
                    : packet.target.kind === "hero"
                        && packet.target.heroId === mutableTarget.hero.definitionId
                        && packet.target.heroDefinitionId === mutableTarget.hero.definitionId;
        if (!targetMatches) {
            throw new Error("Damage packet target does not match mutable target.");
        }
        const resolvedDamage = DamageResolver.resolve(packet, context);
        const capturedReactionState = mutableTarget.kind === "enemy" && this.activeReactionsMechanics
            ? {
                coord: this.enemyCoord(mutableTarget.enemy),
                exposures: cloneExposureStates(this.enemyExposures[mutableTarget.enemy.id] ?? {}),
                statuses: mutableTarget.enemy.statuses
                    ? Object.fromEntries(Object.entries(mutableTarget.enemy.statuses).map(([key, value]) => [key, value ? { ...value } : value]))
                    : {},
                terrainTags: [...this.terrainMetadata(this.map.getTile(this.enemyCoord(mutableTarget.enemy))?.terrain
                        ?? this.content.maps[this.mission.mapId]?.defaultTerrain
                        ?? "").tags]
            }
            : undefined;
        let shieldAbsorbed = 0;
        let hpDamage = resolvedDamage.finalAmount;
        if (resolvedDamage.finalAmount > 0 && mutableTarget.kind === "hero") {
            const definition = (this.activeHeroesMechanics?.schemaVersion === 3
                || this.activeHeroesMechanics?.schemaVersion === 4
                || this.activeHeroesMechanics?.schemaVersion === 5
                || this.activeHeroesMechanics?.schemaVersion === 6)
                ? this.activeHeroesMechanics.definitions[mutableTarget.hero.definitionId]
                : undefined;
            if (definition?.durability.shield) {
                const previous = mutableTarget.hero.shieldCurrent ?? 0;
                shieldAbsorbed = Math.min(previous, resolvedDamage.finalAmount);
                hpDamage = resolvedDamage.finalAmount - shieldAbsorbed;
                mutableTarget.hero.shieldCurrent = previous - shieldAbsorbed;
                if (shieldAbsorbed > 0) {
                    this.lastEvents.push({
                        type: "heroShieldChanged",
                        heroId: mutableTarget.hero.definitionId,
                        previous,
                        current: mutableTarget.hero.shieldCurrent,
                        capacity: definition.durability.shield.capacity,
                        cause: "damage",
                        amount: shieldAbsorbed,
                        ...(hpDamage > 0 ? { overflowDamage: hpDamage } : {})
                    });
                }
            }
        }
        else if (resolvedDamage.finalAmount > 0
            && (mutableTarget.kind === "enemy" || mutableTarget.kind === "tower")) {
            const isEnemy = mutableTarget.kind === "enemy";
            const entity = isEnemy ? mutableTarget.enemy : mutableTarget.tower;
            const state = isEnemy ? this.enemyShields[entity.id] : this.towerShields[entity.id];
            const definition = isEnemy
                ? this.combatShieldDefinitions?.enemies[entity.typeId]
                : this.combatShieldDefinitions?.towers[entity.typeId];
            if (state && definition) {
                state.regenerationDelayRemaining = definition.regeneration?.delayAfterDamage ?? 0;
                const previous = state.current;
                shieldAbsorbed = Math.min(previous, resolvedDamage.finalAmount);
                hpDamage = resolvedDamage.finalAmount - shieldAbsorbed;
                state.current = previous - shieldAbsorbed;
                if (shieldAbsorbed > 0) {
                    if (isEnemy) {
                        this.lastEvents.push({
                            type: "enemyShieldChanged",
                            enemyId: entity.id,
                            enemyTypeId: entity.typeId,
                            previous,
                            current: state.current,
                            capacity: state.capacity,
                            cause: "damage",
                            amount: shieldAbsorbed,
                            ...(hpDamage > 0 ? { overflowDamage: hpDamage } : {})
                        });
                    }
                    else {
                        this.lastEvents.push({
                            type: "towerShieldChanged",
                            towerId: entity.id,
                            towerTypeId: entity.typeId,
                            previous,
                            current: state.current,
                            capacity: state.capacity,
                            cause: "damage",
                            amount: shieldAbsorbed,
                            ...(hpDamage > 0 ? { overflowDamage: hpDamage } : {})
                        });
                    }
                }
            }
        }
        // Keep the target-specific legacy mutation formulas stable while applying only overflow to HP.
        const resolution = hpDamage === resolvedDamage.finalAmount
            ? resolvedDamage
            : { ...resolvedDamage, finalAmount: hpDamage };
        if (mutableTarget.kind === "enemy") {
            // Zero is the canonical pending-death state. Settlement intentionally stays
            // deferred to removeDeadEnemies(), preserving reward/event ordering exactly once.
            mutableTarget.enemy.hp = Math.max(0, mutableTarget.enemy.hp - resolution.finalAmount);
        }
        else if (mutableTarget.kind === "core") {
            this.coreHp = Math.max(0, this.coreHp - resolution.finalAmount);
        }
        else if (mutableTarget.kind === "tower") {
            mutableTarget.tower.hp = (mutableTarget.tower.hp ?? 0) - resolution.finalAmount;
        }
        else {
            mutableTarget.hero.hp = Math.max(0, (mutableTarget.hero.hp ?? 0) - resolution.finalAmount);
        }
        if (mutableTarget.kind === "enemy") {
            this.consumeResolvedMarks(mutableTarget.enemy, resolvedDamage);
            this.applySourceMarkBindings(mutableTarget.enemy, packet, resolvedDamage);
            if (capturedReactionState) {
                this.planAndApplyReactions(packet, mutableTarget.enemy, resolvedDamage, capturedReactionState, reactionRuntime);
            }
        }
        return { resolution: resolvedDamage, shieldAbsorbed, hpDamage };
    }
    planAndApplyReactions(packet, enemy, resolvedDamage, captured, runtime) {
        const profile = this.activeReactionsMechanics;
        if (!profile)
            return;
        const root = runtime?.root ?? {
            queue: [],
            rootEnemyId: enemy.id,
            rootEnemyTypeId: enemy.typeId,
            diagnostics: {},
            processing: false,
            scheduledPackets: 0
        };
        const depth = runtime?.depth ?? 0;
        const liveExposureCount = Object.values(this.enemyExposures)
            .reduce((total, states) => total + Object.keys(states).length, 0);
        const plan = planReactions({
            profile,
            primary: {
                rootEnemyId: enemy.id,
                rootEnemyTypeId: enemy.typeId,
                originCoord: captured.coord,
                damageType: packet.damageType ?? "physical",
                afterModifiers: resolvedDamage.afterModifiers,
                resolvedFinalAmount: resolvedDamage.finalAmount,
                depth,
                sourceKind: packet.source.kind,
                tags: packet.tags ?? [],
                allowReactions: runtime?.allowReactions ?? false,
                aliveAfterPrimary: enemy.hp > 0,
                exposures: captured.exposures,
                statuses: captured.statuses,
                terrainTags: captured.terrainTags
            },
            candidates: this.enemies.map((candidate) => ({
                enemyId: candidate.id,
                enemyTypeId: candidate.typeId,
                coord: this.enemyCoord(candidate),
                topologyDistance: this.map.distance(captured.coord, this.enemyCoord(candidate)),
                alive: candidate.hp > 0,
                terrainTags: this.terrainMetadata(this.map.getTile(this.enemyCoord(candidate))?.terrain
                    ?? this.content.maps[this.mission.mapId]?.defaultTerrain
                    ?? "").tags
            })),
            budget: {
                secondaryPacketsRemaining: Math.max(0, 256 - root.scheduledPackets),
                liveExposuresRemaining: Math.max(0, 16_384 - liveExposureCount)
            }
        });
        for (const consumption of plan.consumptions) {
            if (consumption.kind === "exposure") {
                const states = this.enemyExposures[enemy.id];
                const previous = states?.[consumption.exposureId];
                if (!states || !previous)
                    continue;
                const currentStacks = consumption.stacks === "all" ? 0 : Math.max(0, previous.stacks - 1);
                const remaining = currentStacks === 0 ? 0 : previous.remaining;
                if (currentStacks === 0)
                    delete states[consumption.exposureId];
                else
                    states[consumption.exposureId] = { stacks: currentStacks, remaining };
                if (Object.keys(states).length === 0)
                    delete this.enemyExposures[enemy.id];
                this.lastEvents.push({
                    type: "enemyExposureChanged", enemyId: enemy.id, enemyTypeId: enemy.typeId,
                    exposureId: consumption.exposureId, previousStacks: previous.stacks, currentStacks,
                    previousRemaining: previous.remaining, remaining, cause: "consume"
                });
            }
            else if (enemy.statuses?.[consumption.statusId]) {
                delete enemy.statuses[consumption.statusId];
            }
        }
        for (const trigger of plan.triggers) {
            this.lastEvents.push({ type: "enemyReactionTriggered", ...trigger });
        }
        for (const application of plan.exposureApplications) {
            this.applyEnemyExposure(enemy, application.exposureId, application.stacks, application.duration, application.maxStacks, "damage");
        }
        for (const diagnostic of plan.diagnostics) {
            const accumulated = root.diagnostics[diagnostic.budget];
            if (accumulated)
                accumulated.dropped += diagnostic.dropped;
            else
                root.diagnostics[diagnostic.budget] = {
                    limit: diagnostic.limit,
                    dropped: diagnostic.dropped
                };
        }
        root.queue.push(...plan.secondaryPlans);
        root.scheduledPackets += plan.secondaryPlans.length;
        if (root.processing)
            return;
        root.processing = true;
        while (root.queue.length > 0) {
            const secondary = root.queue.shift();
            const target = this.enemies.find((candidate) => candidate.id === secondary.targetEnemyId && candidate.hp > 0);
            if (!target)
                continue;
            this.applyResolvedEnemyDamage(target, secondary.amount, { kind: "reaction", reactionId: secondary.reactionId }, {
                damageType: secondary.damageType,
                tags: secondary.tags,
                reactionRuntime: {
                    depth: secondary.depth,
                    allowReactions: secondary.allowReactions,
                    root
                }
            });
        }
        root.processing = false;
        for (const budget of ["depth", "secondary_packets", "live_exposures"]) {
            const diagnostic = root.diagnostics[budget];
            if (!diagnostic)
                continue;
            this.lastEvents.push({
                type: "reactionBudgetExceeded",
                rootEnemyId: root.rootEnemyId,
                rootEnemyTypeId: root.rootEnemyTypeId,
                budget,
                limit: diagnostic.limit,
                dropped: diagnostic.dropped
            });
        }
    }
    applyEnemyExposure(enemy, exposureId, stacks, duration, maxStacks, cause) {
        const states = this.enemyExposures[enemy.id] ?? emptyDataRecord();
        const previous = states[exposureId];
        const previousStacks = previous?.stacks ?? 0;
        const previousRemaining = previous?.remaining ?? 0;
        const currentStacks = Math.min(maxStacks, previousStacks + stacks);
        const remaining = duration;
        if (currentStacks === previousStacks && remaining === previousRemaining)
            return;
        states[exposureId] = { stacks: currentStacks, remaining };
        this.enemyExposures[enemy.id] = states;
        this.lastEvents.push({
            type: "enemyExposureChanged", enemyId: enemy.id, enemyTypeId: enemy.typeId,
            exposureId, previousStacks, currentStacks, previousRemaining, remaining, cause
        });
    }
    updateEnemyExposures(delta) {
        if (delta <= 0 || !this.activeReactionsMechanics)
            return;
        for (const enemyId of Object.keys(this.enemyExposures).sort()) {
            const enemy = this.enemies.find((candidate) => candidate.id === enemyId);
            const states = this.enemyExposures[enemyId];
            if (!enemy || !states)
                continue;
            for (const exposureId of Object.keys(states).sort()) {
                const previous = states[exposureId];
                if (!previous)
                    continue;
                const remaining = Math.max(0, previous.remaining - delta);
                if (remaining > 1e-12) {
                    states[exposureId] = { stacks: previous.stacks, remaining };
                    continue;
                }
                delete states[exposureId];
                this.lastEvents.push({
                    type: "enemyExposureChanged", enemyId, enemyTypeId: enemy.typeId,
                    exposureId, previousStacks: previous.stacks, currentStacks: 0,
                    previousRemaining: previous.remaining, remaining: 0, cause: "expiration"
                });
            }
            if (Object.keys(states).length === 0)
                delete this.enemyExposures[enemyId];
        }
    }
    applyTowerDamage(tower, enemy, rawDamage, options = {}) {
        const application = this.applyResolvedTowerDamage(tower.typeId, enemy, rawDamage, options, tower.id);
        const damage = application.resolution.finalAmount;
        if (damage > 0) {
            if (options.applyLegacyStatus !== false)
                this.applyStatusOnHit(tower.typeId, enemy);
            this.lastEvents.push({
                type: "enemyHit",
                towerId: tower.id,
                enemyId: enemy.id,
                enemyTypeId: enemy.typeId,
                damage
            });
            return damage;
        }
        if (rawDamage > 0 && application.resolution.blockedByArmor) {
            this.lastEvents.push({
                type: "enemyArmorBlocked",
                towerId: tower.id,
                enemyId: enemy.id,
                enemyTypeId: enemy.typeId,
                rawDamage
            });
        }
        return 0;
    }
    applyResolvedTowerDamage(towerTypeId, enemy, rawDamage, options = {}, towerId) {
        const modifiers = [];
        if (this.towerDamageMultiplier !== 1) {
            modifiers.push({
                id: "legacy-meta-tower-damage",
                target: "damage",
                stage: "meta",
                operation: "multiplier",
                value: this.towerDamageMultiplier
            });
        }
        modifiers.push(...this.rogueliteDamageModifiers);
        const sourceTower = towerId === undefined || options.overTime === true
            ? undefined
            : this.towers.find((tower) => tower.id === towerId
                && tower.typeId === towerTypeId
                && (tower.hp === undefined || tower.hp > 0));
        if (sourceTower) {
            modifiers.push(...(this.artifactDamageModifiersByTowerId.get(sourceTower.id) ?? []));
            modifiers.push(...this.draftDamageModifiersForTower(sourceTower));
            const damageBonusBasisPoints = this.highGroundPair(sourceTower, enemy)?.damageBonusBasisPoints ?? 0;
            if (damageBonusBasisPoints > 0) {
                modifiers.push({
                    id: "elevation:high-ground:damage",
                    target: "damage",
                    stage: "spatial",
                    operation: "additive_ratio",
                    value: damageBonusBasisPoints / 10_000
                });
            }
            modifiers.push(...this.heroPassiveAuraModifiersForTower(sourceTower));
        }
        if (options.aoe && this.isEnemyInSunlight(enemy)) {
            const sunlightMultiplier = this.mission.sunlight?.aoeDamageMultiplier ?? 1;
            if (sunlightMultiplier !== 1) {
                modifiers.push({
                    id: "legacy-spatial-sunlight-aoe",
                    target: "damage",
                    stage: "spatial",
                    operation: "multiplier",
                    value: sunlightMultiplier
                });
            }
        }
        const tags = [];
        if (options.overTime)
            tags.push("over_time");
        else if (options.aoe)
            tags.push("area");
        if (options.armorPiercing)
            tags.push("armor_piercing");
        const armor = this.enemyTypes[enemy.typeId]?.armor;
        const legacyArmor = armor?.kind === "pierce_only"
            ? {
                kind: "pierce_only",
                bypassed: options.armorPiercing === true || this.piercesSniperArmor(towerTypeId),
                chipDamage: this.armoredChipDamageForTower(towerTypeId, armor.chipDamageByTowerId)
            }
            : undefined;
        const source = {
            kind: "tower",
            towerTypeId,
            ...(towerId === undefined ? {} : { towerId })
        };
        return this.applyResolvedEnemyDamage(enemy, rawDamage, source, {
            damageType: options.damageType ?? this.damageTypeOf(towerTypeId),
            ...(tags.length ? { tags } : {}),
            ...(modifiers.length ? { modifiers } : {}),
            context: {
                resistances: this.enemyTypes[enemy.typeId]?.resistances,
                ...(legacyArmor === undefined ? {} : { legacyArmor })
            }
        });
    }
    draftDamageModifiersForTower(tower) {
        const active = this.activeRogueliteMechanics;
        if (!active?.draft || (this.campaignDeck.length === 0 && this.draftSelections.length === 0))
            return [];
        const tags = new Set(active.towerTagsByTypeId[tower.typeId] ?? []);
        const modifiers = [];
        const entries = [
            ...this.campaignDeck.map((entry, index) => ({
                cardId: entry.cardId,
                modifierIdentity: `campaign:${entry.instanceId.length}:${entry.instanceId}`,
                order: index + 1
            })),
            ...this.draftSelections.map((selection) => ({
                cardId: selection.cardId,
                modifierIdentity: `battle:${selection.sequence}`,
                order: this.campaignDeck.length + selection.sequence
            }))
        ];
        for (const selection of entries) {
            const definition = active.draft.definitions[selection.cardId];
            if (!definition)
                throw new Error(`Draft selection references unknown card "${selection.cardId}".`);
            definition.effects.forEach((effect, effectIndex) => {
                const matches = effect.scope.kind === "all_towers"
                    || (effect.scope.kind === "tower_type" && effect.scope.towerTypeId === tower.typeId)
                    || (effect.scope.kind === "tower_tag" && tags.has(effect.scope.tag));
                if (!matches)
                    return;
                modifiers.push(Object.freeze({
                    id: `roguelite:draft:${selection.order}:${selection.modifierIdentity}:${selection.cardId.length}:${selection.cardId}:modifier:${String(effectIndex).padStart(2, "0")}`,
                    target: effect.modifier.target,
                    stage: "run",
                    operation: effect.modifier.operation,
                    value: effect.modifier.value
                }));
            });
        }
        return modifiers;
    }
    /** The (author-defined) damage type a tower deals; defaults to "physical". */
    damageTypeOf(towerTypeId) {
        const attack = this.towerTypes[towerTypeId]?.attack;
        return attack?.damageType ?? "physical";
    }
    /** "pierce_only" armor is fully pierced by any sniper-kind weapon, regardless of its tower id. */
    piercesSniperArmor(towerTypeId) {
        return this.towerTypes[towerTypeId]?.attack.kind === "sniper";
    }
    armoredChipDamageForTower(towerTypeId, chipDamageByTowerId) {
        const configured = chipDamageByTowerId?.[towerTypeId];
        if (typeof configured === "number" && Number.isFinite(configured)) {
            return Math.max(0, configured);
        }
        const attack = this.towerTypes[towerTypeId]?.attack;
        return attack?.kind === "splash" ? Math.max(0, attack.armoredChipDamage) : 0;
    }
    hasPierceOnlyArmor(enemy) {
        return this.enemyTypes[enemy.typeId]?.armor?.kind === "pierce_only";
    }
    applySlow(enemy, factor, duration, affectsClasses = ["ground"]) {
        if (!affectsClasses.includes(this.enemyTargetClass(enemy)) || factor >= 1 || factor <= 0 || duration <= 0) {
            return;
        }
        const existing = enemy.statuses?.slow;
        enemy.statuses ??= {};
        enemy.statuses.slow = {
            factor: existing ? Math.min(existing.factor, factor) : factor,
            remaining: Math.max(existing?.remaining ?? 0, duration)
        };
    }
    /** Apply a tower's data-driven on-hit status effects. Content-agnostic: keyed on attack.statusOnHit. */
    applyStatusOnHit(towerTypeId, enemy) {
        const spec = this.towerTypes[towerTypeId]?.attack?.statusOnHit;
        if (!spec)
            return;
        this.applyStatusEffect(enemy, spec);
    }
    /**
     * Apply a status-effect spec to an enemy. The shared primitive behind both a tower's
     * `attack.statusOnHit` (via applyStatusOnHit) and an ability's `{kind:"status"}` effect
     * (via applyAbilityEffect) — one status vocabulary, two triggers.
     */
    applyStatusEffect(enemy, spec) {
        if (spec.slow) {
            this.applySlow(enemy, spec.slow.factor, spec.slow.duration, spec.slowAffectsClasses);
        }
        if (typeof spec.stun === "number" && spec.stun > 0) {
            enemy.statuses ??= {};
            enemy.statuses.stun = { remaining: Math.max(enemy.statuses.stun?.remaining ?? 0, spec.stun) };
        }
        if (spec.poison && spec.poison.dps > 0 && spec.poison.duration > 0) {
            enemy.statuses ??= {};
            const existing = enemy.statuses.poison;
            enemy.statuses.poison = {
                dps: Math.max(existing?.dps ?? 0, spec.poison.dps),
                remaining: Math.max(existing?.remaining ?? 0, spec.poison.duration)
            };
        }
    }
    triggerEnemyPhaseSpawns() {
        const spawned = [];
        for (const parent of this.enemies) {
            if (parent.hp <= 0) {
                continue;
            }
            const type = this.enemyTypes[parent.typeId];
            if (!type?.phaseSpawns?.length) {
                continue;
            }
            parent.phaseSpawnsTriggered ??= [];
            for (const phase of type.phaseSpawns) {
                const key = `${phase.hpRatio}:${phase.enemyId}`;
                if (parent.phaseSpawnsTriggered.includes(key) || parent.hp / parent.maxHp > phase.hpRatio) {
                    continue;
                }
                parent.phaseSpawnsTriggered.push(key);
                const children = this.createPhaseSpawnChildren(parent, phase);
                if (children.length > 0) {
                    spawned.push(...children);
                    this.lastEvents.push({
                        type: "enemyPhaseSpawned",
                        parentEnemyId: parent.id,
                        parentEnemyTypeId: parent.typeId,
                        enemyTypeId: phase.enemyId,
                        enemyIds: children.map((child) => child.id),
                        hpRatio: phase.hpRatio
                    });
                }
            }
        }
        if (spawned.length > 0) {
            this.enemies.push(...spawned);
        }
    }
    createPhaseSpawnChildren(parent, phase) {
        const parentRatio = this.enemyRouteProgressRatio(parent);
        const routeIds = phase.routeIds?.length ? phase.routeIds : [parent.routeId ?? this.defaultRouteId()];
        const children = [];
        for (let index = 0; index < phase.count; index += 1) {
            const authoredRouteId = routeIds[index % routeIds.length];
            const routeId = this.activeNavigationProfile
                ? this.resolveDynamicNavigationRoute(authoredRouteId).id
                : this.resolveRouteId(authoredRouteId);
            const offset = phase.pathOffsets?.[index] ?? (index % 2 === 0 ? -0.22 : 0.22);
            let child;
            if (this.activeNavigationProfile && parent.navigation) {
                child = this.createDynamicChildEnemyState(parent, phase.enemyId, routeId, offset, phase.progressOffset ?? 0);
            }
            else {
                const track = this.enemyTrackForType(phase.enemyId, routeId);
                const trackEnd = Math.max(0, track.length - 1);
                const progress = Math.min(Math.max(0, parentRatio * trackEnd + (phase.progressOffset ?? 0)), Math.max(0, trackEnd - 0.001));
                child = this.createEnemyState(phase.enemyId, progress, offset, routeId);
            }
            if (child) {
                children.push(child);
            }
        }
        return children;
    }
    towerFireRateMultiplier(tower) {
        let best = this.towerFireRateMetaMultiplier;
        for (const support of this.towers) {
            if (support.id === tower.id) {
                continue;
            }
            const supportType = this.towerTypes[support.typeId];
            const attack = supportType?.attack;
            if (attack?.kind !== "support_buff" || !attack.affectsTowerIds.includes(tower.typeId)) {
                continue;
            }
            if (!this.supportBuffTouchesTower(support, tower)) {
                continue;
            }
            const levelIndex = Math.max(0, support.level - 1);
            const multiplier = attack.fireRateMultiplierByLevel[Math.min(levelIndex, attack.fireRateMultiplierByLevel.length - 1)] ?? 1;
            best = Math.max(best, multiplier * this.towerFireRateMetaMultiplier);
        }
        return best;
    }
    supportBuffTouchesTower(support, target) {
        const supportType = this.towerTypes[support.typeId];
        const targetType = this.towerTypes[target.typeId];
        const attack = supportType?.attack;
        if (!supportType || !targetType || attack?.kind !== "support_buff") {
            return false;
        }
        const edgeDistance = Math.max(0, this.map.distance(support.coord, target.coord) - supportType.footprintRadius - targetType.footprintRadius);
        return edgeDistance <= this.towerRange(support);
    }
    enemyRouteProgressRatio(enemy) {
        const track = this.enemyTrack(enemy);
        return enemy.pathProgress / Math.max(1, track.length - 1);
    }
    defaultRouteId() {
        return this.map.pathRoutes[0]?.id ?? "main";
    }
    resolveRouteId(routeId) {
        return this.map.pathRouteById(routeId)?.id ?? this.defaultRouteId();
    }
    routePathKey(routeId, pathOrder) {
        return `${this.resolveRouteId(routeId)}:${pathOrder}`;
    }
    isTemporaryWaterTile(coord) {
        const key = coordKey(coord);
        return this.temporaryWaterTiles.some((tile) => coordKey(tile) === key && tile.expiresIn > 0);
    }
    isInsideAnyPulse(enemy) {
        return (this.enemyTargetClass(enemy) === "ground" &&
            this.towers.some((tower) => this.isPulseTower(tower) && this.enemyInTowerAcquisitionRange(tower, enemy)));
    }
    isInsideSupportAura(sourceTypeId, coord) {
        const sourceType = this.towerTypes[sourceTypeId];
        if (sourceType?.attack.kind !== "support") {
            return false;
        }
        return this.towers.some((tower) => tower.typeId === sourceTypeId && this.map.distance(tower.coord, coord) <= this.towerRange(tower));
    }
    buildNavigationWavePairs(profile) {
        const pairs = new Map();
        for (const wave of this.mission.waves) {
            for (const group of wave.groups) {
                const route = this.resolveDynamicNavigationRoute(group.routeId);
                const source = route.pathCenterline[0];
                if (!source)
                    continue;
                const movementProfileId = profile.enemyMovementProfiles?.[group.enemyId]
                    ?? profile.defaultMovementProfileId;
                const pair = Object.freeze({
                    movementProfileId,
                    routeId: route.id,
                    source: Object.freeze({ q: source.q, r: source.r })
                });
                pairs.set(JSON.stringify([movementProfileId, route.id]), pair);
            }
        }
        return Object.freeze([...pairs.values()].sort((left, right) => (compareBinary(left.movementProfileId, right.movementProfileId)
            || compareBinary(left.routeId, right.routeId))));
    }
    buildNavigationMandatoryPairs(profile) {
        const pairs = new Map();
        const queued = new Set();
        const worklist = [];
        const reachableEnemyTypeIds = new Set();
        const deathSpawnChildTypeIds = new Set();
        const phaseSpawnChildTypeIds = new Set();
        const enqueue = (enemyTypeId, routeId) => {
            if (!this.content.enemies[enemyTypeId])
                return;
            const route = this.resolveDynamicNavigationRoute(routeId);
            const key = JSON.stringify([enemyTypeId, route.id]);
            if (queued.has(key))
                return;
            queued.add(key);
            worklist.push(Object.freeze({ enemyTypeId, routeId: route.id }));
            worklist.sort((left, right) => (compareBinary(left.enemyTypeId, right.enemyTypeId)
                || compareBinary(left.routeId, right.routeId)));
        };
        for (const wave of this.mission.waves) {
            for (const group of wave.groups) {
                enqueue(group.enemyId, group.routeId);
            }
        }
        const reachableTerrainIds = new Set([...this.map.tiles.values()].map((tile) => tile.terrain));
        if (this.mission.abilities?.some((ability) => ability.id === "path_water")
            && this.content.terrainTypes.water
            && this.map.allPathCoords().some((coord) => this.map.getBaseTerrain(coord) === "path"))
            reachableTerrainIds.add("water");
        const appliedHandlers = new Set();
        while (true) {
            let changed = false;
            while (worklist.length > 0) {
                const current = worklist.shift();
                changed = true;
                const enemyType = this.content.enemies[current.enemyTypeId];
                if (!enemyType)
                    continue;
                reachableEnemyTypeIds.add(current.enemyTypeId);
                const route = this.resolveDynamicNavigationRoute(current.routeId);
                const movementProfileId = profile.enemyMovementProfiles?.[current.enemyTypeId]
                    ?? profile.defaultMovementProfileId;
                if (profile.movementProfiles[movementProfileId]?.towerOccupancy === "blocked") {
                    const source = route.pathCenterline[0];
                    if (source) {
                        const pair = Object.freeze({
                            movementProfileId,
                            routeId: route.id,
                            source: Object.freeze({ q: source.q, r: source.r })
                        });
                        pairs.set(JSON.stringify([movementProfileId, route.id]), pair);
                    }
                }
                const deathSpawn = enemyType.spawnOnDeath;
                if (deathSpawn && deathSpawn.count > 0) {
                    deathSpawnChildTypeIds.add(deathSpawn.enemyId);
                    enqueue(deathSpawn.enemyId, route.id);
                }
                for (const phase of enemyType.phaseSpawns ?? []) {
                    if (!(phase.count > 0))
                        continue;
                    phaseSpawnChildTypeIds.add(phase.enemyId);
                    if (!phase.routeIds?.length) {
                        enqueue(phase.enemyId, route.id);
                        continue;
                    }
                    const routeCount = Math.min(phase.routeIds.length, Math.ceil(phase.count));
                    for (let index = 0; index < routeCount; index += 1) {
                        enqueue(phase.enemyId, phase.routeIds[index]);
                    }
                }
            }
            for (const scriptId of Object.keys(this.content.scripts ?? {}).sort(compareBinary)) {
                const script = this.content.scripts[scriptId];
                if (!script || script.enabled === false)
                    continue;
                for (const eventName of Object.keys(script.handlers).sort(compareBinary)) {
                    const handlers = script.handlers[eventName] ?? [];
                    for (let handlerIndex = 0; handlerIndex < handlers.length; handlerIndex += 1) {
                        const handlerKey = JSON.stringify([scriptId, eventName, handlerIndex]);
                        if (appliedHandlers.has(handlerKey))
                            continue;
                        if (!this.navigationHandlerAppliesToMission(script, eventName, reachableEnemyTypeIds, deathSpawnChildTypeIds, phaseSpawnChildTypeIds, reachableTerrainIds))
                            continue;
                        appliedHandlers.add(handlerKey);
                        changed = true;
                        const handler = handlers[handlerIndex];
                        for (const action of handler.actions) {
                            if (action.action === "spawnEnemy")
                                enqueue(action.enemyTypeId, action.routeId);
                            if (action.action === "setTileTerrain")
                                reachableTerrainIds.add(action.terrainId);
                        }
                    }
                }
            }
            if (worklist.length === 0 && !changed)
                break;
        }
        const ordered = [...pairs.values()].sort((left, right) => (compareBinary(left.movementProfileId, right.movementProfileId)
            || compareBinary(left.routeId, right.routeId)));
        return Object.freeze(ordered);
    }
    resolveDynamicNavigationRoute(routeId) {
        const route = routeId === undefined
            ? this.map.pathRoutes.find((candidate) => candidate.id === "main")
                ?? [...this.map.pathRoutes].sort((left, right) => compareBinary(left.id, right.id))[0]
            : this.map.pathRoutes.find((candidate) => candidate.id === routeId);
        if (!route) {
            throw new Error(`Dynamic navigation spawn references unknown route "${routeId ?? "main"}".`);
        }
        return route;
    }
    navigationHandlerAppliesToMission(script, eventName, reachableEnemyTypeIds, deathSpawnChildTypeIds, phaseSpawnChildTypeIds, reachableTerrainIds) {
        const acceptsAny = (ids, candidates) => {
            const accepted = ids === undefined ? undefined : new Set(ids);
            for (const candidate of candidates)
                if (!accepted || accepted.has(candidate))
                    return true;
            return false;
        };
        const towerIds = this.mission.buildTowerIds ?? Object.keys(this.content.towers);
        const abilityIds = this.mission.abilityIds ?? Object.keys(this.content.abilities);
        const eventFields = new Set(TOWER_SCRIPT_EVENT_FIELDS[eventName]);
        const eventEnemyTypeIds = eventName === "enemySpawnedOnDeath"
            ? deathSpawnChildTypeIds
            : eventName === "enemyPhaseSpawned"
                ? phaseSpawnChildTypeIds
                : reachableEnemyTypeIds;
        for (const binding of script.bindings) {
            if (binding.scope === "global")
                return true;
            if (binding.scope === "mission" && acceptsAny(binding.ids, [this.mission.id]))
                return true;
            if (binding.scope === "map" && acceptsAny(binding.ids, [this.mission.mapId]))
                return true;
            if (binding.scope === "wave" && acceptsAny(binding.ids, [this.mission.waveSetId]))
                return true;
            if (binding.scope === "tower"
                && (eventName === "tick" || eventFields.has("towerId") || eventFields.has("towerIds"))
                && acceptsAny(binding.ids, towerIds))
                return true;
            if (binding.scope === "ability"
                && eventFields.has("abilityId")
                && acceptsAny(binding.ids, abilityIds))
                return true;
            if (binding.scope === "terrain"
                && (eventFields.has("coord") || eventFields.has("center") || eventFields.has("to"))
                && acceptsAny(binding.ids, reachableTerrainIds))
                return true;
            if (binding.scope === "enemy"
                && (eventName === "tick" || eventFields.has("enemyId") || eventFields.has("targetEnemyId") || eventFields.has("enemyIds"))
                && eventEnemyTypeIds.size > 0
                && acceptsAny(binding.ids, eventEnemyTypeIds)) {
                return true;
            }
        }
        return false;
    }
    navigationTerrainByCoord() {
        const terrainByCoord = {};
        for (const tile of this.map.tiles.values()) {
            Object.defineProperty(terrainByCoord, coordKey(tile), {
                value: tile.terrain,
                enumerable: true,
                configurable: true,
                writable: true
            });
        }
        return terrainByCoord;
    }
    navigationTerrainByCoordForOverrides(overrides) {
        const terrainByCoord = {};
        for (const tile of this.map.tiles.values()) {
            const key = coordKey(tile);
            const terrain = overrides.get(key)?.terrain ?? this.map.getBaseTerrain(tile);
            if (!terrain)
                throw new Error(`Dynamic terraforming candidate is missing base terrain at ${key}.`);
            Object.defineProperty(terrainByCoord, key, {
                value: terrain,
                enumerable: true,
                configurable: true,
                writable: true
            });
        }
        return terrainByCoord;
    }
    navigationOccupiedCoords(ignoreTowerId, candidateFootprint = []) {
        const occupied = new Map();
        for (const tile of this.map.tiles.values()) {
            if (!tile.occupiedBy || tile.occupiedBy === ignoreTowerId)
                continue;
            occupied.set(coordKey(tile), { q: tile.q, r: tile.r });
        }
        for (const coord of candidateFootprint) {
            occupied.set(coordKey(coord), { q: coord.q, r: coord.r });
        }
        return [...occupied.values()];
    }
    createNavigationResolver(occupiedCoords = this.navigationOccupiedCoords(), terrainByCoord = this.navigationTerrainByCoord()) {
        const profile = this.activeNavigationProfile;
        if (!profile)
            throw new Error("Dynamic navigation resolver requires an active profile.");
        return new NavigationResolver({
            grid: this.map.grid,
            width: this.map.width,
            height: this.map.height,
            profile,
            terrainTypes: this.content.terrainTypes,
            terrainByCoord,
            occupiedCoords,
            routes: this.map.pathRoutes
        });
    }
    navigationPlacementPairs() {
        const profile = this.activeNavigationProfile;
        if (!profile)
            return [];
        const pairs = new Map();
        for (const pair of this.navigationMandatoryPairs) {
            pairs.set(JSON.stringify([pair.movementProfileId, pair.routeId, pair.source.q, pair.source.r]), pair);
        }
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0 || !enemy.navigation || !enemy.routeId)
                continue;
            if (profile.movementProfiles[enemy.navigation.movementProfileId]?.towerOccupancy !== "blocked")
                continue;
            const pair = Object.freeze({
                movementProfileId: enemy.navigation.movementProfileId,
                routeId: enemy.routeId,
                source: Object.freeze({ ...enemy.navigation.currentCoord })
            });
            pairs.set(JSON.stringify([pair.movementProfileId, pair.routeId, pair.source.q, pair.source.r]), pair);
        }
        return [...pairs.values()].sort((left, right) => (compareBinary(left.movementProfileId, right.movementProfileId)
            || compareBinary(left.routeId, right.routeId)
            || left.source.r - right.source.r
            || left.source.q - right.source.q));
    }
    navigationPairIsReachable(resolver, pair, lookups, budget) {
        const field = resolver.getField(pair.movementProfileId, pair.routeId);
        if (budget)
            this.consumeNavigationAnalysisField(field, budget);
        return lookups.get(field).get(pair.source) !== undefined;
    }
    createNavigationPlacementAnalysisContext(budget) {
        const pairs = this.navigationPlacementPairs();
        const lookups = new NavigationFieldLookupCache();
        if (pairs.length === 0)
            return { pairs, lookups, budget };
        const baseline = this.createNavigationResolver();
        const baselineUnavailable = pairs.find((pair) => (!this.navigationPairIsReachable(baseline, pair, lookups, budget)));
        return {
            pairs,
            lookups,
            budget,
            ...(baselineUnavailable === undefined ? {} : { baselineUnavailable })
        };
    }
    canPreserveDynamicNavigation(footprint, ignoreTowerId, analysisContext) {
        if (!this.navigationResolver)
            return { ok: true };
        const pairs = analysisContext?.pairs ?? this.navigationPlacementPairs();
        if (pairs.length === 0)
            return { ok: true };
        const lookups = analysisContext?.lookups ?? new NavigationFieldLookupCache();
        if (analysisContext?.baselineUnavailable) {
            const pair = analysisContext.baselineUnavailable;
            return this.fail("A required navigation route is already unavailable.", "reason.navigationUnavailable", { movementProfileId: pair.movementProfileId, routeId: pair.routeId });
        }
        if (!analysisContext) {
            const baseline = this.createNavigationResolver();
            for (const pair of pairs) {
                if (!this.navigationPairIsReachable(baseline, pair, lookups)) {
                    return this.fail("A required navigation route is already unavailable.", "reason.navigationUnavailable", { movementProfileId: pair.movementProfileId, routeId: pair.routeId });
                }
            }
        }
        const candidate = this.createNavigationResolver(this.navigationOccupiedCoords(ignoreTowerId, footprint));
        for (const pair of pairs) {
            if (!this.navigationPairIsReachable(candidate, pair, lookups, analysisContext?.budget)) {
                return this.fail("Tower would block the last available path.", "reason.lastPathBlocked", { movementProfileId: pair.movementProfileId, routeId: pair.routeId });
            }
        }
        return { ok: true };
    }
    syncNavigationTerrain() {
        this.navigationResolver?.updateTerrainByCoord(this.navigationTerrainByCoord());
        this.revalidateHeroMovementAfterMapMutation();
    }
    syncNavigationOccupancy() {
        this.navigationResolver?.updateOccupiedCoords(this.navigationOccupiedCoords());
        this.revalidateHeroMovementAfterMapMutation();
    }
    syncNavigationResolver() {
        const resolver = this.navigationResolver;
        if (resolver) {
            resolver.updateTerrainByCoord(this.navigationTerrainByCoord());
            resolver.updateOccupiedCoords(this.navigationOccupiedCoords());
            resolver.updateRoutes(this.map.pathRoutes);
        }
        this.revalidateHeroMovementAfterMapMutation();
    }
    revalidateHeroMovementAfterMapMutation() {
        if (!this.heroStateV2)
            return;
        this.heroMovementDirty = true;
        this.stabilizeHeroMovement();
    }
    canOccupyTowerFootprint(typeId, coord, ignoreTowerId, analysisContext) {
        const type = this.towerTypes[typeId];
        if (!type) {
            return this.fail("Unknown tower type.", "reason.unknownTower");
        }
        if (type.requiresAuraFrom && !this.isInsideSupportAura(type.requiresAuraFrom, coord)) {
            return this.fail(`${type.label} needs a support aura.`, "reason.needsAura", { tower: typeId });
        }
        const footprint = this.map.tilesWithin(coord, type.footprintRadius);
        if (footprint.length === 0) {
            return this.fail("Outside map.", "reason.outsideMap");
        }
        const expectedFootprintSize = this.map.footprintSize(type.footprintRadius);
        if (footprint.length < expectedFootprintSize) {
            return this.fail("Tower does not fit.", "reason.noFit");
        }
        for (const tile of footprint) {
            if (tile.terrain === "water") {
                return this.fail("Cannot build on water.", "reason.water");
            }
            if (!this.content.terrainTypes[tile.terrain]?.buildable) {
                return this.fail("Can only build outside the path.", "reason.path");
            }
            if (tile.occupiedBy && tile.occupiedBy !== ignoreTowerId) {
                return this.fail("Another tower already occupies this tile.", "reason.occupied");
            }
        }
        return this.canPreserveDynamicNavigation(footprint, ignoreTowerId, analysisContext);
    }
    dependentsKeepSupportAfterMove(sourceTowerId, nextCoord) {
        const sourceTower = this.towers.find((tower) => tower.id === sourceTowerId);
        if (!sourceTower) {
            return false;
        }
        const sourceType = this.towerTypes[sourceTower.typeId];
        if (!sourceType || sourceType.attack.kind !== "support") {
            return true;
        }
        const unlocked = new Set(sourceType.attack.unlocksTowerIds);
        const otherSources = this.towers.filter((tower) => tower.typeId === sourceTower.typeId && tower.id !== sourceTowerId);
        const movedRange = this.towerRange(sourceTower);
        return this.towers.every((tower) => {
            if (!unlocked.has(tower.typeId)) {
                return true;
            }
            if (this.map.distance(nextCoord, tower.coord) <= movedRange) {
                return true;
            }
            return otherSources.some((source) => this.map.distance(source.coord, tower.coord) <= this.towerRange(source));
        });
    }
    dependentsKeepSupportAfterRemoval(sourceTowerId) {
        const sourceTower = this.towers.find((tower) => tower.id === sourceTowerId);
        if (!sourceTower)
            return false;
        const sourceType = this.towerTypes[sourceTower.typeId];
        if (!sourceType || sourceType.attack.kind !== "support")
            return true;
        const unlocked = new Set(sourceType.attack.unlocksTowerIds);
        const otherSources = this.towers.filter((tower) => tower.typeId === sourceTower.typeId && tower.id !== sourceTowerId);
        return this.towers.every((tower) => {
            if (tower.id === sourceTowerId || !unlocked.has(tower.typeId))
                return true;
            return otherSources.some((source) => this.map.distance(source.coord, tower.coord) <= this.towerRange(source));
        });
    }
    applyPassiveIncome(delta) {
        const passive = this.mission.economy?.passivePerTimeUnit;
        if (!passive || delta <= 0)
            return;
        this.addResources(this.scaleBag(passive, delta));
    }
    awardClearedWaveIncome() {
        while (this.clearedWaveCount < this.startedWaveCount) {
            const waveIndex = this.clearedWaveCount;
            const income = this.normalizeCost(this.mission.economy?.perWaveClear ?? {});
            const interest = this.cloneResources({});
            const rate = Math.max(0, this.mission.economy?.interestRate ?? 0);
            const cap = this.mission.economy?.interestCap;
            for (const currencyId of this.currencyIds) {
                const raw = Math.max(0, (this.resources[currencyId] ?? 0) * rate);
                const max = Number(cap?.[currencyId]);
                interest[currencyId] = Number.isFinite(max) && max >= 0 ? Math.min(raw, max) : raw;
            }
            this.addResources(income);
            this.addResources(interest);
            this.clearedWaveCount += 1;
            this.lastEvents.push({ type: "waveCleared", waveIndex, income, interest });
            const heroDefinition = (this.activeHeroesMechanics?.schemaVersion === 5
                || this.activeHeroesMechanics?.schemaVersion === 6) && this.heroStateV2
                ? this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]
                : undefined;
            const tree = heroDefinition?.skillTree;
            const amount = tree?.points.perInterwave ?? 0;
            if (tree && amount > 0 && waveIndex + 1 < this.mission.waves.length
                && this.heroStateV2?.skillPoints !== undefined) {
                const previousPoints = this.heroStateV2.skillPoints;
                this.heroStateV2.skillPoints += amount;
                this.lastEvents.push({
                    type: "heroSkillPointsGranted",
                    heroId: this.heroStateV2.definitionId,
                    heroDefinitionId: this.heroStateV2.definitionId,
                    waveIndex,
                    previousPoints,
                    currentPoints: this.heroStateV2.skillPoints,
                    amount
                });
            }
        }
    }
    createDraftOfferAfterWave(afterWaveIndex) {
        const draft = this.activeRogueliteMechanics?.draft;
        const rng = this.draftRng;
        if (!draft || !rng || this.pendingDraftOffer || afterWaveIndex + 1 >= this.mission.waves.length)
            return;
        const poolId = draft.defaultPoolId;
        if (this.nextDraftOfferSequence !== afterWaveIndex + 1)
            return;
        const selected = sampleDraftOfferCardIds(draft, poolId, rng);
        const sequence = this.nextDraftOfferSequence;
        this.nextDraftOfferSequence += 1;
        this.pendingDraftOffer = Object.freeze({
            offerId: `draft_offer_${sequence}`,
            afterWaveIndex,
            poolId,
            cardIds: selected
        });
        this.nextWaveStartAt = null;
        this.prepRemaining = 0;
        this.rebuildRogueliteSynergies();
    }
    removeDeadEnemies() {
        const survivors = [];
        const spawned = [];
        for (const enemy of this.enemies) {
            if (enemy.hp > 0) {
                survivors.push(enemy);
                continue;
            }
            delete this.enemyShields[enemy.id];
            delete this.enemyMarks[enemy.id];
            delete this.enemyExposures[enemy.id];
            this.navigationEnemyFields?.delete(enemy.id);
            const killedBeforeEndpoint = enemy.navigation
                ? !this.dynamicEnemyAtGoal(enemy)
                : enemy.pathProgress < this.enemyTrack(enemy).length - 1;
            if (killedBeforeEndpoint) {
                const type = this.enemyTypes[enemy.typeId];
                if (!type) {
                    continue;
                }
                const reward = this.scaleBag(this.normalizeCost(type.reward), this.difficulty.enemyRewardMultiplier ?? 1);
                this.addResources(reward);
                this.killCount += 1;
                this.killCountByEnemyType[enemy.typeId] = (this.killCountByEnemyType[enemy.typeId] ?? 0) + 1;
                this.lastEvents.push({
                    type: "enemyKilled",
                    enemyId: enemy.id,
                    enemyTypeId: enemy.typeId,
                    coins: reward.coins ?? 0,
                    resources: reward
                });
                this.settleArtifactLoot(enemy);
                spawned.push(...this.spawnOnDeathChildren(enemy));
            }
        }
        this.enemies = [...survivors, ...spawned];
    }
    settleArtifactLoot(enemy) {
        const active = this.activeRogueliteMechanics;
        const rng = this.artifactRng;
        if (!active?.artifacts || !rng)
            return;
        const table = active.artifacts.bossLootTables[enemy.typeId];
        if (!table)
            return;
        const noDropWeight = table.noDropWeight ?? 0;
        const totalWeight = noDropWeight + table.entries.reduce((sum, entry) => sum + entry.weight, 0);
        for (let rollIndex = 0; rollIndex < table.rolls; rollIndex += 1) {
            let cursor = rng.nextInt(totalWeight);
            if (cursor < noDropWeight)
                continue;
            cursor -= noDropWeight;
            let selectedArtifactId;
            for (const entry of table.entries) {
                if (cursor < entry.weight) {
                    selectedArtifactId = entry.artifactId;
                    break;
                }
                cursor -= entry.weight;
            }
            const campaignArtifactLimit = this.campaignBattle
                ? this.campaignBattle.artifacts.length + this.campaignBattle.maxNewArtifactInstances
                : ROGUELITE_ARTIFACT_INVENTORY_LIMIT;
            if (!selectedArtifactId
                || this.artifactInventory.length >= ROGUELITE_ARTIFACT_INVENTORY_LIMIT
                || this.artifactInventory.length >= campaignArtifactLimit)
                continue;
            const artifactInstanceId = this.campaignBattle
                ? `campaign:${this.campaignBattle.launchId}:artifact:${this.nextArtifactInstanceSequence}`
                : `artifact_${this.nextArtifactInstanceSequence}`;
            this.nextArtifactInstanceSequence += 1;
            this.artifactInventory.push(Object.freeze({
                instanceId: artifactInstanceId,
                artifactId: selectedArtifactId,
                socket: null
            }));
            this.lastEvents.push({
                type: "artifactDropped",
                enemyId: enemy.id,
                enemyTypeId: enemy.typeId,
                artifactInstanceId,
                artifactId: selectedArtifactId,
                rollIndex
            });
        }
        this.rebuildRogueliteSynergies();
    }
    dynamicEnemyAtGoal(enemy) {
        if (!enemy.navigation || !enemy.routeId)
            return false;
        const goal = this.resolveDynamicNavigationRoute(enemy.routeId).pathCenterline.at(-1);
        return Boolean(goal
            && enemy.navigation.currentCoord.q === goal.q
            && enemy.navigation.currentCoord.r === goal.r);
    }
    spawnOnDeathChildren(parent) {
        const spawn = this.enemyTypes[parent.typeId]?.spawnOnDeath;
        if (!spawn || spawn.count <= 0) {
            return [];
        }
        const childRouteId = this.activeNavigationProfile
            ? parent.routeId
            : this.enemyTargetClassByType(spawn.enemyId) === "ground" ? parent.routeId : undefined;
        const children = [];
        for (let index = 0; index < spawn.count; index += 1) {
            const offset = spawn.pathOffsets?.[index] ?? 0;
            let child;
            if (this.activeNavigationProfile && parent.navigation && childRouteId) {
                child = this.createDynamicChildEnemyState(parent, spawn.enemyId, childRouteId, offset, spawn.forwardPathSteps);
            }
            else {
                const track = this.enemyTrackForType(spawn.enemyId, childRouteId);
                const trackEnd = Math.max(0, track.length - 1);
                const childProgress = Math.min(parent.pathProgress + spawn.forwardPathSteps, Math.max(0, trackEnd - 0.001));
                child = this.createEnemyState(spawn.enemyId, childProgress, offset, childRouteId);
            }
            if (child) {
                children.push(child);
            }
        }
        if (children.length > 0) {
            this.lastEvents.push({
                type: "enemySpawnedOnDeath",
                parentEnemyId: parent.id,
                parentEnemyTypeId: parent.typeId,
                enemyTypeId: spawn.enemyId,
                enemyIds: children.map((child) => child.id)
            });
        }
        return children;
    }
    resolveWaveState() {
        if (this.outcome !== "playing") {
            return;
        }
        if (this.startedWaveCount === 0) {
            this.waveState = "ready";
            this.prepRemaining = 0;
            return;
        }
        const battlefieldClear = this.spawnQueue.length === 0 && this.enemies.length === 0;
        if (battlefieldClear)
            this.awardClearedWaveIncome();
        const allWavesClear = this.startedWaveCount >= this.mission.waves.length && battlefieldClear;
        this.waveState = allWavesClear ? "complete" : battlefieldClear ? "between" : "spawning";
        this.syncPrepRemaining();
        const progress = this.buildObjectiveProgress();
        for (const objective of progress) {
            if (objective.complete && !this.completedObjectiveIds.has(objective.id)) {
                this.completedObjectiveIds.add(objective.id);
                this.lastEvents.push({ type: "objectiveCompleted", objectiveId: objective.id, kind: objective.kind });
            }
        }
        const failed = (this.mission.objectives?.failure ?? []).find((condition) => this.failureConditionMet(condition));
        if (failed) {
            this.outcome = "defeat";
            this.prepRemaining = 0;
            this.lastEvents.push({ type: "objectiveFailed", objectiveId: failed.id, kind: failed.kind });
            this.lastEvents.push({ type: "defeat" });
            return;
        }
        if (progress.length > 0 && progress.every((objective) => objective.complete)) {
            this.outcome = "victory";
            this.prepRemaining = 0;
            for (const star of this.mission.objectives?.stars ?? []) {
                if (this.starConditionMet(star) && !this.earnedStarIds.has(star.id)) {
                    this.earnedStarIds.add(star.id);
                    this.lastEvents.push({ type: "starEarned", starId: star.id });
                }
            }
            this.lastEvents.push({ type: "victory" });
            return;
        }
        if (battlefieldClear && this.clearedWaveCount > 0) {
            this.createDraftOfferAfterWave(this.clearedWaveCount - 1);
        }
    }
    victoryObjectives() {
        const authored = this.mission.objectives?.victory;
        return authored?.length ? authored : [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }];
    }
    buildObjectiveProgress() {
        return this.victoryObjectives().map((objective) => {
            let current = 0;
            let target = 1;
            if (objective.kind === "clearWaves") {
                current = this.clearedWaveCount;
                target = this.mission.waves.length;
            }
            else if (objective.kind === "surviveSeconds") {
                current = this.missionElapsed;
                target = objective.seconds;
            }
            else if (objective.kind === "killCount") {
                current = objective.enemyTypeId ? this.killCountByEnemyType[objective.enemyTypeId] ?? 0 : this.killCount;
                target = objective.count;
            }
            else if (objective.kind === "accumulateResource") {
                current = this.resources[objective.resourceId] ?? 0;
                target = objective.amount;
            }
            return {
                id: objective.id,
                label: objective.label || this.objectiveLabel(objective.kind),
                kind: objective.kind,
                current,
                target,
                complete: current + 0.000001 >= target
            };
        });
    }
    objectiveLabel(kind) {
        if (kind === "clearWaves")
            return "Clear all waves";
        if (kind === "surviveSeconds")
            return "Survive";
        if (kind === "killCount")
            return "Defeat enemies";
        return "Accumulate resources";
    }
    failureConditionMet(condition) {
        if (condition.kind === "maxLeaks")
            return this.leakCount > condition.maxLeaks;
        return this.missionElapsed > condition.seconds + 0.000001;
    }
    starConditionMet(condition) {
        if (condition.kind === "coreHpAtLeast")
            return this.coreHp + 0.000001 >= condition.amount;
        if (condition.kind === "maxLeaks")
            return this.leakCount <= condition.maxLeaks;
        if (condition.kind === "timeAtMost")
            return this.missionElapsed <= condition.seconds + 0.000001;
        return (this.resources[condition.resourceId] ?? 0) + 0.000001 >= condition.amount;
    }
    buildStarSnapshot() {
        return (this.mission.objectives?.stars ?? []).map((star) => ({
            id: star.id,
            label: star.label,
            achieved: this.outcome === "victory" && this.starConditionMet(star)
        }));
    }
    syncPrepRemaining() {
        this.prepRemaining = this.getNextWaveRemaining();
    }
    getNextWaveRemaining() {
        if (this.startedWaveCount === 0 || this.nextWaveStartAt === null) {
            return 0;
        }
        return Math.max(0, this.nextWaveStartAt - this.missionElapsed);
    }
    isPathBlockerType(typeId) {
        return this.enemyTypes[typeId]?.isPathBlocker === true;
    }
    enemyAvoidanceOffset(enemy) {
        if (enemy.hp <= 0 || this.isPathBlockerType(enemy.typeId)) {
            return 0;
        }
        const stump = this.enemies
            .filter((item) => item.hp > 0 && this.isPathBlockerType(item.typeId))
            .map((item) => ({
            enemy: item,
            distance: Math.abs(item.pathProgress - enemy.pathProgress)
        }))
            .filter((item) => {
            if (item.enemy.routeId !== enemy.routeId) {
                return false;
            }
            const radius = this.enemyTypes[item.enemy.typeId]?.pathCollisionRadius ?? 1.1;
            return item.distance <= radius + 0.8;
        })
            .sort((a, b) => a.distance - b.distance)[0];
        if (!stump) {
            return 0;
        }
        const numericId = Number(enemy.id.split("_")[1] ?? 0);
        const side = numericId % 2 === 0 ? 1 : -1;
        const stumpRadius = this.enemyTypes[stump.enemy.typeId]?.pathCollisionRadius ?? 1.1;
        const strength = 1 - stump.distance / (stumpRadius + 0.8);
        return side * Math.max(0, strength) * 0.68;
    }
    /** Build a full bag over the declared currency set, defaulting any missing currency to 0. */
    cloneResources(resources) {
        const bag = {};
        for (const id of this.currencyIds) {
            bag[id] = Number(resources?.[id]) || 0;
        }
        return bag;
    }
    normalizeMetaUpgradeLevels(input) {
        const levels = {};
        for (const [upgradeId, upgrade] of Object.entries(this.content.metaProgression.upgrades)) {
            const requested = Number(input[upgradeId]) || 0;
            levels[upgradeId] = Math.max(0, Math.min(upgrade.maxLevel, Math.floor(requested)));
        }
        return levels;
    }
    metaEffectTotal(kind, valueField) {
        let total = 0;
        for (const [upgradeId, upgrade] of Object.entries(this.content.metaProgression.upgrades)) {
            const level = this.metaUpgradeLevels[upgradeId] ?? 0;
            if (level <= 0)
                continue;
            for (const effect of upgrade.effects) {
                if (effect.kind !== kind)
                    continue;
                const value = Number(effect[valueField]) || 0;
                total += value * level;
            }
        }
        return total;
    }
    initialResources() {
        const resources = this.scaleBag(this.mission.startingResources, this.difficulty.startingResourceMultiplier ?? 1);
        for (const [upgradeId, upgrade] of Object.entries(this.content.metaProgression.upgrades)) {
            const level = this.metaUpgradeLevels[upgradeId] ?? 0;
            if (level <= 0)
                continue;
            for (const effect of upgrade.effects) {
                if (effect.kind !== "startingResource" || !this.currencyIds.includes(effect.resourceId))
                    continue;
                resources[effect.resourceId] = (resources[effect.resourceId] ?? 0) + effect.amountPerLevel * level;
            }
        }
        return resources;
    }
    cleanCoord(coord) {
        return { q: coord.q, r: coord.r };
    }
    normalizeCost(cost) {
        return this.cloneResources(cost);
    }
    hasResources(cost) {
        return this.currencyIds.every((id) => (this.resources[id] ?? 0) >= (Number(cost?.[id]) || 0));
    }
    spendResources(cost) {
        for (const id of this.currencyIds) {
            this.resources[id] = (this.resources[id] ?? 0) - (Number(cost?.[id]) || 0);
        }
    }
    addResources(resources) {
        for (const id of this.currencyIds) {
            this.resources[id] = (this.resources[id] ?? 0) + (Number(resources?.[id]) || 0);
        }
    }
    addToBag(target, resources) {
        for (const id of this.currencyIds)
            target[id] = (target[id] ?? 0) + (Number(resources?.[id]) || 0);
    }
    scaleBag(resources, factor) {
        const bag = this.cloneResources({});
        for (const id of this.currencyIds)
            bag[id] = (Number(resources?.[id]) || 0) * factor;
        return bag;
    }
    bagHasValue(resources) {
        return this.currencyIds.some((id) => Math.abs(resources[id] ?? 0) > 0.000001);
    }
    formatCost(cost) {
        const normalized = this.normalizeCost(cost);
        const parts = [];
        for (const currency of this.currencies) {
            const amount = normalized[currency.id] ?? 0;
            if (amount > 0)
                parts.push(`${amount} ${currency.label}`);
        }
        return parts.join(" and ") || "resources";
    }
    fail(reason, reasonKey, reasonParams) {
        return { ok: false, reason, reasonKey, reasonParams };
    }
    costReasonParams(cost) {
        return this.normalizeCost(cost);
    }
}
