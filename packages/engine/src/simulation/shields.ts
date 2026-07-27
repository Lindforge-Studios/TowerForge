import {
  resolveActiveCombatMechanics
} from "../content/combat-mechanics.js";
import type { ShieldDefinition } from "../content/mechanics.js";
import type { GameContentRegistry } from "../content/registry.js";
import type { DamageResolution } from "./damage.js";

export interface ShieldStateV1 {
  current: number;
  capacity: number;
  regenerationDelayRemaining: number;
}

export interface CombatShieldStateV1 {
  readonly schemaVersion: 1;
  readonly shields: {
    readonly enemies: Readonly<Record<string, ShieldStateV1>>;
    readonly towers: Readonly<Record<string, ShieldStateV1>>;
  };
}

export interface MarkStateV1 {
  readonly stacks: number;
  readonly remaining: number;
}

export interface CombatStateV2 {
  readonly schemaVersion: 2;
  readonly shields: CombatShieldStateV1["shields"];
  readonly marks: {
    readonly enemies: Readonly<Record<string, Readonly<Record<string, MarkStateV1>>>>;
  };
}

export type CombatState = CombatShieldStateV1 | CombatStateV2;

export interface DamageApplicationResult {
  readonly resolution: DamageResolution;
  readonly shieldAbsorbed: number;
  readonly hpDamage: number;
}

export type ShieldChangeCause = "damage" | "regeneration" | "script";

interface ShieldChangedEventBase {
  readonly previous: number;
  readonly current: number;
  readonly capacity: number;
  readonly cause: ShieldChangeCause;
  readonly amount: number;
  readonly overflowDamage?: number;
}

export interface EnemyShieldChangedEvent extends ShieldChangedEventBase {
  readonly type: "enemyShieldChanged";
  readonly enemyId: string;
  readonly enemyTypeId: string;
}

export interface TowerShieldChangedEvent extends ShieldChangedEventBase {
  readonly type: "towerShieldChanged";
  readonly towerId: string;
  readonly towerTypeId: string;
}

export interface ActiveCombatShieldDefinitions {
  readonly enemies: Readonly<Record<string, ShieldDefinition>>;
  readonly towers: Readonly<Record<string, ShieldDefinition>>;
}

/**
 * Compatibility wrapper retained for checkpoint/shield callers. The shared combat normalizer
 * accepts both combat v1 (shields only) and v2 (shields plus armor).
 */
export function resolveActiveCombatShieldDefinitions(
  content: GameContentRegistry,
  missionId: string
): ActiveCombatShieldDefinitions | undefined {
  return resolveActiveCombatMechanics(content, missionId)?.shields;
}
