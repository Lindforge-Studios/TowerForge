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

test.describe.serial("R5.8A Studio local ammunition lifecycle", () => {
  let tempRoot;
  let projectDir;
  let studioProcess;
  let studioUrl;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-ammunition-studio-"));
    projectDir = path.join(tempRoot, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
    writeMigratedProjectFiles(projectDir, migrated.files);
    installLogistics(projectDir, { version: 1, ammunition: undefined });
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

  test("opens v1 without migration, explicitly promotes, CRUDs, reloads, disables, re-enables, and saves null", async ({ page }) => {
    test.setTimeout(120_000);
    const beforeRead = authoringBytes(projectDir);
    await openStudio(page, studioUrl);
    await openLogistics(page);
    expect(authoringBytes(projectDir)).toEqual(beforeRead);
    await expect(page.locator("#btn-mechanics-add-ammunition")).toBeVisible();
    await page.locator("#btn-mechanics-add-ammunition").click();
    expect(readLogistics(projectDir).module.schemaVersion).toBe(1);
    await expect(page.locator("#mechanics-logistics-ammunition-enabled")).toBeChecked();

    await page.locator("#btn-mechanics-add-ammunition-type").click();
    const typeRow = page.locator("#mechanics-logistics-ammunition-type-rows").first();
    await typeRow.locator("[data-logistics-ammo-type-id]").fill("shell");
    await typeRow.locator("[data-logistics-ammo-label]").fill("Shell");
    await page.locator("#btn-mechanics-add-tower-inventory").click();
    const inventoryRow = page.locator("#mechanics-logistics-tower-inventory-rows").first();
    await inventoryRow.locator("[data-logistics-inventory-tower-type-id]").fill("cannon_tower");
    await inventoryRow.locator("[data-logistics-inventory-ammo-type-id]").fill("shell");
    await inventoryRow.locator("[data-logistics-inventory-capacity]").fill("30");
    await inventoryRow.locator("[data-logistics-inventory-starting-amount]").fill("12");
    await inventoryRow.locator("[data-logistics-inventory-consumption]").fill("1");
    await page.locator("#btn-mechanics-save").click();
    await expect.poll(() => readLogistics(projectDir)).toMatchObject({
      module: { schemaVersion: 2, enabled: true },
      profile: {
        power: null,
        ammunition: {
          types: { shell: { label: "Shell" } },
          towerInventories: {
            cannon_tower: {
              ammoTypeId: "shell", capacity: 30, startingAmount: 12, consumptionPerActivation: 1
            }
          }
        }
      }
    });

    await page.reload();
    await openLogistics(page);
    await expect(page.locator("[data-logistics-ammo-label]").first()).toHaveValue("Shell");
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-mechanics-disable").click();
    await expect.poll(() => readLogistics(projectDir).module.enabled).toBe(false);
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readLogistics(projectDir).module.enabled).toBe(true);
    await page.locator("#mechanics-logistics-ammunition-enabled").uncheck();
    await page.locator("#btn-mechanics-save").click();
    await expect.poll(() => readLogistics(projectDir).profile).toEqual({ power: null, ammunition: null });
  });

  test("keeps future v3 byte-identical and disables every Mechanics write control", async ({ page }) => {
    installLogistics(projectDir, { version: 3, ammunition: null, future: { factories: ["opaque"] } });
    const before = authoringBytes(projectDir);
    await openStudio(page, studioUrl);
    await openLogistics(page);
    await expect(page.locator("#mechanics-logistics-read-only")).toContainText(/future|schemaVersion 3|read-only/i);
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

test.describe("R5.8A generated local ammunition presentation", () => {
  let tempRoot;
  let server;
  let port;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-ammunition-player-"));
    for (const combination of combinations) buildFixture(tempRoot, { mode: "active", ...combination });
    buildFixture(tempRoot, { mode: "combined", grid: "square", renderer: "canvas" });
    buildFixture(tempRoot, { mode: "absent", grid: "hex", renderer: "canvas" });
    buildFixture(tempRoot, { mode: "v1", grid: "square", renderer: "phaser" });
    buildFixture(tempRoot, { mode: "null", grid: "hex", renderer: "phaser" });
    port = await freePort();
    server = http.createServer((request, response) => serveFixture(request, response, tempRoot, port));
    await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("shows authoritative amount/capacity and depleted cues on Canvas/Phaser and hex/square", async ({ page }) => {
    test.setTimeout(180_000);
    for (const { grid, renderer } of combinations) {
      await page.goto(playerUrl(port, "active", grid, renderer));
      await boot(page);
      await placeTower(page, "cannon_tower");
      await page.locator("#start-wave").click();
      const panel = page.locator("#logistics-status");
      await expect(panel).toBeVisible();
      await expect(panel.locator(".logistics-ammunition-cue")).toContainText(/tower_1[\s\S]*\d+\/1/i);
      await expect(panel.locator(".logistics-depleted-cue")).toContainText(/tower_1|depleted/i, { timeout: 30_000 });
      await expect(panel).toContainText(/0\/1/);
      await expect(panel.locator("button, input, select, textarea")).toHaveCount(0);
    }
  });

  test("shows power brownout and ammunition independently for the same tower", async ({ page }) => {
    await page.goto(playerUrl(port, "combined", "square", "canvas"));
    await boot(page);
    await placeTower(page, "cannon_tower");
    const panel = page.locator("#logistics-status");
    await expect(panel).toContainText(/brownout.*tower_1/i);
    await expect(panel.locator(".logistics-ammunition-cue")).toContainText(/1\/1/);
    await expect(panel.locator(".logistics-depleted-cue")).toHaveCount(0);
  });

  test("keeps absent, v1 power:null, and v2 both-null projects hidden", async ({ page }) => {
    for (const fixture of [
      ["absent", "hex", "canvas"], ["v1", "square", "phaser"], ["null", "hex", "phaser"]
    ]) {
      await page.goto(playerUrl(port, ...fixture));
      await boot(page);
      expect((await page.evaluate(() => window.__towerforgeInspect())).logistics).toBeUndefined();
      await expect(page.locator("#logistics-status")).toBeHidden();
      await expect(page.locator("#logistics-status")).toBeEmpty();
    }
  });
});

function buildFixture(root, { mode, grid, renderer }) {
  const name = fixtureName(mode, grid, renderer);
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  if (mode !== "absent") installLogistics(projectDir, {
    version: mode === "v1" ? 1 : 2,
    ammunition: mode === "active" || mode === "combined" ? {
      types: { shell: { label: "Shell" } },
      towerInventories: {
        cannon_tower: { ammoTypeId: "shell", capacity: 1, startingAmount: 1, consumptionPerActivation: 1 }
      }
    } : null,
    power: mode === "combined" ? {
      generators: {}, relays: {}, consumers: { cannon_tower: { demand: 1, priority: 0 } }
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

function installLogistics(projectDir, { version, ammunition, power = null, future }) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { logistics: "local_ammunition" } };
  const sourceTower = balance.towers.cannon_tower
    ?? balance.towers.cannon
    ?? Object.values(balance.towers).find((tower) => [
      "single", "pulse", "sniper", "antiair", "splash", "pipeline"
    ].includes(tower?.attack?.kind));
  if (!sourceTower) throw new Error("Ammunition fixture needs one fire-capable tower.");
  const cannon = structuredClone(sourceTower);
  cannon.id = "cannon_tower";
  cannon.label = "Ammunition Cannon";
  cannon.cost = { coins: 1 };
  cannon.attack.fireRate = 20;
  balance.towers.cannon_tower = cannon;
  balance.missions[missionId].startingResources = { coins: 100 };
  balance.missions[missionId].buildTowerIds = ["cannon_tower"];
  writeJson(balancePath, balance);
  const profile = version === 1 ? { power } : { power, ammunition };
  if (future) Object.assign(profile, future);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: { logistics: { schemaVersion: version, enabled: true, profiles: { local_ammunition: profile } } }
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
  const coord = await page.evaluate(() => window.__towerforgeInspect().tiles.find((tile) => (
    tile.terrain === "buildable" && !tile.occupiedBy
  )));
  const point = await page.evaluate((tile) => window.__towerforgeTilePoint(tile), coord);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#stat-towers")).toHaveText("1");
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

function fixtureName(mode, grid, renderer) { return `ammo_${mode}_${grid}_${renderer}`; }
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
