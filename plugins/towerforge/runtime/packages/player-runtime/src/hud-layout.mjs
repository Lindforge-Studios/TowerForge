import {
  HUD_CATALOG_LIMITS,
  HUD_COMPONENT_STATES,
  HUD_COMPONENT_TYPES,
  validateHudCatalogV1
} from "./hud-catalog.mjs";

export const HUD_LAYOUT_SCHEMA_VERSION = 1;
export const HUD_SELECTOR_DESCRIPTOR_SCHEMA_VERSION = 1;

const ACTION_DESCRIPTOR_SCHEMA_VERSION = 1;
const COMPONENT_STATE_SET = new Set(HUD_COMPONENT_STATES);
const COMPONENT_TYPE_SET = new Set(HUD_COMPONENT_TYPES);
const INTERACTIVE_TYPES = new Set([
  "button", "toggle", "slider", "select", "build_menu", "ability_bar", "radial_menu", "tile_popover"
]);
const SELECTOR_VALUE_TYPES = new Set(["boolean", "number", "string", "item"]);
const SELECTOR_CARDINALITIES = new Set(["one", "many"]);
const ACTION_KINDS = new Set(["ui", "command", "signal"]);

class HudLayoutValidationError extends TypeError {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "HudLayoutValidationError";
    this.fieldPath = path;
  }
}

function fail(path, message) {
  throw new HudLayoutValidationError(path, message);
}

function inspectRecord(value, path, expectedKeys = undefined) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an own-data object.");
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(path, "must be an inspectable own-data object.");
  }
  if (prototype !== Object.prototype && prototype !== null) fail(path, "must be a plain own-data object.");
  if (Object.getOwnPropertySymbols(descriptors).length > 0) fail(path, "cannot contain symbol keys.");
  const keys = Object.keys(descriptors).sort();
  if (expectedKeys) {
    const allowed = new Set(expectedKeys);
    for (const key of keys) if (!allowed.has(key)) fail(`${path}.${key}`, `unknown field "${key}".`);
    for (const key of expectedKeys) if (!Object.hasOwn(descriptors, key)) fail(`${path}.${key}`, "missing required field.");
  }
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) fail(`${path}.${key}`, "must be enumerable own data; accessors are forbidden.");
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

function inspectArray(value, path, limit) {
  if (!Array.isArray(value)) fail(path, "must be a dense own-data array.");
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(path, "must be an inspectable dense own-data array.");
  }
  if (prototype !== Array.prototype) fail(path, "must be a plain array.");
  if (Object.getOwnPropertySymbols(descriptors).length > 0) fail(path, "cannot contain symbol keys.");
  if (!Number.isSafeInteger(value.length) || value.length > limit) fail(path, `exceeds the limit of ${limit}.`);
  const keys = Object.keys(descriptors).filter((key) => key !== "length");
  if (keys.length !== value.length) fail(path, "must be dense and cannot contain extra fields.");
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail(`${path}[${index}]`, "must be enumerable own data.");
    result.push(descriptor.value);
  }
  return result;
}

function boundedDescriptorId(value, path) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value)) {
    fail(path, "must be a bounded descriptor identifier.");
  }
  return value;
}

function defineOwn(record, key, value) {
  Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true });
}

function deepClone(value, path, seen = new WeakSet(), depth = 0, budget = { count: 0 }) {
  if (depth > 8) fail(path, "exceeds detached data depth 8.");
  budget.count += 1;
  if (budget.count > 2048) fail(path, "exceeds detached data budget 2048.");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "must contain finite numbers.");
    return value;
  }
  if (typeof value !== "object") fail(path, "must contain JSON data only.");
  if (seen.has(value)) fail(path, "cannot contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) {
    const input = inspectArray(value, path, HUD_CATALOG_LIMITS.repeaterItemsPerScreen);
    const output = input.map((item, index) => deepClone(item, `${path}[${index}]`, seen, depth + 1, budget));
    seen.delete(value);
    return output;
  }
  const input = inspectRecord(value, path);
  const output = Object.create(null);
  for (const key of Object.keys(input).sort()) defineOwn(output, key, deepClone(input[key], `${path}.${key}`, seen, depth + 1, budget));
  seen.delete(value);
  return output;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function normalizeActionDescriptors(value) {
  const input = inspectArray(value, "options.availableActions", 256);
  const ids = new Set();
  for (let index = 0; index < input.length; index += 1) {
    const record = inspectRecord(input[index], `options.availableActions[${index}]`, ["schemaVersion", "id", "labelKey", "kind"]);
    if (record.schemaVersion !== ACTION_DESCRIPTOR_SCHEMA_VERSION) fail(`options.availableActions[${index}].schemaVersion`, "must be 1.");
    const id = boundedDescriptorId(record.id, `options.availableActions[${index}].id`);
    if (ids.has(id)) fail("options.availableActions", `duplicate action id "${id}".`);
    if (typeof record.labelKey !== "string" || record.labelKey.length < 1 || record.labelKey.length > 256) fail(`options.availableActions[${index}].labelKey`, "must be a bounded string.");
    if (!ACTION_KINDS.has(record.kind)) fail(`options.availableActions[${index}].kind`, "unsupported action kind.");
    ids.add(id);
  }
  return ids;
}

function normalizeSelectorDescriptors(value) {
  const input = inspectArray(value, "options.selectorDescriptors", 256);
  const map = new Map();
  for (let index = 0; index < input.length; index += 1) {
    const path = `options.selectorDescriptors[${index}]`;
    const record = inspectRecord(input[index], path, ["schemaVersion", "id", "valueType", "cardinality"]);
    if (record.schemaVersion !== HUD_SELECTOR_DESCRIPTOR_SCHEMA_VERSION) fail(`${path}.schemaVersion`, "must be 1.");
    const id = boundedDescriptorId(record.id, `${path}.id`);
    if (map.has(id)) fail("options.selectorDescriptors", `duplicate selector id "${id}".`);
    if (!SELECTOR_VALUE_TYPES.has(record.valueType)) fail(`${path}.valueType`, "unsupported selector value type.");
    if (!SELECTOR_CARDINALITIES.has(record.cardinality)) fail(`${path}.cardinality`, "unsupported selector cardinality.");
    map.set(id, Object.freeze({ valueType: record.valueType, cardinality: record.cardinality }));
  }
  return map;
}

function normalizeSafeArea(value) {
  const record = inspectRecord(value, "options.safeArea", ["top", "right", "bottom", "left"]);
  const result = {};
  for (const key of ["top", "right", "bottom", "left"]) {
    if (!Number.isFinite(record[key]) || record[key] < 0 || record[key] > 16384) fail(`options.safeArea.${key}`, "must be a bounded non-negative number.");
    result[key] = record[key];
  }
  return result;
}

function normalizeRuntimeState(value, selectorDescriptors) {
  const state = inspectRecord(value, "options.state", ["selectors", "nodeStates"]);
  const selectors = inspectRecord(state.selectors, "options.state.selectors");
  const detachedSelectors = Object.create(null);
  for (const id of Object.keys(selectors).sort()) {
    const descriptor = selectorDescriptors.get(id);
    if (!descriptor) fail(`options.state.selectors.${id}`, `selector "${id}" has no descriptor.`);
    const detached = deepClone(selectors[id], `options.state.selectors.${id}`);
    if (descriptor.cardinality === "many") {
      if (!Array.isArray(detached)) fail(`options.state.selectors.${id}`, "must be an array for cardinality many.");
      for (let index = 0; index < detached.length; index += 1) {
        validateSelectorValue(detached[index], descriptor.valueType, `options.state.selectors.${id}[${index}]`);
      }
    } else if (Array.isArray(detached)) {
      fail(`options.state.selectors.${id}`, "must be scalar for cardinality one.");
    } else {
      validateSelectorValue(detached, descriptor.valueType, `options.state.selectors.${id}`);
    }
    defineOwn(detachedSelectors, id, detached);
  }
  const nodeStates = inspectRecord(state.nodeStates, "options.state.nodeStates");
  const detachedNodeStates = Object.create(null);
  for (const id of Object.keys(nodeStates).sort()) {
    if (!COMPONENT_STATE_SET.has(nodeStates[id])) fail(`options.state.nodeStates.${id}`, `unsupported component state "${String(nodeStates[id])}".`);
    defineOwn(detachedNodeStates, id, nodeStates[id]);
  }
  return { selectors: detachedSelectors, nodeStates: detachedNodeStates };
}

function validateSelectorValue(value, valueType, path) {
  if (valueType === "number" && (typeof value !== "number" || !Number.isFinite(value))) fail(path, "must be a finite number.");
  if (valueType === "string" && typeof value !== "string") fail(path, "must be a string.");
  if (valueType === "boolean" && typeof value !== "boolean") fail(path, "must be a boolean.");
  if (valueType === "item" && (value === null || typeof value !== "object" || Array.isArray(value))) fail(path, "must be a detached item record.");
}

function selectVariant(profile, width) {
  if (width <= profile.breakpoints.mobileMax) return "mobile";
  if (width <= profile.breakpoints.tabletMax) return "tablet";
  return "desktop";
}

function createNodeOrder(profile, rootNodeIds) {
  const nodeMap = new Map(profile.commonNodes.map((node) => [node.id, node]));
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];
  function visit(id, depth) {
    if (!nodeMap.has(id)) fail("profile.commonNodes", `references missing node "${id}".`);
    if (depth > HUD_CATALOG_LIMITS.nestingDepth) fail("profile.commonNodes", `exceeds nesting depth ${HUD_CATALOG_LIMITS.nestingDepth}.`);
    if (visiting.has(id)) fail("profile.commonNodes", `contains a cycle at "${id}".`);
    if (visited.has(id)) return;
    visiting.add(id);
    visited.add(id);
    ordered.push(id);
    const node = nodeMap.get(id);
    for (const childId of node.childIds) visit(childId, depth + 1);
    if (node.properties.itemTemplateNodeId !== undefined) visit(node.properties.itemTemplateNodeId, depth + 1);
    visiting.delete(id);
  }
  for (const id of rootNodeIds) visit(id, 1);
  for (const id of [...nodeMap.keys()].sort()) visit(id, 1);
  return { ordered, nodeMap };
}

function buildParentMap(nodeMap) {
  const parents = new Map();
  for (const id of [...nodeMap.keys()].sort()) {
    for (const childId of nodeMap.get(id).childIds) {
      if (parents.has(childId)) fail("profile.commonNodes", `node "${childId}" cannot have multiple layout parents.`);
      parents.set(childId, id);
    }
  }
  return parents;
}

function anchoredRect(layout, viewportWidth, viewportHeight, safeRect) {
  const base = layout.safeArea ? safeRect : { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
  const width = Math.min(layout.size.maxWidth, Math.max(layout.size.minWidth, layout.size.width));
  const height = Math.min(layout.size.maxHeight, Math.max(layout.size.minHeight, layout.size.height));
  const { horizontal, vertical, offsetX, offsetY } = layout.placement;
  let x = base.x + offsetX;
  let y = base.y + offsetY;
  if (horizontal === "center") x = base.x + ((base.width - width) / 2) + offsetX;
  if (horizontal === "right") x = base.x + base.width - width - offsetX;
  if (vertical === "center") y = base.y + ((base.height - height) / 2) + offsetY;
  if (vertical === "bottom") y = base.y + base.height - height - offsetY;
  return { x, y, width: horizontal === "stretch" ? Math.max(layout.size.minWidth, base.width - Math.abs(offsetX) * 2) : width,
    height: vertical === "stretch" ? Math.max(layout.size.minHeight, base.height - Math.abs(offsetY) * 2) : height };
}

function flowRect(id, layout, parentId, rects, nodeMap, variantLayouts) {
  // Repeater templates are detached blueprints rather than visual children. They still carry a
  // flow record so a materialized item can reuse it later, but their compile-time plan has no
  // parent rectangle yet.
  if (!parentId) {
    return { x: 0, y: 0, width: layout.size.width, height: layout.size.height };
  }
  if (!rects.has(parentId)) fail(`profile.variant.layouts.${id}`, "flow placement requires a compiled parent.");
  const parentRect = rects.get(parentId);
  const parent = nodeMap.get(parentId);
  const siblings = parent.childIds
    .map((childId, authoredIndex) => ({ childId, authoredIndex, layout: variantLayouts[childId] }))
    .filter((entry) => entry.layout?.placement.kind === "flow")
    .sort((a, b) => a.layout.placement.order - b.layout.placement.order || a.authoredIndex - b.authoredIndex || a.childId.localeCompare(b.childId));
  const axis = parent.type === "stack" && parent.properties.axis === "vertical" ? "vertical" : "horizontal";
  const gap = Number.isFinite(parent.properties.gap) ? Math.max(0, Math.min(1024, parent.properties.gap)) : 0;
  let cursor = axis === "horizontal" ? parentRect.x : parentRect.y;
  for (const sibling of siblings) {
    const siblingSize = sibling.layout.size;
    const width = Math.min(siblingSize.maxWidth, Math.max(siblingSize.minWidth, siblingSize.width));
    const height = Math.min(siblingSize.maxHeight, Math.max(siblingSize.minHeight, siblingSize.height));
    if (sibling.childId === id) {
      return {
        x: axis === "horizontal" ? cursor : parentRect.x,
        y: axis === "vertical" ? cursor : parentRect.y + ((parentRect.height - height) / 2),
        width,
        height
      };
    }
    cursor += (axis === "horizontal" ? width : height) + gap;
  }
  fail(`profile.variant.layouts.${id}`, "flow node is not an authored child of its parent.");
}

function fallbackContainerRect(layout, parentId, rects, viewportWidth, viewportHeight, safeRect) {
  if (parentId && rects.has(parentId)) {
    const parent = rects.get(parentId);
    return { x: parent.x, y: parent.y, width: layout.size.width, height: layout.size.height };
  }
  return anchoredRect({ ...layout, placement: { kind: "anchor", horizontal: "left", vertical: "top", offsetX: 0, offsetY: 0 } }, viewportWidth, viewportHeight, safeRect);
}

function placementBase(layout, parentId, rects, viewportWidth, viewportHeight, safeRect) {
  if (parentId) {
    if (!rects.has(parentId)) fail("profile.variant.layouts", "container placement requires a compiled parent.");
    return rects.get(parentId);
  }
  return layout.safeArea
    ? safeRect
    : { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
}

function dockRect(layout, parentId, rects, viewportWidth, viewportHeight, safeRect) {
  const base = placementBase(layout, parentId, rects, viewportWidth, viewportHeight, safeRect);
  const { edge, offset } = layout.placement;
  const width = Math.min(layout.size.maxWidth, Math.max(layout.size.minWidth, layout.size.width));
  const height = Math.min(layout.size.maxHeight, Math.max(layout.size.minHeight, layout.size.height));
  if (edge === "fill") return {
    x: base.x + offset, y: base.y + offset,
    width: Math.max(0, base.width - (offset * 2)), height: Math.max(0, base.height - (offset * 2))
  };
  if (edge === "right") return { x: base.x + base.width - width - offset, y: base.y, width, height };
  if (edge === "bottom") return { x: base.x, y: base.y + base.height - height - offset, width, height };
  if (edge === "left") return { x: base.x + offset, y: base.y, width, height };
  return { x: base.x, y: base.y + offset, width, height };
}

function gridRect(id, layout, parentId, rects, nodeMap) {
  if (!parentId || !rects.has(parentId)) fail(`profile.variant.layouts.${id}`, "grid placement requires a compiled parent.");
  const parent = nodeMap.get(parentId);
  if (parent?.type !== "grid") fail(`profile.variant.layouts.${id}`, "grid placement requires a grid parent.");
  const columns = Number.isSafeInteger(parent.properties.columns) && parent.properties.columns > 0 ? parent.properties.columns : 1;
  const rows = Number.isSafeInteger(parent.properties.rows) && parent.properties.rows > 0 ? parent.properties.rows : 1;
  const gap = Number.isFinite(parent.properties.gap) ? Math.max(0, Math.min(1024, parent.properties.gap)) : 0;
  const { row, column, rowSpan, columnSpan } = layout.placement;
  if (row >= rows || column >= columns || row + rowSpan > rows || column + columnSpan > columns) {
    fail(`profile.variant.layouts.${id}.placement`, "grid cell lies outside the parent grid.");
  }
  const base = rects.get(parentId);
  const cellWidth = (base.width - gap * (columns - 1)) / columns;
  const cellHeight = (base.height - gap * (rows - 1)) / rows;
  return {
    x: base.x + column * (cellWidth + gap),
    y: base.y + row * (cellHeight + gap),
    width: cellWidth * columnSpan + gap * (columnSpan - 1),
    height: cellHeight * rowSpan + gap * (rowSpan - 1)
  };
}

function validateNodeBindings(node, actionIds, selectorDescriptors, runtimeState) {
  const data = Object.create(null);
  for (const binding of node.bindings.data) {
    if (!selectorDescriptors.has(binding.selectorId)) fail(`node.${node.id}.bindings.data`, `unknown selector "${binding.selectorId}".`);
    if (Object.hasOwn(data, binding.slot)) fail(`node.${node.id}.bindings.data`, `duplicate slot "${binding.slot}".`);
    if (!Object.hasOwn(runtimeState.selectors, binding.selectorId)) fail(`options.state.selectors`, `missing selector value "${binding.selectorId}".`);
    defineOwn(data, binding.slot, deepClone(runtimeState.selectors[binding.selectorId], `node.${node.id}.data.${binding.slot}`));
  }
  const actions = node.bindings.actions.map((binding) => {
    if (!actionIds.has(binding.actionId)) fail(`node.${node.id}.bindings.actions`, `unknown action "${binding.actionId}".`);
    return {
      event: binding.event,
      actionId: binding.actionId,
      payload: deepClone(binding.payload, `node.${node.id}.actions.${binding.actionId}`)
    };
  });
  return { data, actions };
}

function materializeCollection(node, selectorDescriptors, runtimeState) {
  if (!["build_menu", "radial_menu", "repeater"].includes(node.type)) return undefined;
  const selectorId = node.properties.selectorId;
  if (typeof selectorId !== "string" || !selectorDescriptors.has(selectorId)) fail(`node.${node.id}.properties.selectorId`, "must reference an available selector.");
  if (selectorDescriptors.get(selectorId).cardinality !== "many") fail(`node.${node.id}.properties.selectorId`, "must reference a many selector.");
  if (!Object.hasOwn(runtimeState.selectors, selectorId)) fail(`options.state.selectors`, `missing selector value "${selectorId}".`);
  const source = runtimeState.selectors[selectorId];
  if (!Array.isArray(source)) fail(`options.state.selectors.${selectorId}`, "must be an array.");
  if (source.length > HUD_CATALOG_LIMITS.repeaterItemsPerScreen) fail(`options.state.selectors.${selectorId}`, `exceeds ${HUD_CATALOG_LIMITS.repeaterItemsPerScreen} items.`);
  let maximum = source.length;
  if (node.type === "radial_menu") {
    maximum = node.properties.maxVisibleItems;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > HUD_CATALOG_LIMITS.visibleRadialItems) {
      fail(`node.${node.id}.properties.maxVisibleItems`, `must be between 1 and ${HUD_CATALOG_LIMITS.visibleRadialItems}.`);
    }
  }
  if (node.type === "repeater") {
    maximum = node.properties.maxItems;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > HUD_CATALOG_LIMITS.repeaterItemsPerScreen) {
      fail(`node.${node.id}.properties.maxItems`, `must be between 1 and ${HUD_CATALOG_LIMITS.repeaterItemsPerScreen}.`);
    }
  }
  return source.slice(0, maximum).map((item, index) => deepClone(item, `node.${node.id}.collection[${index}]`));
}

export function compileHudLayoutV1(profileValue, optionsValue) {
  try {
    const options = inspectRecord(optionsValue, "options", [
      "viewportWidth", "viewportHeight", "safeArea", "availableActions", "selectorDescriptors", "state"
    ]);
    if (!Number.isFinite(options.viewportWidth) || options.viewportWidth <= 0 || options.viewportWidth > 16384) fail("options.viewportWidth", "must be a finite positive number no greater than 16384.");
    if (!Number.isFinite(options.viewportHeight) || options.viewportHeight <= 0 || options.viewportHeight > 16384) fail("options.viewportHeight", "must be a finite positive number no greater than 16384.");
    const safeArea = normalizeSafeArea(options.safeArea);
    if (safeArea.left + safeArea.right >= options.viewportWidth || safeArea.top + safeArea.bottom >= options.viewportHeight) fail("options.safeArea", "must leave a positive safe rectangle.");
    const actionIds = normalizeActionDescriptors(options.availableActions);
    const selectorDescriptors = normalizeSelectorDescriptors(options.selectorDescriptors);
    const runtimeState = normalizeRuntimeState(options.state, selectorDescriptors);

    const validation = validateHudCatalogV1({ schemaVersion: 1, profiles: { active: profileValue } });
    if (!validation.ok) throw validation.error;
    const profile = validation.catalog.profiles.active;
    for (const node of profile.commonNodes) {
      if (!COMPONENT_TYPE_SET.has(node.type) || !Object.hasOwn(node, "schemaVersion")) fail(`profile.commonNodes.${node.id}`, "must use the R21.2 typed component shape.");
    }
    const variantId = selectVariant(profile, options.viewportWidth);
    const variant = profile.variants[variantId];
    if (!Object.hasOwn(variant, "layouts")) fail(`profile.variants.${variantId}.layouts`, "is required for layout compilation.");
    const { ordered, nodeMap } = createNodeOrder(profile, variant.rootNodeIds);
    for (const layoutId of Object.keys(variant.layouts)) {
      if (!nodeMap.has(layoutId)) fail(`profile.variants.${variantId}.layouts.${layoutId}`, "does not reference an authored node.");
    }
    for (const stateNodeId of Object.keys(runtimeState.nodeStates)) {
      if (!nodeMap.has(stateNodeId)) fail(`options.state.nodeStates.${stateNodeId}`, "does not reference an authored node.");
    }
    const parentMap = buildParentMap(nodeMap);
    const safeRect = {
      x: safeArea.left,
      y: safeArea.top,
      width: options.viewportWidth - safeArea.left - safeArea.right,
      height: options.viewportHeight - safeArea.top - safeArea.bottom
    };
    const rects = new Map();
    const nodes = [];
    const diagnostics = [];
    for (const id of ordered) {
      const node = nodeMap.get(id);
      const layout = variant.layouts[id];
      if (!layout) fail(`profile.variants.${variantId}.layouts.${id}`, "missing layout record.");
      const parentId = parentMap.get(id);
      let rect;
      if (layout.placement.kind === "anchor") rect = anchoredRect(layout, options.viewportWidth, options.viewportHeight, safeRect);
      else if (layout.placement.kind === "flow") rect = flowRect(id, layout, parentId, rects, nodeMap, variant.layouts);
      else if (layout.placement.kind === "dock") rect = dockRect(layout, parentId, rects, options.viewportWidth, options.viewportHeight, safeRect);
      else if (layout.placement.kind === "grid") rect = gridRect(id, layout, parentId, rects, nodeMap);
      else rect = fallbackContainerRect(layout, parentId, rects, options.viewportWidth, options.viewportHeight, safeRect);
      rects.set(id, rect);
      const selectedState = Object.hasOwn(runtimeState.nodeStates, id) ? runtimeState.nodeStates[id] : "normal";
      if (!Object.hasOwn(node.states, selectedState)) fail(`options.state.nodeStates.${id}`, `state "${selectedState}" is not authored for node "${id}".`);
      const bindings = validateNodeBindings(node, actionIds, selectorDescriptors, runtimeState);
      const collection = materializeCollection(node, selectorDescriptors, runtimeState);
      if (INTERACTIVE_TYPES.has(node.type) && (rect.width < 44 || rect.height < 44)) {
        diagnostics.push({ severity: "error", code: "interactive_target_below_44", nodeId: id });
      }
      const planNode = {
        schemaVersion: HUD_LAYOUT_SCHEMA_VERSION,
        id,
        type: node.type,
        parentId: parentId ?? null,
        childIds: [...node.childIds],
        layer: layout.layer,
        rect,
        properties: deepClone(node.properties, `node.${id}.properties`),
        data: bindings.data,
        actions: bindings.actions,
        state: selectedState,
        stateConfig: deepClone(node.states[selectedState], `node.${id}.states.${selectedState}`)
      };
      if (collection !== undefined) planNode.collection = collection;
      nodes.push(planNode);
    }
    diagnostics.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.code.localeCompare(b.code));
    const plan = {
      schemaVersion: HUD_LAYOUT_SCHEMA_VERSION,
      variantId,
      viewport: { width: options.viewportWidth, height: options.viewportHeight },
      safeRect,
      rootNodeIds: [...variant.rootNodeIds],
      nodes,
      diagnostics
    };
    return Object.freeze({ ok: true, plan: deepFreeze(plan) });
  } catch (error) {
    return Object.freeze({
      ok: false,
      error: error instanceof Error ? error : new HudLayoutValidationError("layout", "compilation failed closed.")
    });
  }
}
