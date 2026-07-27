export declare const TOWER_SCRIPT_SCOPES: readonly ("map" | "global" | "mission" | "wave" | "tower" | "enemy" | "ability" | "terrain")[];
export declare const TOWER_SCRIPT_EVENTS: readonly ("gameStarted" | "tick" | "towerPlaced" | "towerSold" | "towerMoved" | "towerUpgraded" | "towerDestroyed" | "towerTargetModeChanged" | "towerFired" | "towerResourcesGranted" | "towerShieldChanged" | "enemyHit" | "enemyShieldChanged" | "enemyMarkChanged" | "enemyExposureChanged" | "enemyReactionTriggered" | "enemyKilled" | "enemyLeaked" | "enemySpawnedOnDeath" | "enemyPhaseSpawned" | "waveStarted" | "waveCleared" | "resourcesGranted" | "abilityUsed" | "enemyEnteredTile" | "terrainChanged" | "elevationChanged" | "objectiveCompleted" | "objectiveFailed" | "starEarned" | "victory" | "defeat" | "signal")[];
export declare const TOWER_SCRIPT_OPERATORS: readonly ("eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "and" | "or" | "not" | "add" | "sub" | "mul" | "div" | "min" | "max" | "coalesce")[];
export declare const TOWER_SCRIPT_TARGETS: Readonly<{
    entity: ("self" | "eventEnemy" | "eventTower" | "allEnemies" | "allTowers")[];
    enemy: ("self" | "eventEnemy" | "allEnemies")[];
    tower: ("self" | "eventTower" | "allTowers")[];
}>;
export declare const TOWER_SCRIPT_ACTION_SCHEMA: Readonly<{
    grantResource: {
        required: {
            resourceId: string;
            amount: string;
        };
    };
    damageCore: {
        required: {
            amount: string;
        };
    };
    healCore: {
        required: {
            amount: string;
        };
    };
    damageEnemy: {
        required: {
            target: string;
            amount: string;
        };
    };
    healEnemy: {
        required: {
            target: string;
            amount: string;
        };
    };
    restoreEnemyShield: {
        required: {
            target: string;
            amount: string;
        };
    };
    restoreTowerShield: {
        required: {
            target: string;
            amount: string;
        };
    };
    applyEnemyMark: {
        required: {
            target: string;
            markId: string;
        };
        optional: {
            stacks: string;
        };
    };
    clearEnemyMark: {
        required: {
            target: string;
            markId: string;
        };
    };
    applyEnemyExposure: {
        required: {
            target: string;
            exposureId: string;
        };
        optional: {
            stacks: string;
        };
    };
    clearEnemyExposure: {
        required: {
            target: string;
            exposureId: string;
        };
    };
    applyStatus: {
        required: {
            target: string;
            status: string;
        };
    };
    setTowerCooldown: {
        required: {
            target: string;
            value: string;
        };
    };
    addTowerStacks: {
        required: {
            target: string;
            amount: string;
        };
    };
    spawnEnemy: {
        required: {
            enemyTypeId: string;
        };
        optional: {
            count: string;
            routeId: string;
            pathProgress: string;
        };
    };
    setTileTerrain: {
        required: {
            target: string;
            terrainId: string;
        };
        optional: {
            duration: string;
        };
    };
    restoreTileTerrain: {
        required: {
            target: string;
        };
    };
    terraformTiles: {
        required: {
            operations: string;
        };
        optional: {
            duration: string;
        };
        additionalProperties: false;
        minimumSchemaVersion: number;
        operationKinds: string[];
    };
    setState: {
        required: {
            key: string;
            value: string;
        };
    };
    incrementState: {
        required: {
            key: string;
        };
        optional: {
            amount: string;
        };
    };
    emitSignal: {
        required: {
            signal: string;
        };
        optional: {
            payload: string;
        };
    };
}>;
export declare const TOWER_SCRIPT_EVENT_FIELDS: Readonly<{
    gameStarted: string[];
    tick: string[];
    towerPlaced: string[];
    towerSold: string[];
    towerMoved: string[];
    towerUpgraded: string[];
    towerDestroyed: string[];
    towerTargetModeChanged: string[];
    towerFired: string[];
    towerResourcesGranted: string[];
    towerShieldChanged: string[];
    enemyHit: string[];
    enemyShieldChanged: string[];
    enemyMarkChanged: string[];
    enemyExposureChanged: string[];
    enemyReactionTriggered: string[];
    enemyKilled: string[];
    enemyLeaked: string[];
    enemySpawnedOnDeath: string[];
    enemyPhaseSpawned: string[];
    waveStarted: string[];
    waveCleared: string[];
    resourcesGranted: string[];
    abilityUsed: string[];
    enemyEnteredTile: string[];
    terrainChanged: string[];
    elevationChanged: string[];
    objectiveCompleted: string[];
    objectiveFailed: string[];
    starEarned: string[];
    victory: string[];
    defeat: string[];
    signal: string[];
}>;
export declare const TOWER_SCRIPT_LIMITS: Readonly<{
    scriptsPerProject: 128;
    initialStateBytes: 16384;
    handlersPerEvent: 64;
    actionsPerHandler: 64;
    expressionDepth: 12;
    expressionOperationsPerHandler: 512;
    actionsPerTransaction: 512;
    eventsPerTransaction: 512;
    signalRecursionDepth: 8;
    spawnedEnemiesPerAction: 32;
    terrainChangesPerTransaction: 64;
    activeTerrainOverrides: 512;
    stateBytesPerBinding: 65536;
    externalSignalPayloadBytes: 65536;
    retainedDiagnostics: 32;
}>;
export declare const TOWER_SCRIPT_GRAPH_DESCRIPTOR: Readonly<{
    schemaVersion: 1;
    canonicalAst: true;
    projection: "lossless";
    unknownNodes: "raw_lossless";
    layoutStorage: ".towerforge/towerscript-layouts";
    layoutPattern: ".towerforge/towerscript-layouts/**/*.layout.json";
    layoutInGameplayPackages: false;
}>;
export declare const TOWER_SCRIPT_DEBUG_DESCRIPTOR: Readonly<{
    schemaVersion: 1;
    optIn: true;
    stepModes: readonly ["tick", "event", "handler", "action"];
    actionStepping: "checkpoint_replay_to_cursor";
    analysis: Readonly<{
        tool: "preview_tower_script_trace";
        computeOnly: true;
        maxCommands: 128;
        writesProjectFiles: false;
    }>;
    rewind: Readonly<{
        bounded: true;
        maxCheckpointRingCapacity: 2048;
    }>;
    trace: Readonly<{
        schemaVersion: 1;
        phases: readonly ["event", "binding", "handler", "condition", "action", "state_diff", "diagnostic"];
        retention: "bounded_in_memory";
        maxEntries: 16384;
        persistedInSnapshot: false;
        persistedInCheckpoint: false;
        includedInStateDigest: false;
    }>;
    mismatchPolicy: "reject_engine_content_checkpoint_or_replay_mismatch";
}>;
export declare const TOWER_SCRIPT_COMPLETION_DESCRIPTOR: Readonly<{
    source: "engine_schema_descriptor";
    catalog: Readonly<{
        events: readonly Readonly<{
            name: "gameStarted" | "tick" | "towerPlaced" | "towerSold" | "towerMoved" | "towerUpgraded" | "towerDestroyed" | "towerTargetModeChanged" | "towerFired" | "towerResourcesGranted" | "towerShieldChanged" | "enemyHit" | "enemyShieldChanged" | "enemyMarkChanged" | "enemyExposureChanged" | "enemyReactionTriggered" | "enemyKilled" | "enemyLeaked" | "enemySpawnedOnDeath" | "enemyPhaseSpawned" | "waveStarted" | "waveCleared" | "resourcesGranted" | "abilityUsed" | "enemyEnteredTile" | "terrainChanged" | "elevationChanged" | "objectiveCompleted" | "objectiveFailed" | "starEarned" | "victory" | "defeat" | "signal";
            fields: string[];
        }>[];
        actions: readonly Readonly<{
            name: string;
            descriptor: {
                required: {
                    resourceId: string;
                    amount: string;
                };
            } | {
                required: {
                    amount: string;
                };
            } | {
                required: {
                    amount: string;
                };
            } | {
                required: {
                    target: string;
                    amount: string;
                };
            } | {
                required: {
                    target: string;
                    amount: string;
                };
            } | {
                required: {
                    target: string;
                    amount: string;
                };
            } | {
                required: {
                    target: string;
                    amount: string;
                };
            } | {
                required: {
                    target: string;
                    markId: string;
                };
                optional: {
                    stacks: string;
                };
            } | {
                required: {
                    target: string;
                    markId: string;
                };
            } | {
                required: {
                    target: string;
                    exposureId: string;
                };
                optional: {
                    stacks: string;
                };
            } | {
                required: {
                    target: string;
                    exposureId: string;
                };
            } | {
                required: {
                    target: string;
                    status: string;
                };
            } | {
                required: {
                    target: string;
                    value: string;
                };
            } | {
                required: {
                    target: string;
                    amount: string;
                };
            } | {
                required: {
                    enemyTypeId: string;
                };
                optional: {
                    count: string;
                    routeId: string;
                    pathProgress: string;
                };
            } | {
                required: {
                    target: string;
                    terrainId: string;
                };
                optional: {
                    duration: string;
                };
            } | {
                required: {
                    target: string;
                };
            } | {
                required: {
                    operations: string;
                };
                optional: {
                    duration: string;
                };
                additionalProperties: false;
                minimumSchemaVersion: number;
                operationKinds: string[];
            } | {
                required: {
                    key: string;
                    value: string;
                };
            } | {
                required: {
                    key: string;
                };
                optional: {
                    amount: string;
                };
            } | {
                required: {
                    signal: string;
                };
                optional: {
                    payload: string;
                };
            };
        }>[];
        operators: readonly Readonly<{
            name: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "and" | "or" | "not" | "add" | "sub" | "mul" | "div" | "min" | "max" | "coalesce";
        }>[];
        scopes: readonly Readonly<{
            name: "map" | "global" | "mission" | "wave" | "tower" | "enemy" | "ability" | "terrain";
        }>[];
    }>;
}>;
export declare const TOWER_SCRIPT_SCHEMA: Readonly<{
    schemaVersion: 6;
    supportedSchemaVersions: readonly [1, 2, 3, 4, 5, 6];
    filePattern: "scripts/**/*.tower.json";
    semantics: "Deterministic JSON rules interpreted by the engine; never executable host code.";
    graph: Readonly<{
        schemaVersion: 1;
        canonicalAst: true;
        projection: "lossless";
        unknownNodes: "raw_lossless";
        layoutStorage: ".towerforge/towerscript-layouts";
        layoutPattern: ".towerforge/towerscript-layouts/**/*.layout.json";
        layoutInGameplayPackages: false;
    }>;
    debug: Readonly<{
        schemaVersion: 1;
        optIn: true;
        stepModes: readonly ["tick", "event", "handler", "action"];
        actionStepping: "checkpoint_replay_to_cursor";
        analysis: Readonly<{
            tool: "preview_tower_script_trace";
            computeOnly: true;
            maxCommands: 128;
            writesProjectFiles: false;
        }>;
        rewind: Readonly<{
            bounded: true;
            maxCheckpointRingCapacity: 2048;
        }>;
        trace: Readonly<{
            schemaVersion: 1;
            phases: readonly ["event", "binding", "handler", "condition", "action", "state_diff", "diagnostic"];
            retention: "bounded_in_memory";
            maxEntries: 16384;
            persistedInSnapshot: false;
            persistedInCheckpoint: false;
            includedInStateDigest: false;
        }>;
        mismatchPolicy: "reject_engine_content_checkpoint_or_replay_mismatch";
    }>;
    completion: Readonly<{
        source: "engine_schema_descriptor";
        catalog: Readonly<{
            events: readonly Readonly<{
                name: "gameStarted" | "tick" | "towerPlaced" | "towerSold" | "towerMoved" | "towerUpgraded" | "towerDestroyed" | "towerTargetModeChanged" | "towerFired" | "towerResourcesGranted" | "towerShieldChanged" | "enemyHit" | "enemyShieldChanged" | "enemyMarkChanged" | "enemyExposureChanged" | "enemyReactionTriggered" | "enemyKilled" | "enemyLeaked" | "enemySpawnedOnDeath" | "enemyPhaseSpawned" | "waveStarted" | "waveCleared" | "resourcesGranted" | "abilityUsed" | "enemyEnteredTile" | "terrainChanged" | "elevationChanged" | "objectiveCompleted" | "objectiveFailed" | "starEarned" | "victory" | "defeat" | "signal";
                fields: string[];
            }>[];
            actions: readonly Readonly<{
                name: string;
                descriptor: {
                    required: {
                        resourceId: string;
                        amount: string;
                    };
                } | {
                    required: {
                        amount: string;
                    };
                } | {
                    required: {
                        amount: string;
                    };
                } | {
                    required: {
                        target: string;
                        amount: string;
                    };
                } | {
                    required: {
                        target: string;
                        amount: string;
                    };
                } | {
                    required: {
                        target: string;
                        amount: string;
                    };
                } | {
                    required: {
                        target: string;
                        amount: string;
                    };
                } | {
                    required: {
                        target: string;
                        markId: string;
                    };
                    optional: {
                        stacks: string;
                    };
                } | {
                    required: {
                        target: string;
                        markId: string;
                    };
                } | {
                    required: {
                        target: string;
                        exposureId: string;
                    };
                    optional: {
                        stacks: string;
                    };
                } | {
                    required: {
                        target: string;
                        exposureId: string;
                    };
                } | {
                    required: {
                        target: string;
                        status: string;
                    };
                } | {
                    required: {
                        target: string;
                        value: string;
                    };
                } | {
                    required: {
                        target: string;
                        amount: string;
                    };
                } | {
                    required: {
                        enemyTypeId: string;
                    };
                    optional: {
                        count: string;
                        routeId: string;
                        pathProgress: string;
                    };
                } | {
                    required: {
                        target: string;
                        terrainId: string;
                    };
                    optional: {
                        duration: string;
                    };
                } | {
                    required: {
                        target: string;
                    };
                } | {
                    required: {
                        operations: string;
                    };
                    optional: {
                        duration: string;
                    };
                    additionalProperties: false;
                    minimumSchemaVersion: number;
                    operationKinds: string[];
                } | {
                    required: {
                        key: string;
                        value: string;
                    };
                } | {
                    required: {
                        key: string;
                    };
                    optional: {
                        amount: string;
                    };
                } | {
                    required: {
                        signal: string;
                    };
                    optional: {
                        payload: string;
                    };
                };
            }>[];
            operators: readonly Readonly<{
                name: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "and" | "or" | "not" | "add" | "sub" | "mul" | "div" | "min" | "max" | "coalesce";
            }>[];
            scopes: readonly Readonly<{
                name: "map" | "global" | "mission" | "wave" | "tower" | "enemy" | "ability" | "terrain";
            }>[];
        }>;
    }>;
    developerExperience: Readonly<{
        optIn: true;
        gameplayCapability: false;
        trace: Readonly<{
            schemaVersion: 1;
            phases: readonly ["event", "binding", "handler", "condition", "action", "state_diff", "diagnostic"];
            retention: "bounded_in_memory";
            maxEntries: 16384;
            persistedInSnapshot: false;
            persistedInCheckpoint: false;
            includedInStateDigest: false;
        }>;
        debugger: Readonly<{
            schemaVersion: 1;
            optIn: true;
            stepModes: readonly ["tick", "event", "handler", "action"];
            actionStepping: "checkpoint_replay_to_cursor";
            analysis: Readonly<{
                tool: "preview_tower_script_trace";
                computeOnly: true;
                maxCommands: 128;
                writesProjectFiles: false;
            }>;
            rewind: Readonly<{
                bounded: true;
                maxCheckpointRingCapacity: 2048;
            }>;
            trace: Readonly<{
                schemaVersion: 1;
                phases: readonly ["event", "binding", "handler", "condition", "action", "state_diff", "diagnostic"];
                retention: "bounded_in_memory";
                maxEntries: 16384;
                persistedInSnapshot: false;
                persistedInCheckpoint: false;
                includedInStateDigest: false;
            }>;
            mismatchPolicy: "reject_engine_content_checkpoint_or_replay_mismatch";
        }>;
        visualGraph: Readonly<{
            schemaVersion: 1;
            canonicalAst: true;
            projection: "lossless";
            unknownNodes: "raw_lossless";
            layoutStorage: ".towerforge/towerscript-layouts";
            layoutPattern: ".towerforge/towerscript-layouts/**/*.layout.json";
            layoutInGameplayPackages: false;
        }>;
        completion: Readonly<{
            source: "engine_schema_descriptor";
            catalog: Readonly<{
                events: readonly Readonly<{
                    name: "gameStarted" | "tick" | "towerPlaced" | "towerSold" | "towerMoved" | "towerUpgraded" | "towerDestroyed" | "towerTargetModeChanged" | "towerFired" | "towerResourcesGranted" | "towerShieldChanged" | "enemyHit" | "enemyShieldChanged" | "enemyMarkChanged" | "enemyExposureChanged" | "enemyReactionTriggered" | "enemyKilled" | "enemyLeaked" | "enemySpawnedOnDeath" | "enemyPhaseSpawned" | "waveStarted" | "waveCleared" | "resourcesGranted" | "abilityUsed" | "enemyEnteredTile" | "terrainChanged" | "elevationChanged" | "objectiveCompleted" | "objectiveFailed" | "starEarned" | "victory" | "defeat" | "signal";
                    fields: string[];
                }>[];
                actions: readonly Readonly<{
                    name: string;
                    descriptor: {
                        required: {
                            resourceId: string;
                            amount: string;
                        };
                    } | {
                        required: {
                            amount: string;
                        };
                    } | {
                        required: {
                            amount: string;
                        };
                    } | {
                        required: {
                            target: string;
                            amount: string;
                        };
                    } | {
                        required: {
                            target: string;
                            amount: string;
                        };
                    } | {
                        required: {
                            target: string;
                            amount: string;
                        };
                    } | {
                        required: {
                            target: string;
                            amount: string;
                        };
                    } | {
                        required: {
                            target: string;
                            markId: string;
                        };
                        optional: {
                            stacks: string;
                        };
                    } | {
                        required: {
                            target: string;
                            markId: string;
                        };
                    } | {
                        required: {
                            target: string;
                            exposureId: string;
                        };
                        optional: {
                            stacks: string;
                        };
                    } | {
                        required: {
                            target: string;
                            exposureId: string;
                        };
                    } | {
                        required: {
                            target: string;
                            status: string;
                        };
                    } | {
                        required: {
                            target: string;
                            value: string;
                        };
                    } | {
                        required: {
                            target: string;
                            amount: string;
                        };
                    } | {
                        required: {
                            enemyTypeId: string;
                        };
                        optional: {
                            count: string;
                            routeId: string;
                            pathProgress: string;
                        };
                    } | {
                        required: {
                            target: string;
                            terrainId: string;
                        };
                        optional: {
                            duration: string;
                        };
                    } | {
                        required: {
                            target: string;
                        };
                    } | {
                        required: {
                            operations: string;
                        };
                        optional: {
                            duration: string;
                        };
                        additionalProperties: false;
                        minimumSchemaVersion: number;
                        operationKinds: string[];
                    } | {
                        required: {
                            key: string;
                            value: string;
                        };
                    } | {
                        required: {
                            key: string;
                        };
                        optional: {
                            amount: string;
                        };
                    } | {
                        required: {
                            signal: string;
                        };
                        optional: {
                            payload: string;
                        };
                    };
                }>[];
                operators: readonly Readonly<{
                    name: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "and" | "or" | "not" | "add" | "sub" | "mul" | "div" | "min" | "max" | "coalesce";
                }>[];
                scopes: readonly Readonly<{
                    name: "map" | "global" | "mission" | "wave" | "tower" | "enemy" | "ability" | "terrain";
                }>[];
            }>;
        }>;
    }>;
    bindingRules: {
        global: string;
        otherScopes: string;
    };
    scopes: readonly ("map" | "global" | "mission" | "wave" | "tower" | "enemy" | "ability" | "terrain")[];
    events: readonly ("gameStarted" | "tick" | "towerPlaced" | "towerSold" | "towerMoved" | "towerUpgraded" | "towerDestroyed" | "towerTargetModeChanged" | "towerFired" | "towerResourcesGranted" | "towerShieldChanged" | "enemyHit" | "enemyShieldChanged" | "enemyMarkChanged" | "enemyExposureChanged" | "enemyReactionTriggered" | "enemyKilled" | "enemyLeaked" | "enemySpawnedOnDeath" | "enemyPhaseSpawned" | "waveStarted" | "waveCleared" | "resourcesGranted" | "abilityUsed" | "enemyEnteredTile" | "terrainChanged" | "elevationChanged" | "objectiveCompleted" | "objectiveFailed" | "starEarned" | "victory" | "defeat" | "signal")[];
    eventFields: Readonly<{
        gameStarted: string[];
        tick: string[];
        towerPlaced: string[];
        towerSold: string[];
        towerMoved: string[];
        towerUpgraded: string[];
        towerDestroyed: string[];
        towerTargetModeChanged: string[];
        towerFired: string[];
        towerResourcesGranted: string[];
        towerShieldChanged: string[];
        enemyHit: string[];
        enemyShieldChanged: string[];
        enemyMarkChanged: string[];
        enemyExposureChanged: string[];
        enemyReactionTriggered: string[];
        enemyKilled: string[];
        enemyLeaked: string[];
        enemySpawnedOnDeath: string[];
        enemyPhaseSpawned: string[];
        waveStarted: string[];
        waveCleared: string[];
        resourcesGranted: string[];
        abilityUsed: string[];
        enemyEnteredTile: string[];
        terrainChanged: string[];
        elevationChanged: string[];
        objectiveCompleted: string[];
        objectiveFailed: string[];
        starEarned: string[];
        victory: string[];
        defeat: string[];
        signal: string[];
    }>;
    expression: {
        literals: string;
        get: {
            $get: string;
        };
        operator: {
            $op: string;
            args: string;
        };
        operators: readonly ("eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "and" | "or" | "not" | "add" | "sub" | "mul" | "div" | "min" | "max" | "coalesce")[];
        contextRoots: string[];
        gameFields: string[];
    };
    targets: Readonly<{
        entity: ("self" | "eventEnemy" | "eventTower" | "allEnemies" | "allTowers")[];
        enemy: ("self" | "eventEnemy" | "allEnemies")[];
        tower: ("self" | "eventTower" | "allTowers")[];
    }>;
    actions: Readonly<{
        grantResource: {
            required: {
                resourceId: string;
                amount: string;
            };
        };
        damageCore: {
            required: {
                amount: string;
            };
        };
        healCore: {
            required: {
                amount: string;
            };
        };
        damageEnemy: {
            required: {
                target: string;
                amount: string;
            };
        };
        healEnemy: {
            required: {
                target: string;
                amount: string;
            };
        };
        restoreEnemyShield: {
            required: {
                target: string;
                amount: string;
            };
        };
        restoreTowerShield: {
            required: {
                target: string;
                amount: string;
            };
        };
        applyEnemyMark: {
            required: {
                target: string;
                markId: string;
            };
            optional: {
                stacks: string;
            };
        };
        clearEnemyMark: {
            required: {
                target: string;
                markId: string;
            };
        };
        applyEnemyExposure: {
            required: {
                target: string;
                exposureId: string;
            };
            optional: {
                stacks: string;
            };
        };
        clearEnemyExposure: {
            required: {
                target: string;
                exposureId: string;
            };
        };
        applyStatus: {
            required: {
                target: string;
                status: string;
            };
        };
        setTowerCooldown: {
            required: {
                target: string;
                value: string;
            };
        };
        addTowerStacks: {
            required: {
                target: string;
                amount: string;
            };
        };
        spawnEnemy: {
            required: {
                enemyTypeId: string;
            };
            optional: {
                count: string;
                routeId: string;
                pathProgress: string;
            };
        };
        setTileTerrain: {
            required: {
                target: string;
                terrainId: string;
            };
            optional: {
                duration: string;
            };
        };
        restoreTileTerrain: {
            required: {
                target: string;
            };
        };
        terraformTiles: {
            required: {
                operations: string;
            };
            optional: {
                duration: string;
            };
            additionalProperties: false;
            minimumSchemaVersion: number;
            operationKinds: string[];
        };
        setState: {
            required: {
                key: string;
                value: string;
            };
        };
        incrementState: {
            required: {
                key: string;
            };
            optional: {
                amount: string;
            };
        };
        emitSignal: {
            required: {
                signal: string;
            };
            optional: {
                payload: string;
            };
        };
    }>;
    diagnostic: Readonly<{
        requiredFields: readonly ["scriptId", "event", "code", "message"];
        optionalFields: readonly ["handlerId", "reasonKey"];
        additionalProperties: false;
    }>;
    limits: Readonly<{
        scriptsPerProject: 128;
        initialStateBytes: 16384;
        handlersPerEvent: 64;
        actionsPerHandler: 64;
        expressionDepth: 12;
        expressionOperationsPerHandler: 512;
        actionsPerTransaction: 512;
        eventsPerTransaction: 512;
        signalRecursionDepth: 8;
        spawnedEnemiesPerAction: 32;
        terrainChangesPerTransaction: 64;
        activeTerrainOverrides: 512;
        stateBytesPerBinding: 65536;
        externalSignalPayloadBytes: 65536;
        retainedDiagnostics: 32;
    }>;
    example: {
        schemaVersion: number;
        id: string;
        bindings: {
            scope: string;
        }[];
        handlers: {
            enemyKilled: {
                actions: {
                    action: string;
                    resourceId: string;
                    amount: number;
                }[];
            }[];
        };
    };
}>;
