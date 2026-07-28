import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { readRawProjectFiles } from "../../packages/cli/lib/project-loader.mjs";
import {
  migrateProjectFiles,
  writeMigratedProjectFiles
} from "../../packages/cli/lib/project-migrations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.describe("R7/R8 Mechanics Hub browser acceptance", () => {
  let tempRoot;
  let projectDir;
  let studioProcess;
  let studioUrl;
  let serverOutput;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r7-r8-studio-"));
    projectDir = path.join(tempRoot, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
    writeMigratedProjectFiles(projectDir, migrated.files);

    const port = await freePort();
    studioUrl = `http://127.0.0.1:${port}`;
    serverOutput = "";
    studioProcess = spawn(process.execPath, [
      path.join(repoRoot, "packages", "studio", "server.mjs"),
      "--project", projectDir
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

  test("R7 Director previews, enables, edits, reloads, disables, and re-enables without touching legacy before apply", async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    await openStudio(page, studioUrl);
    await openMechanicsModule(page, "director", "#mechanics-director-editor");

    await expect(page.locator('#mechanics-recipe-select option[value="basic_adaptive_wave_director"]'))
      .toHaveText("Basic Adaptive Wave Director");
    await page.locator("#mechanics-recipe-select").selectOption("basic_adaptive_wave_director");
    const beforeMaterialize = authoringBytes(projectDir);
    await page.locator("#btn-mechanics-new-profile").click();
    await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_adaptive_wave_director");
    await page.locator("#mechanics-director-threat-base").fill("14");
    await page.locator("#mechanics-director-threat-per-wave").fill("6");

    await page.locator("#btn-mechanics-preview").click();
    await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
    expect(authoringBytes(projectDir)).toEqual(beforeMaterialize);

    await page.locator("#btn-mechanics-enable").click();
    await waitForMechanicsApply(projectDir, studioProcess, () => serverOutput);
    await expect.poll(() => readMechanicsState(projectDir, "director")).toMatchObject({
      projectSchemaVersion: 3,
      moduleSchemaVersion: 1,
      enabled: true,
      selectedProfileId: "basic_adaptive_wave_director",
      profile: { threatBudget: { base: 14, perWave: 6 } }
    });

    await page.reload();
    await openMechanicsModule(page, "director", "#mechanics-director-editor");
    await expect(page.locator("#mechanics-director-threat-base")).toHaveValue("14");
    await page.locator("#mechanics-director-max-added-enemies").fill("7");
    await page.locator("#btn-mechanics-save").click();
    await expect.poll(() => readMechanicsState(projectDir, "director").profile.fairness.maxAddedEnemies)
      .toBe(7);

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-mechanics-disable").click();
    await expect.poll(() => readMechanicsState(projectDir, "director")).toMatchObject({
      enabled: false,
      selectedProfileId: "basic_adaptive_wave_director",
      profile: { threatBudget: { base: 14, perWave: 6 }, fairness: { maxAddedEnemies: 7 } }
    });
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readMechanicsState(projectDir, "director")).toMatchObject({
      enabled: true,
      selectedProfileId: "basic_adaptive_wave_director",
      profile: { threatBudget: { base: 14, perWave: 6 }, fairness: { maxAddedEnemies: 7 } }
    });
    expect(browserErrors()).toEqual([]);
  });

  test("R8 Multiplayer preserves local co-op while upgrading the module to an asymmetric v2 profile", async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    await openStudio(page, studioUrl);
    await openMechanicsModule(page, "multiplayer", "#mechanics-multiplayer-editor");

    await page.locator("#mechanics-recipe-select").selectOption("basic_local_coop");
    await page.locator("#btn-mechanics-new-profile").click();
    await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_local_coop");
    await page.locator("#mechanics-multiplayer-max-players").fill("3");
    await page.locator("#mechanics-multiplayer-resource-ownership").selectOption("partitioned");
    await page.locator("#btn-mechanics-enable").click();
    await waitForMechanicsApply(projectDir, studioProcess, () => serverOutput);
    await expect.poll(() => readMechanicsState(projectDir, "multiplayer")).toMatchObject({
      projectSchemaVersion: 3,
      moduleSchemaVersion: 1,
      enabled: true,
      selectedProfileId: "basic_local_coop",
      profile: {
        mode: "local_coop",
        maxPlayers: 3,
        ownership: { resources: "partitioned", routes: "shared" }
      }
    });

    await page.reload();
    await openMechanicsModule(page, "multiplayer", "#mechanics-multiplayer-editor");
    await expect(page.locator("#mechanics-multiplayer-max-players")).toHaveValue("3");
    await expect(page.locator("#mechanics-multiplayer-resource-ownership")).toHaveValue("partitioned");

    await page.locator("#mechanics-recipe-select").selectOption("basic_asymmetric_send_vs_build");
    await page.locator("#btn-mechanics-new-profile").click();
    await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_asymmetric_send_vs_build");
    await expect(page.locator("#mechanics-multiplayer-mode")).toHaveValue("asymmetric_send_vs_build");
    await expect(page.locator("#mechanics-multiplayer-max-players")).toBeDisabled();
    await expect(page.locator("#mechanics-multiplayer-resource-ownership")).toHaveValue("partitioned");
    await expect(page.locator("#mechanics-multiplayer-route-ownership")).toHaveValue("partitioned");
    await page.locator("#btn-mechanics-save").click();

    await expect.poll(() => readMultiplayerUpgradeState(projectDir)).toMatchObject({
      moduleSchemaVersion: 2,
      enabled: true,
      selectedProfileId: "basic_asymmetric_send_vs_build",
      local: { mode: "local_coop", maxPlayers: 3, ownership: { resources: "partitioned" } },
      asymmetric: {
        mode: "asymmetric_send_vs_build",
        maxPlayers: 2,
        ownership: { resources: "partitioned", routes: "partitioned" }
      }
    });

    await page.reload();
    await openMechanicsModule(page, "multiplayer", "#mechanics-multiplayer-editor");
    await expect(page.locator("#mechanics-multiplayer-mode")).toHaveValue("asymmetric_send_vs_build");
    await expect(page.locator("#mechanics-multiplayer-send-pool")).toHaveValue(/basic_send/);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-mechanics-disable").click();
    await expect.poll(() => readMultiplayerUpgradeState(projectDir)).toMatchObject({
      moduleSchemaVersion: 2,
      enabled: false,
      local: { mode: "local_coop", maxPlayers: 3 },
      asymmetric: { mode: "asymmetric_send_vs_build", maxPlayers: 2 }
    });
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readMultiplayerUpgradeState(projectDir)).toMatchObject({
      moduleSchemaVersion: 2,
      enabled: true,
      selectedProfileId: "basic_asymmetric_send_vs_build",
      local: { mode: "local_coop", maxPlayers: 3 },
      asymmetric: { mode: "asymmetric_send_vs_build", maxPlayers: 2 }
    });
    expect(browserErrors()).toEqual([]);
  });
});

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
}

function authoringBytes(root) {
  const mechanicsPath = path.join(root, "content", "mechanics.json");
  return {
    project: fs.readFileSync(path.join(root, "project.json"), "utf8"),
    balance: fs.readFileSync(path.join(root, "content", "balance.json"), "utf8"),
    mechanics: fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "utf8") : null
  };
}

function readMechanicsState(root, moduleId) {
  const manifest = readJson(path.join(root, "project.json"));
  const balance = readJson(path.join(root, "content", "balance.json"));
  const mechanics = readJson(path.join(root, "content", "mechanics.json"));
  const missionId = balance.defaultMissionId ?? manifest.defaultMissionId;
  const module = mechanics.modules[moduleId];
  const selectedProfileId = balance.missions[missionId].mechanics?.profiles?.[moduleId];
  return {
    projectSchemaVersion: manifest.schemaVersion,
    moduleSchemaVersion: module.schemaVersion,
    enabled: module.enabled,
    selectedProfileId,
    profile: module.profiles[selectedProfileId]
  };
}

function readMultiplayerUpgradeState(root) {
  const state = readMechanicsState(root, "multiplayer");
  const mechanics = readJson(path.join(root, "content", "mechanics.json"));
  const profiles = mechanics.modules.multiplayer.profiles;
  return {
    ...state,
    local: profiles.basic_local_coop,
    asymmetric: profiles.basic_asymmetric_send_vs_build
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port || [5184, 5193].includes(port)) return freePort();
  return port;
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
  throw new Error(`Timed out waiting for ${url}.\n${output()}`);
}

async function waitForMechanicsApply(root, child, output) {
  const mechanicsPath = path.join(root, "content", "mechanics.json");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(mechanicsPath)) return;
    if (child.exitCode !== null || child.signalCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Multiplayer apply did not finish. Studio output:\n${output()}`);
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
