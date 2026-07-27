import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveTowerScriptPath } from "./project-scripts.mjs";

export const TOWER_SCRIPT_LAYOUT_SCHEMA_VERSION = 1;
export const MAX_TOWER_SCRIPT_LAYOUT_BYTES = 512 * 1024;
export const MAX_TOWER_SCRIPT_LAYOUT_NODES = 16_384;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function dataFields(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object.`);
  }
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(`${label} could not be inspected safely.`);
  }
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new Error(`${label} must be a symbol-free plain object.`);
  }
  const fields = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw new Error(`${label} fields must be enumerable own data; accessors are not allowed.`);
    }
    fields[key] = descriptor.value;
  }
  return fields;
}

function finiteCoordinate(value, field) {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    throw new Error(`TowerScript layout ${field} must be a finite coordinate.`);
  }
  return value;
}

export function validateTowerScriptLayout(layout) {
  const root = dataFields(layout, "TowerScript layout");
  const rootExtras = Object.keys(root).filter((key) => !["schemaVersion", "nodes", "viewport"].includes(key));
  if (rootExtras.length > 0) throw new Error("TowerScript layout contains unsupported fields.");
  if (root.schemaVersion !== TOWER_SCRIPT_LAYOUT_SCHEMA_VERSION) {
    throw new Error(`TowerScript layout schemaVersion must be ${TOWER_SCRIPT_LAYOUT_SCHEMA_VERSION}.`);
  }
  const nodeFields = dataFields(root.nodes, "TowerScript layout nodes");
  const nodeEntries = Object.entries(nodeFields);
  if (nodeEntries.length > MAX_TOWER_SCRIPT_LAYOUT_NODES) {
    throw new Error(`TowerScript layout may contain at most ${MAX_TOWER_SCRIPT_LAYOUT_NODES} nodes.`);
  }
  const nodes = Object.create(null);
  for (const [nodeId, position] of nodeEntries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!nodeId || Buffer.byteLength(nodeId, "utf8") > 1024 || nodeId.includes("\0")) {
      throw new Error("TowerScript layout node id is invalid.");
    }
    const positionFields = dataFields(position, `TowerScript layout node "${nodeId}"`);
    const unexpected = Object.keys(positionFields).filter((key) => !["x", "y", "collapsed"].includes(key));
    if (unexpected.length > 0) throw new Error(`TowerScript layout node "${nodeId}" contains unsupported fields.`);
    if (positionFields.collapsed !== undefined && typeof positionFields.collapsed !== "boolean") {
      throw new Error(`TowerScript layout node "${nodeId}" collapsed must be boolean.`);
    }
    nodes[nodeId] = {
      x: finiteCoordinate(positionFields.x, `${nodeId}.x`),
      y: finiteCoordinate(positionFields.y, `${nodeId}.y`),
      ...(positionFields.collapsed === undefined ? {} : { collapsed: positionFields.collapsed })
    };
  }
  const viewport = dataFields(root.viewport, "TowerScript layout viewport");
  const viewportKeys = Object.keys(viewport).filter((key) => !["x", "y", "zoom"].includes(key));
  if (viewportKeys.length > 0) throw new Error("TowerScript layout viewport contains unsupported fields.");
  const zoom = viewport.zoom;
  if (!Number.isFinite(zoom) || zoom < 0.05 || zoom > 16) throw new Error("TowerScript layout viewport zoom must be 0.05..16.");
  const canonical = {
    schemaVersion: TOWER_SCRIPT_LAYOUT_SCHEMA_VERSION,
    nodes,
    viewport: {
      x: finiteCoordinate(viewport.x, "viewport.x"),
      y: finiteCoordinate(viewport.y, "viewport.y"),
      zoom
    }
  };
  if (Buffer.byteLength(`${JSON.stringify(canonical, null, 2)}\n`, "utf8") > MAX_TOWER_SCRIPT_LAYOUT_BYTES) {
    throw new Error(`TowerScript layout exceeds ${MAX_TOWER_SCRIPT_LAYOUT_BYTES} bytes.`);
  }
  return canonical;
}

function assertNoSymlinkSegments(projectDir, targetPath, includeLeaf = true) {
  const root = path.resolve(projectDir);
  const relative = path.relative(root, targetPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("TowerScript layout path escapes the project.");
  }
  let current = root;
  const parts = relative.split(path.sep);
  for (let index = 0; index < parts.length - (includeLeaf ? 0 : 1); index += 1) {
    current = path.join(current, parts[index]);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error("Symbolic links are not allowed in TowerScript layout paths.");
    }
  }
}

export function resolveTowerScriptLayoutPath(projectDir, scriptPath) {
  const scriptAbsolute = resolveTowerScriptPath(projectDir, scriptPath, { mustExist: true });
  const projectRoot = path.resolve(projectDir);
  const normalizedScriptPath = path.relative(projectRoot, scriptAbsolute).split(path.sep).join("/");
  const target = path.join(
    projectRoot,
    ".towerforge",
    "towerscript-layouts",
    ...normalizedScriptPath.split("/")
  ) + ".layout.json";
  assertNoSymlinkSegments(projectRoot, target);
  return target;
}

function fileRevision(filePath) {
  if (!fs.existsSync(filePath)) return "missing";
  return bytesRevision(fs.readFileSync(filePath));
}

function bytesRevision(source) {
  return createHash("sha256").update(source).digest("hex").slice(0, 20);
}

function graphRevisionFromBytes(scriptSource, layoutSource) {
  const hash = createHash("sha256");
  hash.update("towerforge:towerscript-graph:v1\0");
  hash.update(scriptSource);
  hash.update("\0layout\0");
  hash.update(layoutSource ?? "missing");
  return hash.digest("hex").slice(0, 20);
}

export function towerScriptGraphRevision(projectDir, scriptPath) {
  const scriptAbsolute = resolveTowerScriptPath(projectDir, scriptPath, { mustExist: true });
  const layoutPath = resolveTowerScriptLayoutPath(projectDir, scriptPath);
  return graphRevisionFromBytes(
    fs.readFileSync(scriptAbsolute),
    fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath) : null
  );
}

export function readTowerScriptLayout(projectDir, scriptPath) {
  const layoutPath = resolveTowerScriptLayoutPath(projectDir, scriptPath);
  let layout = null;
  if (fs.existsSync(layoutPath)) {
    const stat = fs.statSync(layoutPath);
    if (!stat.isFile()) throw new Error("TowerScript layout path must be a file.");
    if (stat.size > MAX_TOWER_SCRIPT_LAYOUT_BYTES) {
      throw new Error(`TowerScript layout exceeds ${MAX_TOWER_SCRIPT_LAYOUT_BYTES} bytes.`);
    }
    layout = validateTowerScriptLayout(JSON.parse(fs.readFileSync(layoutPath, "utf8")));
  }
  return {
    scriptPath,
    layout: layout === null ? null : cloneJson(layout),
    layoutRevision: fileRevision(layoutPath),
    revision: towerScriptGraphRevision(projectDir, scriptPath)
  };
}

function backupLayout(projectDir, scriptPath, layoutPath) {
  if (!fs.existsSync(layoutPath)) return { existed: false, path: null };
  const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${process.hrtime.bigint()}`;
  const backupPath = path.join(
    path.resolve(projectDir),
    ".towerforge",
    "backups",
    "towerscript-layouts",
    stamp,
    ...scriptPath.split("/")
  ) + ".layout.json";
  assertNoSymlinkSegments(projectDir, backupPath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(layoutPath, backupPath);
  return { existed: true, path: backupPath };
}

export function writeTowerScriptLayoutAtomic(projectDir, scriptPath, layout, options = {}) {
  if (typeof options.ifRevision !== "string" || options.ifRevision.length === 0) {
    throw new Error("TowerScript layout ifRevision is required.");
  }
  const canonical = validateTowerScriptLayout(layout);
  const actualRevision = towerScriptGraphRevision(projectDir, scriptPath);
  if (actualRevision !== options.ifRevision) {
    return {
      ok: false,
      conflict: true,
      written: false,
      expectedRevision: options.ifRevision,
      actualRevision
    };
  }
  const layoutPath = resolveTowerScriptLayoutPath(projectDir, scriptPath);
  const backup = backupLayout(projectDir, scriptPath, layoutPath);
  const scriptPathAbsolute = resolveTowerScriptPath(projectDir, scriptPath, { mustExist: true });
  const source = `${JSON.stringify(canonical, null, 2)}\n`;
  if (Buffer.byteLength(source, "utf8") > MAX_TOWER_SCRIPT_LAYOUT_BYTES) {
    throw new Error(`TowerScript layout exceeds ${MAX_TOWER_SCRIPT_LAYOUT_BYTES} bytes.`);
  }
  const layoutRevision = bytesRevision(source);
  const revision = graphRevisionFromBytes(fs.readFileSync(scriptPathAbsolute), source);
  fs.mkdirSync(path.dirname(layoutPath), { recursive: true });
  assertNoSymlinkSegments(projectDir, layoutPath);
  const temporary = `${layoutPath}.tmp.${process.pid}.${process.hrtime.bigint()}`;
  let committed = false;
  try {
    fs.writeFileSync(temporary, source, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, layoutPath);
    committed = true;
  } finally {
    if (!committed) fs.rmSync(temporary, { force: true });
  }
  return {
    ok: true,
    written: true,
    scriptPath,
    backup,
    previousRevision: options.ifRevision,
    layoutRevision,
    revision
  };
}

export function restoreTowerScriptLayoutWrite(projectDir, scriptPath, backup, options = {}) {
  const compositeGuard = typeof options.ifRevision === "string" && options.ifRevision.length > 0;
  const layoutGuard = typeof options.ifLayoutRevision === "string" && options.ifLayoutRevision.length > 0;
  if (!compositeGuard && !layoutGuard) {
    throw new Error("TowerScript layout restore ifRevision or ifLayoutRevision is required.");
  }
  const layoutPath = resolveTowerScriptLayoutPath(projectDir, scriptPath);
  const actualRevision = layoutGuard ? fileRevision(layoutPath) : towerScriptGraphRevision(projectDir, scriptPath);
  const expectedRevision = layoutGuard ? options.ifLayoutRevision : options.ifRevision;
  if (actualRevision !== expectedRevision) {
    return {
      ok: false,
      conflict: true,
      restored: false,
      expectedRevision,
      actualRevision
    };
  }
  const scriptPathAbsolute = resolveTowerScriptPath(projectDir, scriptPath, { mustExist: true });
  const scriptSource = fs.readFileSync(scriptPathAbsolute);
  let restoredSource = null;
  if (backup?.existed) {
    if (typeof backup.path !== "string" || !fs.existsSync(backup.path)) throw new Error("TowerScript layout backup is missing.");
    const backupRoot = path.join(path.resolve(projectDir), ".towerforge", "backups", "towerscript-layouts");
    const relative = path.relative(backupRoot, path.resolve(backup.path));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("TowerScript layout backup path escapes the project.");
    assertNoSymlinkSegments(projectDir, backup.path);
    restoredSource = fs.readFileSync(backup.path);
    fs.mkdirSync(path.dirname(layoutPath), { recursive: true });
    const temporary = `${layoutPath}.restore.${process.pid}.${process.hrtime.bigint()}`;
    let committed = false;
    try {
      fs.writeFileSync(temporary, restoredSource, { flag: "wx" });
      fs.renameSync(temporary, layoutPath);
      committed = true;
    } finally {
      if (!committed) fs.rmSync(temporary, { force: true });
    }
  } else {
    fs.rmSync(layoutPath, { force: true });
  }
  return {
    ok: true,
    restored: true,
    revision: graphRevisionFromBytes(scriptSource, restoredSource),
    layoutRevision: restoredSource === null ? "missing" : bytesRevision(restoredSource)
  };
}
