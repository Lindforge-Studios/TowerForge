import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { loadContentRegistry } from "./project-loader.mjs";
import { validateProjectSchemas } from "./project-schema.mjs";
import { mergeValidationResults } from "./trace.mjs";

export const AUTO_BALANCER_WORKER_LIMITS = Object.freeze({
  candidates: 32,
  seeds: 64,
  strategies: 32,
  totalCandidateRuns: 4096,
  concurrency: 8,
  maxTicks: 3600,
  workerTaskTimeoutMs: 180_000
});

const CACHE_SCHEMA_VERSION = 1;
const CACHE_MAX_BYTES = 16 * 1024 * 1024;
const PATCH_MAX_BYTES = 4 * 1024 * 1024;
const WORKER_URL = new URL("./auto-balancer-worker-thread.mjs", import.meta.url);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function autoBalancerCacheKey({ contentHash, engineVersion, request }) {
  for (const [field, value] of [["contentHash", contentHash], ["engineVersion", engineVersion]]) {
    if (typeof value !== "string" || value.length === 0 || value.length > 512) {
      throw new Error(`Auto-balancer cache ${field} must be a bounded non-empty string.`);
    }
  }
  return createHash("sha256")
    .update(canonicalJson({ schemaVersion: CACHE_SCHEMA_VERSION, contentHash, engineVersion, request }))
    .digest("hex");
}

/**
 * Runs an evidence-only auto-balancer request in a bounded Node worker pool.
 *
 * No gameplay source is written. Completed evidence may be cached below the active project's
 * `.towerforge/cache/auto-balancer/v1` directory; proposals are never applied automatically.
 */
export async function runAutoBalancerWorkerBatch(projectDir, input = {}) {
  const projectRoot = resolveProjectRoot(projectDir);
  const request = normalizeRequest(input);
  const cacheRoot = request.cache ? ensureConfinedCacheRoot(projectRoot) : null;
  const { files, engine, content } = await loadContentRegistry(projectRoot);
  const validation = mergeValidationResults(validateProjectSchemas(files), engine.validateGameContentRegistry(content));
  if (!validation.ok) {
    const issue = validation.issues.find((entry) => entry.severity === "error") ?? validation.issues[0];
    throw new Error(`Auto-balancer requires a valid project${issue?.message ? `: ${issue.message}` : "."}`);
  }
  if (!content.missions[request.missionId]) {
    throw new Error(`Auto-balancer mission "${request.missionId}" was not found.`);
  }
  if (typeof engine.getSimulationContentDigest !== "function" || typeof engine.runAutoBalancerBatch !== "function") {
    throw new Error("Engine build is missing the R7 auto-balancer contracts. Run `npm run build:engine`.");
  }
  const contentHash = engine.getSimulationContentDigest(content);
  const engineVersion = engine.SIMULATION_ENGINE_VERSION;
  if (typeof engineVersion !== "string" || engineVersion.length === 0) {
    throw new Error("Engine build did not expose its simulation version.");
  }
  const cacheRequest = {
    schemaVersion: 1,
    missionId: request.missionId,
    candidates: request.candidates,
    seeds: request.seeds,
    strategyIds: request.strategyIds,
    maxTicks: request.maxTicks,
    tickStep: request.tickStep
  };
  const requestDigest = autoBalancerCacheKey({ contentHash, engineVersion, request: cacheRequest });
  const cacheFile = cacheRoot ? path.join(cacheRoot, `${requestDigest}.json`) : null;
  const cached = cacheFile ? readCacheEntry(cacheFile, { contentHash, engineVersion, requestDigest }) : null;
  if (cached) return deepFreeze({ ...cached, cached: true });

  if (request.signal?.aborted) {
    return cancelledResult({ contentHash, engineVersion, requestDigest, baselineRuns: 0, evaluatedRuns: 0 });
  }

  const tasks = buildTasks(request);
  const run = await runWorkerPool({
    projectRoot,
    missionId: request.missionId,
    maxTicks: request.maxTicks,
    tickStep: request.tickStep,
    concurrency: request.concurrency,
    tasks,
    signal: request.signal,
    onProgress: request.onProgress
  });
  const baselineRuns = run.results.filter((result) => result.phase === "baseline").length;
  const evaluatedRuns = run.results.filter((result) => result.phase === "candidate").length;
  if (run.status === "cancelled") {
    return cancelledResult({ contentHash, engineVersion, requestDigest, baselineRuns, evaluatedRuns });
  }

  const baselineScores = run.results
    .filter((result) => result.phase === "baseline")
    .map((result) => result.score);
  const expectedBaselineRuns = request.seeds.length * request.strategyIds.length;
  if (baselineScores.length !== expectedBaselineRuns) {
    throw new Error("Auto-balancer worker batch returned incomplete baseline evidence.");
  }
  const candidateScores = new Map();
  for (const result of run.results) {
    if (result.phase !== "candidate") continue;
    candidateScores.set(autoBalancerEvidenceKey(result.candidateId, result.seed, result.strategyId), result.score);
  }
  const baselineScore = mean(baselineScores);
  const ranked = engine.runAutoBalancerBatch({
    baselineScore,
    candidates: request.candidates,
    seeds: request.seeds,
    strategyIds: request.strategyIds,
    evaluate({ candidateId, seed, strategyId }) {
      const score = candidateScores.get(autoBalancerEvidenceKey(candidateId, seed, strategyId));
      if (!Number.isFinite(score)) throw new Error("Auto-balancer worker batch returned incomplete candidate evidence.");
      return score;
    }
  });
  const result = deepFreeze({
    schemaVersion: 1,
    status: "completed",
    cached: false,
    contentHash,
    engineVersion,
    requestDigest,
    baselineRuns,
    evaluatedRuns: ranked.evaluatedRuns,
    proposals: ranked.proposals
  });
  if (cacheFile) writeCacheEntry(cacheFile, { contentHash, engineVersion, requestDigest, result });
  return result;
}

function normalizeRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Auto-balancer worker request must be an object.");
  }
  const missionId = boundedString(input.missionId, "missionId", 128);
  const candidates = normalizeCandidates(input.candidates);
  const seeds = normalizeUniqueStrings(input.seeds, "seeds", AUTO_BALANCER_WORKER_LIMITS.seeds).sort(binaryCompare);
  const strategyIds = normalizeUniqueStrings(input.strategyIds, "strategyIds", AUTO_BALANCER_WORKER_LIMITS.strategies).sort(binaryCompare);
  const totalCandidateRuns = candidates.length * seeds.length * strategyIds.length;
  if (totalCandidateRuns > AUTO_BALANCER_WORKER_LIMITS.totalCandidateRuns) {
    throw new Error(`Auto-balancer candidate matrix exceeds ${AUTO_BALANCER_WORKER_LIMITS.totalCandidateRuns} runs.`);
  }
  const maxTicks = Number.isSafeInteger(input.maxTicks)
    ? Math.max(1, Math.min(input.maxTicks, AUTO_BALANCER_WORKER_LIMITS.maxTicks))
    : 600;
  const tickStep = typeof input.tickStep === "number" && Number.isFinite(input.tickStep)
    ? Math.max(0.05, Math.min(input.tickStep, 0.2))
    : 0.2;
  const defaultConcurrency = Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, AUTO_BALANCER_WORKER_LIMITS.concurrency));
  const concurrency = Number.isSafeInteger(input.concurrency)
    ? Math.max(1, Math.min(input.concurrency, AUTO_BALANCER_WORKER_LIMITS.concurrency, totalCandidateRuns + (seeds.length * strategyIds.length)))
    : Math.min(defaultConcurrency, totalCandidateRuns + (seeds.length * strategyIds.length));
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
    throw new Error("Auto-balancer signal must be an AbortSignal.");
  }
  if (input.onProgress !== undefined && typeof input.onProgress !== "function") {
    throw new Error("Auto-balancer onProgress must be a function.");
  }
  if (input.cache !== undefined && typeof input.cache !== "boolean") {
    throw new Error("Auto-balancer cache option must be boolean.");
  }
  return {
    missionId,
    candidates,
    seeds,
    strategyIds,
    maxTicks,
    tickStep,
    concurrency,
    cache: input.cache !== false,
    signal: input.signal,
    onProgress: input.onProgress
  };
}

function normalizeCandidates(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > AUTO_BALANCER_WORKER_LIMITS.candidates) {
    throw new Error(`Auto-balancer requires 1..${AUTO_BALANCER_WORKER_LIMITS.candidates} candidates.`);
  }
  const ids = new Set();
  const candidates = value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || !SAFE_ID.test(candidate.id ?? "")) {
      throw new Error("Auto-balancer candidates require a safe id and a JSON patch object.");
    }
    if (ids.has(candidate.id)) throw new Error(`Duplicate auto-balancer candidate id "${candidate.id}".`);
    ids.add(candidate.id);
    const patch = jsonClone(candidate.patch, "candidate patch");
    if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).length === 0) {
      throw new Error(`Auto-balancer candidate "${candidate.id}" requires a non-empty patch object.`);
    }
    if (Buffer.byteLength(canonicalJson(patch), "utf8") > PATCH_MAX_BYTES) {
      throw new Error(`Auto-balancer candidate "${candidate.id}" patch exceeds ${PATCH_MAX_BYTES} bytes.`);
    }
    return Object.freeze({ id: candidate.id, patch: deepFreeze(patch) });
  });
  return Object.freeze(candidates.sort((a, b) => binaryCompare(a.id, b.id)));
}

function normalizeUniqueStrings(value, field, limit) {
  if (!Array.isArray(value) || value.length < 1 || value.length > limit) {
    throw new Error(`Auto-balancer ${field} must contain 1..${limit} strings.`);
  }
  const result = value.map((entry) => boundedString(entry, field, 256));
  if (new Set(result).size !== result.length) throw new Error(`Auto-balancer ${field} must be unique.`);
  return result;
}

function buildTasks(request) {
  let sequence = 0;
  const tasks = [];
  for (const seed of request.seeds) {
    for (const strategyId of request.strategyIds) {
      tasks.push({ sequence: sequence++, phase: "baseline", candidateId: null, patch: null, seed, strategyId });
    }
  }
  for (const candidate of request.candidates) {
    for (const seed of request.seeds) {
      for (const strategyId of request.strategyIds) {
        tasks.push({ sequence: sequence++, phase: "candidate", candidateId: candidate.id, patch: candidate.patch, seed, strategyId });
      }
    }
  }
  return tasks;
}

function runWorkerPool({ projectRoot, missionId, maxTicks, tickStep, concurrency, tasks, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let nextTask = 0;
    const results = [];
    const workers = [];
    const timers = new Map();

    const clearWorkerTimer = (worker) => {
      const timer = timers.get(worker);
      if (timer) clearTimeout(timer);
      timers.delete(worker);
    };
    const stopWorkers = () => {
      for (const worker of workers) {
        clearWorkerTimer(worker);
        void worker.terminate();
      }
    };
    const removeAbortListener = () => signal?.removeEventListener("abort", onAbort);
    const finish = (status) => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      stopWorkers();
      resolve({ status, results: results.sort((a, b) => a.sequence - b.sequence) });
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      stopWorkers();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onAbort = () => finish("cancelled");
    const assign = (worker) => {
      if (settled) return;
      if (signal?.aborted) {
        finish("cancelled");
        return;
      }
      const task = tasks[nextTask++];
      if (!task) {
        if (results.length === tasks.length) finish("completed");
        return;
      }
      worker.postMessage({ type: "evaluate", task });
      timers.set(worker, setTimeout(() => {
        fail(new Error(`Auto-balancer worker task ${task.sequence} exceeded ${AUTO_BALANCER_WORKER_LIMITS.workerTaskTimeoutMs}ms.`));
      }, AUTO_BALANCER_WORKER_LIMITS.workerTaskTimeoutMs));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      finish("cancelled");
      return;
    }
    for (let index = 0; index < concurrency; index += 1) {
      const worker = new Worker(WORKER_URL, { workerData: { projectRoot, missionId, maxTicks, tickStep } });
      workers.push(worker);
      worker.on("message", (message) => {
        if (settled) return;
        if (message?.type === "ready") {
          assign(worker);
          return;
        }
        if (message?.type === "error") {
          clearWorkerTimer(worker);
          fail(new Error(message.message || "Auto-balancer worker failed."));
          return;
        }
        if (message?.type !== "result") return;
        clearWorkerTimer(worker);
        const result = message.result;
        results.push(result);
        try {
          onProgress?.(deepFreeze({
            phase: result.phase,
            candidateId: result.candidateId,
            seed: result.seed,
            strategyId: result.strategyId,
            completedRuns: results.length,
            totalRuns: tasks.length
          }));
        } catch (error) {
          fail(error);
          return;
        }
        if (signal?.aborted) {
          finish("cancelled");
          return;
        }
        assign(worker);
      });
      worker.on("error", fail);
      worker.on("exit", (code) => {
        clearWorkerTimer(worker);
        if (!settled && code !== 0) fail(new Error(`Auto-balancer worker exited with code ${code}.`));
      });
    }
  });
}

function readCacheEntry(cacheFile, expected) {
  if (!fs.existsSync(cacheFile)) return null;
  try {
    const stat = fs.lstatSync(cacheFile);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Auto-balancer cache entries must be regular files.");
    if (stat.size > CACHE_MAX_BYTES) return null;
    const envelope = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (envelope?.schemaVersion !== CACHE_SCHEMA_VERSION
      || envelope.contentHash !== expected.contentHash
      || envelope.engineVersion !== expected.engineVersion
      || envelope.requestDigest !== expected.requestDigest
      || envelope.result?.schemaVersion !== 1
      || envelope.result?.status !== "completed"
      || envelope.result?.contentHash !== expected.contentHash
      || envelope.result?.engineVersion !== expected.engineVersion
      || envelope.result?.requestDigest !== expected.requestDigest
      || !Number.isSafeInteger(envelope.result?.baselineRuns)
      || !Number.isSafeInteger(envelope.result?.evaluatedRuns)
      || !Array.isArray(envelope.result?.proposals)) return null;
    return jsonClone(envelope.result, "auto-balancer cache result");
  } catch {
    return null;
  }
}

function writeCacheEntry(cacheFile, { contentHash, engineVersion, requestDigest, result }) {
  const envelope = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    contentHash,
    engineVersion,
    requestDigest,
    result
  };
  const temporary = `${cacheFile}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${canonicalJson(envelope)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, cacheFile);
}

function cancelledResult({ contentHash, engineVersion, requestDigest, baselineRuns, evaluatedRuns }) {
  return deepFreeze({
    schemaVersion: 1,
    status: "cancelled",
    cached: false,
    contentHash,
    engineVersion,
    requestDigest,
    baselineRuns,
    evaluatedRuns,
    proposals: []
  });
}

function resolveProjectRoot(projectDir) {
  if (typeof projectDir !== "string" || projectDir.length === 0 || !path.isAbsolute(path.resolve(projectDir))) {
    throw new Error("Auto-balancer requires a project directory.");
  }
  const root = fs.realpathSync(path.resolve(projectDir));
  if (!fs.statSync(root).isDirectory() || !fs.existsSync(path.join(root, "project.json"))) {
    throw new Error(`No TowerForge project found at: ${root}`);
  }
  return root;
}

function ensureConfinedCacheRoot(projectRoot) {
  let current = projectRoot;
  for (const segment of [".towerforge", "cache", "auto-balancer", "v1"]) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) {
        throw new Error("Auto-balancer cache path must contain only real project directories.");
      }
    } else {
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  const canonical = fs.realpathSync(current);
  const relative = path.relative(projectRoot, canonical);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Auto-balancer cache escaped the active project.");
  }
  return canonical;
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(jsonClone(value, "canonical JSON")));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  const sorted = {};
  for (const key of Object.keys(value).sort(binaryCompare)) {
    Object.defineProperty(sorted, key, {
      value: sortJson(value[key]),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return sorted;
}

function jsonClone(value, label) {
  const seen = new WeakSet();
  let nodes = 0;
  const visit = (current, depth) => {
    nodes += 1;
    if (nodes > 100_000 || depth > 64) throw new Error(`Auto-balancer ${label} exceeds its JSON budget.`);
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error(`Auto-balancer ${label} rejects non-finite numbers.`);
      return current;
    }
    if (!current || typeof current !== "object") throw new Error(`Auto-balancer ${label} requires plain JSON data.`);
    if (seen.has(current)) throw new Error(`Auto-balancer ${label} rejects cyclic data.`);
    if (Object.getOwnPropertySymbols(current).length) throw new Error(`Auto-balancer ${label} rejects symbol keys.`);
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) throw new Error(`Auto-balancer ${label} requires plain arrays.`);
        const clone = [];
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new Error(`Auto-balancer ${label} rejects sparse or accessor arrays.`);
          }
          clone.push(visit(descriptor.value, depth + 1));
        }
        return clone;
      }
      if (Object.getPrototypeOf(current) !== Object.prototype) {
        throw new Error(`Auto-balancer ${label} requires plain JSON objects.`);
      }
      const clone = {};
      for (const key of Object.keys(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new Error(`Auto-balancer ${label} requires own enumerable JSON data.`);
        }
        Object.defineProperty(clone, key, {
          value: visit(descriptor.value, depth + 1),
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      return clone;
    } finally {
      seen.delete(current);
    }
  };
  return visit(value, 0);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function boundedString(value, field, maxLength) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new Error(`Auto-balancer ${field} must be a bounded non-empty string.`);
  }
  return value;
}

function binaryCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function autoBalancerEvidenceKey(candidateId, seed, strategyId) {
  return JSON.stringify([candidateId, seed, strategyId]);
}
