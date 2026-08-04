import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test.use({ trace: "off", serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
let tempRoot;
let server;
let origin;

test.beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r22-splash-e2e-"));
  const projectDir = path.join(tempRoot, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  configureActiveSplashProject(projectDir);
  for (const renderer of ["canvas", "phaser"]) build(projectDir, `intro-${renderer}`);
  server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    const parts = requestUrl.pathname.replace(/^\/+/, "").split("/");
    const outputDir = path.join(projectDir, parts.shift() || "dist-canvas");
    const filePath = path.resolve(outputDir, decodeURIComponent(parts.join("/")) || "index.html");
    const relative = path.relative(outputDir, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("TowerForge remains first, late skip advances one item, and the finished playlist waits for runtime", async ({ page }) => {
  await installGameplayInputProbe(page);
  let releasePlayer;
  const playerGate = new Promise((resolve) => { releasePlayer = resolve; });
  await page.route("**/player.mjs", async (route) => {
    await playerGate;
    await route.continue();
  });

  const navigation = page.goto(`${origin}/dist-canvas/`, { waitUntil: "load" });
  const engineSplash = page.locator("#towerforge-engine-splash");
  const projectSplash = page.locator("#towerforge-project-splash");
  try {
    await expect(engineSplash).toBeVisible();
    await expect(projectSplash).toBeHidden();
    expect(await page.evaluate(() => globalThis.__towerforgeBootOk === true)).toBe(false);

    await expect(projectSplash).toBeVisible({ timeout: 4_000 });
    await expect(engineSplash).toBeHidden();
    await expect(projectSplash).toHaveAttribute("data-item-id", "studio");
    await expect(page.locator("#towerforge-project-splash-image")).toHaveAttribute("alt", "Example Studio logo");
    await expect(page.locator("#towerforge-project-splash-caption")).toHaveText("Example Studio");

    await page.keyboard.press("KeyD");
    await page.keyboard.press("Digit1");
    expect(await page.evaluate(() => globalThis.__r22GameplayInputs)).toEqual([]);

    await projectSplash.click();
    await page.waitForTimeout(100);
    await expect(projectSplash).toHaveAttribute("data-item-id", "studio");

    await page.waitForTimeout(540);
    await projectSplash.click();
    await expect(projectSplash).toHaveAttribute("data-item-id", "publisher");
    expect(await page.evaluate(() => globalThis.__r22GameplayInputs)).toEqual([]);

    await page.waitForTimeout(320);
    await projectSplash.click();
    await expect(projectSplash).toHaveAttribute("data-state", "waiting-runtime", { timeout: 2_000 });
    await expect(page.locator("#towerforge-project-splash-progress")).toBeVisible();
    expect(await page.evaluate(() => globalThis.__towerforgeBootOk === true)).toBe(false);
    expect(await page.evaluate(() => globalThis.__towerforgeProjectSplashDismissed === true)).toBe(false);
  } finally {
    releasePlayer();
  }

  await navigation;
  await page.waitForFunction(() => globalThis.__towerforgeBootOk === true);
  await expect(projectSplash).toBeHidden();
  expect(await page.evaluate(() => globalThis.__towerforgeProjectSplashDismissed)).toBe(true);
});

test("Escape holds the last valid splash and gameplay input until a delayed runtime is ready", async ({ page }) => {
  await installGameplayInputProbe(page);
  let releasePlayer;
  const playerGate = new Promise((resolve) => { releasePlayer = resolve; });
  await page.route("**/player.mjs", async (route) => {
    await playerGate;
    await route.continue();
  });

  const navigation = page.goto(`${origin}/dist-canvas/`, { waitUntil: "load" });
  const projectSplash = page.locator("#towerforge-project-splash");
  try {
    await expect(projectSplash).toBeVisible({ timeout: 4_000 });
    await expect(projectSplash).toHaveAttribute("data-item-id", "studio");

    await page.keyboard.press("Escape");

    await expect(projectSplash).toBeVisible();
    await expect(projectSplash).toHaveAttribute("data-state", "waiting-runtime");
    await expect(page.locator("#towerforge-project-splash-progress")).toBeVisible();
    expect(await page.evaluate(() => globalThis.__towerforgeProjectSplashDismissed === true)).toBe(false);
    expect(await page.evaluate(() => globalThis.__towerforgeBootOk === true)).toBe(false);

    await page.keyboard.press("KeyD");
    await page.keyboard.press("Digit1");
    expect(await page.evaluate(() => globalThis.__r22GameplayInputs)).toEqual([]);
  } finally {
    releasePlayer();
  }

  await navigation;
  await page.waitForFunction(() => globalThis.__towerforgeBootOk === true);
  await expect(projectSplash).toBeHidden();
});

test("Phaser skips a failed image, honors reduced motion, and Escape dismisses the remaining authored playlist", async ({ page }) => {
  await installGameplayInputProbe(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/assets/splashes/studio.png", (route) => route.abort("failed"));
  await page.goto(`${origin}/dist-phaser/`, { waitUntil: "domcontentloaded" });

  const projectSplash = page.locator("#towerforge-project-splash");
  await expect(projectSplash).toBeVisible({ timeout: 4_000 });
  await expect(projectSplash).toHaveAttribute("data-item-id", "publisher");
  await expect(page.locator("#towerforge-project-splash-image")).toHaveAttribute("alt", "Example Publisher logo");
  expect(await projectSplash.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
  expect(await page.evaluate(() => globalThis.__towerforgeBootOk === true)).toBe(false);

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => globalThis.__towerforgeBootOk === true);
  await expect(projectSplash).toBeHidden();
  expect(await page.evaluate(() => globalThis.__r22GameplayInputs)).toEqual([]);
});

test("a stalled image preload times out and advances to the next valid splash", async ({ page }) => {
  await page.route("**/assets/splashes/studio.png", () => {});
  await page.goto(`${origin}/dist-canvas/`, { waitUntil: "domcontentloaded" });

  const engineSplash = page.locator("#towerforge-engine-splash");
  const projectSplash = page.locator("#towerforge-project-splash");
  await expect(engineSplash).toBeVisible();
  await expect(projectSplash).toBeVisible({ timeout: 5_000 });
  await expect(projectSplash).toHaveAttribute("data-item-id", "publisher");
  await expect(engineSplash).toBeHidden();
});

test("a boot rejection after runtime readiness closes both splashes and opens recovery", async ({ page }) => {
  await page.goto(`${origin}/dist-canvas/`, { waitUntil: "domcontentloaded" });
  const engineSplash = page.locator("#towerforge-engine-splash");
  const projectSplash = page.locator("#towerforge-project-splash");
  const recovery = page.locator("#boot-error");
  await expect(projectSplash).toBeVisible({ timeout: 4_000 });
  await page.evaluate(() => {
    globalThis.__towerforgeCompleteBoot();
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { value: new Error("R22 boot regression") });
    window.dispatchEvent(event);
  });

  await expect(recovery).toBeVisible();
  await expect(page.locator("#boot-error-message")).toHaveText("R22 boot regression");
  await expect(engineSplash).toBeHidden();
  await expect(projectSplash).toBeHidden();
  expect(await page.evaluate(() => globalThis.__towerforgeBootOk === true)).toBe(false);
});

function configureActiveSplashProject(projectDir) {
  const projectPath = path.join(projectDir, "project.json");
  writeJson(projectPath, { ...readJson(projectPath), schemaVersion: 5 });
  const visualsPath = path.join(projectDir, "content", "visuals.json");
  const visuals = readJson(visualsPath);
  writeJson(visualsPath, {
    ...visuals,
    sprites: {
      ...visuals.sprites,
      studio_logo: { src: "assets/splashes/studio.png" },
      publisher_logo: { src: "assets/splashes/publisher.png" }
    }
  });
  fs.mkdirSync(path.join(projectDir, "assets", "splashes"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "assets", "splashes", "studio.png"), PNG);
  fs.writeFileSync(path.join(projectDir, "assets", "splashes", "publisher.png"), PNG);
  writeJson(path.join(projectDir, "content", "splashes.json"), {
    schemaVersion: 1,
    playlists: {
      intro: {
        schemaVersion: 1,
        label: "Studio and publisher",
        items: [
          {
            id: "studio", spriteId: "studio_logo", accessibleLabel: "Example Studio logo",
            caption: "Example Studio", backgroundColor: "#111722", fit: "contain",
            transition: "fade_scale", displayMs: 10000, minimumMs: 600, transitionMs: 120
          },
          {
            id: "publisher", spriteId: "publisher_logo", accessibleLabel: "Example Publisher logo",
            backgroundColor: "#12110f", fit: "cover",
            transition: "cut", displayMs: 10000, minimumMs: 300, transitionMs: 0
          }
        ]
      }
    }
  });
  writeJson(path.join(projectDir, "build-targets.json"), {
    schemaVersion: 2,
    defaults: { web: "intro-canvas" },
    targets: Object.fromEntries(["canvas", "phaser"].map((renderer) => {
      const id = `intro-${renderer}`;
      return [id, {
        id, platform: "web", renderer, webDir: `dist-${renderer}`,
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
        quality: "high", locale: "en", inputProfile: "keyboard_mouse",
        splashPlaylistId: "intro"
      }];
    }))
  });
}

function build(projectDir, targetId) {
  execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--target", targetId,
    "--json"
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json") || filePath.endsWith(".webmanifest")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function installGameplayInputProbe(page) {
  await page.addInitScript(() => {
    globalThis.__r22GameplayInputs = [];
    document.addEventListener("click", () => globalThis.__r22GameplayInputs.push("click"));
    document.addEventListener("keydown", (event) => globalThis.__r22GameplayInputs.push(event.key));
  });
}
