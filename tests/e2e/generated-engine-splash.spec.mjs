import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test.use({ trace: "off", serviceWorkers: "block" });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let tempRoot;
let outputDir;
let server;
let origin;

test.beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-engine-splash-e2e-"));
  const projectDir = path.join(tempRoot, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples/starter.tdproj"), projectDir, { recursive: true });
  const result = JSON.parse(execFileSync(process.execPath, [
    path.join(repoRoot, "packages/cli/build.mjs"),
    "--project", projectDir,
    "--out", "dist-engine-splash",
    "--json"
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  }));
  outputDir = result.outDir;
  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const filePath = path.resolve(outputDir, decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html");
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

test("generated player holds the engine splash until boot and then dismisses it", async ({ page }) => {
  let releasePlayer;
  const playerGate = new Promise((resolve) => { releasePlayer = resolve; });
  await page.route("**/player.mjs", async (route) => {
    await playerGate;
    await route.continue();
  });

  const navigation = page.goto(origin, { waitUntil: "load" });
  const splash = page.locator("#towerforge-engine-splash");
  try {
    await expect(splash).toBeVisible();
    await expect(splash).toHaveAttribute("aria-label", "Made with TowerForge");
    expect(await page.evaluate(() => window.__towerforgeBootOk === true)).toBe(false);
  } finally {
    releasePlayer();
  }
  await navigation;
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  await expect(splash).toBeHidden();
  expect(await page.evaluate(() => window.__towerforgeSplashDismissed)).toBe(true);
});

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json") || filePath.endsWith(".webmanifest")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
