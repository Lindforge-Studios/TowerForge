import { type GameContentRegistry } from "../content/registry.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { ActionResult, GameSnapshot, HexCoord, MissionAbilityId, TowerTargetMode } from "./types.js";
import type { TowerScriptJson } from "../scripting/types.js";
import { dispatchGameCommand, type GameCommandV1 } from "./commands.js";

/** @deprecated Use the versioned GameCommand public contract. */
export type SimulationAction =
  | { type: "tick"; units: number }
  | { type: "startWave" }
  | { type: "placeTower"; towerTypeId: string; coord: HexCoord }
  | { type: "moveTower"; towerId: string; coord: HexCoord }
  | { type: "sellTower"; towerId: string }
  | { type: "upgradeTower"; towerId: string }
  | { type: "setTargetMode"; towerId: string; mode: TowerTargetMode }
  | { type: "useAbility"; abilityId: MissionAbilityId; center: HexCoord }
  | { type: "emitSignal"; signal: string; payload?: TowerScriptJson };

export interface SimulationActionResult {
  action: SimulationAction;
  result: ActionResult;
  snapshot: GameSnapshot;
}

export interface HeadlessMissionRunOptions {
  content: GameContentRegistry;
  missionId: string;
  actions?: SimulationAction[];
  tickStep?: number;
}

export interface HeadlessMissionRunResult {
  game: TowerDefenseGame;
  snapshot: GameSnapshot;
  actionResults: SimulationActionResult[];
}

/** @deprecated Use dispatchGameCommand with a versioned GameCommand. */
export function applySimulationAction(game: TowerDefenseGame, action: SimulationAction): ActionResult {
  const payload = action.type === "emitSignal" && action.payload === undefined
    ? { schemaVersion: 1 as const, type: action.type, signal: action.signal }
    : { schemaVersion: 1 as const, ...action };
  return dispatchGameCommand(game, payload satisfies GameCommandV1);
}

export function tickHeadless(game: TowerDefenseGame, units: number, step = 0.1): void {
  const safeStep = Math.max(0.01, step);
  for (let elapsed = 0; elapsed < units; elapsed += safeStep) {
    game.tick(Math.min(safeStep, units - elapsed));
  }
}

export function runHeadlessMission(options: HeadlessMissionRunOptions): HeadlessMissionRunResult {
  const game = new TowerDefenseGame({ missionId: options.missionId, content: options.content });
  const actionResults: SimulationActionResult[] = [];

  for (const action of options.actions ?? []) {
    if (action.type === "tick") {
      tickHeadless(game, action.units, options.tickStep);
      actionResults.push({ action, result: { ok: true }, snapshot: game.getSnapshot() });
      continue;
    }
    const result = applySimulationAction(game, action);
    actionResults.push({ action, result, snapshot: game.getSnapshot() });
  }

  return { game, snapshot: game.getSnapshot(), actionResults };
}
