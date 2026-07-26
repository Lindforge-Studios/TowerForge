/** Stable mechanics module identifiers shared by project catalogs and mission selections. */
export declare const MECHANICS_MODULE_IDS: readonly ["combat", "reactions", "navigation", "elevation", "physics", "terraforming", "roguelite", "heroes", "logistics", "director", "scriptingDx", "multiplayer"];
export type MechanicsModuleId = (typeof MECHANICS_MODULE_IDS)[number];
/** Modules with executable engine support. Authoring any other module remains capability-inactive. */
export declare const IMPLEMENTED_MECHANICS_MODULE_IDS: readonly ["combat", "reactions", "navigation", "elevation", "physics", "terraforming", "roguelite"];
export declare const SHIELD_LIMITS: Readonly<{
    capacity: 1000000000000;
    ratePerUnit: 1000000000;
    delayAfterDamage: 1000000000;
}>;
export declare const ARMOR_MATRIX_LIMITS: Readonly<{
    damageTypes: 256;
    armorTypes: 256;
    assignments: 4096;
    matrixEntries: 16384;
    multiplier: 1000000;
    labelLength: 128;
}>;
export declare const MARK_LIMITS: Readonly<{
    definitions: 256;
    sourceBindings: 4096;
    runtimeApplications: 16384;
    applicationsPerSource: 16;
    filterDamageTypes: 256;
    labelLength: 128;
    duration: 1000000000;
    maxStacks: 256;
    multiplier: 1000000;
}>;
/** Structural and runtime budgets for the opt-in reactions v1 capability. */
export declare const REACTION_LIMITS: Readonly<{
    exposureDefinitions: 256;
    damageTypeApplicationBindings: 256;
    applicationsPerDamageType: 16;
    totalExposureApplications: 4096;
    reactionDefinitions: 256;
    requirementsPerReaction: 8;
    effectsPerReaction: 8;
    totalReactionEffects: 2048;
    runtimeExposureApplications: 16384;
    labelLength: 128;
    idTagUtf8Bytes: 128;
    duration: 1000000000;
    maxStacks: 256;
    flatDamage: 1000000000000;
    sourceMultiplier: 1000000;
    radius: 64;
    targetsPerEffect: 64;
    maxDepth: 4;
    secondaryPacketsPerRoot: 256;
}>;
export interface ShieldRegenerationDefinition {
    readonly ratePerUnit: number;
    readonly delayAfterDamage?: number;
}
export interface ShieldDefinition {
    readonly capacity: number;
    readonly regeneration?: ShieldRegenerationDefinition;
}
export interface CombatShieldDefinitions {
    readonly enemies?: Readonly<Record<string, ShieldDefinition>>;
    readonly towers?: Readonly<Record<string, ShieldDefinition>>;
}
export interface DamageTypeDefinition {
    readonly label: string;
}
export interface ArmorTypeDefinition {
    readonly label: string;
    readonly defaultMultiplier?: number;
    readonly multipliers: Readonly<Record<string, number>>;
}
export interface CombatArmorAssignments {
    readonly enemies?: Readonly<Record<string, string>>;
}
export type MarkConsumePolicy = "retain" | "consume_one" | "consume_all";
export interface MarkDefinition {
    readonly label: string;
    readonly duration: number;
    readonly maxStacks: number;
    readonly multiplier: number;
    readonly consumePolicy: MarkConsumePolicy;
    readonly damageTypes?: readonly string[];
}
export interface MarkApplication {
    readonly markId: string;
    readonly stacks?: number;
}
export interface CombatMarkBindings {
    readonly towers?: Readonly<Record<string, readonly MarkApplication[]>>;
    readonly abilities?: Readonly<Record<string, readonly MarkApplication[]>>;
    readonly towerScripts?: Readonly<Record<string, readonly MarkApplication[]>>;
}
export interface CombatMarksDefinition {
    readonly definitions: Readonly<Record<string, MarkDefinition>>;
    readonly bindings?: CombatMarkBindings;
}
/** Closed combat profile. Armor fields require schema v2; marks require schema v3. */
export interface CombatMechanicsProfile {
    readonly shields?: CombatShieldDefinitions;
    readonly damageTypes?: Readonly<Record<string, DamageTypeDefinition>>;
    readonly armorTypes?: Readonly<Record<string, ArmorTypeDefinition>>;
    readonly armorAssignments?: CombatArmorAssignments;
    readonly marks?: CombatMarksDefinition;
}
export type MechanicsProfileDefinition = Readonly<Record<string, unknown>>;
export interface MechanicsModuleDefinition {
    schemaVersion: 1 | 2 | 3;
    enabled: boolean;
    profiles: Readonly<Record<string, MechanicsProfileDefinition>>;
}
export interface MechanicsCatalog {
    schemaVersion: 1;
    modules: Readonly<Partial<Record<MechanicsModuleId, MechanicsModuleDefinition>>>;
}
export interface MissionMechanicsSelection {
    profiles?: Readonly<Partial<Record<MechanicsModuleId, string>>>;
}
export type CapabilityReason = "active" | "module_unavailable" | "module_missing" | "module_disabled" | "module_version_unsupported" | "not_selected" | "profile_missing" | "dependency_missing";
export interface CapabilityState {
    readonly moduleId: MechanicsModuleId;
    readonly available: boolean;
    readonly moduleEnabled: boolean;
    readonly active: boolean;
    readonly profileId?: string;
    readonly reason: CapabilityReason;
}
export type CapabilitySet = Readonly<Record<MechanicsModuleId, CapabilityState>>;
/**
 * Resolve a mission's read-only mechanics view without mutating the catalog or selection.
 * Availability is supplied by the engine runtime so authored data cannot claim implementation.
 */
export declare function resolveCapabilitySet(catalog: MechanicsCatalog, selection?: MissionMechanicsSelection, availableModuleIds?: readonly MechanicsModuleId[]): CapabilitySet;
