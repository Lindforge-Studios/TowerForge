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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mechanics-armor-studio-"));
  projectDir = path.join(tempRoot, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migrated.files);
  expect(JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).schemaVersion).toBe(2);

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

test("authors and preserves opt-in armor and marks through the real Mechanics Hub lifecycle", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(studioUrl);
  await expect(page).toHaveTitle(/TowerForge Editor/);
  const capabilityContract = await page.evaluate(async () => (
    await (await fetch("/api/mechanics/capabilities?missionId=tutorial_01")).json()
  ));
  expect(capabilityContract.combat.authoring).toMatchObject({
    schemaVersion: 3,
    supportedModuleSchemaVersions: [1, 2, 3],
    armorMatrix: { limits: { damageTypes: 256, armorTypes: 256, assignments: 4096 } },
    marks: { limits: { definitions: 256, sourceBindings: 4096, runtimeApplications: 16384 } }
  });

  for (const [tab, panel] of [
    ["enemies", "#tab-enemies"],
    ["towers", "#tab-towers"],
    ["missions", "#tab-missions"]
  ]) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await expect(page.locator(panel)).toBeVisible();
    await expect(page.locator(panel).locator(
      "[data-damage-type-id], [data-armor-type-id], [data-armor-multiplier], [data-enemy-armor-id]"
    )).toHaveCount(0);
  }

  await openMechanicsHub(page);
  await page.locator("#mechanics-recipe-select").selectOption("basic_regenerating_shields");
  await page.locator("#btn-mechanics-new-profile").click();
  await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_regenerating_shields");
  await page.locator("#btn-mechanics-enable").click();
  await expect(page.locator("#mechanics-hub-state")).toHaveText("Combat active for mission");
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    moduleSchemaVersion: 1,
    enabled: true,
    selectedProfileId: "basic_regenerating_shields",
    hasArmorFields: false
  });

  // Merely pointing the recipe dropdown at v2 must not mutate the loaded v1 draft or its save.
  await page.locator("#mechanics-recipe-select").selectOption("basic_elemental_armor_matrix");
  await page.locator("#mechanics-profile-select").selectOption("basic_regenerating_shields");
  await page.locator("#btn-mechanics-load-profile").click();
  await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_regenerating_shields");
  await page.locator("#btn-mechanics-save").click();
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    moduleSchemaVersion: 1,
    enabled: true,
    selectedProfileId: "basic_regenerating_shields",
    hasArmorFields: false
  });

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#btn-mechanics-disable").click();
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    moduleSchemaVersion: 1,
    enabled: false,
    selectedProfileId: "basic_regenerating_shields",
    hasArmorFields: false
  });

  await page.locator("#mechanics-recipe-select").selectOption("basic_elemental_armor_matrix");
  await page.locator("#btn-mechanics-new-profile").click();
  await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_elemental_armor_matrix");

  const fireLabel = page.locator('[data-damage-row="fire"] [data-damage-type-label]');
  await expect(fireLabel).toHaveValue("Fire");
  await fireLabel.fill("Flame");
  const platedFire = page.locator('[data-armor-row="plated"] [data-armor-multiplier="fire"]');
  await expect(platedFire).toHaveValue("0.8");
  await platedFire.fill("0.85");

  await page.locator("#btn-mechanics-enable").click();
  await expect(page.locator("#mechanics-hub-state")).toHaveText("Combat active for mission");
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    projectSchemaVersion: 3,
    moduleSchemaVersion: 2,
    enabled: true,
    selectedProfileId: "basic_elemental_armor_matrix",
    fireLabel: "Flame",
    fireMultiplier: 0.85
  });

  await page.reload();
  await openMechanicsHub(page);
  await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_elemental_armor_matrix");
  await expect(page.locator('[data-damage-row="fire"] [data-damage-type-label]')).toHaveValue("Flame");
  await expect(page.locator('[data-armor-row="plated"] [data-armor-multiplier="fire"]')).toHaveValue("0.85");

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#btn-mechanics-disable").click();
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    moduleSchemaVersion: 2,
    enabled: false,
    selectedProfileId: "basic_elemental_armor_matrix",
    fireLabel: "Flame",
    fireMultiplier: 0.85
  });
  await expect(page.locator("#btn-mechanics-enable")).toBeEnabled();

  await page.locator("#btn-mechanics-enable").click();
  await expect(page.locator("#mechanics-hub-state")).toHaveText("Combat active for mission");
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    moduleSchemaVersion: 2,
    enabled: true,
    selectedProfileId: "basic_elemental_armor_matrix",
    fireLabel: "Flame",
    fireMultiplier: 0.85
  });

  // Selecting the v3 recipe is not itself an upgrade: the loaded v2 profile saves unchanged.
  await page.locator("#mechanics-recipe-select").selectOption("basic_vulnerability_marks");
  await page.locator("#mechanics-profile-select").selectOption("basic_elemental_armor_matrix");
  await page.locator("#btn-mechanics-load-profile").click();
  await page.locator("#btn-mechanics-save").click();
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    moduleSchemaVersion: 2,
    enabled: true,
    selectedProfileId: "basic_elemental_armor_matrix",
    hasMarks: false
  });

  await page.locator("#mechanics-recipe-select").selectOption("basic_vulnerability_marks");
  await page.locator("#btn-mechanics-new-profile").click();
  await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_vulnerability_marks");
  await expect(page.locator('[data-mark-row="exposed"] [data-mark-label]')).toHaveValue("Exposed");
  await page.locator('[data-mark-row="exposed"] [data-mark-label]').fill("Armor Cracked");
  await page.locator('[data-mark-row="exposed"] [data-mark-duration]').fill("4");
  await page.locator('[data-mark-row="exposed"] [data-mark-consume-policy]').selectOption("consume_all");
  await expect(page.locator('[data-mark-binding-kind="towers"]')).toHaveCount(1);

  // The module is already active through the v2 profile; Save switches the selected profile
  // through the same guarded transaction, while Enable remains disabled for an active module.
  await page.locator("#btn-mechanics-save").click();
  await expect(page.locator("#mechanics-hub-state")).toHaveText("Combat active for mission");
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    projectSchemaVersion: 3,
    moduleSchemaVersion: 3,
    enabled: true,
    selectedProfileId: "basic_vulnerability_marks",
    hasArmorData: false,
    hasMarks: true,
    markLabel: "Armor Cracked",
    markDuration: 4,
    markConsumePolicy: "consume_all",
    markTowerIds: ["arrow_tower"]
  });

  await page.reload();
  await openMechanicsHub(page);
  await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_vulnerability_marks");
  await expect(page.locator('[data-mark-row="exposed"] [data-mark-label]')).toHaveValue("Armor Cracked");
  await expect(page.locator('[data-mark-row="exposed"] [data-mark-duration]')).toHaveValue("4");
  await expect(page.locator('[data-mark-row="exposed"] [data-mark-consume-policy]')).toHaveValue("consume_all");

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#btn-mechanics-disable").click();
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    moduleSchemaVersion: 3,
    enabled: false,
    selectedProfileId: "basic_vulnerability_marks",
    hasMarks: true,
    markLabel: "Armor Cracked"
  });
  await page.locator("#btn-mechanics-enable").click();
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    moduleSchemaVersion: 3,
    enabled: true,
    selectedProfileId: "basic_vulnerability_marks",
    hasMarks: true,
    markLabel: "Armor Cracked"
  });
  const unexpectedPageErrors = pageErrors.filter((message) => !(
    message.includes("document is sandboxed") && message.includes("allow-same-origin")
  ));
  expect(unexpectedPageErrors).toEqual([]);
});

async function openMechanicsHub(page) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-combat-editor")).toBeVisible();
  await expect(page.locator("#mechanics-recipe-select option")).toContainText([
    "Basic Regenerating Shields",
    "Basic Elemental Armor Matrix",
    "Basic Vulnerability Marks"
  ]);
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
}

function readAuthoredState(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8"));
  const balance = JSON.parse(fs.readFileSync(path.join(root, "content", "balance.json"), "utf8"));
  const mechanics = JSON.parse(fs.readFileSync(path.join(root, "content", "mechanics.json"), "utf8"));
  const missionId = balance.defaultMissionId ?? manifest.defaultMissionId;
  const combat = mechanics.modules.combat;
  const profileId = balance.missions[missionId].mechanics.profiles.combat;
  const profile = combat.profiles[profileId];
  return {
    projectSchemaVersion: manifest.schemaVersion,
    moduleSchemaVersion: combat.schemaVersion,
    enabled: combat.enabled,
    selectedProfileId: profileId,
    hasArmorFields: ["damageTypes", "armorTypes", "armorAssignments"].some((field) => Object.hasOwn(profile, field)),
    hasArmorData: Boolean(
      Object.keys(profile.damageTypes ?? {}).length
      || Object.keys(profile.armorTypes ?? {}).length
      || Object.keys(profile.armorAssignments?.enemies ?? {}).length
    ),
    hasMarks: Object.hasOwn(profile, "marks"),
    fireLabel: profile.damageTypes?.fire?.label,
    fireMultiplier: profile.armorTypes?.plated?.multipliers?.fire,
    markLabel: profile.marks?.definitions?.exposed?.label,
    markDuration: profile.marks?.definitions?.exposed?.duration,
    markConsumePolicy: profile.marks?.definitions?.exposed?.consumePolicy,
    markTowerIds: Object.keys(profile.marks?.bindings?.towers ?? {}).sort()
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
      // Server is still starting.
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
