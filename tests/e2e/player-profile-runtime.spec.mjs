import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const renderers = ["canvas", "phaser"];
const NEWER_VERSION_WARNING = "Saved progress belongs to a newer game version; session changes will not overwrite it.";

let tempRoot;
let projectDir;
let server;
let origin;

test.beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-profile-browser-"));
  projectDir = path.join(tempRoot, "profile-runtime.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
  balance.missions.gated_02 = {
    ...balance.missions.tutorial_01,
    id: "gated_02",
    label: "Gated loadout",
    buildTowerIds: ["cannon_tower"],
    abilityIds: ["path_water"]
  };
  fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`, "utf8");

  const worldMapPath = path.join(projectDir, "content", "world-map.json");
  const worldMap = JSON.parse(fs.readFileSync(worldMapPath, "utf8"));
  worldMap.missionNodes.push({
    ...worldMap.missionNodes[0],
    missionId: "gated_02",
    x: 450,
    unlockRequiresMissionIds: ["tutorial_01"]
  });
  fs.writeFileSync(worldMapPath, `${JSON.stringify(worldMap, null, 2)}\n`, "utf8");

  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
  for (const renderer of renderers) {
    const id = `profile-${renderer}`;
    targets.targets[id] = {
      ...targets.targets["web-pwa"],
      id,
      appId: `local.towerforge.profile.${renderer}`,
      renderer,
      webDir: `dist-${renderer}`
    };
  }
  fs.writeFileSync(targetsPath, `${JSON.stringify(targets, null, 2)}\n`, "utf8");

  for (const renderer of renderers) {
    execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", `profile-${renderer}`,
      "--json"
    ], {
      cwd: repoRoot,
      stdio: "pipe",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    });
  }

  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/storage.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end("<!doctype html><title>storage</title>");
      return;
    }
    const parts = decodeURIComponent(url.pathname).replace(/^\/+/, "").split("/");
    const renderer = parts.shift();
    if (!renderers.includes(renderer)) return respond404(response);
    const outputDir = path.join(projectDir, `dist-${renderer}`);
    const filePath = path.resolve(outputDir, parts.join("/") || "index.html");
    const confined = path.relative(outputDir, filePath);
    if (confined.startsWith("..") || path.isAbsolute(confined) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return respond404(response);
    }
    response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve());
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

for (const renderer of renderers) {
  test(`${renderer} migrates profiles only on explicit actions and confines both reset paths`, async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const scope = `local.towerforge.profile.${renderer}`;
    const profileKey = `towerforge:progress:${scope}`;
    const storyKey = `story_seen_${scope}:frontier_briefing`;
    const playerUrl = `${origin}/${renderer}/`;

    try {
      const legacyArray = '["tutorial_01"]';
      await seedStorage(page, { [profileKey]: legacyArray, [storyKey]: "1" });
      await bootPlayer(page, playerUrl);
      expect(await readStorage(page, profileKey)).toBe(legacyArray);
      await expect(page.locator("#difficulty-select")).toHaveValue("normal");
      await page.locator("#difficulty-select").selectOption("veteran");
      await expectCanonicalProfile(page, profileKey, "veteran");
      await page.reload();
      await waitForBoot(page);
      await expect(page.locator("#difficulty-select")).toHaveValue("veteran");

      const legacyV1 = JSON.stringify({
        version: 1,
        clearedMissionIds: ["tutorial_01"],
        starsByMission: { tutorial_01: 1 },
        metaResources: { forge_shards: 3 },
        upgradeLevels: {},
        selectedDifficultyId: "story"
      });
      await seedStorage(page, { [profileKey]: legacyV1, [storyKey]: "1" });
      await bootPlayer(page, playerUrl);
      expect(await readStorage(page, profileKey)).toBe(legacyV1);
      await expect(page.locator("#difficulty-select")).toHaveValue("story");
      await page.locator("#difficulty-select").selectOption("normal");
      await expectCanonicalProfile(page, profileKey, "normal");
      await page.reload();
      await waitForBoot(page);
      await expect(page.locator("#difficulty-select")).toHaveValue("normal");

      const migrationV2 = JSON.stringify({
        version: 2,
        clearedMissionIds: ["tutorial_01"],
        starsByMission: { tutorial_01: 1 },
        metaResources: { forge_shards: 3 },
        upgradeLevels: { sharpened_tools: 1, reinforced_core: 0 },
        selectedDifficultyId: "story"
      });
      await seedStorage(page, { [profileKey]: migrationV2, [storyKey]: "1" });
      await bootPlayer(page, playerUrl);
      expect(await readStorage(page, profileKey)).toBe(migrationV2);
      await expect(page.locator("#difficulty-select")).toHaveValue("story");
      await page.locator("#difficulty-select").selectOption("veteran");
      await expectCanonicalProfile(page, profileKey, "veteran");

      const futureRaw = JSON.stringify({
        version: 7,
        opaque: "x".repeat(1_048_577),
        marker: "future bytes stay exact"
      });
      await seedStorage(page, { [profileKey]: futureRaw, [storyKey]: "1" });
      await bootPlayer(page, playerUrl);
      await expect(page.locator("#message")).toContainText(NEWER_VERSION_WARNING);
      expect(await readStorage(page, profileKey)).toBe(futureRaw);
      await page.locator("#difficulty-select").selectOption("veteran");
      await expect(page.locator("#message")).toContainText(NEWER_VERSION_WARNING);
      expect(await readStorage(page, profileKey)).toBe(futureRaw);

      const unrelatedProfile = "towerforge:progress:unrelated-app";
      const unrelatedStory = "story_seen_unrelated-app:intro";
      await seedStorage(page, {
        [profileKey]: canonicalProfile("story", ["tutorial_01"]),
        [storyKey]: "1",
        [unrelatedProfile]: "keep-profile",
        [unrelatedStory]: "keep-story"
      });
      await bootPlayer(page, playerUrl);
      await page.locator("#mission-select").selectOption("gated_02");
      await expect(page.locator("#mission-select")).toHaveValue("gated_02");
      await expect(page.locator("#tower-select option")).toHaveCount(1);
      expect(await page.locator("#tower-select option").evaluateAll((options) => options.map((option) => option.value)))
        .toEqual(["cannon_tower"]);
      await expect(page.locator("#ability-bar button")).not.toHaveCount(0);
      await page.locator("#sell-mode").click();
      await expect(page.locator("#sell-mode")).toHaveAttribute("aria-pressed", "true");
      await page.locator("#reset-progress").click();
      expect(await readStorage(page, profileKey)).toBeNull();
      expect(await readStorage(page, storyKey)).toBe("1");
      expect(await readStorage(page, unrelatedProfile)).toBe("keep-profile");
      expect(await readStorage(page, unrelatedStory)).toBe("keep-story");
      expect(await page.evaluate(() => ({
        missionId: document.querySelector("#mission-select")?.value,
        towerOptions: [...document.querySelectorAll("#tower-select option")].map((option) => option.value),
        abilityCount: document.querySelectorAll("#ability-bar button").length,
        sellPressed: document.querySelector("#sell-mode")?.getAttribute("aria-pressed")
      }))).toEqual({
        missionId: "tutorial_01",
        towerOptions: ["arrow_tower", "cannon_tower"],
        abilityCount: 0,
        sellPressed: "false"
      });

      const corruptRaw = "{corrupt profile bytes";
      await seedStorage(page, { [profileKey]: corruptRaw, [storyKey]: "1" });
      await bootPlayer(page, playerUrl);
      await expect(page.locator("#boot-error")).toBeHidden();
      await expect(page.locator("#difficulty-select")).toBeEnabled();
      await expect(page.locator("#message")).toContainText("Saved progress could not be loaded");
      expect(await readStorage(page, profileKey)).toBe(corruptRaw);
      await page.locator("#difficulty-select").selectOption("veteran");
      await expectCanonicalProfile(page, profileKey, "veteran");

      const emergency = await context.newPage();
      const currentStoryTwo = `story_seen_${scope}:second-panel`;
      await seedStorage(emergency, {
        [profileKey]: canonicalProfile("normal"),
        [storyKey]: "1",
        [currentStoryTwo]: "1",
        [unrelatedProfile]: "keep-profile",
        [unrelatedStory]: "keep-story"
      });
      await emergency.route("**/player.mjs", (route) => route.fulfill({
        status: 200,
        contentType: "text/javascript; charset=utf-8",
        body: 'throw new Error("forced profile recovery test");'
      }));
      await emergency.goto(playerUrl);
      await expect(emergency.locator("#boot-error")).toBeVisible({ timeout: 7_000 });
      await emergency.locator("#boot-reset").click();
      await expect(emergency.locator("#boot-error")).toBeVisible({ timeout: 7_000 });
      expect(await readStorage(emergency, profileKey)).toBeNull();
      expect(await readStorage(emergency, storyKey)).toBeNull();
      expect(await readStorage(emergency, currentStoryTwo)).toBeNull();
      expect(await readStorage(emergency, unrelatedProfile)).toBe("keep-profile");
      expect(await readStorage(emergency, unrelatedStory)).toBe("keep-story");
      await emergency.close();
    } finally {
      await context.close();
    }
  });
}

async function seedStorage(page, entries) {
  await page.goto(`${origin}/storage.html`);
  await page.evaluate((values) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  }, entries);
}

async function bootPlayer(page, url) {
  await page.goto(url);
  await waitForBoot(page);
  await expect(page.locator("#boot-error")).toBeHidden();
}

async function waitForBoot(page) {
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
}

async function readStorage(page, key) {
  return page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
}

async function expectCanonicalProfile(page, key, difficultyId) {
  await expect.poll(() => readStorage(page, key)).not.toBeNull();
  const raw = await readStorage(page, key);
  const parsed = JSON.parse(raw);
  expect(parsed.version).toBe(3);
  expect(parsed.selectedDifficultyId).toBe(difficultyId);
  expect(raw).toBe(JSON.stringify(parsed));
}

function canonicalProfile(selectedDifficultyId, clearedMissionIds = []) {
  return JSON.stringify({
    version: 3,
    clearedMissionIds,
    starsByMission: {},
    metaResources: { forge_shards: 0 },
    upgradeLevels: { sharpened_tools: 0, reinforced_core: 0 },
    selectedDifficultyId
  });
}

function respond404(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
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
