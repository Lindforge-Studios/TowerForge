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

    test(`@r18-large-screen ${entry.renderer}/${entry.grid} desktop target works at ${entry.width}x${entry.height}`, async ({ page }) => {
      // Linux/SwiftShader needs more than the ordinary case budget to render and dispose the
      // generated ultrawide surface after the preceding full-suite GPU matrix. The exception stays
      // bounded and applies only to this explicit 3440px Phaser acceptance case.
      test.setTimeout(entry.renderer === "phaser" && entry.width >= 3440 ? 180_000 : 120_000);
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

      if (entry.touch) {
        // Chromium may suppress the host mouse wheel while Playwright emulates a touch-only
        // context. Dispatch the same cancelable wheel event to the real playfield target so this
        // case verifies the player handler instead of the host input-device emulation.
        await dispatchWheelToPlayfield(page, initialPoint);
      } else {
        await page.mouse.move(initialPoint.x, initialPoint.y);
        await page.mouse.wheel(0, -360);
      }
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

      if (entry.accessibility) {
        await verifyRussianDesktopLocale(page);
        await verifyAccessibleDesktopShell(page, entry);
      }
      if (entry.session) {
        await verifyWaveBoundaryAutosave(page, entry);
        await verifyContinueRestore(page, entry);
      }
      if (entry.width === 1024) await expectAllLiveControlsReachable(page);
      if ([1024, 1440, 1920].includes(entry.width)) await expectCombatViewportCoverage(page, entry);
        expect(browserErrors).toEqual([]);
      } finally {
        const pageWasOpen = !page.isClosed();
        graphicsTeardown = await releaseGeneratedGraphics(page, entry.renderer);
        if (entry.renderer === "phaser" && pageWasOpen) {
          expect(graphicsTeardown).toMatchObject({
            disposeHookAvailable: true,
            canvasConnected: false,
            contextLost: true
          });
        }
        if (entry.renderer === "phaser" && !page.isClosed()) {
          // Detach the already-disposed WebGL document before asking Playwright to close the
          // context. Linux/SwiftShader can otherwise leave trace finalization waiting on a stale
          // SharedImage mailbox even though Phaser and the WebGL context are already gone.
          await page.goto("about:blank", { waitUntil: "commit" });
          await page.close({ runBeforeUnload: false });
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
  await page.locator("#desktop-ui-scale").focus();
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

async function verifyAccessibleDesktopShell(page, entry) {
  for (const id of ["desktop-continue", "desktop-upgrade", "desktop-pause", "desktop-reset-view", "desktop-settings", "desktop-fullscreen"]) {
    const button = page.locator(`#${id}`);
    await expect(button).toHaveAttribute("aria-label", /\S/);
    const box = await button.boundingBox();
    expect(box?.width, `${id} width`).toBeGreaterThanOrEqual(44);
    expect(box?.height, `${id} height`).toBeGreaterThanOrEqual(44);
  }

  await page.locator("#desktop-settings").click();
  await page.locator("#desktop-quality").selectOption("low");
  await page.locator('[data-key-binding="cameraReset"]').focus();
  await page.keyboard.press("KeyR");
  await expect(page.locator('[data-key-binding="cameraReset"]')).toHaveValue("KeyR");
  await page.locator("#snd").evaluate((element) => {
    element.checked = false;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator("#sfx-volume").evaluate((element) => {
    element.value = "0.1";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#music-volume").evaluate((element) => {
    element.value = "0.2";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("body")).toHaveAttribute("data-quality", "low");
  const appliedQuality = await page.evaluate(() => globalThis.__towerforgePresentationQuality?.());
  expect(appliedQuality).toMatchObject({
    schemaVersion: 1,
    quality: "low",
    maxDevicePixelRatio: 1,
    targetFps: 24
  });
  if (entry.renderer === "canvas") expect(appliedQuality.effectiveMaxDevicePixelRatio).toBe(1);
  else {
    expect(appliedQuality.effectiveTargetFps).toBe(24);
    expect(appliedQuality.effectiveSchedulerDelay).toBeCloseTo(1000 / 24, 5);
    const backbuffer = await readPhaserBackbuffer(page);
    expect(backbuffer.drawingBufferPixels).toBeLessThanOrEqual(appliedQuality.pixelBudget);
    expect(backbuffer.drawingBufferWidth).toBe(Math.floor(Math.floor(backbuffer.cssWidth) * appliedQuality.resolution));
    expect(backbuffer.drawingBufferHeight).toBe(Math.floor(Math.floor(backbuffer.cssHeight) * appliedQuality.resolution));
    expect(backbuffer.cssWidth).toBeGreaterThan(backbuffer.drawingBufferWidth);
    expect(backbuffer.cssHeight).toBeGreaterThan(backbuffer.drawingBufferHeight);
    expect(backbuffer.cssWidth).toBeCloseTo(backbuffer.playfieldCssWidth, 5);
    expect(backbuffer.cssHeight).toBeCloseTo(backbuffer.playfieldCssHeight, 5);
  }
  const stored = await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith("towerforge:preferences:"))
    .map((key) => JSON.parse(localStorage.getItem(key))));
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    schemaVersion: 1,
    quality: "low",
    soundEnabled: false,
    sfxVolume: 0.1,
    musicVolume: 0.2,
    keyBindings: { cameraReset: "KeyR" }
  });
  await page.locator("#desktop-settings-close").click();
  await expect(page.locator("#desktop-settings")).toBeFocused();
  if (entry.renderer === "phaser") {
    const probe = await findVisibleBuildable(page);
    expect(await page.evaluate((point) => window.__towerforgePickPoint(point), probe.point)).toEqual(probe.coord);
    await page.mouse.click(probe.point.x, probe.point.y);
    expect(await page.evaluate(() => window.__towerforgeLastPointerCoord)).toEqual(probe.coord);

    await page.locator("#desktop-reset-view").click();
    const baseZoom = (await viewportSnapshot(page)).zoom;
    for (let index = 0; index < 24; index += 1) await dispatchWheelToPlayfield(page, probe.point);
    await expect.poll(async () => (await viewportSnapshot(page)).zoom).toBeCloseTo(baseZoom * 3, 4);
    const zoomBeforeReload = (await viewportSnapshot(page)).zoom;
    expect(await readPlayerPreferences(page)).toMatchObject({ cameraZoom: 3 });

    await page.reload();
    await page.waitForFunction(() => window.__towerforgeBootOk === true);
    await expect(page.locator("body")).toHaveAttribute("data-quality", "low");
    await expect(page.locator("#snd")).not.toBeChecked();
    await expect(page.locator("#sfx-volume")).toHaveValue("0.1");
    await expect(page.locator("#music-volume")).toHaveValue("0.2");
    await expect.poll(async () => (await viewportSnapshot(page))?.zoom ?? 0).toBeCloseTo(zoomBeforeReload, 4);
    await page.locator("#desktop-reset-view").focus();
    await page.keyboard.press("KeyR");
    await expect.poll(async () => (await viewportSnapshot(page))?.zoom ?? 0).toBeCloseTo(baseZoom, 4);
    expect(await readPlayerPreferences(page)).toMatchObject({ cameraZoom: 1, keyBindings: { cameraReset: "KeyR" } });
    await expect.poll(async () => (await readPhaserBackbuffer(page)).drawingBufferPixels).toBeLessThanOrEqual(appliedQuality.pixelBudget);

    await page.setViewportSize({ width: entry.width - 240, height: entry.height });
    await expect.poll(async () => (await readPhaserBackbuffer(page)).drawingBufferPixels).toBeLessThanOrEqual(appliedQuality.pixelBudget);
  }
}

async function readPlayerPreferences(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("towerforge:preferences:"));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
}

async function verifyRussianDesktopLocale(page) {
  await expect(page.locator("#start-wave")).toHaveText(/\u043d\u0430\u0447\u0430\u0442\u044c.*\u0432\u043e\u043b\u043d/i);
  await expect(page.locator("#pause-run")).toHaveText(/\u043f\u0430\u0443\u0437/i);
  await page.locator("#pause-run").click();
  await expect(page.locator("#pause-run")).toHaveText(/\u043f\u0440\u043e\u0434\u043e\u043b\u0436/i);
  await page.locator("#pause-run").click();
}

async function verifyWaveBoundaryAutosave(page, entry) {
  await page.locator("#mission-select").selectOption("mission_2");
  await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().missionId)).toBe("mission_2");
  const before = await readSessionSlots(page, entry);
  const beforeLatest = before.head === null ? null : JSON.parse(before.slots[Number(before.head)]);
  expect(beforeLatest?.checkpoint?.state?.clearedWaveCount ?? 0).toBe(0);

  await page.locator("#speed").evaluate((element) => {
    element.value = "4";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#start-wave").click();
  await expect.poll(
    () => page.evaluate(() => window.__towerforgeInspect().clearedWaveCount),
    { timeout: 20_000 }
  ).toBeGreaterThanOrEqual(1);

  await expect.poll(async () => {
    const saved = await readSessionSlots(page, entry);
    if (saved.head === null || saved.slots[Number(saved.head)] === null) return 0;
    return JSON.parse(saved.slots[Number(saved.head)]).checkpoint.state.clearedWaveCount;
  }, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
}

async function expectCombatViewportCoverage(page, entry) {
  const ratio = await page.evaluate(() => {
    const rect = document.querySelector("#playfield").getBoundingClientRect();
    return rect.width * rect.height / (window.innerWidth * window.innerHeight);
  });
  expect(ratio, `${entry.id} playfield coverage`).toBeGreaterThanOrEqual(0.75);
}

async function expectAllLiveControlsReachable(page) {
  const selectors = [
    "#mission-select", "#difficulty-select", "#tower-select", "#start-wave", "#pause-run",
    "#sell-mode", "#reset-run", "#speed", "#snd", "#sfx-volume", "#music-volume",
    "#desktop-continue", "#desktop-upgrade", "#desktop-pause", "#desktop-reset-view",
    "#desktop-settings", "#desktop-fullscreen"
  ];
  for (const selector of selectors) {
    const control = page.locator(selector);
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box?.width ?? 0, `${selector} hit-target width`).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0, `${selector} hit-target height`).toBeGreaterThanOrEqual(44);
  }
}

async function readPhaserBackbuffer(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#playfield canvas");
    const rect = canvas.getBoundingClientRect();
    const playfieldRect = document.querySelector("#playfield").getBoundingClientRect();
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const drawingBufferWidth = gl?.drawingBufferWidth ?? canvas.width;
    const drawingBufferHeight = gl?.drawingBufferHeight ?? canvas.height;
    return {
      drawingBufferWidth,
      drawingBufferHeight,
      drawingBufferPixels: drawingBufferWidth * drawingBufferHeight,
      cssWidth: rect.width,
      cssHeight: rect.height,
      playfieldCssWidth: playfieldRect.width,
      playfieldCssHeight: playfieldRect.height
    };
  });
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
      missionId: snapshot.missionId,
      towers: snapshot.towers.map((tower) => ({ id: tower.id, typeId: tower.typeId, coord: tower.coord, level: tower.level })),
      resources: snapshot.resources
    };
  });

  await page.locator("#mission-select").selectOption("mission_1");
  await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().missionId)).toBe("mission_1");
  await page.locator("#desktop-continue").click();
  await expect(page.locator("#mission-select")).toHaveValue(expected.missionId);
  await expect(page.locator("#tower-select option")).not.toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().towers.length)).toBe(expected.towers.length);
  expect(await page.evaluate(() => {
    const snapshot = window.__towerforgeInspect();
    return {
      missionId: snapshot.missionId,
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

  if (entry.session) {
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.enemies.grunt = {
      ...balance.enemies.grunt,
      maxHp: 10_000,
      speed: 1
    };
    balance.missions.mission_2 = {
      ...structuredClone(balance.missions.mission_1),
      id: "mission_2",
      label: "Mission Two"
    };
    balance.missions.mission_1.prepTimeUnits = 100_000;
    balance.waveSets.waves = [
      { id: "wave_1", label: "Wave 1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] },
      { id: "wave_2", label: "Wave 2", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }
    ];
    fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");
  }
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
