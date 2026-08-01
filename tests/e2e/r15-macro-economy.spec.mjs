import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const playerMatrix = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
));
test.use({ hasTouch: true });

test.describe("R15 Macro-Economy browser acceptance", () => {
  let tempRoot;
  let studioProjectDir;
  let studioProcess;
  let studioUrl;
  let studioOutput;
  let playerServer;
  let playerPort;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r15-macro-browser-"));
    studioProjectDir = createProject({
      name: "r15_macro_studio", parentDir: tempRoot, templateName: "classic", gridKind: "square"
    }).projectDir;

    for (const combination of playerMatrix) buildPlayerFixture(tempRoot, { mode: "active", ...combination });
    buildPlayerFixture(tempRoot, { mode: "absent", grid: "hex", renderer: "canvas" });
    buildPlayerFixture(tempRoot, { mode: "disabled", grid: "square", renderer: "phaser" });

    playerPort = await freePort();
    playerServer = http.createServer((request, response) => servePlayer(request, response, tempRoot, playerPort));
    await new Promise((resolve, reject) => playerServer.listen(
      playerPort, "127.0.0.1", (error) => error ? reject(error) : resolve()
    ));

    const studioPort = await freePort();
    studioUrl = `http://127.0.0.1:${studioPort}`;
    studioOutput = "";
    studioProcess = spawn(process.execPath, [
      path.join(repoRoot, "packages", "studio", "server.mjs"), "--project", studioProjectDir
    ], {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(studioPort), TOWERFORGE_BUNDLED_RUNTIME: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const capture = (chunk) => { studioOutput = `${studioOutput}${chunk}`.slice(-20_000); };
    studioProcess.stdout.on("data", capture);
    studioProcess.stderr.on("data", capture);
    await waitForHttp(`${studioUrl}/api/project`, studioProcess, () => studioOutput);
  });

  test.afterAll(async () => {
    await stopProcess(studioProcess);
    if (playerServer) await new Promise((resolve) => playerServer.close(resolve));
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("Studio previews, enables, edits, reloads, disables, and re-enables Macro-Economy", async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    await openStudio(page, studioUrl);
    await openMacroEconomyMechanics(page);

    await expect(page.locator('#mechanics-recipe-select option[value="basic_local_market"]'))
      .toHaveText("Basic Local Market");
    await page.locator("#mechanics-recipe-select").selectOption("basic_local_market");
    await page.locator("#btn-mechanics-new-profile").click();
    await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_local_market");

    const editor = page.locator("#mechanics-macro-economy-json");
    const profile = JSON.parse(await editor.inputValue());
    profile.commodities.ore.trendPerWave = 0.25;
    profile.altars.exchange_altar.radius = 128;
    await editor.fill(JSON.stringify(profile, null, 2));
    await editor.blur();

    await page.locator("#btn-mechanics-preview").click();
    await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
    expect(fs.existsSync(path.join(studioProjectDir, "content", "mechanics.json"))).toBe(false);
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readMacroEconomyState(studioProjectDir)).toMatchObject({
      enabled: true,
      selectedProfileId: "basic_local_market",
      profile: { commodities: { ore: { trendPerWave: 0.25 } } }
    });

    profile.commodities.ore.trendPerWave = 0.5;
    await editor.fill(JSON.stringify(profile, null, 2));
    await editor.blur();
    await page.locator("#btn-mechanics-preview").click();
    await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
    await page.locator("#btn-mechanics-save").click();
    await expect.poll(() => readMacroEconomyState(studioProjectDir).profile.commodities.ore.trendPerWave).toBe(0.5);

    await page.reload();
    await openMacroEconomyMechanics(page);
    await expect(page.locator("#mechanics-macro-economy-json")).toHaveValue(/"trendPerWave": 0\.5/);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-mechanics-disable").click();
    await expect.poll(() => readMacroEconomyState(studioProjectDir).enabled).toBe(false);
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readMacroEconomyState(studioProjectDir)).toMatchObject({
      enabled: true,
      selectedProfileId: "basic_local_market",
      profile: { commodities: { ore: { trendPerWave: 0.5 } } }
    });
    expect(browserErrors()).toEqual([]);
  });

  test("Canvas and Phaser on hex and square execute authoritative trade, deposit, and ritual commands", async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    for (const [index, { grid, renderer }] of playerMatrix.entries()) {
      await page.goto(playerUrl(playerPort, "active", grid, renderer));
      await waitForPlayerBoot(page);
      const panel = page.locator("#macro-economy-status");
      await expect(panel, `${grid}/${renderer} panel`).toBeVisible();
      await expect(panel).toContainText("Macro-Economy");

      const buy = panel.getByRole("button", { name: "Buy Ore" });
      if (index === 1) { await buy.focus(); await page.keyboard.press("Enter"); }
      else if (index === 2) await buy.tap();
      else await buy.click();
      await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().macroEconomy.market.commodities[0].holding)).toBe(1);

      await panel.getByRole("button", { name: /Deposit 5 coins/ }).click();
      await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().macroEconomy.deposits.length)).toBe(1);

      const target = await page.evaluate(() => {
        const tile = window.__towerforgeInspect().tiles.find((item) => item.terrain === "buildable" && !item.occupiedBy);
        return { coord: { q: tile.q, r: tile.r }, ...window.__towerforgeTilePoint(tile) };
      });
      await page.mouse.click(target.x, target.y);
      await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().towers.length)).toBe(1);
      await expect(panel.getByRole("button", { name: "Perform Forge" })).toBeEnabled();
      await panel.getByRole("button", { name: "Perform Forge" }).click();
      const result = await page.evaluate(() => ({
        towers: window.__towerforgeInspect().towers.length,
        holding: window.__towerforgeInspect().macroEconomy.market.commodities[0].holding,
        ritualEvents: window.__towerforgeInspect().lastEvents.filter((event) => event.type === "ritualPerformed").length
      }));
      expect(result, `${grid}/${renderer}`).toEqual({ towers: 0, holding: 1, ritualEvents: 1 });
    }
    expect(browserErrors()).toEqual([]);
  });

  test("absent and disabled players keep the legacy bundle and snapshot free of Macro-Economy", async ({ page }) => {
    const browserErrors = captureBrowserErrors(page);
    for (const [mode, grid, renderer] of [
      ["absent", "hex", "canvas"], ["disabled", "square", "phaser"]
    ]) {
      await page.goto(playerUrl(playerPort, mode, grid, renderer));
      await waitForPlayerBoot(page);
      expect(await page.locator("#macro-economy-status").count(), `${mode}/${grid}/${renderer} panel`).toBe(0);
      expect(await page.evaluate(() => window.__towerforgeInspect().macroEconomy)).toBeUndefined();
    }
    expect(browserErrors()).toEqual([]);
  });
});

function installMacroEconomy(projectDir, enabled) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const towerTypeId = Object.keys(balance.towers).sort()[0];
  balance.missions[missionId].mechanics = { profiles: { macroEconomy: "browser_macro" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      macroEconomy: {
        schemaVersion: 1,
        enabled,
        profiles: {
          browser_macro: {
            quoteCurrencyId: "coins",
            commodities: {
              ore: { label: "Ore", basePrice: 1, minPrice: 1, maxPrice: 5, trendPerWave: 0, volatility: 0, demandElasticity: 0 }
            },
            deposits: {
              short: { label: "Short", currencyId: "coins", durationClearedWaves: 1, interestBasisPoints: 100, minAmount: 5, maxAmount: 5 }
            },
            altars: {
              forge: {
                label: "Forge", coord: { q: 0, r: 0 }, radius: 128, minTowers: 1, maxTowers: 1,
                towerTypeIds: [towerTypeId], effects: [{ kind: "grant_resource", resourceId: "coins", amount: 10 }]
              }
            }
          }
        }
      }
    }
  });
}

function buildPlayerFixture(root, { mode, grid, renderer }) {
  const name = fixtureName(mode, grid, renderer);
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  if (mode !== "absent") installMacroEconomy(projectDir, mode === "active");
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets.r15 = { ...targets.targets[targets.defaults.web], id: "r15", renderer, webDir: "dist" };
  writeJson(targetsPath, targets);
  execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", projectDir, "--target", "r15"
  ], { cwd: repoRoot, stdio: "ignore", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } });
}

async function openStudio(page, url) {
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(url);
  await expect(page).toHaveTitle(/TowerForge Editor/);
}

async function openMacroEconomyMechanics(page) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
  const module = page.locator('#mechanics-module-grid [data-mechanics-module="macroEconomy"]');
  await expect(module).toBeEnabled();
  if (!await module.evaluate((element) => element.classList.contains("selected"))) await module.click();
  await expect(page.locator("#mechanics-macro-economy-editor")).toBeVisible();
}

async function waitForPlayerBoot(page) {
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  await expect(page.locator("#boot-error")).toBeHidden();
  const story = page.locator("#story-overlay");
  if (await story.isVisible()) await page.locator("#story-skip").click();
}

function readMacroEconomyState(projectDir) {
  const balance = readJson(path.join(projectDir, "content", "balance.json"));
  const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
  if (!fs.existsSync(mechanicsPath)) return { enabled: null, selectedProfileId: null, profile: null };
  const mechanics = readJson(mechanicsPath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const selectedProfileId = balance.missions[missionId].mechanics?.profiles?.macroEconomy;
  return { enabled: mechanics.modules.macroEconomy.enabled, selectedProfileId, profile: mechanics.modules.macroEconomy.profiles[selectedProfileId] };
}

function captureBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  return () => errors.filter((message) => !(message.includes("document is sandboxed") && message.includes("allow-same-origin")));
}

function servePlayer(request, response, root, port) {
  const parts = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname).replace(/^\/+/, "").split("/");
  const [mode, grid, renderer, ...tail] = parts;
  if (!["active", "absent", "disabled"].includes(mode) || !["hex", "square"].includes(grid) || !["canvas", "phaser"].includes(renderer)) return respond404(response);
  const buildRoot = path.join(root, `${fixtureName(mode, grid, renderer)}.tdproj`, "dist");
  const filePath = path.resolve(buildRoot, tail.join("/") || "index.html");
  const relative = path.relative(buildRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return respond404(response);
  response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
  fs.createReadStream(filePath).pipe(response);
}

function contentType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml"
  })[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function fixtureName(mode, grid, renderer) { return `r15_macro_${mode}_${grid}_${renderer}`; }
function playerUrl(port, mode, grid, renderer) { return `http://127.0.0.1:${port}/${mode}/${grid}/${renderer}/`; }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writeJson(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function respond404(response) { response.writeHead(404, { "Content-Type": "text/plain" }); response.end("Not found"); }

async function waitForHttp(url, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Studio exited.\n${output()}`);
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.\n${output()}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port || freePort();
}
