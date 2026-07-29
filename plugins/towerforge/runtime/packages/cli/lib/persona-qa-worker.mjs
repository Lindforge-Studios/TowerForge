import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { loadContentRegistry } from "./project-loader.mjs";
import { validateProjectSchemas } from "./project-schema.mjs";
import { mergeValidationResults } from "./trace.mjs";

export const PERSONA_QA_WORKER_LIMITS = Object.freeze({
  missionIds: 32,
  seeds: 64,
  personas: 3,
  totalRuns: 1_024,
  totalTicks: 2_000_000,
  concurrency: 8,
  simSeconds: 3_600,
  minimumTickStep: 0.05,
  maximumTickStep: 0.2,
  mapCells: 65_536,
  workerTaskTimeoutMs: 180_000
});

const PERSONA_IDS = Object.freeze([
  "aggressive_rush",
  "greedy_economy",
  "turtle_shield"
]);
const PERSONA_ID_SET = new Set(PERSONA_IDS);
const CACHE_SCHEMA_VERSION = 1;
const CACHE_MAX_BYTES = 16 * 1024 * 1024;
const WORKER_URL = new URL("./persona-qa-worker-thread.mjs", import.meta.url);

/**
 * Run evidence-only R10 persona simulations in a bounded worker pool.
 *
 * Authored project files are read-only. Completed evidence may be cached inside the active
 * project's private `.towerforge` directory; cancelled or incomplete batches are never cached.
 */
export async function runPersonaQaWorkerBatch(projectDir, input, options = {}) {
  const request = normalizeRequest(input);
  const workerOptions = normalizeOptions(options, request);
  const projectRoot = resolveProjectRoot(projectDir);
  const { files, engine, content } = await loadContentRegistry(projectRoot);
  const validation = mergeValidationResults(
    validateProjectSchemas(files),
    engine.validateGameContentRegistry(content)
  );
  if (!validation.ok) {
    const issue = validation.issues.find((entry) => entry.severity === "error") ?? validation.issues[0];
    throw new Error(`Persona QA requires a valid project${issue?.message ? `: ${issue.message}` : "."}`);
  }
  for (const missionId of request.missionIds) {
    if (!content.missions[missionId]) throw new Error(`Persona QA mission "${missionId}" was not found.`);
  }
  if (typeof engine.runPersonaQaSuiteV1 !== "function"
    || typeof engine.getSimulationContentDigest !== "function") {
    throw new Error("Engine build is missing the R10 persona QA contracts. Run `npm run build:engine`.");
  }
  const engineVersion = engine.SIMULATION_ENGINE_VERSION;
  if (typeof engineVersion !== "string" || engineVersion.length === 0) {
    throw new Error("Engine build did not expose its simulation version.");
  }
  const contentDigest = createHash("sha256")
    .update(engine.getSimulationContentDigest(content))
    .digest("hex");
  const requestDigest = personaQaCacheKey({ contentDigest, engineVersion, request });
  const cacheRoot = workerOptions.cache ? ensureConfinedCacheRoot(projectRoot) : null;
  const cacheFile = cacheRoot ? path.join(cacheRoot, `${requestDigest}.json`) : null;
  const cached = cacheFile
    ? readCacheEntry(cacheFile, { contentDigest, engineVersion, requestDigest, request })
    : null;
  if (cached) return deepFreeze({ ...cached, cached: true });

  if (workerOptions.signal?.aborted) {
    return cancelledResult({ contentDigest, engineVersion, requestDigest, completedRuns: 0 });
  }

  const tasks = buildTasks(request);
  const batch = await runWorkerPool({
    projectRoot,
    contentDigest,
    engineVersion,
    simSeconds: request.simSeconds,
    tickStep: request.tickStep,
    tasks,
    concurrency: workerOptions.concurrency,
    signal: workerOptions.signal,
    onProgress: workerOptions.onProgress
  });
  if (batch.status === "cancelled") {
    return cancelledResult({
      contentDigest,
      engineVersion,
      requestDigest,
      completedRuns: batch.results.length
    });
  }
  if (batch.results.length !== tasks.length) {
    throw new Error("Persona QA worker batch returned incomplete evidence.");
  }

  const runs = Object.freeze(batch.results.map(({ sequence: _sequence, ...run }) => deepFreeze(run)));
  const findings = buildFindings(runs, request.missionIds);
  const result = deepFreeze({
    schemaVersion: 1,
    status: "completed",
    cached: false,
    contentDigest,
    engineVersion,
    requestDigest,
    missionIds: request.missionIds,
    seeds: request.seeds,
    personaIds: request.personaIds,
    completedRuns: runs.length,
    runs,
    findings
  });
  if (cacheFile) writeCacheEntry(cacheFile, {
    contentDigest,
    engineVersion,
    requestDigest,
    result
  });
  return result;
}

export function personaQaCacheKey({ contentDigest, engineVersion, request }) {
  if (!/^[a-f0-9]{64}$/.test(contentDigest ?? "")) {
    throw new Error("Persona QA cache contentDigest must be a SHA-256 digest.");
  }
  if (typeof engineVersion !== "string" || engineVersion.length < 1 || engineVersion.length > 512) {
    throw new Error("Persona QA cache engineVersion must be a bounded non-empty string.");
  }
  return createHash("sha256")
    .update(canonicalJson({
      schemaVersion: CACHE_SCHEMA_VERSION,
      contentDigest,
      engineVersion,
      request
    }))
    .digest("hex");
}

function normalizeRequest(input) {
  const fields = ownDataFields(input, "Persona QA request");
  requireClosedFields(fields, [
    "schemaVersion",
    "missionIds",
    "seeds",
    "personaIds",
    "simSeconds",
    "tickStep"
  ], "Persona QA request");
  if (fields.get("schemaVersion") !== 1) {
    throw new Error(`Unsupported Persona QA request schema version "${String(fields.get("schemaVersion"))}".`);
  }
  const missionIds = normalizeStringList(
    fields.get("missionIds"),
    "Persona QA missionIds",
    PERSONA_QA_WORKER_LIMITS.missionIds
  );
  const seeds = normalizeStringList(
    fields.get("seeds"),
    "Persona QA seeds",
    PERSONA_QA_WORKER_LIMITS.seeds
  );
  const personaIds = normalizeStringList(
    fields.get("personaIds"),
    "Persona QA personaIds",
    PERSONA_QA_WORKER_LIMITS.personas,
    PERSONA_ID_SET
  );
  const simSeconds = boundedNumber(
    fields.get("simSeconds"),
    "simSeconds",
    PERSONA_QA_WORKER_LIMITS.minimumTickStep,
    PERSONA_QA_WORKER_LIMITS.simSeconds
  );
  const tickStep = boundedNumber(
    fields.get("tickStep"),
    "tickStep",
    PERSONA_QA_WORKER_LIMITS.minimumTickStep,
    PERSONA_QA_WORKER_LIMITS.maximumTickStep
  );
  const totalRuns = missionIds.length * seeds.length * personaIds.length;
  if (totalRuns > PERSONA_QA_WORKER_LIMITS.totalRuns) {
    throw new Error(`Persona QA matrix exceeds the ${PERSONA_QA_WORKER_LIMITS.totalRuns}-run budget.`);
  }
  if (Math.ceil(simSeconds / tickStep) * totalRuns > PERSONA_QA_WORKER_LIMITS.totalTicks) {
    throw new Error(`Persona QA matrix exceeds the ${PERSONA_QA_WORKER_LIMITS.totalTicks}-tick budget.`);
  }
  return deepFreeze({
    schemaVersion: 1,
    missionIds,
    seeds,
    personaIds,
    simSeconds,
    tickStep
  });
}

function normalizeOptions(input, request) {
  const options = input === undefined ? {} : input;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Persona QA worker options must be an object.");
  }
  const totalRuns = request.missionIds.length * request.seeds.length * request.personaIds.length;
  const defaultConcurrency = Math.max(1, Math.min(
    os.availableParallelism?.() ?? os.cpus().length,
    PERSONA_QA_WORKER_LIMITS.concurrency,
    totalRuns
  ));
  const concurrency = options.concurrency === undefined
    ? defaultConcurrency
    : Number.isSafeInteger(options.concurrency)
      ? Math.max(1, Math.min(options.concurrency, PERSONA_QA_WORKER_LIMITS.concurrency, totalRuns))
      : (() => { throw new Error("Persona QA concurrency must be a bounded integer."); })();
  if (options.cache !== undefined && typeof options.cache !== "boolean") {
    throw new Error("Persona QA cache option must be boolean.");
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new Error("Persona QA signal must be an AbortSignal.");
  }
  if (options.onProgress !== undefined && typeof options.onProgress !== "function") {
    throw new Error("Persona QA onProgress must be a function.");
  }
  return {
    concurrency,
    cache: options.cache !== false,
    signal: options.signal,
    onProgress: options.onProgress
  };
}

function buildTasks(request) {
  let sequence = 0;
  const tasks = [];
  for (const missionId of request.missionIds) {
    for (const seed of request.seeds) {
      for (const personaId of request.personaIds) {
        tasks.push({ sequence: sequence++, missionId, seed, personaId });
      }
    }
  }
  return tasks;
}

function runWorkerPool({
  projectRoot,
  contentDigest,
  engineVersion,
  simSeconds,
  tickStep,
  tasks,
  concurrency,
  signal,
  onProgress
}) {
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
      resolve({ status, results: results.sort((left, right) => left.sequence - right.sequence) });
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
        fail(new Error(
          `Persona QA worker task ${task.sequence} exceeded ${PERSONA_QA_WORKER_LIMITS.workerTaskTimeoutMs}ms.`
        ));
      }, PERSONA_QA_WORKER_LIMITS.workerTaskTimeoutMs));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      finish("cancelled");
      return;
    }
    for (let index = 0; index < concurrency; index += 1) {
      const worker = new Worker(WORKER_URL, {
        workerData: { projectRoot, contentDigest, engineVersion, simSeconds, tickStep }
      });
      workers.push(worker);
      worker.on("message", (message) => {
        if (settled) return;
        if (message?.type === "ready") {
          assign(worker);
          return;
        }
        if (message?.type === "error") {
          clearWorkerTimer(worker);
          fail(new Error(message.message || "Persona QA worker failed."));
          return;
        }
        if (message?.type !== "result") return;
        clearWorkerTimer(worker);
        results.push(message.result);
        try {
          onProgress?.(deepFreeze({
            missionId: message.result.missionId,
            seed: message.result.seed,
            personaId: message.result.personaId,
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
        if (!settled && code !== 0) fail(new Error(`Persona QA worker exited with code ${code}.`));
      });
    }
  });
}

function buildFindings(runs, missionIds) {
  const findings = [];
  for (const missionId of missionIds) {
    const missionRuns = runs.filter((run) => run.missionId === missionId);
    const victories = missionRuns.filter((run) => run.outcome === "victory").length;
    if (victories === 0) {
      findings.push(deepFreeze({
        severity: "warning",
        code: "no_persona_victory",
        missionId,
        message: "No tested persona completed the mission within the configured simulation window."
      }));
      continue;
    }
    if (victories !== missionRuns.length) {
      findings.push(deepFreeze({
        severity: "info",
        code: "persona_outcome_gap",
        missionId,
        message: `${victories} of ${missionRuns.length} persona runs completed the mission.`
      }));
    }
  }
  return Object.freeze(findings);
}

function cancelledResult({ contentDigest, engineVersion, requestDigest, completedRuns }) {
  return deepFreeze({
    schemaVersion: 1,
    status: "cancelled",
    cached: false,
    contentDigest,
    engineVersion,
    requestDigest,
    completedRuns,
    findings: []
  });
}

function readCacheEntry(cacheFile, expected) {
  if (!fs.existsSync(cacheFile)) return null;
  try {
    const stat = fs.lstatSync(cacheFile);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > CACHE_MAX_BYTES) return null;
    const envelope = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    const result = envelope?.result;
    if (envelope?.schemaVersion !== CACHE_SCHEMA_VERSION
      || envelope.contentDigest !== expected.contentDigest
      || envelope.engineVersion !== expected.engineVersion
      || envelope.requestDigest !== expected.requestDigest
      || result?.schemaVersion !== 1
      || result?.status !== "completed"
      || result?.contentDigest !== expected.contentDigest
      || result?.engineVersion !== expected.engineVersion
      || result?.requestDigest !== expected.requestDigest
      || result?.cached !== false
      || !validCachedPersonaQaResult(result, expected.request)) return null;
    return jsonClone(result, "cache result");
  } catch {
    return null;
  }
}

function validCachedPersonaQaResult(result, request) {
  const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort(binaryCompare).join("\0") === [...keys].sort(binaryCompare).join("\0");
  const sameStrings = (actual, expected) => Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
  if (!exactKeys(result, [
    "schemaVersion", "status", "cached", "contentDigest", "engineVersion", "requestDigest",
    "missionIds", "seeds", "personaIds", "completedRuns", "runs", "findings"
  ]) || result.cached !== false
    || !sameStrings(result.missionIds, request.missionIds)
    || !sameStrings(result.seeds, request.seeds)
    || !sameStrings(result.personaIds, request.personaIds)
    || !Array.isArray(result.runs)
    || result.runs.length !== request.missionIds.length * request.seeds.length * request.personaIds.length
    || result.completedRuns !== result.runs.length
    || !Array.isArray(result.findings)) return false;

  const tasks = buildTasks(request);
  for (let index = 0; index < tasks.length; index += 1) {
    const run = result.runs[index];
    const task = tasks[index];
    if (!exactKeys(run, [
      "missionId", "seed", "personaId", "outcome", "stateDigest", "coreHpRemaining",
      "towersBuilt", "leaks", "elapsed", "acceptedCommandCount"
    ]) || run.missionId !== task.missionId || run.seed !== task.seed || run.personaId !== task.personaId
      || !["playing", "victory", "defeat"].includes(run.outcome)
      || typeof run.stateDigest !== "string" || !/^tf-state-v1:[0-9a-f]{16}$/.test(run.stateDigest)
      || typeof run.coreHpRemaining !== "number" || !Number.isFinite(run.coreHpRemaining)
      || run.coreHpRemaining < 0 || run.coreHpRemaining > 1
      || !Number.isSafeInteger(run.towersBuilt) || run.towersBuilt < 0
      || !Number.isSafeInteger(run.leaks) || run.leaks < 0
      || typeof run.elapsed !== "number" || !Number.isFinite(run.elapsed)
      || run.elapsed < 0 || run.elapsed > request.simSeconds + 0.000001
      || !Number.isSafeInteger(run.acceptedCommandCount) || run.acceptedCommandCount < 0
      || run.acceptedCommandCount > PERSONA_QA_WORKER_LIMITS.totalTicks + 100_000) return false;
  }

  const expectedFindings = buildFindings(result.runs, request.missionIds);
  return canonicalJson(result.findings) === canonicalJson(expectedFindings);
}

function writeCacheEntry(cacheFile, { contentDigest, engineVersion, requestDigest, result }) {
  const envelope = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    contentDigest,
    engineVersion,
    requestDigest,
    result
  };
  const temporary = `${cacheFile}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${canonicalJson(envelope)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  fs.renameSync(temporary, cacheFile);
}

function resolveProjectRoot(projectDir) {
  if (typeof projectDir !== "string" || projectDir.length === 0) {
    throw new Error("Persona QA requires a project directory.");
  }
  const resolved = path.resolve(projectDir);
  const root = fs.realpathSync(resolved);
  if (!fs.statSync(root).isDirectory() || !fs.existsSync(path.join(root, "project.json"))) {
    throw new Error(`No TowerForge project found at: ${root}`);
  }
  return root;
}

function ensureConfinedCacheRoot(projectRoot) {
  let current = projectRoot;
  for (const segment of [".towerforge", "cache", "persona-qa", "v1"]) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("Persona QA cache path must contain only real project directories.");
      }
    } else {
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  const canonical = fs.realpathSync(current);
  const relative = path.relative(projectRoot, canonical);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Persona QA cache escaped the active project.");
  }
  return canonical;
}

function ownDataFields(value, label) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be a plain data object.`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} must be a plain data object.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length) {
      throw new Error(`${label} rejects symbol fields.`);
    }
    const fields = new Map();
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error(`${label} requires enumerable own data fields.`);
      }
      fields.set(key, descriptor.value);
    }
    return fields;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    throw new Error(`${label} must be readable plain own data.`);
  }
}

function requireClosedFields(fields, expected, label) {
  if (fields.size !== expected.length || expected.some((field) => !fields.has(field))) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}.`);
  }
}

function normalizeStringList(value, label, limit, allowed) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length < 1 || value.length > limit) {
      throw new Error(`${label} must contain 1..${limit} strings.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length
      || Object.keys(descriptors).some((key) => key !== "length" && !/^(0|[1-9]\d*)$/.test(key))
      || Object.keys(descriptors).filter((key) => key !== "length").length !== value.length) {
      throw new Error(`${label} must be a dense plain array.`);
    }
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error(`${label} must contain own data entries.`);
      }
      const entry = descriptor.value;
      if (typeof entry !== "string" || entry.length < 1 || entry !== entry.trim()
        || /[\u0000-\u001f\u007f]/.test(entry) || Buffer.byteLength(entry, "utf8") > 256) {
        throw new Error(`${label} entries must be bounded non-empty strings.`);
      }
      if (allowed && !allowed.has(entry)) throw new Error(`Unknown Persona QA persona "${entry}".`);
      result.push(entry);
    }
    if (new Set(result).size !== result.length) throw new Error(`${label} must be unique.`);
    return Object.freeze(result.sort(binaryCompare));
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith(label) || /persona/i.test(error.message))) {
      throw error;
    }
    throw new Error(`${label} must be a readable dense plain array.`);
  }
}

function boundedNumber(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Persona QA ${label} must be within ${minimum}..${maximum}.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(jsonClone(value, "canonical JSON")));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  const sorted = {};
  for (const key of Object.keys(value).sort(binaryCompare)) sorted[key] = sortJson(value[key]);
  return sorted;
}

function jsonClone(value, label) {
  const seen = new WeakSet();
  let nodes = 0;
  const visit = (current, depth) => {
    nodes += 1;
    if (nodes > 100_000 || depth > 64) throw new Error(`Persona QA ${label} exceeds its JSON budget.`);
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error(`Persona QA ${label} rejects non-finite numbers.`);
      return current;
    }
    if (!current || typeof current !== "object") {
      throw new Error(`Persona QA ${label} requires plain JSON data.`);
    }
    if (seen.has(current)) throw new Error(`Persona QA ${label} rejects cyclic data.`);
    if (Object.getOwnPropertySymbols(current).length) throw new Error(`Persona QA ${label} rejects symbol keys.`);
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) {
          throw new Error(`Persona QA ${label} requires plain arrays.`);
        }
        const clone = [];
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new Error(`Persona QA ${label} rejects sparse or accessor arrays.`);
          }
          clone.push(visit(descriptor.value, depth + 1));
        }
        return clone;
      }
      if (Object.getPrototypeOf(current) !== Object.prototype) {
        throw new Error(`Persona QA ${label} requires plain JSON objects.`);
      }
      const clone = {};
      for (const key of Object.keys(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new Error(`Persona QA ${label} requires own enumerable JSON data.`);
        }
        clone[key] = visit(descriptor.value, depth + 1);
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

function binaryCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
