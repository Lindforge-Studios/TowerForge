import type { ActionResult } from "./types.js";
import {
  checkpointDataField,
  checkpointObjectDescriptors
} from "./checkpoint.js";
import { canonicalStringify } from "./stable-digest.js";
import type { GameCommandJournalResultV1 } from "./journal.js";

export const GAME_COMMAND_JOURNAL_RESULT_LIMITS_INTERNAL = Object.freeze({
  resultBytes: 64 * 1_024,
  reasonParams: 256
});

function cloneReasonParams(
  value: Readonly<Record<string, string | number | undefined>>
): Record<string, string | number> {
  const descriptors = checkpointObjectDescriptors(value, "Game command journal reason params");
  const keys = Object.keys(descriptors);
  if (keys.length > GAME_COMMAND_JOURNAL_RESULT_LIMITS_INTERNAL.reasonParams) {
    throw new Error("Game command journal reason params exceed the parameter limit.");
  }
  const params: Record<string, string | number> = {};
  for (const key of keys) {
    const candidate = checkpointDataField(descriptors, key, "Game command journal reason params");
    if (candidate === undefined) continue;
    if (
      (typeof candidate !== "string" && typeof candidate !== "number")
      || (typeof candidate === "number" && !Number.isFinite(candidate))
    ) {
      throw new Error("Game command journal reason params contain an unsupported value.");
    }
    Object.defineProperty(params, key, {
      value: typeof candidate === "number" && Object.is(candidate, -0) ? 0 : candidate,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return params;
}

/** Shared internal durable-result projection used by recording and replay. */
export function normalizeGameCommandJournalResult(
  result: ActionResult
): GameCommandJournalResultV1 {
  const normalized: {
    ok: boolean;
    reasonKey?: string;
    reasonParams?: Record<string, string | number>;
  } = { ok: result.ok };
  if (!result.ok && result.reasonKey !== undefined) {
    if (typeof result.reasonKey !== "string" || result.reasonKey.length === 0) {
      throw new Error("Game command journal result has an invalid reason key.");
    }
    normalized.reasonKey = result.reasonKey;
  }
  if (!result.ok && result.reasonParams !== undefined) {
    const params = cloneReasonParams(result.reasonParams);
    if (Object.keys(params).length > 0) normalized.reasonParams = params;
  }
  canonicalStringify(normalized, {
    maxBytes: GAME_COMMAND_JOURNAL_RESULT_LIMITS_INTERNAL.resultBytes
  });
  return normalized;
}
