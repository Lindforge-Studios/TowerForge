import { type GameContentRegistry } from "../content/registry.js";
import type { TowerScriptJson } from "../scripting/types.js";
import { GridMap } from "./map.js";
import { type NavigationAnalysisRequestV1, type NavigationAnalysisV1 } from "./navigation-analysis.js";
import { type LineOfSightAnalysisRequestV1, type LineOfSightAnalysisV1 } from "./line-of-sight.js";
import { type GameCheckpointV1 } from "./checkpoint.js";
import { type GameSeed } from "./rng.js";
import type { ActionResult, CurrencyDefinition, DifficultyDefinition, EnemyState, GameEvent, GameSnapshot, HexCoord, MissionAbilityId, ResourceBag, ResourceCost, TowerTargetMode, TowerState, WaveState } from "./types.js";
export interface CampaignBattleLoadoutV1 {
    readonly schemaVersion: 1;
    readonly launchId: string;
    readonly nodeId: string;
    readonly maxNewArtifactInstances: number;
    readonly deck: readonly {
        readonly instanceId: string;
        readonly cardId: string;
    }[];
    readonly artifacts: readonly {
        readonly instanceId: string;
        readonly artifactId: string;
    }[];
}
export interface CampaignBattleSettlementV1 {
    readonly schemaVersion: 1;
    readonly launchId: string;
    readonly nodeId: string;
    readonly missionId: string;
    readonly deck: readonly {
        readonly instanceId: string;
        readonly cardId: string;
    }[];
    readonly artifacts: readonly {
        readonly instanceId: string;
        readonly artifactId: string;
    }[];
}
export interface TowerDefenseGameOptions {
    missionId: string;
    content: GameContentRegistry;
    difficultyId?: string;
    /** Persistent profile input. The pure engine consumes levels but never reads or writes storage. */
    metaUpgradeLevels?: Record<string, number>;
    /** Deterministic simulation seed. Omitted legacy games use the stable numeric seed 0. */
    seed?: GameSeed;
    /** Optional, already content-validated campaign run loadout. Legacy games omit it. */
    campaignBattle?: CampaignBattleLoadoutV1;
}
interface TowerDefenseGameInternalOptions {
    skipGameStarted?: boolean;
}
export declare class TowerDefenseGame {
    readonly content: GameContentRegistry;
    readonly mission: GameContentRegistry["missions"][string];
    readonly map: GridMap;
    coreHp: number;
    resources: ResourceBag;
    waveIndex: number;
    startedWaveCount: number;
    waveState: WaveState;
    prepRemaining: number;
    outcome: GameSnapshot["outcome"];
    enemies: EnemyState[];
    towers: TowerState[];
    lastEvents: GameEvent[];
    readonly currencies: CurrencyDefinition[];
    readonly difficulty: DifficultyDefinition;
    private readonly currencyIds;
    private readonly metaUpgradeLevels;
    private readonly maxCoreHp;
    private readonly towerDamageMultiplier;
    private readonly towerFireRateMetaMultiplier;
    private readonly activeCombatMechanics;
    private readonly activeReactionsMechanics;
    private readonly activeNavigationProfile;
    private readonly activeNavigationProfileId;
    private readonly activeElevation;
    private readonly activeLineOfSightProfile;
    private readonly activeHighGroundProfile;
    private readonly activePhysicsMechanics;
    private readonly activeTerraformingMechanics;
    private readonly activeRogueliteMechanics;
    private readonly activeHeroesMechanics;
    private readonly heroesSnapshotV1;
    private heroStateV2;
    private heroMovementField;
    private readonly heroMovementLookupCache;
    private heroMovementDirty;
    private rogueliteSnapshot;
    private rogueliteDamageModifiers;
    private artifactDamageModifiersByTowerId;
    private artifactInitialRngState;
    private artifactRng;
    private artifactInventory;
    private nextArtifactInstanceSequence;
    /** Preserve historic artifact checkpoint v1 until a socket assignment first changes. */
    private artifactCheckpointForm;
    private draftInitialRngState;
    private draftRng;
    private nextDraftOfferSequence;
    private pendingDraftOffer;
    private draftSelections;
    private campaignBattle;
    private campaignDeck;
    private readonly navigationMandatoryPairs;
    private readonly navigationKnownPairs;
    private navigationResolver;
    private navigationFieldLookupCache;
    private navigationEnemyFields;
    private readonly combatShieldDefinitions;
    private enemyShields;
    private towerShields;
    private enemyMarks;
    private enemyExposures;
    private enemyCounter;
    private towerCounter;
    private clearedWaveCount;
    private killCount;
    private leakCount;
    private killCountByEnemyType;
    private completedObjectiveIds;
    private earnedStarIds;
    private spawnQueue;
    private missionElapsed;
    private nextWaveStartAt;
    private abilityCooldowns;
    private temporaryWaterTiles;
    private runtimeTerrainOverrides;
    private runtimeElevationOverrides;
    private pendingTerraformExpiryGroups;
    private nextTerraformExpirySequence;
    /** Preserve the nested checkpoint source form until native timed state is first committed. */
    private terraformingCheckpointForm;
    private readonly sunlightPathKeys;
    private readonly sunlightTilesSnapshot;
    private readonly directFlightLine;
    private readonly staticTilesSnapshot;
    private readonly staticPathCenterlineSnapshot;
    private readonly staticPathRoutesSnapshot;
    private readonly staticSpawnCoordSnapshot;
    private readonly staticCoreCoordSnapshot;
    private readonly staticElevationSnapshot;
    private readonly derivedMapIntegrityBaseline;
    private scriptValues;
    private scriptDiagnostics;
    private scriptHandlerLastRun;
    private scriptEventCursor;
    private scriptActionsRemaining;
    private scriptTerrainChangesRemaining;
    private scriptSignalDepth;
    private displacementStepAttemptsThisTick;
    private initialRngState;
    private rng;
    constructor(options: TowerDefenseGameOptions, internal?: TowerDefenseGameInternalOptions);
    get coins(): number;
    set coins(value: number);
    get towerTypes(): Record<string, import("./types.js").TowerType>;
    get enemyTypes(): Record<string, import("./types.js").EnemyType>;
    get waves(): import("./types.js").WaveDefinition[];
    reset(): void;
    startNextWave(): ActionResult;
    canPlaceTower(typeId: string, coord: HexCoord): ActionResult;
    canPlaceTowerAnywhere(typeId: string): ActionResult;
    placeTower(typeId: string, coord: HexCoord): ActionResult;
    canMoveTower(towerId: string, coord: HexCoord): ActionResult;
    moveTower(towerId: string, coord: HexCoord): ActionResult;
    canUpgradeTower(towerId: string): ActionResult;
    getTowerUpgradeCost(towerOrId: TowerState | string): ResourceCost | null;
    upgradeTower(towerId: string): ActionResult;
    canSocketArtifact(artifactInstanceId: string, towerId: string, slotId: string): ActionResult;
    socketArtifact(artifactInstanceId: string, towerId: string, slotId: string): ActionResult;
    canUnsocketArtifact(artifactInstanceId: string, towerId: string, slotId: string): ActionResult;
    unsocketArtifact(artifactInstanceId: string, towerId: string, slotId: string): ActionResult;
    chooseDraftOption(offerId: string, cardId: string): ActionResult;
    getTowerSellRefund(towerOrId: TowerState | string): ResourceBag | null;
    canSellTower(towerId: string): ActionResult;
    sellTower(towerId: string): ActionResult;
    setTowerTargetMode(towerId: string, mode: TowerTargetMode): ActionResult;
    usePathWaterAbility(center: HexCoord): ActionResult;
    private useActivePathWaterAbility;
    /**
     * The `strike`/`freeze` engine presets, expressed as the same composable effects a custom
     * ability declares via `MissionAbilityDefinition.effects`. Returns undefined for any other id
     * (including `path_water`, which stays on its own bespoke tile-targeting handler below — its
     * validation/failure modes are tile-specific, not enemy-targeted).
     */
    private builtinAbilityEffects;
    private displacementEffectRanks;
    private reserveDisplacementEffect;
    private safeAbilityEffectsForEvent;
    private applyAbilityEffect;
    /**
     * Trigger a mission ability at a target coord. `path_water` routes to its own handler (a
     * tile effect, not enemy-targeted). Every other ability — `strike`/`freeze` presets or a
     * custom author-declared one — resolves to an `effects[]` composition applied to every enemy
     * within `radius` of `center`, via the shared applyAbilityEffect primitive. A custom ability
     * needs no engine code: declare `effects` on it and it just works.
     */
    useAbility(abilityId: MissionAbilityId, center: HexCoord): ActionResult;
    /**
     * Dispatch an author-defined event into TowerScript. This is the only custom event bridge:
     * callers provide JSON data, while scripts still receive no executable host capability.
     */
    emitScriptSignal(signal: string, payload?: TowerScriptJson): ActionResult;
    getTowerIdAt(coord: HexCoord): string | undefined;
    /** Retarget the single opt-in v2 hero through a canonical shared flow field. */
    moveHero(heroId: string, target: HexCoord): ActionResult;
    /** Use the single deterministic enemy-targeted ability authored by an active heroes v4 profile. */
    useHeroAbility(heroId: string, abilityId: string, targetEnemyId: string): ActionResult;
    /** Atomically spend battle-local points on one authored v5 hero skill. */
    unlockHeroSkill(heroId: string, skillId: string): ActionResult;
    tick(deltaUnits: number): void;
    getSnapshot(): GameSnapshot;
    getRenderSnapshot(): GameSnapshot;
    /** Export only the portable run-owned result; sockets and other battle state never cross missions. */
    exportCampaignBattleSettlement(): CampaignBattleSettlementV1 | undefined;
    getCampaignBattleBinding(): Readonly<{
        launchId: string;
        nodeId: string;
        missionId: string;
    }> | undefined;
    /** Pure, bounded diagnostics for active opt-in elevation v2 line of sight. */
    analyzeLineOfSight(request: LineOfSightAnalysisRequestV1): LineOfSightAnalysisV1 | undefined;
    /** Pure, bounded diagnostics for active opt-in dynamic-flow navigation. */
    analyzeNavigation(request: NavigationAnalysisRequestV1): NavigationAnalysisV1 | undefined;
    createCheckpoint(): GameCheckpointV1;
    getStateDigest(): string;
    /**
     * Strictly validate and detach a checkpoint without constructing a map or
     * executing simulation behavior. Restore and journal decoders share this path.
     */
    static validateCheckpoint(options: {
        content: GameContentRegistry;
        checkpoint: GameCheckpointV1;
    }): GameCheckpointV1;
    static fromCheckpoint(options: {
        content: GameContentRegistry;
        checkpoint: GameCheckpointV1;
    }): TowerDefenseGame;
    private captureDerivedMapIntegrityBaseline;
    /**
     * Validate every mutable GridMap projection against authoritative game state.
     * This intentionally reads untrusted public structures through descriptors so
     * integrity checks never invoke a getter installed by a caller.
     */
    private assertDerivedMapIntegrity;
    private checkpointIdentity;
    private buildCombatState;
    private buildReactionState;
    private consumeNavigationAnalysisField;
    private buildNavigationAnalysisFields;
    private navigationDiagnosticPairs;
    private groupNavigationDiagnosticPairs;
    private buildNavigationFieldDiagnostics;
    private buildNavigationSnapshot;
    private buildElevationSnapshot;
    private buildArtifactCheckpointState;
    private buildDraftCheckpointState;
    private buildCheckpointState;
    private static validateCheckpointIdentity;
    private static validateCheckpointState;
    private restoreCheckpointState;
    private buildSnapshot;
    private initializeScripts;
    private beginScriptTransaction;
    private finishScriptedAction;
    private processScriptEvents;
    private runScriptEvent;
    private runScriptHandler;
    private scriptContexts;
    private scriptStateFor;
    private scriptExpressionContext;
    private applyScriptAction;
    private applyActiveLegacyTerrainAction;
    private resolveScriptTileTarget;
    private applyTerraformTilesAction;
    private applyResolvedPersistentOperations;
    private isNativeTerraformTargetOwned;
    private inspectTerraformOperationArray;
    private inspectTerraformOperation;
    private resolveTerraformTarget;
    private planPersistentTerrainCandidate;
    private planPersistentElevationCandidate;
    private planDynamicPersistentTerrainNavigation;
    private publishPersistentTerraformCandidate;
    private applyTerrainOverride;
    private restoreTerrainOverride;
    private restoreTerrainOverrideByKey;
    private syncTemporaryWaterTiles;
    private terrainMetadata;
    private resolveScriptEnemies;
    private resolveScriptTowers;
    private assertScriptStateSize;
    private recordScriptDiagnostic;
    private cloneScriptJsonObject;
    private cloneScriptValues;
    enemyCoord(enemy: EnemyState): HexCoord;
    private coordEquals;
    /** Resolve one opt-in displacement effect without adding persistent physics state. */
    private applyDisplacementEffect;
    private navigationMovementProfileId;
    private activeHeroesV2;
    private heroSkillManagementAvailable;
    private heroAbilitySkillModifiers;
    private buildHeroMovementField;
    private stabilizeHeroMovement;
    private moveHeroUnit;
    private updateHeroAbility;
    private navigationField;
    private createEnemyNavigationState;
    private createDynamicChildEnemyState;
    private stabilizeDynamicEnemyNavigation;
    private startWave;
    private startScheduledWaves;
    private buildSpawnQueue;
    private spawnDueEnemies;
    private createEnemyState;
    private initializeEnemyShield;
    private initializeTowerShield;
    private runtimeMarkApplicationCount;
    private applyEnemyMark;
    private clearEnemyMark;
    private updateEnemyMarks;
    private activeMarkDamageContext;
    private consumeResolvedMarks;
    private applySourceMarkBindings;
    private updateShieldRegeneration;
    private advanceNativeTerraformingExpiry;
    private updateAbilities;
    private updateEnemyStatuses;
    private buildAbilitySnapshot;
    private buildSunlightTilesSnapshot;
    private moveEnemies;
    private moveDynamicEnemies;
    private leakDynamicEnemy;
    private applyDotDamage;
    private isPulseTower;
    private firstPulseTowerTypeId;
    private pulseDotDamagePerUnit;
    private applySunlightRegeneration;
    private applyHealAuras;
    /** Boss pattern: enemies with `towerDisrupt` periodically silence towers within radius. */
    private updateTowerDisruptions;
    /** Boss pattern: enemies with `towerAttack` damage the nearest durable tower or opt-in durable hero. */
    private updateEnemyTowerAttacks;
    private artifactManagementAvailability;
    private replaceArtifactSocket;
    private autoUnsocketTowerArtifacts;
    private destroyTower;
    private rebuildRogueliteSynergies;
    private currentRogueliteSnapshot;
    private artifactManagementSnapshot;
    private updateTowers;
    private updateSingleTower;
    /**
     * Chain delivery: propagate a landed hit hop-by-hop to the nearest not-yet-hit ground enemy
     * within `jumpRadius` of the LAST-hit enemy (not the origin — a true chain, not a fixed-radius
     * splash), for up to `maxJumps` extra hits, each scaled by `damageFalloff^hop`. Deterministic:
     * ties broken by enemy id. Reuses applyTowerDamage so resistances/armor/statusOnHit apply to
     * every hop exactly as they would to a primary hit.
     */
    private propagateChain;
    private updatePulseTower;
    private updateSniperTower;
    private updateAntiAirTower;
    private updateSplashTower;
    private updatePipelineTower;
    private pipelineTargets;
    private applyPipelineEffect;
    private findSingleTarget;
    private findSniperTarget;
    private findAntiAirTargets;
    private findSplashTarget;
    private towerSupportsTargetMode;
    private selectTargets;
    private towerHasLineOfSight;
    private compareTargets;
    private compareDynamicTargets;
    private dynamicEnemyRemainingCost;
    private enemyInRange;
    private highGroundPair;
    private enemyInTowerAcquisitionRange;
    private towerRange;
    private slipperyJackInterval;
    private towerPulseRate;
    private enemyTrack;
    private enemyTrackForType;
    private enemyTargetClass;
    private enemyTargetClassByType;
    private enemyTerrainSpeedFactor;
    private enemyStatusSpeedFactor;
    private isEnemyInSunlight;
    private applyResolvedEnemyDamage;
    private applyResolvedCoreDamage;
    private applyResolvedTowerEntityDamage;
    private applyResolvedHeroDamage;
    private resolveAndApplyDamage;
    private planAndApplyReactions;
    private applyEnemyExposure;
    private updateEnemyExposures;
    private applyTowerDamage;
    private applyResolvedTowerDamage;
    private draftDamageModifiersForTower;
    /** The (author-defined) damage type a tower deals; defaults to "physical". */
    private damageTypeOf;
    /** "pierce_only" armor is fully pierced by any sniper-kind weapon, regardless of its tower id. */
    private piercesSniperArmor;
    private armoredChipDamageForTower;
    private hasPierceOnlyArmor;
    private applySlow;
    /** Apply a tower's data-driven on-hit status effects. Content-agnostic: keyed on attack.statusOnHit. */
    private applyStatusOnHit;
    /**
     * Apply a status-effect spec to an enemy. The shared primitive behind both a tower's
     * `attack.statusOnHit` (via applyStatusOnHit) and an ability's `{kind:"status"}` effect
     * (via applyAbilityEffect) — one status vocabulary, two triggers.
     */
    private applyStatusEffect;
    private triggerEnemyPhaseSpawns;
    private createPhaseSpawnChildren;
    private towerFireRateMultiplier;
    private supportBuffTouchesTower;
    private enemyRouteProgressRatio;
    private defaultRouteId;
    private resolveRouteId;
    private routePathKey;
    private isTemporaryWaterTile;
    private isInsideAnyPulse;
    private isInsideSupportAura;
    private buildNavigationWavePairs;
    private buildNavigationMandatoryPairs;
    private resolveDynamicNavigationRoute;
    private navigationHandlerAppliesToMission;
    private navigationTerrainByCoord;
    private navigationTerrainByCoordForOverrides;
    private navigationOccupiedCoords;
    private createNavigationResolver;
    private navigationPlacementPairs;
    private navigationPairIsReachable;
    private createNavigationPlacementAnalysisContext;
    private canPreserveDynamicNavigation;
    private syncNavigationTerrain;
    private syncNavigationOccupancy;
    private syncNavigationResolver;
    private revalidateHeroMovementAfterMapMutation;
    private canOccupyTowerFootprint;
    private dependentsKeepSupportAfterMove;
    private dependentsKeepSupportAfterRemoval;
    private applyPassiveIncome;
    private awardClearedWaveIncome;
    private createDraftOfferAfterWave;
    private removeDeadEnemies;
    private settleArtifactLoot;
    private dynamicEnemyAtGoal;
    private spawnOnDeathChildren;
    private resolveWaveState;
    private victoryObjectives;
    private buildObjectiveProgress;
    private objectiveLabel;
    private failureConditionMet;
    private starConditionMet;
    private buildStarSnapshot;
    private syncPrepRemaining;
    private getNextWaveRemaining;
    private isPathBlockerType;
    private enemyAvoidanceOffset;
    /** Build a full bag over the declared currency set, defaulting any missing currency to 0. */
    private cloneResources;
    private normalizeMetaUpgradeLevels;
    private metaEffectTotal;
    private initialResources;
    private cleanCoord;
    private normalizeCost;
    private hasResources;
    private spendResources;
    private addResources;
    private addToBag;
    private scaleBag;
    private bagHasValue;
    private formatCost;
    private fail;
    private costReasonParams;
}
export {};
