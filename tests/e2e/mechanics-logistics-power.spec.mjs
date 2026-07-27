import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";
import { readRawProjectFiles } from "../../packages/cli/lib/project-loader.mjs";
import {
  migrateProjectFiles,
  writeMigratedProjectFiles
} from "../../packages/cli/lib/project-migrations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const combinations = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
));
const placements = [
  ["power_plant", { q: 2, r: 8 }],
  ["power_pylon", { q: 5, r: 8 }],
  ["arc_priority", { q: 2, r: 11 }],
  ["arc_brownout", { q: 5, r: 11 }]
];

test.use({ hasTouch: true });

test.describe.serial("R5.7A Studio Logistics power lifecycle", () => {
  let tempRoot;
  let projectDir;
  let studioProcess;
  let studioUrl;
  let serverOutput;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-logistics-studio-"));
    projectDir = path.join(tempRoot, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
    writeMigratedProjectFiles(projectDir, migrated.files);
    configurePowerTowers(projectDir);

    const port = await freePort();
    studioUrl = `http://127.0.0.1:${port}`;
    serverOutput = "";
    studioProcess = spawn(process.execPath, [
      path.join(repoRoot, "packages", "studio", "server.mjs"), "--project", projectDir
    ], {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(port), TOWERFORGE_BUNDLED_RUNTIME: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const capture = (chunk) => { serverOutput = `${serverOutput}${chunk}`.slice(-20_000); };
    studioProcess.stdout.on("data", capture);
    studioProcess.stderr.on("data", capture);
    await waitForHttp(`${studioUrl}/api/project`, studioProcess, () => serverOutput);
  });

  test.afterEach(async () => {
    await stopProcess(studioProcess);
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("previews without writes, applies, saves, reloads, disables, re-enables, and preserves power:null", async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    await openStudio(page, studioUrl);
    await openLogisticsMechanics(page);
    await expect(page.locator('#mechanics-recipe-select option[value="basic_power_grid"]'))
      .toHaveCount(1);
    await page.locator("#mechanics-recipe-select").selectOption("basic_power_grid");
    await page.locator("#mechanics-logistics-recipe-generator").selectOption("power_plant");
    await page.locator("#mechanics-logistics-recipe-relay").selectOption("power_pylon");
    await page.locator("#mechanics-logistics-recipe-consumer").selectOption("arc_priority");

    const beforeMaterialize = authoringBytes(projectDir);
    await page.locator("#btn-mechanics-new-profile").click();
    await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_power_grid");
    await generatorOutput(page).fill("8");
    const beforePreview = authoringBytes(projectDir);
    expect(beforePreview).toEqual(beforeMaterialize);
    await page.locator("#btn-mechanics-preview").click();
    await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
    expect(authoringBytes(projectDir)).toEqual(beforePreview);

    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => fs.existsSync(
      path.join(projectDir, "content", "mechanics.json")
    )).toBe(true);
    await expect.poll(() => readLogisticsState(projectDir)).toMatchObject({
      projectSchemaVersion: 3,
      moduleSchemaVersion: 1,
      enabled: true,
      selectedProfileId: "basic_power_grid",
      profile: { power: { generators: { power_plant: { output: 8 } } } }
    });

    await page.reload();
    await openLogisticsMechanics(page);
    await expect(generatorOutput(page)).toHaveValue("8");
    await generatorOutput(page).fill("9");
    await page.locator("#btn-mechanics-save").click();
    await expect.poll(() => readLogisticsState(projectDir).profile.power.generators.power_plant.output).toBe(9);

    await page.reload();
    await openLogisticsMechanics(page);
    await expect(generatorOutput(page)).toHaveValue("9");
    const preserved = structuredClone(readLogisticsState(projectDir).profile);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-mechanics-disable").click();
    await expect.poll(() => readLogisticsState(projectDir)).toMatchObject({
      enabled: false, selectedProfileId: "basic_power_grid", profile: preserved
    });
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readLogisticsState(projectDir)).toMatchObject({
      enabled: true, selectedProfileId: "basic_power_grid", profile: preserved
    });

    await page.reload();
    await openLogisticsMechanics(page);
    await expect(page.locator("#mechanics-logistics-power-enabled")).toBeChecked();
    await page.locator("#mechanics-logistics-power-enabled").uncheck();
    await expect(page.locator("#mechanics-logistics-power-enabled")).not.toBeChecked();
    await expect(page.locator("#mechanics-logistics-generator-rows")).toBeEmpty();
    await page.locator("#btn-mechanics-save").click();
    await expect.poll(() => readLogisticsState(projectDir).profile).toEqual({ power: null });
    await page.reload();
    await openLogisticsMechanics(page);
    await expect(page.locator("#mechanics-logistics-power-enabled")).not.toBeChecked();
    await expect(page.locator("#mechanics-logistics-generator-rows")).toBeEmpty();
    expect(browserErrors()).toEqual([]);
  });

  test("keeps future Logistics v4 visible, byte-identical, and read-only", async ({ page }) => {
    writeFutureLogistics(projectDir);
    const before = authoringBytes(projectDir);
    const browserErrors = captureBrowserErrors(page);
    await openStudio(page, studioUrl);
    await openLogisticsMechanics(page);

    await expect(page.locator("#mechanics-logistics-read-only")).toBeVisible();
    await expect(page.locator("#mechanics-logistics-read-only")).toContainText(/future|schemaVersion 4|read-only/i);
    await expect(page.locator("#mechanics-profile-id")).toHaveValue("future_power");
    await expect(generatorOutput(page)).toHaveValue("13");
    expect(await page.locator(
      "#mechanics-logistics-editor input, #mechanics-logistics-editor select, #mechanics-logistics-editor button"
    ).evaluateAll((controls) => controls.length > 0 && controls.every((control) => control.disabled))).toBe(true);
    for (const selector of [
      "#mechanics-profile-id", "#btn-mechanics-new-profile", "#btn-mechanics-preview",
      "#btn-mechanics-enable", "#btn-mechanics-save", "#btn-mechanics-disable"
    ]) await expect(page.locator(selector)).toBeDisabled();
    await page.reload();
    await openLogisticsMechanics(page);
    expect(authoringBytes(projectDir)).toEqual(before);
    expect(browserErrors()).toEqual([]);
  });

  test("shows authoritative supply, brownout, node links, and node coverage in Studio Playtest", async ({ page }) => {
    test.setTimeout(120_000);
    enablePower(projectDir, { mode: "active" });
    const browserErrors = captureBrowserErrors(page);
    await openStudio(page, studioUrl);
    await page.locator('[data-tab="playtest"]').click();
    await expect(page.locator("#playtest-stage")).toBeVisible();

    for (const [towerTypeId, coord] of placements) {
      await page.locator("#pt-tower-list .pt-tower", { hasText: towerLabel(towerTypeId) }).click();
      await clickHexTile(page, "#playtest-canvas", coord, { width: 15, height: 20 });
    }
    await expect(page.locator("#pt-towers-count")).toHaveText("4");
    const panel = page.locator("#pt-logistics-power");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/8\/8 allocated/i);
    await expect(panel).toContainText(/brownout.*tower_4/i);
    await expectVisiblePair(panel.locator(".pt-logistics-link-cue"), "tower_1", "tower_2");
    await expectVisiblePair(panel.locator(".pt-logistics-coverage-cue"), "tower_1", "tower_3");
    await expectVisiblePair(panel.locator(".pt-logistics-coverage-cue"), "tower_2", "tower_4");
    await expect(panel.locator("button, input, select, textarea")).toHaveCount(0);
    expect(browserErrors()).toEqual([]);
  });
});

test.describe("R5.7A generated Logistics power presentation", () => {
  let tempRoot;
  let playerServer;
  let playerPort;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-logistics-player-"));
    for (const combination of combinations) buildPlayerFixture(tempRoot, { mode: "active", ...combination });
    buildPlayerFixture(tempRoot, { mode: "absent", grid: "hex", renderer: "canvas" });
    buildPlayerFixture(tempRoot, { mode: "null", grid: "square", renderer: "phaser" });

    playerPort = await freeHttpPort();
    playerServer = http.createServer((request, response) => {
      const relative = decodeURIComponent(
        new URL(request.url, `http://127.0.0.1:${playerPort}`).pathname
      ).replace(/^\/+/, "");
      const [mode, grid, renderer, ...parts] = relative.split("/");
      if (!["active", "absent", "null"].includes(mode)
        || !["hex", "square"].includes(grid)
        || !["canvas", "phaser"].includes(renderer)) return respond404(response);
      const root = path.join(tempRoot, `${fixtureName(mode, grid, renderer)}.tdproj`, "dist");
      const filePath = path.resolve(root, parts.join("/") || "index.html");
      const confined = path.relative(root, filePath);
      if (confined.startsWith("..") || path.isAbsolute(confined)
        || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return respond404(response);
      response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
      fs.createReadStream(filePath).pipe(response);
    });
    await new Promise((resolve, reject) => playerServer.listen(
      playerPort, "127.0.0.1", (error) => error ? reject(error) : resolve()
    ));
  });

  test.afterAll(async () => {
    if (playerServer) await new Promise((resolve) => playerServer.close(resolve));
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("shows authoritative supply, brownout, links, and coverage on Canvas/Phaser and hex/square", async ({ page }) => {
    test.setTimeout(180_000);
    const browserErrors = captureBrowserErrors(page);
    for (const { grid, renderer } of combinations) {
      await page.goto(playerUrl(playerPort, "active", grid, renderer));
      await waitForPlayerBoot(page);
      const coordinates = await powerPlacementCoordinates(page);
      for (let index = 0; index < placements.length; index += 1) {
        await placePlayerTower(page, placements[index][0], coordinates[index]);
      }

      const snapshot = await page.evaluate(() => window.__towerforgeInspect().logistics);
      expect(snapshot).toMatchObject({
        schemaVersion: 1,
        power: {
          components: [{ output: 8, demand: 16, allocated: 8 }],
          nodes: [
            { towerId: "tower_1", linkTowerIds: ["tower_2"], coveredConsumerIds: ["tower_3"] },
            { towerId: "tower_2", linkTowerIds: ["tower_1"], coveredConsumerIds: ["tower_4"] }
          ],
          consumers: [
            { towerId: "tower_3", powered: true },
            { towerId: "tower_4", powered: false }
          ]
        }
      });
      const panel = page.locator("#logistics-status");
      await expect(panel, `${grid}/${renderer} power panel`).toBeVisible();
      await expect(panel).toContainText(/8\/8 allocated/i);
      await expect(panel).toContainText(/brownout.*tower_4/i);
      await expectVisiblePair(panel.locator(".logistics-link-cue"), "tower_1", "tower_2");
      await expectVisiblePair(panel.locator(".logistics-coverage-cue"), "tower_1", "tower_3");
      await expectVisiblePair(panel.locator(".logistics-coverage-cue"), "tower_2", "tower_4");
      await expect(panel.locator("button, input, select, textarea")).toHaveCount(0);
    }
    expect(browserErrors()).toEqual([]);
  });

  test("keeps absent and power:null projects on the hidden legacy path", async ({ page }) => {
    for (const { mode, grid, renderer } of [
      { mode: "absent", grid: "hex", renderer: "canvas" },
      { mode: "null", grid: "square", renderer: "phaser" }
    ]) {
      await page.goto(playerUrl(playerPort, mode, grid, renderer));
      await waitForPlayerBoot(page);
      expect((await page.evaluate(() => window.__towerforgeInspect())).logistics).toBeUndefined();
      await expect(page.locator("#logistics-status")).toBeHidden();
      await expect(page.locator("#logistics-status")).toBeEmpty();
    }
  });
});

function buildPlayerFixture(root, { mode, grid, renderer }) {
  const name = fixtureName(mode, grid, renderer);
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  configurePowerTowers(projectDir);
  if (mode !== "absent") enablePower(projectDir, { mode });
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets.logistics = {
    ...targets.targets["web-pwa"], id: "logistics", renderer, webDir: "dist"
  };
  writeJson(targetsPath, targets);
  execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir, "--target", "logistics"
  ], {
    cwd: repoRoot,
    stdio: "ignore",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  });
}

function configurePowerTowers(projectDir) {
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const arrow = balance.towers.arrow_tower ?? Object.values(balance.towers)[0];
  const cannon = balance.towers.cannon_tower ?? Object.values(balance.towers)[1] ?? arrow;
  balance.towers.power_plant = cheapTower(arrow, "power_plant", towerLabel("power_plant"));
  balance.towers.power_pylon = cheapTower(arrow, "power_pylon", towerLabel("power_pylon"));
  balance.towers.arc_priority = cheapTower(cannon, "arc_priority", towerLabel("arc_priority"));
  balance.towers.arc_brownout = cheapTower(cannon, "arc_brownout", towerLabel("arc_brownout"));
  balance.missions[missionId].startingResources = { coins: 100 };
  balance.missions[missionId].buildTowerIds = placements.map(([towerTypeId]) => towerTypeId);
  writeJson(balancePath, balance);
}

function enablePower(projectDir, { mode }) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { logistics: "browser_power" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      logistics: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          browser_power: {
            power: mode === "null" ? null : {
              generators: { power_plant: { output: 8, linkRadius: 4, coverageRadius: 4 } },
              relays: { power_pylon: { linkRadius: 4, coverageRadius: 4 } },
              consumers: {
                arc_priority: { demand: 8, priority: 1 },
                arc_brownout: { demand: 8, priority: 2 }
              }
            }
          }
        }
      }
    }
  });
}

function writeFutureLogistics(projectDir) {
  configurePowerTowers(projectDir);
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  balance.missions.tutorial_01.mechanics = { profiles: { logistics: "future_power" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      logistics: {
        schemaVersion: 4,
        enabled: true,
        profiles: {
          future_power: {
            power: {
              generators: { power_plant: { output: 13, linkRadius: 4, coverageRadius: 4 } },
              relays: { power_pylon: { linkRadius: 4, coverageRadius: 4 } },
              consumers: { arc_priority: { demand: 8, priority: 1 } }
            },
            ammunition: null,
            supply: null,
            factories: ["opaque"]
          }
        }
      }
    }
  });
}

async function openStudio(page, url) {
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(url);
  await expect(page).toHaveTitle(/TowerForge Editor/);
}

async function openLogisticsMechanics(page) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
  const card = page.locator('#mechanics-module-grid [data-mechanics-module="logistics"]');
  await expect(card).toBeEnabled();
  if (!await card.evaluate((element) => element.classList.contains("selected"))) await card.click();
  await expect(page.locator("#mechanics-logistics-editor")).toBeVisible();
}

async function placePlayerTower(page, towerTypeId, coord) {
  await page.locator("#tower-select").selectOption(towerTypeId);
  const point = await page.evaluate((candidate) => window.__towerforgeTilePoint(candidate), coord);
  expect(await page.evaluate((candidate) => window.__towerforgePickPoint(candidate), point)).toEqual(coord);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#stat-towers")).toHaveText(String(
    placements.findIndex(([candidate]) => candidate === towerTypeId) + 1
  ));
}

async function powerPlacementCoordinates(page) {
  const coordinates = await page.evaluate(() => {
    const snapshot = window.__towerforgeInspect();
    const pickable = new Map(snapshot.tiles
      .filter((tile) => tile.terrain === "buildable" && !tile.occupiedBy)
      .filter((tile) => {
        const point = window.__towerforgeTilePoint(tile);
        const picked = point && window.__towerforgePickPoint(point);
        return picked?.q === tile.q && picked?.r === tile.r;
      })
      .map((tile) => [`${tile.q},${tile.r}`, { q: tile.q, r: tile.r }]));
    const patterns = [
      [[0, 0], [3, 0], [0, 2], [3, 2]],
      [[0, 0], [0, 3], [2, 0], [2, 3]],
      [[0, 0], [-3, 0], [0, 2], [-3, 2]],
      [[0, 0], [0, -3], [2, 0], [2, -3]]
    ];
    for (const origin of pickable.values()) {
      for (const pattern of patterns) {
        const candidate = pattern.map(([dq, dr]) => pickable.get(`${origin.q + dq},${origin.r + dr}`));
        if (candidate.every(Boolean)) return candidate;
      }
    }
    return null;
  });
  expect(coordinates, "player fixture needs four visible buildable power-grid coordinates").not.toBeNull();
  return coordinates;
}

async function expectVisiblePair(locator, left, right) {
  await expect(locator.first()).toBeVisible();
  const text = (await locator.allTextContents()).join("\n");
  expect(text).toMatch(new RegExp(
    `(?:${escapeRegex(left)}[\\s\\S]*${escapeRegex(right)}|${escapeRegex(right)}[\\s\\S]*${escapeRegex(left)})`
  ));
}

async function waitForPlayerBoot(page) {
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  await expect(page.locator("#boot-error")).toBeHidden();
  const story = page.locator("#story-overlay");
  if (await story.isVisible()) {
    await page.locator("#story-skip").click();
    await expect(story).toBeHidden();
  }
}

async function clickHexTile(page, selector, coord, mapSize) {
  const canvas = page.locator(selector);
  const position = await canvas.evaluate((element, args) => {
    const radius = Math.min(
      element.width / ((args.mapSize.width + 1) * 1.65),
      element.height / ((args.mapSize.height + 1) * 1.45)
    );
    const x = radius * 1.5 + args.coord.q * radius * 1.48 + (args.coord.r % 2) * radius * 0.74;
    const y = radius * 1.5 + args.coord.r * radius * 1.28;
    const rect = element.getBoundingClientRect();
    return { x: x / (element.width / rect.width), y: y / (element.height / rect.height) };
  }, { coord, mapSize });
  await canvas.click({ position });
}

function readLogisticsState(projectDir) {
  const manifest = readJson(path.join(projectDir, "project.json"));
  const balance = readJson(path.join(projectDir, "content", "balance.json"));
  const mechanics = readJson(path.join(projectDir, "content", "mechanics.json"));
  const module = mechanics.modules.logistics;
  const selectedProfileId = balance.missions.tutorial_01.mechanics?.profiles?.logistics;
  return {
    projectSchemaVersion: manifest.schemaVersion,
    moduleSchemaVersion: module.schemaVersion,
    enabled: module.enabled,
    selectedProfileId,
    profile: module.profiles[selectedProfileId]
  };
}

function authoringBytes(projectDir) {
  const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
  return {
    manifest: fs.readFileSync(path.join(projectDir, "project.json"), "base64"),
    balance: fs.readFileSync(path.join(projectDir, "content", "balance.json"), "base64"),
    mechanics: fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "base64") : null
  };
}

function generatorOutput(page) {
  return page.locator('[data-logistics-role="generators"] [data-logistics-output]').first();
}

function towerLabel(towerTypeId) {
  return ({
    power_plant: "Power Plant",
    power_pylon: "Power Pylon",
    arc_priority: "Priority Arc",
    arc_brownout: "Brownout Arc"
  })[towerTypeId];
}

function cheapTower(source, id, label) {
  const tower = structuredClone(source);
  tower.id = id;
  tower.label = label;
  tower.cost = { coins: 1 };
  tower.footprintRadius = 0;
  return tower;
}

function fixtureName(mode, grid, renderer) {
  return `logistics_${mode}_${grid}_${renderer}`;
}

function playerUrl(port, mode, grid, renderer) {
  return `http://127.0.0.1:${port}/${mode}/${grid}/${renderer}/`;
}

function captureBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return () => errors.filter((message) => !(
    message.includes("document is sandboxed") && message.includes("allow-same-origin")
  ));
}

async function waitForHttp(url, child, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Studio exited before readiness.\n${output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Studio is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Studio did not become ready.\n${output()}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) return freePort();
  return port;
}

async function freeHttpPort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) return freeHttpPort();
  return port;
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
