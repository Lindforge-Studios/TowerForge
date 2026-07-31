import type { GameContentRegistry } from "./registry.js";
import { type GameSeed, type SeededRngStateV1 } from "../simulation/rng.js";
import type { HexCoord, StatusEffectSpec } from "../simulation/types.js";
export declare const WEATHER_LIMITS: Readonly<{
    zones: 64;
    tilesPerZone: 4096;
    tilesAcrossProfile: 16384;
    definitions: 64;
    effectsPerDefinition: 16;
    effectsAcrossProfile: 512;
    scheduleChoices: 256;
    scheduledWaves: 4096;
    idUtf8Bytes: 128;
    labelUtf8Bytes: 256;
    weight: 1000000;
    intervalUnits: 1000000000;
    damage: 1000000000000;
    minimumMultiplier: 0.05;
    maximumMultiplier: 20;
    targetInspectionsPerTick: 16384;
    applicationsPerTick: 4096;
}>;
export declare const WEATHER_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 1;
    moduleId: "weather";
    supportedModuleSchemaVersions: readonly [1];
    profile: Readonly<{
        requiredFields: readonly ["zones", "definitions", "schedule"];
        optionalFields: readonly [];
        additionalProperties: false;
    }>;
    zoneKinds: readonly ["all_map", "tiles"];
    effectKinds: readonly ["periodic_damage", "status", "visibility_range", "enemy_speed", "tower_fire_rate"];
    limits: Readonly<{
        zones: 64;
        tilesPerZone: 4096;
        tilesAcrossProfile: 16384;
        definitions: 64;
        effectsPerDefinition: 16;
        effectsAcrossProfile: 512;
        scheduleChoices: 256;
        scheduledWaves: 4096;
        idUtf8Bytes: 128;
        labelUtf8Bytes: 256;
        weight: 1000000;
        intervalUnits: 1000000000;
        damage: 1000000000000;
        minimumMultiplier: 0.05;
        maximumMultiplier: 20;
        targetInspectionsPerTick: 16384;
        applicationsPerTick: 4096;
    }>;
}>;
export interface WeatherAllMapZoneV1 {
    readonly kind: "all_map";
}
export interface WeatherTilesZoneV1 {
    readonly kind: "tiles";
    readonly tiles: readonly HexCoord[];
}
export type WeatherZoneV1 = WeatherAllMapZoneV1 | WeatherTilesZoneV1;
export interface WeatherPeriodicDamageEffectV1 {
    readonly kind: "periodic_damage";
    readonly target: "enemies";
    readonly amount: number;
    readonly intervalUnits: number;
    readonly damageType?: string;
}
export interface WeatherStatusEffectV1 {
    readonly kind: "status";
    readonly target: "enemies";
    readonly intervalUnits: number;
    readonly status: StatusEffectSpec;
}
export interface WeatherMultiplierEffectV1 {
    readonly kind: "visibility_range" | "enemy_speed" | "tower_fire_rate";
    readonly multiplier: number;
}
export type WeatherEffectV1 = WeatherPeriodicDamageEffectV1 | WeatherStatusEffectV1 | WeatherMultiplierEffectV1;
export interface WeatherDefinitionV1 {
    readonly label: string;
    readonly effects: Readonly<Record<string, WeatherEffectV1>>;
}
export interface WeatherScheduleChoiceV1 {
    readonly weatherId: string;
    readonly zoneId: string;
    readonly weight: number;
}
export interface WeatherProfileV1 {
    readonly zones: Readonly<Record<string, WeatherZoneV1>>;
    readonly definitions: Readonly<Record<string, WeatherDefinitionV1>>;
    readonly schedule: {
        readonly calmWeight: number;
        readonly choices: Readonly<Record<string, WeatherScheduleChoiceV1>>;
    };
}
export interface ActiveWeatherMechanicsV1 extends WeatherProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export interface WeatherOccurrenceV1 {
    readonly waveIndex: number;
    readonly choiceId: string;
    readonly weatherId: string;
    readonly zoneId: string;
    readonly zone: WeatherZoneV1;
}
export interface WeatherScheduleV1 {
    readonly schemaVersion: 1;
    readonly rng: {
        readonly initial: SeededRngStateV1;
        readonly current: SeededRngStateV1;
    };
    readonly occurrences: readonly (WeatherOccurrenceV1 | null)[];
}
export interface WeatherRuntimeOccurrenceV1 extends WeatherOccurrenceV1 {
    readonly elapsedUnits: number;
}
export interface WeatherRuntimeV1 {
    readonly schemaVersion: 1;
    readonly active: WeatherRuntimeOccurrenceV1 | null;
    readonly periodicOrdinals: Readonly<Record<string, number>>;
}
export interface WeatherTransitionFactV1 {
    readonly kind: "started" | "ended";
    readonly waveIndex: number;
    readonly choiceId: string;
    readonly weatherId: string;
    readonly zoneId: string;
    readonly reason?: "wave_cleared" | "wave_changed";
}
export interface WeatherDueEffectFactV1 {
    readonly waveIndex: number;
    readonly choiceId: string;
    readonly weatherId: string;
    readonly zoneId: string;
    readonly effectId: string;
    readonly applicationOrdinal: number;
    readonly effect: WeatherPeriodicDamageEffectV1 | WeatherStatusEffectV1;
}
export interface WeatherAdvanceResultV1 {
    readonly runtime: WeatherRuntimeV1;
    readonly transitions: readonly WeatherTransitionFactV1[];
    readonly dueEffects: readonly WeatherDueEffectFactV1[];
}
export declare class WeatherProfileValidationError extends Error {
}
/** Parse Weather v1 as canonical detached deeply frozen own data. */
export declare function normalizeWeatherProfileV1(value: unknown): WeatherProfileV1;
/** Deterministically choose zero or one weather occurrence for every authored wave. */
export declare function createWeatherScheduleV1(profileInput: WeatherProfileV1, optionsInput: {
    readonly seed: GameSeed;
    readonly missionId: string;
    readonly waveCount: number;
}): WeatherScheduleV1;
export declare function createWeatherRuntimeV1(scheduleInput: WeatherScheduleV1): WeatherRuntimeV1;
/** Advance only Weather timing; entity lookup and gameplay application remain caller-owned. */
export declare function advanceWeatherRuntimeV1(profileInput: WeatherProfileV1, scheduleInput: WeatherScheduleV1, runtimeInput: WeatherRuntimeV1, inputValue: {
    readonly waveIndex: number;
    readonly elapsedUnits: number;
    readonly waveActive: boolean;
}): WeatherAdvanceResultV1;
export declare function resolveActiveWeatherMechanics(content: GameContentRegistry, missionId: string): ActiveWeatherMechanicsV1 | undefined;
