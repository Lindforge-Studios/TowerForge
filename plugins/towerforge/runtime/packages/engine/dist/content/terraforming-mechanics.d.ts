import type { GameContentRegistry } from "./registry.js";
/** Closed structural and runtime budgets for opt-in transactional terraforming v1. */
export declare const TERRAFORMING_LIMITS: Readonly<{
    transitionDefinitions: 64;
    sourceTagsPerTransition: 8;
    sourceTagsAcrossProfile: 512;
    idOrTagUtf8Bytes: 128;
    operationsPerBatch: 64;
    operationsPerScriptTransaction: 64;
    distinctCellsPerBatch: 64;
    activeTerrainOverrides: 512;
    activeElevationOverrides: 512;
    activeOverridesCombined: 1024;
    elevationMinimum: -1000000;
    elevationMaximum: 1000000;
    maximumElevationDeltaPerOperation: 64;
    duration: 1000000000;
    safetySourcesPerTransaction: 16384;
    profileGoalFieldsPerTransaction: 256;
    fieldCellsBaselineAndCandidate: 8388608;
    pendingExpiryGroups: 512;
}>;
/** Capability-aware authoring descriptor shared by Studio and MCP surfaces. */
export declare const TERRAFORMING_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 1;
    moduleId: "terraforming";
    supportedModuleSchemaVersions: readonly [1];
    profile: Readonly<{
        requiredFields: readonly [];
        optionalFields: readonly ["terrainTransitions", "elevation"];
        additionalProperties: false;
        terrainTransition: Readonly<{
            requiredFields: readonly ["fromTerrainTags", "toTerrainId"];
            optionalFields: readonly [];
            additionalProperties: false;
            sourceTagSemantics: "any";
        }>;
        elevation: Readonly<{
            requiredFields: readonly ["minimum", "maximum", "maximumDeltaPerOperation"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
    }>;
    limits: Readonly<{
        transitionDefinitions: 64;
        sourceTagsPerTransition: 8;
        sourceTagsAcrossProfile: 512;
        idOrTagUtf8Bytes: 128;
        operationsPerBatch: 64;
        operationsPerScriptTransaction: 64;
        distinctCellsPerBatch: 64;
        activeTerrainOverrides: 512;
        activeElevationOverrides: 512;
        activeOverridesCombined: 1024;
        elevationMinimum: -1000000;
        elevationMaximum: 1000000;
        maximumElevationDeltaPerOperation: 64;
        duration: 1000000000;
        safetySourcesPerTransaction: 16384;
        profileGoalFieldsPerTransaction: 256;
        fieldCellsBaselineAndCandidate: 8388608;
        pendingExpiryGroups: 512;
    }>;
    dependencies: Readonly<{
        terrain: "independent";
        elevation: Readonly<{
            moduleId: "elevation";
            supportedModuleSchemaVersions: readonly [1, 2, 3];
            requiresProfilePolicy: "elevation";
        }>;
    }>;
    towerScript: Readonly<{
        minimumSchemaVersion: 6;
        action: "terraformTiles";
        event: "elevationChanged";
    }>;
    failureReasons: readonly ["terraform.invalid_operation", "terraform.operation_budget_exceeded", "terraform.duplicate_target", "terraform.target_outside_map", "terraform.transition_missing", "terraform.transition_source_tag_mismatch", "terraform.elevation_dependency_missing", "terraform.elevation_policy_missing", "terraform.elevation_out_of_range", "terraform.elevation_delta_exceeded", "terraform.override_budget_exceeded", "terraform.duration_out_of_range", "terraform.expiry_group_budget_exceeded", "terraform.target_owned", "terraform.authored_route_unavailable", "terraform.last_authored_route_blocked", "terraform.navigation_unavailable", "terraform.last_path_blocked", "terraform.solver_budget_exceeded"];
    runtimeSnapshot: Readonly<{
        path: "snapshot.terraforming";
        schemaVersion: 1;
        optionalUnlessActive: true;
    }>;
}>;
export interface TerraformTerrainTransitionV1 {
    readonly fromTerrainTags: readonly string[];
    readonly toTerrainId: string;
}
export interface TerraformElevationPolicyV1 {
    readonly minimum: number;
    readonly maximum: number;
    readonly maximumDeltaPerOperation: number;
}
export interface TerraformingProfileV1 {
    readonly terrainTransitions?: Readonly<Record<string, TerraformTerrainTransitionV1>>;
    readonly elevation?: TerraformElevationPolicyV1;
}
export interface ActiveTerraformingMechanicsV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
    readonly terrainTransitions: Readonly<Record<string, TerraformTerrainTransitionV1>>;
    readonly elevation?: TerraformElevationPolicyV1;
}
export declare class TerraformingProfileValidationError extends Error {
    readonly fieldPath: string;
    constructor(fieldPath: string, message: string);
}
/** Validate and detach the exact closed v1 profile without invoking authored accessors. */
export declare function normalizeTerraformingProfileV1(value: unknown): TerraformingProfileV1;
/** Resolve a detached profile only when the mission genuinely activates terraforming v1. */
export declare function resolveActiveTerraformingMechanics(content: GameContentRegistry, missionId: string): ActiveTerraformingMechanicsV1 | undefined;
