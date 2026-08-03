const MAX_MODEL_DEPTH = 32;
const MAX_MODEL_VALUES = 16_384;
const DESCRIPTOR_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u;
const CONDITION_OPERATORS = new Set([
  "equals", "not_equals", "less_than", "less_than_or_equal", "greater_than",
  "greater_than_or_equal", "truthy", "falsy"
]);
const ASSET_KINDS = new Set(["image", "atlas_frame", "nine_slice"]);

function invalid(message) {
  throw new TypeError(`HUD Studio model: ${message}`);
}

function cloneOwnData(value, path = "value", seen = new WeakSet(), depth = 0, budget = { count: 0 }) {
  budget.count += 1;
  if (budget.count > MAX_MODEL_VALUES) invalid(`${path} exceeds the data budget.`);
  if (depth > MAX_MODEL_DEPTH) invalid(`${path} exceeds the maximum depth.`);
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "undefined") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(`${path} must contain finite numbers.`);
    return value;
  }
  if (typeof value !== "object") invalid(`${path} must contain only own JSON-like data.`);
  if (seen.has(value)) invalid(`${path} cannot contain cycles.`);
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    invalid(`${path} must be inspectable.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) invalid(`${path} cannot contain symbols.`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) invalid(`${path} must be a plain array.`);
    const elementKeys = Object.keys(descriptors).filter((key) => key !== "length");
    if (elementKeys.length !== value.length) invalid(`${path} must be a dense array without extra fields.`);
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid(`${path}[${index}] must be own data.`);
      result.push(cloneOwnData(descriptor.value, `${path}[${index}]`, seen, depth + 1, budget));
    }
    seen.delete(value);
    return result;
  }
  if (prototype !== Object.prototype && prototype !== null) invalid(`${path} must be a plain object.`);
  const result = Object.create(null);
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) invalid(`${path}.${key} must be own data; accessors are forbidden.`);
    result[key] = cloneOwnData(descriptor.value, `${path}.${key}`, seen, depth + 1, budget);
  }
  seen.delete(value);
  return result;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function detached(value, path) {
  return deepFreeze(cloneOwnData(value, path));
}

function boundedId(value, path) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    invalid(`${path} must be a bounded identifier.`);
  }
  return value;
}

function descriptorId(value, path) {
  if (!DESCRIPTOR_ID.test(value ?? "")) invalid(`${path} must be a descriptor identifier.`);
  return value;
}

function cloneProfile(profile) {
  const copy = cloneOwnData(profile, "profile");
  if (!Array.isArray(copy.commonNodes) || copy.variants === null || typeof copy.variants !== "object") {
    invalid("profile is missing commonNodes or variants.");
  }
  return copy;
}

function findTransition(profile, transitionId) {
  boundedId(transitionId, "transitionId");
  const transitions = profile?.screenGraph?.transitions;
  if (!Array.isArray(transitions)) invalid("profile.screenGraph.transitions must be an array.");
  const index = transitions.findIndex((entry) => entry?.id === transitionId);
  if (index < 0) invalid(`transition "${transitionId}" does not exist.`);
  return transitions[index];
}

function normalizeCondition(condition) {
  const copy = cloneOwnData(condition, "condition");
  if (Object.keys(copy).sort().join(",") !== "operator,selectorId,value") invalid("condition must contain selectorId, operator and value only.");
  descriptorId(copy.selectorId, "condition.selectorId");
  if (!CONDITION_OPERATORS.has(copy.operator)) invalid("condition.operator is unsupported.");
  if (copy.value !== null && typeof copy.value !== "boolean" && typeof copy.value !== "string"
    && (typeof copy.value !== "number" || !Number.isFinite(copy.value))) {
    invalid("condition.value must be a finite scalar.");
  }
  return copy;
}

function normalizeAssetMetadata(metadata) {
  const copy = cloneOwnData(metadata, "metadata");
  if (copy.schemaVersion !== 1 || !ASSET_KINDS.has(copy.kind)) invalid("metadata schema or kind is unsupported.");
  if (copy.kind === "image") {
    if (Object.keys(copy).sort().join(",") !== "kind,schemaVersion") invalid("image metadata has unknown fields.");
  } else if (copy.kind === "atlas_frame") {
    if (Object.keys(copy).sort().join(",") !== "atlasFrame,kind,schemaVersion") invalid("atlas metadata has unknown fields.");
    descriptorId(copy.atlasFrame, "metadata.atlasFrame");
  } else {
    if (Object.keys(copy).sort().join(",") !== "kind,nineSlice,schemaVersion") invalid("nine-slice metadata has unknown fields.");
    const borders = copy.nineSlice;
    if (borders === null || typeof borders !== "object" || Array.isArray(borders)
      || Object.keys(borders).sort().join(",") !== "bottom,left,right,top") invalid("metadata.nineSlice must contain four borders.");
    for (const side of ["top", "right", "bottom", "left"]) {
      if (!Number.isFinite(borders[side]) || borders[side] < 0 || borders[side] > 16_384) {
        invalid(`metadata.nineSlice.${side} must be a bounded non-negative number.`);
      }
    }
  }
  return copy;
}

export function createHudStudioDescriptorModel(descriptor) {
  const copy = cloneOwnData(descriptor, "descriptor");
  for (const key of ["components", "states", "layers"]) {
    if (!Array.isArray(copy[key]) || copy[key].some((item) => typeof item !== "string")) {
      invalid(`descriptor.${key} must be an array of strings.`);
    }
  }
  if (copy.selectors === null || typeof copy.selectors !== "object"
    || copy.actions === null || typeof copy.actions !== "object") {
    invalid("descriptor selectors and actions must be records.");
  }
  return deepFreeze(copy);
}

export function applyHudStudioComponentDraft(profile, draft) {
  const next = cloneProfile(profile);
  const input = cloneOwnData(draft, "draft");
  const nodeId = boundedId(input.nodeId, "draft.nodeId");
  if (input.component?.id !== nodeId) invalid("draft.component.id must match draft.nodeId.");
  const nodeIndex = next.commonNodes.findIndex((entry) => entry?.id === nodeId);
  if (nodeIndex < 0) invalid(`node "${nodeId}" does not exist.`);
  next.commonNodes[nodeIndex] = input.component;
  const variantId = boundedId(input.variantId, "draft.variantId");
  const variant = next.variants[variantId];
  if (!variant || !variant.layouts || !Object.hasOwn(variant.layouts, nodeId)) {
    invalid(`layout for node "${nodeId}" in variant "${variantId}" does not exist.`);
  }
  variant.layouts[nodeId] = input.layout;
  return deepFreeze(next);
}

export function upsertHudStudioTransitionCondition(profile, input) {
  const next = cloneProfile(profile);
  const draft = cloneOwnData(input, "input");
  const transition = findTransition(next, draft.transitionId);
  if (!Array.isArray(transition.conditions)) invalid("transition.conditions must be an array.");
  if (!Number.isSafeInteger(draft.index) || draft.index < 0 || draft.index > transition.conditions.length) {
    invalid("condition index is outside the ordered condition list.");
  }
  const condition = normalizeCondition(draft.condition);
  if (draft.index === transition.conditions.length) transition.conditions.push(condition);
  else transition.conditions[draft.index] = condition;
  return deepFreeze(next);
}

export function removeHudStudioTransitionCondition(profile, input) {
  const next = cloneProfile(profile);
  const draft = cloneOwnData(input, "input");
  const transition = findTransition(next, draft.transitionId);
  if (!Array.isArray(transition.conditions) || !Number.isSafeInteger(draft.index)
    || draft.index < 0 || draft.index >= transition.conditions.length) {
    invalid("condition index is outside the ordered condition list.");
  }
  transition.conditions.splice(draft.index, 1);
  return deepFreeze(next);
}

export function upsertHudStudioAssetRole(profile, input) {
  const next = cloneProfile(profile);
  const draft = cloneOwnData(input, "input");
  const roleId = boundedId(draft.roleId, "input.roleId");
  const spriteId = boundedId(draft.spriteId, "input.spriteId");
  if (!next.assetRoles || typeof next.assetRoles !== "object" || Array.isArray(next.assetRoles)) {
    invalid("profile.assetRoles must be a record.");
  }
  next.assetRoles[roleId] = spriteId;
  if (!next.assetMetadata) next.assetMetadata = Object.create(null);
  if (typeof next.assetMetadata !== "object" || Array.isArray(next.assetMetadata)) {
    invalid("profile.assetMetadata must be a record.");
  }
  next.assetMetadata[roleId] = normalizeAssetMetadata(draft.metadata);
  return deepFreeze(next);
}
