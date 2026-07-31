import { type GameContentRegistry } from "../content/registry.js";
import { MARK_LIMITS, REACTION_LIMITS } from "../content/mechanics.js";
import {
  resolveActiveCombatMechanics,
  resolveEnemyArmorMatrix,
  type ActiveCombatMechanics
} from "../content/combat-mechanics.js";
import { resolveActiveReactionsMechanics } from "../content/reaction-mechanics.js";
import {
  NAVIGATION_LIMITS,
  resolveActiveNavigationMechanics,
  type DynamicFlowNavigationProfileV1
} from "../content/navigation-mechanics.js";
import {
  LINE_OF_SIGHT_LIMITS,
  resolveActiveElevationMechanics,
  resolveActiveHighGroundMechanics,
  resolveActiveLineOfSightMechanics
} from "../content/elevation-mechanics.js";
import {
  PHYSICS_LIMITS,
  inspectOwnDataEffect,
  parseDisplacementEffectV1,
  resolveActivePhysicsMechanics,
  type ActivePhysicsMechanicsV1
} from "../content/physics-mechanics.js";
import {
  ARC_CLEARANCE_LIMITS,
  BALLISTICS_LIMITS,
  RICOCHET_LIMITS,
  resolveActiveBallisticsMechanics,
  type ActiveBallisticsMechanicsV1,
  type BallisticsTowerBindingV1
} from "../content/ballistics-mechanics.js";
import {
  WEATHER_LIMITS,
  advanceWeatherRuntimeV1,
  createWeatherRuntimeV1,
  createWeatherScheduleV1,
  resolveActiveWeatherMechanics,
  type ActiveWeatherMechanicsV1,
  type WeatherEffectV1,
  type WeatherRuntimeV1,
  type WeatherScheduleV1,
  type WeatherZoneV1
} from "../content/weather-mechanics.js";
import {
  TERRAFORMING_LIMITS,
  resolveActiveTerraformingMechanics,
  type ActiveTerraformingMechanicsV1
} from "../content/terraforming-mechanics.js";
import {
  ROGUELITE_ARTIFACT_INVENTORY_LIMIT,
  ROGUELITE_DAMAGE_MODIFIER_RESERVE,
  ROGUELITE_DRAFT_LIMITS,
  deriveRogueliteSynergyStateV1,
  rogueliteSynergyWorstCaseModifierCount,
  resolveActiveRogueliteMechanics,
  type ActiveRogueliteMechanics,
  type RogueliteDraftDefinitionV3
} from "../content/roguelite-mechanics.js";
import {
  activeHeroAuraModifierReserve,
  heroPassiveAuraModifierIdV6,
  heroSkillModifierIdV5,
  resolveActiveHeroesMechanics,
  type ActiveHeroesMechanics,
  type ActiveHeroesMechanicsV2,
  type ActiveHeroesMechanicsV3,
  type ActiveHeroesMechanicsV4,
  type ActiveHeroesMechanicsV5,
  type ActiveHeroesMechanicsV6,
  type ActiveHeroesMechanicsV7
} from "../content/heroes-mechanics.js";
import {
  LOGISTICS_AMMUNITION_LIMITS,
  LOGISTICS_SUPPLY_LIMITS,
  resolveActiveLogisticsMechanics,
  type LogisticsAmmunitionDefinitionV2,
  type LogisticsPowerDefinitionV1,
  type LogisticsSupplyDefinitionV3
} from "../content/logistics-mechanics.js";
import {
  DIRECTOR_LIMITS,
  resolveActiveDirectorMechanics,
  type ActiveDirectorMechanicsV1
} from "../content/director-mechanics.js";
import {
  resolveActiveQuestMechanics,
  selectProceduralQuestsV1,
  type ActiveQuestMechanicsV1,
  type QuestDefinitionV1,
  type QuestShieldScopeV1
} from "../content/quest-mechanics.js";
import {
  ENEMY_BEHAVIORS_LIMITS,
  resolveActiveEnemyBehaviorsV1,
  type ActiveEnemyBehaviorsV1,
  type FormationRoleV1,
  type FormationSteeringDefinitionV1,
  type VanguardProtectionDefinitionV1,
  type VanguardProtectionRuntimeStatsV1,
  type VanguardProtectionSourceKindV1
} from "../content/enemy-behaviors-mechanics.js";
import { CAMPAIGN_RUN_LIMITS } from "../run/campaign-run.js";
import {
  campaignBattleWorstCaseModifierCount,
  preflightHeroAuraDamageFinite
} from "../run/campaign-battle-policy.js";
import { evaluateTowerScriptExpression } from "../scripting/expression.js";
import {
  evaluateTowerScriptBehaviorTree,
  type TowerScriptTargetCandidateV1
} from "../scripting/behavior-tree.js";
import {
  collectTowerScriptStatePaths,
  hasTowerScriptStateTransitionProvenance,
  initializeTowerScriptStateMachine,
  planTowerScriptStateTransition,
  type TowerScriptMachineExpressionContextV1,
  type TowerScriptMachineRuntimeStateV1
} from "../scripting/state-machine.js";
import {
  TOWER_SCRIPT_EVENTS,
  TOWER_SCRIPT_EVENT_FIELDS,
  TOWER_SCRIPT_LIMITS
} from "../scripting/schema-descriptor.js";
import {
  diffTowerScriptState,
  TowerScriptTracePauseError,
  type TowerScriptTraceCollector
} from "../scripting/trace.js";
import type {
  TowerScriptAction,
  TowerScriptBinding,
  TowerScriptBehaviorTreeV1,
  TowerScriptDefinition,
  TowerScriptDiagnostic,
  TowerScriptEntityTarget,
  TowerScriptEventName,
  TowerScriptHandler,
  TowerScriptJson,
  TowerScriptStateMachineV1,
  TowerScriptTileTarget,
  TerraformOperationV1,
  TerraformTilesActionV1
} from "../scripting/types.js";
import { coordKey } from "./hex.js";
import { GridMap, type GridMapElevationOverride } from "./map.js";
import {
  computeHighGroundPairModifiers,
  type ActiveHighGroundMechanics
} from "./high-ground.js";
import { NavigationResolver } from "./navigation-runtime.js";
import { NavigationFieldLookupCache } from "./navigation-movement.js";
import { buildNavigationField, type NavigationFieldResult } from "./navigation-field.js";
import {
  selectFormationSteeringNextV1,
  type FormationSteeringNeighborV1,
  type FormationSteeringRuntimeStatsV1
} from "./formation-steering.js";
import {
  planDynamicTerraformingNavigation,
  type DynamicTerraformingNavigationPlan
} from "./terraforming-navigation.js";
import { collectDynamicTerraformingSpawnProvenance } from "./navigation-reachability.js";
import { DynamicTerraformingSafetyBudgetError } from "./terraforming-navigation-budget.js";
import { prepareDynamicTerraformingSafetySet } from "./terraforming-navigation-safety.js";
import {
  advanceTerraformExpiryGroups,
  buildTerraformingSnapshot,
  countTerraformExpiryOwnership,
  terraformExpiryTargetKey,
  type TerraformExpiryGroupV1,
  type TerraformExpiryTargetV1
} from "./terraforming-expiry.js";
import {
  normalizeNavigationAnalysisRequestV1,
  type NavigationAnalysisRequestV1,
  type NavigationAnalysisV1,
  type NormalizedNavigationAnalysisRequestV1
} from "./navigation-analysis.js";
import {
  analyzeLineOfSightTargets,
  analyzeLineOfSightTargetsV2,
  normalizeLineOfSightAnalysisRequestV1,
  traceLineOfSight,
  traceLineOfSightV2,
  type LineOfSightAnalysisRequestV1,
  type LineOfSightAnalysisV1,
  type LineOfSightAnalysisV2,
  type LineOfSightLegacyPolicyV1,
  type LineOfSightRuntimeProfileV2
} from "./line-of-sight.js";
import {
  buildDynamicAuthoredLineOfSightIndexV1,
  type DynamicAuthoredLineOfSightIndexV1
} from "./destructible-line-of-sight.js";
import {
  DamageResolver,
  validateDamagePacket,
  type DamagePacket,
  type DamageResolution,
  type DamageResolutionContext,
  type DamageSourceRef,
  type DamageTag
} from "./damage.js";
import { MAX_MODIFIERS_PER_RESOLUTION, type ModifierSpec } from "./modifiers.js";
import {
  GAME_CHECKPOINT_SCHEMA_VERSION,
  SIMULATION_ENGINE_VERSION,
  checkpointDataField,
  checkpointObjectDescriptors,
  cloneCheckpointJson,
  computeCheckpointStateDigest,
  inspectCheckpointEnvelope,
  requireExactCheckpointKeys,
  type GameCheckpointIdentityV1,
  type ArtifactCheckpointState,
  type DraftCheckpointState,
  type EnemyBehaviorsCheckpointStateV1,
  type BallisticsCheckpointState,
  type ProjectileCheckpoint,
  type ProjectileCheckpointV2,
  type ProjectileCheckpointV3,
  type ProjectileCheckpointV4,
  type RuntimeElevationOverrideV1,
  type TerraformingCheckpointStateV2,
  type GameCheckpointStateV1,
  type GameCheckpointV1
} from "./checkpoint.js";
import {
  projectileAltitudeAtProgress,
  traceProjectileClearanceV1
} from "./projectile-clearance.js";
import { traceProjectileRicochetRayV1 } from "./projectile-ricochet.js";
import {
  DESTRUCTIBLE_COLLISION_LIMITS,
  createDestructibleCollisionIndexV1,
  planDestructibleObjectDamageV1,
  traceProjectileDestructibleCollisionV1,
  type DestructibleCollisionIndexV1,
  type ProjectileMapObjectCollisionV1
} from "./projectile-destructible.js";
import {
  PersistentTerrainTransactionError,
  adoptPersistentTerrainTransaction,
  preparePersistentTerrainTransaction
} from "./persistent-terrain-transaction.js";
import { SeededRng, type GameSeed, type SeededRngStateV1 } from "./rng.js";
import {
  planDirectorWaveV1,
  type DirectorDefenseAnalysisV1
} from "./director.js";
import {
  type ActiveCombatShieldDefinitions,
  type CombatState,
  type DamageApplicationResult,
  type MarkStateV1,
  type ShieldStateV1
} from "./shields.js";
import { canonicalStringify, getSimulationContentDigest, stableDigest } from "./stable-digest.js";
import {
  planReactions,
  type ActiveReactionsMechanics,
  type ExposureRuntimeStateV1,
  type ReactionPlannerOutput,
  type ReactionStateV1
} from "./reactions.js";
import { TOWER_TARGET_MODES } from "./types.js";
import { createGridTopology, normalizeGridDefinition, type GridTopology } from "./topology.js";
import { expectedTowerFootprintSize, resolveTowerFootprintCoords } from "./tower-footprint.js";
import {
  planTileDisplacement,
  type DisplacementStopReason
} from "./displacement.js";
import {
  buildLogisticsPowerSnapshotV1,
  cloneLogisticsPowerSnapshotV1,
  isLiveLogisticsPowerTower,
  preflightLogisticsPowerMoveV1,
  preflightLogisticsPowerPlacementV1,
  preflightLogisticsPowerRemovalV1,
  preflightLogisticsPowerTopologyV1,
  type LogisticsPowerTopologyCountsV1
} from "./logistics-power.js";
import {
  assertLogisticsAmmunitionPlacement,
  buildLogisticsAmmunitionSnapshotV2,
  getLogisticsAmmunitionTowerInventory,
  isAmmunitionBoundTowerType,
  isLiveLogisticsAmmunitionTower
} from "./logistics-ammunition.js";
import {
  buildLogisticsSupplyTopologyV3,
  getLogisticsProducerDefinitionV3,
  getLogisticsStorageDefinitionV3,
  isLogisticsSupplySourceTypeV3,
  preflightLogisticsSupplyTopologyV3,
  type LogisticsSupplyTopologyV3
} from "./logistics-supply.js";
import type {
  AbilityEffect,
  ActionResult,
  ChainDeliverySpec,
  CurrencyDefinition,
  DifficultyDefinition,
  EffectPipelineAttackModel,
  EnemyPhaseSpawnDefinition,
  EnemyNavigationStateV1,
  EnemyState,
  EnemyTargetClass,
  GameEvent,
  GameSnapshot,
  LogisticsSnapshotV1,
  GridDefinition,
  GridPathRoute,
  HexCoord,
  HexTile,
  MissionAbilityDefinition,
  MissionAbilityId,
  MissionFailureObjective,
  MissionStarCondition,
  MissionVictoryObjective,
  ResourceBag,
  ResourceCost,
  RogueliteArtifactManagementSnapshotV1,
  RuntimeTerrainOverride,
  NavigationSnapshotV1,
  StatusEffectSpec,
  SunlightTile,
  TemporaryWaterTile,
  TowerTargetMode,
  TowerState,
  TowerType,
  WaveGroup,
  WaveState
} from "./types.js";

interface SpawnItem {
  at: number;
  enemyId: string;
  routeId?: string;
}

interface NavigationMandatoryPair {
  readonly movementProfileId: string;
  readonly routeId: string;
  readonly source: HexCoord;
}

interface NavigationFieldGroup {
  readonly movementProfileId: string;
  readonly goal: HexCoord;
  readonly routeIds: Set<string>;
}

interface NavigationSpawnPair {
  readonly enemyTypeId: string;
  readonly routeId: string;
}

interface NavigationAnalysisRelaxationBudget {
  used: number;
  readonly limit: number;
  readonly fields: WeakSet<NavigationFieldResult>;
}

interface NavigationPlacementAnalysisContext {
  readonly pairs: readonly NavigationMandatoryPair[];
  readonly lookups: NavigationFieldLookupCache;
  readonly baselineUnavailable?: NavigationMandatoryPair;
  readonly budget: NavigationAnalysisRelaxationBudget;
}

interface DamageResolutionOptions {
  aoe?: boolean;
  overTime?: boolean;
  damageType?: string;
  armorPiercing?: boolean;
  applyLegacyStatus?: boolean;
}

interface DisplacementSource {
  readonly sourceKind: "tower" | "ability";
  readonly sourceId: string;
  readonly sourceCoord: HexCoord;
}

interface DisplacementActivationBudget {
  used: number;
  readonly limit: number;
}

type RuntimeDisplacementStopReason = DisplacementStopReason | "goal_blocked" | "immune";

interface ResolvedEnemyDamageOptions {
  damageType?: string;
  tags?: readonly DamageTag[];
  modifiers?: readonly ModifierSpec[];
  context?: DamageResolutionContext;
  reactionRuntime?: ReactionRuntimeContext;
  componentId?: string;
}

interface MutableBossComponentRuntimeStateV1 {
  hp: number;
  maxHp: number;
  shield?: ShieldStateV1;
}

type ReactionQueuedPacket = ReactionPlannerOutput["secondaryPlans"][number];

interface ReactionRootRuntime {
  readonly queue: ReactionQueuedPacket[];
  readonly rootEnemyId: string;
  readonly rootEnemyTypeId: string;
  readonly diagnostics: Partial<Record<"depth" | "secondary_packets" | "live_exposures", {
    limit: number;
    dropped: number;
  }>>;
  processing: boolean;
  scheduledPackets: number;
}

interface ReactionRuntimeContext {
  readonly depth: number;
  readonly allowReactions: boolean;
  readonly root: ReactionRootRuntime;
}

function emptyDataRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameGridCoord(left: Readonly<HexCoord>, right: Readonly<HexCoord>): boolean {
  return left.q === right.q && left.r === right.r;
}

function cloneExposureStates(
  source: Readonly<Record<string, ExposureRuntimeStateV1>>,
  canonical = false,
  plain = false
): Record<string, ExposureRuntimeStateV1> {
  const cloned = plain ? {} : emptyDataRecord<ExposureRuntimeStateV1>();
  const exposureIds = Object.keys(source);
  if (canonical) exposureIds.sort();
  for (const exposureId of exposureIds) {
    Object.defineProperty(cloned, exposureId, {
      value: { ...source[exposureId]! },
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return cloned;
}

function cloneEnemyExposureStates(
  source: Readonly<Record<string, Readonly<Record<string, ExposureRuntimeStateV1>>>>,
  canonical = false,
  plain = false
): Record<string, Record<string, ExposureRuntimeStateV1>> {
  const cloned = plain ? {} : emptyDataRecord<Record<string, ExposureRuntimeStateV1>>();
  const enemyIds = Object.keys(source);
  if (canonical) enemyIds.sort();
  for (const enemyId of enemyIds) {
    Object.defineProperty(cloned, enemyId, {
      value: cloneExposureStates(source[enemyId]!, canonical, plain),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return cloned;
}

type MutableDamageTarget =
  | { readonly kind: "enemy"; readonly enemy: EnemyState }
  | { readonly kind: "core" }
  | { readonly kind: "tower"; readonly tower: TowerState }
  | { readonly kind: "hero"; readonly hero: HeroRuntimeStateV2 };

interface TowerScriptSelfContext {
  scope: TowerScriptBinding["scope"];
  id: string;
  typeId?: string;
  value: Record<string, unknown>;
}

interface TowerScriptExecutionContext {
  script: TowerScriptDefinition;
  binding: TowerScriptBinding;
  self: TowerScriptSelfContext;
  state: Record<string, TowerScriptJson>;
  stateKey: string;
  event: Record<string, unknown>;
  eventName: TowerScriptEventName;
  machineComponent?: Readonly<Record<string, unknown>>;
}

const INVALID_SHIELD_RESTORE_MESSAGE = "TowerScript action is invalid for the current shield target.";
const EMPTY_FROZEN_ARRAY: readonly never[] = Object.freeze([]);

class TowerScriptInvalidActionError extends Error {
  constructor(message = INVALID_SHIELD_RESTORE_MESSAGE) {
    super(message);
    this.name = "TowerScriptInvalidActionError";
  }
}

type TerraformingFailureReason =
  | "terraform.invalid_operation"
  | "terraform.operation_budget_exceeded"
  | "terraform.duplicate_target"
  | "terraform.target_outside_map"
  | "terraform.transition_missing"
  | "terraform.transition_source_tag_mismatch"
  | "terraform.elevation_dependency_missing"
  | "terraform.elevation_policy_missing"
  | "terraform.elevation_out_of_range"
  | "terraform.elevation_delta_exceeded"
  | "terraform.override_budget_exceeded"
  | "terraform.duration_out_of_range"
  | "terraform.expiry_group_budget_exceeded"
  | "terraform.target_owned"
  | "terraform.authored_route_unavailable"
  | "terraform.last_authored_route_blocked"
  | "terraform.navigation_unavailable"
  | "terraform.last_path_blocked"
  | "terraform.solver_budget_exceeded";

class TowerScriptTerraformingError extends Error {
  constructor(
    readonly code: "invalid_action" | "budget_exceeded",
    readonly reasonKey: TerraformingFailureReason,
    message: string
  ) {
    super(message);
    this.name = "TowerScriptTerraformingError";
  }
}

interface ResolvedPersistentOperation {
  readonly kind: "set_terrain" | "restore_terrain" | "set_elevation" | "restore_elevation";
  readonly coord: HexCoord;
  readonly transitionId?: string;
  readonly directTerrainId?: string;
  readonly terrainSource?: RuntimeTerrainOverride["source"];
  readonly elevation?: number;
  readonly order: number;
  readonly previousTerrainOverride?: RuntimeTerrainOverride | null;
  readonly previousElevationOverride?: RuntimeElevationOverrideV1 | null;
}

interface PersistentTerrainCandidate {
  readonly overrides: Map<string, RuntimeTerrainOverride>;
  readonly writes: readonly { readonly coord: HexCoord; readonly terrain: string }[];
  readonly events: readonly OrderedTerraformEvent[];
}

interface PersistentElevationCandidate {
  readonly overrides: Map<string, RuntimeElevationOverrideV1>;
  readonly writes: readonly { readonly coord: HexCoord; readonly elevation: number }[];
  readonly events: readonly OrderedTerraformEvent[];
}

interface OrderedTerraformEvent {
  readonly order: number;
  readonly event: Extract<GameEvent, { type: "terrainChanged" | "elevationChanged" }>;
}

interface PropertyDescriptorSnapshot {
  readonly key: PropertyKey;
  readonly configurable: boolean;
  readonly enumerable: boolean;
  readonly writable?: boolean;
  readonly value?: unknown;
  readonly get?: (() => unknown) | undefined;
  readonly set?: ((value: unknown) => void) | undefined;
}

interface DerivedMapIntegrityBaseline {
  readonly mapRef: GridMap;
  readonly tilesRef: Map<string, HexTile>;
  readonly baseTerrainRef: Map<string, string>;
  readonly topologyRef: GridTopology;
  readonly gridRef: GridDefinition;
  readonly topologyGridRef: GridDefinition;
  readonly mapOwnShape: readonly PropertyDescriptorSnapshot[];
  readonly mapPrototypeRef: object;
  readonly mapPrototypeShape: readonly PropertyDescriptorSnapshot[];
  readonly definitionCanonical: string;
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly grid: GridDefinition;
  readonly topologyGrid: GridDefinition;
  readonly topologyDirectionCount: GridTopology["directionCount"];
  readonly topologyMethods: Readonly<{
    neighbors: GridTopology["neighbors"];
    distance: GridTopology["distance"];
    line: GridTopology["line"];
    directionBetween: GridTopology["directionBetween"];
    tilesWithin: GridTopology["tilesWithin"];
    footprintSize: GridTopology["footprintSize"];
  }>;
  readonly baseTiles: readonly Readonly<HexTile>[];
  readonly pathCenterline: readonly Readonly<HexCoord>[];
  readonly pathRoutes: readonly Readonly<{
    id: string;
    pathCenterline: readonly Readonly<HexCoord>[];
  }>[];
  readonly spawnCoord: Readonly<HexCoord>;
  readonly coreCoord: Readonly<HexCoord>;
}

const NATIVE_MAP_PROTOTYPE = Map.prototype;
const NATIVE_MAP_GET = Map.prototype.get;
const NATIVE_MAP_SET = Map.prototype.set;
const NATIVE_MAP_HAS = Map.prototype.has;
const NATIVE_MAP_ENTRIES = Map.prototype.entries;
const NATIVE_MAP_SIZE_GETTER = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;
const NATIVE_MAP_ITERATOR_PROTOTYPE = Object.getPrototypeOf(Reflect.apply(NATIVE_MAP_ENTRIES, new Map(), []));
const NATIVE_MAP_ITERATOR_NEXT = Object.getOwnPropertyDescriptor(NATIVE_MAP_ITERATOR_PROTOTYPE, "next")?.value as
  | ((this: IterableIterator<unknown>) => IteratorResult<unknown>)
  | undefined;
const NATIVE_MAP_INTRINSIC_KEYS = Object.freeze([
  "get", "set", "has", "delete", "clear", "entries", "values", "size", Symbol.iterator
] as const);

function snapshotPropertyDescriptor(key: PropertyKey, descriptor: PropertyDescriptor): PropertyDescriptorSnapshot {
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

function capturePropertyDescriptorShape(value: object): readonly PropertyDescriptorSnapshot[] {
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
  return Object.freeze(Reflect.ownKeys(descriptors).map((key) => snapshotPropertyDescriptor(key, descriptors[key]!)));
}

const PINNED_GRID_MAP_PROTOTYPE = GridMap.prototype;
const PINNED_GRID_MAP_PROTOTYPE_SHAPE = capturePropertyDescriptorShape(PINNED_GRID_MAP_PROTOTYPE);
const PINNED_GRID_MAP_OWN_KEYS = Object.freeze([
  "id", "width", "height", "grid", "topology", "tiles", "pathCenterline", "pathRoutes",
  "spawnCoord", "coreCoord", "definition", "baseTerrainByCoord"
]);

const NATIVE_MAP_INTRINSIC_SHAPE = Object.freeze(NATIVE_MAP_INTRINSIC_KEYS.map((key) => {
  const descriptor = Object.getOwnPropertyDescriptor(NATIVE_MAP_PROTOTYPE, key);
  if (!descriptor) throw new Error(`Missing native Map intrinsic ${String(key)}.`);
  return snapshotPropertyDescriptor(key, descriptor);
}));

function descriptorMatchesSnapshot(
  actual: PropertyDescriptor | undefined,
  expected: PropertyDescriptorSnapshot
): boolean {
  if (!actual) return false;
  if (
    Boolean(actual.configurable) !== expected.configurable
    || Boolean(actual.enumerable) !== expected.enumerable
  ) return false;
  if ("value" in actual) {
    return Object.prototype.hasOwnProperty.call(expected, "value")
      && Boolean(actual.writable) === expected.writable
      && actual.value === expected.value;
  }
  return !Object.prototype.hasOwnProperty.call(expected, "value")
    && actual.get === expected.get
    && actual.set === expected.set;
}

function assertPinnedNativeMapIntrinsics(): void {
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

function assertPinnedGridMapSurface(map: GridMap): void {
  if (Object.getPrototypeOf(map) !== PINNED_GRID_MAP_PROTOTYPE) {
    throw new Error("Derived map integrity rejected a changed GridMap prototype identity.");
  }
  const prototypeDescriptors = Object.getOwnPropertyDescriptors(PINNED_GRID_MAP_PROTOTYPE) as
    Record<PropertyKey, PropertyDescriptor>;
  if (
    Reflect.ownKeys(prototypeDescriptors).length !== PINNED_GRID_MAP_PROTOTYPE_SHAPE.length
    || PINNED_GRID_MAP_PROTOTYPE_SHAPE.some((expected) => (
      !descriptorMatchesSnapshot(prototypeDescriptors[expected.key], expected)
    ))
  ) {
    throw new Error("Derived map integrity rejected changed GridMap prototype methods.");
  }
  const ownDescriptors = Object.getOwnPropertyDescriptors(map);
  const ownKeys = Reflect.ownKeys(ownDescriptors);
  if (
    ownKeys.length !== PINNED_GRID_MAP_OWN_KEYS.length
    || ownKeys.some((key) => typeof key !== "string" || !PINNED_GRID_MAP_OWN_KEYS.includes(key))
  ) {
    throw new Error("Derived map integrity rejected a GridMap own method shadow or accessor.");
  }
  for (const key of PINNED_GRID_MAP_OWN_KEYS) {
    const descriptor = ownDescriptors[key];
    if (
      !descriptor
      || !("value" in descriptor)
      || !descriptor.enumerable
      || !descriptor.configurable
      || !descriptor.writable
    ) {
      throw new Error(`Derived map integrity rejected GridMap own descriptor ${key}.`);
    }
  }
}

const SCRIPT_GAME_EVENT_NAMES = new Set<TowerScriptEventName>([
  "towerPlaced", "towerSold", "towerMoved", "towerUpgraded", "towerDestroyed", "towerTargetModeChanged",
  "towerFired", "towerResourcesGranted", "towerShieldChanged", "enemyHit", "enemyShieldChanged", "bossComponentDamaged", "bossComponentDestroyed", "enemyMarkChanged", "enemyKilled", "enemyLeaked", "enemySpawnedOnDeath",
  "enemyExposureChanged", "enemyReactionTriggered",
  "enemyPhaseSpawned", "waveStarted", "waveCleared", "resourcesGranted", "abilityUsed", "objectiveCompleted",
  "enemyEnteredTile", "terrainChanged", "elevationChanged", "objectiveFailed", "starEarned", "victory", "defeat",
  "stateMachineTransitioned"
]);

function artifactLootSeed(seed: GameSeed, missionId: string): string {
  const seedType = typeof seed === "string" ? "s" : "n";
  const seedPayload = String(seed);
  return `towerforge:artifact-loot:v1|${seedType}:${seedPayload.length}:${seedPayload}|m:${missionId.length}:${missionId}`;
}

function waveDraftSeed(initialRngState: SeededRngStateV1, missionId: string): string {
  const seedPayload = canonicalStringify(initialRngState);
  return `towerforge:wave-draft:v1|r:${seedPayload.length}:${seedPayload}|m:${missionId.length}:${missionId}`;
}

function questRuntimeSeed(initialRngState: SeededRngStateV1, missionId: string): string {
  const rng = canonicalStringify(initialRngState);
  return `towerforge:quest-runtime:v1|r:${rng.length}:${rng}|m:${missionId.length}:${missionId}`;
}

function sampleDraftOfferCardIds(
  draft: RogueliteDraftDefinitionV3,
  poolId: string,
  rng: SeededRng
): readonly [string, string, string] {
  const pool = draft.pools[poolId];
  if (!pool || pool.entries.length < ROGUELITE_DRAFT_LIMITS.offerSize) {
    throw new Error("Draft offer pool is unavailable or too small.");
  }
  const remaining = pool.entries.map((entry) => ({ ...entry }));
  const selected: string[] = [];
  while (selected.length < ROGUELITE_DRAFT_LIMITS.offerSize) {
    const totalWeight = remaining.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = rng.nextInt(totalWeight);
    let selectedIndex = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index]!;
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
  return Object.freeze(selected) as unknown as readonly [string, string, string];
}

interface ArtifactInventorySocketRef {
  readonly towerId: string;
  readonly slotId: string;
}

interface ArtifactInventoryEntry {
  readonly instanceId: string;
  readonly artifactId: string;
  socket: ArtifactInventorySocketRef | null;
}

interface DraftPendingOffer {
  readonly offerId: string;
  readonly afterWaveIndex: number;
  readonly poolId: string;
  readonly cardIds: readonly [string, string, string];
}

interface DraftSelection {
  readonly sequence: number;
  readonly offerId: string;
  readonly cardId: string;
  readonly instanceId?: string;
}

export interface CampaignBattleLoadoutV1 {
  readonly schemaVersion: 1;
  readonly launchId: string;
  readonly nodeId: string;
  readonly maxNewArtifactInstances: number;
  readonly deck: readonly { readonly instanceId: string; readonly cardId: string }[];
  readonly artifacts: readonly { readonly instanceId: string; readonly artifactId: string }[];
}

export interface CampaignBattleSettlementV1 {
  readonly schemaVersion: 1;
  readonly launchId: string;
  readonly nodeId: string;
  readonly missionId: string;
  readonly deck: readonly { readonly instanceId: string; readonly cardId: string }[];
  readonly artifacts: readonly { readonly instanceId: string; readonly artifactId: string }[];
}

function normalizeCampaignBattleLoadout(
  value: CampaignBattleLoadoutV1,
  active: ActiveRogueliteMechanics | undefined,
  content: GameContentRegistry,
  missionId: string
): CampaignBattleLoadoutV1 {
  if (active?.schemaVersion !== 4 || active.campaign?.schemaVersion !== 2) {
    throw new Error("Campaign battle handoff is inactive for this mission.");
  }
  const root = checkpointObjectDescriptors(value, "Campaign battle loadout");
  requireExactCheckpointKeys(
    root,
    ["schemaVersion", "launchId", "nodeId", "maxNewArtifactInstances", "deck", "artifacts"],
    "Campaign battle loadout"
  );
  if (checkpointDataField(root, "schemaVersion", "Campaign battle loadout") !== 1) {
    throw new Error("Campaign battle loadout schema version is unsupported.");
  }
  const launchId = checkpointDataField(root, "launchId", "Campaign battle loadout");
  const nodeId = checkpointDataField(root, "nodeId", "Campaign battle loadout");
  const maxNewArtifactInstances = checkpointDataField(root, "maxNewArtifactInstances", "Campaign battle loadout");
  if (
    typeof launchId !== "string"
    || !/^[0-9a-f]{16}$/.test(launchId)
    || typeof nodeId !== "string"
    || nodeId.length === 0
    || nodeId.length > CAMPAIGN_RUN_LIMITS.identifierCodeUnits
  ) {
    throw new Error("Campaign battle loadout identity is invalid.");
  }
  if (
    typeof maxNewArtifactInstances !== "number"
    || !Number.isSafeInteger(maxNewArtifactInstances)
    || maxNewArtifactInstances < 0
    || maxNewArtifactInstances > ROGUELITE_ARTIFACT_INVENTORY_LIMIT
  ) throw new Error("Campaign battle artifact acquisition limit is invalid.");
  const normalizeEntries = <K extends "cardId" | "artifactId">(
    input: unknown,
    field: K,
    definitions: Readonly<Record<string, unknown>> | undefined
  ): readonly Readonly<{ instanceId: string } & Record<K, string>>[] => {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
      throw new Error("Campaign battle loadout collections must be plain arrays.");
    }
    const seen = new Set<string>();
    return Object.freeze(input.map((entry, index) => {
      const descriptors = checkpointObjectDescriptors(entry, `Campaign battle ${field} entry`);
      requireExactCheckpointKeys(descriptors, ["instanceId", field], `Campaign battle ${field} entry`);
      const instanceId = checkpointDataField(descriptors, "instanceId", `Campaign battle ${field} entry`);
      const definitionId = checkpointDataField(descriptors, field, `Campaign battle ${field} entry`);
      if (
        typeof instanceId !== "string"
        || instanceId.length === 0
        || instanceId.length > 256
        || seen.has(instanceId)
        || typeof definitionId !== "string"
        || !definitions
        || !Object.prototype.hasOwnProperty.call(definitions, definitionId)
      ) throw new Error(`Campaign battle ${field} entry ${index} is invalid.`);
      seen.add(instanceId);
      return Object.freeze({ instanceId, [field]: definitionId }) as Readonly<{ instanceId: string } & Record<K, string>>;
    }));
  };
  const deck = normalizeEntries(
    checkpointDataField(root, "deck", "Campaign battle loadout"),
    "cardId",
    active.draft?.definitions
  );
  const artifacts = normalizeEntries(
    checkpointDataField(root, "artifacts", "Campaign battle loadout"),
    "artifactId",
    active.artifacts?.definitions
  );
  if (deck.length + artifacts.length > CAMPAIGN_RUN_LIMITS.collectionEntries) {
    throw new Error("Campaign battle loadout exceeds the aggregate CampaignRun collection limit.");
  }
  if (campaignBattleWorstCaseModifierCount(deck, content, missionId) > MAX_MODIFIERS_PER_RESOLUTION) {
    throw new Error("Campaign battle loadout exceeds the shared modifier budget.");
  }
  const numericPreflight = preflightHeroAuraDamageFinite(content, missionId, { deck });
  if (!numericPreflight.ok) throw new Error(numericPreflight.message);
  return Object.freeze({ schemaVersion: 1, launchId, nodeId, maxNewArtifactInstances, deck, artifacts });
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
  /** Explicit authoring-only trace sink. Omit for the literal legacy runtime path. */
  towerScriptTrace?: TowerScriptTraceCollector;
}

interface TowerDefenseGameInternalOptions {
  skipGameStarted?: boolean;
}

interface HeroRuntimeStateV2 {
  definitionId: string;
  currentCoord: HexCoord;
  targetCoord: HexCoord | null;
  nextCoord: HexCoord | null;
  edgeProgress: number;
  hp?: number;
  shieldCurrent?: number;
  mana?: number;
  abilityCooldownRemaining?: number;
  skillPoints?: number;
  unlockedSkillIds?: Set<string>;
}

interface LogisticsProducerRuntimeStateV3 {
  amount: number;
  productionProgress: number;
  transferProgress: number;
}

interface LogisticsStorageRuntimeStateV3 {
  amount: number;
  transferProgress: number;
}

interface ScriptedTargetingControllerV1 {
  readonly script: TowerScriptDefinition;
  readonly tree: TowerScriptBehaviorTreeV1;
}

interface ActiveFormationAssignmentV1 {
  readonly cohortId: string;
  readonly role: FormationRoleV1;
  readonly steering: FormationSteeringDefinitionV1;
  readonly protection?: VanguardProtectionDefinitionV1;
}

interface FormationTickObservationV1 extends ActiveFormationAssignmentV1 {
  readonly enemyId: string;
  readonly anchorCoord: HexCoord;
  readonly fieldKey: string;
  readonly remainingCostMilli: number;
}

interface FormationTickIndexV1 {
  readonly observations: ReadonlyMap<string, FormationTickObservationV1>;
  readonly buckets: ReadonlyMap<string, readonly string[]>;
}

interface VanguardProtectionIndexV1 {
  readonly buckets: ReadonlyMap<string, readonly EnemyState[]>;
}

interface RuntimeDamageApplicationResult extends DamageApplicationResult {
  readonly enemyTarget?: EnemyState;
}

interface MutableDestructibleObjectStateV1 {
  readonly objectId: string;
  readonly definitionId: string;
  readonly coord: HexCoord;
  hp: number;
  readonly maxHp: number;
  destroyed: boolean;
}

type MutableFormationSteeringRuntimeStatsV1 = {
  -readonly [Key in keyof FormationSteeringRuntimeStatsV1]: FormationSteeringRuntimeStatsV1[Key];
};

export class TowerDefenseGame {
  readonly content: GameContentRegistry;
  readonly mission: GameContentRegistry["missions"][string];
  readonly map: GridMap;
  coreHp: number;
  resources: ResourceBag;
  waveIndex = 0;
  startedWaveCount = 0;
  waveState: WaveState = "ready";
  prepRemaining = 0;
  outcome: GameSnapshot["outcome"] = "playing";
  enemies: EnemyState[] = [];
  towers: TowerState[] = [];
  lastEvents: GameEvent[] = [];
  readonly currencies: CurrencyDefinition[];
  readonly difficulty: DifficultyDefinition;
  private readonly currencyIds: string[];
  private readonly metaUpgradeLevels: Record<string, number>;
  private readonly maxCoreHp: number;
  private readonly towerDamageMultiplier: number;
  private readonly towerFireRateMetaMultiplier: number;
  private readonly activeCombatMechanics: ActiveCombatMechanics | undefined;
  private readonly activeReactionsMechanics: ActiveReactionsMechanics | undefined;
  private readonly activeNavigationProfile: DynamicFlowNavigationProfileV1 | undefined;
  private readonly activeNavigationProfileId: string | undefined;
  private readonly activeElevation: boolean;
  private readonly activeLineOfSightProfile: LineOfSightRuntimeProfileV2 | undefined;
  private hasAuthoredDynamicLineOfSightCapability = false;
  private dynamicLineOfSightIndex: DynamicAuthoredLineOfSightIndexV1 | undefined = undefined;
  private readonly activeHighGroundProfile: ActiveHighGroundMechanics | undefined;
  private readonly activePhysicsMechanics: ActivePhysicsMechanicsV1 | undefined;
  private readonly activeBallisticsMechanics: ActiveBallisticsMechanicsV1 | undefined;
  private readonly activeWeatherMechanics: ActiveWeatherMechanicsV1 | undefined;
  private weatherSchedule: WeatherScheduleV1 | undefined;
  private weatherRuntime: WeatherRuntimeV1 | undefined;
  private readonly activeTerraformingMechanics: ActiveTerraformingMechanicsV1 | undefined;
  private readonly activeRogueliteMechanics: ActiveRogueliteMechanics | undefined;
  private readonly activeHeroesMechanics: ActiveHeroesMechanics | undefined;
  private readonly activeLogisticsPower: LogisticsPowerDefinitionV1 | undefined;
  private readonly activeLogisticsAmmunition: LogisticsAmmunitionDefinitionV2 | undefined;
  private readonly activeLogisticsSupply: LogisticsSupplyDefinitionV3 | undefined;
  private readonly activeLogisticsSchemaVersion: 1 | 2 | 3 | undefined;
  private readonly activeDirectorMechanics: ActiveDirectorMechanicsV1 | undefined;
  private readonly activeQuestMechanics: ActiveQuestMechanicsV1 | undefined;
  private readonly activeEnemyBehaviors: ActiveEnemyBehaviorsV1 | undefined;
  private readonly activeFormationAssignments: ReadonlyMap<string, ActiveFormationAssignmentV1> | undefined;
  private formationSteeringStats: MutableFormationSteeringRuntimeStatsV1 = {
    bucketBuildCount: 0,
    bucketEntryCount: 0,
    fieldReadCount: 0,
    plannerInvocationCount: 0,
    neighborEntriesInspected: 0,
    maximumNeighborCount: 0
  };
  private vanguardProtectionIndex: VanguardProtectionIndexV1 | undefined;
  private vanguardProtectionTransactionsThisTick = 0;
  private vanguardProtectionCandidatesInspected = 0;
  private vanguardProtectionMaximumCandidateCount = 0;
  private questEntries: NonNullable<GameSnapshot["quests"]>["entries"] = Object.freeze([]);
  private readonly scriptedTargetingByTowerType = new Map<string, ScriptedTargetingControllerV1>();
  private directorDecisions: NonNullable<GameSnapshot["director"]>["decisions"] = Object.freeze([]);
  private readonly activeHeroPassiveAura: Readonly<{
    definitionId: string;
    aura: NonNullable<ActiveHeroesMechanicsV6["definitions"][string]["passiveAura"]>;
    modifiers: readonly ModifierSpec[];
  }> | undefined;
  private readonly activeHeroBlocking: Readonly<{
    definitionId: string;
    blocking: NonNullable<ActiveHeroesMechanicsV7["definitions"][string]["blocking"]>;
  }> | undefined;
  private readonly heroesSnapshotV1: GameSnapshot["heroes"];
  private heroStateV2: HeroRuntimeStateV2 | undefined;
  private heroMovementField: NavigationFieldResult | undefined;
  private readonly heroMovementLookupCache = new NavigationFieldLookupCache();
  private heroMovementDirty = false;
  private logisticsPowerSnapshotCache: LogisticsSnapshotV1 | undefined;
  private logisticsPoweredConsumerIds: ReadonlySet<string> | undefined;
  private logisticsPowerDirty = false;
  private logisticsTopologyCounts: LogisticsPowerTopologyCountsV1 = Object.freeze({
    participants: 0,
    nodes: 0,
    undirectedEdges: 0
  });
  private logisticsLiveParticipantIds = new Set<string>();
  private logisticsAmmunitionAmounts = new Map<string, number>();
  private logisticsSupplyProducers = new Map<string, LogisticsProducerRuntimeStateV3>();
  private logisticsSupplyStorages = new Map<string, LogisticsStorageRuntimeStateV3>();
  private logisticsSupplyTopologyCache: LogisticsSupplyTopologyV3 | undefined;
  private logisticsSupplyDirty = false;
  private rogueliteSnapshot: GameSnapshot["roguelite"];
  private rogueliteDamageModifiers: readonly ModifierSpec[] = Object.freeze([]);
  private artifactDamageModifiersByTowerId: ReadonlyMap<string, readonly ModifierSpec[]> = new Map();
  private artifactInitialRngState: SeededRngStateV1 | undefined;
  private artifactRng: SeededRng | undefined;
  private artifactInventory: ArtifactInventoryEntry[] = [];
  private nextArtifactInstanceSequence = 1;
  /** Preserve historic artifact checkpoint v1 until a socket assignment first changes. */
  private artifactCheckpointForm: 0 | 1 | 2 | 3 = 0;
  private draftInitialRngState: SeededRngStateV1 | undefined;
  private draftRng: SeededRng | undefined;
  private nextDraftOfferSequence = 1;
  private pendingDraftOffer: DraftPendingOffer | null = null;
  private draftSelections: DraftSelection[] = [];
  private campaignBattle: CampaignBattleLoadoutV1 | undefined;
  private campaignDeck: CampaignBattleLoadoutV1["deck"] = Object.freeze([]);
  private readonly navigationMandatoryPairs: readonly NavigationMandatoryPair[];
  private readonly navigationKnownPairs: readonly NavigationMandatoryPair[];
  private navigationResolver: NavigationResolver | undefined;
  private navigationFieldLookupCache: NavigationFieldLookupCache | undefined;
  private navigationEnemyFields: Map<string, NavigationFieldResult> | undefined;
  private readonly combatShieldDefinitions: ActiveCombatShieldDefinitions | undefined;
  private enemyShields: Record<string, ShieldStateV1> = {};
  private towerShields: Record<string, ShieldStateV1> = {};
  private enemyMarks: Record<string, Record<string, MarkStateV1>> = {};
  private enemyExposures: Record<string, Record<string, ExposureRuntimeStateV1>> = emptyDataRecord();
  private enemyComponentStates: Record<string, Record<string, MutableBossComponentRuntimeStateV1>> = {};
  private projectiles: ProjectileCheckpoint[] = [];
  private nextProjectileSequence = 1;
  private projectileClearanceInspectionsThisTick = 0;
  private projectileDestructibleInspectionsThisTick = 0;
  private projectileRicochetInspectionsThisTick = 0;
  private projectileRicochetsThisTick = 0;
  private destructibleObjects: MutableDestructibleObjectStateV1[] = [];
  private destructibleCollisionIndex: DestructibleCollisionIndexV1 | undefined;

  private enemyCounter = 0;
  private towerCounter = 0;
  private clearedWaveCount = 0;
  private killCount = 0;
  private leakCount = 0;
  private killCountByEnemyType: Record<string, number> = {};
  private completedObjectiveIds = new Set<string>();
  private earnedStarIds = new Set<string>();
  private spawnQueue: SpawnItem[] = [];
  private missionElapsed = 0;
  private nextWaveStartAt: number | null = null;
  private abilityCooldowns: Partial<Record<MissionAbilityId, number>> = {};
  private temporaryWaterTiles: TemporaryWaterTile[] = [];
  private runtimeTerrainOverrides = new Map<string, RuntimeTerrainOverride>();
  private runtimeElevationOverrides = new Map<string, RuntimeElevationOverrideV1>();
  private pendingTerraformExpiryGroups: TerraformExpiryGroupV1[] = [];
  private nextTerraformExpirySequence = 1;
  /** Preserve the nested checkpoint source form until native timed state is first committed. */
  private terraformingCheckpointForm: 0 | 1 | 2 = 0;
  private readonly sunlightPathKeys: Set<string>;
  private readonly sunlightTilesSnapshot: SunlightTile[];
  private readonly directFlightLine: HexCoord[];
  private readonly staticTilesSnapshot: HexTile[];
  private readonly staticPathCenterlineSnapshot: HexCoord[];
  private readonly staticPathRoutesSnapshot: GameSnapshot["pathRoutes"];
  private readonly staticSpawnCoordSnapshot: HexCoord;
  private readonly staticCoreCoordSnapshot: HexCoord;
  private readonly staticElevationSnapshot: GameSnapshot["elevation"];
  private readonly derivedMapIntegrityBaseline: DerivedMapIntegrityBaseline;
  private scriptValues: Record<string, Record<string, Record<string, TowerScriptJson>>> = {};
  private scriptDiagnostics: TowerScriptDiagnostic[] = [];
  private scriptHandlerLastRun: Record<string, number> = {};
  private scriptEventCursor = 0;
  private scriptActionsRemaining = 0;
  private scriptTerrainChangesRemaining = 0;
  private scriptSignalDepth = 0;
  private scriptStateTransitionsRemaining = 0;
  private scriptMachines: Record<string, Record<string, Record<string, TowerScriptMachineRuntimeStateV1>>> = {};
  private hasScriptStateMachines = false;
  private readonly towerScriptTrace: TowerScriptTraceCollector | undefined;
  private displacementStepAttemptsThisTick = 0;
  private initialRngState: SeededRngStateV1;
  private rng: SeededRng;

  constructor(options: TowerDefenseGameOptions, internal: TowerDefenseGameInternalOptions = {}) {
    assertPinnedNativeMapIntrinsics();
    this.content = options.content;
    this.towerScriptTrace = options.towerScriptTrace;
    this.rng = new SeededRng(options.seed ?? 0);
    this.initialRngState = this.rng.exportState();
    // Currencies are content-defined; "coins" is always guaranteed as the primary (first) currency.
    // Dedupe and reorder defensively so the engine is correct even on content built without the loader.
    const declared = this.content.currencies?.length ? this.content.currencies : [{ id: "coins", label: "Coins" }];
    const seen = new Set<string>();
    const ordered: CurrencyDefinition[] = [];
    for (const currency of declared) {
      if (currency && currency.id && !seen.has(currency.id)) {
        seen.add(currency.id);
        ordered.push(currency);
      }
    }
    if (!seen.has("coins")) ordered.unshift({ id: "coins", label: "Coins" });
    const coinsIndex = ordered.findIndex((c) => c.id === "coins");
    if (coinsIndex > 0) ordered.unshift(ordered.splice(coinsIndex, 1)[0]!);
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
    this.activeBallisticsMechanics = resolveActiveBallisticsMechanics(this.content, missionId);
    this.activeWeatherMechanics = resolveActiveWeatherMechanics(this.content, missionId);
    this.weatherSchedule = this.activeWeatherMechanics
      ? createWeatherScheduleV1({
          zones: this.activeWeatherMechanics.zones,
          definitions: this.activeWeatherMechanics.definitions,
          schedule: this.activeWeatherMechanics.schedule
        }, {
          seed: canonicalStringify(this.initialRngState),
          missionId,
          waveCount: this.mission.waves.length
        })
      : undefined;
    this.weatherRuntime = this.weatherSchedule ? createWeatherRuntimeV1(this.weatherSchedule) : undefined;
    this.activeTerraformingMechanics = resolveActiveTerraformingMechanics(this.content, missionId);
    this.initializeDestructibleObjects();
    this.activeRogueliteMechanics = resolveActiveRogueliteMechanics(this.content, missionId);
    this.activeHeroesMechanics = resolveActiveHeroesMechanics(this.content, missionId);
    this.activeDirectorMechanics = resolveActiveDirectorMechanics(this.content, missionId);
    this.activeQuestMechanics = resolveActiveQuestMechanics(this.content, missionId);
    this.activeEnemyBehaviors = resolveActiveEnemyBehaviorsV1(this.content, missionId);
    this.initializeQuestEntries();
    const activeLogistics = resolveActiveLogisticsMechanics(this.content, missionId);
    this.activeLogisticsSchemaVersion = activeLogistics?.schemaVersion;
    this.activeLogisticsPower = activeLogistics?.power ?? undefined;
    this.activeLogisticsAmmunition = activeLogistics?.schemaVersion === 2
      || activeLogistics?.schemaVersion === 3
      ? activeLogistics.ammunition ?? undefined
      : undefined;
    this.activeLogisticsSupply = activeLogistics?.schemaVersion === 3
      ? activeLogistics.supply ?? undefined
      : undefined;
    this.logisticsPowerDirty = this.activeLogisticsPower !== undefined;
    this.logisticsSupplyDirty = this.activeLogisticsSupply !== undefined;
    const passiveAuraDefinition = this.activeHeroesMechanics?.schemaVersion === 6
      || this.activeHeroesMechanics?.schemaVersion === 7
      ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId]
      : undefined;
    const passiveAura = passiveAuraDefinition?.passiveAura ?? undefined;
    this.activeHeroPassiveAura = passiveAura === undefined || passiveAura === null
      ? undefined
      : Object.freeze({
          definitionId: this.activeHeroesMechanics!.selectedHeroId,
          aura: passiveAura,
          modifiers: Object.freeze(passiveAura.effects.map((effect, effectIndex) => Object.freeze({
            id: heroPassiveAuraModifierIdV6(
              this.activeHeroesMechanics!.selectedHeroId,
              passiveAura.id,
              effectIndex
            ),
            target: effect.modifier.target,
            stage: "spatial" as const,
            operation: effect.modifier.operation,
            value: effect.modifier.value
          })))
        });
    const blockingDefinition = this.activeHeroesMechanics?.schemaVersion === 7
      ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId]?.blocking
      : undefined;
    this.activeHeroBlocking = blockingDefinition === undefined || blockingDefinition === null
      ? undefined
      : Object.freeze({
          definitionId: this.activeHeroesMechanics!.selectedHeroId,
          blocking: blockingDefinition
        });
    if (activeHeroAuraModifierReserve(this.content, missionId) > 0) {
      if (campaignBattleWorstCaseModifierCount([], this.content, missionId) > MAX_MODIFIERS_PER_RESOLUTION) {
        throw new Error("Active mission mechanics exceed the shared modifier budget.");
      }
      const numericPreflight = preflightHeroAuraDamageFinite(this.content, missionId);
      if (!numericPreflight.ok) throw new Error(numericPreflight.message);
    }
    if (this.activeHeroesMechanics?.schemaVersion === 1) {
      const definition = this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId]!;
      const coord = Object.freeze({ q: this.map.coreCoord.q, r: this.map.coreCoord.r });
      this.heroesSnapshotV1 = Object.freeze({
        schemaVersion: 1 as const,
        units: Object.freeze([Object.freeze({
          id: this.activeHeroesMechanics.selectedHeroId,
          definitionId: this.activeHeroesMechanics.selectedHeroId,
          label: definition.label,
          coord
        })])
      });
    } else {
      this.heroesSnapshotV1 = undefined;
    }
    if (this.activeHeroesMechanics?.schemaVersion === 2
      || this.activeHeroesMechanics?.schemaVersion === 3
      || this.activeHeroesMechanics?.schemaVersion === 4
      || this.activeHeroesMechanics?.schemaVersion === 5
      || this.activeHeroesMechanics?.schemaVersion === 6
      || this.activeHeroesMechanics?.schemaVersion === 7) {
      const durability = this.activeHeroesMechanics.schemaVersion === 3
        ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId]!.durability
        : this.activeHeroesMechanics.schemaVersion === 4 || this.activeHeroesMechanics.schemaVersion === 5
          || this.activeHeroesMechanics.schemaVersion === 6 || this.activeHeroesMechanics.schemaVersion === 7
          ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId]!.durability
          : undefined;
      const mana = this.activeHeroesMechanics.schemaVersion === 4 || this.activeHeroesMechanics.schemaVersion === 5
        || this.activeHeroesMechanics.schemaVersion === 6 || this.activeHeroesMechanics.schemaVersion === 7
        ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId]!.mana
        : undefined;
      const skillTree = this.activeHeroesMechanics.schemaVersion === 5 || this.activeHeroesMechanics.schemaVersion === 6
        || this.activeHeroesMechanics.schemaVersion === 7
        ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId]!.skillTree
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
          unlockedSkillIds: new Set<string>()
        })
      };
    }
    if (options.campaignBattle !== undefined) {
      this.campaignBattle = normalizeCampaignBattleLoadout(
        options.campaignBattle,
        this.activeRogueliteMechanics,
        this.content,
        missionId
      );
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
    } else {
      this.activeNavigationProfileId = undefined;
      this.activeNavigationProfile = undefined;
      this.navigationKnownPairs = Object.freeze([]);
      this.navigationMandatoryPairs = Object.freeze([]);
      this.navigationResolver = undefined;
      this.navigationFieldLookupCache = undefined;
      this.navigationEnemyFields = undefined;
    }
    this.activeFormationAssignments = this.activeNavigationProfile && this.activeEnemyBehaviors?.formations
      ? new Map(Object.entries(this.activeEnemyBehaviors.formations.cohorts).flatMap(([cohortId, cohort]) => (
          Object.entries(cohort.members).map(([enemyTypeId, role]) => [
            enemyTypeId,
            Object.freeze({
              cohortId,
              role,
              steering: cohort.steering,
              ...(cohort.protection === undefined ? {} : { protection: cohort.protection })
            })
          ] as const)
        )))
      : undefined;
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
          schemaVersion: 1 as const,
          defaultElevation: 0 as const,
          overrides: Object.freeze(this.map.getElevationOverrides().map((entry) => Object.freeze({ ...entry })))
        })
      : undefined;
    this.derivedMapIntegrityBaseline = this.captureDerivedMapIntegrityBaseline();
    this.maxCoreHp = Math.max(
      1,
      this.mission.startingCoreHp * (this.difficulty.coreHpMultiplier ?? 1) + this.metaEffectTotal("coreHp", "amountPerLevel")
    );
    this.coreHp = this.maxCoreHp;
    this.resources = this.initialResources();
    this.initializeScriptedTargeting();
    this.initializeScripts();
    if (!internal.skipGameStarted) {
      this.beginScriptTransaction();
      this.runScriptEvent("gameStarted", { type: "gameStarted" });
      this.processScriptEvents();
    }
  }

  get coins(): number {
    return this.resources.coins ?? 0;
  }

  set coins(value: number) {
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

  reset(): void {
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
      || this.activeHeroesMechanics?.schemaVersion === 6
      || this.activeHeroesMechanics?.schemaVersion === 7) {
      const durability = this.activeHeroesMechanics.schemaVersion === 3
        ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId]!.durability
        : this.activeHeroesMechanics.schemaVersion === 4 || this.activeHeroesMechanics.schemaVersion === 5
          || this.activeHeroesMechanics.schemaVersion === 6 || this.activeHeroesMechanics.schemaVersion === 7
          ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId]!.durability
          : undefined;
      const mana = this.activeHeroesMechanics.schemaVersion === 4 || this.activeHeroesMechanics.schemaVersion === 5
        || this.activeHeroesMechanics.schemaVersion === 6 || this.activeHeroesMechanics.schemaVersion === 7
        ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId]!.mana
        : undefined;
      const skillTree = this.activeHeroesMechanics.schemaVersion === 5 || this.activeHeroesMechanics.schemaVersion === 6
        || this.activeHeroesMechanics.schemaVersion === 7
        ? this.activeHeroesMechanics.definitions[this.activeHeroesMechanics.selectedHeroId]!.skillTree
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
          unlockedSkillIds: new Set<string>()
        })
      };
      this.heroMovementField = undefined;
      this.heroMovementDirty = false;
    }
    this.towers = [];
    this.logisticsAmmunitionAmounts.clear();
    this.logisticsSupplyProducers.clear();
    this.logisticsSupplyStorages.clear();
    this.logisticsSupplyTopologyCache = undefined;
    this.logisticsSupplyDirty = this.activeLogisticsSupply !== undefined;
    this.logisticsTopologyCounts = Object.freeze({ participants: 0, nodes: 0, undirectedEdges: 0 });
    this.logisticsLiveParticipantIds.clear();
    this.logisticsPowerSnapshotCache = undefined;
    this.logisticsPoweredConsumerIds = undefined;
    this.logisticsPowerDirty = this.activeLogisticsPower !== undefined;
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
    if (this.draftInitialRngState) this.draftRng = SeededRng.fromState(this.draftInitialRngState);
    this.rebuildRogueliteSynergies();
    this.enemyShields = {};
    this.towerShields = {};
    this.enemyMarks = {};
    this.enemyComponentStates = {};
    this.projectiles = [];
    this.weatherRuntime = this.weatherSchedule ? createWeatherRuntimeV1(this.weatherSchedule) : undefined;
    this.nextProjectileSequence = 1;
    this.projectileClearanceInspectionsThisTick = 0;
    this.projectileDestructibleInspectionsThisTick = 0;
    this.projectileRicochetInspectionsThisTick = 0;
    this.projectileRicochetsThisTick = 0;
    this.initializeDestructibleObjects();
    this.vanguardProtectionIndex = undefined;
    this.vanguardProtectionTransactionsThisTick = 0;
    this.vanguardProtectionCandidatesInspected = 0;
    this.vanguardProtectionMaximumCandidateCount = 0;
    this.directorDecisions = Object.freeze([]);
    this.initializeQuestEntries();
    this.lastEvents = [];
    if (this.activePhysicsMechanics) this.displacementStepAttemptsThisTick = 0;
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

  private questRuntimeSeed(): string {
    return questRuntimeSeed(this.initialRngState, this.mission.id);
  }

  private initializeQuestEntries(): void {
    const active = this.activeQuestMechanics;
    if (!active) {
      this.questEntries = Object.freeze([]);
      return;
    }
    const selected = selectProceduralQuestsV1(
      { selectionCount: active.selectionCount, definitions: active.definitions },
      { seed: this.questRuntimeSeed() }
    );
    this.questEntries = Object.freeze(selected.map(({ questId, definition }) => Object.freeze({
      questId,
      label: definition.label,
      kind: definition.objective.kind,
      current: 0,
      target: definition.objective.kind === "kill_with_source"
        ? definition.objective.count
        : definition.objective.waves,
      status: "active" as const
    })));
  }

  private replaceQuestEntry(
    questId: string,
    update: (entry: NonNullable<GameSnapshot["quests"]>["entries"][number]) => NonNullable<GameSnapshot["quests"]>["entries"][number]
  ): void {
    this.questEntries = Object.freeze(this.questEntries.map((entry) => (
      entry.questId === questId ? Object.freeze(update(entry)) : entry
    )));
  }

  private completeQuest(questId: string, kind: NonNullable<GameSnapshot["quests"]>["entries"][number]["kind"]): void {
    const entry = this.questEntries.find((candidate) => candidate.questId === questId);
    if (!entry || entry.status !== "active") return;
    this.replaceQuestEntry(questId, (current) => ({ ...current, current: current.target, status: "completed" }));
    this.lastEvents.push({ type: "questCompleted", questId, kind });
  }

  private failQuest(questId: string, kind: NonNullable<GameSnapshot["quests"]>["entries"][number]["kind"]): void {
    const entry = this.questEntries.find((candidate) => candidate.questId === questId);
    if (!entry || entry.status !== "active") return;
    this.replaceQuestEntry(questId, (current) => ({ ...current, status: "failed" }));
    this.lastEvents.push({ type: "questFailed", questId, kind });
  }

  private questDamageSourceMatches(definition: QuestDefinitionV1, source: DamageSourceRef): boolean {
    if (definition.objective.kind !== "kill_with_source") return false;
    const expected = definition.objective.source;
    if (source.kind !== expected.kind) return false;
    if (source.kind === "tower") return source.towerTypeId === expected.id;
    if (source.kind === "ability") return source.abilityId === expected.id;
    if (source.kind === "tower_script") return source.scriptId === expected.id;
    if (source.kind === "status") return source.statusId === expected.id;
    if (source.kind === "reaction") return source.reactionId === expected.id;
    return false;
  }

  private creditQuestLethalDamage(source: DamageSourceRef): void {
    const active = this.activeQuestMechanics;
    if (!active) return;
    for (const entry of this.questEntries) {
      if (entry.status !== "active") continue;
      const definition = active.definitions[entry.questId];
      if (!definition || !this.questDamageSourceMatches(definition, source)) continue;
      const next = Math.min(entry.target, entry.current + 1);
      if (next >= entry.target) {
        this.completeQuest(entry.questId, entry.kind);
      } else {
        this.replaceQuestEntry(entry.questId, (current) => ({ ...current, current: next }));
      }
    }
  }

  private questShieldScopeMatches(scope: QuestShieldScopeV1, target: "tower" | "hero"): boolean {
    return scope === "any" || scope === target;
  }

  private failPreserveShieldQuests(target: "tower" | "hero"): void {
    const active = this.activeQuestMechanics;
    if (!active) return;
    for (const entry of this.questEntries) {
      const definition = active.definitions[entry.questId];
      if (entry.status !== "active" || definition?.objective.kind !== "preserve_shield") continue;
      if (this.questShieldScopeMatches(definition.objective.scope, target)) {
        this.failQuest(entry.questId, entry.kind);
      }
    }
  }

  private advancePreserveShieldQuests(): void {
    const active = this.activeQuestMechanics;
    if (!active) return;
    for (const entry of this.questEntries) {
      const definition = active.definitions[entry.questId];
      if (entry.status !== "active" || definition?.objective.kind !== "preserve_shield") continue;
      const next = Math.min(entry.target, entry.current + 1);
      if (next >= entry.target) this.completeQuest(entry.questId, entry.kind);
      else this.replaceQuestEntry(entry.questId, (current) => ({ ...current, current: next }));
    }
  }

  private buildQuestSnapshot(): GameSnapshot["quests"] {
    if (!this.activeQuestMechanics) return undefined;
    return Object.freeze({
      schemaVersion: 1 as const,
      profileId: this.activeQuestMechanics.profileId,
      entries: Object.freeze(this.questEntries.map((entry) => Object.freeze({ ...entry })))
    });
  }

  private weatherZoneContains(zone: WeatherZoneV1, coord: HexCoord): boolean {
    return zone.kind === "all_map" || zone.tiles.some((tile) => tile.q === coord.q && tile.r === coord.r);
  }

  private activeWeatherEffects(): readonly [string, WeatherEffectV1][] {
    const active = this.weatherRuntime?.active;
    const definition = active && this.activeWeatherMechanics?.definitions[active.weatherId];
    return definition ? Object.entries(definition.effects) : [];
  }

  private weatherMultiplierAt(kind: WeatherEffectV1["kind"], coord: HexCoord): number {
    const active = this.weatherRuntime?.active;
    if (!active || !this.weatherZoneContains(active.zone, coord)) return 1;
    let multiplier = 1;
    for (const [, effect] of this.activeWeatherEffects()) {
      if (effect.kind === kind && "multiplier" in effect) multiplier *= effect.multiplier;
    }
    return multiplier;
  }

  private publishWeatherTransitions(transitions: ReturnType<typeof advanceWeatherRuntimeV1>["transitions"]): void {
    const profileId = this.activeWeatherMechanics?.profileId;
    if (!profileId) return;
    for (const transition of transitions) {
      if (transition.kind === "started") {
        this.lastEvents.push({
          type: "weatherStarted", profileId,
          waveIndex: transition.waveIndex, choiceId: transition.choiceId,
          weatherId: transition.weatherId, zoneId: transition.zoneId
        });
      } else {
        this.lastEvents.push({
          type: "weatherEnded", profileId,
          waveIndex: transition.waveIndex, choiceId: transition.choiceId,
          weatherId: transition.weatherId, zoneId: transition.zoneId,
          reason: transition.reason ?? "wave_cleared"
        });
      }
    }
  }

  private startWeatherWave(waveIndex: number): void {
    if (!this.activeWeatherMechanics || !this.weatherSchedule || !this.weatherRuntime) return;
    const result = advanceWeatherRuntimeV1(
      { zones: this.activeWeatherMechanics.zones, definitions: this.activeWeatherMechanics.definitions,
        schedule: this.activeWeatherMechanics.schedule }, this.weatherSchedule, this.weatherRuntime,
      { waveIndex, elapsedUnits: 0, waveActive: true }
    );
    this.weatherRuntime = result.runtime;
    this.publishWeatherTransitions(result.transitions);
  }

  private advanceWeather(delta: number): void {
    const activeProfile = this.activeWeatherMechanics;
    const schedule = this.weatherSchedule;
    const runtime = this.weatherRuntime;
    if (!activeProfile || !schedule || !runtime || !runtime.active) return;
    const result = advanceWeatherRuntimeV1({
      zones: activeProfile.zones, definitions: activeProfile.definitions, schedule: activeProfile.schedule
    }, schedule, runtime, {
      waveIndex: runtime.active.waveIndex,
      elapsedUnits: runtime.active.elapsedUnits + delta,
      waveActive: true
    });
    this.weatherRuntime = result.runtime;
    this.publishWeatherTransitions(result.transitions);
    let inspected = 0;
    let applications = 0;
    for (const due of result.dueEffects) {
      let affectedCount = 0;
      const zone = activeProfile.zones[due.zoneId];
      if (!zone) continue;
      for (const enemy of [...this.enemies].sort((left, right) => compareBinary(left.id, right.id))) {
        if (enemy.hp <= 0 || !this.weatherZoneContains(zone, this.enemyCoord(enemy))) continue;
        inspected += 1;
        if (inspected > WEATHER_LIMITS.targetInspectionsPerTick) {
          this.lastEvents.push({
            type: "weatherBudgetExceeded", profileId: activeProfile.profileId,
            waveIndex: due.waveIndex, limit: WEATHER_LIMITS.targetInspectionsPerTick
          });
          return;
        }
        if (applications >= WEATHER_LIMITS.applicationsPerTick) {
          this.lastEvents.push({
            type: "weatherBudgetExceeded", profileId: activeProfile.profileId,
            waveIndex: due.waveIndex, limit: WEATHER_LIMITS.applicationsPerTick
          });
          return;
        }
        if (due.effect.kind === "periodic_damage") {
          this.applyResolvedEnemyDamage(enemy, due.effect.amount, {
            kind: "weather", profileId: activeProfile.profileId, weatherId: due.weatherId,
            zoneId: due.zoneId, effectId: due.effectId
          }, {
            ...(due.effect.damageType === undefined ? {} : { damageType: due.effect.damageType }),
            tags: ["area", "over_time"]
          });
        } else {
          this.applyStatusEffect(enemy, due.effect.status);
        }
        applications += 1;
        affectedCount += 1;
      }
      this.lastEvents.push({
        type: "weatherEffectApplied", profileId: activeProfile.profileId,
        waveIndex: due.waveIndex, choiceId: due.choiceId, weatherId: due.weatherId,
        zoneId: due.zoneId, effectId: due.effectId, kind: due.effect.kind,
        applicationOrdinal: due.applicationOrdinal, affectedCount
      });
    }
  }

  private endWeatherWave(reason: "wave_cleared" | "wave_changed" = "wave_cleared"): void {
    const activeProfile = this.activeWeatherMechanics;
    const schedule = this.weatherSchedule;
    const runtime = this.weatherRuntime;
    if (!activeProfile || !schedule || !runtime?.active) return;
    const result = advanceWeatherRuntimeV1({
      zones: activeProfile.zones, definitions: activeProfile.definitions, schedule: activeProfile.schedule
    }, schedule, runtime, {
      waveIndex: runtime.active.waveIndex,
      elapsedUnits: runtime.active.elapsedUnits,
      waveActive: false
    });
    this.weatherRuntime = result.runtime;
    this.publishWeatherTransitions(result.transitions.map((entry) => entry.kind === "ended"
      ? Object.freeze({ ...entry, reason })
      : entry));
  }

  startNextWave(): ActionResult {
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
    if (result.ok) this.finishScriptedAction();
    return result;
  }

  canPlaceTower(typeId: string, coord: HexCoord): ActionResult {
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

    const footprint = this.canOccupyTowerFootprint(typeId, coord);
    if (!footprint.ok) return footprint;
    if (this.activeLogisticsPower) {
      try {
        preflightLogisticsPowerPlacementV1(
          this.activeLogisticsPower,
          this.towers,
          this.towerTypes,
          this.map,
          this.logisticsTopologyCounts,
          { id: `tower_${this.towerCounter + 1}`, typeId, coord }
        );
      } catch (error) {
        return this.fail(error instanceof Error ? error.message : "Logistics power topology limit exceeded.", "reason.noBuildSpace");
      }
    }
    if (this.activeLogisticsAmmunition) {
      try {
        assertLogisticsAmmunitionPlacement(this.activeLogisticsAmmunition, this.towers, typeId);
      } catch (error) {
        return this.fail(
          error instanceof Error ? error.message : "Logistics ammunition inventory limit exceeded.",
          "reason.noBuildSpace"
        );
      }
    }
    if (this.activeLogisticsSupply && this.activeLogisticsAmmunition) {
      try {
        preflightLogisticsSupplyTopologyV3(
          this.activeLogisticsSupply,
          this.activeLogisticsAmmunition,
          [...this.towers, { id: `tower_${this.towerCounter + 1}`, typeId, coord }],
          this.towerTypes,
          this.map
        );
      } catch (error) {
        return this.fail(
          error instanceof Error ? error.message : "Logistics supply topology limit exceeded.",
          "reason.noBuildSpace"
        );
      }
    }
    return { ok: true };
  }

  canPlaceTowerAnywhere(typeId: string): ActionResult {
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
    let firstReasonKey: ActionResult["reasonKey"] = "reason.noBuildSpace";
    let firstReasonParams: ActionResult["reasonParams"] | undefined;
    let navigationAnalyses = 0;
    for (const tile of this.map.tiles.values()) {
      if (
        this.navigationResolver
        && navigationAnalyses >= NAVIGATION_LIMITS.placementAnalysisCoordinates
      ) {
        return this.fail(
          "Dynamic navigation placement analysis budget exceeded.",
          "reason.navigationAnalysisBudgetExceeded",
          { limit: NAVIGATION_LIMITS.placementAnalysisCoordinates }
        );
      }
      const result = this.canPlaceTower(typeId, tile);
      if (result.ok) {
        return { ok: true };
      }
      if (
        this.navigationResolver
        && (result.reasonKey === "reason.lastPathBlocked" || result.reasonKey === "reason.navigationUnavailable")
      ) navigationAnalyses += 1;
      firstReason = result.reason ?? firstReason;
      firstReasonKey = result.reasonKey ?? firstReasonKey;
      firstReasonParams = result.reasonParams ?? firstReasonParams;
    }

    return { ok: false, reason: firstReason, reasonKey: firstReasonKey, reasonParams: firstReasonParams };
  }

  placeTower(typeId: string, coord: HexCoord): ActionResult {
    const check = this.canPlaceTower(typeId, coord);
    if (!check.ok) {
      return check;
    }

    const type = this.towerTypes[typeId];
    if (!type) {
      return this.fail("Unknown tower type.", "reason.unknownTower");
    }
    const towerId = `tower_${this.towerCounter + 1}`;
    const logisticsCounts = this.activeLogisticsPower
      ? preflightLogisticsPowerPlacementV1(
          this.activeLogisticsPower,
          this.towers,
          this.towerTypes,
          this.map,
          this.logisticsTopologyCounts,
          { id: towerId, typeId, coord }
        )
      : this.logisticsTopologyCounts;
    const attack = type.attack;
    const tower: TowerState = {
      id: towerId,
      typeId,
      coord: this.cleanCoord(coord),
      footprint: this.towerFootprintTiles(type, coord).map(({ q, r }) => ({ q, r })),
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

    this.towerCounter += 1;
    this.spendResources(type.cost);
    this.towers.push(tower);
    const ammunitionDefinition = this.activeLogisticsAmmunition
      ? getLogisticsAmmunitionTowerInventory(this.activeLogisticsAmmunition, typeId)
      : undefined;
    if (ammunitionDefinition) {
      this.logisticsAmmunitionAmounts.set(towerId, ammunitionDefinition.startingAmount);
    }
    if (this.activeLogisticsSupply) {
      const producer = getLogisticsProducerDefinitionV3(this.activeLogisticsSupply, typeId);
      const storage = getLogisticsStorageDefinitionV3(this.activeLogisticsSupply, typeId);
      if (producer) {
        this.logisticsSupplyProducers.set(towerId, {
          amount: producer.startingAmount,
          productionProgress: 0,
          transferProgress: producer.transferInterval
        });
      } else if (storage) {
        this.logisticsSupplyStorages.set(towerId, {
          amount: storage.startingAmount,
          transferProgress: storage.transferInterval
        });
      }
      if (producer || storage || ammunitionDefinition) this.markLogisticsSupplyDirty();
    }
    if (this.isLogisticsParticipantType(typeId)) {
      this.logisticsTopologyCounts = logisticsCounts;
      this.logisticsLiveParticipantIds.add(towerId);
      this.markLogisticsPowerDirty();
    }
    this.rebuildRogueliteSynergies();
    this.initializeTowerShield(tower);
    this.map.setOccupied(tower.footprint, towerId);
    this.syncNavigationOccupancy();
    const placedTile = this.map.getTile(coord)!;
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

  canMoveTower(towerId: string, coord: HexCoord): ActionResult {
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

    if (this.activeLogisticsPower) {
      try {
        preflightLogisticsPowerMoveV1(
          this.activeLogisticsPower,
          this.towers,
          this.towerTypes,
          this.map,
          this.logisticsTopologyCounts,
          towerId,
          coord
        );
      } catch (error) {
        return this.fail(error instanceof Error ? error.message : "Logistics power topology limit exceeded.", "reason.noBuildSpace");
      }
    }

    if (this.activeLogisticsSupply && this.activeLogisticsAmmunition) {
      try {
        preflightLogisticsSupplyTopologyV3(
          this.activeLogisticsSupply,
          this.activeLogisticsAmmunition,
          this.towers.map((candidate) => candidate.id === towerId ? { ...candidate, coord } : candidate),
          this.towerTypes,
          this.map
        );
      } catch (error) {
        return this.fail(
          error instanceof Error ? error.message : "Logistics supply topology limit exceeded.",
          "reason.noBuildSpace"
        );
      }
    }

    return { ok: true };
  }

  moveTower(towerId: string, coord: HexCoord): ActionResult {
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
    const footprint = this.towerFootprintTiles(type, coord).map(({ q, r }) => ({ q, r }));
    const logisticsCounts = this.activeLogisticsPower
      ? preflightLogisticsPowerMoveV1(
          this.activeLogisticsPower,
          this.towers,
          this.towerTypes,
          this.map,
          this.logisticsTopologyCounts,
          towerId,
          coord
        )
      : this.logisticsTopologyCounts;

    const moveTowerCost = this.content.constants.moveTowerCost;
    this.spendResources(moveTowerCost);
    this.map.clearOccupied(tower.id);
    tower.coord = this.cleanCoord(coord);
    tower.footprint = footprint;
    this.map.setOccupied(footprint, tower.id);
    if (this.isLiveLogisticsParticipant(tower)) {
      this.logisticsTopologyCounts = logisticsCounts;
      this.markLogisticsPowerDirty();
    }
    if (this.isLogisticsSupplyTopologyParticipant(tower.typeId)) this.markLogisticsSupplyDirty();
    this.syncNavigationOccupancy();
    this.lastEvents.push({ type: "towerMoved", towerId, from, to: this.cleanCoord(coord), cost: this.cloneResources(moveTowerCost) });
    this.finishScriptedAction();
    return { ok: true };
  }

  canUpgradeTower(towerId: string, branchId?: string): ActionResult {
    const tower = this.towers.find((item) => item.id === towerId);
    if (!tower) {
      return this.fail("No tower selected.", "reason.noTowerSelected");
    }

    if (tower.upgradeBranchId !== undefined) {
      return this.fail("Upgrade branch is already locked.", "reason.upgradeBranchLocked");
    }
    const type = this.towerTypes[tower.typeId];
    if (!type) {
      return this.fail("Unknown tower type.", "reason.unknownTower");
    }
    const branches = type.upgradeBranches;
    if (tower.level === 2 && branches?.length) {
      if (branchId === undefined) {
        return this.fail("Choose an upgrade branch.", "reason.upgradeBranchRequired");
      }
      const branch = branches.find((candidate) => candidate.id === branchId);
      const target = branch ? this.towerTypes[branch.targetTowerId] : undefined;
      if (!branch || !target) {
        return this.fail("Unknown upgrade branch.", "reason.unknownUpgradeBranch");
      }
      if (target.footprintRadius !== type.footprintRadius || target.footprintShape !== type.footprintShape) {
        return this.fail("Upgrade branch changes the tower footprint.", "reason.upgradeBranchFootprintMismatch");
      }
    } else if (branchId !== undefined) {
      return this.fail("Upgrade branch is not available yet.", "reason.upgradeBranchUnavailable");
    }

    const cost = this.getTowerUpgradeCost(tower, branchId);
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

  getTowerUpgradeCost(towerOrId: TowerState | string, branchId?: string): ResourceCost | null {
    const tower = typeof towerOrId === "string" ? this.towers.find((item) => item.id === towerOrId) : towerOrId;
    if (!tower) {
      return null;
    }

    const type = this.towerTypes[tower.typeId];
    if (!type) {
      return null;
    }
    if (tower.upgradeBranchId !== undefined) return null;
    if (tower.level === 2 && type.upgradeBranches?.length) {
      if (branchId === undefined) return null;
      return type.upgradeBranches.find((branch) => branch.id === branchId)?.cost ?? null;
    }
    if (branchId !== undefined) return null;
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

  upgradeTower(towerId: string, branchId?: string): ActionResult {
    const tower = this.towers.find((item) => item.id === towerId);
    if (!tower) {
      return this.fail("No tower selected.", "reason.noTowerSelected");
    }

    const check = this.canUpgradeTower(towerId, branchId);
    if (!check.ok) {
      return check;
    }

    const cost = this.getTowerUpgradeCost(tower, branchId);
    if (!cost) {
      return this.fail("Cluster is already full.", "reason.clusterFull");
    }

    const type = this.towerTypes[tower.typeId];
    if (!type) {
      return this.fail("Unknown tower type.", "reason.unknownTower");
    }
    const branch = tower.level === 2 && branchId !== undefined
      ? type.upgradeBranches?.find((candidate) => candidate.id === branchId)
      : undefined;
    const targetType = branch ? this.towerTypes[branch.targetTowerId] : undefined;
    if (branch && !targetType) {
      return this.fail("Unknown upgrade branch target.", "reason.unknownUpgradeBranch");
    }

    this.spendResources(cost);
    this.addToBag(tower.investedResources, cost);
    if (branch && targetType) {
      tower.baseTypeId = type.id;
      tower.upgradeBranchId = branch.id;
      tower.typeId = targetType.id;
      tower.level = 3;
      tower.targetMode = targetType.attack.kind === "sniper"
        ? (targetType.attack.targetPriority ?? "first")
        : targetType.attack.kind === "pipeline"
          ? (targetType.attack.targeting?.mode ?? "first")
          : undefined;
      if (targetType.maxHp === undefined) {
        delete tower.hp;
      } else {
        tower.hp = Math.min(tower.hp ?? targetType.maxHp, targetType.maxHp);
      }
      this.rebuildRogueliteSynergies();
      if (this.isLogisticsSupplyTopologyParticipant(type.id) || this.isLogisticsSupplyTopologyParticipant(targetType.id)) {
        this.markLogisticsSupplyDirty();
      }
      this.markLogisticsPowerDirty();
    } else if (type.attack.kind === "single") {
      tower.stacks += 1;
    } else {
      tower.level += 1;
    }
    this.lastEvents.push({
      type: "towerUpgraded",
      towerId,
      level: tower.level,
      stacks: tower.stacks,
      ...(branch && targetType ? {
        branchId: branch.id,
        baseTypeId: type.id,
        typeId: targetType.id
      } : {})
    });
    this.finishScriptedAction();
    return { ok: true };
  }

  canSocketArtifact(artifactInstanceId: string, towerId: string, slotId: string): ActionResult {
    const availability = this.artifactManagementAvailability();
    if (!availability.ok) return availability;
    const active = this.activeRogueliteMechanics;
    const artifacts = active?.artifacts;
    if (!active || !artifacts) {
      return this.fail("Artifacts are not available.", "reason.artifactsUnavailable");
    }
    const entry = this.artifactInventory.find((item) => item.instanceId === artifactInstanceId);
    if (!entry) return this.fail("Artifact is not owned.", "reason.artifactNotOwned");
    if (entry.socket) return this.fail("Artifact is already socketed.", "reason.artifactAlreadySocketed");
    const tower = this.towers.find((item) => item.id === towerId && (item.hp === undefined || item.hp > 0));
    if (!tower) return this.fail("Tower was not found.", "reason.artifactTowerNotFound");
    const slot = artifacts.towerSlots[tower.typeId]?.find((item) => item.slotId === slotId);
    if (!slot) return this.fail("Artifact slot was not found.", "reason.artifactSlotNotFound");
    const definition = artifacts.definitions[entry.artifactId];
    if (!definition || definition.slotType !== slot.slotType) {
      return this.fail("Artifact is incompatible with this slot.", "reason.artifactSlotIncompatible");
    }
    if (this.artifactInventory.some((item) => item.socket?.towerId === towerId && item.socket.slotId === slotId)) {
      return this.fail("Artifact slot is occupied.", "reason.artifactSlotOccupied");
    }
    const existingModifierCount = this.artifactInventory.reduce((sum, item) => {
      if (item.socket?.towerId !== towerId) return sum;
      return sum + (artifacts.definitions[item.artifactId]?.modifiers.length ?? 0);
    }, 0);
    const synergyWorstCase = rogueliteSynergyWorstCaseModifierCount(active.synergies);
    if (
      synergyWorstCase
      + existingModifierCount
      + definition.modifiers.length
      + ROGUELITE_DAMAGE_MODIFIER_RESERVE.total
      + activeHeroAuraModifierReserve(this.content, this.mission.id)
      > MAX_MODIFIERS_PER_RESOLUTION
    ) {
      return this.fail("Artifact modifier budget is exceeded.", "reason.artifactModifierBudgetExceeded");
    }
    return { ok: true };
  }

  socketArtifact(artifactInstanceId: string, towerId: string, slotId: string): ActionResult {
    const check = this.canSocketArtifact(artifactInstanceId, towerId, slotId);
    if (!check.ok) return check;
    const index = this.artifactInventory.findIndex((item) => item.instanceId === artifactInstanceId);
    const tower = this.towers.find((item) => item.id === towerId);
    if (index < 0 || !tower) return this.fail("Artifact socketing state changed.", "reason.artifactNotOwned");
    const previous = this.artifactInventory[index]!;
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

  canUnsocketArtifact(artifactInstanceId: string, towerId: string, slotId: string): ActionResult {
    const availability = this.artifactManagementAvailability();
    if (!availability.ok) return availability;
    const entry = this.artifactInventory.find((item) => item.instanceId === artifactInstanceId);
    if (!entry) return this.fail("Artifact is not owned.", "reason.artifactNotOwned");
    if (entry.socket?.towerId !== towerId || entry.socket.slotId !== slotId) {
      return this.fail("Artifact socket assignment changed.", "reason.artifactSocketMismatch");
    }
    return { ok: true };
  }

  unsocketArtifact(artifactInstanceId: string, towerId: string, slotId: string): ActionResult {
    const check = this.canUnsocketArtifact(artifactInstanceId, towerId, slotId);
    if (!check.ok) return check;
    const entry = this.artifactInventory.find((item) => item.instanceId === artifactInstanceId);
    const tower = this.towers.find((item) => item.id === towerId);
    if (!entry || !tower) return this.fail("Artifact socket assignment changed.", "reason.artifactSocketMismatch");
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

  chooseDraftOption(offerId: string, cardId: string): ActionResult {
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

  getTowerSellRefund(towerOrId: TowerState | string): ResourceBag | null {
    const tower = typeof towerOrId === "string" ? this.towers.find((item) => item.id === towerOrId) : towerOrId;
    if (!tower) return null;
    const ratio = this.mission.economy?.sellRefundRatio ?? 0.7;
    const refund = this.cloneResources({});
    for (const currencyId of this.currencyIds) {
      const invested = Number(tower.investedResources?.[currencyId]) || 0;
      refund[currencyId] = Math.floor(invested * ratio * 100 + 1e-9) / 100;
    }
    return refund;
  }

  canSellTower(towerId: string): ActionResult {
    const tower = this.towers.find((item) => item.id === towerId);
    if (!tower) return this.fail("No tower selected.", "reason.noTowerSelected");
    if (this.outcome !== "playing") return this.fail("Mission already ended.", "reason.missionEnded");
    if (!this.dependentsKeepSupportAfterRemoval(towerId)) {
      return this.fail("Dependent towers still need this support aura.", "reason.dependentsLoseAura");
    }
    return { ok: true };
  }

  sellTower(towerId: string): ActionResult {
    const tower = this.towers.find((item) => item.id === towerId);
    if (!tower) return this.fail("No tower selected.", "reason.noTowerSelected");
    const check = this.canSellTower(towerId);
    if (!check.ok) return check;
    const refund = this.getTowerSellRefund(tower) ?? this.cloneResources({});
    this.addResources(refund);
    this.autoUnsocketTowerArtifacts(tower, "tower_sold");
    this.destroyTower(towerId);
    this.lastEvents.push({ type: "towerSold", towerId, towerTypeId: tower.typeId, refund });
    this.finishScriptedAction();
    return { ok: true };
  }

  setTowerTargetMode(towerId: string, mode: TowerTargetMode): ActionResult {
    const tower = this.towers.find((item) => item.id === towerId);
    if (!tower) {
      return this.fail("No tower selected.", "reason.noTowerSelected");
    }

    if (this.scriptedTargetingByTowerType.has(tower.typeId)) {
      return this.fail(
        "This tower's target priority is controlled by TowerScript.",
        "reason.targetModeScripted"
      );
    }

    if (!this.towerSupportsTargetMode(tower)) {
      return this.fail("This tower has no selectable target mode.", "reason.targetModeUnsupported");
    }
    if (!(TOWER_TARGET_MODES as readonly string[]).includes(mode)) {
      return this.fail("Unknown target mode.", "reason.targetModeUnknown", { mode });
    }

    tower.targetMode = mode;
    this.lastEvents.push({ type: "towerTargetModeChanged", towerId, mode });
    this.finishScriptedAction();
    return { ok: true };
  }

  usePathWaterAbility(center: HexCoord): ActionResult {
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
      if (!result.ok) return result;
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

  private useActivePathWaterAbility(
    ability: MissionAbilityDefinition,
    center: HexCoord,
    effectCoords: readonly HexCoord[]
  ): ActionResult {
    if (effectCoords.length > TERRAFORMING_LIMITS.operationsPerBatch) {
      return this.fail(
        `Water spill exceeds the ${TERRAFORMING_LIMITS.operationsPerBatch} tile operation budget.`,
        "terraform.operation_budget_exceeded"
      );
    }
    if (this.pendingTerraformExpiryGroups.length >= TERRAFORMING_LIMITS.pendingExpiryGroups) {
      return this.fail(
        `Terraform expiry groups exceed the ${TERRAFORMING_LIMITS.pendingExpiryGroups} group limit.`,
        "terraform.expiry_group_budget_exceeded"
      );
    }
    if (!Number.isFinite(ability.duration)
      || ability.duration <= 0
      || ability.duration > TERRAFORMING_LIMITS.duration) {
      return this.fail(
        `Terraform duration must be finite and inside (0, ${TERRAFORMING_LIMITS.duration}].`,
        "terraform.duration_out_of_range"
      );
    }
    if (!this.content.terrainTypes.water) {
      return this.fail(
        'Terraform destination terrain "water" is unknown.',
        "terraform.invalid_operation"
      );
    }
    for (const coord of effectCoords) {
      const existing = this.runtimeTerrainOverrides.get(coordKey(coord));
      if (this.isNativeTerraformTargetOwned("terrain", coord) || typeof existing?.expiresIn === "number") {
        return this.fail(
          `Terraform terrain target ${coordKey(coord)} is owned by a timed override.`,
          "terraform.target_owned"
        );
      }
    }

    try {
      this.applyResolvedPersistentOperations(
        effectCoords.map((coord, order): ResolvedPersistentOperation => ({
          kind: "set_terrain",
          coord,
          directTerrainId: "water",
          terrainSource: "ability",
          order
        })),
        ability.duration
      );
    } catch (error) {
      if (!(error instanceof TowerScriptTerraformingError)) throw error;
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
  private builtinAbilityEffects(abilityId: MissionAbilityId, ability: MissionAbilityDefinition): AbilityEffect[] | undefined {
    if (abilityId === "strike") {
      return [{ kind: "damage", amount: Math.max(0, ability.damage ?? 0) }];
    }
    if (abilityId === "freeze") {
      return [{ kind: "status", status: { stun: ability.stunDuration ?? ability.duration } }];
    }
    return undefined;
  }

  private displacementEffectRanks(effects: readonly unknown[]): ReadonlyMap<number, number> {
    const ranks = new Map<number, number>();
    let displacementIndex = 0;
    effects.forEach((effect, index) => {
      const inspected = inspectOwnDataEffect(effect);
      if (!inspected.ok || inspected.kind !== "displacement") return;
      ranks.set(index, displacementIndex);
      displacementIndex += 1;
    });
    return ranks;
  }

  private reserveDisplacementEffect(
    value: unknown,
    activationBudget: DisplacementActivationBudget | undefined,
    includeTickBudget: boolean
  ): ReturnType<typeof parseDisplacementEffectV1> {
    if (!this.activePhysicsMechanics || !activationBudget) return undefined;
    const effect = parseDisplacementEffectV1(value);
    if (!effect) return undefined;
    const reserved = effect.distance;
    if (activationBudget.used + reserved > activationBudget.limit) return undefined;
    if (includeTickBudget
      && this.displacementStepAttemptsThisTick + reserved > PHYSICS_LIMITS.stepAttemptsPerTick) return undefined;
    activationBudget.used += reserved;
    if (includeTickBudget) this.displacementStepAttemptsThisTick += reserved;
    return effect;
  }

  private safeAbilityEffectsForEvent(effects: readonly unknown[]): AbilityEffect[] {
    const safe: AbilityEffect[] = [];
    for (const value of effects) {
      const inspected = inspectOwnDataEffect(value);
      if (!inspected.ok) continue;
      if (inspected.kind === "displacement") {
        if (!this.activePhysicsMechanics) continue;
        const effect = parseDisplacementEffectV1(inspected.record);
        if (effect) safe.push(effect);
      } else if (inspected.kind === "damage" || inspected.kind === "status") {
        safe.push(inspected.record as unknown as AbilityEffect);
      }
    }
    return safe;
  }

  private applyAbilityEffect(
    enemy: EnemyState,
    effectValue: unknown,
    abilityId: MissionAbilityId,
    center: HexCoord,
    displacementAllowed: boolean,
    displacementBudget: DisplacementActivationBudget | undefined
  ): void {
    const inspected = inspectOwnDataEffect(effectValue);
    if (!inspected.ok) return;
    const effect = inspected.record;
    if (inspected.kind === "damage") {
      if (typeof effect.amount !== "number" || !Number.isFinite(effect.amount)) return;
      this.applyResolvedEnemyDamage(
        enemy,
        Math.max(0, effect.amount),
        { kind: "ability", abilityId },
        { tags: ["area"] }
      ); // reward/removal handled by the next removeDeadEnemies() pass
    } else if (inspected.kind === "status") {
      if (!effect.status || typeof effect.status !== "object") return;
      this.applyStatusEffect(enemy, effect.status as StatusEffectSpec);
    } else if (inspected.kind === "displacement" && displacementAllowed) {
      const displacement = this.reserveDisplacementEffect(effect, displacementBudget, false);
      if (!displacement) return;
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
  useAbility(abilityId: MissionAbilityId, center: HexCoord): ActionResult {
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
    const displacementBudget: DisplacementActivationBudget | undefined = this.activePhysicsMechanics
      ? { used: 0, limit: PHYSICS_LIMITS.stepAttemptsPerActivation }
      : undefined;
    const enemyIds: string[] = [];
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
      const enemy = targets[targetIndex]!;
      for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
        if (enemy.hp <= 0) break;
        const displacementRank = displacementRanks?.get(effectIndex);
        this.applyAbilityEffect(
          enemy,
          effects[effectIndex],
          abilityId,
          center,
          displacementRank !== undefined && (
            targetIndex < PHYSICS_LIMITS.displacementTargetsPerActivation
            && displacementRank < PHYSICS_LIMITS.displacementEffectsPerSource
          ),
          displacementBudget
        );
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
  emitScriptSignal(signal: string, payload: TowerScriptJson = null): ActionResult {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(signal)) {
      return this.fail("Script signal must be a safe identifier.", "reason.invalidScriptSignal");
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      return this.fail("Script signal payload must be JSON-compatible.", "reason.invalidScriptPayload");
    }
    if (serialized === undefined || serialized.length > TOWER_SCRIPT_LIMITS.externalSignalPayloadBytes) {
      return this.fail("Script signal payload exceeds 64 KiB.", "reason.invalidScriptPayload");
    }
    const safePayload = JSON.parse(serialized) as TowerScriptJson;
    this.beginScriptTransaction();
    this.lastEvents.push({ type: "scriptSignal", scriptId: "external", signal, payload: safePayload });
    this.runScriptEvent("signal", { type: "signal", signal, payload: safePayload, sourceScriptId: "external" });
    this.processScriptEvents();
    this.stabilizeDynamicEnemyNavigation();
    return { ok: true };
  }

  getTowerIdAt(coord: HexCoord): string | undefined {
    return this.map.occupiedTowerAt(coord);
  }

  /** Retarget the single opt-in v2 hero through a canonical shared flow field. */
  moveHero(heroId: string, target: HexCoord): ActionResult {
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

    let field: NavigationFieldResult;
    try {
      field = this.buildHeroMovementField(profile, target);
    } catch {
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
  useHeroAbility(heroId: string, abilityId: string, targetEnemyId: string): ActionResult {
    if (this.outcome !== "playing") {
      return this.fail("Mission already ended.", "reason.missionEnded");
    }
    const profile = this.activeHeroesMechanics;
    const state = this.heroStateV2;
    if ((profile?.schemaVersion !== 4 && profile?.schemaVersion !== 5 && profile?.schemaVersion !== 6
      && profile?.schemaVersion !== 7) || !state) {
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
    const applied = this.applyResolvedEnemyDamage(
      target,
      definition.activeAbility.damage,
      { kind: "ability", abilityId: definition.activeAbility.id },
      profile.schemaVersion === 5 || profile.schemaVersion === 6 || profile.schemaVersion === 7
        ? { modifiers: this.heroAbilitySkillModifiers(profile, state) }
        : undefined
    );
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
  unlockHeroSkill(heroId: string, skillId: string): ActionResult {
    if (this.outcome !== "playing") {
      return this.fail("Mission already ended.", "reason.missionEnded");
    }
    const profile = this.activeHeroesMechanics;
    const state = this.heroStateV2;
    if ((profile?.schemaVersion !== 5 && profile?.schemaVersion !== 6 && profile?.schemaVersion !== 7) || !state) {
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
    if (skill.requires.some((requiredId) => !state.unlockedSkillIds!.has(requiredId))) {
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

  tick(deltaUnits: number): void {
    this.lastEvents = [];
    this.vanguardProtectionTransactionsThisTick = 0;
    this.projectileClearanceInspectionsThisTick = 0;
    this.projectileDestructibleInspectionsThisTick = 0;
    this.projectileRicochetInspectionsThisTick = 0;
    this.projectileRicochetsThisTick = 0;
    this.vanguardProtectionIndex = undefined;
    if (this.activePhysicsMechanics) this.displacementStepAttemptsThisTick = 0;
    this.scriptEventCursor = 0;
    this.beginScriptTransaction();
    if (this.pendingDraftOffer) return;

    if (this.outcome !== "playing") {
      return;
    }

    const delta = Math.max(0, Math.min(deltaUnits, 0.2));
    this.updateAbilities(delta);
    this.advanceNativeTerraformingExpiry(delta);
    this.updateHeroAbility(delta);
    this.moveHeroUnit(delta);

    // Externally authored deterministic queues (for example asymmetric multiplayer sends)
    // advance even before the lane's first authored wave starts.
    if (this.startedWaveCount > 0 || this.spawnQueue.length > 0) {
      this.missionElapsed += delta;
      this.applyPassiveIncome(delta);
      this.startScheduledWaves();
      this.spawnDueEnemies();
      this.syncPrepRemaining();
    }

    this.updateShieldRegeneration(delta);
    this.advanceWeather(delta);
    this.updateEnemyMarks(delta);
    this.updateEnemyExposures(delta);
    this.updateEnemyStatuses(delta);
    this.moveEnemies(delta);
    this.updateProjectiles(delta);
    this.vanguardProtectionIndex = undefined;
    this.applySunlightRegeneration(delta);
    this.applyHealAuras(delta);
    this.applyDotDamage(delta);
    this.updateTowerDisruptions(delta);
    this.updateEnemyTowerAttacks(delta);
    this.updateLogisticsSupply(delta);
    this.updateTowers(delta);
    this.triggerEnemyPhaseSpawns();
    this.removeDeadEnemies();
    this.processScriptEvents();
    if (this.outcome === "playing") this.runScriptEvent("tick", { type: "tick", delta });
    this.removeDeadEnemies();
    this.processScriptEvents();
    this.resolveWaveState();
    this.processScriptEvents();
    this.stabilizeDynamicEnemyNavigation();
    if (this.pendingDraftOffer) this.beginScriptTransaction();
  }

  getSnapshot(): GameSnapshot {
    return this.buildSnapshot(true);
  }

  getRenderSnapshot(): GameSnapshot {
    return this.buildSnapshot(false);
  }

  /** Export only the portable run-owned result; sockets and other battle state never cross missions. */
  exportCampaignBattleSettlement(): CampaignBattleSettlementV1 | undefined {
    if (!this.campaignBattle || this.outcome !== "victory") return undefined;
    return Object.freeze({
      schemaVersion: 1,
      launchId: this.campaignBattle.launchId,
      nodeId: this.campaignBattle.nodeId,
      missionId: this.mission.id,
      deck: Object.freeze([
        ...this.campaignDeck.map((entry) => Object.freeze({ ...entry })),
        ...this.draftSelections.map((entry) => Object.freeze({
          instanceId: entry.instanceId!,
          cardId: entry.cardId
        }))
      ]),
      artifacts: Object.freeze(this.artifactInventory.map((entry) => Object.freeze({
        instanceId: entry.instanceId,
        artifactId: entry.artifactId
      })))
    });
  }

  getCampaignBattleBinding(): Readonly<{ launchId: string; nodeId: string; missionId: string }> | undefined {
    if (!this.campaignBattle) return undefined;
    return Object.freeze({
      launchId: this.campaignBattle.launchId,
      nodeId: this.campaignBattle.nodeId,
      missionId: this.mission.id
    });
  }

  /** Pure, bounded diagnostics for active opt-in elevation and live destructible line of sight. */
  analyzeLineOfSight(
    request: LineOfSightAnalysisRequestV1
  ): LineOfSightAnalysisV1 | LineOfSightAnalysisV2 | undefined {
    const profile = this.activeLineOfSightProfile;
    const dynamicIndex = this.dynamicLineOfSightIndex;
    if (!profile && !dynamicIndex) return undefined;
    const normalized = normalizeLineOfSightAnalysisRequestV1(request, this.map);
    if (dynamicIndex) {
      return analyzeLineOfSightTargetsV2(
        this.map,
        profile === undefined ? undefined : this.lineOfSightLegacyPolicy(profile),
        dynamicIndex,
        {
          ...(profile === undefined ? {} : { elevation: profile.profileId }),
          ballistics: this.activeBallisticsMechanics!.profileId
        },
        normalized
      );
    }
    return analyzeLineOfSightTargets(
      this.map,
      this.content.terrainTypes,
      profile!,
      normalized
    );
  }

  /** Pure, bounded diagnostics for active opt-in dynamic-flow navigation. */
  analyzeNavigation(request: NavigationAnalysisRequestV1): NavigationAnalysisV1 | undefined {
    const profile = this.activeNavigationProfile;
    const profileId = this.activeNavigationProfileId;
    if (!profile || profileId === undefined) return undefined;

    const normalized = normalizeNavigationAnalysisRequestV1(request, {
      width: this.map.width,
      height: this.map.height,
      movementProfileIds: Object.keys(profile.movementProfiles),
      routeIds: this.map.pathRoutes.map((route) => route.id),
      towerTypeIds: Object.keys(this.towerTypes)
    });
    const budget: NavigationAnalysisRelaxationBudget = {
      used: 0,
      limit: NAVIGATION_LIMITS.placementAnalysisRelaxations,
      fields: new WeakSet()
    };
    const fields = this.buildNavigationAnalysisFields(normalized, budget);
    const placementContext = normalized.coordinates.length > 0
      ? this.createNavigationPlacementAnalysisContext(budget)
      : undefined;
    const placementRows = normalized.coordinates.map((coord) => {
      const result = this.canOccupyTowerFootprint(
        normalized.towerTypeId!,
        coord,
        undefined,
        placementContext
      );
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

  createCheckpoint(): GameCheckpointV1 {
    this.assertDerivedMapIntegrity();
    const identity = this.checkpointIdentity();
    const state = this.buildCheckpointState();
    const currentRng = this.rng.exportState();
    const contentDigest = getSimulationContentDigest(this.content);
    const rng = {
      initial: this.initialRngState,
      current: currentRng
    };
    const checkpoint: GameCheckpointV1 = {
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

  getStateDigest(): string {
    this.assertDerivedMapIntegrity();
    const identity = this.checkpointIdentity();
    return computeCheckpointStateDigest(
      getSimulationContentDigest(this.content),
      identity,
      { initial: this.initialRngState, current: this.rng.exportState() },
      this.buildCheckpointState()
    );
  }

  /**
   * Strictly validate and detach a checkpoint without constructing a map or
   * executing simulation behavior. Restore and journal decoders share this path.
   */
  static validateCheckpoint(options: {
    content: GameContentRegistry;
    checkpoint: GameCheckpointV1;
  }): GameCheckpointV1 {
    const descriptors = inspectCheckpointEnvelope(options.checkpoint);

    const expectedContentDigest = checkpointDataField(descriptors, "contentDigest", "Game checkpoint");
    if (typeof expectedContentDigest !== "string" || expectedContentDigest !== getSimulationContentDigest(options.content)) {
      throw new Error("Game checkpoint content digest mismatch.");
    }

    const identity = cloneCheckpointJson(
      checkpointDataField(descriptors, "identity", "Game checkpoint")
    ) as GameCheckpointIdentityV1;
    TowerDefenseGame.validateCheckpointIdentity(options.content, identity);

    const rngDescriptors = checkpointObjectDescriptors(
      checkpointDataField(descriptors, "rng", "Game checkpoint"),
      "Game checkpoint RNG"
    );
    requireExactCheckpointKeys(rngDescriptors, ["initial", "current"], "Game checkpoint RNG");
    const initialRng = cloneCheckpointJson(
      checkpointDataField(rngDescriptors, "initial", "Game checkpoint RNG")
    ) as SeededRngStateV1;
    const currentRng = cloneCheckpointJson(
      checkpointDataField(rngDescriptors, "current", "Game checkpoint RNG")
    ) as SeededRngStateV1;
    for (const [label, rngState] of [["initial", initialRng], ["current", currentRng]] as const) {
      requireExactCheckpointKeys(
        checkpointObjectDescriptors(rngState, `Game checkpoint ${label} RNG state`),
        ["schemaVersion", "algorithm", "words"],
        `Game checkpoint ${label} RNG state`
      );
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
          if (key === "length") continue;
          const enemyDescriptor = rawEnemyDescriptors[key];
          if (!enemyDescriptor || !("value" in enemyDescriptor) || !enemyDescriptor.enumerable) continue;
          const rawEnemy = enemyDescriptor.value;
          if (rawEnemy === null || typeof rawEnemy !== "object" || Array.isArray(rawEnemy)) continue;
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
        if (key === "length") continue;
        const enemyDescriptor = rawEnemyDescriptors[key];
        if (!enemyDescriptor || !("value" in enemyDescriptor) || !enemyDescriptor.enumerable) continue;
        const rawEnemy = enemyDescriptor.value;
        if (rawEnemy === null || typeof rawEnemy !== "object" || Array.isArray(rawEnemy)) continue;
        const enemyDescriptors = Object.getOwnPropertyDescriptors(rawEnemy);
        if (!Object.prototype.hasOwnProperty.call(enemyDescriptors, "navigation")) continue;
        const navigationValue = checkpointDataField(
          enemyDescriptors,
          "navigation",
          "Game checkpoint enemy navigation"
        );
        const navigationDescriptors = checkpointObjectDescriptors(
          navigationValue,
          "Game checkpoint enemy navigation"
        );
        for (const coordKey of ["currentCoord", "nextCoord"] as const) {
          if (!Object.prototype.hasOwnProperty.call(navigationDescriptors, coordKey)) continue;
          const coordDescriptors = checkpointObjectDescriptors(
            checkpointDataField(navigationDescriptors, coordKey, "Game checkpoint enemy navigation"),
            `Game checkpoint enemy navigation ${coordKey}`
          );
          for (const axis of ["q", "r"] as const) {
            checkpointDataField(coordDescriptors, axis, `Game checkpoint enemy navigation ${coordKey}`);
          }
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(rawStateDescriptors, "reactions")) {
      const rawReactions = checkpointObjectDescriptors(
        checkpointDataField(rawStateDescriptors, "reactions", "Game checkpoint state"),
        "Game checkpoint reaction state"
      );
      const rawExposures = checkpointObjectDescriptors(
        checkpointDataField(rawReactions, "exposures", "Game checkpoint reaction state"),
        "Game checkpoint reaction exposures"
      );
      const rawEnemies = checkpointObjectDescriptors(
        checkpointDataField(rawExposures, "enemies", "Game checkpoint reaction exposures"),
        "Game checkpoint reaction exposure enemies"
      );
      const enemyIds = Object.keys(rawEnemies);
      if (enemyIds.join("\u0000") !== [...enemyIds].sort().join("\u0000")) {
        throw new Error("Game checkpoint reaction enemy order is not canonical.");
      }
      for (const enemyId of enemyIds) {
        const rawEnemyExposures = checkpointObjectDescriptors(
          checkpointDataField(rawEnemies, enemyId, "Game checkpoint reaction exposure enemies"),
          `Game checkpoint reaction exposures for ${enemyId}`
        );
        const exposureIds = Object.keys(rawEnemyExposures);
        if (exposureIds.join("\u0000") !== [...exposureIds].sort().join("\u0000")) {
          throw new Error("Game checkpoint exposure order is not canonical.");
        }
      }
    }
    const state = cloneCheckpointJson(rawState) as GameCheckpointStateV1;
    TowerDefenseGame.validateCheckpointState(options.content, identity, state, initialRng);
    const expectedStateDigest = checkpointDataField(descriptors, "stateDigest", "Game checkpoint");
    if (
      typeof expectedStateDigest !== "string" ||
      expectedStateDigest !== computeCheckpointStateDigest(
        expectedContentDigest,
        identity,
        { initial: initialRng, current: currentRng },
        state
      )
    ) {
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

  static fromCheckpoint(options: {
    content: GameContentRegistry;
    checkpoint: GameCheckpointV1;
    towerScriptTrace?: TowerScriptTraceCollector;
  }): TowerDefenseGame {
    const checkpoint = TowerDefenseGame.validateCheckpoint(options);
    const game = new TowerDefenseGame({
      content: options.content,
      missionId: checkpoint.identity.missionId,
      difficultyId: checkpoint.identity.difficultyId,
      metaUpgradeLevels: { ...checkpoint.identity.metaUpgradeLevels },
      seed: 0,
      towerScriptTrace: options.towerScriptTrace
    }, { skipGameStarted: true });
    game.restoreCheckpointState(
      checkpoint.state,
      checkpoint.rng.initial,
      checkpoint.rng.current
    );
    game.assertDerivedMapIntegrity();
    return game;
  }

  private captureDerivedMapIntegrityBaseline(): DerivedMapIntegrityBaseline {
    const freezeCoord = (coord: HexCoord): Readonly<HexCoord> => Object.freeze({ q: coord.q, r: coord.r });
    const freezeGrid = (grid: GridDefinition): GridDefinition => Object.freeze({ ...grid }) as GridDefinition;
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
      baseTerrainRef: baseTerrainDescriptor.value as Map<string, string>,
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
  private assertDerivedMapIntegrity(): void {
    const fail = (detail: string): never => {
      throw new Error(`Derived map integrity is incoherent: ${detail}`);
    };
    const ownData = (
      value: unknown,
      prototype: object | null,
      context: string,
      inspectEveryField = true
    ): Record<PropertyKey, PropertyDescriptor> => {
      if (value === null || typeof value !== "object") return fail(`${context} is not an object.`);
      let actualPrototype: object | null = null;
      let descriptors: Record<PropertyKey, PropertyDescriptor> = {};
      try {
        actualPrototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
      } catch {
        return fail(`${context} descriptors cannot be inspected.`);
      }
      if (actualPrototype !== prototype) return fail(`${context} has an unexpected prototype.`);
      if (Object.getOwnPropertySymbols(descriptors).length > 0) return fail(`${context} has symbol fields.`);
      if (inspectEveryField) {
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (!("value" in descriptor)) return fail(`${context}.${key} must be a data property.`);
          if (!descriptor.enumerable) return fail(`${context}.${key} must be enumerable.`);
        }
      }
      return descriptors;
    };
    const field = (
      descriptors: Record<PropertyKey, PropertyDescriptor>,
      key: string,
      context: string
    ): unknown => {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return fail(`${context}.${key} must be an enumerable data property.`);
      }
      return descriptor.value;
    };
    const exactKeys = (
      descriptors: Record<PropertyKey, PropertyDescriptor>,
      keys: readonly string[],
      context: string
    ): void => {
      const actual = Object.keys(descriptors);
      if (actual.length !== keys.length || keys.some((key) => !actual.includes(key))) {
        fail(`${context} has missing or extra fields.`);
      }
    };
    const assertDescriptorShape = (
      descriptors: Record<PropertyKey, PropertyDescriptor>,
      expected: readonly PropertyDescriptorSnapshot[],
      context: string
    ): void => {
      const actualKeys = Reflect.ownKeys(descriptors);
      if (
        actualKeys.length !== expected.length
        || expected.some((snapshot) => !actualKeys.some((key) => Object.is(key, snapshot.key)))
      ) {
        fail(`${context} own shape changed or has a method shadow.`);
      }
      for (const snapshot of expected) {
        if (!descriptorMatchesSnapshot(descriptors[snapshot.key], snapshot)) {
          fail(`${context} descriptor for ${String(snapshot.key)} changed.`);
        }
      }
    };
    const nativeMapSize = (value: unknown, context: string): number => {
      if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== NATIVE_MAP_PROTOTYPE) {
        return fail(`${context} is not a native Map.`);
      }
      if (Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).length > 0) {
        return fail(`${context} has unsupported own fields.`);
      }
      if (typeof NATIVE_MAP_SIZE_GETTER !== "function") return fail("native Map size intrinsic is unavailable.");
      try {
        const size = Reflect.apply(NATIVE_MAP_SIZE_GETTER, value, []);
        return typeof size === "number" && Number.isSafeInteger(size) && size >= 0
          ? size
          : fail(`${context} native size is invalid.`);
      } catch {
        return fail(`${context} native size cannot be inspected.`);
      }
    };
    const assertNativeMapIntrinsics = (): void => {
      if (Map.prototype !== NATIVE_MAP_PROTOTYPE) fail("native Map prototype identity changed.");
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
    const arrayItems = (value: unknown, context: string): readonly unknown[] => {
      if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        return fail(`${context} is not a plain array.`);
      }
      let descriptors: Record<PropertyKey, PropertyDescriptor>;
      try {
        descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
      } catch {
        return fail(`${context} descriptors cannot be inspected.`);
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) fail(`${context} has symbol fields.`);
      const lengthDescriptor = descriptors["length"];
      if (!lengthDescriptor || !("value" in lengthDescriptor)) return fail(`${context} length is not a data property.`);
      const length = lengthDescriptor.value;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
        return fail(`${context} length is invalid.`);
      }
      const keys = Object.keys(descriptors).filter((key) => key !== "length");
      if (keys.length !== length) fail(`${context} is sparse or has extra fields.`);
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return fail(`${context}[${index}] must be an enumerable data property.`);
        }
        result.push(descriptor.value);
      }
      return result;
    };
    const mapEntries = (
      value: unknown,
      context: string,
      expectedSize?: number,
      maximumSize?: number
    ): readonly [unknown, unknown][] => {
      const size = nativeMapSize(value, context);
      if (expectedSize !== undefined && size !== expectedSize) fail(`${context} native size changed.`);
      if (maximumSize !== undefined && size > maximumSize) fail(`${context} exceeds its native size budget.`);
      if (typeof NATIVE_MAP_ITERATOR_NEXT !== "function") return fail("native Map iterator is unavailable.");
      const iteratorNext = NATIVE_MAP_ITERATOR_NEXT;
      try {
        const iterator = Reflect.apply(NATIVE_MAP_ENTRIES, value, []) as IterableIterator<[unknown, unknown]>;
        const entries: [unknown, unknown][] = [];
        for (let index = 0; index < size; index += 1) {
          const step = Reflect.apply(iteratorNext, iterator, []) as IteratorResult<[unknown, unknown]>;
          if (step.done) return fail(`${context} ended before its native size.`);
          entries.push(step.value);
        }
        const end = Reflect.apply(iteratorNext, iterator, []) as IteratorResult<[unknown, unknown]>;
        if (!end.done) return fail(`${context} exceeds its native size.`);
        return entries;
      } catch {
        return fail(`${context} entries cannot be inspected.`);
      }
    };
    const nativeMapGet = <K, V>(map: Map<K, V>, key: K): V | undefined => (
      Reflect.apply(NATIVE_MAP_GET, map, [key]) as V | undefined
    );
    const nativeMapSet = <K, V>(map: Map<K, V>, key: K, value: V): void => {
      Reflect.apply(NATIVE_MAP_SET, map, [key, value]);
    };
    const nativeMapHas = <K, V>(map: Map<K, V>, key: K): boolean => (
      Reflect.apply(NATIVE_MAP_HAS, map, [key]) as boolean
    );
    const coord = (value: unknown, context: string): HexCoord => {
      const descriptors = ownData(value, Object.prototype, context);
      exactKeys(descriptors, ["q", "r"], context);
      const q = field(descriptors, "q", context);
      const r = field(descriptors, "r", context);
      if (typeof q !== "number" || !Number.isInteger(q) || typeof r !== "number" || !Number.isInteger(r)) {
        return fail(`${context} has invalid coordinates.`);
      }
      return { q, r };
    };
    const sameCoord = (actual: HexCoord, expected: Readonly<HexCoord>, context: string): void => {
      if (actual.q !== expected.q || actual.r !== expected.r) fail(`${context} changed.`);
    };
    const grid = (value: unknown, expected: GridDefinition, context: string): void => {
      const descriptors = ownData(value, Object.prototype, context);
      const keys = expected.kind === "square" ? ["kind", "adjacency"] : ["kind", "layout"];
      exactKeys(descriptors, keys, context);
      if (field(descriptors, "kind", context) !== expected.kind) fail(`${context} kind changed.`);
      const variantKey = expected.kind === "square" ? "adjacency" : "layout";
      const expectedVariant = expected.kind === "square" ? expected.adjacency : expected.layout;
      if (field(descriptors, variantKey, context) !== expectedVariant) fail(`${context} descriptor changed.`);
    };
    const paths = (
      value: unknown,
      expected: readonly Readonly<HexCoord>[],
      context: string
    ): void => {
      const items = arrayItems(value, context);
      if (items.length !== expected.length) fail(`${context} length changed.`);
      for (let index = 0; index < items.length; index += 1) {
        sameCoord(coord(items[index], `${context}[${index}]`), expected[index]!, `${context}[${index}]`);
      }
    };

    const baseline = this.derivedMapIntegrityBaseline;
    const gameDescriptors = ownData(this, TowerDefenseGame.prototype, "game", false);
    const liveMap = field(gameDescriptors, "map", "game");
    if (liveMap !== baseline.mapRef) fail("map identity changed.");
    const mapDescriptors = ownData(liveMap, GridMap.prototype, "map", false);
    assertDescriptorShape(mapDescriptors, baseline.mapOwnShape, "map");
    if (Object.getPrototypeOf(liveMap) !== baseline.mapPrototypeRef) fail("map prototype identity changed.");
    assertDescriptorShape(
      Object.getOwnPropertyDescriptors(baseline.mapPrototypeRef) as Record<PropertyKey, PropertyDescriptor>,
      baseline.mapPrototypeShape,
      "map prototype"
    );
    const liveDefinition = field(mapDescriptors, "definition", "map");
    try {
      if (canonicalStringify(liveDefinition) !== baseline.definitionCanonical) {
        fail("map definition changed and would alter clone behavior.");
      }
    } catch {
      fail("map definition is not canonical clone data.");
    }
    if (field(mapDescriptors, "id", "map") !== baseline.id) fail("map id changed.");
    if (field(mapDescriptors, "width", "map") !== baseline.width) fail("map width changed.");
    if (field(mapDescriptors, "height", "map") !== baseline.height) fail("map height changed.");

    const liveTiles = field(mapDescriptors, "tiles", "map");
    if (liveTiles !== baseline.tilesRef) fail("map tiles identity changed.");
    const baseTerrain = field(mapDescriptors, "baseTerrainByCoord", "map");
    if (baseTerrain !== baseline.baseTerrainRef) fail("map base terrain identity changed.");
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
    if (liveGrid !== baseline.gridRef) fail("map grid identity changed.");
    grid(liveGrid, baseline.grid, "map grid");

    const liveTopology = field(mapDescriptors, "topology", "map");
    if (liveTopology !== baseline.topologyRef) fail("map topology identity changed.");
    const topologyDescriptors = ownData(liveTopology, Object.prototype, "map topology");
    exactKeys(topologyDescriptors, [
      "grid", "directionCount", "neighbors", "distance", "line", "directionBetween", "tilesWithin", "footprintSize"
    ], "map topology");
    const topologyGrid = field(topologyDescriptors, "grid", "map topology");
    if (topologyGrid !== baseline.topologyGridRef) fail("topology grid identity changed.");
    grid(topologyGrid, baseline.topologyGrid, "topology grid");
    if (field(topologyDescriptors, "directionCount", "map topology") !== baseline.topologyDirectionCount) {
      fail("topology direction count changed.");
    }
    for (const [key, expected] of Object.entries(baseline.topologyMethods)) {
      if (field(topologyDescriptors, key, "map topology") !== expected) fail(`topology method ${key} changed.`);
    }

    paths(field(mapDescriptors, "pathCenterline", "map"), baseline.pathCenterline, "map pathCenterline");
    const routeValues = arrayItems(field(mapDescriptors, "pathRoutes", "map"), "map pathRoutes");
    if (routeValues.length !== baseline.pathRoutes.length) fail("map pathRoutes length changed.");
    for (let index = 0; index < routeValues.length; index += 1) {
      const routeDescriptors = ownData(routeValues[index], Object.prototype, `map pathRoutes[${index}]`);
      exactKeys(routeDescriptors, ["id", "pathCenterline"], `map pathRoutes[${index}]`);
      const expected = baseline.pathRoutes[index]!;
      if (field(routeDescriptors, "id", `map pathRoutes[${index}]`) !== expected.id) {
        fail(`map pathRoutes[${index}] id changed.`);
      }
      paths(
        field(routeDescriptors, "pathCenterline", `map pathRoutes[${index}]`),
        expected.pathCenterline,
        `map pathRoutes[${index}].pathCenterline`
      );
    }
    sameCoord(
      coord(field(mapDescriptors, "spawnCoord", "map"), "map spawnCoord"),
      baseline.spawnCoord,
      "map spawnCoord"
    );
    sameCoord(
      coord(field(mapDescriptors, "coreCoord", "map"), "map coreCoord"),
      baseline.coreCoord,
      "map coreCoord"
    );

    const expectedTiles = new Map<string, { q: number; r: number; terrain: string }>();
    for (const tile of baseline.baseTiles) nativeMapSet(expectedTiles, coordKey(tile), { ...tile });
    const baseTerrainEntries = mapEntries(baseTerrain, "map base terrain", baseline.baseTiles.length);
    for (const [key, terrain] of baseTerrainEntries) {
      if (
        typeof key !== "string"
        || typeof terrain !== "string"
        || nativeMapGet(expectedTiles, key)?.terrain !== terrain
      ) {
        fail("map base terrain changed.");
      }
    }

    const overrideEntries = mapEntries(
      runtimeOverrides,
      "runtime terrain overrides",
      undefined,
      TOWER_SCRIPT_LIMITS.activeTerrainOverrides
    );
    for (let index = 0; index < overrideEntries.length; index += 1) {
      const [key, value] = overrideEntries[index]!;
      if (typeof key !== "string") return fail(`runtime terrain override ${index} has a non-string key.`);
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
      nativeMapGet(expectedTiles, key)!.terrain = terrain;
    }

    const elevationEntries = mapEntries(
      runtimeElevationOverrides,
      "runtime elevation overrides",
      undefined,
      TERRAFORMING_LIMITS.activeElevationOverrides
    );
    if (elevationEntries.length + overrideEntries.length > TERRAFORMING_LIMITS.activeOverridesCombined) {
      fail("runtime terraforming overrides exceed the combined native size budget.");
    }
    const expectedElevation = new Map(
      this.map.getElevationOverrides().map((entry) => [coordKey(entry), { ...entry }])
    );
    const elevationPolicy = this.activeTerraformingMechanics?.elevation;
    for (let index = 0; index < elevationEntries.length; index += 1) {
      const [key, value] = elevationEntries[index]!;
      if (typeof key !== "string") return fail(`runtime elevation override ${index} has a non-string key.`);
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
      if (
        !elevationPolicy
        || !Number.isSafeInteger(elevation)
        || (elevation as number) < elevationPolicy.minimum
        || (elevation as number) > elevationPolicy.maximum
        || elevation === baseElevation
      ) {
        fail(`runtime elevation override ${index} is invalid.`);
      }
      nativeMapSet(expectedElevation, key, {
        q: overrideCoord.q,
        r: overrideCoord.r,
        elevation: elevation as number
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
    const pendingExpiryGroups = arrayItems(
      field(gameDescriptors, "pendingTerraformExpiryGroups", "game"),
      "pending terraforming expiry groups"
    );
    const nextExpirySequence = field(gameDescriptors, "nextTerraformExpirySequence", "game");
    if (
      (checkpointForm !== 0 && checkpointForm !== 1 && checkpointForm !== 2)
      || (!this.activeTerraformingMechanics && checkpointForm !== 0)
      || (checkpointForm === 1 && !elevationPolicy)
      || (pendingExpiryGroups.length > 0 && checkpointForm !== 2)
      || !Number.isSafeInteger(nextExpirySequence)
      || (nextExpirySequence as number) < 1
      || pendingExpiryGroups.length > TERRAFORMING_LIMITS.pendingExpiryGroups
    ) {
      fail("native terraforming checkpoint inventory is invalid.");
    }
    const ownedExpiryTargets = new Set<string>();
    let ownedExpiryTerrain = 0;
    let ownedExpiryElevation = 0;
    let previousExpirySequence = 0;
    for (let groupIndex = 0; groupIndex < pendingExpiryGroups.length; groupIndex += 1) {
      const group = ownData(
        pendingExpiryGroups[groupIndex],
        Object.prototype,
        `pending terraforming expiry group ${groupIndex}`
      );
      exactKeys(group, ["sequence", "remaining", "targets"], `pending terraforming expiry group ${groupIndex}`);
      const sequence = field(group, "sequence", `pending terraforming expiry group ${groupIndex}`);
      const remaining = field(group, "remaining", `pending terraforming expiry group ${groupIndex}`);
      if (
        !Number.isSafeInteger(sequence)
        || (sequence as number) <= previousExpirySequence
        || (sequence as number) >= (nextExpirySequence as number)
        || typeof remaining !== "number"
        || !Number.isFinite(remaining)
        || remaining < 0
        || remaining > TERRAFORMING_LIMITS.duration
      ) {
        fail(`pending terraforming expiry group ${groupIndex} sequence or remaining is invalid.`);
      }
      previousExpirySequence = sequence as number;
      const targets = arrayItems(
        field(group, "targets", `pending terraforming expiry group ${groupIndex}`),
        `pending terraforming expiry group ${groupIndex} targets`
      );
      if (targets.length < 1 || targets.length > TERRAFORMING_LIMITS.operationsPerBatch) {
        fail(`pending terraforming expiry group ${groupIndex} target budget is invalid.`);
      }
      let previousOrder = -1;
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const target = ownData(
          targets[targetIndex],
          Object.prototype,
          `pending terraforming expiry target ${groupIndex}:${targetIndex}`
        );
        const layer = field(target, "layer", `pending terraforming expiry target ${groupIndex}:${targetIndex}`);
        exactKeys(
          target,
          layer === "terrain"
            ? ["layer", "q", "r", "order", "appliedTerrain", "previousOverride"]
            : layer === "elevation"
              ? ["layer", "q", "r", "order", "appliedElevation", "previousElevationOverride"]
              : ["layer"],
          `pending terraforming expiry target ${groupIndex}:${targetIndex}`
        );
        if (layer !== "terrain" && layer !== "elevation") {
          fail(`pending terraforming expiry target ${groupIndex}:${targetIndex} layer is invalid.`);
        }
        const order = field(target, "order", `pending terraforming expiry target ${groupIndex}:${targetIndex}`);
        const targetCoord = coord({
          q: field(target, "q", `pending terraforming expiry target ${groupIndex}:${targetIndex}`),
          r: field(target, "r", `pending terraforming expiry target ${groupIndex}:${targetIndex}`)
        }, `pending terraforming expiry target ${groupIndex}:${targetIndex} coordinate`);
        if (
          !Number.isSafeInteger(order)
          || (order as number) < 0
          || (order as number) > 63
          || (order as number) <= previousOrder
          || !this.map.isInside(targetCoord)
        ) {
          fail(`pending terraforming expiry target ${groupIndex}:${targetIndex} order or coordinate is invalid.`);
        }
        previousOrder = order as number;
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
          const appliedTerrain = field(
            target,
            "appliedTerrain",
            `pending terraforming expiry terrain target ${groupIndex}:${targetIndex}`
          );
          const projected = nativeMapGet(
            runtimeOverrides as Map<string, RuntimeTerrainOverride>,
            key
          );
          const previousValue = field(
            target,
            "previousOverride",
            `pending terraforming expiry terrain target ${groupIndex}:${targetIndex}`
          );
          const authoredTerrain = nativeMapGet(baseTerrain as Map<string, string>, key);
          const effectiveTerrain = projected?.terrain ?? authoredTerrain;
          const validRuntimeSource = projected?.source === "script" || (
            projected?.source === "ability"
            && this.activeTerraformingMechanics !== undefined
            && this.mission.abilities?.some((ability) => ability.id === "path_water")
            && appliedTerrain === "water"
            && authoredTerrain === "path"
          );
          if (
            ownedExpiryTerrain > TERRAFORMING_LIMITS.activeTerrainOverrides
            || typeof appliedTerrain !== "string"
            || !Object.prototype.hasOwnProperty.call(this.content.terrainTypes, appliedTerrain)
            || effectiveTerrain !== appliedTerrain
            || (appliedTerrain === authoredTerrain && projected !== undefined)
            || (appliedTerrain !== authoredTerrain && (
              !projected
              || !validRuntimeSource
              || projected.expiresIn !== undefined
            ))
          ) {
            fail(`pending terraforming expiry terrain target ${groupIndex}:${targetIndex} projection is invalid.`);
          }
          if (previousValue === null) {
            if (authoredTerrain === appliedTerrain) {
              fail(`pending terraforming expiry terrain target ${groupIndex}:${targetIndex} before-image is invalid.`);
            }
          } else {
            const previousOverride = ownData(
              previousValue,
              Object.prototype,
              `pending terraforming expiry terrain before-image ${groupIndex}:${targetIndex}`
            );
            exactKeys(
              previousOverride,
              ["terrain", "source"],
              `pending terraforming expiry terrain before-image ${groupIndex}:${targetIndex}`
            );
            const previousTerrain = field(previousOverride, "terrain", "pending terraforming expiry terrain before-image");
            const previousSource = field(previousOverride, "source", "pending terraforming expiry terrain before-image");
            if (
              typeof previousTerrain !== "string"
              || !Object.prototype.hasOwnProperty.call(this.content.terrainTypes, previousTerrain)
              || (previousSource !== "script" && previousSource !== "ability")
              || previousTerrain === appliedTerrain
            ) {
              fail(`pending terraforming expiry terrain target ${groupIndex}:${targetIndex} before-image is invalid.`);
            }
          }
        } else {
          ownedExpiryElevation += 1;
          const appliedElevation = field(
            target,
            "appliedElevation",
            `pending terraforming expiry elevation target ${groupIndex}:${targetIndex}`
          );
          const previousElevation = field(
            target,
            "previousElevationOverride",
            `pending terraforming expiry elevation target ${groupIndex}:${targetIndex}`
          );
          const projected = nativeMapGet(
            runtimeElevationOverrides as Map<string, RuntimeElevationOverrideV1>,
            key
          );
          const baseElevation = this.map.getBaseElevation(targetCoord);
          const effectiveElevationValue = projected?.elevation ?? baseElevation;
          if (
            ownedExpiryElevation > TERRAFORMING_LIMITS.activeElevationOverrides
            || !elevationPolicy
            || !Number.isSafeInteger(appliedElevation)
            || effectiveElevationValue !== appliedElevation
            || (appliedElevation === baseElevation && projected !== undefined)
            || (appliedElevation !== baseElevation && !projected)
            || (previousElevation === null && baseElevation === appliedElevation)
            || (previousElevation !== null && (
              !Number.isSafeInteger(previousElevation)
              || (previousElevation as number) < elevationPolicy.minimum
              || (previousElevation as number) > elevationPolicy.maximum
              || previousElevation === appliedElevation
              || previousElevation === baseElevation
            ))
          ) {
            fail(`pending terraforming expiry elevation target ${groupIndex}:${targetIndex} projection is invalid.`);
          }
        }
      }
    }
    const expectedOccupancy = new Map<string, string>();
    const towerValues = arrayItems(field(gameDescriptors, "towers", "game"), "game towers");
    const towerIds = new Set<string>();
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
    const seenTileKeys = new Set<string>();
    for (let index = 0; index < tileEntries.length; index += 1) {
      const [key, value] = tileEntries[index]!;
      if (typeof key !== "string" || seenTileKeys.has(key)) return fail(`map tile ${index} has an invalid key.`);
      seenTileKeys.add(key);
      const expected = nativeMapGet(expectedTiles, key);
      if (!expected) return fail(`map tile ${index} has an unexpected key.`);
      const expectedTowerId = nativeMapGet(expectedOccupancy, key);
      const tileDescriptors = ownData(value, Object.prototype, `map tile ${key}`);
      exactKeys(
        tileDescriptors,
        expectedTowerId === undefined ? ["q", "r", "terrain"] : ["q", "r", "terrain", "occupiedBy"],
        `map tile ${key}`
      );
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
      if (
        expectedTowerId !== undefined
        && field(tileDescriptors, "occupiedBy", `map tile ${key}`) !== expectedTowerId
      ) {
        fail(`map tile ${key} occupancy does not match tower footprints.`);
      }
    }
  }

  private checkpointIdentity(): GameCheckpointIdentityV1 {
    return cloneCheckpointJson({
      missionId: this.mission.id,
      difficultyId: this.difficulty.id,
      metaUpgradeLevels: { ...this.metaUpgradeLevels }
    });
  }

  private buildCombatState(): CombatState | undefined {
    const cloneRecord = (record: Readonly<Record<string, ShieldStateV1>>) => Object.fromEntries(
      Object.keys(record).sort().map((id) => {
        const state = record[id]!;
        return [id, {
          current: state.current,
          capacity: state.capacity,
          regenerationDelayRemaining: state.regenerationDelayRemaining
        }];
      })
    );
    const enemies = cloneRecord(this.enemyShields);
    const towers = cloneRecord(this.towerShields);
    const markEnemies = Object.fromEntries(Object.keys(this.enemyMarks).sort().map((enemyId) => [
      enemyId,
      Object.fromEntries(Object.keys(this.enemyMarks[enemyId] ?? {}).sort().map((markId) => {
        const state = this.enemyMarks[enemyId]![markId]!;
        return [markId, { stacks: state.stacks, remaining: state.remaining }];
      }))
    ]));
    const hasShields = Object.keys(enemies).length > 0 || Object.keys(towers).length > 0;
    const hasMarks = Object.keys(markEnemies).length > 0;
    if (!hasShields && !hasMarks) return undefined;
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

  private buildReactionState(): ReactionStateV1 | undefined {
    const enemies = cloneEnemyExposureStates(this.enemyExposures, true, true);
    if (Object.keys(enemies).length === 0) return undefined;
    return { schemaVersion: 1, exposures: { enemies } };
  }

  private buildEnemyBehaviorsState(): GameSnapshot["enemyBehaviors"] {
    if (!this.activeEnemyBehaviors) return undefined;
    const formationEnemies = this.activeFormationAssignments === undefined
      ? undefined
      : Object.fromEntries(this.enemies
          .filter((enemy) => enemy.hp > 0 && this.activeFormationAssignments!.has(enemy.typeId))
          .sort((left, right) => compareBinary(left.id, right.id))
          .map((enemy) => {
            const assignment = this.activeFormationAssignments!.get(enemy.typeId)!;
            return [enemy.id, { cohortId: assignment.cohortId, role: assignment.role }];
          }));
    const protectionCohorts = this.activeFormationAssignments === undefined
      ? undefined
      : Object.fromEntries(Object.entries(this.activeEnemyBehaviors.formations?.cohorts ?? {})
          .filter(([, cohort]) => cohort.protection !== undefined)
          .sort(([left], [right]) => compareBinary(left, right))
          .map(([cohortId, cohort]) => [cohortId, {
            radius: cohort.protection!.radius,
            sourceKinds: [...cohort.protection!.sourceKinds]
          }]));
    return {
      schemaVersion: 1,
      components: Object.fromEntries(Object.keys(this.enemyComponentStates).sort(compareBinary).map((enemyId) => [
        enemyId,
        Object.fromEntries(Object.keys(this.enemyComponentStates[enemyId] ?? {}).sort(compareBinary).map((componentId) => {
          const state = this.enemyComponentStates[enemyId]![componentId]!;
          return [componentId, {
            hp: state.hp,
            maxHp: state.maxHp,
            ...(state.shield === undefined ? {} : { shield: { ...state.shield } })
          }];
        }))
      ])),
      ...(formationEnemies === undefined ? {} : {
        formations: {
          schemaVersion: 1,
          enemies: formationEnemies,
          ...(protectionCohorts === undefined || Object.keys(protectionCohorts).length === 0 ? {} : {
            protection: { schemaVersion: 1, cohorts: protectionCohorts }
          })
        }
      })
    };
  }

  private buildEnemyBehaviorsCheckpointState(): EnemyBehaviorsCheckpointStateV1 | undefined {
    const state = this.buildEnemyBehaviorsState();
    if (state === undefined) return undefined;
    const hasProtection = Object.values(this.activeEnemyBehaviors?.formations?.cohorts ?? {})
      .some((cohort) => cohort.protection !== undefined);
    return {
      ...state,
      ...(hasProtection ? {
        protectionRuntime: {
          schemaVersion: 1,
          transactionsThisTick: this.vanguardProtectionTransactionsThisTick
        }
      } : {})
    };
  }

  private projectileAltitude(projectile: ProjectileCheckpoint): number {
    const progress = Math.max(0, Math.min(1, projectile.elapsedUnits / projectile.travelTimeUnits));
    return projectileAltitudeAtProgress(
      projectile.sourceElevation,
      projectile.impact.targetElevation,
      projectile.trajectory,
      projectile.maxAltitude,
      progress
    );
  }

  private initializeDestructibleObjects(): void {
    const definitions = this.activeBallisticsMechanics?.projectiles.destructibles?.definitions;
    if (!definitions) {
      this.destructibleObjects = [];
      this.destructibleCollisionIndex = undefined;
      this.hasAuthoredDynamicLineOfSightCapability = false;
      this.dynamicLineOfSightIndex = undefined;
      return;
    }
    this.destructibleObjects = this.map.getDestructibleObjects()
      .map((placement): MutableDestructibleObjectStateV1 => {
        const definition = definitions[placement.definitionId];
        if (!definition) throw new Error(`Active destructible object "${placement.id}" has no authored definition.`);
        return {
          objectId: placement.id,
          definitionId: placement.definitionId,
          coord: { ...placement.coord },
          hp: definition.maxHp,
          maxHp: definition.maxHp,
          destroyed: false
        };
      })
      .sort((left, right) => compareBinary(left.objectId, right.objectId));
    this.rebuildDestructibleCollisionIndex();
  }

  private rebuildDestructibleCollisionIndex(): void {
    const definitions = this.activeBallisticsMechanics?.projectiles.destructibles?.definitions;
    if (!definitions) {
      this.destructibleCollisionIndex = undefined;
      this.hasAuthoredDynamicLineOfSightCapability = false;
      this.dynamicLineOfSightIndex = undefined;
      return;
    }
    this.hasAuthoredDynamicLineOfSightCapability = this.destructibleObjects.some(
      (object) => definitions[object.definitionId]!.hitRegion.blocksLineOfSight
    );
    const liveObjects = this.destructibleObjects.filter((object) => !object.destroyed);
    this.destructibleCollisionIndex = createDestructibleCollisionIndexV1(
      this.map,
      liveObjects.map((object) => ({
          objectId: object.objectId,
          definitionId: object.definitionId,
          coord: { ...object.coord },
          blockerHeight: definitions[object.definitionId]!.hitRegion.blockerHeight
        }))
    );
    const lineOfSightBlockers = liveObjects
      .filter((object) => definitions[object.definitionId]!.hitRegion.blocksLineOfSight)
      .map((object) => ({
        objectId: object.objectId,
        definitionId: object.definitionId,
        coord: { ...object.coord },
        blockerHeight: definitions[object.definitionId]!.hitRegion.blockerHeight
      }));
    this.dynamicLineOfSightIndex = this.hasAuthoredDynamicLineOfSightCapability
      ? buildDynamicAuthoredLineOfSightIndexV1(this.map, lineOfSightBlockers)
      : undefined;
  }

  private buildDestructibleState() {
    if (!this.activeBallisticsMechanics?.projectiles.destructibles) return undefined;
    return {
      schemaVersion: 1 as const,
      objects: this.destructibleObjects.map((object) => ({
        objectId: object.objectId,
        definitionId: object.definitionId,
        coord: { ...object.coord },
        hp: object.hp,
        maxHp: object.maxHp,
        destroyed: object.destroyed
      }))
    };
  }

  private buildBallisticsState(): GameSnapshot["ballistics"] {
    if (!this.activeBallisticsMechanics) return undefined;
    const destructibles = this.buildDestructibleState();
    const projectiles = this.projectiles
      .slice()
      .sort((left, right) => compareBinary(left.id, right.id))
      .map((projectile) => ({
          id: projectile.id,
          sourceCoord: { ...projectile.sourceCoord },
          targetCoord: { ...projectile.impact.targetCoord },
          trajectory: projectile.trajectory,
          elapsedUnits: projectile.elapsedUnits,
          travelTimeUnits: projectile.travelTimeUnits,
          altitude: this.projectileAltitude(projectile),
          ...(projectile.maxAltitude === undefined ? {} : { maxAltitude: projectile.maxAltitude })
        }));
    return destructibles === undefined
      ? { schemaVersion: 1, projectiles }
      : { schemaVersion: 2, projectiles, destructibles };
  }

  private buildBallisticsCheckpointState(): BallisticsCheckpointState | undefined {
    if (!this.activeBallisticsMechanics) return undefined;
    const destructibles = this.buildDestructibleState();
    const schemaVersion = destructibles !== undefined
      ? 4 as const
      : this.activeBallisticsMechanics.projectiles.ricochet !== undefined
        ? 3 as const
        : this.activeBallisticsMechanics.projectiles.clearance === undefined ? 1 as const : 2 as const;
    const projectiles = this.projectiles
        .slice()
        .sort((left, right) => compareBinary(left.id, right.id))
        .map((projectile) => ({
          ...projectile,
          sourceCoord: { ...projectile.sourceCoord },
          ...("clearanceCollision" in projectile && projectile.clearanceCollision !== undefined ? {
            clearanceCollision: {
              ...projectile.clearanceCollision,
              blockerCoord: { ...projectile.clearanceCollision.blockerCoord }
            }
          } : {}),
          ...("ricochet" in projectile && projectile.ricochet !== undefined ? {
            ricochet: {
              ...projectile.ricochet,
              ...(projectile.ricochet.lastCollision === undefined ? {} : {
                lastCollision: {
                  ...projectile.ricochet.lastCollision,
                  collisionCoord: { ...projectile.ricochet.lastCollision.collisionCoord },
                  incomingFromCoord: { ...projectile.ricochet.lastCollision.incomingFromCoord }
                }
              })
            }
          } : {}),
          ...("destructibleCollision" in projectile && projectile.destructibleCollision !== undefined ? {
            destructibleCollision: {
              ...projectile.destructibleCollision,
              collisionCoord: { ...projectile.destructibleCollision.collisionCoord }
            }
          } : {}),
          impact: {
            targetCoord: { ...projectile.impact.targetCoord },
            targetElevation: projectile.impact.targetElevation,
            damagePacket: cloneCheckpointJson(projectile.impact.damagePacket)
          }
        }));
    if (destructibles !== undefined) {
      return {
        schemaVersion: 4,
        nextProjectileSequence: this.nextProjectileSequence,
        projectiles: projectiles as ProjectileCheckpointV4[],
        destructibles
      };
    }
    return {
      schemaVersion,
      nextProjectileSequence: this.nextProjectileSequence,
      projectiles
    } as BallisticsCheckpointState;
  }

  getFormationSteeringStats(): FormationSteeringRuntimeStatsV1 {
    return Object.freeze({ ...this.formationSteeringStats });
  }

  getVanguardProtectionStats(): VanguardProtectionRuntimeStatsV1 {
    return Object.freeze({
      transactionsThisTick: this.vanguardProtectionTransactionsThisTick,
      candidatesInspected: this.vanguardProtectionCandidatesInspected,
      maximumCandidateCount: this.vanguardProtectionMaximumCandidateCount
    });
  }

  private consumeNavigationAnalysisField(
    field: NavigationFieldResult,
    budget: NavigationAnalysisRelaxationBudget
  ): void {
    if (budget.fields.has(field)) return;
    budget.fields.add(field);
    const next = budget.used + field.stats.relaxations;
    if (!Number.isSafeInteger(next) || next > budget.limit) {
      throw new Error(`Navigation analysis relaxation budget limit ${budget.limit} exceeded.`);
    }
    budget.used = next;
  }

  private buildNavigationAnalysisFields(
    request: NormalizedNavigationAnalysisRequestV1,
    budget: NavigationAnalysisRelaxationBudget
  ): NavigationAnalysisV1["fields"] {
    const resolver = this.createNavigationResolver();
    const lookups = new NavigationFieldLookupCache();
    const movementProfileIds = new Set(request.movementProfileIds);
    const routeIds = new Set(request.routeIds);
    const pairs = this.navigationDiagnosticPairs().filter((pair) => (
      movementProfileIds.has(pair.movementProfileId) && routeIds.has(pair.routeId)
    ));
    return this.buildNavigationFieldDiagnostics(
      this.groupNavigationDiagnosticPairs(pairs),
      (movementProfileId, routeId) => resolver.getField(movementProfileId, routeId),
      lookups,
      budget
    );
  }

  private navigationDiagnosticPairs(): readonly NavigationMandatoryPair[] {
    const pairs = new Map<string, NavigationMandatoryPair>();
    for (const pair of [...this.navigationKnownPairs, ...this.navigationMandatoryPairs]) {
      pairs.set(JSON.stringify([pair.movementProfileId, pair.routeId]), pair);
    }
    for (const enemy of this.enemies) {
      if (!enemy.navigation || !enemy.routeId) continue;
      const route = this.resolveDynamicNavigationRoute(enemy.routeId);
      const source = route.pathCenterline[0];
      if (!source) continue;
      const pair: NavigationMandatoryPair = {
        movementProfileId: enemy.navigation.movementProfileId,
        routeId: route.id,
        source: { ...source }
      };
      pairs.set(JSON.stringify([pair.movementProfileId, pair.routeId]), pair);
    }
    return [...pairs.values()].sort((left, right) => (
      compareBinary(left.movementProfileId, right.movementProfileId)
      || compareBinary(left.routeId, right.routeId)
    ));
  }

  private groupNavigationDiagnosticPairs(
    pairs: readonly NavigationMandatoryPair[]
  ): readonly NavigationFieldGroup[] {
    const grouped = new Map<string, NavigationFieldGroup>();
    for (const pair of pairs) {
      const route = this.resolveDynamicNavigationRoute(pair.routeId);
      const goal = route.pathCenterline.at(-1);
      if (!goal) continue;
      const key = JSON.stringify([pair.movementProfileId, goal.q, goal.r]);
      const group = grouped.get(key) ?? {
        movementProfileId: pair.movementProfileId,
        goal: { ...goal },
        routeIds: new Set<string>()
      };
      group.routeIds.add(route.id);
      grouped.set(key, group);
    }
    return [...grouped.values()]
      .sort((left, right) => (
        compareBinary(left.movementProfileId, right.movementProfileId)
        || left.goal.r - right.goal.r
        || left.goal.q - right.goal.q
      ));
  }

  private buildNavigationFieldDiagnostics(
    groups: readonly NavigationFieldGroup[],
    resolveField: (movementProfileId: string, routeId: string) => NavigationFieldResult,
    lookups: NavigationFieldLookupCache,
    budget?: NavigationAnalysisRelaxationBudget
  ): NavigationAnalysisV1["fields"] {
    const profile = this.activeNavigationProfile;
    if (!profile) return [];
    const terrainByCoord = this.navigationTerrainByCoord();
    const occupiedCoords = this.navigationOccupiedCoords();
    return groups
      .map((group) => {
        const routeIds = [...group.routeIds].sort(compareBinary);
        const field = resolveField(group.movementProfileId, routeIds[0]!);
        if (budget) this.consumeNavigationAnalysisField(field, budget);
        const lookup = lookups.get(field);
        const reachableRouteIds: string[] = [];
        const unreachableRouteIds: string[] = [];
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

  private buildNavigationSnapshot(): NavigationSnapshotV1 | undefined {
    if (!this.activeNavigationProfile || !this.navigationResolver || !this.navigationFieldLookupCache) return undefined;
    const fields = this.buildNavigationFieldDiagnostics(
      this.groupNavigationDiagnosticPairs(this.navigationDiagnosticPairs()),
      (movementProfileId, routeId) => (
        this.navigationResolver!.peekField(movementProfileId, routeId)
        ?? this.navigationField(movementProfileId, routeId)
      ),
      this.navigationFieldLookupCache
    );
    const stalledEnemyIds = this.enemies
      .filter((enemy) => enemy.hp > 0 && enemy.navigation && !enemy.navigation.nextCoord && !this.dynamicEnemyAtGoal(enemy))
      .map((enemy) => enemy.id)
      .sort(compareBinary);
    return { schemaVersion: 1, mode: "dynamic_flow", fields, stalledEnemyIds };
  }

  private buildElevationSnapshot(copyStaticState: boolean): GameSnapshot["elevation"] {
    if (!this.activeElevation) return undefined;
    if (!copyStaticState && this.runtimeElevationOverrides.size === 0) return this.staticElevationSnapshot;
    return {
      schemaVersion: 1,
      defaultElevation: 0,
      overrides: this.map.getEffectiveElevationOverrides()
    };
  }

  private buildArtifactCheckpointState(): ArtifactCheckpointState | undefined {
    if (!this.activeRogueliteMechanics?.artifacts
      || !this.artifactInitialRngState
      || !this.artifactRng) return undefined;
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

  private buildDraftCheckpointState(): DraftCheckpointState | undefined {
    if (!this.activeRogueliteMechanics?.draft || !this.draftInitialRngState || !this.draftRng) return undefined;
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
        cardIds: [...this.pendingDraftOffer.cardIds] as [string, string, string]
      },
      selections: this.draftSelections.map((selection) => ({ ...selection }))
    } as DraftCheckpointState;
  }

  private buildCheckpointState(): GameCheckpointStateV1 {
    const enemies = this.enemies.map((enemy): EnemyState => ({
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
      ...(enemy.disruptTargetTowerIds === undefined ? {} : { disruptTargetTowerIds: [...enemy.disruptTargetTowerIds] }),
      ...(enemy.towerAttackCooldown === undefined ? {} : { towerAttackCooldown: enemy.towerAttackCooldown })
    }));
    const towers = this.towers.map((tower): TowerState => ({
      id: tower.id,
      typeId: tower.typeId,
      coord: { ...tower.coord },
      footprint: tower.footprint.map((coord) => ({ ...coord })),
      level: tower.level,
      ...(tower.baseTypeId === undefined ? {} : { baseTypeId: tower.baseTypeId }),
      ...(tower.upgradeBranchId === undefined ? {} : { upgradeBranchId: tower.upgradeBranchId }),
      ...(tower.targetMode === undefined ? {} : { targetMode: tower.targetMode }),
      stacks: tower.stacks,
      cooldown: tower.cooldown,
      investedResources: { ...tower.investedResources },
      ...(tower.disabledFor === undefined ? {} : { disabledFor: tower.disabledFor }),
      ...(tower.hp === undefined ? {} : { hp: tower.hp })
    }));
    const combat = this.buildCombatState();
    const reactions = this.buildReactionState();
    const enemyBehaviors = this.buildEnemyBehaviorsCheckpointState();
    const ballistics = this.buildBallisticsCheckpointState();
    const weather = this.activeWeatherMechanics && this.weatherSchedule && this.weatherRuntime
      ? {
          schemaVersion: 1 as const,
          profileId: this.activeWeatherMechanics.profileId,
          rng: this.weatherSchedule.rng,
          active: this.weatherRuntime.active,
          periodicOrdinals: this.weatherRuntime.periodicOrdinals
        }
      : undefined;
    const artifacts = this.buildArtifactCheckpointState();
    const draft = this.buildDraftCheckpointState();
    const heroes = this.heroStateV2 === undefined
      ? undefined
      : (this.activeHeroesMechanics?.schemaVersion === 5 || this.activeHeroesMechanics?.schemaVersion === 6
          || this.activeHeroesMechanics?.schemaVersion === 7)
        && this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]?.skillTree !== null
        ? {
            schemaVersion: 4 as const,
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
        || ((this.activeHeroesMechanics?.schemaVersion === 5 || this.activeHeroesMechanics?.schemaVersion === 6
          || this.activeHeroesMechanics?.schemaVersion === 7)
          && this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]?.skillTree === null)
        ? {
            schemaVersion: 3 as const,
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
            schemaVersion: 2 as const,
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
          schemaVersion: 1 as const,
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
            schemaVersion: 1 as const,
            runtimeElevationOverrides
          }
        : {
            schemaVersion: 2 as const,
            runtimeElevationOverrides,
            nextExpiryGroupSequence: this.nextTerraformExpirySequence,
            pendingExpiryGroups: this.pendingTerraformExpiryGroups.map((group) => ({
              sequence: group.sequence,
              remaining: group.remaining,
              entries: group.targets.map((target) => target.layer === "terrain"
                ? {
                    layer: "terrain" as const,
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
                    layer: "elevation" as const,
                    order: target.order,
                    q: target.q,
                    r: target.r,
                    appliedElevation: target.appliedElevation,
                    previousElevationOverride: target.previousElevationOverride
                  })
            }))
          } satisfies TerraformingCheckpointStateV2;
    const ammunitionCheckpoint = this.activeLogisticsAmmunition === undefined
      ? null
      : {
          inventories: this.towers
            .filter((tower) => isLiveLogisticsAmmunitionTower(tower)
              && isAmmunitionBoundTowerType(this.activeLogisticsAmmunition!, tower.typeId))
            .sort((left, right) => compareBinary(left.id, right.id))
            .map((tower) => {
              const amount = this.logisticsAmmunitionAmounts.get(tower.id);
              if (amount === undefined) {
                throw new Error(`Logistics ammunition inventory for tower "${tower.id}" is missing.`);
              }
              return { towerId: tower.id, amount };
            })
        };
    const logistics = this.activeLogisticsSchemaVersion === 3
      ? (!this.activeLogisticsAmmunition && !this.activeLogisticsSupply
          ? undefined
          : {
              schemaVersion: 2 as const,
              ammunition: ammunitionCheckpoint,
              supply: this.activeLogisticsSupply === undefined
                ? null
                : {
                    producers: this.towers
                      .filter((tower) => isLiveLogisticsAmmunitionTower(tower)
                        && getLogisticsProducerDefinitionV3(this.activeLogisticsSupply!, tower.typeId) !== undefined)
                      .sort((left, right) => compareBinary(left.id, right.id))
                      .map((tower) => {
                        const runtime = this.logisticsSupplyProducers.get(tower.id);
                        if (!runtime) throw new Error(`Logistics supply producer state for tower "${tower.id}" is missing.`);
                        return {
                          towerId: tower.id,
                          amount: runtime.amount,
                          productionProgress: runtime.productionProgress,
                          transferProgress: runtime.transferProgress
                        };
                      }),
                    storages: this.towers
                      .filter((tower) => isLiveLogisticsAmmunitionTower(tower)
                        && getLogisticsStorageDefinitionV3(this.activeLogisticsSupply!, tower.typeId) !== undefined)
                      .sort((left, right) => compareBinary(left.id, right.id))
                      .map((tower) => {
                        const runtime = this.logisticsSupplyStorages.get(tower.id);
                        if (!runtime) throw new Error(`Logistics supply storage state for tower "${tower.id}" is missing.`);
                        return {
                          towerId: tower.id,
                          amount: runtime.amount,
                          transferProgress: runtime.transferProgress
                        };
                      })
                  }
            })
      : this.activeLogisticsAmmunition === undefined
        ? undefined
        : { schemaVersion: 1 as const, ammunition: ammunitionCheckpoint! };
    const director: GameCheckpointStateV1["director"] = this.activeDirectorMechanics
      ? {
          schemaVersion: 1,
          profileId: this.activeDirectorMechanics.profileId,
          decisions: this.directorDecisions.map((decision) => ({
            ...decision,
            reason: { ...decision.reason },
            addedGroups: decision.addedGroups.map((group) => ({ ...group }))
          }))
        }
      : undefined;
    const quests = this.buildQuestSnapshot();
    const state: GameCheckpointStateV1 = {
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
      abilityCooldowns: Object.fromEntries(
        Object.entries(this.abilityCooldowns).filter((entry): entry is [string, number] => typeof entry[1] === "number")
      ),
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
      ...(this.hasScriptStateMachines ? {
        scriptMachines: {
          schemaVersion: 1 as const,
          transitionsRemaining: this.scriptStateTransitionsRemaining,
          values: this.cloneScriptMachines()
        }
      } : {}),
      ...(combat === undefined ? {} : { combat }),
      ...(reactions === undefined ? {} : { reactions }),
      ...(artifacts === undefined ? {} : { artifacts }),
      ...(draft === undefined ? {} : { draft }),
      ...(heroes === undefined ? {} : { heroes }),
      ...(logistics === undefined ? {} : { logistics }),
      ...(director === undefined ? {} : { director }),
      ...(quests === undefined ? {} : { quests }),
      ...(enemyBehaviors === undefined ? {} : { enemyBehaviors }),
      ...(ballistics === undefined ? {} : { ballistics }),
      ...(weather === undefined ? {} : { weather }),
      ...(this.campaignBattle === undefined ? {} : {
        campaignBattle: {
          schemaVersion: 1 as const,
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

  private static validateCheckpointIdentity(content: GameContentRegistry, identity: GameCheckpointIdentityV1): void {
    const descriptors = checkpointObjectDescriptors(identity, "Game checkpoint identity");
    requireExactCheckpointKeys(
      descriptors,
      ["missionId", "difficultyId", "metaUpgradeLevels"],
      "Game checkpoint identity"
    );
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
    if (
      authoredUpgradeIds.length !== checkpointUpgradeIds.length ||
      authoredUpgradeIds.some((upgradeId, index) => upgradeId !== checkpointUpgradeIds[index])
    ) {
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

  private static validateCheckpointState(
    content: GameContentRegistry,
    identity: GameCheckpointIdentityV1,
    state: GameCheckpointStateV1,
    rootInitialRng: SeededRngStateV1
  ): void {
    const descriptors = checkpointObjectDescriptors(state, "Game checkpoint state");
    const required = [
      "coreHp", "resources", "waveIndex", "startedWaveCount", "waveState", "prepRemaining", "outcome",
      "enemies", "towers", "lastEvents", "enemyCounter", "towerCounter", "clearedWaveCount", "killCount",
      "leakCount", "killCountByEnemyType", "completedObjectiveIds", "earnedStarIds", "spawnQueue",
      "missionElapsed", "nextWaveStartAt", "abilityCooldowns", "runtimeTerrainOverrides", "scriptValues",
      "scriptDiagnostics", "scriptHandlerLastRun", "scriptEventCursor", "scriptActionsRemaining",
      "scriptTerrainChangesRemaining", "scriptSignalDepth"
    ] as const;
    for (const key of required) checkpointDataField(descriptors, key, "Game checkpoint state");
    const checkpointTerraforming = resolveActiveTerraformingMechanics(content, identity.missionId);
    const checkpointRoguelite = resolveActiveRogueliteMechanics(content, identity.missionId);
    const checkpointHeroes = resolveActiveHeroesMechanics(content, identity.missionId);
    const checkpointDirector = resolveActiveDirectorMechanics(content, identity.missionId);
    const checkpointQuests = resolveActiveQuestMechanics(content, identity.missionId);
    const checkpointEnemyBehaviors = resolveActiveEnemyBehaviorsV1(content, identity.missionId);
    const checkpointBallistics = resolveActiveBallisticsMechanics(content, identity.missionId);
    const checkpointWeather = resolveActiveWeatherMechanics(content, identity.missionId);
    const checkpointStateMachines = Object.values(content.scripts ?? {})
      .filter((script): script is TowerScriptDefinition => Boolean(
        script && script.enabled !== false && script.schemaVersion === 7 && script.stateMachines?.length
      ))
      .sort((left, right) => compareBinary(left.id, right.id));
    const requiresScriptMachinesCheckpoint = checkpointStateMachines.length > 0;
    const checkpointLogisticsMechanics = resolveActiveLogisticsMechanics(content, identity.missionId);
    const checkpointAmmunition = checkpointLogisticsMechanics?.schemaVersion === 2
      || checkpointLogisticsMechanics?.schemaVersion === 3
      ? checkpointLogisticsMechanics.ammunition ?? undefined
      : undefined;
    const checkpointSupply = checkpointLogisticsMechanics?.schemaVersion === 3
      ? checkpointLogisticsMechanics.supply ?? undefined
      : undefined;
    const mission = content.missions[identity.missionId]!;
    const requiresArtifactCheckpoint = checkpointRoguelite?.artifacts !== undefined;
    const requiresDraftCheckpoint = checkpointRoguelite?.draft !== undefined;
    const requiresElevationTerraformingCheckpoint = (
      resolveActiveElevationMechanics(content, identity.missionId) !== undefined
      && checkpointTerraforming?.elevation !== undefined
    );
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
    if (hasArtifactCheckpoint) checkpointDataField(descriptors, "artifacts", "Game checkpoint state");
    const hasDraftCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "draft");
    if (requiresDraftCheckpoint && !hasDraftCheckpoint) {
      throw new Error("Game checkpoint draft state is required for active wave draft.");
    }
    if (!requiresDraftCheckpoint && hasDraftCheckpoint) {
      throw new Error("Game checkpoint draft state is unsupported for an inactive capability.");
    }
    if (hasDraftCheckpoint) checkpointDataField(descriptors, "draft", "Game checkpoint state");
    const hasCampaignBattleCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "campaignBattle");
    if (hasCampaignBattleCheckpoint) checkpointDataField(descriptors, "campaignBattle", "Game checkpoint state");
    const requiresHeroesCheckpoint = checkpointHeroes?.schemaVersion === 2
      || checkpointHeroes?.schemaVersion === 3
      || checkpointHeroes?.schemaVersion === 4
      || checkpointHeroes?.schemaVersion === 5
      || checkpointHeroes?.schemaVersion === 6
      || checkpointHeroes?.schemaVersion === 7;
    const hasHeroesCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "heroes");
    if (requiresHeroesCheckpoint && !hasHeroesCheckpoint) {
      throw new Error("Game checkpoint hero state is required for active moving heroes.");
    }
    if (!requiresHeroesCheckpoint && hasHeroesCheckpoint) {
      throw new Error("Game checkpoint hero state is unsupported for an inactive or static capability.");
    }
    if (hasHeroesCheckpoint) checkpointDataField(descriptors, "heroes", "Game checkpoint state");
    const hasLogisticsCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "logistics");
    if ((checkpointAmmunition || checkpointSupply) && !hasLogisticsCheckpoint) {
      throw new Error("Game checkpoint Logistics ammunition or supply state is required.");
    }
    if (!checkpointAmmunition && !checkpointSupply && hasLogisticsCheckpoint) {
      throw new Error("Game checkpoint Logistics ammunition state is unsupported for an inactive capability.");
    }
    if (hasLogisticsCheckpoint) checkpointDataField(descriptors, "logistics", "Game checkpoint state");
    const hasDirectorCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "director");
    if (checkpointDirector && !hasDirectorCheckpoint) {
      throw new Error("Game checkpoint Director state is required for an active capability.");
    }
    if (!checkpointDirector && hasDirectorCheckpoint) {
      throw new Error("Game checkpoint Director state is unsupported for an inactive capability.");
    }
    if (hasDirectorCheckpoint) checkpointDataField(descriptors, "director", "Game checkpoint state");
    const hasQuestCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "quests");
    if (checkpointQuests && !hasQuestCheckpoint) {
      throw new Error("Game checkpoint quest state is required for an active capability.");
    }
    if (!checkpointQuests && hasQuestCheckpoint) {
      throw new Error("Game checkpoint quest state is unsupported for an inactive capability.");
    }
    if (hasQuestCheckpoint) checkpointDataField(descriptors, "quests", "Game checkpoint state");
    const hasEnemyBehaviorsCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "enemyBehaviors");
    if (checkpointEnemyBehaviors && !hasEnemyBehaviorsCheckpoint) {
      throw new Error("Game checkpoint enemyBehaviors state is required for an active capability.");
    }
    if (!checkpointEnemyBehaviors && hasEnemyBehaviorsCheckpoint) {
      throw new Error("Game checkpoint enemyBehaviors state is unsupported for an inactive capability.");
    }
    if (hasEnemyBehaviorsCheckpoint) checkpointDataField(descriptors, "enemyBehaviors", "Game checkpoint state");
    const hasBallisticsCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "ballistics");
    if (checkpointBallistics && !hasBallisticsCheckpoint) {
      throw new Error("Game checkpoint ballistics state is required for an active capability.");
    }
    if (!checkpointBallistics && hasBallisticsCheckpoint) {
      throw new Error("Game checkpoint ballistics state is unsupported for an inactive capability.");
    }
    if (hasBallisticsCheckpoint) checkpointDataField(descriptors, "ballistics", "Game checkpoint state");
    const hasWeatherCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "weather");
    if (checkpointWeather && !hasWeatherCheckpoint) {
      throw new Error("Game checkpoint weather state is required for an active capability.");
    }
    if (!checkpointWeather && hasWeatherCheckpoint) {
      throw new Error("Game checkpoint weather state is unsupported for an inactive capability.");
    }
    if (hasWeatherCheckpoint) checkpointDataField(descriptors, "weather", "Game checkpoint state");
    const hasScriptMachinesCheckpoint = Object.prototype.hasOwnProperty.call(descriptors, "scriptMachines");
    if (requiresScriptMachinesCheckpoint && !hasScriptMachinesCheckpoint) {
      throw new Error("Game checkpoint TowerScript machine state is required for active schema v7 machines.");
    }
    if (!requiresScriptMachinesCheckpoint && hasScriptMachinesCheckpoint) {
      throw new Error("Game checkpoint TowerScript machine state is unsupported without active schema v7 machines.");
    }
    if (hasScriptMachinesCheckpoint) checkpointDataField(descriptors, "scriptMachines", "Game checkpoint state");
    requireExactCheckpointKeys(descriptors, [
      ...required,
      ...(hasTerraformingCheckpoint ? ["terraforming"] : []),
      ...(Object.prototype.hasOwnProperty.call(descriptors, "combat") ? ["combat"] : []),
      ...(Object.prototype.hasOwnProperty.call(descriptors, "reactions") ? ["reactions"] : []),
      ...(hasArtifactCheckpoint ? ["artifacts"] : []),
      ...(hasDraftCheckpoint ? ["draft"] : []),
      ...(hasCampaignBattleCheckpoint ? ["campaignBattle"] : []),
      ...(hasHeroesCheckpoint ? ["heroes"] : []),
      ...(hasLogisticsCheckpoint ? ["logistics"] : []),
      ...(hasDirectorCheckpoint ? ["director"] : []),
      ...(hasQuestCheckpoint ? ["quests"] : []),
      ...(hasEnemyBehaviorsCheckpoint ? ["enemyBehaviors"] : []),
      ...(hasBallisticsCheckpoint ? ["ballistics"] : []),
      ...(hasWeatherCheckpoint ? ["weather"] : []),
      ...(hasScriptMachinesCheckpoint ? ["scriptMachines"] : [])
    ], "Game checkpoint state");

    const finite = (value: unknown, label: string, minimum = 0, maximum = Infinity): number => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`Game checkpoint state ${label} is invalid.`);
      }
      return value;
    };
    const integer = (value: unknown, label: string, minimum = 0): number => {
      const result = finite(value, label, minimum);
      if (!Number.isSafeInteger(result)) throw new Error(`Game checkpoint state ${label} must be a safe integer.`);
      return result;
    };
    const array = (value: unknown, label: string): readonly unknown[] => {
      if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        throw new Error(`Game checkpoint state ${label} must be an array.`);
      }
      return value;
    };
    const closed = (
      value: unknown,
      label: string,
      requiredKeys: readonly string[],
      optionalKeys: readonly string[] = []
    ) => {
      const result = checkpointObjectDescriptors(value, `Game checkpoint state ${label}`);
      for (const key of requiredKeys) checkpointDataField(result, key, `Game checkpoint state ${label}`);
      const allowed = new Set([...requiredKeys, ...optionalKeys]);
      if (Object.keys(result).some((key) => !allowed.has(key))) {
        throw new Error(`Game checkpoint state ${label} contains an unsupported field.`);
      }
      return result;
    };
    const stringValue = (value: unknown, label: string): string => {
      if (typeof value !== "string") throw new Error(`Game checkpoint state ${label} must be a string.`);
      return value;
    };
    const own = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);
    const recordNumbers = (
      value: unknown,
      label: string,
      allowedKeys?: ReadonlySet<string>,
      integersOnly = false
    ): void => {
      const entries = checkpointObjectDescriptors(value, `Game checkpoint state ${label}`);
      for (const key of Object.keys(entries)) {
        if (allowedKeys && !allowedKeys.has(key)) throw new Error(`Game checkpoint state ${label} references unknown id "${key}".`);
        const number = finite(checkpointDataField(entries, key, label), `${label}.${key}`);
        if (integersOnly && !Number.isInteger(number)) throw new Error(`Game checkpoint state ${label}.${key} must be an integer.`);
      }
    };
    const stringArray = (value: unknown, label: string, unique = false): string[] => {
      const result = array(value, label).map((item) => stringValue(item, `${label} entry`));
      if (unique && new Set(result).size !== result.length) {
        throw new Error(`Game checkpoint state ${label} contains duplicate ids.`);
      }
      return result;
    };

    if (checkpointWeather && state.weather) {
      const expectedWeatherSchedule = createWeatherScheduleV1({
        zones: checkpointWeather.zones,
        definitions: checkpointWeather.definitions,
        schedule: checkpointWeather.schedule
      }, {
        seed: canonicalStringify(rootInitialRng),
        missionId: identity.missionId,
        waveCount: mission.waves.length
      });
      const weather = closed(
        state.weather,
        "weather state",
        ["schemaVersion", "profileId", "rng", "active", "periodicOrdinals"]
      );
      if (integer(checkpointDataField(weather, "schemaVersion", "weather state"), "weather schemaVersion", 1) !== 1) {
        throw new Error("Game checkpoint weather schema version is unsupported.");
      }
      if (stringValue(checkpointDataField(weather, "profileId", "weather state"), "weather profileId") !== checkpointWeather.profileId) {
        throw new Error("Game checkpoint weather profile provenance is invalid.");
      }
      const weatherRng = closed(checkpointDataField(weather, "rng", "weather state"), "weather rng", ["initial", "current"]);
      const checkpointWeatherRng = {
        initial: SeededRng.fromState(checkpointDataField(weatherRng, "initial", "weather rng") as SeededRngStateV1).exportState(),
        current: SeededRng.fromState(checkpointDataField(weatherRng, "current", "weather rng") as SeededRngStateV1).exportState()
      };
      if (canonicalStringify(checkpointWeatherRng) !== canonicalStringify(expectedWeatherSchedule.rng)) {
        throw new Error("Game checkpoint weather RNG provenance is invalid.");
      }
      const activeValue = checkpointDataField(weather, "active", "weather state");
      const activeChoice = activeValue === null ? null : closed(
        activeValue,
        "weather active occurrence",
        ["waveIndex", "choiceId", "weatherId", "zoneId", "zone", "elapsedUnits"]
      );
      if (activeChoice) {
        const activeWaveIndex = integer(
          checkpointDataField(activeChoice, "waveIndex", "weather active occurrence"),
          "weather waveIndex"
        );
        finite(checkpointDataField(activeChoice, "elapsedUnits", "weather active occurrence"), "weather elapsedUnits");
        const choiceId = stringValue(checkpointDataField(activeChoice, "choiceId", "weather active occurrence"), "weather choiceId");
        const expectedOccurrence = expectedWeatherSchedule.occurrences[activeWaveIndex];
        if (!expectedOccurrence
          || choiceId !== expectedOccurrence.choiceId
          || stringValue(checkpointDataField(activeChoice, "weatherId", "weather active occurrence"), "weather weatherId") !== expectedOccurrence.weatherId
          || stringValue(checkpointDataField(activeChoice, "zoneId", "weather active occurrence"), "weather zoneId") !== expectedOccurrence.zoneId) {
          throw new Error("Game checkpoint weather active occurrence provenance is invalid.");
        }
        const checkpointZone = checkpointDataField(activeChoice, "zone", "weather active occurrence");
        if (canonicalStringify(checkpointZone) !== canonicalStringify(expectedOccurrence.zone)) {
          throw new Error("Game checkpoint weather zone provenance is invalid.");
        }
      }
      const allowedEffectIds = new Set(Object.values(checkpointWeather.definitions).flatMap((definition) => Object.keys(definition.effects)));
      recordNumbers(
        checkpointDataField(weather, "periodicOrdinals", "weather state"),
        "weather periodicOrdinals",
        allowedEffectIds,
        true
      );
    }

    if (checkpointBallistics && state.ballistics) {
      const ballistics = closed(
        state.ballistics,
        "ballistics state",
        ["schemaVersion", "nextProjectileSequence", "projectiles"],
        checkpointBallistics.projectiles.destructibles === undefined ? [] : ["destructibles"]
      );
      const checkpointBallisticsSchemaVersion = integer(
        checkpointDataField(ballistics, "schemaVersion", "ballistics state"),
        "ballistics schemaVersion",
        1
      );
      const checkpointClearance = checkpointBallistics.projectiles.clearance;
      const checkpointRicochet = checkpointBallistics.projectiles.ricochet;
      const checkpointDestructibles = checkpointBallistics.projectiles.destructibles;
      const expectedBallisticsSchemaVersion = checkpointDestructibles !== undefined
        ? 4
        : checkpointRicochet !== undefined
          ? 3
          : checkpointClearance === undefined ? 1 : 2;
      if (checkpointBallisticsSchemaVersion !== expectedBallisticsSchemaVersion) {
        throw new Error("Game checkpoint ballistics schema version is unsupported.");
      }
      const nextProjectileSequence = integer(
        checkpointDataField(ballistics, "nextProjectileSequence", "ballistics state"),
        "ballistics nextProjectileSequence",
        1
      );
      const projectiles = array(
        checkpointDataField(ballistics, "projectiles", "ballistics state"),
        "ballistics projectiles"
      );
      if (projectiles.length > BALLISTICS_LIMITS.activeProjectiles) {
        throw new Error("Game checkpoint ballistics projectile limit is exceeded.");
      }
      const seen = new Set<string>();
      let previousId = "";
      let maximumSequence = 0;
      const map = content.maps[mission.mapId];
      const checkpointGridMap = GridMap.fromDefinition(map);
      const runtimeTerrainMutationKeys = new Set<string>();
      for (const value of array(state.runtimeTerrainOverrides, "ballistics runtimeTerrainOverrides")) {
        const override = closed(
          value,
          "ballistics terrain override",
          ["q", "r", "terrain", "source"],
          ["expiresIn"]
        );
        const q = integer(checkpointDataField(override, "q", "ballistics terrain override"), "ballistics terrain override.q");
        const r = integer(checkpointDataField(override, "r", "ballistics terrain override"), "ballistics terrain override.r");
        runtimeTerrainMutationKeys.add(`${q},${r}`);
      }
      const runtimeElevationMutationKeys = new Set<string>();
      if (hasTerraformingCheckpoint) {
        const terraforming = checkpointObjectDescriptors(
          state.terraforming,
          "Game checkpoint state ballistics terraforming provenance"
        );
        const overrides = array(
          checkpointDataField(terraforming, "runtimeElevationOverrides", "ballistics terraforming provenance"),
          "ballistics runtimeElevationOverrides"
        );
        for (const value of overrides) {
          const override = closed(
            value,
            "ballistics elevation override",
            ["q", "r", "elevation"]
          );
          const q = integer(checkpointDataField(override, "q", "ballistics elevation override"), "ballistics elevation override.q");
          const r = integer(checkpointDataField(override, "r", "ballistics elevation override"), "ballistics elevation override.r");
          runtimeElevationMutationKeys.add(`${q},${r}`);
        }
      }
      const authoredTerrainByCoord = new Map(
        (map?.terrainOverrides ?? []).map((override) => [`${override.q},${override.r}`, override.terrain])
      );
      const authoredElevationByCoord = new Map(
        (map?.elevationOverrides ?? []).map((override) => [`${override.q},${override.r}`, override.elevation])
      );
      const authoredDestructibles = [...(map?.destructibleObjects ?? [])]
        .sort((left, right) => compareBinary(left.id, right.id));
      const destructibleRowsById = new Map<string, {
        readonly definitionId: string;
        readonly coord: HexCoord;
        readonly hp: number;
        readonly maxHp: number;
        readonly destroyed: boolean;
      }>();
      if (checkpointDestructibles !== undefined) {
        const destructibles = closed(
          checkpointDataField(ballistics, "destructibles", "ballistics state"),
          "ballistics destructibles",
          ["schemaVersion", "objects"]
        );
        if (checkpointDataField(destructibles, "schemaVersion", "ballistics destructibles") !== 1) {
          throw new Error("Game checkpoint ballistics destructible schema version is unsupported.");
        }
        const rows = array(
          checkpointDataField(destructibles, "objects", "ballistics destructibles"),
          "ballistics destructible objects"
        );
        if (rows.length !== authoredDestructibles.length) {
          throw new Error("Game checkpoint ballistics destructible objects are missing authored rows.");
        }
        const seenObjectIds = new Set<string>();
        let previousObjectId: string | undefined;
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          const row = closed(
            rows[rowIndex],
            `ballistics destructible object ${rowIndex}`,
            ["objectId", "definitionId", "coord", "hp", "maxHp", "destroyed"]
          );
          const objectId = stringValue(
            checkpointDataField(row, "objectId", "ballistics destructible object"),
            "ballistics destructible objectId"
          );
          if (previousObjectId !== undefined && compareBinary(previousObjectId, objectId) >= 0) {
            throw new Error("Game checkpoint ballistics destructible objects are not in canonical binary order.");
          }
          previousObjectId = objectId;
          if (seenObjectIds.has(objectId)) {
            throw new Error("Game checkpoint ballistics destructible object id is duplicate.");
          }
          seenObjectIds.add(objectId);
          const authored = authoredDestructibles.find((entry) => entry.id === objectId);
          if (!authored) throw new Error("Game checkpoint ballistics destructible object id is unknown.");
          const definitionId = stringValue(
            checkpointDataField(row, "definitionId", "ballistics destructible object"),
            "ballistics destructible definitionId"
          );
          const definition = checkpointDestructibles.definitions[definitionId];
          if (definitionId !== authored.definitionId || !definition) {
            throw new Error("Game checkpoint ballistics destructible definition provenance is invalid.");
          }
          const coordFields = closed(
            checkpointDataField(row, "coord", "ballistics destructible object"),
            "ballistics destructible coord",
            ["q", "r"]
          );
          const objectCoord = {
            q: integer(checkpointDataField(coordFields, "q", "ballistics destructible coord"), "ballistics destructible coord.q"),
            r: integer(checkpointDataField(coordFields, "r", "ballistics destructible coord"), "ballistics destructible coord.r")
          };
          if (objectCoord.q !== authored.coord.q || objectCoord.r !== authored.coord.r) {
            throw new Error("Game checkpoint ballistics destructible object coordinate provenance is invalid.");
          }
          const maxHp = finite(
            checkpointDataField(row, "maxHp", "ballistics destructible object"),
            "ballistics destructible maxHp",
            Number.MIN_VALUE
          );
          const hp = finite(
            checkpointDataField(row, "hp", "ballistics destructible object"),
            "ballistics destructible hp",
            0,
            maxHp
          );
          const destroyed = checkpointDataField(row, "destroyed", "ballistics destructible object");
          if (maxHp !== definition.maxHp || typeof destroyed !== "boolean" || destroyed !== (hp === 0)) {
            throw new Error("Game checkpoint ballistics destructible hp or destroyed state is incoherent.");
          }
          destructibleRowsById.set(objectId, { definitionId, coord: objectCoord, hp, maxHp, destroyed });
        }
      }
      const baseTerrainAt = (coord: Readonly<HexCoord>): string | undefined => {
        if (!map) return undefined;
        const key = `${coord.q},${coord.r}`;
        if (key === `${map.spawnCoord.q},${map.spawnCoord.r}`) return "spawn";
        if (key === `${map.coreCoord.q},${map.coreCoord.r}`) return "core";
        return authoredTerrainByCoord.get(key) ?? map.defaultTerrain;
      };
      for (let index = 0; index < projectiles.length; index += 1) {
        const projectile = closed(
          projectiles[index],
          `ballistics projectile ${index}`,
          [
            "id", "sourceCoord", "trajectory", "elapsedUnits", "travelTimeUnits", "altitude",
            "sourceElevation", "impact"
          ],
          checkpointBallisticsSchemaVersion === 4
            ? ["maxAltitude", "clearanceCollision", "ricochet", "destructibleCollision"]
            : checkpointBallisticsSchemaVersion === 3
              ? ["maxAltitude", "clearanceCollision", "ricochet"]
            : checkpointBallisticsSchemaVersion === 2
              ? ["maxAltitude", "clearanceCollision"]
              : ["maxAltitude"]
        );
        const id = stringValue(
          checkpointDataField(projectile, "id", "ballistics projectile"),
          "ballistics projectile id"
        );
        const idMatch = /^projectile_([1-9][0-9]*)$/.exec(id);
        const sequence = idMatch ? Number(idMatch[1]) : NaN;
        if (!Number.isSafeInteger(sequence) || seen.has(id) || (previousId && compareBinary(previousId, id) >= 0)) {
          throw new Error("Game checkpoint ballistics projectile id is invalid, duplicate, or non-canonical.");
        }
        seen.add(id);
        previousId = id;
        maximumSequence = Math.max(maximumSequence, sequence);
        const coord = (value: unknown, label: string) => {
          const fields = closed(value, label, ["q", "r"]);
          const q = integer(checkpointDataField(fields, "q", label), `${label}.q`);
          const r = integer(checkpointDataField(fields, "r", label), `${label}.r`);
          if (!map || q >= map.width || r >= map.height) {
            throw new Error(`Game checkpoint ${label} is outside the authored map.`);
          }
          return { q, r };
        };
        const sourceCoord = coord(
          checkpointDataField(projectile, "sourceCoord", "ballistics projectile"),
          "ballistics sourceCoord"
        );
        const trajectory = stringValue(
          checkpointDataField(projectile, "trajectory", "ballistics projectile"),
          "ballistics trajectory"
        );
        if (trajectory !== "direct" && trajectory !== "arc") {
          throw new Error("Game checkpoint ballistics trajectory is invalid.");
        }
        const travelTimeUnits = finite(
          checkpointDataField(projectile, "travelTimeUnits", "ballistics projectile"),
          "ballistics travelTimeUnits",
          Number.MIN_VALUE,
          BALLISTICS_LIMITS.travelTimeUnits
        );
        const elapsedUnits = finite(
          checkpointDataField(projectile, "elapsedUnits", "ballistics projectile"),
          "ballistics elapsedUnits",
          0,
          travelTimeUnits
        );
        const sourceElevation = finite(
          checkpointDataField(projectile, "sourceElevation", "ballistics projectile"),
          "ballistics sourceElevation",
          -BALLISTICS_LIMITS.maxAltitude,
          BALLISTICS_LIMITS.maxAltitude
        );
        const maxAltitude = own(projectile, "maxAltitude")
          ? finite(
              checkpointDataField(projectile, "maxAltitude", "ballistics projectile"),
              "ballistics maxAltitude",
              Number.MIN_VALUE,
              BALLISTICS_LIMITS.maxAltitude
            )
          : undefined;
        if ((trajectory === "arc") !== (maxAltitude !== undefined)) {
          throw new Error("Game checkpoint ballistics arc altitude contract is invalid.");
        }
        const progress = elapsedUnits / travelTimeUnits;
        const altitude = finite(
          checkpointDataField(projectile, "altitude", "ballistics projectile"),
          "ballistics altitude",
          -BALLISTICS_LIMITS.maxAltitude * 2,
          BALLISTICS_LIMITS.maxAltitude * 2
        );
        const impact = closed(
          checkpointDataField(projectile, "impact", "ballistics projectile"),
          "ballistics impact",
          ["targetCoord", "targetElevation", "damagePacket"]
        );
        const targetCoord = coord(
          checkpointDataField(impact, "targetCoord", "ballistics impact"),
          "ballistics targetCoord"
        );
        const targetElevation = finite(
          checkpointDataField(impact, "targetElevation", "ballistics impact"),
          "ballistics targetElevation",
          -BALLISTICS_LIMITS.maxAltitude,
          BALLISTICS_LIMITS.maxAltitude
        );
        const expectedAltitude = sourceElevation + (targetElevation - sourceElevation) * progress
          + (trajectory === "arc" ? 4 * maxAltitude! * progress * (1 - progress) : 0);
        if (Math.abs(altitude - expectedAltitude) > 1e-9) {
          throw new Error("Game checkpoint ballistics projectile altitude is incoherent.");
        }
        if (checkpointBallisticsSchemaVersion >= 2 && own(projectile, "clearanceCollision")) {
          const collision = closed(
            checkpointDataField(projectile, "clearanceCollision", "ballistics projectile"),
            "ballistics clearance collision",
            ["blockerCoord", "terrainId", "blockerTag", "blockerElevation", "elapsedUnits"]
          );
          const blockerCoord = coord(
            checkpointDataField(collision, "blockerCoord", "ballistics clearance collision"),
            "ballistics clearance blockerCoord"
          );
          const terrainId = stringValue(
            checkpointDataField(collision, "terrainId", "ballistics clearance collision"),
            "ballistics clearance terrainId"
          );
          const blockerTag = stringValue(
            checkpointDataField(collision, "blockerTag", "ballistics clearance collision"),
            "ballistics clearance blockerTag"
          );
          const blockerElevation = finite(
            checkpointDataField(collision, "blockerElevation", "ballistics clearance collision"),
            "ballistics clearance blockerElevation",
            -BALLISTICS_LIMITS.maxAltitude,
            BALLISTICS_LIMITS.maxAltitude
          );
          const collisionElapsed = finite(
            checkpointDataField(collision, "elapsedUnits", "ballistics clearance collision"),
            "ballistics clearance elapsedUnits",
            Number.MIN_VALUE,
            travelTimeUnits
          );
          const topologyLine = createGridTopology(map?.grid).line(sourceCoord, targetCoord);
          const blockerIndex = topologyLine.findIndex((entry, lineIndex) => (
            lineIndex > 0 && lineIndex < topologyLine.length - 1
            && entry.q === blockerCoord.q && entry.r === blockerCoord.r
          ));
          if (blockerIndex < 1 || topologyLine.length - 1 > ARC_CLEARANCE_LIMITS.maximumRayDistance) {
            throw new Error("Game checkpoint ballistics clearance collision coordinate provenance is invalid.");
          }
          const expectedCollisionElapsed = travelTimeUnits * blockerIndex / (topologyLine.length - 1);
          if (Math.abs(collisionElapsed - expectedCollisionElapsed) > 1e-9 || elapsedUnits > collisionElapsed + 1e-9) {
            throw new Error("Game checkpoint ballistics clearance collision elapsed provenance is invalid.");
          }
          const terrain = content.terrainTypes[terrainId];
          const blockerHeight = checkpointClearance?.terrainBlockerHeights[blockerTag];
          if (!terrain || blockerHeight === undefined || !terrain.tags.includes(blockerTag)) {
            throw new Error("Game checkpoint ballistics clearance collision terrain provenance is invalid.");
          }
          let selectedTag: string | undefined;
          let selectedHeight = Number.NEGATIVE_INFINITY;
          for (const tag of terrain.tags) {
            if (!Object.prototype.hasOwnProperty.call(checkpointClearance!.terrainBlockerHeights, tag)) continue;
            const height = checkpointClearance!.terrainBlockerHeights[tag]!;
            if (height > selectedHeight || (height === selectedHeight && (selectedTag === undefined || tag < selectedTag))) {
              selectedTag = tag;
              selectedHeight = height;
            }
          }
          const collisionProgress = blockerIndex / (topologyLine.length - 1);
          const collisionAltitude = projectileAltitudeAtProgress(
            sourceElevation,
            targetElevation,
            trajectory,
            maxAltitude,
            collisionProgress
          );
          if (selectedTag !== blockerTag || collisionAltitude > blockerElevation + blockerHeight) {
            throw new Error("Game checkpoint ballistics clearance collision blocker provenance is invalid.");
          }
          const blockerKey = `${blockerCoord.q},${blockerCoord.r}`;
          if (!runtimeTerrainMutationKeys.has(blockerKey)
            && !runtimeElevationMutationKeys.has(blockerKey)
            && (baseTerrainAt(blockerCoord) !== terrainId
              || (authoredElevationByCoord.get(blockerKey) ?? 0) !== blockerElevation)) {
            throw new Error("Game checkpoint ballistics clearance collision authored provenance is invalid.");
          }
          for (let lineIndex = 1; lineIndex < blockerIndex; lineIndex += 1) {
            const earlierCoord = topologyLine[lineIndex]!;
            const earlierKey = `${earlierCoord.q},${earlierCoord.r}`;
            // An active terrain/elevation override may have been applied after launch. The stored
            // collision remains authoritative in that case, so only immutable authored cells can
            // prove that a forged checkpoint skipped the first launch-time blocker.
            if (runtimeTerrainMutationKeys.has(earlierKey) || runtimeElevationMutationKeys.has(earlierKey)) continue;
            const earlierTerrainId = baseTerrainAt(earlierCoord);
            const earlierTerrain = earlierTerrainId === undefined ? undefined : content.terrainTypes[earlierTerrainId];
            let earlierTag: string | undefined;
            let earlierHeight = Number.NEGATIVE_INFINITY;
            for (const tag of earlierTerrain?.tags ?? []) {
              if (!Object.prototype.hasOwnProperty.call(checkpointClearance!.terrainBlockerHeights, tag)) continue;
              const height = checkpointClearance!.terrainBlockerHeights[tag]!;
              if (height > earlierHeight || (height === earlierHeight && (earlierTag === undefined || tag < earlierTag))) {
                earlierTag = tag;
                earlierHeight = height;
              }
            }
            if (earlierTag === undefined) continue;
            const earlierProgress = lineIndex / (topologyLine.length - 1);
            const earlierAltitude = projectileAltitudeAtProgress(
              sourceElevation,
              targetElevation,
              trajectory,
              maxAltitude,
              earlierProgress
            );
            const earlierElevation = authoredElevationByCoord.get(earlierKey) ?? 0;
            if (earlierAltitude <= earlierElevation + earlierHeight) {
              throw new Error("Game checkpoint ballistics clearance collision skipped the first blocker provenance.");
            }
          }
        }
        if (checkpointBallisticsSchemaVersion === 4 && own(projectile, "destructibleCollision")) {
          if (own(projectile, "clearanceCollision")) {
            throw new Error("Game checkpoint ballistics projectile has conflicting terminal collisions.");
          }
          const collision = closed(
            checkpointDataField(projectile, "destructibleCollision", "ballistics projectile"),
            "ballistics destructible collision",
            [
              "kind", "objectId", "definitionId", "collisionCoord",
              "blockerElevation", "blockerHeight", "elapsedUnits"
            ]
          );
          if (checkpointDataField(collision, "kind", "ballistics destructible collision") !== "map_object") {
            throw new Error("Game checkpoint ballistics destructible collision kind is invalid.");
          }
          const objectId = stringValue(
            checkpointDataField(collision, "objectId", "ballistics destructible collision"),
            "ballistics destructible collision objectId"
          );
          const definitionId = stringValue(
            checkpointDataField(collision, "definitionId", "ballistics destructible collision"),
            "ballistics destructible collision definitionId"
          );
          const object = destructibleRowsById.get(objectId);
          const definition = checkpointDestructibles?.definitions[definitionId];
          if (!object || object.definitionId !== definitionId || !definition) {
            throw new Error("Game checkpoint ballistics destructible collision object provenance is invalid.");
          }
          const collisionCoord = coord(
            checkpointDataField(collision, "collisionCoord", "ballistics destructible collision"),
            "ballistics destructible collisionCoord"
          );
          if (collisionCoord.q !== object.coord.q || collisionCoord.r !== object.coord.r) {
            throw new Error("Game checkpoint ballistics destructible collision coordinate provenance is invalid.");
          }
          const blockerElevation = finite(
            checkpointDataField(collision, "blockerElevation", "ballistics destructible collision"),
            "ballistics destructible blockerElevation",
            -BALLISTICS_LIMITS.maxAltitude,
            BALLISTICS_LIMITS.maxAltitude
          );
          const blockerHeight = finite(
            checkpointDataField(collision, "blockerHeight", "ballistics destructible collision"),
            "ballistics destructible blockerHeight",
            0,
            BALLISTICS_LIMITS.maxAltitude
          );
          const collisionElapsed = finite(
            checkpointDataField(collision, "elapsedUnits", "ballistics destructible collision"),
            "ballistics destructible collision elapsedUnits",
            Number.MIN_VALUE,
            travelTimeUnits
          );
          const topologyLine = createGridTopology(map?.grid).line(sourceCoord, targetCoord);
          const objectIndex = topologyLine.findIndex((entry, lineIndex) => (
            lineIndex > 0 && entry.q === collisionCoord.q && entry.r === collisionCoord.r
          ));
          const expectedElapsed = objectIndex < 1
            ? Number.NaN
            : travelTimeUnits * objectIndex / (topologyLine.length - 1);
          const collisionKey = `${collisionCoord.q},${collisionCoord.r}`;
          const authoredElevation = authoredElevationByCoord.get(collisionKey) ?? 0;
          const collisionAltitude = objectIndex < 1
            ? Number.POSITIVE_INFINITY
            : projectileAltitudeAtProgress(
                sourceElevation,
                targetElevation,
                trajectory,
                maxAltitude,
                objectIndex / (topologyLine.length - 1)
              );
          if (objectIndex < 1
            || topologyLine.length - 1 > DESTRUCTIBLE_COLLISION_LIMITS.maximumRayDistance
            || Math.abs(collisionElapsed - expectedElapsed) > 1e-9
            || elapsedUnits > collisionElapsed + 1e-9
            || blockerHeight !== definition.hitRegion.blockerHeight
            || (!runtimeElevationMutationKeys.has(collisionKey) && blockerElevation !== authoredElevation)
            || collisionAltitude > blockerElevation + blockerHeight) {
            throw new Error("Game checkpoint ballistics destructible collision provenance is incoherent.");
          }
        }
        const packet = checkpointDataField(impact, "damagePacket", "ballistics impact") as DamagePacket;
        validateDamagePacket(packet);
        if (packet.source.kind !== "tower" || !content.towers[packet.source.towerTypeId]
          || packet.target.kind !== "enemy" || !content.enemies[packet.target.enemyTypeId]) {
          throw new Error("Game checkpoint ballistics damage packet has invalid authored provenance.");
        }
        const towerBinding = checkpointBallistics.projectiles.towers[packet.source.towerTypeId];
        if (!towerBinding
          || trajectory !== towerBinding.trajectory
          || travelTimeUnits !== towerBinding.travelTimeUnits
          || maxAltitude !== towerBinding.maxAltitude) {
          throw new Error("Game checkpoint ballistics projectile binding provenance is invalid.");
        }
        const authoredRicochet = towerBinding?.ricochet;
        const hasRicochetState = own(projectile, "ricochet");
        if (checkpointBallisticsSchemaVersion >= 3 && (authoredRicochet !== undefined) !== hasRicochetState) {
          throw new Error("Game checkpoint ballistics ricochet binding provenance is invalid.");
        }
        if (hasRicochetState) {
          if (checkpointBallisticsSchemaVersion < 3 || authoredRicochet === undefined || checkpointRicochet === undefined) {
            throw new Error("Game checkpoint ballistics ricochet state is unsupported.");
          }
          const ricochet = closed(
            checkpointDataField(projectile, "ricochet", "ballistics projectile"),
            "ballistics ricochet state",
            ["schemaVersion", "maxBounces", "rangeCells", "bounceCount", "segmentHasTarget"],
            ["lastCollision"]
          );
          if (checkpointDataField(ricochet, "schemaVersion", "ballistics ricochet state") !== 1) {
            throw new Error("Game checkpoint ballistics ricochet schema version is unsupported.");
          }
          const maxBounces = integer(
            checkpointDataField(ricochet, "maxBounces", "ballistics ricochet state"),
            "ballistics ricochet maxBounces",
            1
          );
          const rangeCells = integer(
            checkpointDataField(ricochet, "rangeCells", "ballistics ricochet state"),
            "ballistics ricochet rangeCells",
            1
          );
          const bounceCount = integer(
            checkpointDataField(ricochet, "bounceCount", "ballistics ricochet state"),
            "ballistics ricochet bounceCount"
          );
          const segmentHasTarget = checkpointDataField(
            ricochet,
            "segmentHasTarget",
            "ballistics ricochet state"
          );
          if (typeof segmentHasTarget !== "boolean") {
            throw new Error("Game checkpoint ballistics ricochet segmentHasTarget must be boolean.");
          }
          if (maxBounces !== authoredRicochet.maxBounces
            || rangeCells !== authoredRicochet.rangeCells
            || bounceCount > maxBounces) {
            throw new Error("Game checkpoint ballistics ricochet bounce provenance exceeds its authored maximum.");
          }
          const hasLastCollision = own(ricochet, "lastCollision");
          if ((bounceCount > 0) !== hasLastCollision) {
            throw new Error("Game checkpoint ballistics ricochet collision provenance is incoherent.");
          }
          if (hasLastCollision) {
            const collision = closed(
              checkpointDataField(ricochet, "lastCollision", "ballistics ricochet state"),
              "ballistics ricochet lastCollision",
              ["kind", "surfaceId", "collisionCoord", "incomingFromCoord"]
            );
            const kind = stringValue(
              checkpointDataField(collision, "kind", "ballistics ricochet lastCollision"),
              "ballistics ricochet collision kind"
            );
            if (kind !== "terrain" && kind !== "armor") {
              throw new Error("Game checkpoint ballistics ricochet collision kind is invalid.");
            }
            const surfaceId = stringValue(
              checkpointDataField(collision, "surfaceId", "ballistics ricochet lastCollision"),
              "ballistics ricochet collision surfaceId"
            );
            const surfaceEnabled = kind === "terrain"
              ? checkpointRicochet.terrainTags?.[surfaceId] === true
              : checkpointRicochet.armorTypes?.[surfaceId] === true;
            if (!surfaceEnabled) {
              throw new Error("Game checkpoint ballistics ricochet collision surface provenance is invalid.");
            }
            const collisionCoord = coord(
              checkpointDataField(collision, "collisionCoord", "ballistics ricochet lastCollision"),
              "ballistics ricochet collisionCoord"
            );
            const incomingFromCoord = coord(
              checkpointDataField(collision, "incomingFromCoord", "ballistics ricochet lastCollision"),
              "ballistics ricochet incomingFromCoord"
            );
            const ray = traceProjectileRicochetRayV1(
              checkpointGridMap,
              { kind, collisionCoord, incomingFromCoord, rangeCells }
            );
            if (!ray.ok
              || ray.nextSourceCoord.q !== sourceCoord.q
              || ray.nextSourceCoord.r !== sourceCoord.r
              || !ray.ray.some((candidate) => candidate.q === targetCoord.q && candidate.r === targetCoord.r)) {
              throw new Error("Game checkpoint ballistics ricochet reflected ray provenance is invalid.");
            }
            if (segmentHasTarget && packet.target.componentId !== undefined) {
              throw new Error("Game checkpoint ballistics ricochet reflected target must address the enemy root.");
            }
          }
        }
      }
      if (maximumSequence >= nextProjectileSequence) {
        throw new Error("Game checkpoint ballistics projectile sequence is incoherent.");
      }
    }

    const validateDirectorReason = (value: unknown, label: string, counterId: string) => {
      const base = checkpointObjectDescriptors(value, `Game checkpoint state ${label}`);
      const metric = stringValue(checkpointDataField(base, "metric", label), `${label}.metric`);
      const keys = metric === "logistics_brownout_ratio"
        ? ["metric", "operator", "threshold", "observed"]
        : ["metric", "key", "operator", "threshold", "observed"];
      requireExactCheckpointKeys(base, keys, `Game checkpoint state ${label}`);
      if (!["damage_share", "coverage_ratio", "movement_layer_share", "logistics_brownout_ratio"].includes(metric)) {
        throw new Error("Game checkpoint Director reason metric is invalid.");
      }
      const operator = stringValue(checkpointDataField(base, "operator", label), `${label}.operator`);
      if (operator !== "gte" && operator !== "lte") throw new Error("Game checkpoint Director reason operator is invalid.");
      const key = metric === "logistics_brownout_ratio"
        ? undefined
        : stringValue(checkpointDataField(base, "key", label), `${label}.key`);
      const threshold = finite(checkpointDataField(base, "threshold", label), `${label}.threshold`, 0, 1);
      const observed = finite(checkpointDataField(base, "observed", label), `${label}.observed`, 0, 1);
      const counter = checkpointDirector?.counterPool[counterId];
      const authored = counter?.conditions.some((condition) => condition.metric === metric
        && condition.key === key
        && condition.operator === operator
        && condition.threshold === threshold);
      const satisfied = operator === "gte" ? observed >= threshold : observed <= threshold;
      if (!authored || !satisfied) {
        throw new Error("Game checkpoint Director reason must match a satisfied authored condition.");
      }
    };
    const validateDirectorGroups = (value: unknown, label: string, counterId: string) => {
      if (!checkpointDirector) throw new Error("Game checkpoint Director profile is inactive.");
      const expected = checkpointDirector.counterPool[counterId]?.groups;
      const groups = array(value, label);
      if (!expected || groups.length !== expected.length) throw new Error("Game checkpoint Director groups do not match the authored counter.");
      groups.forEach((groupValue, index) => {
        const authored = expected[index]!;
        const group = closed(groupValue, `${label}[${index}]`, ["enemyId", "count", "spawnInterval", "startDelay"], ["routeId"]);
        const enemyId = stringValue(checkpointDataField(group, "enemyId", label), `${label}.enemyId`);
        const count = integer(checkpointDataField(group, "count", label), `${label}.count`, 1);
        const spawnInterval = finite(checkpointDataField(group, "spawnInterval", label), `${label}.spawnInterval`);
        const startDelay = finite(checkpointDataField(group, "startDelay", label), `${label}.startDelay`);
        const routeId = own(group, "routeId")
          ? stringValue(checkpointDataField(group, "routeId", label), `${label}.routeId`)
          : undefined;
        if (enemyId !== authored.enemyId || count !== authored.count || spawnInterval !== authored.spawnInterval
          || startDelay !== authored.startDelay || routeId !== authored.routeId) {
          throw new Error("Game checkpoint Director groups do not match the authored counter.");
        }
      });
    };
    if (checkpointDirector && state.director) {
      const director = closed(state.director, "Director state", ["schemaVersion", "profileId", "decisions"]);
      if (checkpointDataField(director, "schemaVersion", "Director state") !== 1
        || checkpointDataField(director, "profileId", "Director state") !== checkpointDirector.profileId) {
        throw new Error("Game checkpoint Director identity is invalid.");
      }
      const decisions = array(checkpointDataField(director, "decisions", "Director state"), "Director decisions");
      if (decisions.length > DIRECTOR_LIMITS.decisionHistory) throw new Error("Game checkpoint Director history exceeds its bound.");
      let previousWave = -1;
      for (const decisionValue of decisions) {
        const decision = closed(decisionValue, "Director decision", ["waveIndex", "counterId", "threatCost", "reason", "addedGroups"]);
        const waveIndex = integer(checkpointDataField(decision, "waveIndex", "Director decision"), "Director waveIndex");
        const counterId = stringValue(checkpointDataField(decision, "counterId", "Director decision"), "Director counterId");
        const counter = checkpointDirector.counterPool[counterId];
        if (!counter || waveIndex <= previousWave || waveIndex >= state.startedWaveCount) throw new Error("Game checkpoint Director decision order is invalid.");
        previousWave = waveIndex;
        if (checkpointDataField(decision, "threatCost", "Director decision") !== counter.threatCost) throw new Error("Game checkpoint Director threat cost is invalid.");
        validateDirectorReason(checkpointDataField(decision, "reason", "Director decision"), "Director reason", counterId);
        validateDirectorGroups(checkpointDataField(decision, "addedGroups", "Director decision"), "Director added groups", counterId);
      }
    }

    const checkpointQuestEntries = new Map<string, { kind: string; status: string }>();
    if (checkpointQuests && state.quests) {
      const quests = closed(state.quests, "quest state", ["schemaVersion", "profileId", "entries"]);
      if (checkpointDataField(quests, "schemaVersion", "quest state") !== 1
        || checkpointDataField(quests, "profileId", "quest state") !== checkpointQuests.profileId) {
        throw new Error("Game checkpoint quest identity is invalid.");
      }
      const expected = selectProceduralQuestsV1(
        {
          selectionCount: checkpointQuests.selectionCount,
          definitions: checkpointQuests.definitions
        },
        { seed: questRuntimeSeed(rootInitialRng, identity.missionId) }
      );
      const entries = array(checkpointDataField(quests, "entries", "quest state"), "quest entries");
      if (entries.length !== expected.length) {
        throw new Error("Game checkpoint quest selection is incomplete or contains duplicates.");
      }
      entries.forEach((entryValue, index) => {
        const selected = expected[index]!;
        const definition = selected.definition;
        const entry = closed(
          entryValue,
          `quest entry ${index}`,
          ["questId", "label", "kind", "current", "target", "status"]
        );
        const questId = stringValue(checkpointDataField(entry, "questId", "quest entry"), "quest entry questId");
        const label = stringValue(checkpointDataField(entry, "label", "quest entry"), "quest entry label");
        const kind = stringValue(checkpointDataField(entry, "kind", "quest entry"), "quest entry kind");
        const target = integer(checkpointDataField(entry, "target", "quest entry"), "quest entry target", 1);
        const current = integer(checkpointDataField(entry, "current", "quest entry"), "quest entry current");
        const status = stringValue(checkpointDataField(entry, "status", "quest entry"), "quest entry status");
        const authoredTarget = definition.objective.kind === "kill_with_source"
          ? definition.objective.count
          : definition.objective.waves;
        if (questId !== selected.questId || label !== definition.label || kind !== definition.objective.kind
          || target !== authoredTarget) {
          throw new Error("Game checkpoint quest entry does not match the deterministic authored selection.");
        }
        if (current > target || !["active", "completed", "failed"].includes(status)) {
          throw new Error("Game checkpoint quest current, target, or status is invalid.");
        }
        if ((status === "active" && current >= target)
          || (status === "completed" && current !== target)
          || (status === "failed" && (
            definition.objective.kind !== "preserve_shield" || current >= target
          ))) {
          throw new Error("Game checkpoint quest progress is impossible for the authored objective.");
        }
        checkpointQuestEntries.set(questId, { kind, status });
      });
    }

    let campaignBattleState: GameCheckpointStateV1["campaignBattle"];
    if (hasCampaignBattleCheckpoint) {
      if (checkpointRoguelite?.schemaVersion !== 4 || checkpointRoguelite.campaign?.schemaVersion !== 2) {
        throw new Error("Game checkpoint campaign battle state is unsupported for an inactive handoff.");
      }
      const campaign = closed(
        state.campaignBattle,
        "campaign battle state",
        ["schemaVersion", "launchId", "nodeId", "maxNewArtifactInstances", "deck", "artifacts"]
      );
      if (checkpointDataField(campaign, "schemaVersion", "campaign battle state") !== 1) {
        throw new Error("Game checkpoint campaign battle state schema version is unsupported.");
      }
      const launchId = stringValue(checkpointDataField(campaign, "launchId", "campaign battle state"), "campaign launchId");
      const nodeId = stringValue(checkpointDataField(campaign, "nodeId", "campaign battle state"), "campaign nodeId");
      const maxNewArtifactInstances = integer(
        checkpointDataField(campaign, "maxNewArtifactInstances", "campaign battle state"),
        "campaign maxNewArtifactInstances"
      );
      if (maxNewArtifactInstances > ROGUELITE_ARTIFACT_INVENTORY_LIMIT) {
        throw new Error("Game checkpoint campaign artifact acquisition limit is invalid.");
      }
      if (
        !/^[0-9a-f]{16}$/.test(launchId)
        || nodeId.length === 0
        || nodeId.length > CAMPAIGN_RUN_LIMITS.identifierCodeUnits
      ) {
        throw new Error("Game checkpoint campaign battle identity is invalid.");
      }
      const normalizePortable = (value: unknown, field: "cardId" | "artifactId"): Array<Record<string, string>> => {
        const definitions = field === "cardId" ? checkpointRoguelite.draft?.definitions : checkpointRoguelite.artifacts?.definitions;
        const seen = new Set<string>();
        return array(value, `campaign ${field} entries`).map((item) => {
          const entry = closed(item, `campaign ${field} entry`, ["instanceId", field]);
          const instanceId = stringValue(checkpointDataField(entry, "instanceId", `campaign ${field} entry`), `campaign ${field} instanceId`);
          const definitionId = stringValue(checkpointDataField(entry, field, `campaign ${field} entry`), `campaign ${field}`);
          if (
            instanceId.length === 0
            || instanceId.length > CAMPAIGN_RUN_LIMITS.identifierCodeUnits
            || seen.has(instanceId)
            || !definitions
            || !Object.prototype.hasOwnProperty.call(definitions, definitionId)
          ) throw new Error(`Game checkpoint campaign ${field} entry is invalid.`);
          seen.add(instanceId);
          return { instanceId, [field]: definitionId };
        });
      };
      campaignBattleState = {
        schemaVersion: 1,
        launchId,
        nodeId,
        maxNewArtifactInstances,
        deck: normalizePortable(checkpointDataField(campaign, "deck", "campaign battle state"), "cardId") as never,
        artifacts: normalizePortable(checkpointDataField(campaign, "artifacts", "campaign battle state"), "artifactId") as never
      };
      if (
        campaignBattleState.deck.length + campaignBattleState.artifacts.length
        > CAMPAIGN_RUN_LIMITS.collectionEntries
      ) throw new Error("Game checkpoint campaign loadout exceeds the aggregate CampaignRun collection limit.");
      if (
        campaignBattleWorstCaseModifierCount(campaignBattleState.deck, content, identity.missionId)
        > MAX_MODIFIERS_PER_RESOLUTION
      ) throw new Error("Game checkpoint campaign loadout exceeds the shared modifier budget.");
      const numericPreflight = preflightHeroAuraDamageFinite(content, identity.missionId, {
        deck: campaignBattleState.deck
      });
      if (!numericPreflight.ok) throw new Error(numericPreflight.message);
    }

    let campaignArtifactInventoryCount = 0;
    let campaignDraftSelectionCount = 0;
    const artifactSockets: Array<{
      readonly instanceId: string;
      readonly artifactId: string;
      readonly towerId: string;
      readonly slotId: string;
    }> = [];
    if (requiresArtifactCheckpoint) {
      const artifactState = state.artifacts;
      if (!artifactState) throw new Error("Game checkpoint artifact state is required.");
      const artifact = closed(
        artifactState,
        "artifact state",
        ["schemaVersion", "rng", "nextInstanceSequence", "inventory"]
      );
      const artifactSchemaVersion = checkpointDataField(artifact, "schemaVersion", "artifact state");
      if (artifactSchemaVersion !== 1 && artifactSchemaVersion !== 2 && artifactSchemaVersion !== 3) {
        throw new Error("Game checkpoint artifact state schema version is unsupported.");
      }
      if ((artifactSchemaVersion === 3) !== Boolean(campaignBattleState)) {
        throw new Error("Game checkpoint campaign artifact state and handoff context are inconsistent.");
      }
      const artifactRng = closed(
        checkpointDataField(artifact, "rng", "artifact state"),
        "artifact RNG",
        ["initial", "current"]
      );
      const artifactInitial = checkpointDataField(artifactRng, "initial", "artifact RNG") as SeededRngStateV1;
      const artifactCurrent = checkpointDataField(artifactRng, "current", "artifact RNG") as SeededRngStateV1;
      for (const [label, rngState] of [["initial", artifactInitial], ["current", artifactCurrent]] as const) {
        closed(rngState, `artifact ${label} RNG state`, ["schemaVersion", "algorithm", "words"]);
        SeededRng.fromState(rngState);
      }
      const inventory = array(
        checkpointDataField(artifact, "inventory", "artifact state"),
        "artifact inventory"
      );
      if (campaignBattleState) campaignArtifactInventoryCount = inventory.length;
      if (inventory.length > ROGUELITE_ARTIFACT_INVENTORY_LIMIT) {
        throw new Error("Game checkpoint artifact inventory budget is exceeded.");
      }
      const reachableArtifactIds = new Set(
        Object.values(checkpointRoguelite.artifacts.bossLootTables)
          .flatMap((table) => table.entries.map((entry) => entry.artifactId))
      );
      const seenInstances = new Set<string>();
      for (let index = 0; index < inventory.length; index += 1) {
        const entry = closed(
          inventory[index],
          "artifact inventory entry",
          artifactSchemaVersion === 2 || artifactSchemaVersion === 3
            ? ["instanceId", "artifactId", "socket"]
            : ["instanceId", "artifactId"]
        );
        const instanceId = stringValue(
          checkpointDataField(entry, "instanceId", "artifact inventory entry"),
          "artifact inventory instanceId"
        );
        const artifactId = stringValue(
          checkpointDataField(entry, "artifactId", "artifact inventory entry"),
          "artifact inventory artifactId"
        );
        const carriedArtifact = campaignBattleState?.artifacts[index];
        const validCampaignInstance = artifactSchemaVersion === 3 && (
          carriedArtifact
            ? carriedArtifact.instanceId === instanceId && carriedArtifact.artifactId === artifactId
            : instanceId === `campaign:${campaignBattleState!.launchId}:artifact:${index + 1}`
        );
        if (
          seenInstances.has(instanceId)
          || (artifactSchemaVersion !== 3 && instanceId !== `artifact_${index + 1}`)
          || (artifactSchemaVersion === 3 && !validCampaignInstance)
        ) {
          throw new Error("Game checkpoint artifact inventory has an invalid or duplicate instance id.");
        }
        if (!checkpointRoguelite.artifacts.definitions[artifactId]) {
          throw new Error("Game checkpoint artifact inventory references an unknown definition.");
        }
        if (
          (artifactSchemaVersion !== 3 || !carriedArtifact)
          && !reachableArtifactIds.has(artifactId)
        ) {
          throw new Error("Game checkpoint artifact inventory references an artifact unreachable from authored loot tables.");
        }
        if (artifactSchemaVersion === 2 || artifactSchemaVersion === 3) {
          const socketValue = checkpointDataField(entry, "socket", "artifact inventory entry");
          if (socketValue !== null) {
            const socket = closed(socketValue, "artifact socket", ["towerId", "slotId"]);
            artifactSockets.push({
              instanceId,
              artifactId,
              towerId: stringValue(
                checkpointDataField(socket, "towerId", "artifact socket"),
                "artifact socket towerId"
              ),
              slotId: stringValue(
                checkpointDataField(socket, "slotId", "artifact socket"),
                "artifact socket slotId"
              )
            });
          }
        }
        seenInstances.add(instanceId);
      }
      if (artifactSchemaVersion === 3 && inventory.length < (campaignBattleState?.artifacts.length ?? 0)) {
        throw new Error("Game checkpoint campaign artifact inventory is missing carried entries.");
      }
      if (
        artifactSchemaVersion === 3
        && inventory.length - (campaignBattleState?.artifacts.length ?? 0) > (campaignBattleState?.maxNewArtifactInstances ?? 0)
      ) throw new Error("Game checkpoint campaign artifact acquisition limit is exceeded.");
      const nextInstanceSequence = integer(
        checkpointDataField(artifact, "nextInstanceSequence", "artifact state"),
        "artifact nextInstanceSequence",
        1
      );
      if (nextInstanceSequence !== inventory.length + 1) {
        throw new Error("Game checkpoint artifact instance sequence is incoherent with inventory.");
      }
    }

    if (requiresDraftCheckpoint) {
      const draftDefinition = checkpointRoguelite?.draft;
      const draftState = state.draft;
      if (!draftDefinition || !draftState) throw new Error("Game checkpoint draft state is required.");
      const draft = closed(
        draftState,
        "draft state",
        ["schemaVersion", "rng", "nextOfferSequence", "pendingOffer", "selections"]
      );
      const draftSchemaVersion = checkpointDataField(draft, "schemaVersion", "draft state");
      if (draftSchemaVersion !== 1 && draftSchemaVersion !== 2) {
        throw new Error("Game checkpoint draft state schema version is unsupported.");
      }
      if ((draftSchemaVersion === 2) !== Boolean(campaignBattleState)) {
        throw new Error("Game checkpoint campaign draft state and handoff context are inconsistent.");
      }
      const draftRng = closed(checkpointDataField(draft, "rng", "draft state"), "draft RNG", ["initial", "current"]);
      const draftInitial = checkpointDataField(draftRng, "initial", "draft RNG") as SeededRngStateV1;
      const draftCurrent = checkpointDataField(draftRng, "current", "draft RNG") as SeededRngStateV1;
      for (const [label, rngState] of [["initial", draftInitial], ["current", draftCurrent]] as const) {
        closed(rngState, `draft ${label} RNG state`, ["schemaVersion", "algorithm", "words"]);
        SeededRng.fromState(rngState);
      }
      const expectedDraftInitial = new SeededRng(waveDraftSeed(rootInitialRng, identity.missionId)).exportState();
      if (canonicalStringify(draftInitial) !== canonicalStringify(expectedDraftInitial)) {
        throw new Error("Game checkpoint draft initial RNG does not match the simulation seed domain.");
      }
      const replayDraftRng = SeededRng.fromState(draftInitial);
      const selections = array(checkpointDataField(draft, "selections", "draft state"), "draft selections");
      if (campaignBattleState) campaignDraftSelectionCount = selections.length;
      if (selections.length > ROGUELITE_DRAFT_LIMITS.selections) {
        throw new Error("Game checkpoint draft selections exceed the selection budget.");
      }
      if (selections.length > Math.max(0, mission.waves.length - 1)) {
        throw new Error("Game checkpoint draft selections exceed the mission inter-wave opportunities.");
      }
      for (let index = 0; index < selections.length; index += 1) {
        const selection = closed(
          selections[index],
          "draft selection",
          draftSchemaVersion === 2 ? ["sequence", "offerId", "cardId", "instanceId"] : ["sequence", "offerId", "cardId"]
        );
        const sequence = integer(checkpointDataField(selection, "sequence", "draft selection"), "draft selection sequence", 1);
        const offerId = stringValue(checkpointDataField(selection, "offerId", "draft selection"), "draft selection offerId");
        const cardId = stringValue(checkpointDataField(selection, "cardId", "draft selection"), "draft selection cardId");
        const offeredCardIds = sampleDraftOfferCardIds(draftDefinition, draftDefinition.defaultPoolId, replayDraftRng);
        if (
          sequence !== index + 1
          || offerId !== `draft_offer_${sequence}`
          || !draftDefinition.definitions[cardId]
          || !offeredCardIds.includes(cardId)
        ) {
          throw new Error("Game checkpoint draft selection sequence, offer, or card is invalid.");
        }
        if (draftSchemaVersion === 2) {
          const instanceId = stringValue(checkpointDataField(selection, "instanceId", "draft selection"), "draft selection instanceId");
          if (instanceId !== `campaign:${campaignBattleState!.launchId}:card:${sequence}`) {
            throw new Error("Game checkpoint campaign draft selection instance is invalid.");
          }
        }
      }
      const pendingValue = checkpointDataField(draft, "pendingOffer", "draft state");
      if (pendingValue !== null) {
        const pending = closed(
          pendingValue,
          "draft pending offer",
          ["offerId", "afterWaveIndex", "poolId", "cardIds"]
        );
        const offerId = stringValue(checkpointDataField(pending, "offerId", "draft pending offer"), "draft offerId");
        const afterWaveIndex = integer(
          checkpointDataField(pending, "afterWaveIndex", "draft pending offer"),
          "draft afterWaveIndex"
        );
        const poolId = stringValue(checkpointDataField(pending, "poolId", "draft pending offer"), "draft poolId");
        if (poolId !== draftDefinition.defaultPoolId) {
          throw new Error("Game checkpoint draft pending offer must use the authored default pool.");
        }
        const cardIds = stringArray(
          checkpointDataField(pending, "cardIds", "draft pending offer"),
          "draft pending cardIds",
          true
        );
        const pool = draftDefinition.pools[poolId];
        const nextOfferSequence = integer(
          checkpointDataField(draft, "nextOfferSequence", "draft state"),
          "draft nextOfferSequence",
          1
        );
        const expectedCardIds = sampleDraftOfferCardIds(draftDefinition, poolId, replayDraftRng);
        if (
          cardIds.length !== ROGUELITE_DRAFT_LIMITS.offerSize
          || offerId !== `draft_offer_${nextOfferSequence - 1}`
          || nextOfferSequence !== selections.length + 2
          || afterWaveIndex !== state.clearedWaveCount - 1
          || afterWaveIndex >= mission.waves.length - 1
          || !pool
          || cardIds.some((cardId) => (
            !draftDefinition.definitions[cardId]
            || !pool.entries.some((entry) => entry.cardId === cardId)
          ))
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
          || state.scriptSignalDepth !== 0
        ) {
          throw new Error("Game checkpoint draft pending offer is incoherent with authored cards or sequence.");
        }
      } else {
        const nextOfferSequence = integer(
          checkpointDataField(draft, "nextOfferSequence", "draft state"),
          "draft nextOfferSequence",
          1
        );
        if (nextOfferSequence !== selections.length + 1) {
          throw new Error("Game checkpoint draft offer sequence is incoherent with selections.");
        }
      }
      const pendingCount = pendingValue === null ? 0 : 1;
      const clearedDelta = state.clearedWaveCount - selections.length;
      const finalWaveCleared = state.clearedWaveCount === mission.waves.length;
      if (
        (pendingCount === 1 && (clearedDelta !== 1 || finalWaveCleared))
        || (pendingCount === 0 && (
          clearedDelta !== 0
          && !(clearedDelta === 1 && (state.outcome !== "playing" || finalWaveCleared))
        ))
      ) {
        throw new Error("Game checkpoint draft phase is incoherent with cleared waves and terminal outcome.");
      }
      if (canonicalStringify(replayDraftRng.exportState()) !== canonicalStringify(draftCurrent)) {
        throw new Error("Game checkpoint draft RNG is incoherent with recorded offers and selections.");
      }
    }

    if (
      campaignBattleState
      && campaignBattleState.deck.length + campaignDraftSelectionCount + campaignArtifactInventoryCount
        > CAMPAIGN_RUN_LIMITS.collectionEntries
    ) throw new Error("Game checkpoint campaign state exceeds the aggregate CampaignRun collection limit.");

    finite(state.coreHp, "coreHp");
    const currencyIds = new Set(content.currencies.map((currency) => currency.id));
    recordNumbers(state.resources, "resources", currencyIds);
    const waveIndex = integer(state.waveIndex, "waveIndex");
    const startedWaveCount = integer(state.startedWaveCount, "startedWaveCount");
    if (waveIndex >= Math.max(1, mission.waves.length) || startedWaveCount > mission.waves.length) {
      throw new Error("Game checkpoint state wave position is outside the mission.");
    }
    if (!(new Set<WaveState>(["ready", "spawning", "between", "complete"])).has(state.waveState)) {
      throw new Error("Game checkpoint state waveState is invalid.");
    }
    if (!(new Set(["playing", "victory", "defeat"])).has(state.outcome)) {
      throw new Error("Game checkpoint state outcome is invalid.");
    }
    finite(state.prepRemaining, "prepRemaining");
    finite(state.missionElapsed, "missionElapsed");
    if (state.nextWaveStartAt !== null) finite(state.nextWaveStartAt, "nextWaveStartAt");
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
    if (!mapDefinition) throw new Error("Game checkpoint identity mission has no source map.");
    const admitsNativePathWater = checkpointTerraforming !== undefined
      && (mission.abilities ?? []).some((ability) => ability.id === "path_water")
      && content.terrainTypes.water !== undefined;
    const validCoord = (value: unknown, label: string): { q: number; r: number } => {
      const coord = closed(value, label, ["q", "r"]);
      const q = checkpointDataField(coord, "q", label);
      const r = checkpointDataField(coord, "r", label);
      if (
        typeof q !== "number" || !Number.isInteger(q) || typeof r !== "number" || !Number.isInteger(r) ||
        q < 0 || q >= mapDefinition.width || r < 0 || r >= mapDefinition.height
      ) throw new Error(`Game checkpoint state ${label} is outside the map.`);
      return { q, r };
    };
    const routeIds = new Set(
      mapDefinition.pathRoutes?.length ? mapDefinition.pathRoutes.map((route) => route.id) : ["main"]
    );
    const routeTracks = new Map(
      mapDefinition.pathRoutes?.length
        ? mapDefinition.pathRoutes.map((route) => [route.id, route.pathCenterline] as const)
        : [["main", mapDefinition.pathCenterline] as const]
    );
    const topology = createGridTopology(normalizeGridDefinition(mapDefinition.grid));
    const directFlightTrack = topology.line(mapDefinition.spawnCoord, mapDefinition.coreCoord);
    const difficulty = content.difficulties.find((item) => item.id === identity.difficultyId)!;
    const selectedNavigation = resolveActiveNavigationMechanics(content, identity.missionId);
    const activeNavigationProfile: DynamicFlowNavigationProfileV1 | undefined = selectedNavigation?.mode === "dynamic_flow"
      ? {
          mode: "dynamic_flow",
          defaultMovementProfileId: selectedNavigation.defaultMovementProfileId,
          movementProfiles: selectedNavigation.movementProfiles,
          ...(selectedNavigation.enemyMovementProfiles === undefined
            ? {}
            : { enemyMovementProfiles: selectedNavigation.enemyMovementProfiles })
        }
      : undefined;
    const checkpointFormationAssignments = activeNavigationProfile && checkpointEnemyBehaviors?.formations
      ? new Map(Object.entries(checkpointEnemyBehaviors.formations.cohorts).flatMap(([cohortId, cohort]) => (
          Object.entries(cohort.members).map(([enemyTypeId, role]) => [
            enemyTypeId,
            Object.freeze({
              cohortId,
              role,
              steering: cohort.steering,
              ...(cohort.protection === undefined ? {} : { protection: cohort.protection })
            })
          ] as const)
        )))
      : undefined;
    const checkpointFormationProtection = checkpointFormationAssignments
      ? Object.fromEntries(Object.entries(checkpointEnemyBehaviors?.formations?.cohorts ?? {})
          .filter(([, cohort]) => cohort.protection !== undefined)
          .sort(([left], [right]) => compareBinary(left, right))
          .map(([cohortId, cohort]) => [cohortId, cohort.protection!]))
      : {};
    const optionalRoute = (descriptors: ReturnType<typeof closed>, label: string): void => {
      if (!own(descriptors, "routeId")) return;
      const routeId = stringValue(checkpointDataField(descriptors, "routeId", label), `${label}.routeId`);
      if (!routeIds.has(routeId)) throw new Error(`Game checkpoint state ${label} references an unknown route.`);
    };
    const optionalFinite = (
      object: ReturnType<typeof closed>, key: string, label: string, minimum = 0, maximum = Infinity
    ): void => {
      if (own(object, key)) finite(checkpointDataField(object, key, label), `${label}.${key}`, minimum, maximum);
    };

    const enemyIds = new Set<string>();
    const liveEnemyIds = new Set<string>();
    const enemyTypeByInstance = new Map<string, string>();
    const disruptTargetReferences: Array<{ enemyId: string; towerIds: string[] }> = [];
    const navigationStates: Array<{
      readonly enemyId: string;
      readonly routeId: string;
      readonly navigation: EnemyNavigationStateV1;
    }> = [];
    let liveNavigationStates = 0;
    let maxEnemyId = 0;
    for (const value of array(state.enemies, "enemies")) {
      const enemy = closed(value, "enemy", [
        "id", "typeId", "hp", "maxHp", "pathProgress", "dotRemaining", "pathOffset"
      ], [
        "dotDamagePerUnit", "dotSourceTowerTypeId", "routeId", "phaseSpawnsTriggered", "statuses",
        "disruptCooldown", "disruptTargetTowerIds", "towerAttackCooldown", "navigation"
      ]);
      const id = checkpointDataField(enemy, "id", "Game checkpoint enemy");
      const typeId = checkpointDataField(enemy, "typeId", "Game checkpoint enemy");
      if (
        typeof id !== "string" || enemyIds.has(id) || typeof typeId !== "string" ||
        !own(content.enemies, typeId)
      ) {
        throw new Error("Game checkpoint state has an invalid or duplicate enemy identity.");
      }
      const idMatch = /^enemy_([1-9]\d*)$/.exec(id);
      if (!idMatch) throw new Error("Game checkpoint state enemy id is not an engine id.");
      const numericId = Number(idMatch[1]);
      if (!Number.isSafeInteger(numericId)) throw new Error("Game checkpoint state enemy id suffix is unsafe.");
      maxEnemyId = Math.max(maxEnemyId, numericId);
      enemyIds.add(id);
      enemyTypeByInstance.set(id, typeId);
      for (const key of ["hp", "maxHp", "pathProgress", "dotRemaining", "pathOffset"] as const) {
        finite(checkpointDataField(enemy, key, "Game checkpoint enemy"), `enemy.${key}`, key === "pathOffset" ? -Infinity : 0);
      }
      optionalFinite(enemy, "dotDamagePerUnit", "enemy");
      const enemyType = content.enemies[typeId];
      if (!enemyType) throw new Error("Game checkpoint enemy references an unknown type.");
      const maxHp = checkpointDataField(enemy, "maxHp", "enemy");
      const hp = checkpointDataField(enemy, "hp", "enemy");
      const expectedMaxHp = enemyType.maxHp * (difficulty.enemyHpMultiplier ?? 1);
      if (maxHp !== expectedMaxHp || typeof hp !== "number" || hp > expectedMaxHp) {
        throw new Error("Game checkpoint enemy hp or maxHp is inconsistent with authored content.");
      }
      if (hp > 0) liveEnemyIds.add(id);
      if (own(enemy, "dotSourceTowerTypeId")) {
        const towerTypeId = stringValue(checkpointDataField(enemy, "dotSourceTowerTypeId", "enemy"), "enemy.dotSourceTowerTypeId");
        if (!own(content.towers, towerTypeId)) throw new Error("Game checkpoint enemy references an unknown dot tower type.");
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
      if (activeNavigationProfile || !isFlying) optionalRoute(enemy, "enemy");
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
        const navigation = closed(
          checkpointDataField(enemy, "navigation", "enemy"),
          "enemy navigation",
          ["schemaVersion", "movementProfileId", "currentCoord", "edgeProgress", "stepsEntered"],
          ["nextCoord"]
        );
        if (checkpointDataField(navigation, "schemaVersion", "enemy navigation") !== 1) {
          throw new Error("Game checkpoint enemy navigation schema version is unsupported.");
        }
        const movementProfileId = stringValue(
          checkpointDataField(navigation, "movementProfileId", "enemy navigation"),
          "enemy navigation movement profile"
        );
        const expectedMovementProfileId = activeNavigationProfile.enemyMovementProfiles?.[typeId]
          ?? activeNavigationProfile.defaultMovementProfileId;
        if (
          !own(activeNavigationProfile.movementProfiles, movementProfileId)
          || movementProfileId !== expectedMovementProfileId
        ) {
          throw new Error("Game checkpoint enemy navigation profile is invalid for its enemy type.");
        }
        const currentCoord = validCoord(
          checkpointDataField(navigation, "currentCoord", "enemy navigation"),
          "enemy navigation current coord"
        );
        const nextCoord = own(navigation, "nextCoord")
          ? validCoord(
              checkpointDataField(navigation, "nextCoord", "enemy navigation"),
              "enemy navigation next coord"
            )
          : undefined;
        const edgeProgress = finite(
          checkpointDataField(navigation, "edgeProgress", "enemy navigation"),
          "enemy navigation edge progress"
        );
        if (edgeProgress >= 1) {
          throw new Error("Game checkpoint enemy navigation edge progress must be in [0, 1)." );
        }
        const stepsEntered = integer(
          checkpointDataField(navigation, "stepsEntered", "enemy navigation"),
          "enemy navigation steps entered"
        );
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
        if (typeof hp === "number" && hp > 0) liveNavigationStates += 1;
      }
      optionalFinite(enemy, "disruptCooldown", "enemy");
      optionalFinite(enemy, "towerAttackCooldown", "enemy");
      if (own(enemy, "disruptTargetTowerIds")) {
        const disrupt = enemyType.towerDisrupt;
        if (!disrupt?.telegraphLead) {
          throw new Error("Game checkpoint enemy disruption targets require an authored telegraph.");
        }
        const towerIds = stringArray(
          checkpointDataField(enemy, "disruptTargetTowerIds", "enemy"),
          "enemy.disruptTargetTowerIds",
          true
        );
        if (towerIds.length > (disrupt.maxTargets ?? Number.POSITIVE_INFINITY)) {
          throw new Error("Game checkpoint enemy disruption target count exceeds authored maxTargets.");
        }
        const cooldown = own(enemy, "disruptCooldown")
          ? checkpointDataField(enemy, "disruptCooldown", "enemy")
          : undefined;
        if (typeof cooldown !== "number" || cooldown <= 0 || cooldown > disrupt.telegraphLead) {
          throw new Error("Game checkpoint enemy disruption targets are outside the telegraph window.");
        }
        disruptTargetReferences.push({ enemyId: id, towerIds });
      }
      if (own(enemy, "phaseSpawnsTriggered")) {
        const triggers = stringArray(
          checkpointDataField(enemy, "phaseSpawnsTriggered", "enemy"),
          "enemy.phaseSpawnsTriggered",
          true
        );
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
    if (enemyCounter < maxEnemyId) throw new Error("Game checkpoint enemy counter is below a live enemy id.");
    let checkpointVanguardProtectionTransactionsThisTick: number | undefined;
    if (checkpointEnemyBehaviors) {
      const protectionCohortIds = Object.keys(checkpointFormationProtection);
      const hasProtectionRuntime = protectionCohortIds.length > 0;
      const enemyBehaviorsValue = checkpointDataField(descriptors, "enemyBehaviors", "Game checkpoint state");
      const enemyBehaviorsDescriptors = checkpointObjectDescriptors(
        enemyBehaviorsValue,
        "Game checkpoint state enemyBehaviors state"
      );
      if (!hasProtectionRuntime && own(enemyBehaviorsDescriptors, "protectionRuntime")) {
        throw new Error(
          "Game checkpoint enemyBehaviors protectionRuntime is unsupported when formation protection is inactive."
        );
      }
      const section = closed(
        enemyBehaviorsValue,
        "enemyBehaviors state",
        [
          "schemaVersion",
          "components",
          ...(checkpointFormationAssignments ? ["formations"] : []),
          ...(hasProtectionRuntime ? ["protectionRuntime"] : [])
        ]
      );
      if (checkpointDataField(section, "schemaVersion", "enemyBehaviors state") !== 1) {
        throw new Error("Game checkpoint enemyBehaviors schema version is unsupported.");
      }
      if (hasProtectionRuntime) {
        const protectionRuntime = checkpointObjectDescriptors(
          checkpointDataField(section, "protectionRuntime", "enemyBehaviors state"),
          "Game checkpoint state enemyBehaviors protectionRuntime"
        );
        checkpointDataField(protectionRuntime, "schemaVersion", "enemyBehaviors protectionRuntime");
        checkpointDataField(protectionRuntime, "transactionsThisTick", "enemyBehaviors protectionRuntime");
        const unsupportedProtectionRuntimeKey = Object.keys(protectionRuntime)
          .find((key) => key !== "schemaVersion" && key !== "transactionsThisTick");
        if (unsupportedProtectionRuntimeKey !== undefined) {
          throw new Error(
            `Game checkpoint enemyBehaviors protectionRuntime closed schema contains unknown field "${unsupportedProtectionRuntimeKey}".`
          );
        }
        if (checkpointDataField(protectionRuntime, "schemaVersion", "enemyBehaviors protectionRuntime") !== 1) {
          throw new Error("Game checkpoint enemyBehaviors protectionRuntime schema version is unsupported.");
        }
        const transactionsThisTick = checkpointDataField(
          protectionRuntime,
          "transactionsThisTick",
          "enemyBehaviors protectionRuntime"
        );
        if (
          typeof transactionsThisTick !== "number"
          || !Number.isSafeInteger(transactionsThisTick)
          || transactionsThisTick < 0
          || transactionsThisTick > ENEMY_BEHAVIORS_LIMITS.protectionTransactionsPerTick
        ) {
          throw new Error(
            `Game checkpoint enemyBehaviors protectionRuntime.transactionsThisTick must be an integer in range 0..${ENEMY_BEHAVIORS_LIMITS.protectionTransactionsPerTick}.`
          );
        }
        checkpointVanguardProtectionTransactionsThisTick = transactionsThisTick;
      }
      const componentEnemies = checkpointObjectDescriptors(
        checkpointDataField(section, "components", "enemyBehaviors state"),
        "Game checkpoint enemyBehaviors components"
      );
      const expectedEnemyIds = [...enemyTypeByInstance.entries()]
        .filter(([, typeId]) => checkpointEnemyBehaviors.bosses?.[typeId] !== undefined)
        .map(([enemyId]) => enemyId)
        .sort(compareBinary);
      const actualEnemyIds = Object.keys(componentEnemies);
      if (actualEnemyIds.join("\u0000") !== expectedEnemyIds.join("\u0000")) {
        throw new Error("Game checkpoint enemyBehaviors state has missing, extra, or non-canonical enemy ids.");
      }
      for (const enemyId of actualEnemyIds) {
        const typeId = enemyTypeByInstance.get(enemyId)!;
        const authoredBoss = checkpointEnemyBehaviors.bosses?.[typeId];
        if (!authoredBoss) throw new Error("Game checkpoint enemyBehaviors state references a non-component enemy.");
        const authored = authoredBoss.components;
        const componentRecord = checkpointObjectDescriptors(
          checkpointDataField(componentEnemies, enemyId, "enemyBehaviors components"),
          `Game checkpoint enemyBehaviors components for ${enemyId}`
        );
        const expectedComponentIds = Object.keys(authored).sort(compareBinary);
        const actualComponentIds = Object.keys(componentRecord);
        if (actualComponentIds.join("\u0000") !== expectedComponentIds.join("\u0000")) {
          throw new Error(`Game checkpoint enemyBehaviors state for "${enemyId}" has invalid component ids.`);
        }
        for (const componentId of actualComponentIds) {
          const definition = authored[componentId]!;
          const component = closed(
            checkpointDataField(componentRecord, componentId, `enemyBehaviors components for ${enemyId}`),
            `enemyBehaviors component ${enemyId}.${componentId}`,
            ["hp", "maxHp"],
            definition.shield === undefined ? [] : ["shield"]
          );
          const expectedMaxHp = definition.maxHp * (difficulty.enemyHpMultiplier ?? 1);
          if (checkpointDataField(component, "maxHp", componentId) !== expectedMaxHp) {
            throw new Error(`Game checkpoint enemyBehaviors component "${componentId}" maxHp differs from authored content.`);
          }
          finite(checkpointDataField(component, "hp", componentId), `${componentId}.hp`, 0, expectedMaxHp);
          const hasShield = own(component, "shield");
          if ((definition.shield !== undefined) !== hasShield) {
            throw new Error(`Game checkpoint enemyBehaviors component "${componentId}" shield state is inconsistent.`);
          }
          if (definition.shield && hasShield) {
            const shield = closed(
              checkpointDataField(component, "shield", componentId),
              `${componentId}.shield`,
              ["current", "capacity", "regenerationDelayRemaining"]
            );
            if (checkpointDataField(shield, "capacity", componentId) !== definition.shield.capacity) {
              throw new Error(`Game checkpoint enemyBehaviors component "${componentId}" shield capacity differs.`);
            }
            finite(checkpointDataField(shield, "current", componentId), `${componentId}.shield.current`, 0, definition.shield.capacity);
            finite(
              checkpointDataField(shield, "regenerationDelayRemaining", componentId),
              `${componentId}.shield.regenerationDelayRemaining`,
              0,
              definition.shield.regeneration?.delayAfterDamage ?? 0
            );
          }
        }
      }
      if (checkpointFormationAssignments) {
        const formations = closed(
          checkpointDataField(section, "formations", "enemyBehaviors state"),
          "enemyBehaviors formations state",
          protectionCohortIds.length > 0
            ? ["schemaVersion", "enemies", "protection"]
            : ["schemaVersion", "enemies"]
        );
        if (checkpointDataField(formations, "schemaVersion", "enemyBehaviors formations state") !== 1) {
          throw new Error("Game checkpoint enemyBehaviors formation schema version is unsupported.");
        }
        const formationEnemies = checkpointObjectDescriptors(
          checkpointDataField(formations, "enemies", "enemyBehaviors formations state"),
          "Game checkpoint enemyBehaviors formation enemies"
        );
        const expectedFormationEnemyIds = [...enemyTypeByInstance.entries()]
          .filter(([enemyId, typeId]) => liveEnemyIds.has(enemyId) && checkpointFormationAssignments.has(typeId))
          .map(([enemyId]) => enemyId)
          .sort(compareBinary);
        const actualFormationEnemyIds = Object.keys(formationEnemies);
        if (actualFormationEnemyIds.join("\u0000") !== expectedFormationEnemyIds.join("\u0000")) {
          throw new Error("Game checkpoint enemyBehaviors formation state has missing, stale, extra, or non-canonical enemy ids.");
        }
        for (const enemyId of actualFormationEnemyIds) {
          const typeId = enemyTypeByInstance.get(enemyId)!;
          const expected = checkpointFormationAssignments.get(typeId)!;
          const membership = closed(
            checkpointDataField(formationEnemies, enemyId, "enemyBehaviors formation enemies"),
            `enemyBehaviors formation membership ${enemyId}`,
            ["cohortId", "role"]
          );
          if (
            checkpointDataField(membership, "cohortId", `formation membership ${enemyId}`) !== expected.cohortId
            || checkpointDataField(membership, "role", `formation membership ${enemyId}`) !== expected.role
          ) {
            throw new Error(`Game checkpoint enemyBehaviors formation membership for "${enemyId}" has an invalid cohort or role.`);
          }
        }
        if (protectionCohortIds.length > 0) {
          const protection = closed(
            checkpointDataField(formations, "protection", "enemyBehaviors formations state"),
            "enemyBehaviors formation protection state",
            ["schemaVersion", "cohorts"]
          );
          if (checkpointDataField(protection, "schemaVersion", "enemyBehaviors formation protection state") !== 1) {
            throw new Error("Game checkpoint enemyBehaviors formation protection schema version is unsupported.");
          }
          const cohorts = checkpointObjectDescriptors(
            checkpointDataField(protection, "cohorts", "enemyBehaviors formation protection state"),
            "Game checkpoint enemyBehaviors formation protection cohorts"
          );
          if (Object.keys(cohorts).join("\u0000") !== protectionCohortIds.join("\u0000")) {
            throw new Error("Game checkpoint enemyBehaviors formation protection cohorts are missing, extra, or non-canonical.");
          }
          for (const cohortId of protectionCohortIds) {
            const authored = checkpointFormationProtection[cohortId]!;
            const cohort = closed(
              checkpointDataField(cohorts, cohortId, "enemyBehaviors formation protection cohorts"),
              `enemyBehaviors formation protection ${cohortId}`,
              ["radius", "sourceKinds"]
            );
            if (checkpointDataField(cohort, "radius", `formation protection ${cohortId}`) !== authored.radius) {
              throw new Error(`Game checkpoint enemyBehaviors formation protection radius for "${cohortId}" differs from authored content.`);
            }
            const sourceKinds = stringArray(
              checkpointDataField(cohort, "sourceKinds", `formation protection ${cohortId}`),
              `formation protection ${cohortId}.sourceKinds`,
              true
            );
            if (sourceKinds.join("\u0000") !== authored.sourceKinds.join("\u0000")) {
              throw new Error(`Game checkpoint enemyBehaviors formation protection sources for "${cohortId}" differ from authored content.`);
            }
          }
        }
      }
    }

    const towerIds = new Set<string>();
    const towerStateById = new Map<string, { readonly typeId: string; readonly hp?: number }>();
    const occupiedCoords = new Set<string>();
    let maxTowerId = 0;
    for (const value of array(state.towers, "towers")) {
      const tower = closed(value, "tower", [
        "id", "typeId", "coord", "footprint", "level", "stacks", "cooldown", "investedResources"
      ], ["targetMode", "disabledFor", "hp", "baseTypeId", "upgradeBranchId"]);
      const id = checkpointDataField(tower, "id", "Game checkpoint tower");
      const typeId = checkpointDataField(tower, "typeId", "Game checkpoint tower");
      if (
        typeof id !== "string" || towerIds.has(id) || typeof typeId !== "string" ||
        !own(content.towers, typeId)
      ) {
        throw new Error("Game checkpoint state has an invalid or duplicate tower identity.");
      }
      const idMatch = /^tower_([1-9]\d*)$/.exec(id);
      if (!idMatch) throw new Error("Game checkpoint state tower id is not an engine id.");
      const numericId = Number(idMatch[1]);
      if (!Number.isSafeInteger(numericId)) throw new Error("Game checkpoint state tower id suffix is unsafe.");
      maxTowerId = Math.max(maxTowerId, numericId);
      towerIds.add(id);
      const type = content.towers[typeId];
      if (!type) throw new Error("Game checkpoint tower references an unknown type.");
      const center = validCoord(checkpointDataField(tower, "coord", "Game checkpoint tower"), `tower ${id} coord`);
      const level = integer(checkpointDataField(tower, "level", "tower"), "tower.level", 1);
      const hasBaseTypeId = own(tower, "baseTypeId");
      const hasUpgradeBranchId = own(tower, "upgradeBranchId");
      if (hasBaseTypeId !== hasUpgradeBranchId) {
        throw new Error("Game checkpoint tower upgrade branch identity is incomplete.");
      }
      if (hasBaseTypeId) {
        const baseTypeId = stringValue(checkpointDataField(tower, "baseTypeId", "tower"), "tower.baseTypeId");
        const upgradeBranchId = stringValue(checkpointDataField(tower, "upgradeBranchId", "tower"), "tower.upgradeBranchId");
        const baseType = content.towers[baseTypeId];
        const branch = baseType?.upgradeBranches?.find((candidate) => candidate.id === upgradeBranchId);
        if (!baseType || !branch || branch.targetTowerId !== typeId || level !== 3) {
          throw new Error("Game checkpoint tower upgrade branch is inconsistent with authored content.");
        }
      }
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
        if (!(TOWER_TARGET_MODES as readonly string[]).includes(mode)) throw new Error("Game checkpoint tower target mode is invalid.");
      }
      const expectedFootprint = resolveTowerFootprintCoords(topology, center, type)
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
        if (occupiedCoords.has(key)) throw new Error("Game checkpoint tower footprints overlap.");
        occupiedCoords.add(key);
      }
    }
    if (towerCounter < maxTowerId) throw new Error("Game checkpoint tower counter is below a live tower id.");
    for (const reference of disruptTargetReferences) {
      if (reference.towerIds.some((towerId) => !towerIds.has(towerId))) {
        throw new Error(`Game checkpoint enemy ${reference.enemyId} disruption targets reference an unknown tower.`);
      }
    }
    const checkpointPower = checkpointLogisticsMechanics?.power;
    if (checkpointPower) {
      preflightLogisticsPowerTopologyV1(
        checkpointPower,
        state.towers,
        content.towers,
        topology
      );
    }
    if (checkpointAmmunition || checkpointSupply) {
      const isV3 = checkpointLogisticsMechanics?.schemaVersion === 3;
      const logisticsState = closed(
        state.logistics,
        "Logistics checkpoint",
        isV3 ? ["schemaVersion", "ammunition", "supply"] : ["schemaVersion", "ammunition"]
      );
      const expectedSchema = isV3 ? 2 : 1;
      if (checkpointDataField(logisticsState, "schemaVersion", "Logistics checkpoint") !== expectedSchema) {
        throw new Error("Game checkpoint Logistics schema version is invalid.");
      }
      const ammunitionValue = checkpointDataField(logisticsState, "ammunition", "Logistics checkpoint");
      if (!checkpointAmmunition) {
        if (ammunitionValue !== null) throw new Error("Game checkpoint Logistics ammunition must be null.");
      } else {
        const ammunitionState = closed(
          ammunitionValue,
          "Logistics ammunition checkpoint ammunition",
          ["inventories"]
        );
        const rows = array(
          checkpointDataField(ammunitionState, "inventories", "Logistics ammunition checkpoint ammunition"),
          "Logistics ammunition inventories"
        );
        if (rows.length > LOGISTICS_AMMUNITION_LIMITS.liveInventories) {
          throw new Error(
            `Game checkpoint Logistics ammunition inventory limit ${LOGISTICS_AMMUNITION_LIMITS.liveInventories} exceeded.`
          );
        }
        const expected = state.towers
          .filter((tower) => isLiveLogisticsAmmunitionTower(tower)
            && isAmmunitionBoundTowerType(checkpointAmmunition, tower.typeId))
          .sort((left, right) => compareBinary(left.id, right.id));
        if (rows.length !== expected.length) {
          throw new Error("Game checkpoint Logistics ammunition inventories have a missing or extra live tower row.");
        }
        let previousTowerId: string | undefined;
        for (let index = 0; index < rows.length; index += 1) {
          const row = closed(rows[index], `Logistics ammunition inventory ${index}`, ["towerId", "amount"]);
          const towerId = stringValue(
            checkpointDataField(row, "towerId", "Logistics ammunition inventory"),
            `Logistics ammunition inventory ${index} towerId`
          );
          if (previousTowerId !== undefined && compareBinary(previousTowerId, towerId) >= 0) {
            throw new Error("Game checkpoint Logistics ammunition inventory order is not canonical or contains duplicates.");
          }
          previousTowerId = towerId;
          const tower = expected[index];
          if (!tower || tower.id !== towerId) {
            throw new Error("Game checkpoint Logistics ammunition inventory references an unknown, extra, or downed tower.");
          }
          const definition = getLogisticsAmmunitionTowerInventory(checkpointAmmunition, tower.typeId);
          if (!definition) throw new Error("Game checkpoint Logistics ammunition inventory references an unbound tower type.");
          const amount = integer(
            checkpointDataField(row, "amount", "Logistics ammunition inventory"),
            `Logistics ammunition inventory ${towerId} amount`
          );
          const hasActiveSupply = isV3 && checkpointSupply !== undefined;
          const maximum = hasActiveSupply ? definition.capacity : definition.startingAmount;
          if (amount > maximum) {
            throw new Error(
              `Game checkpoint Logistics ammunition amount exceeds the authored ${hasActiveSupply ? "capacity" : "starting amount"}.`
            );
          }
        }
      }

      if (isV3) {
        const supplyValue = checkpointDataField(logisticsState, "supply", "Logistics checkpoint");
        if (!checkpointSupply) {
          if (supplyValue !== null) throw new Error("Game checkpoint Logistics supply must be null.");
        } else {
          const supplyState = closed(supplyValue, "Logistics supply checkpoint", ["producers", "storages"]);
          const producerRows = array(
            checkpointDataField(supplyState, "producers", "Logistics supply checkpoint"),
            "Logistics supply producers"
          );
          const storageRows = array(
            checkpointDataField(supplyState, "storages", "Logistics supply checkpoint"),
            "Logistics supply storages"
          );
          if (producerRows.length + storageRows.length > LOGISTICS_SUPPLY_LIMITS.liveSources) {
            throw new Error(`Game checkpoint Logistics supply source limit ${LOGISTICS_SUPPLY_LIMITS.liveSources} exceeded.`);
          }
          const expectedProducers = state.towers
            .filter((tower) => isLiveLogisticsAmmunitionTower(tower)
              && getLogisticsProducerDefinitionV3(checkpointSupply, tower.typeId) !== undefined)
            .sort((left, right) => compareBinary(left.id, right.id));
          const expectedStorages = state.towers
            .filter((tower) => isLiveLogisticsAmmunitionTower(tower)
              && getLogisticsStorageDefinitionV3(checkpointSupply, tower.typeId) !== undefined)
            .sort((left, right) => compareBinary(left.id, right.id));
          if (producerRows.length !== expectedProducers.length || storageRows.length !== expectedStorages.length) {
            throw new Error("Game checkpoint Logistics supply has a missing or extra live producer or storage row.");
          }
          const validateProgress = (value: unknown, label: string, maximum: number, inclusive: boolean): number => {
            if (typeof value !== "number" || !Number.isFinite(value) || value < 0
              || (inclusive ? value > maximum : value >= maximum)) {
              throw new Error(`Game checkpoint Logistics supply ${label} is invalid.`);
            }
            return value;
          };
          let previousProducerId: string | undefined;
          for (let index = 0; index < producerRows.length; index += 1) {
            const row = closed(
              producerRows[index],
              `Logistics supply producer ${index}`,
              ["towerId", "amount", "productionProgress", "transferProgress"]
            );
            const towerId = stringValue(
              checkpointDataField(row, "towerId", "Logistics supply producer"),
              `Logistics supply producer ${index} towerId`
            );
            if (previousProducerId !== undefined && compareBinary(previousProducerId, towerId) >= 0) {
              throw new Error("Game checkpoint Logistics supply producer order is not canonical or contains duplicates.");
            }
            previousProducerId = towerId;
            const tower = expectedProducers[index];
            if (!tower || tower.id !== towerId) {
              throw new Error("Game checkpoint Logistics supply producer references an unknown or downed tower.");
            }
            const definition = getLogisticsProducerDefinitionV3(checkpointSupply, tower.typeId)!;
            const recipe = Object.prototype.hasOwnProperty.call(checkpointSupply.productionRecipes, definition.recipeId)
              ? checkpointSupply.productionRecipes[definition.recipeId]
              : undefined;
            if (!recipe) throw new Error("Game checkpoint Logistics supply producer recipe is missing.");
            const amount = integer(
              checkpointDataField(row, "amount", "Logistics supply producer"),
              `Logistics supply producer ${towerId} amount`
            );
            if (amount > definition.capacity) throw new Error("Game checkpoint Logistics supply producer amount exceeds capacity.");
            validateProgress(
              checkpointDataField(row, "productionProgress", "Logistics supply producer"),
              "producer production progress",
              recipe.interval,
              false
            );
            validateProgress(
              checkpointDataField(row, "transferProgress", "Logistics supply producer"),
              "producer transfer progress",
              definition.transferInterval,
              true
            );
          }
          let previousStorageId: string | undefined;
          for (let index = 0; index < storageRows.length; index += 1) {
            const row = closed(
              storageRows[index],
              `Logistics supply storage ${index}`,
              ["towerId", "amount", "transferProgress"]
            );
            const towerId = stringValue(
              checkpointDataField(row, "towerId", "Logistics supply storage"),
              `Logistics supply storage ${index} towerId`
            );
            if (previousStorageId !== undefined && compareBinary(previousStorageId, towerId) >= 0) {
              throw new Error("Game checkpoint Logistics supply storage order is not canonical or contains duplicates.");
            }
            previousStorageId = towerId;
            const tower = expectedStorages[index];
            if (!tower || tower.id !== towerId) {
              throw new Error("Game checkpoint Logistics supply storage references an unknown or downed tower.");
            }
            const definition = getLogisticsStorageDefinitionV3(checkpointSupply, tower.typeId)!;
            const amount = integer(
              checkpointDataField(row, "amount", "Logistics supply storage"),
              `Logistics supply storage ${towerId} amount`
            );
            if (amount > definition.capacity) throw new Error("Game checkpoint Logistics supply storage amount exceeds capacity.");
            validateProgress(
              checkpointDataField(row, "transferProgress", "Logistics supply storage"),
              "storage transfer progress",
              definition.transferInterval,
              true
            );
          }
          preflightLogisticsSupplyTopologyV3(
            checkpointSupply,
            checkpointAmmunition!,
            state.towers,
            content.towers,
            topology
          );
        }
      }
    }

    if (artifactSockets.length > 0) {
      if (!checkpointRoguelite?.artifacts) {
        throw new Error("Game checkpoint artifact sockets require active roguelite artifacts.");
      }
      const occupiedArtifactSlots = new Set<string>();
      const artifactModifierCounts = new Map<string, number>();
      for (const socket of artifactSockets) {
        const tower = towerStateById.get(socket.towerId);
        if (!tower || (tower.hp !== undefined && tower.hp <= 0)) {
          throw new Error("Game checkpoint artifact socket references a missing or non-live tower.");
        }
        const slot = checkpointRoguelite.artifacts.towerSlots[tower.typeId]
          ?.find((item) => item.slotId === socket.slotId);
        if (!slot) throw new Error("Game checkpoint artifact socket references an unknown tower slot.");
        const definition = checkpointRoguelite.artifacts.definitions[socket.artifactId];
        if (!definition || definition.slotType !== slot.slotType) {
          throw new Error("Game checkpoint artifact socket is incompatible with the authored slot.");
        }
        const assignmentKey = `${socket.towerId.length}:${socket.towerId}|${socket.slotId.length}:${socket.slotId}`;
        if (occupiedArtifactSlots.has(assignmentKey)) {
          throw new Error("Game checkpoint artifact socket assignment is duplicated.");
        }
        occupiedArtifactSlots.add(assignmentKey);
        artifactModifierCounts.set(
          socket.towerId,
          (artifactModifierCounts.get(socket.towerId) ?? 0) + definition.modifiers.length
        );
      }
      const synergyWorstCase = rogueliteSynergyWorstCaseModifierCount(checkpointRoguelite.synergies);
      for (const artifactModifierCount of artifactModifierCounts.values()) {
        if (
          synergyWorstCase
          + artifactModifierCount
          + ROGUELITE_DAMAGE_MODIFIER_RESERVE.total
          + activeHeroAuraModifierReserve(content, identity.missionId)
          > MAX_MODIFIERS_PER_RESOLUTION
        ) {
          throw new Error("Game checkpoint artifact socket modifier budget is exceeded.");
        }
      }
    }

    const activeCombat = resolveActiveCombatMechanics(content, identity.missionId);
    const combatDefinitions = activeCombat?.shields;
    const expectedEnemyShields = new Map<string, NonNullable<ActiveCombatShieldDefinitions["enemies"][string]>>();
    const expectedTowerShields = new Map<string, NonNullable<ActiveCombatShieldDefinitions["towers"][string]>>();
    if (combatDefinitions) {
      for (const enemy of state.enemies) {
        const definition = combatDefinitions.enemies[enemy.typeId];
        if (definition) expectedEnemyShields.set(enemy.id, definition);
      }
      for (const tower of state.towers) {
        const definition = combatDefinitions.towers[tower.typeId];
        if (definition) expectedTowerShields.set(tower.id, definition);
      }
    }
    const expectsShields = expectedEnemyShields.size > 0 || expectedTowerShields.size > 0;
    const hasCombat = own(descriptors, "combat");
    if (expectsShields && !hasCombat) {
      throw new Error("Game checkpoint combat shield state is missing.");
    }
    if (hasCombat) {
      if (!activeCombat) throw new Error("Game checkpoint combat state is unexpected for an inactive capability.");
      const rawCombat = checkpointObjectDescriptors(
        checkpointDataField(descriptors, "combat", "Game checkpoint state"),
        "Game checkpoint state combat"
      );
      const combatSchemaVersion = checkpointDataField(rawCombat, "schemaVersion", "combat state");
      const expectedSchemaVersion = activeCombat.schemaVersion === 3 ? 2 : 1;
      if (combatSchemaVersion !== expectedSchemaVersion) {
        throw new Error("Game checkpoint combat schema version is invalid.");
      }
      const combat = closed(
        checkpointDataField(descriptors, "combat", "Game checkpoint state"),
        "combat state",
        combatSchemaVersion === 2 ? ["schemaVersion", "shields", "marks"] : ["schemaVersion", "shields"]
      );
      const shields = closed(
        checkpointDataField(combat, "shields", "combat state"),
        "combat shields",
        ["enemies", "towers"]
      );
      const validateShieldRecord = (
        value: unknown,
        label: string,
        expected: ReadonlyMap<string, NonNullable<ActiveCombatShieldDefinitions["enemies"][string]>>
      ) => {
        const record = checkpointObjectDescriptors(value, `Game checkpoint state ${label}`);
        const actualIds = Object.keys(record).sort();
        const expectedIds = [...expected.keys()].sort();
        if (
          actualIds.length !== expectedIds.length
          || actualIds.some((id, index) => id !== expectedIds[index])
        ) {
          throw new Error(`Game checkpoint ${label} has a missing or extra shield target.`);
        }
        for (const id of actualIds) {
          const definition = expected.get(id)!;
          const shield = closed(
            checkpointDataField(record, id, label),
            `${label}.${id}`,
            ["current", "capacity", "regenerationDelayRemaining"]
          );
          const capacity = checkpointDataField(shield, "capacity", label);
          if (capacity !== definition.capacity) {
            throw new Error(`Game checkpoint ${label}.${id} shield capacity differs from authored content.`);
          }
          finite(checkpointDataField(shield, "current", label), `${label}.${id}.current`, 0, definition.capacity);
          finite(
            checkpointDataField(shield, "regenerationDelayRemaining", label),
            `${label}.${id}.regenerationDelayRemaining`,
            0,
            definition.regeneration?.delayAfterDamage ?? 0
          );
        }
      };
      validateShieldRecord(
        checkpointDataField(shields, "enemies", "combat shields"),
        "enemy shields",
        expectedEnemyShields
      );
      validateShieldRecord(
        checkpointDataField(shields, "towers", "combat shields"),
        "tower shields",
        expectedTowerShields
      );

      let markApplicationCount = 0;
      if (combatSchemaVersion === 2) {
        const marks = closed(
          checkpointDataField(combat, "marks", "combat state"),
          "combat marks",
          ["enemies"]
        );
        const markEnemies = checkpointObjectDescriptors(
          checkpointDataField(marks, "enemies", "combat marks"),
          "Game checkpoint state combat mark enemies"
        );
        for (const enemyId of Object.keys(markEnemies)) {
          if (!enemyIds.has(enemyId)) {
            throw new Error(`Game checkpoint combat marks reference unknown enemy "${enemyId}".`);
          }
          const enemyMarkRecord = checkpointObjectDescriptors(
            checkpointDataField(markEnemies, enemyId, "combat mark enemies"),
            `Game checkpoint state combat marks for ${enemyId}`
          );
          const markIds = Object.keys(enemyMarkRecord);
          if (markIds.length === 0) throw new Error("Game checkpoint combat mark enemy record must not be empty.");
          markApplicationCount += markIds.length;
          if (markApplicationCount > MARK_LIMITS.runtimeApplications) {
            throw new Error(`Game checkpoint mark applications exceed the ${MARK_LIMITS.runtimeApplications} limit.`);
          }
          for (const markId of markIds) {
            const definition = activeCombat.marks.definitions[markId];
            if (!definition) throw new Error(`Game checkpoint combat state references unknown mark "${markId}".`);
            const mark = closed(
              checkpointDataField(enemyMarkRecord, markId, `combat marks for ${enemyId}`),
              `combat mark ${enemyId}.${markId}`,
              ["stacks", "remaining"]
            );
            integer(
              checkpointDataField(mark, "stacks", `combat mark ${markId}`),
              `combat mark ${markId}.stacks`,
              1
            );
            const stacks = checkpointDataField(mark, "stacks", `combat mark ${markId}`);
            if (typeof stacks !== "number" || stacks > definition.maxStacks) {
              throw new Error(`Game checkpoint combat mark "${markId}" stacks exceed its definition.`);
            }
            finite(
              checkpointDataField(mark, "remaining", `combat mark ${markId}`),
              `combat mark ${markId}.remaining`,
              Number.MIN_VALUE,
              definition.duration
            );
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
      if (!activeReactions) throw new Error("Game checkpoint reaction state is unexpected for an inactive capability.");
      const reactionState = closed(
        checkpointDataField(descriptors, "reactions", "Game checkpoint state"),
        "reaction state",
        ["schemaVersion", "exposures"]
      );
      if (checkpointDataField(reactionState, "schemaVersion", "reaction state") !== 1) {
        throw new Error("Game checkpoint reaction state version is unsupported.");
      }
      const exposures = closed(
        checkpointDataField(reactionState, "exposures", "reaction state"),
        "reaction exposures",
        ["enemies"]
      );
      const exposureEnemies = checkpointObjectDescriptors(
        checkpointDataField(exposures, "enemies", "reaction exposures"),
        "Game checkpoint reaction exposure enemies"
      );
      const enemyOrder = Object.keys(exposureEnemies);
      if (enemyOrder.length === 0 || enemyOrder.join("\u0000") !== [...enemyOrder].sort().join("\u0000")) {
        throw new Error("Game checkpoint reaction enemy order must be canonical and non-empty.");
      }
      let total = 0;
      for (const enemyId of enemyOrder) {
        if (!enemyIds.has(enemyId)) throw new Error(`Game checkpoint reaction state references unknown enemy "${enemyId}".`);
        const enemyExposureRecord = checkpointObjectDescriptors(
          checkpointDataField(exposureEnemies, enemyId, "reaction exposure enemies"),
          `Game checkpoint reaction exposures for ${enemyId}`
        );
        const exposureOrder = Object.keys(enemyExposureRecord);
        if (exposureOrder.length === 0 || exposureOrder.join("\u0000") !== [...exposureOrder].sort().join("\u0000")) {
          throw new Error("Game checkpoint exposure order must be canonical and non-empty.");
        }
        total += exposureOrder.length;
        if (total > REACTION_LIMITS.runtimeExposureApplications) throw new Error("Game checkpoint reaction exposure budget is exceeded.");
        for (const exposureId of exposureOrder) {
          const definition = activeReactions.exposures.definitions[exposureId];
          if (!definition) throw new Error(`Game checkpoint references unknown exposure "${exposureId}".`);
          const exposure = closed(
            checkpointDataField(enemyExposureRecord, exposureId, `reaction exposures for ${enemyId}`),
            `reaction exposure ${enemyId}.${exposureId}`,
            ["stacks", "remaining"]
          );
          const stacks = integer(checkpointDataField(exposure, "stacks", exposureId), `reaction exposure ${exposureId}.stacks`, 1);
          if (stacks > definition.maxStacks) throw new Error("Game checkpoint reaction exposure stacks exceed definition.");
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
    ] as const) {
      const values = stringArray(state[key], key, true);
      if (values.some((value, index) => index > 0 && values[index - 1]! > value)) {
        throw new Error(`Game checkpoint state ${key} is not in canonical order.`);
      }
      for (const value of values) {
        if (!allowed.has(value)) throw new Error(`Game checkpoint state ${key} references an unauthored objective or star.`);
      }
    }
    const validateScriptJson = (value: unknown, label: string, depth = 0): void => {
      if (depth > 128) throw new Error(`Game checkpoint state ${label} exceeds the script JSON depth limit.`);
      if (value === null || typeof value === "string" || typeof value === "boolean") return;
      if (typeof value === "number") {
        finite(value, label, -Infinity);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of array(value, label)) validateScriptJson(item, label, depth + 1);
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
    if (
      authoredScriptIds.length !== stateScriptIds.length ||
      authoredScriptIds.some((scriptId, index) => scriptId !== stateScriptIds[index])
    ) throw new Error("Game checkpoint script values do not match authored scripts.");
    for (const scriptId of stateScriptIds) {
      if (!own(content.scripts, scriptId)) throw new Error("Game checkpoint script values reference an unknown script.");
      const bindings = checkpointObjectDescriptors(
        checkpointDataField(scriptValueRoot, scriptId, "scriptValues"),
        `Game checkpoint script values for ${scriptId}`
      );
      for (const bindingKey of Object.keys(bindings)) {
        const bindingState = checkpointDataField(bindings, bindingKey, `script ${scriptId}`);
        const values = checkpointObjectDescriptors(
          bindingState,
          `Game checkpoint script binding ${scriptId}:${bindingKey}`
        );
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

    const allowedTimerKeys = new Set<string>();
    for (const scriptId of authoredScriptIds) {
      const script = content.scripts[scriptId];
      if (!script) continue;
      const bindingStates = checkpointObjectDescriptors(
        checkpointDataField(scriptValueRoot, scriptId, "scriptValues"),
        `Game checkpoint script values for ${scriptId}`
      );
      const timedHandlers = (script.handlers.tick ?? [])
        .map((handler, index) => ({ handler, handlerId: handler.id ?? String(index) }))
        .filter(({ handler }) => typeof handler.every === "number");
      for (const bindingKey of Object.keys(bindingStates)) {
        for (const { handlerId } of timedHandlers) allowedTimerKeys.add(`${script.id}:${bindingKey}:${handlerId}`);
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
    const scriptEvents = new Set<string>(TOWER_SCRIPT_EVENTS);
    const validateDiagnostic = (value: unknown, label: string): void => {
      const diagnostic = closed(value, label, ["scriptId", "event", "code", "message"], ["handlerId"]);
      const scriptId = stringValue(checkpointDataField(diagnostic, "scriptId", label), `${label}.scriptId`);
      if (scriptId !== "runtime" && !own(content.scripts, scriptId)) throw new Error("Game checkpoint diagnostic references an unknown script.");
      const event = stringValue(checkpointDataField(diagnostic, "event", label), `${label}.event`);
      const code = stringValue(checkpointDataField(diagnostic, "code", label), `${label}.code`);
      stringValue(checkpointDataField(diagnostic, "message", label), `${label}.message`);
      if (!scriptEvents.has(event) || !diagnosticCodes.has(code)) throw new Error("Game checkpoint script diagnostic is invalid.");
      if (own(diagnostic, "handlerId")) stringValue(checkpointDataField(diagnostic, "handlerId", label), `${label}.handlerId`);
    };
    const diagnostics = array(state.scriptDiagnostics, "scriptDiagnostics");
    if (diagnostics.length > TOWER_SCRIPT_LIMITS.retainedDiagnostics) {
      throw new Error("Game checkpoint retained script diagnostic limit is exceeded.");
    }
    for (const diagnostic of diagnostics) {
      validateDiagnostic(diagnostic, "script diagnostic");
    }

    const eventSchemas: Record<string, { required: readonly string[]; optional?: readonly string[] }> = {
      towerPlaced: { required: ["type", "towerId", "towerTypeId", "coord", "terrain", "terrainMetadata"] },
      towerSold: { required: ["type", "towerId", "towerTypeId", "refund"] },
      towerMoved: { required: ["type", "towerId", "from", "to", "cost"] },
      towerUpgraded: { required: ["type", "towerId", "level", "stacks"], optional: ["branchId", "baseTypeId", "typeId"] },
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
      weatherStarted: {
        required: ["type", "profileId", "waveIndex", "choiceId", "weatherId", "zoneId"]
      },
      weatherEnded: {
        required: ["type", "profileId", "waveIndex", "choiceId", "weatherId", "zoneId", "reason"]
      },
      weatherEffectApplied: {
        required: [
          "type", "profileId", "waveIndex", "choiceId", "weatherId", "zoneId", "effectId",
          "kind", "applicationOrdinal", "affectedCount"
        ]
      },
      weatherBudgetExceeded: { required: ["type", "profileId", "waveIndex", "limit"] },
      directorDecision: { required: ["type", "waveIndex", "counterId", "threatCost", "reason", "addedGroups"] },
      waveCleared: { required: ["type", "waveIndex", "income", "interest"] },
      questCompleted: { required: ["type", "questId", "kind"] },
      questFailed: { required: ["type", "questId", "kind"] },
      resourcesGranted: { required: ["type", "source", "waveIndex", "resources"] },
      objectiveCompleted: { required: ["type", "objectiveId", "kind"] },
      objectiveFailed: { required: ["type", "objectiveId", "kind"] },
      starEarned: { required: ["type", "starId"] },
      towerFired: { required: ["type", "towerId", "enemyId", "damage"] },
      enemyHit: { required: ["type", "towerId", "enemyId", "enemyTypeId", "damage"] },
      destructibleObjectDamaged: {
        required: [
          "type", "projectileId", "objectId", "definitionId", "coord", "fromHp", "toHp", "damage"
        ]
      },
      destructibleObjectDestroyed: {
        required: ["type", "projectileId", "objectId", "definitionId", "coord"]
      },
      enemyShieldChanged: {
        required: ["type", "enemyId", "enemyTypeId", "previous", "current", "capacity", "cause", "amount"],
        optional: ["overflowDamage"]
      },
      bossComponentDamaged: {
        required: [
          "type", "enemyId", "enemyTypeId", "componentId", "sourceKind", "previousHp", "currentHp",
          "maxHp", "hpDamage", "previousShield", "currentShield", "shieldCapacity", "shieldAbsorbed"
        ]
      },
      bossComponentDestroyed: {
        required: [
          "type", "enemyId", "enemyTypeId", "componentId", "sourceKind", "previousHp", "currentHp",
          "maxHp", "hpDamage", "previousShield", "currentShield", "shieldCapacity", "shieldAbsorbed"
        ]
      },
      vanguardDamageIntercepted: {
        required: [
          "type", "cohortId", "protectedEnemyId", "protectedEnemyTypeId", "vanguardEnemyId",
          "vanguardEnemyTypeId", "sourceKind", "requestedAmount", "originalComponentId"
        ]
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
      stateMachineTransitioned: {
        required: [
          "type", "scriptId", "machineId", "contextId", "transitionId", "fromStatePath", "toStatePath"
        ]
      },
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
      "cooldownApplied", "requestedDamage", "resolvedDamage", "cost", "previousPoints", "currentPoints",
      "threatCost", "previousHp", "currentHp", "maxHp", "previousShield", "currentShield", "shieldCapacity",
      "requestedAmount", "fromHp", "toHp", "applicationOrdinal", "affectedCount"
    ]);
    const stringEventFields = new Set([
      "towerId", "towerTypeId", "enemyId", "enemyTypeId", "parentEnemyId", "parentEnemyTypeId", "healerEnemyId",
      "targetEnemyId", "targetEnemyTypeId", "source", "objectiveId", "kind", "starId", "abilityId", "terrain",
      "fromTerrain", "toTerrain", "scriptId", "signal", "routeId", "mode", "cause", "markId",
      "exposureId", "reactionId", "originEnemyId", "originEnemyTypeId", "rootEnemyId", "rootEnemyTypeId",
      "triggerDamageType", "budget", "sourceKind", "sourceId", "stopReason", "terrainTag",
      "artifactInstanceId", "artifactId", "slotId", "heroId", "heroDefinitionId", "skillId",
      "counterId", "questId", "machineId", "contextId", "transitionId", "fromStatePath", "toStatePath",
      "componentId", "cohortId", "protectedEnemyId", "protectedEnemyTypeId", "vanguardEnemyId",
      "vanguardEnemyTypeId", "projectileId", "objectId", "definitionId", "profileId", "choiceId",
      "weatherId", "zoneId", "effectId", "reason"
    ]);
    const coordEventFields = new Set(["coord", "from", "to", "center", "originCoord", "sourceCoord"]);
    const bagEventFields = new Set(["refund", "cost", "resources", "income", "interest"]);
    const stringArrayEventFields = new Set(["towerIds", "enemyIds", "scheduledTargetIds"]);
    let retainedHeroAbilityState: Readonly<{
      currentMana: number;
      cooldownApplied: number;
      manaMaximum: number;
      cooldownMaximum: number;
    }> | undefined;
    let retainedHeroSkillPointState: {
      currentPoints: number;
      unlockedSkillIds: string[];
    } | undefined;
    const checkpointTransitionEvents: Array<{
      index: number;
      scriptId: string;
      machineId: string;
      contextId: string;
      transitionId: string;
      fromStatePath: string;
      toStatePath: string;
    }> = [];
    const checkpointEvents = array(state.lastEvents, "lastEvents");
    let checkpointVanguardInterceptionEventCount = 0;
    for (const [eventIndex, value] of checkpointEvents.entries()) {
      const base = checkpointObjectDescriptors(value, "Game checkpoint last event");
      const type = stringValue(checkpointDataField(base, "type", "last event"), "last event type");
      const schema = eventSchemas[type];
      if (!schema) throw new Error(`Game checkpoint state last event type "${type}" is invalid.`);
      const event = closed(value, `last event ${type}`, schema.required, schema.optional ?? []);
      for (const key of Object.keys(event)) {
        if (key === "type") continue;
        const field = checkpointDataField(event, key, `last event ${type}`);
        if (numericEventFields.has(key)) finite(
          field,
          `last event ${type}.${key}`,
          key === "fromElevation" || key === "toElevation" ? -Infinity : 0
        );
        else if (stringEventFields.has(key)) stringValue(field, `last event ${type}.${key}`);
        else if (coordEventFields.has(key)) validCoord(field, `last event ${type}.${key}`);
        else if (bagEventFields.has(key)) recordNumbers(field, `last event ${type}.${key}`, currencyIds);
        else if (stringArrayEventFields.has(key)) stringArray(field, `last event ${type}.${key}`);
        else if (key === "coords") for (const coord of array(field, `last event ${type}.coords`)) validCoord(coord, `last event ${type}.coords`);
        else if (key === "terrainMetadata") {
          const terrain = closed(field, "event terrain metadata", ["id", "label", "buildable", "walkable", "groundSpeedMultiplier", "tags"]);
          stringValue(checkpointDataField(terrain, "id", "terrain metadata"), "terrain metadata id");
          stringValue(checkpointDataField(terrain, "label", "terrain metadata"), "terrain metadata label");
          if (typeof checkpointDataField(terrain, "buildable", "terrain metadata") !== "boolean" || typeof checkpointDataField(terrain, "walkable", "terrain metadata") !== "boolean") {
            throw new Error("Game checkpoint event terrain metadata booleans are invalid.");
          }
          finite(checkpointDataField(terrain, "groundSpeedMultiplier", "terrain metadata"), "terrain speed");
          stringArray(checkpointDataField(terrain, "tags", "terrain metadata"), "terrain tags");
        } else if (key === "diagnostic") validateDiagnostic(field, "event script diagnostic");
        else if (key === "payload") validateScriptJson(field, `last event ${type}.${key}`);
        else if (key === "originalComponentId") {
          if (field !== null) stringValue(field, `last event ${type}.${key}`);
        }
        else if (key === "reason") validateDirectorReason(
          field,
          `last event ${type}.reason`,
          stringValue(checkpointDataField(event, "counterId", `last event ${type}`), `last event ${type}.counterId`)
        );
        else if (key === "addedGroups") validateDirectorGroups(field, `last event ${type}.addedGroups`, stringValue(
          checkpointDataField(event, "counterId", `last event ${type}`),
          `last event ${type}.counterId`
        ));
        else if (key === "effects") {
          for (const effectValue of array(field, `last event ${type}.effects`)) {
            const effectBase = checkpointObjectDescriptors(effectValue, "Game checkpoint ability event effect");
            const kind = stringValue(checkpointDataField(effectBase, "kind", "ability event effect"), "ability event effect kind");
            if (kind === "damage") {
              const effect = closed(effectValue, "ability damage effect", ["kind", "amount"]);
              finite(checkpointDataField(effect, "amount", "ability damage effect"), "ability damage amount");
            } else if (kind === "status") {
              const effect = closed(effectValue, "ability status effect", ["kind", "status"]);
              const status = closed(
                checkpointDataField(effect, "status", "ability status effect"),
                "ability status spec",
                [],
                ["stun", "slow", "poison", "slowAffectsClasses"]
              );
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
                if (classes.some((item) => item !== "ground" && item !== "flying")) throw new Error("Game checkpoint ability slow class is invalid.");
              }
            } else if (kind === "displacement") {
              const effect = closed(
                effectValue,
                "ability displacement effect",
                ["kind", "mode", "distance", "stopAtBlocker"]
              );
              const mode = stringValue(
                checkpointDataField(effect, "mode", "ability displacement effect"),
                "ability displacement mode"
              );
              const distance = checkpointDataField(effect, "distance", "ability displacement effect");
              const stopAtBlocker = checkpointDataField(effect, "stopAtBlocker", "ability displacement effect");
              if (mode !== "push" && mode !== "pull") throw new Error("Game checkpoint ability displacement mode is invalid.");
              if (!Number.isSafeInteger(distance) || (distance as number) < 1 || (distance as number) > 8) {
                throw new Error("Game checkpoint ability displacement distance is invalid.");
              }
              if (typeof stopAtBlocker !== "boolean") throw new Error("Game checkpoint ability displacement stopAtBlocker is invalid.");
            } else {
              throw new Error("Game checkpoint ability event effect kind is invalid.");
            }
          }
        }
      }
      for (const key of ["enemyTypeId", "parentEnemyTypeId", "targetEnemyTypeId"] as const) {
        if (!own(event, key)) continue;
        const typeId = stringValue(checkpointDataField(event, key, type), `${type}.${key}`);
        if (!own(content.enemies, typeId)) throw new Error("Game checkpoint event references an unknown enemy type.");
      }
      if (type === "questCompleted" || type === "questFailed") {
        const questId = stringValue(checkpointDataField(event, "questId", type), `${type}.questId`);
        const kind = stringValue(checkpointDataField(event, "kind", type), `${type}.kind`);
        const selected = checkpointQuestEntries.get(questId);
        const expectedStatus = type === "questCompleted" ? "completed" : "failed";
        if (!checkpointQuests || !selected || selected.kind !== kind || selected.status !== expectedStatus) {
          throw new Error(`Game checkpoint ${type} event does not match active quest state.`);
        }
      }
      if (type === "stateMachineTransitioned") {
        checkpointTransitionEvents.push({
          index: eventIndex,
          scriptId: stringValue(checkpointDataField(event, "scriptId", type), `${type}.scriptId`),
          machineId: stringValue(checkpointDataField(event, "machineId", type), `${type}.machineId`),
          contextId: stringValue(checkpointDataField(event, "contextId", type), `${type}.contextId`),
          transitionId: stringValue(checkpointDataField(event, "transitionId", type), `${type}.transitionId`),
          fromStatePath: stringValue(checkpointDataField(event, "fromStatePath", type), `${type}.fromStatePath`),
          toStatePath: stringValue(checkpointDataField(event, "toStatePath", type), `${type}.toStatePath`)
        });
      }
      if (type === "bossComponentDamaged" || type === "bossComponentDestroyed") {
        if (!checkpointEnemyBehaviors) {
          throw new Error("Game checkpoint boss component event requires active enemyBehaviors.");
        }
        const enemyTypeId = stringValue(checkpointDataField(event, "enemyTypeId", type), `${type}.enemyTypeId`);
        const componentId = stringValue(checkpointDataField(event, "componentId", type), `${type}.componentId`);
        const definition = checkpointEnemyBehaviors.bosses?.[enemyTypeId]?.components[componentId];
        if (!definition) throw new Error("Game checkpoint boss component event references an unknown component.");
        const sourceKind = checkpointDataField(event, "sourceKind", type);
        if (!["tower", "ability", "tower_script", "status", "reaction", "enemy", "leak"].includes(String(sourceKind))) {
          throw new Error("Game checkpoint boss component event sourceKind is invalid.");
        }
        const expectedMaxHp = definition.maxHp * (difficulty.enemyHpMultiplier ?? 1);
        const maxHp = finite(checkpointDataField(event, "maxHp", type), `${type}.maxHp`, Number.MIN_VALUE, expectedMaxHp);
        const previousHp = finite(checkpointDataField(event, "previousHp", type), `${type}.previousHp`, 0, expectedMaxHp);
        const currentHp = finite(checkpointDataField(event, "currentHp", type), `${type}.currentHp`, 0, expectedMaxHp);
        const hpDamage = finite(checkpointDataField(event, "hpDamage", type), `${type}.hpDamage`, 0, expectedMaxHp);
        const expectedShieldCapacity = definition.shield?.capacity ?? 0;
        const shieldCapacity = finite(
          checkpointDataField(event, "shieldCapacity", type),
          `${type}.shieldCapacity`,
          0,
          expectedShieldCapacity
        );
        const previousShield = finite(
          checkpointDataField(event, "previousShield", type),
          `${type}.previousShield`,
          0,
          expectedShieldCapacity
        );
        const currentShield = finite(
          checkpointDataField(event, "currentShield", type),
          `${type}.currentShield`,
          0,
          expectedShieldCapacity
        );
        const componentShieldAbsorbed = finite(
          checkpointDataField(event, "shieldAbsorbed", type),
          `${type}.shieldAbsorbed`,
          0,
          expectedShieldCapacity
        );
        const nearlyEqual = (left: number, right: number): boolean => (
          Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
        );
        if (maxHp !== expectedMaxHp || shieldCapacity !== expectedShieldCapacity
          || currentHp > previousHp || currentShield > previousShield
          || !nearlyEqual(previousHp - currentHp, hpDamage)
          || !nearlyEqual(previousShield - currentShield, componentShieldAbsorbed)
          || (hpDamage <= 0 && componentShieldAbsorbed <= 0)) {
          throw new Error("Game checkpoint boss component event arithmetic is invalid.");
        }
        if (type === "bossComponentDestroyed" && !(previousHp > 0 && currentHp === 0)) {
          throw new Error("Game checkpoint boss component destruction event crossing is invalid.");
        }
      }
      if (type === "vanguardDamageIntercepted") {
        const cohortId = stringValue(checkpointDataField(event, "cohortId", type), `${type}.cohortId`);
        const authored = checkpointFormationProtection[cohortId];
        if (!authored) throw new Error("Game checkpoint vanguard interception event references inactive protection.");
        const protectedEnemyTypeId = stringValue(
          checkpointDataField(event, "protectedEnemyTypeId", type),
          `${type}.protectedEnemyTypeId`
        );
        const vanguardEnemyTypeId = stringValue(
          checkpointDataField(event, "vanguardEnemyTypeId", type),
          `${type}.vanguardEnemyTypeId`
        );
        const protectedAssignment = checkpointFormationAssignments?.get(protectedEnemyTypeId);
        const vanguardAssignment = checkpointFormationAssignments?.get(vanguardEnemyTypeId);
        if (
          protectedAssignment?.cohortId !== cohortId
          || (protectedAssignment.role !== "body" && protectedAssignment.role !== "support")
          || vanguardAssignment?.cohortId !== cohortId
          || vanguardAssignment.role !== "vanguard"
        ) {
          throw new Error("Game checkpoint vanguard interception event has invalid formation roles.");
        }
        const sourceKind = stringValue(checkpointDataField(event, "sourceKind", type), `${type}.sourceKind`);
        if (!authored.sourceKinds.includes(sourceKind as VanguardProtectionSourceKindV1)) {
          throw new Error("Game checkpoint vanguard interception event source is not authored.");
        }
        const originalComponentId = checkpointDataField(event, "originalComponentId", type);
        if (
          originalComponentId !== null
          && !checkpointEnemyBehaviors?.bosses?.[protectedEnemyTypeId]?.components[String(originalComponentId)]
        ) {
          throw new Error("Game checkpoint vanguard interception event references an unknown original component.");
        }
        checkpointVanguardInterceptionEventCount += 1;
      }
      if (own(event, "towerTypeId")) {
        const typeId = stringValue(checkpointDataField(event, "towerTypeId", type), `${type}.towerTypeId`);
        if (!own(content.towers, typeId)) throw new Error("Game checkpoint event references an unknown tower type.");
      }
      if (own(event, "abilityId") && type !== "heroAbilityUsed") {
        const abilityId = stringValue(checkpointDataField(event, "abilityId", type), `${type}.abilityId`);
        if (!abilityIds.has(abilityId)) throw new Error("Game checkpoint event references an unknown ability.");
      }
      if (type === "scriptSignal") {
        const scriptId = stringValue(checkpointDataField(event, "scriptId", type), "script signal scriptId");
        if (scriptId !== "external" && !own(content.scripts, scriptId)) throw new Error("Game checkpoint event references an unknown script.");
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
        if (
          !Number.isSafeInteger(fromElevation) || !Number.isSafeInteger(toElevation)
          || (fromElevation as number) < TERRAFORMING_LIMITS.elevationMinimum
          || (fromElevation as number) > TERRAFORMING_LIMITS.elevationMaximum
          || (toElevation as number) < TERRAFORMING_LIMITS.elevationMinimum
          || (toElevation as number) > TERRAFORMING_LIMITS.elevationMaximum
        ) {
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
        if (mode !== "push" && mode !== "pull") throw new Error("Game checkpoint displacement event mode is invalid.");
        if (typeof reason !== "string" || !reasons.has(reason)) throw new Error("Game checkpoint displacement stop reason is invalid.");
        if (!Number.isSafeInteger(requested) || (requested as number) < 1 || (requested as number) > 8
          || !Number.isSafeInteger(moved) || (moved as number) < 0 || (moved as number) > (requested as number)) {
          throw new Error("Game checkpoint displacement event distance is invalid.");
        }
      }
      if (type === "heroShieldChanged" || type === "heroAttacked" || type === "heroDefeated") {
        if (checkpointHeroes?.schemaVersion !== 3 && checkpointHeroes?.schemaVersion !== 4
          && checkpointHeroes?.schemaVersion !== 5 && checkpointHeroes?.schemaVersion !== 6
          && checkpointHeroes?.schemaVersion !== 7) {
          throw new Error("Game checkpoint hero event requires active hero durability.");
        }
        const selectedHeroId = checkpointHeroes.selectedHeroId;
        const durableDefinition = checkpointHeroes.definitions[selectedHeroId]!.durability;
        const heroId = stringValue(checkpointDataField(event, "heroId", type), `${type}.heroId`);
        if (heroId !== selectedHeroId) {
          throw new Error("Game checkpoint hero event references an unavailable hero.");
        }
        const nearlyEqual = (left: number, right: number): boolean => (
          Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
        );
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
        } else if (type === "heroAttacked") {
          const damage = finite(checkpointDataField(event, "damage", type), `${type}.damage`, 0);
          const shieldAbsorbed = finite(
            checkpointDataField(event, "shieldAbsorbed", type),
            `${type}.shieldAbsorbed`,
            0
          );
          const hpDamage = finite(checkpointDataField(event, "hpDamage", type), `${type}.hpDamage`, 0);
          const authoredShieldCapacity = durableDefinition.shield?.capacity ?? 0;
          if (damage <= 0 || shieldAbsorbed > authoredShieldCapacity
            || !nearlyEqual(damage, shieldAbsorbed + hpDamage)) {
            throw new Error("Game checkpoint hero attack damage decomposition is invalid.");
          }
        } else {
          const definitionId = stringValue(
            checkpointDataField(event, "heroDefinitionId", type),
            `${type}.heroDefinitionId`
          );
          if (definitionId !== selectedHeroId) {
            throw new Error("Game checkpoint hero defeat event references an unavailable definition.");
          }
          const heroesState = closed(
            checkpointDataField(descriptors, "heroes", "Game checkpoint state"),
            "heroes",
            ["schemaVersion", "unit"]
          );
          const skillTree = checkpointHeroes.schemaVersion === 5 || checkpointHeroes.schemaVersion === 6
            || checkpointHeroes.schemaVersion === 7
            ? checkpointHeroes.definitions[selectedHeroId]!.skillTree
            : null;
          const expectedDurabilityCheckpointVersion = (checkpointHeroes.schemaVersion === 5
            || checkpointHeroes.schemaVersion === 6 || checkpointHeroes.schemaVersion === 7) && skillTree !== null
            ? 4
            : checkpointHeroes.schemaVersion === 4 || checkpointHeroes.schemaVersion === 5
              || checkpointHeroes.schemaVersion === 6 || checkpointHeroes.schemaVersion === 7 ? 3 : 2;
          if (checkpointDataField(heroesState, "schemaVersion", "heroes") !== expectedDurabilityCheckpointVersion) {
            throw new Error("Game checkpoint hero defeat event requires durable hero state.");
          }
          const heroUnit = closed(
            checkpointDataField(heroesState, "unit", "heroes"),
            "hero unit",
            (checkpointHeroes.schemaVersion === 5 || checkpointHeroes.schemaVersion === 6
              || checkpointHeroes.schemaVersion === 7) && skillTree !== null
              ? [
                  "definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent",
                  "mana", "abilityCooldownRemaining", "skillPoints", "unlockedSkillIds"
                ]
              : checkpointHeroes.schemaVersion === 4 || checkpointHeroes.schemaVersion === 5
                || checkpointHeroes.schemaVersion === 6 || checkpointHeroes.schemaVersion === 7
              ? [
                  "definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent",
                  "mana", "abilityCooldownRemaining"
                ]
              : ["definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent"]
          );
          const currentHp = finite(
            checkpointDataField(heroUnit, "hp", "hero unit"),
            "hero hp",
            0,
            durableDefinition.maxHp
          );
          if (currentHp !== 0) {
            throw new Error("Game checkpoint hero defeat event requires zero hero HP.");
          }
        }
      }
      if (type === "heroAbilityUsed") {
        if (checkpointHeroes?.schemaVersion !== 4 && checkpointHeroes?.schemaVersion !== 5
          && checkpointHeroes?.schemaVersion !== 6 && checkpointHeroes?.schemaVersion !== 7) {
          throw new Error("Game checkpoint hero ability event requires active hero abilities.");
        }
        const selectedHeroId = checkpointHeroes.selectedHeroId;
        const definition = checkpointHeroes.definitions[selectedHeroId]!;
        const heroId = stringValue(checkpointDataField(event, "heroId", type), `${type}.heroId`);
        const definitionId = stringValue(
          checkpointDataField(event, "heroDefinitionId", type),
          `${type}.heroDefinitionId`
        );
        const abilityId = stringValue(checkpointDataField(event, "abilityId", type), `${type}.abilityId`);
        const targetEnemyId = stringValue(
          checkpointDataField(event, "targetEnemyId", type),
          `${type}.targetEnemyId`
        );
        const targetEnemyTypeId = stringValue(
          checkpointDataField(event, "targetEnemyTypeId", type),
          `${type}.targetEnemyTypeId`
        );
        const targetEnemyState = state.enemies.find((enemy) => enemy.id === targetEnemyId);
        if (heroId !== selectedHeroId || definitionId !== selectedHeroId || abilityId !== definition.activeAbility.id
          || !targetEnemyState || targetEnemyState.typeId !== targetEnemyTypeId || !own(content.enemies, targetEnemyTypeId)) {
          throw new Error("Game checkpoint hero ability event references unavailable authored state.");
        }
        const previousMana = finite(checkpointDataField(event, "previousMana", type), `${type}.previousMana`, 0, definition.mana.max);
        const currentMana = finite(checkpointDataField(event, "currentMana", type), `${type}.currentMana`, 0, definition.mana.max);
        const manaSpent = finite(checkpointDataField(event, "manaSpent", type), `${type}.manaSpent`, 0, definition.mana.max);
        const cooldownApplied = finite(
          checkpointDataField(event, "cooldownApplied", type),
          `${type}.cooldownApplied`,
          0,
          definition.activeAbility.cooldown
        );
        const requestedDamage = finite(checkpointDataField(event, "requestedDamage", type), `${type}.requestedDamage`, 0);
        const resolvedDamage = finite(checkpointDataField(event, "resolvedDamage", type), `${type}.resolvedDamage`, 0);
        const shieldAbsorbed = finite(checkpointDataField(event, "shieldAbsorbed", type), `${type}.shieldAbsorbed`, 0);
        const hpDamage = finite(checkpointDataField(event, "hpDamage", type), `${type}.hpDamage`, 0);
        const nearlyEqual = (left: number, right: number): boolean => (
          Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
        );
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
        if (checkpointHeroes?.schemaVersion !== 5 && checkpointHeroes?.schemaVersion !== 6
          && checkpointHeroes?.schemaVersion !== 7) {
          throw new Error("Game checkpoint hero skill event requires active heroes v5.");
        }
        const selectedHeroId = checkpointHeroes.selectedHeroId;
        const tree = checkpointHeroes.definitions[selectedHeroId]!.skillTree;
        const heroId = stringValue(checkpointDataField(event, "heroId", type), `${type}.heroId`);
        const definitionId = stringValue(
          checkpointDataField(event, "heroDefinitionId", type),
          `${type}.heroDefinitionId`
        );
        const previousPoints = integer(
          checkpointDataField(event, "previousPoints", type),
          `${type}.previousPoints`
        );
        const currentPoints = integer(
          checkpointDataField(event, "currentPoints", type),
          `${type}.currentPoints`
        );
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
          if (!tree.nodes[skillId] || tree.nodes[skillId]!.cost !== cost || previousPoints - cost !== currentPoints) {
            throw new Error("Game checkpoint hero skill unlock event arithmetic is invalid.");
          }
          if (unlockedSkillIds.includes(skillId)) {
            throw new Error("Game checkpoint retained hero skill event chain contains a duplicate unlock.");
          }
          unlockedSkillIds.push(skillId);
        } else {
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
        const markDefinitions = (
          activeCombatMechanics as unknown as {
            marks?: { definitions?: Readonly<Record<string, { maxStacks: number; duration: number }>> };
          } | undefined
        )?.marks?.definitions;
        const markDefinition = markDefinitions && Object.prototype.hasOwnProperty.call(markDefinitions, markId)
          ? markDefinitions[markId]
          : undefined;
        if (!markDefinition) throw new Error("Game checkpoint mark event references an unknown mark.");
        const previousStacks = integer(
          checkpointDataField(event, "previousStacks", type),
          `${type}.previousStacks`,
          0
        );
        const currentStacks = integer(
          checkpointDataField(event, "currentStacks", type),
          `${type}.currentStacks`,
          0
        );
        if (previousStacks > markDefinition.maxStacks || currentStacks > markDefinition.maxStacks) {
          throw new Error("Game checkpoint mark event stacks exceed the mark definition.");
        }
        const previousRemaining = finite(
          checkpointDataField(event, "previousRemaining", type),
          `${type}.previousRemaining`,
          0
        );
        const remaining = finite(
          checkpointDataField(event, "remaining", type),
          `${type}.remaining`,
          0
        );
        if (previousRemaining > markDefinition.duration || remaining > markDefinition.duration) {
          throw new Error("Game checkpoint mark event remaining duration exceeds the mark definition.");
        }
      }
      if (type === "enemyExposureChanged") {
        if (!activeReactions) throw new Error("Game checkpoint exposure event requires active reactions.");
        const exposureId = stringValue(checkpointDataField(event, "exposureId", type), `${type}.exposureId`);
        const definition = activeReactions.exposures.definitions[exposureId];
        if (!definition) throw new Error("Game checkpoint exposure event references an unknown exposure.");
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
        if (!activeReactions) throw new Error("Game checkpoint reaction event requires active reactions.");
        const reactionId = stringValue(checkpointDataField(event, "reactionId", type), `${type}.reactionId`);
        if (!activeReactions.reactions[reactionId]) {
          throw new Error("Game checkpoint reaction event references an unknown reaction.");
        }
        const triggerDamageType = stringValue(
          checkpointDataField(event, "triggerDamageType", type),
          `${type}.triggerDamageType`
        );
        if (!activeCombat?.damageTypes[triggerDamageType]) {
          throw new Error("Game checkpoint reaction event references an unknown trigger damage type.");
        }
        integer(checkpointDataField(event, "depth", type), `${type}.depth`);
        if ((checkpointDataField(event, "depth", type) as number) > REACTION_LIMITS.maxDepth) {
          throw new Error("Game checkpoint reaction event depth exceeds the runtime budget.");
        }
        const scheduledTargetIds = stringArray(
          checkpointDataField(event, "scheduledTargetIds", type),
          `${type}.scheduledTargetIds`,
          true
        );
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
        const artifactId = stringValue(
          checkpointDataField(event, "artifactId", type),
          `${type}.artifactId`
        );
        const instanceId = stringValue(
          checkpointDataField(event, "artifactInstanceId", type),
          `${type}.artifactInstanceId`
        );
        const enemyTypeId = stringValue(
          checkpointDataField(event, "enemyTypeId", type),
          `${type}.enemyTypeId`
        );
        const rollIndex = integer(checkpointDataField(event, "rollIndex", type), `${type}.rollIndex`);
        const table = checkpointRoguelite.artifacts.bossLootTables[enemyTypeId];
        if (!checkpointRoguelite.artifacts.definitions[artifactId]
          || !table
          || !table.entries.some((entry) => entry.artifactId === artifactId)
          || rollIndex >= table.rolls
          || !state.artifacts.inventory.some((entry) => (
            entry.instanceId === instanceId && entry.artifactId === artifactId
          ))) {
          throw new Error("Game checkpoint artifact drop event is inconsistent with authored loot or inventory.");
        }
      }
      if (type === "artifactSocketed" || type === "artifactUnsocketed") {
        if (!checkpointRoguelite?.artifacts || state.artifacts?.schemaVersion !== 2) {
          throw new Error("Game checkpoint artifact socket event requires artifact checkpoint v2.");
        }
        const artifactId = stringValue(checkpointDataField(event, "artifactId", type), `${type}.artifactId`);
        const instanceId = stringValue(
          checkpointDataField(event, "artifactInstanceId", type),
          `${type}.artifactInstanceId`
        );
        const towerTypeId = stringValue(checkpointDataField(event, "towerTypeId", type), `${type}.towerTypeId`);
        const towerId = stringValue(checkpointDataField(event, "towerId", type), `${type}.towerId`);
        const slotId = stringValue(checkpointDataField(event, "slotId", type), `${type}.slotId`);
        const towerIdMatch = /^tower_([1-9]\d*)$/.exec(towerId);
        const towerNumericId = towerIdMatch ? Number(towerIdMatch[1]) : Number.NaN;
        const currentTower = towerStateById.get(towerId);
        const definition = checkpointRoguelite.artifacts.definitions[artifactId];
        const slot = checkpointRoguelite.artifacts.towerSlots[towerTypeId]
          ?.find((candidate) => candidate.slotId === slotId);
        if (
          !towerIdMatch
          || !Number.isSafeInteger(towerNumericId)
          || towerNumericId > towerCounter
          || (currentTower !== undefined && currentTower.typeId !== towerTypeId)
          || !own(content.towers, towerTypeId)
          ||
          !definition
          || !slot
          || definition.slotType !== slot.slotType
          || !state.artifacts.inventory.some((entry) => (
            entry.instanceId === instanceId && entry.artifactId === artifactId
          ))
        ) {
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
      const heroesState = closed(
        checkpointDataField(descriptors, "heroes", "Game checkpoint state"),
        "heroes",
        ["schemaVersion", "unit"]
      );
      const retainedHeroesVersion = checkpointDataField(heroesState, "schemaVersion", "heroes");
      if (retainedHeroesVersion !== 3 && retainedHeroesVersion !== 4) {
        throw new Error("Game checkpoint hero ability event requires hero ability state.");
      }
      const heroUnit = closed(
        checkpointDataField(heroesState, "unit", "heroes"),
        "hero unit",
        [
          "definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent",
          "mana", "abilityCooldownRemaining",
          ...(retainedHeroesVersion === 4 ? ["skillPoints", "unlockedSkillIds"] : [])
        ]
      );
      const authoritativeMana = finite(
        checkpointDataField(heroUnit, "mana", "hero unit"),
        "hero mana",
        0,
        retainedHeroAbilityState.manaMaximum
      );
      const authoritativeCooldown = finite(
        checkpointDataField(heroUnit, "abilityCooldownRemaining", "hero unit"),
        "hero ability cooldown",
        0,
        retainedHeroAbilityState.cooldownMaximum
      );
      const nearlyEqual = (left: number, right: number): boolean => (
        Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
      );
      if (!nearlyEqual(retainedHeroAbilityState.currentMana, authoritativeMana)
        || !nearlyEqual(retainedHeroAbilityState.cooldownApplied, authoritativeCooldown)) {
        throw new Error("Game checkpoint hero ability event does not match authoritative mana or cooldown state.");
      }
    }
    if (retainedHeroSkillPointState) {
      const heroesState = closed(
        checkpointDataField(descriptors, "heroes", "Game checkpoint state"),
        "heroes",
        ["schemaVersion", "unit"]
      );
      if (checkpointDataField(heroesState, "schemaVersion", "heroes") !== 4) {
        throw new Error("Game checkpoint hero skill events require nested heroes state v4.");
      }
      const heroUnit = closed(
        checkpointDataField(heroesState, "unit", "heroes"),
        "hero unit",
        [
          "definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent",
          "mana", "abilityCooldownRemaining", "skillPoints", "unlockedSkillIds"
        ]
      );
      const authoritativePoints = integer(
        checkpointDataField(heroUnit, "skillPoints", "hero unit"),
        "hero authoritative skill points"
      );
      const authoritativeUnlockedSkillIds = stringArray(
        checkpointDataField(heroUnit, "unlockedSkillIds", "hero unit"),
        "hero authoritative unlocked skill ids",
        true
      );
      const tree = checkpointHeroes?.schemaVersion === 5 || checkpointHeroes?.schemaVersion === 6
        || checkpointHeroes?.schemaVersion === 7
        ? checkpointHeroes.definitions[checkpointHeroes.selectedHeroId]!.skillTree
        : null;
      if (!tree) {
        throw new Error("Game checkpoint retained hero skill event chain has no authored tree.");
      }
      const retainedUnlockSet = new Set(retainedHeroSkillPointState.unlockedSkillIds);
      const reconstructedUnlocks = new Set(
        authoritativeUnlockedSkillIds.filter((skillId) => !retainedUnlockSet.has(skillId))
      );
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
    if (new Set(overrideKeys).size !== overrideKeys.length) throw new Error("Game checkpoint has duplicate terrain override coordinates.");
    if (overrideKeys.length > TOWER_SCRIPT_LIMITS.activeTerrainOverrides) throw new Error("Game checkpoint terrain override budget is exceeded.");
    const authoredTerrain = new Map(
      mapDefinition.terrainOverrides.map((override) => [coordKey(override), override.terrain])
    );
    const authoredTerrainAt = (coord: Readonly<HexCoord>): string => {
      const key = coordKey(coord);
      if (key === coordKey(mapDefinition.spawnCoord)) return "spawn";
      if (key === coordKey(mapDefinition.coreCoord)) return "core";
      return authoredTerrain.get(key) ?? mapDefinition.defaultTerrain;
    };
    if (hasHeroesCheckpoint && (checkpointHeroes?.schemaVersion === 2
      || checkpointHeroes?.schemaVersion === 3
      || checkpointHeroes?.schemaVersion === 4
      || checkpointHeroes?.schemaVersion === 5
      || checkpointHeroes?.schemaVersion === 6 || checkpointHeroes?.schemaVersion === 7)) {
      const heroes = closed(state.heroes, "heroes", ["schemaVersion", "unit"]);
      const heroSkillTree = checkpointHeroes.schemaVersion === 5 || checkpointHeroes.schemaVersion === 6
        || checkpointHeroes.schemaVersion === 7
        ? checkpointHeroes.definitions[checkpointHeroes.selectedHeroId]!.skillTree
        : null;
      const expectedHeroCheckpointVersion = (checkpointHeroes.schemaVersion === 5
        || checkpointHeroes.schemaVersion === 6 || checkpointHeroes.schemaVersion === 7) && heroSkillTree !== null
        ? 4
        : checkpointHeroes.schemaVersion === 4 || checkpointHeroes.schemaVersion === 5
          || checkpointHeroes.schemaVersion === 6 || checkpointHeroes.schemaVersion === 7
          ? 3
        : checkpointHeroes.schemaVersion === 3 ? 2 : 1;
      if (checkpointDataField(heroes, "schemaVersion", "heroes") !== expectedHeroCheckpointVersion) {
        throw new Error("Game checkpoint hero state schema version is unsupported.");
      }
      const unit = closed(
        checkpointDataField(heroes, "unit", "heroes"),
        "hero unit",
        (checkpointHeroes.schemaVersion === 5 || checkpointHeroes.schemaVersion === 6
          || checkpointHeroes.schemaVersion === 7) && heroSkillTree !== null
          ? [
              "definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent",
              "mana", "abilityCooldownRemaining", "skillPoints", "unlockedSkillIds"
            ]
          : checkpointHeroes.schemaVersion === 4 || checkpointHeroes.schemaVersion === 5
            || checkpointHeroes.schemaVersion === 6 || checkpointHeroes.schemaVersion === 7
          ? [
              "definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent",
              "mana", "abilityCooldownRemaining"
            ]
          : checkpointHeroes.schemaVersion === 3
            ? ["definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress", "hp", "shieldCurrent"]
          : ["definitionId", "currentCoord", "targetCoord", "nextCoord", "edgeProgress"]
      );
      const definitionId = stringValue(
        checkpointDataField(unit, "definitionId", "hero unit"),
        "hero definitionId"
      );
      if (definitionId !== checkpointHeroes.selectedHeroId) {
        throw new Error("Game checkpoint hero state references an unavailable definition.");
      }
      const definition = checkpointHeroes.definitions[definitionId]!;
      const currentCoord = validCoord(
        checkpointDataField(unit, "currentCoord", "hero unit"),
        "hero currentCoord"
      );
      const rawTarget = checkpointDataField(unit, "targetCoord", "hero unit");
      const rawNext = checkpointDataField(unit, "nextCoord", "hero unit");
      const targetCoord = rawTarget === null ? null : validCoord(rawTarget, "hero targetCoord");
      const nextCoord = rawNext === null ? null : validCoord(rawNext, "hero nextCoord");
      const edgeProgress = finite(
        checkpointDataField(unit, "edgeProgress", "hero unit"),
        "hero edgeProgress",
        0,
        0.999999999999
      );
      let heroHp: number | undefined;
      let heroShieldCurrent: number | undefined;
      if (checkpointHeroes.schemaVersion === 3 || checkpointHeroes.schemaVersion === 4
        || checkpointHeroes.schemaVersion === 5 || checkpointHeroes.schemaVersion === 6
        || checkpointHeroes.schemaVersion === 7) {
        const durability = checkpointHeroes.definitions[definitionId]!.durability;
        heroHp = finite(checkpointDataField(unit, "hp", "hero unit"), "hero hp", 0, durability.maxHp);
        heroShieldCurrent = finite(
          checkpointDataField(unit, "shieldCurrent", "hero unit"),
          "hero shieldCurrent",
          0,
          durability.shield?.capacity ?? 0
        );
        if (heroHp < durability.maxHp && heroShieldCurrent > 0) {
          throw new Error("Game checkpoint hero durability state violates shield-first damage ordering.");
        }
      }
      if (checkpointHeroes.schemaVersion === 4 || checkpointHeroes.schemaVersion === 5
        || checkpointHeroes.schemaVersion === 6 || checkpointHeroes.schemaVersion === 7) {
        const activeDefinition = checkpointHeroes.definitions[definitionId]!;
        finite(checkpointDataField(unit, "mana", "hero unit"), "hero mana", 0, activeDefinition.mana.max);
        finite(
          checkpointDataField(unit, "abilityCooldownRemaining", "hero unit"),
          "hero ability cooldown",
          0,
          activeDefinition.activeAbility.cooldown
        );
      }
      if ((checkpointHeroes.schemaVersion === 5 || checkpointHeroes.schemaVersion === 6
        || checkpointHeroes.schemaVersion === 7)
        && heroSkillTree !== null) {
        const skillPoints = integer(
          checkpointDataField(unit, "skillPoints", "hero unit"),
          "hero skill points",
          0
        );
        const unlockedSkillIds = stringArray(
          checkpointDataField(unit, "unlockedSkillIds", "hero unit"),
          "hero unlocked skill ids",
          true
        );
        if (unlockedSkillIds.length > Object.keys(heroSkillTree.nodes).length) {
          throw new Error("Game checkpoint hero skill unlock count exceeds the authored tree.");
        }
        for (let index = 0; index < unlockedSkillIds.length; index += 1) {
          const skillId = unlockedSkillIds[index]!;
          if (!heroSkillTree.nodes[skillId]) {
            throw new Error("Game checkpoint hero skill state references an unavailable skill.");
          }
          if (index > 0 && compareBinary(unlockedSkillIds[index - 1]!, skillId) >= 0) {
            throw new Error("Game checkpoint hero skill ids must be unique and binary-canonical.");
          }
        }
        const unlocked = new Set(unlockedSkillIds);
        for (const skillId of unlockedSkillIds) {
          if (heroSkillTree.nodes[skillId]!.requires.some((requiredId) => !unlocked.has(requiredId))) {
            throw new Error("Game checkpoint hero skill prerequisite state is invalid.");
          }
        }
        const awardedInterwaves = Math.min(state.clearedWaveCount, Math.max(0, mission.waves.length - 1));
        const spentPoints = unlockedSkillIds.reduce(
          (total, skillId) => total + heroSkillTree.nodes[skillId]!.cost,
          0
        );
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
      } else {
        if (sameGridCoord(currentCoord, targetCoord)) {
          throw new Error("Game checkpoint hero at its target must use canonical idle state.");
        }
        const terrainByCoord: Record<string, string> = {};
        const runtimeTerrain = new Map(
          state.runtimeTerrainOverrides.map((override) => [coordKey(override), override.terrain])
        );
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
          profile: checkpointHeroes.movementProfiles[movementProfileId]!,
          terrainTypes: content.terrainTypes,
          terrainByCoord,
          occupiedCoords: state.towers.flatMap((tower) => tower.footprint.map((coord) => ({ q: coord.q, r: coord.r })))
        });
        const currentCell = new NavigationFieldLookupCache().get(field).get(currentCoord);
        if (!currentCell?.nextCoord) {
          if (nextCoord !== null || edgeProgress !== 0) {
            throw new Error("Game checkpoint stalled hero must have null nextCoord and zero progress.");
          }
        } else if (!nextCoord || !sameGridCoord(nextCoord, currentCell.nextCoord)) {
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
      const terraforming = closed(
        state.terraforming,
        "terraforming",
        terraformingSchemaVersion === 1
          ? ["schemaVersion", "runtimeElevationOverrides"]
          : ["schemaVersion", "runtimeElevationOverrides", "nextExpiryGroupSequence", "pendingExpiryGroups"]
      );
      const values = array(
        checkpointDataField(terraforming, "runtimeElevationOverrides", "terraforming"),
        "terraforming.runtimeElevationOverrides"
      );
      if (values.length > TERRAFORMING_LIMITS.activeElevationOverrides) {
        throw new Error("Game checkpoint elevation override budget is exceeded.");
      }
      if (values.length > 0 && !requiresElevationTerraformingCheckpoint) {
        throw new Error("Game checkpoint terraforming elevation overrides require active terraforming elevation.");
      }
      if (values.length + overrideKeys.length > TERRAFORMING_LIMITS.activeOverridesCombined) {
        throw new Error("Game checkpoint combined terraforming override budget is exceeded.");
      }
      const authoredElevation = new Map(
        (mapDefinition.elevationOverrides ?? []).map((entry) => [coordKey(entry), entry.elevation])
      );
      const runtimeElevationProjection = new Map<string, number>();
      let previous: { q: number; r: number } | undefined;
      for (let index = 0; index < values.length; index += 1) {
        const value = closed(
          values[index],
          `terraforming elevation override ${index}`,
          ["q", "r", "elevation"]
        );
        const overrideCoord = validCoord({
          q: checkpointDataField(value, "q", "terraforming elevation override"),
          r: checkpointDataField(value, "r", "terraforming elevation override")
        }, `terraforming elevation override ${index}`);
        if (
          previous
          && (overrideCoord.r < previous.r || (overrideCoord.r === previous.r && overrideCoord.q <= previous.q))
        ) {
          throw new Error("Game checkpoint terraforming elevation overrides are not canonical or contain duplicates.");
        }
        previous = overrideCoord;
        const elevation = checkpointDataField(value, "elevation", "terraforming elevation override");
        const policy = checkpointTerraforming!.elevation!;
        if (
          !Number.isSafeInteger(elevation)
          || (elevation as number) < TERRAFORMING_LIMITS.elevationMinimum
          || (elevation as number) > TERRAFORMING_LIMITS.elevationMaximum
          || (elevation as number) < policy.minimum
          || (elevation as number) > policy.maximum
        ) {
          throw new Error("Game checkpoint terraforming elevation override is outside the active policy.");
        }
        const baseElevation = authoredElevation.get(coordKey(overrideCoord)) ?? 0;
        if (elevation === baseElevation) {
          throw new Error("Game checkpoint terraforming elevation override must differ from authored elevation.");
        }
        runtimeElevationProjection.set(coordKey(overrideCoord), elevation as number);
      }
      if (terraformingSchemaVersion === 2) {
        const nextSequence = integer(
          checkpointDataField(terraforming, "nextExpiryGroupSequence", "terraforming"),
          "terraforming.nextExpiryGroupSequence",
          1
        );
        const groups = array(
          checkpointDataField(terraforming, "pendingExpiryGroups", "terraforming"),
          "terraforming.pendingExpiryGroups"
        );
        if (groups.length > TERRAFORMING_LIMITS.pendingExpiryGroups) {
          throw new Error("Game checkpoint pending terraforming expiry group budget is exceeded.");
        }
        const runtimeTerrainProjection = new Map(
          state.runtimeTerrainOverrides.map((override) => [coordKey(override), override])
        );
        const ownedTargets = new Set<string>();
        let ownedTerrain = 0;
        let ownedElevation = 0;
        let previousSequence = 0;
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          const group = closed(
            groups[groupIndex],
            `terraforming expiry group ${groupIndex}`,
            ["sequence", "remaining", "entries"]
          );
          const sequence = integer(
            checkpointDataField(group, "sequence", "terraforming expiry group"),
            `terraforming expiry group ${groupIndex} sequence`,
            1
          );
          if (sequence <= previousSequence || sequence >= nextSequence) {
            throw new Error("Game checkpoint terraforming expiry group sequence is not canonical.");
          }
          previousSequence = sequence;
          finite(
            checkpointDataField(group, "remaining", "terraforming expiry group"),
            `terraforming expiry group ${groupIndex} remaining`,
            0,
            TERRAFORMING_LIMITS.duration
          );
          const entries = array(
            checkpointDataField(group, "entries", "terraforming expiry group"),
            `terraforming expiry group ${groupIndex} entries`
          );
          if (entries.length < 1 || entries.length > TERRAFORMING_LIMITS.operationsPerBatch) {
            throw new Error("Game checkpoint terraforming expiry group entry budget is exceeded.");
          }
          let previousOrder = -1;
          for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
            const entryProbe = checkpointObjectDescriptors(
              entries[entryIndex],
              `Game checkpoint state terraforming expiry entry ${groupIndex}:${entryIndex}`
            );
            const layer = checkpointDataField(entryProbe, "layer", "terraforming expiry entry");
            const entry = closed(
              entries[entryIndex],
              `terraforming expiry entry ${groupIndex}:${entryIndex}`,
              layer === "terrain"
                ? ["layer", "order", "q", "r", "appliedTerrain", "previousOverride"]
                : layer === "elevation"
                  ? ["layer", "order", "q", "r", "appliedElevation", "previousElevationOverride"]
                  : ["layer"]
            );
            if (layer !== "terrain" && layer !== "elevation") {
              throw new Error("Game checkpoint terraforming expiry entry layer is unsupported.");
            }
            const order = integer(
              checkpointDataField(entry, "order", "terraforming expiry entry"),
              `terraforming expiry entry ${groupIndex}:${entryIndex} order`
            );
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
              const validRuntimeSource = current?.source === "script" || (
                current?.source === "ability"
                && admitsNativePathWater
                && appliedTerrain === "water"
                && baseTerrain === "path"
              );
              if (
                effectiveTerrain !== appliedTerrain
                || (appliedTerrain === baseTerrain && current !== undefined)
                || (appliedTerrain !== baseTerrain && (
                  !current || !validRuntimeSource || current.expiresIn !== undefined
                ))
              ) {
                throw new Error("Game checkpoint terraforming terrain expiry projection does not match runtime state.");
              }
              const previousValue = checkpointDataField(entry, "previousOverride", "terraforming terrain expiry entry");
              if (previousValue === null) {
                if (baseTerrain === appliedTerrain) {
                  throw new Error("Game checkpoint terraforming terrain expiry before-image is invalid.");
                }
              } else {
                const previousOverride = closed(
                  previousValue,
                  "terraforming terrain expiry previous override",
                  ["terrain", "source"]
                );
                const previousTerrain = checkpointDataField(
                  previousOverride,
                  "terrain",
                  "terraforming terrain expiry previous override"
                );
                const previousSource = checkpointDataField(
                  previousOverride,
                  "source",
                  "terraforming terrain expiry previous override"
                );
                if (
                  typeof previousTerrain !== "string"
                  || !own(content.terrainTypes, previousTerrain)
                  || (previousSource !== "script" && previousSource !== "ability")
                  || previousTerrain === appliedTerrain
                ) {
                  throw new Error("Game checkpoint terraforming terrain expiry previous override is invalid.");
                }
              }
            } else {
              ownedElevation += 1;
              if (!requiresElevationTerraformingCheckpoint) {
                throw new Error("Game checkpoint elevation expiry requires active terraforming elevation.");
              }
              if (ownedElevation > TERRAFORMING_LIMITS.activeElevationOverrides) {
                throw new Error("Game checkpoint elevation expiry ownership budget is exceeded.");
              }
              const appliedElevation = checkpointDataField(
                entry,
                "appliedElevation",
                "terraforming elevation expiry entry"
              );
              const policy = checkpointTerraforming!.elevation!;
              const baseElevation = authoredElevation.get(coordValue) ?? 0;
              const currentElevation = runtimeElevationProjection.get(coordValue);
              const effectiveElevation = currentElevation ?? baseElevation;
              if (
                !Number.isSafeInteger(appliedElevation)
                || (appliedElevation as number) < TERRAFORMING_LIMITS.elevationMinimum
                || (appliedElevation as number) > TERRAFORMING_LIMITS.elevationMaximum
                || (appliedElevation as number) < policy.minimum
                || (appliedElevation as number) > policy.maximum
                || effectiveElevation !== appliedElevation
                || (appliedElevation === baseElevation && currentElevation !== undefined)
                || (appliedElevation !== baseElevation && currentElevation === undefined)
              ) {
                throw new Error("Game checkpoint terraforming elevation expiry projection is invalid.");
              }
              const previousElevation = checkpointDataField(
                entry,
                "previousElevationOverride",
                "terraforming elevation expiry entry"
              );
              if (previousElevation === null) {
                if (baseElevation === appliedElevation) {
                  throw new Error("Game checkpoint terraforming elevation expiry before-image is invalid.");
                }
              } else if (
                !Number.isSafeInteger(previousElevation)
                || (previousElevation as number) < policy.minimum
                || (previousElevation as number) > policy.maximum
                || previousElevation === baseElevation
                || previousElevation === appliedElevation
              ) {
                throw new Error("Game checkpoint terraforming elevation expiry previous override is invalid.");
              }
            }
          }
        }
      }
    }
    if (activeNavigationProfile) {
      const authoredTerrain = new Map(
        mapDefinition.terrainOverrides.map((override) => [coordKey(override), override.terrain])
      );
      const runtimeTerrain = new Map(
        state.runtimeTerrainOverrides.map((override) => [coordKey(override), override.terrain])
      );
      const terrainByCoord: Record<string, string> = {};
      for (let r = 0; r < mapDefinition.height; r += 1) {
        for (let q = 0; q < mapDefinition.width; q += 1) {
          const key = coordKey({ q, r });
          let terrain = authoredTerrain.get(key) ?? mapDefinition.defaultTerrain;
          if (key === coordKey(mapDefinition.spawnCoord)) terrain = "spawn";
          if (key === coordKey(mapDefinition.coreCoord)) terrain = "core";
          terrainByCoord[key] = runtimeTerrain.get(key) ?? terrain;
        }
      }
      const routes = mapDefinition.pathRoutes?.length
        ? mapDefinition.pathRoutes
        : [{ id: "main", pathCenterline: mapDefinition.pathCenterline }];
      const occupiedNavigationCoords = state.towers.flatMap((tower) => (
        tower.footprint.map((coord) => ({ q: coord.q, r: coord.r }))
      ));
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
        const formationAssignment = checkpointFormationAssignments?.get(enemyTypeByInstance.get(entry.enemyId)!);
        if (formationAssignment) {
          const movementProfile = activeNavigationProfile.movementProfiles[navigation.movementProfileId]!;
          const terrainId = terrainByCoord[coordKey(navigation.nextCoord)];
          const hasTerrainOverride = terrainId !== undefined
            && Object.prototype.hasOwnProperty.call(movementProfile.terrainCosts ?? {}, terrainId);
          const enteredCost = terrainId === undefined
            ? null
            : hasTerrainOverride
              ? movementProfile.terrainCosts![terrainId] ?? null
              : movementProfile.terrainMode === "respect_walkable"
                && content.terrainTypes[terrainId]?.walkable !== true
                ? null
                : movementProfile.defaultTerrainCost;
          if (enteredCost === null || nextCell.distance + enteredCost !== currentCell.distance) {
            throw new Error("Game checkpoint formation navigation nextCoord is not an equal-optimal field link.");
          }
        } else if (
          !currentCell.nextCoord
          || navigation.nextCoord.q !== currentCell.nextCoord.q
          || navigation.nextCoord.r !== currentCell.nextCoord.r
        ) {
          throw new Error("Game checkpoint enemy navigation nextCoord is not the canonical field link.");
        }
      }
    }
    const eventCursor = integer(state.scriptEventCursor, "scriptEventCursor");
    if (eventCursor > state.lastEvents.length) throw new Error("Game checkpoint script event cursor is invalid.");
    integer(state.scriptActionsRemaining, "scriptActionsRemaining", 0);
    if (state.scriptActionsRemaining > TOWER_SCRIPT_LIMITS.actionsPerTransaction) throw new Error("Game checkpoint action budget is invalid.");
    integer(state.scriptTerrainChangesRemaining, "scriptTerrainChangesRemaining", 0);
    if (state.scriptTerrainChangesRemaining > TOWER_SCRIPT_LIMITS.terrainChangesPerTransaction) throw new Error("Game checkpoint terrain budget is invalid.");
    integer(state.scriptSignalDepth, "scriptSignalDepth", 0);
    if (state.scriptSignalDepth > TOWER_SCRIPT_LIMITS.signalRecursionDepth) throw new Error("Game checkpoint signal depth is invalid.");
    if (requiresScriptMachinesCheckpoint) {
      const machineCheckpoint = closed(
        state.scriptMachines,
        "TowerScript machine state",
        ["schemaVersion", "transitionsRemaining", "values"]
      );
      if (checkpointDataField(machineCheckpoint, "schemaVersion", "TowerScript machine state") !== 1) {
        throw new Error("Game checkpoint TowerScript machine schema version is unsupported.");
      }
      const transitionsRemaining = integer(
        checkpointDataField(machineCheckpoint, "transitionsRemaining", "TowerScript machine state"),
        "TowerScript machine transitionsRemaining"
      );
      if (transitionsRemaining > TOWER_SCRIPT_LIMITS.stateTransitionsPerTransaction) {
        throw new Error("Game checkpoint TowerScript machine transition budget is invalid.");
      }
      const scriptValues = checkpointObjectDescriptors(
        checkpointDataField(machineCheckpoint, "values", "TowerScript machine state"),
        "Game checkpoint TowerScript machine values"
      );
      const expectedScriptIds = checkpointStateMachines.map((script) => script.id);
      if (Object.keys(scriptValues).join("\u0000") !== expectedScriptIds.join("\u0000")) {
        throw new Error("Game checkpoint TowerScript machine script ids are not canonical.");
      }
      for (const script of checkpointStateMachines) {
        const machines = checkpointObjectDescriptors(
          checkpointDataField(scriptValues, script.id, "TowerScript machine values"),
          `Game checkpoint TowerScript machines for ${script.id}`
        );
        const definitions = [...(script.stateMachines ?? [])].sort((left, right) => compareBinary(left.id, right.id));
        if (Object.keys(machines).join("\u0000") !== definitions.map((machine) => machine.id).join("\u0000")) {
          throw new Error(`Game checkpoint TowerScript machine ids for "${script.id}" are not canonical.`);
        }
        for (const machine of definitions) {
          const contexts = checkpointObjectDescriptors(
            checkpointDataField(machines, machine.id, "TowerScript machine values"),
            `Game checkpoint TowerScript contexts for ${script.id}/${machine.id}`
          );
          const contextIds = Object.keys(contexts);
          if (contextIds.join("\u0000") !== [...contextIds].sort(compareBinary).join("\u0000")) {
            throw new Error("Game checkpoint TowerScript machine context order is not canonical.");
          }
          const statePaths = new Set(collectTowerScriptStatePaths(machine));
          const allowedScopes = new Set(machine.bindings.map((binding) => binding.scope));
          for (const contextId of contextIds) {
            const separator = contextId.indexOf(":");
            const scope = separator < 0 ? "" : contextId.slice(0, separator);
            if (!allowedScopes.has(scope as TowerScriptBinding["scope"])) {
              throw new Error(`Game checkpoint TowerScript context "${contextId}" is outside machine bindings.`);
            }
            const runtime = closed(
              checkpointDataField(contexts, contextId, "TowerScript machine contexts"),
              `TowerScript machine runtime ${contextId}`,
              ["schemaVersion", "activeStatePath", "enteredAt", "transitionCount"]
            );
            if (checkpointDataField(runtime, "schemaVersion", "TowerScript machine runtime") !== 1) {
              throw new Error("Game checkpoint TowerScript machine runtime schema version is unsupported.");
            }
            const activeStatePath = stringValue(
              checkpointDataField(runtime, "activeStatePath", "TowerScript machine runtime"),
              "TowerScript machine activeStatePath"
            );
            if (!statePaths.has(activeStatePath)) {
              throw new Error(`Game checkpoint TowerScript machine active state "${activeStatePath}" is unknown.`);
            }
            const enteredAt = finite(
              checkpointDataField(runtime, "enteredAt", "TowerScript machine runtime"),
              "TowerScript machine enteredAt"
            );
            if (enteredAt > state.missionElapsed) {
              throw new Error("Game checkpoint TowerScript machine enteredAt is in the future.");
            }
            integer(
              checkpointDataField(runtime, "transitionCount", "TowerScript machine runtime"),
              "TowerScript machine transitionCount"
            );
          }
        }
      }
    }
    if (
      checkpointVanguardProtectionTransactionsThisTick !== undefined
      && checkpointVanguardProtectionTransactionsThisTick !== checkpointVanguardInterceptionEventCount
    ) {
      throw new Error(
        "Game checkpoint enemyBehaviors protectionRuntime.transactionsThisTick must equal this tick's vanguardDamageIntercepted event count."
      );
    }
    for (const transitionEvent of checkpointTransitionEvents) {
      if (transitionEvent.index >= eventCursor) {
        throw new Error("Game checkpoint cannot restore a queued state-machine transition event.");
      }
      const script = checkpointStateMachines.find((candidate) => candidate.id === transitionEvent.scriptId);
      const machine = script?.stateMachines?.find((candidate) => candidate.id === transitionEvent.machineId);
      if (!script || !machine || !hasTowerScriptStateTransitionProvenance(
        machine,
        transitionEvent.transitionId,
        transitionEvent.fromStatePath,
        transitionEvent.toStatePath
      )) {
        throw new Error("Game checkpoint state-machine transition event has unknown authored provenance.");
      }
      const separator = transitionEvent.contextId.indexOf(":");
      const scope = separator < 0 ? "" : transitionEvent.contextId.slice(0, separator);
      if (!machine.bindings.some((binding) => binding.scope === scope)) {
        throw new Error("Game checkpoint state-machine transition event context is outside machine bindings.");
      }
    }
  }

  private restoreCheckpointState(
    state: GameCheckpointStateV1,
    initialRng: SeededRngStateV1,
    currentRng: SeededRngStateV1
  ): void {
    const logisticsCounts = this.activeLogisticsPower
      ? preflightLogisticsPowerTopologyV1(
          this.activeLogisticsPower,
          state.towers,
          this.towerTypes,
          this.map
        )
      : Object.freeze({ participants: 0, nodes: 0, undirectedEdges: 0 });
    this.coreHp = state.coreHp;
    this.resources = { ...state.resources };
    this.waveIndex = state.waveIndex;
    this.startedWaveCount = state.startedWaveCount;
    this.waveState = state.waveState;
    this.prepRemaining = state.prepRemaining;
    this.outcome = state.outcome;
    this.enemies = state.enemies.map((enemy): EnemyState => ({
      ...enemy,
      ...(enemy.disruptTargetTowerIds === undefined ? {} : { disruptTargetTowerIds: [...enemy.disruptTargetTowerIds] }),
      ...(enemy.navigation === undefined ? {} : {
        navigation: {
          ...enemy.navigation,
          currentCoord: { ...enemy.navigation.currentCoord },
          ...(enemy.navigation.nextCoord === undefined ? {} : { nextCoord: { ...enemy.navigation.nextCoord } })
        }
      })
    }));
    this.navigationEnemyFields?.clear();
    this.towers = [...state.towers] as TowerState[];
    this.logisticsAmmunitionAmounts = new Map(
      state.logistics?.ammunition?.inventories.map((entry) => [entry.towerId, entry.amount] as const) ?? []
    );
    this.logisticsSupplyProducers = new Map(
      state.logistics?.schemaVersion === 2 && state.logistics.supply
        ? state.logistics.supply.producers.map((entry) => [entry.towerId, {
            amount: entry.amount,
            productionProgress: entry.productionProgress,
            transferProgress: entry.transferProgress
          }] as const)
        : []
    );
    this.logisticsSupplyStorages = new Map(
      state.logistics?.schemaVersion === 2 && state.logistics.supply
        ? state.logistics.supply.storages.map((entry) => [entry.towerId, {
            amount: entry.amount,
            transferProgress: entry.transferProgress
          }] as const)
        : []
    );
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
    } else {
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
    } else {
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
            cardIds: Object.freeze([...state.draft.pendingOffer.cardIds]) as unknown as readonly [string, string, string]
          });
      this.draftSelections = state.draft.selections.map((selection) => Object.freeze({ ...selection }));
    } else {
      this.draftInitialRngState = undefined;
      this.draftRng = undefined;
      this.nextDraftOfferSequence = 1;
      this.pendingDraftOffer = null;
      this.draftSelections = [];
    }
    this.rebuildRogueliteSynergies();
    this.directorDecisions = Object.freeze((state.director?.decisions ?? []).map((decision) => Object.freeze({
      ...decision,
      reason: Object.freeze({ ...decision.reason }),
      addedGroups: Object.freeze(decision.addedGroups.map((group) => Object.freeze({ ...group })))
    })));
    this.questEntries = Object.freeze((state.quests?.entries ?? []).map((entry) => Object.freeze({ ...entry })));
    this.weatherRuntime = this.activeWeatherMechanics && state.weather
      ? Object.freeze({
          schemaVersion: 1 as const,
          active: state.weather.active === null
            ? null
            : Object.freeze({
                ...state.weather.active,
                zone: state.weather.active.zone.kind === "all_map"
                  ? Object.freeze({ kind: "all_map" as const })
                  : Object.freeze({
                      kind: "tiles" as const,
                      tiles: Object.freeze(state.weather.active.zone.tiles.map((tile) => Object.freeze({ ...tile })))
                    })
              }),
          periodicOrdinals: Object.freeze({ ...state.weather.periodicOrdinals })
        })
      : this.weatherSchedule ? createWeatherRuntimeV1(this.weatherSchedule) : undefined;
    this.lastEvents = [...state.lastEvents] as GameEvent[];
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
    this.scriptValues = state.scriptValues as Record<string, Record<string, Record<string, TowerScriptJson>>>;
    this.scriptDiagnostics = [...state.scriptDiagnostics];
    this.scriptHandlerLastRun = { ...state.scriptHandlerLastRun };
    this.scriptEventCursor = state.scriptEventCursor;
    this.scriptActionsRemaining = state.scriptActionsRemaining;
    this.scriptTerrainChangesRemaining = state.scriptTerrainChangesRemaining;
    this.scriptSignalDepth = state.scriptSignalDepth;
    this.scriptStateTransitionsRemaining = state.scriptMachines?.transitionsRemaining ?? 0;
    this.scriptMachines = state.scriptMachines
      ? cloneCheckpointJson(state.scriptMachines.values) as Record<string, Record<string, Record<string, TowerScriptMachineRuntimeStateV1>>>
      : {};
    this.hasScriptStateMachines = state.scriptMachines !== undefined;
    this.enemyShields = Object.fromEntries(Object.entries(state.combat?.shields.enemies ?? {}).map(([id, shield]) => [id, { ...shield }]));
    this.towerShields = Object.fromEntries(Object.entries(state.combat?.shields.towers ?? {}).map(([id, shield]) => [id, { ...shield }]));
    this.enemyMarks = state.combat?.schemaVersion === 2
      ? Object.fromEntries(Object.entries(state.combat.marks.enemies).map(([enemyId, marks]) => [
          enemyId,
          Object.fromEntries(Object.entries(marks).map(([markId, mark]) => [markId, { ...mark }]))
        ]))
      : {};
    this.enemyExposures = cloneEnemyExposureStates(state.reactions?.exposures.enemies ?? {});
    this.enemyComponentStates = Object.fromEntries(Object.entries(state.enemyBehaviors?.components ?? {}).map(([enemyId, components]) => [
      enemyId,
      Object.fromEntries(Object.entries(components).map(([componentId, component]) => [
        componentId,
        {
          hp: component.hp,
          maxHp: component.maxHp,
          ...(component.shield === undefined ? {} : { shield: { ...component.shield } })
        }
      ]))
    ]));
    this.vanguardProtectionTransactionsThisTick = state.enemyBehaviors?.protectionRuntime?.transactionsThisTick ?? 0;
    this.projectiles = (state.ballistics?.projectiles ?? []).map((projectile) => {
      const clearanceCollision = (projectile as ProjectileCheckpointV2).clearanceCollision;
      const destructibleCollision = (projectile as ProjectileCheckpointV4).destructibleCollision;
      return {
        ...projectile,
        sourceCoord: { ...projectile.sourceCoord },
        ...(clearanceCollision === undefined ? {} : {
          clearanceCollision: {
            ...clearanceCollision,
            blockerCoord: { ...clearanceCollision.blockerCoord }
          }
        }),
        ...(destructibleCollision === undefined ? {} : {
          destructibleCollision: {
            ...destructibleCollision,
            collisionCoord: { ...destructibleCollision.collisionCoord }
          }
        }),
        impact: {
          targetCoord: { ...projectile.impact.targetCoord },
          targetElevation: projectile.impact.targetElevation,
          damagePacket: cloneCheckpointJson(projectile.impact.damagePacket)
        }
      };
    });
    this.nextProjectileSequence = state.ballistics?.nextProjectileSequence ?? 1;
    if (state.ballistics?.schemaVersion === 4) {
      this.destructibleObjects = state.ballistics.destructibles.objects.map((object) => ({
        objectId: object.objectId,
        definitionId: object.definitionId,
        coord: { ...object.coord },
        hp: object.hp,
        maxHp: object.maxHp,
        destroyed: object.destroyed
      }));
      this.rebuildDestructibleCollisionIndex();
    } else {
      this.initializeDestructibleObjects();
    }
    this.projectileClearanceInspectionsThisTick = 0;
    this.projectileDestructibleInspectionsThisTick = 0;
    this.initialRngState = cloneCheckpointJson(initialRng);
    this.rng = SeededRng.fromState(currentRng);
    if (this.activeWeatherMechanics) {
      this.weatherSchedule = createWeatherScheduleV1({
        zones: this.activeWeatherMechanics.zones,
        definitions: this.activeWeatherMechanics.definitions,
        schedule: this.activeWeatherMechanics.schedule
      }, {
        seed: canonicalStringify(this.initialRngState),
        missionId: this.mission.id,
        waveCount: this.mission.waves.length
      });
    }

    this.map.restoreAllTerrain();
    for (const tile of this.map.tiles.values()) delete tile.occupiedBy;
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
          targets: group.entries.map((entry): TerraformExpiryTargetV1 => entry.layer === "terrain"
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
    for (const tower of this.towers) this.map.setOccupied(tower.footprint, tower.id);
    this.syncTemporaryWaterTiles();
    this.syncNavigationResolver();
    if (
      (this.activeHeroesMechanics?.schemaVersion === 2
        || this.activeHeroesMechanics?.schemaVersion === 3
        || this.activeHeroesMechanics?.schemaVersion === 4
        || this.activeHeroesMechanics?.schemaVersion === 5
        || this.activeHeroesMechanics?.schemaVersion === 6
        || this.activeHeroesMechanics?.schemaVersion === 7)
      && state.heroes
    ) {
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
        if (!enemy.navigation || !enemy.routeId) continue;
        this.navigationEnemyFields.set(
          enemy.id,
          this.navigationField(enemy.navigation.movementProfileId, enemy.routeId)
        );
      }
    }
    this.logisticsTopologyCounts = logisticsCounts;
    this.logisticsLiveParticipantIds = new Set(
      this.towers
        .filter((tower) => this.isLiveLogisticsParticipant(tower))
        .map((tower) => tower.id)
    );
    this.logisticsPowerSnapshotCache = undefined;
    this.logisticsPoweredConsumerIds = undefined;
    this.logisticsPowerDirty = this.activeLogisticsPower !== undefined;
    this.logisticsSupplyTopologyCache = undefined;
    this.logisticsSupplyDirty = this.activeLogisticsSupply !== undefined;
  }

  private buildSnapshot(copyStaticState: boolean): GameSnapshot {
    const combat = this.buildCombatState();
    const reactions = this.buildReactionState();
    const enemyBehaviors = this.buildEnemyBehaviorsState();
    const ballistics = this.buildBallisticsState();
    const weather: GameSnapshot["weather"] = this.activeWeatherMechanics && this.weatherRuntime
      ? Object.freeze({
          schemaVersion: 1 as const,
          profileId: this.activeWeatherMechanics.profileId,
          active: this.weatherRuntime.active
        })
      : undefined;
    const navigation = this.buildNavigationSnapshot();
    const elevation = this.buildElevationSnapshot(copyStaticState);
    const terraforming = this.activeTerraformingMechanics
      ? buildTerraformingSnapshot(this.pendingTerraformExpiryGroups)
      : undefined;
    const roguelite = this.currentRogueliteSnapshot();
    const logistics = this.currentLogisticsPowerSnapshot();
    const heroes: GameSnapshot["heroes"] = this.activeHeroesMechanics?.schemaVersion === 7
      && this.heroStateV2
      && this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.blocking !== null
      ? (() => {
          const state = this.heroStateV2!;
          const definition = (this.activeHeroesMechanics as ActiveHeroesMechanicsV7).definitions[state.definitionId]!;
          const tree = definition.skillTree;
          const unlocked = state.unlockedSkillIds ?? new Set<string>();
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
          const auraActive = definition.passiveAura !== null && this.heroPassiveAuraActive();
          const blockingActive = this.heroBlockingActive();
          return Object.freeze({
            schemaVersion: 7 as const,
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
              passiveAura: definition.passiveAura === null
                ? null
                : Object.freeze({
                    id: definition.passiveAura.id,
                    label: definition.passiveAura.label,
                    radius: definition.passiveAura.radius,
                    active: auraActive,
                    affectedTowerIds: auraActive ? this.heroPassiveAuraAffectedTowerIds() : Object.freeze([])
                  }),
              blocking: Object.freeze({
                blockCapacity: definition.blocking!.blockCapacity,
                active: blockingActive,
                blockedEnemyIds: blockingActive ? this.deriveHeroBlockedEnemyIds() : Object.freeze([])
              })
            })])
          });
        })()
      : (this.activeHeroesMechanics?.schemaVersion === 6
        || (this.activeHeroesMechanics?.schemaVersion === 7
          && this.activeHeroesMechanics.definitions[this.heroStateV2?.definitionId ?? ""]?.blocking === null))
      && this.heroStateV2
      && this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.passiveAura !== null
      ? (() => {
          const state = this.heroStateV2!;
          const definition = (this.activeHeroesMechanics as ActiveHeroesMechanicsV6 | ActiveHeroesMechanicsV7)
            .definitions[state.definitionId]!;
          const tree = definition.skillTree;
          const unlocked = state.unlockedSkillIds ?? new Set<string>();
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
            schemaVersion: 6 as const,
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
                id: definition.passiveAura!.id,
                label: definition.passiveAura!.label,
                radius: definition.passiveAura!.radius,
                active: auraActive,
                affectedTowerIds: auraActive ? this.heroPassiveAuraAffectedTowerIds() : Object.freeze([])
              })
            })])
          });
        })()
      : (this.activeHeroesMechanics?.schemaVersion === 5 || this.activeHeroesMechanics?.schemaVersion === 6
          || this.activeHeroesMechanics?.schemaVersion === 7)
      && this.heroStateV2
      && this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.skillTree !== null
      ? (() => {
          const state = this.heroStateV2!;
          const definition = this.activeHeroesMechanics!.schemaVersion === 5
            || this.activeHeroesMechanics!.schemaVersion === 6
            || this.activeHeroesMechanics!.schemaVersion === 7
            ? this.activeHeroesMechanics.definitions[state.definitionId]!
            : undefined;
          const tree = definition!.skillTree!;
          const unlocked = state.unlockedSkillIds ?? new Set<string>();
          const managementAvailable = this.heroSkillManagementAvailable();
          return Object.freeze({
            schemaVersion: 5 as const,
            units: Object.freeze([Object.freeze({
              id: state.definitionId,
              definitionId: state.definitionId,
              label: definition!.label,
              coord: Object.freeze({ ...state.currentCoord }),
              movement: Object.freeze({
                targetCoord: state.targetCoord === null ? null : Object.freeze({ ...state.targetCoord }),
                nextCoord: state.nextCoord === null ? null : Object.freeze({ ...state.nextCoord }),
                edgeProgress: state.edgeProgress
              }),
              durability: Object.freeze({
                hp: state.hp ?? 0,
                maxHp: definition!.durability.maxHp,
                shield: definition!.durability.shield === null
                  ? null
                  : Object.freeze({
                      current: state.shieldCurrent ?? 0,
                      capacity: definition!.durability.shield.capacity
                    }),
                defeated: (state.hp ?? 0) <= 0
              }),
              mana: Object.freeze({
                current: state.mana ?? 0,
                max: definition!.mana.max,
                regenerationPerUnit: definition!.mana.regenerationPerUnit
              }),
              activeAbility: Object.freeze({
                ...definition!.activeAbility,
                cooldownRemaining: state.abilityCooldownRemaining ?? 0,
                ready: (state.hp ?? 0) > 0
                  && this.outcome === "playing"
                  && (state.mana ?? 0) >= definition!.activeAbility.manaCost
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
        || ((this.activeHeroesMechanics?.schemaVersion === 5 || this.activeHeroesMechanics?.schemaVersion === 6
          || this.activeHeroesMechanics?.schemaVersion === 7)
          && this.activeHeroesMechanics.definitions[this.heroStateV2?.definitionId ?? ""]?.skillTree === null))
        && this.heroStateV2
      ? Object.freeze({
          schemaVersion: 4 as const,
          units: Object.freeze([Object.freeze({
            id: this.heroStateV2.definitionId,
            definitionId: this.heroStateV2.definitionId,
            label: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.label,
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
              maxHp: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.durability.maxHp,
              shield: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.durability.shield === null
                ? null
                : Object.freeze({
                    current: this.heroStateV2.shieldCurrent ?? 0,
                    capacity: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.durability.shield!.capacity
                  }),
              defeated: (this.heroStateV2.hp ?? 0) <= 0
            }),
            mana: Object.freeze({
              current: this.heroStateV2.mana ?? 0,
              max: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.mana.max,
              regenerationPerUnit: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.mana.regenerationPerUnit
            }),
            activeAbility: Object.freeze({
              ...this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.activeAbility,
              cooldownRemaining: this.heroStateV2.abilityCooldownRemaining ?? 0,
              ready: (this.heroStateV2.hp ?? 0) > 0
                && this.outcome === "playing"
                && (this.heroStateV2.mana ?? 0) >= this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.activeAbility.manaCost
                && (this.heroStateV2.abilityCooldownRemaining ?? 0) <= 0
            })
          })])
        })
      : this.activeHeroesMechanics?.schemaVersion === 3 && this.heroStateV2
      ? Object.freeze({
          schemaVersion: 3 as const,
          units: Object.freeze([Object.freeze({
            id: this.heroStateV2.definitionId,
            definitionId: this.heroStateV2.definitionId,
            label: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.label,
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
              maxHp: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.durability.maxHp,
              shield: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.durability.shield === null
                ? null
                : Object.freeze({
                    current: this.heroStateV2.shieldCurrent ?? 0,
                    capacity: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.durability.shield!.capacity
                  }),
              defeated: (this.heroStateV2.hp ?? 0) <= 0
            })
          })])
        })
      : this.activeHeroesMechanics?.schemaVersion === 2 && this.heroStateV2
        ? Object.freeze({
            schemaVersion: 2 as const,
            units: Object.freeze([Object.freeze({
              id: this.heroStateV2.definitionId,
              definitionId: this.heroStateV2.definitionId,
              label: this.activeHeroesMechanics.definitions[this.heroStateV2.definitionId]!.label,
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
    const director: GameSnapshot["director"] = this.activeDirectorMechanics
      ? Object.freeze({
          schemaVersion: 1 as const,
          profileId: this.activeDirectorMechanics.profileId,
          decisions: Object.freeze(this.directorDecisions.map((decision) => Object.freeze({
            ...decision,
            reason: Object.freeze({ ...decision.reason }),
            addedGroups: Object.freeze(decision.addedGroups.map((group) => Object.freeze({ ...group })))
          })))
        })
      : undefined;
    const quests = this.buildQuestSnapshot();
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
        ...(enemy.disruptTargetTowerIds === undefined ? {} : { disruptTargetTowerIds: [...enemy.disruptTargetTowerIds] }),
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
        footprint: tower.footprint.map((coord) => ({ ...coord })),
        ...(() => {
          const controller = this.scriptedTargetingByTowerType.get(tower.typeId);
          return controller
            ? {
                scriptedTargeting: {
                  schemaVersion: 1 as const,
                  scriptId: controller.script.id,
                  behaviorTreeId: controller.tree.id,
                  fallbackMode: tower.targetMode ?? "first"
                }
              }
            : {};
        })()
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
      ...(logistics === undefined ? {} : { logistics }),
      ...(director === undefined ? {} : { director }),
      ...(quests === undefined ? {} : { quests }),
      ...(enemyBehaviors === undefined ? {} : { enemyBehaviors }),
      ...(ballistics === undefined ? {} : { ballistics }),
      ...(weather === undefined ? {} : { weather }),
      scriptState: {
        values: this.cloneScriptValues(),
        diagnostics: this.scriptDiagnostics.map((diagnostic) => ({ ...diagnostic })),
        ...(this.hasScriptStateMachines ? { machines: this.cloneScriptMachines() } : {})
      },
      lastEvents: [...this.lastEvents]
    };
  }

  private initializeScripts(): void {
    this.scriptValues = {};
    this.scriptDiagnostics = [];
    this.scriptHandlerLastRun = {};
    this.scriptEventCursor = 0;
    this.scriptActionsRemaining = 0;
    this.scriptSignalDepth = 0;
    this.scriptStateTransitionsRemaining = 0;
    this.scriptMachines = {};
    this.hasScriptStateMachines = false;
    for (const scriptId of Object.keys(this.content.scripts ?? {}).sort()) this.scriptValues[scriptId] = {};
    for (const script of Object.values(this.content.scripts ?? {})) {
      if (script?.enabled === false || script?.schemaVersion !== 7 || !script.stateMachines?.length) continue;
      this.hasScriptStateMachines = true;
      this.scriptMachines[script.id] = Object.fromEntries(script.stateMachines.map((machine) => [machine.id, {}]));
    }
  }

  private initializeScriptedTargeting(): void {
    this.scriptedTargetingByTowerType.clear();
    const allTowerIds = Object.keys(this.content.towers).sort(compareBinary);
    const scripts = Object.values(this.content.scripts ?? {}).sort((left, right) => compareBinary(left.id, right.id));
    for (const script of scripts) {
      if (!script || script.enabled === false || script.schemaVersion !== 7 || !Array.isArray(script.behaviorTrees)) continue;
      for (const tree of script.behaviorTrees) {
        if (!tree || tree.schemaVersion !== 1 || !Array.isArray(tree.bindings)) continue;
        for (const binding of tree.bindings) {
          if (!binding || binding.scope !== "tower") continue;
          for (const towerTypeId of binding.ids ?? allTowerIds) {
            if (this.scriptedTargetingByTowerType.has(towerTypeId)) continue;
            const tower = this.content.towers[towerTypeId];
            if (!tower) continue;
            const supported = tower.attack.kind !== "support"
              && tower.attack.kind !== "support_buff"
              && tower.attack.kind !== "pulse"
              && !(tower.attack.kind === "pipeline" && tower.attack.delivery.kind === "aura");
            if (supported) this.scriptedTargetingByTowerType.set(towerTypeId, Object.freeze({ script, tree }));
          }
        }
      }
    }
  }

  private beginScriptTransaction(): void {
    this.scriptActionsRemaining = TOWER_SCRIPT_LIMITS.actionsPerTransaction;
    this.scriptTerrainChangesRemaining = TOWER_SCRIPT_LIMITS.terrainChangesPerTransaction;
    this.scriptSignalDepth = 0;
    this.scriptStateTransitionsRemaining = TOWER_SCRIPT_LIMITS.stateTransitionsPerTransaction;
  }

  private finishScriptedAction(): void {
    this.beginScriptTransaction();
    this.processScriptEvents();
    this.stabilizeDynamicEnemyNavigation();
  }

  private processScriptEvents(): void {
    let processed = 0;
    while (this.scriptEventCursor < this.lastEvents.length && processed < TOWER_SCRIPT_LIMITS.eventsPerTransaction) {
      const event = this.lastEvents[this.scriptEventCursor++];
      processed += 1;
      if (!event || event.type === "scriptDiagnostic" || event.type === "scriptSignal") continue;
      if (SCRIPT_GAME_EVENT_NAMES.has(event.type as TowerScriptEventName)) {
        this.runScriptEvent(event.type as TowerScriptEventName, event as unknown as Record<string, unknown>);
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
    this.cleanupScriptMachineContexts();
  }

  private runScriptEvent(eventName: TowerScriptEventName, event: Record<string, unknown>): void {
    const eventTrace = this.towerScriptTrace?.record({
      phase: "event",
      eventName,
      event: event as Record<string, TowerScriptJson>
    });
    if (eventTrace && this.towerScriptTrace?.shouldPauseBeforeEntry(eventTrace.sequence)) {
      throw new TowerScriptTracePauseError(eventTrace.sequence);
    }
    for (const script of Object.values(this.content.scripts ?? {}).sort((a, b) => a.id.localeCompare(b.id))) {
      if (!script || script.enabled === false) continue;
      if (script.schemaVersion === 7 && script.stateMachines?.length) {
        this.runScriptStateMachines(script, eventName, event, eventTrace?.sequence);
      }
      const handlers = script.handlers?.[eventName] ?? [];
      if (!Array.isArray(handlers) || handlers.length === 0) continue;
      const seenContexts = new Set<string>();
      for (const [bindingIndex, binding] of (script.bindings ?? []).entries()) {
        for (const self of this.scriptContexts(binding, eventName, event)) {
          const contextIdentity = `${self.scope}:${self.id}`;
          if (seenContexts.has(contextIdentity)) continue;
          seenContexts.add(contextIdentity);
          const stateKey = contextIdentity;
          const context: TowerScriptExecutionContext = {
            script,
            binding,
            self,
            state: this.scriptStateFor(script, stateKey),
            stateKey,
            event,
            eventName
          };
          const bindingTrace = this.towerScriptTrace?.record({
            phase: "binding",
            ...(eventTrace ? { parentSequence: eventTrace.sequence } : {}),
            eventName,
            scriptId: script.id,
            bindingIndex,
            contextId: contextIdentity,
            scope: binding.scope
          });
          handlers.forEach((handler, index) => this.runScriptHandler(
            context,
            handler,
            index,
            bindingTrace?.sequence
          ));
        }
      }
    }
  }

  private runScriptStateMachines(
    script: TowerScriptDefinition,
    eventName: TowerScriptEventName,
    event: Record<string, unknown>,
    parentTraceSequence?: number
  ): void {
    const machineComponent = this.scriptMachineComponentContext(eventName, event);
    for (const machine of script.stateMachines ?? []) {
      const machineContexts = new Set<string>();
      for (const binding of machine.bindings) {
        for (const self of this.scriptContexts(binding, eventName, event)) {
          const contextId = `${self.scope}:${self.id}`;
          if (machineContexts.has(contextId)) continue;
          machineContexts.add(contextId);
          const state = this.scriptStateFor(script, contextId);
          const context: TowerScriptExecutionContext = {
            script,
            binding,
            self,
            state,
            stateKey: contextId,
            event,
            eventName,
            ...(machineComponent === undefined ? {} : { machineComponent })
          };
          const machineStates = (this.scriptMachines[script.id] ??= {});
          const contexts = (machineStates[machine.id] ??= {});
          let runtime = contexts[contextId];
          if (!runtime) {
            try {
              const initialized = initializeTowerScriptStateMachine(machine, this.missionElapsed);
              runtime = initialized.state;
              contexts[contextId] = runtime;
              if (!this.runScriptMachineActions(
                context,
                machine,
                "entry",
                initialized.entryActions,
                undefined,
                parentTraceSequence
              )) continue;
            } catch (error) {
              if (error instanceof TowerScriptTracePauseError) throw error;
              this.recordScriptMachineDiagnostic(script, machine, context, error, parentTraceSequence);
              continue;
            }
          }
          try {
            const root = this.scriptExpressionContext(context);
            const plan = planTowerScriptStateTransition(
              machine,
              runtime,
              eventName,
              {
                ...root,
                ...(context.machineComponent === undefined ? {} : { component: context.machineComponent }),
                machine: { ...runtime }
              } as unknown as TowerScriptMachineExpressionContextV1,
              this.missionElapsed
            );
            if (!plan) continue;
            if (this.scriptStateTransitionsRemaining <= 0) {
              this.scriptStateTransitionsRemaining = 0;
              throw new Error("TowerScript state transition budget exceeded.");
            }
            this.scriptStateTransitionsRemaining -= 1;
            // The target is authoritative before any user-authored action runs.
            contexts[contextId] = plan.state;
            const transitionTrace = this.towerScriptTrace?.record({
              phase: "transition",
              ...(parentTraceSequence === undefined ? {} : { parentSequence: parentTraceSequence }),
              eventName,
              scriptId: script.id,
              contextId,
              controllerId: machine.id,
              machineId: machine.id,
              transitionId: plan.transitionId,
              fromStatePath: plan.fromStatePath,
              toStatePath: plan.toStatePath
            });
            if (transitionTrace && this.towerScriptTrace?.shouldPauseAfterEntry(transitionTrace.sequence)) {
              throw new TowerScriptTracePauseError(transitionTrace.sequence);
            }
            const phases = [
              ["exit", plan.exitActions],
              ["transition", plan.transitionActions],
              ["entry", plan.entryActions]
            ] as const;
            let completed = true;
            for (const [phase, actions] of phases) {
              if (!this.runScriptMachineActions(
                context,
                machine,
                phase,
                actions,
                plan.transitionId,
                transitionTrace?.sequence ?? parentTraceSequence
              )) {
                completed = false;
                break;
              }
            }
            this.lastEvents.push({
              type: "stateMachineTransitioned",
              scriptId: script.id,
              machineId: machine.id,
              contextId,
              transitionId: plan.transitionId,
              fromStatePath: plan.fromStatePath,
              toStatePath: plan.toStatePath
            });
            if (!completed) continue;
          } catch (error) {
            if (error instanceof TowerScriptTracePauseError) throw error;
            this.recordScriptMachineDiagnostic(script, machine, context, error, parentTraceSequence);
          }
        }
      }
    }
  }

  private runScriptMachineActions(
    context: TowerScriptExecutionContext,
    machine: TowerScriptStateMachineV1,
    phase: "entry" | "exit" | "transition",
    actions: readonly TowerScriptAction[],
    transitionId?: string,
    parentTraceSequence?: number
  ): boolean {
    const handlerId = transitionId === undefined
      ? `${machine.id}:${phase}`
      : `${machine.id}:${transitionId}:${phase}`;
    const expressionBudget = { remaining: TOWER_SCRIPT_LIMITS.expressionOperationsPerHandler };
    const runtime = this.scriptMachines[context.script.id]?.[machine.id]?.[context.stateKey];
    const root = {
      ...this.scriptExpressionContext(context),
      ...(context.machineComponent === undefined ? {} : { component: context.machineComponent }),
      ...(runtime ? { machine: { ...runtime } } : {})
    };
    for (const [actionIndex, action] of actions.entries()) {
      try {
        if (this.scriptActionsRemaining <= 0) {
          this.scriptActionsRemaining = 0;
          throw new Error("TowerScript action budget exceeded.");
        }
        this.scriptActionsRemaining -= 1;
        const stateBefore = this.towerScriptTrace ? this.cloneScriptJsonObject(context.state) : undefined;
        const actionTrace = this.towerScriptTrace?.record({
          phase: "action",
          ...(parentTraceSequence === undefined ? {} : { parentSequence: parentTraceSequence }),
          eventName: context.eventName,
          scriptId: context.script.id,
          contextId: context.stateKey,
          handlerId,
          handlerIndex: -1,
          actionIndex,
          actionPhase: phase,
          action
        });
        this.applyScriptAction(action, context, root, expressionBudget);
        if (stateBefore && this.towerScriptTrace) {
          const changes = diffTowerScriptState(stateBefore, context.state);
          if (changes.length > 0) {
            this.towerScriptTrace.record({
              phase: "state_diff",
              ...(actionTrace ? { parentSequence: actionTrace.sequence } : {}),
              eventName: context.eventName,
              scriptId: context.script.id,
              contextId: context.stateKey,
              handlerId,
              handlerIndex: -1,
              actionIndex,
              changes
            });
          }
        }
        if (actionTrace && this.towerScriptTrace?.shouldPauseAfterAction(actionTrace.sequence)) {
          throw new TowerScriptTracePauseError(actionTrace.sequence);
        }
      } catch (error) {
        if (error instanceof TowerScriptTracePauseError) throw error;
        this.recordScriptMachineDiagnostic(context.script, machine, context, error, parentTraceSequence, handlerId, actionIndex);
        return false;
      }
    }
    return true;
  }

  private recordScriptMachineDiagnostic(
    script: TowerScriptDefinition,
    machine: TowerScriptStateMachineV1,
    context: TowerScriptExecutionContext,
    error: unknown,
    parentSequence?: number,
    handlerId = machine.id,
    actionIndex?: number
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.recordScriptDiagnostic({
      scriptId: script.id,
      handlerId,
      event: context.eventName,
      code: /budget exceeded/i.test(message)
        ? "budget_exceeded"
        : /expression|\$get|\$op|context path/i.test(message) ? "invalid_expression" : "runtime_error",
      message
    }, {
      ...(actionIndex === undefined ? {} : { actionIndex }),
      contextId: context.stateKey,
      handlerIndex: -1,
      ...(parentSequence === undefined ? {} : { parentSequence })
    });
  }

  private cleanupScriptMachineContexts(): void {
    if (!this.hasScriptStateMachines) return;
    const liveTowers = new Set(this.towers.map((tower) => `tower:${tower.id}`));
    const liveEnemies = new Set(this.enemies.filter((enemy) => enemy.hp > 0).map((enemy) => `enemy:${enemy.id}`));
    for (const machines of Object.values(this.scriptMachines)) {
      for (const contexts of Object.values(machines)) {
        for (const contextId of Object.keys(contexts)) {
          if ((contextId.startsWith("tower:") && !liveTowers.has(contextId))
            || (contextId.startsWith("enemy:") && !liveEnemies.has(contextId))) {
            delete contexts[contextId];
          }
        }
      }
    }
  }

  private runScriptHandler(
    context: TowerScriptExecutionContext,
    handler: TowerScriptHandler,
    handlerIndex: number,
    parentSequence?: number
  ): void {
    const handlerId = handler.id ?? String(handlerIndex);
    let actionIndex: number | undefined;
    let actionTraceSequence: number | undefined;
    let handlerTraceSequence: number | undefined;
    try {
      const handlerTrace = this.towerScriptTrace?.record({
        phase: "handler",
        ...(parentSequence === undefined ? {} : { parentSequence }),
        eventName: context.eventName,
        scriptId: context.script.id,
        contextId: context.stateKey,
        handlerId,
        handlerIndex
      });
      handlerTraceSequence = handlerTrace?.sequence;
      if (handlerTrace && this.towerScriptTrace?.shouldPauseBeforeEntry(handlerTrace.sequence)) {
        throw new TowerScriptTracePauseError(handlerTrace.sequence);
      }
      if (context.eventName === "tick" && typeof handler.every === "number") {
        const timerKey = `${context.script.id}:${context.stateKey}:${handlerId}`;
        const lastRun = this.scriptHandlerLastRun[timerKey];
        if (lastRun !== undefined && this.missionElapsed - lastRun + 0.000001 < handler.every) return;
        this.scriptHandlerLastRun[timerKey] = this.missionElapsed;
      }
      const expressionBudget = { remaining: TOWER_SCRIPT_LIMITS.expressionOperationsPerHandler };
      const root = this.scriptExpressionContext(context);
      if (handler.when !== undefined) {
        const result = Boolean(evaluateTowerScriptExpression(handler.when, root, expressionBudget));
        this.towerScriptTrace?.record({
          phase: "condition",
          ...(handlerTrace ? { parentSequence: handlerTrace.sequence } : {}),
          eventName: context.eventName,
          scriptId: context.script.id,
          contextId: context.stateKey,
          handlerId,
          handlerIndex,
          result
        });
        if (!result) return;
      }
      for (const [nextActionIndex, action] of (handler.actions ?? []).entries()) {
        actionIndex = nextActionIndex;
        if (this.scriptActionsRemaining <= 0) {
          this.scriptActionsRemaining = 0;
          throw new Error("TowerScript action budget exceeded.");
        }
        this.scriptActionsRemaining -= 1;
        const stateBefore = this.towerScriptTrace ? this.cloneScriptJsonObject(context.state) : undefined;
        const actionTrace = this.towerScriptTrace?.record({
          phase: "action",
          ...(handlerTrace ? { parentSequence: handlerTrace.sequence } : {}),
          eventName: context.eventName,
          scriptId: context.script.id,
          contextId: context.stateKey,
          handlerId,
          handlerIndex,
          actionIndex,
          action
        });
        actionTraceSequence = actionTrace?.sequence;
        this.applyScriptAction(action, context, root, expressionBudget);
        if (stateBefore && this.towerScriptTrace) {
          const changes = diffTowerScriptState(stateBefore, context.state);
          if (changes.length > 0) {
            this.towerScriptTrace.record({
              phase: "state_diff",
              ...(actionTrace ? { parentSequence: actionTrace.sequence } : {}),
              eventName: context.eventName,
              scriptId: context.script.id,
              contextId: context.stateKey,
              handlerId,
              handlerIndex,
              actionIndex,
              changes
            });
          }
        }
        if (actionTrace && this.towerScriptTrace?.shouldPauseAfterAction(actionTrace.sequence)) {
          throw new TowerScriptTracePauseError(actionTrace.sequence);
        }
      }
    } catch (error) {
      if (error instanceof TowerScriptTracePauseError) throw error;
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
      }, {
        actionIndex,
        contextId: context.stateKey,
        handlerIndex,
        parentSequence: actionTraceSequence ?? handlerTraceSequence
      });
    }
  }

  private scriptContexts(binding: TowerScriptBinding, eventName: TowerScriptEventName, event: Record<string, unknown>): TowerScriptSelfContext[] {
    const accepts = (id: string) => !binding.ids || binding.ids.includes(id);
    if (binding.scope === "global") return [{ scope: "global", id: "global", value: { id: "global" } }];
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
      if (!abilityId || !accepts(abilityId)) return [];
      return [{ scope: "ability", id: abilityId, typeId: abilityId, value: { id: abilityId, ...(this.content.abilities[abilityId] ?? {}) } as Record<string, unknown> }];
    }
    if (binding.scope === "terrain") {
      const coordValue = event.coord ?? event.center ?? event.to;
      if (!coordValue || typeof coordValue !== "object") return [];
      const rawCoord = coordValue as { q?: unknown; r?: unknown };
      if (!Number.isInteger(rawCoord.q) || !Number.isInteger(rawCoord.r)) return [];
      const coord = { q: Number(rawCoord.q), r: Number(rawCoord.r) };
      const terrainId = typeof event.toTerrain === "string"
        ? event.toTerrain
        : typeof event.terrain === "string" ? event.terrain : this.map.getTile(coord)?.terrain;
      if (!terrainId || !accepts(terrainId)) return [];
      return [{
        scope: "terrain",
        id: `${coord.q},${coord.r}`,
        typeId: terrainId,
        value: { ...this.terrainMetadata(terrainId), coord }
      }];
    }
    if (binding.scope === "tower") {
      const candidates: TowerScriptSelfContext[] = [];
      if (eventName === "tick") {
        for (const tower of this.towers) if (accepts(tower.typeId)) candidates.push({ scope: "tower", id: tower.id, typeId: tower.typeId, value: tower as unknown as Record<string, unknown> });
        return candidates;
      }
      const towerIds = [event.towerId, ...(Array.isArray(event.towerIds) ? event.towerIds : [])].filter((value): value is string => typeof value === "string");
      for (const towerId of towerIds) {
        const tower = this.towers.find((item) => item.id === towerId);
        const typeId = tower?.typeId ?? (typeof event.towerTypeId === "string" ? event.towerTypeId : undefined);
        if (typeId && accepts(typeId)) candidates.push({ scope: "tower", id: towerId, typeId, value: tower ? tower as unknown as Record<string, unknown> : { id: towerId, typeId } });
      }
      return candidates;
    }
    if (binding.scope === "enemy") {
      const candidates: TowerScriptSelfContext[] = [];
      if (eventName === "tick") {
        for (const enemy of this.enemies) if (accepts(enemy.typeId)) candidates.push({ scope: "enemy", id: enemy.id, typeId: enemy.typeId, value: enemy as unknown as Record<string, unknown> });
        return candidates;
      }
      const enemyIds = [
        event.enemyId,
        event.targetEnemyId,
        ...(Array.isArray(event.enemyIds) ? event.enemyIds : [])
      ].filter((value): value is string => typeof value === "string");
      for (const enemyId of enemyIds) {
        const enemy = this.enemies.find((item) => item.id === enemyId);
        const typeId = enemy?.typeId ?? (typeof event.enemyTypeId === "string" ? event.enemyTypeId : undefined);
        if (typeId && accepts(typeId)) candidates.push({ scope: "enemy", id: enemyId, typeId, value: enemy ? enemy as unknown as Record<string, unknown> : { id: enemyId, typeId } });
      }
      return candidates;
    }
    return [];
  }

  private scriptStateFor(script: TowerScriptDefinition, stateKey: string): Record<string, TowerScriptJson> {
    const scriptStates = this.scriptValues[script.id] ??= {};
    return scriptStates[stateKey] ??= this.cloneScriptJsonObject(script.initialState ?? {});
  }

  private scriptExpressionContext(context: TowerScriptExecutionContext): Record<string, unknown> {
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

  private scriptMachineComponentContext(
    eventName: TowerScriptEventName,
    event: Record<string, unknown>
  ): Readonly<Record<string, unknown>> | undefined {
    if (eventName !== "bossComponentDamaged" && eventName !== "bossComponentDestroyed") return undefined;
    const enemyTypeId = event.enemyTypeId;
    const componentId = event.componentId;
    if (typeof enemyTypeId !== "string" || typeof componentId !== "string") return undefined;
    const authored = this.activeEnemyBehaviors?.bosses?.[enemyTypeId]?.components[componentId];
    if (!authored) return undefined;
    const hp = Number(event.currentHp);
    const maxHp = Number(event.maxHp);
    const currentShield = Number(event.currentShield);
    const shieldCapacity = Number(event.shieldCapacity);
    const shield = shieldCapacity > 0
      ? Object.freeze({ current: currentShield, capacity: shieldCapacity, ratio: currentShield / shieldCapacity })
      : null;
    return Object.freeze({
      schemaVersion: 1,
      enemyId: String(event.enemyId),
      enemyTypeId,
      id: componentId,
      label: authored.label ?? null,
      hp,
      maxHp,
      hpRatio: hp / maxHp,
      destroyed: hp === 0,
      tags: Object.freeze([...(authored.tags ?? [])].sort(compareBinary)),
      disablesAbilities: Object.freeze([...(authored.disablesAbilities ?? [])].sort(compareBinary)),
      shield
    });
  }

  private applyScriptAction(
    action: TowerScriptAction,
    context: TowerScriptExecutionContext,
    root: Record<string, unknown>,
    budget: { remaining: number }
  ): void {
    const evaluate = (expression: Parameters<typeof evaluateTowerScriptExpression>[0]) => evaluateTowerScriptExpression(expression, root, budget);
    const numberValue = (expression: Parameters<typeof evaluateTowerScriptExpression>[0], fallback = 0) => {
      const value = evaluate(expression);
      return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    };
    if (action.action === "grantResource") {
      if (!this.currencyIds.includes(action.resourceId)) throw new Error(`Unknown runtime currency "${action.resourceId}".`);
      const amount = numberValue(action.amount);
      this.resources[action.resourceId] = Math.max(0, Math.min(1e12, (this.resources[action.resourceId] ?? 0) + amount));
      return;
    }
    if (action.action === "damageCore") {
      this.applyResolvedCoreDamage(
        Math.max(0, numberValue(action.amount)),
        { kind: "tower_script", scriptId: context.script.id }
      );
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
          this.applyResolvedEnemyDamage(
            enemy,
            amount,
            { kind: "tower_script", scriptId: context.script.id }
          );
        } else {
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
        if (!shield) continue;
        shieldTargetCount += 1;
        const previous = shield.current;
        shield.current = Math.min(shield.capacity, previous + amount);
        const restored = shield.current - previous;
        if (restored <= 0) continue;
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
      if (shieldTargetCount === 0) throw new TowerScriptInvalidActionError();
      return;
    }
    if (action.action === "restoreTowerShield") {
      const amount = Math.max(0, numberValue(action.amount));
      let shieldTargetCount = 0;
      for (const tower of this.resolveScriptTowers(action.target, context)) {
        const shield = this.towerShields[tower.id];
        if (!shield) continue;
        shieldTargetCount += 1;
        const previous = shield.current;
        shield.current = Math.min(shield.capacity, previous + amount);
        const restored = shield.current - previous;
        if (restored <= 0) continue;
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
      if (shieldTargetCount === 0) throw new TowerScriptInvalidActionError();
      return;
    }
    if (action.action === "applyEnemyMark") {
      const definition = this.activeCombatMechanics?.marks.definitions[action.markId];
      const stacks = action.stacks === undefined ? 1 : numberValue(action.stacks);
      if (
        !definition
        || !Number.isSafeInteger(stacks)
        || stacks <= 0
        || stacks > definition.maxStacks
      ) {
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
      let firstDropped: EnemyState | undefined;
      for (const enemy of this.resolveScriptEnemies(action.target, context)) {
        const createsLiveExposure = this.enemyExposures[enemy.id]?.[action.exposureId] === undefined;
        if (createsLiveExposure && liveExposureCount >= REACTION_LIMITS.runtimeExposureApplications) {
          dropped += 1;
          firstDropped ??= enemy;
          continue;
        }
        this.applyEnemyExposure(enemy, action.exposureId, stacks, definition.duration, definition.maxStacks, "script");
        if (createsLiveExposure) liveExposureCount += 1;
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
        if (!states || !previous) continue;
        delete states[action.exposureId];
        if (Object.keys(states).length === 0) delete this.enemyExposures[enemy.id];
        this.lastEvents.push({
          type: "enemyExposureChanged", enemyId: enemy.id, enemyTypeId: enemy.typeId,
          exposureId: action.exposureId, previousStacks: previous.stacks, currentStacks: 0,
          previousRemaining: previous.remaining, remaining: 0, cause: "script"
        });
      }
      return;
    }
    if (action.action === "applyStatus") {
      for (const enemy of this.resolveScriptEnemies(action.target, context)) this.applyStatusEffect(enemy, action.status);
      return;
    }
    if (action.action === "setTowerCooldown") {
      const value = Math.max(0, numberValue(action.value));
      for (const tower of this.resolveScriptTowers(action.target, context)) tower.cooldown = value;
      return;
    }
    if (action.action === "addTowerStacks") {
      const amount = Math.trunc(numberValue(action.amount));
      for (const tower of this.resolveScriptTowers(action.target, context)) tower.stacks = Math.max(0, Math.min(999, tower.stacks + amount));
      return;
    }
    if (action.action === "spawnEnemy") {
      const count = Math.max(0, Math.min(TOWER_SCRIPT_LIMITS.spawnedEnemiesPerAction, Math.trunc(action.count === undefined ? 1 : numberValue(action.count, 1))));
      const progress = Math.max(0, numberValue(action.pathProgress ?? 0));
      for (let index = 0; index < count; index += 1) {
        const enemy = this.createEnemyState(action.enemyTypeId, progress, 0, action.routeId);
        if (!enemy) throw new Error(`Unknown enemy type "${action.enemyTypeId}".`);
        this.enemies.push(enemy);
      }
      this.vanguardProtectionIndex = undefined;
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
      if (!coord) throw new Error("TowerScript tile target did not resolve to an in-bounds integer coordinate.");
      if (action.action === "restoreTileTerrain") {
        this.restoreTerrainOverride(coord);
        return;
      }
      const duration = action.duration === undefined ? undefined : numberValue(action.duration);
      if (duration !== undefined && duration <= 0) throw new Error("setTileTerrain duration must be greater than zero.");
      const result = this.applyTerrainOverride(coord, action.terrainId, duration, "script");
      if (!result.ok) throw new Error(result.reason ?? "Unable to change tile terrain.");
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
      } catch (error) {
        if (hadPrevious) context.state[action.key] = previous!;
        else delete context.state[action.key];
        throw error;
      }
      return;
    }
    if (action.action === "incrementState") {
      const current = typeof context.state[action.key] === "number" ? context.state[action.key] as number : 0;
      const next = current + (action.amount === undefined ? 1 : numberValue(action.amount, 1));
      const hadPrevious = Object.prototype.hasOwnProperty.call(context.state, action.key);
      const previous = context.state[action.key];
      context.state[action.key] = Number.isFinite(next) ? Math.max(-1e12, Math.min(1e12, next)) : 0;
      try {
        this.assertScriptStateSize(context);
      } catch (error) {
        if (hadPrevious) context.state[action.key] = previous!;
        else delete context.state[action.key];
        throw error;
      }
      return;
    }
    if (action.action === "emitSignal") {
      if (this.scriptSignalDepth >= TOWER_SCRIPT_LIMITS.signalRecursionDepth) throw new Error("TowerScript signal recursion budget exceeded.");
      const payload = action.payload === undefined ? null : evaluate(action.payload);
      this.lastEvents.push({ type: "scriptSignal", scriptId: context.script.id, signal: action.signal, payload });
      this.scriptSignalDepth += 1;
      this.runScriptEvent("signal", { type: "signal", signal: action.signal, payload, sourceScriptId: context.script.id });
      this.scriptSignalDepth -= 1;
    }
  }

  private applyActiveLegacyTerrainAction(
    action: Extract<TowerScriptAction, { action: "setTileTerrain" | "restoreTileTerrain" }>,
    context: TowerScriptExecutionContext,
    evaluate: (expression: Parameters<typeof evaluateTowerScriptExpression>[0]) => TowerScriptJson
  ): void {
    if (this.scriptTerrainChangesRemaining <= 0) {
      this.scriptTerrainChangesRemaining = 0;
      throw new TowerScriptTerraformingError(
        "budget_exceeded",
        "terraform.operation_budget_exceeded",
        "TowerScript terraforming operation budget exceeded."
      );
    }
    this.scriptTerrainChangesRemaining -= 1;

    const timed = action.action === "setTileTerrain"
      && Object.prototype.hasOwnProperty.call(action, "duration");
    if (timed && this.pendingTerraformExpiryGroups.length >= TERRAFORMING_LIMITS.pendingExpiryGroups) {
      throw new TowerScriptTerraformingError(
        "budget_exceeded",
        "terraform.expiry_group_budget_exceeded",
        `Terraform expiry groups exceed the ${TERRAFORMING_LIMITS.pendingExpiryGroups} group limit.`
      );
    }
    let duration: number | undefined;
    if (timed) {
      const resolvedDuration = evaluate(action.duration!);
      if (typeof resolvedDuration !== "number" || !Number.isFinite(resolvedDuration)
        || resolvedDuration <= 0 || resolvedDuration > TERRAFORMING_LIMITS.duration) {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          "terraform.duration_out_of_range",
          `Terraform duration must be finite and inside (0, ${TERRAFORMING_LIMITS.duration}].`
        );
      }
      duration = resolvedDuration;
    }
    const coord = this.resolveTerraformTarget(action.target, context, evaluate);
    if (!coord) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "Terraform tile target did not resolve to safe integer coordinates."
      );
    }
    if (!this.map.isInside(coord)) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.target_outside_map",
        `Terraform target ${coord.q},${coord.r} is outside the map.`
      );
    }
    if (action.action === "setTileTerrain" && !this.content.terrainTypes[action.terrainId]) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        `Terraform destination terrain "${action.terrainId}" is unknown.`
      );
    }
    const key = coordKey(coord);
    const existing = this.runtimeTerrainOverrides.get(key);
    if (this.isNativeTerraformTargetOwned("terrain", coord) || typeof existing?.expiresIn === "number") {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.target_owned",
        `Terraform terrain target ${key} is owned by a timed override.`
      );
    }
    const operation: ResolvedPersistentOperation = action.action === "setTileTerrain"
      ? { kind: "set_terrain", coord, directTerrainId: action.terrainId, order: 0 }
      : { kind: "restore_terrain", coord, order: 0 };
    this.applyResolvedPersistentOperations([operation], duration);
  }

  private resolveScriptTileTarget(
    target: TowerScriptTileTarget,
    context: TowerScriptExecutionContext,
    evaluate: (expression: Parameters<typeof evaluateTowerScriptExpression>[0]) => TowerScriptJson
  ): HexCoord | undefined {
    if (target === "eventTile") {
      const value = context.event.coord ?? context.event.center ?? context.event.to;
      if (!value || typeof value !== "object") return undefined;
      const coord = value as { q?: unknown; r?: unknown };
      if (!Number.isInteger(coord.q) || !Number.isInteger(coord.r)) return undefined;
      const resolved = { q: Number(coord.q), r: Number(coord.r) };
      return this.map.isInside(resolved) ? resolved : undefined;
    }
    const q = evaluate(target.q);
    const r = evaluate(target.r);
    if (!Number.isInteger(q) || !Number.isInteger(r)) return undefined;
    const coord = { q: Number(q), r: Number(r) };
    return this.map.isInside(coord) ? coord : undefined;
  }

  private applyTerraformTilesAction(
    action: TerraformTilesActionV1,
    context: TowerScriptExecutionContext,
    evaluate: (expression: Parameters<typeof evaluateTowerScriptExpression>[0]) => TowerScriptJson
  ): void {
    // Inactive projects retain the exact legacy path: the generic action slot was consumed by
    // the interpreter, but no terraforming field, expression, budget, or diagnostic is touched.
    if (!this.activeTerraformingMechanics) return;

    let actionPrototype: object | null;
    let actionDescriptors: Record<PropertyKey, PropertyDescriptor>;
    try {
      actionPrototype = Object.getPrototypeOf(action);
      actionDescriptors = Object.getOwnPropertyDescriptors(action) as Record<PropertyKey, PropertyDescriptor>;
    } catch {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "terraformTiles action could not be inspected safely."
      );
    }
    const actionKeys = Reflect.ownKeys(actionDescriptors);
    const allowedActionKeys = new Set(["action", "operations", "duration"]);
    const actionDescriptor = actionDescriptors.action;
    const operationsDescriptor = actionDescriptors.operations;
    if (
      actionPrototype !== Object.prototype
      || actionKeys.some((key) => typeof key !== "string" || !allowedActionKeys.has(key))
      || !actionDescriptor
      || !operationsDescriptor
      || actionKeys.some((key) => {
        const descriptor = actionDescriptors[key];
        return !descriptor?.enumerable || !("value" in descriptor);
      })
      || actionDescriptor.value !== "terraformTiles"
    ) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "terraformTiles must be an exact plain data action."
      );
    }
    const operationValues = this.inspectTerraformOperationArray(operationsDescriptor.value);
    const operationCount = operationValues.length;
    if (operationCount < 1) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "terraformTiles requires at least one operation."
      );
    }
    if (operationCount > this.scriptTerrainChangesRemaining) {
      // C1's public RED contract exhausts the remaining batch budget on a failed reservation.
      this.scriptTerrainChangesRemaining = 0;
      throw new TowerScriptTerraformingError(
        "budget_exceeded",
        "terraform.operation_budget_exceeded",
        "TowerScript terraforming operation budget exceeded."
      );
    }
    this.scriptTerrainChangesRemaining -= operationCount;

    const operations = operationValues.map((value) => this.inspectTerraformOperation(value));
    const timed = Object.prototype.hasOwnProperty.call(actionDescriptors, "duration");
    if (timed && operations.some((operation) => (
      operation.kind === "restore_terrain" || operation.kind === "restore_elevation"
    ))) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "Timed terraforming batches support set operations only."
      );
    }
    if (timed && this.pendingTerraformExpiryGroups.length >= TERRAFORMING_LIMITS.pendingExpiryGroups) {
      throw new TowerScriptTerraformingError(
        "budget_exceeded",
        "terraform.expiry_group_budget_exceeded",
        `Terraform expiry groups exceed the ${TERRAFORMING_LIMITS.pendingExpiryGroups} group limit.`
      );
    }
    let duration: number | undefined;
    if (timed) {
      const durationDescriptor = actionDescriptors.duration!;
      const resolvedDuration = evaluate(
        durationDescriptor.value as Parameters<typeof evaluateTowerScriptExpression>[0]
      );
      if (typeof resolvedDuration !== "number" || !Number.isFinite(resolvedDuration)
        || resolvedDuration <= 0 || resolvedDuration > TERRAFORMING_LIMITS.duration) {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          "terraform.duration_out_of_range",
          `Terraform duration must be finite and inside (0, ${TERRAFORMING_LIMITS.duration}].`
        );
      }
      duration = resolvedDuration;
    }
    const hasElevationOperations = operations.some((operation) => (
      operation.kind === "set_elevation" || operation.kind === "restore_elevation"
    ));
    if (hasElevationOperations && !this.activeElevation) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.elevation_dependency_missing",
        "Elevation terraforming requires an active elevation capability."
      );
    }
    if (hasElevationOperations && !this.activeTerraformingMechanics.elevation) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.elevation_policy_missing",
        "Elevation terraforming requires an active terraforming elevation policy."
      );
    }
    const resolvedOperations = operations.map((operation, order): ResolvedPersistentOperation => {
      const coord = this.resolveTerraformTarget(operation.target, context, evaluate);
      if (!coord) {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          "terraform.invalid_operation",
          "Terraform tile target did not resolve to safe integer coordinates."
        );
      }
      if (operation.kind === "set_terrain") {
        return { kind: "set_terrain", coord, transitionId: operation.transitionId, order };
      }
      if (operation.kind === "restore_terrain") return { kind: "restore_terrain", coord, order };
      if (operation.kind === "restore_elevation") return { kind: "restore_elevation", coord, order };
      const elevation = (
        typeof operation.elevation === "number" && !Number.isFinite(operation.elevation)
      ) ? Number.NaN : evaluate(operation.elevation);
      return {
        kind: "set_elevation",
        coord,
        elevation: typeof elevation === "number" ? elevation : Number.NaN,
        order
      };
    });
    const outside = resolvedOperations.find((operation) => !this.map.isInside(operation.coord));
    if (outside) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.target_outside_map",
        `Terraform target ${outside.coord.q},${outside.coord.r} is outside the map.`
      );
    }
    const targetKeys = new Set<string>();
    for (const operation of resolvedOperations) {
      const layer = operation.kind === "set_terrain" || operation.kind === "restore_terrain"
        ? "terrain"
        : "elevation";
      const coordValue = coordKey(operation.coord);
      const key = `${layer}:${coordValue}`;
      if (targetKeys.has(key)) {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          "terraform.duplicate_target",
          `Terraform ${layer} target ${coordValue} is duplicated in the batch.`
        );
      }
      targetKeys.add(key);
      if (this.isNativeTerraformTargetOwned(layer, operation.coord)) {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          "terraform.target_owned",
          `Terraform ${layer} target ${coordValue} is owned by a timed batch.`
        );
      }
    }

    this.applyResolvedPersistentOperations(resolvedOperations, duration);
  }

  private applyResolvedPersistentOperations(
    resolvedOperations: readonly ResolvedPersistentOperation[],
    duration: number | undefined
  ): void {
    const terrainOperations = resolvedOperations.filter((operation): operation is ResolvedPersistentOperation => (
      operation.kind === "set_terrain" || operation.kind === "restore_terrain"
    ));
    const elevationOperations = resolvedOperations.filter((operation): operation is ResolvedPersistentOperation => (
      operation.kind === "set_elevation" || operation.kind === "restore_elevation"
    ));
    const terrainCandidate = terrainOperations.length > 0
      ? this.planPersistentTerrainCandidate(terrainOperations)
      : undefined;
    const elevationCandidate = elevationOperations.length > 0
      ? this.planPersistentElevationCandidate(elevationOperations)
      : undefined;
    const terrainOverrideCount = terrainCandidate?.overrides.size ?? this.runtimeTerrainOverrides.size;
    const elevationOverrideCount = elevationCandidate?.overrides.size ?? this.runtimeElevationOverrides.size;
    if (terrainOverrideCount + elevationOverrideCount > TERRAFORMING_LIMITS.activeOverridesCombined) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.override_budget_exceeded",
        `Terraform runtime overrides exceed the ${TERRAFORMING_LIMITS.activeOverridesCombined} combined limit.`
      );
    }
    if ((terrainCandidate?.events.length ?? 0) === 0
      && (elevationCandidate?.events.length ?? 0) === 0) {
      return;
    }
    const navigation = terrainCandidate && this.activeNavigationProfile
      ? this.planDynamicPersistentTerrainNavigation(terrainCandidate)
      : undefined;
    let expiryGroup: TerraformExpiryGroupV1 | undefined;
    if (duration !== undefined) {
      const changedTerrainEvents = new Map(
        (terrainCandidate?.events ?? []).map((event) => [event.order, event.event])
      );
      const changedElevationEvents = new Map(
        (elevationCandidate?.events ?? []).map((event) => [event.order, event.event])
      );
      const targets: TerraformExpiryTargetV1[] = [];
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
        } else if (operation.kind === "set_elevation" && elevationEvent?.type === "elevationChanged") {
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
      if (
        owned.terrain + added.terrain > TERRAFORMING_LIMITS.activeTerrainOverrides
        || owned.elevation + added.elevation > TERRAFORMING_LIMITS.activeElevationOverrides
        || owned.combined + added.combined > TERRAFORMING_LIMITS.activeOverridesCombined
      ) {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          "terraform.override_budget_exceeded",
          "Terraform timed ownership exceeds the active per-layer or combined override limit."
        );
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

  private isNativeTerraformTargetOwned(layer: "terrain" | "elevation", coord: HexCoord): boolean {
    const key = `${layer}:${coordKey(coord)}`;
    return this.pendingTerraformExpiryGroups.some((group) => (
      group.targets.some((target) => terraformExpiryTargetKey(target) === key)
    ));
  }

  private inspectTerraformOperationArray(value: unknown): readonly unknown[] {
    let prototype: object | null;
    let lengthDescriptor: PropertyDescriptor | undefined;
    try {
      if (!Array.isArray(value)) {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          "terraform.invalid_operation",
          "Terraform operations must be an ordinary dense array."
        );
      }
      prototype = Object.getPrototypeOf(value);
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    } catch {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "Terraform operations could not be inspected safely."
      );
    }
    if (prototype !== Array.prototype) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "Terraform operations must be an ordinary dense array."
      );
    }
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "Terraform operations array length is invalid."
      );
    }
    if (length > TERRAFORMING_LIMITS.operationsPerBatch) {
      this.scriptTerrainChangesRemaining = 0;
      throw new TowerScriptTerraformingError(
        "budget_exceeded",
        "terraform.operation_budget_exceeded",
        `terraformTiles exceeds the ${TERRAFORMING_LIMITS.operationsPerBatch} operation budget.`
      );
    }

    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
    } catch {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "Terraform operations could not be inspected safely."
      );
    }
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (descriptorKeys.some((key) => {
      if (key === "length") return false;
      return typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length;
    }) || descriptorKeys.length - 1 !== length) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "Terraform operations must be dense own data without extra fields."
      );
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          "terraform.invalid_operation",
          "Terraform operation entries must be enumerable own data."
        );
      }
      result.push(descriptor.value);
    }
    return result;
  }

  private inspectTerraformOperation(value: unknown): TerraformOperationV1 {
    let prototype: object | null;
    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    try {
      prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
      descriptors = value !== null && typeof value === "object"
        ? Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>
        : {};
    } catch {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "Terraform operation could not be inspected safely."
      );
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || prototype !== Object.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "Terraform operation must be a plain own-data object."
      );
    }
    const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          "terraform.invalid_operation",
          `Terraform operation field "${key}" must be enumerable own data.`
        );
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
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "Terraform operation has an unknown kind, missing field, or extra field."
      );
    }
    if (kind === "set_terrain" && typeof fields.transitionId !== "string") {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.invalid_operation",
        "set_terrain requires a transitionId string."
      );
    }
    return Object.freeze({ ...fields }) as unknown as TerraformOperationV1;
  }

  private resolveTerraformTarget(
    target: TerraformOperationV1["target"],
    context: TowerScriptExecutionContext,
    evaluate: (expression: Parameters<typeof evaluateTowerScriptExpression>[0]) => TowerScriptJson
  ): HexCoord | undefined {
    if (target === "eventTile") {
      const value = context.event.coord ?? context.event.center ?? context.event.to;
      if (!value || typeof value !== "object") return undefined;
      const coord = value as { q?: unknown; r?: unknown };
      return Number.isSafeInteger(coord.q) && Number.isSafeInteger(coord.r)
        ? { q: Number(coord.q), r: Number(coord.r) }
        : undefined;
    }
    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    let prototype: object | null;
    try {
      prototype = target !== null && typeof target === "object" ? Object.getPrototypeOf(target) : null;
      descriptors = target !== null && typeof target === "object"
        ? Object.getOwnPropertyDescriptors(target) as Record<PropertyKey, PropertyDescriptor>
        : {};
    } catch {
      return undefined;
    }
    if (target === null || typeof target !== "object" || Array.isArray(target)
      || prototype !== Object.prototype || Object.getOwnPropertySymbols(descriptors).length > 0
      || Object.keys(descriptors).some((key) => key !== "q" && key !== "r")) return undefined;
    const qField = descriptors.q;
    const rField = descriptors.r;
    if (!qField?.enumerable || !("value" in qField) || !rField?.enumerable || !("value" in rField)) {
      return undefined;
    }
    const q = evaluate(qField.value as Parameters<typeof evaluateTowerScriptExpression>[0]);
    const r = evaluate(rField.value as Parameters<typeof evaluateTowerScriptExpression>[0]);
    return Number.isSafeInteger(q) && Number.isSafeInteger(r)
      ? { q: Number(q), r: Number(r) }
      : undefined;
  }

  private planPersistentTerrainCandidate(
    operations: readonly ResolvedPersistentOperation[]
  ): PersistentTerrainCandidate {
    const overrides = new Map<string, RuntimeTerrainOverride>();
    for (const [key, override] of this.runtimeTerrainOverrides) overrides.set(key, { ...override });
    const writes: { coord: HexCoord; terrain: string }[] = [];
    const events: OrderedTerraformEvent[] = [];
    const effectiveTerrain = (coord: HexCoord): string | undefined => (
      overrides.get(coordKey(coord))?.terrain ?? this.map.getBaseTerrain(coord)
    );

    for (const operation of operations) {
      const key = coordKey(operation.coord);
      const currentTerrain = effectiveTerrain(operation.coord);
      const baseTerrain = this.map.getBaseTerrain(operation.coord);
      if (!currentTerrain || !baseTerrain) {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          "terraform.target_outside_map",
          `Terraform target ${key} is outside the map.`
        );
      }
      const existing = overrides.get(key);
      if (typeof existing?.expiresIn === "number") {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          "terraform.target_owned",
          `Terraform target ${key} is owned by a legacy timed override.`
        );
      }
      let nextTerrain: string;
      let eventSource: "script" | "ability" | "restore";
      if (operation.previousTerrainOverride !== undefined) {
        nextTerrain = operation.previousTerrainOverride?.terrain ?? baseTerrain;
        eventSource = "restore";
        if (operation.previousTerrainOverride) {
          overrides.set(key, { ...operation.previousTerrainOverride });
        } else {
          overrides.delete(key);
        }
      } else if (operation.kind === "set_terrain") {
        if (operation.directTerrainId !== undefined) {
          const destination = this.content.terrainTypes[operation.directTerrainId];
          if (!destination) {
            throw new TowerScriptTerraformingError(
              "invalid_action",
              "terraform.invalid_operation",
              `Terraform destination terrain "${operation.directTerrainId}" is unknown.`
            );
          }
          nextTerrain = destination.id;
        } else {
          const transition = this.activeTerraformingMechanics!.terrainTransitions[operation.transitionId!];
          if (!transition) {
            throw new TowerScriptTerraformingError(
              "invalid_action",
              "terraform.transition_missing",
              `Terraform transition "${operation.transitionId}" is not active.`
            );
          }
          const destination = this.content.terrainTypes[transition.toTerrainId];
          if (!destination) {
            throw new TowerScriptTerraformingError(
              "invalid_action",
              "terraform.invalid_operation",
              `Terraform transition destination "${transition.toTerrainId}" is unknown.`
            );
          }
          const sourceTags = this.terrainMetadata(currentTerrain).tags;
          if (!transition.fromTerrainTags.some((tag) => sourceTags.includes(tag))) {
            throw new TowerScriptTerraformingError(
              "invalid_action",
              "terraform.transition_source_tag_mismatch",
              `Terraform transition "${operation.transitionId}" does not admit terrain "${currentTerrain}".`
            );
          }
          nextTerrain = destination.id;
        }
        eventSource = operation.terrainSource ?? "script";
        if (currentTerrain !== nextTerrain) {
          if (nextTerrain === baseTerrain) overrides.delete(key);
          else overrides.set(key, {
            q: operation.coord.q,
            r: operation.coord.r,
            terrain: nextTerrain,
            source: operation.terrainSource ?? "script"
          });
        }
      } else {
        nextTerrain = baseTerrain;
        eventSource = "restore";
        if (currentTerrain !== nextTerrain) overrides.delete(key);
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
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.override_budget_exceeded",
        `Terraform terrain overrides exceed the ${TERRAFORMING_LIMITS.activeTerrainOverrides} entry limit.`
      );
    }

    if (events.length > 0 && !this.activeNavigationProfile) {
      const routes = [...this.map.pathRoutes].sort((left, right) => (
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0
      ));
      const baselineAvailable = routes.every((route) => route.pathCenterline.every((coord) => {
        const terrain = this.map.getTile(coord)?.terrain;
        return terrain !== undefined && this.terrainMetadata(terrain).walkable;
      }));
      const candidateAvailable = routes.every((route) => route.pathCenterline.every((coord) => {
        const terrain = effectiveTerrain(coord);
        return terrain !== undefined && this.terrainMetadata(terrain).walkable;
      }));
      if (!candidateAvailable) {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          baselineAvailable ? "terraform.last_authored_route_blocked" : "terraform.authored_route_unavailable",
          baselineAvailable
            ? "Terraforming would block an authored route."
            : "Authored routes remain unavailable after terraforming."
        );
      }
    }
    return { overrides, writes, events };
  }

  private planPersistentElevationCandidate(
    operations: readonly ResolvedPersistentOperation[]
  ): PersistentElevationCandidate {
    const policy = this.activeTerraformingMechanics?.elevation;
    if (!policy) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.elevation_policy_missing",
        "Elevation terraforming requires an active policy."
      );
    }
    const overrides = new Map<string, RuntimeElevationOverrideV1>();
    for (const [key, override] of this.runtimeElevationOverrides) overrides.set(key, { ...override });
    const writes: { coord: HexCoord; elevation: number }[] = [];
    const events: OrderedTerraformEvent[] = [];
    for (const operation of operations) {
      const key = coordKey(operation.coord);
      const currentElevation = overrides.get(key)?.elevation ?? this.map.getBaseElevation(operation.coord);
      const baseElevation = this.map.getBaseElevation(operation.coord);
      if (currentElevation === undefined || baseElevation === undefined) {
        throw new TowerScriptTerraformingError(
          "invalid_action",
          "terraform.target_outside_map",
          `Terraform target ${key} is outside the map.`
        );
      }
      let nextElevation: number;
      let source: "script" | "restore";
      if (operation.previousElevationOverride !== undefined) {
        nextElevation = operation.previousElevationOverride?.elevation ?? baseElevation;
        source = "restore";
        if (operation.previousElevationOverride) {
          overrides.set(key, { ...operation.previousElevationOverride });
        } else {
          overrides.delete(key);
        }
      } else if (operation.kind === "set_elevation") {
        nextElevation = operation.elevation!;
        if (
          !Number.isSafeInteger(nextElevation)
          || nextElevation < TERRAFORMING_LIMITS.elevationMinimum
          || nextElevation > TERRAFORMING_LIMITS.elevationMaximum
          || nextElevation < policy.minimum
          || nextElevation > policy.maximum
        ) {
          throw new TowerScriptTerraformingError(
            "invalid_action",
            "terraform.elevation_out_of_range",
            "Terraform elevation must be a safe integer inside the active elevation policy."
          );
        }
        if (Math.abs(nextElevation - currentElevation) > policy.maximumDeltaPerOperation) {
          throw new TowerScriptTerraformingError(
            "invalid_action",
            "terraform.elevation_delta_exceeded",
            "Terraform elevation change exceeds the active per-operation delta."
          );
        }
        source = "script";
        if (nextElevation === baseElevation) overrides.delete(key);
        else overrides.set(key, {
          q: operation.coord.q,
          r: operation.coord.r,
          elevation: nextElevation
        });
      } else {
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
      throw new TowerScriptTerraformingError(
        "invalid_action",
        "terraform.override_budget_exceeded",
        `Terraform elevation overrides exceed the ${TERRAFORMING_LIMITS.activeElevationOverrides} entry limit.`
      );
    }
    return { overrides, writes, events };
  }

  private planDynamicPersistentTerrainNavigation(
    candidate: PersistentTerrainCandidate
  ): DynamicTerraformingNavigationPlan {
    const profile = this.activeNavigationProfile;
    if (!profile) throw new Error("Dynamic terraforming navigation requires an active profile.");
    const routes = this.map.pathRoutes;
    const reachableTerrainIds = new Set(
      [...this.map.tiles.values()].map((tile) => tile.terrain)
    );
    if (
      this.mission.abilities?.some((ability) => ability.id === "path_water")
      && this.content.terrainTypes.water
      && this.map.allPathCoords().some((coord) => this.map.getBaseTerrain(coord) === "path")
    ) reachableTerrainIds.add("water");
    const transitionTerrainById = Object.fromEntries(
      Object.keys(this.activeTerraformingMechanics!.terrainTransitions)
        .sort(compareBinary)
        .map((transitionId) => [
          transitionId,
          this.activeTerraformingMechanics!.terrainTransitions[transitionId]!.toTerrainId
        ])
    );
    let safetySet: ReturnType<typeof prepareDynamicTerraformingSafetySet>;
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
    } catch (error) {
      if (error instanceof DynamicTerraformingSafetyBudgetError) {
        throw new TowerScriptTerraformingError(
          "budget_exceeded",
          "terraform.solver_budget_exceeded",
          error.message
        );
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
      candidateResolver: this.createNavigationResolver(
        occupiedCoords,
        this.navigationTerrainByCoordForOverrides(candidate.overrides)
      )
    });
    if (!navigation.candidateAvailable) {
      throw new TowerScriptTerraformingError(
        "invalid_action",
        navigation.baselineAvailable
          ? "terraform.last_path_blocked"
          : "terraform.navigation_unavailable",
        navigation.baselineAvailable
          ? "Terraforming would block the last dynamic path."
          : "Dynamic paths remain unavailable after terraforming."
      );
    }
    return navigation;
  }

  private publishPersistentTerraformCandidate(
    terrainCandidate: PersistentTerrainCandidate | undefined,
    elevationCandidate: PersistentElevationCandidate | undefined,
    navigation?: DynamicTerraformingNavigationPlan
  ): void {
    if (terrainCandidate) {
      for (const write of terrainCandidate.writes) this.map.setTerrain(write.coord, write.terrain);
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
        if (!rebind) continue;
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

  private applyTerrainOverride(
    coord: HexCoord,
    terrainId: string,
    duration: number | undefined,
    source: RuntimeTerrainOverride["source"]
  ): ActionResult {
    const terrain = this.content.terrainTypes[terrainId];
    if (!terrain) return this.fail(`Unknown terrain "${terrainId}".`, "reason.unknownTerrain", { terrainId });
    if (!terrain.walkable && this.map.isPathCoord(coord)) {
      return this.fail("An active route cannot be changed to non-walkable terrain.", "reason.routeMustRemainWalkable");
    }
    const tile = this.map.getTile(coord);
    if (!tile) return this.fail("Tile is outside the map.", "reason.tileOutsideMap");
    const key = coordKey(coord);
    if (this.activeTerraformingMechanics && this.isNativeTerraformTargetOwned("terrain", coord)) {
      return this.fail(
        `Terraform terrain target ${key} is owned by a timed batch.`,
        "terraform.target_owned"
      );
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

  private restoreTerrainOverride(coord: HexCoord): boolean {
    return this.restoreTerrainOverrideByKey(coordKey(coord));
  }

  private restoreTerrainOverrideByKey(key: string): boolean {
    const existing = this.runtimeTerrainOverrides.get(key);
    if (!existing) return false;
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

  private syncTemporaryWaterTiles(): void {
    const legacy = [...this.runtimeTerrainOverrides.values()]
      .filter((entry) => entry.source === "ability" && entry.terrain === "water" && typeof entry.expiresIn === "number")
      .map((entry) => ({ q: entry.q, r: entry.r, expiresIn: entry.expiresIn! }));
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
              if (target.layer !== "terrain" || target.appliedTerrain !== "water") return [];
              const override = this.runtimeTerrainOverrides.get(coordKey(target));
              if (!override || override.source !== "ability" || override.terrain !== "water") return [];
              return [{ q: target.q, r: target.r, expiresIn: group.remaining }];
            }));
    const seen = new Set<string>();
    this.temporaryWaterTiles = [...legacy, ...native].filter((entry) => {
      const key = coordKey(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private terrainMetadata(terrainId: string) {
    return this.content.terrainTypes[terrainId] ?? {
      id: terrainId,
      label: terrainId,
      buildable: false,
      walkable: false,
      groundSpeedMultiplier: 1,
      tags: []
    };
  }

  private resolveScriptEnemies(target: TowerScriptEntityTarget, context: TowerScriptExecutionContext): EnemyState[] {
    if (target === "allEnemies") return this.enemies.filter((enemy) => enemy.hp > 0);
    const id = target === "self" && context.self.scope === "enemy"
      ? context.self.id
      : target === "eventEnemy" && typeof context.event.enemyId === "string" ? context.event.enemyId : null;
    const enemy = id ? this.enemies.find((item) => item.id === id && item.hp > 0) : undefined;
    return enemy ? [enemy] : [];
  }

  private resolveScriptTowers(target: TowerScriptEntityTarget, context: TowerScriptExecutionContext): TowerState[] {
    if (target === "allTowers") return [...this.towers];
    const id = target === "self" && context.self.scope === "tower"
      ? context.self.id
      : target === "eventTower" && typeof context.event.towerId === "string" ? context.event.towerId : null;
    const tower = id ? this.towers.find((item) => item.id === id) : undefined;
    return tower ? [tower] : [];
  }

  private assertScriptStateSize(context: TowerScriptExecutionContext): void {
    try {
      canonicalStringify(context.state, {
        maxDepth: 64,
        maxNodes: 100_000,
        maxBytes: TOWER_SCRIPT_LIMITS.stateBytesPerBinding
      });
    } catch {
      throw new Error(`TowerScript state for ${context.stateKey} exceeds the canonical JSON limit.`);
    }
  }

  private recordScriptDiagnostic(
    diagnostic: TowerScriptDiagnostic,
    trace?: { actionIndex?: number; contextId?: string; handlerIndex?: number; parentSequence?: number }
  ): void {
    this.scriptDiagnostics.push(diagnostic);
    if (this.scriptDiagnostics.length > TOWER_SCRIPT_LIMITS.retainedDiagnostics) this.scriptDiagnostics.shift();
    this.lastEvents.push({ type: "scriptDiagnostic", diagnostic });
    this.towerScriptTrace?.record({
      phase: "diagnostic",
      ...(trace?.parentSequence === undefined ? {} : { parentSequence: trace.parentSequence }),
      eventName: diagnostic.event,
      scriptId: diagnostic.scriptId,
      handlerId: diagnostic.handlerId,
      ...(trace?.contextId === undefined ? {} : { contextId: trace.contextId }),
      ...(trace?.handlerIndex === undefined ? {} : { handlerIndex: trace.handlerIndex }),
      ...(trace?.actionIndex === undefined ? {} : { actionIndex: trace.actionIndex }),
      diagnostic
    });
  }

  private cloneScriptJsonObject(value: Record<string, TowerScriptJson>): Record<string, TowerScriptJson> {
    return JSON.parse(JSON.stringify(value)) as Record<string, TowerScriptJson>;
  }

  private cloneScriptValues(): Record<string, Record<string, Record<string, TowerScriptJson>>> {
    return JSON.parse(JSON.stringify(this.scriptValues)) as Record<string, Record<string, Record<string, TowerScriptJson>>>;
  }

  private cloneScriptMachines(): Record<string, Record<string, Record<string, TowerScriptMachineRuntimeStateV1>>> {
    return Object.fromEntries(Object.keys(this.scriptMachines).sort(compareBinary).map((scriptId) => [
      scriptId,
      Object.fromEntries(Object.keys(this.scriptMachines[scriptId] ?? {}).sort(compareBinary).map((machineId) => [
        machineId,
        Object.fromEntries(Object.keys(this.scriptMachines[scriptId]?.[machineId] ?? {}).sort(compareBinary).map((contextId) => [
          contextId,
          { ...this.scriptMachines[scriptId]![machineId]![contextId]! }
        ]))
      ]))
    ]));
  }

  enemyCoord(enemy: EnemyState): HexCoord {
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

  private coordEquals(left: HexCoord, right: HexCoord): boolean {
    return left.q === right.q && left.r === right.r;
  }

  /** Resolve one opt-in displacement effect without adding persistent physics state. */
  private applyDisplacementEffect(
    enemy: EnemyState,
    effectValue: unknown,
    source: DisplacementSource
  ): void {
    const profile = this.activePhysicsMechanics;
    if (!profile || enemy.hp <= 0) return;
    const effect = parseDisplacementEffectV1(effectValue);
    if (!effect) return;
    const from = this.enemyCoord(enemy);
    const sourceCoord = { ...source.sourceCoord };
    const emitResolved = (
      to: HexCoord,
      movedDistance: number,
      stopReason: RuntimeDisplacementStopReason
    ): void => {
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
    if (
      this.enemyTargetClass(enemy) === "flying"
      || profile.displacementImmuneEnemyTypeIds.includes(enemy.typeId)
    ) {
      emitResolved(from, 0, "immune");
      return;
    }

    let goalBlocked = false;
    let fallTag: string | undefined;
    let applyPlanPosition: (to: HexCoord, fell: boolean, steps: readonly HexCoord[]) => void;
    let classifyCandidate: (coord: HexCoord) => "open" | "blocked" | "fall_hazard";

    if (enemy.navigation && this.activeNavigationProfile && enemy.routeId) {
      const navigation = enemy.navigation;
      const field = this.navigationField(navigation.movementProfileId, enemy.routeId);
      const lookup = this.navigationFieldLookupCache?.get(field);
      if (!lookup) return;
      const goal = this.resolveDynamicNavigationRoute(enemy.routeId).pathCenterline.at(-1);
      classifyCandidate = (candidate) => {
        const tile = this.map.getTile(candidate);
        if (!tile) return "blocked";
        if (goal && this.coordEquals(candidate, goal)) {
          goalBlocked = true;
          return "blocked";
        }
        const tag = profile.fallHazardTerrainTags.find((candidateTag) => (
          this.terrainMetadata(tile.terrain).tags.includes(candidateTag)
        ));
        if (tag) {
          if (profile.fallImmuneEnemyTypeIds.includes(enemy.typeId)) return "blocked";
          fallTag = tag;
          return "fall_hazard";
        }
        return lookup.get(candidate) ? "open" : "blocked";
      };
      applyPlanPosition = (to, fell, steps) => {
        const destination = fell ? (steps.at(-2) ?? from) : to;
        const cell = lookup.get(destination);
        navigation.currentCoord = { ...destination };
        if (cell?.nextCoord) navigation.nextCoord = { ...cell.nextCoord };
        else delete navigation.nextCoord;
        navigation.edgeProgress = 0;
        enemy.pathProgress = navigation.stepsEntered;
        this.vanguardProtectionIndex = undefined;
      };
    } else {
      const track = this.enemyTrack(enemy);
      const anchorIndex = Math.min(Math.round(enemy.pathProgress), Math.max(0, track.length - 1));
      let currentIndex = anchorIndex;
      const indicesByCoord = new Map<string, number[]>();
      for (let index = 0; index < track.length; index += 1) {
        const coord = track[index]!;
        const key = coordKey(coord);
        const indices = indicesByCoord.get(key) ?? [];
        indices.push(index);
        indicesByCoord.set(key, indices);
      }
      classifyCandidate = (candidate) => {
        const currentCoord = track[currentIndex];
        const currentIndices = currentCoord ? indicesByCoord.get(coordKey(currentCoord)) : undefined;
        if (!currentCoord || currentIndices?.length !== 1) return "blocked";
        const indices = indicesByCoord.get(coordKey(candidate));
        if (!indices || indices.length !== 1) return "blocked";
        const candidateIndex = indices[0]!;
        if (candidateIndex === track.length - 1) {
          goalBlocked = true;
          return "blocked";
        }
        if (Math.abs(candidateIndex - currentIndex) !== 1
          || this.map.distance(currentCoord, candidate) !== 1) return "blocked";
        const tile = this.map.getTile(candidate);
        if (!tile) return "blocked";
        const tag = profile.fallHazardTerrainTags.find((candidateTag) => (
          this.terrainMetadata(tile.terrain).tags.includes(candidateTag)
        ));
        if (tag) {
          if (profile.fallImmuneEnemyTypeIds.includes(enemy.typeId)) return "blocked";
          fallTag = tag;
          currentIndex = candidateIndex;
          return "fall_hazard";
        }
        if (tile.occupiedBy || !this.terrainMetadata(tile.terrain).walkable) return "blocked";
        currentIndex = candidateIndex;
        return "open";
      };
      applyPlanPosition = (to) => {
        const indices = indicesByCoord.get(coordKey(to));
        if (indices?.length === 1) enemy.pathProgress = indices[0]!;
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
    const stopReason = goalBlocked ? "goal_blocked" : plan.stopReason as DisplacementStopReason;
    emitResolved(plan.to, plan.movedDistance, stopReason);
    if (!plan.fell || !fallTag) return;
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

  private navigationMovementProfileId(typeId: string): string {
    const profile = this.activeNavigationProfile;
    if (!profile) throw new Error("Dynamic enemy navigation requires an active profile.");
    return profile.enemyMovementProfiles?.[typeId] ?? profile.defaultMovementProfileId;
  }

  private activeHeroesV2():
    | ActiveHeroesMechanicsV2
    | ActiveHeroesMechanicsV3
    | ActiveHeroesMechanicsV4
    | ActiveHeroesMechanicsV5
    | ActiveHeroesMechanicsV6
    | ActiveHeroesMechanicsV7
    | undefined {
    return this.activeHeroesMechanics?.schemaVersion === 2
      || this.activeHeroesMechanics?.schemaVersion === 3
      || this.activeHeroesMechanics?.schemaVersion === 4
      || this.activeHeroesMechanics?.schemaVersion === 5
      || this.activeHeroesMechanics?.schemaVersion === 6
      || this.activeHeroesMechanics?.schemaVersion === 7
      ? this.activeHeroesMechanics
      : undefined;
  }

  private heroSkillManagementAvailable(): boolean {
    if (this.outcome !== "playing" || this.enemies.length > 0 || this.spawnQueue.length > 0) return false;
    const setup = this.waveState === "ready" && this.startedWaveCount === 0;
    const interwave = this.waveState === "between"
      && this.startedWaveCount > 0
      && this.startedWaveCount < this.mission.waves.length;
    return setup || interwave;
  }

  private heroAbilitySkillModifiers(
    profile: ActiveHeroesMechanicsV5 | ActiveHeroesMechanicsV6 | ActiveHeroesMechanicsV7,
    state: HeroRuntimeStateV2
  ): readonly ModifierSpec[] {
    const tree = profile.definitions[state.definitionId]?.skillTree;
    if (!tree || !state.unlockedSkillIds) return Object.freeze([]);
    const modifiers: ModifierSpec[] = [];
    for (const skillId of [...state.unlockedSkillIds].sort(compareBinary)) {
      const node = tree.nodes[skillId];
      if (!node) continue;
      for (let effectIndex = 0; effectIndex < node.effects.length; effectIndex += 1) {
        const effect = node.effects[effectIndex]!;
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

  private heroPassiveAuraActive(): boolean {
    const cached = this.activeHeroPassiveAura;
    const state = this.heroStateV2;
    return cached !== undefined
      && state !== undefined
      && state.definitionId === cached.definitionId
      && this.outcome === "playing"
      && (state.hp ?? 0) > 0;
  }

  private heroPassiveAuraAffectedTowerIds(): readonly string[] {
    const cached = this.activeHeroPassiveAura;
    if (!cached) return EMPTY_FROZEN_ARRAY;
    const state = this.heroStateV2;
    if (!state || !this.heroPassiveAuraActive()) return EMPTY_FROZEN_ARRAY;
    return Object.freeze(this.towers
      .filter((tower) => (tower.hp === undefined || tower.hp > 0)
        && this.map.distance(state.currentCoord, tower.coord) <= cached.aura.radius)
      .map((tower) => tower.id)
      .sort(compareBinary));
  }

  private heroPassiveAuraModifiersForTower(tower: TowerState): readonly ModifierSpec[] {
    const cached = this.activeHeroPassiveAura;
    if (!cached) return EMPTY_FROZEN_ARRAY;
    const state = this.heroStateV2;
    if (!state || !this.heroPassiveAuraActive()
      || (tower.hp !== undefined && tower.hp <= 0)
      || this.map.distance(state.currentCoord, tower.coord) > cached.aura.radius) {
      return EMPTY_FROZEN_ARRAY;
    }
    return cached.modifiers;
  }

  private buildHeroMovementField(
    profile: ActiveHeroesMechanicsV2 | ActiveHeroesMechanicsV3 | ActiveHeroesMechanicsV4
      | ActiveHeroesMechanicsV5 | ActiveHeroesMechanicsV6 | ActiveHeroesMechanicsV7,
    target: Readonly<HexCoord>
  ): NavigationFieldResult {
    const definition = profile.definitions[profile.selectedHeroId]!;
    const movementProfileId = definition.movement.movementProfileId;
    return buildNavigationField({
      grid: this.map.grid,
      width: this.map.width,
      height: this.map.height,
      movementProfileId,
      goal: { q: target.q, r: target.r },
      profile: profile.movementProfiles[movementProfileId]!,
      terrainTypes: this.content.terrainTypes,
      terrainByCoord: this.navigationTerrainByCoord(),
      occupiedCoords: this.navigationOccupiedCoords()
    });
  }

  private stabilizeHeroMovement(): void {
    const profile = this.activeHeroesV2();
    const state = this.heroStateV2;
    if (!profile || !state || !this.heroMovementDirty) return;
    this.heroMovementDirty = false;
    if (state.targetCoord === null) {
      state.nextCoord = null;
      state.edgeProgress = 0;
      this.heroMovementField = undefined;
      return;
    }
    let field: NavigationFieldResult;
    try {
      field = this.buildHeroMovementField(profile, state.targetCoord);
    } catch {
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

  private moveHeroUnit(delta: number): void {
    const profile = this.activeHeroesV2();
    const state = this.heroStateV2;
    if (!profile || !state) return;
    if (profile.schemaVersion >= 3 && (state.hp ?? 0) <= 0) return;
    this.stabilizeHeroMovement();
    if (state.targetCoord === null || !this.heroMovementField) return;
    const definition = profile.definitions[state.definitionId];
    if (!definition) return;
    const lookup = this.heroMovementLookupCache.get(this.heroMovementField);
    let movementBudget = Math.max(0, definition.movement.speed * delta * 1_000);
    let entered = 0;
    while (entered < NAVIGATION_LIMITS.activeMapCells) {
      if (state.targetCoord === null) break;
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
      if (enteredCost === undefined || movementBudget <= 0) break;
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

  private updateHeroAbility(delta: number): void {
    const profile = this.activeHeroesMechanics;
    const state = this.heroStateV2;
    if ((profile?.schemaVersion !== 4 && profile?.schemaVersion !== 5 && profile?.schemaVersion !== 6
      && profile?.schemaVersion !== 7)
      || !state || (state.hp ?? 0) <= 0) return;
    const definition = profile.definitions[state.definitionId];
    if (!definition) return;
    state.mana = Math.min(
      definition.mana.max,
      (state.mana ?? 0) + definition.mana.regenerationPerUnit * delta
    );
    state.abilityCooldownRemaining = Math.max(0, (state.abilityCooldownRemaining ?? 0) - delta);
  }

  private navigationField(movementProfileId: string, routeId: string): NavigationFieldResult {
    const resolver = this.navigationResolver;
    if (!resolver) throw new Error("Dynamic enemy navigation requires an active resolver.");
    return resolver.getField(movementProfileId, routeId);
  }

  private createEnemyNavigationState(
    enemyId: string,
    typeId: string,
    routeId: string,
    pathProgress: number
  ): EnemyNavigationStateV1 {
    const movementProfileId = this.navigationMovementProfileId(typeId);
    const route = this.resolveDynamicNavigationRoute(routeId);
    const source = route.pathCenterline[0] ?? route.pathCenterline.at(-1);
    if (!source) throw new Error(`Dynamic navigation route "${route.id}" has no endpoint.`);
    const field = this.navigationField(movementProfileId, route.id);
    const lookup = this.navigationFieldLookupCache?.get(field);
    if (!lookup) throw new Error("Dynamic enemy navigation lookup cache is unavailable.");
    const state: EnemyNavigationStateV1 = {
      schemaVersion: 1,
      movementProfileId,
      currentCoord: { q: source.q, r: source.r },
      edgeProgress: 0,
      stepsEntered: 0
    };
    let remainingSteps = Math.min(
      NAVIGATION_LIMITS.activeMapCells,
      Math.max(0, Math.floor(Number.isFinite(pathProgress) ? pathProgress : 0))
    );
    while (remainingSteps > 0) {
      const cell = lookup.get(state.currentCoord);
      if (!cell?.nextCoord) break;
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

  private createDynamicChildEnemyState(
    parent: EnemyState,
    typeId: string,
    routeId: string,
    pathOffset: number,
    forwardSteps: number
  ): EnemyState | null {
    const child = this.createEnemyState(typeId, 0, pathOffset, routeId);
    if (!child || !parent.navigation || !child.navigation || !child.routeId) return child;
    const field = this.navigationField(child.navigation.movementProfileId, child.routeId);
    const lookup = this.navigationFieldLookupCache?.get(field);
    if (!lookup) return child;
    let currentCoord = { ...parent.navigation.currentCoord };
    let stepsEntered = parent.navigation.stepsEntered;
    let cell = lookup.get(currentCoord);
    const parentEdgeIsCanonical = Boolean(
      parent.navigation.nextCoord
      && cell?.nextCoord
      && parent.navigation.nextCoord.q === cell.nextCoord.q
      && parent.navigation.nextCoord.r === cell.nextCoord.r
    );
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
    if (cell?.nextCoord) edgeProgress = Math.min(0.999999999999, edgeProgress + remaining);
    else edgeProgress = 0;
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

  private stabilizeDynamicEnemyNavigation(): void {
    if (!this.activeNavigationProfile || !this.navigationResolver) return;
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
      if (
        installedField
        && this.navigationResolver.isFieldCurrent(installedField, movementProfileId, routeId)
      ) continue;
      const field = this.navigationField(movementProfileId, routeId);
      if (installedField === field) continue;
      const lookup = this.navigationFieldLookupCache?.get(field);
      const cell = lookup?.get(enemy.navigation.currentCoord);
      const edgeRemainsCanonical = Boolean(
        enemy.navigation.nextCoord
        && cell?.nextCoord
        && enemy.navigation.nextCoord.q === cell.nextCoord.q
        && enemy.navigation.nextCoord.r === cell.nextCoord.r
        && lookup?.enteredCost(cell) !== undefined
      );
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

  private directorTowerTargetClasses(type: TowerType): readonly EnemyTargetClass[] {
    const attack = type.attack;
    if (attack.kind === "support" || attack.kind === "support_buff") return Object.freeze([]);
    if (attack.kind === "antiair") return Object.freeze(["flying"]);
    if (attack.kind === "pipeline") {
      const classes: readonly EnemyTargetClass[] = attack.targeting?.classes?.length
        ? attack.targeting.classes
        : ["ground"];
      return Object.freeze([...classes]
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort(compareBinary));
    }
    if (attack.kind === "splash" && attack.affectsClasses?.length) {
      return Object.freeze([...attack.affectsClasses]
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort(compareBinary));
    }
    return Object.freeze(["ground"]);
  }

  private directorTowerDamageTypes(type: TowerType): readonly string[] {
    const attack = type.attack;
    if (attack.kind === "support" || attack.kind === "support_buff") return Object.freeze([]);
    if (attack.kind === "pipeline") {
      return Object.freeze(attack.effects
        .filter((effect) => effect.kind === "damage")
        .map((effect) => effect.damageType ?? "physical")
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort(compareBinary));
    }
    return Object.freeze(["damageType" in attack && typeof attack.damageType === "string"
      ? attack.damageType
      : "physical"]);
  }

  private directorDefenseAnalysis(): DirectorDefenseAnalysisV1 {
    const damageCounts: Record<string, number> = {};
    const coverageCounts: Record<string, number> = {};
    let damageTotal = 0;
    let coverageTotal = 0;
    const targetClassesByTower = new Map<string, readonly EnemyTargetClass[]>();
    for (const tower of [...this.towers].sort((left, right) => compareBinary(left.id, right.id))) {
      const type = this.towerTypes[tower.typeId];
      if (!type) continue;
      const damageTypes = this.directorTowerDamageTypes(type);
      for (const damageType of damageTypes) damageCounts[damageType] = (damageCounts[damageType] ?? 0) + 1;
      damageTotal += damageTypes.length;
      const targetClasses = this.directorTowerTargetClasses(type);
      if (targetClasses.length === 0) continue;
      targetClassesByTower.set(tower.id, targetClasses);
      for (const targetClass of targetClasses) coverageCounts[targetClass] = (coverageCounts[targetClass] ?? 0) + 1;
      coverageTotal += 1;
    }
    const share = (record: Readonly<Record<string, number>>, total: number) => Object.freeze(Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, total > 0 ? record[key]! / total : 0])
    ));
    let logisticsBrownoutRatio = 0;
    if (this.activeLogisticsPower) {
      const consumers = this.ensureLogisticsPowerSnapshot().power.consumers;
      logisticsBrownoutRatio = consumers.length === 0
        ? 0
        : consumers.filter((consumer) => !consumer.powered).length / consumers.length;
    }
    const coverageRatios = share(coverageCounts, coverageTotal);
    let movementLayerShares = coverageRatios;
    if (this.activeNavigationProfile) {
      const classesByProfile = new Map<string, Set<EnemyTargetClass>>();
      for (const profileId of Object.keys(this.activeNavigationProfile.movementProfiles).sort(compareBinary)) {
        classesByProfile.set(profileId, new Set());
      }
      for (const enemyTypeId of Object.keys(this.enemyTypes).sort(compareBinary)) {
        const profileId = this.activeNavigationProfile.enemyMovementProfiles?.[enemyTypeId]
          ?? this.activeNavigationProfile.defaultMovementProfileId;
        classesByProfile.get(profileId)?.add(this.enemyTargetClassByType(enemyTypeId));
      }
      movementLayerShares = Object.freeze(Object.fromEntries(
        [...classesByProfile.entries()].sort(([left], [right]) => compareBinary(left, right)).map(([profileId, classes]) => {
          const supported = [...targetClassesByTower.values()].filter((towerClasses) => (
            [...classes].some((targetClass) => towerClasses.includes(targetClass))
          )).length;
          return [profileId, coverageTotal > 0 ? supported / coverageTotal : 0];
        })
      ));
    }
    return Object.freeze({
      damageShares: share(damageCounts, damageTotal),
      coverageRatios,
      movementLayerShares,
      logisticsBrownoutRatio
    });
  }

  private planDirectorWave(waveIndex: number, authoredWave: GameContentRegistry["missions"][string]["waves"][number]) {
    const profile = this.activeDirectorMechanics;
    if (!profile) return undefined;
    return planDirectorWaveV1(profile, {
      nextWaveIndex: waveIndex,
      nextWave: authoredWave,
      analysis: this.directorDefenseAnalysis(),
      recentCounterIds: this.directorDecisions.slice(-DIRECTOR_LIMITS.decisionHistory).map((decision) => decision.counterId)
    });
  }

  private startWave(waveIndex: number, startedAt: number, earlyStartUnits = 0): ActionResult {
    const authoredWave = this.mission.waves[waveIndex];
    const plan = authoredWave ? this.planDirectorWave(waveIndex, authoredWave) : undefined;
    const wave = plan?.wave ?? authoredWave;
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
    if (plan) {
      const decision = Object.freeze({
        waveIndex,
        counterId: plan.decision.counterId,
        threatCost: plan.decision.threatCost,
        reason: Object.freeze({ ...plan.decision.reason }),
        addedGroups: Object.freeze(plan.decision.addedGroups.map((group) => Object.freeze({ ...group })))
      });
      this.directorDecisions = Object.freeze([
        ...this.directorDecisions.slice(-(DIRECTOR_LIMITS.decisionHistory - 1)),
        decision
      ]);
      this.lastEvents.push({ type: "directorDecision", ...decision });
    }
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
    this.startWeatherWave(waveIndex);
    return { ok: true };
  }

  private startScheduledWaves(): void {
    if (this.pendingDraftOffer) return;
    while (
      this.nextWaveStartAt !== null &&
      this.startedWaveCount < this.mission.waves.length &&
      this.missionElapsed + 0.0001 >= this.nextWaveStartAt
    ) {
      const scheduledAt = this.nextWaveStartAt;
      this.startWave(this.startedWaveCount, scheduledAt);
    }
  }

  private buildSpawnQueue(
    wave: Readonly<{ readonly groups: readonly WaveGroup[] }> | undefined = this.mission.waves[this.waveIndex],
    baseAt = 0
  ): SpawnItem[] {
    const queue: SpawnItem[] = [];
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

  private spawnDueEnemies(): void {
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

  private createEnemyState(typeId: string, pathProgress: number, pathOffset: number, routeId?: string): EnemyState | null {
    const type = this.enemyTypes[typeId];
    if (!type) {
      return null;
    }

    const resolvedRouteId = this.activeNavigationProfile
      ? this.resolveDynamicNavigationRoute(routeId).id
      : this.enemyTargetClassByType(typeId) === "ground" ? this.resolveRouteId(routeId) : undefined;
    const trackEnd = Math.max(0, this.enemyTrackForType(typeId, resolvedRouteId).length - 1);
    const enemy: EnemyState = {
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
    this.initializeEnemyComponents(enemy);
    return enemy;
  }

  private initializeEnemyComponents(enemy: EnemyState): void {
    const authored = this.activeEnemyBehaviors?.bosses?.[enemy.typeId]?.components;
    if (!authored) return;
    const multiplier = this.difficulty.enemyHpMultiplier ?? 1;
    this.enemyComponentStates[enemy.id] = Object.fromEntries(Object.keys(authored).sort(compareBinary).map((componentId) => {
      const definition = authored[componentId]!;
      const maxHp = definition.maxHp * multiplier;
      return [componentId, {
        hp: maxHp,
        maxHp,
        ...(definition.shield === undefined ? {} : {
          shield: {
            current: definition.shield.capacity,
            capacity: definition.shield.capacity,
            regenerationDelayRemaining: 0
          }
        })
      }];
    }));
  }

  private enemyAbilityEnabled(
    enemy: EnemyState,
    abilityId: "towerAttack" | "towerDisrupt" | "healAura"
  ): boolean {
    const definitions = this.activeEnemyBehaviors?.bosses?.[enemy.typeId]?.components;
    const states = this.enemyComponentStates[enemy.id];
    if (!definitions || !states) return true;
    for (const componentId of Object.keys(definitions).sort(compareBinary)) {
      if ((states[componentId]?.hp ?? 0) <= 0 && definitions[componentId]?.disablesAbilities?.includes(abilityId)) {
        return false;
      }
    }
    return true;
  }

  private towerComponentTargetId(enemy: EnemyState, towerTypeId: string): string | undefined {
    const binding = this.activeEnemyBehaviors?.targeting?.towers[towerTypeId];
    const definitions = this.activeEnemyBehaviors?.bosses?.[enemy.typeId]?.components;
    const states = this.enemyComponentStates[enemy.id];
    if (!binding || !definitions || !states) return undefined;
    const componentIds = Object.keys(definitions).sort(compareBinary);
    for (const tag of binding.priorityTags) {
      const componentId = componentIds.find((candidateId) => (
        (states[candidateId]?.hp ?? 0) > 0
        && definitions[candidateId]?.tags?.includes(tag)
      ));
      if (componentId !== undefined) return componentId;
    }
    return undefined;
  }

  private initializeEnemyShield(enemy: EnemyState): void {
    const definition = this.combatShieldDefinitions?.enemies[enemy.typeId];
    if (!definition) return;
    this.enemyShields[enemy.id] = {
      current: definition.capacity,
      capacity: definition.capacity,
      regenerationDelayRemaining: 0
    };
  }

  private initializeTowerShield(tower: TowerState): void {
    const definition = this.combatShieldDefinitions?.towers[tower.typeId];
    if (!definition) return;
    this.towerShields[tower.id] = {
      current: definition.capacity,
      capacity: definition.capacity,
      regenerationDelayRemaining: 0
    };
  }

  private runtimeMarkApplicationCount(): number {
    let count = 0;
    for (const marks of Object.values(this.enemyMarks)) count += Object.keys(marks).length;
    return count;
  }

  private applyEnemyMark(
    enemy: EnemyState,
    markId: string,
    stacks: number,
    cause: "application" | "script"
  ): boolean {
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
    if (currentStacks === previousStacks && definition.duration === previousRemaining) return false;
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

  private clearEnemyMark(
    enemy: EnemyState,
    markId: string,
    cause: "consume" | "expiration" | "script",
    consumedStacks?: number
  ): boolean {
    const enemyMarkState = this.enemyMarks[enemy.id];
    const previous = enemyMarkState?.[markId];
    if (!enemyMarkState || !previous) return false;
    const currentStacks = consumedStacks === undefined ? 0 : Math.max(0, previous.stacks - consumedStacks);
    const remaining = currentStacks > 0 ? previous.remaining : 0;
    if (currentStacks > 0) enemyMarkState[markId] = { stacks: currentStacks, remaining };
    else delete enemyMarkState[markId];
    if (Object.keys(enemyMarkState).length === 0) delete this.enemyMarks[enemy.id];
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

  private updateEnemyMarks(delta: number): void {
    if (delta <= 0) return;
    for (const enemy of this.enemies) {
      const marks = this.enemyMarks[enemy.id];
      if (!marks) continue;
      for (const markId of Object.keys(marks).sort()) {
        const state = marks[markId];
        if (!state) continue;
        const remaining = Math.max(0, state.remaining - delta);
        if (remaining <= 1e-9) this.clearEnemyMark(enemy, markId, "expiration");
        else marks[markId] = { stacks: state.stacks, remaining };
      }
    }
  }

  private activeMarkDamageContext(enemy: EnemyState): DamageResolutionContext["marks"] {
    const states = this.enemyMarks[enemy.id];
    if (!states) return undefined;
    return Object.keys(states).sort().flatMap((markId) => {
      const state = states[markId];
      const definition = this.activeCombatMechanics?.marks.definitions[markId];
      if (!state || !definition) return [];
      return [{
        markId,
        stacks: state.stacks,
        multiplier: definition.multiplier,
        consumePolicy: definition.consumePolicy,
        ...(definition.damageTypes === undefined ? {} : { damageTypes: definition.damageTypes })
      }];
    });
  }

  private consumeResolvedMarks(enemy: EnemyState, resolution: DamageResolution): void {
    if (resolution.afterModifiers <= 0) return;
    for (const step of resolution.markTrace ?? []) {
      if (step.consumePolicy === "retain") continue;
      this.clearEnemyMark(
        enemy,
        step.markId,
        "consume",
        step.consumePolicy === "consume_one" ? 1 : undefined
      );
    }
  }

  private applySourceMarkBindings(enemy: EnemyState, packet: DamagePacket, resolution: DamageResolution): void {
    if (
      enemy.hp <= 0
      || resolution.finalAmount <= 0
      || packet.tags?.includes("over_time")
      || !this.activeCombatMechanics
    ) return;
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

  private updateShieldRegeneration(delta: number): void {
    if (delta <= 0 || (!this.combatShieldDefinitions && !this.activeEnemyBehaviors)) return;
    const regenerate = (
      state: ShieldStateV1,
      definition: { readonly regeneration?: { readonly ratePerUnit: number; readonly delayAfterDamage?: number } },
      emitFull: (previous: number, amount: number) => void
    ) => {
      const regeneration = definition.regeneration;
      if (!regeneration || state.current >= state.capacity) return;
      let available = delta;
      if (state.regenerationDelayRemaining > 0) {
        const consumed = Math.min(available, state.regenerationDelayRemaining);
        state.regenerationDelayRemaining = Math.max(0, state.regenerationDelayRemaining - consumed);
        available -= consumed;
      }
      if (available <= 0) return;
      const previous = state.current;
      state.current = Math.min(state.capacity, state.current + regeneration.ratePerUnit * available);
      if (previous < state.capacity && state.current === state.capacity) {
        emitFull(previous, state.current - previous);
      }
    };

    for (const enemy of this.enemies) {
      const state = this.enemyShields[enemy.id];
      const definition = this.combatShieldDefinitions?.enemies[enemy.typeId];
      if (!state || !definition) continue;
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
      const definition = this.combatShieldDefinitions?.towers[tower.typeId];
      if (!state || !definition) continue;
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
    for (const enemy of this.enemies) {
      const definitions = this.activeEnemyBehaviors?.bosses?.[enemy.typeId]?.components;
      const states = this.enemyComponentStates[enemy.id];
      if (!definitions || !states) continue;
      for (const componentId of Object.keys(definitions).sort(compareBinary)) {
        const definition = definitions[componentId];
        const state = states[componentId]?.shield;
        if (!definition?.shield || !state) continue;
        regenerate(state, definition.shield, () => {});
      }
    }
  }

  private advanceNativeTerraformingExpiry(delta: number): void {
    if (!this.activeTerraformingMechanics || this.pendingTerraformExpiryGroups.length === 0) return;
    const advanced = advanceTerraformExpiryGroups(this.pendingTerraformExpiryGroups, delta);
    const due = advanced
      .filter((group) => group.remaining === 0)
      .sort((left, right) => left.sequence - right.sequence);
    if (due.length === 0) {
      this.pendingTerraformExpiryGroups = [...advanced];
      this.syncTemporaryWaterTiles();
      return;
    }

    const operations: ResolvedPersistentOperation[] = [];
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
        } else {
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
    } catch (error) {
      if (!(error instanceof TowerScriptTerraformingError)) throw error;
      // Expiry safety failures are retryable state, not script failures. Retain every due group
      // at zero and retry on tick(0) without emitting diagnostics or partial events.
      this.pendingTerraformExpiryGroups = [...advanced];
      this.syncTemporaryWaterTiles();
    }
  }

  private updateAbilities(delta: number): void {
    for (const ability of this.mission.abilities ?? []) {
      const remaining = this.abilityCooldowns[ability.id] ?? 0;
      this.abilityCooldowns[ability.id] = Math.max(0, remaining - delta);
    }

    for (const [key, override] of this.runtimeTerrainOverrides) {
      if (override.expiresIn === undefined) continue;
      override.expiresIn = Math.max(0, override.expiresIn - delta);
      if (override.expiresIn <= 0) this.restoreTerrainOverrideByKey(key);
    }
    this.syncTemporaryWaterTiles();
  }

  private updateEnemyStatuses(delta: number): void {
    for (const enemy of this.enemies) {
      const statuses = enemy.statuses;
      if (!statuses) {
        continue;
      }
      if (statuses.slow) {
        statuses.slow.remaining = Math.max(0, statuses.slow.remaining - delta);
        if (statuses.slow.remaining <= 0) delete statuses.slow;
      }
      if (statuses.stun) {
        statuses.stun.remaining = Math.max(0, statuses.stun.remaining - delta);
        if (statuses.stun.remaining <= 0) delete statuses.stun;
      }
      if (statuses.poison) {
        // Damage-over-time; death + reward is handled by the later removeDeadEnemies() pass.
        if (enemy.hp > 0) {
          this.applyResolvedEnemyDamage(
            enemy,
            statuses.poison.dps * delta,
            { kind: "status", statusId: "poison" },
            { tags: ["over_time"] }
          );
        }
        statuses.poison.remaining = Math.max(0, statuses.poison.remaining - delta);
        if (statuses.poison.remaining <= 0) delete statuses.poison;
      }
    }
  }

  private buildAbilitySnapshot(): GameSnapshot["abilities"] {
    const abilities: GameSnapshot["abilities"] = {};
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

  private buildSunlightTilesSnapshot(): SunlightTile[] {
    const sunlight = this.mission.sunlight;
    if (!sunlight) {
      return [];
    }

    const tiles: SunlightTile[] = [];
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

  private moveEnemies(delta: number): void {
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
      enemy.pathProgress += type.speed * (this.difficulty.enemySpeedMultiplier ?? 1) * avoidanceSpeedFactor * terrainSpeedFactor
        * statusSpeedFactor * this.weatherMultiplierAt("enemy_speed", this.enemyCoord(enemy)) * delta;

      const track = this.enemyTrack(enemy);
      const enteredThrough = Math.min(Math.floor(enemy.pathProgress), track.length - 1);
      for (let pathOrder = previousPathOrder + 1; pathOrder <= enteredThrough; pathOrder += 1) {
        const coord = track[pathOrder];
        const tile = coord ? this.map.getTile(coord) : undefined;
        if (!coord || !tile) continue;
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
        this.applyResolvedCoreDamage(
          coreDamage,
          { kind: "leak", enemyId: enemy.id, enemyTypeId: enemy.typeId }
        );
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

  private moveDynamicEnemies(delta: number): void {
    this.stabilizeDynamicEnemyNavigation();
    const formationIndex = this.buildFormationTickIndex();
    const blockingActive = this.heroBlockingActive();
    const blockedEnemyIds = new Set(blockingActive ? this.deriveHeroBlockedEnemyIds() : []);
    if (formationIndex !== undefined) this.enemies.sort((left, right) => compareBinary(left.id, right.id));
    const enemies = blockingActive && formationIndex === undefined
      ? [...this.enemies].sort((left, right) => compareBinary(left.id, right.id))
      : this.enemies;
    for (const enemy of enemies) {
      if (enemy.hp <= 0 || !enemy.navigation || !enemy.routeId) continue;
      const type = this.enemyTypes[enemy.typeId];
      if (!type) continue;
      const field = this.navigationField(enemy.navigation.movementProfileId, enemy.routeId);
      const lookup = this.navigationFieldLookupCache?.get(field);
      if (!lookup) continue;
      if (blockedEnemyIds.has(enemy.id) && this.heroBlockingActive()) continue;
      let movementBudget = Math.max(0,
        type.speed
        * (this.difficulty.enemySpeedMultiplier ?? 1)
        * this.enemyStatusSpeedFactor(enemy)
        * this.weatherMultiplierAt("enemy_speed", this.enemyCoord(enemy))
        * delta
        * 1_000
      );
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
        if (this.tryAcquireHeroBlock(enemy, lookup, blockedEnemyIds)) break;
        if (!cell.nextCoord) {
          delete navigation.nextCoord;
          navigation.edgeProgress = 0;
          enemy.pathProgress = navigation.stepsEntered;
          if (cell.distance === 0) this.leakDynamicEnemy(enemy, type);
          break;
        }
        const selectedNextCoord = navigation.edgeProgress > 0 && navigation.nextCoord
          ? navigation.nextCoord
          : this.selectFormationNextCoord(enemy, field, formationIndex) ?? cell.nextCoord;
        const selectedNextCell = lookup.get(selectedNextCoord);
        const enteredCost = selectedNextCell === undefined
          ? undefined
          : cell.distance - selectedNextCell.distance;
        navigation.nextCoord = { q: selectedNextCoord.q, r: selectedNextCoord.r };
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
        navigation.currentCoord = { q: selectedNextCoord.q, r: selectedNextCoord.r };
        navigation.edgeProgress = 0;
        navigation.stepsEntered += 1;
        enemy.pathProgress = navigation.stepsEntered;
        entered += 1;
        const enteredCell = lookup.get(navigation.currentCoord);
        if (enteredCell?.nextCoord) {
          navigation.nextCoord = { q: enteredCell.nextCoord.q, r: enteredCell.nextCoord.r };
        } else {
          delete navigation.nextCoord;
        }
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
        if (this.tryAcquireHeroBlock(enemy, lookup, blockedEnemyIds)) break;
      }
    }
  }

  private buildFormationTickIndex(): FormationTickIndexV1 | undefined {
    const assignments = this.activeFormationAssignments;
    const resolver = this.navigationResolver;
    const lookupCache = this.navigationFieldLookupCache;
    if (!assignments || !resolver || !lookupCache) return undefined;

    const observations = new Map<string, FormationTickObservationV1>();
    const mutableBuckets = new Map<string, string[]>();
    const partitionKeys = new Set<string>();
    const enemies = this.enemies
      .filter((enemy) => enemy.hp > 0 && enemy.navigation && enemy.routeId && assignments.has(enemy.typeId))
      .sort((left, right) => compareBinary(left.id, right.id));

    for (const enemy of enemies) {
      const navigation = enemy.navigation!;
      const assignment = assignments.get(enemy.typeId)!;
      const field = this.navigationField(navigation.movementProfileId, enemy.routeId!);
      const lookup = lookupCache.get(field);
      const anchorCoord = navigation.edgeProgress >= 0.5 && navigation.nextCoord
        ? navigation.nextCoord
        : navigation.currentCoord;
      const remainingCost = lookup.remainingCost(navigation);
      if (!Number.isFinite(remainingCost)) continue;
      const fieldKey = JSON.stringify([
        assignment.cohortId,
        navigation.movementProfileId,
        field.goal.q,
        field.goal.r
      ]);
      const observation = Object.freeze({
        enemyId: enemy.id,
        cohortId: assignment.cohortId,
        role: assignment.role,
        steering: assignment.steering,
        anchorCoord: Object.freeze({ q: anchorCoord.q, r: anchorCoord.r }),
        fieldKey,
        remainingCostMilli: Math.round(remainingCost)
      });
      observations.set(enemy.id, observation);
      partitionKeys.add(fieldKey);
      const bucketKey = `${fieldKey}:${coordKey(anchorCoord)}`;
      const bucket = mutableBuckets.get(bucketKey) ?? [];
      bucket.push(enemy.id);
      mutableBuckets.set(bucketKey, bucket);
      this.formationSteeringStats.fieldReadCount += 1;
      this.formationSteeringStats.bucketEntryCount += 1;
    }

    this.formationSteeringStats.bucketBuildCount += partitionKeys.size;
    const buckets = new Map<string, readonly string[]>();
    for (const [key, ids] of mutableBuckets) {
      buckets.set(key, Object.freeze(ids.sort(compareBinary)));
    }
    return { observations, buckets };
  }

  private collectFormationNeighbors(
    self: FormationTickObservationV1,
    index: FormationTickIndexV1
  ): readonly FormationSteeringNeighborV1[] {
    const neighborIds: string[] = [];
    let inspected = 0;
    const coords = this.map.topology.tilesWithin(self.anchorCoord, self.steering.neighborRadius)
      .sort((left, right) => (
        this.map.topology.distance(self.anchorCoord, left) - this.map.topology.distance(self.anchorCoord, right)
        || left.r - right.r
        || left.q - right.q
      ));
    for (const coord of coords) {
      const ids = index.buckets.get(`${self.fieldKey}:${coordKey(coord)}`) ?? [];
      for (const enemyId of ids) {
        if (inspected >= 32 || neighborIds.length >= 16) break;
        inspected += 1;
        if (enemyId !== self.enemyId) neighborIds.push(enemyId);
      }
      if (inspected >= 32 || neighborIds.length >= 16) break;
    }
    this.formationSteeringStats.neighborEntriesInspected += inspected;

    const neighbors = neighborIds
      .map((enemyId) => index.observations.get(enemyId))
      .filter((value): value is FormationTickObservationV1 => value !== undefined)
      .sort((left, right) => (
        this.map.topology.distance(self.anchorCoord, left.anchorCoord)
          - this.map.topology.distance(self.anchorCoord, right.anchorCoord)
        || compareBinary(left.enemyId, right.enemyId)
      ))
      .slice(0, 16)
      .map((neighbor) => Object.freeze({
        enemyId: neighbor.enemyId,
        role: neighbor.role,
        anchorCoord: neighbor.anchorCoord,
        remainingCostMilli: neighbor.remainingCostMilli
      }));
    this.formationSteeringStats.maximumNeighborCount = Math.max(
      this.formationSteeringStats.maximumNeighborCount,
      neighbors.length
    );
    return Object.freeze(neighbors);
  }

  private navigationDestinationCost(movementProfileId: string, coord: HexCoord): number | undefined {
    const profile = this.activeNavigationProfile?.movementProfiles[movementProfileId];
    const terrain = this.map.getTile(coord)?.terrain;
    if (!profile || terrain === undefined) return undefined;
    if (Object.prototype.hasOwnProperty.call(profile.terrainCosts ?? {}, terrain)) {
      return profile.terrainCosts![terrain] ?? undefined;
    }
    if (profile.terrainMode === "respect_walkable" && this.content.terrainTypes[terrain]?.walkable !== true) {
      return undefined;
    }
    return profile.defaultTerrainCost ?? undefined;
  }

  private selectFormationNextCoord(
    enemy: EnemyState,
    field: NavigationFieldResult,
    index: FormationTickIndexV1 | undefined
  ): HexCoord | undefined {
    const navigation = enemy.navigation;
    const lookup = this.navigationFieldLookupCache?.get(field);
    const currentCell = navigation && lookup?.get(navigation.currentCoord);
    if (!navigation || navigation.edgeProgress !== 0 || !index || !lookup || !currentCell?.nextCoord) return undefined;
    const self = index.observations.get(enemy.id);
    if (!self) return undefined;

    const candidates = this.map.topology.neighbors(navigation.currentCoord)
      .map((coord) => ({ coord, cell: lookup.get(coord) }))
      .filter((entry): entry is { coord: HexCoord; cell: NonNullable<typeof currentCell> } => {
        if (!entry.cell) return false;
        const enteredCost = this.navigationDestinationCost(navigation.movementProfileId, entry.coord);
        return enteredCost !== undefined && entry.cell.distance + enteredCost === currentCell.distance;
      })
      .map((entry) => Object.freeze({
        coord: Object.freeze({ q: entry.coord.q, r: entry.coord.r }),
        remainingCostMilli: entry.cell.distance
      }));
    if (candidates.length === 0) return undefined;

    this.formationSteeringStats.plannerInvocationCount += 1;
    return selectFormationSteeringNextV1({
      schemaVersion: 1,
      grid: this.map.grid,
      currentCoord: navigation.currentCoord,
      canonicalNextCoord: currentCell.nextCoord,
      candidates,
      self: { enemyId: enemy.id, cohortId: self.cohortId, role: self.role },
      neighbors: this.collectFormationNeighbors(self, index),
      steering: self.steering
    }).nextCoord;
  }

  private heroBlockingActive(): boolean {
    const cached = this.activeHeroBlocking;
    const state = this.heroStateV2;
    return cached !== undefined
      && this.activeNavigationProfile !== undefined
      && state !== undefined
      && state.definitionId === cached.definitionId
      && (state.hp ?? 0) > 0
      && this.outcome === "playing";
  }

  private heroBlockingCandidate(
    enemy: EnemyState,
    lookup?: ReturnType<NavigationFieldLookupCache["get"]>
  ): boolean {
    const cached = this.activeHeroBlocking;
    const hero = this.heroStateV2;
    const navigation = enemy.navigation;
    if (!cached || !hero || enemy.hp <= 0 || !navigation || navigation.edgeProgress !== 0
      || !cached.blocking.movementProfileIds.includes(navigation.movementProfileId)
      || !sameGridCoord(navigation.currentCoord, hero.currentCoord)) return false;
    const resolvedLookup = lookup ?? (() => {
      const field = this.navigationEnemyFields?.get(enemy.id);
      return field === undefined ? undefined : this.navigationFieldLookupCache?.get(field);
    })();
    return resolvedLookup?.get(navigation.currentCoord) !== undefined;
  }

  private deriveHeroBlockedEnemyIds(): readonly string[] {
    const cached = this.activeHeroBlocking;
    if (!cached || !this.heroBlockingActive()) return EMPTY_FROZEN_ARRAY;
    return Object.freeze(this.enemies
      .filter((enemy) => this.heroBlockingCandidate(enemy))
      .map((enemy) => enemy.id)
      .sort(compareBinary)
      .slice(0, cached.blocking.blockCapacity));
  }

  private tryAcquireHeroBlock(
    enemy: EnemyState,
    lookup: ReturnType<NavigationFieldLookupCache["get"]>,
    blockedEnemyIds: Set<string>
  ): boolean {
    const cached = this.activeHeroBlocking;
    if (!cached || blockedEnemyIds.has(enemy.id)
      || blockedEnemyIds.size >= cached.blocking.blockCapacity
      || !this.heroBlockingActive()
      || !this.heroBlockingCandidate(enemy, lookup)) return false;
    blockedEnemyIds.add(enemy.id);
    return true;
  }

  private leakDynamicEnemy(enemy: EnemyState, type: GameContentRegistry["enemies"][string]): void {
    if (enemy.hp <= 0) return;
    enemy.hp = 0;
    const coreDamage = type.coreDamage * (this.difficulty.coreDamageMultiplier ?? 1);
    this.applyResolvedCoreDamage(
      coreDamage,
      { kind: "leak", enemyId: enemy.id, enemyTypeId: enemy.typeId }
    );
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

  private applyDotDamage(delta: number): void {
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

  private isPulseTower(tower: TowerState): boolean {
    return this.towerTypes[tower.typeId]?.attack.kind === "pulse";
  }

  private firstPulseTowerTypeId(): string | undefined {
    for (const [typeId, type] of Object.entries(this.towerTypes)) {
      if (type.attack.kind === "pulse") {
        return typeId;
      }
    }
    return undefined;
  }

  private pulseDotDamagePerUnit(towerTypeId: string | undefined): number {
    if (!towerTypeId) {
      return 0;
    }
    const attack = this.towerTypes[towerTypeId]?.attack;
    return attack?.kind === "pulse" ? attack.dotDamagePerUnit : 0;
  }

  private applySunlightRegeneration(delta: number): void {
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

  private applyHealAuras(delta: number): void {
    const healByTargetId = new Map<string, { amount: number; healerId: string }>();
    for (const healer of this.enemies) {
      if (healer.hp <= 0) {
        continue;
      }
      const aura = this.enemyTypes[healer.typeId]?.healAura;
      if (!aura || !this.enemyAbilityEnabled(healer, "healAura") || aura.radius <= 0 || aura.healPerUnit <= 0) {
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
        } else if (!previous) {
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
  private updateTowerDisruptions(delta: number): void {
    if (this.towers.length === 0) {
      return;
    }
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) {
        continue;
      }
      const disrupt = this.enemyTypes[enemy.typeId]?.towerDisrupt;
      if (!disrupt || !this.enemyAbilityEnabled(enemy, "towerDisrupt") || disrupt.interval <= 0 || disrupt.duration <= 0) {
        if (!this.enemyAbilityEnabled(enemy, "towerDisrupt")) delete enemy.disruptTargetTowerIds;
        continue;
      }
      enemy.disruptCooldown = (enemy.disruptCooldown ?? disrupt.interval) - delta;
      if (
        disrupt.telegraphLead !== undefined
        && enemy.disruptCooldown <= disrupt.telegraphLead
        && enemy.disruptCooldown > 0
        && enemy.disruptTargetTowerIds === undefined
      ) {
        enemy.disruptTargetTowerIds = this.selectDisruptionTargets(enemy, disrupt.radius, disrupt.maxTargets)
          .map((tower) => tower.id);
      }
      if (enemy.disruptCooldown > 0) {
        continue;
      }
      enemy.disruptCooldown = disrupt.interval;
      const targets = disrupt.telegraphLead === undefined
        ? this.selectDisruptionTargets(enemy, disrupt.radius, disrupt.maxTargets)
        : (enemy.disruptTargetTowerIds ?? this.selectDisruptionTargets(enemy, disrupt.radius, disrupt.maxTargets).map((tower) => tower.id))
          .map((towerId) => this.towers.find((tower) => tower.id === towerId))
          .filter((tower): tower is TowerState => tower !== undefined);
      delete enemy.disruptTargetTowerIds;
      const disabledTowerIds: string[] = [];
      for (const tower of targets) {
        tower.disabledFor = Math.max(tower.disabledFor ?? 0, disrupt.duration);
        disabledTowerIds.push(tower.id);
      }
      if (disabledTowerIds.length > 0) {
        this.lastEvents.push({ type: "towerDisrupted", enemyId: enemy.id, enemyTypeId: enemy.typeId, towerIds: disabledTowerIds, duration: disrupt.duration });
      }
    }
  }

  private selectDisruptionTargets(enemy: EnemyState, radius: number, maxTargets: number | undefined): TowerState[] {
    const center = this.enemyCoord(enemy);
    return this.towers
      .filter((tower) => this.map.distance(center, tower.coord) <= radius)
      .sort((left, right) => (
        this.map.distance(center, left.coord) - this.map.distance(center, right.coord)
        || compareBinary(left.id, right.id)
      ))
      .slice(0, maxTargets ?? this.towers.length);
  }

  /** Boss pattern: enemies with `towerAttack` damage the nearest durable tower or opt-in durable hero. */
  private updateEnemyTowerAttacks(delta: number): void {
    const durableHero = (this.activeHeroesMechanics?.schemaVersion === 3
      || this.activeHeroesMechanics?.schemaVersion === 4
      || this.activeHeroesMechanics?.schemaVersion === 5
      || this.activeHeroesMechanics?.schemaVersion === 6
      || this.activeHeroesMechanics?.schemaVersion === 7)
      && this.heroStateV2
      && (this.heroStateV2.hp ?? 0) > 0
      ? this.heroStateV2
      : undefined;
    if (this.towers.length === 0 && !durableHero) {
      return;
    }
    const destroyedIds: string[] = [];
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) {
        continue;
      }
      const attack = this.enemyTypes[enemy.typeId]?.towerAttack;
      if (!attack || !this.enemyAbilityEnabled(enemy, "towerAttack") || attack.interval <= 0 || attack.damage <= 0) {
        continue;
      }
      enemy.towerAttackCooldown = (enemy.towerAttackCooldown ?? attack.interval) - delta;
      if (enemy.towerAttackCooldown > 0) {
        continue;
      }
      enemy.towerAttackCooldown = attack.interval;
      const center = this.enemyCoord(enemy);
      let target: TowerState | null = null;
      let best = Infinity;
      for (const tower of this.towers) {
        if (typeof tower.hp !== "number" || tower.hp <= 0) continue; // indestructible or already downed this tick
        const dist = this.map.distance(center, tower.coord);
        const stableV3Tie = (this.activeHeroesMechanics?.schemaVersion === 3
          || this.activeHeroesMechanics?.schemaVersion === 4
          || this.activeHeroesMechanics?.schemaVersion === 5
          || this.activeHeroesMechanics?.schemaVersion === 6
          || this.activeHeroesMechanics?.schemaVersion === 7)
          && dist === best
          && target !== null
          && tower.id < target.id;
        if (dist <= attack.range && (dist < best || stableV3Tie)) { best = dist; target = tower; }
      }
      const heroDistance = durableHero ? this.map.distance(center, durableHero.currentCoord) : Infinity;
      if (durableHero && (durableHero.hp ?? 0) > 0 && heroDistance <= attack.range && heroDistance < best) {
        const previousHp = durableHero.hp ?? 0;
        const application = this.applyResolvedHeroDamage(
          durableHero,
          attack.damage,
          { kind: "enemy", enemyId: enemy.id, enemyTypeId: enemy.typeId }
        );
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
      } else if (target) {
        const application = this.applyResolvedTowerEntityDamage(
          target,
          attack.damage,
          { kind: "enemy", enemyId: enemy.id, enemyTypeId: enemy.typeId }
        );
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
    for (const id of destroyedIds) this.destroyTower(id);
  }

  private artifactManagementAvailability(): ActionResult {
    if (!this.activeRogueliteMechanics?.artifacts) {
      return this.fail("Artifacts are not available.", "reason.artifactsUnavailable");
    }
    if (this.outcome !== "playing") return this.fail("Mission already ended.", "reason.missionEnded");
    const campaignPreparation = Boolean(
      this.campaignBattle
      && this.waveState === "ready"
      && this.startedWaveCount === 0
      && this.enemies.length === 0
      && this.spawnQueue.length === 0
    );
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

  private replaceArtifactSocket(instanceId: string, socket: ArtifactInventorySocketRef | null): void {
    const index = this.artifactInventory.findIndex((item) => item.instanceId === instanceId);
    if (index < 0) return;
    this.artifactInventory[index] = { ...this.artifactInventory[index]!, socket };
  }

  private autoUnsocketTowerArtifacts(
    tower: TowerState,
    cause: "tower_sold" | "tower_destroyed"
  ): void {
    const assignments = this.artifactInventory
      .filter((entry) => entry.socket?.towerId === tower.id)
      .sort((left, right) => (
        compareBinary(left.socket!.slotId, right.socket!.slotId)
        || compareBinary(left.instanceId, right.instanceId)
      ));
    for (const entry of assignments) {
      const slotId = entry.socket!.slotId;
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

  private isLogisticsParticipantType(towerTypeId: string): boolean {
    const power = this.activeLogisticsPower;
    return power !== undefined && (
      Object.prototype.hasOwnProperty.call(power.generators, towerTypeId)
      || Object.prototype.hasOwnProperty.call(power.relays, towerTypeId)
      || Object.prototype.hasOwnProperty.call(power.consumers, towerTypeId)
    );
  }

  private towerHasRequiredAmmunition(tower: Pick<TowerState, "id" | "typeId">): boolean {
    const definition = this.activeLogisticsAmmunition
      ? getLogisticsAmmunitionTowerInventory(this.activeLogisticsAmmunition, tower.typeId)
      : undefined;
    if (!definition) return true;
    const amount = this.logisticsAmmunitionAmounts.get(tower.id);
    return amount !== undefined && amount >= definition.consumptionPerActivation;
  }

  private consumeTowerAmmunition(tower: Pick<TowerState, "id" | "typeId">): boolean {
    const definition = this.activeLogisticsAmmunition
      ? getLogisticsAmmunitionTowerInventory(this.activeLogisticsAmmunition, tower.typeId)
      : undefined;
    if (!definition) return true;
    const amount = this.logisticsAmmunitionAmounts.get(tower.id);
    if (amount === undefined || amount < definition.consumptionPerActivation) return false;
    this.logisticsAmmunitionAmounts.set(tower.id, amount - definition.consumptionPerActivation);
    return true;
  }

  private isLiveLogisticsParticipant(tower: Pick<TowerState, "typeId" | "hp">): boolean {
    return isLiveLogisticsPowerTower(tower) && this.isLogisticsParticipantType(tower.typeId);
  }

  private markLogisticsPowerDirty(): void {
    if (this.activeLogisticsPower) this.logisticsPowerDirty = true;
  }

  private isLogisticsSupplyTopologyParticipant(towerTypeId: string): boolean {
    if (!this.activeLogisticsSupply || !this.activeLogisticsAmmunition) return false;
    return isLogisticsSupplySourceTypeV3(this.activeLogisticsSupply, towerTypeId)
      || getLogisticsAmmunitionTowerInventory(this.activeLogisticsAmmunition, towerTypeId) !== undefined;
  }

  private markLogisticsSupplyDirty(): void {
    if (this.activeLogisticsSupply) this.logisticsSupplyDirty = true;
  }

  private ensureLogisticsSupplyTopology(): LogisticsSupplyTopologyV3 {
    if (!this.activeLogisticsSupply || !this.activeLogisticsAmmunition) {
      throw new Error("Logistics supply topology requested without active ammunition supply.");
    }
    if (!this.logisticsSupplyTopologyCache || this.logisticsSupplyDirty) {
      this.logisticsSupplyTopologyCache = buildLogisticsSupplyTopologyV3(
        this.activeLogisticsSupply,
        this.activeLogisticsAmmunition,
        this.towers,
        this.towerTypes,
        this.map
      );
      this.logisticsSupplyDirty = false;
    }
    return this.logisticsSupplyTopologyCache;
  }

  private logisticsTowerPowered(tower: Pick<TowerState, "id" | "typeId">): boolean {
    if (!this.activeLogisticsPower
      || !Object.prototype.hasOwnProperty.call(this.activeLogisticsPower.consumers, tower.typeId)) return true;
    this.ensureLogisticsPowerSnapshot();
    return this.logisticsPoweredConsumerIds?.has(tower.id) ?? false;
  }

  private logisticsTowerOperational(tower: TowerState): boolean {
    return isLiveLogisticsAmmunitionTower(tower)
      && this.logisticsTowerPowered(tower)
      && !(tower.disabledFor && tower.disabledFor > 0);
  }

  private updateLogisticsSupply(delta: number): void {
    const supply = this.activeLogisticsSupply;
    const ammunition = this.activeLogisticsAmmunition;
    if (!supply || !ammunition) return;
    const topology = this.ensureLogisticsSupplyTopology();
    const towerById = new Map(this.towers.map((tower) => [tower.id, tower] as const));

    // Production is applied first and is visible to the detached transfer plan in this tick.
    for (const tower of [...this.towers].sort((left, right) => compareBinary(left.id, right.id))) {
      const definition = getLogisticsProducerDefinitionV3(supply, tower.typeId);
      const state = this.logisticsSupplyProducers.get(tower.id);
      if (!definition || !state || !this.logisticsTowerOperational(tower)) continue;
      const recipe = Object.prototype.hasOwnProperty.call(supply.productionRecipes, definition.recipeId)
        ? supply.productionRecipes[definition.recipeId]
        : undefined;
      if (!recipe || state.amount + recipe.outputAmount > definition.capacity) continue;
      let progress = Math.min(recipe.interval, state.productionProgress + delta);
      if (progress >= recipe.interval) {
        state.amount += recipe.outputAmount;
        progress -= recipe.interval;
      }
      state.productionProgress = progress;
    }

    // Planning reads post-production but pre-transfer balances. Reservations make earlier sources
    // win headroom without allowing incoming stock to be forwarded or outgoing stock to make room.
    const sourceAvailable = new Map<string, number>();
    const destinationBase = new Map<string, number>();
    const destinationReserved = new Map<string, number>();
    for (const [towerId, state] of this.logisticsSupplyProducers) sourceAvailable.set(towerId, state.amount);
    for (const [towerId, state] of this.logisticsSupplyStorages) {
      sourceAvailable.set(towerId, state.amount);
      destinationBase.set(`storage:${towerId}`, state.amount);
    }
    for (const [towerId, amount] of this.logisticsAmmunitionAmounts) {
      destinationBase.set(`consumer:${towerId}`, amount);
    }
    const outgoing = new Map<string, number>();
    const incoming = new Map<string, number>();
    const edgesBySource = new Map<string, Array<(typeof topology.edges)[number]>>();
    for (const edge of topology.edges) {
      const entries = edgesBySource.get(edge.sourceTowerId);
      if (entries) entries.push(edge);
      else edgesBySource.set(edge.sourceTowerId, [edge]);
    }

    for (const towerId of [...sourceAvailable.keys()].sort(compareBinary)) {
      const tower = towerById.get(towerId);
      if (!tower || !this.logisticsTowerOperational(tower)) continue;
      const producerDefinition = getLogisticsProducerDefinitionV3(supply, tower.typeId);
      const storageDefinition = getLogisticsStorageDefinitionV3(supply, tower.typeId);
      const definition = producerDefinition ?? storageDefinition;
      const state = producerDefinition
        ? this.logisticsSupplyProducers.get(towerId)
        : this.logisticsSupplyStorages.get(towerId);
      if (!definition || !state) continue;
      const available = sourceAvailable.get(towerId) ?? 0;
      const candidates = (edgesBySource.get(towerId) ?? []).filter((edge) => {
        const destination = towerById.get(edge.destinationTowerId);
        if (!destination || !isLiveLogisticsAmmunitionTower(destination)) return false;
        const key = `${edge.destinationKind}:${edge.destinationTowerId}`;
        const base = destinationBase.get(key);
        if (base === undefined) return false;
        const capacity = edge.destinationKind === "consumer"
          ? getLogisticsAmmunitionTowerInventory(ammunition, destination.typeId)?.capacity
          : getLogisticsStorageDefinitionV3(supply, destination.typeId)?.capacity;
        return capacity !== undefined && base + (destinationReserved.get(key) ?? 0) < capacity;
      });
      if (available <= 0 || candidates.length === 0) continue;
      let progress = state.transferProgress >= definition.transferInterval
        ? definition.transferInterval
        : Math.min(definition.transferInterval, state.transferProgress + delta);
      if (progress < definition.transferInterval) {
        state.transferProgress = progress;
        continue;
      }
      let remaining = Math.min(definition.transferAmount, available);
      let moved = 0;
      for (const edge of candidates) {
        if (remaining <= 0) break;
        const destination = towerById.get(edge.destinationTowerId)!;
        const key = `${edge.destinationKind}:${edge.destinationTowerId}`;
        const base = destinationBase.get(key)!;
        const capacity = edge.destinationKind === "consumer"
          ? getLogisticsAmmunitionTowerInventory(ammunition, destination.typeId)!.capacity
          : getLogisticsStorageDefinitionV3(supply, destination.typeId)!.capacity;
        const headroom = capacity - base - (destinationReserved.get(key) ?? 0);
        const amount = Math.min(remaining, headroom);
        if (amount <= 0) continue;
        remaining -= amount;
        moved += amount;
        destinationReserved.set(key, (destinationReserved.get(key) ?? 0) + amount);
        incoming.set(key, (incoming.get(key) ?? 0) + amount);
      }
      if (moved <= 0) continue;
      outgoing.set(towerId, moved);
      state.transferProgress = progress - definition.transferInterval;
    }

    for (const [towerId, amount] of outgoing) {
      const producer = this.logisticsSupplyProducers.get(towerId);
      const storage = this.logisticsSupplyStorages.get(towerId);
      if (producer) producer.amount -= amount;
      else if (storage) storage.amount -= amount;
    }
    for (const [key, amount] of incoming) {
      const separator = key.indexOf(":");
      const kind = key.slice(0, separator);
      const towerId = key.slice(separator + 1);
      if (kind === "consumer") {
        this.logisticsAmmunitionAmounts.set(towerId, (this.logisticsAmmunitionAmounts.get(towerId) ?? 0) + amount);
      } else {
        const storage = this.logisticsSupplyStorages.get(towerId);
        if (storage) storage.amount += amount;
      }
    }
  }

  private ensureLogisticsPowerSnapshot(): LogisticsSnapshotV1 {
    if (!this.activeLogisticsPower) {
      throw new Error("Logistics power snapshot requested without an active power profile.");
    }
    if (!this.logisticsPowerSnapshotCache || this.logisticsPowerDirty) {
      this.logisticsPowerSnapshotCache = buildLogisticsPowerSnapshotV1(
        this.activeLogisticsPower,
        this.towers,
        this.towerTypes,
        this.map
      );
      this.logisticsPoweredConsumerIds = new Set(
        this.logisticsPowerSnapshotCache.power.consumers
          .filter((consumer) => consumer.powered)
          .map((consumer) => consumer.towerId)
      );
      this.logisticsPowerDirty = false;
    }
    return this.logisticsPowerSnapshotCache;
  }

  private currentLogisticsPowerSnapshot(): GameSnapshot["logistics"] {
    if (this.activeLogisticsSchemaVersion === 1) {
      return this.activeLogisticsPower
        ? cloneLogisticsPowerSnapshotV1(this.ensureLogisticsPowerSnapshot())
        : undefined;
    }
    if (this.activeLogisticsSchemaVersion !== 2 && this.activeLogisticsSchemaVersion !== 3) return undefined;
    if (!this.activeLogisticsPower && !this.activeLogisticsAmmunition && !this.activeLogisticsSupply) return undefined;
    const power = this.activeLogisticsPower
      ? cloneLogisticsPowerSnapshotV1(this.ensureLogisticsPowerSnapshot()).power
      : null;
    const ammunition = this.activeLogisticsAmmunition
      ? buildLogisticsAmmunitionSnapshotV2(
          this.activeLogisticsAmmunition,
          this.towers,
          this.logisticsAmmunitionAmounts
        )
      : null;
    if (this.activeLogisticsSchemaVersion === 3) {
      const supplyDefinition = this.activeLogisticsSupply;
      const supply = supplyDefinition && this.activeLogisticsAmmunition
        ? (() => {
            const topology = this.ensureLogisticsSupplyTopology();
            const producers = this.towers
              .filter((tower) => isLiveLogisticsAmmunitionTower(tower)
                && getLogisticsProducerDefinitionV3(supplyDefinition, tower.typeId) !== undefined)
              .sort((left, right) => compareBinary(left.id, right.id))
              .map((tower) => {
                const definition = getLogisticsProducerDefinitionV3(supplyDefinition, tower.typeId)!;
                const recipe = Object.prototype.hasOwnProperty.call(
                  supplyDefinition.productionRecipes,
                  definition.recipeId
                ) ? supplyDefinition.productionRecipes[definition.recipeId] : undefined;
                const state = this.logisticsSupplyProducers.get(tower.id);
                if (!recipe || !state) throw new Error(`Logistics supply producer state for tower "${tower.id}" is missing.`);
                const powered = this.logisticsTowerPowered(tower);
                return Object.freeze({
                  towerId: tower.id,
                  towerTypeId: tower.typeId,
                  recipeId: definition.recipeId,
                  ammoTypeId: recipe.ammoTypeId,
                  amount: state.amount,
                  capacity: definition.capacity,
                  productionProgress: state.productionProgress,
                  productionInterval: recipe.interval,
                  transferProgress: state.transferProgress,
                  transferInterval: definition.transferInterval,
                  transferAmount: definition.transferAmount,
                  transferRadius: definition.transferRadius,
                  powered,
                  operational: powered && !(tower.disabledFor && tower.disabledFor > 0)
                });
              });
            const storages = this.towers
              .filter((tower) => isLiveLogisticsAmmunitionTower(tower)
                && getLogisticsStorageDefinitionV3(supplyDefinition, tower.typeId) !== undefined)
              .sort((left, right) => compareBinary(left.id, right.id))
              .map((tower) => {
                const definition = getLogisticsStorageDefinitionV3(supplyDefinition, tower.typeId)!;
                const state = this.logisticsSupplyStorages.get(tower.id);
                if (!state) throw new Error(`Logistics supply storage state for tower "${tower.id}" is missing.`);
                const powered = this.logisticsTowerPowered(tower);
                return Object.freeze({
                  towerId: tower.id,
                  towerTypeId: tower.typeId,
                  ammoTypeId: definition.ammoTypeId,
                  amount: state.amount,
                  capacity: definition.capacity,
                  transferProgress: state.transferProgress,
                  transferInterval: definition.transferInterval,
                  transferAmount: definition.transferAmount,
                  transferRadius: definition.transferRadius,
                  powered,
                  operational: powered && !(tower.disabledFor && tower.disabledFor > 0)
                });
              });
            return Object.freeze({
              producers: Object.freeze(producers),
              storages: Object.freeze(storages),
              edges: Object.freeze(topology.edges.map((edge) => Object.freeze({ ...edge })))
            });
          })()
        : null;
      return Object.freeze({ schemaVersion: 3 as const, power, ammunition, supply });
    }
    return Object.freeze({
      schemaVersion: 2 as const,
      power,
      ammunition
    });
  }

  private destroyTower(towerId: string): void {
    const index = this.towers.findIndex((tower) => tower.id === towerId);
    if (index < 0) return;
    const tower = this.towers[index]!;
    const wasCounted = this.logisticsLiveParticipantIds.has(towerId);
    const topologyTowers = wasCounted
      ? this.towers.map((candidate) => (
          this.logisticsLiveParticipantIds.has(candidate.id) && !isLiveLogisticsPowerTower(candidate)
            ? { ...candidate, hp: undefined }
            : candidate
        ))
      : this.towers;
    const logisticsCounts = this.activeLogisticsPower
      ? preflightLogisticsPowerRemovalV1(
          this.activeLogisticsPower,
          topologyTowers,
          this.towerTypes,
          this.map,
          this.logisticsTopologyCounts,
          towerId
        )
      : this.logisticsTopologyCounts;
    this.map.clearOccupied(towerId); // free the footprint tiles for rebuilding
    this.towers.splice(index, 1);
    for (const enemy of this.enemies) {
      if (enemy.disruptTargetTowerIds?.includes(towerId)) {
        enemy.disruptTargetTowerIds = enemy.disruptTargetTowerIds.filter((candidate) => candidate !== towerId);
      }
    }
    this.logisticsAmmunitionAmounts.delete(towerId);
    this.logisticsSupplyProducers.delete(towerId);
    this.logisticsSupplyStorages.delete(towerId);
    if (this.isLogisticsSupplyTopologyParticipant(tower.typeId)) this.markLogisticsSupplyDirty();
    if (wasCounted) {
      this.logisticsTopologyCounts = logisticsCounts;
      this.logisticsLiveParticipantIds.delete(towerId);
      this.markLogisticsPowerDirty();
    }
    this.rebuildRogueliteSynergies();
    delete this.towerShields[towerId];
    this.syncNavigationOccupancy();
  }

  private rebuildRogueliteSynergies(): void {
    if (!this.activeRogueliteMechanics) {
      this.rogueliteSnapshot = undefined;
      this.rogueliteDamageModifiers = Object.freeze([]);
      this.artifactDamageModifiersByTowerId = new Map();
      return;
    }
    const active = this.activeRogueliteMechanics;
    const derived = deriveRogueliteSynergyStateV1(active, this.towers);
    let artifactSnapshot: Extract<NonNullable<GameSnapshot["roguelite"]>, { schemaVersion: 3 }>["artifacts"] | undefined;
    if (active.artifacts) {
      const artifacts = active.artifacts;
      const towerById = new Map(this.towers.map((tower) => [tower.id, tower] as const));
      const artifactBySlot = new Map<string, string>();
      const damageModifiersByTowerId = new Map<string, ModifierSpec[]>();
      for (const entry of this.artifactInventory) {
        if (!entry.socket) continue;
        artifactBySlot.set(
          `${entry.socket.towerId.length}:${entry.socket.towerId}|${entry.socket.slotId.length}:${entry.socket.slotId}`,
          entry.instanceId
        );
        const definition = artifacts.definitions[entry.artifactId];
        if (!definition) throw new Error(`Artifact inventory references unknown definition "${entry.artifactId}".`);
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
      this.artifactDamageModifiersByTowerId = new Map(
        [...damageModifiersByTowerId].map(([towerId, modifiers]) => [towerId, Object.freeze(modifiers)] as const)
      );
      artifactSnapshot = Object.freeze({
        inventory: Object.freeze(this.artifactInventory.map((entry) => {
            const definition = artifacts.definitions[entry.artifactId];
            if (!definition) throw new Error(`Artifact inventory references unknown definition "${entry.artifactId}".`);
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
                towerTypeId: tower!.typeId,
                slotId: entry.socket.slotId
              })
            });
          })),
        towerSlots: Object.freeze([...this.towers]
            .sort((left, right) => compareBinary(left.id, right.id))
            .flatMap((tower) => {
              const slots = artifacts.towerSlots[tower.typeId];
              if (!slots?.length) return [];
              return [Object.freeze({
                towerId: tower.id,
                towerTypeId: tower.typeId,
                slots: Object.freeze(slots.map((slot) => Object.freeze({
                  slotId: slot.slotId,
                  slotType: slot.slotType,
                  artifactInstanceId: artifactBySlot.get(
                    `${tower.id.length}:${tower.id}|${slot.slotId.length}:${slot.slotId}`
                  ) ?? null
                })))
              })];
            })),
        management: this.artifactManagementSnapshot()
      });
    } else {
      this.artifactDamageModifiersByTowerId = new Map();
    }

    if (active.draft) {
      const selectionCounts = new Map<string, { label: string; count: number }>();
      for (const selection of [...this.campaignDeck, ...this.draftSelections]) {
        const definition = active.draft.definitions[selection.cardId];
        if (!definition) throw new Error(`Draft selection references unknown card "${selection.cardId}".`);
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
          const definition = active.draft!.definitions[cardId];
          if (!definition) throw new Error(`Draft offer references unknown card "${cardId}".`);
          return Object.freeze({ cardId, label: definition.label });
        }))
      });
      this.rogueliteSnapshot = Object.freeze({
        schemaVersion: 4 as const,
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
    } else if (artifactSnapshot) {
      this.rogueliteSnapshot = Object.freeze({
        schemaVersion: 3 as const,
        synergies: derived.snapshot.synergies,
        artifacts: artifactSnapshot
      });
    } else {
      this.rogueliteSnapshot = derived.snapshot;
    }
    this.rogueliteDamageModifiers = derived.damageModifiers;
  }

  private currentRogueliteSnapshot(): GameSnapshot["roguelite"] {
    const snapshot = this.rogueliteSnapshot;
    if (snapshot?.schemaVersion === 3) {
      return Object.freeze({
        schemaVersion: 3 as const,
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
        schemaVersion: 4 as const,
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

  private artifactManagementSnapshot(): RogueliteArtifactManagementSnapshotV1 {
    const result = this.artifactManagementAvailability();
    if (result.ok) return Object.freeze({ allowed: true as const });
    if (!result.reasonKey) throw new Error("Artifact management failure is missing a reason key.");
    return Object.freeze({ allowed: false as const, reasonKey: result.reasonKey });
  }

  private ballisticsBinding(towerTypeId: string): BallisticsTowerBindingV1 | undefined {
    return this.activeBallisticsMechanics?.projectiles.towers[towerTypeId];
  }

  private prepareTowerProjectile(
    tower: TowerState,
    target: EnemyState,
    damage: number,
    binding: BallisticsTowerBindingV1
  ): ProjectileCheckpoint | undefined {
    if (this.projectiles.length >= BALLISTICS_LIMITS.activeProjectiles) return undefined;
    const sourceCoord = { q: tower.coord.q, r: tower.coord.r };
    const targetCoord = { ...this.enemyCoord(target) };
    const sourceElevation = this.map.elevationAt(sourceCoord) ?? 0;
    const targetElevation = this.map.elevationAt(targetCoord) ?? 0;
    const clearance = this.activeBallisticsMechanics?.projectiles.clearance;
    const trace = clearance === undefined
      ? undefined
      : traceProjectileClearanceV1(
          this.map,
          this.content.terrainTypes,
          clearance,
          {
            sourceCoord,
            targetCoord,
            sourceElevation,
            targetElevation,
            trajectory: binding.trajectory,
            travelTimeUnits: binding.travelTimeUnits,
            ...(binding.maxAltitude === undefined ? {} : { maxAltitude: binding.maxAltitude })
          },
          Math.max(
            0,
            ARC_CLEARANCE_LIMITS.cellInspectionsPerTick - this.projectileClearanceInspectionsThisTick
          )
        );
    if (trace !== undefined) {
      this.projectileClearanceInspectionsThisTick += trace.cellInspections;
      if (!trace.ok) return undefined;
    }
    const destructibleTrace = this.destructibleCollisionIndex === undefined
      ? undefined
      : traceProjectileDestructibleCollisionV1(
          this.map,
          this.destructibleCollisionIndex,
          {
            sourceCoord,
            targetCoord,
            sourceElevation,
            targetElevation,
            trajectory: binding.trajectory,
            travelTimeUnits: binding.travelTimeUnits,
            ...(binding.maxAltitude === undefined ? {} : { maxAltitude: binding.maxAltitude }),
            ...(trace?.ok && trace.collision !== undefined ? { terrainCollision: trace.collision } : {})
          },
          Math.max(
            0,
            DESTRUCTIBLE_COLLISION_LIMITS.cellInspectionsPerTick
              - this.projectileDestructibleInspectionsThisTick
          )
        );
    if (destructibleTrace !== undefined) {
      this.projectileDestructibleInspectionsThisTick += destructibleTrace.cellInspections;
      if (!destructibleTrace.ok) return undefined;
    }
    const fixedCollision = destructibleTrace?.ok ? destructibleTrace.collision : undefined;
    const destructibleCollision = fixedCollision?.kind === "map_object" ? fixedCollision : undefined;
    const clearanceCollision = fixedCollision?.kind === "terrain"
      ? fixedCollision
      : destructibleTrace === undefined && trace?.ok ? trace.collision : undefined;
    const damagePacket = this.buildTowerDamagePacket(tower.typeId, target, damage, {}, tower.id);
    return {
      id: `projectile_${this.nextProjectileSequence}`,
      sourceCoord,
      trajectory: binding.trajectory,
      elapsedUnits: 0,
      travelTimeUnits: binding.travelTimeUnits,
      altitude: sourceElevation,
      ...(binding.maxAltitude === undefined ? {} : { maxAltitude: binding.maxAltitude }),
      sourceElevation,
      ...(clearanceCollision !== undefined ? {
        clearanceCollision: {
          blockerCoord: { ...clearanceCollision.blockerCoord },
          terrainId: clearanceCollision.terrainId,
          blockerTag: clearanceCollision.blockerTag,
          blockerElevation: clearanceCollision.blockerElevation,
          elapsedUnits: clearanceCollision.elapsedUnits
        }
      } : {}),
      ...(destructibleCollision === undefined ? {} : {
        destructibleCollision: {
          ...destructibleCollision,
          collisionCoord: { ...destructibleCollision.collisionCoord }
        }
      }),
      ...(binding.ricochet === undefined ? {} : {
        ricochet: {
          schemaVersion: 1 as const,
          maxBounces: binding.ricochet.maxBounces,
          rangeCells: binding.ricochet.rangeCells,
          bounceCount: 0,
          segmentHasTarget: true
        }
      }),
      impact: {
        targetCoord,
        targetElevation,
        damagePacket: cloneCheckpointJson(damagePacket)
      }
    };
  }

  private commitTowerProjectile(projectile: ProjectileCheckpoint): void {
    this.nextProjectileSequence += 1;
    this.projectiles.push(projectile);
  }

  private compareRicochetEnemyIds(left: EnemyState, right: EnemyState): number {
    const leftMatch = /^enemy_([1-9][0-9]*)$/.exec(left.id);
    const rightMatch = /^enemy_([1-9][0-9]*)$/.exec(right.id);
    if (leftMatch && rightMatch) {
      const numeric = Number(leftMatch[1]) - Number(rightMatch[1]);
      if (numeric !== 0) return numeric;
    }
    return compareBinary(left.id, right.id);
  }

  private buildRicochetEnemyBuckets(): ReadonlyMap<string, readonly EnemyState[]> {
    const collected = new Map<string, EnemyState[]>();
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue;
      const key = coordKey(this.enemyCoord(enemy));
      const bucket = collected.get(key);
      if (bucket === undefined) collected.set(key, [enemy]);
      else bucket.push(enemy);
    }
    const bounded = new Map<string, readonly EnemyState[]>();
    for (const [key, bucket] of collected) {
      bounded.set(
        key,
        bucket
          .sort((left, right) => this.compareRicochetEnemyIds(left, right))
          .slice(0, RICOCHET_LIMITS.enemyCandidatesPerCell)
      );
    }
    return bounded;
  }

  private ricochetIncomingCoord(
    projectile: ProjectileCheckpoint,
    collisionCoord: Readonly<HexCoord>
  ): HexCoord | undefined {
    const line = this.map.line(projectile.sourceCoord, projectile.impact.targetCoord);
    const index = line.findIndex((coord) => sameGridCoord(coord, collisionCoord));
    if (index <= 0) return undefined;
    return { ...line[index - 1]! };
  }

  private reflectProjectile(
    projectile: ProjectileCheckpoint,
    kind: "terrain" | "armor",
    surfaceId: string,
    collisionCoord: Readonly<HexCoord>,
    incomingFromCoord: Readonly<HexCoord>,
    enemyBuckets: ReadonlyMap<string, readonly EnemyState[]>
  ): ProjectileCheckpoint | undefined {
    const ricochet = (projectile as ProjectileCheckpointV3).ricochet;
    const surfaces = this.activeBallisticsMechanics?.projectiles.ricochet;
    if (!ricochet || !surfaces || ricochet.bounceCount >= ricochet.maxBounces
      || this.projectileRicochetsThisTick >= RICOCHET_LIMITS.ricochetsPerTick) return undefined;
    const reflective = kind === "terrain"
      ? surfaces.terrainTags?.[surfaceId] === true
      : surfaces.armorTypes?.[surfaceId] === true;
    if (!reflective) return undefined;
    const ray = traceProjectileRicochetRayV1(
      this.map,
      {
        kind,
        incomingFromCoord: { ...incomingFromCoord },
        collisionCoord: { ...collisionCoord },
        rangeCells: ricochet.rangeCells
      },
      Math.max(0, RICOCHET_LIMITS.cellInspectionsPerTick - this.projectileRicochetInspectionsThisTick)
    );
    this.projectileRicochetInspectionsThisTick += ray.cellInspections;
    if (!ray.ok || ray.ray.length === 0) return undefined;

    let nextTarget: EnemyState | undefined;
    let nextTargetCoord: HexCoord | undefined;
    for (const coord of ray.ray) {
      const candidate = enemyBuckets.get(coordKey(coord))?.find((enemy) => enemy.hp > 0);
      if (candidate === undefined) continue;
      nextTarget = candidate;
      nextTargetCoord = { ...coord };
      break;
    }
    const segmentHasTarget = nextTarget !== undefined;
    nextTargetCoord ??= { ...ray.ray[ray.ray.length - 1]! };
    const nextSourceCoord = { ...ray.nextSourceCoord };
    const sourceElevation = this.map.elevationAt(nextSourceCoord) ?? 0;
    const targetElevation = this.map.elevationAt(nextTargetCoord) ?? 0;
    const clearance = this.activeBallisticsMechanics?.projectiles.clearance;
    const clearanceTrace = clearance === undefined
      ? undefined
      : traceProjectileClearanceV1(
          this.map,
          this.content.terrainTypes,
          clearance,
          {
            sourceCoord: nextSourceCoord,
            targetCoord: nextTargetCoord,
            sourceElevation,
            targetElevation,
            trajectory: projectile.trajectory,
            travelTimeUnits: projectile.travelTimeUnits,
            ...(projectile.maxAltitude === undefined ? {} : { maxAltitude: projectile.maxAltitude })
          },
          Math.max(
            0,
            ARC_CLEARANCE_LIMITS.cellInspectionsPerTick - this.projectileClearanceInspectionsThisTick
          )
        );
    if (clearanceTrace !== undefined) {
      this.projectileClearanceInspectionsThisTick += clearanceTrace.cellInspections;
      if (!clearanceTrace.ok) return undefined;
    }
    const destructibleTrace = this.destructibleCollisionIndex === undefined
      ? undefined
      : traceProjectileDestructibleCollisionV1(
          this.map,
          this.destructibleCollisionIndex,
          {
            sourceCoord: nextSourceCoord,
            targetCoord: nextTargetCoord,
            sourceElevation,
            targetElevation,
            trajectory: projectile.trajectory,
            travelTimeUnits: projectile.travelTimeUnits,
            ...(projectile.maxAltitude === undefined ? {} : { maxAltitude: projectile.maxAltitude }),
            ...(clearanceTrace?.ok && clearanceTrace.collision !== undefined
              ? { terrainCollision: clearanceTrace.collision }
              : {})
          },
          Math.max(
            0,
            DESTRUCTIBLE_COLLISION_LIMITS.cellInspectionsPerTick
              - this.projectileDestructibleInspectionsThisTick
          )
        );
    if (destructibleTrace !== undefined) {
      this.projectileDestructibleInspectionsThisTick += destructibleTrace.cellInspections;
      if (!destructibleTrace.ok) return undefined;
    }
    const fixedCollision = destructibleTrace?.ok ? destructibleTrace.collision : undefined;
    const destructibleCollision = fixedCollision?.kind === "map_object" ? fixedCollision : undefined;
    const clearanceCollision = fixedCollision?.kind === "terrain"
      ? fixedCollision
      : destructibleTrace === undefined && clearanceTrace?.ok ? clearanceTrace.collision : undefined;

    const packet = projectile.impact.damagePacket;
    const nextPacket: DamagePacket = nextTarget === undefined
      ? packet
      : {
          ...packet,
          target: {
            kind: "enemy",
            enemyId: nextTarget.id,
            enemyTypeId: nextTarget.typeId
          }
    };
    const bounceCount = ricochet.bounceCount + 1;
    const {
      clearanceCollision: _previousClearanceCollision,
      destructibleCollision: _previousDestructibleCollision,
      ...projectileWithoutTerminalCollision
    } = projectile as ProjectileCheckpointV4;
    const reflected: ProjectileCheckpointV4 = {
      ...projectileWithoutTerminalCollision,
      sourceCoord: nextSourceCoord,
      sourceElevation,
      elapsedUnits: 0,
      altitude: sourceElevation,
      ...(clearanceCollision !== undefined ? {
        clearanceCollision: {
          blockerCoord: { ...clearanceCollision.blockerCoord },
          terrainId: clearanceCollision.terrainId,
          blockerTag: clearanceCollision.blockerTag,
          blockerElevation: clearanceCollision.blockerElevation,
          elapsedUnits: clearanceCollision.elapsedUnits
        }
      } : {}),
      ...(destructibleCollision === undefined ? {} : {
        destructibleCollision: {
          ...destructibleCollision,
          collisionCoord: { ...destructibleCollision.collisionCoord }
        }
      }),
      ricochet: {
        ...ricochet,
        bounceCount,
        segmentHasTarget,
        lastCollision: {
          kind,
          surfaceId,
          collisionCoord: { ...collisionCoord },
          incomingFromCoord: { ...incomingFromCoord }
        }
      },
      impact: {
        targetCoord: nextTargetCoord,
        targetElevation,
        damagePacket: cloneCheckpointJson(nextPacket)
      }
    };
    this.projectileRicochetsThisTick += 1;
    this.lastEvents.push({
      type: "projectileRicocheted",
      projectileId: projectile.id,
      bounceCount,
      surfaceKind: kind,
      surfaceId,
      collisionCoord: { ...collisionCoord },
      nextSourceCoord: { ...nextSourceCoord },
      nextTargetCoord: { ...nextTargetCoord }
    });
    return reflected;
  }

  private persistentOverridesForCandidateTerrain(
    candidateTerrainByCoord: ReadonlyMap<string, string>
  ): Map<string, RuntimeTerrainOverride> {
    const overrides = new Map<string, RuntimeTerrainOverride>();
    for (const tile of this.map.tiles.values()) {
      const key = coordKey(tile);
      const terrain = candidateTerrainByCoord.get(key);
      const baseTerrain = this.map.getBaseTerrain(tile);
      if (terrain === undefined || baseTerrain === undefined || terrain === baseTerrain) continue;
      const previous = this.runtimeTerrainOverrides.get(key);
      overrides.set(key, {
        q: tile.q,
        r: tile.r,
        terrain,
        source: previous?.source ?? "script"
      });
    }
    return overrides;
  }

  private prepareDestructibleTerrainTransition(
    object: MutableDestructibleObjectStateV1,
    transitionId: string
  ) {
    return preparePersistentTerrainTransaction({
      map: this.map,
      terrainTypes: this.content.terrainTypes,
      transitions: this.activeTerraformingMechanics?.terrainTransitions ?? Object.freeze({}),
      runtimeOverrides: this.runtimeTerrainOverrides,
      operations: [{
        kind: "set_terrain",
        coord: { ...object.coord },
        transitionId,
        order: 0
      }],
      navigation: this.activeNavigationProfile === undefined
        ? { mode: "authored_routes" }
        : {
            mode: "dynamic_flow",
            prove: (candidateTerrainByCoord) => {
              try {
                const plan = this.planDynamicPersistentTerrainNavigation({
                  overrides: this.persistentOverridesForCandidateTerrain(candidateTerrainByCoord),
                  writes: [],
                  events: []
                });
                return {
                  baselineAvailable: plan.baselineAvailable,
                  candidateAvailable: plan.candidateAvailable,
                  proof: plan
                };
              } catch (error) {
                if (error instanceof TowerScriptTerraformingError
                  && error.reasonKey === "terraform.last_path_blocked") {
                  return { baselineAvailable: true, candidateAvailable: false };
                }
                if (error instanceof TowerScriptTerraformingError
                  && error.reasonKey === "terraform.navigation_unavailable") {
                  return { baselineAvailable: false, candidateAvailable: false };
                }
                throw error;
              }
            }
          }
    });
  }

  private applyDestructibleProjectileImpact(
    projectile: ProjectileCheckpoint,
    collision: ProjectileMapObjectCollisionV1
  ): void {
    const object = this.destructibleObjects.find((candidate) => (
      candidate.objectId === collision.objectId
      && candidate.definitionId === collision.definitionId
    ));
    if (!object || object.destroyed) return;
    const definition = this.activeBallisticsMechanics?.projectiles.destructibles
      ?.definitions[object.definitionId];
    if (!definition) throw new Error("Active destructible collision lost its authored definition.");
    const armor = definition.armorTypeId === undefined
      ? undefined
      : this.activeCombatMechanics?.armorTypes[definition.armorTypeId];
    if (definition.armorTypeId !== undefined && armor === undefined) {
      throw new Error("Active destructible collision lost its authored armor provenance.");
    }
    const plan = planDestructibleObjectDamageV1(
      projectile.impact.damagePacket,
      {
        objectId: object.objectId,
        definitionId: object.definitionId,
        hp: object.hp,
        maxHp: object.maxHp,
        ...(definition.armorTypeId === undefined ? {} : { armorTypeId: definition.armorTypeId })
      },
      armor === undefined ? {} : {
        armorMatrix: {
          armorTypeId: definition.armorTypeId!,
          ...(armor.defaultMultiplier === undefined ? {} : { defaultMultiplier: armor.defaultMultiplier }),
          multipliers: armor.multipliers
        }
      }
    );
    if (plan.outcome === "no_effect") return;

    let terrainAdoption: Parameters<Parameters<typeof adoptPersistentTerrainTransaction>[1]>[0] | undefined;
    if (plan.outcome === "requires_atomic_destruction" && definition.onDestroyed !== undefined) {
      if (this.isNativeTerraformTargetOwned("terrain", object.coord)) return;
      let prepared;
      try {
        prepared = this.prepareDestructibleTerrainTransition(
          object,
          definition.onDestroyed.terrainTransitionId
        );
      } catch (error) {
        if (error instanceof PersistentTerrainTransactionError
          || error instanceof TowerScriptTerraformingError) return;
        throw error;
      }
      const adopted = adoptPersistentTerrainTransaction(prepared, (adoption) => {
        for (const write of adoption.writes) this.map.setTerrain(write.coord, write.terrain);
        this.runtimeTerrainOverrides = new Map(adoption.runtimeOverrides.map((override) => [
          coordKey(override),
          { ...override }
        ]));
        terrainAdoption = adoption;
      });
      if (!adopted.adopted || terrainAdoption === undefined) {
        throw new Error("Prepared destructible terrain transaction could not be adopted.");
      }
      const navigation = terrainAdoption.navigationProof as DynamicTerraformingNavigationPlan | undefined;
      if (navigation) {
        this.navigationResolver = navigation.candidateResolver;
        this.navigationFieldLookupCache = navigation.candidateLookupCache;
        this.navigationEnemyFields = navigation.candidateEnemyFields;
        const rebinds = new Map(navigation.enemyRebinds.map((rebind) => [rebind.enemyId, rebind]));
        for (const enemy of this.enemies) {
          const rebind = rebinds.get(enemy.id);
          if (!rebind) continue;
          enemy.navigation = rebind.navigation;
          enemy.pathProgress = rebind.pathProgress;
        }
      }
      this.revalidateHeroMovementAfterMapMutation();
      this.syncTemporaryWaterTiles();
    }

    const previousHp = object.hp;
    object.hp = plan.nextHp;
    object.destroyed = plan.outcome === "requires_atomic_destruction";
    this.lastEvents.push({
      type: "destructibleObjectDamaged",
      projectileId: projectile.id,
      objectId: object.objectId,
      definitionId: object.definitionId,
      coord: { ...object.coord },
      fromHp: previousHp,
      toHp: object.hp,
      damage: plan.resolution.finalAmount
    });
    if (terrainAdoption !== undefined) {
      this.lastEvents.push(...terrainAdoption.events.map((entry) => entry.event as GameEvent));
    }
    if (object.destroyed) {
      this.lastEvents.push({
        type: "destructibleObjectDestroyed",
        projectileId: projectile.id,
        objectId: object.objectId,
        definitionId: object.definitionId,
        coord: { ...object.coord }
      });
      this.rebuildDestructibleCollisionIndex();
    }
  }

  private updateProjectiles(delta: number): void {
    if (!this.activeBallisticsMechanics || this.projectiles.length === 0 || delta <= 0) return;
    const retained: ProjectileCheckpoint[] = [];
    let ricochetEnemyBuckets: ReadonlyMap<string, readonly EnemyState[]> | undefined;
    let impacts = 0;
    for (const current of this.projectiles.slice().sort((left, right) => compareBinary(left.id, right.id))) {
      const collision = "clearanceCollision" in current ? current.clearanceCollision : undefined;
      const destructibleCollision = "destructibleCollision" in current
        ? current.destructibleCollision
        : undefined;
      const terminalElapsed = destructibleCollision === undefined
        ? collision?.elapsedUnits ?? current.travelTimeUnits
        : destructibleCollision.elapsedUnits;
      const elapsedUnits = Math.min(terminalElapsed, current.elapsedUnits + delta);
      const altitude = this.projectileAltitude({ ...current, elapsedUnits });
      const advanced: ProjectileCheckpoint = {
        ...current,
        elapsedUnits,
        altitude,
        sourceCoord: { ...current.sourceCoord },
        ...(collision === undefined ? {} : {
          clearanceCollision: { ...collision, blockerCoord: { ...collision.blockerCoord } }
        }),
        ...(destructibleCollision === undefined ? {} : {
          destructibleCollision: {
            ...destructibleCollision,
            collisionCoord: { ...destructibleCollision.collisionCoord }
          }
        }),
        impact: {
          targetCoord: { ...current.impact.targetCoord },
          targetElevation: current.impact.targetElevation,
          damagePacket: current.impact.damagePacket
        }
      };
      if (elapsedUnits < terminalElapsed || impacts >= BALLISTICS_LIMITS.impactsPerTick) {
        retained.push(advanced);
        continue;
      }
      impacts += 1;
      if (destructibleCollision !== undefined) {
        this.applyDestructibleProjectileImpact(advanced, destructibleCollision);
        continue;
      }
      if (collision !== undefined) {
        const blockerHeight = this.activeBallisticsMechanics.projectiles.clearance
          ?.terrainBlockerHeights[collision.blockerTag];
        if (blockerHeight === undefined) {
          throw new Error("Active ballistics clearance collision lost its authored blocker provenance.");
        }
        const incomingFromCoord = this.ricochetIncomingCoord(advanced, collision.blockerCoord);
        const reflected = incomingFromCoord === undefined
          ? undefined
          : this.reflectProjectile(
              advanced,
              "terrain",
              collision.blockerTag,
              collision.blockerCoord,
              incomingFromCoord,
              ricochetEnemyBuckets ??= this.buildRicochetEnemyBuckets()
            );
        if (reflected !== undefined) {
          retained.push(reflected);
          continue;
        }
        this.lastEvents.push({
          type: "projectileBlocked",
          projectileId: advanced.id,
          targetCoord: { ...advanced.impact.targetCoord },
          blockerCoord: { ...collision.blockerCoord },
          terrainId: collision.terrainId,
          blockerTag: collision.blockerTag,
          projectileAltitude: this.projectileAltitude(advanced),
          obstacleTop: collision.blockerElevation + blockerHeight
        });
        continue;
      }
      const packet = advanced.impact.damagePacket;
      const ricochetState = (advanced as ProjectileCheckpointV3).ricochet;
      const targetRef = packet.target.kind === "enemy" ? packet.target : undefined;
      if (ricochetState?.segmentHasTarget === false) {
        this.lastEvents.push({
          type: "projectileMissed",
          projectileId: advanced.id,
          targetEnemyId: targetRef?.enemyId ?? "",
          targetCoord: { ...advanced.impact.targetCoord },
          reason: "target_missing"
        });
        continue;
      }
      const target = targetRef === undefined
        ? undefined
        : this.enemies.find((enemy) => enemy.id === targetRef.enemyId && enemy.typeId === targetRef.enemyTypeId && enemy.hp > 0);
      if (!target) {
        this.lastEvents.push({
          type: "projectileMissed",
          projectileId: advanced.id,
          targetEnemyId: targetRef?.enemyId ?? "",
          targetCoord: { ...advanced.impact.targetCoord },
          reason: "target_missing"
        });
        continue;
      }
      const targetCoord = this.enemyCoord(target);
      if (targetCoord.q !== advanced.impact.targetCoord.q || targetCoord.r !== advanced.impact.targetCoord.r) {
        this.lastEvents.push({
          type: "projectileMissed",
          projectileId: advanced.id,
          targetEnemyId: target.id,
          targetCoord: { ...advanced.impact.targetCoord },
          reason: "target_moved"
        });
        continue;
      }
      if (targetRef?.componentId !== undefined
        && (this.enemyComponentStates[target.id]?.[targetRef.componentId]?.hp ?? 0) <= 0) {
        this.lastEvents.push({
          type: "projectileMissed",
          projectileId: advanced.id,
          targetEnemyId: target.id,
          targetCoord: { ...advanced.impact.targetCoord },
          reason: "component_unavailable"
        });
        continue;
      }
      const componentArmorTypeId = targetRef?.componentId === undefined
        ? undefined
        : this.activeEnemyBehaviors?.bosses?.[target.typeId]?.components[targetRef.componentId]?.armorTypeId;
      const armorTypeId = componentArmorTypeId
        ?? resolveEnemyArmorMatrix(this.activeCombatMechanics, target.typeId)?.armorTypeId;
      if (armorTypeId !== undefined) {
        const incomingFromCoord = this.ricochetIncomingCoord(advanced, targetCoord);
        const reflected = incomingFromCoord === undefined
          ? undefined
          : this.reflectProjectile(
              advanced,
              "armor",
              armorTypeId,
              targetCoord,
              incomingFromCoord,
              ricochetEnemyBuckets ??= this.buildRicochetEnemyBuckets()
            );
        if (reflected !== undefined) {
          retained.push(reflected);
          continue;
        }
      }
      const application = this.resolveAndApplyDamage(
        packet,
        this.enemyDamageResolutionContext(target, packet),
        { kind: "enemy", enemy: target }
      );
      const appliedEnemy = application.enemyTarget ?? target;
      if (application.resolution.finalAmount > 0) {
        if (packet.source.kind === "tower") this.applyStatusOnHit(packet.source.towerTypeId, appliedEnemy);
        this.lastEvents.push({
          type: "enemyHit",
          towerId: packet.source.kind === "tower" ? packet.source.towerId ?? "" : "",
          enemyId: appliedEnemy.id,
          enemyTypeId: appliedEnemy.typeId,
          damage: application.resolution.finalAmount
        });
      } else if (packet.amount > 0 && application.resolution.blockedByArmor && packet.source.kind === "tower") {
        this.lastEvents.push({
          type: "enemyArmorBlocked",
          towerId: packet.source.towerId ?? "",
          enemyId: appliedEnemy.id,
          enemyTypeId: appliedEnemy.typeId,
          rawDamage: packet.amount
        });
      }
    }
    this.projectiles = retained;
  }

  private updateTowers(delta: number): void {
    const poweredConsumers = this.activeLogisticsPower
      ? (this.ensureLogisticsPowerSnapshot(), this.logisticsPoweredConsumerIds!)
      : undefined;
    for (const tower of this.towers) {
      const type = this.towerTypes[tower.typeId];
      if (!type) {
        continue;
      }
      if (tower.disabledFor && tower.disabledFor > 0) {
        tower.disabledFor = Math.max(0, tower.disabledFor - delta); // silenced by an enemy disrupt pulse
        continue;
      }
      if (poweredConsumers && Object.prototype.hasOwnProperty.call(this.activeLogisticsPower!.consumers, tower.typeId)
        && !poweredConsumers.has(tower.id)) continue;
      if (this.activeLogisticsAmmunition && !this.towerHasRequiredAmmunition(tower)) continue;
      tower.cooldown -= delta;
      const fireRateMultiplier = this.towerFireRateMultiplier(tower);

      if (type.attack.kind === "single") {
        this.updateSingleTower(tower, type.attack.fireRate * fireRateMultiplier, type.attack.damagePerStack, type.attack.chain);
      } else if (type.attack.kind === "pulse") {
        this.updatePulseTower(
          tower,
          this.towerPulseRate(tower) * fireRateMultiplier,
          type.attack.pulseDamage,
          type.attack.dotDuration,
          type.attack.dotDamagePerUnit
        );
      } else if (type.attack.kind === "sniper") {
        this.updateSniperTower(tower, type.attack.interval / fireRateMultiplier, type.attack.damage);
      } else if (type.attack.kind === "antiair") {
        this.updateAntiAirTower(tower, type.attack.fireRate * fireRateMultiplier, type.attack.damage);
      } else if (type.attack.kind === "splash") {
        this.updateSplashTower(tower, fireRateMultiplier);
      } else if (type.attack.kind === "pipeline") {
        this.updatePipelineTower(tower, type.attack, fireRateMultiplier);
      }
    }
  }

  private updateSingleTower(tower: TowerState, fireRate: number, damagePerStack: number, chain?: ChainDeliverySpec): void {
    const interval = 1 / fireRate;
    let shots = 0;

    while (tower.cooldown <= 0 && shots < 4) {
      if (this.activeLogisticsAmmunition && !this.towerHasRequiredAmmunition(tower)) return;
      const target = this.findSingleTarget(tower);
      if (!target) {
        tower.cooldown = 0;
        return;
      }
      const damage = tower.stacks * damagePerStack;
      const projectileBinding = chain === undefined ? this.ballisticsBinding(tower.typeId) : undefined;
      const preparedProjectile = projectileBinding === undefined
        ? undefined
        : this.prepareTowerProjectile(tower, target, damage, projectileBinding);
      if (projectileBinding !== undefined && preparedProjectile === undefined) return;
      if (this.activeLogisticsAmmunition && !this.consumeTowerAmmunition(tower)) return;
      this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.id, damage });
      const applied = projectileBinding
        ? (this.commitTowerProjectile(preparedProjectile!), 0)
        : this.applyTowerDamage(tower, target, damage);
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
  private propagateChain(tower: TowerState, originTarget: EnemyState, baseDamage: number, chain: ChainDeliverySpec): void {
    const alreadyHit = new Set<string>([originTarget.id]);
    let current = originTarget;
    for (let hop = 1; hop <= chain.maxJumps; hop += 1) {
      const fromCoord = this.enemyCoord(current);
      let next: EnemyState | undefined;
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

  private updatePulseTower(
    tower: TowerState,
    pulseRate: number,
    pulseDamage: number,
    dotDuration: number,
    dotDamagePerUnit: number
  ): void {
    const interval = 1 / pulseRate;
    let pulses = 0;

    while (tower.cooldown <= 0 && pulses < 3) {
      if (this.activeLogisticsAmmunition && !this.towerHasRequiredAmmunition(tower)) return;
      let targets = this.enemies.filter(
        (enemy) =>
          enemy.hp > 0 && this.enemyTargetClass(enemy) === "ground" && this.enemyInTowerAcquisitionRange(tower, enemy)
      );
      if (this.activeLineOfSightProfile || this.dynamicLineOfSightIndex) {
        targets = targets
          .sort((left, right) => this.compareTargets(tower, left, right))
          .slice(0, LINE_OF_SIGHT_LIMITS.candidatesPerAcquisition)
          .filter((enemy) => this.towerHasLineOfSight(tower, enemy));
      }
      if (targets.length === 0) {
        tower.cooldown = 0;
        return;
      }
      if (this.activeLogisticsAmmunition && !this.consumeTowerAmmunition(tower)) return;

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

  private updateSniperTower(tower: TowerState, interval: number, damage: number): void {
    let shots = 0;

    while (tower.cooldown <= 0 && shots < 2) {
      if (this.activeLogisticsAmmunition && !this.towerHasRequiredAmmunition(tower)) return;
      const target = this.findSniperTarget(tower);
      if (!target) {
        tower.cooldown = 0;
        return;
      }
      if (this.activeLogisticsAmmunition && !this.consumeTowerAmmunition(tower)) return;

      this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.id, damage });
      this.applyTowerDamage(tower, target, damage);
      tower.cooldown += interval;
      shots += 1;
    }
  }

  private updateAntiAirTower(tower: TowerState, fireRate: number, damage: number): void {
    const interval = 1 / fireRate;
    let volleys = 0;

    while (tower.cooldown <= 0 && volleys < 3) {
      if (this.activeLogisticsAmmunition && !this.towerHasRequiredAmmunition(tower)) return;
      const targets = this.findAntiAirTargets(tower);
      if (targets.length === 0) {
        tower.cooldown = 0;
        return;
      }
      if (this.activeLogisticsAmmunition && !this.consumeTowerAmmunition(tower)) return;

      for (const target of targets) {
        this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.id, damage });
        this.applyTowerDamage(tower, target, damage);
      }

      tower.cooldown += interval;
      volleys += 1;
    }
  }

  private updateSplashTower(tower: TowerState, fireRateMultiplier = 1): void {
    const type = this.towerTypes[tower.typeId];
    if (!type || type.attack.kind !== "splash") {
      return;
    }
    const attack = type.attack;
    const interval = this.slipperyJackInterval(tower) / fireRateMultiplier;
    let shots = 0;

    while (tower.cooldown <= 0 && shots < 3) {
      if (this.activeLogisticsAmmunition && !this.towerHasRequiredAmmunition(tower)) return;
      const target = this.findSplashTarget(tower);
      if (!target) {
        tower.cooldown = 0;
        return;
      }
      if (this.activeLogisticsAmmunition && !this.consumeTowerAmmunition(tower)) return;

      const targetCoord = this.enemyCoord(target);
      const targets = this.enemies.filter(
        (enemy) =>
          enemy.hp > 0 &&
          (attack.affectsClasses ?? ["ground"]).includes(this.enemyTargetClass(enemy)) &&
          this.map.distance(this.enemyCoord(enemy), targetCoord) <= attack.splashRadius
      );

      this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.id, damage: attack.damage });
      for (const enemy of targets) {
        this.applyTowerDamage(tower, enemy, enemy.id === target.id ? attack.damage : attack.splashDamage);
        this.applySlow(enemy, attack.slowFactor, attack.slowDuration, attack.affectsClasses);
      }

      tower.cooldown += interval;
      shots += 1;
    }
  }

  private updatePipelineTower(tower: TowerState, attack: EffectPipelineAttackModel, fireRateMultiplier: number): void {
    const levelIndex = Math.max(0, tower.level - 1);
    const baseInterval = attack.intervalByLevel?.[Math.min(levelIndex, attack.intervalByLevel.length - 1)] ?? attack.interval;
    const interval = baseInterval / Math.max(0.05, fireRateMultiplier);
    const displacementRanks = this.activePhysicsMechanics
      ? this.displacementEffectRanks(attack.effects)
      : undefined;
    let activations = 0;
    while (tower.cooldown <= 0 && activations < 4) {
      if (this.activeLogisticsAmmunition && !this.towerHasRequiredAmmunition(tower)) return;
      const targets = this.pipelineTargets(tower, attack);
      if (targets.length === 0) {
        tower.cooldown = 0;
        return;
      }
      if (this.activeLogisticsAmmunition && !this.consumeTowerAmmunition(tower)) return;
      const displacementBudget: DisplacementActivationBudget | undefined = this.activePhysicsMechanics
        ? { used: 0, limit: PHYSICS_LIMITS.stepAttemptsPerActivation }
        : undefined;
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const target = targets[targetIndex]!;
        const expectedDamage = attack.effects.reduce((sum, effect) => {
          const inspected = inspectOwnDataEffect(effect);
          if (!inspected.ok || inspected.kind !== "damage") return sum;
          const record = inspected.record;
          if (typeof record.amount !== "number" || !Number.isFinite(record.amount)) return sum;
          const amountByLevel = Array.isArray(record.amountByLevel) ? record.amountByLevel : undefined;
          const amount = amountByLevel?.[Math.min(levelIndex, amountByLevel.length - 1)] ?? record.amount;
          if (typeof amount !== "number" || !Number.isFinite(amount)) return sum;
          return sum + amount * target.damageMultiplier;
        }, 0);
        this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.enemy.id, damage: expectedDamage });
        for (let effectIndex = 0; effectIndex < attack.effects.length; effectIndex += 1) {
          if (target.enemy.hp <= 0) break;
          const displacementRank = displacementRanks?.get(effectIndex);
          this.applyPipelineEffect(
            tower,
            target.enemy,
            attack.effects[effectIndex],
            target.damageMultiplier,
            levelIndex,
            attack.delivery.kind === "area" || attack.delivery.kind === "aura",
            displacementRank !== undefined && (
              targetIndex < PHYSICS_LIMITS.displacementTargetsPerActivation
              && displacementRank < PHYSICS_LIMITS.displacementEffectsPerSource
            ),
            displacementBudget
          );
        }
      }
      tower.cooldown += interval;
      activations += 1;
    }
  }

  private pipelineTargets(
    tower: TowerState,
    attack: EffectPipelineAttackModel
  ): Array<{ enemy: EnemyState; damageMultiplier: number }> {
    const classes = attack.targeting?.classes?.length ? attack.targeting.classes : ["ground" as const];
    const inRange = this.orderTowerTargetCandidates(tower, this.enemies.filter((enemy) => (
      enemy.hp > 0
      && classes.includes(this.enemyTargetClass(enemy))
      && this.enemyInTowerAcquisitionRange(tower, enemy)
    )));
    if (attack.delivery.kind === "aura") return inRange.map((enemy) => ({ enemy, damageMultiplier: 1 }));

    if (attack.delivery.kind === "cone") {
      const primary = inRange[0];
      if (!primary) return [];
      const maximum = Math.max(1, attack.targeting?.maxTargets ?? 1);
      const angleDegrees = attack.delivery.angleDegrees;
      return inRange
        .filter((enemy) => this.enemyInsideTowerCone(tower, primary, enemy, angleDegrees))
        .slice(0, maximum)
        .map((enemy) => ({ enemy, damageMultiplier: 1 }));
    }

    const primaryLimit = attack.delivery.kind === "single" ? 1 : Math.max(1, attack.targeting?.maxTargets ?? 1);
    const primaries = inRange.slice(0, primaryLimit);
    if (attack.delivery.kind === "single" || attack.delivery.kind === "multi") {
      return primaries.map((enemy) => ({ enemy, damageMultiplier: 1 }));
    }

    const delivered = new Map<string, { enemy: EnemyState; damageMultiplier: number }>();
    for (const primary of primaries) {
      delivered.set(primary.id, { enemy: primary, damageMultiplier: 1 });
      if (attack.delivery.kind === "area") {
        const multiplier = Math.max(0, attack.delivery.secondaryMultiplier ?? 1);
        const center = this.enemyCoord(primary);
        for (const enemy of this.enemies) {
          if (enemy.hp <= 0 || !classes.includes(this.enemyTargetClass(enemy)) || this.map.distance(center, this.enemyCoord(enemy)) > attack.delivery.radius) continue;
          const nextMultiplier = enemy.id === primary.id ? 1 : multiplier;
          const current = delivered.get(enemy.id);
          if (!current || nextMultiplier > current.damageMultiplier) delivered.set(enemy.id, { enemy, damageMultiplier: nextMultiplier });
        }
      } else if (attack.delivery.kind === "chain") {
        const delivery = attack.delivery;
        let current = primary;
        const visited = new Set<string>([primary.id]);
        for (let hop = 1; hop <= delivery.maxJumps; hop += 1) {
          const center = this.enemyCoord(current);
          const next = this.enemies
            .filter((enemy) => enemy.hp > 0 && !visited.has(enemy.id) && classes.includes(this.enemyTargetClass(enemy)) && this.map.distance(center, this.enemyCoord(enemy)) <= delivery.jumpRadius)
            .sort((left, right) => this.map.distance(center, this.enemyCoord(left)) - this.map.distance(center, this.enemyCoord(right)) || left.id.localeCompare(right.id))[0];
          if (!next) break;
          visited.add(next.id);
          const damageMultiplier = Math.pow(delivery.damageFalloff ?? 1, hop);
          const existing = delivered.get(next.id);
          if (!existing || damageMultiplier > existing.damageMultiplier) delivered.set(next.id, { enemy: next, damageMultiplier });
          current = next;
        }
      }
    }
    return [...delivered.values()];
  }

  private applyPipelineEffect(
    tower: TowerState,
    enemy: EnemyState,
    effectValue: unknown,
    deliveryMultiplier: number,
    levelIndex: number,
    aoe: boolean,
    displacementAllowed: boolean,
    displacementBudget: DisplacementActivationBudget | undefined
  ): void {
    const inspected = inspectOwnDataEffect(effectValue);
    if (!inspected.ok) return;
    const effect = inspected.record;
    if (inspected.kind === "damage") {
      if (typeof effect.amount !== "number" || !Number.isFinite(effect.amount)) return;
      const amountByLevel = Array.isArray(effect.amountByLevel) ? effect.amountByLevel : undefined;
      const amount = amountByLevel?.[Math.min(levelIndex, amountByLevel.length - 1)] ?? effect.amount;
      if (typeof amount !== "number" || !Number.isFinite(amount)) return;
      this.applyTowerDamage(tower, enemy, amount * deliveryMultiplier, {
        aoe,
        damageType: typeof effect.damageType === "string" ? effect.damageType : undefined,
        armorPiercing: typeof effect.armorPiercing === "boolean" ? effect.armorPiercing : undefined,
        applyLegacyStatus: false
      });
    } else if (inspected.kind === "status") {
      if (!effect.status || typeof effect.status !== "object") return;
      this.applyStatusEffect(enemy, effect.status as StatusEffectSpec);
    } else if (inspected.kind === "resource") {
      if (!effect.resources || typeof effect.resources !== "object") return;
      const resources = this.normalizeCost(effect.resources as ResourceBag);
      this.addResources(resources);
      this.lastEvents.push({ type: "towerResourcesGranted", towerId: tower.id, enemyId: enemy.id, resources });
    } else if (inspected.kind === "displacement" && displacementAllowed) {
      const displacement = this.reserveDisplacementEffect(effect, displacementBudget, true);
      if (!displacement) return;
      this.applyDisplacementEffect(enemy, displacement, {
        sourceKind: "tower",
        sourceId: tower.id,
        sourceCoord: tower.coord
      });
    }
  }

  private findSingleTarget(tower: TowerState): EnemyState | undefined {
    return this.selectTargets(tower, "ground", 1)[0];
  }

  private findSniperTarget(tower: TowerState): EnemyState | undefined {
    return this.selectTargets(tower, "ground", 1)[0];
  }

  private findAntiAirTargets(tower: TowerState): EnemyState[] {
    const type = this.towerTypes[tower.typeId];
    const attack = type?.attack.kind === "antiair" ? type.attack : undefined;
    if (!attack) {
      return [];
    }

    const limit = attack.maxTargetsByLevel[Math.min(tower.level, attack.maxTargetsByLevel.length) - 1] ?? 1;
    return this.selectTargets(tower, "flying", limit);
  }

  private findSplashTarget(tower: TowerState): EnemyState | undefined {
    return this.selectTargets(tower, "ground", 1)[0];
  }

  private towerSupportsTargetMode(tower: TowerState): boolean {
    const kind = this.towerTypes[tower.typeId]?.attack.kind;
    return kind === "single" || kind === "sniper" || kind === "antiair" || kind === "splash" || kind === "pipeline";
  }

  private selectTargets(tower: TowerState, targetClass: "ground" | "flying", limit: number): EnemyState[] {
    return this.orderTowerTargetCandidates(tower, this.enemies.filter((enemy) => (
      enemy.hp > 0
      && this.enemyTargetClass(enemy) === targetClass
      && this.enemyInTowerAcquisitionRange(tower, enemy)
    ))).slice(0, Math.max(0, limit));
  }

  private legacyOrderTowerTargetCandidates(tower: TowerState, candidates: readonly EnemyState[]): EnemyState[] {
    const sorted = [...candidates].sort((left, right) => this.compareTargets(tower, left, right));
    if (!this.activeLineOfSightProfile && !this.dynamicLineOfSightIndex) return sorted;
    return sorted
      .slice(0, LINE_OF_SIGHT_LIMITS.candidatesPerAcquisition)
      .filter((enemy) => this.towerHasLineOfSight(tower, enemy));
  }

  private orderTowerTargetCandidates(tower: TowerState, candidates: readonly EnemyState[]): EnemyState[] {
    const controller = this.scriptedTargetingByTowerType.get(tower.typeId);
    if (!controller) return this.legacyOrderTowerTargetCandidates(tower, candidates);

    const stable = [...candidates].sort((left, right) => compareBinary(left.id, right.id));
    const visible: EnemyState[] = [];
    for (const enemy of stable) {
      if ((this.activeLineOfSightProfile || this.dynamicLineOfSightIndex)
        && !this.towerHasLineOfSight(tower, enemy)) continue;
      visible.push(enemy);
      // The engine owns the acquisition bound and keeps the first binary-stable candidates.
      // The pure evaluator separately rejects hostile over-budget direct callers.
      if (visible.length === TOWER_SCRIPT_LIMITS.behaviorCandidatesPerAcquisition) break;
    }
    const facts: TowerScriptTargetCandidateV1[] = visible.map((enemy) => {
      const shield = this.enemyShields[enemy.id];
      const remaining = this.activeNavigationProfile ? this.dynamicEnemyRemainingCost(enemy) : undefined;
      const routeProgress = remaining !== undefined && Number.isFinite(remaining)
        ? -remaining
        : this.enemyRouteProgressRatio(enemy);
      return Object.freeze({
        id: enemy.id,
        typeId: enemy.typeId,
        tags: Object.freeze([...(this.enemyTypes[enemy.typeId]?.tags ?? [])].sort(compareBinary)),
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        hpRatio: enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0,
        distance: this.map.distance(tower.coord, this.enemyCoord(enemy)),
        routeProgress,
        hasPierceOnlyArmor: this.hasPierceOnlyArmor(enemy),
        ...(shield ? { shieldCurrent: shield.current, shieldCapacity: shield.capacity } : {}),
        ...(enemy.statuses ? { statuses: enemy.statuses as unknown as Record<string, TowerScriptJson> } : {}),
        ...(this.enemyMarks[enemy.id] ? { marks: this.enemyMarks[enemy.id] as unknown as Record<string, TowerScriptJson> } : {}),
        ...(this.enemyExposures[enemy.id] ? { exposures: this.enemyExposures[enemy.id] as unknown as Record<string, TowerScriptJson> } : {})
      });
    });
    const stateKey = `tower:${tower.id}`;
    const decision = evaluateTowerScriptBehaviorTree(controller.tree, {
      tower: Object.freeze({
        id: tower.id,
        typeId: tower.typeId,
        level: tower.level,
        targetMode: tower.targetMode ?? "first",
        hp: tower.hp ?? null,
        maxHp: this.towerTypes[tower.typeId]?.maxHp ?? null
      }),
      game: Object.freeze({
        missionId: this.mission.id,
        mapId: this.mission.mapId,
        difficultyId: this.difficulty.id,
        elapsed: this.missionElapsed,
        waveIndex: this.waveIndex,
        coreHp: this.coreHp,
        maxCoreHp: this.maxCoreHp,
        enemyCount: this.enemies.length,
        towerCount: this.towers.length,
        outcome: this.outcome
      }),
      state: this.scriptStateFor(controller.script, stateKey),
      candidates: facts
    });
    for (const node of decision.trace) {
      const trace = this.towerScriptTrace?.record({
        phase: "behavior",
        eventName: "tick",
        scriptId: controller.script.id,
        contextId: stateKey,
        controllerId: controller.tree.id,
        nodeId: node.nodeId,
        nodeKind: node.nodeKind,
        status: node.status,
        ...(node.selectedTargetIds === undefined ? {} : {
          selectedTargetIds: node.selectedTargetIds.slice(0, TOWER_SCRIPT_LIMITS.behaviorCandidatesPerAcquisition)
        })
      });
      if (trace && this.towerScriptTrace?.shouldPauseAfterEntry(trace.sequence)) {
        throw new TowerScriptTracePauseError(trace.sequence);
      }
    }
    if (decision.status !== "success") {
      if (decision.diagnostic) {
        this.recordScriptDiagnostic({
          scriptId: controller.script.id,
          handlerId: controller.tree.id,
          event: "tick",
          code: decision.diagnostic.code === "budget_exceeded" ? "budget_exceeded"
            : decision.diagnostic.code === "invalid_expression" ? "invalid_expression" : "runtime_error",
          message: decision.diagnostic.message
        });
      }
      return this.legacyOrderTowerTargetCandidates(tower, candidates);
    }
    const byId = new Map(visible.map((enemy) => [enemy.id, enemy] as const));
    const selected: EnemyState[] = [];
    const seen = new Set<string>();
    for (const id of decision.selectedTargetIds) {
      const enemy = byId.get(id);
      if (enemy && !seen.has(id)) {
        seen.add(id);
        selected.push(enemy);
      }
    }
    return selected.length > 0 ? selected : this.legacyOrderTowerTargetCandidates(tower, candidates);
  }

  private towerHasLineOfSight(tower: TowerState, enemy: EnemyState): boolean {
    const profile = this.activeLineOfSightProfile;
    const dynamicIndex = this.dynamicLineOfSightIndex;
    if (!dynamicIndex) {
      if (!profile) return true;
      return traceLineOfSight(
        this.map,
        this.content.terrainTypes,
        profile.terrainBlockerTags,
        tower.coord,
        this.enemyCoord(enemy)
      ).row.visible;
    }
    return traceLineOfSightV2(
      this.map,
      profile === undefined ? undefined : this.lineOfSightLegacyPolicy(profile),
      dynamicIndex,
      tower.coord,
      this.enemyCoord(enemy)
    ).row.visible;
  }

  private lineOfSightLegacyPolicy(profile: LineOfSightRuntimeProfileV2): LineOfSightLegacyPolicyV1 {
    return {
      terrainTypes: this.content.terrainTypes,
      terrainBlockerTags: profile.terrainBlockerTags
    };
  }

  private compareTargets(tower: TowerState, left: EnemyState, right: EnemyState): number {
    if (this.activeNavigationProfile) return this.compareDynamicTargets(tower, left, right);
    const mode = tower.targetMode ?? "first";
    const leftProgress = this.enemyRouteProgressRatio(left);
    const rightProgress = this.enemyRouteProgressRatio(right);
    const leftDistance = this.map.distance(tower.coord, this.enemyCoord(left));
    const rightDistance = this.map.distance(tower.coord, this.enemyCoord(right));
    let result = 0;
    if (mode === "last") result = leftProgress - rightProgress;
    else if (mode === "closest") result = leftDistance - rightDistance;
    else if (mode === "furthest") result = rightDistance - leftDistance;
    else if (mode === "strongest" || mode === "largest_hp") result = right.hp - left.hp || rightProgress - leftProgress;
    else if (mode === "weakest") result = left.hp - right.hp || rightProgress - leftProgress;
    else if (mode === "fastest_ahead") {
      result = Number(this.hasPierceOnlyArmor(right)) - Number(this.hasPierceOnlyArmor(left)) || rightProgress - leftProgress;
    } else result = rightProgress - leftProgress;
    return result || left.id.localeCompare(right.id);
  }

  private compareDynamicTargets(tower: TowerState, left: EnemyState, right: EnemyState): number {
    const mode = tower.targetMode ?? "first";
    const leftRemaining = this.dynamicEnemyRemainingCost(left);
    const rightRemaining = this.dynamicEnemyRemainingCost(right);
    const compareRemaining = leftRemaining === rightRemaining
      ? 0
      : leftRemaining < rightRemaining ? -1 : 1;
    const leftDistance = this.map.distance(tower.coord, this.enemyCoord(left));
    const rightDistance = this.map.distance(tower.coord, this.enemyCoord(right));
    let result = 0;
    if (mode === "last") result = -compareRemaining;
    else if (mode === "closest") result = leftDistance - rightDistance;
    else if (mode === "furthest") result = rightDistance - leftDistance;
    else if (mode === "strongest" || mode === "largest_hp") result = right.hp - left.hp || compareRemaining;
    else if (mode === "weakest") result = left.hp - right.hp || compareRemaining;
    else if (mode === "fastest_ahead") {
      result = Number(this.hasPierceOnlyArmor(right)) - Number(this.hasPierceOnlyArmor(left)) || compareRemaining;
    } else result = compareRemaining;
    return result || compareBinary(left.id, right.id);
  }

  private dynamicEnemyRemainingCost(enemy: EnemyState): number {
    if (!enemy.navigation || !enemy.routeId || !this.navigationFieldLookupCache) return Number.POSITIVE_INFINITY;
    const field = this.navigationField(enemy.navigation.movementProfileId, enemy.routeId);
    return this.navigationFieldLookupCache.get(field).remainingCost(enemy.navigation);
  }

  private enemyInRange(tower: TowerState, enemy: EnemyState, range: number): boolean {
    return this.map.distance(tower.coord, this.enemyCoord(enemy)) <= range;
  }

  private highGroundPair(tower: TowerState, enemy: EnemyState) {
    const profile = this.activeHighGroundProfile;
    if (!profile) return undefined;
    return computeHighGroundPairModifiers(
      this.map.elevationAt(tower.coord),
      this.map.elevationAt(this.enemyCoord(enemy)),
      profile
    );
  }

  private enemyInTowerAcquisitionRange(tower: TowerState, enemy: EnemyState): boolean {
    const rangeBonus = this.highGroundPair(tower, enemy)?.rangeBonus ?? 0;
    const distance = this.map.distance(tower.coord, this.enemyCoord(enemy));
    const type = this.towerTypes[tower.typeId];
    const minRange = type?.attack.kind === "pipeline" ? (type.attack.minRange ?? 0) : 0;
    return distance >= minRange
      && distance <= this.towerRange(tower) * this.weatherMultiplierAt("visibility_range", tower.coord) + rangeBonus;
  }

  private enemyInsideTowerCone(
    tower: TowerState,
    primary: EnemyState,
    candidate: EnemyState,
    angleDegrees: number
  ): boolean {
    if (candidate.id === primary.id || angleDegrees >= 360) return true;
    const origin = this.gridWorldPoint(tower.coord);
    const aim = this.gridWorldPoint(this.enemyCoord(primary));
    const point = this.gridWorldPoint(this.enemyCoord(candidate));
    const aimX = aim.x - origin.x;
    const aimY = aim.y - origin.y;
    const pointX = point.x - origin.x;
    const pointY = point.y - origin.y;
    const aimLength = Math.hypot(aimX, aimY);
    const pointLength = Math.hypot(pointX, pointY);
    if (aimLength === 0 || pointLength === 0) return false;
    const cosine = (aimX * pointX + aimY * pointY) / (aimLength * pointLength);
    return cosine + 1e-12 >= Math.cos((angleDegrees * Math.PI) / 360);
  }

  private gridWorldPoint(coord: HexCoord): { x: number; y: number } {
    if (this.map.grid.kind === "square") return { x: coord.q, y: coord.r };
    const parity = ((coord.r % 2) + 2) % 2;
    return {
      x: Math.sqrt(3) * (coord.q + parity / 2),
      y: 1.5 * coord.r
    };
  }

  private towerRange(tower: TowerState): number {
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

  private slipperyJackInterval(tower: TowerState): number {
    const type = this.towerTypes[tower.typeId];
    if (!type || type.attack.kind !== "splash") {
      return 1;
    }
    const levelIndex = Math.max(0, tower.level - 1);
    return type.attack.intervalByLevel?.[Math.min(levelIndex, type.attack.intervalByLevel.length - 1)] ?? type.attack.interval;
  }

  private towerPulseRate(tower: TowerState): number {
    const type = this.towerTypes[tower.typeId];
    if (!type || type.attack.kind !== "pulse") {
      return 1;
    }
    const levelIndex = Math.max(0, tower.level - 1);
    return type.attack.pulseRateByLevel?.[Math.min(levelIndex, type.attack.pulseRateByLevel.length - 1)] ?? type.attack.pulseRate;
  }

  private enemyTrack(enemy: EnemyState): HexCoord[] {
    return this.enemyTrackForType(enemy.typeId, enemy.routeId);
  }

  private enemyTrackForType(typeId: string, routeId?: string): HexCoord[] {
    return this.enemyTypes[typeId]?.movementKind === "direct_flying"
      ? this.directFlightLine
      : (this.map.pathRouteById(routeId)?.pathCenterline ?? this.map.pathCenterline);
  }

  private enemyTargetClass(enemy: EnemyState): "ground" | "flying" {
    return this.enemyTargetClassByType(enemy.typeId);
  }

  private enemyTargetClassByType(typeId: string): "ground" | "flying" {
    return this.enemyTypes[typeId]?.targetClass ?? "ground";
  }

  private enemyTerrainSpeedFactor(enemy: EnemyState): number {
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

  private enemyStatusSpeedFactor(enemy: EnemyState): number {
    if ((enemy.statuses?.stun?.remaining ?? 0) > 0) {
      return 0; // stunned enemies are frozen in place
    }
    const slow = enemy.statuses?.slow;
    if (!slow || slow.remaining <= 0) {
      return 1;
    }
    return Math.min(1, Math.max(0.05, slow.factor));
  }

  private isEnemyInSunlight(enemy: EnemyState): boolean {
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

  private buildVanguardProtectionIndex(): VanguardProtectionIndexV1 | undefined {
    if (this.vanguardProtectionIndex) return this.vanguardProtectionIndex;
    const assignments = this.activeFormationAssignments;
    if (!assignments) return undefined;
    const mutable = new Map<string, EnemyState[]>();
    for (const enemy of [...this.enemies].sort((left, right) => compareBinary(left.id, right.id))) {
      const assignment = assignments.get(enemy.typeId);
      if (enemy.hp <= 0 || assignment?.role !== "vanguard" || !assignment.protection) continue;
      const key = `${assignment.cohortId}:${coordKey(this.enemyCoord(enemy))}`;
      const bucket = mutable.get(key) ?? [];
      bucket.push(enemy);
      mutable.set(key, bucket);
    }
    const buckets = new Map<string, readonly EnemyState[]>();
    for (const [key, enemies] of mutable) buckets.set(key, Object.freeze(enemies));
    this.vanguardProtectionIndex = { buckets };
    return this.vanguardProtectionIndex;
  }

  private collectVanguardProtectionCandidates(
    cohortId: string,
    targetCoord: HexCoord,
    radius: number,
    index: VanguardProtectionIndexV1
  ): readonly EnemyState[] {
    const candidates: EnemyState[] = [];
    const coords = this.map.topology.tilesWithin(targetCoord, radius);
    for (let distance = 0; distance <= radius && candidates.length < ENEMY_BEHAVIORS_LIMITS.protectionCandidatesPerPacket; distance += 1) {
      const buckets = coords
        .filter((coord) => this.map.topology.distance(targetCoord, coord) === distance)
        .map((coord) => index.buckets.get(`${cohortId}:${coordKey(coord)}`) ?? [])
        .filter((bucket) => bucket.length > 0);
      const cursors = buckets.map(() => 0);
      while (candidates.length < ENEMY_BEHAVIORS_LIMITS.protectionCandidatesPerPacket) {
        let selectedBucket = -1;
        let selected: EnemyState | undefined;
        for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
          const candidate = buckets[bucketIndex]![cursors[bucketIndex]!];
          if (candidate && (!selected || compareBinary(candidate.id, selected.id) < 0)) {
            selected = candidate;
            selectedBucket = bucketIndex;
          }
        }
        if (!selected || selectedBucket < 0) break;
        cursors[selectedBucket] = cursors[selectedBucket]! + 1;
        candidates.push(selected);
      }
    }
    this.vanguardProtectionMaximumCandidateCount = Math.max(
      this.vanguardProtectionMaximumCandidateCount,
      candidates.length
    );
    return Object.freeze(candidates);
  }

  private planVanguardDamageInterception(
    packet: DamagePacket,
    target: EnemyState
  ): { readonly packet: DamagePacket; readonly enemy: EnemyState } | undefined {
    const assignment = this.activeFormationAssignments?.get(target.typeId);
    const protection = assignment?.protection;
    if (
      target.hp <= 0
      || !protection
      || (assignment.role !== "body" && assignment.role !== "support")
      || packet.target.kind !== "enemy"
      || packet.amount <= 0
      || packet.source.kind === "leak"
      || packet.source.kind === "weather"
      || !protection.sourceKinds.includes(packet.source.kind)
      || this.vanguardProtectionTransactionsThisTick >= ENEMY_BEHAVIORS_LIMITS.protectionTransactionsPerTick
    ) return undefined;
    const index = this.buildVanguardProtectionIndex();
    if (!index) return undefined;
    const candidates = this.collectVanguardProtectionCandidates(
      assignment.cohortId,
      this.enemyCoord(target),
      protection.radius,
      index
    );
    let vanguard: EnemyState | undefined;
    for (const candidate of candidates) {
      this.vanguardProtectionCandidatesInspected += 1;
      const shield = this.enemyShields[candidate.id];
      if (candidate.hp > 0 && shield && shield.current > 0) {
        vanguard = candidate;
        break;
      }
    }
    if (!vanguard) return undefined;
    this.vanguardProtectionTransactionsThisTick += 1;
    this.lastEvents.push({
      type: "vanguardDamageIntercepted",
      cohortId: assignment.cohortId,
      protectedEnemyId: target.id,
      protectedEnemyTypeId: target.typeId,
      vanguardEnemyId: vanguard.id,
      vanguardEnemyTypeId: vanguard.typeId,
      sourceKind: packet.source.kind,
      requestedAmount: packet.amount,
      originalComponentId: packet.target.componentId ?? null
    });
    return {
      packet: {
        ...packet,
        target: { kind: "enemy", enemyId: vanguard.id, enemyTypeId: vanguard.typeId }
      },
      enemy: vanguard
    };
  }

  private enemyDamageResolutionContext(
    enemy: EnemyState,
    packet: DamagePacket
  ): DamageResolutionContext | undefined {
    const armorMatrix = resolveEnemyArmorMatrix(this.activeCombatMechanics, enemy.typeId);
    const resistances = this.activeCombatMechanics?.enemyResistances[enemy.typeId]
      ?? this.enemyTypes[enemy.typeId]?.resistances;
    const marks = this.activeMarkDamageContext(enemy);
    const legacyDefinition = this.enemyTypes[enemy.typeId]?.armor;
    const towerTypeId = packet.source.kind === "tower" ? packet.source.towerTypeId : undefined;
    const legacyArmor = legacyDefinition?.kind === "pierce_only"
      ? {
          kind: "pierce_only" as const,
          bypassed: packet.tags?.includes("armor_piercing") === true
            || (towerTypeId !== undefined && this.piercesSniperArmor(towerTypeId)),
          chipDamage: towerTypeId === undefined
            ? 0
            : this.armoredChipDamageForTower(towerTypeId, legacyDefinition.chipDamageByTowerId)
        }
      : undefined;
    const context: DamageResolutionContext = {
      ...(armorMatrix === undefined ? {} : { armorMatrix }),
      ...(resistances === undefined ? {} : { resistances }),
      ...(legacyArmor === undefined ? {} : { legacyArmor }),
      ...(marks === undefined ? {} : { marks })
    };
    return Object.keys(context).length === 0 ? undefined : context;
  }

  private applyResolvedEnemyDamage(
    enemy: EnemyState,
    amount: number,
    source: DamageSourceRef,
    options: ResolvedEnemyDamageOptions = {}
  ): RuntimeDamageApplicationResult {
    const componentDefinition = options.componentId === undefined
      ? undefined
      : this.activeEnemyBehaviors?.bosses?.[enemy.typeId]?.components[options.componentId];
    const componentArmor = componentDefinition?.armorTypeId === undefined
      ? undefined
      : this.activeCombatMechanics?.armorTypes[componentDefinition.armorTypeId];
    const armorMatrix = componentDefinition
      ? componentArmor === undefined
        ? undefined
        : {
            armorTypeId: componentDefinition.armorTypeId!,
            ...(componentArmor.defaultMultiplier === undefined ? {} : { defaultMultiplier: componentArmor.defaultMultiplier }),
            multipliers: componentArmor.multipliers
          }
      : resolveEnemyArmorMatrix(this.activeCombatMechanics, enemy.typeId);
    const resistances = this.activeCombatMechanics?.enemyResistances[enemy.typeId];
    const marks = this.activeMarkDamageContext(enemy);
    const context: DamageResolutionContext = {
      ...(options.context ?? {}),
      ...(resistances === undefined ? {} : { resistances }),
      ...(armorMatrix === undefined ? {} : { armorMatrix }),
      ...(marks === undefined ? {} : { marks })
    };
    return this.resolveAndApplyDamage(
      {
        amount,
        source,
        target: {
          kind: "enemy",
          enemyId: enemy.id,
          enemyTypeId: enemy.typeId,
          ...(options.componentId === undefined ? {} : { componentId: options.componentId })
        },
        ...(options.damageType === undefined ? {} : { damageType: options.damageType }),
        ...(options.tags?.length ? { tags: options.tags } : {}),
        ...(options.modifiers?.length ? { modifiers: options.modifiers } : {})
      },
      Object.keys(context).length === 0 ? undefined : context,
      { kind: "enemy", enemy },
      options.reactionRuntime
    );
  }

  private applyResolvedCoreDamage(amount: number, source: DamageSourceRef): DamageApplicationResult {
    return this.resolveAndApplyDamage(
      { amount, source, target: { kind: "core" } },
      undefined,
      { kind: "core" }
    );
  }

  private applyResolvedTowerEntityDamage(
    tower: TowerState,
    amount: number,
    source: DamageSourceRef
  ): DamageApplicationResult {
    return this.resolveAndApplyDamage(
      {
        amount,
        source,
        target: { kind: "tower", towerId: tower.id, towerTypeId: tower.typeId }
      },
      undefined,
      { kind: "tower", tower }
    );
  }

  private applyResolvedHeroDamage(
    hero: HeroRuntimeStateV2,
    amount: number,
    source: DamageSourceRef
  ): DamageApplicationResult {
    return this.resolveAndApplyDamage(
      {
        amount,
        source,
        target: {
          kind: "hero",
          heroId: hero.definitionId,
          heroDefinitionId: hero.definitionId
        }
      },
      undefined,
      { kind: "hero", hero }
    );
  }

  private resolveAndApplyDamage(
    packet: DamagePacket,
    context: DamageResolutionContext | undefined,
    mutableTarget: MutableDamageTarget,
    reactionRuntime?: ReactionRuntimeContext
  ): RuntimeDamageApplicationResult {
    if (mutableTarget.kind === "enemy") {
      const initialComponentId = packet.target.kind === "enemy" ? packet.target.componentId : undefined;
      const initialComponentState = initialComponentId === undefined
        ? undefined
        : this.enemyComponentStates[mutableTarget.enemy.id]?.[initialComponentId];
      if (
        packet.target.kind !== "enemy"
        || packet.target.enemyId !== mutableTarget.enemy.id
        || packet.target.enemyTypeId !== mutableTarget.enemy.typeId
        || (initialComponentId !== undefined && initialComponentState === undefined)
      ) {
        throw new Error("Damage packet target does not match mutable target or authored component.");
      }
    }
    if (mutableTarget.kind === "enemy") {
      const interception = this.planVanguardDamageInterception(packet, mutableTarget.enemy);
      if (interception) {
        packet = interception.packet;
        mutableTarget = { kind: "enemy", enemy: interception.enemy };
        context = this.enemyDamageResolutionContext(interception.enemy, packet);
      }
    }
    const componentId = packet.target.kind === "enemy" ? packet.target.componentId : undefined;
    const componentState = componentId === undefined || mutableTarget.kind !== "enemy"
      ? undefined
      : this.enemyComponentStates[mutableTarget.enemy.id]?.[componentId];
    const targetMatches = mutableTarget.kind === "core"
      ? packet.target.kind === "core"
      : mutableTarget.kind === "enemy"
        ? packet.target.kind === "enemy"
          && packet.target.enemyId === mutableTarget.enemy.id
          && packet.target.enemyTypeId === mutableTarget.enemy.typeId
          && (packet.target.componentId === undefined || componentState !== undefined)
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
    const componentDefinition = componentId === undefined || mutableTarget.kind !== "enemy"
      ? undefined
      : this.activeEnemyBehaviors?.bosses?.[mutableTarget.enemy.typeId]?.components[componentId];
    const previousComponentHp = componentState?.hp;
    const previousComponentShield = componentState?.shield?.current ?? 0;
    const componentShieldCapacity = componentState?.shield?.capacity ?? 0;
    const componentArmor = componentDefinition?.armorTypeId === undefined
      ? undefined
      : this.activeCombatMechanics?.armorTypes[componentDefinition.armorTypeId];
    const componentContext = componentDefinition === undefined
      ? context
      : {
          ...(context ?? {}),
          armorMatrix: componentArmor === undefined
            ? undefined
            : {
                armorTypeId: componentDefinition.armorTypeId!,
                ...(componentArmor.defaultMultiplier === undefined ? {} : { defaultMultiplier: componentArmor.defaultMultiplier }),
                multipliers: componentArmor.multipliers
              }
        };
    const resolvedDamage = DamageResolver.resolve(packet, componentContext);
    const capturedReactionState = mutableTarget.kind === "enemy" && this.activeReactionsMechanics
      ? {
          coord: this.enemyCoord(mutableTarget.enemy),
          exposures: cloneExposureStates(this.enemyExposures[mutableTarget.enemy.id] ?? {}),
          statuses: mutableTarget.enemy.statuses
            ? Object.fromEntries(Object.entries(mutableTarget.enemy.statuses).map(([key, value]) => [key, value ? { ...value } : value]))
            : {},
          terrainTags: [...this.terrainMetadata(
            this.map.getTile(this.enemyCoord(mutableTarget.enemy))?.terrain
              ?? this.content.maps[this.mission.mapId]?.defaultTerrain
              ?? ""
          ).tags]
        }
      : undefined;
    let shieldAbsorbed = 0;
    let hpDamage = resolvedDamage.finalAmount;
    if (resolvedDamage.finalAmount > 0 && mutableTarget.kind === "hero") {
      const definition = (this.activeHeroesMechanics?.schemaVersion === 3
        || this.activeHeroesMechanics?.schemaVersion === 4
        || this.activeHeroesMechanics?.schemaVersion === 5
        || this.activeHeroesMechanics?.schemaVersion === 6
        || this.activeHeroesMechanics?.schemaVersion === 7)
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
          if (previous > 0 && mutableTarget.hero.shieldCurrent === 0) {
            this.failPreserveShieldQuests("hero");
          }
        }
      }
    } else if (
      resolvedDamage.finalAmount > 0
      && (mutableTarget.kind === "enemy" || mutableTarget.kind === "tower")
    ) {
      const entity = mutableTarget.kind === "enemy" ? mutableTarget.enemy : mutableTarget.tower;
      const state = mutableTarget.kind === "enemy" ? this.enemyShields[entity.id] : this.towerShields[entity.id];
      const definition = mutableTarget.kind === "enemy"
        ? this.combatShieldDefinitions?.enemies[entity.typeId]
        : this.combatShieldDefinitions?.towers[entity.typeId];
      if (state && definition) {
        state.regenerationDelayRemaining = definition.regeneration?.delayAfterDamage ?? 0;
        const previous = state.current;
        shieldAbsorbed = Math.min(previous, resolvedDamage.finalAmount);
        hpDamage = resolvedDamage.finalAmount - shieldAbsorbed;
        state.current = previous - shieldAbsorbed;
        if (shieldAbsorbed > 0) {
          if (mutableTarget.kind === "enemy") {
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
          } else {
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
            if (previous > 0 && state.current === 0) {
              this.failPreserveShieldQuests("tower");
            }
          }
        }
      }
    }
    if (resolvedDamage.finalAmount > 0 && componentState && componentDefinition?.shield) {
      const shield = componentState.shield;
      if (!shield) throw new Error("Boss component shield state is missing.");
      shield.regenerationDelayRemaining = componentDefinition.shield.regeneration?.delayAfterDamage ?? 0;
      const absorbed = Math.min(shield.current, hpDamage);
      shield.current -= absorbed;
      shieldAbsorbed += absorbed;
      hpDamage -= absorbed;
    }
    // Keep the target-specific legacy mutation formulas stable while applying only overflow to HP.
    const resolution: DamageResolution = hpDamage === resolvedDamage.finalAmount
      ? resolvedDamage
      : { ...resolvedDamage, finalAmount: hpDamage };
    const previousEnemyHp = mutableTarget.kind === "enemy" ? mutableTarget.enemy.hp : undefined;
    if (mutableTarget.kind === "enemy" && componentState) {
      componentState.hp = Math.max(0, componentState.hp - resolution.finalAmount);
    } else if (mutableTarget.kind === "enemy") {
      // Zero is the canonical pending-death state. Settlement intentionally stays
      // deferred to removeDeadEnemies(), preserving reward/event ordering exactly once.
      mutableTarget.enemy.hp = Math.max(0, mutableTarget.enemy.hp - resolution.finalAmount);
      if ((previousEnemyHp ?? 0) > 0 && mutableTarget.enemy.hp === 0) {
        this.creditQuestLethalDamage(packet.source);
      }
    } else if (mutableTarget.kind === "core") {
      this.coreHp = Math.max(0, this.coreHp - resolution.finalAmount);
    } else if (mutableTarget.kind === "tower") {
      mutableTarget.tower.hp = (mutableTarget.tower.hp ?? 0) - resolution.finalAmount;
    } else {
      mutableTarget.hero.hp = Math.max(0, (mutableTarget.hero.hp ?? 0) - resolution.finalAmount);
    }
    if (
      mutableTarget.kind === "enemy"
      && componentId !== undefined
      && componentState
      && previousComponentHp !== undefined
    ) {
      const currentComponentShield = componentState.shield?.current ?? 0;
      const componentHpDamage = previousComponentHp - componentState.hp;
      const componentShieldAbsorbed = previousComponentShield - currentComponentShield;
      if (componentHpDamage > 0 || componentShieldAbsorbed > 0) {
        const payload = {
          enemyId: mutableTarget.enemy.id,
          enemyTypeId: mutableTarget.enemy.typeId,
          componentId,
          sourceKind: packet.source.kind,
          previousHp: previousComponentHp,
          currentHp: componentState.hp,
          maxHp: componentState.maxHp,
          hpDamage: componentHpDamage,
          previousShield: previousComponentShield,
          currentShield: currentComponentShield,
          shieldCapacity: componentShieldCapacity,
          shieldAbsorbed: componentShieldAbsorbed
        } as const;
        this.lastEvents.push({ type: "bossComponentDamaged", ...payload });
        if (previousComponentHp > 0 && componentState.hp === 0) {
          this.lastEvents.push({ type: "bossComponentDestroyed", ...payload });
        }
      }
    }
    if (mutableTarget.kind === "enemy") {
      this.consumeResolvedMarks(mutableTarget.enemy, resolvedDamage);
      this.applySourceMarkBindings(mutableTarget.enemy, packet, resolvedDamage);
      if (capturedReactionState) {
        this.planAndApplyReactions(packet, mutableTarget.enemy, resolvedDamage, capturedReactionState, reactionRuntime);
      }
    }
    return {
      resolution: resolvedDamage,
      shieldAbsorbed,
      hpDamage,
      ...(mutableTarget.kind === "enemy" ? { enemyTarget: mutableTarget.enemy } : {})
    };
  }

  private planAndApplyReactions(
    packet: DamagePacket,
    enemy: EnemyState,
    resolvedDamage: DamageResolution,
    captured: {
      coord: HexCoord;
      exposures: Record<string, ExposureRuntimeStateV1>;
      statuses: Record<string, unknown>;
      terrainTags: string[];
    },
    runtime?: ReactionRuntimeContext
  ): void {
    const profile = this.activeReactionsMechanics;
    if (!profile) return;
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
        terrainTags: this.terrainMetadata(
          this.map.getTile(this.enemyCoord(candidate))?.terrain
            ?? this.content.maps[this.mission.mapId]?.defaultTerrain
            ?? ""
        ).tags
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
        if (!states || !previous) continue;
        const currentStacks = consumption.stacks === "all" ? 0 : Math.max(0, previous.stacks - 1);
        const remaining = currentStacks === 0 ? 0 : previous.remaining;
        if (currentStacks === 0) delete states[consumption.exposureId];
        else states[consumption.exposureId] = { stacks: currentStacks, remaining };
        if (Object.keys(states).length === 0) delete this.enemyExposures[enemy.id];
        this.lastEvents.push({
          type: "enemyExposureChanged", enemyId: enemy.id, enemyTypeId: enemy.typeId,
          exposureId: consumption.exposureId, previousStacks: previous.stacks, currentStacks,
          previousRemaining: previous.remaining, remaining, cause: "consume"
        });
      } else if (enemy.statuses?.[consumption.statusId]) {
        delete enemy.statuses[consumption.statusId];
      }
    }
    for (const trigger of plan.triggers) {
      this.lastEvents.push({ type: "enemyReactionTriggered", ...trigger });
    }
    for (const application of plan.exposureApplications) {
      this.applyEnemyExposure(
        enemy,
        application.exposureId,
        application.stacks,
        application.duration,
        application.maxStacks,
        "damage"
      );
    }
    for (const diagnostic of plan.diagnostics) {
      const accumulated = root.diagnostics[diagnostic.budget];
      if (accumulated) accumulated.dropped += diagnostic.dropped;
      else root.diagnostics[diagnostic.budget] = {
        limit: diagnostic.limit,
        dropped: diagnostic.dropped
      };
    }
    root.queue.push(...plan.secondaryPlans);
    root.scheduledPackets += plan.secondaryPlans.length;
    if (root.processing) return;
    root.processing = true;
    while (root.queue.length > 0) {
      const secondary = root.queue.shift()!;
      const target = this.enemies.find((candidate) => candidate.id === secondary.targetEnemyId && candidate.hp > 0);
      if (!target) continue;
      this.applyResolvedEnemyDamage(
        target,
        secondary.amount,
        { kind: "reaction", reactionId: secondary.reactionId },
        {
          damageType: secondary.damageType,
          tags: secondary.tags,
          reactionRuntime: {
            depth: secondary.depth,
            allowReactions: secondary.allowReactions,
            root
          }
        }
      );
    }
    root.processing = false;
    for (const budget of ["depth", "secondary_packets", "live_exposures"] as const) {
      const diagnostic = root.diagnostics[budget];
      if (!diagnostic) continue;
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

  private applyEnemyExposure(
    enemy: EnemyState,
    exposureId: string,
    stacks: number,
    duration: number,
    maxStacks: number,
    cause: "damage" | "script"
  ): void {
    const states = this.enemyExposures[enemy.id] ?? emptyDataRecord<ExposureRuntimeStateV1>();
    const previous = states[exposureId];
    const previousStacks = previous?.stacks ?? 0;
    const previousRemaining = previous?.remaining ?? 0;
    const currentStacks = Math.min(maxStacks, previousStacks + stacks);
    const remaining = duration;
    if (currentStacks === previousStacks && remaining === previousRemaining) return;
    states[exposureId] = { stacks: currentStacks, remaining };
    this.enemyExposures[enemy.id] = states;
    this.lastEvents.push({
      type: "enemyExposureChanged", enemyId: enemy.id, enemyTypeId: enemy.typeId,
      exposureId, previousStacks, currentStacks, previousRemaining, remaining, cause
    });
  }

  private updateEnemyExposures(delta: number): void {
    if (delta <= 0 || !this.activeReactionsMechanics) return;
    for (const enemyId of Object.keys(this.enemyExposures).sort()) {
      const enemy = this.enemies.find((candidate) => candidate.id === enemyId);
      const states = this.enemyExposures[enemyId];
      if (!enemy || !states) continue;
      for (const exposureId of Object.keys(states).sort()) {
        const previous = states[exposureId];
        if (!previous) continue;
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
      if (Object.keys(states).length === 0) delete this.enemyExposures[enemyId];
    }
  }

  private applyTowerDamage(
    tower: TowerState,
    enemy: EnemyState,
    rawDamage: number,
    options: DamageResolutionOptions = {}
  ): number {
    const application = this.applyResolvedTowerDamage(tower.typeId, enemy, rawDamage, options, tower.id);
    const appliedEnemy = application.enemyTarget ?? enemy;
    const damage = application.resolution.finalAmount;
    if (damage > 0) {
      if (options.applyLegacyStatus !== false) this.applyStatusOnHit(tower.typeId, appliedEnemy);
      this.lastEvents.push({
        type: "enemyHit",
        towerId: tower.id,
        enemyId: appliedEnemy.id,
        enemyTypeId: appliedEnemy.typeId,
        damage
      });
      return damage;
    }

    if (rawDamage > 0 && application.resolution.blockedByArmor) {
      this.lastEvents.push({
        type: "enemyArmorBlocked",
        towerId: tower.id,
        enemyId: appliedEnemy.id,
        enemyTypeId: appliedEnemy.typeId,
        rawDamage
      });
    }
    return 0;
  }

  private buildTowerDamagePacket(
    towerTypeId: string,
    enemy: EnemyState,
    rawDamage: number,
    options: DamageResolutionOptions = {},
    towerId?: string
  ): DamagePacket {
    const modifiers: ModifierSpec[] = [];
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

    const tags: DamageTag[] = [];
    if (options.overTime) tags.push("over_time");
    else if (options.aoe) tags.push("area");
    if (options.armorPiercing) tags.push("armor_piercing");

    const source: DamageSourceRef = {
      kind: "tower",
      towerTypeId,
      ...(towerId === undefined ? {} : { towerId })
    };
    const componentId = this.towerComponentTargetId(enemy, towerTypeId);
    return Object.freeze({
      amount: rawDamage,
      damageType: options.damageType ?? this.damageTypeOf(towerTypeId),
      source: Object.freeze(source),
      target: Object.freeze({
        kind: "enemy" as const,
        enemyId: enemy.id,
        enemyTypeId: enemy.typeId,
        ...(componentId === undefined ? {} : { componentId })
      }),
      ...(tags.length ? { tags } : {}),
      ...(modifiers.length ? { modifiers } : {})
    });
  }

  private applyResolvedTowerDamage(
    towerTypeId: string,
    enemy: EnemyState,
    rawDamage: number,
    options: DamageResolutionOptions = {},
    towerId?: string
  ): RuntimeDamageApplicationResult {
    const packet = this.buildTowerDamagePacket(towerTypeId, enemy, rawDamage, options, towerId);
    return this.applyResolvedEnemyDamage(enemy, packet.amount, packet.source, {
      damageType: packet.damageType,
      componentId: packet.target.kind === "enemy" ? packet.target.componentId : undefined,
      ...(packet.tags === undefined ? {} : { tags: packet.tags }),
      ...(packet.modifiers === undefined ? {} : { modifiers: packet.modifiers }),
      context: this.enemyDamageResolutionContext(enemy, packet)
    });
  }

  private draftDamageModifiersForTower(tower: TowerState): readonly ModifierSpec[] {
    const active = this.activeRogueliteMechanics;
    if (!active?.draft || (this.campaignDeck.length === 0 && this.draftSelections.length === 0)) return [];
    const tags = new Set(active.towerTagsByTypeId[tower.typeId] ?? []);
    const modifiers: ModifierSpec[] = [];
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
      if (!definition) throw new Error(`Draft selection references unknown card "${selection.cardId}".`);
      definition.effects.forEach((effect, effectIndex) => {
        const matches = effect.scope.kind === "all_towers"
          || (effect.scope.kind === "tower_type" && effect.scope.towerTypeId === tower.typeId)
          || (effect.scope.kind === "tower_tag" && tags.has(effect.scope.tag));
        if (!matches) return;
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
  private damageTypeOf(towerTypeId: string): string {
    const attack = this.towerTypes[towerTypeId]?.attack as { damageType?: string } | undefined;
    return attack?.damageType ?? "physical";
  }

  /** "pierce_only" armor is fully pierced by any sniper-kind weapon, regardless of its tower id. */
  private piercesSniperArmor(towerTypeId: string): boolean {
    return this.towerTypes[towerTypeId]?.attack.kind === "sniper";
  }

  private armoredChipDamageForTower(towerTypeId: string, chipDamageByTowerId?: Record<string, number>): number {
    const configured = chipDamageByTowerId?.[towerTypeId];
    if (typeof configured === "number" && Number.isFinite(configured)) {
      return Math.max(0, configured);
    }

    const attack = this.towerTypes[towerTypeId]?.attack;
    return attack?.kind === "splash" ? Math.max(0, attack.armoredChipDamage) : 0;
  }

  private hasPierceOnlyArmor(enemy: EnemyState): boolean {
    return this.enemyTypes[enemy.typeId]?.armor?.kind === "pierce_only";
  }

  private applySlow(enemy: EnemyState, factor: number, duration: number, affectsClasses: EnemyTargetClass[] = ["ground"]): void {
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
  private applyStatusOnHit(towerTypeId: string, enemy: EnemyState): void {
    const spec = (this.towerTypes[towerTypeId]?.attack as { statusOnHit?: StatusEffectSpec } | undefined)?.statusOnHit;
    if (!spec) return;
    this.applyStatusEffect(enemy, spec);
  }

  /**
   * Apply a status-effect spec to an enemy. The shared primitive behind both a tower's
   * `attack.statusOnHit` (via applyStatusOnHit) and an ability's `{kind:"status"}` effect
   * (via applyAbilityEffect) — one status vocabulary, two triggers.
   */
  private applyStatusEffect(enemy: EnemyState, spec: StatusEffectSpec): void {
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

  private triggerEnemyPhaseSpawns(): void {
    const spawned: EnemyState[] = [];
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
      this.vanguardProtectionIndex = undefined;
    }
  }

  private createPhaseSpawnChildren(parent: EnemyState, phase: EnemyPhaseSpawnDefinition): EnemyState[] {
    const parentRatio = this.enemyRouteProgressRatio(parent);
    const routeIds = phase.routeIds?.length ? phase.routeIds : [parent.routeId ?? this.defaultRouteId()];
    const children: EnemyState[] = [];
    for (let index = 0; index < phase.count; index += 1) {
      const authoredRouteId = routeIds[index % routeIds.length];
      const routeId = this.activeNavigationProfile
        ? this.resolveDynamicNavigationRoute(authoredRouteId).id
        : this.resolveRouteId(authoredRouteId);
      const offset = phase.pathOffsets?.[index] ?? (index % 2 === 0 ? -0.22 : 0.22);
      let child: EnemyState | null;
      if (this.activeNavigationProfile && parent.navigation) {
        child = this.createDynamicChildEnemyState(
          parent,
          phase.enemyId,
          routeId,
          offset,
          phase.progressOffset ?? 0
        );
      } else {
        const track = this.enemyTrackForType(phase.enemyId, routeId);
        const trackEnd = Math.max(0, track.length - 1);
        const progress = Math.min(
          Math.max(0, parentRatio * trackEnd + (phase.progressOffset ?? 0)),
          Math.max(0, trackEnd - 0.001)
        );
        child = this.createEnemyState(phase.enemyId, progress, offset, routeId);
      }
      if (child) {
        children.push(child);
      }
    }
    return children;
  }

  private towerFireRateMultiplier(tower: TowerState): number {
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
      const multiplier =
        attack.fireRateMultiplierByLevel[Math.min(levelIndex, attack.fireRateMultiplierByLevel.length - 1)] ?? 1;
      best = Math.max(best, multiplier * this.towerFireRateMetaMultiplier);
    }
    return best * this.weatherMultiplierAt("tower_fire_rate", tower.coord);
  }

  private supportBuffTouchesTower(support: TowerState, target: TowerState): boolean {
    const supportType = this.towerTypes[support.typeId];
    const targetType = this.towerTypes[target.typeId];
    const attack = supportType?.attack;
    if (!supportType || !targetType || attack?.kind !== "support_buff") {
      return false;
    }

    const edgeDistance = Math.max(0, this.map.distance(support.coord, target.coord) - supportType.footprintRadius - targetType.footprintRadius);
    return edgeDistance <= this.towerRange(support);
  }

  private enemyRouteProgressRatio(enemy: EnemyState): number {
    const track = this.enemyTrack(enemy);
    return enemy.pathProgress / Math.max(1, track.length - 1);
  }

  private defaultRouteId(): string {
    return this.map.pathRoutes[0]?.id ?? "main";
  }

  private resolveRouteId(routeId: string | undefined): string {
    return this.map.pathRouteById(routeId)?.id ?? this.defaultRouteId();
  }

  private routePathKey(routeId: string | undefined, pathOrder: number): string {
    return `${this.resolveRouteId(routeId)}:${pathOrder}`;
  }

  private isTemporaryWaterTile(coord: HexCoord): boolean {
    const key = coordKey(coord);
    return this.temporaryWaterTiles.some((tile) => coordKey(tile) === key && tile.expiresIn > 0);
  }

  private isInsideAnyPulse(enemy: EnemyState): boolean {
    return (
      this.enemyTargetClass(enemy) === "ground" &&
      this.towers.some((tower) => (
        this.isPulseTower(tower)
        && this.logisticsPulseFieldActive(tower)
        && this.enemyInTowerAcquisitionRange(tower, enemy)
      ))
    );
  }

  private logisticsPulseFieldActive(tower: TowerState): boolean {
    if (this.activeLogisticsAmmunition && !this.towerHasRequiredAmmunition(tower)) return false;
    const power = this.activeLogisticsPower;
    if (!power || !Object.prototype.hasOwnProperty.call(power.consumers, tower.typeId)) return true;
    this.ensureLogisticsPowerSnapshot();
    return this.logisticsPoweredConsumerIds!.has(tower.id);
  }

  private isInsideSupportAura(sourceTypeId: string, coord: HexCoord): boolean {
    const sourceType = this.towerTypes[sourceTypeId];
    if (sourceType?.attack.kind !== "support") {
      return false;
    }

    return this.towers.some(
      (tower) => tower.typeId === sourceTypeId && this.map.distance(tower.coord, coord) <= this.towerRange(tower)
    );
  }

  private buildNavigationWavePairs(
    profile: DynamicFlowNavigationProfileV1
  ): readonly NavigationMandatoryPair[] {
    const pairs = new Map<string, NavigationMandatoryPair>();
    for (const wave of this.mission.waves) {
      for (const group of wave.groups) {
        const route = this.resolveDynamicNavigationRoute(group.routeId);
        const source = route.pathCenterline[0];
        if (!source) continue;
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
    return Object.freeze([...pairs.values()].sort((left, right) => (
      compareBinary(left.movementProfileId, right.movementProfileId)
      || compareBinary(left.routeId, right.routeId)
    )));
  }

  private buildNavigationMandatoryPairs(
    profile: DynamicFlowNavigationProfileV1
  ): readonly NavigationMandatoryPair[] {
    const pairs = new Map<string, NavigationMandatoryPair>();
    const queued = new Set<string>();
    const worklist: NavigationSpawnPair[] = [];
    const reachableEnemyTypeIds = new Set<string>();
    const deathSpawnChildTypeIds = new Set<string>();
    const phaseSpawnChildTypeIds = new Set<string>();
    const enqueue = (enemyTypeId: string, routeId: string | undefined): void => {
      if (!this.content.enemies[enemyTypeId]) return;
      const route = this.resolveDynamicNavigationRoute(routeId);
      const key = JSON.stringify([enemyTypeId, route.id]);
      if (queued.has(key)) return;
      queued.add(key);
      worklist.push(Object.freeze({ enemyTypeId, routeId: route.id }));
      worklist.sort((left, right) => (
        compareBinary(left.enemyTypeId, right.enemyTypeId)
        || compareBinary(left.routeId, right.routeId)
      ));
    };
    for (const wave of this.mission.waves) {
      for (const group of wave.groups) {
        enqueue(group.enemyId, group.routeId);
      }
    }

    const reachableTerrainIds = new Set([...this.map.tiles.values()].map((tile) => tile.terrain));
    if (
      this.mission.abilities?.some((ability) => ability.id === "path_water")
      && this.content.terrainTypes.water
      && this.map.allPathCoords().some((coord) => this.map.getBaseTerrain(coord) === "path")
    ) reachableTerrainIds.add("water");
    const appliedHandlers = new Set<string>();
    while (true) {
      let changed = false;
      while (worklist.length > 0) {
        const current = worklist.shift()!;
        changed = true;
        const enemyType = this.content.enemies[current.enemyTypeId];
        if (!enemyType) continue;
        reachableEnemyTypeIds.add(current.enemyTypeId);
        const route = this.resolveDynamicNavigationRoute(current.routeId);
        const movementProfileId = profile.enemyMovementProfiles?.[current.enemyTypeId]
          ?? profile.defaultMovementProfileId;
        if (profile.movementProfiles[movementProfileId]?.towerOccupancy === "blocked") {
          const source = route.pathCenterline[0];
          if (source) {
            const pair: NavigationMandatoryPair = Object.freeze({
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
          if (!(phase.count > 0)) continue;
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
        if (!script || script.enabled === false) continue;
        for (const eventName of Object.keys(script.handlers).sort(compareBinary) as TowerScriptEventName[]) {
          const handlers = script.handlers[eventName] ?? [];
          for (let handlerIndex = 0; handlerIndex < handlers.length; handlerIndex += 1) {
            const handlerKey = JSON.stringify([scriptId, eventName, handlerIndex]);
            if (appliedHandlers.has(handlerKey)) continue;
            if (!this.navigationHandlerAppliesToMission(
              script,
              eventName,
              reachableEnemyTypeIds,
              deathSpawnChildTypeIds,
              phaseSpawnChildTypeIds,
              reachableTerrainIds
            )) continue;
            appliedHandlers.add(handlerKey);
            changed = true;
            const handler = handlers[handlerIndex]!;
            for (const action of handler.actions) {
              if (action.action === "spawnEnemy") enqueue(action.enemyTypeId, action.routeId);
              if (action.action === "setTileTerrain") reachableTerrainIds.add(action.terrainId);
            }
          }
        }
      }
      if (worklist.length === 0 && !changed) break;
    }
    const ordered = [...pairs.values()].sort((left, right) => (
      compareBinary(left.movementProfileId, right.movementProfileId)
      || compareBinary(left.routeId, right.routeId)
    ));
    return Object.freeze(ordered);
  }

  private resolveDynamicNavigationRoute(routeId: string | undefined): GridPathRoute {
    const route = routeId === undefined
      ? this.map.pathRoutes.find((candidate) => candidate.id === "main")
        ?? [...this.map.pathRoutes].sort((left, right) => compareBinary(left.id, right.id))[0]
      : this.map.pathRoutes.find((candidate) => candidate.id === routeId);
    if (!route) {
      throw new Error(`Dynamic navigation spawn references unknown route "${routeId ?? "main"}".`);
    }
    return route;
  }

  private navigationHandlerAppliesToMission(
    script: TowerScriptDefinition,
    eventName: TowerScriptEventName,
    reachableEnemyTypeIds: ReadonlySet<string>,
    deathSpawnChildTypeIds: ReadonlySet<string>,
    phaseSpawnChildTypeIds: ReadonlySet<string>,
    reachableTerrainIds: ReadonlySet<string>
  ): boolean {
    const acceptsAny = (ids: readonly string[] | undefined, candidates: Iterable<string>): boolean => {
      const accepted = ids === undefined ? undefined : new Set(ids);
      for (const candidate of candidates) if (!accepted || accepted.has(candidate)) return true;
      return false;
    };
    const towerIds = this.mission.buildTowerIds ?? Object.keys(this.content.towers);
    const abilityIds = this.mission.abilityIds ?? Object.keys(this.content.abilities);
    const eventFields = new Set<string>(TOWER_SCRIPT_EVENT_FIELDS[eventName]);
    const eventEnemyTypeIds = eventName === "enemySpawnedOnDeath"
      ? deathSpawnChildTypeIds
      : eventName === "enemyPhaseSpawned"
        ? phaseSpawnChildTypeIds
        : reachableEnemyTypeIds;
    for (const binding of script.bindings) {
      if (binding.scope === "global") return true;
      if (binding.scope === "mission" && acceptsAny(binding.ids, [this.mission.id])) return true;
      if (binding.scope === "map" && acceptsAny(binding.ids, [this.mission.mapId])) return true;
      if (binding.scope === "wave" && acceptsAny(binding.ids, [this.mission.waveSetId])) return true;
      if (
        binding.scope === "tower"
        && (eventName === "tick" || eventFields.has("towerId") || eventFields.has("towerIds"))
        && acceptsAny(binding.ids, towerIds)
      ) return true;
      if (
        binding.scope === "ability"
        && eventFields.has("abilityId")
        && acceptsAny(binding.ids, abilityIds)
      ) return true;
      if (
        binding.scope === "terrain"
        && (eventFields.has("coord") || eventFields.has("center") || eventFields.has("to"))
        && acceptsAny(binding.ids, reachableTerrainIds)
      ) return true;
      if (
        binding.scope === "enemy"
        && (eventName === "tick" || eventFields.has("enemyId") || eventFields.has("targetEnemyId") || eventFields.has("enemyIds"))
        && eventEnemyTypeIds.size > 0
        && acceptsAny(binding.ids, eventEnemyTypeIds)
      ) {
        return true;
      }
    }
    return false;
  }

  private navigationTerrainByCoord(): Readonly<Record<string, string>> {
    const terrainByCoord: Record<string, string> = {};
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

  private navigationTerrainByCoordForOverrides(
    overrides: ReadonlyMap<string, RuntimeTerrainOverride>
  ): Readonly<Record<string, string>> {
    const terrainByCoord: Record<string, string> = {};
    for (const tile of this.map.tiles.values()) {
      const key = coordKey(tile);
      const terrain = overrides.get(key)?.terrain ?? this.map.getBaseTerrain(tile);
      if (!terrain) throw new Error(`Dynamic terraforming candidate is missing base terrain at ${key}.`);
      Object.defineProperty(terrainByCoord, key, {
        value: terrain,
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return terrainByCoord;
  }

  private navigationOccupiedCoords(
    ignoreTowerId?: string,
    candidateFootprint: readonly HexCoord[] = []
  ): readonly HexCoord[] {
    const occupied = new Map<string, HexCoord>();
    for (const tile of this.map.tiles.values()) {
      if (!tile.occupiedBy || tile.occupiedBy === ignoreTowerId) continue;
      occupied.set(coordKey(tile), { q: tile.q, r: tile.r });
    }
    for (const coord of candidateFootprint) {
      occupied.set(coordKey(coord), { q: coord.q, r: coord.r });
    }
    return [...occupied.values()];
  }

  private createNavigationResolver(
    occupiedCoords = this.navigationOccupiedCoords(),
    terrainByCoord = this.navigationTerrainByCoord()
  ): NavigationResolver {
    const profile = this.activeNavigationProfile;
    if (!profile) throw new Error("Dynamic navigation resolver requires an active profile.");
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

  private navigationPlacementPairs(): readonly NavigationMandatoryPair[] {
    const profile = this.activeNavigationProfile;
    if (!profile) return [];
    const pairs = new Map<string, NavigationMandatoryPair>();
    for (const pair of this.navigationMandatoryPairs) {
      pairs.set(JSON.stringify([pair.movementProfileId, pair.routeId, pair.source.q, pair.source.r]), pair);
    }
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 || !enemy.navigation || !enemy.routeId) continue;
      if (profile.movementProfiles[enemy.navigation.movementProfileId]?.towerOccupancy !== "blocked") continue;
      const pair: NavigationMandatoryPair = Object.freeze({
        movementProfileId: enemy.navigation.movementProfileId,
        routeId: enemy.routeId,
        source: Object.freeze({ ...enemy.navigation.currentCoord })
      });
      pairs.set(JSON.stringify([pair.movementProfileId, pair.routeId, pair.source.q, pair.source.r]), pair);
    }
    return [...pairs.values()].sort((left, right) => (
      compareBinary(left.movementProfileId, right.movementProfileId)
      || compareBinary(left.routeId, right.routeId)
      || left.source.r - right.source.r
      || left.source.q - right.source.q
    ));
  }

  private navigationPairIsReachable(
    resolver: NavigationResolver,
    pair: NavigationMandatoryPair,
    lookups: NavigationFieldLookupCache,
    budget?: NavigationAnalysisRelaxationBudget
  ): boolean {
    const field = resolver.getField(pair.movementProfileId, pair.routeId);
    if (budget) this.consumeNavigationAnalysisField(field, budget);
    return lookups.get(field).get(pair.source) !== undefined;
  }

  private createNavigationPlacementAnalysisContext(
    budget: NavigationAnalysisRelaxationBudget
  ): NavigationPlacementAnalysisContext {
    const pairs = this.navigationPlacementPairs();
    const lookups = new NavigationFieldLookupCache();
    if (pairs.length === 0) return { pairs, lookups, budget };
    const baseline = this.createNavigationResolver();
    const baselineUnavailable = pairs.find((pair) => (
      !this.navigationPairIsReachable(baseline, pair, lookups, budget)
    ));
    return {
      pairs,
      lookups,
      budget,
      ...(baselineUnavailable === undefined ? {} : { baselineUnavailable })
    };
  }

  private canPreserveDynamicNavigation(
    footprint: readonly HexCoord[],
    ignoreTowerId?: string,
    analysisContext?: NavigationPlacementAnalysisContext
  ): ActionResult {
    if (!this.navigationResolver) return { ok: true };
    const pairs = analysisContext?.pairs ?? this.navigationPlacementPairs();
    if (pairs.length === 0) return { ok: true };
    const lookups = analysisContext?.lookups ?? new NavigationFieldLookupCache();
    if (analysisContext?.baselineUnavailable) {
      const pair = analysisContext.baselineUnavailable;
      return this.fail(
        "A required navigation route is already unavailable.",
        "reason.navigationUnavailable",
        { movementProfileId: pair.movementProfileId, routeId: pair.routeId }
      );
    }
    if (!analysisContext) {
      const baseline = this.createNavigationResolver();
      for (const pair of pairs) {
        if (!this.navigationPairIsReachable(baseline, pair, lookups)) {
          return this.fail(
            "A required navigation route is already unavailable.",
            "reason.navigationUnavailable",
            { movementProfileId: pair.movementProfileId, routeId: pair.routeId }
          );
        }
      }
    }
    const candidate = this.createNavigationResolver(this.navigationOccupiedCoords(ignoreTowerId, footprint));
    for (const pair of pairs) {
      if (!this.navigationPairIsReachable(candidate, pair, lookups, analysisContext?.budget)) {
        return this.fail(
          "Tower would block the last available path.",
          "reason.lastPathBlocked",
          { movementProfileId: pair.movementProfileId, routeId: pair.routeId }
        );
      }
    }
    return { ok: true };
  }

  private syncNavigationTerrain(): void {
    this.navigationResolver?.updateTerrainByCoord(this.navigationTerrainByCoord());
    this.revalidateHeroMovementAfterMapMutation();
  }

  private syncNavigationOccupancy(): void {
    this.navigationResolver?.updateOccupiedCoords(this.navigationOccupiedCoords());
    this.revalidateHeroMovementAfterMapMutation();
  }

  private syncNavigationResolver(): void {
    const resolver = this.navigationResolver;
    if (resolver) {
      resolver.updateTerrainByCoord(this.navigationTerrainByCoord());
      resolver.updateOccupiedCoords(this.navigationOccupiedCoords());
      resolver.updateRoutes(this.map.pathRoutes);
    }
    this.revalidateHeroMovementAfterMapMutation();
  }

  private revalidateHeroMovementAfterMapMutation(): void {
    if (!this.heroStateV2) return;
    this.heroMovementDirty = true;
    this.stabilizeHeroMovement();
  }

  private canOccupyTowerFootprint(
    typeId: string,
    coord: HexCoord,
    ignoreTowerId?: string,
    analysisContext?: NavigationPlacementAnalysisContext
  ): ActionResult {
    const type = this.towerTypes[typeId];
    if (!type) {
      return this.fail("Unknown tower type.", "reason.unknownTower");
    }

    if (type.requiresAuraFrom && !this.isInsideSupportAura(type.requiresAuraFrom, coord)) {
      return this.fail(`${type.label} needs a support aura.`, "reason.needsAura", { tower: typeId });
    }

    const footprint = this.towerFootprintTiles(type, coord);
    if (footprint.length === 0) {
      return this.fail("Outside map.", "reason.outsideMap");
    }

    const expectedFootprintSize = expectedTowerFootprintSize(this.map.topology, type);
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

  private towerFootprintTiles(type: TowerType, coord: HexCoord): HexTile[] {
    return resolveTowerFootprintCoords(this.map.topology, coord, type)
      .map((candidate) => this.map.getTile(candidate))
      .filter((tile): tile is HexTile => tile !== undefined);
  }

  private dependentsKeepSupportAfterMove(sourceTowerId: string, nextCoord: HexCoord): boolean {
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

  private dependentsKeepSupportAfterRemoval(sourceTowerId: string): boolean {
    const sourceTower = this.towers.find((tower) => tower.id === sourceTowerId);
    if (!sourceTower) return false;
    const sourceType = this.towerTypes[sourceTower.typeId];
    if (!sourceType || sourceType.attack.kind !== "support") return true;
    const unlocked = new Set(sourceType.attack.unlocksTowerIds);
    const otherSources = this.towers.filter((tower) => tower.typeId === sourceTower.typeId && tower.id !== sourceTowerId);
    return this.towers.every((tower) => {
      if (tower.id === sourceTowerId || !unlocked.has(tower.typeId)) return true;
      return otherSources.some((source) => this.map.distance(source.coord, tower.coord) <= this.towerRange(source));
    });
  }

  private applyPassiveIncome(delta: number): void {
    const passive = this.mission.economy?.passivePerTimeUnit;
    if (!passive || delta <= 0) return;
    this.addResources(this.scaleBag(passive, delta));
  }

  private awardClearedWaveIncome(): void {
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
      this.advancePreserveShieldQuests();
      const heroDefinition = (this.activeHeroesMechanics?.schemaVersion === 5
        || this.activeHeroesMechanics?.schemaVersion === 6
        || this.activeHeroesMechanics?.schemaVersion === 7) && this.heroStateV2
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

  private createDraftOfferAfterWave(afterWaveIndex: number): void {
    const draft = this.activeRogueliteMechanics?.draft;
    const rng = this.draftRng;
    if (!draft || !rng || this.pendingDraftOffer || afterWaveIndex + 1 >= this.mission.waves.length) return;
    const poolId = draft.defaultPoolId;
    if (this.nextDraftOfferSequence !== afterWaveIndex + 1) return;
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

  private removeDeadEnemies(): void {
    const survivors: EnemyState[] = [];
    const spawned: EnemyState[] = [];

    for (const enemy of this.enemies) {
      if (enemy.hp > 0) {
        survivors.push(enemy);
        continue;
      }

      delete this.enemyShields[enemy.id];
      delete this.enemyMarks[enemy.id];
      delete this.enemyExposures[enemy.id];
      delete this.enemyComponentStates[enemy.id];
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
    this.vanguardProtectionIndex = undefined;
  }

  private settleArtifactLoot(enemy: EnemyState): void {
    const active = this.activeRogueliteMechanics;
    const rng = this.artifactRng;
    if (!active?.artifacts || !rng) return;
    const table = active.artifacts.bossLootTables[enemy.typeId];
    if (!table) return;
    const noDropWeight = table.noDropWeight ?? 0;
    const totalWeight = noDropWeight + table.entries.reduce((sum, entry) => sum + entry.weight, 0);
    for (let rollIndex = 0; rollIndex < table.rolls; rollIndex += 1) {
      let cursor = rng.nextInt(totalWeight);
      if (cursor < noDropWeight) continue;
      cursor -= noDropWeight;
      let selectedArtifactId: string | undefined;
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
      if (
        !selectedArtifactId
        || this.artifactInventory.length >= ROGUELITE_ARTIFACT_INVENTORY_LIMIT
        || this.artifactInventory.length >= campaignArtifactLimit
      ) continue;
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

  private dynamicEnemyAtGoal(enemy: EnemyState): boolean {
    if (!enemy.navigation || !enemy.routeId) return false;
    const goal = this.resolveDynamicNavigationRoute(enemy.routeId).pathCenterline.at(-1);
    return Boolean(
      goal
      && enemy.navigation.currentCoord.q === goal.q
      && enemy.navigation.currentCoord.r === goal.r
    );
  }

  private spawnOnDeathChildren(parent: EnemyState): EnemyState[] {
    const spawn = this.enemyTypes[parent.typeId]?.spawnOnDeath;
    if (!spawn || spawn.count <= 0) {
      return [];
    }

    const childRouteId = this.activeNavigationProfile
      ? parent.routeId
      : this.enemyTargetClassByType(spawn.enemyId) === "ground" ? parent.routeId : undefined;
    const children: EnemyState[] = [];
    for (let index = 0; index < spawn.count; index += 1) {
      const offset = spawn.pathOffsets?.[index] ?? 0;
      let child: EnemyState | null;
      if (this.activeNavigationProfile && parent.navigation && childRouteId) {
        child = this.createDynamicChildEnemyState(
          parent,
          spawn.enemyId,
          childRouteId,
          offset,
          spawn.forwardPathSteps
        );
      } else {
        const track = this.enemyTrackForType(spawn.enemyId, childRouteId);
        const trackEnd = Math.max(0, track.length - 1);
        const childProgress = Math.min(
          parent.pathProgress + spawn.forwardPathSteps,
          Math.max(0, trackEnd - 0.001)
        );
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

  private resolveWaveState(): void {
    if (this.outcome !== "playing") {
      return;
    }

    if (this.startedWaveCount === 0) {
      this.waveState = "ready";
      this.prepRemaining = 0;
      return;
    }

    const battlefieldClear = this.spawnQueue.length === 0 && this.enemies.length === 0;
    if (battlefieldClear) {
      this.awardClearedWaveIncome();
      this.endWeatherWave();
    }
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

  private victoryObjectives(): MissionVictoryObjective[] {
    const authored = this.mission.objectives?.victory;
    return authored?.length ? authored : [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }];
  }

  private buildObjectiveProgress() {
    return this.victoryObjectives().map((objective) => {
      let current = 0;
      let target = 1;
      if (objective.kind === "clearWaves") {
        current = this.clearedWaveCount;
        target = this.mission.waves.length;
      } else if (objective.kind === "surviveSeconds") {
        current = this.missionElapsed;
        target = objective.seconds;
      } else if (objective.kind === "killCount") {
        current = objective.enemyTypeId ? this.killCountByEnemyType[objective.enemyTypeId] ?? 0 : this.killCount;
        target = objective.count;
      } else if (objective.kind === "accumulateResource") {
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

  private objectiveLabel(kind: MissionVictoryObjective["kind"]): string {
    if (kind === "clearWaves") return "Clear all waves";
    if (kind === "surviveSeconds") return "Survive";
    if (kind === "killCount") return "Defeat enemies";
    return "Accumulate resources";
  }

  private failureConditionMet(condition: MissionFailureObjective): boolean {
    if (condition.kind === "maxLeaks") return this.leakCount > condition.maxLeaks;
    return this.missionElapsed > condition.seconds + 0.000001;
  }

  private starConditionMet(condition: MissionStarCondition): boolean {
    if (condition.kind === "coreHpAtLeast") return this.coreHp + 0.000001 >= condition.amount;
    if (condition.kind === "maxLeaks") return this.leakCount <= condition.maxLeaks;
    if (condition.kind === "timeAtMost") return this.missionElapsed <= condition.seconds + 0.000001;
    return (this.resources[condition.resourceId] ?? 0) + 0.000001 >= condition.amount;
  }

  private buildStarSnapshot() {
    return (this.mission.objectives?.stars ?? []).map((star) => ({
      id: star.id,
      label: star.label,
      achieved: this.outcome === "victory" && this.starConditionMet(star)
    }));
  }

  private syncPrepRemaining(): void {
    this.prepRemaining = this.getNextWaveRemaining();
  }

  private getNextWaveRemaining(): number {
    if (this.startedWaveCount === 0 || this.nextWaveStartAt === null) {
      return 0;
    }
    return Math.max(0, this.nextWaveStartAt - this.missionElapsed);
  }

  private isPathBlockerType(typeId: string): boolean {
    return this.enemyTypes[typeId]?.isPathBlocker === true;
  }

  private enemyAvoidanceOffset(enemy: EnemyState): number {
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
  private cloneResources(resources: ResourceBag): ResourceBag {
    const bag: ResourceBag = {};
    for (const id of this.currencyIds) {
      bag[id] = Number(resources?.[id]) || 0;
    }
    return bag;
  }

  private normalizeMetaUpgradeLevels(input: Record<string, number>): Record<string, number> {
    const levels: Record<string, number> = {};
    for (const [upgradeId, upgrade] of Object.entries(this.content.metaProgression.upgrades)) {
      const requested = Number(input[upgradeId]) || 0;
      levels[upgradeId] = Math.max(0, Math.min(upgrade.maxLevel, Math.floor(requested)));
    }
    return levels;
  }

  private metaEffectTotal(
    kind: "towerDamage" | "towerFireRate" | "coreHp",
    valueField: "multiplierPerLevel" | "amountPerLevel"
  ): number {
    let total = 0;
    for (const [upgradeId, upgrade] of Object.entries(this.content.metaProgression.upgrades)) {
      const level = this.metaUpgradeLevels[upgradeId] ?? 0;
      if (level <= 0) continue;
      for (const effect of upgrade.effects) {
        if (effect.kind !== kind) continue;
        const value = Number((effect as unknown as Record<string, number>)[valueField]) || 0;
        total += value * level;
      }
    }
    return total;
  }

  private initialResources(): ResourceBag {
    const resources = this.scaleBag(this.mission.startingResources, this.difficulty.startingResourceMultiplier ?? 1);
    for (const [upgradeId, upgrade] of Object.entries(this.content.metaProgression.upgrades)) {
      const level = this.metaUpgradeLevels[upgradeId] ?? 0;
      if (level <= 0) continue;
      for (const effect of upgrade.effects) {
        if (effect.kind !== "startingResource" || !this.currencyIds.includes(effect.resourceId)) continue;
        resources[effect.resourceId] = (resources[effect.resourceId] ?? 0) + effect.amountPerLevel * level;
      }
    }
    return resources;
  }

  private cleanCoord(coord: HexCoord): HexCoord {
    return { q: coord.q, r: coord.r };
  }

  private normalizeCost(cost: ResourceCost): ResourceBag {
    return this.cloneResources(cost);
  }

  private hasResources(cost: ResourceCost): boolean {
    return this.currencyIds.every((id) => (this.resources[id] ?? 0) >= (Number(cost?.[id]) || 0));
  }

  private spendResources(cost: ResourceCost): void {
    for (const id of this.currencyIds) {
      this.resources[id] = (this.resources[id] ?? 0) - (Number(cost?.[id]) || 0);
    }
  }

  private addResources(resources: ResourceBag): void {
    for (const id of this.currencyIds) {
      this.resources[id] = (this.resources[id] ?? 0) + (Number(resources?.[id]) || 0);
    }
  }

  private addToBag(target: ResourceBag, resources: ResourceBag): void {
    for (const id of this.currencyIds) target[id] = (target[id] ?? 0) + (Number(resources?.[id]) || 0);
  }

  private scaleBag(resources: ResourceBag, factor: number): ResourceBag {
    const bag = this.cloneResources({});
    for (const id of this.currencyIds) bag[id] = (Number(resources?.[id]) || 0) * factor;
    return bag;
  }

  private bagHasValue(resources: ResourceBag): boolean {
    return this.currencyIds.some((id) => Math.abs(resources[id] ?? 0) > 0.000001);
  }

  private formatCost(cost: ResourceCost): string {
    const normalized = this.normalizeCost(cost);
    const parts: string[] = [];
    for (const currency of this.currencies) {
      const amount = normalized[currency.id] ?? 0;
      if (amount > 0) parts.push(`${amount} ${currency.label}`);
    }
    return parts.join(" and ") || "resources";
  }

  private fail(
    reason: string,
    reasonKey: NonNullable<ActionResult["reasonKey"]>,
    reasonParams?: ActionResult["reasonParams"]
  ): ActionResult {
    return { ok: false, reason, reasonKey, reasonParams };
  }

  private costReasonParams(cost: ResourceCost): ActionResult["reasonParams"] {
    return this.normalizeCost(cost);
  }
}
