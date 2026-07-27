import type { GameContentRegistry } from "./registry.js";
import { type ArmorTypeDefinition, type CombatShieldDefinitions, type DamageTypeDefinition, type MarkApplication, type MarkDefinition, type ShieldDefinition } from "./mechanics.js";
export interface ActiveCombatMechanics {
    readonly schemaVersion: 1 | 2 | 3;
    readonly shields: {
        readonly enemies: Readonly<Record<string, ShieldDefinition>>;
        readonly towers: Readonly<Record<string, ShieldDefinition>>;
    };
    readonly damageTypes: Readonly<Record<string, DamageTypeDefinition>>;
    readonly armorTypes: Readonly<Record<string, ArmorTypeDefinition>>;
    readonly enemyArmorAssignments: Readonly<Record<string, string>>;
    readonly enemyResistances: Readonly<Record<string, Readonly<Record<string, number>>>>;
    readonly marks: {
        readonly definitions: Readonly<Record<string, MarkDefinition>>;
        readonly bindings: {
            readonly towers: Readonly<Record<string, readonly MarkApplication[]>>;
            readonly abilities: Readonly<Record<string, readonly MarkApplication[]>>;
            readonly towerScripts: Readonly<Record<string, readonly MarkApplication[]>>;
        };
    };
}
export interface ArmorMatrixContext {
    readonly armorTypeId: string;
    readonly defaultMultiplier?: number;
    readonly multipliers: Readonly<Record<string, number>>;
}
/**
 * Safely detach one active combat profile. Inactive modules are an exact legacy no-op.
 */
export declare function resolveActiveCombatMechanics(content: GameContentRegistry, missionId: string): ActiveCombatMechanics | undefined;
/** Stateless lookup used by every damage delivery through the shared resolver boundary. */
export declare function resolveEnemyArmorMatrix(mechanics: ActiveCombatMechanics | undefined, enemyTypeId: string): ArmorMatrixContext | undefined;
export declare function combatShieldDefinitions(mechanics: ActiveCombatMechanics | undefined): CombatShieldDefinitions | undefined;
