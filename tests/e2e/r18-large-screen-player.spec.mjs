import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";

// Retained Playwright traces serialize every large GPU-backed surface in this six-viewport matrix.
// Linux/SwiftShader can time out in the trace fixture after the tested player has already disposed
// successfully, so this resource-heavy file keeps its direct assertions and pageerror collection
// but leaves tracing to the dedicated lifecycle suite.
test.use({ trace: "off" });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cases = Object.freeze([
  Object.freeze({ id: "canvas-hex-1024", renderer: "canvas", grid: "hex", width: 1024, height: 720, dpr: 1 }),
  Object.freeze({ id: "phaser-square-1280", renderer: "phaser", grid: "square", width: 1280, height: 720, dpr: 2, touch: true }),
  Object.freeze({ id: "canvas-square-1440", renderer: "canvas", grid: "square", width: 1440, height: 900, dpr: 1 }),
  Object.freeze({ id: "phaser-hex-1920", renderer: "phaser", grid: "hex", width: 1920, height: 1080, dpr: 2, session: true }),
  Object.freeze({ id: "canvas-hex-2560", renderer: "canvas", grid: "hex", width: 2560, height: 1440, dpr: 2 }),
  Object.freeze({ id: "phaser-square-3440", renderer: "phaser", grid: "square", width: 3440, height: 1440, dpr: 1, accessibility: true })
]);

let tempRoot;
let server;
let origin;
const projects = new Map();

test.beforeAll(async () => {
  test.setTimeout(240_000);
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r18-large-screen-e2e-"));
  for (const entry of cases) {
    const { projectDir } = createProject({
      name: entry.id,
      parentDir: tempRoot,
      templateName: "classic",
      gridKind: entry.grid
    });
    authorDesktopTarget(projectDir, entry);
    execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", "desktop",
      "--json"
    ], {
      cwd: repoRoot,
      stdio: "pipe",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    });
    projects.set(entry.id, path.join(projectDir, "dist-desktop"));
  }

  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const parts = decodeURIComponent(url.pathname).replace(/^\/+/, "").split("/");
    const id = parts.shift();
    const outputDir = projects.get(id);
    if (!outputDir) return respond404(response);
    const filePath = path.resolve(outputDir, parts.join("/") || "index.html");
    const confined = path.relative(outputDir, filePath);
    if (confined.startsWith("..") || path.isAbsolute(confined) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return respond404(response);
    }
    response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

for (const entry of cases) {
  test.describe(entry.id, () => {
    test.use({
      viewport: { width: entry.width, height: entry.height },
      deviceScaleFactor: entry.dpr,
      hasTouch: entry.touch === true,
      serviceWorkers: "block",
      reducedMotion: "reduce"
    });

    test(`${entry.renderer}/${entry.grid} desktop target works at ${entry.width}x${entry.height}`, async ({ page }) => {
      test.setTimeout(120_000);
      const browserErrors = [];
      let graphicsTeardown = null;
      page.on("pageerror", (error) => browserErrors.push(error.message));
      try {
        await page.goto(`${origin}/${entry.id}/`);
      await page.waitForFunction(() => window.__towerforgeBootOk === true);
      await expect(page.locator("#boot-error")).toBeHidden();
      await expect(page.locator("body")).toHaveAttribute("data-towerforge-player-shell", "desktop");
      await expect(page.locator("#playfield")).toBeVisible();
      await expect(page.locator("#desktop-action-bar")).toBeVisible();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      const playfield = entry.renderer === "phaser" ? page.locator("#playfield canvas") : page.locator("canvas#playfield");
      await expect(playfield).toBeVisible();
      await expectActionButtonsFit(page, entry);
      await verifySettingsAndInputGate(page);

      const probe = await findVisibleBuildable(page, { preferEdge: true });
      // Phaser RESIZE settles asynchronously after modal focus/scrollbar changes on compact
      // touch viewports. Establish the authored reset state after that layout boundary.
      await page.locator("#desktop-reset-view").click();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const initialPoint = await tilePoint(page, probe.coord);
      const initialViewport = await viewportSnapshot(page);
      expect(await page.evaluate((point) => window.__towerforgePickPoint(point), initialPoint)).toEqual(probe.coord);

      await page.mouse.move(initialPoint.x, initialPoint.y);
      await page.mouse.wheel(0, -360);
      await expect.poll(async () => (await viewportSnapshot(page)).zoom).toBeGreaterThan(initialViewport.zoom * 1.01);

      await page.locator("#desktop-reset-view").click();
      await expect.poll(async () => (await viewportSnapshot(page)).zoom).toBeCloseTo(initialViewport.zoom, 5);
      const resetPoint = await tilePoint(page, probe.coord);
      expect(await page.evaluate((point) => window.__towerforgePickPoint(point), resetPoint)).toEqual(probe.coord);

      const box = await playfield.boundingBox();
      expect(box).not.toBeNull();
      const dragStart = { x: box.x + box.width * 0.52, y: box.y + box.height * 0.55 };
      await page.mouse.move(dragStart.x, dragStart.y);
      await page.mouse.wheel(0, -360);
      const beforePan = await tilePoint(page, probe.coord);
      await page.mouse.move(dragStart.x, dragStart.y);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(dragStart.x + 56, dragStart.y + 28, { steps: 4 });
      await page.mouse.up({ button: "middle" });
      const pannedPoint = await tilePoint(page, probe.coord);
      expect(pointDistance(pannedPoint, beforePan)).toBeGreaterThan(8);

      await page.mouse.move(pannedPoint.x, pannedPoint.y);
      await page.mouse.wheel(0, -240);
      const placement = await findVisibleBuildable(page);
      expect(await page.evaluate((point) => window.__towerforgePickPoint(point), placement.point)).toEqual(placement.coord);
      if (entry.touch) await page.touchscreen.tap(placement.point.x, placement.point.y);
      else await page.mouse.click(placement.point.x, placement.point.y);
      await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().towers.length)).toBe(1);
      expect(await page.evaluate(() => window.__towerforgeLastPointerCoord)).toEqual(placement.coord);
      expect(await page.evaluate(() => window.__towerforgeInspect().towers[0].coord)).toEqual(placement.coord);

      await page.waitForTimeout(250);
      const beforeUpgrade = await page.evaluate(() => {
        const tower = window.__towerforgeInspect().towers[0];
        return { level: tower.level, stacks: tower.stacks };
      });
      await page.locator("#desktop-upgrade").click();
      await expect.poll(() => page.evaluate((before) => {
        const tower = window.__towerforgeInspect().towers[0];
        return tower.level > before.level || tower.stacks > before.stacks;
      }, beforeUpgrade)).toBe(true);
      await page.waitForTimeout(250);

      if (entry.accessibility) await verifyAccessibleDesktopShell(page);
      if (entry.session) await verifyContinueRestore(page, entry);
        expect(browserErrors).toEqual([]);
      } finally {
        graphicsTeardown = await releaseGeneratedGraphics(page, entry.renderer);
        if (entry.renderer === "phaser" && !page.isClosed()) {
          // Detach the already-disposed WebGL document before asking Playwright to close the
          // context. Linux/SwiftShader can otherwise leave trace finalization waiting on a stale
          // SharedImage mailbox even though Phaser and the WebGL context are already gone.
          await page.goto("about:blank", { waitUntil: "commit" });
        }
        if (entry.renderer === "phaser") {
          expect(graphicsTeardown).toMatchObject({
            disposeHookAvailable: true,
            canvasConnected: false,
            contextLost: true
          });
        }
      }
    });
  });
}

async function releaseGeneratedGraphics(page, renderer) {
  if (renderer !== "phaser" || page.isClosed()) return null;
  return page.evaluate(async () => {
    const canvas = document.querySelector("#playfield canvas");
    const graphics = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl") ?? null;
    const disposeHookAvailable = typeof globalThis.__towerforgeDispose === "function";
    if (disposeHookAvailable) {
      await globalThis.__towerforgeDispose();
    } else {
      // RED runs still release the scarce CI GPU resource. The assertion below requires the
      // generated player to own this lifecycle before the candidate can become GREEN.
      graphics?.getExtension("WEBGL_lose_context")?.loseContext();
      canvas?.remove();
    }
    return {
      disposeHookAvailable,
      canvasConnected: canvas?.isConnected ?? false,
      contextLost: graphics ? graphics.isContextLost() : true
    };
  });
}

async function verifySettingsAndInputGate(page) {
  const settings = page.locator("#desktop-settings");
  await settings.click();
  const dialog = page.locator("#desktop-settings-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("#desktop-settings-close")).toBeFocused();

  const probe = await findVisibleBuildable(page, { allowDialog: true, preferEdge: true });
  await page.waitForTimeout(120);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await viewportSnapshot(page);
  await page.locator("#desktop-quality").focus();
  await page.keyboard.press("KeyA");
  await dispatchWheelToPlayfield(page, probe.point);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = await viewportSnapshot(page);
  // Phaser can recompute vertical centering after a modal changes the compact viewport,
  // but blocked A/wheel input must not change horizontal pan or zoom.
  expect(after.zoom).toBe(before.zoom);
  expect(after.offsetX).toBe(before.offsetX);

  // A modal must remain keyboard-dismissible from its form controls, not only from its close button.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settings).toBeFocused();
}

async function verifyAccessibleDesktopShell(page) {
  for (const id of ["desktop-continue", "desktop-upgrade", "desktop-pause", "desktop-reset-view", "desktop-settings", "desktop-fullscreen"]) {
    const button = page.locator(`#${id}`);
    await expect(button).toHaveAttribute("aria-label", /\S/);
    const box = await button.boundingBox();
    expect(box?.width, `${id} width`).toBeGreaterThanOrEqual(44);
    expect(box?.height, `${id} height`).toBeGreaterThanOrEqual(44);
  }

  await page.locator("#desktop-settings").click();
  await page.locator("#desktop-quality").selectOption("high");
  await expect(page.locator("body")).toHaveAttribute("data-quality", "high");
  const stored = await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith("towerforge:preferences:"))
    .map((key) => JSON.parse(localStorage.getItem(key))));
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ schemaVersion: 1, quality: "high" });
  await page.locator("#desktop-settings-close").click();
  await expect(page.locator("#desktop-settings")).toBeFocused();
}

async function verifyContinueRestore(page, entry) {
  const saved = await expect.poll(() => readSessionSlots(page, entry), { timeout: 10_000 }).toMatchObject({
    head: expect.stringMatching(/^[01]$/),
    slots: expect.arrayContaining([expect.any(String), expect.any(String)])
  });
  void saved;
  const session = await readSessionSlots(page, entry);
  const latestRaw = session.slots[Number(session.head)];
  const latest = JSON.parse(latestRaw);
  expect(latest.contentDigest).toBe(latest.checkpoint.contentDigest);
  expect(latest.checkpoint.stateDigest).toMatch(/^tf-state-v1:[0-9a-f]{16}$/);
  const expected = await page.evaluate(() => {
    const snapshot = window.__towerforgeInspect();
    return {
      towers: snapshot.towers.map((tower) => ({ id: tower.id, typeId: tower.typeId, coord: tower.coord, level: tower.level })),
      resources: snapshot.resources
    };
  });

  await page.locator("#reset-run").click();
  await expect(page.locator("#stat-towers")).toHaveText("0");
  await page.locator("#desktop-continue").click();
  await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().towers.length)).toBe(expected.towers.length);
  expect(await page.evaluate(() => {
    const snapshot = window.__towerforgeInspect();
    return {
      towers: snapshot.towers.map((tower) => ({ id: tower.id, typeId: tower.typeId, coord: tower.coord, level: tower.level })),
      resources: snapshot.resources
    };
  })).toEqual(expected);
  await expect(page.locator("#message")).toContainText(/restored|восстанов/i);
}

async function readSessionSlots(page, entry) {
  return page.evaluate(async ({ appId }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(`towerforge-player-${appId}`, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (key) => new Promise((resolve, reject) => {
      const transaction = db.transaction("player-data", "readonly");
      const request = transaction.objectStore("player-data").get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    const base = `towerforge:session:${appId}`;
    return {
      head: await read(`${base}:head`),
      slots: [await read(`${base}:slot-0`), await read(`${base}:slot-1`)]
    };
  }, { appId: `local.towerforge.r18.${entry.id}` });
}

async function expectActionButtonsFit(page, entry) {
  const viewport = page.viewportSize();
  for (const id of ["desktop-continue", "desktop-upgrade", "desktop-pause", "desktop-reset-view", "desktop-settings", "desktop-fullscreen"]) {
    const button = page.locator(`#${id}`);
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.x, `${entry.id}/${id} left`).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0), `${entry.id}/${id} right`).toBeLessThanOrEqual(viewport.width);
    expect(box?.y, `${entry.id}/${id} top`).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0), `${entry.id}/${id} bottom`).toBeLessThanOrEqual(viewport.height);
  }
}

async function findVisibleBuildable(page, options = {}) {
  return page.evaluate(({ allowDialog, preferEdge }) => {
    const playfield = document.querySelector("#playfield");
    const rect = playfield.getBoundingClientRect();
    const rows = window.__towerforgeInspect().tiles
      .filter((tile) => tile.terrain === "buildable" && !tile.occupiedBy)
      .map((tile) => ({
        coord: { q: tile.q, r: tile.r },
        point: window.__towerforgeTilePoint(tile)
      }))
      .filter(({ point }) => point && point.x >= rect.left + 54 && point.x <= rect.right - 54
        && point.y >= rect.top + 64 && point.y <= rect.bottom - 54);
    if (rows.length === 0) throw new Error(`No visible buildable tile${allowDialog ? " behind dialog" : ""}.`);
    if (!preferEdge) return rows[Math.floor(rows.length / 2)];
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    rows.sort((a, b) => Math.hypot(b.point.x - center.x, b.point.y - center.y)
      - Math.hypot(a.point.x - center.x, a.point.y - center.y));
    return rows[0];
  }, options);
}

async function dispatchWheelToPlayfield(page, point) {
  await page.evaluate(({ x, y }) => {
    const target = document.querySelector("#playfield canvas") ?? document.querySelector("canvas#playfield") ?? document.querySelector("#playfield");
    target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY: -300 }));
  }, point);
}

function tilePoint(page, coord) {
  return page.evaluate((value) => window.__towerforgeTilePoint(value), coord);
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function viewportSnapshot(page) {
  return page.evaluate(() => window.__towerforgeViewportSnapshot?.() ?? null);
}

function authorDesktopTarget(projectDir, entry) {
  const projectPath = path.join(projectDir, "project.json");
  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  project.schemaVersion = 5;
  fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");

  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
  targets.schemaVersion = 2;
  targets.targets.desktop = {
    ...targets.targets[targets.defaults.web],
    id: "desktop",
    appId: `local.towerforge.r18.${entry.id}`,
    renderer: entry.renderer,
    webDir: "dist-desktop",
    formFactor: "desktop",
    viewport: { fit: "contain", padding: 32, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
    quality: "balanced",
    locale: "ru",
    inputProfile: "keyboard_mouse"
  };
  fs.writeFileSync(targetsPath, `${JSON.stringify(targets, null, 2)}\n`, "utf8");
}

function respond404(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function contentType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}
