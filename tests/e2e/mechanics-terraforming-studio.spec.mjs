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

test.describe("R3.4b C5B2 Studio terraforming lifecycle", () => {
  test.use({ hasTouch: true });

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-terraforming-studio-"));
    projectDir = path.join(tempRoot, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
    writeMigratedProjectFiles(projectDir, migrated.files);

    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = readJson(balancePath);
    balance.terrainTypes.buildable.tags = ["ground", "soil"];
    balance.terrainTypes.path.tags = ["path", "road"];
    balance.missions.sandbox_02 = {
      ...structuredClone(balance.missions.tutorial_01),
      id: "sandbox_02",
      label: "Sandbox Two"
    };
    writeJson(balancePath, balance);
    expect(readJson(path.join(projectDir, "project.json")).schemaVersion).toBe(2);
    expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(false);

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
    await waitForHttp(`${studioUrl}/api/project`, studioProcess);
  });

  test.afterEach(async () => {
    await stopProcess(studioProcess);
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("materializes one detached transition and read-only v6 snippet without writes, auto-enable, or script install", async ({ page }) => {
    const errors = captureBrowserErrors(page);
    await openStudio(page);
    const before = authoringBytes(projectDir);

    await openTerraformingMechanics(page);
    await materializeRecipe(page, {
      recipeId: "tagged_flood",
      sourceTag: "path",
      destinationId: "water",
      transitionId: "flood_custom"
    });

    const row = page.locator('[data-transition-key="flood_custom"]');
    await expect(row).toBeVisible();
    await expect(row.locator('[data-role="source-tag"]')).toHaveValue("path");
    await expect(row.locator('[data-role="destination-id"]')).toHaveValue("water");
    await expect(page.locator("#mechanics-terraforming-recipe-snippet")).toContainText('"minimumSchemaVersion": 6');
    await expect(page.locator("#mechanics-terraforming-recipe-snippet")).toContainText('"action": "terraformTiles"');
    await expect(page.locator("#mechanics-terraforming-recipe-snippet")).toContainText('"transitionId": "flood_custom"');
    expect(authoringBytes(projectDir)).toEqual(before);

    await page.locator("#btn-mechanics-preview").click();
    await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
    expect(authoringBytes(projectDir)).toEqual(before);
    expect(readMissionSelection(projectDir, "tutorial_01")).toBeUndefined();
    expect(errors()).toEqual([]);
  });

  test("enables schema v3, performs complete transition CRUD, reloads exact data, and isolates mission selection", async ({ page }) => {
    const errors = captureBrowserErrors(page);
    await openStudio(page);
    await openTerraformingMechanics(page);
    await materializeRecipe(page, {
      sourceTag: "path",
      destinationId: "water",
      transitionId: "flood_custom"
    });
    await page.locator("#btn-mechanics-enable").click();
    await expect(page.locator("#mechanics-hub-state")).toHaveText("Terraforming active for mission");
    expect(readTerraformingState(projectDir)).toMatchObject({
      projectSchemaVersion: 3,
      moduleSchemaVersion: 1,
      enabled: true,
      selections: { tutorial_01: "tagged_flood" }
    });

    let row = page.locator('[data-transition-key="flood_custom"]');
    await row.locator('[data-role="add-source-tag"]').click();
    row = page.locator('[data-transition-key="flood_custom"]');
    await expect(row.locator('[data-role="source-tag"]')).toHaveCount(2);
    await row.locator('[data-role="source-tag"]').nth(0).selectOption("path");
    await row.locator('[data-role="source-tag"]').nth(1).selectOption("road");
    await row.locator('[data-role="destination-id"]').selectOption("blocked");
    await row.locator('[data-role="transition-id"]').fill("flood_edited");
    await row.locator('[data-role="transition-id"]').press("Tab");
    await expect(page.locator('[data-transition-key="flood_edited"]')).toBeVisible();

    await page.locator("#btn-mechanics-add-terraforming-transition").click();
    const temporary = page.locator('[data-transition-key="transition_2"]');
    await expect(temporary).toBeVisible();
    await temporary.locator('[data-role="remove-transition"]').click();
    await expect(temporary).toHaveCount(0);
    await page.locator("#btn-mechanics-save").click();
    await expect.poll(() => readTerraformingState(projectDir).profile).toEqual({
      terrainTransitions: {
        flood_edited: { fromTerrainTags: ["path", "road"], toTerrainId: "blocked" }
      }
    });

    await page.reload();
    await openTerraformingMechanics(page);
    row = page.locator('[data-transition-key="flood_edited"]');
    await expect(row.locator('[data-role="source-tag"]')).toHaveCount(2);
    await expect(row.locator('[data-role="source-tag"]').nth(0)).toHaveValue("path");
    await expect(row.locator('[data-role="source-tag"]').nth(1)).toHaveValue("road");
    await expect(row.locator('[data-role="destination-id"]')).toHaveValue("blocked");

    await page.locator("#mechanics-mission-select").selectOption("sandbox_02");
    await expect(page.locator("#mechanics-hub-state")).toHaveText("Opt-in modules");
    expect(readMissionSelection(projectDir, "sandbox_02")).toBeUndefined();
    expect(readMissionSelection(projectDir, "tutorial_01")).toBe("tagged_flood");
    await page.locator("#mechanics-mission-select").selectOption("tutorial_01");
    await expect(page.locator("#mechanics-hub-state")).toHaveText("Terraforming active for mission");
    await expect(page.locator('[data-transition-key="flood_edited"]')).toBeVisible();
    expect(errors()).toEqual([]);
  });

  test("global disable preserves mission selection and profile so direct re-enable restores the exact state", async ({ page }) => {
    const errors = captureBrowserErrors(page);
    await openStudio(page);
    await openTerraformingMechanics(page);
    await materializeRecipe(page, {
      sourceTag: "path",
      destinationId: "water",
      transitionId: "preserved_flood"
    });
    await page.locator("#btn-mechanics-enable").click();
    await expect(page.locator("#mechanics-hub-state")).toHaveText("Terraforming active for mission");
    const preservedProfile = structuredClone(readTerraformingState(projectDir).profile);

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-mechanics-disable").click();
    await expect(page.locator("#mechanics-hub-state")).toHaveText("Opt-in modules");
    await expect(page.locator('#mechanics-module-grid [data-mechanics-module="terraforming"]'))
      .toHaveAttribute("data-status", "available");
    await expect.poll(() => readMissionSelection(projectDir, "tutorial_01")).toBe("tagged_flood");
    expect(readTerraformingState(projectDir)).toMatchObject({
      enabled: false,
      selections: { tutorial_01: "tagged_flood" },
      profile: preservedProfile
    });

    await expect(page.locator("#btn-mechanics-enable")).toBeEnabled();
    await page.locator("#btn-mechanics-enable").click();
    await expect(page.locator("#mechanics-hub-state")).toHaveText("Terraforming active for mission");
    expect(readTerraformingState(projectDir)).toMatchObject({
      enabled: true,
      selections: { tutorial_01: "tagged_flood" },
      profile: preservedProfile
    });
    expect(errors()).toEqual([]);
  });

  test("reports the exact deterministic elevation dependency error without writing", async ({ page }) => {
    const errors = captureBrowserErrors(page);
    await openStudio(page);
    const before = authoringBytes(projectDir);
    await openTerraformingMechanics(page);
    await materializeRecipe(page, {
      sourceTag: "path",
      destinationId: "water",
      transitionId: "raised_flood"
    });
    await page.locator("#mechanics-terraforming-elevation-enabled").check();
    await page.locator("#mechanics-terraforming-elevation-minimum").fill("-4");
    await page.locator("#mechanics-terraforming-elevation-maximum").fill("4");
    await page.locator("#mechanics-terraforming-elevation-max-delta").fill("2");
    await expect(page.locator("#mechanics-terraforming-elevation-dependency"))
      .toContainText("requires an active elevation profile");
    const responsePromise = page.waitForResponse((response) => (
      response.url().endsWith("/api/mechanics/preview") && response.request().method() === "POST"
    ));
    await page.locator("#btn-mechanics-preview").click();
    const response = await responsePromise;
    const payload = await response.json();
    expect(response.status()).toBe(422);
    expect(payload).toMatchObject({
      code: "validation",
      error: 'Active terraforming elevation policy requires an active elevation capability for mission "tutorial_01".'
    });
    await expect(page.locator("#mechanics-preview-result")).toContainText(payload.error);
    expect(authoringBytes(projectDir)).toEqual(before);
    expect(errors().filter((message) => !(
      message.includes("Failed to load resource") && message.includes("422")
    ))).toEqual([]);
  });

  test("persists optional elevation policy only after the selected mission activates elevation", async ({ page }) => {
    const errors = captureBrowserErrors(page);
    await openStudio(page);
    await openMechanicsModule(page, "elevation", "#mechanics-elevation-editor");
    await page.locator("#mechanics-recipe-select").selectOption("basic_authored_elevation");
    await page.locator("#mechanics-profile-id").fill("sentinel_pending_recipe");
    await page.locator("#btn-mechanics-new-profile").click();
    await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_authored_elevation");
    const elevationPreviewResponsePromise = page.waitForResponse((response) => (
      response.url().endsWith("/api/mechanics/preview") && response.request().method() === "POST"
    ));
    await page.locator("#btn-mechanics-enable").click();
    const elevationPreviewResponse = await elevationPreviewResponsePromise;
    const elevationPreviewPayload = await elevationPreviewResponse.json();
    expect(elevationPreviewResponse.status(), JSON.stringify(elevationPreviewPayload)).toBe(200);
    await expect(page.locator("#mechanics-hub-state")).toHaveText("Elevation active for mission");

    await openTerraformingMechanics(page);
    await materializeRecipe(page, {
      recipeId: "tagged_moat",
      sourceTag: "ground",
      destinationId: "water",
      transitionId: "bounded_moat"
    });
    await page.locator("#mechanics-terraforming-elevation-enabled").check();
    await page.locator("#mechanics-terraforming-elevation-minimum").fill("-3");
    await page.locator("#mechanics-terraforming-elevation-maximum").fill("5");
    await page.locator("#mechanics-terraforming-elevation-max-delta").fill("2");
    await expect(page.locator("#mechanics-terraforming-elevation-dependency"))
      .toContainText("required elevation capability");
    await page.locator("#btn-mechanics-preview").click();
    await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
    await page.locator("#btn-mechanics-enable").click();
    await expect(page.locator("#mechanics-hub-state")).toHaveText("Terraforming active for mission");
    await expect.poll(() => readTerraformingState(projectDir).profile).toEqual({
      terrainTransitions: {
        bounded_moat: { fromTerrainTags: ["ground"], toTerrainId: "water" }
      },
      elevation: { minimum: -3, maximum: 5, maximumDeltaPerOperation: 2 }
    });
    expect(errors()).toEqual([]);
  });

  test("keeps a future v2 module raw, visible, lossless, and entirely read-only", async ({ page }) => {
    writeFutureTerraformingFixture(projectDir);
    const before = authoringBytes(projectDir);
    const errors = captureBrowserErrors(page);
    await openStudio(page);
    await openTerraformingMechanics(page);

    const row = page.locator('[data-transition-key="future_flood"]');
    await expect(row).toBeVisible();
    await expect(row.locator('[data-role="source-tag"]')).toHaveValue("future-authored-tag");
    await expect(row.locator('[data-role="destination-id"]')).toHaveValue("future-terrain-id");
    await expect(page.locator("#mechanics-profile-id")).toHaveValue("future_profile");
    for (const control of [
      "#mechanics-profile-id",
      "#btn-mechanics-new-profile",
      "#btn-mechanics-preview",
      "#btn-mechanics-enable",
      "#btn-mechanics-save",
      "#btn-mechanics-disable",
      "#btn-mechanics-add-terraforming-transition"
    ]) await expect(page.locator(control)).toBeDisabled();
    const rowControls = row.locator("input, select, button");
    await expect(rowControls).toHaveCount(6);
    expect(await rowControls.evaluateAll((controls) => controls.every((control) => control.disabled))).toBe(true);
    expect(authoringBytes(projectDir)).toEqual(before);
    expect(errors()).toEqual([]);
  });

  test("rejects stale, malformed, and invalid guarded requests without partial writes or path disclosure", async ({ page }) => {
    await openStudio(page);
    const staleCandidate = mechanicsRequest("stale_candidate", "stale_transition", "path", "water");
    const winnerCandidate = mechanicsRequest("winner", "winner_transition", "ground", "blocked");
    const stalePreview = await browserPost(page, "/api/mechanics/preview", staleCandidate);
    const winnerPreview = await browserPost(page, "/api/mechanics/preview", winnerCandidate);
    expect(stalePreview.status).toBe(200);
    expect(winnerPreview.status).toBe(200);
    const winnerApply = await browserPost(page, "/api/mechanics/apply", {
      ...winnerCandidate,
      ifRevision: winnerPreview.payload.revision
    });
    expect(winnerApply.status).toBe(200);
    const committed = authoringBytes(projectDir);

    const staleApply = await browserPost(page, "/api/mechanics/apply", {
      ...staleCandidate,
      ifRevision: stalePreview.payload.revision
    });
    expect(staleApply.status).toBe(409);
    expect(staleApply.payload.code).toMatch(/conflict|stale/);
    expect(JSON.stringify(staleApply.payload)).not.toContain(projectDir);
    expect(authoringBytes(projectDir)).toEqual(committed);

    const malformed = await page.evaluate(async () => {
      const response = await fetch("/api/mechanics/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json"
      });
      return { status: response.status, payload: await response.json() };
    });
    expect(malformed).toMatchObject({ status: 400, payload: { code: "malformed_request" } });
    expect(JSON.stringify(malformed.payload)).not.toContain(projectDir);

    const invalid = await browserPost(page, "/api/mechanics/apply", {
      ...mechanicsRequest("invalid", "invalid_transition", "missing-tag", "missing-terrain"),
      ifRevision: winnerApply.payload.revision
    });
    expect(invalid.status).toBe(422);
    expect(JSON.stringify(invalid.payload)).not.toContain(projectDir);
    expect(authoringBytes(projectDir)).toEqual(committed);
  });

  test("supports keyboard and touch access at 840px while leaving the existing Mechanics Hub intact", async ({ page }) => {
    await page.setViewportSize({ width: 840, height: 900 });
    const errors = captureBrowserErrors(page);
    await openStudio(page);
    await page.locator('[data-tab="mechanics"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#mechanics-module-grid")).toBeVisible();

    const terraformingCard = page.locator('#mechanics-module-grid [data-mechanics-module="terraforming"]');
    await terraformingCard.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#mechanics-terraforming-editor")).toBeVisible();
    const editorBox = await page.locator("#mechanics-terraforming-editor").boundingBox();
    expect(editorBox).not.toBeNull();
    expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(840);

    await page.locator("#btn-mechanics-add-terraforming-transition").tap();
    await expect(page.locator("#mechanics-terraforming-transition-rows [data-transition-key]"))
      .toHaveCount(1);
    await page.locator('#mechanics-module-grid [data-mechanics-module="physics"]').tap();
    await expect(page.locator("#mechanics-physics-editor")).toBeVisible();
    await page.locator('#mechanics-module-grid [data-mechanics-module="combat"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#mechanics-combat-fields")).toBeVisible();
    expect(errors()).toEqual([]);
  });
});

async function openStudio(page) {
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(studioUrl);
  await expect(page).toHaveTitle(/TowerForge Editor/);
}

async function openTerraformingMechanics(page) {
  await openMechanicsModule(page, "terraforming", "#mechanics-terraforming-editor");
}

async function openMechanicsModule(page, moduleId, editorSelector) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
  const card = page.locator(`#mechanics-module-grid [data-mechanics-module="${moduleId}"]`);
  await expect(card).toBeEnabled();
  if (!await card.evaluate((element) => element.classList.contains("selected"))) await card.click();
  await expect(page.locator(editorSelector)).toBeVisible();
}

async function materializeRecipe(page, {
  recipeId = "tagged_flood",
  sourceTag,
  destinationId,
  transitionId
}) {
  await page.locator("#mechanics-recipe-select").selectOption(recipeId);
  await page.locator("#mechanics-terraforming-recipe-source-tag").selectOption(sourceTag);
  await page.locator("#mechanics-terraforming-recipe-destination").selectOption(destinationId);
  await page.locator("#mechanics-terraforming-recipe-transition-id").fill(transitionId);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/mechanics/recipe"
  ), { timeout: 45_000 });
  await page.locator("#btn-mechanics-new-profile").click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  await expect(page.locator("#mechanics-profile-id")).toHaveValue(recipeId);
  await expect(page.locator(`[data-transition-key="${transitionId}"]`)).toBeVisible();
}

function mechanicsRequest(profileId, transitionId, sourceTag, destinationId) {
  return {
    moduleId: "terraforming",
    moduleSchemaVersion: 1,
    missionId: "tutorial_01",
    enabled: true,
    profileId,
    profile: {
      terrainTransitions: {
        [transitionId]: { fromTerrainTags: [sourceTag], toTerrainId: destinationId }
      }
    }
  };
}

async function browserPost(page, endpoint, body) {
  return page.evaluate(async ({ endpoint, body }) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return { status: response.status, payload: await response.json() };
  }, { endpoint, body });
}

function readTerraformingState(root) {
  const manifest = readJson(path.join(root, "project.json"));
  const balance = readJson(path.join(root, "content", "balance.json"));
  const mechanics = readJson(path.join(root, "content", "mechanics.json"));
  const module = mechanics.modules.terraforming;
  const profileId = balance.missions.tutorial_01.mechanics?.profiles?.terraforming ?? "tagged_flood";
  return {
    projectSchemaVersion: manifest.schemaVersion,
    moduleSchemaVersion: module.schemaVersion,
    enabled: module.enabled,
    selections: Object.fromEntries(Object.entries(balance.missions)
      .flatMap(([missionId, mission]) => mission.mechanics?.profiles?.terraforming
        ? [[missionId, mission.mechanics.profiles.terraforming]] : [])),
    profile: module.profiles[profileId]
  };
}

function readMissionSelection(root, missionId) {
  return readJson(path.join(root, "content", "balance.json"))
    .missions[missionId].mechanics?.profiles?.terraforming;
}

function authoringBytes(root) {
  const mechanicsPath = path.join(root, "content", "mechanics.json");
  return {
    manifest: fs.readFileSync(path.join(root, "project.json"), "base64"),
    balance: fs.readFileSync(path.join(root, "content", "balance.json"), "base64"),
    mechanics: fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "base64") : null,
    scripts: readTree(path.join(root, "scripts"))
  };
}

function readTree(root) {
  if (!fs.existsSync(root)) return {};
  const result = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else result[path.relative(root, absolute)] = fs.readFileSync(absolute, "base64");
    }
  };
  visit(root);
  return result;
}

function writeFutureTerraformingFixture(root) {
  const manifestPath = path.join(root, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);
  const balancePath = path.join(root, "content", "balance.json");
  const balance = readJson(balancePath);
  balance.missions.tutorial_01.mechanics = { profiles: { terraforming: "future_profile" } };
  writeJson(balancePath, balance);
  writeJson(path.join(root, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      terraforming: {
        schemaVersion: 2,
        enabled: true,
        profiles: {
          future_profile: {
            terrainTransitions: {
              future_flood: {
                fromTerrainTags: ["future-authored-tag"],
                toTerrainId: "future-terrain-id",
                futureTransitionRule: { retain: true }
              }
            },
            futureProfileRule: ["retain", 2]
          }
        },
        futureModuleRule: { retain: true }
      }
    }
  });
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
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
  if (!port) return freePort();
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
