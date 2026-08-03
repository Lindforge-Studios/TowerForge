import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeProjectFiles, readRawProjectFiles } from "./project-loader.mjs";
import { validateProjectSchemas } from "./project-schema.mjs";
import { validateHudCatalogV1 } from "../../player-runtime/src/hud-catalog.mjs";
import { compileHudLayoutV1 } from "../../player-runtime/src/hud-layout.mjs";
import { createDefaultPlayerActionDescriptors } from "../../player-runtime/src/player-actions.mjs";
import { HUD_SELECTOR_DESCRIPTORS_V1 } from "../../player-runtime/src/hud-selectors.mjs";

const REVISION_SOURCES = Object.freeze([
  "project.json",
  "build-targets.json",
  "content/hud.json",
  "content/visuals.json"
]);

export const HUD_AUTHORING_SCHEMA_V1 = deepFreeze({
  schemaVersion: 1,
  projectSchemaVersion: 5,
  buildTargetsSchemaVersion: 2,
  hudCatalogSchemaVersion: 1,
  revisionSources: REVISION_SOURCES,
  assetMetadata: {
    field: "profile.assetMetadata",
    optional: true,
    roleReferences: "profile.assetRoles",
    schemaVersion: 1,
    kinds: ["image", "atlas_frame", "nine_slice"],
    atlasFrame: { requiredFor: "atlas_frame", type: "bounded_id" },
    nineSlice: {
      requiredFor: "nine_slice",
      fields: ["top", "right", "bottom", "left"],
      values: "bounded_non_negative_numbers"
    }
  },
  authoringTransaction: {
    read: "get_hud_profiles",
    recipe: "get_hud_profile_recipe",
    preview: "preview_hud_profile",
    apply: "apply_hud_profile",
    renderPreview: "render_hud_preview",
    revisionGuard: "ifRevision"
  }
});

export const HUD_PROFILE_RECIPE_IDS = Object.freeze([
  "desktop_quickbar",
  "radial_wheel",
  "mobile_bottom_sheet"
]);

export const HUD_MOCK_STATE_IDS = Object.freeze([
  "default", "victory", "defeat", "low_hp", "draft", "inventory", "capabilities"
]);

export { HUD_SELECTOR_DESCRIPTORS_V1 };

export function getHudProfileRecipe(recipeId, profileId) {
  if (!HUD_PROFILE_RECIPE_IDS.includes(recipeId)) throw new Error(`Unknown HUD profile recipe "${String(recipeId)}".`);
  assertId(profileId, "profileId");
  const labels = {
    desktop_quickbar: "Desktop quickbar",
    radial_wheel: "Radial wheel",
    mobile_bottom_sheet: "Mobile bottom sheet"
  };
  return deepFreeze({
    recipeId,
    profileId,
    detached: true,
    written: false,
    profile: recipeProfile(recipeId, labels[recipeId])
  });
}

export function getHudProfiles(projectDir) {
  const projectRoot = assertOwnedSources(projectDir);
  const raw = readRawProjectFiles(projectRoot);
  const catalog = raw.hud === undefined ? emptyCatalog() : requireValidCatalog(raw.hud);
  return deepFreeze({
    schemaVersion: 1,
    projectSchemaVersion: raw.manifest?.schemaVersion ?? 1,
    buildTargetsSchemaVersion: raw.buildTargets?.schemaVersion ?? 1,
    hudCatalogSchemaVersion: catalog.schemaVersion,
    revision: hudRevision(projectRoot),
    profiles: ownClone(catalog.profiles, "profiles"),
    bindings: collectBindings(raw.buildTargets)
  });
}

export function renderHudPreview(projectDir, args) {
  const projectRoot = assertOwnedSources(projectDir);
  const request = ownClone(args, "hudRenderPreviewRequest");
  assertExactKeys(request, ["targetId", "profileId", "screenId", "viewport", "mockState"], "hudRenderPreviewRequest", true);
  assertId(request.targetId, "targetId");
  assertId(request.profileId, "profileId");
  assertId(request.screenId, "screenId");
  if (!HUD_MOCK_STATE_IDS.includes(request.mockState)) throw new Error(`Unknown HUD mock state "${String(request.mockState)}".`);
  const viewport = ownClone(request.viewport, "viewport");
  assertExactKeys(viewport, ["width", "height"], "viewport", true);
  for (const key of ["width", "height"]) {
    if (!Number.isFinite(viewport[key]) || viewport[key] <= 0 || viewport[key] > 16384) {
      throw new Error(`viewport.${key} must be a finite positive number no greater than 16384.`);
    }
  }

  const raw = readRawProjectFiles(projectRoot);
  const catalog = requireValidCatalog(raw.hud);
  const profile = ownValue(catalog.profiles, request.profileId);
  if (!isOwnRecord(profile)) throw new Error(`HUD profile "${request.profileId}" does not exist.`);
  const target = ownValue(raw.buildTargets?.targets, request.targetId);
  if (!isOwnRecord(target)) throw new Error(`Build target "${request.targetId}" does not exist.`);
  if (ownValue(target, "hudProfileId") !== request.profileId) {
    throw new Error(`Build target "${request.targetId}" is not bound to HUD profile "${request.profileId}".`);
  }
  if (!isOwnRecord(ownValue(profile, "screens")) || !Object.hasOwn(profile.screens, request.screenId)) {
    throw new Error(`HUD screen "${request.screenId}" does not exist in profile "${request.profileId}".`);
  }

  const variantId = selectHudVariant(profile, viewport.width);
  let renderPlan;
  if (profile.commonNodes.length === 0) {
    renderPlan = deepFreeze({
      schemaVersion: 1,
      variantId,
      viewport: { width: viewport.width, height: viewport.height },
      safeRect: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      rootNodeIds: [...profile.variants[variantId].rootNodeIds],
      nodes: [],
      diagnostics: []
    });
  } else {
    const compiled = compileHudLayoutV1(profile, {
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      availableActions: createDefaultPlayerActionDescriptors(),
      selectorDescriptors: HUD_SELECTOR_DESCRIPTORS_V1,
      state: mockHudRuntimeState(request.mockState)
    });
    if (!compiled.ok) throw compiled.error ?? new Error("HUD render preview failed closed.");
    renderPlan = compiled.plan;
  }
  return deepFreeze({
    ok: true,
    written: false,
    profileId: request.profileId,
    screenId: request.screenId,
    variantId,
    mockState: request.mockState,
    renderPlan
  });
}

export function previewHudProfile(projectDir, args) {
  const projectRoot = assertOwnedSources(projectDir);
  const revision = hudRevision(projectRoot);
  let candidate;
  try {
    const raw = readRawProjectFiles(projectRoot);
    candidate = createCandidate(raw, args);
    const normalized = normalizeProjectFiles(candidate.raw);
    const validation = validateProjectSchemas(normalized);
    return deepFreeze({
      ok: validation.ok,
      dryRun: true,
      written: false,
      revision,
      projectSchemaVersion: normalized.manifest.schemaVersion,
      buildTargetsSchemaVersion: normalized.buildTargets.schemaVersion,
      hudCatalogSchemaVersion: normalized.hud?.schemaVersion ?? 1,
      validation,
      candidate: candidate.summary
    });
  } catch (error) {
    return failurePreview(revision, error);
  }
}

export function applyHudProfile(projectDir, args) {
  if (typeof args?.ifRevision !== "string" || !/^[a-f0-9]{64}$/.test(args.ifRevision)) {
    throw new Error("HUD profile apply requires the exact ifRevision from preview.");
  }
  const projectRoot = assertOwnedSources(projectDir);
  const previousRevision = hudRevision(projectRoot);
  if (previousRevision !== args.ifRevision) return conflict(args.ifRevision, previousRevision);

  const preview = previewHudProfile(projectRoot, args);
  if (!preview.ok) return deepFreeze({ ...preview, dryRun: false });

  // Re-read and re-hash immediately before deriving any bytes to commit. This closes the
  // preview/apply and validation/write races without widening the transaction's ownership.
  assertOwnedSources(projectRoot);
  const currentRevision = hudRevision(projectRoot);
  if (currentRevision !== previousRevision) return conflict(previousRevision, currentRevision);
  const beforeRaw = readRawProjectFiles(projectRoot);
  const candidate = createCandidate(beforeRaw, args).raw;
  const candidateValidation = validateProjectSchemas(normalizeProjectFiles(candidate));
  if (!candidateValidation.ok) {
    return deepFreeze({ ok: false, written: false, dryRun: false, validation: candidateValidation });
  }

  const sources = sourcePaths(projectRoot);
  const before = readOwnedBytes(sources);
  const backupDir = createBackupDirectory(projectRoot);
  writeBackups(backupDir, before);

  try {
    writeJsonAtomic(sources.project, candidate.manifest);
    writeJsonAtomic(sources.targets, candidate.buildTargets);
    writeJsonAtomic(sources.hud, candidate.hud);
    writeBytesAtomic(sources.visuals, before.visuals);

    const afterRaw = readRawProjectFiles(projectRoot);
    const validation = validateProjectSchemas(normalizeProjectFiles(afterRaw));
    if (!validation.ok) throw new Error("Post-write HUD profile validation failed.");
    return deepFreeze({
      ok: true,
      written: true,
      rolledBack: false,
      previousRevision,
      revision: hudRevision(projectRoot),
      validation,
      backup: { directory: portableRelative(projectRoot, backupDir) }
    });
  } catch (error) {
    rollbackSources(sources, before);
    cleanupTemporaryFiles(sources);
    return deepFreeze({
      ok: false,
      written: false,
      rolledBack: true,
      error: error instanceof Error ? error.message : "HUD authoring transaction failed.",
      validation: { ok: false }
    });
  }
}

function createCandidate(raw, args) {
  const request = ownClone(args, "hudProfileRequest");
  assertExactKeys(request, ["profileId", "profile", "binding", "ifRevision"], "hudProfileRequest");
  assertId(request.profileId, "profileId");
  const binding = ownClone(request.binding, "binding");
  assertExactKeys(binding, ["targetId", "enabled"], "binding", true);
  assertId(binding.targetId, "binding.targetId");
  if (typeof binding.enabled !== "boolean") throw new Error("binding.enabled must be boolean.");

  const existingCatalog = raw.hud === undefined ? emptyCatalog() : requireValidCatalog(raw.hud);
  const profiles = ownClone(existingCatalog.profiles, "hud.profiles");
  defineOwn(profiles, request.profileId, ownClone(request.profile, "profile"));
  const hud = { schemaVersion: 1, profiles };
  requireValidCatalog(hud);

  const manifest = ownClone(raw.manifest, "project.json");
  manifest.schemaVersion = 5;
  const buildTargets = ownClone(raw.buildTargets, "build-targets.json");
  buildTargets.schemaVersion = 2;
  if (!isOwnRecord(buildTargets.targets)) throw new Error("build-targets.json targets must be an own-data object.");
  const target = ownValue(buildTargets.targets, binding.targetId);
  if (!isOwnRecord(target)) throw new Error(`Build target "${binding.targetId}" does not exist.`);
  if (binding.enabled) defineOwn(target, "hudProfileId", request.profileId);
  else delete target.hudProfileId;

  return {
    raw: {
      ...raw,
      manifest,
      buildTargets,
      hud,
      hudAuthored: true,
      visuals: ownClone(raw.visuals, "content/visuals.json")
    },
    summary: {
      profileId: request.profileId,
      profile: ownClone(request.profile, "profile"),
      binding: { targetId: binding.targetId, enabled: binding.enabled }
    }
  };
}

function collectBindings(buildTargets) {
  const bindings = Object.create(null);
  const targets = buildTargets?.targets;
  if (!isOwnRecord(targets)) return bindings;
  for (const targetId of Object.keys(targets).sort()) {
    const target = ownValue(targets, targetId);
    if (!isOwnRecord(target) || typeof ownValue(target, "hudProfileId") !== "string") continue;
    defineOwn(bindings, targetId, target.hudProfileId);
  }
  return bindings;
}

function requireValidCatalog(value) {
  const result = validateHudCatalogV1(value);
  if (!result.ok) throw result.error ?? new Error("HUD catalog validation failed.");
  return result.catalog;
}

function emptyCatalog() {
  return { schemaVersion: 1, profiles: Object.create(null) };
}

function emptyProfile(label) {
  const variant = (width, height) => ({ schemaVersion: 1, designViewport: { width, height }, rootNodeIds: [] });
  return {
    schemaVersion: 1,
    label,
    breakpoints: { mobileMax: 767, tabletMax: 1199 },
    commonNodes: [],
    variants: {
      desktop: variant(1920, 1080),
      tablet: variant(1024, 768),
      mobile: variant(390, 844)
    },
    screens: { gameplay: { schemaVersion: 1, surface: "gameplay", rootNodeIds: [] } },
    screenGraph: { schemaVersion: 1, initialScreenId: "gameplay", transitions: [] },
    assetRoles: {}
  };
}

function recipeProfile(recipeId, label) {
  const state = () => ({
    normal: { visible: true, enabled: true },
    disabled: { visible: true, enabled: false },
    focused: { visible: true, enabled: true }
  });
  const node = (id, type, properties, childIds = [], actions = []) => ({
    schemaVersion: 1,
    id,
    type,
    childIds,
    properties,
    bindings: { data: [], actions },
    states: state()
  });
  const sized = (width, height) => ({
    width,
    height,
    minWidth: Math.min(width, 44),
    minHeight: Math.min(height, 44),
    maxWidth: Math.max(width, 44),
    maxHeight: Math.max(height, 44)
  });
  const anchor = (width, height, horizontal, vertical, offsetX = 0, offsetY = 0, layer = "content") => ({
    schemaVersion: 1,
    layer,
    safeArea: true,
    placement: { kind: "anchor", horizontal, vertical, offsetX, offsetY },
    size: sized(width, height)
  });
  const flow = (width, height, order) => ({
    schemaVersion: 1,
    layer: "content",
    safeArea: true,
    placement: { kind: "flow", order, grow: 0 },
    size: sized(width, height)
  });
  const variant = (width, height, layouts, rootNodeIds) => ({
    schemaVersion: 1,
    designViewport: { width, height },
    rootNodeIds,
    layouts
  });
  const profileShell = (authoredNodes, layouts) => {
    const pauseNodes = [
      node("pause_panel", "modal", { titleKey: "hud.pause" }, ["resume_game"]),
      node("resume_game", "button", { labelKey: "hud.resume", ariaLabelKey: "hud.resume" }, [], [
        { event: "activate", actionId: "pause", payload: {} }
      ])
    ];
    const commonNodes = [...authoredNodes, ...pauseNodes];
    for (const variantId of ["desktop", "tablet", "mobile"]) {
      layouts[variantId].pause_panel = anchor(300, 132, "center", "center", 0, 0, "modal");
      layouts[variantId].resume_game = flow(220, 52, 0);
    }
    return ({
    schemaVersion: 1,
    label,
    breakpoints: { mobileMax: 767, tabletMax: 1199 },
    commonNodes,
    variants: {
      desktop: variant(1920, 1080, layouts.desktop, [commonNodes[0].id, "pause_panel"]),
      tablet: variant(1024, 768, layouts.tablet, [commonNodes[0].id, "pause_panel"]),
      mobile: variant(390, 844, layouts.mobile, [commonNodes[0].id, "pause_panel"])
    },
    screens: {
      gameplay: { schemaVersion: 1, surface: "gameplay", rootNodeIds: [commonNodes[0].id] },
      pause: { schemaVersion: 1, surface: "pause", rootNodeIds: ["pause_panel"] }
    },
    screenGraph: {
      schemaVersion: 1,
      initialScreenId: "gameplay",
      transitions: [
        { id: "open_pause", event: "pauseRequested", fromScreenId: "gameplay", targetScreenId: "pause", conditions: [] },
        { id: "resume_gameplay", event: "resumeRequested", fromScreenId: "pause", targetScreenId: "gameplay", conditions: [] }
      ]
    },
    assetRoles: {}
    });
  };

  let profile;
  if (recipeId === "desktop_quickbar") {
    const nodes = [
      node("quickbar", "stack", { axis: "horizontal", gap: 12, align: "center" }, ["build_options", "start_wave"]),
      node("build_options", "build_menu", { presentation: "horizontal_quickbar", selectorId: "buildOptions" }, [], [
        { event: "select", actionId: "selectBuildSlot", payload: {} }
      ]),
      node("start_wave", "button", { labelKey: "hud.start_wave", ariaLabelKey: "hud.start_wave" }, [], [
        { event: "activate", actionId: "startWave", payload: {} }
      ])
    ];
    const makeLayouts = (width, height, offset) => ({
      quickbar: anchor(width, height, "center", "bottom", 0, offset, "overlay"),
      build_options: flow(width - 132, 52, 0),
      start_wave: flow(112, 52, 1)
    });
    profile = profileShell(nodes, {
      desktop: makeLayouts(760, 76, 24),
      tablet: makeLayouts(620, 76, 20),
      mobile: makeLayouts(350, 76, 12)
    });
  } else if (recipeId === "radial_wheel") {
    const nodes = [node("build_wheel", "radial_menu", { selectorId: "buildOptions", maxVisibleItems: 8 }, [], [
      { event: "select", actionId: "selectBuildSlot", payload: {} }
    ])];
    const makeLayouts = (size, offset) => ({
      build_wheel: anchor(size, size, "center", "bottom", 0, offset, "overlay")
    });
    profile = profileShell(nodes, {
      desktop: makeLayouts(320, 32),
      tablet: makeLayouts(280, 24),
      mobile: makeLayouts(240, 16)
    });
  } else {
    const nodes = [
      node("bottom_sheet", "stack", { axis: "vertical", gap: 8, align: "stretch" }, ["sheet_title", "build_options"]),
      node("sheet_title", "localized_text", { messageId: "hud.build" }),
      node("build_options", "build_menu", { presentation: "mobile_bottom_sheet", selectorId: "buildOptions" }, [], [
        { event: "select", actionId: "selectBuildSlot", payload: {} }
      ])
    ];
    const makeLayouts = (width, height, offset) => ({
      bottom_sheet: anchor(width, height, "center", "bottom", 0, offset, "overlay"),
      sheet_title: flow(width - 24, 44, 0),
      build_options: flow(width - 24, height - 60, 1)
    });
    profile = profileShell(nodes, {
      desktop: makeLayouts(560, 220, 24),
      tablet: makeLayouts(520, 220, 20),
      mobile: makeLayouts(366, 240, 12)
    });
  }

  return requireValidCatalog({ schemaVersion: 1, profiles: { recipe: profile } }).profiles.recipe;
}

function selectHudVariant(profile, viewportWidth) {
  if (viewportWidth <= profile.breakpoints.mobileMax) return "mobile";
  if (viewportWidth <= profile.breakpoints.tabletMax) return "tablet";
  return "desktop";
}

function mockHudRuntimeState(mockState) {
  const selectors = Object.create(null);
  const itemSelectors = ["buildOptions", "abilityOptions", "inventoryItems", "questItems", "capabilityItems"];
  for (const id of itemSelectors) defineOwn(selectors, id, []);
  defineOwn(selectors, "statusText", mockState);
  defineOwn(selectors, "coreHp", mockState === "low_hp" ? 10 : 100);
  defineOwn(selectors, "isVictory", mockState === "victory");
  defineOwn(selectors, "isDefeat", mockState === "defeat");
  return { selectors, nodeStates: Object.create(null) };
}

function failurePreview(revision, error) {
  const closed = error instanceof Error ? error : new Error("HUD authoring preview failed closed.");
  return deepFreeze({
    ok: false,
    dryRun: true,
    written: false,
    revision,
    validation: {
      ok: false,
      issues: [{ severity: "error", fieldPath: closed.fieldPath ?? "hudProfile", message: closed.message }]
    }
  });
}

function conflict(expectedRevision, actualRevision) {
  return deepFreeze({ ok: false, conflict: true, written: false, expectedRevision, actualRevision });
}

function hudRevision(projectRoot) {
  const sources = sourcePaths(projectRoot);
  const hash = createHash("sha256");
  for (const [relative, absolute] of [
    ["project.json", sources.project],
    ["build-targets.json", sources.targets],
    ["content/hud.json", sources.hud],
    ["content/visuals.json", sources.visuals]
  ]) {
    const bytes = fs.existsSync(absolute) ? fs.readFileSync(absolute) : Buffer.from("<absent>", "utf8");
    hash.update(Buffer.from(`${relative}\0${bytes.length}\0`, "utf8"));
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function assertOwnedSources(projectDir) {
  const root = path.resolve(projectDir);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("HUD authoring project root must be a real directory.");
  requiredFile(root, "project.json");
  requiredFile(root, "build-targets.json");
  requiredFile(root, "content/visuals.json");
  optionalFile(root, "content/hud.json");
  return root;
}

function sourcePaths(root) {
  return {
    project: confinedPath(root, "project.json"),
    targets: confinedPath(root, "build-targets.json"),
    hud: confinedPath(root, "content/hud.json"),
    visuals: confinedPath(root, "content/visuals.json")
  };
}

function requiredFile(root, relative) {
  const target = confinedPath(root, relative);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`HUD authoring requires regular source ${relative}.`);
  return target;
}

function optionalFile(root, relative) {
  const target = confinedPath(root, relative);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`HUD authoring requires regular source ${relative}.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return target;
}

function confinedPath(projectRoot, relative) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes("..")) {
    throw new Error("HUD authoring path escaped project.");
  }
  const root = path.resolve(projectRoot);
  let cursor = root;
  const segments = relative.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error(`HUD authoring rejects symbolic link traversal: ${relative}.`);
      if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(`HUD authoring parent must be a directory: ${relative}.`);
    } catch (error) {
      if (error?.code !== "ENOENT" || index < segments.length - 1) throw error;
    }
  }
  const rel = path.relative(root, cursor);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("HUD authoring path escaped project.");
  return cursor;
}

function createBackupDirectory(projectRoot) {
  let cursor = projectRoot;
  for (const segment of [".towerforge", "backups"]) {
    cursor = path.join(cursor, segment);
    try {
      const stat = fs.lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("HUD backup path must use real project directories.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      fs.mkdirSync(cursor, { mode: 0o700 });
    }
  }
  const backup = path.join(cursor, `r21-hud-${Date.now()}-${process.pid}`);
  fs.mkdirSync(backup, { mode: 0o700 });
  return backup;
}

function readOwnedBytes(sources) {
  return {
    project: fs.readFileSync(sources.project),
    targets: fs.readFileSync(sources.targets),
    hud: fs.existsSync(sources.hud) ? fs.readFileSync(sources.hud) : null,
    visuals: fs.readFileSync(sources.visuals)
  };
}

function writeBackups(backupDir, before) {
  fs.writeFileSync(path.join(backupDir, "project.json.bak"), before.project);
  fs.writeFileSync(path.join(backupDir, "build-targets.json.bak"), before.targets);
  if (before.hud === null) fs.writeFileSync(path.join(backupDir, "hud.json.absent"), "absent\n", "utf8");
  else fs.writeFileSync(path.join(backupDir, "hud.json.bak"), before.hud);
  fs.writeFileSync(path.join(backupDir, "visuals.json.bak"), before.visuals);
}

function rollbackSources(sources, before) {
  fs.writeFileSync(sources.project, before.project);
  fs.writeFileSync(sources.targets, before.targets);
  if (before.hud === null) {
    try { fs.unlinkSync(sources.hud); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  } else fs.writeFileSync(sources.hud, before.hud);
  fs.writeFileSync(sources.visuals, before.visuals);
}

function writeJsonAtomic(filePath, value) {
  writeBytesAtomic(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

function writeBytesAtomic(filePath, bytes) {
  const temporary = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.trunc(performance.now() * 1000)}`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: "wx" });
    fs.renameSync(temporary, filePath);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function cleanupTemporaryFiles(sources) {
  for (const filePath of Object.values(sources)) {
    const directory = path.dirname(filePath);
    const prefix = `${path.basename(filePath)}.tmp.`;
    try {
      for (const entry of fs.readdirSync(directory)) if (entry.startsWith(prefix)) fs.unlinkSync(path.join(directory, entry));
    } catch {}
  }
}

function ownClone(value, field, tracker = { active: new WeakSet(), nodes: 0 }, depth = 0) {
  if (value === null || typeof value !== "object") {
    if (["string", "number", "boolean", "undefined"].includes(typeof value) && (typeof value !== "number" || Number.isFinite(value))) return value;
    throw new Error(`${field} must contain bounded own-data values.`);
  }
  if (depth > 20 || tracker.nodes++ >= 8192) throw new Error(`${field} exceeds the bounded own-data budget.`);
  if (tracker.active.has(value)) throw new Error(`${field} must not contain cycles.`);
  let prototype; let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(`${field} must be inspectable own data.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) throw new Error(`${field} cannot contain symbol keys.`);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new Error(`${field} must be a plain array.`);
  } else if (prototype !== Object.prototype && prototype !== null) throw new Error(`${field} must be a plain object.`);
  tracker.active.add(value);
  try {
    if (Array.isArray(value)) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length > 8192 || Object.keys(descriptors).length !== length + 1) throw new Error(`${field} must be a dense array.`);
      const result = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error(`${field}[${index}] must be enumerable own data.`);
        result.push(ownClone(descriptor.value, `${field}[${index}]`, tracker, depth + 1));
      }
      return result;
    }
    const result = Object.create(null);
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) throw new Error(`${field}.${key} must be enumerable own data; accessors are forbidden.`);
      defineOwn(result, key, ownClone(descriptor.value, `${field}.${key}`, tracker, depth + 1));
    }
    return result;
  } finally {
    tracker.active.delete(value);
  }
}

function isOwnRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch { return false; }
}

function ownValue(record, key) {
  return isOwnRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined;
}

function defineOwn(record, key, value) {
  Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true });
}

function assertExactKeys(value, allowed, field, required = false) {
  if (!isOwnRecord(value)) throw new Error(`${field} must be an own-data object.`);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new Error(`${field}.${key} is not allowed.`);
  if (required) for (const key of allowed) if (!Object.hasOwn(value, key)) throw new Error(`${field}.${key} is required.`);
}

function assertId(value, field) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${field} must be a non-empty bounded JSON identifier.`);
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function portableRelative(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}
