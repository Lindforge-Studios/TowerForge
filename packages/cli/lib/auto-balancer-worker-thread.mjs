import { parentPort, workerData } from "node:worker_threads";
import { loadEngine, normalizeProjectFiles, readRawProjectFiles } from "./project-loader.mjs";
import { validateProjectSchemas } from "./project-schema.mjs";
import { mergeValidationResults } from "./trace.mjs";

const BALANCE_PATCH_KEYS = new Set([
  "enemies", "towers", "waveSets", "missions", "abilities", "constants", "currencies", "defaultMissionId",
  "defaultDifficultyId", "difficulties", "metaProgression", "terrainTypes"
]);

if (!parentPort) throw new Error("Auto-balancer worker requires a parent port.");

const raw = readRawProjectFiles(workerData.projectRoot);
const engine = await loadEngine();
const contentByCandidate = new Map();
contentByCandidate.set("baseline", createContent(normalizeProjectFiles(raw)));

parentPort.on("message", (message) => {
  if (message?.type !== "evaluate") return;
  try {
    const task = message.task;
    const content = task.phase === "baseline" ? contentByCandidate.get("baseline") : candidateContent(task);
    const report = engine.runBalanceSweep(content, {
      missionIds: [workerData.missionId],
      simSeconds: workerData.maxTicks,
      tickStep: workerData.tickStep,
      seed: task.seed,
      ...(task.strategyId === "baseline" ? {} : { strategyIds: [task.strategyId] })
    });
    const score = scoreReport(report, workerData.missionId, task.strategyId);
    parentPort.postMessage({
      type: "result",
      result: {
        sequence: task.sequence,
        phase: task.phase,
        candidateId: task.candidateId,
        seed: task.seed,
        strategyId: task.strategyId,
        score
      }
    });
  } catch (error) {
    parentPort.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});

parentPort.postMessage({ type: "ready" });

function candidateContent(task) {
  const existing = contentByCandidate.get(task.candidateId);
  if (existing) return existing;
  const balance = structuredClone(raw.balance);
  if (!task.patch || typeof task.patch !== "object" || Array.isArray(task.patch)) {
    throw new Error(`Auto-balancer candidate "${task.candidateId}" requires a patch object.`);
  }
  for (const key of Object.keys(task.patch)) {
    if (!BALANCE_PATCH_KEYS.has(key)) throw new Error(`Auto-balancer patch contains unsupported balance key "${key}".`);
    balance[key] = structuredClone(task.patch[key]);
  }
  const candidateFiles = normalizeProjectFiles({ ...raw, balance });
  const content = createContent(candidateFiles);
  const validation = mergeValidationResults(validateProjectSchemas(candidateFiles), engine.validateGameContentRegistry(content));
  if (!validation.ok) {
    const issue = validation.issues.find((entry) => entry.severity === "error") ?? validation.issues[0];
    throw new Error(`Auto-balancer candidate "${task.candidateId}" is invalid${issue?.message ? `: ${issue.message}` : "."}`);
  }
  contentByCandidate.set(task.candidateId, content);
  return content;
}

function createContent(files) {
  return engine.createGameContentRegistry({
    balance: files.balance,
    maps: files.maps,
    worldMap: files.worldMap,
    scripts: files.scripts,
    mechanics: files.mechanics,
    visuals: files.visuals,
    storyComics: files.storyComics,
    battleBackgrounds: files.battleBackgrounds
  });
}

function scoreReport(report, missionId, strategyId) {
  const mission = report.missions.find((candidate) => candidate.missionId === missionId);
  if (!mission) throw new Error(`Auto-balancer mission "${missionId}" was not evaluated.`);
  if (strategyId === "baseline") {
    const errors = mission.flags.filter((flag) => flag.severity === "error").length;
    const warnings = mission.flags.filter((flag) => flag.severity === "warning").length;
    return ((1 - mission.winRate) * 100)
      + (Math.abs(0.65 - mission.avgCoreHpRemaining) * 20)
      + (errors * 20)
      + (warnings * 5);
  }
  const result = mission.results.find((candidate) => candidate.strategyId === strategyId);
  if (!result) throw new Error(`Auto-balancer strategy "${strategyId}" was not evaluated.`);
  return (result.win ? 0 : 100) + (result.leaks * 5) + (Math.abs(0.65 - result.coreHpRemaining) * 20);
}
