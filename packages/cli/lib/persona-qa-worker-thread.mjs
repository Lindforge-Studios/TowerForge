import { createHash } from "node:crypto";
import { parentPort, workerData } from "node:worker_threads";
import { loadContentRegistry } from "./project-loader.mjs";

if (!parentPort) throw new Error("Persona QA worker requires a parent port.");

const { engine, content } = await loadContentRegistry(workerData.projectRoot);
if (typeof engine.runPersonaQaSuiteV1 !== "function") {
  throw new Error("Engine build is missing the R10 persona QA contract. Run `npm run build:engine`.");
}
if (engine.SIMULATION_ENGINE_VERSION !== workerData.engineVersion
  || typeof engine.getSimulationContentDigest !== "function"
  || createHash("sha256").update(engine.getSimulationContentDigest(content)).digest("hex") !== workerData.contentDigest) {
  throw new Error("Persona QA project content changed while the worker batch was starting; run the analysis again.");
}

parentPort.on("message", (message) => {
  if (message?.type !== "evaluate") return;
  try {
    const task = message.task;
    const report = engine.runPersonaQaSuiteV1(content, {
      schemaVersion: 1,
      missionIds: [task.missionId],
      seeds: [task.seed],
      personaIds: [task.personaId],
      simSeconds: workerData.simSeconds,
      tickStep: workerData.tickStep
    });
    if (report.status !== "completed" || report.runs.length !== 1) {
      throw new Error("Persona QA engine returned incomplete task evidence.");
    }
    parentPort.postMessage({
      type: "result",
      result: {
        sequence: task.sequence,
        ...report.runs[0]
      }
    });
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

parentPort.postMessage({ type: "ready" });
