import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";
import { applyThemePack } from "../../packages/cli/lib/theme-packs.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const combinations = ["hex", "square"].flatMap((grid) =>
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
);
let tempRoot;
let playerServer;
let playerPort;
let studioProcess;
let studioUrl;

test.beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-c6b-player-"));
  for (const { grid, renderer } of combinations) {
    const { projectDir } = createProject({
      name: `terraforming_${grid}_${renderer}`,
      parentDir: tempRoot,
      templateName: "classic",
      gridKind: grid
    });
    const themed = await applyThemePack(projectDir, "verdant-frontier");
    if (!themed.ok) throw new Error(`Could not apply the presentation theme: ${themed.error}`);
    configureProject(projectDir, renderer);
    execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", "terraforming"
    ], {
      cwd: repoRoot,
      stdio: "ignore",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    });
  }

  playerServer = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const [, grid, renderer, ...parts] = pathname.split("/");
    if (!["hex", "square"].includes(grid) || !["canvas", "phaser"].includes(renderer)) {
      return respond404(response);
    }
    const root = path.join(tempRoot, `terraforming_${grid}_${renderer}.tdproj`, "dist");
    const filePath = path.resolve(root, parts.join("/") || "index.html");
    const relative = path.relative(root, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return respond404(response);
    }
    response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => playerServer.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  playerPort = playerServer.address().port;

  const studioProject = path.join(tempRoot, "terraforming_hex_canvas.tdproj");
  const port = await freePort();
  studioUrl = `http://127.0.0.1:${port}`;
  studioProcess = spawn(process.execPath, [
    path.join(repoRoot, "packages", "studio", "server.mjs"),
    "--project", studioProject
  ], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), TOWERFORGE_BUNDLED_RUNTIME: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForHttp(`${studioUrl}/api/project`, studioProcess);
});

test.afterAll(async () => {
  if (studioProcess && studioProcess.exitCode === null && studioProcess.signalCode === null) {
    studioProcess.kill();
    await new Promise((resolve) => studioProcess.once("exit", resolve));
  }
  if (playerServer) await new Promise((resolve) => playerServer.close(resolve));
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("Canvas and Phaser redraw terrain signatures and elevation cues on set and timed restore for hex and square", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const { grid, renderer } of combinations) {
    await page.goto(`http://127.0.0.1:${playerPort}/${grid}/${renderer}/`);
    await page.waitForFunction(() => window.__towerforgeBootOk === true);
    await expect(page.locator("#boot-error")).toBeHidden();
    await dismissStory(page);
    await setSpeed(page, "#speed", 0);
    await page.waitForTimeout(100);
    await twoFrames(page);

    const initial = {
      root: await tilePixels(page, { q: 1, r: 1 }),
      neighbor: await tileEdgePixels(page, { q: 1, r: 2 }, { q: 1, r: 1 }),
      elevation: await tilePixels(page, { q: 4, r: 1 }, 90),
      neighborSignatures: await surroundingAutotileSignatures(page, { q: 1, r: 1 })
    };
    await page.locator("#start-wave").click();
    await expect.poll(() => page.evaluate(() => {
      const snapshot = window.__towerforgeInspect();
      const terrain = snapshot.tiles.find((tile) => tile.q === 1 && tile.r === 1)?.terrain;
      const elevation = snapshot.elevation?.overrides?.find((item) => item.q === 4 && item.r === 1)?.elevation;
      return { terrain, elevation, groups: snapshot.terraforming?.pendingExpiryGroups?.length };
    }), { timeout: 10_000 }).toEqual({ terrain: "water", elevation: 2, groups: 1 });
    await twoFrames(page);

    const changed = {
      root: await tilePixels(page, { q: 1, r: 1 }),
      neighbor: await tileEdgePixels(page, { q: 1, r: 2 }, { q: 1, r: 1 }),
      elevation: await tilePixels(page, { q: 4, r: 1 }, 90),
      neighborSignatures: await surroundingAutotileSignatures(page, { q: 1, r: 1 })
    };
    expect(changed.root, `${grid}/${renderer}: changed terrain was not redrawn`).not.toBe(initial.root);
    expect(
      changed.neighborSignatures.some((signature, index) => signature !== initial.neighborSignatures[index]),
      `${grid}/${renderer}: no neighboring autotile signature changed`
    ).toBe(true);
    expect(changed.elevation, `${grid}/${renderer}: elevation cue was not drawn`).not.toBe(initial.elevation);

    await setSpeed(page, "#speed", 4);
    await expect.poll(() => page.evaluate(() => {
      const snapshot = window.__towerforgeInspect();
      const terrain = snapshot.tiles.find((tile) => tile.q === 1 && tile.r === 1)?.terrain;
      const elevation = snapshot.elevation?.overrides?.find((item) => item.q === 4 && item.r === 1)?.elevation ?? 0;
      return { terrain, elevation, groups: snapshot.terraforming?.pendingExpiryGroups?.length };
    }), { timeout: 10_000 }).toEqual({ terrain: "buildable", elevation: 0, groups: 0 });
    await setSpeed(page, "#speed", 0);
    await twoFrames(page);

    const restored = {
      root: await tilePixels(page, { q: 1, r: 1 }),
      neighbor: await tileEdgePixels(page, { q: 1, r: 2 }, { q: 1, r: 1 }),
      elevation: await tilePixels(page, { q: 4, r: 1 }, 90),
      neighborSignatures: await surroundingAutotileSignatures(page, { q: 1, r: 1 })
    };
    // The running wave can add time-dependent background/entity pixels to a crop, so exact
    // equality with the pre-wave frame is not a portable renderer contract. Equality with the
    // set frame, however, proves a stale cached tile/cue; every restore must visibly replace it.
    expect(restored.root, `${grid}/${renderer}: terrain restore did not redraw`).not.toBe(changed.root);
    expect(restored.neighborSignatures, `${grid}/${renderer}: neighbor restore kept a set signature`).toEqual(initial.neighborSignatures);
    expect(restored.neighbor).toMatch(/^[a-f0-9]{64}$/);
    expect(restored.elevation, `${grid}/${renderer}: elevation restore kept a stale cue`).not.toBe(changed.elevation);
  }
  expect(pageErrors).toEqual([]);
});

test("Studio playtest consumes the same active set and restore events without a private gameplay implementation", async ({ page }) => {
  test.setTimeout(30_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem("towerforge:welcomed", "1");
      localStorage.setItem("towerforge:language", "en");
    } catch {}
  });
  await page.goto(studioUrl);
  await page.getByRole("tab", { name: /Playtest/ }).click();
  await expect(page.locator("#playtest-canvas")).toBeVisible();
  await setSpeed(page, "#pt-speed", 0);
  await page.locator("#pt-start").click();
  await expect(page.locator("#pt-event-timeline .pt-event-type", { hasText: "terrainChanged" })).toHaveCount(1);
  await expect(page.locator("#pt-event-timeline .pt-event-type", { hasText: "elevationChanged" })).toHaveCount(1);

  await setSpeed(page, "#pt-speed", 4);
  await expect.poll(() => page.locator("#pt-event-timeline .pt-event-type").evaluateAll((nodes) => ({
    terrain: nodes.filter((node) => node.textContent === "terrainChanged").length,
    elevation: nodes.filter((node) => node.textContent === "elevationChanged").length,
    restored: nodes.filter((node) => node.title.includes('"source":"restore"')).length
  })), { timeout: 10_000 }).toEqual({ terrain: 2, elevation: 2, restored: 2 });
  await setSpeed(page, "#pt-speed", 0);
  expect(pageErrors).toEqual([]);
});

function configureProject(projectDir, renderer) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      elevation: { schemaVersion: 1, enabled: true, profiles: { authored_elevation: {} } },
      terraforming: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          mutable_terrain: {
            terrainTransitions: {
              flood: { fromTerrainTags: ["ground"], toTerrainId: "water" }
            },
            elevation: { minimum: -3, maximum: 5, maximumDeltaPerOperation: 2 }
          }
        }
      }
    }
  });

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const mission = balance.missions[balance.defaultMissionId];
  mission.mechanics = { profiles: { elevation: "authored_elevation", terraforming: "mutable_terrain" } };
  writeJson(balancePath, balance);

  const scriptsDir = path.join(projectDir, "scripts");
  const scriptPath = findFile(scriptsDir, (fileName) => fileName.endsWith(".tower.json"));
  const script = readJson(scriptPath);
  script.schemaVersion = 6;
  script.handlers ??= {};
  script.handlers.waveStarted ??= [];
  script.handlers.waveStarted.push({
    id: "c6b_timed_terraforming",
    actions: [{
      action: "terraformTiles",
      duration: 2,
      operations: [
        { kind: "set_terrain", target: { q: 1, r: 1 }, transitionId: "flood" },
        { kind: "set_elevation", target: { q: 4, r: 1 }, elevation: 2 }
      ]
    }]
  });
  writeJson(scriptPath, script);

  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets.terraforming = {
    ...targets.targets["web-pwa"],
    id: "terraforming",
    renderer,
    webDir: "dist"
  };
  writeJson(targetsPath, targets);
}

function findFile(root, predicate) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(target, predicate);
      if (nested) return nested;
    } else if (predicate(entry.name)) return target;
  }
  return undefined;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function dismissStory(page) {
  const overlay = page.locator("#story-overlay");
  if (await overlay.isVisible()) await page.locator("#story-skip").click();
  await expect(overlay).toBeHidden();
}

async function setSpeed(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function twoFrames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function tilePixels(page, coord, size = 42) {
  const point = await page.evaluate((target) => window.__towerforgeTilePoint(target), coord);
  return screenshotHash(page, point, size);
}

async function tileEdgePixels(page, coord, adjacentCoord) {
  const [center, adjacent] = await page.evaluate(([target, neighbor]) => [
    window.__towerforgeTilePoint(target),
    window.__towerforgeTilePoint(neighbor)
  ], [coord, adjacentCoord]);
  // Sample just inside the neighboring cell on the shared edge. The tile center can stay
  // byte-identical across edge masks even though the connection border changed.
  const point = {
    x: center.x + (adjacent.x - center.x) * 0.38,
    y: center.y + (adjacent.y - center.y) * 0.38
  };
  return screenshotHash(page, point, 14);
}

async function surroundingAutotileSignatures(page, coord) {
  return page.evaluate(async (target) => {
    const [{ resolveAutotile }, projectModule] = await Promise.all([
      import("./renderer/autotile.mjs"),
      import("./project-data.js")
    ]);
    const snapshot = window.__towerforgeInspect();
    const map = {
        id: snapshot.mapId || snapshot.missionId,
        grid: snapshot.grid,
        tiles: snapshot.tiles,
        pathRoutes: snapshot.pathRoutes || []
    };
    const offsets = snapshot.grid.kind === "square"
      ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
      : [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 0]];
    return offsets.map(([dq, dr]) => {
      const tile = snapshot.tiles.find((item) => item.q === target.q + dq && item.r === target.r + dr);
      if (!tile) return null;
      const result = resolveAutotile({
        map,
        visuals: projectModule.default.visuals,
        coord: tile,
        terrain: tile.terrain,
        seed: projectModule.default.visuals?.tileSeed || 0
      });
      return `${tile.q},${tile.r}:${tile.terrain}:${result.signature}`;
    });
  }, coord);
}

async function screenshotHash(page, point, size) {
  const viewport = page.viewportSize();
  const clip = {
    x: Math.max(0, Math.min(viewport.width - size, point.x - size / 2)),
    y: Math.max(0, Math.min(viewport.height - size, point.y - size / 2)),
    width: size,
    height: size
  };
  return createHash("sha256").update(await page.screenshot({ clip })).digest("hex");
}

function respond404(response) {
  response.writeHead(404, { "Content-Type": "text/plain" });
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

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHttp(url, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Studio exited before readiness.");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Studio.");
}
