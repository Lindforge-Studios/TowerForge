import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const combinations = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
));
const modes = ["handoff", "marker-v1", "absent"];
const activations = ["click", "enter", "space", "tap"];

test.use({ hasTouch: true });

test.describe("R4.4C generated-player campaign battle handoff", () => {
  let root;
  let server;
  let port;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-campaign-handoff-e2e-"));
    for (const { grid, renderer } of combinations) {
      for (const mode of modes) buildFixture(root, { mode, grid, renderer });
    }
    port = await freeHttpPort();
    server = http.createServer((request, response) => {
      const relative = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname)
        .replace(/^\/+/, "");
      const [mode, grid, renderer, ...parts] = relative.split("/");
      if (!modes.includes(mode) || !["hex", "square"].includes(grid)
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

  test("imports, resets, and settles the same carried loadout on Canvas/Phaser × hex/square", async ({ page }) => {
    test.setTimeout(300_000);
    const browserErrors = captureBrowserErrors(page);

    for (const [{ grid, renderer }, activation, draftActivation, socketActivation] of combinations.map((entry, index) => [
      entry,
      activations[index],
      activations[(index + 1) % activations.length],
      activations[(index + 2) % activations.length]
    ])) {
      await page.goto(playerUrl(port, "handoff", grid, renderer));
      await waitForBoot(page);
      await expect(page.locator("#campaign-run-panel"), `${grid}/${renderer} active panel`).toBeVisible();

      const imported = importedRun(`${grid}-${renderer}`);
      const migrated = { ...imported, version: 2, arsenal: { moduleInventory: [] } };
      await importRun(page, imported);
      await expect.poll(async () => (await inspectCampaign(page)).run).toMatchObject(migrated);

      const node = page.locator('#campaign-run-nodes button[data-state="available"]');
      await expect(node).toHaveCount(1);
      await activateNativeControl(page, node, activation);
      await expect.poll(async () => (await inspectCampaign(page)).pendingNodeId).toBe("battle");
      await expect.poll(() => inspectBattleLoadout(page)).toEqual({
        artifacts: [{ instanceId: "imported_artifact", artifactId: "scope", socket: null }],
        draft: [{ cardId: "ember", count: 1 }]
      });

      await page.locator("#reset-run").click();
      await expect.poll(() => inspectBattleLoadout(page)).toEqual({
        artifacts: [{ instanceId: "imported_artifact", artifactId: "scope", socket: null }],
        draft: [{ cardId: "ember", count: 1 }]
      });
      await expect.poll(async () => (await inspectCampaign(page)).run).toMatchObject(migrated);

      const placement = await nextPlacementPoint(page);
      expect(placement, `${grid}/${renderer} buildable tower tile`).not.toBeNull();
      await page.mouse.click(placement.x, placement.y);
      await expect(page.locator("#stat-towers")).toHaveText("1");
      const socket = page.locator('[data-artifact-action="socket"]');
      await expect(socket, `${grid}/${renderer} initial carried socket action`).toBeEnabled();
      await activateNativeControl(page, socket, socketActivation);
      await expect.poll(() => inspectBattleLoadout(page)).toEqual({
        artifacts: [{
          instanceId: "imported_artifact",
          artifactId: "scope",
          socket: { towerId: "tower_1", towerTypeId: "arrow", slotId: "optic" }
        }],
        draft: [{ cardId: "ember", count: 1 }]
      });
      await page.locator("#reset-run").click();
      await expect.poll(() => inspectBattleLoadout(page)).toEqual({
        artifacts: [{ instanceId: "imported_artifact", artifactId: "scope", socket: null }],
        draft: [{ cardId: "ember", count: 1 }]
      });
      const replayPlacement = await nextPlacementPoint(page);
      expect(replayPlacement, `${grid}/${renderer} reset buildable tower tile`).not.toBeNull();
      await page.mouse.click(replayPlacement.x, replayPlacement.y);
      await expect(page.locator("#stat-towers")).toHaveText("1");
      await page.locator("#speed").fill("4");
      await page.locator("#start-wave").click();

      const draft = page.locator("#wave-draft");
      await expect(draft, `${grid}/${renderer} draft offer`).toBeVisible({ timeout: 30_000 });
      const draftOption = draft.locator("[data-draft-card-id]").first();
      await activateNativeControl(page, draftOption, draftActivation);

      await expect.poll(async () => (await inspectCampaign(page)).run?.nodeId, {
        timeout: 40_000,
        message: `${grid}/${renderer} victory must settle the handoff exactly once`
      }).toBe("battle");
      const settled = await inspectCampaign(page);
      expect(settled.pendingNodeId).toBeNull();
      expect(settled.run.deck[0]).toEqual({ instanceId: "imported_card", cardId: "ember" });
      expect(settled.run.deck).toHaveLength(2);
      expect(settled.run.deck[1].instanceId).toMatch(/^campaign:[^:]+:card:[1-9]\d*$/);
      expect(settled.run.artifacts[0]).toEqual({ instanceId: "imported_artifact", artifactId: "scope" });
      expect(settled.run.artifacts).toHaveLength(3);
      for (const artifact of settled.run.artifacts.slice(1)) {
        expect(artifact.instanceId).toMatch(/^campaign:[^:]+:artifact:[1-9]\d*$/);
        expect(artifact.artifactId).toBe("scope");
      }
      expect(await persistedProfile(page)).toMatchObject({
        version: 3,
        clearedMissionIds: ["mission_1"]
      });
    }
    expect(browserErrors()).toEqual([]);
  });

  test("keeps marker v1 and absent campaigns on their legacy paths across the renderer/grid matrix", async ({ page }) => {
    test.setTimeout(180_000);
    const browserErrors = captureBrowserErrors(page);
    for (const { grid, renderer } of combinations) {
      await page.goto(playerUrl(port, "marker-v1", grid, renderer));
      await waitForBoot(page);
      await importRun(page, importedRun(`legacy-${grid}-${renderer}`));
      const node = page.locator('#campaign-run-nodes button[data-state="available"]');
      await node.click();
      await expect.poll(() => inspectBattleLoadout(page)).toEqual({ artifacts: [], draft: [] });
      await page.locator("#reset-run").click();
      await expect.poll(() => inspectBattleLoadout(page)).toEqual({ artifacts: [], draft: [] });
      expect((await inspectCampaign(page)).run).toMatchObject({
        deck: [{ instanceId: "imported_card", cardId: "ember" }],
        artifacts: [{ instanceId: "imported_artifact", artifactId: "scope" }]
      });

      await page.goto(playerUrl(port, "absent", grid, renderer));
      await waitForBoot(page);
      await expect(page.locator("#campaign-run-panel")).toBeHidden();
      expect(await inspectCampaign(page)).toEqual({
        active: false,
        run: null,
        pendingNodeId: null,
        availableNodeIds: []
      });
      expect(await inspectBattleLoadout(page)).toEqual({ artifacts: [], draft: [] });
    }
    expect(browserErrors()).toEqual([]);
  });
});

function buildFixture(root, { mode, grid, renderer }) {
  const name = fixtureName(mode, grid, renderer);
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  writeRuntimeFixture(projectDir, mode);
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets.handoff = {
    ...targets.targets["web-pwa"],
    id: "handoff",
    renderer,
    webDir: "dist"
  };
  writeJson(targetsPath, targets);
  try {
    execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", "handoff"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    });
  } catch (error) {
    throw new Error(`Failed to build ${mode}/${grid}/${renderer}.\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
  }
}

function writeRuntimeFixture(projectDir, mode) {
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
  mission.mechanics = { profiles: { roguelite: "handoff" } };
  mission.prepTimeUnits = 1;
  balance.towers[towerId].range = 32;
  if ("damagePerStack" in balance.towers[towerId].attack) balance.towers[towerId].attack.damagePerStack = 100;
  if ("damage" in balance.towers[towerId].attack) balance.towers[towerId].attack.damage = 100;
  if ("fireRate" in balance.towers[towerId].attack) balance.towers[towerId].attack.fireRate = 30;
  if ("interval" in balance.towers[towerId].attack) balance.towers[towerId].attack.interval = 0.05;
  balance.enemies[enemyId].maxHp = 1;
  balance.enemies[enemyId].speed = 0.01;
  balance.waveSets[mission.waveSetId] = [1, 2].map((number) => ({
    id: `handoff_wave_${number}`,
    label: `Handoff wave ${number}`,
    groups: [{ enemyId, count: 1, spawnInterval: 0.1, startDelay: 0 }]
  }));
  writeJson(balancePath, balance);

  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      roguelite: {
        schemaVersion: 4,
        enabled: true,
        profiles: {
          handoff: {
            synergies: {},
            artifacts: {
              definitions: { scope: { label: "Scope", slotType: "scope", modifiers: [] } },
              towerSlots: { [towerId]: [{ slotId: "optic", slotType: "scope" }] },
              bossLootTables: { [enemyId]: { rolls: 1, entries: [{ artifactId: "scope", weight: 1 }] } }
            },
            draft: draftBlock(),
            ...(mode === "handoff" ? { campaign: { schemaVersion: 2 } }
              : mode === "marker-v1" ? { campaign: { schemaVersion: 1 } } : {})
          }
        }
      }
    }
  });

  if (mode !== "absent") {
    const worldMapPath = path.join(projectDir, "content", "world-map.json");
    const worldMap = readJson(worldMapPath);
    const regionId = worldMap.regions?.[0]?.id ?? "default";
    worldMap.campaign = {
      schemaVersion: 1,
      rogueliteProfileId: "handoff",
      entryNodeIds: ["battle"],
      nodes: [{
        id: "battle", type: "battle", missionId, regionId,
        x: 200, y: 300, difficulty: 1, nextNodeIds: []
      }]
    };
    writeJson(worldMapPath, worldMap);
  }
}

function draftBlock() {
  const values = { ember: 0.1, frost: 0.2, storm: 0.3, bloom: 0.4 };
  const definitions = Object.fromEntries(Object.keys(values).map((cardId) => [
    cardId,
    {
      label: cardId[0].toUpperCase() + cardId.slice(1),
      effects: [{
        kind: "modifier",
        scope: { kind: "all_towers" },
        modifier: { target: "damage", operation: "additive_ratio", value: values[cardId] }
      }]
    }
  ]));
  return {
    definitions,
    pools: {
      default: {
        entries: Object.keys(definitions).map((cardId) => ({ cardId, weight: 1 }))
      }
    },
    defaultPoolId: "default"
  };
}

function importedRun(seed) {
  return {
    version: 1,
    seed,
    nodeId: null,
    deck: [{ instanceId: "imported_card", cardId: "ember" }],
    artifacts: [{ instanceId: "imported_artifact", artifactId: "scope" }],
    runResources: {}
  };
}

async function importRun(page, run) {
  await page.locator("#campaign-run-file").setInputFiles({
    name: "towerforge-campaign-run.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(run))
  });
}

async function inspectCampaign(page) {
  return page.evaluate(() => window.__towerforgeCampaignInspect());
}

async function inspectBattleLoadout(page) {
  return page.evaluate(() => {
    const roguelite = window.__towerforgeInspect().roguelite;
    return {
      artifacts: (roguelite?.artifacts?.inventory ?? []).map(({ instanceId, artifactId, socket }) => ({
        instanceId, artifactId, socket
      })),
      draft: (roguelite?.draft?.selections ?? []).map(({ cardId, count }) => ({ cardId, count }))
    };
  });
}

async function persistedProfile(page) {
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("towerforge:progress:")) continue;
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    }
    return null;
  });
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

async function activateNativeControl(page, locator, activation) {
  if (activation === "click") return locator.click();
  if (activation === "tap") return locator.tap();
  await locator.focus();
  await page.keyboard.press(activation === "space" ? "Space" : "Enter");
}

async function waitForBoot(page) {
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  await expect(page.locator("#boot-error")).toBeHidden();
}

function fixtureName(mode, grid, renderer) {
  return `campaign_handoff_${mode}_${grid}_${renderer}`;
}

function playerUrl(port, mode, grid, renderer) {
  return `http://127.0.0.1:${port}/${mode}/${grid}/${renderer}/`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

async function freeHttpPort() {
  const probe = http.createServer();
  await new Promise((resolve, reject) => probe.listen(0, "127.0.0.1", (error) => (
    error ? reject(error) : resolve()
  )));
  const address = probe.address();
  const result = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  if (!result) return freeHttpPort();
  return result;
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

function respond404(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}
