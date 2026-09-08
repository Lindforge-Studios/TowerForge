// Browser adapter only: relocate existing controls; gameplay and storage stay in their owners.
export function mountResponsivePlayerShell({ document, window, text }) {
  const make = (tag, id, parent) => {
    const node = document.createElement(tag);
    node.id = id;
    parent.append(node);
    return node;
  };
  const status = make("header", "responsive-status", document.body);
  status.setAttribute("aria-label", text("battleStatus"));
  const actions = make("nav", "responsive-actions", document.body);
  actions.setAttribute("aria-label", text("battleActions"));
  const menu = make("section", "responsive-menu", document.body);
  menu.className = "desktop-dialog";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-modal", "true");
  menu.setAttribute("aria-label", text("moreActions"));
  menu.hidden = true;
  const card = make("div", "responsive-menu-card", menu);
  const close = make("button", "responsive-menu-close", card);
  close.type = "button";
  close.textContent = text("close");
  const secondary = make("div", "responsive-menu-actions", card);
  const more = make("button", "responsive-more", status);
  more.type = "button";
  more.textContent = text("moreActions");
  more.setAttribute("aria-expanded", "false");
  more.setAttribute("aria-controls", menu.id);
  const placements = [];
  const move = (node, parent, before = null) => {
    if (!node) return;
    const anchor = document.createComment("responsive-control");
    node.before(anchor);
    placements.push({ node, anchor });
    parent.insertBefore(node, before);
  };
  const closeMenu = (restoreFocus = true) => {
    menu.hidden = true;
    more.setAttribute("aria-expanded", "false");
    if (restoreFocus) more.focus();
  };
  more.addEventListener("click", () => {
    menu.hidden = false;
    more.setAttribute("aria-expanded", "true");
    close.focus();
  });
  close.addEventListener("click", () => closeMenu());
  menu.addEventListener("click", event => { if (event.target === menu) closeMenu(); });
  secondary.addEventListener("click", event => {
    if (event.target.closest("button")) closeMenu(false);
  });
  const onKey = event => {
    if (menu.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closeMenu(); }
    if (event.key !== "Tab") return;
    const focusable = [...menu.querySelectorAll("button, select, input, [tabindex='0']")]
      .filter(node => !node.disabled && node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  window.addEventListener("keydown", onKey, true);
  const media = window.matchMedia("(max-width: 900px)");
  let compact = false;
  const update = () => {
    if (compact === media.matches) { status.hidden = actions.hidden = !compact; return; }
    compact = media.matches;
    if (compact) {
      document.body.setAttribute("data-towerforge-responsive", "");
      for (const id of ["stat-core", "stat-resources", "stat-wave"]) move(document.getElementById(id)?.parentElement, status, more);
      move(document.getElementById("pause-run"), status, more);
      move(document.getElementById("tower-select")?.parentElement, actions);
      for (const id of ["start-wave", "sell-mode", "desktop-upgrade"]) move(document.getElementById(id), actions);
      for (const id of ["mission-select", "difficulty-select"]) move(document.getElementById(id)?.parentElement, secondary);
      for (const id of ["desktop-continue", "desktop-settings", "desktop-reset-view", "desktop-fullscreen", "reset-run", "reset-progress"]) move(document.getElementById(id), secondary);
      move(document.querySelector(".play-shell > .panel"), card);
    } else {
      closeMenu(false);
      for (const { node, anchor } of placements.splice(0).reverse()) { anchor.replaceWith(node); }
      document.body.removeAttribute("data-towerforge-responsive");
    }
    status.hidden = actions.hidden = !compact;
    window.dispatchEvent(new Event("resize"));
  };
  media.addEventListener("change", update);
  update();
  return Object.freeze({ dispose() {
    media.removeEventListener("change", update);
    window.removeEventListener("keydown", onKey, true);
    for (const { node, anchor } of placements.splice(0).reverse()) anchor.replaceWith(node);
    document.body.removeAttribute("data-towerforge-responsive");
    status.remove(); actions.remove(); menu.remove();
  } });
}

export const RESPONSIVE_PLAYER_CSS = `
#responsive-status[hidden],#responsive-actions[hidden]{display:none}
body[data-towerforge-responsive]{overflow:hidden;height:100dvh}
body[data-towerforge-responsive] #app,body[data-towerforge-responsive] .play-shell{height:100dvh;min-height:0}
body[data-towerforge-responsive] #playfield{top:calc(66px + env(safe-area-inset-top));bottom:calc(112px + env(safe-area-inset-bottom));height:calc(100dvh - 178px - env(safe-area-inset-top) - env(safe-area-inset-bottom))}
body[data-towerforge-responsive] .hud,body[data-towerforge-responsive] .desktop-action-bar{display:none}
#responsive-status{position:fixed;z-index:10;top:0;left:0;right:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr) auto auto;align-items:center;gap:4px;padding:calc(6px + env(safe-area-inset-top)) max(6px,env(safe-area-inset-right)) 6px max(6px,env(safe-area-inset-left));background:#111b16;border-bottom:1px solid var(--border)}
#responsive-status .stat{display:grid;gap:3px;min-width:0;padding:0;border:0;font-size:11px}
#responsive-status .stat strong{font-size:14px;overflow-wrap:anywhere}
#responsive-status button{padding:6px;min-width:44px;min-height:44px;font-size:12px}
#responsive-actions{position:fixed;z-index:10;bottom:0;left:0;right:0;display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:6px;padding:6px max(6px,env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) max(6px,env(safe-area-inset-left));background:#111b16;border-top:1px solid var(--border)}
#responsive-actions label{grid-column:1/-1;display:flex;align-items:center;gap:8px;font-size:12px;min-width:0}
#responsive-actions select{flex:1;min-width:0;appearance:none;-webkit-appearance:none;height:44px}
#responsive-actions button,#responsive-actions select{min-height:44px;min-width:44px;padding:6px;font-size:13px}
#responsive-menu{z-index:39;padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left))}
#responsive-menu-card{width:min(520px,100%);max-height:100%;overflow:auto;background:var(--surface);padding:12px;border:1px solid var(--border);border-radius:10px}
#responsive-menu-close{display:block;margin:0 0 12px auto}
#responsive-menu-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#responsive-menu-actions label{display:grid;gap:4px;min-width:0}
#responsive-menu select{min-width:0;width:100%}
#responsive-menu button,#responsive-menu select,#responsive-menu input{min-width:44px;min-height:44px}
body[data-towerforge-responsive] #responsive-menu .panel{position:static;width:100%;max-height:none;overflow:visible;display:grid;grid-template-columns:1fr 1fr;margin-top:12px;box-shadow:none}
@media(max-width:900px) and (orientation:landscape){body[data-towerforge-responsive] #playfield{bottom:calc(62px + env(safe-area-inset-bottom));height:calc(100dvh - 128px - env(safe-area-inset-top) - env(safe-area-inset-bottom))}#responsive-actions{grid-template-columns:minmax(160px,2fr) 1fr 1fr 1fr}#responsive-actions label{grid-column:auto}#responsive-status{grid-template-columns:1fr 1.3fr 1fr auto auto}}
`;
