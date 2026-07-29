import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPersonaQaWorkerBatch } from "./persona-qa-worker.mjs";

const fixtures = [];
const PERSONA_IDS = ["aggressive_rush", "greedy_economy", "turtle_shield"];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true });
});

function copyStarterFixture() {
  const source = path.resolve("examples/starter.tdproj");
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-persona-qa-"));
  fixtures.push(projectDir);
  fs.copyFileSync(path.join(source, "project.json"), path.join(projectDir, "project.json"));
  fs.cpSync(path.join(source, "content"), path.join(projectDir, "content"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "maps"), { recursive: true });
  fs.cpSync(path.join(source, "maps", "compiled"), path.join(projectDir, "maps", "compiled"), { recursive: true });
  fs.cpSync(path.join(source, "scripts"), path.join(projectDir, "scripts"), { recursive: true });

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.missions.persona_qa_clone = {
    ...balance.missions.tutorial_01,
    id: "persona_qa_clone",
    label: "Persona QA Clone"
  };
  fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");
  return projectDir;
}

function request(overrides = {}) {
  return {
    schemaVersion: 1,
    missionIds: ["tutorial_01", "persona_qa_clone"],
    seeds: ["seed-b", "seed-a"],
    personaIds: ["turtle_shield", "greedy_economy", "aggressive_rush"],
    simSeconds: 0.2,
    tickStep: 0.2,
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

function cacheFiles(projectDir) {
  const root = path.join(projectDir, ".towerforge", "cache", "persona-qa", "v1");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => name.endsWith(".json")).sort();
}

describe("R10 persona QA Node worker orchestration (RED)", () => {
  it("canonicalizes and bounds the mission x seed x persona matrix before worker execution", async () => {
    const projectDir = copyStarterFixture();
    const result = await runPersonaQaWorkerBatch(projectDir, request(), { concurrency: 2, cache: false });

    expect(result).toMatchObject({
      schemaVersion: 1,
      status: "completed",
      cached: false,
      missionIds: ["persona_qa_clone", "tutorial_01"],
      seeds: ["seed-a", "seed-b"],
      personaIds: PERSONA_IDS
    });
    expect(result.runs.map((run) => [run.missionId, run.seed, run.personaId])).toEqual([
      ["persona_qa_clone", "seed-a", "aggressive_rush"],
      ["persona_qa_clone", "seed-a", "greedy_economy"],
      ["persona_qa_clone", "seed-a", "turtle_shield"],
      ["persona_qa_clone", "seed-b", "aggressive_rush"],
      ["persona_qa_clone", "seed-b", "greedy_economy"],
      ["persona_qa_clone", "seed-b", "turtle_shield"],
      ["tutorial_01", "seed-a", "aggressive_rush"],
      ["tutorial_01", "seed-a", "greedy_economy"],
      ["tutorial_01", "seed-a", "turtle_shield"],
      ["tutorial_01", "seed-b", "aggressive_rush"],
      ["tutorial_01", "seed-b", "greedy_economy"],
      ["tutorial_01", "seed-b", "turtle_shield"]
    ]);

    await expect(runPersonaQaWorkerBatch(projectDir, request({
      missionIds: Array.from({ length: 33 }, (_, index) => `mission-${index}`)
    }), { cache: false })).rejects.toThrow(/missionIds|1\.\.32|budget|bounded/i);
    await expect(runPersonaQaWorkerBatch(projectDir, request({
      personaIds: ["aggressive_rush", "unknown_persona"]
    }), { cache: false })).rejects.toThrow(/persona/i);
  }, 30_000);

  it("returns byte-equivalent evidence for concurrency 1/2 and reordered request dimensions", async () => {
    const projectDir = copyStarterFixture();
    const serial = await runPersonaQaWorkerBatch(projectDir, request(), { concurrency: 1, cache: false });
    const parallel = await runPersonaQaWorkerBatch(projectDir, request({
      missionIds: ["persona_qa_clone", "tutorial_01"],
      seeds: ["seed-a", "seed-b"],
      personaIds: PERSONA_IDS
    }), { concurrency: 2, cache: false });

    expect(parallel).toEqual(serial);
    expect(JSON.stringify(parallel)).toBe(JSON.stringify(serial));
  }, 30_000);

  it("publishes cancellation without partial findings or a cache entry", async () => {
    const projectDir = copyStarterFixture();
    const authoredBefore = authoredSourceSnapshot(projectDir);
    const controller = new AbortController();
    const result = await runPersonaQaWorkerBatch(projectDir, request({
      seeds: ["seed-a", "seed-b", "seed-c", "seed-d"]
    }), {
      concurrency: 1,
      signal: controller.signal,
      onProgress(progress) {
        if (progress.completedRuns >= 1) controller.abort();
      }
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      status: "cancelled",
      cached: false,
      findings: []
    });
    expect(result.completedRuns).toBeGreaterThanOrEqual(1);
    expect(Object.prototype.hasOwnProperty.call(result, "applied")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "written")).toBe(false);
    expect(cacheFiles(projectDir)).toEqual([]);
    expect(authoredSourceSnapshot(projectDir)).toEqual(authoredBefore);
  }, 30_000);

  it("keys completed cache evidence by content digest, engine version, and canonical request only", async () => {
    const projectDir = copyStarterFixture();
    const authoredBefore = authoredSourceSnapshot(projectDir);
    const first = await runPersonaQaWorkerBatch(projectDir, request(), { concurrency: 1 });
    const second = await runPersonaQaWorkerBatch(projectDir, request({
      missionIds: ["persona_qa_clone", "tutorial_01"],
      seeds: ["seed-a", "seed-b"],
      personaIds: PERSONA_IDS
    }), { concurrency: 2 });

    expect(first).toMatchObject({
      schemaVersion: 1,
      status: "completed",
      cached: false,
      contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      engineVersion: expect.any(String),
      requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(second).toEqual({ ...first, cached: true });
    expect(cacheFiles(projectDir)).toEqual([`${first.requestDigest}.json`]);

    const envelope = JSON.parse(fs.readFileSync(path.join(
      projectDir,
      ".towerforge",
      "cache",
      "persona-qa",
      "v1",
      `${first.requestDigest}.json`
    ), "utf8"));
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      contentDigest: first.contentDigest,
      engineVersion: first.engineVersion,
      requestDigest: first.requestDigest
    });
    expect(envelope.result).toMatchObject({ status: "completed", requestDigest: first.requestDigest });
    expect(authoredSourceSnapshot(projectDir)).toEqual(authoredBefore);
  }, 30_000);

  it("ignores corrupt and future cache envelopes instead of trusting partial or unknown evidence", async () => {
    const projectDir = copyStarterFixture();
    const first = await runPersonaQaWorkerBatch(projectDir, request());
    const cacheFile = path.join(
      projectDir,
      ".towerforge",
      "cache",
      "persona-qa",
      "v1",
      `${first.requestDigest}.json`
    );

    fs.writeFileSync(cacheFile, "{not-json", "utf8");
    const afterCorruption = await runPersonaQaWorkerBatch(projectDir, request());
    expect(afterCorruption).toMatchObject({ status: "completed", cached: false });
    expect(afterCorruption.runs).toEqual(first.runs);

    const validEnvelope = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    fs.writeFileSync(cacheFile, `${JSON.stringify({ ...validEnvelope, schemaVersion: 2 })}\n`, "utf8");
    const afterFutureEnvelope = await runPersonaQaWorkerBatch(projectDir, request());
    expect(afterFutureEnvelope).toMatchObject({ status: "completed", cached: false });
    expect(afterFutureEnvelope.runs).toEqual(first.runs);
    expect(JSON.parse(fs.readFileSync(cacheFile, "utf8"))).toMatchObject({ schemaVersion: 1 });
  }, 30_000);

  it("never changes authored project files, including when cache is disabled", async () => {
    const projectDir = copyStarterFixture();
    const authoredBefore = authoredSourceSnapshot(projectDir);

    const result = await runPersonaQaWorkerBatch(projectDir, request(), { concurrency: 2, cache: false });

    expect(result).toMatchObject({ status: "completed", cached: false });
    expect(authoredSourceSnapshot(projectDir)).toEqual(authoredBefore);
    expect(fs.existsSync(path.join(projectDir, ".towerforge"))).toBe(false);
  }, 30_000);
});
