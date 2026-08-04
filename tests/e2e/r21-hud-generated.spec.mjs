import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";
import { getHudProfileRecipe } from "../../packages/cli/lib/hud-authoring.mjs";

test.use({ trace: "off", serviceWorkers: "block" });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputs = new Map();
let tempRoot;
let server;
let origin;

test.beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r21-hud-player-"));
  for (const renderer of ["canvas", "phaser"]) {
    const { projectDir } = createProject({
      name: `hud_${renderer}`,
      parentDir: tempRoot,
      templateName: "classic",
      gridKind: renderer === "canvas" ? "hex" : "square"
    });
    authorHudTarget(projectDir, renderer);
    execFileSync(process.execPath, [
      path.join(repoRoot, "packages/cli/build.mjs"),
      "--project", projectDir,
      "--target", "hud-desktop",
      "--json"
    ], { cwd: repoRoot, stdio: "pipe", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } });
    outputs.set(renderer, path.join(projectDir, `dist-hud-${renderer}`));
  }
  server = http.createServer((request, response) => serve(request, response));
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

for (const renderer of ["canvas", "phaser"]) {
  test(`@r21-hud generated ${renderer} player renders live authored controls and screen events`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      globalThis.__towerforgeTestGamepad = {
        connected: true,
        buttons: Array.from({ length: 16 }, () => ({ pressed: false }))
      };
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => [globalThis.__towerforgeTestGamepad]
      });
    });
    await page.goto(`${origin}/${renderer}/`);
    await page.waitForFunction(() => globalThis.__towerforgeBootOk === true);
    await expect(page.locator("[data-hud-system-recovery=true]")).toHaveCount(0);
    await expect(page.locator("body")).toHaveAttribute("data-towerforge-hud-profile", "main");
    await expect(page.locator("header.hud")).toBeHidden();
    await expect(page.locator("#desktop-action-bar")).toBeHidden();
    await expect(page.locator('[data-hud-node-id="status"]')).toContainText(/Choose a tower|Action accepted/);
    await expect(page.locator('[data-hud-node-id="build_options"] > button')).not.toHaveCount(0);

    await page.locator('[data-hud-node-id="build_options"] > button').first().click();
    await page.locator('[data-hud-node-id="start_wave"]').click();
    await expect.poll(() => page.evaluate(() => globalThis.__towerforgeInspect().startedWaveCount)).toBe(1);

    await page.evaluate(() => globalThis.__towerforgePlayerActions.invoke("pause"));
    await expect(page.locator("#towerforge-hud-root")).toHaveAttribute("data-towerforge-hud-screen", "pause");
    await expect(page.locator('[data-hud-node-id="resume_game"]')).toBeVisible();
    await page.locator('[data-hud-node-id="resume_game"]').focus();
    await page.evaluate(() => { globalThis.__towerforgeTestGamepad.buttons[0].pressed = true; });
    await expect(page.locator("#towerforge-hud-root")).toHaveAttribute("data-towerforge-hud-screen", "gameplay", { timeout: 10_000 });
    await page.evaluate(() => { globalThis.__towerforgeTestGamepad.buttons[0].pressed = false; });
    expect(errors).toEqual([]);
  });
}

function authorHudTarget(projectDir, renderer) {
  const projectPath = path.join(projectDir, "project.json");
  writeJson(projectPath, { ...readJson(projectPath), schemaVersion: 5 });
  const profile = structuredClone(getHudProfileRecipe("desktop_quickbar", "main").profile);
  profile.commonNodes[0].childIds.unshift("status");
  profile.commonNodes.push({
    schemaVersion: 1,
    id: "status",
    type: "status_chip",
    childIds: [],
    properties: { text: "Status" },
    bindings: { data: [{ slot: "value", selectorId: "statusText" }], actions: [] },
    states: { normal: { visible: true, enabled: true } }
  });
  for (const variantId of ["desktop", "tablet", "mobile"]) {
    profile.variants[variantId].layouts.status = {
      schemaVersion: 1,
      layer: "overlay",
      safeArea: true,
      placement: { kind: "flow", order: -1, grow: 0 },
      size: { width: 180, height: 52, minWidth: 44, minHeight: 44, maxWidth: 240, maxHeight: 72 }
    };
  }
  writeJson(path.join(projectDir, "content/hud.json"), { schemaVersion: 1, profiles: { main: profile } });
  writeJson(path.join(projectDir, "build-targets.json"), {
    schemaVersion: 2,
    defaults: { web: "hud-desktop" },
    targets: {
      "hud-desktop": {
        id: "hud-desktop", platform: "web", renderer, webDir: `dist-hud-${renderer}`,
        formFactor: "desktop",
        viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 4, initialZoom: 1 },
        quality: "high", locale: "en", inputProfile: "hybrid", hudProfileId: "main"
      }
    }
  });
}

function serve(request, response) {
  const parts = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\/+/, "").split("/");
  const outputDir = outputs.get(parts.shift());
  if (!outputDir) return notFound(response);
  const filePath = path.resolve(outputDir, parts.join("/") || "index.html");
  const relative = path.relative(outputDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return notFound(response);
  const type = filePath.endsWith(".html") ? "text/html; charset=utf-8"
    : filePath.endsWith(".mjs") || filePath.endsWith(".js") ? "text/javascript; charset=utf-8"
      : filePath.endsWith(".css") ? "text/css; charset=utf-8"
        : filePath.endsWith(".json") || filePath.endsWith(".webmanifest") ? "application/json; charset=utf-8"
          : filePath.endsWith(".png") ? "image/png" : "application/octet-stream";
  response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  fs.createReadStream(filePath).pipe(response);
}

function notFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writeJson(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
