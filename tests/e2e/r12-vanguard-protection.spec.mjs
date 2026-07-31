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
const sourceKinds = ["tower", "ability", "tower_script", "status", "reaction", "enemy"];
const playerMatrix = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
));

test.describe("R12.4 vanguard protection browser acceptance", () => {
  let tempRoot;
  let studioProjectDir;
  let studioProcess;
  let studioUrl;
  let server;
  let playerPort;
  let studioOutput;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r12-vanguard-browser-"));
    studioProjectDir = createProject({
      name: "r12_vanguard_studio",
      parentDir: tempRoot,
      templateName: "classic",
      gridKind: "square"
    }).projectDir;
    installPrerequisites(studioProjectDir);

    for (const combination of playerMatrix) buildPlayerFixture(tempRoot, { mode: "active", ...combination });
    buildPlayerFixture(tempRoot, { mode: "absent", grid: "hex", renderer: "canvas" });
    buildPlayerFixture(tempRoot, { mode: "disabled", grid: "square", renderer: "phaser" });

    playerPort = await freePort();
    server = http.createServer((request, response) => servePlayer(request, response, tempRoot, playerPort));
    await new Promise((resolve, reject) => server.listen(
      playerPort,
      "127.0.0.1",
      (error) => error ? reject(error) : resolve()
    ));

    const studioPort = await freePort();
    studioUrl = `http://127.0.0.1:${studioPort}`;
    studioOutput = "";
    studioProcess = spawn(process.execPath, [
      path.join(repoRoot, "packages", "studio", "server.mjs"),
      "--project", studioProjectDir
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
    if (server) await new Promise((resolve) => server.close(resolve));
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("Studio enables, edits, previews, saves, reloads, disables, and re-enables a protected cohort", async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    await openStudio(page, studioUrl);
    await openMechanicsModule(page, "enemyBehaviors", "#mechanics-enemy-behaviors-editor");

    const recipe = page.locator('#mechanics-recipe-select option[value="basic_vanguard_protection"]');
    await expect(recipe).toHaveText("Basic Vanguard Protection");
    await page.locator("#mechanics-recipe-select").selectOption("basic_vanguard_protection");
    expect(readPrerequisiteState(studioProjectDir)).toEqual({
      navigation: { selectedProfileId: "browser_flow", enabled: true, mode: "dynamic_flow" },
      combat: { selectedProfileId: "browser_shields", enabled: true, shieldedEnemyCount: 1 }
    });
    await expect(page.locator("#mechanics-reaction-prerequisites")).toBeHidden();
    await page.locator("#btn-mechanics-new-profile").click();
    await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_vanguard_protection");

    await page.locator("#btn-mechanics-preview").click();
    await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readProtectionState(studioProjectDir)).toMatchObject({
      enabled: true,
      selectedProfileId: "basic_vanguard_protection",
      protection: { radius: 2, sourceKinds }
    });

    const formations = page.locator("#mechanics-enemy-formations-profile-json");
    const edited = JSON.parse(await formations.inputValue());
    edited.cohorts.main.protection.radius = 3;
    await formations.fill(JSON.stringify(edited, null, 2));
    await formations.blur();
    await page.locator("#btn-mechanics-preview").click();
    await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
    await page.locator("#btn-mechanics-save").click();
    await expect.poll(() => readProtectionState(studioProjectDir).protection.radius).toBe(3);

    await page.reload();
    await openMechanicsModule(page, "enemyBehaviors", "#mechanics-enemy-behaviors-editor");
    await expect(page.locator("#mechanics-enemy-formations-profile-json")).toHaveValue(/"radius": 3/);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-mechanics-disable").click();
    await expect.poll(() => readProtectionState(studioProjectDir).enabled).toBe(false);
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readProtectionState(studioProjectDir)).toMatchObject({
      enabled: true,
      protection: { radius: 3, sourceKinds }
    });
    expect(browserErrors()).toEqual([]);
  });

  test("Canvas and Phaser on hex and square expose the shared authoritative protection presentation", async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    for (const { grid, renderer } of playerMatrix) {
      await page.goto(playerUrl(playerPort, "active", grid, renderer));
      await waitForPlayerBoot(page);
      const actual = await page.evaluate(async () => {
        const snapshot = window.__towerforgeInspect();
        const { projectVanguardProtectionPresentation } = await import("./renderer/vanguard-protection-presentation.mjs");
        return {
          authoritative: snapshot.enemyBehaviors?.formations?.protection,
          projected: projectVanguardProtectionPresentation(snapshot),
          text: JSON.parse(window.render_game_to_text()).vanguardProtection
        };
      });
      expect(actual.authoritative, `${grid}/${renderer} authoritative snapshot`).toMatchObject({
        schemaVersion: 1,
        cohorts: { browser_line: { radius: 2, sourceKinds } }
      });
      expect(actual.projected, `${grid}/${renderer} shared renderer projection`).toMatchObject({
        active: true,
        cohorts: [{ cohortId: "browser_line", radius: 2, sourceKinds }]
      });
      expect(actual.text, `${grid}/${renderer} headless presentation`).toEqual(actual.projected);
    }
    expect(browserErrors()).toEqual([]);
  });

  test("absent and disabled projects keep the legacy player free of protection snapshots and work", async ({ page }) => {
    const browserErrors = captureBrowserErrors(page);
    for (const [mode, grid, renderer] of [
      ["absent", "hex", "canvas"],
      ["disabled", "square", "phaser"]
    ]) {
      await page.goto(playerUrl(playerPort, mode, grid, renderer));
      await waitForPlayerBoot(page);
      const actual = await page.evaluate(async () => {
        const snapshot = window.__towerforgeInspect();
        const { projectVanguardProtectionPresentation } = await import("./renderer/vanguard-protection-presentation.mjs");
        return {
          enemyBehaviors: snapshot.enemyBehaviors,
          projected: projectVanguardProtectionPresentation(snapshot),
          text: JSON.parse(window.render_game_to_text()).vanguardProtection
        };
      });
      expect(actual.enemyBehaviors?.formations?.protection).toBeUndefined();
      expect(actual.projected).toEqual({ active: false, cohorts: [], cues: [] });
      expect(actual.text).toBeUndefined();
    }
    expect(browserErrors()).toEqual([]);
  });
});

function installPrerequisites(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const enemyIds = Object.keys(balance.enemies).sort();
  const shieldedEnemyId = enemyIds[0];
  balance.missions[missionId].mechanics = {
    profiles: { navigation: "browser_flow", combat: "browser_shields" }
  };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      navigation: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          browser_flow: {
            mode: "dynamic_flow",
            defaultMovementProfileId: "ground",
            movementProfiles: {
              ground: {
                label: "Ground",
                terrainMode: "respect_walkable",
                towerOccupancy: "blocked",
                defaultTerrainCost: 1000
              }
            }
          }
        }
      },
      combat: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          browser_shields: { shields: { enemies: { [shieldedEnemyId]: { capacity: 50 } } } }
        }
      }
    }
  });
}

function installPlayerProtection(projectDir, enabled) {
  installPrerequisites(projectDir);
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const enemyIds = Object.keys(balance.enemies).sort();
  balance.missions[missionId].mechanics.profiles.enemyBehaviors = "browser_protection";
  writeJson(balancePath, balance);
  const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
  const mechanics = readJson(mechanicsPath);
  mechanics.modules.enemyBehaviors = {
    schemaVersion: 1,
    enabled,
    profiles: {
      browser_protection: {
        formations: {
          cohorts: {
            browser_line: {
              members: {
                [enemyIds[0]]: "vanguard",
                [enemyIds[1]]: "body",
                [enemyIds[2]]: "support"
              },
              steering: {
                neighborRadius: 2,
                cohesionWeight: 600,
                separationWeight: 800,
                roleWeight: 400
              },
              protection: { radius: 2, sourceKinds }
            }
          }
        }
      }
    }
  };
  writeJson(mechanicsPath, mechanics);
}

function buildPlayerFixture(root, { mode, grid, renderer }) {
  const name = fixtureName(mode, grid, renderer);
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  if (mode !== "absent") installPlayerProtection(projectDir, mode === "active");
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets.r12 = { ...targets.targets[targets.defaults.web], id: "r12", renderer, webDir: "dist" };
  writeJson(targetsPath, targets);
  execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--target", "r12"
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

async function openMechanicsModule(page, moduleId, editorSelector) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
  const module = page.locator(`#mechanics-module-grid [data-mechanics-module="${moduleId}"]`);
  await expect(module).toBeEnabled();
  if (!await module.evaluate((element) => element.classList.contains("selected"))) await module.click();
  await expect(page.locator(editorSelector)).toBeVisible();
  await expect(page.locator("#mechanics-enemy-formation-protection-editor")).toBeVisible();
}

async function waitForPlayerBoot(page) {
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  await expect(page.locator("#boot-error")).toBeHidden();
  const story = page.locator("#story-overlay");
  if (await story.isVisible()) await page.locator("#story-skip").click();
}

function readProtectionState(projectDir) {
  const balance = readJson(path.join(projectDir, "content", "balance.json"));
  const mechanics = readJson(path.join(projectDir, "content", "mechanics.json"));
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const module = mechanics.modules.enemyBehaviors;
  const selectedProfileId = balance.missions[missionId].mechanics?.profiles?.enemyBehaviors;
  const cohort = module?.profiles?.[selectedProfileId]?.formations?.cohorts?.main;
  return { enabled: module?.enabled, selectedProfileId, protection: cohort?.protection };
}

function readPrerequisiteState(projectDir) {
  const balance = readJson(path.join(projectDir, "content", "balance.json"));
  const mechanics = readJson(path.join(projectDir, "content", "mechanics.json"));
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const profiles = balance.missions[missionId].mechanics.profiles;
  const navigation = mechanics.modules.navigation;
  const combat = mechanics.modules.combat;
  return {
    navigation: {
      selectedProfileId: profiles.navigation,
      enabled: navigation.enabled,
      mode: navigation.profiles[profiles.navigation].mode
    },
    combat: {
      selectedProfileId: profiles.combat,
      enabled: combat.enabled,
      shieldedEnemyCount: Object.keys(combat.profiles[profiles.combat].shields.enemies).length
    }
  };
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

function servePlayer(request, response, root, port) {
  const parts = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname)
    .replace(/^\/+/, "").split("/");
  const [mode, grid, renderer, ...tail] = parts;
  if (!['active', 'absent', 'disabled'].includes(mode)
    || !["hex", "square"].includes(grid)
    || !["canvas", "phaser"].includes(renderer)) return respond404(response);
  const fixtureRoot = path.join(root, `${fixtureName(mode, grid, renderer)}.tdproj`, "dist");
  const filePath = path.resolve(fixtureRoot, tail.join("/") || "index.html");
  const relative = path.relative(fixtureRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)
    || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return respond404(response);
  const types = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml"
  };
  response.writeHead(200, {
    "Content-Type": types[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(response);
}

function fixtureName(mode, grid, renderer) { return `r12_vanguard_${mode}_${grid}_${renderer}`; }
function playerUrl(port, mode, grid, renderer) { return `http://127.0.0.1:${port}/${mode}/${grid}/${renderer}/`; }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function respond404(response) {
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("Not found");
}

async function waitForHttp(url, child, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Studio exited before readiness.\n${output()}`);
    }
    try { if ((await fetch(url)).ok) return; } catch { /* Studio is still starting. */ }
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
