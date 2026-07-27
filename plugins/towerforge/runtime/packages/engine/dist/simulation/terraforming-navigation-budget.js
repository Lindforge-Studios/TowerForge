import { TERRAFORMING_LIMITS } from "../content/terraforming-mechanics.js";
const SOLVER_BUDGET_MESSAGE = "Terraforming navigation solver budget exceeded.";
export class DynamicTerraformingSafetyBudgetError extends Error {
    code = "budget_exceeded";
    reasonKey = "terraform.solver_budget_exceeded";
    constructor() {
        super(SOLVER_BUDGET_MESSAGE);
        this.name = "DynamicTerraformingSafetyBudgetError";
    }
}
export function failDynamicTerraformingSafetyBudget() {
    throw new DynamicTerraformingSafetyBudgetError();
}
/** Fails before a new bounded collector entry can exceed the shared safety-entry limit. */
export function reserveDynamicTerraformingSafetyEntry(currentSize) {
    if (!Number.isSafeInteger(currentSize)
        || currentSize < 0
        || currentSize >= TERRAFORMING_LIMITS.safetySourcesPerTransaction)
        failDynamicTerraformingSafetyBudget();
}
export function isDynamicTerraformingSafetyEntryCount(value) {
    return Number.isSafeInteger(value)
        && value >= 0
        && value <= TERRAFORMING_LIMITS.safetySourcesPerTransaction;
}
