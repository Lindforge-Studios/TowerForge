import { TowerDefenseGame } from "./TowerDefenseGame.js";
import { dispatchGameCommand } from "./commands.js";
/** @deprecated Use dispatchGameCommand with a versioned GameCommand. */
export function applySimulationAction(game, action) {
    const payload = action.type === "emitSignal" && action.payload === undefined
        ? { schemaVersion: 1, type: action.type, signal: action.signal }
        : { schemaVersion: 1, ...action };
    return dispatchGameCommand(game, payload);
}
export function tickHeadless(game, units, step = 0.1) {
    const safeStep = Math.max(0.01, step);
    for (let elapsed = 0; elapsed < units; elapsed += safeStep) {
        game.tick(Math.min(safeStep, units - elapsed));
    }
}
export function runHeadlessMission(options) {
    const game = new TowerDefenseGame({ missionId: options.missionId, content: options.content });
    const actionResults = [];
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
