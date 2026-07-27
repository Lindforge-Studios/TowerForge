import type { GameContentRegistry } from "./registry.js";
import type { ActiveReactionsMechanics } from "../simulation/reactions.js";
export declare function normalizeReactionsProfileV1(value: unknown, damageTypeIds: ReadonlySet<string>): ActiveReactionsMechanics;
export declare function resolveActiveReactionsMechanics(content: GameContentRegistry, missionId: string): ActiveReactionsMechanics | undefined;
