export declare class DynamicTerraformingSafetyBudgetError extends Error {
    readonly code: "budget_exceeded";
    readonly reasonKey: "terraform.solver_budget_exceeded";
    constructor();
}
export declare function failDynamicTerraformingSafetyBudget(): never;
/** Fails before a new bounded collector entry can exceed the shared safety-entry limit. */
export declare function reserveDynamicTerraformingSafetyEntry(currentSize: number): void;
export declare function isDynamicTerraformingSafetyEntryCount(value: number): boolean;
