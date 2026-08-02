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
  root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r18-hit-targets-"));
  const { projectDir } = createProject({ name: "desktop-hit-targets", parentDir: root, templateName: "classic", gridKind: "hex" });
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
    renderer: "canvas",
    webDir: "dist-desktop",
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "en",
    inputProfile: "keyboard_mouse"
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

test("1024x720 desktop action bar does not occlude primary HUD hit targets", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 720 }, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await page.goto(origin);
    await page.waitForFunction(() => window.__towerforgeBootOk === true);
    await expect(page.locator("#desktop-action-bar")).toBeVisible();

    for (const id of ["mission-select", "difficulty-select", "tower-select", "start-wave", "pause-run"]) {
      const proof = await centerHit(page, id);
      expect(proof.hitId, `${id} center is owned by ${proof.hitId || "nothing"}`).toBe(id);
    }

    for (const id of ["mission-select", "difficulty-select", "tower-select"]) {
      const { point } = await centerHit(page, id);
      await page.mouse.click(point.x, point.y);
      await expect(page.locator(`#${id}`)).toBeFocused();
      await page.keyboard.press("Escape");
    }

    const start = await centerHit(page, "start-wave");
    await page.mouse.click(start.point.x, start.point.y);
    await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().startedWaveCount)).toBe(1);

    const pause = await centerHit(page, "pause-run");
    await page.mouse.click(pause.point.x, pause.point.y);
    await expect(page.locator("#pause-run")).toHaveAttribute("aria-pressed", "true");
  } finally {
    await context.close();
  }
});

async function centerHit(page, id) {
  return page.evaluate((targetId) => {
    const target = document.getElementById(targetId);
    const rect = target.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    return { point, hitId: hit?.closest("button,select,input,a")?.id ?? hit?.id ?? null };
  }, id);
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
