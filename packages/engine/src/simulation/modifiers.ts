export const MODIFIER_TARGETS = Object.freeze(["damage"] as const);
export const MODIFIER_STAGE_ORDER = Object.freeze([
  "tower_upgrade",
  "meta",
  "run",
  "spatial",
  "temporary"
] as const);
export const MODIFIER_OPERATION_ORDER = Object.freeze(["flat", "additive_ratio", "multiplier"] as const);

export const MAX_MODIFIERS_PER_RESOLUTION = 64;

export type ModifierTarget = (typeof MODIFIER_TARGETS)[number];
export type ModifierStage = (typeof MODIFIER_STAGE_ORDER)[number];
export type ModifierOperation = (typeof MODIFIER_OPERATION_ORDER)[number];

/**
 * A bounded, data-only modifier. The closed target and operation allowlists make
 * authored modifiers deterministic and safe to validate without executable code.
 */
export interface ModifierSpec {
  readonly id: string;
  readonly target: ModifierTarget;
  readonly stage: ModifierStage;
  readonly operation: ModifierOperation;
  readonly value: number;
}

export interface ModifierTraceStep {
  readonly id: string;
  readonly stage: ModifierStage;
  readonly operation: ModifierOperation;
  readonly operand: number;
  readonly before: number;
  readonly after: number;
}

export interface ModifierResolution {
  readonly baseValue: number;
  readonly target: ModifierTarget;
  readonly value: number;
  readonly trace: readonly ModifierTraceStep[];
}

function binaryCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isAllowed<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function validateModifier(spec: ModifierSpec, index: number, seenIds: Set<string>): void {
  if (!spec || typeof spec !== "object") {
    throw new Error(`Modifier at index ${index} must be an object.`);
  }
  if (typeof spec.id !== "string" || spec.id.trim().length === 0) {
    throw new Error(`Modifier at index ${index} must have a non-empty id.`);
  }
  if (seenIds.has(spec.id)) {
    throw new Error(`Duplicate modifier id "${spec.id}".`);
  }
  seenIds.add(spec.id);

  if (!isAllowed(MODIFIER_TARGETS, spec.target)) {
    throw new Error(`Modifier "${spec.id}" has unsupported target "${String(spec.target)}".`);
  }
  if (!isAllowed(MODIFIER_STAGE_ORDER, spec.stage)) {
    throw new Error(`Modifier "${spec.id}" has unsupported stage "${String(spec.stage)}".`);
  }
  if (!isAllowed(MODIFIER_OPERATION_ORDER, spec.operation)) {
    throw new Error(`Modifier "${spec.id}" has unsupported operation "${String(spec.operation)}".`);
  }
  if (!Number.isFinite(spec.value)) {
    throw new Error(`Modifier "${spec.id}" value must be finite.`);
  }
}

/**
 * Resolves modifiers using the stable contract
 * stage -> operation -> binary id. Additive ratios in one stage are all
 * anchored to the value immediately after that stage's flat modifiers.
 */
export function resolveModifiers(
  baseValue: number,
  target: ModifierTarget,
  modifiers: readonly ModifierSpec[]
): ModifierResolution {
  if (!Number.isFinite(baseValue)) {
    throw new Error("Modifier base value must be finite.");
  }
  if (!isAllowed(MODIFIER_TARGETS, target)) {
    throw new Error(`Unsupported modifier target "${String(target)}".`);
  }
  if (!Array.isArray(modifiers)) {
    throw new Error("Modifiers must be an array.");
  }
  if (modifiers.length > MAX_MODIFIERS_PER_RESOLUTION) {
    throw new Error(`Modifier budget exceeded: at most ${MAX_MODIFIERS_PER_RESOLUTION} modifiers are allowed.`);
  }

  const seenIds = new Set<string>();
  modifiers.forEach((spec, index) => validateModifier(spec, index, seenIds));

  const targetModifiers = modifiers
    .filter((spec) => spec.target === target)
    .slice()
    .sort((left, right) => {
      const stageOrder = MODIFIER_STAGE_ORDER.indexOf(left.stage) - MODIFIER_STAGE_ORDER.indexOf(right.stage);
      if (stageOrder !== 0) return stageOrder;
      const operationOrder =
        MODIFIER_OPERATION_ORDER.indexOf(left.operation) - MODIFIER_OPERATION_ORDER.indexOf(right.operation);
      return operationOrder !== 0 ? operationOrder : binaryCompare(left.id, right.id);
    });

  const trace: ModifierTraceStep[] = [];
  let value = baseValue;
  let currentStage: ModifierStage | undefined;
  let additiveRatioAnchor = value;

  for (const spec of targetModifiers) {
    if (spec.stage !== currentStage) {
      currentStage = spec.stage;
      additiveRatioAnchor = value;
    }

    const before = value;
    if (spec.operation === "flat") {
      value += spec.value;
      additiveRatioAnchor = value;
    } else if (spec.operation === "additive_ratio") {
      value += additiveRatioAnchor * spec.value;
    } else {
      value *= spec.value;
    }

    if (!Number.isFinite(value)) {
      throw new Error(`Modifier "${spec.id}" produced a non-finite value.`);
    }
    trace.push({
      id: spec.id,
      stage: spec.stage,
      operation: spec.operation,
      operand: spec.value,
      before,
      after: value
    });
  }

  return { baseValue, target, value, trace };
}
