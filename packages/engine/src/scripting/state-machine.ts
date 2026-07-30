import { evaluateTowerScriptExpression } from "./expression.js";
import { TOWER_SCRIPT_LIMITS } from "./schema-descriptor.js";
import type {
  TowerScriptAction,
  TowerScriptEventName,
  TowerScriptMachineRuntimeStateV1,
  TowerScriptStateMachineV1,
  TowerScriptStateNodeV1,
  TowerScriptStateTransitionV1
} from "./types.js";
export type { TowerScriptMachineRuntimeStateV1 } from "./types.js";

export interface TowerScriptMachineExpressionContextV1 {
  readonly event: Readonly<Record<string, unknown>>;
  readonly self: Readonly<Record<string, unknown>>;
  readonly state: Readonly<Record<string, unknown>>;
  readonly game: Readonly<Record<string, unknown>>;
  readonly machine?: Readonly<Record<string, unknown>>;
}

export interface TowerScriptMachineInitializationV1 {
  readonly state: TowerScriptMachineRuntimeStateV1;
  readonly entryActions: readonly TowerScriptAction[];
}

export interface TowerScriptStateTransitionPlanV1 {
  readonly schemaVersion: 1;
  readonly transitionId: string;
  readonly fromStatePath: string;
  readonly toStatePath: string;
  readonly exitActions: readonly TowerScriptAction[];
  readonly transitionActions: readonly TowerScriptAction[];
  readonly entryActions: readonly TowerScriptAction[];
  readonly state: TowerScriptMachineRuntimeStateV1;
}

interface StateRecord {
  readonly path: string;
  readonly parentPath: string;
  readonly node: TowerScriptStateNodeV1;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "" : path.slice(0, index);
}

function flattenStates(machine: TowerScriptStateMachineV1): ReadonlyMap<string, StateRecord> {
  const records = new Map<string, StateRecord>();
  let count = 0;
  const visit = (states: readonly TowerScriptStateNodeV1[], parent: string, depth: number): void => {
    if (depth > TOWER_SCRIPT_LIMITS.stateMachineDepth) throw new Error("TowerScript state machine depth budget exceeded.");
    for (const node of states) {
      count += 1;
      if (count > TOWER_SCRIPT_LIMITS.stateMachineStates) throw new Error("TowerScript state machine state budget exceeded.");
      const path = `${parent}/${node.id}`;
      if (records.has(path)) throw new Error(`Duplicate TowerScript state path "${path}".`);
      records.set(path, { path, parentPath: parent, node });
      if (node.states?.length) visit(node.states, path, depth + 1);
    }
  };
  visit(machine.states, "", 0);
  return records;
}

/** Canonical absolute state paths used by checkpoint validation and authoring surfaces. */
export function collectTowerScriptStatePaths(machine: TowerScriptStateMachineV1): readonly string[] {
  return [...flattenStates(machine).keys()].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function resolveInitialLeaf(
  machine: TowerScriptStateMachineV1,
  records: ReadonlyMap<string, StateRecord>,
  startPath?: string
): string {
  let path = startPath ?? `/${machine.initial}`;
  const seen = new Set<string>();
  while (true) {
    if (seen.has(path)) throw new Error("TowerScript state machine initial-state cycle detected.");
    seen.add(path);
    const record = records.get(path);
    if (!record) throw new Error(`Unknown TowerScript state path "${path}".`);
    if (!record.node.states?.length) return path;
    if (!record.node.initial) throw new Error(`Compound TowerScript state "${path}" needs initial.`);
    path = `${path}/${record.node.initial}`;
  }
}

function pathChain(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, index) => `/${parts.slice(0, index + 1).join("/")}`);
}

function actionsForPaths(
  records: ReadonlyMap<string, StateRecord>,
  paths: readonly string[],
  field: "entryActions" | "exitActions"
): TowerScriptAction[] {
  return paths.flatMap((path) => [...(records.get(path)?.node[field] ?? [])]);
}

export function initializeTowerScriptStateMachine(
  machine: TowerScriptStateMachineV1,
  enteredAt: number
): TowerScriptMachineInitializationV1 {
  const records = flattenStates(machine);
  const leaf = resolveInitialLeaf(machine, records);
  return {
    state: {
      schemaVersion: 1,
      activeStatePath: leaf,
      enteredAt,
      transitionCount: 0
    },
    entryActions: actionsForPaths(records, pathChain(leaf), "entryActions")
  };
}

function matchingTransition(
  records: ReadonlyMap<string, StateRecord>,
  activePath: string,
  eventName: TowerScriptEventName,
  context: TowerScriptMachineExpressionContextV1
): { sourcePath: string; transition: TowerScriptStateTransitionV1 } | null {
  const expressionBudget = { remaining: TOWER_SCRIPT_LIMITS.behaviorExpressionOperationsPerAcquisition };
  let path = activePath;
  while (path) {
    const record = records.get(path);
    if (!record) throw new Error(`Unknown active TowerScript state path "${path}".`);
    for (const transition of record.node.transitions ?? []) {
      if (transition.event !== eventName) continue;
      if (transition.when !== undefined && !Boolean(evaluateTowerScriptExpression(
        transition.when,
        context as unknown as Record<string, unknown>,
        expressionBudget
      ))) continue;
      return { sourcePath: path, transition };
    }
    path = record.parentPath;
  }
  return null;
}

function commonAncestor(left: string, right: string): string {
  const leftParts = left.split("/").filter(Boolean);
  const rightParts = right.split("/").filter(Boolean);
  const common: string[] = [];
  for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] !== rightParts[index]) break;
    common.push(leftParts[index]!);
  }
  return common.length ? `/${common.join("/")}` : "";
}

export function planTowerScriptStateTransition(
  machine: TowerScriptStateMachineV1,
  current: TowerScriptMachineRuntimeStateV1,
  eventName: TowerScriptEventName,
  context: TowerScriptMachineExpressionContextV1,
  enteredAt: number
): TowerScriptStateTransitionPlanV1 | null {
  const records = flattenStates(machine);
  if (!records.has(current.activeStatePath)) throw new Error("TowerScript state machine active state is unknown.");
  const match = matchingTransition(records, current.activeStatePath, eventName, context);
  if (!match) return null;
  if (!match.transition.target.startsWith("/")) throw new Error("TowerScript state transition target must be absolute.");
  const targetLeaf = resolveInitialLeaf(machine, records, match.transition.target);
  let boundary = commonAncestor(match.sourcePath, targetLeaf);
  if (boundary === match.sourcePath) boundary = parentPath(match.sourcePath);

  const activeChain = pathChain(current.activeStatePath);
  const exitPaths = [...activeChain].reverse().filter((path) => path !== boundary && path.startsWith(`${boundary}/`));
  const targetChain = pathChain(targetLeaf);
  const entryPaths = targetChain.filter((path) => path !== boundary && path.startsWith(`${boundary}/`));
  return {
    schemaVersion: 1,
    transitionId: match.transition.id,
    fromStatePath: current.activeStatePath,
    toStatePath: targetLeaf,
    exitActions: actionsForPaths(records, exitPaths, "exitActions"),
    transitionActions: [...(match.transition.actions ?? [])],
    entryActions: actionsForPaths(records, entryPaths, "entryActions"),
    state: {
      schemaVersion: 1,
      activeStatePath: targetLeaf,
      enteredAt,
      transitionCount: current.transitionCount + 1
    }
  };
}
