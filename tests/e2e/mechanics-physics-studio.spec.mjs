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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-physics-studio-"));
  projectDir = path.join(tempRoot, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migrated.files);

  // Keep one authored displacement effect in ordinary content while physics is inactive. The
  // Studio must preserve this raw row and only expose the typed editor after the mission opts in.
  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.towers.arrow_tower.attack = {
    kind: "pipeline",
    interval: 1,
    targeting: { classes: ["ground"], mode: "first", maxTargets: 1 },
    delivery: { kind: "single" },
    effects: [
      { kind: "damage", amount: 1 },
      { kind: "displacement", mode: "push", distance: 2, stopAtBlocker: true }
    ],
    upgradeCosts: []
  };
  fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");

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

test("authors, reloads, disables, and re-enables opt-in physics while gating displacement editors", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(studioUrl);
  await expect(page).toHaveTitle(/TowerForge Editor/);

  // Inactive physics keeps the standard tower editor and raw effect bytes, but adds no typed row.
  await openPipelineTower(page);
  await expect(page.locator("#af-pipeline-effects")).toContainText('"kind": "displacement"');
  await expect(page.locator('[data-displacement-editor][data-displacement-scope="pipeline"]')).toHaveCount(0);

  await openPhysicsMechanics(page);
  await expect(page.locator('#mechanics-recipe-select option[value="basic_displacement_physics"]'))
    .toHaveText("Basic Displacement Physics");
  await page.locator("#mechanics-recipe-select").selectOption("basic_displacement_physics");
  await page.locator("#btn-mechanics-new-profile").click();
  await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_displacement_physics");

  await page.locator("#mechanics-physics-displacement-immunity").fill("basic_grunt\nswift_runner");
  await page.locator("#mechanics-physics-fall-immunity").fill("armored_brute");
  await page.locator("#mechanics-physics-hazard-tags").fill("blocked");
  await page.locator("#btn-mechanics-preview").click();
  await expect(page.locator("#mechanics-preview-result")).toContainText('"physics"');
  await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
  expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(false);

  await page.locator("#btn-mechanics-enable").click();
  await expect(page.locator("#mechanics-hub-state")).toHaveText("Physics active for mission");
  await expect.poll(() => readAuthoredState(projectDir)).toEqual({
    projectSchemaVersion: 3,
    moduleSchemaVersion: 1,
    enabled: true,
    selectedProfileId: "basic_displacement_physics",
    profile: {
      displacementImmuneEnemyTypeIds: ["basic_grunt", "swift_runner"],
      fallImmuneEnemyTypeIds: ["armored_brute"],
      fallHazardTerrainTags: ["blocked"]
    },
    displacementEffect: { kind: "displacement", mode: "push", distance: 2, stopAtBlocker: true }
  });

  // Active selection reveals a typed editor over the preserved pipeline effect.
  await openPipelineTower(page);
  const displacementEditor = page.locator('[data-displacement-editor][data-displacement-scope="pipeline"]');
  await expect(displacementEditor).toBeVisible();
  await expect(displacementEditor.locator('[data-displacement-field="mode"]')).toHaveValue("push");
  await expect(displacementEditor.locator('[data-displacement-field="distance"]')).toHaveValue("2");
  await expect(displacementEditor.locator('[data-displacement-field="stopAtBlocker"]')).toBeChecked();

  await page.reload();
  await openPhysicsMechanics(page);
  await expect(page.locator("#mechanics-physics-displacement-immunity")).toHaveValue("basic_grunt\nswift_runner");
  await expect(page.locator("#mechanics-physics-fall-immunity")).toHaveValue("armored_brute");
  await expect(page.locator("#mechanics-physics-hazard-tags")).toHaveValue("blocked");

  // Saving an edited list uses the same guarded transaction and retains sibling lists/effects.
  await page.locator("#mechanics-physics-hazard-tags").fill("blocked\nwater");
  await page.locator("#btn-mechanics-save").click();
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    enabled: true,
    selectedProfileId: "basic_displacement_physics",
    profile: {
      displacementImmuneEnemyTypeIds: ["basic_grunt", "swift_runner"],
      fallImmuneEnemyTypeIds: ["armored_brute"],
      fallHazardTerrainTags: ["blocked", "water"]
    },
    displacementEffect: { kind: "displacement", mode: "push", distance: 2, stopAtBlocker: true }
  });

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#btn-mechanics-disable").click();
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    enabled: false,
    selectedProfileId: "basic_displacement_physics",
    profile: { fallHazardTerrainTags: ["blocked", "water"] }
  });
  await openPipelineTower(page);
  await expect(page.locator('[data-displacement-editor][data-displacement-scope="pipeline"]')).toHaveCount(0);
  await expect(page.locator("#af-pipeline-effects")).toContainText('"kind": "displacement"');

  await openPhysicsMechanics(page);
  await page.locator("#btn-mechanics-enable").click();
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    enabled: true,
    selectedProfileId: "basic_displacement_physics",
    profile: { fallHazardTerrainTags: ["blocked", "water"] },
    displacementEffect: { kind: "displacement", mode: "push", distance: 2, stopAtBlocker: true }
  });
  await openPipelineTower(page);
  await expect(page.locator('[data-displacement-editor][data-displacement-scope="pipeline"]')).toBeVisible();

  const unexpectedPageErrors = pageErrors.filter((message) => !(
    message.includes("document is sandboxed") && message.includes("allow-same-origin")
  ));
  expect(unexpectedPageErrors).toEqual([]);
});

async function openPhysicsMechanics(page) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
  const physics = page.locator('#mechanics-module-grid [data-mechanics-module="physics"]');
  await expect(physics).toBeEnabled();
  if (!await physics.evaluate((element) => element.classList.contains("selected"))) await physics.click();
  await expect(page.locator("#mechanics-physics-editor")).toBeVisible();
}

async function openPipelineTower(page) {
  await page.locator('[data-tab="towers"]').click();
  const tower = page.locator('#tower-list [data-eid="arrow_tower"]');
  await expect(tower).toBeVisible();
  await tower.click();
  await expect(page.locator("#tf-attack-kind")).toHaveValue("pipeline");
  await expect(page.locator("#af-pipeline-effects")).toBeVisible();
}

function readAuthoredState(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8"));
  const balance = JSON.parse(fs.readFileSync(path.join(root, "content", "balance.json"), "utf8"));
  const mechanics = JSON.parse(fs.readFileSync(path.join(root, "content", "mechanics.json"), "utf8"));
  const missionId = balance.defaultMissionId ?? manifest.defaultMissionId;
  const physics = mechanics.modules.physics;
  const selectedProfileId = balance.missions[missionId].mechanics?.profiles?.physics;
  return {
    projectSchemaVersion: manifest.schemaVersion,
    moduleSchemaVersion: physics.schemaVersion,
    enabled: physics.enabled,
    selectedProfileId,
    profile: physics.profiles[selectedProfileId],
    displacementEffect: balance.towers.arrow_tower.attack.effects.find((effect) => effect.kind === "displacement")
  };
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
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
