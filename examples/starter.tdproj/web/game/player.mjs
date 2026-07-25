import {
  createEmptyPlayerProfile,
  createGameContentRegistry,
  getPlayerProfileLaunchOptions,
  isPlayerMissionUnlocked,
  parsePlayerProfileJson,
  purchasePlayerMetaUpgrade,
  recordPlayerMissionClear,
  selectPlayerDifficulty,
  serializePlayerProfile,
  TowerDefenseGame
} from "./engine/index.js";
import { createPlayerProfileStore, derivePlayerProfileStorageKey } from "./player-runtime/index.mjs";
import { createCanvasRenderer, projectElevationCues, projectNavigationPlacementCues } from "./renderer/index.mjs";
import { createAudioPlayer } from "./renderer/audio.mjs";
import project from "./project-data.js";

const content = createGameContentRegistry({
  balance: project.balance,
  maps: project.maps,
  worldMap: project.worldMap,
  scripts: project.scripts,
  mechanics: project.mechanics,
  visuals: project.visuals,
  storyComics: project.storyComics,
  battleBackgrounds: project.battleBackgrounds
});

// TOWERFORGE_PROFILE_RUNTIME_BEGIN
const playerProfileCodec = Object.freeze({
  createEmptyPlayerProfile,
  parsePlayerProfileJson,
  serializePlayerProfile
});
const playerProfileKey = derivePlayerProfileStorageKey({
  appId: project.buildTarget && project.buildTarget.appId,
  manifestName: project.manifest && project.manifest.name
});
const playerProfileScope = playerProfileKey.slice("towerforge:progress:".length);

function createBrowserProfileStoragePort() {
  let storage;
  try { storage = globalThis.localStorage; } catch { return undefined; }
  if (!storage) return undefined;
  return Object.freeze({
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key)
  });
}

const playerProfileStore = createPlayerProfileStore({
  storage: createBrowserProfileStoragePort(),
  key: playerProfileKey,
  content,
  codec: playerProfileCodec
});
const playerProfileLoadResult = playerProfileStore.load();
let progress = playerProfileLoadResult.profile;
let playerProfileStorageWarning = profileStorageWarningFor(playerProfileLoadResult.code);

function profileStorageWarningFor(code) {
  if (code === "profile_version_unsupported") return "Saved progress belongs to a newer game version; session changes will not overwrite it.";
  if (code === "profile_corrupt") return "Saved progress could not be loaded; this session uses a safe profile.";
  if (code === "storage_unavailable" || code === "storage_read_failed" || code === "storage_write_failed" || code === "storage_remove_failed") {
    return "Progress storage is unavailable; changes remain available for this session only.";
  }
  return "";
}

function rememberProfileStorageResult(result) {
  playerProfileStorageWarning = profileStorageWarningFor(result && result.code);
  return result;
}

function playerProfileStatusText(text) {
  return playerProfileStorageWarning ? String(text || "") + " " + playerProfileStorageWarning : String(text || "");
}

function persistPlayerProfile() {
  return rememberProfileStorageResult(playerProfileStore.save(progress));
}

function currentPlayerLaunchOptions() {
  return getPlayerProfileLaunchOptions(progress);
}

function profileRecordNumber(record, id) {
  if (!record || !Object.prototype.hasOwnProperty.call(record, id)) return 0;
  const value = record[id];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isUnlocked(id) {
  return isPlayerMissionUnlocked(progress, content, id);
}

function metaCostText(cost) {
  return Object.entries(cost || {}).map(([id, amount]) => amount + " " + ((content.metaProgression.currencies || []).find((item) => item.id === id)?.label || id)).join(" · ");
}

function buyMetaUpgrade(id) {
  const result = purchasePlayerMetaUpgrade(progress, content, id);
  if (!result.ok) {
    message = result.code === "insufficient_meta_resources"
      ? "Not enough permanent currency."
      : result.code === "upgrade_max_level" ? "Upgrade is at max level." : "Upgrade could not be purchased.";
    renderMetaPanel();
    return result;
  }
  progress = result.profile;
  persistPlayerProfile();
  game = createGame();
  clearNavigationOverlay();
  victoryRewarded = false;
  selectedTowerId = null;
  renderMetaPanel();
  const upgrade = content.metaProgression.upgrades && content.metaProgression.upgrades[id];
  message = ((upgrade && upgrade.label) || id) + " upgraded to level " + result.newLevel + ".";
  return result;
}

function renderMetaPanel() {
  const panel = $("meta-panel");
  const upgrades = Object.values(content.metaProgression.upgrades || {});
  const currencies = content.metaProgression.currencies || [];
  if (!panel) return;
  panel.hidden = upgrades.length === 0 && currencies.length === 0;
  $("meta-resources").textContent = currencies.map((item) => profileRecordNumber(progress.metaResources, item.id) + " " + item.label).join(" · ");
  $("meta-upgrades").innerHTML = upgrades.map((upgrade) => {
    const level = profileRecordNumber(progress.upgradeLevels, upgrade.id);
    const cost = upgrade.costs && upgrade.costs[level];
    const preview = purchasePlayerMetaUpgrade(progress, content, upgrade.id);
    return '<div class="meta-upgrade"><span><b>' + escapeHtml(upgrade.label || upgrade.id)
      + '</b><br>Lv ' + level + '/' + upgrade.maxLevel + '</span><button type="button" data-meta-upgrade="'
      + escapeHtml(upgrade.id) + '"' + (preview.ok ? "" : " disabled") + '>'
      + (cost ? escapeHtml(metaCostText(cost)) : "Max") + '</button></div>';
  }).join("");
  for (const button of document.querySelectorAll("[data-meta-upgrade]")) button.onclick = () => buyMetaUpgrade(button.dataset.metaUpgrade);
}

function refreshMissionOptions() {
  const select = $("mission-select");
  if (!select) return;
  select.innerHTML = Object.values(content.missions).map((mission) => {
    const unlocked = isUnlocked(mission.id);
    const cleared = progress.clearedMissionIds.includes(mission.id);
    const mark = cleared ? "✓ " : (unlocked ? "" : "🔒 ");
    return '<option value="' + escapeHtml(mission.id) + '"' + (unlocked ? "" : " disabled") + '>'
      + mark + escapeHtml(mission.label || mission.id) + '</option>';
  }).join("");
  select.value = missionId;
}

function choosePlayerDifficulty(id) {
  const result = selectPlayerDifficulty(progress, content, id);
  if (!result.ok) return result;
  progress = result.profile;
  persistPlayerProfile();
  return result;
}

function recordPlayerVictory(id, stars) {
  const result = recordPlayerMissionClear(progress, content, id, stars);
  if (!result.ok) {
    message = "Mission clear could not be recorded.";
    return result;
  }
  progress = result.profile;
  persistPlayerProfile();
  renderMetaPanel();
  const unlocked = result.newlyUnlockedMissionIds.map((missionId) => (content.missions[missionId] && content.missions[missionId].label) || missionId);
  message = (result.firstClear ? "Mission cleared!" : "Mission cleared again!") + (unlocked.length ? " Unlocked: " + unlocked.join(", ") : "");
  return result;
}

function resetPlayerProgress() {
  const result = rememberProfileStorageResult(playerProfileStore.reset());
  progress = result.profile;
  if (!isUnlocked(missionId)) missionId = Object.keys(content.missions).find(isUnlocked) || content.defaultMissionId;
  towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
  refreshMissionOptions();
  initDifficultySelector();
  initTowerSelector();
  game = createGame();
  clearNavigationOverlay();
  initAbilityBar();
  setSellMode(false);
  applyBattleBackground();
  selectMissionMusic();
  renderMetaPanel();
  selectedTowerId = null;
  victoryRewarded = false;
  message = "Campaign progress reset.";
  return result;
}
// TOWERFORGE_PROFILE_RUNTIME_END

const $ = (id) => document.getElementById(id);
applyProjectTheme();
const audio = createAudioPlayer({ audio: project.visuals && project.visuals.audio });
const canvas = $("playfield");
let missionId = content.defaultMissionId || Object.keys(content.missions)[0];
let towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
let game = createGame();
const renderer = createCanvasRenderer({ canvas, content, theme: content.visuals?.theme?.renderer });
let lastFrame = performance.now();
let message = "Choose a tower, click a buildable tile, then start the wave.";
let armedAbility = null;
let sellMode = false;
let selectedTowerId = null;
let keyboardCoord = null;
let navigationHoverCoord = null;
let navigationOverlayPlacementState = null;
let navigationOverlayFieldState = null;
let lastRunningSpeed = 1;
let activeStory = null;
let storyWasRunning = false;
let victoryRewarded = false;
const shownStories = new Set();

initSelectors();
syncKeyboardCursor(null);
initAbilityBar();
renderMetaPanel();
resize();
requestAnimationFrame(loop);
window.addEventListener("resize", resize);
// Pause the loop and free the audio hardware while the app is backgrounded (home button / app
// switch on Android) — saves battery and avoids a huge post-resume time step. RAF is already
// throttled while hidden; this also suspends the AudioContext.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { audio.suspend(); }
  else { lastFrame = performance.now(); if ($("snd")?.checked) audio.resume(); }
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./offline-sw.js").catch(() => {}));
}
$("start-wave").addEventListener("click", () => { audio.resume(); report(game.startNextWave()); });
$("pause-run").addEventListener("click", () => setPaused(Number($("speed").value) > 0));
$("sell-mode").addEventListener("click", () => setSellMode(!sellMode));
$("reset-run").addEventListener("click", () => { game = createGame(); victoryRewarded = false; selectedTowerId = null; initAbilityBar(); setSellMode(false); clearNavigationOverlay(); message = "Run reset."; });
$("reset-progress")?.addEventListener("click", resetPlayerProgress);
$("speed").addEventListener("input", syncSpeedUi);
$("snd").addEventListener("change", () => { syncAudioSettings(); if ($("snd").checked) audio.resume(); });
$("sfx-volume").addEventListener("input", () => { syncAudioSettings(); if ($("snd").checked) audio.resume(); });
$("music-volume").addEventListener("input", () => { syncAudioSettings(); if ($("snd").checked) audio.resume(); });
$("target-mode").addEventListener("change", () => {
  if (!selectedTowerId) return;
  report(game.setTowerTargetMode(selectedTowerId, $("target-mode").value));
});
$("story-next").addEventListener("click", advanceStory);
$("story-skip").addEventListener("click", finishStory);
document.addEventListener("keydown", (event) => {
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
  if (event.code === "Space") { event.preventDefault(); setPaused(Number($("speed").value) > 0); return; }
  if (document.activeElement !== canvas) return;
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (moves[event.key]) { event.preventDefault(); moveKeyboardCursor(moves[event.key][0], moves[event.key][1]); }
  else if (event.key === "Enter") { event.preventDefault(); actAtCoord(ensureKeyboardCoord()); }
  else if (event.key === "Escape") { event.preventDefault(); setArmed(null); setSellMode(false); message = "Build action cancelled."; }
});
syncSpeedUi();
syncAudioSettings();
applyBattleBackground();
selectMissionMusic();
showStoryForMission("beforeMission");
window.__towerforgeInspect = () => game.getRenderSnapshot();
window.__towerforgeTilePoint = (coord) => {
  const snapshot = game.getRenderSnapshot();
  const point = renderer.center(coord, renderer.geometry(snapshot.tiles, snapshot.grid));
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + point.x * rect.width / canvas.width, y: rect.top + point.y * rect.height / canvas.height };
};
window.__towerforgePickPoint = (point) => renderer.pickTile({ clientX: point.x, clientY: point.y }, game.getRenderSnapshot().tiles);
window.__towerforgeBootOk = true;
const bootError = document.getElementById("boot-error");
if (bootError) bootError.hidden = true;
canvas.addEventListener("focus", () => syncKeyboardCursor(ensureKeyboardCoord()));
canvas.addEventListener("pointermove", (event) => {
  const coord = pickTile(event);
  if (coord?.q === navigationHoverCoord?.q && coord?.r === navigationHoverCoord?.r) return;
  navigationHoverCoord = coord;
  refreshNavigationOverlay(navigationHoverCoord);
});
canvas.addEventListener("pointerleave", () => {
  navigationHoverCoord = null;
  refreshNavigationOverlay(keyboardCoord);
});
canvas.addEventListener("pointerdown", (event) => {
  audio.resume();
  const coord = pickTile(event);
  if (!coord) return;
  window.__towerforgeLastPointerCoord = coord;
  syncKeyboardCursor(coord);
  actAtCoord(coord);
});

function clearNavigationOverlay() {
  navigationOverlayPlacementState = null;
  navigationOverlayFieldState = null;
  projectNavigationPlacementCues(undefined);
  renderer.clearNavigationOverlay();
}

function captureNavigationOverlayPlacementState(snapshot) {
  // Allocation belongs to successful overlay refreshes, never animation-frame comparison.
  navigationOverlayPlacementState = snapshot.towers.map((tower) => ({
    id: tower.id,
    typeId: tower.typeId,
    q: tower.coord.q,
    r: tower.coord.r
  }));
  navigationOverlayFieldState = snapshot.navigation.fields.map((field) => ({
    movementProfileId: field.movementProfileId,
    revision: field.revision
  }));
}

function navigationSnapshotRevision(snapshot) {
  if (snapshot?.navigation?.schemaVersion !== 1 || snapshot.navigation.mode !== "dynamic_flow") return "";
  const fields = snapshot.navigation.fields;
  if (navigationOverlayFieldState === null || fields.length !== navigationOverlayFieldState.length) return true;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const retained = navigationOverlayFieldState[index];
    if (field.movementProfileId !== retained.movementProfileId || field.revision !== retained.revision) return true;
  }
  const towers = snapshot.towers;
  if (navigationOverlayPlacementState === null || towers.length !== navigationOverlayPlacementState.length) return true;
  // Engine snapshot order is deterministic, so exact positional comparison is
  // collision-free and catches create/destroy/move/type changes without allocation.
  for (let index = 0; index < towers.length; index += 1) {
    const tower = towers[index];
    const retained = navigationOverlayPlacementState[index];
    if (tower.id !== retained.id
      || tower.typeId !== retained.typeId
      || tower.coord.q !== retained.q
      || tower.coord.r !== retained.r) return true;
  }
  return false;
}

function syncNavigationOverlaySnapshot(snapshot) {
  if (snapshot.outcome !== "playing") { clearNavigationOverlay(); return; }
  const revisionChanged = navigationSnapshotRevision(snapshot);
  if (revisionChanged === "") {
    if (navigationOverlayPlacementState !== null || navigationOverlayFieldState !== null) clearNavigationOverlay();
    return;
  }
  if (revisionChanged && (navigationHoverCoord || keyboardCoord)) refreshNavigationOverlay();
}

function refreshNavigationOverlay(coord = navigationHoverCoord || keyboardCoord) {
  if (!coord || !towerId || sellMode || armedAbility) {
    clearNavigationOverlay();
    return;
  }
  let analysis;
  try {
    analysis = game.analyzeNavigation({ towerTypeId: towerId, coordinates: [{ q: coord.q, r: coord.r }] });
  } catch {
    clearNavigationOverlay();
    return;
  }
  const presentation = projectNavigationPlacementCues(analysis);
  if (!presentation.active) {
    clearNavigationOverlay();
    return;
  }
  renderer.setNavigationOverlay(analysis);
  captureNavigationOverlayPlacementState(game.getRenderSnapshot());
  const blocked = presentation.cues.find((cue) => cue.state === "blocked");
  if (blocked?.reasonKey === "reason.lastPathBlocked") message = "That tower would block the last path.";
}

function actAtCoord(coord) {
  if (!coord) return;
  if (sellMode) {
    const towerAt = game.getTowerIdAt(coord);
    report(towerAt ? game.sellTower(towerAt) : { ok: false, reason: "Choose a tower tile." });
    if (towerAt === selectedTowerId) selectedTowerId = null;
    setSellMode(false);
    return;
  }
  if (armedAbility) { report(game.useAbility(armedAbility, coord)); setArmed(null); return; }
  const towerAt = game.getTowerIdAt(coord);
  if (towerAt) { selectedTowerId = towerAt; message = "Tower selected."; return; }
  if (!towerId) return;
  const preflight = game.canPlaceTower(towerId, coord);
  if (!preflight.ok) { report(preflight); refreshNavigationOverlay(coord); return; }
  const result = game.placeTower(towerId, coord);
  report(result);
  if (result.ok) selectedTowerId = game.getTowerIdAt(coord);
  refreshNavigationOverlay(coord);
}

function ensureKeyboardCoord() {
  const tiles = game.getSnapshot().tiles;
  if (keyboardCoord && tiles.some((tile) => tile.q === keyboardCoord.q && tile.r === keyboardCoord.r)) return keyboardCoord;
  const tile = tiles.find((item) => item.terrain === "buildable") || tiles[0];
  keyboardCoord = tile ? { q: tile.q, r: tile.r } : null;
  return keyboardCoord;
}

function syncKeyboardCursor(coord) {
  keyboardCoord = coord ? { q: coord.q, r: coord.r } : null;
  renderer.setFocusCoord(keyboardCoord);
  const snapshot = game.getSnapshot();
  const tile = keyboardCoord && snapshot.tiles.find((item) => item.q === keyboardCoord.q && item.r === keyboardCoord.r);
  const battlefieldLabel = snapshot.grid.kind === "square" ? "Square battlefield" : "Hex battlefield";
  canvas.setAttribute("aria-label", tile ? battlefieldLabel + ". Selected tile q " + tile.q + ", r " + tile.r + ", " + tile.terrain + ". Arrow keys move; Enter acts; Escape cancels." : battlefieldLabel + ".");
  refreshNavigationOverlay(keyboardCoord);
}

function moveKeyboardCursor(dq, dr) {
  const current = ensureKeyboardCoord();
  if (!current) return;
  const tiles = game.getSnapshot().tiles;
  const targetQ = current.q + dq, targetR = current.r + dr;
  const target = tiles.find((tile) => tile.q === targetQ && tile.r === targetR);
  if (target) syncKeyboardCursor(target);
}

function createGame() {
  return new TowerDefenseGame({ missionId, content, ...currentPlayerLaunchOptions() });
}

function setSellMode(active) {
  sellMode = Boolean(active);
  $("sell-mode").setAttribute("aria-pressed", String(sellMode));
  if (sellMode) { setArmed(null); message = "Click a tower to sell it."; }
  if (sellMode) clearNavigationOverlay(); else refreshNavigationOverlay();
}

function setPaused(paused) {
  const speed = $("speed");
  const current = Number(speed.value) || 0;
  if (paused) {
    if (current > 0) lastRunningSpeed = current;
    speed.value = "0";
  } else {
    speed.value = String(lastRunningSpeed > 0 ? lastRunningSpeed : 1);
  }
  syncSpeedUi();
}

function syncSpeedUi() {
  const speed = Number($("speed").value) || 0;
  if (speed > 0) lastRunningSpeed = speed;
  $("speed-label").textContent = speed + "x";
  $("pause-run").textContent = speed > 0 ? "Pause" : "Resume";
  $("pause-run").setAttribute("aria-pressed", String(speed === 0));
}

function syncAudioSettings() {
  const enabled = $("snd").checked;
  const sfxVolume = Number($("sfx-volume").value);
  const musicVolume = Number($("music-volume").value);
  audio.setVolumes(sfxVolume, musicVolume);
  audio.setEnabled(enabled);
  $("sfx-volume-label").textContent = Math.round(sfxVolume * 100) + "%";
  $("music-volume-label").textContent = Math.round(musicVolume * 100) + "%";
  $("music-volume").disabled = Object.keys(project.visuals?.audio?.musicTracks || {}).length === 0;
}

function selectMissionMusic() {
  audio.selectMusic(project.visuals?.audio?.musicByMission?.[missionId] || "");
}

function initSelectors() {
  const missionSelect = $("mission-select");
  // Start on an unlocked mission (the default may be gated behind unlockRequiresMissionIds).
  if (!isUnlocked(missionId)) { const first = Object.keys(content.missions).find(isUnlocked); if (first) { missionId = first; game = createGame(); } }
  refreshMissionOptions();
  initDifficultySelector();
  missionSelect.addEventListener("change", () => {
    if (!isUnlocked(missionSelect.value)) { missionSelect.value = missionId; return; } // locked
    missionId = missionSelect.value;
    towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
    game = createGame();
    syncKeyboardCursor(null);
    clearNavigationOverlay();
    victoryRewarded = false;
    selectedTowerId = null;
    setSellMode(false);
    initTowerSelector();
    initAbilityBar();
    applyBattleBackground();
    selectMissionMusic();
    showStoryForMission("beforeMission");
  });
  initTowerSelector();
}

function initDifficultySelector() {
  const select = $("difficulty-select");
  if (!select) return;
  select.innerHTML = content.difficulties.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label || item.id)}</option>`).join("");
  select.value = currentPlayerLaunchOptions().difficultyId;
  select.onchange = () => {
    const result = choosePlayerDifficulty(select.value);
    if (!result.ok) { select.value = currentPlayerLaunchOptions().difficultyId; return; }
    game = createGame();
    clearNavigationOverlay();
    victoryRewarded = false;
    selectedTowerId = null;
    initAbilityBar();
    const selectedDifficultyId = currentPlayerLaunchOptions().difficultyId;
    message = "Difficulty changed to " + (content.difficulties.find((item) => item.id === selectedDifficultyId)?.label || selectedDifficultyId) + ".";
  };
}

function initTowerSelector() {
  const towerSelect = $("tower-select");
  const mission = content.missions[missionId];
  const ids = mission?.buildTowerIds?.length ? mission.buildTowerIds : Object.keys(content.towers);
  towerSelect.innerHTML = ids.map((id) => {
    const tower = content.towers[id];
    return `<option value="${escapeHtml(id)}">${escapeHtml(tower?.label || id)}</option>`;
  }).join("");
  towerId = ids[0] || "";
  towerSelect.value = towerId;
  // Assigning onchange (vs addEventListener) keeps a single handler when missions switch.
  towerSelect.onchange = () => { towerId = towerSelect.value; refreshNavigationOverlay(); };
}

function setArmed(id) {
  armedAbility = id;
  if (id) message = "Click the map to use " + ((game.getSnapshot().abilities[id] || {}).label || id) + ".";
  if (id) clearNavigationOverlay(); else refreshNavigationOverlay();
  for (const btn of document.querySelectorAll("#ability-bar button")) btn.classList.toggle("armed", btn.dataset.aid === id);
}
function initAbilityBar() {
  const bar = $("ability-bar");
  if (!bar) return;
  const abilities = Object.values(game.getSnapshot().abilities || {});
  bar.innerHTML = abilities.map((a) => `<button data-aid="${escapeHtml(a.id)}" title="Radius ${a.radius}, cooldown ${a.cooldown}">${escapeHtml(a.label || a.id)}</button>`).join("");
  armedAbility = null;
  for (const btn of bar.querySelectorAll("button")) {
    btn.onclick = () => { audio.resume(); setArmed(armedAbility === btn.dataset.aid ? null : btn.dataset.aid); };
  }
}
function updateAbilityBar(snap) {
  for (const btn of document.querySelectorAll("#ability-bar button")) {
    const a = snap.abilities ? snap.abilities[btn.dataset.aid] : null;
    const ready = !!a && a.ready;
    btn.disabled = !ready;
    const cd = Math.ceil((a && a.cooldownRemaining) || 0);
    btn.textContent = ((a && a.label) || btn.dataset.aid) + (cd > 0 ? " (" + cd + ")" : "");
    if (!ready && armedAbility === btn.dataset.aid) setArmed(null);
  }
}

function resolveStandaloneSprite(spriteId) {
  const src = content.visuals?.sprites?.[spriteId]?.src;
  if (typeof src !== "string" || !src) return "";
  return visualAssetUrl(src);
}

function visualAssetUrl(src) {
  if (/^(?:data:|blob:|https?:)/i.test(src)) return src;
  return "./" + String(src).split("/").map(encodeURIComponent).join("/");
}

function applyBattleBackground() {
  const fallback = content.battleBackgroundFallbackMissionId;
  const definition = content.battleBackgrounds?.[missionId] || (fallback ? content.battleBackgrounds?.[fallback] : null) || {};
  const playfield = $("playfield");
  playfield.style.backgroundColor = definition.color || "#101410";
  const src = resolveStandaloneSprite(definition.spriteId);
  const opacity = Math.max(0, Math.min(1, Number(definition.opacity ?? 1)));
  const color = /^#[0-9a-f]{6}$/i.test(definition.color || "") ? definition.color : "#101410";
  const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)).join(",");
  const tint = opacity < 1 ? "linear-gradient(rgba(" + rgb + "," + (1 - opacity) + "),rgba(" + rgb + "," + (1 - opacity) + "))," : "";
  playfield.style.backgroundImage = src ? tint + "url(" + JSON.stringify(src) + ")" : "none";
}

function showStoryForMission(trigger) {
  const entry = Object.entries(content.storyComics || {}).find(([, comic]) => comic?.missionId === missionId && (comic.trigger || "beforeMission") === trigger);
  if (!entry) return;
  const [comicId, comic] = entry;
  const runKey = trigger + ":" + comicId;
  if (shownStories.has(runKey)) return;
  const seenKey = content.storySeenStoragePrefix + playerProfileScope + ":" + comicId;
  if (comic.replay !== "always") {
    try { if (localStorage.getItem(seenKey) === "1") return; } catch {}
  }
  shownStories.add(runKey);
  storyWasRunning = Number($("speed").value) > 0;
  setPaused(true);
  activeStory = { comicId, comic, panelIndex: 0, seenKey };
  $("story-overlay").hidden = false;
  renderStoryPanel();
  $("story-next").focus();
}

function renderStoryPanel() {
  if (!activeStory) return;
  const { comic, panelIndex } = activeStory;
  const panel = comic.panels[panelIndex];
  $("story-title").textContent = comic.title || content.missions[comic.missionId]?.label || comic.missionId;
  $("story-speaker").textContent = panel.speaker || "";
  $("story-text").textContent = panel.text;
  const art = $("story-art");
  const src = resolveStandaloneSprite(panel.spriteId);
  art.hidden = !src;
  art.style.backgroundImage = src ? "url(" + JSON.stringify(src) + ")" : "none";
  $("story-next").textContent = panelIndex >= comic.panels.length - 1 ? "Continue" : "Next";
}

function advanceStory() {
  if (!activeStory) return;
  if (activeStory.panelIndex < activeStory.comic.panels.length - 1) {
    activeStory.panelIndex += 1;
    renderStoryPanel();
  } else finishStory();
}

function finishStory() {
  if (!activeStory) return;
  try { localStorage.setItem(activeStory.seenKey, "1"); } catch {}
  activeStory = null;
  $("story-overlay").hidden = true;
  if (storyWasRunning) setPaused(false);
  $("start-wave").focus();
}

function loop(now) {
  const dtSeconds = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const speed = Number($("speed").value) || 0;
  // Capture events from player actions (place/upgrade/ability/first wave) BEFORE tick() clears
  // them — tick() resets lastEvents at its start, so reading only after ticking drops them and
  // their sounds/effects never fire. One render snapshot per frame drives draw + HUD (no extra
  // deep-copy getSnapshot() calls).
  let snap = game.getRenderSnapshot();
  const pending = snap.lastEvents;
  const ticked = speed > 0 && snap.outcome === "playing";
  if (ticked) {
    const timeUnitSeconds = content.constants.timeUnitSeconds || 1;
    game.tick((dtSeconds / timeUnitSeconds) * speed);
    snap = game.getRenderSnapshot();
  }
  syncNavigationOverlaySnapshot(snap);
  const events = ticked ? pending.concat(snap.lastEvents) : pending;
  game.lastEvents = []; // consumed this frame — clear so nothing replays on the next frame
  draw(snap, events);
  updateHud(snap);
  requestAnimationFrame(loop);
}

function resize() {
  renderer.resize();
}

function draw(snap, events) {
  snap.lastEvents = events;
  renderer.drawSnapshot(snap);
  if ($("snd")?.checked) audio.handleEvents(events);
}

function updateHud(snap) {
  updateAbilityBar(snap);
  updateTargetMode(snap);
  if (snap.outcome === "victory" && !victoryRewarded) {
    victoryRewarded = true;
    recordPlayerVictory(missionId, (snap.stars || []).filter((item) => item.achieved).length);
    refreshMissionOptions();
    showStoryForMission("afterVictory");
  }
  $("mission-caption").textContent = content.missions[missionId]?.description || content.missions[missionId]?.label || missionId;
  $("stat-outcome").textContent = snap.outcome;
  $("stat-core").textContent = `${snap.coreHp}/${snap.maxCoreHp}`;
  $("stat-resources").textContent = Object.entries(snap.resources).map(([id, value]) => { const c = (content.currencies || []).find((c) => c.id === id); return `${c ? c.label : id}: ${value}`; }).join(" · ");
  $("stat-wave").textContent = `${snap.startedWaveCount}/${snap.totalWaves} ${snap.waveState}`;
  $("stat-enemies").textContent = String(snap.enemies.length);
  $("stat-towers").textContent = String(snap.towers.length);
  const objectives = snap.objectiveProgress || [];
  const stars = snap.stars || [];
  $("stat-objectives").textContent = objectives.filter((item) => item.complete).length + "/" + objectives.length
    + (stars.length ? " | " + stars.filter((item) => item.achieved).length + "/" + stars.length + " stars" : "");
  $("message").textContent = playerProfileStatusText(message);
}

function updateTargetMode(snap) {
  const select = $("target-mode");
  const tower = selectedTowerId ? snap.towers.find((item) => item.id === selectedTowerId) : null;
  if (!tower) selectedTowerId = null;
  select.disabled = !tower || !tower.targetMode;
  if (tower && tower.targetMode) select.value = tower.targetMode === "largest_hp" ? "strongest" : tower.targetMode === "fastest_ahead" ? "first" : tower.targetMode;
}

function report(result) {
  message = result.ok ? "Action accepted." : (result.reason || "Action rejected.");
}

function pickTile(event) {
  return renderer.pickTile(event, game.getSnapshot().tiles);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function applyProjectTheme() {
  const palette = content.visuals?.theme?.ui ?? {};
  for (const [key, value] of Object.entries(palette)) {
    if (/^[a-z][a-z0-9-]*$/i.test(key) && /^#[0-9a-f]{6}$/i.test(value)) {
      document.documentElement.style.setProperty(`--${key}`, value);
    }
  }
}
