import { compileHudLayoutV1 } from "../../player-runtime/src/hud-layout.mjs";
import { createHudScreenGraphSessionV1 } from "../../player-runtime/src/hud-screen-graph.mjs";

export const HUD_DOM_RUNTIME_SCHEMA_VERSION = 1;

const TAG_BY_TYPE = Object.freeze({
  button: "button", toggle: "button", slider: "input", select: "select",
  image: "img", icon: "img", progress_bar: "progress", drawer: "section",
  modal: "section", panel: "section", nine_slice: "section"
});

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

  function render(next = {}) {
    if (disposed) return Object.freeze({ ok: false, code: "hud_disposed" });
    const viewportWidth = next.viewportWidth ?? options.viewportWidth ?? root.clientWidth ?? 1920;
    const viewportHeight = next.viewportHeight ?? options.viewportHeight ?? root.clientHeight ?? 1080;
    const state = next.state ?? options.state ?? { selectors: {}, nodeStates: {} };
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
      renderRecovery(document, root, compiled.error);
      return Object.freeze({ ok: false, error: compiled.error });
    }
    const screenId = graph.snapshot().currentScreenId;
    const screen = profile.screens?.[screenId];
    const visible = new Set(screen?.rootNodeIds ?? compiled.plan.rootNodeIds);
    const byId = new Map();
    for (const node of compiled.plan.nodes) {
      const element = createNode(document, node, options);
      byId.set(node.id, element);
      if (!node.parentId && !visible.has(node.id)) element.hidden = true;
      if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).append(element);
      else root.append(element);
    }
    return Object.freeze({ ok: true, plan: compiled.plan, screen: graph.snapshot() });
  }

  return Object.freeze({
    schemaVersion: HUD_DOM_RUNTIME_SCHEMA_VERSION,
    render,
    dispatch(event, selectorState = {}) {
      const result = graph.dispatch(event, selectorState);
      render({ state: options.state });
      return result;
    },
    snapshot: graph.snapshot,
    dispose() { disposed = true; root.replaceChildren(); }
  });
}

function createNode(document, node, options) {
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
    if (typeof assetId === "string") element.src = options.resolveAsset?.(assetId) ?? "";
  } else if (tag === "input" && node.type === "slider") {
    element.type = "range";
  } else {
    element.textContent = String(options.localize?.(label) ?? label);
  }
  element.hidden = node.stateConfig.visible === false;
  if ("disabled" in element) element.disabled = node.stateConfig.enabled === false;
  for (const binding of node.actions) {
    const eventName = binding.event === "activate" ? "click" : "change";
    element.addEventListener(eventName, () => options.actionRegistry?.invoke(binding.actionId, binding.payload));
  }
  return element;
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
