import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeProjectFiles, readRawProjectFiles } from "./project-loader.mjs";
import { validateProjectSchemas } from "./project-schema.mjs";

export const DESKTOP_LARGE_SCREEN_RECIPE_ID = "desktop_large_screen";

export function readPlayerTargets(projectDir) {
  const raw = readRawProjectFiles(projectDir);
  return Object.freeze({
    projectSchemaVersion: raw.manifest?.schemaVersion ?? 1,
    buildTargetsSchemaVersion: raw.buildTargets?.schemaVersion ?? 1,
    revision: playerTargetsRevision(raw),
    targets: Object.freeze(structuredClone(raw.buildTargets?.targets ?? {}))
  });
}

export function getPlayerTargetRecipe(projectDir, recipeId, targetId) {
  if (recipeId !== DESKTOP_LARGE_SCREEN_RECIPE_ID) {
    const error = new Error(`Unknown player target recipe "${recipeId}".`);
    error.code = "unknown_player_target_recipe";
    throw error;
  }
  assertTargetId(targetId);
  const read = readPlayerTargets(projectDir);
  return Object.freeze({
    recipeId,
    targetId,
    detached: true,
    written: false,
    revision: read.revision,
    target: Object.freeze({
      id: targetId,
      platform: "web",
      renderer: "canvas",
      webDir: "dist-desktop",
      market: "pwa",
      storeChannel: "pwa",
      appId: "com.example.game",
      appName: "My Game",
      appTitle: "My Game",
      backgroundColor: "#111111",
      appVersion: "0.1.0",
      formFactor: "desktop",
      viewport: Object.freeze({ fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 }),
      quality: "balanced",
      locale: "auto",
      inputProfile: "keyboard_mouse"
    })
  });
}

export function previewPlayerTarget(projectDir, targetId, target) {
  const raw = readRawProjectFiles(projectDir);
  const candidateRaw = candidateProject(raw, targetId, target);
  const validation = validateProjectSchemas(normalizeProjectFiles(candidateRaw));
  return Object.freeze({
    ok: validation.ok,
    dryRun: true,
    written: false,
    revision: playerTargetsRevision(raw),
    projectSchemaVersion: 5,
    buildTargetsSchemaVersion: 2,
    validation,
    candidate: validation.ok ? Object.freeze({ targetId, target: Object.freeze(structuredClone(target)) }) : undefined
  });
}

export function applyPlayerTarget(projectDir, targetId, target, options = {}) {
  if (typeof options.ifRevision !== "string" || options.ifRevision.length === 0) {
    const error = new Error("Player target apply requires ifRevision from preview.");
    error.code = "revision_required";
    throw error;
  }
  const beforeRaw = readRawProjectFiles(projectDir);
  const previousRevision = playerTargetsRevision(beforeRaw);
  if (previousRevision !== options.ifRevision) {
    return Object.freeze({ ok: false, conflict: true, written: false, expectedRevision: options.ifRevision, actualRevision: previousRevision });
  }
  const preview = previewPlayerTarget(projectDir, targetId, target);
  if (!preview.ok) return Object.freeze({ ...preview, dryRun: false });

  const manifestPath = path.join(projectDir, "project.json");
  const targetsPath = path.join(projectDir, "build-targets.json");
  const beforeManifest = fs.readFileSync(manifestPath);
  const beforeTargets = fs.readFileSync(targetsPath);
  const backupDir = path.join(projectDir, ".towerforge", "backups", `r18-player-target-${Date.now()}-${process.pid}`);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(backupDir, "project.json.bak"), beforeManifest);
  fs.writeFileSync(path.join(backupDir, "build-targets.json.bak"), beforeTargets);

  const candidate = candidateProject(beforeRaw, targetId, target);
  try {
    writeJsonAtomic(manifestPath, candidate.manifest);
    writeJsonAtomic(targetsPath, candidate.buildTargets);
    const afterRaw = readRawProjectFiles(projectDir);
    const validation = validateProjectSchemas(normalizeProjectFiles(afterRaw));
    if (!validation.ok) throw new Error("Post-write player target validation failed.");
    return Object.freeze({
      ok: true,
      written: true,
      rolledBack: false,
      previousRevision,
      revision: playerTargetsRevision(afterRaw),
      validation,
      backup: Object.freeze({ directory: path.relative(projectDir, backupDir).split(path.sep).join("/") })
    });
  } catch (error) {
    fs.writeFileSync(manifestPath, beforeManifest);
    fs.writeFileSync(targetsPath, beforeTargets);
    return Object.freeze({ ok: false, written: false, rolledBack: true, error: error.message, validation: { ok: false } });
  }
}

function candidateProject(raw, targetId, target) {
  assertTargetId(targetId);
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    const error = new Error("Player target candidate must be an object.");
    error.code = "invalid_player_target";
    throw error;
  }
  const nextTarget = structuredClone(target);
  nextTarget.id = targetId;
  return {
    ...raw,
    manifest: { ...raw.manifest, schemaVersion: 5 },
    buildTargets: {
      ...raw.buildTargets,
      schemaVersion: 2,
      defaults: { ...(raw.buildTargets?.defaults ?? {}) },
      targets: { ...(raw.buildTargets?.targets ?? {}), [targetId]: nextTarget }
    }
  };
}

function assertTargetId(targetId) {
  if (typeof targetId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(targetId)) {
    const error = new Error("targetId must be a confined identifier.");
    error.code = "invalid_target_id";
    throw error;
  }
}

function playerTargetsRevision(raw) {
  return createHash("sha256")
    .update(JSON.stringify(raw.manifest ?? {}))
    .update("\0")
    .update(JSON.stringify(raw.buildTargets ?? {}))
    .digest("hex");
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
