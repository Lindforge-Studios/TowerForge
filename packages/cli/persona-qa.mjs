// persona-qa.mjs — deterministic evidence-only mission QA using fixed player personas.
import process from "node:process";
import { loadProjectFiles, resolveProjectDir } from "./lib/project-loader.mjs";
import { runPersonaQaWorkerBatch } from "./lib/persona-qa-worker.mjs";
import { parseJsonFlag, printJson } from "./lib/trace.mjs";

const ALL_PERSONAS = ["aggressive_rush", "greedy_economy", "turtle_shield"];

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = {
    projectDir: null, missionIds: [], seeds: [], personaIds: [], simSeconds: 600,
    tickStep: 0.2, cache: true, json: parseJsonFlag(raw)
  };
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    const next = raw[index + 1];
    if (arg === "--project" && next) { result.projectDir = next; index += 1; }
    else if (arg === "--mission" && next) { result.missionIds.push(next); index += 1; }
    else if (arg === "--seed" && next) { result.seeds.push(next); index += 1; }
    else if (arg === "--persona" && next) { result.personaIds.push(next); index += 1; }
    else if (arg === "--seconds" && next) { result.simSeconds = Number(next); index += 1; }
    else if (arg === "--tick-step" && next) { result.tickStep = Number(next); index += 1; }
    else if (arg === "--no-cache") result.cache = false;
  }
  return result;
}

const args = parseArgs();
const projectDir = resolveProjectDir(args.projectDir, []);

try {
  const files = loadProjectFiles(projectDir);
  const report = await runPersonaQaWorkerBatch(projectDir, {
    schemaVersion: 1,
    missionIds: args.missionIds.length > 0
      ? args.missionIds
      : [files.balance.defaultMissionId],
    seeds: args.seeds.length > 0 ? args.seeds : ["towerforge-persona-qa"],
    personaIds: args.personaIds.length > 0 ? args.personaIds : ALL_PERSONAS,
    simSeconds: args.simSeconds,
    tickStep: args.tickStep
  }, { cache: args.cache });
  if (args.json) {
    printJson({ ok: true, projectDir, ...report });
  } else {
    console.log(`\nPersona QA: ${report.completedRuns} deterministic run(s), ${report.findings.length} finding(s).`);
    for (const finding of report.findings) {
      console.log(`  ${finding.severity === "error" ? "✗" : "!"} ${finding.missionId}: ${finding.message}`);
    }
    if (report.findings.length === 0) console.log("  No persona outcome gaps found in the configured window.");
    console.log();
  }
} catch (error) {
  if (args.json) printJson({ ok: false, projectDir, error: error instanceof Error ? error.message : String(error) });
  else console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
