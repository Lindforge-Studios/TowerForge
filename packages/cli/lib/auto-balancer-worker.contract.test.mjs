import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  autoBalancerEvidenceKey,
  autoBalancerCacheKey,
  runAutoBalancerWorkerBatch
} from "./auto-balancer-worker.mjs";

const fixtures = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true });
});

function copyStarterFixture() {
  const source = path.resolve("examples/starter.tdproj");
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-auto-balancer-"));
  fixtures.push(projectDir);
  fs.copyFileSync(path.join(source, "project.json"), path.join(projectDir, "project.json"));
  fs.cpSync(path.join(source, "content"), path.join(projectDir, "content"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "maps"), { recursive: true });
  fs.cpSync(path.join(source, "maps", "compiled"), path.join(projectDir, "maps", "compiled"), { recursive: true });
  fs.cpSync(path.join(source, "scripts"), path.join(projectDir, "scripts"), { recursive: true });
  return projectDir;
}

function request(projectDir, overrides = {}) {
  const balance = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
  return {
    missionId: "tutorial_01",
    candidates: [{ id: "same_constants", patch: { constants: balance.constants } }],
    seeds: ["seed-b", "seed-a"],
    strategyIds: ["solo_arrow_tower"],
    maxTicks: 1,
    concurrency: 1,
    ...overrides
  };
}

function authoredSourceSnapshot(projectDir) {
  const entries = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (directory === projectDir && entry.name === ".towerforge") continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(projectDir, absolute);
      if (entry.isDirectory()) visit(absolute);
      else entries.push([relative, fs.readFileSync(absolute).toString("base64")]);
    }
  };
  visit(projectDir);
  return entries;
}

describe("R7 auto-balancer Node worker orchestration", () => {
  it("keeps evidence tuples collision-free even when bounded strings contain NUL", () => {
    expect(autoBalancerEvidenceKey("candidate", "a\0b", "c"))
      .not.toBe(autoBalancerEvidenceKey("candidate", "a", "b\0c"));
  });

  it("keys the cache by content, engine, and canonical request", () => {
    const first = autoBalancerCacheKey({
      contentHash: "content-a",
      engineVersion: "engine-a",
      request: { seeds: ["b", "a"], strategyIds: ["solo"] }
    });
    const reordered = autoBalancerCacheKey({
      contentHash: "content-a",
      engineVersion: "engine-a",
      request: { strategyIds: ["solo"], seeds: ["b", "a"] }
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered).toBe(first);
    expect(autoBalancerCacheKey({ contentHash: "content-b", engineVersion: "engine-a", request: { seeds: ["b", "a"], strategyIds: ["solo"] } })).not.toBe(first);
    expect(autoBalancerCacheKey({ contentHash: "content-a", engineVersion: "engine-b", request: { seeds: ["b", "a"], strategyIds: ["solo"] } })).not.toBe(first);
    expect(autoBalancerCacheKey({ contentHash: "content-a", engineVersion: "engine-a", request: { seeds: ["a"], strategyIds: ["solo"] } })).not.toBe(first);
  });

  it("runs a bounded seed×strategy batch in workers, writes only its confined cache, and reuses evidence", async () => {
    const projectDir = copyStarterFixture();
    const balancePath = path.join(projectDir, "content", "balance.json");
    const before = fs.readFileSync(balancePath, "utf8");
    const authoredBefore = authoredSourceSnapshot(projectDir);

    const first = await runAutoBalancerWorkerBatch(projectDir, request(projectDir));
    const second = await runAutoBalancerWorkerBatch(projectDir, request(projectDir));

    expect(first).toMatchObject({
      schemaVersion: 1,
      status: "completed",
      cached: false,
      evaluatedRuns: 2,
      baselineRuns: 2
    });
    expect(first.proposals).toHaveLength(1);
    expect(first.proposals[0]).toMatchObject({
      id: "same_constants",
      rank: 1,
      evidence: {
        runCount: 2,
        seeds: ["seed-a", "seed-b"],
        strategyIds: ["solo_arrow_tower"]
      }
    });
    expect(Object.prototype.hasOwnProperty.call(first, "written")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(first, "applied")).toBe(false);
    expect(second).toMatchObject({ status: "completed", cached: true, requestDigest: first.requestDigest });
    expect(second.proposals).toEqual(first.proposals);
    expect(fs.readFileSync(balancePath, "utf8")).toBe(before);
    expect(authoredSourceSnapshot(projectDir)).toEqual(authoredBefore);

    const cacheRoot = path.join(projectDir, ".towerforge", "cache", "auto-balancer", "v1");
    expect(fs.readdirSync(cacheRoot).filter((name) => name.endsWith(".json"))).toHaveLength(1);
  }, 30_000);

  it("terminates a running bounded batch and withholds rankings from partial evidence", async () => {
    const projectDir = copyStarterFixture();
    const controller = new AbortController();
    const result = await runAutoBalancerWorkerBatch(projectDir, request(projectDir, {
      seeds: ["seed-a", "seed-b", "seed-c", "seed-d"],
      onProgress(progress) {
        if (progress.phase === "candidate") controller.abort();
      },
      signal: controller.signal
    }));

    expect(result.status).toBe("cancelled");
    expect(result.evaluatedRuns).toBeGreaterThanOrEqual(1);
    expect(result.proposals).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(result, "written")).toBe(false);
    expect(fs.existsSync(path.join(projectDir, ".towerforge", "cache", "auto-balancer", "v1"))).toBe(true);
    expect(fs.readdirSync(path.join(projectDir, ".towerforge", "cache", "auto-balancer", "v1"))).toEqual([]);
  }, 30_000);

  it("supports an explicitly cache-free compute-only surface without any project write", async () => {
    const projectDir = copyStarterFixture();
    const before = authoredSourceSnapshot(projectDir);

    const result = await runAutoBalancerWorkerBatch(projectDir, request(projectDir, { cache: false }));

    expect(result).toMatchObject({ status: "completed", cached: false });
    expect(authoredSourceSnapshot(projectDir)).toEqual(before);
    expect(fs.existsSync(path.join(projectDir, ".towerforge"))).toBe(false);
  }, 30_000);
});
