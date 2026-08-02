import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let root;
let outputDir;
let server;
let origin;

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r18-phaser-lifecycle-browser-"));
  const { projectDir } = createProject({ name: "phaser-lifecycle", parentDir: root, templateName: "classic", gridKind: "hex" });
  const projectPath = path.join(projectDir, "project.json");
  const project = readJson(projectPath);
  project.schemaVersion = 5;
  writeJson(projectPath, project);
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.schemaVersion = 2;
  targets.targets.desktop = {
    ...targets.targets[targets.defaults.web],
    id: "desktop",
    renderer: "phaser",
    webDir: "dist-desktop",
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "en",
    inputProfile: "hybrid"
  };
  writeJson(targetsPath, targets);
  const built = JSON.parse(execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--target", "desktop",
    "--json"
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
  outputDir = built.outDir;
  server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, "");
    const filePath = path.resolve(outputDir, relative || "index.html");
    const confined = path.relative(outputDir, filePath);
    if (confined.startsWith("..") || path.isAbsolute(confined) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
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
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test("persisted BFCache transition preserves the live Phaser canvas until final pagehide", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await boot(page);
    const before = await page.locator("#playfield canvas").evaluate((canvas) => ({ width: canvas.width, height: canvas.height }));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(page.locator("#playfield canvas")).toBeAttached();
    await expect(page.locator("#playfield canvas")).toBeVisible();
    expect(await page.locator("#playfield canvas").evaluate((canvas) => ({ width: canvas.width, height: canvas.height }))).toEqual(before);
    expect(await page.evaluate(() => {
      const tile = window.__towerforgeInspect().tiles.find((entry) => entry.terrain === "buildable");
      const point = window.__towerforgeTilePoint(tile);
      return { point, picked: window.__towerforgePickPoint(point), tile: { q: tile.q, r: tile.r } };
    })).toMatchObject({ point: { x: expect.any(Number), y: expect.any(Number) }, picked: expect.any(Object) });

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
    await page.evaluate(() => globalThis.__towerforgeDispose());
    await expect(page.locator("#playfield canvas")).toHaveCount(0);
  } finally {
    await page.evaluate(() => globalThis.__towerforgeDispose?.()).catch(() => {});
    await context.close();
  }
});

test("dispose is same-promise idempotent and settles while requestAnimationFrame is unavailable", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await boot(page);
    const result = await page.evaluate(async () => {
      const original = globalThis.requestAnimationFrame;
      let rafCalls = 0;
      globalThis.requestAnimationFrame = () => { rafCalls += 1; throw new Error("hidden page has no animation frame"); };
      try {
        const first = globalThis.__towerforgeDispose();
        const second = globalThis.__towerforgeDispose();
        const third = globalThis.__towerforgeDispose();
        const samePromise = first === second && second === third;
        const settled = await Promise.race([
          Promise.allSettled([first, second, third]).then(() => true),
          new Promise((resolve) => setTimeout(() => resolve(false), 250))
        ]);
        return { samePromise, settled, rafCalls, canvasConnected: document.querySelector("#playfield canvas")?.isConnected ?? false };
      } finally {
        globalThis.requestAnimationFrame = original;
      }
    });
    expect(result).toEqual({ samePromise: true, settled: true, rafCalls: 0, canvasConnected: false });
  } finally {
    await context.close();
  }
});

async function boot(page) {
  await page.goto(origin);
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  await expect(page.locator("#playfield canvas")).toBeVisible();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function contentType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png"
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}
