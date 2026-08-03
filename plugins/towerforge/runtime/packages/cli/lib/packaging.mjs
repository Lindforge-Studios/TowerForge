// packaging.mjs — wrap a built web bundle into a native app project.
//
//   kind "mobile"  → a Capacitor project (Android/iOS) under <project>/mobile
//   kind "desktop" → a Tauri v2 project (Windows/macOS/Linux) under <project>/desktop
//
// Neither publishes anything and neither needs network: they scaffold a self-contained project
// (native config + the built game bundle + a README with the exact local build + store steps) that
// the author builds locally with Android Studio / Xcode / the Rust + Tauri toolchain.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { PNG } from "pngjs";
import { loadProjectFiles, repoRoot, selectBuildTarget } from "./project-loader.mjs";
import {
  generatedDesktopReleaseWorkflow,
  generatedReleaseAssemblerScript,
  generatedSigningStatusScript,
  generatedUpdaterEntryScript
} from "./generated-desktop-release.mjs";
import { assertConfinedProjectOutput } from "./path-confinement.mjs";
import { writeDirectoryZip } from "./zip-store.mjs";

const CAPACITOR_VERSION = "^6.0.0";
const TAURI_CLI_VERSION = "2.11.4";
const DESKTOP_ICON_MAX_BYTES = 16 * 1024 * 1024;
const DESKTOP_ICON_FILES = Object.freeze([
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
]);
const DESKTOP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ipc:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

/**
 * @param {string} projectDir
 * @param {{ kind?: "mobile"|"desktop"|"web", targetId?: string|null, outDir?: string|null }} [opts]
 */
export async function packageProject(projectDir, opts = {}) {
  const kind = ["desktop", "web"].includes(opts.kind) ? opts.kind : "mobile";
  const files = loadProjectFiles(projectDir);

  const [selectedId, selected] = selectPackagingTarget(files.buildTargets, kind, opts.targetId ?? null);
  const selectedPlatform = selected.platform ?? selected.type ?? "web";
  if ((kind === "web" || kind === "mobile") && selectedPlatform !== "web") {
    return { ok: false, projectDir, error: `Build target "${selectedId}" uses platform "${selectedPlatform}". ${kind} packaging requires an explicit web target.` };
  }
  if (kind === "desktop" && selectedPlatform !== "web" && selectedPlatform !== "desktop") {
    return { ok: false, projectDir, error: `Build target "${selectedId}" uses platform "${selectedPlatform}". Desktop packaging accepts only an explicit desktop target or legacy web target.` };
  }
  const nativeDesktopTarget = kind === "desktop" && selected.platform === "desktop";

  // Mobile, portable web, and legacy desktop packaging continue to wrap a web target. A
  // first-class desktop target is compiled directly below and must never fall back to another
  // target's renderer, form factor, or player settings.
  const webTarget = selectedPlatform === "web" ? [selectedId, selected] : null;
  if (!nativeDesktopTarget && !webTarget) {
    return { ok: false, projectDir, error: "No web build target found. Packaging wraps a web bundle — add a platform \"web\" target first." };
  }
  const webTargetId = webTarget?.[0];
  const buildTargetId = nativeDesktopTarget ? selectedId : webTargetId;

  const app = appMeta(files.manifest, selected);
  const defaultOutputDir = nativeDesktopTarget
    ? (selected.outputDir ?? `desktop-${selectedId}`)
    : kind;
  const outDir = path.resolve(projectDir, opts.outDir ?? defaultOutputDir);
  assertUnderProject(projectDir, outDir);
  // Do NOT wipe the whole outDir: on a re-package it would destroy the user's native projects
  // (android/, ios/ from `npx cap add`, src-tauri/target/), their signing config, and node_modules.
  // The child build cleans only the web subdir (www/dist) below, and the scaffold files are
  // idempotent overwrites — so a re-package refreshes the bundle while preserving native work.
  fs.mkdirSync(outDir, { recursive: true });

  // Build the web bundle into the folder the native project serves from. The child build empties
  // just this web subdir, so a failed build leaves the native project intact (only the bundle is
  // cleared) rather than deleting everything under outDir.
  const webSub = kind === "desktop" ? "dist" : (kind === "web" ? "game" : "www");
  const webRel = path.join(path.relative(projectDir, outDir), webSub);
  const build = await runBuild(projectDir, buildTargetId, webRel, {
    singleFile: kind === "web",
    nativeDesktopBundle: nativeDesktopTarget
  });
  if (!build.ok) {
    return { ok: false, projectDir, error: build.error ?? "Web build failed.", output: build.output };
  }

  if (kind === "web") {
    const nextSteps = writeWebPackage(outDir, app);
    const archiveName = `${app.slug}-${app.version}-web.zip`;
    const archivePath = path.join(outDir, archiveName);
    const archive = writeDirectoryZip(outDir, archivePath, { exclude: [archiveName] });
    return { ok: true, projectDir, outDir, kind, webTargetId, app, copiedAssets: build.copiedAssets, archive, nextSteps };
  }

  const nextSteps = kind === "desktop"
    ? nativeDesktopTarget
      ? writeNativeTauri(projectDir, outDir, app, selected)
      : writeLegacyTauri(outDir, app)
    : writeCapacitor(outDir, app);

  return nativeDesktopTarget
    ? { ok: true, projectDir, outDir, kind, targetId: selectedId, app, copiedAssets: build.copiedAssets, nextSteps }
    : { ok: true, projectDir, outDir, kind, webTargetId, app, copiedAssets: build.copiedAssets, nextSteps };
}

/** @deprecated kept for the mobile call sites; prefer packageProject. */
export function packageMobile(projectDir, opts = {}) {
  return packageProject(projectDir, { ...opts, kind: "mobile" });
}
export function packageDesktop(projectDir, opts = {}) {
  return packageProject(projectDir, { ...opts, kind: "desktop" });
}
export function packageWeb(projectDir, opts = {}) {
  return packageProject(projectDir, { ...opts, kind: "web" });
}

// ── Portable web archive ──────────────────────────────────────────────────────

function writeWebPackage(outDir, app) {
  writeText(path.join(outDir, "serve.mjs"), webServerTemplate());
  writeText(path.join(outDir, "README.md"), `# ${app.appName} — Portable web build

This archive contains a complete offline game under \`game/\`.

- Double-click \`game/index.single.html\` to play without installing anything.
- Or run \`node serve.mjs\` and open the printed loopback URL for the installable PWA build.
- The local server binds only to \`127.0.0.1\` and serves only files inside this archive.

No package installation or network connection is required.\n`);
  return ["extract the zip", "double-click game/index.single.html", "or run: node serve.mjs"];
}

function webServerTemplate() {
  return `import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "game"));
const portIndex = process.argv.indexOf("--port");
const requestedPort = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 4173;
const port = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 4173;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg" };

function confinedFile(rawUrl) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(rawUrl || "/", "http://127.0.0.1").pathname); }
  catch { return null; }
  const requested = path.resolve(ROOT, "." + (pathname === "/" ? "/index.html" : pathname));
  const lexical = path.relative(ROOT, requested);
  if (lexical.startsWith("..") || path.isAbsolute(lexical)) return null;
  try {
    const candidate = fs.statSync(requested).isDirectory() ? path.join(requested, "index.html") : requested;
    const real = fs.realpathSync(candidate);
    const relative = path.relative(ROOT, real);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}

const checkPathIndex = process.argv.indexOf("--check-path");
if (checkPathIndex >= 0) {
  process.stdout.write(confinedFile(process.argv[checkPathIndex + 1]) ? "allowed\\n" : "blocked\\n");
  process.exit(0);
}

const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; }
  const file = confinedFile(req.url);
  if (!file) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Not found"); return; }
  const headers = {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).pipe(res);
});
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  console.log("TowerForge game: http://127.0.0.1:" + address.port);
});
`;
}

// ── Capacitor (mobile) ──────────────────────────────────────────────────────────

function writeCapacitor(outDir, app) {
  writeJson(path.join(outDir, "capacitor.config.json"), {
    appId: app.appId,
    appName: app.appName,
    webDir: "www",
    backgroundColor: app.backgroundColor,
    // Hardening ported from a shipped Capacitor game: a game WebView should not pinch-zoom or
    // auto-focus inputs, should log quietly in production, and should keep the status bar out of
    // the playfield. These remove whole classes of "my APK feels broken" reports.
    zoomEnabled: false,
    initialFocus: false,
    loggingBehavior: "production",
    server: { androidScheme: "https" },
    android: {
      backgroundColor: app.backgroundColor,
      zoomEnabled: false,
      // Cheap devices can otherwise silently fall back to a slower WebView path; requiring it makes
      // behavior consistent, and captureInput keeps key events inside the game.
      captureInput: true,
      webContentsDebuggingEnabled: false
    },
    plugins: {
      StatusBar: {
        overlaysWebView: false,
        style: "DARK",
        backgroundColor: app.backgroundColor
      }
    }
  });
  writeJson(path.join(outDir, "package.json"), {
    name: app.slug,
    version: app.version,
    private: true,
    description: `${app.appName} — mobile wrapper (Capacitor).`,
    scripts: {
      "add:android": "cap add android",
      "add:ios": "cap add ios",
      sync: "cap sync",
      "open:android": "cap open android",
      "open:ios": "cap open ios"
    },
    devDependencies: { "@capacitor/cli": CAPACITOR_VERSION },
    dependencies: {
      "@capacitor/core": CAPACITOR_VERSION,
      "@capacitor/android": CAPACITOR_VERSION,
      "@capacitor/ios": CAPACITOR_VERSION
    }
  });
  fs.writeFileSync(path.join(outDir, ".gitignore"), "node_modules/\nandroid/\nios/\n", "utf8");
  fs.writeFileSync(path.join(outDir, "README.md"), capacitorReadme(app), "utf8");
  return [
    "cd mobile",
    "npm install",
    "npx cap add android   # and/or: npx cap add ios",
    "npx cap open android   # opens Android Studio to build/sign the store bundle"
  ];
}

// ── Tauri (desktop) ─────────────────────────────────────────────────────────────

function writeLegacyTauri(outDir, app) {
  const crate = app.crate;
  writeJson(path.join(outDir, "package.json"), {
    name: app.slug,
    version: app.version,
    private: true,
    description: `${app.appName} — desktop wrapper (Tauri).`,
    scripts: { tauri: "tauri", dev: "tauri dev", build: "tauri build" },
    devDependencies: { "@tauri-apps/cli": TAURI_CLI_VERSION }
  });
  writeJson(path.join(outDir, "src-tauri", "tauri.conf.json"), {
    $schema: "https://schema.tauri.app/config/2",
    productName: app.appName,
    version: app.version,
    identifier: app.appId,
    build: { frontendDist: "../dist" },
    app: {
      windows: [{ title: app.appName, width: 1024, height: 720, resizable: true }],
      security: { csp: null }
    },
    bundle: {
      active: true,
      targets: "all",
      icon: ["icons/32x32.png", "icons/128x128.png", "icons/icon.icns", "icons/icon.ico"]
    }
  });
  writeText(path.join(outDir, "src-tauri", "Cargo.toml"),
    `[package]
name = "${crate}"
version = "${app.version}"
edition = "2021"

[lib]
name = "${crate}_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
`);
  writeText(path.join(outDir, "src-tauri", "build.rs"), `fn main() {\n  tauri_build::build()\n}\n`);
  writeText(path.join(outDir, "src-tauri", "src", "main.rs"),
    `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  ${crate}_lib::run()
}
`);
  writeText(path.join(outDir, "src-tauri", "src", "lib.rs"),
    `#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
`);
  fs.writeFileSync(path.join(outDir, ".gitignore"), "node_modules/\nsrc-tauri/target/\n", "utf8");
  fs.writeFileSync(path.join(outDir, "README.md"), tauriReadme(app), "utf8");
  return [
    "cd desktop",
    "npm install",
    "npm run tauri icon ../assets/icon.png   # generate app icons (once, from a 1024×1024 png)",
    "npm run build                           # produces installers under src-tauri/target/release/bundle"
  ];
}

function writeNativeTauri(projectDir, outDir, app, target) {
  const crate = app.crate;
  const window = target.window;
  const updaterActive = target.updater?.enabled === true;
  const updaterEntryPath = path.join(outDir, "scripts", "collect-updater-entry.mjs");
  const existingCargoPath = path.join(outDir, "src-tauri", "Cargo.toml");
  const hadUpdaterSources = fs.existsSync(updaterEntryPath)
    || (fs.existsSync(existingCargoPath) && fs.readFileSync(existingCargoPath, "utf8").includes("tauri-plugin-updater"));
  if (!updaterActive && hadUpdaterSources) {
    // A generated target and lock can retain updater code/payloads after an enabled native build.
    // They are disposable build state, while all other carrier files and author notes are preserved.
    fs.rmSync(path.join(outDir, "src-tauri", "target"), { recursive: true, force: true });
    const cargoLockPath = path.join(outDir, "src-tauri", "Cargo.lock");
    if (fs.existsSync(cargoLockPath)) fs.unlinkSync(cargoLockPath);
  }
  generateDesktopIcons(projectDir, target.bundle.iconSource, path.join(outDir, "src-tauri", "icons"));
  writeJson(path.join(outDir, "package.json"), {
    name: app.slug,
    version: app.version,
    private: true,
    description: `${app.appName} — native desktop game (Tauri).`,
    scripts: {
      tauri: "tauri",
      dev: "tauri dev",
      build: "node scripts/build-current-platform.mjs",
      "tauri:build": "tauri build"
    },
    devDependencies: { "@tauri-apps/cli": TAURI_CLI_VERSION }
  });
  writeJson(path.join(outDir, "src-tauri", "tauri.conf.json"), {
    $schema: "https://schema.tauri.app/config/2",
    productName: app.appName,
    version: app.version,
    identifier: app.appId,
    build: { frontendDist: "../dist" },
    app: {
      withGlobalTauri: false,
      windows: [{
        label: "main",
        title: target.appTitle ?? app.appName,
        width: window.width,
        height: window.height,
        minWidth: window.minWidth,
        minHeight: window.minHeight,
        fullscreen: window.fullscreen,
        resizable: window.resizable,
        backgroundColor: app.backgroundColor
      }],
      security: { csp: DESKTOP_CSP }
    },
    bundle: {
      active: true,
      targets: [...target.bundle.targets],
      icon: [...DESKTOP_ICON_FILES],
      ...(updaterActive ? { createUpdaterArtifacts: true } : {})
    },
    ...(updaterActive ? { plugins: { updater: { endpoints: [...target.updater.endpoints], pubkey: target.updater.publicKey } } } : {})
  });
  writeJson(path.join(outDir, "src-tauri", "capabilities", "main.json"), {
    $schema: "../gen/schemas/desktop-schema.json",
    identifier: "player-main",
    description: "Allowlisted local capabilities for the generated TowerForge player window.",
    windows: ["main"],
    local: true,
    permissions: [
      "core:event:allow-listen",
      "core:event:allow-emit"
    ]
  });
  writeText(path.join(outDir, "src-tauri", "Cargo.toml"),
    `[package]
name = "${crate}"
version = "${app.version}"
edition = "2021"

[lib]
name = "${crate}_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "=2.6.3", features = [] }

[dependencies]
tauri = { version = "=2.11.5", features = [] }
tauri-plugin-single-instance = "=2.4.3"
tempfile = "=3.27.0"${updaterActive ? '\ntauri-plugin-updater = "=2.10.1"\nserde_json = "=1.0.151"' : ""}
`);
  writeText(path.join(outDir, "src-tauri", "build.rs"), `fn main() {\n  tauri_build::build()\n}\n`);
  writeText(path.join(outDir, "src-tauri", "src", "main.rs"),
    `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  ${crate}_lib::run()
}
`);
  writeText(path.join(outDir, "src-tauri", "src", "lib.rs"),
    nativePlayerRustTemplate(updaterActive));
  writeText(path.join(outDir, "scripts", "build-current-platform.mjs"), currentPlatformBuildTemplate(target.bundle.targets));
  writeText(path.join(outDir, "scripts", "assemble-release.mjs"), generatedReleaseAssemblerScript(updaterActive));
  writeText(path.join(outDir, "scripts", "write-signing-status.mjs"), generatedSigningStatusScript());
  if (updaterActive) writeText(updaterEntryPath, generatedUpdaterEntryScript());
  else if (fs.existsSync(updaterEntryPath)) fs.unlinkSync(updaterEntryPath);
  writeText(path.join(outDir, ".github", "workflows", "towerforge-desktop-release.yml"), generatedDesktopReleaseWorkflow(updaterActive));
  writeText(path.join(outDir, "SIGNING.md"), desktopSigningGuide(updaterActive));
  fs.writeFileSync(path.join(outDir, ".gitignore"), "node_modules/\nsrc-tauri/target/\n", "utf8");
  fs.writeFileSync(path.join(outDir, "README.md"), nativeTauriReadme(app), "utf8");
  return [
    `cd ${path.basename(outDir)}`,
    "npm install",
    "npm run build   # produces current-platform installers under src-tauri/target/release/bundle"
  ];
}

function currentPlatformBuildTemplate(authoredTargets) {
  return `import { spawnSync } from "node:child_process";
import process from "node:process";

const authoredTargets = Object.freeze(${JSON.stringify(authoredTargets)});
const supportedTargets = process.platform === "darwin"
  ? new Set(["dmg"])
  : process.platform === "win32"
    ? new Set(["nsis", "msi"])
    : process.platform === "linux"
      ? new Set(["appimage", "deb", "rpm"])
      : null;

if (!supportedTargets) throw new Error("Desktop installers are not supported on this operating system.");
const targets = authoredTargets.filter((target) => supportedTargets.has(target)).join(",");
if (!targets) throw new Error("The desktop target does not author an installer for this operating system.");

if (process.argv.includes("--print-targets")) {
  process.stdout.write(targets + "\\n");
  process.exit(0);
}

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(executable, ["tauri", "build", "--bundles", targets], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`;
}

function desktopSigningGuide(updaterActive = false) {
  return `# Signing and notarization

Generated games are unsigned unless the author explicitly configures signing in CI. Credentials
belong to the operating system or GitHub Actions secrets and must never be written into this
project. The reference unsigned workflow always publishes a pre-release labelled **Unsigned
build**. When every required platform secret is configured, the workflow imports the native
certificate, verifies the produced macOS signature/notarization ticket or Windows Authenticode
signer, and only then can publish the verified signed candidate as a normal release.

Documented macOS secret names:

- APPLE_CERTIFICATE
- APPLE_CERTIFICATE_PASSWORD
- APPLE_SIGNING_IDENTITY
- APPLE_ID
- APPLE_PASSWORD
- APPLE_TEAM_ID

Documented Windows secret names:

- WINDOWS_CERTIFICATE
- WINDOWS_CERTIFICATE_PASSWORD
${updaterActive ? `
Documented updater signing secret names (required only when updater is enabled):

- TAURI_SIGNING_PRIVATE_KEY
- TAURI_SIGNING_PRIVATE_KEY_PASSWORD
` : ""}

Use environment variables or GitHub Actions secrets for values. Do not commit certificates,
passwords, private keys, provisioning profiles, or a local .env file.${updaterActive ? ` With updater support enabled,
the workflow also publishes the Tauri update payloads, their adjacent detached .sig files, and the
static latest.json platform manifest.` : ""}
`;
}

function nativePlayerRustTemplate(updaterActive = false) {
  return `use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State, WebviewWindow};
use tempfile::NamedTempFile;

const MAX_SESSION_BYTES: usize = 32 * 1024 * 1024;

struct PlayerState {
  root: PathBuf,
  pending_write: AtomicBool,
  close_authorized: AtomicBool,
}

fn checked_slot(slot: u8) -> Result<u8, String> {
  if slot <= 1 { Ok(slot) } else { Err("unsupported session slot".into()) }
}

fn session_file(root: &Path, slot: u8) -> PathBuf {
  root.join(format!("slot-{slot}.json"))
}

fn atomic_write(destination: &Path, value: &[u8]) -> Result<(), String> {
  if value.len() > MAX_SESSION_BYTES { return Err("session value exceeds native limit".into()); }
  let parent = destination.parent().ok_or_else(|| "session destination has no parent".to_string())?;
  let mut temporary = NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
  let file = temporary.as_file_mut();
  file.write_all(value).map_err(|error| error.to_string())?;
  file.sync_all().map_err(|error| error.to_string())?;
  temporary.persist(destination).map_err(|error| error.error.to_string())?;
  #[cfg(unix)]
  File::open(parent).and_then(|directory| directory.sync_all()).map_err(|error| error.to_string())?;
  Ok(())
}

fn read_optional(file: &Path) -> Result<Option<String>, String> {
  match fs::read(file) {
    Ok(bytes) if bytes.len() <= MAX_SESSION_BYTES => String::from_utf8(bytes).map(Some).map_err(|_| "session value is not UTF-8".into()),
    Ok(_) => Err("session value exceeds native limit".into()),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(error) => Err(error.to_string()),
  }
}

#[tauri::command]
fn player_session_read_head(state: State<PlayerState>) -> Result<Option<String>, String> {
  read_optional(&state.root.join("head"))
}

#[tauri::command]
fn player_session_read_slot(slot: u8, state: State<PlayerState>) -> Result<Option<String>, String> {
  read_optional(&session_file(&state.root, checked_slot(slot)?))
}

#[tauri::command]
fn player_session_write_slot(slot: u8, value: String, state: State<PlayerState>) -> Result<(), String> {
  atomic_write(&session_file(&state.root, checked_slot(slot)?), value.as_bytes())
}

#[tauri::command]
fn player_session_write_head(slot: u8, state: State<PlayerState>) -> Result<(), String> {
  let slot = checked_slot(slot)?;
  atomic_write(&state.root.join("head"), slot.to_string().as_bytes())
}

#[tauri::command]
fn player_session_remove_slot(slot: u8, state: State<PlayerState>) -> Result<(), String> {
  let file = session_file(&state.root, checked_slot(slot)?);
  match fs::remove_file(file) { Ok(()) => Ok(()), Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(error) => Err(error.to_string()) }
}

#[tauri::command]
fn player_session_remove_head(state: State<PlayerState>) -> Result<(), String> {
  match fs::remove_file(state.root.join("head")) { Ok(()) => Ok(()), Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(error) => Err(error.to_string()) }
}

#[tauri::command]
fn player_set_pending_write(pending: bool, window: WebviewWindow, state: State<PlayerState>) -> Result<(), String> {
  state.pending_write.store(pending, Ordering::SeqCst);
  let _ = window;
  Ok(())
}

#[tauri::command]
fn player_get_fullscreen(window: WebviewWindow) -> Result<bool, String> {
  window.is_fullscreen().map_err(|error| error.to_string())
}

#[tauri::command]
fn player_set_fullscreen(fullscreen: bool, window: WebviewWindow) -> Result<(), String> {
  window.set_fullscreen(fullscreen).map_err(|error| error.to_string())
}

#[tauri::command]
fn player_finish_close(window: WebviewWindow, state: State<PlayerState>) -> Result<(), String> {
  if state.pending_write.load(Ordering::SeqCst) { return Err("session write still pending".into()); }
  state.close_authorized.store(true, Ordering::SeqCst);
  window.close().map_err(|error| error.to_string())
}

${updaterActive ? `#[tauri::command]
async fn player_check_and_install_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
  use tauri_plugin_updater::UpdaterExt;
  let updater = app.updater().map_err(|error| error.to_string())?;
  let Some(update) = updater.check().await.map_err(|error| error.to_string())? else { return Ok(None); };
  let version = update.version.to_string();
  update.download_and_install(|_, _| {}, || {}).await.map_err(|error| error.to_string())?;
  Ok(Some(version))
}
` : ""}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    ${updaterActive ? ".plugin(tauri_plugin_updater::Builder::new().build())\n    " : ""}.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
    }))
    .setup(|app| {
      let root = app.path().app_data_dir()?.join("player-session-v1");
      fs::create_dir_all(&root)?;
      app.manage(PlayerState { root, pending_write: AtomicBool::new(false), close_authorized: AtomicBool::new(false) });
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      player_session_read_head, player_session_read_slot, player_session_write_slot,
      player_session_write_head, player_session_remove_slot, player_session_remove_head,
      player_set_pending_write, player_get_fullscreen, player_set_fullscreen, player_finish_close${updaterActive ? ",\n      player_check_and_install_update" : ""}
    ])
    .on_window_event(|window, event| {
      match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
          let state = window.state::<PlayerState>();
          if !state.close_authorized.swap(false, Ordering::SeqCst) {
            api.prevent_close();
            let _ = window.emit("towerforge-native-close-requested", ());
          }
        }
        tauri::WindowEvent::Focused(false) => { let _ = window.emit("towerforge-native-suspend", ()); }
        tauri::WindowEvent::Focused(true) => { let _ = window.emit("towerforge-native-resume", ()); }
        _ => {}
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");
  app.run(|app, event| {
    match event {
      tauri::RunEvent::Resumed => { let _ = app.emit("towerforge-native-resume", ()); }
      _ => {}
    }
  });
}
`;
}

// ── helpers ────────────────────────────────────────────────────────────────────

function selectPackagingTarget(buildTargets, kind, explicitTargetId) {
  if (explicitTargetId) return selectBuildTarget(buildTargets, explicitTargetId);
  if (kind === "desktop") {
    const desktopId = buildTargets.defaults?.desktop;
    if (desktopId && buildTargets.targets?.[desktopId]?.platform === "desktop") {
      return [desktopId, buildTargets.targets[desktopId]];
    }
    if (buildTargets.schemaVersion === 2) {
      throw new Error("Desktop packaging requires defaults.desktop or an explicit targetId; the legacy web wrapper is explicit-only for BuildTargets v2.");
    }
  }
  return selectBuildTarget(buildTargets, null);
}

function generateDesktopIcons(projectDir, sourceRelativePath, iconsDir) {
  const sourcePath = resolveProjectFile(projectDir, sourceRelativePath, "Desktop icon source");
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile() || stat.size < 24 || stat.size > DESKTOP_ICON_MAX_BYTES) {
    throw new Error(`Desktop icon source must be a PNG between 24 bytes and ${DESKTOP_ICON_MAX_BYTES} bytes.`);
  }
  const bytes = fs.readFileSync(sourcePath);
  assertPngHeader(bytes);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== 1024 || height !== 1024) {
    throw new Error(`Desktop icon source must be exactly 1024x1024 pixels; got ${width}x${height}.`);
  }
  let source;
  try {
    source = PNG.sync.read(bytes, { checkCRC: true });
  } catch (error) {
    throw new Error(`Desktop icon source is not a valid PNG: ${error.message}`);
  }
  if (source.width !== 1024 || source.height !== 1024) throw new Error("Desktop icon PNG dimensions changed while decoding.");

  const sizes = new Map();
  for (const size of [32, 128, 256, 512, 1024]) {
    sizes.set(size, size === 1024 ? bytes : PNG.sync.write(resizePng(source, size)));
  }
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.writeFileSync(path.join(iconsDir, "32x32.png"), sizes.get(32));
  fs.writeFileSync(path.join(iconsDir, "128x128.png"), sizes.get(128));
  fs.writeFileSync(path.join(iconsDir, "128x128@2x.png"), sizes.get(256));
  fs.writeFileSync(path.join(iconsDir, "icon.icns"), createIcns(sizes));
  fs.writeFileSync(path.join(iconsDir, "icon.ico"), createIco(sizes));
}

function resolveProjectFile(projectDir, relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error(`${label} must be a project-relative path.`);
  }
  const projectReal = fs.realpathSync(projectDir);
  const lexical = path.resolve(projectReal, relativePath);
  const lexicalRelative = path.relative(projectReal, lexical);
  if (!lexicalRelative || lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) {
    throw new Error(`${label} must stay inside the project.`);
  }
  let sourceReal;
  try {
    sourceReal = fs.realpathSync(lexical);
  } catch {
    throw new Error(`${label} does not exist: ${relativePath}`);
  }
  const realRelative = path.relative(projectReal, sourceReal);
  if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error(`${label} resolves outside the project.`);
  }
  return sourceReal;
}

function assertPngHeader(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((value, index) => bytes[index] !== value)
    || bytes.toString("ascii", 12, 16) !== "IHDR"
    || bytes.readUInt32BE(8) !== 13) {
    throw new Error("Desktop icon source must have a valid PNG signature and IHDR header.");
  }
}

function resizePng(source, size) {
  const output = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor(y * source.height / size));
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor(x * source.width / size));
      const from = (sourceY * source.width + sourceX) * 4;
      const to = (y * size + x) * 4;
      output.data[to] = source.data[from];
      output.data[to + 1] = source.data[from + 1];
      output.data[to + 2] = source.data[from + 2];
      output.data[to + 3] = source.data[from + 3];
    }
  }
  return output;
}

function createIcns(sizes) {
  const records = [["icp5", 32], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024]].map(([type, size]) => {
    const data = sizes.get(size);
    const record = Buffer.allocUnsafe(8 + data.length);
    record.write(type, 0, 4, "ascii");
    record.writeUInt32BE(record.length, 4);
    data.copy(record, 8);
    return record;
  });
  const total = 8 + records.reduce((sum, record) => sum + record.length, 0);
  const header = Buffer.allocUnsafe(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...records], total);
}

function createIco(sizes) {
  const entries = [32, 128, 256].map((size) => ({ size, data: sizes.get(size) }));
  const headerSize = 6 + entries.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = headerSize;
  for (let index = 0; index < entries.length; index += 1) {
    const { size, data } = entries[index];
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header[entry + 2] = 0;
    header[entry + 3] = 0;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries.map((entry) => entry.data)], offset);
}

/** Derive native app metadata from the target + manifest, with a valid reverse-DNS appId + Rust crate. */
function appMeta(manifest, target) {
  const rawName = target.appName ?? target.appTitle ?? manifest?.name ?? "TowerForge Game";
  const slug = slugify(rawName) || "towerforge-game";
  // Identifier segments and Rust crate names must start with a letter (Android/Tauri/Cargo reject a
  // leading digit), so guard the derived-from-name cases against numeric project names like "2048".
  const idSegment = letterLed(slug.replace(/-/g, ""));
  const appId = isReverseDns(target.appId) ? target.appId : `com.towerforge.${idSegment}`;
  const crate = letterLed(slug.replace(/-/g, "_"));
  const version = typeof target.appVersion === "string" && target.appVersion ? target.appVersion : "0.1.0";
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
    throw new Error("Desktop appVersion must be a bounded semantic version.");
  }
  return {
    appId,
    appName: rawName,
    slug,
    crate,
    version,
    backgroundColor: target.backgroundColor ?? "#111111"
  };
}

/** Prefix an identifier so it starts with a letter (a leading digit is invalid for crates/app-ids). */
function letterLed(value) {
  return /^[a-zA-Z]/.test(value) ? value : `app${value}`;
}

/** Every dot-separated segment must start with a letter (Android package / Tauri identifier rule). */
function isReverseDns(value) {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value);
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const BUILD_TIMEOUT_MS = 180_000;

function runBuild(projectDir, targetId, outRel, options = {}) {
  return new Promise((resolve) => {
    const args = [path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", projectDir, "--target", targetId, "--out", outRel, "--json"];
    if (options.singleFile) args.push("--single-file");
    if (options.nativeDesktopBundle) args.push("--native-desktop-bundle");
    const child = spawn(process.execPath, args, { cwd: repoRoot, timeout: BUILD_TIMEOUT_MS, killSignal: "SIGKILL" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.on("close", (code, signal) => {
      if (signal) return resolve({ ok: false, error: `Build timed out after ${BUILD_TIMEOUT_MS}ms.` });
      try {
        const parsed = JSON.parse(stdout);
        resolve({ ok: parsed.ok !== false, error: parsed.error, copiedAssets: parsed.copiedAssets, output: stdout.trim() });
      } catch {
        resolve({ ok: code === 0, error: stderr.trim() || `Build exited with code ${code}.`, output: stdout.trim() });
      }
    });
  });
}

function assertUnderProject(projectDir, outDir) {
  assertConfinedProjectOutput(projectDir, outDir, "package");
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function capacitorReadme(app) {
  return `# ${app.appName} — Mobile packaging (Capacitor)

This folder is a self-contained [Capacitor](https://capacitorjs.com) project that wraps the built
web game (in \`www/\`) into a native **Android** and **iOS** app you can build, sign, and submit to
the stores. Nothing here is published automatically — you run the native builds locally.

- **App id:** \`${app.appId}\`
- **App name:** ${app.appName}
- **Version:** ${app.version}

## Prerequisites
- Node.js 18+
- **Android:** [Android Studio](https://developer.android.com/studio) (JDK + Android SDK)
- **iOS:** macOS with [Xcode](https://developer.apple.com/xcode/) and CocoaPods

## Build the native app
\`\`\`bash
cd mobile
npm install

# Android
npx cap add android
npx cap sync android
npx cap open android      # → Build > Generate Signed Bundle/APK in Android Studio

# iOS (macOS only)
npx cap add ios
npx cap sync ios
npx cap open ios          # → Product > Archive in Xcode, then distribute
\`\`\`

When the game changes, re-run \`towerforge package\` (rebuilds \`www/\`) then \`npx cap sync\`.

## Store packaging checklist
- **Icons & splash:** \`npm i -D @capacitor/assets\` then \`npx capacitor-assets generate\`
  (drop a 1024×1024 \`icon.png\`/\`splash.png\` in an \`assets/\` folder first).
- **Version:** bump \`version\` here and in the native project (Android \`versionCode\`/\`versionName\`,
  iOS build/marketing version) for each store submission.
- **Android signing:** create a keystore, configure signing to produce a signed \`.aab\` for Google Play.
- **iOS signing:** set Team + Bundle Identifier (\`${app.appId}\`) in Xcode > Signing & Capabilities,
  then Archive and upload via the Organizer / Transporter.
- **Offline:** the bundle ships an offline service worker, so the app works without a network.

## Low-end device / stability checklist
The generated \`capacitor.config.json\` already hardens the web layer (no pinch-zoom, no input
auto-focus, quiet production logging, status bar out of the playfield). A few wins live in the
**native Android project** that \`npx cap add android\` generates — verify them in
\`android/app/src/main/AndroidManifest.xml\` before shipping:
- **\`android:hardwareAccelerated="true"\`** on \`<application>\` (Capacitor default) — required for smooth WebGL.
- **\`android:configChanges="orientation|screenSize|screenLayout|keyboardHidden|density|uiMode"\`** on the main activity so a rotation/resize does NOT recreate the Activity — recreation destroys the WebView's GL context and is a classic crash. Keep Capacitor's defaults.
- **Portrait lock** (if your game is portrait): add \`android:screenOrientation="portrait"\` to the activity.
- **Android 12+ Game Mode:** a \`res/xml/game_mode_config.xml\` with \`supportsBatteryGameMode\`/\`supportsPerformanceGameMode\` referenced via an application \`<meta-data android:name="android.game_mode_config">\` lets the OS grant better clocks.
- **Test in airplane mode** once: the offline service worker should let the game open with no network.
`;
}

function tauriReadme(app) {
  return `# ${app.appName} — Desktop packaging (Tauri v2)

This folder is a self-contained [Tauri v2](https://tauri.app) project that wraps the built web game
(in \`dist/\`) into a native **Windows / macOS / Linux** desktop app and installers. Nothing here is
published automatically — you run the build locally.

- **Identifier:** \`${app.appId}\`
- **Product name:** ${app.appName}
- **Version:** ${app.version}

## Prerequisites
- Node.js 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- Platform build deps (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)):
  macOS → Xcode Command Line Tools; Windows → MSVC + WebView2; Linux → webkit2gtk + build-essential.

## Build the desktop app
\`\`\`bash
cd desktop
npm install
npm run tauri icon ../assets/icon.png   # once: generate icons/ from a 1024×1024 png
npm run build                           # → installers in src-tauri/target/release/bundle/
\`\`\`
\`npm run dev\` runs the app in a dev window. When the game changes, re-run \`towerforge package
--kind desktop\` to refresh \`dist/\`.

## Store / distribution notes
- **Icons are required** for a release build — run \`npm run tauri icon\` first (creates
  \`src-tauri/icons/\`). The game changes rarely, so do this once.
- **Version:** bump \`version\` in this \`package.json\` and \`src-tauri/tauri.conf.json\` per release.
- **Signing:** macOS notarization and Windows code-signing are configured in \`tauri.conf.json\`
  (\`bundle.macOS\` / \`bundle.windows\`) — see the Tauri distribution guide.
- **Stores:** the produced \`.dmg\`/\`.msi\`/\`.AppImage\`/\`.deb\` can be submitted to the Mac App Store,
  Microsoft Store, or distributed directly. The game runs fully offline.
`;
}

function nativeTauriReadme(app) {
  return `# ${app.appName} — Native desktop game (Tauri v2)

This project was generated from a first-class TowerForge desktop target. The exact target's player
bundle is in \`dist/\`; it is not a wrapper around another web target.

- **Identifier:** \`${app.appId}\`
- **Product name:** ${app.appName}
- **Version:** ${app.version}
- **Icons:** generated from the validated project-bound 1024×1024 PNG
- **WebView:** restrictive CSP, no global Tauri object, and an explicit local capability allowlist

## Build the current-platform installers

\`\`\`bash
npm install
npm run build
\`\`\`

Tauri writes installers under \`src-tauri/target/release/bundle/\`. Re-run the TowerForge desktop
package action to refresh the deterministic player bundle and generated native contract.
`;
}
