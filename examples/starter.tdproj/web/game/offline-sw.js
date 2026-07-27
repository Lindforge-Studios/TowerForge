const CACHE = "towerforge-build-cc4f9c56e153cddd";
const ASSETS = ["./","./assets/backgrounds/frontier-before-battle.png","./boot.js","./engine/content/combat-mechanics.js","./engine/content/elevation-mechanics.js","./engine/content/mechanics.js","./engine/content/navigation-mechanics.js","./engine/content/reaction-mechanics.js","./engine/content/registry.js","./engine/content/schema-descriptor.js","./engine/content/validate.js","./engine/index.js","./engine/profile/player-profile.js","./engine/scripting/expression.js","./engine/scripting/schema-descriptor.js","./engine/scripting/types.js","./engine/scripting/validate.js","./engine/simulation/TowerDefenseGame.js","./engine/simulation/balance.js","./engine/simulation/checkpoint.js","./engine/simulation/command-internal.js","./engine/simulation/commands.js","./engine/simulation/damage.js","./engine/simulation/headless.js","./engine/simulation/hex.js","./engine/simulation/journal-result-internal.js","./engine/simulation/journal.js","./engine/simulation/line-of-sight.js","./engine/simulation/map.js","./engine/simulation/modifiers.js","./engine/simulation/navigation-analysis.js","./engine/simulation/navigation-field.js","./engine/simulation/navigation-movement.js","./engine/simulation/navigation-runtime.js","./engine/simulation/reactions.js","./engine/simulation/replay.js","./engine/simulation/rng.js","./engine/simulation/shields.js","./engine/simulation/stable-digest.js","./engine/simulation/terrain.js","./engine/simulation/topology.js","./engine/simulation/types.js","./index.html","./manifest.webmanifest","./player-runtime/index.mjs","./player-runtime/player-profile-store.mjs","./player.mjs","./project-data.js","./renderer/audio.mjs","./renderer/autotile.mjs","./renderer/combat-presentation.mjs","./renderer/elevation-presentation.mjs","./renderer/index.mjs","./renderer/line-of-sight-presentation.mjs","./renderer/navigation-presentation.mjs","./styles.css"];
self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Resilient precache: cache each URL independently (Promise.allSettled), so one missing/renamed
  // asset can't abort the whole install and leave the game uncached — unlike all-or-nothing addAll.
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(ASSETS.map((url) => cache.add(url)))));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return; // leave cross-origin requests to the network
  // Navigations: network-first (a fresh index.html when online, so a returning player is never
  // pinned to a stale shell), falling back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((cache) => cache.put("./", copy)); return res; })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./")))
    );
    return;
  }
  // Assets: cache-first for instant loads, populating the cache with same-origin responses.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => {
      if (res && res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
      return res;
    }))
  );
});
