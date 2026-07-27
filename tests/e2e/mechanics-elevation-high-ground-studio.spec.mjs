import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { readRawProjectFiles } from "../../packages/cli/lib/project-loader.mjs";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../../packages/cli/lib/project-migrations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let tempRoot;
let projectDir;
let studioProcess;
let studioUrl;
let serverOutput = "";

test.beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-high-ground-studio-"));
  projectDir = path.join(tempRoot, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migrated.files);

  const manifestPath = path.join(projectDir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.missions.tutorial_01.mechanics = { profiles: { elevation: "combined" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      elevation: {
        schemaVersion: 2,
        enabled: true,
        profiles: {
          combined: { lineOfSight: { terrainBlockerTags: [] } }
        }
      }
    }
  });

  const port = await freePort();
  studioUrl = `http://127.0.0.1:${port}`;
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
  await waitForHttp(`${studioUrl}/api/project`, studioProcess);
});

test.afterAll(async () => {
  await stopProcess(studioProcess);
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("upgrades, reloads, and removes high-ground without losing LoS or downgrading v3", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(studioUrl);

  const highGroundIds = [
    "mechanics-elevation-high-ground-enabled",
    "mechanics-elevation-high-ground-max-delta",
    "mechanics-elevation-high-ground-range-bonus",
    "mechanics-elevation-high-ground-damage-bps"
  ];
  for (const panel of ["#tab-enemies", "#tab-towers", "#tab-missions", "#tab-maps", "#tab-scripts"]) {
    for (const id of highGroundIds) await expect(page.locator(panel).locator(`#${id}`)).toHaveCount(0);
  }

  await openElevationMechanics(page);
  await expect(page.locator('#mechanics-recipe-select option[value="basic_elevation_high_ground"]'))
    .toHaveText("Basic Elevation High Ground");
  await expect(page.locator("#mechanics-elevation-los-enabled")).toBeChecked();
  await expect(page.locator("#mechanics-elevation-high-ground-enabled")).not.toBeChecked();
  await expect(page.locator("#mechanics-elevation-high-ground-max-delta")).toHaveAttribute("min", "1");
  await expect(page.locator("#mechanics-elevation-high-ground-max-delta")).toHaveAttribute("max", "64");
  await expect(page.locator("#mechanics-elevation-high-ground-range-bonus")).toHaveAttribute("max", "16");
  await expect(page.locator("#mechanics-elevation-high-ground-damage-bps")).toHaveAttribute("max", "10000");

  await page.locator("#mechanics-elevation-high-ground-enabled").check();
  await page.locator("#mechanics-elevation-high-ground-max-delta").fill("3");
  await page.locator("#mechanics-elevation-high-ground-range-bonus").fill("1");
  await page.locator("#mechanics-elevation-high-ground-damage-bps").fill("1000");
  await page.locator("#btn-mechanics-save").click();

  await expect.poll(() => readState(projectDir)).toEqual({
    schemaVersion: 3,
    profile: {
      lineOfSight: { terrainBlockerTags: [] },
      highGround: {
        maximumEffectiveElevationDelta: 3,
        rangeBonusPerElevation: 1,
        damageBonusBasisPointsPerElevation: 1_000
      }
    }
  });

  await page.reload();
  await openElevationMechanics(page);
  await expect(page.locator("#mechanics-elevation-los-enabled")).toBeChecked();
  await expect(page.locator("#mechanics-elevation-high-ground-enabled")).toBeChecked();
  await expect(page.locator("#mechanics-elevation-high-ground-max-delta")).toHaveValue("3");
  await expect(page.locator("#mechanics-elevation-high-ground-range-bonus")).toHaveValue("1");
  await expect(page.locator("#mechanics-elevation-high-ground-damage-bps")).toHaveValue("1000");

  await page.locator("#mechanics-elevation-high-ground-enabled").uncheck();
  await page.locator("#btn-mechanics-save").click();
  await expect.poll(() => readState(projectDir)).toEqual({
    schemaVersion: 3,
    profile: { lineOfSight: { terrainBlockerTags: [] } }
  });

  await page.reload();
  await openElevationMechanics(page);
  await expect(page.locator("#mechanics-elevation-los-enabled")).toBeChecked();
  await expect(page.locator("#mechanics-elevation-high-ground-enabled")).not.toBeChecked();
  await expect(page.locator("#mechanics-hub-state")).toHaveText("Elevation active for mission");

  const unexpectedPageErrors = pageErrors.filter((message) => !(
    message.includes("document is sandboxed") && message.includes("allow-same-origin")
  ));
  expect(unexpectedPageErrors).toEqual([]);
});

async function openElevationMechanics(page) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
  const elevation = page.locator('#mechanics-module-grid [data-mechanics-module="elevation"]');
  await expect(elevation).toBeEnabled();
  if (!await elevation.evaluate((element) => element.classList.contains("selected"))) await elevation.click();
  await expect(page.locator("#mechanics-elevation-editor")).toBeVisible();
}

function readState(root) {
  const mechanics = JSON.parse(fs.readFileSync(path.join(root, "content", "mechanics.json"), "utf8"));
  return {
    schemaVersion: mechanics.modules.elevation.schemaVersion,
    profile: mechanics.modules.elevation.profiles.combined
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

async function waitForHttp(url, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Studio exited before readiness.\n${serverOutput}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Studio is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.\n${serverOutput}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
