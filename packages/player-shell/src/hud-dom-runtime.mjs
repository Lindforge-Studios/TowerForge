import { compileHudLayoutV1 } from "../../player-runtime/src/hud-layout.mjs";
import { createHudScreenGraphSessionV1 } from "../../player-runtime/src/hud-screen-graph.mjs";

export const HUD_DOM_RUNTIME_SCHEMA_VERSION = 1;

const TAG_BY_TYPE = Object.freeze({
  button: "button", toggle: "button", slider: "input", select: "select",
  image: "img", icon: "img", progress_bar: "progress", drawer: "section",
  modal: "section", panel: "section", nine_slice: "section"
});
const INPUT_FAMILIES = new Set(["pointer", "keyboard", "gamepad", "touch"]);
const COLLECTION_ACTION_EVENTS = new Set(["select", "activate"]);

/** Browser-only semantic adapter. Layout, navigation and action validation stay in player-runtime. */
export function createHudDomRuntimeV1(options) {
  if (!options || typeof options !== "object" || !options.document || !options.root) {
    throw new TypeError("HUD DOM runtime requires an explicit document and root.");
  }
  const { document, root, catalog, profileId } = options;
  const profile = catalog?.profiles?.[profileId];
  const graph = createHudScreenGraphSessionV1(profile, {
    selectorDescriptors: options.selectorDescriptors ?? [],
    state: { selectors: options.state?.selectors ?? {} }
  });
  let disposed = false;
  let currentState = options.state ?? { selectors: {}, nodeStates: {} };
  let currentPlan = null;

  function activateCollectionItem(request) {
    if (disposed) return Object.freeze({ ok: false, code: "hud_disposed" });
    if (!request || typeof request !== "object" || !INPUT_FAMILIES.has(request.inputFamily)) {
      return Object.freeze({ ok: false, code: "hud_input_family_not_allowed" });
    }
    const node = currentPlan?.nodes.find((entry) => entry.id === request.nodeId);
    if (!node || !Array.isArray(node.collection)) {
      return Object.freeze({ ok: false, code: "hud_collection_not_found" });
    }
    const index = node.collection.findIndex((item) => item?.id === request.itemId);
    if (index < 0) return Object.freeze({ ok: false, code: "hud_collection_item_not_found" });
    const item = node.collection[index];
    if (item?.enabled === false || item?.visible === false || node.stateConfig.enabled === false || node.stateConfig.visible === false) {
      return Object.freeze({ ok: false, code: "hud_collection_item_unavailable" });
    }
    const binding = node.actions.find((entry) => COLLECTION_ACTION_EVENTS.has(entry.event));
    if (!binding) return Object.freeze({ ok: false, code: "hud_collection_action_unavailable" });
    const payload = Object.freeze({ ...binding.payload, slotId: request.itemId, index });
    options.actionRegistry?.invoke(binding.actionId, payload);
    return Object.freeze({ ok: true, actionId: binding.actionId, payload });
  }

  function render(next = {}) {
    if (disposed) return Object.freeze({ ok: false, code: "hud_disposed" });
    const viewportWidth = next.viewportWidth ?? options.viewportWidth ?? root.clientWidth ?? 1920;
    const viewportHeight = next.viewportHeight ?? options.viewportHeight ?? root.clientHeight ?? 1080;
    if (Object.hasOwn(next, "state")) currentState = next.state;
    const state = currentState;
    const compiled = compileHudLayoutV1(profile, {
      viewportWidth,
      viewportHeight,
      safeArea: next.safeArea ?? options.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 },
      availableActions: options.availableActions ?? [],
      selectorDescriptors: options.selectorDescriptors ?? [],
      state
    });
    root.replaceChildren();
    root.dataset.towerforgeHudProfile = profileId;
    root.dataset.towerforgeHudScreen = graph.snapshot().currentScreenId;
    if (!compiled.ok) {
      currentPlan = null;
      renderRecovery(document, root, compiled.error);
      return Object.freeze({ ok: false, error: compiled.error });
    }
    currentPlan = compiled.plan;
    const screenId = graph.snapshot().currentScreenId;
    const screen = profile.screens?.[screenId];
    const visible = new Set(screen?.rootNodeIds ?? compiled.plan.rootNodeIds);
    const byId = new Map();
    const planById = new Map(compiled.plan.nodes.map((node) => [node.id, node]));
    for (const node of compiled.plan.nodes) {
      const element = createNode(document, node, options, activateCollectionItem);
      byId.set(node.id, element);
      if (!node.parentId && !visible.has(node.id)) element.hidden = true;
      if (node.parentId && byId.has(node.parentId)) {
        const parentNode = planById.get(node.parentId);
        element.style.left = `${node.rect.x - parentNode.rect.x}px`;
        element.style.top = `${node.rect.y - parentNode.rect.y}px`;
        byId.get(node.parentId).append(element);
      }
      else root.append(element);
    }
    return Object.freeze({ ok: true, plan: compiled.plan, screen: graph.snapshot() });
  }

  return Object.freeze({
    schemaVersion: HUD_DOM_RUNTIME_SCHEMA_VERSION,
    render,
    dispatch(event, selectorState = undefined) {
      const selectors = selectorState ?? currentState.selectors;
      const result = graph.dispatch(event, { selectors });
      if (result.ok) {
        currentState = { ...currentState, selectors };
      }
      render();
      return result;
    },
    activateCollectionItem,
    snapshot: graph.snapshot,
    dispose() { disposed = true; root.replaceChildren(); }
  });
}

function createNode(document, node, options, activateCollectionItem) {
  const tag = TAG_BY_TYPE[node.type] ?? (node.type === "text" || node.type === "localized_text" ? "span" : "div");
  const element = document.createElement(tag);
  element.dataset.hudNodeId = node.id;
  element.dataset.hudComponent = node.type;
  element.dataset.hudLayer = node.layer;
  element.dataset.hudState = node.state;
  element.style.position = "absolute";
  element.style.left = `${node.rect.x}px`;
  element.style.top = `${node.rect.y}px`;
  element.style.width = `${node.rect.width}px`;
  element.style.height = `${node.rect.height}px`;
  const label = node.properties.labelKey ?? node.properties.messageId ?? node.properties.text ?? node.id;
  if (tag === "img") {
    element.alt = String(node.properties.altKey ?? label);
    const assetId = node.properties.assetId;
    if (typeof assetId === "string") {
      const asset = options.resolveAsset?.(assetId);
      if (typeof asset === "string") element.src = asset;
      else if (asset && typeof asset === "object" && typeof asset.src === "string") {
        element.src = asset.src;
        if (asset.frame) {
          element.style.objectFit = "none";
          element.style.objectPosition = `${-asset.frame.x}px ${-asset.frame.y}px`;
        }
      } else element.src = "";
    }
  } else if (tag === "input" && node.type === "slider") {
    element.type = "range";
  } else {
    element.textContent = String(options.localize?.(label) ?? label);
  }
  applyBoundData(element, node, options);
  element.hidden = node.stateConfig.visible === false || node.data.visible === false;
  if ("disabled" in element) element.disabled = node.stateConfig.enabled === false || node.data.enabled === false;
  for (const binding of node.actions) {
    const eventName = binding.event === "activate" ? "click" : "change";
    element.addEventListener(eventName, () => options.actionRegistry?.invoke(binding.actionId, binding.payload));
  }
  materializeCollection(document, element, node, options, activateCollectionItem);
  return element;
}

function applyBoundData(element, node, options) {
  const value = node.data.value;
  if (node.type === "progress_bar") {
    element.min = finiteOr(node.data.min, finiteOr(node.properties.min, 0));
    element.max = finiteOr(node.data.max, finiteOr(node.properties.max, 1));
    element.value = finiteOr(value, element.min);
    return;
  }
  if (node.type === "slider") {
    element.min = finiteOr(node.data.min, finiteOr(node.properties.min, 0));
    element.max = finiteOr(node.data.max, finiteOr(node.properties.max, 100));
    element.value = finiteOr(value, element.min);
    return;
  }
  if (node.type === "toggle" && typeof value === "boolean") {
    element.setAttribute("aria-pressed", String(value));
  }
  const displayValue = node.data.text ?? node.data.label ?? value;
  if (["string", "number", "boolean"].includes(typeof displayValue)) {
    element.textContent = String(options.localize?.(displayValue) ?? displayValue);
  }
}

function finiteOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function materializeCollection(document, parent, node, options, activateCollectionItem) {
  if (!Array.isArray(node.collection)) return;
  node.collection.forEach((item, index) => {
    const control = document.createElement("button");
    const itemId = typeof item?.id === "string" ? item.id : String(index);
    control.type = "button";
    control.dataset.hudCollectionNodeId = node.id;
    control.dataset.hudCollectionItemId = itemId;
    control.dataset.hudCollectionIndex = String(index);
    const label = item?.labelKey ?? item?.label ?? item?.name ?? itemId;
    control.textContent = String(options.localize?.(label) ?? label);
    control.hidden = item?.visible === false;
    control.disabled = item?.enabled === false;
    control.addEventListener("click", (event) => {
      event?.stopPropagation?.();
      activateCollectionItem({
      nodeId: node.id,
      itemId,
      inputFamily: "pointer"
      });
    });
    parent.append(control);
  });
}

function renderRecovery(document, root, error) {
  const overlay = document.createElement("section");
  overlay.dataset.hudSystemRecovery = "true";
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  const heading = document.createElement("h2");
  heading.textContent = "Interface unavailable";
  const message = document.createElement("p");
  message.textContent = error instanceof Error ? error.message : "The authored HUD could not be rendered.";
  overlay.append(heading, message);
  root.append(overlay);
}
