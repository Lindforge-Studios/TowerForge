import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";

test.use({ trace: "off", serviceWorkers: "block" });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const renderers = Object.freeze(["canvas", "phaser"]);
const outputs = new Map();
let tempRoot;
let server;
let origin;

test.beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r20-camera-boot-"));
  for (const renderer of renderers) {
    const { projectDir } = createProject({
      name: `camera_boot_${renderer}`,
      parentDir: tempRoot,
      templateName: "classic",
      gridKind: renderer === "canvas" ? "hex" : "square"
    });
    authorCameraTarget(projectDir, renderer);
    execFileSync(process.execPath, [
      path.join(repoRoot, "packages/cli/build.mjs"),
      "--project", projectDir,
      "--target", "camera-desktop",
      "--json"
    ], {
      cwd: repoRoot,
      stdio: "pipe",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    });
    outputs.set(renderer, path.join(projectDir, `dist-camera-${renderer}`));
  }

  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const parts = decodeURIComponent(url.pathname).replace(/^\/+/, "").split("/");
    const renderer = parts.shift();
    const outputDir = outputs.get(renderer);
    if (!outputDir) return respond404(response);
    const filePath = path.resolve(outputDir, parts.join("/") || "index.html");
    const relative = path.relative(outputDir, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return respond404(response);
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

for (const renderer of renderers) {
  test(`@r20-camera-boot generated ${renderer} camera target boots with a closed viewport profile`, async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${origin}/${renderer}/`);
    await page.waitForFunction(() => window.__towerforgeBootOk === true, undefined, { timeout: 30_000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    await expect(page.locator("#boot-error")).toBeHidden();
    await expect(page.locator("#playfield")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
}

function authorCameraTarget(projectDir, renderer) {
  const manifestPath = path.join(projectDir, "project.json");
  writeJson(manifestPath, { ...readJson(manifestPath), schemaVersion: 5 });

  const visualsPath = path.join(projectDir, "content/visuals.json");
  const visuals = readJson(visualsPath);
  visuals.schemaVersion = 4;
  visuals.cameraProfiles = {
    schemaVersion: 1,
    profiles: {
      iso: {
        schemaVersion: 1,
        projection: "isometric_2_1",
        orientation: "north",
        elevationScale: 1.25,
        fitPadding: 32,
        panPadding: 32,
        minZoom: 0.5,
        maxZoom: 3,
        initialZoom: 1
      }
    },
    bindings: { maps: {}, missions: {} }
  };
  writeJson(visualsPath, visuals);

  writeJson(path.join(projectDir, "build-targets.json"), {
    schemaVersion: 2,
    defaults: { web: "camera-desktop" },
    targets: {
      "camera-desktop": {
        id: "camera-desktop",
        platform: "web",
        renderer,
        webDir: `dist-camera-${renderer}`,
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
        quality: "high",
        locale: "en",
        inputProfile: "keyboard_mouse",
        cameraProfileId: "iso"
      }
    }
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
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

function respond404(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}
