import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";
import { applyPlayerTarget, getPlayerTargetRecipe, readPlayerTargets } from "../../packages/cli/lib/player-target-authoring.mjs";

const entries = ["canvas", "phaser"].flatMap(renderer => ["hex", "square"].map(grid => ({ renderer, grid, id: `${renderer}-${grid}` })));
test.describe("R23 phones", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  let root, server, origin;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tf-r23-phone-"));
    for (const entry of entries) {
      const { projectDir } = createProject({ name: entry.id, parentDir: root, templateName: "classic", gridKind: entry.grid });
      const balancePath = path.join(projectDir, "content/balance.json");
      const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
      for (const enemy of Object.values(balance.enemies)) { enemy.maxHp = 5000; enemy.speed = 0.01; }
      balance.enemies.r23_probe = { id: "r23_probe", label: "Probe", maxHp: 5, speed: 2, coreDamage: 1, coinReward: 1, reward: { coins: 1 }, color: 0x66aa88 };
      balance.towers.r23_probe = { id: "r23_probe", label: "Probe tower", cost: { coins: 1 }, footprintRadius: 0, range: 100, attack: { kind: "single", fireRate: 1, damagePerStack: 100, startingStacks: 1, maxStacks: 1, upgradeCost: 1 } };
      balance.waveSets.r23_result = [{ id: "result", label: "Result", groups: [{ enemyId: "r23_probe", count: 1, spawnInterval: 1, startDelay: 2 }] }];
      balance.missions.r23_result = { ...balance.missions[balance.defaultMissionId], id: "r23_result", label: "Result check", waveSetId: "r23_result", buildTowerIds: ["r23_probe"], startingCoreHp: 1, startingResources: { coins: 50 } };
      fs.writeFileSync(balancePath, JSON.stringify(balance));
      const recipe = getPlayerTargetRecipe(projectDir, "responsive_web_mobile", "responsive");
      const target = { ...recipe.target, renderer: entry.renderer, appId: `local.r23.${entry.id}`, locale: "en" };
      expect(applyPlayerTarget(projectDir, "responsive", target, { ifRevision: readPlayerTargets(projectDir).revision }).ok).toBe(true);
      execFileSync(process.execPath, ["packages/cli/build.mjs", "--project", projectDir, "--target", "responsive", "--json"], { cwd: path.resolve("."), stdio: "pipe" });
    }
    server = http.createServer((request, response) => {
      const parts = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).split("/").filter(Boolean);
      const id = parts.shift();
      if (!entries.some(entry => entry.id === id)) { response.writeHead(404); response.end(); return; }
      const dir = path.join(root, `${id}.tdproj`, "dist-responsive");
      const file = path.resolve(dir, parts.join("/") || "index.html");
      if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
      response.setHeader("Content-Type", ({ ".mjs": "text/javascript", ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  test.afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });
  for (const entry of entries) test(`${entry.id}: touch HUD, battle, background, Continue and corrupt fallback`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/${entry.id}/`);
    await boot(page);
    await expect(page).toHaveTitle(/Game/);
    await fit(page);
    const tile = await page.evaluate(() => {
      const rect = document.getElementById("playfield").getBoundingClientRect();
      return window.__towerforgeInspect().tiles.filter(tile => tile.terrain === "buildable" && !tile.occupiedBy)
        .map(tile => ({ coord: { q: tile.q, r: tile.r }, point: window.__towerforgeTilePoint(tile) }))
        .find(({ point }) => point && point.x > rect.left + 20 && point.x < rect.right - 20 && point.y > rect.top + 30 && point.y < rect.bottom - 30);
    });
    expect(tile).toBeTruthy();
    await page.touchscreen.tap(tile.point.x, tile.point.y);
    await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().towers.length)).toBe(1);
    await page.locator("#start-wave").tap();
    await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().enemies.length)).toBeGreaterThan(0);
    // These slow durable enemies cannot clear a wave here; no further action triggers a save.
    await expect.poll(async () => (await slots(page, entry)).latest?.checkpoint?.state?.missionElapsed ?? 0, { timeout: 10_000 }).toBeGreaterThan(20);
    await page.locator("#pause-run").tap();
    await expect(page.locator("#speed")).toHaveValue("0");
    const elapsed = await page.evaluate(() => window.__towerforgeInspect().missionElapsed);
    await expect.poll(async () => (await slots(page, entry)).latest?.checkpoint?.state?.missionElapsed).toBe(elapsed);
    const saved = await slots(page, entry);
    expect(saved.latest.checkpoint.state.towers).toHaveLength(1);
    await page.screenshot({ path: info.outputPath("portrait.png") });
    await page.setViewportSize({ width: 844, height: 390 });
    await fit(page);
    await page.screenshot({ path: info.outputPath("landscape.png") });
    // Entering and leaving background must neither advance the battle nor resume playback.
    await page.locator("#pause-run").tap();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator("#speed")).toHaveValue("0");
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
    await expect(page.locator("#speed")).toHaveValue("0");
    await page.reload();
    await boot(page);
    // A fresh, unplayed page must not overwrite the previous battle on its periodic timer.
    await page.waitForTimeout(5200);
    const expectedState = (await slots(page, entry)).latest.checkpoint.state;
    await page.locator("#responsive-more").tap();
    await page.locator("#desktop-continue").tap();
    await expect(page.locator("#speed")).toHaveValue("0");
    await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().towers.length)).toBe(1);
    expect(await page.evaluate(() => window.__towerforgeInspect().missionElapsed)).toBeGreaterThanOrEqual(elapsed);
    const restoredState = await page.evaluate(() => window.__towerforgeInspect());
    expect(restoredState.resources).toEqual(expectedState.resources);
    expect(restoredState.coreHp).toBe(expectedState.coreHp);
    expect(restoredState.enemies.map(e => ({ id: e.id, hp: e.hp }))).toEqual(expectedState.enemies.map(e => ({ id: e.id, hp: e.hp })));
    const frozen = await page.evaluate(() => window.__towerforgeInspect().missionElapsed);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__towerforgeInspect().missionElapsed)).toBe(frozen);
    const recovered = await slots(page, entry, true);
    expect(recovered.backup).toBeTruthy();
    await page.reload();
    await boot(page);
    await page.locator("#responsive-more").tap();
    await page.locator("#desktop-continue").tap();
    await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().missionElapsed)).toBe(recovered.backup.checkpoint.state.missionElapsed);
    await expect(page.locator("#boot-error")).toBeHidden();
    // Complete a real mission, reload its profile, then restart it without a tower and lose.
    await page.locator("#responsive-more").tap();
    await page.locator("#mission-select").selectOption("r23_result");
    await page.locator("#responsive-menu-close").tap();
    await page.setViewportSize({ width: 390, height: 844 });
    await fit(page);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const resultTile = await page.evaluate(() => {
      const rect = document.getElementById("playfield").getBoundingClientRect();
      return window.__towerforgeInspect().tiles.filter(t => t.terrain === "buildable" && !t.occupiedBy)
        .map(t => window.__towerforgeTilePoint(t))
        .find(point => point && point.x > rect.left + 40 && point.x < rect.right - 40 && point.y > rect.top + 40 && point.y < rect.bottom - 40);
    });
    await page.touchscreen.tap(resultTile.x, resultTile.y);
    await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().towers.length)).toBe(1);
    if (await page.locator("#speed").inputValue() === "0") await page.locator("#pause-run").tap();
    await page.locator("#start-wave").tap();
    await expect(page.locator("#desktop-result-dialog")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#desktop-result-copy")).toHaveText("Victory");
    await expect.poll(async () => (await slots(page, entry)).profile).toContain("r23_result");
    const profile = (await slots(page, entry)).profile;
    await page.reload();
    await boot(page);
    expect((await slots(page, entry)).profile).toBe(profile);
    await page.locator("#responsive-more").tap();
    await page.locator("#mission-select").selectOption("r23_result");
    await page.locator("#responsive-menu-close").tap();
    if (await page.locator("#speed").inputValue() === "0") await page.locator("#pause-run").tap();
    await page.locator("#start-wave").tap();
    await expect(page.locator("#desktop-result-dialog")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#desktop-result-copy")).toHaveText("Defeat");
    await page.locator("#desktop-result-close").tap();
    await page.locator("#responsive-more").tap();
    await page.locator("#reset-run").tap();
    await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().outcome)).toBe("playing");
    expect(errors).toEqual([]);
    await page.evaluate(() => window.__towerforgeDispose?.());
  });
});

async function boot(page) {
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  await page.locator("#towerforge-engine-splash").waitFor({ state: "hidden" });
  if (await page.locator("#story-overlay").isVisible()) await page.locator("#story-skip").tap();
  await expect(page.locator("#responsive-status")).toBeVisible();
}
async function fit(page) {
  const { width, height } = page.viewportSize();
  for (const id of ["stat-core", "stat-resources", "stat-wave", "pause-run", "responsive-more", "tower-select", "start-wave", "sell-mode", "desktop-upgrade"]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
    const b = await page.locator(`#${id}`).boundingBox();
    expect(b.x, id).toBeGreaterThanOrEqual(0);
    expect(b.y, id).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, id).toBeLessThanOrEqual(width + 1);
    expect(b.y + b.height, id).toBeLessThanOrEqual(height + 1);
    if (!id.startsWith("stat-")) { expect(b.width, id).toBeGreaterThanOrEqual(44); expect(b.height, id).toBeGreaterThanOrEqual(44); }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height + 1);
}
async function slots(page, entry, corrupt = false) {
  return page.evaluate(async ({ id, corrupt }) => {
    const scope = `local.r23.${id}`;
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open(`towerforge-player-${scope}`); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const tx = db.transaction("player-data", corrupt ? "readwrite" : "readonly");
      const store = tx.objectStore("player-data");
      const read = key => new Promise((resolve, reject) => { const request = store.get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const base = `towerforge:session:${scope}`;
      const [head, zero, one, profile] = await Promise.all([read(`${base}:head`), read(`${base}:slot-0`), read(`${base}:slot-1`), read(`towerforge:progress:${scope}`)]);
      const raw = [zero, one], index = head === "1" ? 1 : 0;
      const parse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
      const latest = parse(raw[index]);
      const backup = parse(raw[1 - index]);
      if (corrupt) {
        store.put("broken-json", `${base}:slot-${index}`);
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      }
      return { latest, backup, profile };
    } finally { db.close(); }
  }, { id: entry.id, corrupt });
}
