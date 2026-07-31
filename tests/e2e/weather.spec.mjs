import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { createProject } from "../../packages/cli/lib/create-project.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const activeMatrix = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
));

test.describe("R13.5 Weather browser acceptance", () => {
  let tempRoot;
  let studioProjectDir;
  let studioProcess;
  let studioUrl;
  let studioOutput;
  let playerServer;
  let playerPort;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r13-weather-browser-"));
    studioProjectDir = createProject({
      name: "r13_weather_studio", parentDir: tempRoot, templateName: "classic", gridKind: "square"
    }).projectDir;

    for (const combination of activeMatrix) buildPlayerFixture(tempRoot, { mode: "active", ...combination });
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

  test("Studio enables, edits, previews, saves, reloads, disables, and re-enables Weather", async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    await openStudio(page, studioUrl);
    await openWeatherMechanics(page);

    await expect(page.locator('#mechanics-recipe-select option[value="basic_blizzard_weather"]'))
      .toHaveText("Basic Blizzard Weather");
    await page.locator("#mechanics-recipe-select").selectOption("basic_blizzard_weather");
    await page.locator("#btn-mechanics-new-profile").click();
    await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_blizzard_weather");

    const zones = { browser_field: { kind: "all_map" } };
    const definitions = {
      browser_blizzard: {
        label: "Browser blizzard",
        effects: {
          sight: { kind: "visibility_range", multiplier: 0.8 },
          slow: { kind: "enemy_speed", multiplier: 0.75 }
        }
      }
    };
    const schedule = {
      calmWeight: 0,
      choices: { always: { weatherId: "browser_blizzard", zoneId: "browser_field", weight: 1 } }
    };
    await page.locator("#mechanics-weather-zone-rows").fill(JSON.stringify(zones, null, 2));
    await page.locator("#mechanics-weather-definition-rows").fill(JSON.stringify(definitions, null, 2));
    await page.locator("#mechanics-weather-schedule-rows").fill(JSON.stringify(schedule, null, 2));

    await page.locator("#btn-mechanics-preview").click();
    await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
    expect(fs.existsSync(path.join(studioProjectDir, "content", "mechanics.json"))).toBe(false);
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readWeatherState(studioProjectDir)).toMatchObject({
      enabled: true,
      selectedProfileId: "basic_blizzard_weather",
      profile: { zones, definitions, schedule }
    });

    definitions.browser_blizzard.effects.slow.multiplier = 0.7;
    await page.locator("#mechanics-weather-definition-rows").fill(JSON.stringify(definitions, null, 2));
    await page.locator("#btn-mechanics-preview").click();
    await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
    await page.locator("#btn-mechanics-save").click();
    await expect.poll(() => readWeatherState(studioProjectDir).profile.definitions.browser_blizzard.effects.slow.multiplier)
      .toBe(0.7);

    await page.reload();
    await openWeatherMechanics(page);
    await expect(page.locator("#mechanics-weather-definition-rows")).toHaveValue(/"multiplier": 0\.7/);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-mechanics-disable").click();
    await expect.poll(() => readWeatherState(studioProjectDir)).toMatchObject({
      enabled: false, selectedProfileId: "basic_blizzard_weather"
    });
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readWeatherState(studioProjectDir)).toMatchObject({
      enabled: true,
      selectedProfileId: "basic_blizzard_weather",
      profile: { definitions }
    });
    expect(browserErrors()).toEqual([]);
  });

  test("generated Canvas and Phaser players project authoritative Weather on hex and square", async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    for (const { grid, renderer } of activeMatrix) {
      await page.goto(playerUrl(playerPort, "active", grid, renderer));
      await waitForPlayerBoot(page);
      const beforeTint = await weatherTintPixels(page, renderer);
      await page.locator("#start-wave").click();
      await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().weather?.active?.weatherId))
        .toBe("browser_blizzard");
      const actual = await page.evaluate(async () => {
        const snapshot = window.__towerforgeInspect();
        const { projectWeatherPresentation } = await import("./renderer/weather-presentation.mjs");
        return { authoritative: snapshot.weather, projected: projectWeatherPresentation(snapshot) };
      });
      expect(actual.authoritative, `${grid}/${renderer} authoritative`).toMatchObject({
        schemaVersion: 1,
        profileId: "browser_weather",
        active: {
          choiceId: "always", weatherId: "browser_blizzard", zoneId: "browser_field",
          zone: { kind: "all_map" }
        }
      });
      expect(actual.projected, `${grid}/${renderer} projection`).toMatchObject({
        active: true, profileId: "browser_weather", weatherId: "browser_blizzard",
        zoneId: "browser_field", zoneKind: "all_map"
      });
      await expect.poll(() => weatherTintPixels(page, renderer), {
        message: `${grid}/${renderer} did not display the active Weather projection`
      }).toBeGreaterThan(beforeTint + 40);
    }
    expect(browserErrors()).toEqual([]);
  });

  test("absent and disabled generated players preserve the legacy Weather-free path", async ({ page }) => {
    const browserErrors = captureBrowserErrors(page);
    for (const [mode, grid, renderer] of [
      ["absent", "hex", "canvas"], ["disabled", "square", "phaser"]
    ]) {
      await page.goto(playerUrl(playerPort, mode, grid, renderer));
      await waitForPlayerBoot(page);
      await page.locator("#start-wave").click();
      const actual = await page.evaluate(async () => {
        const snapshot = window.__towerforgeInspect();
        const { projectWeatherPresentation } = await import("./renderer/weather-presentation.mjs");
        return { weather: snapshot.weather, projected: projectWeatherPresentation(snapshot) };
      });
      expect(actual.weather, `${mode}/${grid}/${renderer}`).toBeUndefined();
      expect(actual.projected).toEqual({ active: false, zoneKind: null, tiles: [] });
    }
    expect(browserErrors()).toEqual([]);
  });
});

function installWeather(projectDir, enabled) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { weather: "browser_weather" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      weather: {
        schemaVersion: 1,
        enabled,
        profiles: {
          browser_weather: {
            zones: { browser_field: { kind: "all_map" } },
            definitions: {
              browser_blizzard: {
                label: "Browser blizzard",
                effects: { sight: { kind: "visibility_range", multiplier: 0.8 } }
              }
            },
            schedule: {
              calmWeight: 0,
              choices: { always: { weatherId: "browser_blizzard", zoneId: "browser_field", weight: 1 } }
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
  if (mode !== "absent") installWeather(projectDir, mode === "active");
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets.r13 = { ...targets.targets[targets.defaults.web], id: "r13", renderer, webDir: "dist" };
  writeJson(targetsPath, targets);
  execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"), "--project", projectDir, "--target", "r13"
  ], {
    cwd: repoRoot,
    stdio: "ignore",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
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

async function openWeatherMechanics(page) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
  const module = page.locator('#mechanics-module-grid [data-mechanics-module="weather"]');
  await expect(module).toBeEnabled();
  if (!await module.evaluate((element) => element.classList.contains("selected"))) await module.click();
  await expect(page.locator("#mechanics-weather-editor")).toBeVisible();
}

async function waitForPlayerBoot(page) {
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  await expect(page.locator("#boot-error")).toBeHidden();
  const story = page.locator("#story-overlay");
  if (await story.isVisible()) await page.locator("#story-skip").click();
}

async function weatherTintPixels(page, renderer) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const canvas = renderer === "phaser" ? page.locator("#playfield canvas") : page.locator("canvas#playfield");
  const png = PNG.sync.read(await canvas.screenshot());
  let count = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const red = png.data[index];
    const green = png.data[index + 1];
    const blue = png.data[index + 2];
    const alpha = png.data[index + 3];
    if (alpha > 64 && green > red + 10 && blue > red + 7) count += 1;
  }
  return count;
}

function readWeatherState(projectDir) {
  const balance = readJson(path.join(projectDir, "content", "balance.json"));
  const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
  if (!fs.existsSync(mechanicsPath)) {
    return { enabled: null, selectedProfileId: null, profile: null };
  }
  const mechanics = readJson(mechanicsPath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const selectedProfileId = balance.missions[missionId].mechanics?.profiles?.weather;
  return {
    enabled: mechanics.modules.weather.enabled,
    selectedProfileId,
    profile: mechanics.modules.weather.profiles[selectedProfileId]
  };
}

function captureBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  return () => errors.filter((message) => !(
    message.includes("document is sandboxed") && message.includes("allow-same-origin")
  ));
}

function servePlayer(request, response, root, port) {
  const parts = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname)
    .replace(/^\/+/, "").split("/");
  const [mode, grid, renderer, ...tail] = parts;
  if (!["active", "absent", "disabled"].includes(mode)
    || !["hex", "square"].includes(grid) || !["canvas", "phaser"].includes(renderer)) return respond404(response);
  const buildRoot = path.join(root, `${fixtureName(mode, grid, renderer)}.tdproj`, "dist");
  const filePath = path.resolve(buildRoot, tail.join("/") || "index.html");
  const relative = path.relative(buildRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)
    || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return respond404(response);
  response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
  fs.createReadStream(filePath).pipe(response);
}

function contentType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml"
  })[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function fixtureName(mode, grid, renderer) { return `r13_weather_${mode}_${grid}_${renderer}`; }
function playerUrl(port, mode, grid, renderer) { return `http://127.0.0.1:${port}/${mode}/${grid}/${renderer}/`; }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
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
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port || freePort();
}
