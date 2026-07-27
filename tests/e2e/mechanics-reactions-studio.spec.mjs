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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-mechanics-reactions-studio-"));
  projectDir = path.join(tempRoot, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
  writeMigratedProjectFiles(projectDir, migrated.files);
  expect(JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).schemaVersion).toBe(2);
  expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(false);

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

test("authors and preserves opt-in reactions through the real Mechanics Hub lifecycle", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(studioUrl);
  await expect(page).toHaveTitle(/TowerForge Editor/);

  const initial = await page.evaluate(async () => (
    await (await fetch("/api/mechanics/capabilities?missionId=tutorial_01")).json()
  ));
  expect(initial).toMatchObject({
    authoring: { writable: true },
    capabilities: {
      combat: { available: true, active: false, reason: "module_missing" },
      reactions: { available: true, active: false, reason: "module_missing" }
    },
    reactions: {
      authoring: {
        moduleId: "reactions",
        schemaVersion: 1,
        dependency: { moduleId: "combat", supportedModuleSchemaVersions: [2, 3] }
      }
    }
  });

  // Legacy entity and mission forms stay free of reaction controls until the Hub is opened.
  for (const [tab, panel] of [
    ["enemies", "#tab-enemies"],
    ["towers", "#tab-towers"],
    ["missions", "#tab-missions"]
  ]) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await expect(page.locator(panel)).toBeVisible();
    await expect(page.locator(panel).locator(
      "[data-exposure-id], [data-reaction-id], [data-reaction-trigger-damage-type]"
    )).toHaveCount(0);
  }
  expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(false);

  await openMechanicsHub(page);
  await selectMechanicsModule(page, "reactions");
  await page.locator("#mechanics-recipe-select").selectOption("elemental_shatter");
  await page.locator("#btn-mechanics-new-profile").click();
  await expect(page.locator("#mechanics-profile-id")).toHaveValue("elemental_shatter");
  await expect(page.locator("#mechanics-reaction-prerequisites")).toBeVisible();
  await expect(page.locator("#mechanics-reaction-prerequisites")).toContainText("dependency_missing");
  await page.locator("#btn-mechanics-preview").click();
  await expect(page.locator("#mechanics-preview-result")).toContainText(/dependency_missing|reaction_damage_type_missing/);
  expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(false);

  // Satisfy the explicit combat prerequisite through the same Hub, without touching standard forms.
  await selectMechanicsModule(page, "combat");
  await page.locator("#mechanics-recipe-select").selectOption("basic_elemental_armor_matrix");
  await page.locator("#btn-mechanics-new-profile").click();
  await page.locator("#btn-mechanics-enable").click();
  await expect(page.locator("#mechanics-hub-state")).toHaveText("Combat active for mission");
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    projectSchemaVersion: 3,
    combat: { schemaVersion: 2, enabled: true, selectedProfileId: "basic_elemental_armor_matrix" },
    reactions: null
  });

  await selectMechanicsModule(page, "reactions");
  await expect(page.locator("#mechanics-reaction-prerequisites")).toBeHidden();
  await page.locator("#mechanics-recipe-select").selectOption("elemental_shatter");
  await page.locator("#btn-mechanics-new-profile").click();
  await expect(page.locator('[data-exposure-row="fire"] [data-exposure-label]')).toHaveValue("Fire");
  await page.locator('[data-exposure-row="fire"] [data-exposure-label]').fill("Burning");
  await page.locator('[data-exposure-row="fire"] [data-exposure-duration]').fill("5");
  await page.locator('[data-exposure-row="ice"] [data-exposure-max-stacks]').fill("2");
  const shatterRow = page.locator('[data-reaction-row="shatter_fire_into_ice"]');
  await shatterRow.locator('[data-reaction-label]').fill("Thermal Shatter");
  await shatterRow.locator('[data-reaction-trigger-damage-type]').fill("fire, ice");
  await shatterRow.locator('[data-reaction-requirement-index="0"] [data-reaction-requirement-min-stacks]').fill("2");
  await shatterRow.locator('[data-reaction-effect-id="critical"] [data-reaction-effect-amount-value]').fill("2.25");

  // Exercise full bounded CRUD: keep a second requirement/effect, and add/remove a third.
  await shatterRow.locator('[data-add-reaction-requirement]').click();
  let secondRequirement = page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-requirement-index="1"]');
  await secondRequirement.locator('[data-reaction-requirement-kind]').selectOption("terrain_tag");
  await secondRequirement.locator('[data-reaction-requirement-ref]').fill("path");
  await page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-add-reaction-requirement]').click();
  await page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-requirement-index="2"] [data-remove-reaction-requirement]').click();
  await expect(page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-requirement-index]')).toHaveCount(2);

  await page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-add-reaction-effect]').click();
  let addedEffect = page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-effect-id="effect_1"]');
  await addedEffect.locator('[data-reaction-effect-amount-value]').fill("3");
  await addedEffect.locator('[data-reaction-effect-damage-type]').fill("physical");
  await addedEffect.locator('[data-reaction-effect-target]').selectOption("radius");
  await addedEffect.locator('[data-reaction-effect-radius]').fill("1");
  await addedEffect.locator('[data-reaction-effect-max-targets]').fill("2");
  await addedEffect.locator('[data-reaction-effect-key]').fill("splash");
  await addedEffect.locator('[data-reaction-effect-key]').press("Tab");
  await expect(page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-effect-id="splash"]')).toBeVisible();
  await page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-add-reaction-effect]').click();
  await page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-effect-id="effect_1"] [data-remove-reaction-effect]').click();
  await expect(page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-effect-id]')).toHaveCount(2);

  await page.locator("#btn-mechanics-add-reaction").click();
  await expect(page.locator('[data-reaction-row="reaction_1"]')).toBeVisible();
  await page.locator('[data-reaction-row="reaction_1"] [data-remove-reaction]').click();
  await expect(page.locator('[data-reaction-row="reaction_1"]')).toHaveCount(0);

  await page.locator("#btn-mechanics-preview").click();
  await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
  await page.locator("#btn-mechanics-enable").click();
  await expect(page.locator("#mechanics-hub-state")).toHaveText("Reactions active for mission");
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    projectSchemaVersion: 3,
    combat: { schemaVersion: 2, enabled: true, selectedProfileId: "basic_elemental_armor_matrix" },
    reactions: {
      schemaVersion: 1,
      enabled: true,
      selectedProfileId: "elemental_shatter",
      fireLabel: "Burning",
      fireDuration: 5,
      iceMaxStacks: 2,
      shatterLabel: "Thermal Shatter",
      shatterMultiplier: 2.25,
      shatterTriggerDamageTypes: ["fire", "ice"],
      shatterRequirements: [
        { kind: "exposure", exposureId: "ice", minStacks: 2, consume: "all" },
        { kind: "terrain_tag", tag: "path" }
      ],
      shatterEffectIds: ["critical", "splash"],
      splashEffect: {
        kind: "damage",
        amount: { kind: "flat", value: 3 },
        damageType: "physical",
        target: { kind: "radius", radius: 1, maxTargets: 2 },
        allowReactions: false
      }
    }
  });

  await page.reload();
  await openMechanicsHub(page);
  await selectMechanicsModule(page, "reactions");
  await expect(page.locator("#mechanics-profile-id")).toHaveValue("elemental_shatter");
  await expect(page.locator('[data-exposure-row="fire"] [data-exposure-label]')).toHaveValue("Burning");
  await expect(page.locator('[data-exposure-row="fire"] [data-exposure-duration]')).toHaveValue("5");
  await expect(page.locator('[data-exposure-row="ice"] [data-exposure-max-stacks]')).toHaveValue("2");
  await expect(page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-label]')).toHaveValue("Thermal Shatter");
  await expect(page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-trigger-damage-type]')).toHaveValue("fire, ice");
  await expect(page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-requirement-index]')).toHaveCount(2);
  await expect(page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-requirement-index="0"] [data-reaction-requirement-min-stacks]')).toHaveValue("2");
  await expect(page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-requirement-index="1"] [data-reaction-requirement-kind]')).toHaveValue("terrain_tag");
  await expect(page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-effect-id="critical"] [data-reaction-effect-amount-value]')).toHaveValue("2.25");
  await expect(page.locator('[data-reaction-row="shatter_fire_into_ice"] [data-reaction-effect-id="splash"] [data-reaction-effect-amount-value]')).toHaveValue("3");

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#btn-mechanics-disable").click();
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    reactions: {
      schemaVersion: 1,
      enabled: false,
      selectedProfileId: "elemental_shatter",
      fireLabel: "Burning",
      shatterLabel: "Thermal Shatter"
    }
  });
  await expect(page.locator("#btn-mechanics-enable")).toBeEnabled();
  await page.locator("#btn-mechanics-enable").click();
  await expect(page.locator("#mechanics-hub-state")).toHaveText("Reactions active for mission");
  await expect.poll(() => readAuthoredState(projectDir)).toMatchObject({
    reactions: { enabled: true, selectedProfileId: "elemental_shatter", fireLabel: "Burning" }
  });

  const unexpectedPageErrors = pageErrors.filter((message) => !(
    message.includes("document is sandboxed") && message.includes("allow-same-origin")
  ));
  expect(unexpectedPageErrors).toEqual([]);
});

async function openMechanicsHub(page) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-combat-editor")).toBeVisible();
  await expect(page.locator('#mechanics-module-grid [data-mechanics-module="combat"]')).toBeEnabled();
  await expect(page.locator('#mechanics-module-grid [data-mechanics-module="reactions"]')).toBeEnabled();
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
}

async function selectMechanicsModule(page, moduleId) {
  const button = page.locator(`#mechanics-module-grid [data-mechanics-module="${moduleId}"]`);
  await expect(button).toBeEnabled();
  if (!await button.evaluate((element) => element.classList.contains("selected"))) await button.click();
  if (moduleId === "reactions") await expect(page.locator("#mechanics-reaction-editor")).toBeVisible();
  else await expect(page.locator("#mechanics-combat-fields")).toBeVisible();
}

function readAuthoredState(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8"));
  const balance = JSON.parse(fs.readFileSync(path.join(root, "content", "balance.json"), "utf8"));
  const mechanics = JSON.parse(fs.readFileSync(path.join(root, "content", "mechanics.json"), "utf8"));
  const missionId = balance.defaultMissionId ?? manifest.defaultMissionId;
  const selected = balance.missions[missionId].mechanics?.profiles ?? {};
  const combatModule = mechanics.modules.combat;
  const reactionModule = mechanics.modules.reactions;
  const reactionProfile = reactionModule?.profiles?.[selected.reactions];
  return {
    projectSchemaVersion: manifest.schemaVersion,
    combat: combatModule ? {
      schemaVersion: combatModule.schemaVersion,
      enabled: combatModule.enabled,
      selectedProfileId: selected.combat
    } : null,
    reactions: reactionModule ? {
      schemaVersion: reactionModule.schemaVersion,
      enabled: reactionModule.enabled,
      selectedProfileId: selected.reactions,
      fireLabel: reactionProfile?.exposures?.definitions?.fire?.label,
      fireDuration: reactionProfile?.exposures?.definitions?.fire?.duration,
      iceMaxStacks: reactionProfile?.exposures?.definitions?.ice?.maxStacks,
      shatterLabel: reactionProfile?.reactions?.shatter_fire_into_ice?.label,
      shatterMultiplier: reactionProfile?.reactions?.shatter_fire_into_ice?.effects?.critical?.amount?.multiplier,
      shatterTriggerDamageTypes: reactionProfile?.reactions?.shatter_fire_into_ice?.trigger?.damageTypes,
      shatterRequirements: reactionProfile?.reactions?.shatter_fire_into_ice?.requirements,
      shatterEffectIds: Object.keys(reactionProfile?.reactions?.shatter_fire_into_ice?.effects ?? {}).sort(),
      splashEffect: reactionProfile?.reactions?.shatter_fire_into_ice?.effects?.splash
    } : null
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
  if (!port || [5184, 5193, 5197].includes(port)) return freePort();
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
