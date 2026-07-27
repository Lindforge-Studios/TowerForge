export const TOWER_SCRIPT_SCOPES = Object.freeze([
    "global", "mission", "map", "wave", "tower", "enemy", "ability", "terrain"
]);
export const TOWER_SCRIPT_EVENTS = Object.freeze([
    "gameStarted", "tick", "towerPlaced", "towerSold", "towerMoved", "towerUpgraded", "towerDestroyed",
    "towerTargetModeChanged", "towerFired", "towerResourcesGranted", "towerShieldChanged", "enemyHit", "enemyShieldChanged", "enemyKilled", "enemyLeaked",
    "enemyMarkChanged",
    "enemyExposureChanged", "enemyReactionTriggered",
    "enemySpawnedOnDeath", "enemyPhaseSpawned", "waveStarted", "waveCleared", "resourcesGranted", "abilityUsed",
    "enemyEnteredTile", "terrainChanged", "elevationChanged", "objectiveCompleted", "objectiveFailed", "starEarned", "victory", "defeat", "signal"
]);
export const TOWER_SCRIPT_OPERATORS = Object.freeze([
    "eq", "ne", "gt", "gte", "lt", "lte", "and", "or", "not", "add", "sub", "mul", "div", "min", "max", "coalesce"
]);
export const TOWER_SCRIPT_TARGETS = Object.freeze({
    entity: ["self", "eventEnemy", "eventTower", "allEnemies", "allTowers"],
    enemy: ["self", "eventEnemy", "allEnemies"],
    tower: ["self", "eventTower", "allTowers"]
});
export const TOWER_SCRIPT_ACTION_SCHEMA = Object.freeze({
    grantResource: { required: { resourceId: "runtime currency id", amount: "expression" } },
    damageCore: { required: { amount: "expression >= 0" } },
    healCore: { required: { amount: "expression >= 0" } },
    damageEnemy: { required: { target: "enemy target", amount: "expression >= 0" } },
    healEnemy: { required: { target: "enemy target", amount: "expression >= 0" } },
    restoreEnemyShield: { required: { target: "enemy target", amount: "expression >= 0" } },
    restoreTowerShield: { required: { target: "tower target", amount: "expression >= 0" } },
    applyEnemyMark: {
        required: { target: "enemy target", markId: "existing mark id" },
        optional: { stacks: "expression; integer >= 1; defaults to 1" }
    },
    clearEnemyMark: { required: { target: "enemy target", markId: "existing mark id" } },
    applyEnemyExposure: {
        required: { target: "enemy target", exposureId: "existing exposure id" },
        optional: { stacks: "expression; integer >= 1; defaults to 1" }
    },
    clearEnemyExposure: { required: { target: "enemy target", exposureId: "existing exposure id" } },
    applyStatus: { required: { target: "enemy target", status: "StatusEffectSpec" } },
    setTowerCooldown: { required: { target: "tower target", value: "expression >= 0" } },
    addTowerStacks: { required: { target: "tower target", amount: "expression; truncated to an integer" } },
    spawnEnemy: {
        required: { enemyTypeId: "existing enemy type id" },
        optional: { count: "expression; integer 0..32", routeId: "existing route id", pathProgress: "expression >= 0" }
    },
    setTileTerrain: {
        required: { target: '"eventTile" or {q: expression, r: expression}', terrainId: "existing terrain id" },
        optional: { duration: "expression > 0; omitted persists until reset or restore" }
    },
    restoreTileTerrain: { required: { target: '"eventTile" or {q: expression, r: expression}' } },
    terraformTiles: {
        required: { operations: "1..64 closed terraform operations" },
        optional: { duration: "expression > 0; allowed only when all operations are set_*" },
        additionalProperties: false,
        minimumSchemaVersion: 6,
        operationKinds: ["set_terrain", "restore_terrain", "set_elevation", "restore_elevation"]
    },
    setState: { required: { key: "safe identifier", value: "expression" } },
    incrementState: { required: { key: "safe identifier" }, optional: { amount: "expression; defaults to 1" } },
    emitSignal: { required: { signal: "safe identifier" }, optional: { payload: "JSON expression" } }
});
export const TOWER_SCRIPT_EVENT_FIELDS = Object.freeze({
    gameStarted: ["type"],
    tick: ["type", "delta"],
    towerPlaced: ["type", "towerId", "towerTypeId"],
    towerSold: ["type", "towerId", "towerTypeId", "refund"],
    towerMoved: ["type", "towerId", "from", "to", "cost"],
    towerUpgraded: ["type", "towerId", "level", "stacks", "branchId", "baseTypeId", "typeId"],
    towerDestroyed: ["type", "towerId", "towerTypeId", "enemyId"],
    towerTargetModeChanged: ["type", "towerId", "mode"],
    towerFired: ["type", "towerId", "enemyId", "damage"],
    towerResourcesGranted: ["type", "towerId", "enemyId", "resources"],
    towerShieldChanged: ["type", "towerId", "towerTypeId", "previous", "current", "capacity", "cause", "amount", "overflowDamage"],
    enemyHit: ["type", "towerId", "enemyId", "enemyTypeId", "damage"],
    enemyShieldChanged: ["type", "enemyId", "enemyTypeId", "previous", "current", "capacity", "cause", "amount", "overflowDamage"],
    enemyMarkChanged: [
        "type", "enemyId", "enemyTypeId", "markId", "previousStacks", "currentStacks",
        "previousRemaining", "remaining", "cause"
    ],
    enemyExposureChanged: [
        "type", "enemyId", "enemyTypeId", "exposureId", "previousStacks", "currentStacks",
        "previousRemaining", "remaining", "cause"
    ],
    enemyReactionTriggered: [
        "type", "reactionId", "originEnemyId", "originEnemyTypeId", "originCoord",
        "triggerDamageType", "depth", "scheduledTargetIds"
    ],
    enemyKilled: ["type", "enemyId", "enemyTypeId", "coins", "resources"],
    enemyLeaked: ["type", "enemyId", "enemyTypeId", "damage"],
    enemySpawnedOnDeath: ["type", "parentEnemyId", "parentEnemyTypeId", "enemyTypeId", "enemyIds"],
    enemyPhaseSpawned: ["type", "parentEnemyId", "parentEnemyTypeId", "enemyTypeId", "enemyIds", "hpRatio"],
    waveStarted: ["type", "waveIndex"],
    waveCleared: ["type", "waveIndex", "income", "interest"],
    resourcesGranted: ["type", "source", "waveIndex", "resources"],
    abilityUsed: ["type", "abilityId", "center", "enemyIds", "effects"],
    enemyEnteredTile: ["type", "enemyId", "enemyTypeId", "coord", "terrain", "terrainMetadata", "routeId", "pathOrder"],
    terrainChanged: ["type", "coord", "fromTerrain", "toTerrain", "terrainMetadata", "source"],
    elevationChanged: ["type", "coord", "fromElevation", "toElevation", "source"],
    objectiveCompleted: ["type", "objectiveId", "kind"],
    objectiveFailed: ["type", "objectiveId", "kind"],
    starEarned: ["type", "starId"],
    victory: ["type"],
    defeat: ["type"],
    signal: ["type", "signal", "payload", "sourceScriptId"]
});
export const TOWER_SCRIPT_LIMITS = Object.freeze({
    scriptsPerProject: 128,
    initialStateBytes: 16_384,
    handlersPerEvent: 64,
    actionsPerHandler: 64,
    expressionDepth: 12,
    expressionOperationsPerHandler: 512,
    actionsPerTransaction: 512,
    eventsPerTransaction: 512,
    signalRecursionDepth: 8,
    spawnedEnemiesPerAction: 32,
    terrainChangesPerTransaction: 64,
    activeTerrainOverrides: 512,
    stateBytesPerBinding: 65_536,
    externalSignalPayloadBytes: 65_536,
    retainedDiagnostics: 32
});
export const TOWER_SCRIPT_GRAPH_DESCRIPTOR = Object.freeze({
    schemaVersion: 1,
    canonicalAst: true,
    projection: "lossless",
    unknownNodes: "raw_lossless",
    layoutStorage: ".towerforge/towerscript-layouts",
    layoutPattern: ".towerforge/towerscript-layouts/**/*.layout.json",
    layoutInGameplayPackages: false
});
export const TOWER_SCRIPT_DEBUG_DESCRIPTOR = Object.freeze({
    schemaVersion: 1,
    optIn: true,
    stepModes: Object.freeze(["tick", "event", "handler", "action"]),
    actionStepping: "checkpoint_replay_to_cursor",
    analysis: Object.freeze({
        tool: "preview_tower_script_trace",
        computeOnly: true,
        maxCommands: 128,
        writesProjectFiles: false
    }),
    rewind: Object.freeze({ bounded: true, maxCheckpointRingCapacity: 2_048 }),
    trace: Object.freeze({
        schemaVersion: 1,
        phases: Object.freeze(["event", "binding", "handler", "condition", "action", "state_diff", "diagnostic"]),
        retention: "bounded_in_memory",
        maxEntries: 16_384,
        persistedInSnapshot: false,
        persistedInCheckpoint: false,
        includedInStateDigest: false
    }),
    mismatchPolicy: "reject_engine_content_checkpoint_or_replay_mismatch"
});
export const TOWER_SCRIPT_COMPLETION_DESCRIPTOR = Object.freeze({
    source: "engine_schema_descriptor",
    catalog: Object.freeze({
        events: Object.freeze(TOWER_SCRIPT_EVENTS.map((name) => Object.freeze({
            name,
            fields: TOWER_SCRIPT_EVENT_FIELDS[name]
        }))),
        actions: Object.freeze(Object.keys(TOWER_SCRIPT_ACTION_SCHEMA).sort().map((name) => Object.freeze({
            name,
            descriptor: TOWER_SCRIPT_ACTION_SCHEMA[name]
        }))),
        operators: Object.freeze(TOWER_SCRIPT_OPERATORS.map((name) => Object.freeze({ name }))),
        scopes: Object.freeze(TOWER_SCRIPT_SCOPES.map((name) => Object.freeze({ name })))
    })
});
export const TOWER_SCRIPT_SCHEMA = Object.freeze({
    schemaVersion: 6,
    supportedSchemaVersions: Object.freeze([1, 2, 3, 4, 5, 6]),
    filePattern: "scripts/**/*.tower.json",
    semantics: "Deterministic JSON rules interpreted by the engine; never executable host code.",
    graph: TOWER_SCRIPT_GRAPH_DESCRIPTOR,
    debug: TOWER_SCRIPT_DEBUG_DESCRIPTOR,
    completion: TOWER_SCRIPT_COMPLETION_DESCRIPTOR,
    developerExperience: Object.freeze({
        optIn: true,
        gameplayCapability: false,
        trace: TOWER_SCRIPT_DEBUG_DESCRIPTOR.trace,
        debugger: TOWER_SCRIPT_DEBUG_DESCRIPTOR,
        visualGraph: TOWER_SCRIPT_GRAPH_DESCRIPTOR,
        completion: TOWER_SCRIPT_COMPLETION_DESCRIPTOR
    }),
    bindingRules: {
        global: "ids forbidden",
        otherScopes: "ids optional; omitted means all objects in the scope; provided ids must exist"
    },
    scopes: TOWER_SCRIPT_SCOPES,
    events: TOWER_SCRIPT_EVENTS,
    eventFields: TOWER_SCRIPT_EVENT_FIELDS,
    expression: {
        literals: "JSON values",
        get: { $get: "event|self|state|game path" },
        operator: { $op: "operator", args: "expression[]" },
        operators: TOWER_SCRIPT_OPERATORS,
        contextRoots: ["event", "self", "state", "game"],
        gameFields: [
            "missionId", "mapId", "difficultyId", "elapsed", "waveIndex", "startedWaveCount", "clearedWaveCount",
            "killCount", "leakCount", "coreHp", "maxCoreHp", "resources", "enemyCount", "towerCount", "outcome"
        ]
    },
    targets: TOWER_SCRIPT_TARGETS,
    actions: TOWER_SCRIPT_ACTION_SCHEMA,
    diagnostic: Object.freeze({
        requiredFields: Object.freeze(["scriptId", "event", "code", "message"]),
        optionalFields: Object.freeze(["handlerId", "reasonKey"]),
        additionalProperties: false
    }),
    limits: TOWER_SCRIPT_LIMITS,
    example: {
        schemaVersion: 1,
        id: "kill_bonus",
        bindings: [{ scope: "global" }],
        handlers: {
            enemyKilled: [{ actions: [{ action: "grantResource", resourceId: "coins", amount: 1 }] }]
        }
    }
});
