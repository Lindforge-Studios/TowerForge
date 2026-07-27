import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const combinations = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
));
const controls = [
  { mode: "absent", grid: "hex", renderer: "canvas" },
  { mode: "unselected", grid: "square", renderer: "phaser" }
];
let tempDir;
let server;
let port;

test.use({ hasTouch: true });

test.beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-roguelite-player-"));
  for (const combination of combinations) buildFixture({ mode: "active", ...combination });
  for (const control of controls) buildFixture(control);

  port = await freePort();
  server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname).replace(/^\/+/, "");
    const [mode, grid, renderer, ...parts] = relative.split("/");
    if (!["active", "absent", "unselected"].includes(mode)
      || !["hex", "square"].includes(grid)
      || !["canvas", "phaser"].includes(renderer)) return respond404(response);
    const buildDir = path.join(tempDir, `${fixtureName(mode, grid, renderer)}.tdproj`, "dist");
    const filePath = path.resolve(buildDir, parts.join("/") || "index.html");
    const confined = path.relative(buildDir, filePath);
    if (confined.startsWith("..") || path.isAbsolute(confined)
      || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return respond404(response);
    response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", (error) => error ? reject(error) : resolve()));
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test("active synergies cross Canvas and Phaser on hex and square through the authoritative snapshot", async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors = captureBrowserErrors(page);

  for (const { grid, renderer } of combinations) {
    await page.goto(playerUrl("active", grid, renderer));
    await waitForPlayerBoot(page);
    const status = page.locator("#roguelite-status");
    await expect(status, `${grid}/${renderer} active panel`).toBeVisible();
    await assertAuthoritativeStatus(page, {
      synergyId: "browser_elemental",
      towerCount: 0,
      activeTierRequiredCounts: [],
      text: "Browser Elemental: 0 towers (inactive)"
    });

    const first = await nextPlacementPoint(page);
    expect(first, `${grid}/${renderer} needs a first placement`).not.toBeNull();
    expect(await page.evaluate((point) => window.__towerforgePickPoint(point), first)).toEqual(first.coord);
    await page.mouse.click(first.x, first.y);
    await expect(page.locator("#stat-towers")).toHaveText("1");
    await assertAuthoritativeStatus(page, {
      synergyId: "browser_elemental",
      towerCount: 1,
      activeTierRequiredCounts: [],
      text: "Browser Elemental: 1 towers (inactive)"
    });

    const second = await nextPlacementPoint(page, first.coord);
    expect(second, `${grid}/${renderer} needs a second placement`).not.toBeNull();
    expect(await page.evaluate((point) => window.__towerforgePickPoint(point), second)).toEqual(second.coord);
    await page.mouse.click(second.x, second.y);
    await expect(page.locator("#stat-towers")).toHaveText("2");
    await assertAuthoritativeStatus(page, {
      synergyId: "browser_elemental",
      towerCount: 2,
      activeTierRequiredCounts: [2],
      text: "Browser Elemental: 2 towers (active 2)"
    });
  }

  expect(browserErrors()).toEqual([]);
});

test("absent and mission-unselected mechanics keep the generated-player panel hidden", async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  for (const { mode, grid, renderer } of controls) {
    await page.goto(playerUrl(mode, grid, renderer));
    await waitForPlayerBoot(page);
    const snapshot = await page.evaluate(() => window.__towerforgeInspect());
    expect(snapshot.roguelite, `${mode}/${grid}/${renderer} must stay legacy`).toBeUndefined();
    await expect(page.locator("#roguelite-status")).toBeHidden();
    await expect(page.locator("#roguelite-status")).toBeEmpty();
  }
  expect(browserErrors()).toEqual([]);
});

test("the active PWA and single-file artifacts both carry the same initial synergy snapshot", async ({ page }) => {
  test.setTimeout(120_000);
  const projectDir = path.join(tempDir, `${fixtureName("active", "hex", "canvas")}.tdproj`);
  const dist = path.join(projectDir, "dist");
  for (const relativePath of [
    "manifest.webmanifest",
    "offline-sw.js",
    "project-data.js",
    "renderer/roguelite-presentation.mjs",
    "index.single.html"
  ]) expect(fs.existsSync(path.join(dist, relativePath)), `missing ${relativePath}`).toBe(true);

  const browserErrors = captureBrowserErrors(page);
  await page.goto(`${playerUrl("active", "hex", "canvas")}index.single.html`);
  await waitForPlayerBoot(page);
  await assertAuthoritativeStatus(page, {
    synergyId: "browser_elemental",
    towerCount: 0,
    activeTierRequiredCounts: [],
    text: "Browser Elemental: 0 towers (inactive)"
  });
  expect(browserErrors()).toEqual([]);
});

test("boss loot is socketed and unsocketed through native controls across the player matrix", async ({ page }) => {
  test.setTimeout(180_000);
  const browserErrors = captureBrowserErrors(page);
  const activations = ["click", "enter", "space", "tap"];

  for (const [{ grid, renderer }, activation] of combinations.map((entry, index) => [entry, activations[index]])) {
    await page.goto(playerUrl("active", grid, renderer));
    await waitForPlayerBoot(page);

    const placement = await nextPlacementPoint(page);
    expect(placement, `${grid}/${renderer} needs an artifact host tower`).not.toBeNull();
    await page.mouse.click(placement.x, placement.y);
    await expect(page.locator("#stat-towers")).toHaveText("1");

    const startWave = page.locator("#start-wave");
    await startWave.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => artifactState(page), {
      message: `${grid}/${renderer} must receive deterministic boss loot`,
      timeout: 20_000
    }).toMatchObject({ inventoryCount: 1, managementAllowed: true, socket: null });

    const socket = page.locator('[data-artifact-action="socket"]');
    await expect(socket, `${grid}/${renderer} socket action`).toBeEnabled();
    await activateNativeControl(page, socket, activation);
    await expect.poll(() => artifactState(page), {
      message: `${grid}/${renderer} socket command must update the authoritative snapshot`
    }).toMatchObject({
      inventoryCount: 1,
      managementAllowed: true,
      socket: { towerId: "tower_1", slotId: "scope" }
    });
    await expect(page.locator("#artifact-inventory")).toContainText("tower_1/scope");

    const unsocket = page.locator('[data-artifact-action="unsocket"]');
    await expect(unsocket, `${grid}/${renderer} unsocket action`).toBeEnabled();
    await unsocket.click();
    await expect.poll(() => artifactState(page), {
      message: `${grid}/${renderer} unsocket command must update the authoritative snapshot`
    }).toMatchObject({ inventoryCount: 1, managementAllowed: true, socket: null });
  }

  expect(browserErrors()).toEqual([]);
});

function buildFixture({ mode, grid, renderer }) {
  const name = fixtureName(mode, grid, renderer);
  const { projectDir } = createProject({ name, parentDir: tempDir, templateName: "classic", gridKind: grid });
  if (mode !== "absent") {
    const manifestPath = path.join(projectDir, "project.json");
    const manifest = readJson(manifestPath);
    manifest.schemaVersion = 3;
    writeJson(manifestPath, manifest);

    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = readJson(balancePath);
    const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
    const hostTowerId = balance.missions[missionId].buildTowerIds[0];
    const bossEnemyId = Object.keys(balance.enemies)[0];
    for (const tower of Object.values(balance.towers)) tower.tags = ["elemental"];
    if (mode === "active") {
      balance.missions[missionId].mechanics = { profiles: { roguelite: "browser_synergies" } };
      balance.towers[hostTowerId].range = 32;
      if ("fireRate" in balance.towers[hostTowerId].attack) balance.towers[hostTowerId].attack.fireRate = 30;
      if ("interval" in balance.towers[hostTowerId].attack) balance.towers[hostTowerId].attack.interval = 0.05;
      balance.enemies[bossEnemyId].maxHp = 1;
      balance.enemies[bossEnemyId].speed = 0.1;
      balance.waveSets[balance.missions[missionId].waveSetId] = [{
        id: "artifact_boss_wave",
        label: "Artifact boss wave",
        groups: [{ enemyId: bossEnemyId, count: 1, spawnInterval: 0.1, startDelay: 0 }]
      }, {
        id: "pending_wave",
        label: "Pending wave",
        groups: [{ enemyId: bossEnemyId, count: 1, spawnInterval: 0.1, startDelay: 0 }]
      }];
    }
    writeJson(balancePath, balance);
    writeJson(path.join(projectDir, "content", "mechanics.json"), {
      schemaVersion: 1,
      modules: {
        roguelite: {
          schemaVersion: mode === "active" ? 2 : 1,
          enabled: true,
          profiles: {
            browser_synergies: {
              synergies: {
                browser_elemental: {
                  label: "Browser Elemental",
                  tag: "elemental",
                  tiers: [
                    { requiredCount: 2, modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.1 }] },
                    { requiredCount: 4, modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.2 }] }
                  ]
                }
              },
              ...(mode === "active" ? {
                artifacts: {
                  definitions: {
                    browser_scope: {
                      label: "Browser Scope",
                      slotType: "scope",
                      modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.1 }]
                    }
                  },
                  towerSlots: {
                    [hostTowerId]: [{ slotId: "scope", slotType: "scope" }]
                  },
                  bossLootTables: {
                    [bossEnemyId]: {
                      rolls: 1,
                      entries: [{ artifactId: "browser_scope", weight: 1 }]
                    }
                  }
                }
              } : {})
            }
          }
        }
      }
    });
  }

  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets.roguelite = {
    ...targets.targets["web-pwa"],
    id: "roguelite",
    renderer,
    webDir: "dist"
  };
  writeJson(targetsPath, targets);
  const buildArgs = [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--target", "roguelite"
  ];
  if (mode === "active" && grid === "hex" && renderer === "canvas") buildArgs.push("--single-file");
  execFileSync(process.execPath, buildArgs, {
    cwd: repoRoot,
    stdio: "ignore",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  });
}

async function waitForPlayerBoot(page) {
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  await expect(page.locator("#boot-error")).toBeHidden();
}

async function nextPlacementPoint(page, farFrom = null) {
  return page.evaluate((origin) => {
    const candidates = window.__towerforgeInspect().tiles
      .filter((tile) => tile.terrain === "buildable" && !tile.occupiedBy)
      .map((tile) => ({
        coord: { q: tile.q, r: tile.r },
        distance: origin ? Math.abs(tile.q - origin.q) + Math.abs(tile.r - origin.r) : 0,
        ...window.__towerforgeTilePoint(tile)
      }))
      .filter((point) => {
        const picked = window.__towerforgePickPoint(point);
        return picked?.q === point.coord.q && picked?.r === point.coord.r;
      })
      .sort((left, right) => right.distance - left.distance
        || left.coord.r - right.coord.r || left.coord.q - right.coord.q);
    return candidates[0] ?? null;
  }, farFrom);
}

async function assertAuthoritativeStatus(page, expected) {
  await expect.poll(() => page.evaluate(() => {
    const snapshot = window.__towerforgeInspect();
    const row = snapshot.roguelite?.synergies?.[0];
    return row ? {
      synergyId: row.synergyId,
      towerCount: row.towerCount,
      activeTierRequiredCounts: row.activeTierRequiredCounts
    } : null;
  })).toEqual({
    synergyId: expected.synergyId,
    towerCount: expected.towerCount,
    activeTierRequiredCounts: expected.activeTierRequiredCounts
  });
  await expect(page.locator("#roguelite-status")).toHaveText(expected.text);
}

async function artifactState(page) {
  return page.evaluate(() => {
    const artifacts = window.__towerforgeInspect().roguelite?.artifacts;
    const artifact = artifacts?.inventory?.[0];
    return {
      inventoryCount: artifacts?.inventory?.length ?? 0,
      managementAllowed: artifacts?.management?.allowed ?? false,
      socket: artifact?.socket ?? null
    };
  });
}

async function activateNativeControl(page, locator, activation) {
  if (activation === "click") return locator.click();
  if (activation === "tap") return locator.tap();
  await locator.focus();
  await page.keyboard.press(activation === "space" ? "Space" : "Enter");
}

function fixtureName(mode, grid, renderer) {
  return `roguelite_${mode}_${grid}_${renderer}`;
}

function playerUrl(mode, grid, renderer) {
  return `http://127.0.0.1:${port}/${mode}/${grid}/${renderer}/`;
}

function captureBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return () => errors;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function freePort() {
  const probe = http.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const resolved = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  if (!resolved) return freePort();
  return resolved;
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
