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
const activations = ["click", "enter", "space", "tap"];

test.use({ hasTouch: true });

test.describe("R4.3 generated-player wave draft", () => {
  let root;
  let server;
  let port;

  test.beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-wave-draft-player-"));
    for (const combination of combinations) buildPlayerFixture(root, { mode: "active", ...combination });
    buildPlayerFixture(root, { mode: "absent", grid: "hex", renderer: "canvas" });
    buildPlayerFixture(root, { mode: "no-draft", grid: "square", renderer: "phaser" });

    port = await freeHttpPort();
    server = http.createServer((request, response) => {
      const relative = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname)
        .replace(/^\/+/, "");
      const [mode, grid, renderer, ...parts] = relative.split("/");
      if (!["active", "absent", "no-draft"].includes(mode)
        || !["hex", "square"].includes(grid)
        || !["canvas", "phaser"].includes(renderer)) return respond404(response);
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

  test("offers exactly three unique choices and resumes prep across Canvas/Phaser and hex/square", async ({ page }) => {
    test.setTimeout(180_000);
    const browserErrors = captureBrowserErrors(page);

    for (const [{ grid, renderer }, activation] of combinations.map((entry, index) => [entry, activations[index]])) {
      await page.goto(playerUrl(port, "active", grid, renderer));
      await waitForPlayerBoot(page);

      const placement = await nextPlacementPoint(page);
      expect(placement, `${grid}/${renderer} needs a draft-wave tower`).not.toBeNull();
      await page.mouse.click(placement.x, placement.y);
      await expect(page.locator("#stat-towers")).toHaveText("1");
      await page.locator("#start-wave").click();

      const panel = page.locator("#wave-draft");
      const buttons = panel.locator("[data-draft-card-id]");
      await expect(panel, `${grid}/${renderer} wave draft panel`).toBeVisible({ timeout: 20_000 });
      await expect(buttons).toHaveCount(3);
      const cardIds = await buttons.evaluateAll((nodes) => nodes.map((node) => node.dataset.draftCardId));
      expect(new Set(cardIds).size, `${grid}/${renderer} draft choices must be unique`).toBe(3);
      expect(cardIds.every((cardId) => typeof cardId === "string" && cardId.length > 0)).toBe(true);

      const before = await inspectDraftState(page);
      expect(before.draft).toMatchObject({ pendingOffer: { options: expect.any(Array) }, selections: [] });
      expect(before.draft.pendingOffer.options).toHaveLength(3);
      const chosenCardId = cardIds[0];
      const chosenButton = panel.locator(`[data-draft-card-id="${chosenCardId}"]`);
      await activateNativeControl(page, chosenButton, activation);

      await expect(panel, `${grid}/${renderer} panel must close after ${activation}`).toBeHidden();
      await expect.poll(() => inspectDraftState(page), {
        message: `${grid}/${renderer} choice must enter the authoritative snapshot`
      }).toMatchObject({
        draft: {
          pendingOffer: null,
          selections: [{ cardId: chosenCardId, count: 1 }]
        }
      });
      await expect.poll(async () => (await inspectDraftState(page)).missionElapsed, {
        message: `${grid}/${renderer} prep clock must resume after the choice`
      }).toBeGreaterThan(before.missionElapsed);
      const after = await inspectDraftState(page);
      expect(JSON.stringify(after.draft)).not.toBe(JSON.stringify(before.draft));
    }

    expect(browserErrors()).toEqual([]);
  });

  test("absent and selected v3-without-draft fixtures keep the draft panel and state out of the legacy path", async ({ page }) => {
    const browserErrors = captureBrowserErrors(page);

    await page.goto(playerUrl(port, "absent", "hex", "canvas"));
    await waitForPlayerBoot(page);
    await expect(page.locator("#wave-draft")).toBeHidden();
    expect((await page.evaluate(() => window.__towerforgeInspect())).roguelite).toBeUndefined();

    await page.goto(playerUrl(port, "no-draft", "square", "phaser"));
    await waitForPlayerBoot(page);
    const placement = await nextPlacementPoint(page);
    expect(placement).not.toBeNull();
    await page.mouse.click(placement.x, placement.y);
    await page.locator("#start-wave").click();
    await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().clearedWaveCount), {
      timeout: 20_000
    }).toBeGreaterThanOrEqual(1);
    await expect(page.locator("#wave-draft")).toBeHidden();
    expect(await page.evaluate(() => window.__towerforgeInspect().roguelite?.draft)).toBeUndefined();

    expect(browserErrors()).toEqual([]);
  });
});

test.describe("R4.3 Studio Playtest wave draft", () => {
  let root;
  let projectDir;
  let studioProcess;
  let studioUrl;
  let serverOutput = "";

  test.beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-wave-draft-studio-"));
    projectDir = path.join(root, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
    writeMigratedProjectFiles(projectDir, migrated.files);
    writeDraftRuntimeFixture(projectDir);

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

  test("chooses a real v3 draft option from Studio Playtest", async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    await page.addInitScript(() => {
      localStorage.setItem("towerforge:welcomed", "1");
      localStorage.setItem("towerforge:language", "en");
    });
    await page.goto(studioUrl);
    await expect(page).toHaveTitle(/TowerForge Editor/);
    await page.getByRole("tab", { name: /Playtest/ }).click();
    await expect(page.locator("#playtest-stage")).toBeVisible();

    await clickHexTile(page, "#playtest-canvas", { q: 12, r: 8 }, { width: 15, height: 20 });
    await expect(page.locator("#pt-towers-count")).toHaveText("1");
    await page.locator("#pt-speed").fill("4");
    await page.locator("#pt-start").click();

    const panel = page.locator("#pt-wave-draft");
    const buttons = panel.locator("[data-pt-draft-card-id]");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(buttons).toHaveCount(3);
    const ids = await buttons.evaluateAll((nodes) => nodes.map((node) => node.dataset.ptDraftCardId));
    expect(new Set(ids).size).toBe(3);

    await buttons.first().focus();
    await page.keyboard.press("Enter");
    await expect(panel).toBeHidden();
    await expect(page.locator("#pt-msg")).toHaveText("Wave upgrade selected.");
    expect(browserErrors()).toEqual([]);
  });
});

function buildPlayerFixture(root, { mode, grid, renderer }) {
  const name = fixtureName(mode, grid, renderer);
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  if (mode !== "absent") writeDraftRuntimeFixture(projectDir, mode === "active");

  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets.draft = {
    ...targets.targets["web-pwa"],
    id: "draft",
    renderer,
    webDir: "dist"
  };
  writeJson(targetsPath, targets);
  try {
    execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", "draft"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    });
  } catch (error) {
    throw new Error(`Failed to build ${mode}/${grid}/${renderer}.\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
  }
}

function writeDraftRuntimeFixture(projectDir, activeDraft = true) {
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
  mission.mechanics = { profiles: { roguelite: "browser_draft" } };
  mission.prepTimeUnits = 10;
  balance.towers[towerId].range = 32;
  if ("fireRate" in balance.towers[towerId].attack) balance.towers[towerId].attack.fireRate = 30;
  if ("interval" in balance.towers[towerId].attack) balance.towers[towerId].attack.interval = 0.05;
  balance.enemies[enemyId].maxHp = 1;
  balance.enemies[enemyId].speed = 0.1;
  balance.waveSets[mission.waveSetId] = [1, 2].map((number) => ({
    id: `draft_wave_${number}`,
    label: `Draft wave ${number}`,
    groups: [{ enemyId, count: 1, spawnInterval: 0.1, startDelay: 0 }]
  }));
  writeJson(balancePath, balance);

  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      roguelite: {
        schemaVersion: 3,
        enabled: true,
        profiles: {
          browser_draft: {
            synergies: {},
            ...(activeDraft ? { draft: draftBlock() } : {})
          }
        }
      }
    }
  });
}

function draftBlock() {
  return {
    definitions: Object.fromEntries([
      ["ember", "Ember"],
      ["frost", "Frost"],
      ["storm", "Storm"],
      ["bloom", "Bloom"]
    ].map(([cardId, label], index) => [cardId, {
      label,
      effects: [{
        kind: "modifier",
        scope: { kind: "all_towers" },
        modifier: { target: "damage", operation: "additive_ratio", value: (index + 1) / 10 }
      }]
    }])),
    pools: {
      starter: {
        entries: ["ember", "frost", "storm", "bloom"].map((cardId, index) => ({
          cardId,
          weight: index + 1
        }))
      }
    },
    defaultPoolId: "starter"
  };
}

async function waitForPlayerBoot(page) {
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  await expect(page.locator("#boot-error")).toBeHidden();
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

async function inspectDraftState(page) {
  return page.evaluate(() => {
    const snapshot = window.__towerforgeInspect();
    return {
      missionElapsed: snapshot.missionElapsed,
      draft: snapshot.roguelite?.draft
    };
  });
}

async function activateNativeControl(page, locator, activation) {
  if (activation === "click") return locator.click();
  if (activation === "tap") return locator.tap();
  await locator.focus();
  await page.keyboard.press(activation === "space" ? "Space" : "Enter");
}

async function clickHexTile(page, selector, coord, mapSize) {
  const canvas = page.locator(selector);
  const position = await canvas.evaluate((element, args) => {
    const radius = Math.min(
      element.width / ((args.mapSize.width + 1) * 1.65),
      element.height / ((args.mapSize.height + 1) * 1.45)
    );
    const x = radius * 1.5 + args.coord.q * radius * 1.48 + (args.coord.r % 2) * radius * 0.74;
    const y = radius * 1.5 + args.coord.r * radius * 1.28;
    const rect = element.getBoundingClientRect();
    return { x: x / (element.width / rect.width), y: y / (element.height / rect.height) };
  }, { coord, mapSize });
  await canvas.click({ position });
}

function fixtureName(mode, grid, renderer) {
  return `wave_draft_${mode}_${grid}_${renderer}`;
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
