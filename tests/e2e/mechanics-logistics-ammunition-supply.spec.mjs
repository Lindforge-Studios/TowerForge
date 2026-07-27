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
import { migrateProjectFiles, writeMigratedProjectFiles } from "../../packages/cli/lib/project-migrations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const combinations = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
));

test.use({ hasTouch: true });

test.describe.serial("R5.8B Studio ammunition supply lifecycle", () => {
  let tempRoot;
  let projectDir;
  let studioProcess;
  let studioUrl;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-supply-studio-"));
    projectDir = path.join(tempRoot, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
    writeMigratedProjectFiles(projectDir, migrated.files);
    installLogistics(projectDir, { version: 2, supply: undefined });
    const port = await freePort();
    studioUrl = `http://127.0.0.1:${port}`;
    studioProcess = spawn(process.execPath, [
      path.join(repoRoot, "packages", "studio", "server.mjs"), "--project", projectDir
    ], {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(port), TOWERFORGE_BUNDLED_RUNTIME: "1" },
      stdio: "ignore"
    });
    await waitForHttp(`${studioUrl}/api/project`, studioProcess);
  });

  test.afterEach(async () => {
    await stopProcess(studioProcess);
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("opens v2 byte-identically, explicitly promotes, CRUDs supply, reloads, disables, and re-enables", async ({ page }) => {
    test.setTimeout(120_000);
    const before = authoringBytes(projectDir);
    await openStudio(page, studioUrl);
    await openLogistics(page);
    expect(authoringBytes(projectDir)).toEqual(before);
    await expect(page.locator("#btn-mechanics-add-supply")).toBeVisible();
    await page.locator("#btn-mechanics-add-supply").click();
    expect(readLogistics(projectDir).module.schemaVersion).toBe(2);
    await expect(page.locator("#mechanics-logistics-supply-enabled")).toBeChecked();

    await page.locator("#btn-mechanics-add-production-recipe").click();
    const recipe = page.locator("#mechanics-logistics-production-recipe-rows").first();
    await recipe.locator("[data-logistics-production-recipe-id]").fill("forge_shell");
    await recipe.locator("[data-logistics-production-recipe-label]").fill("Forge shell");
    await recipe.locator("[data-logistics-production-ammo-type-id]").fill("shell");
    await recipe.locator("[data-logistics-production-output-amount]").fill("4");
    await recipe.locator("[data-logistics-production-interval]").fill("1");

    await page.locator("#btn-mechanics-add-producer").click();
    const producer = page.locator("#mechanics-logistics-producer-rows").first();
    await fillSupplySource(producer, "producer", {
      towerTypeId: "shell_factory", recipeOrAmmoId: "forge_shell", capacity: "120", starting: "0",
      radius: "4", amount: "8", interval: "0.4"
    });
    await page.locator("#btn-mechanics-add-storage").click();
    const storage = page.locator("#mechanics-logistics-storage-rows").first();
    await fillSupplySource(storage, "storage", {
      towerTypeId: "shell_depot", recipeOrAmmoId: "shell", capacity: "240", starting: "0",
      radius: "5", amount: "12", interval: "0.4"
    });
    await page.locator("#btn-mechanics-save").click();
    await expect.poll(() => readLogistics(projectDir)).toMatchObject({
      module: { schemaVersion: 3, enabled: true },
      profile: {
        power: null,
        ammunition: {
          types: { shell: { label: "Shell" } },
          towerInventories: {
            cannon_tower: { ammoTypeId: "shell", capacity: 30, startingAmount: 0, consumptionPerActivation: 1 }
          }
        },
        supply: {
          productionRecipes: {
            forge_shell: { label: "Forge shell", ammoTypeId: "shell", outputAmount: 4, interval: 1 }
          },
          producers: { shell_factory: expect.objectContaining({ recipeId: "forge_shell", transferAmount: 8 }) },
          storages: { shell_depot: expect.objectContaining({ ammoTypeId: "shell", transferAmount: 12 }) }
        }
      }
    });
    await page.reload();
    await openLogistics(page);
    await expect(page.locator("[data-logistics-production-recipe-label]").first()).toHaveValue("Forge shell");
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-mechanics-disable").click();
    await expect.poll(() => readLogistics(projectDir).module.enabled).toBe(false);
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readLogistics(projectDir).module.enabled).toBe(true);
  });

  test("keeps future v4 byte-identical and disables every Mechanics write control", async ({ page }) => {
    installLogistics(projectDir, { version: 4, supply: null, future: { conveyors: ["opaque"] } });
    const before = authoringBytes(projectDir);
    await openStudio(page, studioUrl);
    await openLogistics(page);
    await expect(page.locator("#mechanics-logistics-read-only")).toContainText(/future|schemaVersion 4|read-only/i);
    for (const selector of [
      "#mechanics-profile-id", "#btn-mechanics-new-profile", "#btn-mechanics-preview",
      "#btn-mechanics-enable", "#btn-mechanics-save", "#btn-mechanics-disable"
    ]) await expect(page.locator(selector)).toBeDisabled();
    expect(await page.locator(
      "#mechanics-logistics-editor input, #mechanics-logistics-editor select, #mechanics-logistics-editor button"
    ).evaluateAll((controls) => controls.length > 0 && controls.every((control) => control.disabled))).toBe(true);
    await page.reload();
    await openLogistics(page);
    expect(authoringBytes(projectDir)).toEqual(before);
  });
});

test.describe("R5.8B generated ammunition supply presentation", () => {
  let tempRoot;
  let server;
  let port;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-supply-player-"));
    for (const combination of combinations) buildFixture(tempRoot, { mode: "active", ...combination });
    buildFixture(tempRoot, { mode: "brownout", grid: "square", renderer: "canvas" });
    buildFixture(tempRoot, { mode: "absent", grid: "hex", renderer: "canvas" });
    buildFixture(tempRoot, { mode: "v2", grid: "square", renderer: "phaser" });
    buildFixture(tempRoot, { mode: "null", grid: "hex", renderer: "phaser" });
    port = await freePort();
    server = http.createServer((request, response) => serveFixture(request, response, tempRoot, port));
    await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("shows authoritative stock, progress, directed links, and refill cues on Canvas/Phaser and hex/square", async ({ page }) => {
    test.setTimeout(180_000);
    for (const { grid, renderer } of combinations) {
      await page.goto(playerUrl(port, "active", grid, renderer));
      await boot(page);
      for (const towerTypeId of ["shell_factory", "shell_depot", "cannon_tower"])
        await placeTower(page, towerTypeId);
      await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().logistics?.supply))
        .toMatchObject({
          producers: [expect.objectContaining({ towerId: "tower_1", operational: true })],
          storages: [expect.objectContaining({ towerId: "tower_2" })],
          edges: expect.arrayContaining([
            expect.objectContaining({ sourceTowerId: "tower_1", destinationTowerId: "tower_3", destinationKind: "consumer" })
          ])
        });
      const panel = page.locator("#logistics-status");
      await expect(panel).toBeVisible();
      await expect(panel.locator(".logistics-supply-stock-cue", { hasText: "tower_1" }).first())
        .toContainText(/tower_1[\s\S]*\d+\/10/i);
      await expect(panel.locator(".logistics-supply-progress-cue").first()).toBeVisible();
      await expectPair(panel.locator(".logistics-supply-link-cue"), "tower_1", "tower_3");
      await expectPair(panel.locator(".logistics-refill-cue"), "tower_1", "tower_3");
      await expect(panel.locator("button, input, select, textarea")).toHaveCount(0);
    }
  });

  test("shows authoritative paused/brownout producer while passive refill relationships remain visible", async ({ page }) => {
    await page.goto(playerUrl(port, "brownout", "square", "canvas"));
    await boot(page);
    for (const towerTypeId of ["shell_factory", "shell_depot", "cannon_tower"])
      await placeTower(page, towerTypeId);
    const panel = page.locator("#logistics-status");
    await expect(panel.locator(".logistics-supply-paused-cue")).toContainText(/tower_1|brownout|paused/i);
    await expectPair(panel.locator(".logistics-refill-cue"), "tower_1", "tower_3");
    expect(await page.evaluate(() => window.__towerforgeInspect().logistics.supply.producers[0]))
      .toMatchObject({ towerId: "tower_1", powered: false, operational: false });
  });

  test("keeps absent, v2, and v3 supply:null paths free of supply overlays", async ({ page }) => {
    for (const fixture of [
      ["absent", "hex", "canvas"], ["v2", "square", "phaser"], ["null", "hex", "phaser"]
    ]) {
      await page.goto(playerUrl(port, ...fixture));
      await boot(page);
      const logistics = await page.evaluate(() => window.__towerforgeInspect().logistics);
      if (fixture[0] === "absent") expect(logistics).toBeUndefined();
      else if (fixture[0] === "v2") expect(logistics?.supply).toBeUndefined();
      else expect(logistics?.supply).toBeNull();
      await expect(page.locator(".logistics-supply-stock-cue, .logistics-supply-progress-cue, .logistics-supply-link-cue, .logistics-refill-cue"))
        .toHaveCount(0);
    }
  });
});

async function fillSupplySource(row, role, values) {
  await row.locator(`[data-logistics-${role}-tower-type-id]`).fill(values.towerTypeId);
  await row.locator(`[data-logistics-${role}-${role === "producer" ? "recipe" : "ammo-type"}-id]`)
    .fill(values.recipeOrAmmoId);
  await row.locator(`[data-logistics-${role}-capacity]`).fill(values.capacity);
  await row.locator(`[data-logistics-${role}-starting-amount]`).fill(values.starting);
  await row.locator(`[data-logistics-${role}-transfer-radius]`).fill(values.radius);
  await row.locator(`[data-logistics-${role}-transfer-amount]`).fill(values.amount);
  await row.locator(`[data-logistics-${role}-transfer-interval]`).fill(values.interval);
}

function buildFixture(root, { mode, grid, renderer }) {
  const name = fixtureName(mode, grid, renderer);
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  if (mode !== "absent") installLogistics(projectDir, {
    version: mode === "v2" ? 2 : 3,
    supply: mode === "active" || mode === "brownout" ? supplyProfile() : null,
    power: mode === "brownout" ? {
      generators: {}, relays: {}, consumers: { shell_factory: { demand: 1, priority: 0 } }
    } : null
  });
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets.logistics = { ...targets.targets["web-pwa"], id: "logistics", renderer, webDir: "dist" };
  writeJson(targetsPath, targets);
  execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir, "--target", "logistics"
  ], { cwd: repoRoot, stdio: "ignore", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } });
}

function supplyProfile() {
  return {
    productionRecipes: {
      forge_shell: { label: "Forge shell", ammoTypeId: "shell", outputAmount: 4, interval: 0.2 }
    },
    producers: {
      shell_factory: {
        recipeId: "forge_shell", capacity: 10, startingAmount: 4,
        transferRadius: 64, transferAmount: 4, transferInterval: 0.2
      }
    },
    storages: {
      shell_depot: {
        ammoTypeId: "shell", capacity: 20, startingAmount: 0,
        transferRadius: 64, transferAmount: 4, transferInterval: 0.2
      }
    }
  };
}

function installLogistics(projectDir, { version, supply, power = null, future }) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { logistics: "factory_supply" } };
  const baseTower = Object.values(balance.towers).find((tower) => tower?.attack?.kind);
  for (const [id, label] of [
    ["shell_factory", "Shell Factory"], ["shell_depot", "Shell Depot"], ["cannon_tower", "Supply Cannon"]
  ]) {
    const tower = structuredClone(baseTower);
    tower.id = id;
    tower.label = label;
    tower.cost = { coins: 1 };
    if (id === "cannon_tower") tower.attack.fireRate = 20;
    balance.towers[id] = tower;
  }
  balance.missions[missionId].startingResources = { coins: 100 };
  balance.missions[missionId].buildTowerIds = ["shell_factory", "shell_depot", "cannon_tower"];
  writeJson(balancePath, balance);
  const ammunition = {
    types: { shell: { label: "Shell" } },
    towerInventories: {
      cannon_tower: { ammoTypeId: "shell", capacity: 30, startingAmount: 0, consumptionPerActivation: 1 }
    }
  };
  const profile = version === 2 ? { power, ammunition } : { power, ammunition, supply };
  if (future) Object.assign(profile, future);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: { logistics: { schemaVersion: version, enabled: true, profiles: { factory_supply: profile } } }
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

async function openLogistics(page) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
  const card = page.locator('#mechanics-module-grid [data-mechanics-module="logistics"]');
  await expect(card).toBeEnabled();
  if (!await card.evaluate((element) => element.classList.contains("selected"))) await card.click();
  await expect(page.locator("#mechanics-logistics-editor")).toBeVisible();
}

async function boot(page) {
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  const story = page.locator("#story-overlay");
  if (await story.isVisible()) await page.locator("#story-skip").click();
}

async function placeTower(page, towerTypeId) {
  await page.locator("#tower-select").selectOption(towerTypeId);
  const { countBefore, candidates } = await page.evaluate(() => {
    const snapshot = window.__towerforgeInspect();
    return {
      countBefore: snapshot.towers.length,
      candidates: snapshot.tiles.filter((tile) => tile.terrain === "buildable" && !tile.occupiedBy)
    };
  });
  for (const coord of candidates) {
    const point = await page.evaluate((tile) => window.__towerforgeTilePoint(tile), coord);
    await page.mouse.click(point.x, point.y);
    const countAfter = await page.evaluate(() => window.__towerforgeInspect().towers.length);
    if (countAfter === countBefore + 1) {
      await expect(page.locator("#stat-towers")).toHaveText(String(countAfter));
      return;
    }
  }
  throw new Error(`No authoritative canPlaceTower-approved coordinate for ${towerTypeId}.`);
}

async function expectPair(locator, left, right) {
  await expect(locator.first()).toBeVisible();
  expect((await locator.allTextContents()).join("\n")).toMatch(new RegExp(
    `(?:${left}[\\s\\S]*${right}|${right}[\\s\\S]*${left})`
  ));
}

function serveFixture(request, response, root, port) {
  const parts = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname)
    .replace(/^\/+/, "").split("/");
  const [mode, grid, renderer, ...tail] = parts;
  const fixtureRoot = path.join(root, `${fixtureName(mode, grid, renderer)}.tdproj`, "dist");
  const filePath = path.resolve(fixtureRoot, tail.join("/") || "index.html");
  const relative = path.relative(fixtureRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
    response.writeHead(404).end();
    return;
  }
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
  response.writeHead(200, { "Content-Type": types[path.extname(filePath)] ?? "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}

function readLogistics(projectDir) {
  const balance = readJson(path.join(projectDir, "content", "balance.json"));
  const module = readJson(path.join(projectDir, "content", "mechanics.json")).modules.logistics;
  const profileId = balance.missions.tutorial_01.mechanics.profiles.logistics;
  return { module, profile: module.profiles[profileId] };
}

function authoringBytes(projectDir) {
  return ["project.json", "content/mechanics.json", "content/balance.json"]
    .map((relativePath) => fs.readFileSync(path.join(projectDir, relativePath)).toString("base64"));
}

function fixtureName(mode, grid, renderer) { return `supply_${mode}_${grid}_${renderer}`; }
function playerUrl(port, mode, grid, renderer) { return `http://127.0.0.1:${port}/${mode}/${grid}/${renderer}/`; }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writeJson(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }

async function waitForHttp(url, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Studio exited before readiness.");
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Studio did not become ready.");
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
  return port || freePort();
}
