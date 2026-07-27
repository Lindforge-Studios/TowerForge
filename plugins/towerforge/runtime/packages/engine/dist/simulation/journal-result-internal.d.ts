import type { ActionResult } from "./types.js";
import type { GameCommandJournalResultV1 } from "./journal.js";
export declare const GAME_COMMAND_JOURNAL_RESULT_LIMITS_INTERNAL: Readonly<{
    resultBytes: number;
    reasonParams: 256;
}>;
/** Shared internal durable-result projection used by recording and replay. */
export declare function normalizeGameCommandJournalResult(result: ActionResult): GameCommandJournalResultV1;
