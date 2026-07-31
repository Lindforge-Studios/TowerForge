// build.mjs — Build a .tdproj project into a deployable web bundle.
// Usage: node build.mjs [--project <path>] [--target <targetId>] [--out <dir>]
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  loadEngine,
  loadProjectFiles,
  repoRoot,
  resolveProjectDir,
  selectBuildTarget,
  validateProjectDir
} from "./lib/project-loader.mjs";
import { copyVisualAssets } from "./lib/assets.mjs";
import { parseJsonFlag, printJson } from "./lib/trace.mjs";
import { projectTileCoverage } from "./lib/tile-coverage.mjs";

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = { projectDir: null, targetId: null, outDir: null, json: parseJsonFlag(raw), singleFile: false };
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "--project" && raw[i + 1]) {
      result.projectDir = raw[i + 1];
      i += 2;
    } else if (raw[i] === "--target" && raw[i + 1]) {
      result.targetId = raw[i + 1];
      i += 2;
    } else if (raw[i] === "--out" && raw[i + 1]) {
      result.outDir = raw[i + 1];
      i += 2;
    } else if (raw[i] === "--json") {
      i += 1;
    } else if (raw[i] === "--single-file") {
      result.singleFile = true;
      i += 1;
    } else {
      // A bare positional (not a flag or a flag's value) is the project path, matching
      // `towerforge validate <path>`. Without this it was silently dropped -> the command
      // operated on the default starter project instead of the one the user named.
      if (!result.projectDir && !raw[i].startsWith("--")) result.projectDir = raw[i];
      i += 1;
    }
  }
  return result;
}

const args = parseArgs();
const PROJECT_DIR = resolveProjectDir(args.projectDir, []);

try {
  const { result } = await validateProjectDir(PROJECT_DIR);
  if (!result.ok) {
    if (!args.json) {
      for (const issue of result.issues) {
        if (issue.severity === "error") {
          console.error(`  ✗ [${issue.entityKind}:${issue.entityId}] ${issue.fieldPath} — ${issue.message}`);
        }
      }
    }
    const error = new Error("Build stopped because project validation failed.");
    error.issues = result.issues;
    throw error;
  }

  await loadEngine();
  const files = loadProjectFiles(PROJECT_DIR);
  const initialGridKind = resolveInitialGridKind(files);
  const tileCoverage = projectTileCoverage(files);
  if (!tileCoverage.ok) {
    const error = new Error(`Build stopped because ${tileCoverage.missingCount} reachable tileset signature(s) are missing.`);
    error.issues = tileCoverage.maps.flatMap((map) => map.missing.map((entry) => ({
      severity: "error", entityKind: "tileSet", entityId: map.tileSetId ?? "?", fieldPath: `maps.${map.mapId}.${entry.terrain}.${entry.signature}`,
      code: "TILESET_REACHABLE_SIGNATURE_MISSING", message: `Map "${map.mapId}" needs ${entry.terrain}/${entry.signature} (${entry.count} reachable cell(s)).`
    })));
    throw error;
  }
  const [targetId, target] = selectBuildTarget(files.buildTargets, args.targetId);
  if (target.platform !== "web") {
    throw new Error(`Build target "${targetId}" uses platform "${target.platform}". This build command currently supports web targets only.`);
  }

  const outDir = path.resolve(PROJECT_DIR, args.outDir ?? target.webDir ?? "dist");
  assertSafeOutputDir(PROJECT_DIR, outDir);
  emptyDir(outDir);

  const renderer = target.renderer === "phaser" ? "phaser" : "canvas";
  const multiplayerActive = hasActiveMultiplayer(files);
  copyDir(path.join(repoRoot, "packages", "engine", "dist"), path.join(outDir, "engine"), {
    excludeRootEntries: multiplayerActive ? undefined : new Set(["multiplayer"])
  });
  const playerRuntimeSource = path.join(repoRoot, "packages", "player-runtime", "src");
  const playerRuntimeOutput = path.join(outDir, "player-runtime");
  fs.mkdirSync(playerRuntimeOutput, { recursive: true });
  for (const fileName of ["index.mjs", "player-profile-store.mjs"]) {
    fs.copyFileSync(path.join(playerRuntimeSource, fileName), path.join(playerRuntimeOutput, fileName));
  }
  // Renderer dir ships for both players — the canvas player needs index.mjs, both need audio.mjs.
  copyDir(path.join(repoRoot, "packages", "renderer", "src"), path.join(outDir, "renderer"));
  if (renderer === "phaser") {
    // Vendor Phaser locally so the offline PWA still works (no CDN dependency).
    const phaserSrc = path.join(repoRoot, "packages", "renderer", "vendor", "phaser.min.js");
    if (!fs.existsSync(phaserSrc)) {
      throw new Error("Phaser renderer requested but packages/renderer/vendor/phaser.min.js is missing.");
    }
    fs.mkdirSync(path.join(outDir, "vendor"), { recursive: true });
    fs.copyFileSync(phaserSrc, path.join(outDir, "vendor", "phaser.min.js"));
  }
  const assetCopy = copyVisualAssets(PROJECT_DIR, outDir, files.visuals);
  writeJsonModule(path.join(outDir, "project-data.js"), {
    manifest: files.manifest,
    balance: files.balance,
    worldMap: files.worldMap,
    maps: files.maps,
    scripts: files.scripts,
    ...(files.mechanicsAuthored ? { mechanics: files.mechanics } : {}),
    visuals: files.visuals,
    storyComics: files.storyComics,
    battleBackgrounds: files.battleBackgrounds,
    buildTarget: target
  });
  fs.writeFileSync(path.join(outDir, "index.html"), htmlTemplate(files.manifest, target, renderer, initialGridKind), "utf8");
  fs.writeFileSync(path.join(outDir, "styles.css"), cssTemplate(target), "utf8");
  fs.writeFileSync(path.join(outDir, "boot.js"), bootRecoveryTemplate(files.manifest, target, files.storyComics), "utf8");
  fs.writeFileSync(
    path.join(outDir, "player.mjs"),
    renderer === "phaser" ? phaserPlayerTemplate(multiplayerActive) : playerTemplate(multiplayerActive),
    "utf8"
  );
  fs.writeFileSync(path.join(outDir, "manifest.webmanifest"), JSON.stringify(webManifest(files.manifest, target), null, 2) + "\n", "utf8");

  // Service worker is written last: precache every emitted asset and version the cache by content
  // hash so a rebuild invalidates stale clients.
  const precacheAssets = collectPrecacheAssets(outDir);
  // Version the cache by CONTENT, not just file names: hash every precached file's bytes so any
  // change to maps/worldMap/visuals (embedded in project-data.js), engine/renderer JS, or a
  // replaced binary asset yields a new offline-sw.js and evicts the stale cache on returning
  // clients. Hashing names alone left redeploys byte-identical, pinning players to the old build.
  const versionHash = createHash("sha256").update(JSON.stringify({ target }));
  for (const rel of precacheAssets) {
    versionHash.update(rel).update("\0");
    versionHash.update(fs.readFileSync(path.join(outDir, rel.replace(/^\.\//, ""))));
  }
  const cacheVersion = versionHash.digest("hex").slice(0, 16);
  fs.writeFileSync(path.join(outDir, "offline-sw.js"), serviceWorkerTemplate(precacheAssets, cacheVersion), "utf8");

  let singleFilePath = null;
  if (args.singleFile) {
    singleFilePath = path.join(outDir, "index.single.html");
    const embeddedProject = {
      manifest: files.manifest,
      balance: files.balance,
      worldMap: files.worldMap,
      maps: files.maps,
      scripts: files.scripts,
      ...(files.mechanicsAuthored ? { mechanics: files.mechanics } : {}),
      visuals: embedVisualAssets(PROJECT_DIR, files.visuals),
      storyComics: files.storyComics,
      battleBackgrounds: files.battleBackgrounds,
      buildTarget: target
    };
    fs.writeFileSync(singleFilePath, singleFileHtml(outDir, files.manifest, target, renderer, embeddedProject, initialGridKind), "utf8");
  }

  // Phaser now shares topology and terrain tileset resolution with Canvas. Entity sprites still use
  // flat placeholders, so report only those bindings instead of claiming all visual art is ignored.
  const warnings = [];
  if (renderer === "phaser") {
    const bindings = files.visuals?.bindings ?? {};
    const boundCount = Object.keys(bindings.towers ?? {}).length + Object.keys(bindings.enemies ?? {}).length;
    if (boundCount > 0) {
      warnings.push(`Phaser renderer uses the shared tileset pipeline, but ${boundCount} bound tower/enemy sprite(s) still use flat entity placeholders.`);
    }
  }

  const summary = {
    ok: true,
    projectDir: PROJECT_DIR,
    targetId,
    outDir,
    copiedAssets: assetCopy.copied,
    missingAssets: assetCopy.missing,
    invalidAssets: assetCopy.invalid,
    singleFilePath,
    warnings
  };
  if (args.json) {
    printJson(summary);
  } else {
    console.log(`  ✓ Built ${targetId} to ${outDir}`);
    if (assetCopy.missing.length > 0) {
      console.warn(`  ! ${assetCopy.missing.length} visual asset(s) were referenced but not found.`);
    }
    for (const warning of warnings) console.warn(`  ! ${warning}`);
    if (singleFilePath) console.log(`  Open ${singleFilePath} directly, or serve ${outDir} and open index.html.`);
    else console.log(`  Serve ${outDir} with any static server, then open index.html.`);
  }
} catch (error) {
  if (args.json) printJson({ ok: false, error: error.message, issues: error.issues ?? [] });
  else console.error(`  ✗ ${error.message}`);
  process.exit(1);
}

function assertSafeOutputDir(projectDir, outDir) {
  const rel = path.relative(projectDir, outDir);
  if (!rel || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing to build outside the project directory: ${outDir}`);
  }
}

function emptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest, options = {}, depth = 0) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // Skip test/spec files and any TypeScript declaration / source files — the player only needs
    // runtime JS. Also skip dotfiles (e.g. dist/.build-stamp, an internal engine-freshness marker)
    // so build-internal artifacts never ship in the bundle or get precached by the service worker.
    if (entry.name.startsWith(".") || /\.(test|spec)\.(mjs|js|ts)$/.test(entry.name) || /\.d\.ts(\.map)?$/.test(entry.name) || /\.ts$/.test(entry.name)) continue;
    if (depth === 0 && options.excludeRootEntries?.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to, options, depth + 1);
    else fs.copyFileSync(from, to);
  }
}

function hasActiveMultiplayer(files) {
  const module = files.mechanics?.modules?.multiplayer;
  if (module?.enabled !== true || (module.schemaVersion !== 1 && module.schemaVersion !== 2)) return false;
  const profiles = module.profiles;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) return false;
  return Object.values(files.balance?.missions ?? {}).some((mission) => {
    const profileId = mission?.mechanics?.profiles?.multiplayer;
    return typeof profileId === "string" && Object.prototype.hasOwnProperty.call(profiles, profileId);
  });
}

/** Walk a built output directory and return `./`-prefixed posix paths for service-worker precaching. */
function collectPrecacheAssets(outDir) {
  const assets = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name !== "offline-sw.js" && !entry.name.startsWith(".")) {
        // Never precache the SW itself or dotfiles (build-internal markers, DS_Store, etc.).
        const rel = path.relative(outDir, full).split(path.sep).join("/");
        assets.push("./" + rel);
      }
    }
  };
  walk(outDir);
  return assets.sort();
}

function writeJsonModule(filePath, data) {
  fs.writeFileSync(filePath, `export default ${JSON.stringify(data, null, 2)};\n`, "utf8");
}

function embedVisualAssets(projectDir, visuals) {
  const embedded = JSON.parse(JSON.stringify(visuals ?? {}));
  const groups = [embedded.atlases, embedded.sprites, embedded.audio?.sounds, embedded.audio?.musicTracks];
  for (const group of groups) {
    for (const entry of Object.values(group ?? {})) {
      if (!entry?.src || /^(?:data:|blob:|https?:)/i.test(entry.src)) continue;
      const absolute = path.resolve(projectDir, entry.src);
      const relative = path.relative(projectDir, absolute);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
      entry.src = `data:${mimeType(absolute)};base64,${fs.readFileSync(absolute).toString("base64")}`;
    }
  }
  return embedded;
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4"
  })[ext] ?? "application/octet-stream";
}

function singleFileHtml(outDir, manifest, target, renderer, projectData, initialGridKind) {
  const virtual = new Map([
    [path.resolve(outDir, "project-data.js"), `export default ${JSON.stringify(projectData)};\n`]
  ]);
  const entryPath = path.resolve(outDir, "player.mjs");
  const entry = singleFileModuleBootstrap(entryPath, outDir, virtual);
  let html = htmlTemplate(manifest, target, renderer, initialGridKind);
  html = html.replace(/\s*<link rel="manifest"[^>]*>/, "");
  html = html.replace('  <link rel="stylesheet" href="./styles.css">', `  <style>${escapeInlineStyle(cssTemplate(target))}</style>`);
  if (renderer === "phaser") {
    const phaser = fs.readFileSync(path.join(outDir, "vendor", "phaser.min.js"), "utf8");
    html = html.replace('  <script src="./vendor/phaser.min.js"></script>', `  <script>${escapeInlineScript(phaser)}</script>`);
  }
  html = html.replace('  <script src="./boot.js"></script>', `  <script>${escapeInlineScript(bootRecoveryTemplate(manifest, target, projectData.storyComics))}</script>`);
  html = html.replace('  <script type="module" src="./player.mjs"></script>', `  <script>${escapeInlineScript(entry)}</script>`);
  return html;
}

function collectSingleFileModule(filePath, moduleRoot, virtual, memo, modules, stack) {
  const absolute = path.resolve(filePath);
  if (stack.includes(absolute)) throw new Error(`Single-file module graph contains a cycle: ${[...stack, absolute].map((item) => path.relative(moduleRoot, item)).join(" -> ")}`);
  if (memo.has(absolute)) return memo.get(absolute);
  const id = `m${memo.size}`;
  memo.set(absolute, id);
  let source = virtual.get(absolute) ?? fs.readFileSync(absolute, "utf8");
  const nextStack = [...stack, absolute];
  const dependencies = [];
  const importPattern = /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?(["'])([^"']+)\1/g;
  source = source.replace(importPattern, (statement, quote, specifier) => {
    if (!specifier.startsWith(".")) return statement;
    const dependency = path.resolve(path.dirname(absolute), specifier);
    const relative = path.relative(moduleRoot, dependency);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Single-file module escapes build output: ${specifier}`);
    const dependencyId = collectSingleFileModule(dependency, moduleRoot, virtual, memo, modules, nextStack);
    const token = `__TOWERFORGE_MODULE_URL_${id}_${dependencies.length}__`;
    dependencies.push([token, dependencyId]);
    return statement.replace(`${quote}${specifier}${quote}`, `${quote}${token}${quote}`);
  });
  modules[id] = {
    source: `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`,
    dependencies
  };
  return id;
}

function singleFileModuleBootstrap(entryPath, moduleRoot, virtual) {
  const modules = {};
  const entryId = collectSingleFileModule(entryPath, moduleRoot, virtual, new Map(), modules, []);
  return `(() => {
  const modules = ${JSON.stringify(modules)};
  const urls = Object.create(null);
  const decode = (url) => {
    const encoded = url.slice(url.indexOf(",") + 1);
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };
  const materialize = (id) => {
    if (urls[id]) return urls[id];
    const module = modules[id];
    let source = decode(module.source);
    for (const [token, dependencyId] of module.dependencies) {
      source = source.split(token).join(materialize(dependencyId));
    }
    urls[id] = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    return urls[id];
  };
  void import(materialize(${JSON.stringify(entryId)}));
})();`;
}

function escapeInlineScript(value) { return String(value).replace(/<\/script/gi, "<\\/script"); }
function escapeInlineStyle(value) { return String(value).replace(/<\/style/gi, "<\\/style"); }

function webManifest(manifest, target) {
  return {
    name: target.manifest?.name ?? target.appTitle ?? manifest.name ?? "TowerForge TD",
    short_name: target.manifest?.shortName ?? target.appName ?? manifest.name ?? "TowerForge",
    start_url: ".",
    display: target.manifest?.display ?? "standalone",
    orientation: target.manifest?.orientation ?? "any",
    theme_color: target.manifest?.themeColor ?? target.backgroundColor ?? "#111111",
    background_color: target.manifest?.backgroundColor ?? target.backgroundColor ?? "#111111"
  };
}

function resolveInitialGridKind(project) {
  const missions = project.balance?.missions ?? {};
  const missionId = project.balance?.defaultMissionId ?? Object.keys(missions)[0];
  const mapId = missions[missionId]?.mapId;
  return project.maps?.[mapId]?.grid?.kind === "square" ? "square" : "hex";
}

function htmlTemplate(manifest, target, renderer = "canvas", initialGridKind = "hex") {
  const title = esc(target.appTitle ?? manifest.name ?? "TowerForge TD");
  const battlefieldKind = initialGridKind === "square" ? "Square" : "Hex";
  const playfield = renderer === "phaser"
    ? `<div id="playfield" tabindex="0" role="application" aria-label="${battlefieldKind} battlefield. Use arrow keys to move the tile cursor and Enter to act."></div>`
    : `<canvas id="playfield" tabindex="0" role="application" aria-label="${battlefieldKind} battlefield. Use arrow keys to move the tile cursor and Enter to act."></canvas>`;
  const phaserScript = renderer === "phaser" ? `\n  <script src="./vendor/phaser.min.js"></script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="${esc(target.backgroundColor ?? manifest.backgroundColor ?? "#111111")}">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${title}</title>
  <link rel="manifest" href="./manifest.webmanifest">
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <main id="app">
    <header class="hud">
      <div>
        <h1>${title}</h1>
        <p id="mission-caption"></p>
      </div>
      <div class="controls">
        <label>Mission <select id="mission-select"></select></label>
        <label>Difficulty <select id="difficulty-select"></select></label>
        <label>Tower <select id="tower-select"></select></label>
        <button id="start-wave">Start wave</button>
        <button id="pause-run" aria-pressed="false" title="Pause or resume (Space)">Pause</button>
        <button id="sell-mode" aria-pressed="false" title="Sell a tower">Sell</button>
        <button id="reset-run">Reset</button>
        <button id="reset-progress" title="Clear saved campaign progress">Reset progress</button>
      </div>
    </header>
    <section class="play-shell">
      ${playfield}
      <aside class="panel">
        <div class="stat"><span>Outcome</span><strong id="stat-outcome" aria-live="polite">playing</strong></div>
        <div class="stat"><span>Core</span><strong id="stat-core">-</strong></div>
        <div class="stat"><span>Resources</span><strong id="stat-resources">-</strong></div>
        <div class="stat"><span>Wave</span><strong id="stat-wave">-</strong></div>
        <div class="stat"><span>Enemies</span><strong id="stat-enemies">-</strong></div>
        <div class="stat"><span>Towers</span><strong id="stat-towers">-</strong></div>
        <div class="stat"><span>Objectives</span><strong id="stat-objectives">-</strong></div>
        <label class="targeting">Target priority <select id="target-mode" disabled>
          <option value="first">First</option><option value="last">Last</option><option value="closest">Closest</option>
          <option value="furthest">Furthest</option><option value="strongest">Strongest</option><option value="weakest">Weakest</option>
        </select></label>
        <label class="speed">Speed <input id="speed" type="range" min="0" max="4" step="0.25" value="1"><span id="speed-label">1x</span></label>
        <label class="speed">Sound <input id="snd" type="checkbox" checked style="width:auto;justify-self:start"></label>
        <label class="speed">SFX <input id="sfx-volume" type="range" min="0" max="1" step="0.05" value="0.5"><span id="sfx-volume-label">50%</span></label>
        <label class="speed">Music <input id="music-volume" type="range" min="0" max="1" step="0.05" value="0.35"><span id="music-volume-label">35%</span></label>
        <div id="ability-bar" class="ability-bar"></div>
        <section id="roguelite-status" class="roguelite-status" aria-label="Tower synergies" hidden></section>
        <section id="wave-draft" class="roguelite-status" aria-label="Wave draft" hidden></section>
        <section id="artifact-inventory" class="roguelite-status" aria-label="Artifact inventory" hidden></section>
        <section id="arsenal-status" class="roguelite-status" aria-label="Modular arsenal" hidden></section>
        <section id="logistics-status" class="roguelite-status" aria-label="Power grid" hidden></section>
        <section id="quest-status" class="roguelite-status" aria-label="Optional challenges" hidden></section>
        <section id="campaign-run-panel" class="campaign-run-panel" aria-label="Campaign run" hidden>
          <strong>Campaign run</strong>
          <span id="campaign-run-summary"></span>
          <div id="campaign-run-nodes" class="campaign-run-nodes"></div>
          <div class="campaign-run-actions">
            <button id="campaign-run-export" type="button">Export run</button>
            <button id="campaign-run-import" type="button">Import run</button>
            <input id="campaign-run-file" type="file" accept="application/json,.json" hidden>
          </div>
        </section>
        <section id="meta-panel" class="meta-panel" aria-label="Permanent upgrades" hidden>
          <div class="meta-title">Forge upgrades <span id="meta-resources"></span></div>
          <div id="meta-upgrades" class="meta-upgrades"></div>
        </section>
        <p id="message" role="status" aria-live="polite"></p>
      </aside>
    </section>
  </main>
  <section id="boot-error" class="boot-error" role="alertdialog" aria-modal="true" aria-labelledby="boot-error-title" hidden>
    <div class="boot-error-panel">
      <h2 id="boot-error-title">The game could not start</h2>
      <p id="boot-error-message">Reload the game. If the problem continues, reset local progress.</p>
      <div class="boot-error-actions">
        <button type="button" id="boot-reload">Reload</button>
        <button type="button" id="boot-reset">Reset local progress</button>
      </div>
    </div>
  </section>
  <section id="story-overlay" class="story-overlay" role="dialog" aria-modal="true" aria-labelledby="story-title" hidden>
    <div class="story-panel">
      <div id="story-art" class="story-art" hidden></div>
      <div class="story-copy">
        <h2 id="story-title"></h2>
        <p id="story-speaker" class="story-speaker"></p>
        <p id="story-text" class="story-text"></p>
        <div class="story-actions">
          <button type="button" id="story-skip">Skip</button>
          <button type="button" id="story-next">Next</button>
        </div>
      </div>
    </div>
  </section>
  <script src="./boot.js"></script>${phaserScript}
  <script type="module" src="./player.mjs"></script>
</body>
</html>
`;
}

function bootRecoveryTemplate(manifest = {}, target = {}, storyComics = {}) {
  const scope = target.appId || manifest.name || "game";
  const profileKey = `towerforge:progress:${scope}`;
  const storyNamespace = `${storyComics.seenStoragePrefix || "story_seen_"}${scope}:`;
  return `(() => {
  const reveal = (reason) => {
    const overlay = document.getElementById("boot-error");
    if (!overlay || window.__towerforgeBootOk) return;
    const message = document.getElementById("boot-error-message");
    if (message && reason) message.textContent = String(reason);
    overlay.hidden = false;
    document.getElementById("boot-reload").onclick = () => location.reload();
    document.getElementById("boot-reset").onclick = () => {
      try {
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
          const key = localStorage.key(i) || "";
          if (key === ${JSON.stringify(profileKey)} || key.startsWith(${JSON.stringify(storyNamespace)})) localStorage.removeItem(key);
        }
      } catch {}
      location.reload();
    };
    document.getElementById("boot-reload").focus();
  };
  window.addEventListener("error", (event) => reveal(event.error?.message || event.message));
  window.addEventListener("unhandledrejection", (event) => reveal(event.reason?.message || event.reason || "The game failed while starting."));
  setTimeout(() => reveal("The game did not finish starting."), 5000);
})();\n`;
}

function cssTemplate(target) {
  const bg = target.backgroundColor ?? "#111111";
  return `:root{--bg:${bg};--surface:#191b19;--panel:#222620;--border:#364036;--text:#eff3ea;--muted:#9ca895;--accent:#8ac783;--path:#6b5540;--danger:#df6a59;--water:#427b88;--font:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
*{box-sizing:border-box}html,body{height:100%;margin:0;background:var(--bg);color:var(--text);font-family:var(--font)}
/* Native-app touch hardening (ported from a shipped Capacitor game): no pinch-zoom/pull-to-refresh,
   no long-press text selection or blue tap-highlight, and respect the notch via safe-area insets. */
body{overflow:hidden;overscroll-behavior:none;touch-action:manipulation;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.hud{padding-top:calc(12px + env(safe-area-inset-top))}
.panel{padding-bottom:calc(14px + env(safe-area-inset-bottom))}
.campaign-run-node{flex-wrap:wrap}.campaign-run-choices{flex-basis:100%;display:grid;gap:4px}.campaign-run-choice{display:flex;justify-content:space-between;gap:6px;padding:5px 7px;font-size:11px}
button,select,input{font:inherit}button,select{border:1px solid var(--border);border-radius:6px;background:#111611;color:var(--text);padding:8px 10px}button{cursor:pointer}button:hover{border-color:var(--accent)}button:focus-visible,select:focus-visible,input:focus-visible,#playfield:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button[aria-pressed="true"]{border-color:var(--danger);color:var(--danger)}#app{height:100%;display:flex;flex-direction:column}.hud{display:flex;gap:18px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--surface)}h1{font-size:18px;line-height:1.1;margin:0;color:var(--accent);letter-spacing:0}p{margin:4px 0 0;color:var(--muted)}.controls{margin-left:auto;display:flex;gap:10px;align-items:end;flex-wrap:wrap}.controls label{display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:12px}.play-shell{min-height:0;flex:1;display:grid;grid-template-columns:minmax(0,1fr) 280px}#playfield{width:100%;height:100%;display:block;background:#101410;overflow:hidden;background-position:center;background-size:cover;background-repeat:no-repeat;touch-action:none}#playfield canvas{display:block}.panel{border-left:1px solid var(--border);background:var(--panel);padding:14px;display:flex;flex-direction:column;gap:10px;overflow:auto}.stat{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)}.stat span{color:var(--muted)}.stat strong{font-variant-numeric:tabular-nums}.targeting{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:center;color:var(--muted);font-size:13px}.targeting select{min-width:0}.speed{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;color:var(--muted);margin-top:8px}#message{min-height:42px;padding:10px;border:1px solid var(--border);border-radius:6px;background:#161a16;color:var(--text)}.ability-bar{display:flex;flex-wrap:wrap;gap:6px}.ability-bar:empty{display:none}.ability-bar button{padding:6px 9px;font-size:12px}.ability-bar button.armed{border-color:var(--accent);color:var(--accent)}.ability-bar button:disabled{opacity:.45;cursor:default}.roguelite-status{display:grid;gap:5px;border-top:1px solid var(--border);padding-top:10px}.roguelite-status[hidden]{display:none}.roguelite-status strong{font-size:12px;color:var(--accent)}.roguelite-status span{font-size:12px;color:var(--muted)}.campaign-run-panel{display:grid;gap:7px;border-top:1px solid var(--border);padding-top:10px}.campaign-run-panel[hidden]{display:none}.campaign-run-panel>strong{font-size:12px;color:var(--accent)}.campaign-run-panel>span,.campaign-run-nodes{font-size:12px;color:var(--muted)}.campaign-run-nodes{display:grid;gap:4px}.campaign-run-node{display:flex;justify-content:space-between;gap:8px}.campaign-run-node[data-state="available"]{color:var(--accent)}.campaign-run-node[data-state="current"]{color:var(--text);font-weight:700}.campaign-run-actions{display:flex;gap:6px;flex-wrap:wrap}.campaign-run-actions button{padding:5px 7px;font-size:11px}.meta-panel{border-top:1px solid var(--border);padding-top:10px}.meta-title{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:12px;text-transform:uppercase}.meta-upgrades{display:grid;gap:6px;margin-top:8px}.meta-upgrade{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center;padding:7px;border:1px solid var(--border);border-radius:6px;background:#161a16}.meta-upgrade span{min-width:0;font-size:12px}.meta-upgrade button{padding:5px 7px;font-size:11px}.boot-error,.story-overlay{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:24px;background:#0b0e0bdd}.boot-error[hidden],.story-overlay[hidden]{display:none}.boot-error-panel{width:min(460px,100%);padding:22px;border:1px solid var(--danger);border-radius:6px;background:var(--surface);box-shadow:0 20px 60px #0009}.boot-error-panel h2{margin:0 0 8px;font-size:20px}.boot-error-actions,.story-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}.story-panel{width:min(820px,100%);max-height:min(680px,90vh);display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);overflow:hidden;border:1px solid var(--border);border-radius:6px;background:var(--surface);box-shadow:0 20px 60px #0009}.story-art{min-height:360px;background-position:center;background-size:cover;background-repeat:no-repeat;background-color:#101410}.story-copy{padding:24px;align-self:end}.story-copy h2{margin:0 0 18px;font-size:24px}.story-speaker{min-height:18px;color:var(--accent);font-weight:700}.story-text{color:var(--text);font-size:16px;line-height:1.55;white-space:pre-wrap}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}@media(max-width:820px){body{overflow:auto}.hud{align-items:flex-start;flex-direction:column}.controls{margin-left:0}.play-shell{grid-template-columns:1fr;grid-template-rows:65vh auto}.panel{border-left:0;border-top:1px solid var(--border)}.story-panel{grid-template-columns:1fr}.story-art{min-height:220px}.story-copy{padding:18px}}`;
}

function playerProfileRuntimeTemplate() {
  return `// TOWERFORGE_PROFILE_RUNTIME_BEGIN
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
// TOWERFORGE_PROFILE_RUNTIME_END`;
}

function arsenalPlayerRuntimeTemplate() {
  return `function updateArsenalStatus(snap) {
  const panel = $("arsenal-status");
  if (!panel) return;
  const presentation = projectArsenalPresentation(snap);
  panel.replaceChildren();
  panel.hidden = !presentation?.active;
  if (!presentation?.active) return;
  const heading = document.createElement("strong");
  heading.textContent = "Modular Arsenal";
  panel.append(heading);
  const tower = presentation.towers.find((entry) => entry.towerId === selectedTowerId);
  if (tower) {
    const selects = {};
    for (const category of ["base", "barrel", "core"]) {
      const label = document.createElement("label");
      label.textContent = category;
      const select = document.createElement("select");
      select.dataset.arsenalCategory = category;
      for (const option of tower.availableModules[category]) {
        const element = document.createElement("option");
        element.value = option.id;
        element.textContent = option.label;
        element.selected = option.id === tower.modules[category];
        select.append(element);
      }
      label.append(select);
      panel.append(label);
      selects[category] = select;
    }
    const apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = "Apply modules";
    apply.disabled = !presentation.managementAllowed;
    apply.addEventListener("click", () => {
      const result = dispatchGameCommand(game, {
        schemaVersion: 7, type: "configureTowerModules", towerId: tower.towerId,
        modules: { base: selects.base.value, barrel: selects.barrel.value, core: selects.core.value }
      });
      report(result);
      if (result.ok) updateArsenalStatus(game.getSnapshot());
    });
    panel.append(apply);
    const stats = document.createElement("span");
    stats.textContent = "Damage ×" + tower.damageMultiplier + " · range ×" + tower.rangeMultiplier + " · durability ×" + tower.durabilityMultiplier;
    panel.append(stats);
  } else if (presentation.towers.length) {
    const note = document.createElement("span");
    note.textContent = "Select a tower to configure its modules.";
    panel.append(note);
  }
  const inventory = projectRoguelitePresentation(snap)?.artifacts?.inventory ?? [];
  for (const recipe of presentation.craftingRecipes) {
    const available = inventory.filter((entry) => !entry.socket);
    const used = new Set();
    const cells = recipe.pattern.map((cell) => {
      const artifact = available.find((entry) => entry.artifactId === cell.artifactId && !used.has(entry.instanceId));
      if (artifact) used.add(artifact.instanceId);
      return artifact ? { x: cell.x, y: cell.y, artifactInstanceId: artifact.instanceId } : null;
    });
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.craftRecipe = recipe.id;
    button.textContent = "Craft " + recipe.outputArtifactId;
    button.disabled = !presentation.managementAllowed || cells.some((cell) => cell === null);
    button.addEventListener("click", () => {
      const result = dispatchGameCommand(game, { schemaVersion: 7, type: "craftGem", recipeId: recipe.id, cells });
      report(result);
      if (result.ok) { updateRogueliteStatus(game.getSnapshot()); updateArsenalStatus(game.getSnapshot()); }
    });
    panel.append(button);
  }
}`;
}

function playerTemplate(includeMultiplayer = false) {
  return `import {
  createCampaignRun,
  createEmptyPlayerProfile,
  createGameContentRegistry,
  dispatchGameCommand,
  exportCampaignRun,
  getAvailableCampaignNodeIds,
  getPlayerProfileLaunchOptions,
  importCampaignRun,
  isPlayerMissionUnlocked,
  parsePlayerProfileJson,
  prepareCampaignBattle,
  purchasePlayerMetaUpgrade,
  recordCampaignBattleVictory,
  recordPlayerMissionClear,
  resolveCampaignStructuralChoice,
  resolveWorldCampaign,
  selectPlayerDifficulty,
  serializePlayerProfile,
  settleCampaignBattleVictory,
  TowerDefenseGame,
  validateCampaignRunAgainstContent
} from "./engine/index.js";
${includeMultiplayer ? 'import * as TowerForgeMultiplayer from "./engine/multiplayer/index.js";' : ""}
import { createPlayerProfileStore, derivePlayerProfileStorageKey } from "./player-runtime/index.mjs";
import { createCanvasRenderer, hitTestHeroesPresentation, projectArsenalPresentation, projectCampaignPresentation, projectDirectorDecisionCues, projectElevationCues, projectHeroPresentationPoint, projectHeroesPresentation, projectLogisticsPresentation, projectNavigationPlacementCues, projectPhysicsPresentationCues, projectProceduralJuicePresentation, projectQuestPresentation, projectRoguelitePresentation, projectVanguardProtectionPresentation, selectHeroAbilityEnemy } from "./renderer/index.mjs";
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
${includeMultiplayer ? "globalThis.__towerforgeMultiplayer = TowerForgeMultiplayer;" : ""}

${playerProfileRuntimeTemplate()}
${arsenalPlayerRuntimeTemplate()}

const $ = (id) => document.getElementById(id);
applyProjectTheme();
const audio = createAudioPlayer({ audio: project.visuals && project.visuals.audio });
const canvas = $("playfield");
let missionId = content.defaultMissionId || Object.keys(content.missions)[0];
let towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
let game = new TowerDefenseGame({ missionId, content, ...currentPlayerLaunchOptions() });
const activeCampaign = resolveWorldCampaign(content);
let campaignRun = activeCampaign ? createCampaignRun("campaign") : null;
let pendingCampaignNodeId = null;
let pendingCampaignBattle = false;
const renderer = createCanvasRenderer({ canvas, content, theme: content.visuals?.theme?.renderer });
let lastFrame = performance.now();
let message = "Choose a tower, click a buildable tile, then start the wave.";
let targetingMode = { kind: "build" };
let selectedTowerId = null;
let keyboardCoord = null;
let navigationHoverCoord = null;
let navigationOverlayPlacementState = null;
let navigationOverlayFieldState = null;
let lastRunningSpeed = 1;
let activeStory = null;
let storyWasRunning = false;
let victoryRewarded = false;
let lastObservedEvents = [];
const shownStories = new Set();

initSelectors();
syncKeyboardCursor(null);
initAbilityBar();
renderMetaPanel();
setupCampaignRunControls();
updateCampaignRun();
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
$("sell-mode").addEventListener("click", () => setSellMode(targetingMode.kind !== "sell"));
$("reset-run").addEventListener("click", () => { game.reset(); renderer.resetProceduralJuicePresentation(); audio.disposeProceduralVoices(); victoryRewarded = false; selectedTowerId = null; setTargetingMode({ kind: "build" }); initAbilityBar(); clearNavigationOverlay(); message = "Run reset."; });
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
  if (tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
  if (event.code === "Space") { event.preventDefault(); setPaused(Number($("speed").value) > 0); return; }
  if (document.activeElement !== canvas) return;
  if (event.code === "Digit1") { event.preventDefault(); armCurrentHeroAbility(); return; }
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (moves[event.key]) { event.preventDefault(); moveKeyboardCursor(moves[event.key][0], moves[event.key][1]); }
  else if (event.key === "Enter") { event.preventDefault(); const coord = ensureKeyboardCoord(); actAtCoord(coord, hitTestHeroAtCoord(coord), hitTestHeroAbilityEnemyAtCoord(coord)); }
  else if (event.key === "Escape") { event.preventDefault(); setTargetingMode({ kind: "build" }); message = "Build action cancelled."; }
});
syncSpeedUi();
syncAudioSettings();
applyBattleBackground();
selectMissionMusic();
showStoryForMission("beforeMission");
window.__towerforgeInspect = () => {
  const snapshot = game.getRenderSnapshot();
  if (snapshot.lastEvents.length === 0 && lastObservedEvents.length > 0) {
    snapshot.lastEvents = lastObservedEvents;
  }
  return snapshot;
};
window.render_game_to_text = () => {
  const snapshot = window.__towerforgeInspect();
  const vanguardProtection = projectVanguardProtectionPresentation(snapshot);
  return JSON.stringify({
    coordinateSystem: "tile coordinates: q increases right/east; r increases down/south",
    missionId: snapshot.missionId,
    outcome: snapshot.outcome,
    coreHp: snapshot.coreHp,
    maxCoreHp: snapshot.maxCoreHp,
    waveState: snapshot.waveState,
    startedWaveCount: snapshot.startedWaveCount,
    resources: snapshot.resources,
    towers: snapshot.towers.map((tower) => ({ id: tower.id, typeId: tower.typeId, coord: tower.coord })),
    enemies: snapshot.enemies.map((enemy) => ({
      id: enemy.id, typeId: enemy.typeId, hp: enemy.hp,
      coord: enemy.navigation?.currentCoord ?? null, routeProgress: enemy.pathProgress
    })),
    ...(vanguardProtection.active ? { vanguardProtection } : {})
  });
};
window.__towerforgeCampaignInspect = () => ({
  active: Boolean(activeCampaign && campaignRun),
  run: campaignRun ? JSON.parse(exportCampaignRun(campaignRun)) : null,
  pendingNodeId: pendingCampaignNodeId,
  availableNodeIds: activeCampaign && campaignRun ? [...getAvailableCampaignNodeIds(campaignRun, content)] : []
});
window.__towerforgeTilePoint = (coord) => {
  const snapshot = game.getRenderSnapshot();
  const point = renderer.center(coord, renderer.geometry(snapshot.tiles, snapshot.grid));
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + point.x * rect.width / canvas.width, y: rect.top + point.y * rect.height / canvas.height };
};
window.__towerforgeEnemyPoint = (enemyId) => {
  const snapshot = game.getRenderSnapshot();
  const enemy = snapshot.enemies.find((candidate) => candidate.id === enemyId);
  if (!enemy) return null;
  const geom = renderer.geometry(snapshot.tiles, snapshot.grid);
  const point = renderer.enemyPoint(enemy, snapshot, geom);
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
  actAtCoord(coord, hitTestHeroAtPointer(event), hitTestHeroAbilityEnemyAtPointer(event));
});

function heroMovementPresentation() {
  const snapshot = game.getRenderSnapshot();
  const presentation = projectHeroesPresentation(snapshot);
  return presentation.active && presentation.units.every((hero) => hero.movement)
    ? { snapshot, presentation }
    : null;
}

function hitTestHeroAtCoord(coord) {
  const source = heroMovementPresentation();
  if (!source || !coord) return null;
  const geom = renderer.geometry(source.snapshot.tiles, source.snapshot.grid);
  const point = renderer.center(coord, geom);
  return hitTestHeroesPresentation(source.presentation, point, (candidate) => renderer.center(candidate, geom), geom.r * 0.7);
}

function hitTestHeroAtPointer(event) {
  const source = heroMovementPresentation();
  if (!source) return null;
  const rect = canvas.getBoundingClientRect();
  const geom = renderer.geometry(source.snapshot.tiles, source.snapshot.grid);
  const point = { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
  return hitTestHeroesPresentation(source.presentation, point, (candidate) => renderer.center(candidate, geom), geom.r * 0.7);
}

function hitTestHeroAbilityEnemyAtCoord(coord) {
  if (targetingMode.kind !== "heroAbility" || !coord) return null;
  const snapshot = game.getRenderSnapshot();
  const geom = renderer.geometry(snapshot.tiles, snapshot.grid);
  return selectHeroAbilityEnemy(
    snapshot.enemies,
    renderer.center(coord, geom),
    (enemy) => renderer.enemyPoint(enemy, snapshot, geom)
  );
}

function hitTestHeroAbilityEnemyAtPointer(event) {
  if (targetingMode.kind !== "heroAbility") return null;
  const snapshot = game.getRenderSnapshot();
  const rect = canvas.getBoundingClientRect();
  const geom = renderer.geometry(snapshot.tiles, snapshot.grid);
  const point = {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height
  };
  return selectHeroAbilityEnemy(
    snapshot.enemies,
    point,
    (enemy) => renderer.enemyPoint(enemy, snapshot, geom),
    geom.r * 0.62
  );
}

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
  if (!coord || !towerId || targetingMode.kind !== "build") {
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

function actAtCoord(coord, heroHitId = null, enemyHitId = null) {
  if (!coord) return;
  if (targetingMode.kind === "sell") {
    const towerAt = game.getTowerIdAt(coord);
    report(towerAt ? game.sellTower(towerAt) : { ok: false, reason: "Choose a tower tile." });
    if (towerAt === selectedTowerId) selectedTowerId = null;
    setSellMode(false);
    return;
  }
  if (targetingMode.kind === "missionAbility") {
    report(game.useAbility(targetingMode.abilityId, coord));
    setTargetingMode({ kind: "build" });
    return;
  }
  if (targetingMode.kind === "heroAbility") {
    if (!enemyHitId) { message = "Choose a live enemy target."; return; }
    const result = dispatchGameCommand(game, {
      schemaVersion: 5,
      type: "useHeroAbility",
      heroId: targetingMode.heroId,
      abilityId: targetingMode.abilityId,
      targetEnemyId: enemyHitId
    });
    report(result);
    if (result.ok) setTargetingMode({ kind: "build" });
    return;
  }
  if (targetingMode.kind === "heroMove") {
    const result = dispatchGameCommand(game, {
      schemaVersion: 4, type: "moveHero", heroId: targetingMode.heroId,
      target: { q: coord.q, r: coord.r }
    });
    report(result);
    if (result.ok) setTargetingMode({ kind: "build" });
    return;
  }
  if (heroHitId) { setTargetingMode({ kind: "heroMove", heroId: heroHitId }); selectedTowerId = null; message = "Hero selected. Choose a destination."; return; }
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
  renderer.resetProceduralJuicePresentation();
  audio.disposeProceduralVoices();
  return new TowerDefenseGame({ missionId, content, ...currentPlayerLaunchOptions() });
}

function setSellMode(active) {
  setTargetingMode(active ? { kind: "sell" } : { kind: "build" });
  if (active) message = "Click a tower to sell it.";
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
    pendingCampaignNodeId = null;
    pendingCampaignBattle = false;
    missionId = missionSelect.value;
    towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
    game = createGame();
    setTargetingMode({ kind: "build" });
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
  select.innerHTML = content.difficulties.map((item) => \`<option value="\${escapeHtml(item.id)}">\${escapeHtml(item.label || item.id)}</option>\`).join("");
  select.value = currentPlayerLaunchOptions().difficultyId;
  select.onchange = () => {
    const result = choosePlayerDifficulty(select.value);
    if (!result.ok) { select.value = currentPlayerLaunchOptions().difficultyId; return; }
    game = createGame();
    setTargetingMode({ kind: "build" });
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
    return \`<option value="\${escapeHtml(id)}">\${escapeHtml(tower?.label || id)}</option>\`;
  }).join("");
  towerId = ids[0] || "";
  towerSelect.value = towerId;
  // Assigning onchange (vs addEventListener) keeps a single handler when missions switch.
  towerSelect.onchange = () => { towerId = towerSelect.value; refreshNavigationOverlay(); };
}

function setTargetingMode(next) {
  targetingMode = next;
  $("sell-mode").setAttribute("aria-pressed", String(targetingMode.kind === "sell"));
  for (const btn of document.querySelectorAll("#ability-bar button")) {
    btn.classList.toggle("armed", targetingMode.kind === "missionAbility" && btn.dataset.aid === targetingMode.abilityId);
  }
  const heroButton = document.querySelector("#hero-action-bar button");
  if (heroButton) heroButton.classList.toggle("armed", targetingMode.kind === "heroAbility");
  if (targetingMode.kind === "build") refreshNavigationOverlay(); else clearNavigationOverlay();
}
function setArmed(id) {
  if (!id) { setTargetingMode({ kind: "build" }); return; }
  setTargetingMode({ kind: "missionAbility", abilityId: id });
  message = "Click the map to use " + ((game.getSnapshot().abilities[id] || {}).label || id) + ".";
}
function initAbilityBar() {
  const bar = $("ability-bar");
  if (!bar) return;
  const abilities = Object.values(game.getSnapshot().abilities || {});
  bar.innerHTML = abilities.map((a) => \`<button data-aid="\${escapeHtml(a.id)}" title="Radius \${a.radius}, cooldown \${a.cooldown}">\${escapeHtml(a.label || a.id)}</button>\`).join("");
  setTargetingMode({ kind: "build" });
  for (const btn of bar.querySelectorAll("button")) {
    btn.onclick = () => { audio.resume(); setArmed(
      targetingMode.kind === "missionAbility" && targetingMode.abilityId === btn.dataset.aid
        ? null
        : btn.dataset.aid
    ); };
  }
}
function updateAbilityBar(snap) {
  for (const btn of document.querySelectorAll("#ability-bar button")) {
    const a = snap.abilities ? snap.abilities[btn.dataset.aid] : null;
    const ready = !!a && a.ready;
    btn.disabled = !ready;
    const cd = Math.ceil((a && a.cooldownRemaining) || 0);
    btn.textContent = ((a && a.label) || btn.dataset.aid) + (cd > 0 ? " (" + cd + ")" : "");
    if (!ready && targetingMode.kind === "missionAbility" && targetingMode.abilityId === btn.dataset.aid) setArmed(null);
  }
}

function activeHeroAbilityUnit(snapshot = game.getRenderSnapshot()) {
  const presentation = projectHeroesPresentation(snapshot);
  const hero = presentation.active && presentation.units.length === 1
    ? presentation.units[0]
    : null;
  return hero?.activeAbility && hero?.mana ? hero : null;
}

function armCurrentHeroAbility() {
  const hero = activeHeroAbilityUnit();
  if (!hero || !hero.activeAbility.ready) return;
  setTargetingMode({ kind: "heroAbility", heroId: hero.id, abilityId: hero.activeAbility.id });
  message = "Choose a live enemy for " + hero.activeAbility.label + ".";
}

function updateHeroActionBar(snap) {
  const hero = activeHeroAbilityUnit(snap);
  let bar = document.getElementById("hero-action-bar");
  if (!hero) {
    if (bar) bar.remove();
    if (targetingMode.kind === "heroAbility") setTargetingMode({ kind: "build" });
    return;
  }
  if (!bar) {
    bar = document.createElement("section");
    bar.id = "hero-action-bar";
    bar.className = "ability-bar hero-action-bar";
    bar.setAttribute("aria-label", "Hero actions");
    $("message").before(bar);
  }
  let button = bar.querySelector("button");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => {
      audio.resume();
      if (targetingMode.kind === "heroAbility") setTargetingMode({ kind: "build" });
      else armCurrentHeroAbility();
    });
    bar.append(button);
  }
  let status = bar.querySelector("span");
  if (!status) { status = document.createElement("span"); bar.append(status); }
  const ability = hero.activeAbility;
  button.disabled = !ability.ready;
  button.dataset.heroId = hero.id;
  button.dataset.abilityId = ability.id;
  button.classList.toggle("armed", targetingMode.kind === "heroAbility");
  const cooldown = Math.ceil(ability.cooldownRemaining);
  button.textContent = ability.label + " [1]" + (cooldown > 0 ? " (" + cooldown + ")" : "");
  button.title = "Mana " + hero.mana.current + "/" + hero.mana.max + " · Cost " + ability.manaCost;
  status.textContent = "Mana " + hero.mana.current + "/" + hero.mana.max
    + " (+" + hero.mana.regenerationPerUnit + ")";
  bar.dataset.manaCurrent = String(hero.mana.current);
  bar.dataset.manaMax = String(hero.mana.max);
  bar.dataset.cooldownRemaining = String(ability.cooldownRemaining);
  if (!ability.ready && targetingMode.kind === "heroAbility") setTargetingMode({ kind: "build" });
}

function updateHeroSkillTree(snap) {
  const presentation = projectHeroesPresentation(snap);
  const unit = presentation.active && presentation.units.length === 1
    ? presentation.units[0]
    : null;
  const skills = unit?.skills;
  let panel = document.getElementById("hero-skill-tree");
  const panelCreated = !panel;
  if (!skills) {
    if (panel) panel.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "hero-skill-tree";
    panel.className = "roguelite-status hero-skill-tree";
    panel.setAttribute("aria-label", "Hero skill tree");
    const heading = document.createElement("strong");
    heading.textContent = "Hero skills";
    const status = document.createElement("span");
    status.dataset.heroSkillPoints = "true";
    const nodes = document.createElement("div");
    nodes.dataset.heroSkillNodes = "true";
    panel.append(heading, status, nodes);
    $("message").before(panel);
  }
  const status = panel.querySelector("[data-hero-skill-points]");
  panel.dataset.availablePoints = String(skills.availablePoints);
  status.textContent = "Available points: " + skills.availablePoints;
  const nodes = panel.querySelector("[data-hero-skill-nodes]");
  const retained = new Set();
  for (let nodeIndex = 0; nodeIndex < skills.nodes.length; nodeIndex += 1) {
    const node = skills.nodes[nodeIndex];
    retained.add(node.id);
    let button = [...nodes.querySelectorAll("button")]
      .find((candidate) => candidate.dataset.heroSkillId === node.id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.heroSkillId = node.id;
      button.addEventListener("click", () => {
        const result = dispatchGameCommand(game, {
          schemaVersion: 6,
          type: "unlockHeroSkill",
          heroId: button.dataset.heroId,
          skillId: button.dataset.heroSkillId
        });
        report(result);
        updateHeroSkillTree(game.getRenderSnapshot());
      });
      button.addEventListener("touchend", (event) => {
        event.preventDefault();
        button.click();
      }, { passive: false });
    }
    button.dataset.heroId = unit.id;
    button.disabled = !skills.managementAvailable || !node.unlockable;
    button.textContent = (node.unlocked ? "Unlocked: " : "Unlock: ")
      + node.label + " (" + node.cost + ")";
    button.title = node.description;
    if (nodes.children[nodeIndex] !== button) {
      nodes.insertBefore(button, nodes.children[nodeIndex] ?? null);
    }
  }
  for (const button of [...nodes.querySelectorAll("button")]) {
    if (!retained.has(button.dataset.heroSkillId)) button.remove();
  }
  if (panelCreated) panel.scrollIntoView({ block: "nearest" });
}

function updateCampaignRun() {
  const panel = $("campaign-run-panel");
  if (!panel) return;
  const presentation = projectCampaignPresentation(activeCampaign && campaignRun ? {
    campaign: activeCampaign,
    run: campaignRun,
    availableNodeIds: getAvailableCampaignNodeIds(campaignRun, content)
  } : undefined) || projectCampaignPresentation();
  panel.hidden = !presentation.active;
  if (!presentation.active) return;
  const resourceSummary = (presentation.runResources || [])
    .map((resource) => resource.label + ": " + resource.amount)
    .join(" · ");
  $("campaign-run-summary").textContent = (pendingCampaignNodeId
    ? "Battle selected: " + pendingCampaignNodeId
    : presentation.currentNodeId
      ? "Current: " + presentation.currentNodeId
      : "Choose an available entry node") + (resourceSummary ? " · " + resourceSummary : "");
  const nodes = $("campaign-run-nodes");
  nodes.replaceChildren();
  for (const node of presentation.nodes) {
    const hasChoices = Array.isArray(node.choices) && node.choices.length > 0;
    const row = document.createElement(node.state === "available" && !hasChoices ? "button" : "div");
    if (row instanceof HTMLButtonElement) {
      row.type = "button";
      row.addEventListener("click", () => selectCampaignNode(node.id));
    }
    row.className = "campaign-run-node";
    row.setAttribute("data-state", node.state);
    const title = document.createElement("span");
    title.textContent = node.label || content.missions[node.missionId]?.label || node.missionId || node.id;
    const state = document.createElement("span");
    state.textContent = node.type + " · " + node.state;
    row.append(title, state);
    if (node.state === "available" && hasChoices) {
      const choices = document.createElement("div");
      choices.className = "campaign-run-choices";
      for (const choice of node.choices) {
        const choiceButton = document.createElement("button");
        choiceButton.type = "button";
        choiceButton.className = "campaign-run-choice";
        choiceButton.setAttribute("data-campaign-choice-id", choice.id);
        choiceButton.textContent = formatCampaignChoice(choice, presentation.runResources || []);
        choiceButton.title = "Resolve campaign choice";
        choiceButton.addEventListener("click", () => selectCampaignChoice(node.id, choice.id));
        choices.append(choiceButton);
      }
      row.append(choices);
    }
    nodes.append(row);
  }
}

function formatCampaignChoice(choice, resources) {
  const label = (resourceId) => resources.find((entry) => entry.id === resourceId)?.label || resourceId;
  const costs = choice.costs.map((entry) => label(entry.resourceId) + ":" + entry.amount).join(", ") || "free";
  const grants = choice.grants.map((entry) => label(entry.resourceId) + ":" + entry.amount).join(", ") || "none";
  return choice.label + " · " + costs + " → " + grants;
}

function selectCampaignChoice(nodeId, choiceId) {
  if (!activeCampaign || !campaignRun) return;
  const result = resolveCampaignStructuralChoice(campaignRun, content, nodeId, choiceId);
  if (result.ok) {
    campaignRun = result.run;
    pendingCampaignNodeId = null;
    pendingCampaignBattle = false;
    message = "Campaign choice resolved: " + choiceId + ".";
    updateCampaignRun();
    return;
  }
  message = "Campaign choice rejected: " + result.code + ".";
  updateCampaignRun();
}

function selectCampaignNode(nodeId) {
  if (!activeCampaign || !campaignRun) return;
  const prepared = prepareCampaignBattle(campaignRun, content, nodeId);
  if (prepared.ok) {
    pendingCampaignBattle = true;
    pendingCampaignNodeId = prepared.nodeId;
    missionId = prepared.missionId;
    game = prepared.game;
  } else if (prepared.code === "campaign_handoff_inactive") {
    // Campaign marker v1 retains the legacy graph reducer without battle carry.
    const availableNodeIds = getAvailableCampaignNodeIds(campaignRun, content);
    const node = activeCampaign.nodes.find((candidate) => candidate.id === nodeId);
    if (!availableNodeIds.includes(nodeId) || !node || node.type === "merchant" || node.type === "event") {
      message = "Campaign node is not available.";
      return;
    }
    pendingCampaignBattle = false;
    pendingCampaignNodeId = node.id;
    missionId = node.missionId;
    game = createGame();
  } else {
    message = "Campaign battle could not be prepared: " + prepared.code + ".";
    return;
  }
  towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
  setTargetingMode({ kind: "build" });
  refreshMissionOptions();
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
  message = "Campaign battle selected: " + nodeId + ".";
  updateCampaignRun();
}

function setupCampaignRunControls() {
  const exportButton = $("campaign-run-export");
  const importButton = $("campaign-run-import");
  const fileInput = $("campaign-run-file");
  if (!exportButton || !importButton || !fileInput) return;
  exportButton.addEventListener("click", () => {
    if (!campaignRun) return;
    const source = exportCampaignRun(campaignRun);
    const url = URL.createObjectURL(new Blob([source], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "towerforge-campaign-run.json";
    link.click();
    URL.revokeObjectURL(url);
  });
  importButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    if (pendingCampaignNodeId) {
      fileInput.value = "";
      message = "Campaign run import cannot replace an active battle.";
      return;
    }
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file || !activeCampaign) return;
    if (file.size > 1_048_576) {
      message = "Campaign run import failed: file exceeds 1 MiB.";
      return;
    }
    try {
      const decoded = importCampaignRun(await file.text()).run;
      const validation = validateCampaignRunAgainstContent(decoded, content);
      if (!validation.ok) throw new Error("Campaign run is incompatible with this project: " + validation.code);
      pendingCampaignNodeId = null;
      pendingCampaignBattle = false;
      campaignRun = validation.run;
      message = "Campaign run imported.";
      updateCampaignRun();
    } catch (error) {
      message = "Campaign run import failed: " + error.message;
    }
  });
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
  if (events.length > 0) lastObservedEvents = events;
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
  projectPhysicsPresentationCues(snap);
  const directorCue = projectDirectorDecisionCues(snap).at(-1);
  if (directorCue) message = directorCue.label;
  const questPresentation = projectQuestPresentation(snap);
  const questCue = questPresentation?.cues.at(-1);
  if (questCue) {
    const entry = questPresentation.entries.find((candidate) => candidate.questId === questCue.questId);
    message = \`\${questCue.type === "completed" ? "Challenge completed" : "Challenge failed"}: \${entry?.label ?? questCue.questId}\`;
  }
  renderer.drawSnapshot(snap);
  const proceduralCues = renderer.drainProceduralAudioCues();
  if ($("snd")?.checked) audio.handleEvents(events, { proceduralCues });
}

function updateHud(snap) {
  updateAbilityBar(snap);
  updateHeroActionBar(snap);
  updateHeroSkillTree(snap);
  updateTargetMode(snap);
  updateRogueliteStatus(snap);
  updateArsenalStatus(snap);
  updateLogisticsStatus(snap);
  updateQuestStatus(snap);
  if (snap.outcome === "victory" && !victoryRewarded) {
    victoryRewarded = true;
    const earnedStars = (snap.stars || []).filter((item) => item.achieved).length;
    if (activeCampaign && campaignRun && pendingCampaignNodeId) {
      const result = pendingCampaignBattle
        ? settleCampaignBattleVictory(campaignRun, progress, content, pendingCampaignNodeId, earnedStars, game)
        : recordCampaignBattleVictory(campaignRun, progress, content, pendingCampaignNodeId, earnedStars);
      if (result.ok) {
        campaignRun = result.run;
        progress = result.profile;
        persistPlayerProfile();
        renderMetaPanel();
        message = "Campaign battle recorded. Available: " + (result.newlyAvailableNodeIds.join(", ") || "none");
      } else {
        message = "Campaign battle could not be recorded: " + result.code;
      }
      pendingCampaignNodeId = null;
      pendingCampaignBattle = false;
      updateCampaignRun();
    } else {
      recordPlayerVictory(missionId, earnedStars);
    }
    refreshMissionOptions();
    showStoryForMission("afterVictory");
  }
  $("mission-caption").textContent = content.missions[missionId]?.description || content.missions[missionId]?.label || missionId;
  $("stat-outcome").textContent = snap.outcome;
  $("stat-core").textContent = \`\${snap.coreHp}/\${snap.maxCoreHp}\`;
  $("stat-resources").textContent = Object.entries(snap.resources).map(([id, value]) => { const c = (content.currencies || []).find((c) => c.id === id); return \`\${c ? c.label : id}: \${value}\`; }).join(" · ");
  $("stat-wave").textContent = \`\${snap.startedWaveCount}/\${snap.totalWaves} \${snap.waveState}\`;
  $("stat-enemies").textContent = String(snap.enemies.length);
  $("stat-towers").textContent = String(snap.towers.length);
  const objectives = snap.objectiveProgress || [];
  const stars = snap.stars || [];
  $("stat-objectives").textContent = objectives.filter((item) => item.complete).length + "/" + objectives.length
    + (stars.length ? " | " + stars.filter((item) => item.achieved).length + "/" + stars.length + " stars" : "");
  $("message").textContent = playerProfileStatusText(message);
}

function updateRogueliteStatus(snap) {
  const panel = $("roguelite-status");
  const draftPanel = $("wave-draft");
  const artifactPanel = $("artifact-inventory");
  if (!panel || !draftPanel || !artifactPanel) return;
  const source = snap?.roguelite;
  const nextCache = {
    synergies: source?.synergies,
    inventory: source?.artifacts?.inventory,
    towerSlots: source?.artifacts?.towerSlots,
    allowed: source?.artifacts?.management?.allowed,
    reasonKey: source?.artifacts?.management?.reasonKey,
    pendingOffer: source?.draft?.pendingOffer,
    selections: source?.draft?.selections,
    selectedTowerId
  };
  const previousCache = updateRogueliteStatus.lastRender;
  if (previousCache
    && previousCache.synergies === nextCache.synergies
    && previousCache.inventory === nextCache.inventory
    && previousCache.towerSlots === nextCache.towerSlots
    && previousCache.allowed === nextCache.allowed
    && previousCache.reasonKey === nextCache.reasonKey
    && previousCache.pendingOffer === nextCache.pendingOffer
    && previousCache.selections === nextCache.selections
    && previousCache.selectedTowerId === nextCache.selectedTowerId) return;
  updateRogueliteStatus.lastRender = nextCache;
  const presentation = projectRoguelitePresentation(snap);
  if (!presentation) { panel.hidden = true; panel.replaceChildren(); draftPanel.hidden = true; draftPanel.replaceChildren(); artifactPanel.hidden = true; artifactPanel.replaceChildren(); return; }
  panel.hidden = !presentation.active;
  panel.replaceChildren();
  draftPanel.hidden = !presentation.active || !presentation.draft?.pendingOffer;
  draftPanel.replaceChildren();
  artifactPanel.hidden = !presentation.active || !presentation.artifacts;
  artifactPanel.replaceChildren();
  if (!presentation.active) return;
  for (const synergy of presentation.synergies) {
    const row = document.createElement("span");
    const active = synergy.activeTierRequiredCounts.length
      ? "active " + synergy.activeTierRequiredCounts.join("/")
      : "inactive";
    row.textContent = synergy.label + ": " + synergy.towerCount + " towers (" + active + ")";
    panel.append(row);
  }
  const pendingOffer = presentation.draft?.pendingOffer;
  if (pendingOffer) {
    const title = document.createElement("strong");
    title.textContent = "Choose a wave upgrade";
    draftPanel.append(title);
    for (const option of pendingOffer.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-draft-card-id", option.cardId);
      button.textContent = option.label;
      button.addEventListener("click", () => {
        const result = dispatchGameCommand(game, {
          schemaVersion: 3, type: "chooseDraftOption",
          offerId: pendingOffer.offerId,
          cardId: option.cardId
        });
        report(result);
        if (result.ok) updateRogueliteStatus(game.getSnapshot());
      });
      draftPanel.append(button);
    }
  }
  if (presentation.artifacts) {
    const title = document.createElement("strong");
    title.textContent = "Artifacts (" + presentation.artifacts.inventory.length + ")";
    artifactPanel.append(title);
    for (const artifact of presentation.artifacts.inventory) {
      const row = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = artifact.label + " · " + artifact.slotType
        + (artifact.socket ? " → " + artifact.socket.towerId + "/" + artifact.socket.slotId : "");
      row.append(label);
      const addAction = (action, text, activate) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-artifact-action", action);
        button.textContent = text;
        button.disabled = presentation.artifacts.management?.allowed !== true;
        button.addEventListener("click", () => {
          const result = activate();
          report(result);
          if (result.ok) updateRogueliteStatus(game.getSnapshot());
        });
        row.append(button);
      };
      if (artifact.socket) {
        addAction("unsocket", "Unsocket", () => dispatchGameCommand(game, {
          schemaVersion: 2, type: "unsocketArtifact",
          artifactInstanceId: artifact.instanceId,
          towerId: artifact.socket.towerId,
          slotId: artifact.socket.slotId
        }));
      } else {
        const tower = presentation.artifacts.towerSlots?.find((item) => item.towerId === selectedTowerId);
        for (const slot of tower?.slots ?? []) {
          if (slot.slotType !== artifact.slotType || slot.artifactInstanceId !== null) continue;
          addAction("socket", "Socket in " + slot.slotId, () => dispatchGameCommand(game, {
            schemaVersion: 2, type: "socketArtifact",
            artifactInstanceId: artifact.instanceId,
            towerId: tower.towerId,
            slotId: slot.slotId
          }));
        }
      }
      artifactPanel.append(row);
    }
  }
}

function updateQuestStatus(snap) {
  const panel = $("quest-status");
  if (!panel) return;
  const presentation = projectQuestPresentation(snap);
  panel.replaceChildren();
  panel.hidden = !presentation;
  if (!presentation) return;
  const title = document.createElement("strong");
  title.textContent = "Challenges";
  panel.append(title);
  for (const quest of presentation.entries) {
    const row = document.createElement("span");
    row.dataset.status = quest.status;
    row.textContent = quest.label + ": " + quest.current + "/" + quest.target + " · " + quest.status;
    panel.append(row);
  }
}

function updateLogisticsStatus(snapshot) {
  const panel = $("logistics-status");
  if (!panel) return;
  const presentation = projectLogisticsPresentation(snapshot);
  panel.replaceChildren();
  panel.hidden = !presentation.active;
  if (!presentation.active) return;
  const heading = document.createElement("strong");
  heading.textContent = "Logistics";
  panel.append(heading);
  if (presentation.power) {
    for (const component of presentation.power.components) {
      const row = document.createElement("span");
      row.textContent = component.id + ": " + component.allocated + "/" + component.output
        + " allocated · " + component.consumerIds.length + " consumers";
      panel.append(row);
    }
    const brownout = presentation.power.consumers.filter((consumer) => !consumer.powered);
    if (brownout.length) {
      const row = document.createElement("span");
      row.dataset.logisticsBrownout = "true";
      row.textContent = "Brownout: " + brownout.map((consumer) => consumer.towerId).join(", ");
      panel.append(row);
    }
    for (const node of presentation.power.nodes) {
      for (const linkedTowerId of node.linkTowerIds) {
        if (node.towerId >= linkedTowerId) continue;
        const row = document.createElement("span");
        row.className = "logistics-link-cue";
        row.textContent = "Grid link: " + node.towerId + " ↔ " + linkedTowerId;
        panel.append(row);
      }
      for (const consumerTowerId of node.coveredConsumerIds) {
        const row = document.createElement("span");
        row.className = "logistics-coverage-cue";
        row.textContent = "Power coverage: " + node.towerId + " → " + consumerTowerId;
        panel.append(row);
      }
    }
  }
  if (presentation.ammunition) {
    for (const inventory of presentation.ammunition.inventories) {
      const row = document.createElement("span");
      row.className = "logistics-ammunition-cue";
      row.textContent = inventory.towerId + ": " + inventory.amount + "/" + inventory.capacity
        + " " + inventory.ammoTypeId;
      panel.append(row);
      if (!inventory.hasRequiredAmmo) {
        const depleted = document.createElement("span");
        depleted.className = "logistics-depleted-cue";
        depleted.textContent = "Depleted: " + inventory.towerId;
        panel.append(depleted);
      }
    }
  }
  if (presentation.supply) {
    const supply = presentation.supply;
    for (const source of [...supply.producers, ...supply.storages]) {
      const stock = document.createElement("span");
      stock.className = "logistics-supply-stock-cue";
      stock.textContent = source.towerId + ": " + source.amount + "/" + source.capacity
        + " " + source.ammoTypeId;
      panel.append(stock);
      const progress = document.createElement("span");
      progress.className = "logistics-supply-progress-cue";
      progress.textContent = "productionProgress" in source
        ? source.towerId + ": production " + source.productionProgress + "/" + source.productionInterval
          + ", transfer " + source.transferProgress + "/" + source.transferInterval
        : source.towerId + ": transfer " + source.transferProgress + "/" + source.transferInterval;
      panel.append(progress);
      if (!source.operational) {
        const paused = document.createElement("span");
        paused.className = "logistics-supply-paused-cue";
        paused.textContent = "Paused/brownout: " + source.towerId;
        panel.append(paused);
      }
    }
    for (const edge of supply.edges) {
      const link = document.createElement("span");
      link.className = "logistics-supply-link-cue";
      link.textContent = "Supply link: " + edge.sourceTowerId + " → " + edge.destinationTowerId;
      panel.append(link);
      if (edge.destinationKind === "consumer") {
        const refill = document.createElement("span");
        refill.className = "logistics-refill-cue";
        refill.textContent = "Refill: " + edge.sourceTowerId + " → " + edge.destinationTowerId;
        panel.append(refill);
      }
    }
  }
}

function updateTargetMode(snap) {
  const select = $("target-mode");
  const tower = selectedTowerId ? snap.towers.find((item) => item.id === selectedTowerId) : null;
  if (!tower) selectedTowerId = null;
  select.disabled = !tower || !tower.targetMode || Boolean(tower.scriptedTargeting);
  select.title = tower?.scriptedTargeting
    ? "Target priority is controlled by TowerScript " + tower.scriptedTargeting.scriptId + "/" + tower.scriptedTargeting.behaviorTreeId
    : "";
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
      document.documentElement.style.setProperty(\`--\${key}\`, value);
    }
  }
}
`;
}

function phaserPlayerTemplate(includeMultiplayer = false) {
  return `import {
  createCampaignRun,
  createEmptyPlayerProfile,
  createGameContentRegistry,
  dispatchGameCommand,
  exportCampaignRun,
  getAvailableCampaignNodeIds,
  getPlayerProfileLaunchOptions,
  importCampaignRun,
  isPlayerMissionUnlocked,
  parsePlayerProfileJson,
  prepareCampaignBattle,
  purchasePlayerMetaUpgrade,
  recordCampaignBattleVictory,
  recordPlayerMissionClear,
  resolveCampaignStructuralChoice,
  resolveWorldCampaign,
  selectPlayerDifficulty,
  serializePlayerProfile,
  settleCampaignBattleVictory,
  TowerDefenseGame,
  validateCampaignRunAgainstContent
} from "./engine/index.js";
${includeMultiplayer ? 'import * as TowerForgeMultiplayer from "./engine/multiplayer/index.js";' : ""}
import { createPlayerProfileStore, derivePlayerProfileStorageKey } from "./player-runtime/index.mjs";
import { createAudioPlayer } from "./renderer/audio.mjs";
import {
  createProceduralJuicePresentationRuntime,
  createProceduralJuiceWorldSnapshotBuffer,
  projectCampaignPresentation,
  projectArsenalPresentation,
  projectBallisticsEventPresentation,
  projectBallisticsPresentation,
  projectBallisticsPresentationPoint,
  projectBallisticsRicochetEventPresentation,
  projectDirectorDecisionCues,
  projectDestructibleEnvironmentPresentation,
  projectWeatherPresentation,
  projectElevationCues,
  projectEnemyNavigationPoint,
  projectEnemyComponentsPresentation,
  projectEnemyFormationsPresentation,
  projectVanguardProtectionPresentation,
  projectLegacyPresentationEvents,
  projectExposurePresentationCues,
  projectMarkPresentationCues,
  projectNavigationPlacementCues,
  projectPhysicsPresentationCues,
  projectProceduralJuicePresentation,
  projectQuestPresentation,
  hitTestHeroesPresentation,
  projectHeroesPresentation,
  projectHeroPresentationPoint,
  projectLogisticsPresentation,
  projectRoguelitePresentation,
  projectReactionPresentationCues,
  projectSnapshotSpawnCoord,
  projectShieldPresentationCues,
  projectTerraformingPresentation,
  resolveExposurePresentation,
  resolveMarkPresentation,
  resolveShieldPresentation,
  selectHeroAbilityEnemy
} from "./renderer/index.mjs";
import { expandAutotileInvalidations, resolveAutotile } from "./renderer/autotile.mjs";
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
${includeMultiplayer ? "globalThis.__towerforgeMultiplayer = TowerForgeMultiplayer;" : ""}

function ownDataValue(record, key) {
  if (record === null || typeof record !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

${playerProfileRuntimeTemplate()}
${arsenalPlayerRuntimeTemplate()}

const $ = (id) => document.getElementById(id);
applyProjectTheme();
const audio = createAudioPlayer({ audio: project.visuals && project.visuals.audio });
let missionId = content.defaultMissionId || Object.keys(content.missions)[0];
let towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
let game = new TowerDefenseGame({ missionId, content, ...currentPlayerLaunchOptions() });
const activeCampaign = resolveWorldCampaign(content);
let campaignRun = activeCampaign ? createCampaignRun("campaign") : null;
let pendingCampaignNodeId = null;
let pendingCampaignBattle = false;
let message = "Choose a tower, click a buildable tile, then start the wave.";
let targetingMode = { kind: "build" };
let selectedTowerId = null;
let keyboardCoord = null;
let navigationHoverCoord = null;
let navigationOverlay = projectNavigationPlacementCues(undefined);
let navigationOverlayPlacementState = null;
let navigationOverlayFieldState = null;
let lastRunningSpeed = 1;
let activeStory = null;
let storyWasRunning = false;
let victoryRewarded = false;
let lastObservedEvents = [];
const shownStories = new Set();
let phaserGame = null;

const rendererTheme = content.visuals?.theme?.renderer ?? {};
const TERRAIN_COLORS = {
  buildable: colorNumber(rendererTheme.buildable, 0x1d2a1d),
  path: colorNumber(rendererTheme.path, 0x6b5540),
  water: colorNumber(rendererTheme.water, 0x427b88),
  blocked: colorNumber(rendererTheme.blocked, 0x252820),
  spawn: colorNumber(rendererTheme.spawn, 0x735e2c),
  core: colorNumber(rendererTheme.core, 0x3f6f43)
};

initSelectors();
syncKeyboardCursor(null);
initAbilityBar();
renderMetaPanel();
setupCampaignRunControls();
updateCampaignRun();
$("start-wave").addEventListener("click", () => { audio.resume(); report(game.startNextWave()); });
$("pause-run").addEventListener("click", () => setPaused(Number($("speed").value) > 0));
$("sell-mode").addEventListener("click", () => setSellMode(targetingMode.kind !== "sell"));
$("reset-run").addEventListener("click", () => { game.reset(); resetPlayerPresentation(); victoryRewarded = false; selectedTowerId = null; setTargetingMode({ kind: "build" }); initAbilityBar(); clearNavigationOverlay(); message = "Run reset."; });
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
  if (tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
  if (event.code === "Space") { event.preventDefault(); setPaused(Number($("speed").value) > 0); return; }
  if (document.activeElement !== $("playfield")) return;
  if (event.code === "Digit1") { event.preventDefault(); armCurrentHeroAbility(); return; }
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (moves[event.key]) { event.preventDefault(); moveKeyboardCursor(moves[event.key][0], moves[event.key][1]); }
  else if (event.key === "Enter") { event.preventDefault(); const coord = ensureKeyboardCoord(); actAtCoord(coord, hitTestHeroAtCoord(coord), hitTestHeroAbilityEnemyAtCoord(coord)); }
  else if (event.key === "Escape") { event.preventDefault(); setTargetingMode({ kind: "build" }); message = "Build action cancelled."; }
});
syncSpeedUi();
syncAudioSettings();
applyBattleBackground();
selectMissionMusic();
showStoryForMission("beforeMission");
$("playfield").addEventListener("focus", () => syncKeyboardCursor(ensureKeyboardCoord()));

function resetPlayerPresentation() {
  const scene = phaserGame?.scene.getScenes(true)[0];
  scene?.resetProceduralJuicePresentation?.();
  audio.disposeProceduralVoices();
}

function createGame() {
  resetPlayerPresentation();
  return new TowerDefenseGame({ missionId, content, ...currentPlayerLaunchOptions() });
}

function hitTestHeroAtCoord(coord) {
  const scene = typeof phaserGame === "undefined" ? null : phaserGame.scene.getScenes(true)[0];
  if (!scene || !coord) return null;
  const snapshot = game.getRenderSnapshot();
  const presentation = projectHeroesPresentation(snapshot);
  if (!presentation.active || !presentation.units.every((hero) => hero.movement)) return null;
  const geom = scene.geometry(snapshot.tiles, snapshot.grid);
  const point = scene.center(coord, geom);
  return hitTestHeroesPresentation(presentation, point, (candidate) => scene.center(candidate, geom), geom.r * 0.7);
}

function hitTestHeroAbilityEnemyAtCoord(coord) {
  if (targetingMode.kind !== "heroAbility" || !coord) return null;
  const scene = typeof phaserGame === "undefined" ? null : phaserGame.scene.getScenes(true)[0];
  if (!scene) return null;
  const snapshot = game.getRenderSnapshot();
  const geom = scene.geometry(snapshot.tiles, snapshot.grid);
  return selectHeroAbilityEnemy(
    snapshot.enemies,
    scene.center(coord, geom),
    (enemy) => scene.enemyPos(enemy, snapshot, geom)
  );
}

function clearNavigationOverlay() {
  navigationOverlay = projectNavigationPlacementCues(undefined);
  navigationOverlayPlacementState = null;
  navigationOverlayFieldState = null;
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
  if (!coord || !towerId || targetingMode.kind !== "build") {
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
  navigationOverlay = projectNavigationPlacementCues(analysis);
  if (!navigationOverlay.active) {
    clearNavigationOverlay();
    return;
  }
  captureNavigationOverlayPlacementState(game.getRenderSnapshot());
  const blocked = navigationOverlay.cues.find((cue) => cue.state === "blocked");
  if (blocked?.reasonKey === "reason.lastPathBlocked") message = "That tower would block the last path.";
}

function actAtCoord(coord, heroHitId = null, enemyHitId = null) {
  if (!coord) return;
  if (targetingMode.kind === "sell") {
    const towerAt = game.getTowerIdAt(coord);
    report(towerAt ? game.sellTower(towerAt) : { ok: false, reason: "Choose a tower tile." });
    if (towerAt === selectedTowerId) selectedTowerId = null;
    setSellMode(false);
    return;
  }
  if (targetingMode.kind === "missionAbility") {
    report(game.useAbility(targetingMode.abilityId, coord));
    setTargetingMode({ kind: "build" });
    return;
  }
  if (targetingMode.kind === "heroAbility") {
    if (!enemyHitId) { message = "Choose a live enemy target."; return; }
    const result = dispatchGameCommand(game, {
      schemaVersion: 5,
      type: "useHeroAbility",
      heroId: targetingMode.heroId,
      abilityId: targetingMode.abilityId,
      targetEnemyId: enemyHitId
    });
    report(result);
    if (result.ok) setTargetingMode({ kind: "build" });
    return;
  }
  if (targetingMode.kind === "heroMove") {
    const result = dispatchGameCommand(game, {
      schemaVersion: 4, type: "moveHero", heroId: targetingMode.heroId,
      target: { q: coord.q, r: coord.r }
    });
    report(result);
    if (result.ok) setTargetingMode({ kind: "build" });
    return;
  }
  if (heroHitId) { setTargetingMode({ kind: "heroMove", heroId: heroHitId }); selectedTowerId = null; message = "Hero selected. Choose a destination."; return; }
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
  const snapshot = game.getSnapshot();
  const tile = keyboardCoord && snapshot.tiles.find((item) => item.q === keyboardCoord.q && item.r === keyboardCoord.r);
  const battlefieldLabel = snapshot.grid.kind === "square" ? "Square battlefield" : "Hex battlefield";
  $("playfield").setAttribute("aria-label", tile ? battlefieldLabel + ". Selected tile q " + tile.q + ", r " + tile.r + ", " + tile.terrain + ". Arrow keys move; Enter acts; Escape cancels." : battlefieldLabel + ".");
  refreshNavigationOverlay(keyboardCoord);
}

function moveKeyboardCursor(dq, dr) {
  const current = ensureKeyboardCoord();
  if (!current) return;
  const tiles = game.getSnapshot().tiles;
  const target = tiles.find((tile) => tile.q === current.q + dq && tile.r === current.r + dr);
  if (target) syncKeyboardCursor(target);
}

function setSellMode(active) {
  setTargetingMode(active ? { kind: "sell" } : { kind: "build" });
  if (active) message = "Click a tower to sell it.";
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

class PlayScene extends Phaser.Scene {
  preload() {
    for (const [atlasId, atlas] of Object.entries(content.visuals?.atlases || {})) {
      if (atlas?.src) this.load.image("tf-atlas:" + atlasId, visualAssetUrl(atlas.src));
    }
    for (const [spriteId, sprite] of Object.entries(content.visuals?.sprites || {})) {
      if (sprite?.src) this.load.image("tf-sprite:" + spriteId, visualAssetUrl(sprite.src));
    }
  }
  create() {
    const proceduralJuiceEnabled = content.visuals?.schemaVersion === 3 && content.visuals?.proceduralJuice !== undefined;
    this.tileG = this.add.graphics();
    this.fxG = this.add.graphics();
    this.juiceNormalG = proceduralJuiceEnabled ? this.add.graphics() : null;
    this.juiceAdditiveG = proceduralJuiceEnabled ? this.add.graphics().setBlendMode(Phaser.BlendModes.ADD) : null;
    this.juiceMultiplyG = proceduralJuiceEnabled ? this.add.graphics().setBlendMode(Phaser.BlendModes.MULTIPLY) : null;
    this.entG = this.add.graphics();
    this.towerLabels = new Map();
    this.heroImages = new Map();
    this.heroLabels = new Map();
    this.tileImages = new Map();
    this.tileTerrainState = new Map();
    this.tileImageKey = "";
    this.previousEnemyPositions = new Map();
    this.previousTowerPositions = new Map();
    this.previousCombat = null;
    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    this.proceduralJuiceRuntime = proceduralJuiceEnabled
      ? createProceduralJuicePresentationRuntime({ motionPreference: reducedMotion ? "reduced" : "full" })
      : null;
    this.proceduralJuiceWorldSnapshots = proceduralJuiceEnabled
      ? createProceduralJuiceWorldSnapshotBuffer()
      : null;
    this.previousProceduralJuiceSnapshot = null;
    this.proceduralJuiceMissionId = null;
    this.markLabels = new Map();
    this.exposureLabels = new Map();
    this.elevationLabels = new Map();
    this.registerAtlasFrames();
    this.input.on("pointerdown", (p) => {
      audio.resume();
      const point = this.pointerScenePoint(p);
      const coord = point && this.pickTile(point.x, point.y);
      if (!coord) return;
      window.__towerforgeLastPointerCoord = coord;
      syncKeyboardCursor(coord);
      actAtCoord(coord, this.hitTestHero(point.x, point.y), this.hitTestAbilityEnemy(point.x, point.y));
    });
    this.input.on("pointermove", (p) => {
      const point = this.pointerScenePoint(p);
      const coord = point && this.pickTile(point.x, point.y);
      if (coord?.q === navigationHoverCoord?.q && coord?.r === navigationHoverCoord?.r) return;
      navigationHoverCoord = coord;
      refreshNavigationOverlay(navigationHoverCoord);
    });
    this.input.on("pointerout", () => {
      navigationHoverCoord = null;
      refreshNavigationOverlay(keyboardCoord);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.resetProceduralJuicePresentation();
    });
  }
  resetProceduralJuicePresentation() {
    this.proceduralJuiceRuntime?.reset();
    this.proceduralJuiceWorldSnapshots?.reset();
    this.previousProceduralJuiceSnapshot = null;
    this.proceduralJuiceMissionId = null;
    for (const graphics of [this.juiceNormalG, this.juiceAdditiveG, this.juiceMultiplyG]) graphics?.clear();
    this.cameras.main.setScroll(0, 0);
    this.game.canvas.style.filter = "";
  }
  pointerScenePoint(pointer) {
    const event = pointer && pointer.event;
    const source = event && ((event.changedTouches && event.changedTouches[0])
      || (event.touches && event.touches[0]) || event);
    const rect = this.game.canvas.getBoundingClientRect();
    if (!source || !Number.isFinite(source.clientX) || !Number.isFinite(source.clientY)
      || !(rect.width > 0) || !(rect.height > 0)) return null;
    return {
      x: (source.clientX - rect.left) * this.scale.width / rect.width,
      y: (source.clientY - rect.top) * this.scale.height / rect.height
    };
  }
  hitTestHero(x, y) {
    const snapshot = game.getRenderSnapshot();
    const presentation = projectHeroesPresentation(snapshot);
    if (!presentation.active || !presentation.units.every((hero) => hero.movement)) return null;
    const geom = this.geometry(snapshot.tiles, snapshot.grid);
    return hitTestHeroesPresentation(presentation, { x, y }, (coord) => this.center(coord, geom), geom.r * 0.7);
  }
  hitTestAbilityEnemy(x, y) {
    if (targetingMode.kind !== "heroAbility") return null;
    const snapshot = game.getRenderSnapshot();
    const geom = this.geometry(snapshot.tiles, snapshot.grid);
    return selectHeroAbilityEnemy(
      snapshot.enemies,
      { x, y },
      (enemy) => this.enemyPos(enemy, snapshot, geom),
      geom.r * 0.62
    );
  }
  registerAtlasFrames() {
    for (const [spriteId, sprite] of Object.entries(content.visuals?.sprites || {})) {
      if (!sprite?.atlas || !sprite.frame) continue;
      const texture = this.textures.get("tf-atlas:" + sprite.atlas);
      const frame = sprite.frame;
      if (texture?.key !== "__MISSING" && !texture.has(spriteId)) texture.add(spriteId, 0, frame.x, frame.y, frame.w, frame.h);
    }
  }
  spriteTexture(spriteId) {
    if (typeof spriteId !== "string" || !spriteId) return null;
    const sprites = ownDataValue(content.visuals, "sprites");
    const sprite = ownDataValue(sprites, spriteId);
    if (!sprite) return null;
    if (sprite.atlas && sprite.frame && this.textures.exists("tf-atlas:" + sprite.atlas)) return { key: "tf-atlas:" + sprite.atlas, frame: spriteId };
    if (sprite.src && this.textures.exists("tf-sprite:" + spriteId)) return { key: "tf-sprite:" + spriteId };
    return null;
  }
  geometry(tiles, grid) {
    let maxQ = 1, maxR = 1;
    for (const t of tiles) { if (t.q > maxQ) maxQ = t.q; if (t.r > maxR) maxR = t.r; }
    const W = this.scale.width, H = this.scale.height;
    if (grid?.kind === "square") {
      const cell = Math.min(W / (maxQ + 2), H / (maxR + 2));
      return { r: cell / 2, ox: cell, oy: cell, grid };
    }
    const r = Math.min(W / ((maxQ + 2) * 1.65), H / ((maxR + 2) * 1.45));
    return { r, ox: r * 1.5, oy: r * 1.5, grid: grid || { kind: "hex", layout: "odd-r" } };
  }
  center(coord, g) {
    if (g.grid.kind === "square") return { x: g.ox + coord.q * g.r * 2, y: g.oy + coord.r * g.r * 2 };
    return { x: g.ox + coord.q * g.r * 1.48 + (coord.r % 2) * g.r * 0.74, y: g.oy + coord.r * g.r * 1.28 };
  }
  pickTile(x, y) {
    const snap = game.getRenderSnapshot();
    const g = this.geometry(snap.tiles, snap.grid);
    let best = null, bestD = Infinity;
    for (const t of snap.tiles) { const p = this.center(t, g); const d = Math.hypot(p.x - x, p.y - y); if (d < bestD) { bestD = d; best = t; } }
    return best && bestD <= (g.grid.kind === "square" ? g.r * Math.SQRT2 : g.r * 0.95) ? { q: best.q, r: best.r } : null;
  }
  enemyPos(enemy, snap, g) {
    const route = enemy.routeId ? snap.pathRoutes?.find((rt) => rt.id === enemy.routeId)?.pathCenterline : snap.pathCenterline;
    const track = route && route.length ? route : snap.pathCenterline;
    if (!track || !track.length) return this.center(snap.spawnCoord || { q: 0, r: 0 }, g);
    const prog = Math.max(0, Math.min(track.length - 1, enemy.pathProgress));
    const i = Math.floor(prog), f = prog - i;
    const a = this.center(track[i], g), b = this.center(track[Math.min(i + 1, track.length - 1)], g);
    const legacyPoint = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    // enemy.navigation stays opaque here; the shared renderer projector validates it.
    return projectEnemyNavigationPoint(enemy, legacyPoint, (coord) => this.center(coord, g));
  }
  hex(gr, x, y, r, fill, alpha) {
    gr.fillStyle(fill, alpha == null ? 1 : alpha);
    gr.beginPath();
    for (let i = 0; i < 6; i += 1) { const a = Math.PI / 6 + i * Math.PI / 3; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i === 0) gr.moveTo(px, py); else gr.lineTo(px, py); }
    gr.closePath(); gr.fillPath();
    gr.lineStyle(1, 0xffffff, 0.08); gr.strokePath();
  }
  cell(gr, x, y, r, fill, alpha, grid) {
    if (grid.kind === "square") {
      gr.fillStyle(fill, alpha == null ? 1 : alpha);
      gr.fillRect(x - r, y - r, r * 2, r * 2);
      gr.lineStyle(1, 0xffffff, 0.08);
      gr.strokeRect(x - r, y - r, r * 2, r * 2);
      return;
    }
    this.hex(gr, x, y, r, fill, alpha);
  }
  shieldRing(gr, x, y, radius, shield) {
    if (!shield) return;
    const width = Math.max(2, radius * 0.12);
    gr.lineStyle(width, 0x63d9ff, 0.2);
    gr.strokeCircle(x, y, radius);
    if (shield.ratio <= 0) return;
    gr.lineStyle(width, 0x63d9ff, 0.95);
    gr.beginPath();
    gr.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * shield.ratio, false);
    gr.strokePath();
  }
  syncTileImages(snap, g, terraformingPresentation) {
    const stateKey = [snap.mapId, snap.grid?.kind, this.scale.width, this.scale.height].join("|");
    let fullRedraw = stateKey !== this.tileImageKey;
    if (fullRedraw) {
      for (const images of this.tileImages.values()) for (const image of images) this.destroyTileImage(image);
      this.tileImages.clear();
      this.tileTerrainState.clear();
      this.tileImageKey = stateKey;
    }
    const map = { id: snap.mapId || snap.missionId, grid: snap.grid, tiles: snap.tiles, pathRoutes: snap.pathRoutes || [] };
    const tileByKey = new Map(snap.tiles.map((tile) => [tile.q + "," + tile.r, tile]));
    const changedRoots = [];
    for (const tile of snap.tiles) {
      const key = tile.q + "," + tile.r;
      if (fullRedraw || this.tileTerrainState.get(key) !== tile.terrain) {
        changedRoots.push({ q: tile.q, r: tile.r });
      }
    }
    if (changedRoots.length > 1_024) {
      fullRedraw = true;
      for (const images of this.tileImages.values()) for (const image of images) this.destroyTileImage(image);
      this.tileImages.clear();
      this.tileTerrainState.clear();
    }
    const roots = this.mergeAutotileRoots(changedRoots, terraformingPresentation?.terrainInvalidations);
    const expanded = roots === null ? undefined : expandAutotileInvalidations({
      gridType: snap.grid?.kind || "hex", coordinates: roots, tiles: snap.tiles
    });
    // The authoritative snapshot is the fallback whenever the bounded hint channel overflows
    // or descriptor validation makes a partial redraw unsafe.
    const dirty = roots === null || expanded === undefined
      ? new Set(snap.tiles.map((tile) => tile.q + "," + tile.r))
      : new Set(expanded.map((coord) => coord.q + "," + coord.r));
    for (const key of dirty) {
      for (const image of this.tileImages.get(key) || []) this.destroyTileImage(image);
      this.tileImages.delete(key);
      const tile = tileByKey.get(key);
      if (!tile) continue;
      const resolved = resolveAutotile({ map, visuals: content.visuals, coord: tile, terrain: tile.terrain, seed: content.visuals?.tileSeed || 0 });
      const p = this.center(tile, g);
      if (resolved.sectors?.length) {
        for (const sector of resolved.sectors) this.addTileImage(sector.selected, p, g, sector.direction, key);
      } else {
        this.addTileImage(resolved.selected, p, g, null, key);
      }
    }
    this.tileTerrainState = new Map(snap.tiles.map((tile) => [tile.q + "," + tile.r, tile.terrain]));
  }
  destroyTileImage(image) {
    image.__towerforgeMask?.destroy();
    image.__towerforgeMaskShape?.destroy();
    image.destroy();
  }
  mergeAutotileRoots(changedRoots, hints) {
    const unique = new Map();
    for (const point of changedRoots) unique.set(point.q + "," + point.r, point);
    if (Array.isArray(hints)) for (const point of hints) {
      if (Number.isSafeInteger(point?.q) && Number.isSafeInteger(point?.r) && point.q >= 0 && point.r >= 0) unique.set(point.q + "," + point.r, { q: point.q, r: point.r });
    }
    return unique.size <= 1024 ? [...unique.values()] : null;
  }
  addTileImage(selected, p, g, sectorDirection, tileKey) {
    const texture = this.spriteTexture(selected?.spriteId);
    if (!texture) return;
    const size = g.r * 1.72;
    const image = this.add.image(p.x, p.y, texture.key, texture.frame).setDisplaySize(size, size).setDepth(-1);
    const transform = selected.transform;
    image.setFlip(Boolean(transform?.flipX), Boolean(transform?.flipY));
    image.setAngle(Number(transform?.rotate || 0));
    if (sectorDirection) {
      const shape = this.make.graphics({ add: false });
      shape.fillStyle(0xffffff, 1);
      if (g.grid.kind === "square") {
        const quadrants = { NW: [-size / 2, -size / 2], NE: [0, -size / 2], SE: [0, 0], SW: [-size / 2, 0] };
        const offset = quadrants[sectorDirection] || quadrants.NW;
        shape.fillRect(p.x + offset[0], p.y + offset[1], size / 2, size / 2);
      } else {
        const directions = ["NW", "NE", "E", "SE", "SW", "W"];
        const index = Math.max(0, directions.indexOf(sectorDirection));
        const start = -Math.PI + index * Math.PI / 3;
        shape.fillTriangle(
          p.x, p.y,
          p.x + Math.cos(start) * size / 2, p.y + Math.sin(start) * size / 2,
          p.x + Math.cos(start + Math.PI / 3) * size / 2, p.y + Math.sin(start + Math.PI / 3) * size / 2
        );
      }
      const mask = shape.createGeometryMask();
      image.setMask(mask);
      image.__towerforgeMask = mask;
      image.__towerforgeMaskShape = shape;
    }
    const images = this.tileImages.get(tileKey) || [];
    images.push(image);
    this.tileImages.set(tileKey, images);
  }
  update(time, delta) {
    if (document.hidden) return; // paused while backgrounded (see the visibilitychange listener)
    const speed = Number($("speed").value) || 0;
    // Capture player-action events before tick() clears them (see canvas loop note).
    let snap = game.getRenderSnapshot();
    const pending = snap.lastEvents;
    const ticked = speed > 0 && snap.outcome === "playing";
    if (ticked) {
      const tu = content.constants.timeUnitSeconds || 1;
      game.tick((Math.min(50, delta) / 1000 / tu) * speed);
      snap = game.getRenderSnapshot();
    }
    syncNavigationOverlaySnapshot(snap);
    const events = ticked ? pending.concat(snap.lastEvents) : pending;
    if (events.length > 0) lastObservedEvents = events;
    game.lastEvents = []; // consumed this frame — clear so nothing replays next frame
    const authoritativeSnapshot = snap;
    const presentationSnapshot = {
      ...snap,
      ...(snap.combat === undefined && this.previousCombat !== null ? { combat: this.previousCombat } : {}),
      lastEvents: events
    };
    let proceduralJuiceState = null;
    if (this.proceduralJuiceRuntime) {
      if (this.proceduralJuiceMissionId !== null && this.proceduralJuiceMissionId !== snap.missionId) {
        this.proceduralJuiceRuntime.reset();
        this.proceduralJuiceWorldSnapshots?.reset();
        this.previousProceduralJuiceSnapshot = null;
      }
      this.proceduralJuiceMissionId = snap.missionId;
      this.proceduralJuiceRuntime.advance(Math.min(50, delta));
      const proceduralJuicePresentation = projectProceduralJuicePresentation({
        snapshot: presentationSnapshot,
        previousSnapshot: this.previousProceduralJuiceSnapshot ?? presentationSnapshot,
        visuals: content.visuals,
        content
      });
      this.proceduralJuiceRuntime.ingest(proceduralJuicePresentation);
      proceduralJuiceState = this.proceduralJuiceRuntime.read();
      const proceduralCues = this.proceduralJuiceRuntime.drainAudioCues();
      if ($("snd")?.checked) audio.handleEvents(events, { proceduralCues });
    } else if ($("snd")?.checked) {
      audio.handleEvents(events);
    }
    snap = this.proceduralJuiceWorldSnapshots?.select({
      snapshot: authoritativeSnapshot,
      previousSnapshot: this.previousProceduralJuiceSnapshot ?? presentationSnapshot,
      frame: proceduralJuiceState,
      deltaMs: Math.min(50, delta)
    }) ?? authoritativeSnapshot;
    const g = this.geometry(snap.tiles, snap.grid);
    const enemyPositions = new Map();
    for (const enemy of snap.enemies) {
      const point = this.enemyPos(enemy, snap, g);
      if (point) enemyPositions.set(enemy.id, point);
    }
    const towerPositions = new Map(snap.towers.map((tower) => [tower.id, this.center(tower.coord, g)]));
    const directorCue = projectDirectorDecisionCues(presentationSnapshot).at(-1);
    if (directorCue) message = directorCue.label;
    const questPresentation = projectQuestPresentation(presentationSnapshot);
    const questCue = questPresentation?.cues.at(-1);
    if (questCue) {
      const entry = questPresentation.entries.find((candidate) => candidate.questId === questCue.questId);
      message = \`\${questCue.type === "completed" ? "Challenge completed" : "Challenge failed"}: \${entry?.label ?? questCue.questId}\`;
    }
    const terraformingPresentation = projectTerraformingPresentation(presentationSnapshot);
    this.syncTileImages(snap, g, terraformingPresentation);
    const map = { id: snap.mapId || snap.missionId, grid: snap.grid, tiles: snap.tiles, pathRoutes: snap.pathRoutes || [] };

    this.tileG.clear();
    for (const t of snap.tiles) {
      const resolved = resolveAutotile({ map, visuals: content.visuals, coord: t, terrain: t.terrain, seed: content.visuals?.tileSeed || 0 });
      const missingVisual = resolved.sectors?.length
        ? resolved.sectors.some((sector) => !this.spriteTexture(sector.selected?.spriteId))
        : !this.spriteTexture(resolved.selected?.spriteId);
      if (missingVisual) {
        const p = this.center(t, g);
        this.cell(this.tileG, p.x, p.y, g.r * 0.86, TERRAIN_COLORS[t.terrain] ?? TERRAIN_COLORS.buildable, 1, g.grid);
      }
    }
    for (const w of snap.temporaryWaterTiles) { const p = this.center(w, g); this.cell(this.tileG, p.x, p.y, g.r * 0.74, 0x427b88, 0.55, g.grid); }
    this.drawElevationPresentation(terraformingPresentation?.elevationPresentation || projectElevationCues(snap.elevation), g);
    if (navigationOverlay.active) {
      for (const cue of navigationOverlay.cues) {
        const p = this.center(cue.coord, g);
        this.cell(
          this.tileG,
          p.x,
          p.y,
          g.r * 0.76,
          cue.state === "blocked" ? 0xdf6a59 : 0x8ac783,
          cue.state === "blocked" ? 0.28 : 0.2,
          g.grid
        );
      }
    }
    if (keyboardCoord) {
      const p = this.center(keyboardCoord, g);
      this.tileG.lineStyle(Math.max(2, g.r * 0.12), 0xe8f4db, 1);
      if (g.grid.kind === "square") this.tileG.strokeRect(p.x - g.r * 0.72, p.y - g.r * 0.72, g.r * 1.44, g.r * 1.44);
      else this.tileG.strokeCircle(p.x, p.y, g.r * 0.64);
    }

    this.fxG.clear();
    const ballisticsPresentation = projectBallisticsPresentation(presentationSnapshot);
    if (ballisticsPresentation.active) {
      this.fxG.fillStyle(0xffd27a, 1);
      this.fxG.lineStyle(Math.max(1, g.r * 0.08), 0xfff4c4, 0.72);
      for (const projectile of ballisticsPresentation.projectiles) {
        const point = projectBallisticsPresentationPoint(
          projectile,
          (coord) => this.center(coord, g),
          Math.max(1, g.r * 0.18)
        );
        if (!point) continue;
        this.fxG.fillCircle(point.x, point.y, Math.max(2, g.r * 0.13));
        this.fxG.strokeCircle(point.x, point.y, Math.max(2, g.r * 0.13));
      }
    }
    const ballisticsEvents = projectBallisticsEventPresentation(presentationSnapshot);
    for (const event of ballisticsEvents) {
      const point = this.center(event.blockerCoord, g);
      const radius = Math.max(3, g.r * 0.32);
      this.fxG.lineStyle(Math.max(2, g.r * 0.11), 0xff8b5c, 0.95);
      this.fxG.lineBetween(point.x - radius, point.y - radius, point.x + radius, point.y + radius);
      this.fxG.lineBetween(point.x + radius, point.y - radius, point.x - radius, point.y + radius);
    }
    const ballisticsRicochetEvents = projectBallisticsRicochetEventPresentation(presentationSnapshot);
    for (const event of ballisticsRicochetEvents) {
      const collision = this.center(event.collisionCoord, g);
      const target = this.center(event.nextTargetCoord, g);
      this.fxG.lineStyle(Math.max(2, g.r * 0.1), 0x76e6ff, 0.95);
      this.fxG.lineBetween(collision.x, collision.y, target.x, target.y);
      this.fxG.fillStyle(0xd6f9ff, 1);
      this.fxG.fillCircle(collision.x, collision.y, Math.max(2, g.r * 0.12));
    }
    const presentationEvents = projectLegacyPresentationEvents(presentationSnapshot);
    const placedTowerPositions = new Map();
    for (const ev of presentationEvents) {
      if (ev.type === "towerPlaced") {
        placedTowerPositions.set(ev.towerId, this.center(ev.coord, g));
        continue;
      }
      if (ev.type !== "towerFired") continue;
      const tw = snap.towers.find((t) => t.id === ev.towerId);
      const en = snap.enemies.find((e) => e.id === ev.enemyId);
      if (tw && en) { const a = this.center(tw.coord, g), b = this.enemyPos(en, snap, g); if (b) { this.fxG.lineStyle(2, 0xffe2a8, 0.85); this.fxG.lineBetween(a.x, a.y, b.x, b.y); } }
    }
    for (const cue of projectShieldPresentationCues(presentationSnapshot)) {
      let p;
      if (cue.kind === "enemy") {
        p = enemyPositions.get(cue.runtimeId) || this.previousEnemyPositions.get(cue.runtimeId);
        if (!p && cue.change === "break") {
          const spawnCoord = projectSnapshotSpawnCoord(presentationSnapshot);
          if (spawnCoord) p = this.center(spawnCoord, g);
        }
      } else {
        p = towerPositions.get(cue.runtimeId)
          || this.previousTowerPositions.get(cue.runtimeId)
          || placedTowerPositions.get(cue.runtimeId);
      }
      if (!p) continue;
      const color = cue.change === "break" ? 0xb6ebff
        : cue.change === "damage" ? 0x5cc6ff
          : cue.change === "regeneration" ? 0x6deed5 : 0xab8eff;
      this.fxG.lineStyle(Math.max(2, g.r * 0.1), color, 0.9);
      this.fxG.strokeCircle(p.x, p.y, g.r * (cue.kind === "tower" ? 0.78 : 0.62));
    }
    for (const cue of projectMarkPresentationCues(presentationSnapshot)) {
      let p = enemyPositions.get(cue.runtimeId) || this.previousEnemyPositions.get(cue.runtimeId);
      if (!p) {
        const spawnCoord = projectSnapshotSpawnCoord(presentationSnapshot);
        if (spawnCoord) p = this.center(spawnCoord, g);
      }
      if (!p) continue;
      const color = cue.cause === "expiration" ? 0xbeafda
        : cue.cause === "consume" ? 0xffbe70 : 0xc48bff;
      this.fxG.lineStyle(Math.max(2, g.r * 0.09), color, 0.9);
      this.fxG.strokeCircle(p.x, p.y, g.r * 0.68);
    }
    for (const cue of projectExposurePresentationCues(presentationSnapshot)) {
      let p = enemyPositions.get(cue.runtimeId) || this.previousEnemyPositions.get(cue.runtimeId);
      if (!p) {
        const spawnCoord = projectSnapshotSpawnCoord(presentationSnapshot);
        if (spawnCoord) p = this.center(spawnCoord, g);
      }
      if (!p) continue;
      const color = cue.cause === "consume" ? 0xffd680
        : cue.cause === "expiration" ? 0x97becd : 0x69d3ff;
      this.fxG.lineStyle(Math.max(2, g.r * 0.09), color, 0.9);
      this.fxG.strokeCircle(p.x, p.y, g.r * 0.74);
    }
    for (const cue of projectReactionPresentationCues(presentationSnapshot)) {
      const p = enemyPositions.get(cue.originEnemyId)
        || this.previousEnemyPositions.get(cue.originEnemyId)
        || this.center(cue.originCoord, g);
      this.fxG.lineStyle(Math.max(2, g.r * 0.13), 0xffe674, 0.92);
      this.fxG.strokeCircle(p.x, p.y, g.r * 0.9);
    }
    for (const cue of projectPhysicsPresentationCues(presentationSnapshot)) {
      const from = this.center(cue.from, g);
      const to = this.center(cue.to, g);
      if (cue.kind === "displacement") {
        this.fxG.lineStyle(Math.max(2, g.r * 0.11), 0x7bdcff, 0.9);
        this.fxG.lineBetween(from.x, from.y, to.x, to.y);
      } else {
        this.fxG.lineStyle(Math.max(2, g.r * 0.12), 0xff8b5c, 0.92);
        this.fxG.strokeCircle(to.x, to.y, g.r * 0.78);
      }
    }
    for (const graphics of [this.juiceNormalG, this.juiceAdditiveG, this.juiceMultiplyG]) graphics?.clear();
    if (proceduralJuiceState) {
      for (const particle of proceduralJuiceState.particles) {
        const origin = this.center(particle.origin, g);
        const graphics = particle.blendMode === "additive" ? this.juiceAdditiveG
          : particle.blendMode === "multiply" ? this.juiceMultiplyG : this.juiceNormalG;
        const color = Number.parseInt(particle.color.slice(1, 7), 16);
        const authoredAlpha = particle.color.length === 9 ? Number.parseInt(particle.color.slice(7, 9), 16) / 255 : 1;
        graphics.fillStyle(color, particle.alpha * authoredAlpha);
        graphics.fillCircle(origin.x + particle.offsetX, origin.y + particle.offsetY, Math.max(0.1, particle.sizePx));
      }
      const shakeCap = g.r * 0.75;
      this.cameras.main.setScroll(
        -proceduralJuiceState.shakeOffset.x * shakeCap,
        -proceduralJuiceState.shakeOffset.y * shakeCap
      );
      const chromatic = proceduralJuiceState.chromaticAberration;
      this.game.canvas.style.filter = chromatic > 0
        ? \`drop-shadow(\${Math.max(1, chromatic * 5)}px 0 rgba(255,32,64,.25)) drop-shadow(\${-Math.max(1, chromatic * 5)}px 0 rgba(32,160,255,.22))\`
        : "";
    } else {
      this.cameras.main.setScroll(0, 0);
      this.game.canvas.style.filter = "";
    }

    this.entG.clear();
    const weatherPresentation = projectWeatherPresentation(snap);
    if (weatherPresentation.active) {
      const weatherTiles = weatherPresentation.zoneKind === "all_map" ? (snap.tiles ?? []) : weatherPresentation.tiles;
      for (const tile of weatherTiles) {
        const p = this.center(tile, g);
        this.entG.fillStyle(0x6ca1be, 0.14);
        if (g.grid.kind === "square") {
          const size = g.r * 1.52;
          this.entG.fillRect(p.x - size / 2, p.y - size / 2, size, size);
        } else {
          this.entG.fillCircle(p.x, p.y, g.r * 0.76);
        }
      }
    }
    const destructibleEnvironmentPresentation = projectDestructibleEnvironmentPresentation(snap);
    if (destructibleEnvironmentPresentation.active) {
      for (const row of destructibleEnvironmentPresentation.rows) {
        const p = this.center(row.coord, g);
        const radius = Math.max(3, g.r * 0.38);
        const alpha = row.destroyed ? 0.42 : 0.95;
        this.entG.fillStyle(row.destroyed ? 0x605d55 : 0x9b7653, alpha);
        this.entG.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
        this.entG.lineStyle(Math.max(1, g.r * 0.08), row.destroyed ? 0xa5a095 : 0xf0d3a8, alpha);
        this.entG.strokeRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
        if (row.destroyed) {
          this.entG.lineBetween(p.x - radius, p.y - radius, p.x + radius, p.y + radius);
          this.entG.lineBetween(p.x + radius, p.y - radius, p.x - radius, p.y + radius);
        } else if (row.hpRatio < 1) {
          const barHeight = Math.max(2, g.r * 0.08);
          const top = p.y + radius + barHeight;
          this.entG.fillStyle(0x1b1d18, 1);
          this.entG.fillRect(p.x - radius, top, radius * 2, barHeight);
          this.entG.fillStyle(row.hpRatio > 0.35 ? 0xd7b06f : 0xdf6a59, 1);
          this.entG.fillRect(p.x - radius, top, radius * 2 * row.hpRatio, barHeight);
        }
      }
    }
    const seen = new Set();
    for (const tw of snap.towers) {
      const p = this.center(tw.coord, g); seen.add(tw.id);
      const disabled = (tw.disabledFor ?? 0) > 0; // silenced by an enemy tower-disrupt pulse
      const alpha = disabled ? 0.4 : 1;
      this.entG.fillStyle(0x8ac783, alpha); this.entG.fillCircle(p.x, p.y, g.r * 0.5);
      this.entG.lineStyle(2, disabled ? 0xdf6a59 : 0xe8f4db, alpha); this.entG.strokeCircle(p.x, p.y, g.r * 0.5);
      // Health bar for damaged destructible towers (hp defined and below the type's maxHp).
      const tMax = content.towers[tw.typeId]?.maxHp;
      if (typeof tw.hp === "number" && typeof tMax === "number" && tMax > 0 && tw.hp < tMax) {
        const frac = Math.max(0, Math.min(1, tw.hp / tMax));
        this.entG.fillStyle(0x1b1d18, 1); this.entG.fillRect(p.x - g.r * 0.45, p.y + g.r * 0.5, g.r * 0.9, 4);
        this.entG.fillStyle(frac > 0.35 ? 0x8ac783 : 0xdf6a59, 1); this.entG.fillRect(p.x - g.r * 0.45, p.y + g.r * 0.5, g.r * 0.9 * frac, 4);
      }
      this.shieldRing(this.entG, p.x, p.y, g.r * 0.66, resolveShieldPresentation(snap, "tower", tw.id));
      let label = this.towerLabels.get(tw.id);
      const text = (content.towers[tw.typeId]?.label || tw.typeId).slice(0, 2);
      if (!label) { label = this.add.text(0, 0, text, { fontFamily: "sans-serif", color: "#101410" }).setOrigin(0.5).setDepth(10); this.towerLabels.set(tw.id, label); }
      label.setText(text).setFontSize(Math.max(10, Math.round(g.r * 0.42))).setPosition(p.x, p.y).setAlpha(alpha);
    }
    for (const [id, lbl] of this.towerLabels) { if (!seen.has(id)) { lbl.destroy(); this.towerLabels.delete(id); } }

    // Every supported heroes schema renders from the exact fail-closed engine snapshot. V1 remains
    // static; validated v2/v3 movement input dispatches GameCommandV4 while this scene only presents.
    const heroPresentation = projectHeroesPresentation(snap);
    const seenHeroes = new Set();
    for (const hero of heroPresentation.units) {
      seenHeroes.add(hero.id);
      const point = projectHeroPresentationPoint(hero, (coord) => this.center(coord, g));
      if (!point) continue;
      const passiveAura = hero.passiveAura;
      if (passiveAura?.active) {
        this.entG.lineStyle(Math.max(2, g.r * 0.08), 0x7ae8d6, 0.55);
        this.entG.strokeCircle(point.x, point.y, Math.max(g.r * 0.72, passiveAura.radius * g.r));
        for (const towerId of passiveAura.affectedTowerIds) {
          const towerPoint = towerPositions.get(towerId);
          if (towerPoint) this.entG.strokeCircle(towerPoint.x, towerPoint.y, g.r * 0.62);
        }
      }
      const heroBindings = ownDataValue(ownDataValue(content.visuals, "bindings"), "heroes");
      const spriteId = ownDataValue(heroBindings, hero.definitionId);
      const texture = this.spriteTexture(spriteId);
      let image = this.heroImages.get(hero.id);
      let label = this.heroLabels.get(hero.id);
      const heroAlpha = hero.durability?.defeated ? 0.38 : 1;
      if (texture) {
        if (!image) {
          image = this.add.image(point.x, point.y, texture.key, texture.frame).setDepth(9);
          this.heroImages.set(hero.id, image);
        }
        image.setTexture(texture.key, texture.frame).setPosition(point.x, point.y)
          .setDisplaySize(g.r * 1.35, g.r * 1.35).setAlpha(heroAlpha).setVisible(true);
        if (label) { label.destroy(); this.heroLabels.delete(hero.id); label = null; }
      } else {
        if (image) { image.destroy(); this.heroImages.delete(hero.id); image = null; }
        this.entG.fillStyle(0xe6b85c, heroAlpha); this.entG.fillCircle(point.x, point.y, g.r * 0.5);
        this.entG.lineStyle(2, 0xfff0bd, heroAlpha); this.entG.strokeCircle(point.x, point.y, g.r * 0.5);
        if (!label) {
          label = this.add.text(0, 0, "", { fontFamily: "sans-serif", fontStyle: "bold", color: "#101410" }).setOrigin(0.5).setDepth(10);
          this.heroLabels.set(hero.id, label);
        }
        label.setText(hero.label.slice(0, 2)).setFontSize(Math.max(10, Math.round(g.r * 0.38)))
          .setPosition(point.x, point.y).setAlpha(heroAlpha).setVisible(true);
      }
      if (hero.durability) {
        const width = g.r * 1.05;
        const height = Math.max(3, g.r * 0.13);
        const x = point.x - width / 2;
        const y = point.y - g.r * 0.82;
        const hpRatio = hero.durability.hp / hero.durability.maxHp;
        this.entG.fillStyle(0x000000, 0.65);
        this.entG.fillRect(x - 1, y - 1, width + 2, height + 2);
        this.entG.fillStyle(hpRatio > 0.35 ? 0x73cf82 : 0xdf6a59, 1);
        this.entG.fillRect(x, y, width * hpRatio, height);
        if (hero.durability.shield) {
          this.shieldRing(this.entG, point.x, point.y, g.r * 0.62, {
            ratio: hero.durability.shield.current / hero.durability.shield.capacity
          });
        }
        if (hero.durability.defeated) {
          const radius = g.r * 0.38;
          this.entG.lineStyle(Math.max(2, g.r * 0.1), 0xdf6a59, 1);
          this.entG.lineBetween(point.x - radius, point.y - radius, point.x + radius, point.y + radius);
          this.entG.lineBetween(point.x + radius, point.y - radius, point.x - radius, point.y + radius);
        }
      }
    }
    for (const [id, image] of this.heroImages) {
      if (!seenHeroes.has(id)) { image.destroy(); this.heroImages.delete(id); }
    }
    for (const [id, label] of this.heroLabels) {
      if (!seenHeroes.has(id)) { label.destroy(); this.heroLabels.delete(id); }
    }

    const seenMarkLabels = new Set();
    const seenExposureLabels = new Set();
    const componentRowsByEnemyId = new Map();
    for (const row of projectEnemyComponentsPresentation(snap).rows) {
      const existing = componentRowsByEnemyId.get(row.enemyId);
      if (existing) existing.push(row);
      else componentRowsByEnemyId.set(row.enemyId, [row]);
    }
    const enemyFormationsByEnemyId = new Map(
      projectEnemyFormationsPresentation(snap).rows.map((row) => [row.enemyId, row])
    );
    const vanguardDamageInterceptedCues = projectVanguardProtectionPresentation(snap).cues;
    const vanguardProtectionCueEnemyIds = new Set(vanguardDamageInterceptedCues.flatMap((cue) => [
      cue.protectedEnemyId,
      cue.vanguardEnemyId
    ]));
    for (const en of snap.enemies) {
      const p = this.enemyPos(en, snap, g);
      if (!p) continue;
      const color = Number(content.enemies[en.typeId]?.color ?? 0xaaaaaa);
      this.entG.fillStyle(color, 1); this.entG.fillCircle(p.x, p.y, g.r * 0.38);
      this.entG.lineStyle(2, 0x111111, 1); this.entG.strokeCircle(p.x, p.y, g.r * 0.38);
      const ratio = Math.max(0, en.hp / en.maxHp);
      this.entG.fillStyle(0x1b1d18, 1); this.entG.fillRect(p.x - g.r * 0.45, p.y - g.r * 0.62, g.r * 0.9, 4);
      this.entG.fillStyle(ratio > 0.35 ? 0x8ac783 : 0xdf6a59, 1); this.entG.fillRect(p.x - g.r * 0.45, p.y - g.r * 0.62, g.r * 0.9 * ratio, 4);
      this.shieldRing(this.entG, p.x, p.y, g.r * 0.52, resolveShieldPresentation(snap, "enemy", en.id));
      const formation = enemyFormationsByEnemyId.get(en.id);
      if (formation) {
        const formationColor = formation.role === "vanguard" ? 0xf0b45b
          : formation.role === "support" ? 0x73bfe8 : 0xa79bdc;
        this.entG.lineStyle(Math.max(1, g.r * 0.07), formationColor, 1);
        this.entG.strokeCircle(p.x, p.y, g.r * 0.46);
      }
      if (vanguardProtectionCueEnemyIds.has(en.id)) {
        this.entG.lineStyle(Math.max(1, g.r * 0.09), 0xf7d774, 1);
        this.entG.strokeCircle(p.x, p.y, g.r * 0.58);
      }
      const components = componentRowsByEnemyId.get(en.id) ?? [];
      if (components.length > 0) {
        const width = g.r * 0.9, cellWidth = width / components.length;
        for (let index = 0; index < components.length; index += 1) {
          const row = components[index], x = p.x - width / 2 + index * cellWidth, y = p.y + g.r * 0.48;
          this.entG.fillStyle(0x1b1d18, 1); this.entG.fillRect(x, y, Math.max(1, cellWidth - 1), 3);
          this.entG.fillStyle(row.destroyed ? 0xdf6a59 : 0x8ac783, 1);
          this.entG.fillRect(x, y, Math.max(0, cellWidth - 1) * row.hpRatio, 3);
        }
      }
      const exposurePresentation = resolveExposurePresentation(snap, en.id);
      const exposureBadges = exposurePresentation.entries.map((entry) => ({ key: entry.exposureId, label: String(entry.stacks) }));
      if (exposurePresentation.overflowCount > 0) exposureBadges.push({ key: "overflow", label: "+" + exposurePresentation.overflowCount });
      const exposureRadius = Math.max(3, g.r * 0.12), exposureStep = exposureRadius * 2.25;
      for (let index = 0; index < exposureBadges.length; index += 1) {
        const row = Math.floor(index / 4), rowCount = Math.min(4, exposureBadges.length - row * 4), column = index % 4;
        const x = p.x + (column - (rowCount - 1) / 2) * exposureStep;
        const y = p.y - g.r * 0.86 - row * exposureStep;
        this.entG.fillStyle(0x1c6982, 0.94); this.entG.fillCircle(x, y, exposureRadius);
        this.entG.lineStyle(Math.max(1, exposureRadius * 0.18), 0x9de9ff, 0.95); this.entG.strokeCircle(x, y, exposureRadius);
        const labelKey = en.id + "|" + exposureBadges[index].key;
        seenExposureLabels.add(labelKey);
        let label = this.exposureLabels.get(labelKey);
        if (!label) {
          label = this.add.text(0, 0, "", { fontFamily: "sans-serif", fontStyle: "bold", color: "#effcff" }).setOrigin(0.5).setDepth(12);
          this.exposureLabels.set(labelKey, label);
        }
        label.setText(exposureBadges[index].label).setFontSize(Math.max(7, Math.round(exposureRadius * 1.2))).setPosition(x, y).setVisible(true);
      }
      const markPresentation = resolveMarkPresentation(snap, en.id);
      const badges = markPresentation.entries.map((entry) => ({ key: entry.markId, label: String(entry.stacks) }));
      if (markPresentation.overflowCount > 0) badges.push({ key: "overflow", label: "+" + markPresentation.overflowCount });
      const radius = Math.max(3, g.r * 0.13), step = radius * 2.25;
      for (let index = 0; index < badges.length; index += 1) {
        const row = Math.floor(index / 4), rowCount = Math.min(4, badges.length - row * 4), column = index % 4;
        const x = p.x + (column - (rowCount - 1) / 2) * step;
        const y = p.y + g.r * 0.64 + row * step;
        this.entG.fillStyle(0x5b3580, 0.92); this.entG.fillCircle(x, y, radius);
        this.entG.lineStyle(Math.max(1, radius * 0.18), 0xe0c4ff, 0.92); this.entG.strokeCircle(x, y, radius);
        const labelKey = en.id + "|" + badges[index].key;
        seenMarkLabels.add(labelKey);
        let label = this.markLabels.get(labelKey);
        if (!label) {
          label = this.add.text(0, 0, "", { fontFamily: "sans-serif", fontStyle: "bold", color: "#fff5ff" }).setOrigin(0.5).setDepth(12);
          this.markLabels.set(labelKey, label);
        }
        label.setText(badges[index].label).setFontSize(Math.max(7, Math.round(radius * 1.2))).setPosition(x, y).setVisible(true);
      }
    }
    for (const [key, label] of this.markLabels) {
      if (!seenMarkLabels.has(key)) { label.destroy(); this.markLabels.delete(key); }
    }
    for (const [key, label] of this.exposureLabels) {
      if (!seenExposureLabels.has(key)) { label.destroy(); this.exposureLabels.delete(key); }
    }

    for (const hero of heroPresentation.units) {
      const blocking = hero.blocking;
      if (!blocking?.active) continue;
      const heroPoint = projectHeroPresentationPoint(hero, (coord) => this.center(coord, g));
      this.entG.lineStyle(Math.max(2, g.r * 0.11), 0xffbb5c, 0.92);
      if (heroPoint) this.entG.strokeCircle(heroPoint.x, heroPoint.y, g.r * 0.72);
      for (const enemyId of blocking.blockedEnemyIds) {
        const enemyPoint = enemyPositions.get(enemyId);
        if (enemyPoint) this.entG.strokeCircle(enemyPoint.x, enemyPoint.y, g.r * 0.54);
      }
    }

    // Outcome banner (VICTORY/DEFEAT), matching the canvas renderer so the phaser build doesn't
    // hide the end-of-mission state.
    const ended = snap.outcome === "victory" || snap.outcome === "defeat";
    if (ended && !this.outcomeText) {
      this.outcomeText = this.add.text(0, 0, "", { fontFamily: "sans-serif", fontStyle: "bold" }).setOrigin(0.5).setDepth(20);
    }
    if (this.outcomeText) {
      if (ended) {
        this.outcomeText.setText(snap.outcome === "victory" ? "VICTORY" : "DEFEAT")
          .setColor(snap.outcome === "victory" ? "#8ac783" : "#df6a59")
          .setFontSize(Math.max(28, Math.round(this.scale.height * 0.12)))
          .setPosition(this.scale.width / 2, this.scale.height / 2)
          .setVisible(true);
      } else {
        this.outcomeText.setVisible(false);
      }
    }

    this.previousEnemyPositions = enemyPositions;
    this.previousTowerPositions = towerPositions;
    this.previousCombat = authoritativeSnapshot.combat ?? null;
    this.previousProceduralJuiceSnapshot = presentationSnapshot;
    updateHud(authoritativeSnapshot);
  }

  drawElevationPresentation(presentation, g) {
    const retained = new Set();
    if (presentation?.active) {
      for (const cue of presentation.cues) {
        const key = cue.coord.q + "," + cue.coord.r;
        const p = this.center(cue.coord, g);
        const color = cue.elevation > 0 ? 0xffdd84 : 0x75caf1;
        retained.add(key);
        this.tileG.lineStyle(Math.max(1, g.r * 0.08), color, 0.88);
        if (g.grid.kind === "square") {
          const size = g.r * 1.45;
          this.tileG.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
        } else {
          this.tileG.strokeCircle(p.x, p.y, g.r * 0.69);
        }
        let label = this.elevationLabels.get(key);
        if (!label) {
          label = this.add.text(0, 0, cue.label, {
            fontFamily: "sans-serif",
            fontStyle: "bold",
            color: "#fff8df",
            backgroundColor: cue.elevation > 0 ? "#5c4712" : "#14435b",
            padding: { x: 3, y: 1 }
          }).setOrigin(0.5).setDepth(4);
          this.elevationLabels.set(key, label);
        }
        label.setText(cue.label).setPosition(p.x + g.r * 0.28, p.y - g.r * 0.7).setVisible(true);
        label.setFontSize(Math.max(8, g.r * 0.3));
      }
      if (presentation.overflowCount > 0) {
        const key = "__overflow__";
        const text = "+" + presentation.overflowCount + " elevation cues";
        retained.add(key);
        let label = this.elevationLabels.get(key);
        if (!label) {
          label = this.add.text(0, 0, text, {
            fontFamily: "sans-serif",
            fontStyle: "bold",
            color: "#fff8df",
            backgroundColor: "#141814",
            padding: { x: 6, y: 3 }
          }).setOrigin(1, 0).setDepth(5);
          this.elevationLabels.set(key, label);
        }
        label.setText(text).setPosition(this.scale.width - 12, 12).setVisible(true);
        label.setFontSize(Math.max(10, g.r * 0.32));
      }
    }
    for (const [key, label] of this.elevationLabels) {
      if (retained.has(key)) continue;
      label.destroy();
      this.elevationLabels.delete(key);
    }
  }
}

phaserGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "playfield",
  transparent: true,
  // Low-end-Android render hardening (ported from a shipped Capacitor game): no MSAA (fill-rate is
  // the #1 killer on cheap GPUs), request the high-performance GPU, and a low-latency canvas.
  // panicMax bounds delta catch-up so a background stall can't trigger a spiral-of-death on resume.
  render: { antialias: false, powerPreference: "high-performance", desynchronized: true, roundPixels: true },
  fps: { target: 60, limit: 60, panicMax: 120 },
  scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
  scene: PlayScene
});
window.__towerforgeInspect = () => {
  const snapshot = game.getRenderSnapshot();
  if (snapshot.lastEvents.length === 0 && lastObservedEvents.length > 0) {
    snapshot.lastEvents = lastObservedEvents;
  }
  return snapshot;
};
window.render_game_to_text = () => {
  const snapshot = window.__towerforgeInspect();
  const vanguardProtection = projectVanguardProtectionPresentation(snapshot);
  return JSON.stringify({
    coordinateSystem: "tile coordinates: q increases right/east; r increases down/south",
    missionId: snapshot.missionId,
    outcome: snapshot.outcome,
    coreHp: snapshot.coreHp,
    maxCoreHp: snapshot.maxCoreHp,
    waveState: snapshot.waveState,
    startedWaveCount: snapshot.startedWaveCount,
    resources: snapshot.resources,
    towers: snapshot.towers.map((tower) => ({ id: tower.id, typeId: tower.typeId, coord: tower.coord })),
    enemies: snapshot.enemies.map((enemy) => ({
      id: enemy.id, typeId: enemy.typeId, hp: enemy.hp,
      coord: enemy.navigation?.currentCoord ?? null, routeProgress: enemy.pathProgress
    })),
    ...(vanguardProtection.active ? { vanguardProtection } : {})
  });
};
window.__towerforgeCampaignInspect = () => ({
  active: Boolean(activeCampaign && campaignRun),
  run: campaignRun ? JSON.parse(exportCampaignRun(campaignRun)) : null,
  pendingNodeId: pendingCampaignNodeId,
  availableNodeIds: activeCampaign && campaignRun ? [...getAvailableCampaignNodeIds(campaignRun, content)] : []
});
window.__towerforgeTilePoint = (coord) => {
  const scene = phaserGame.scene.getScenes(true)[0];
  if (!scene) return null;
  const snapshot = game.getRenderSnapshot();
  const point = scene.center(coord, scene.geometry(snapshot.tiles, snapshot.grid));
  const rect = phaserGame.canvas.getBoundingClientRect();
  return { x: rect.left + point.x * rect.width / scene.scale.width, y: rect.top + point.y * rect.height / scene.scale.height };
};
window.__towerforgeEnemyPoint = (enemyId) => {
  const scene = phaserGame.scene.getScenes(true)[0];
  if (!scene) return null;
  const snapshot = game.getRenderSnapshot();
  const enemy = snapshot.enemies.find((candidate) => candidate.id === enemyId);
  if (!enemy) return null;
  const point = scene.enemyPos(enemy, snapshot, scene.geometry(snapshot.tiles, snapshot.grid));
  const rect = phaserGame.canvas.getBoundingClientRect();
  return { x: rect.left + point.x * rect.width / scene.scale.width, y: rect.top + point.y * rect.height / scene.scale.height };
};
window.__towerforgePickPoint = (point) => {
  const scene = phaserGame.scene.getScenes(true)[0];
  if (!scene) return null;
  const rect = phaserGame.canvas.getBoundingClientRect();
  return scene.pickTile((point.x - rect.left) * scene.scale.width / rect.width, (point.y - rect.top) * scene.scale.height / rect.height);
};
window.__towerforgeBootOk = true;
const bootError = document.getElementById("boot-error");
if (bootError) bootError.hidden = true;

// Free the audio hardware while the app is backgrounded (the scene's update() already bails on
// document.hidden). Saves battery in a wrapped APK; no-op on desktop.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { audio.suspend(); }
  else if ($("snd")?.checked) { audio.resume(); }
});

// Register the offline service worker (the canvas player does the same) so the phaser build is
// actually an installable, offline-capable PWA — Phaser is vendored locally precisely for this.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./offline-sw.js").catch(() => {}));
}

function initSelectors() {
  const missionSelect = $("mission-select");
  // Start on an unlocked mission (the default may be gated behind unlockRequiresMissionIds).
  if (!isUnlocked(missionId)) { const first = Object.keys(content.missions).find(isUnlocked); if (first) { missionId = first; game = createGame(); } }
  refreshMissionOptions();
  initDifficultySelector();
  missionSelect.addEventListener("change", () => {
    if (!isUnlocked(missionSelect.value)) { missionSelect.value = missionId; return; } // locked
    pendingCampaignNodeId = null;
    pendingCampaignBattle = false;
    missionId = missionSelect.value;
    towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
    game = createGame();
    setTargetingMode({ kind: "build" });
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
  select.innerHTML = content.difficulties.map((item) => \`<option value="\${escapeHtml(item.id)}">\${escapeHtml(item.label || item.id)}</option>\`).join("");
  select.value = currentPlayerLaunchOptions().difficultyId;
  select.onchange = () => {
    const result = choosePlayerDifficulty(select.value);
    if (!result.ok) { select.value = currentPlayerLaunchOptions().difficultyId; return; }
    game = createGame();
    setTargetingMode({ kind: "build" });
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
    return \`<option value="\${escapeHtml(id)}">\${escapeHtml(tower?.label || id)}</option>\`;
  }).join("");
  towerId = ids[0] || "";
  towerSelect.value = towerId;
  towerSelect.onchange = () => { towerId = towerSelect.value; refreshNavigationOverlay(); };
}

function setTargetingMode(next) {
  targetingMode = next;
  $("sell-mode").setAttribute("aria-pressed", String(targetingMode.kind === "sell"));
  for (const btn of document.querySelectorAll("#ability-bar button")) {
    btn.classList.toggle("armed", targetingMode.kind === "missionAbility" && btn.dataset.aid === targetingMode.abilityId);
  }
  const heroButton = document.querySelector("#hero-action-bar button");
  if (heroButton) heroButton.classList.toggle("armed", targetingMode.kind === "heroAbility");
  if (targetingMode.kind === "build") refreshNavigationOverlay(); else clearNavigationOverlay();
}
function setArmed(id) {
  if (!id) { setTargetingMode({ kind: "build" }); return; }
  setTargetingMode({ kind: "missionAbility", abilityId: id });
  message = "Click the map to use " + ((game.getSnapshot().abilities[id] || {}).label || id) + ".";
}
function initAbilityBar() {
  const bar = $("ability-bar");
  if (!bar) return;
  const abilities = Object.values(game.getSnapshot().abilities || {});
  bar.innerHTML = abilities.map((a) => \`<button data-aid="\${escapeHtml(a.id)}" title="Radius \${a.radius}, cooldown \${a.cooldown}">\${escapeHtml(a.label || a.id)}</button>\`).join("");
  setTargetingMode({ kind: "build" });
  for (const btn of bar.querySelectorAll("button")) {
    btn.onclick = () => { audio.resume(); setArmed(
      targetingMode.kind === "missionAbility" && targetingMode.abilityId === btn.dataset.aid
        ? null
        : btn.dataset.aid
    ); };
  }
}
function updateAbilityBar(snap) {
  for (const btn of document.querySelectorAll("#ability-bar button")) {
    const a = snap.abilities ? snap.abilities[btn.dataset.aid] : null;
    const ready = !!a && a.ready;
    btn.disabled = !ready;
    const cd = Math.ceil((a && a.cooldownRemaining) || 0);
    btn.textContent = ((a && a.label) || btn.dataset.aid) + (cd > 0 ? " (" + cd + ")" : "");
    if (!ready && targetingMode.kind === "missionAbility" && targetingMode.abilityId === btn.dataset.aid) setArmed(null);
  }
}

function activeHeroAbilityUnit(snapshot = game.getRenderSnapshot()) {
  const presentation = projectHeroesPresentation(snapshot);
  const hero = presentation.active && presentation.units.length === 1
    ? presentation.units[0]
    : null;
  return hero?.activeAbility && hero?.mana ? hero : null;
}

function armCurrentHeroAbility() {
  const hero = activeHeroAbilityUnit();
  if (!hero || !hero.activeAbility.ready) return;
  setTargetingMode({ kind: "heroAbility", heroId: hero.id, abilityId: hero.activeAbility.id });
  message = "Choose a live enemy for " + hero.activeAbility.label + ".";
}

function updateHeroActionBar(snap) {
  const hero = activeHeroAbilityUnit(snap);
  let bar = document.getElementById("hero-action-bar");
  if (!hero) {
    if (bar) bar.remove();
    if (targetingMode.kind === "heroAbility") setTargetingMode({ kind: "build" });
    return;
  }
  if (!bar) {
    bar = document.createElement("section");
    bar.id = "hero-action-bar";
    bar.className = "ability-bar hero-action-bar";
    bar.setAttribute("aria-label", "Hero actions");
    $("message").before(bar);
  }
  let button = bar.querySelector("button");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => {
      audio.resume();
      if (targetingMode.kind === "heroAbility") setTargetingMode({ kind: "build" });
      else armCurrentHeroAbility();
    });
    bar.append(button);
  }
  let status = bar.querySelector("span");
  if (!status) { status = document.createElement("span"); bar.append(status); }
  const ability = hero.activeAbility;
  button.disabled = !ability.ready;
  button.dataset.heroId = hero.id;
  button.dataset.abilityId = ability.id;
  button.classList.toggle("armed", targetingMode.kind === "heroAbility");
  const cooldown = Math.ceil(ability.cooldownRemaining);
  button.textContent = ability.label + " [1]" + (cooldown > 0 ? " (" + cooldown + ")" : "");
  button.title = "Mana " + hero.mana.current + "/" + hero.mana.max + " · Cost " + ability.manaCost;
  status.textContent = "Mana " + hero.mana.current + "/" + hero.mana.max
    + " (+" + hero.mana.regenerationPerUnit + ")";
  bar.dataset.manaCurrent = String(hero.mana.current);
  bar.dataset.manaMax = String(hero.mana.max);
  bar.dataset.cooldownRemaining = String(ability.cooldownRemaining);
  if (!ability.ready && targetingMode.kind === "heroAbility") setTargetingMode({ kind: "build" });
}

function updateHeroSkillTree(snap) {
  const presentation = projectHeroesPresentation(snap);
  const unit = presentation.active && presentation.units.length === 1
    ? presentation.units[0]
    : null;
  const skills = unit?.skills;
  let panel = document.getElementById("hero-skill-tree");
  const panelCreated = !panel;
  if (!skills) {
    if (panel) panel.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "hero-skill-tree";
    panel.className = "roguelite-status hero-skill-tree";
    panel.setAttribute("aria-label", "Hero skill tree");
    const heading = document.createElement("strong");
    heading.textContent = "Hero skills";
    const status = document.createElement("span");
    status.dataset.heroSkillPoints = "true";
    const nodes = document.createElement("div");
    nodes.dataset.heroSkillNodes = "true";
    panel.append(heading, status, nodes);
    $("message").before(panel);
  }
  const status = panel.querySelector("[data-hero-skill-points]");
  panel.dataset.availablePoints = String(skills.availablePoints);
  status.textContent = "Available points: " + skills.availablePoints;
  const nodes = panel.querySelector("[data-hero-skill-nodes]");
  const retained = new Set();
  for (let nodeIndex = 0; nodeIndex < skills.nodes.length; nodeIndex += 1) {
    const node = skills.nodes[nodeIndex];
    retained.add(node.id);
    let button = [...nodes.querySelectorAll("button")]
      .find((candidate) => candidate.dataset.heroSkillId === node.id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.heroSkillId = node.id;
      button.addEventListener("click", () => {
        const result = dispatchGameCommand(game, {
          schemaVersion: 6,
          type: "unlockHeroSkill",
          heroId: button.dataset.heroId,
          skillId: button.dataset.heroSkillId
        });
        report(result);
        updateHeroSkillTree(game.getRenderSnapshot());
      });
      button.addEventListener("touchend", (event) => {
        event.preventDefault();
        button.click();
      }, { passive: false });
    }
    button.dataset.heroId = unit.id;
    button.disabled = !skills.managementAvailable || !node.unlockable;
    button.textContent = (node.unlocked ? "Unlocked: " : "Unlock: ")
      + node.label + " (" + node.cost + ")";
    button.title = node.description;
    if (nodes.children[nodeIndex] !== button) {
      nodes.insertBefore(button, nodes.children[nodeIndex] ?? null);
    }
  }
  for (const button of [...nodes.querySelectorAll("button")]) {
    if (!retained.has(button.dataset.heroSkillId)) button.remove();
  }
  if (panelCreated) panel.scrollIntoView({ block: "nearest" });
}

function updateCampaignRun() {
  const panel = $("campaign-run-panel");
  if (!panel) return;
  const presentation = projectCampaignPresentation(activeCampaign && campaignRun ? {
    campaign: activeCampaign,
    run: campaignRun,
    availableNodeIds: getAvailableCampaignNodeIds(campaignRun, content)
  } : undefined) || projectCampaignPresentation();
  panel.hidden = !presentation.active;
  if (!presentation.active) return;
  const resourceSummary = (presentation.runResources || [])
    .map((resource) => resource.label + ": " + resource.amount)
    .join(" · ");
  $("campaign-run-summary").textContent = (pendingCampaignNodeId
    ? "Battle selected: " + pendingCampaignNodeId
    : presentation.currentNodeId
      ? "Current: " + presentation.currentNodeId
      : "Choose an available entry node") + (resourceSummary ? " · " + resourceSummary : "");
  const nodes = $("campaign-run-nodes");
  nodes.replaceChildren();
  for (const node of presentation.nodes) {
    const hasChoices = Array.isArray(node.choices) && node.choices.length > 0;
    const row = document.createElement(node.state === "available" && !hasChoices ? "button" : "div");
    if (row instanceof HTMLButtonElement) {
      row.type = "button";
      row.addEventListener("click", () => selectCampaignNode(node.id));
    }
    row.className = "campaign-run-node";
    row.setAttribute("data-state", node.state);
    const title = document.createElement("span");
    title.textContent = node.label || content.missions[node.missionId]?.label || node.missionId || node.id;
    const state = document.createElement("span");
    state.textContent = node.type + " · " + node.state;
    row.append(title, state);
    if (node.state === "available" && hasChoices) {
      const choices = document.createElement("div");
      choices.className = "campaign-run-choices";
      for (const choice of node.choices) {
        const choiceButton = document.createElement("button");
        choiceButton.type = "button";
        choiceButton.className = "campaign-run-choice";
        choiceButton.setAttribute("data-campaign-choice-id", choice.id);
        choiceButton.textContent = formatCampaignChoice(choice, presentation.runResources || []);
        choiceButton.title = "Resolve campaign choice";
        choiceButton.addEventListener("click", () => selectCampaignChoice(node.id, choice.id));
        choices.append(choiceButton);
      }
      row.append(choices);
    }
    nodes.append(row);
  }
}

function formatCampaignChoice(choice, resources) {
  const label = (resourceId) => resources.find((entry) => entry.id === resourceId)?.label || resourceId;
  const costs = choice.costs.map((entry) => label(entry.resourceId) + ":" + entry.amount).join(", ") || "free";
  const grants = choice.grants.map((entry) => label(entry.resourceId) + ":" + entry.amount).join(", ") || "none";
  return choice.label + " · " + costs + " → " + grants;
}

function selectCampaignChoice(nodeId, choiceId) {
  if (!activeCampaign || !campaignRun) return;
  const result = resolveCampaignStructuralChoice(campaignRun, content, nodeId, choiceId);
  if (result.ok) {
    campaignRun = result.run;
    pendingCampaignNodeId = null;
    pendingCampaignBattle = false;
    message = "Campaign choice resolved: " + choiceId + ".";
    updateCampaignRun();
    return;
  }
  message = "Campaign choice rejected: " + result.code + ".";
  updateCampaignRun();
}

function selectCampaignNode(nodeId) {
  if (!activeCampaign || !campaignRun) return;
  const prepared = prepareCampaignBattle(campaignRun, content, nodeId);
  if (prepared.ok) {
    pendingCampaignBattle = true;
    pendingCampaignNodeId = prepared.nodeId;
    missionId = prepared.missionId;
    game = prepared.game;
  } else if (prepared.code === "campaign_handoff_inactive") {
    // Campaign marker v1 retains the legacy graph reducer without battle carry.
    const availableNodeIds = getAvailableCampaignNodeIds(campaignRun, content);
    const node = activeCampaign.nodes.find((candidate) => candidate.id === nodeId);
    if (!availableNodeIds.includes(nodeId) || !node || node.type === "merchant" || node.type === "event") {
      message = "Campaign node is not available.";
      return;
    }
    pendingCampaignBattle = false;
    pendingCampaignNodeId = node.id;
    missionId = node.missionId;
    game = createGame();
  } else {
    message = "Campaign battle could not be prepared: " + prepared.code + ".";
    return;
  }
  towerId = content.missions[missionId]?.buildTowerIds?.[0] || Object.keys(content.towers)[0];
  setTargetingMode({ kind: "build" });
  refreshMissionOptions();
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
  message = "Campaign battle selected: " + nodeId + ".";
  updateCampaignRun();
}

function setupCampaignRunControls() {
  const exportButton = $("campaign-run-export");
  const importButton = $("campaign-run-import");
  const fileInput = $("campaign-run-file");
  if (!exportButton || !importButton || !fileInput) return;
  exportButton.addEventListener("click", () => {
    if (!campaignRun) return;
    const source = exportCampaignRun(campaignRun);
    const url = URL.createObjectURL(new Blob([source], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "towerforge-campaign-run.json";
    link.click();
    URL.revokeObjectURL(url);
  });
  importButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    if (pendingCampaignNodeId) {
      fileInput.value = "";
      message = "Campaign run import cannot replace an active battle.";
      return;
    }
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file || !activeCampaign) return;
    if (file.size > 1_048_576) {
      message = "Campaign run import failed: file exceeds 1 MiB.";
      return;
    }
    try {
      const decoded = importCampaignRun(await file.text()).run;
      const validation = validateCampaignRunAgainstContent(decoded, content);
      if (!validation.ok) throw new Error("Campaign run is incompatible with this project: " + validation.code);
      pendingCampaignNodeId = null;
      pendingCampaignBattle = false;
      campaignRun = validation.run;
      message = "Campaign run imported.";
      updateCampaignRun();
    } catch (error) {
      message = "Campaign run import failed: " + error.message;
    }
  });
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

function updateHud(snap) {
  updateAbilityBar(snap);
  updateHeroActionBar(snap);
  updateHeroSkillTree(snap);
  updateTargetMode(snap);
  updateRogueliteStatus(snap);
  updateArsenalStatus(snap);
  updateLogisticsStatus(snap);
  updateQuestStatus(snap);
  if (snap.outcome === "victory" && !victoryRewarded) {
    victoryRewarded = true;
    const earnedStars = (snap.stars || []).filter((item) => item.achieved).length;
    if (activeCampaign && campaignRun && pendingCampaignNodeId) {
      const result = pendingCampaignBattle
        ? settleCampaignBattleVictory(campaignRun, progress, content, pendingCampaignNodeId, earnedStars, game)
        : recordCampaignBattleVictory(campaignRun, progress, content, pendingCampaignNodeId, earnedStars);
      if (result.ok) {
        campaignRun = result.run;
        progress = result.profile;
        persistPlayerProfile();
        renderMetaPanel();
        message = "Campaign battle recorded. Available: " + (result.newlyAvailableNodeIds.join(", ") || "none");
      } else {
        message = "Campaign battle could not be recorded: " + result.code;
      }
      pendingCampaignNodeId = null;
      pendingCampaignBattle = false;
      updateCampaignRun();
    } else {
      recordPlayerVictory(missionId, earnedStars);
    }
    refreshMissionOptions();
    showStoryForMission("afterVictory");
  }
  $("mission-caption").textContent = content.missions[missionId]?.description || content.missions[missionId]?.label || missionId;
  $("stat-outcome").textContent = snap.outcome;
  $("stat-core").textContent = \`\${snap.coreHp}/\${snap.maxCoreHp}\`;
  $("stat-resources").textContent = Object.entries(snap.resources).map(([id, value]) => { const c = (content.currencies || []).find((c) => c.id === id); return \`\${c ? c.label : id}: \${value}\`; }).join(" · ");
  $("stat-wave").textContent = \`\${snap.startedWaveCount}/\${snap.totalWaves} \${snap.waveState}\`;
  $("stat-enemies").textContent = String(snap.enemies.length);
  $("stat-towers").textContent = String(snap.towers.length);
  const objectives = snap.objectiveProgress || [];
  const stars = snap.stars || [];
  $("stat-objectives").textContent = objectives.filter((item) => item.complete).length + "/" + objectives.length
    + (stars.length ? " | " + stars.filter((item) => item.achieved).length + "/" + stars.length + " stars" : "");
  $("message").textContent = playerProfileStatusText(message);
}

function updateRogueliteStatus(snap) {
  const panel = $("roguelite-status");
  const draftPanel = $("wave-draft");
  const artifactPanel = $("artifact-inventory");
  if (!panel || !draftPanel || !artifactPanel) return;
  const source = snap?.roguelite;
  const nextCache = {
    synergies: source?.synergies,
    inventory: source?.artifacts?.inventory,
    towerSlots: source?.artifacts?.towerSlots,
    allowed: source?.artifacts?.management?.allowed,
    reasonKey: source?.artifacts?.management?.reasonKey,
    pendingOffer: source?.draft?.pendingOffer,
    selections: source?.draft?.selections,
    selectedTowerId
  };
  const previousCache = updateRogueliteStatus.lastRender;
  if (previousCache
    && previousCache.synergies === nextCache.synergies
    && previousCache.inventory === nextCache.inventory
    && previousCache.towerSlots === nextCache.towerSlots
    && previousCache.allowed === nextCache.allowed
    && previousCache.reasonKey === nextCache.reasonKey
    && previousCache.pendingOffer === nextCache.pendingOffer
    && previousCache.selections === nextCache.selections
    && previousCache.selectedTowerId === nextCache.selectedTowerId) return;
  updateRogueliteStatus.lastRender = nextCache;
  const presentation = projectRoguelitePresentation(snap);
  if (!presentation) { panel.hidden = true; panel.replaceChildren(); draftPanel.hidden = true; draftPanel.replaceChildren(); artifactPanel.hidden = true; artifactPanel.replaceChildren(); return; }
  panel.hidden = !presentation.active;
  panel.replaceChildren();
  draftPanel.hidden = !presentation.active || !presentation.draft?.pendingOffer;
  draftPanel.replaceChildren();
  artifactPanel.hidden = !presentation.active || !presentation.artifacts;
  artifactPanel.replaceChildren();
  if (!presentation.active) return;
  for (const synergy of presentation.synergies) {
    const row = document.createElement("span");
    const active = synergy.activeTierRequiredCounts.length
      ? "active " + synergy.activeTierRequiredCounts.join("/")
      : "inactive";
    row.textContent = synergy.label + ": " + synergy.towerCount + " towers (" + active + ")";
    panel.append(row);
  }
  const pendingOffer = presentation.draft?.pendingOffer;
  if (pendingOffer) {
    const title = document.createElement("strong");
    title.textContent = "Choose a wave upgrade";
    draftPanel.append(title);
    for (const option of pendingOffer.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-draft-card-id", option.cardId);
      button.textContent = option.label;
      button.addEventListener("click", () => {
        const result = dispatchGameCommand(game, {
          schemaVersion: 3, type: "chooseDraftOption",
          offerId: pendingOffer.offerId,
          cardId: option.cardId
        });
        report(result);
        if (result.ok) updateRogueliteStatus(game.getSnapshot());
      });
      draftPanel.append(button);
    }
  }
  if (presentation.artifacts) {
    const title = document.createElement("strong");
    title.textContent = "Artifacts (" + presentation.artifacts.inventory.length + ")";
    artifactPanel.append(title);
    for (const artifact of presentation.artifacts.inventory) {
      const row = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = artifact.label + " · " + artifact.slotType
        + (artifact.socket ? " → " + artifact.socket.towerId + "/" + artifact.socket.slotId : "");
      row.append(label);
      const addAction = (action, text, activate) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-artifact-action", action);
        button.textContent = text;
        button.disabled = presentation.artifacts.management?.allowed !== true;
        button.addEventListener("click", () => {
          const result = activate();
          report(result);
          if (result.ok) updateRogueliteStatus(game.getSnapshot());
        });
        row.append(button);
      };
      if (artifact.socket) {
        addAction("unsocket", "Unsocket", () => dispatchGameCommand(game, {
          schemaVersion: 2, type: "unsocketArtifact",
          artifactInstanceId: artifact.instanceId,
          towerId: artifact.socket.towerId,
          slotId: artifact.socket.slotId
        }));
      } else {
        const tower = presentation.artifacts.towerSlots?.find((item) => item.towerId === selectedTowerId);
        for (const slot of tower?.slots ?? []) {
          if (slot.slotType !== artifact.slotType || slot.artifactInstanceId !== null) continue;
          addAction("socket", "Socket in " + slot.slotId, () => dispatchGameCommand(game, {
            schemaVersion: 2, type: "socketArtifact",
            artifactInstanceId: artifact.instanceId,
            towerId: tower.towerId,
            slotId: slot.slotId
          }));
        }
      }
      artifactPanel.append(row);
    }
  }
}

function updateQuestStatus(snap) {
  const panel = $("quest-status");
  if (!panel) return;
  const presentation = projectQuestPresentation(snap);
  panel.replaceChildren();
  panel.hidden = !presentation;
  if (!presentation) return;
  const title = document.createElement("strong");
  title.textContent = "Challenges";
  panel.append(title);
  for (const quest of presentation.entries) {
    const row = document.createElement("span");
    row.dataset.status = quest.status;
    row.textContent = quest.label + ": " + quest.current + "/" + quest.target + " · " + quest.status;
    panel.append(row);
  }
}

function updateLogisticsStatus(snapshot) {
  const panel = $("logistics-status");
  if (!panel) return;
  const presentation = projectLogisticsPresentation(snapshot);
  panel.replaceChildren();
  panel.hidden = !presentation.active;
  if (!presentation.active) return;
  const heading = document.createElement("strong");
  heading.textContent = "Logistics";
  panel.append(heading);
  if (presentation.power) {
    for (const component of presentation.power.components) {
      const row = document.createElement("span");
      row.textContent = component.id + ": " + component.allocated + "/" + component.output
        + " allocated · " + component.consumerIds.length + " consumers";
      panel.append(row);
    }
    const brownout = presentation.power.consumers.filter((consumer) => !consumer.powered);
    if (brownout.length) {
      const row = document.createElement("span");
      row.dataset.logisticsBrownout = "true";
      row.textContent = "Brownout: " + brownout.map((consumer) => consumer.towerId).join(", ");
      panel.append(row);
    }
    for (const node of presentation.power.nodes) {
      for (const linkedTowerId of node.linkTowerIds) {
        if (node.towerId >= linkedTowerId) continue;
        const row = document.createElement("span");
        row.className = "logistics-link-cue";
        row.textContent = "Grid link: " + node.towerId + " ↔ " + linkedTowerId;
        panel.append(row);
      }
      for (const consumerTowerId of node.coveredConsumerIds) {
        const row = document.createElement("span");
        row.className = "logistics-coverage-cue";
        row.textContent = "Power coverage: " + node.towerId + " → " + consumerTowerId;
        panel.append(row);
      }
    }
  }
  if (presentation.ammunition) {
    for (const inventory of presentation.ammunition.inventories) {
      const row = document.createElement("span");
      row.className = "logistics-ammunition-cue";
      row.textContent = inventory.towerId + ": " + inventory.amount + "/" + inventory.capacity
        + " " + inventory.ammoTypeId;
      panel.append(row);
      if (!inventory.hasRequiredAmmo) {
        const depleted = document.createElement("span");
        depleted.className = "logistics-depleted-cue";
        depleted.textContent = "Depleted: " + inventory.towerId;
        panel.append(depleted);
      }
    }
  }
  if (presentation.supply) {
    const supply = presentation.supply;
    for (const source of [...supply.producers, ...supply.storages]) {
      const stock = document.createElement("span");
      stock.className = "logistics-supply-stock-cue";
      stock.textContent = source.towerId + ": " + source.amount + "/" + source.capacity
        + " " + source.ammoTypeId;
      panel.append(stock);
      const progress = document.createElement("span");
      progress.className = "logistics-supply-progress-cue";
      progress.textContent = "productionProgress" in source
        ? source.towerId + ": production " + source.productionProgress + "/" + source.productionInterval
          + ", transfer " + source.transferProgress + "/" + source.transferInterval
        : source.towerId + ": transfer " + source.transferProgress + "/" + source.transferInterval;
      panel.append(progress);
      if (!source.operational) {
        const paused = document.createElement("span");
        paused.className = "logistics-supply-paused-cue";
        paused.textContent = "Paused/brownout: " + source.towerId;
        panel.append(paused);
      }
    }
    for (const edge of supply.edges) {
      const link = document.createElement("span");
      link.className = "logistics-supply-link-cue";
      link.textContent = "Supply link: " + edge.sourceTowerId + " → " + edge.destinationTowerId;
      panel.append(link);
      if (edge.destinationKind === "consumer") {
        const refill = document.createElement("span");
        refill.className = "logistics-refill-cue";
        refill.textContent = "Refill: " + edge.sourceTowerId + " → " + edge.destinationTowerId;
        panel.append(refill);
      }
    }
  }
}

function updateTargetMode(snap) {
  const select = $("target-mode");
  const tower = selectedTowerId ? snap.towers.find((item) => item.id === selectedTowerId) : null;
  if (!tower) selectedTowerId = null;
  select.disabled = !tower || !tower.targetMode || Boolean(tower.scriptedTargeting);
  select.title = tower?.scriptedTargeting
    ? "Target priority is controlled by TowerScript " + tower.scriptedTargeting.scriptId + "/" + tower.scriptedTargeting.behaviorTreeId
    : "";
  if (tower && tower.targetMode) select.value = tower.targetMode === "largest_hp" ? "strongest" : tower.targetMode === "fastest_ahead" ? "first" : tower.targetMode;
}

function report(result) { message = result.ok ? "Action accepted." : (result.reason || "Action rejected."); }

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function colorNumber(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? Number.parseInt(value.slice(1), 16) : fallback;
}

function applyProjectTheme() {
  const palette = content.visuals?.theme?.ui ?? {};
  for (const [key, value] of Object.entries(palette)) {
    if (/^[a-z][a-z0-9-]*$/i.test(key) && /^#[0-9a-f]{6}$/i.test(value)) {
      document.documentElement.style.setProperty(\`--\${key}\`, value);
    }
  }
}
`;
}

function serviceWorkerTemplate(precacheAssets = [], cacheVersion = "dev") {
  const assets = ["./", ...precacheAssets];
  return `const CACHE = "towerforge-build-${cacheVersion}";
const ASSETS = ${JSON.stringify(assets)};
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
`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
