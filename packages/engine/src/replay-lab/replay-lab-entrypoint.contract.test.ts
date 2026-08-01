// @ts-expect-error Test-only package-contract import; engine production intentionally has no Node typings.
import fs from "node:fs";
// @ts-expect-error Test-only package-contract import; engine production intentionally has no Node typings.
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as rootEngine from "../index.js";

describe("R16 Replay Lab isolated entrypoint contract (RED)", () => {
  it("publishes Replay Lab through a dedicated package export", async () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("packages/engine/package.json"), "utf8"));
    expect(packageJson.exports).toMatchObject({ "./replay-lab": "./src/replay-lab/index.ts" });

    const specifier = "./index.js";
    const replayLab = await import(specifier);
    expect(replayLab).toEqual(expect.objectContaining({
      REPLAY_ARCHIVE_SCHEMA_VERSION: 1,
      REPLAY_ARCHIVE_HEADER_BYTES: 20,
      REPLAY_ARCHIVE_LIMITS: expect.objectContaining({ maximumBytes: 72 * 1_024 * 1_024 }),
      computeReplayCapabilityDigestV1: expect.any(Function),
      encodeReplayArchiveV1: expect.any(Function),
      decodeReplayArchiveV1: expect.any(Function)
    }));
  });

  it("does not expose Replay Lab runtime from the root engine entrypoint", () => {
    const root = rootEngine as unknown as Record<string, unknown>;
    for (const name of [
      "REPLAY_ARCHIVE_SCHEMA_VERSION",
      "REPLAY_ARCHIVE_HEADER_BYTES",
      "REPLAY_ARCHIVE_LIMITS",
      "computeReplayCapabilityDigestV1",
      "encodeReplayArchiveV1",
      "decodeReplayArchiveV1",
      "GhostReplaySessionV1",
      "ReplayBranchV1"
    ]) {
      expect(root).not.toHaveProperty(name);
    }
    const source = fs.readFileSync(path.resolve("packages/engine/src/index.ts"), "utf8");
    expect(source).not.toMatch(/replay-lab|replay-archive|ghost-session|replay-branch/i);
  });
});
