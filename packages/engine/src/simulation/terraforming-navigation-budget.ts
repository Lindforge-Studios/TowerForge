import { TERRAFORMING_LIMITS } from "../content/terraforming-mechanics.js";

const SOLVER_BUDGET_MESSAGE = "Terraforming navigation solver budget exceeded.";

export class DynamicTerraformingSafetyBudgetError extends Error {
  readonly code = "budget_exceeded" as const;
  readonly reasonKey = "terraform.solver_budget_exceeded" as const;

  constructor() {
    super(SOLVER_BUDGET_MESSAGE);
    this.name = "DynamicTerraformingSafetyBudgetError";
  }
}

export function failDynamicTerraformingSafetyBudget(): never {
  throw new DynamicTerraformingSafetyBudgetError();
}

/** Fails before a new bounded collector entry can exceed the shared safety-entry limit. */
export function reserveDynamicTerraformingSafetyEntry(currentSize: number): void {
  if (
    !Number.isSafeInteger(currentSize)
    || currentSize < 0
    || currentSize >= TERRAFORMING_LIMITS.safetySourcesPerTransaction
  ) failDynamicTerraformingSafetyBudget();
}

export function isDynamicTerraformingSafetyEntryCount(value: number): boolean {
  return Number.isSafeInteger(value)
    && value >= 0
    && value <= TERRAFORMING_LIMITS.safetySourcesPerTransaction;
}
