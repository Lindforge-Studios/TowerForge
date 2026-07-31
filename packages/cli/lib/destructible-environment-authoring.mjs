import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";
import { compileMapSource, compileMapSources, normalizeDestructibleObjects } from "./map-compiler.mjs";
import { previewMechanicsModule } from "./mechanics-authoring.mjs";
import {
  loadEngine,
  normalizeProjectFiles,
  readRawProjectFiles,
  validateProjectDir
} from "./project-loader.mjs";
import { validateProjectSchemas } from "./project-schema.mjs";
import { mergeValidationResults } from "./trace.mjs";

const FIXED_FILES = Object.freeze([
  ["manifest", "project.json"],
  ["mechanics", "content/mechanics.json"],
  ["balance", "content/balance.json"],
  ["maps", "maps/compiled/maps.json"]
]);
let sequence = 0;

export async function previewDestructibleEnvironment(projectDir, args) {
  const plan = await buildPlan(projectDir, args);
  return publicPlan(plan, true);
}

export async function applyDestructibleEnvironment(projectDir, args, hooks = {}) {
  const plan = await buildPlan(projectDir, args);
  if (plan.conflict || !plan.validation.ok) return publicPlan(plan, false);
  if (typeof plan.request.ifRevision !== "string" || plan.request.ifRevision.length === 0) {
    return invalidPlanResult(plan, issue("revision_required", "ifRevision", "Apply requires the revision returned by preview."));
  }
  if (plan.noOp) {
    return {
      ...publicPlan(plan, false), written: false, rolledBack: false,
      previousRevision: plan.revision, revision: plan.revision
    };
  }

  const writes = candidateWrites(plan);
  const staged = stageWrites(writes);
  const committed = [];
  let backup;
  try {
    if (readSnapshot(plan.projectDir, plan.mapId).revision !== plan.revision) {
      return conflict(plan, readSnapshot(plan.projectDir, plan.mapId).revision);
    }
    backup = createBackup(plan, writes);
    if (readSnapshot(plan.projectDir, plan.mapId).revision !== plan.revision) {
      return conflict(plan, readSnapshot(plan.projectDir, plan.mapId).revision, backup);
    }
    for (const write of writes) {
      fs.renameSync(staged.get(write.relativePath), write.absolutePath);
      staged.delete(write.relativePath);
      committed.push(write);
      hooks.afterFileReplace?.(write.relativePath);
    }
    const post = await validateProjectDir(plan.projectDir);
    if (!post.result.ok) throw new Error("Destructible environment post-write validation failed.");
    return {
      ...publicPlan(plan, false),
      written: true,
      rolledBack: false,
      previousRevision: plan.revision,
      revision: readSnapshot(plan.projectDir, plan.mapId).revision,
      validation: post.result,
      backup
    };
  } catch (error) {
    rollback(committed);
    throw error;
  } finally {
    for (const temp of staged.values()) fs.rmSync(temp, { force: true });
  }
}

async function buildPlan(projectDir, unsafeArgs) {
  const resolved = realProjectRoot(projectDir);
  let request;
  try {
    request = inspectOwnData(unsafeArgs);
  } catch (error) {
    return invalidEarly(
      resolved,
      Object.create(null),
      "input_unsafe",
      "request",
      error instanceof Error ? error.message : "Request inspection failed."
    );
  }
  const mapId = safeId(request.mapId, "mapId");
  if (!mapId) return invalidEarly(resolved, request, "unsafe_map_id", "mapId", "mapId must be a safe project identifier.");

  let snapshot;
  try {
    snapshot = readSnapshot(resolved, mapId);
  } catch (error) {
    return invalidEarly(resolved, request, error.code ?? "source_invalid", "mapId", error.message);
  }
  if (request.ifRevision !== undefined && typeof request.ifRevision !== "string") {
    return invalid(snapshot, request, issue("request_invalid", "ifRevision", "ifRevision must be a string."));
  }
  if (request.ifRevision !== undefined && request.ifRevision !== snapshot.revision) {
    return {
      projectDir: resolved, snapshot, request, mapId, revision: snapshot.revision,
      conflict: true, expectedRevision: request.ifRevision, actualRevision: snapshot.revision,
      validation: { ok: false, issues: [] }
    };
  }
  if (request.moduleSchemaVersion !== 1 || typeof request.missionId !== "string"
    || typeof request.profileId !== "string" || typeof request.enabled !== "boolean") {
    return invalid(snapshot, request, issue("request_invalid", "request", "The closed destructible request fields are invalid."));
  }

  let placements;
  try {
    placements = normalizeDestructibleObjects(
      request.placements,
      snapshot.located.compiled.width,
      snapshot.located.compiled.height,
      "placements"
    );
  } catch (error) {
    return invalid(snapshot, request, issue("placement_invalid", "placements", error.message));
  }
  const definitions = request.profile?.projectiles?.destructibles?.definitions;
  if (!definitions || typeof definitions !== "object" || Array.isArray(definitions)) {
    return invalid(snapshot, request, issue("definition_missing", "profile.projectiles.destructibles.definitions", "Definitions are required."));
  }
  const missing = placements.find((placement) => !Object.hasOwn(definitions, placement.definitionId));
  if (missing) {
    return invalid(snapshot, request, issue("reference_missing", "placements", `Placement references missing definition "${missing.definitionId}".`));
  }

  const mechanicsPreview = await previewMechanicsModule(resolved, {
    moduleId: "ballistics",
    moduleSchemaVersion: 1,
    missionId: request.missionId,
    profileId: request.profileId,
    profile: request.profile,
    enabled: request.enabled
  });
  if (!mechanicsPreview.ok) {
    return invalid(snapshot, request, mechanicsPreview.validation.issues[0]
      ?? issue("candidate_invalid", "profile", "Mechanics candidate is invalid."));
  }

  const mapSource = clone(snapshot.located.source);
  writePlacements(mapSource, placements);
  const mapSources = { ...snapshot.rawFiles.mapSources, [snapshot.located.sourceName]: mapSource };
  const compiled = compileMapSources(mapSources, mechanicsPreview.candidate.balance.terrainTypes ?? {});
  if (!compiled.ok) {
    return invalid(snapshot, request, compiled.issues[0]
      ?? issue("map_compile_invalid", "placements", "Map candidate did not compile."));
  }
  const candidate = {
    manifest: mechanicsPreview.candidate.manifest,
    mechanics: mechanicsPreview.candidate.mechanics,
    balance: mechanicsPreview.candidate.balance,
    mapSource,
    compiledMaps: compiled.maps
  };
  const validation = await validateCandidate(snapshot.rawFiles, candidate, snapshot.located.sourceName);
  const plan = {
    projectDir: resolved, snapshot, request, mapId, revision: snapshot.revision,
    sourceName: snapshot.located.sourceName, candidate, validation
  };
  plan.noOp = candidateWrites(plan).every(
    (write) => write.original !== null && write.original.equals(write.bytes)
  );
  return plan;
}

async function validateCandidate(rawFiles, candidate, sourceName) {
  try {
    const normalized = normalizeProjectFiles({
      ...rawFiles,
      manifest: candidate.manifest,
      mechanics: candidate.mechanics,
      balance: candidate.balance,
      maps: candidate.compiledMaps,
      mapSources: { ...rawFiles.mapSources, [sourceName]: candidate.mapSource }
    });
    const engine = await loadEngine();
    const registry = engine.createGameContentRegistry({
      balance: normalized.balance, maps: normalized.maps, worldMap: normalized.worldMap,
      scripts: normalized.scripts, mechanics: normalized.mechanics, visuals: normalized.visuals,
      storyComics: normalized.storyComics, battleBackgrounds: normalized.battleBackgrounds
    });
    return mergeValidationResults(validateProjectSchemas(normalized), engine.validateGameContentRegistry(registry));
  } catch (error) {
    return { ok: false, issues: [issue("candidate_invalid", "project", error.message)] };
  }
}

function readSnapshot(projectDir, mapId) {
  const rawFiles = readRawProjectFiles(projectDir);
  const matches = [];
  for (const [sourceName, source] of Object.entries(rawFiles.mapSources ?? {})) {
    const compiled = compileMapSource(source, sourceName, rawFiles.balance?.terrainTypes ?? {});
    if (compiled.id === mapId) matches.push({ sourceName, source, compiled });
  }
  if (matches.length !== 1) throw coded("map_source_invalid", `Expected exactly one authored source for map "${mapId}".`);
  const located = matches[0];
  if (!/^[a-zA-Z0-9_.-]+\.tmj$/.test(located.sourceName)) throw coded("unsafe_map_source", "Map source name is unsafe.");
  const files = new Map();
  for (const [, relativePath] of FIXED_FILES) {
    files.set(relativePath, relativePath === "content/mechanics.json"
      ? readOptionalFile(projectDir, relativePath)
      : readFile(projectDir, relativePath));
  }
  const sourcePath = `maps/src/${located.sourceName}`;
  files.set(sourcePath, readFile(projectDir, sourcePath));
  const revisionFiles = new Map(files);
  for (const sourceName of Object.keys(rawFiles.mapSources ?? {}).sort(binaryCompare)) {
    if (!/^[a-zA-Z0-9_.-]+\.tmj$/.test(sourceName)) {
      throw coded("unsafe_map_source", `Map source name "${sourceName}" is unsafe.`);
    }
    const relativePath = `maps/src/${sourceName}`;
    if (!revisionFiles.has(relativePath)) revisionFiles.set(relativePath, readFile(projectDir, relativePath));
  }
  const hash = createHash("sha256");
  for (const relativePath of [...revisionFiles.keys()].sort(binaryCompare)) {
    const bytes = revisionFiles.get(relativePath);
    hash.update(`${relativePath}\0${bytes === null ? "absent" : bytes.length}\0`);
    if (bytes !== null) hash.update(bytes);
    hash.update("\0");
  }
  return { projectDir, rawFiles, located, files, revision: hash.digest("hex") };
}

function candidateWrites(plan) {
  const values = new Map([
    ["project.json", plan.candidate.manifest],
    ["content/mechanics.json", plan.candidate.mechanics],
    ["content/balance.json", plan.candidate.balance],
    [`maps/src/${plan.sourceName}`, plan.candidate.mapSource],
    ["maps/compiled/maps.json", plan.candidate.compiledMaps]
  ]);
  return transactionPaths(plan.sourceName).map((relativePath) => ({
    relativePath,
    absolutePath: confinedTarget(plan.projectDir, relativePath),
    original: plan.snapshot.files.get(relativePath),
    bytes: canonical(values.get(relativePath))
  }));
}

function stageWrites(writes) {
  const staged = new Map();
  for (const write of writes) {
    const temp = `${write.absolutePath}.destructible-stage.${process.pid}.${sequence++}`;
    fs.writeFileSync(temp, write.bytes, { flag: "wx" });
    staged.set(write.relativePath, temp);
  }
  return staged;
}

function createBackup(plan, writes) {
  const root = path.join(plan.projectDir, ".towerforge", "backups");
  fs.mkdirSync(root, { recursive: true });
  const directory = path.join(root, `destructible-${Date.now()}-${sequence++}`);
  fs.mkdirSync(directory);
  const files = {};
  for (const write of writes) {
    if (write.original === null) {
      files[write.relativePath] = null;
      continue;
    }
    const target = path.join(directory, write.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, write.original);
    files[write.relativePath] = target;
  }
  return { directory, files };
}

function rollback(committed) {
  for (const write of [...committed].reverse()) {
    if (write.original === null) {
      fs.rmSync(write.absolutePath, { force: true });
      continue;
    }
    const temp = `${write.absolutePath}.destructible-rollback.${process.pid}.${sequence++}`;
    try { fs.writeFileSync(temp, write.original, { flag: "wx" }); fs.renameSync(temp, write.absolutePath); }
    finally { fs.rmSync(temp, { force: true }); }
  }
}

function writePlacements(source, placements) {
  const property = Array.isArray(source.properties)
    ? source.properties.find((entry) => entry?.name === "destructibleObjects")
    : undefined;
  if (property) {
    delete source.destructibleObjects;
    property.value = typeof property.value === "string" ? JSON.stringify(placements) : clone(placements);
  } else source.destructibleObjects = clone(placements);
}

function publicPlan(plan, dryRun) {
  return {
    projectDir: plan.projectDir,
    ok: Boolean(plan.validation.ok), dryRun, written: false,
    ...(plan.conflict ? { conflict: true, expectedRevision: plan.expectedRevision, actualRevision: plan.actualRevision } : {}),
    revision: plan.revision ?? null,
    ...(plan.candidate ? { candidate: clone(plan.candidate) } : {}),
    validation: plan.validation
  };
}

function invalidEarly(projectDir, request, code, fieldPath, message) {
  return { projectDir, request, revision: null, validation: { ok: false, issues: [issue(code, fieldPath, message)] } };
}
function invalid(snapshot, request, problem) {
  return { projectDir: snapshot.projectDir, snapshot, request, mapId: request.mapId, revision: snapshot.revision, validation: { ok: false, issues: [problem] } };
}
function invalidPlanResult(plan, problem) {
  return { ...publicPlan({ ...plan, validation: { ok: false, issues: [problem] } }, false), written: false };
}
function conflict(plan, actualRevision, backup) {
  return { ...publicPlan({ ...plan, conflict: true, actualRevision }, false), ok: false, conflict: true, written: false, ...(backup ? { backup } : {}) };
}
function issue(code, fieldPath, message) { return { severity: "error", code, fieldPath, message }; }
function coded(code, message) { const error = new Error(message); error.code = code; return error; }
function inspectOwnData(value) {
  const seen = new WeakSet();
  let inspected = 0;

  function visit(current, fieldPath, depth) {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error(`${fieldPath} must contain only finite numbers.`);
      return current;
    }
    if (typeof current !== "object") throw new Error(`${fieldPath} must contain only plain JSON data.`);
    if (depth > 64 || ++inspected > 10_000) throw new Error("Request own-data inspection budget exceeded.");
    if (seen.has(current)) throw new Error(`${fieldPath} must not be cyclic.`);
    if (utilTypes.isProxy(current)) throw new Error(`${fieldPath} must not be a Proxy.`);
    seen.add(current);

    const prototype = Object.getPrototypeOf(current);
    const array = Array.isArray(current);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) {
      throw new Error(`${fieldPath} must use an ordinary Object or Array prototype.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === "symbol")) {
      throw new Error(`${fieldPath} must not contain symbol properties.`);
    }

    if (array) {
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || "get" in lengthDescriptor || "set" in lengthDescriptor
        || lengthDescriptor.enumerable || typeof lengthDescriptor.value !== "number") {
        throw new Error(`${fieldPath} has an invalid array length descriptor.`);
      }
      const length = lengthDescriptor.value;
      const output = new Array(length);
      for (const key of keys) {
        if (key === "length") continue;
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || "get" in descriptor || "set" in descriptor
          || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) {
          throw new Error(`${fieldPath} must contain only enumerable indexed own data.`);
        }
      }
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor) throw new Error(`${fieldPath} must not be sparse.`);
        output[index] = visit(descriptor.value, `${fieldPath}[${index}]`, depth + 1);
      }
      seen.delete(current);
      return output;
    }

    const output = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || "get" in descriptor || "set" in descriptor) {
        throw new Error(`${fieldPath}.${key} must be enumerable own data.`);
      }
    }
    for (const key of keys) {
      Object.defineProperty(output, key, {
        value: visit(descriptors[key].value, `${fieldPath}.${key}`, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    seen.delete(current);
    return output;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request must be an ordinary Object own-data record.");
  }
  return visit(value, "request", 0);
}
function safeId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && /^[A-Za-z0-9_.-]+$/.test(value) ? value : undefined;
}
function transactionPaths(sourceName) {
  return ["project.json", "content/mechanics.json", "content/balance.json", `maps/src/${sourceName}`, "maps/compiled/maps.json"];
}
function binaryCompare(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function canonical(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function realProjectRoot(projectDir) {
  const root = fs.realpathSync(path.resolve(projectDir));
  if (!fs.statSync(root).isDirectory()) throw new Error("Project root must be a directory.");
  return root;
}
function confinedFile(projectDir, relativePath) {
  const target = path.resolve(projectDir, relativePath);
  const relative = path.relative(projectDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Transaction path escaped project root.");
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${relativePath} must be a regular project file.`);
  return target;
}
function readFile(projectDir, relativePath) { return fs.readFileSync(confinedFile(projectDir, relativePath)); }
function confinedTarget(projectDir, relativePath) {
  const target = path.resolve(projectDir, relativePath);
  const relative = path.relative(projectDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Transaction path escaped project root.");
  const parent = fs.realpathSync(path.dirname(target));
  if (parent !== path.dirname(target) || !fs.statSync(parent).isDirectory()) {
    throw new Error(`${relativePath} parent must be a real project directory.`);
  }
  if (fs.existsSync(target)) return confinedFile(projectDir, relativePath);
  return target;
}
function readOptionalFile(projectDir, relativePath) {
  return fs.existsSync(path.resolve(projectDir, relativePath)) ? readFile(projectDir, relativePath) : null;
}
