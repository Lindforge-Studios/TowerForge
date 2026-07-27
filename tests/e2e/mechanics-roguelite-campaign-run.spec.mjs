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
const nodeActivations = ["click", "enter", "space", "tap"];

test.use({ hasTouch: true });

test.describe("R4.4B Studio campaign lifecycle", () => {
  let root;
  let projectDir;
  let studioProcess;
  let studioUrl;
  let serverOutput = "";

  test.beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-campaign-studio-"));
    projectDir = path.join(root, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
    writeMigratedProjectFiles(projectDir, migrated.files);

    const port = await freeTcpPort();
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
    await waitForHttp(`${studioUrl}/api/project`, studioProcess, () => serverOutput);
  });

  test.afterAll(async () => {
    await stopProcess(studioProcess);
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  test("previews, enables, reloads, disables, and re-enables without losing the graph draft", async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    await openStudio(page, studioUrl);
    await openRogueliteMechanics(page);

    const campaign = campaignGraph();
    const source = JSON.stringify(campaign, null, 2);
    await page.locator("#mechanics-roguelite-campaign-profile-id").fill("browser_campaign");
    await page.locator("#mechanics-roguelite-campaign-json").fill(source);
    const beforePreview = campaignState(projectDir);
    expect(beforePreview.authored).toBe(false);

    await page.locator("#btn-campaign-preview").click();
    await expect(page.locator("#campaign-preview-result")).toContainText('"ok": true');
    await expect(page.locator("#mechanics-roguelite-campaign-json")).toHaveValue(source);
    expect(campaignState(projectDir)).toEqual(beforePreview);

    await page.locator("#btn-campaign-enable").click();
    await expect.poll(() => campaignState(projectDir)).toMatchObject({
      projectSchemaVersion: 3,
      authored: true,
      active: true,
      profileId: "browser_campaign",
      selectedProfileId: "browser_campaign"
    });

    await page.reload();
    await openRogueliteMechanics(page);
    await expect(page.locator("#mechanics-roguelite-campaign-json")).toHaveValue(source);
    await expect(page.locator("#btn-campaign-disable")).toBeEnabled();

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-campaign-disable").click();
    await expect.poll(() => campaignState(projectDir)).toMatchObject({ authored: true, active: false });
    await expect(page.locator("#mechanics-roguelite-campaign-json")).toHaveValue(source);

    await page.locator("#btn-campaign-enable").click();
    await expect.poll(() => campaignState(projectDir)).toMatchObject({ authored: true, active: true });

    await page.reload();
    await openRogueliteMechanics(page);
    const towerTags = page.locator('[data-roguelite-tower="arrow_tower"] [data-role="tower-tags"]');
    await expect(towerTags).toBeEnabled();
    await towerTags.fill("campaign, sniper");
    await page.locator("#btn-mechanics-save").click();
    await expect.poll(() => readJson(path.join(projectDir, "content", "balance.json")).towers.arrow_tower.tags)
      .toEqual(["campaign", "sniper"]);
    expect(campaignState(projectDir)).toMatchObject({ authored: true, active: true });
    expect(readJson(path.join(projectDir, "content", "mechanics.json"))
      .modules.roguelite.profiles.browser_campaign.campaign).toEqual({ schemaVersion: 2 });

    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const futureMechanics = readJson(mechanicsPath);
    futureMechanics.modules.roguelite.profiles.browser_campaign.campaign = {
      schemaVersion: 3,
      rawFutureField: { preserve: ["exact", 3] }
    };
    writeJson(mechanicsPath, futureMechanics);
    const futureBytes = fs.readFileSync(mechanicsPath, "utf8");
    await page.reload();
    await openRogueliteMechanics(page);
    await expect(page.locator("#btn-mechanics-preview")).toBeDisabled();
    await expect(page.locator("#btn-mechanics-save")).toBeDisabled();
    await expect(page.locator("#mechanics-roguelite-campaign-json")).toBeDisabled();
    await expect(page.locator("#campaign-preview-result")).toContainText(/newer|read-only/i);
    expect(fs.readFileSync(mechanicsPath, "utf8")).toBe(futureBytes);
    expect(browserErrors()).toEqual([]);
  });
});

test.describe("R4.4B generated-player campaign run", () => {
  let root;
  let server;
  let port;

  test.beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-campaign-player-"));
    for (const combination of combinations) {
      buildPlayerFixture(root, { mode: "active", ...combination });
      buildPlayerFixture(root, { mode: "absent", ...combination });
    }
    port = await freeHttpPort();
    server = http.createServer((request, response) => {
      const relative = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname)
        .replace(/^\/+/, "");
      const [mode, grid, renderer, ...parts] = relative.split("/");
      if (!["active", "absent"].includes(mode)
        || !["hex", "square"].includes(grid) || !["canvas", "phaser"].includes(renderer)) {
        return respond404(response);
      }
      const buildDir = path.join(root, `${fixtureName(mode, grid, renderer)}.tdproj`, "dist");
      const filePath = path.resolve(buildDir, parts.join("/") || "index.html");
      const confined = path.relative(buildDir, filePath);
      if (confined.startsWith("..") || path.isAbsolute(confined)
        || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return respond404(response);
      response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
      fs.createReadStream(filePath).pipe(response);
    });
    await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", (error) => (
      error ? reject(error) : resolve()
    )));
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  test("resolves structural choices and round-trips their resources across Canvas/Phaser and hex/square", async ({ page }) => {
    test.setTimeout(240_000);
    const browserErrors = captureBrowserErrors(page);

    for (const [{ grid, renderer }, activation, choiceActivation] of combinations.map((entry, index) => [
      entry,
      nodeActivations[index],
      nodeActivations[(index + 1) % nodeActivations.length]
    ])) {
      await page.goto(playerUrl(port, "active", grid, renderer));
      await waitForPlayerBoot(page);
      await expect(page.locator("#campaign-run-panel")).toBeVisible();
      await expect.poll(async () => (await inspectCampaign(page)).availableNodeIds).toEqual(["first_battle"]);
      const entry = page.locator('#campaign-run-nodes button[data-state="available"]');
      await expect(entry, `${grid}/${renderer} entry node`).toHaveCount(1);
      await activateNativeControl(page, entry, activation);
      await expect.poll(() => inspectCampaign(page)).toMatchObject({
        active: true,
        pendingNodeId: "first_battle",
        availableNodeIds: ["first_battle"]
      });

      const placement = await nextPlacementPoint(page);
      expect(placement, `${grid}/${renderer} needs a buildable tower tile`).not.toBeNull();
      await page.mouse.click(placement.x, placement.y);
      await expect(page.locator("#stat-towers")).toHaveText("1");
      await page.locator("#speed").fill("4");
      await page.locator("#start-wave").click();
      await expect.poll(async () => (await inspectCampaign(page)).run?.nodeId, {
        timeout: 30_000,
        message: `${grid}/${renderer} ${activation} selection must advance CampaignRun exactly once`
      }).toBe("first_battle");
      await expect.poll(async () => (await inspectCampaign(page)).availableNodeIds).toEqual(["event_offer"]);

      const eventNode = page.locator('#campaign-run-nodes [data-state="available"]', { hasText: "Event Offer" });
      const relicChoice = eventNode.locator('[data-campaign-choice-id="relic"]');
      await expect(relicChoice).toBeEnabled();
      await expect(relicChoice).toContainText("Coins:3");
      await relicChoice.click();
      await expect(page.locator("#message")).toContainText("insufficient_run_resources");
      await expect.poll(() => inspectCampaign(page)).toMatchObject({
        pendingNodeId: null,
        availableNodeIds: ["event_offer"],
        run: { nodeId: "first_battle", runResources: {} }
      });
      const cacheChoice = eventNode.locator('[data-campaign-choice-id="cache"]');
      await expect(cacheChoice).toBeEnabled();
      await activateNativeControl(page, cacheChoice, choiceActivation);
      await expect.poll(() => inspectCampaign(page)).toMatchObject({
        pendingNodeId: null,
        availableNodeIds: [],
        run: { nodeId: "event_offer", runResources: { coins: 5 } }
      });
      await expect(page.locator("#campaign-run-summary")).toContainText("Coins: 5");

      const downloadPromise = page.waitForEvent("download");
      await page.locator("#campaign-run-export").click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("towerforge-campaign-run.json");
      const downloadedPath = await download.path();
      const exported = JSON.parse(fs.readFileSync(downloadedPath, "utf8"));
      expect(exported).toMatchObject({ nodeId: "event_offer", runResources: { coins: 5 } });

      await importRun(page, { ...exported, nodeId: null });
      await expect.poll(async () => (await inspectCampaign(page)).run?.nodeId).toBeNull();
      await expect.poll(async () => (await inspectCampaign(page)).availableNodeIds).toEqual(["first_battle"]);
      await importRun(page, exported);
      await expect.poll(async () => (await inspectCampaign(page)).run?.nodeId).toBe("event_offer");
    }

    expect(browserErrors()).toEqual([]);
  });

  test("keeps the absent campaign path inert across Canvas/Phaser and hex/square", async ({ page }) => {
    test.setTimeout(180_000);
    const browserErrors = captureBrowserErrors(page);
    for (const { grid, renderer } of combinations) {
      await page.goto(playerUrl(port, "absent", grid, renderer));
      await waitForPlayerBoot(page);
      await expect(page.locator("#campaign-run-panel")).toBeHidden();
      expect(await inspectCampaign(page), `${grid}/${renderer} absent campaign state`).toEqual({
        active: false,
        run: null,
        pendingNodeId: null,
        availableNodeIds: []
      });
      const snapshot = await page.evaluate(() => window.__towerforgeInspect());
      expect(snapshot, `${grid}/${renderer} legacy snapshot`).not.toHaveProperty("campaign");
    }
    expect(browserErrors()).toEqual([]);
  });
});

function campaignGraph({ missionId = "tutorial_01", regionId = "forest" } = {}) {
  return {
    schemaVersion: 2,
    rogueliteProfileId: "browser_campaign",
    runResources: {
      coins: { label: "Coins" },
      relics: { label: "Relics" }
    },
    entryNodeIds: ["first_battle"],
    nodes: [
      {
        id: "first_battle",
        type: "battle",
        missionId,
        regionId,
        x: 200,
        y: 300,
        difficulty: 1,
        nextNodeIds: ["event_offer"]
      },
      {
        id: "event_offer",
        type: "event",
        label: "Event Offer",
        regionId,
        x: 400,
        y: 300,
        difficulty: 2,
        nextNodeIds: [],
        choices: [
          { id: "relic", label: "Buy relic", costs: { coins: 3 }, grants: { relics: 1 } },
          { id: "cache", label: "Take cache", costs: {}, grants: { coins: 5 } }
        ]
      }
    ]
  };
}

function buildPlayerFixture(root, { mode, grid, renderer }) {
  const name = fixtureName(mode, grid, renderer);
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  if (mode === "active") writeCampaignRuntimeFixture(projectDir);
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets.campaign = {
    ...targets.targets["web-pwa"],
    id: "campaign",
    renderer,
    webDir: "dist"
  };
  writeJson(targetsPath, targets);
  try {
    execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", "campaign"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    });
  } catch (error) {
    throw new Error(`Failed to build ${mode}/${grid}/${renderer}.\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
  }
}

function writeCampaignRuntimeFixture(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const mission = balance.missions[missionId];
  const towerId = mission.buildTowerIds[0];
  const enemyId = Object.keys(balance.enemies)[0];
  mission.mechanics = { profiles: { roguelite: "browser_campaign" } };
  mission.prepTimeUnits = 1;
  balance.towers[towerId].range = 32;
  if ("fireRate" in balance.towers[towerId].attack) balance.towers[towerId].attack.fireRate = 30;
  if ("interval" in balance.towers[towerId].attack) balance.towers[towerId].attack.interval = 0.05;
  balance.enemies[enemyId].maxHp = 1;
  balance.enemies[enemyId].speed = 0.1;
  balance.waveSets[mission.waveSetId] = [{
    id: "campaign_wave",
    label: "Campaign wave",
    groups: [{ enemyId, count: 1, spawnInterval: 0.1, startDelay: 0 }]
  }];
  writeJson(balancePath, balance);

  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      roguelite: {
        schemaVersion: 4,
        enabled: true,
        profiles: {
          browser_campaign: {
            synergies: {},
            campaign: { schemaVersion: 1 }
          }
        }
      }
    }
  });
  const worldMapPath = path.join(projectDir, "content", "world-map.json");
  const worldMap = readJson(worldMapPath);
  const regionId = worldMap.regions?.[0]?.id ?? "default";
  worldMap.campaign = campaignGraph({ missionId, regionId });
  writeJson(worldMapPath, worldMap);
}

async function openStudio(page, url) {
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(url);
  await expect(page).toHaveTitle(/TowerForge Editor/);
}

async function openRogueliteMechanics(page) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
  const card = page.locator('#mechanics-module-grid [data-mechanics-module="roguelite"]');
  await expect(card).toBeEnabled();
  if (!await card.evaluate((element) => element.classList.contains("selected"))) await card.click();
  await expect(page.locator("#mechanics-roguelite-campaign-editor")).toBeVisible();
}

function campaignState(projectDir) {
  const manifest = readJson(path.join(projectDir, "project.json"));
  const balance = readJson(path.join(projectDir, "content", "balance.json"));
  const worldMap = readJson(path.join(projectDir, "content", "world-map.json"));
  const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
  const mechanics = fs.existsSync(mechanicsPath) ? readJson(mechanicsPath) : undefined;
  const profileId = worldMap.campaign?.rogueliteProfileId;
  return {
    projectSchemaVersion: manifest.schemaVersion,
    authored: Boolean(worldMap.campaign),
    active: Boolean(
      mechanics?.modules?.roguelite?.enabled === true
      && mechanics.modules.roguelite.schemaVersion === 4
      && mechanics.modules.roguelite.profiles?.[profileId]?.campaign?.schemaVersion === 2
      && balance.missions.tutorial_01.mechanics?.profiles?.roguelite === profileId
    ),
    profileId,
    selectedProfileId: balance.missions.tutorial_01.mechanics?.profiles?.roguelite
  };
}

async function waitForPlayerBoot(page) {
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  await expect(page.locator("#boot-error")).toBeHidden();
}

async function inspectCampaign(page) {
  return page.evaluate(() => window.__towerforgeCampaignInspect());
}

async function nextPlacementPoint(page) {
  return page.evaluate(() => window.__towerforgeInspect().tiles
    .filter((tile) => tile.terrain === "buildable" && !tile.occupiedBy)
    .map((tile) => ({ coord: { q: tile.q, r: tile.r }, ...window.__towerforgeTilePoint(tile) }))
    .find((point) => {
      const picked = window.__towerforgePickPoint(point);
      return picked?.q === point.coord.q && picked?.r === point.coord.r;
    }) ?? null);
}

async function importRun(page, run) {
  await page.locator("#campaign-run-file").setInputFiles({
    name: "towerforge-campaign-run.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(run))
  });
}

async function activateNativeControl(page, locator, activation) {
  if (activation === "click") return locator.click();
  if (activation === "tap") return locator.tap();
  await locator.focus();
  await page.keyboard.press(activation === "space" ? "Space" : "Enter");
}

function fixtureName(mode, grid, renderer) {
  return `campaign_run_${mode}_${grid}_${renderer}`;
}

function playerUrl(port, mode, grid, renderer) {
  return `http://127.0.0.1:${port}/${mode}/${grid}/${renderer}/`;
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

async function freeHttpPort() {
  const probe = http.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  if (!port) return freeHttpPort();
  return port;
}

async function freeTcpPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) return freeTcpPort();
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

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function respond404(response) {
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("Not found");
}

function contentType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}
