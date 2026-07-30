import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  loadEngine,
  normalizeProjectFiles,
  readRawProjectFiles,
  validateProjectDir
} from "./project-loader.mjs";
import { PROCEDURAL_JUICE_SUPPORTED_EVENTS, PROJECT_SCHEMA_VERSION, validateProjectSchemas } from "./project-schema.mjs";
import { mergeValidationResults } from "./trace.mjs";

const TRANSACTION_FILES = Object.freeze([
  { key: "project", candidateKey: "manifest", relativePath: "project.json", limit: 256 * 1024 },
  { key: "visuals", candidateKey: "visuals", relativePath: "content/visuals.json", limit: 16 * 1024 * 1024 }
]);
const REQUEST_LIMITS = Object.freeze({ bytes: 1024 * 1024, depth: 24, nodes: 50_000 });
let transactionSequence = 0;

export const PROCEDURAL_JUICE_AUTHORING_SCHEMA = Object.freeze({
  schemaVersion: 1,
  visualsSchemaVersion: 3,
  activation: "content/visuals.json.proceduralJuice",
  mechanicsRequired: false,
  deterministic: true,
  presentationOnly: true,
  supportedEvents: PROCEDURAL_JUICE_SUPPORTED_EVENTS,
  catalogs: Object.freeze(["particleEmitters", "audioCues", "cameraCues", "eventBindings"]),
  budgets: Object.freeze({
    particleEmitters: 64,
    audioCues: 64,
    cameraCues: 64,
    eventBindings: 128,
    referencesPerBinding: 16,
    particlesPerEmitter: 256,
    eventsPerFrame: 64,
    durationMs: 10_000,
    hitStopDurationMs: 1_000
  }),
  disable: "remove proceduralJuice; keep the remaining visuals v3 catalog",
  tools: Object.freeze({
    read: "get_procedural_juice",
    recipe: "get_procedural_juice_recipe",
    preview: "preview_procedural_juice",
    apply: "apply_procedural_juice",
    eventPreview: "preview_procedural_juice_event"
  })
});

const RECIPES = Object.freeze({
  impact_feedback: Object.freeze({
    label: "Impact sparks and parametric hit tone",
    build({ missionIds = [] } = {}) {
      return {
        schemaVersion: 1,
        particleEmitters: {
          impact_sparks: {
            maxParticles: 12,
            lifetimeMs: { min: 80, max: 180 },
            speedPxPerSecond: { min: 40, max: 100 },
            angleDegrees: { min: 0, max: 360 },
            sizePx: { min: 1, max: 3 },
            color: "#ffd166",
            gravityPxPerSecondSquared: 80,
            blendMode: "additive"
          }
        },
        audioCues: {
          impact_tone: {
            waveform: "triangle",
            baseFrequencyHz: 220,
            durationMs: 120,
            gain: 0.3,
            pitchSemitones: {
              damage: 0.05,
              attackSpeed: 1,
              targetSize: -0.5,
              variation: { min: -0.2, max: 0.2 }
            }
          }
        },
        cameraCues: {},
        eventBindings: {
          impact: {
            event: "enemyHit",
            ...(missionIds.length > 0 ? { missionIds } : {}),
            particleEmitterIds: ["impact_sparks"],
            audioCueIds: ["impact_tone"]
          }
        }
      };
    }
  }),
  boss_finisher: Object.freeze({
    label: "Boss defeat camera finish",
    build({ missionIds = [], enemyTypeIds = [] } = {}) {
      return {
        schemaVersion: 1,
        particleEmitters: {},
        audioCues: {},
        cameraCues: {
          boss_finish: {
            shake: { durationMs: 160, intensity: 0.4 },
            hitStop: { durationMs: 200, timeScale: 0.2 },
            chromaticAberration: { durationMs: 120, intensity: 0.3 }
          }
        },
        eventBindings: enemyTypeIds.length > 0 ? {
          boss_death: {
            event: "enemyKilled",
            ...(missionIds.length > 0 ? { missionIds } : {}),
            enemyTypeIds,
            cameraCueIds: ["boss_finish"]
          }
        } : {}
      };
    }
  })
});

export class ProceduralJuiceAuthoringError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProceduralJuiceAuthoringError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function listProceduralJuiceRecipes() {
  return Object.entries(RECIPES).map(([id, recipe]) => ({
    id,
    label: recipe.label,
    schemaVersion: 1,
    requiredParameters: id === "boss_finisher" ? ["enemyTypeIds"] : [],
    optionalParameters: id === "boss_finisher" ? ["missionIds"] : ["missionIds"]
  }));
}

export function getProceduralJuiceRecipe(recipeId, unsafeParameters = {}) {
  if (typeof recipeId !== "string") throw new ProceduralJuiceAuthoringError("recipe_not_found", "Procedural Juice recipeId must be a string.");
  const recipe = ownValue(RECIPES, recipeId);
  if (!recipe) throw new ProceduralJuiceAuthoringError("recipe_not_found", `Unknown Procedural Juice recipe "${String(recipeId)}".`);
  const parameters = detachJson(unsafeParameters, "parameters");
  if (!ownRecord(parameters)) throw inputError("invalid_parameters", "parameters", "Recipe parameters must be an object.");
  const unknown = Object.keys(parameters).find((key) => !["missionIds", "enemyTypeIds"].includes(key));
  if (unknown) throw inputError("invalid_parameters", `parameters.${unknown}`, `Unknown recipe parameter "${unknown}".`);
  const missionIds = validateIdList(parameters.missionIds, "parameters.missionIds");
  const enemyTypeIds = validateIdList(parameters.enemyTypeIds, "parameters.enemyTypeIds");
  return cloneJson({
    schemaVersion: 1,
    recipeId,
    label: recipe.label,
    detached: true,
    proceduralJuice: recipe.build({ missionIds, enemyTypeIds })
  });
}

export function proceduralJuiceAuthoringRevision(projectDir) {
  return readSnapshot(projectDir).revision;
}

export async function inspectProceduralJuiceAuthoring(projectDir) {
  const snapshot = readSnapshot(projectDir);
  const juice = ownValue(ownRecord(snapshot.rawFiles.visuals), "proceduralJuice");
  const authored = juice !== undefined;
  let active = authored
    && snapshot.rawFiles.visuals?.schemaVersion === 3
    && juice?.schemaVersion === 1;
  if (active) {
    try {
      const files = normalizeProjectFiles(snapshot.rawFiles);
      active = !validateProjectSchemas(files).issues.some((entry) => (
        entry.severity === "error"
        && entry.entityKind === "visuals"
        && String(entry.fieldPath).includes("proceduralJuice")
      ));
    } catch {
      active = false;
    }
  }
  return {
    schemaVersion: 1,
    projectDir: snapshot.projectDir,
    revision: snapshot.revision,
    authored,
    active,
    projectSchemaVersion: snapshot.rawFiles.manifest?.schemaVersion ?? null,
    visualsSchemaVersion: snapshot.rawFiles.visuals?.schemaVersion ?? null,
    counts: catalogCounts(juice),
    ...(authored ? { proceduralJuice: cloneJson(juice) } : {})
  };
}

export async function previewProceduralJuiceAuthoring(projectDir, args) {
  const plan = await buildPlan(projectDir, args);
  return publicPlan(plan, true);
}

export async function applyProceduralJuiceAuthoring(projectDir, args, internalHooks = {}) {
  const plan = await buildPlan(projectDir, args);
  if (plan.conflict || !plan.validation.ok) return publicPlan(plan, false);
  if (typeof plan.request.ifRevision !== "string" || plan.request.ifRevision.length === 0) {
    return invalidResult(plan, "revision_required", "ifRevision", "Procedural Juice apply requires the revision returned by preview.", false);
  }
  if (plan.noOp) {
    assertRevision(plan.projectDir, plan.revision);
    return { ...publicPlan(plan, false), written: false, rolledBack: false, previousRevision: plan.revision };
  }

  const payloads = Object.fromEntries(TRANSACTION_FILES.map((entry) => [entry.key, canonicalJson(plan.candidate[entry.candidateKey])]));
  const staged = stagePayloads(plan.projectDir, payloads);
  const committedKeys = [];
  let backup;
  try {
    assertRevision(plan.projectDir, plan.revision);
    backup = createBackup(plan.projectDir, plan.snapshot);
    assertRevision(plan.projectDir, plan.revision);
    for (const entry of TRANSACTION_FILES) {
      assertOwnership(plan, payloads, committedKeys);
      const target = path.join(plan.projectDir, entry.relativePath);
      assertRegularOwnedTarget(plan.projectDir, entry.relativePath);
      fs.renameSync(staged[entry.key], target);
      staged[entry.key] = null;
      committedKeys.push(entry.key);
      internalHooks.afterFileReplace?.(entry.relativePath);
    }
    const post = await validateProjectDir(plan.projectDir);
    if (!post.result.ok) {
      throw new ProceduralJuiceAuthoringError(
        "post_write_validation_failed",
        "The committed Procedural Juice candidate failed complete project validation.",
        { validation: post.result }
      );
    }
    assertOwnership(plan, payloads, committedKeys);
    return {
      ...publicPlan(plan, false),
      written: true,
      rolledBack: false,
      previousRevision: plan.revision,
      revision: proceduralJuiceAuthoringRevision(plan.projectDir),
      backup
    };
  } catch (error) {
    const rollback = rollbackOwnedWrites(plan, payloads, committedKeys);
    if (!rollback.ok) {
      throw new ProceduralJuiceAuthoringError(
        rollback.conflicts.length > 0 ? "rollback_conflict" : "rollback_failed",
        "Procedural Juice authoring could not restore its owned files.",
        { cause: error, backup, rollback }
      );
    }
    if (error instanceof ProceduralJuiceAuthoringError) {
      error.backup = backup;
      error.rolledBack = committedKeys.length > 0;
    }
    throw error;
  } finally {
    cleanupStaged(staged);
  }
}

async function buildPlan(projectDir, unsafeArgs) {
  const snapshot = readSnapshot(projectDir);
  let request;
  try {
    request = detachJson(unsafeArgs, "request");
  } catch (error) {
    return invalidPlan(snapshot, error.code ?? "input_unsafe", error.fieldPath ?? "request", error.message);
  }
  if (!ownRecord(request)) return invalidPlan(snapshot, "invalid_request", "request", "Procedural Juice request must be an object.");
  const unknown = Object.keys(request).find((key) => !["proceduralJuice", "ifRevision"].includes(key));
  if (unknown) return invalidPlan(snapshot, "invalid_request", unknown, `Unknown request field "${unknown}".`, request);
  if (!Object.hasOwn(request, "proceduralJuice") || (request.proceduralJuice !== null && !ownRecord(request.proceduralJuice))) {
    return invalidPlan(snapshot, "invalid_request", "proceduralJuice", "proceduralJuice must be an exact object or null to disable.", request);
  }
  if (request.ifRevision !== undefined && typeof request.ifRevision !== "string") {
    return invalidPlan(snapshot, "invalid_request", "ifRevision", "ifRevision must be a string when provided.", request);
  }
  if (request.ifRevision !== undefined && request.ifRevision !== snapshot.revision) {
    return {
      projectDir: snapshot.projectDir,
      snapshot,
      request,
      revision: snapshot.revision,
      conflict: true,
      expectedRevision: request.ifRevision,
      actualRevision: snapshot.revision,
      validation: { ok: false, issues: [] }
    };
  }
  const projectVersion = snapshot.rawFiles.manifest?.schemaVersion;
  if (!Number.isSafeInteger(projectVersion) || projectVersion < 1 || projectVersion > PROJECT_SCHEMA_VERSION) {
    return invalidPlan(snapshot, "project_version_unsupported", "project.json.schemaVersion", `Project schemaVersion must be between 1 and ${PROJECT_SCHEMA_VERSION}.`, request);
  }
  const visualsVersion = snapshot.rawFiles.visuals?.schemaVersion;
  if (!Number.isSafeInteger(visualsVersion) || visualsVersion < 1 || visualsVersion > 3) {
    return invalidPlan(snapshot, "visuals_version_unsupported", "content/visuals.json.schemaVersion", "Procedural Juice authoring supports visuals schema versions 1 through 3.", request);
  }
  const authoredVersion = snapshot.rawFiles.visuals?.proceduralJuice?.schemaVersion;
  if (Number.isSafeInteger(authoredVersion) && authoredVersion > 1) {
    return invalidPlan(snapshot, "nested_version_unsupported", "content/visuals.json.proceduralJuice.schemaVersion", "A newer Procedural Juice catalog is read-only in this runtime.", request);
  }

  const candidate = createCandidate(snapshot.rawFiles, request);
  const validation = await validateCandidate(snapshot.rawFiles, candidate);
  const noOp = TRANSACTION_FILES.every((entry) => (
    JSON.stringify(snapshot.rawFiles[entry.candidateKey]) === JSON.stringify(candidate[entry.candidateKey])
  ));
  return { projectDir: snapshot.projectDir, snapshot, request, revision: snapshot.revision, candidate, validation, noOp };
}

function createCandidate(rawFiles, request) {
  const manifest = cloneJson(rawFiles.manifest);
  const visuals = cloneJson(rawFiles.visuals);
  if (!ownRecord(manifest) || !ownRecord(visuals)) throw inputError("candidate_invalid", "project", "Owned project sources must be JSON objects.");
  if (request.proceduralJuice === null) {
    delete visuals.proceduralJuice;
    return { manifest, visuals };
  }
  manifest.schemaVersion = 3;
  visuals.schemaVersion = 3;
  defineOwnData(visuals, "proceduralJuice", cloneJson(request.proceduralJuice));
  return { manifest, visuals };
}

async function validateCandidate(rawFiles, candidate) {
  try {
    const files = normalizeProjectFiles({ ...rawFiles, manifest: candidate.manifest, visuals: candidate.visuals });
    const engine = await loadEngine();
    const content = engine.createGameContentRegistry({
      balance: files.balance,
      maps: files.maps,
      worldMap: files.worldMap,
      scripts: files.scripts,
      mechanics: files.mechanics,
      visuals: files.visuals,
      storyComics: files.storyComics,
      battleBackgrounds: files.battleBackgrounds
    });
    return mergeValidationResults(validateProjectSchemas(files), engine.validateGameContentRegistry(content));
  } catch (error) {
    return { ok: false, issues: [issue("candidate_validation_failed", "proceduralJuice", error instanceof Error ? error.message : "Candidate validation failed.")] };
  }
}

function readSnapshot(projectDir) {
  const projectRoot = confinedProjectRoot(projectDir);
  const files = {};
  for (const entry of TRANSACTION_FILES) {
    const absolutePath = assertRegularOwnedTarget(projectRoot, entry.relativePath);
    const stat = fs.statSync(absolutePath);
    if (stat.size > entry.limit) throw new ProceduralJuiceAuthoringError("budget_exceeded", `${entry.relativePath} exceeds its authoring source budget.`);
    files[entry.key] = { bytes: fs.readFileSync(absolutePath), absolutePath };
  }
  const rawFiles = readRawProjectFiles(projectRoot);
  rawFiles.manifest = JSON.parse(files.project.bytes.toString("utf8"));
  rawFiles.visuals = JSON.parse(files.visuals.bytes.toString("utf8"));
  return { projectDir: projectRoot, files, rawFiles, revision: revisionFromFiles(files) };
}

function confinedProjectRoot(projectDir) {
  if (typeof projectDir !== "string" || projectDir.length === 0) throw new ProceduralJuiceAuthoringError("project_invalid", "projectDir must be a non-empty path.");
  const root = path.resolve(projectDir);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProceduralJuiceAuthoringError("project_invalid", "Project root must be a real directory, not a symbolic link.");
  return root;
}

function assertRegularOwnedTarget(projectDir, relativePath) {
  const absolutePath = path.resolve(projectDir, relativePath);
  const relative = path.relative(projectDir, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new ProceduralJuiceAuthoringError("path_escape", `Owned source escaped the project: ${relativePath}.`);
  let current = projectDir;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new ProceduralJuiceAuthoringError("symlink_rejected", `Owned source must not use a symbolic link: ${relativePath}.`);
  }
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile()) throw new ProceduralJuiceAuthoringError("source_invalid", `Owned source must be a regular file: ${relativePath}.`);
  return absolutePath;
}

function revisionFromFiles(files) {
  const hash = createHash("sha256");
  for (const entry of TRANSACTION_FILES) {
    hash.update(`${entry.relativePath}\0`);
    hash.update(files[entry.key].bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function stagePayloads(projectDir, payloads) {
  const staged = {};
  const suffix = `${process.pid}.${transactionSequence++}`;
  try {
    for (const entry of TRANSACTION_FILES) {
      assertRegularOwnedTarget(projectDir, entry.relativePath);
      const target = path.join(projectDir, entry.relativePath);
      const temp = `${target}.juice-stage.${suffix}`;
      fs.writeFileSync(temp, payloads[entry.key], { encoding: "utf8", flag: "wx" });
      staged[entry.key] = temp;
    }
    return staged;
  } catch (error) {
    cleanupStaged(staged);
    throw error;
  }
}

function createBackup(projectDir, snapshot) {
  const backupRoot = ensureRealDirectory(projectDir, [".towerforge", "backups"]);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(backupRoot, `procedural-juice-${stamp}-${transactionSequence++}`);
  fs.mkdirSync(directory);
  for (const entry of TRANSACTION_FILES) {
    const target = path.join(directory, entry.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, snapshot.files[entry.key].bytes);
  }
  const backups = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("procedural-juice-"))
    .map((entry) => entry.name).sort();
  for (const stale of backups.slice(0, Math.max(0, backups.length - 20))) fs.rmSync(path.join(backupRoot, stale), { recursive: true, force: true });
  return { directory };
}

function assertOwnership(plan, payloads, committedKeys) {
  for (const entry of TRANSACTION_FILES) {
    const target = assertRegularOwnedTarget(plan.projectDir, entry.relativePath);
    const expected = committedKeys.includes(entry.key) ? Buffer.from(payloads[entry.key]) : plan.snapshot.files[entry.key].bytes;
    if (!fs.readFileSync(target).equals(expected)) throw new ProceduralJuiceAuthoringError("commit_conflict", `Owned source changed during commit: ${entry.relativePath}.`);
  }
}

function rollbackOwnedWrites(plan, payloads, committedKeys) {
  const conflicts = [];
  const failures = [];
  for (const entry of [...TRANSACTION_FILES].reverse()) {
    if (!committedKeys.includes(entry.key)) continue;
    const target = path.join(plan.projectDir, entry.relativePath);
    try {
      assertRegularOwnedTarget(plan.projectDir, entry.relativePath);
      if (!fs.readFileSync(target).equals(Buffer.from(payloads[entry.key]))) {
        conflicts.push(entry.relativePath);
        continue;
      }
      writeBytesAtomic(target, plan.snapshot.files[entry.key].bytes);
    } catch {
      failures.push(entry.relativePath);
    }
  }
  return { ok: conflicts.length === 0 && failures.length === 0, conflicts, failures };
}

function assertRevision(projectDir, expected) {
  const actual = proceduralJuiceAuthoringRevision(projectDir);
  if (actual !== expected) throw new ProceduralJuiceAuthoringError("revision_conflict", "Procedural Juice sources changed since preview.", { expectedRevision: expected, actualRevision: actual });
}

function cleanupStaged(staged) {
  for (const value of Object.values(staged)) if (value) fs.rmSync(value, { force: true });
}

function writeBytesAtomic(filePath, bytes) {
  const temp = `${filePath}.rollback.${process.pid}.${transactionSequence++}`;
  try {
    fs.writeFileSync(temp, bytes, { flag: "wx" });
    fs.renameSync(temp, filePath);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function publicPlan(plan, dryRun) {
  if (plan.conflict) {
    return {
      projectDir: plan.projectDir,
      ok: false,
      dryRun,
      written: false,
      conflict: true,
      expectedRevision: plan.expectedRevision,
      actualRevision: plan.actualRevision,
      revision: plan.actualRevision
    };
  }
  return {
    projectDir: plan.projectDir,
    ok: plan.validation.ok,
    dryRun,
    written: false,
    revision: plan.revision,
    ...(plan.candidate ? { candidate: cloneJson(plan.candidate) } : {}),
    validation: plan.validation
  };
}

function invalidPlan(snapshot, code, fieldPath, message, request = {}) {
  return { projectDir: snapshot.projectDir, snapshot, request, revision: snapshot.revision, validation: { ok: false, issues: [issue(code, fieldPath, message)] } };
}

function invalidResult(plan, code, fieldPath, message, dryRun) {
  return { projectDir: plan.projectDir, ok: false, dryRun, written: false, revision: plan.revision, validation: { ok: false, issues: [issue(code, fieldPath, message)] } };
}

function issue(code, fieldPath, message) {
  return { severity: "error", entityKind: "proceduralJuice", entityId: "visuals", fieldPath, message, code };
}

function inputError(code, fieldPath, message) {
  return new ProceduralJuiceAuthoringError(code, message, { fieldPath });
}

function detachJson(value, fieldPath) {
  const state = { bytes: 0, nodes: 0, ancestors: new WeakSet() };
  const visit = (current, currentPath, depth) => {
    state.nodes += 1;
    if (state.nodes > REQUEST_LIMITS.nodes || depth > REQUEST_LIMITS.depth) throw inputError("budget_exceeded", currentPath, "Request exceeds its structural budget.");
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "string") {
      state.bytes += Buffer.byteLength(current);
      if (state.bytes > REQUEST_LIMITS.bytes) throw inputError("budget_exceeded", currentPath, "Request exceeds its byte budget.");
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw inputError("input_unsafe", currentPath, "Numbers must be finite.");
      return Object.is(current, -0) ? 0 : current;
    }
    if (typeof current !== "object" || state.ancestors.has(current)) throw inputError("input_unsafe", currentPath, "Request must be acyclic JSON data.");
    let descriptors;
    let prototype;
    let symbols;
    try {
      descriptors = Object.getOwnPropertyDescriptors(current);
      prototype = Object.getPrototypeOf(current);
      symbols = Object.getOwnPropertySymbols(current);
    } catch {
      throw inputError("input_unsafe", currentPath, "Request could not be inspected safely.");
    }
    let isArray;
    try {
      isArray = Array.isArray(current);
    } catch {
      throw inputError("input_unsafe", currentPath, "Request could not be inspected safely.");
    }
    if ((isArray && prototype !== Array.prototype) || (!isArray && prototype !== Object.prototype && prototype !== null) || symbols.length > 0) {
      throw inputError("input_unsafe", currentPath, "Request must contain only plain JSON objects and arrays.");
    }
    state.ancestors.add(current);
    try {
      if (isArray) {
        const length = descriptors.length?.value;
        if (!Number.isSafeInteger(length) || length < 0) throw inputError("input_unsafe", currentPath, "Array length is invalid.");
        const result = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) throw inputError("input_unsafe", `${currentPath}[${index}]`, "Sparse or accessor arrays are not accepted.");
          result.push(visit(descriptor.value, `${currentPath}[${index}]`, depth + 1));
        }
        return result;
      }
      const result = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        const keyBytes = Buffer.byteLength(key);
        state.bytes += keyBytes;
        if (state.bytes > REQUEST_LIMITS.bytes) throw inputError("budget_exceeded", currentPath, "Request exceeds its byte budget.");
        if (keyBytes > 256) throw inputError("input_unsafe", currentPath, "Request property names must not exceed 256 UTF-8 bytes.");
        if (!("value" in descriptor) || descriptor.enumerable !== true) throw inputError("input_unsafe", `${currentPath}.${key}`, "Accessors and non-enumerable values are not accepted.");
        defineOwnData(result, key, visit(descriptor.value, `${currentPath}.${key}`, depth + 1));
      }
      return result;
    } finally {
      state.ancestors.delete(current);
    }
  };
  return visit(value, fieldPath, 0);
}

function validateIdList(value, fieldPath) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64 || new Set(value).size !== value.length
    || value.some((id) => typeof id !== "string" || id.length === 0)) {
    throw inputError("invalid_parameters", fieldPath, `${fieldPath} must be a unique list of up to 64 non-empty project content IDs.`);
  }
  return [...value];
}

function catalogCounts(juice) {
  const count = (key) => ownRecord(juice?.[key]) ? Object.keys(juice[key]).length : 0;
  return { particleEmitters: count("particleEmitters"), audioCues: count("audioCues"), cameraCues: count("cameraCues"), eventBindings: count("eventBindings") };
}

function ensureRealDirectory(projectDir, segments) {
  let current = projectDir;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new ProceduralJuiceAuthoringError("backup_path_invalid", "Backup path must contain only real project directories.");
    }
  }
  return current;
}

function ownRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? value : undefined;
  } catch {
    return undefined;
  }
}

function ownValue(record, key) {
  if (!record) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && "value" in descriptor && descriptor.enumerable === true ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function defineOwnData(record, key, value) {
  Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
