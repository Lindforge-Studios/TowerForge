import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.describe("R22 Splash Studio guarded authoring acceptance", () => {
  let root;
  let projectDir;
  let studioProcess;
  let studioUrl;
  let studioOutput;

  test.beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r22-splash-studio-"));
    projectDir = path.join(root, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const port = await freePort();
    studioUrl = `http://127.0.0.1:${port}`;
    studioOutput = "";
    studioProcess = spawn(process.execPath, [
      path.join(repoRoot, "packages", "studio", "server.mjs"), "--project", projectDir
    ], {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(port), TOWERFORGE_BUNDLED_RUNTIME: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const capture = (chunk) => { studioOutput = `${studioOutput}${chunk}`.slice(-20_000); };
    studioProcess.stdout.on("data", capture);
    studioProcess.stderr.on("data", capture);
    await waitForHttp(`${studioUrl}/api/project`, studioProcess, () => studioOutput);
  });

  test.afterEach(async () => {
    await stopProcess(studioProcess);
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  test("imports, previews, saves, reloads, reorders, disables and re-enables an opt-in playlist", async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      localStorage.setItem("towerforge:welcomed", "1");
      localStorage.setItem("towerforge:language", "en");
    });
    await page.goto(studioUrl);
    await expect(page).toHaveTitle(/TowerForge Editor/);
    expect(fs.existsSync(path.join(projectDir, "content", "splashes.json"))).toBe(false);
    expect(readJson(path.join(projectDir, "project.json")).schemaVersion).toBe(1);
    expect(readJson(path.join(projectDir, "build-targets.json")).schemaVersion).toBe(1);

    await page.locator('[data-tab="splashes"]').click();
    await expect(page.locator('[data-tab="splashes"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#splash-engine-slot")).toContainText("Made with TowerForge");
    await expect(page.locator("#splash-engine-slot")).toContainText(/locked/i);
    await expect(page.locator("#splash-target-picker")).toHaveValue("web-pwa");

    await page.locator("#splash-import-source").fill("assets/backgrounds/frontier-before-battle.png");
    await page.locator("#splash-import-target").fill("splashes/studio-e2e.png");
    await page.locator("#splash-import-id").fill("studio_e2e");
    await page.locator("#btn-splash-import-asset").click();
    await expect(page.locator("#splash-sprite-id")).toHaveValue("studio_e2e");
    await page.locator("#splash-accessible-label").fill("R22 browser studio");
    await page.locator("#splash-caption").fill("A guarded project splash");

    await page.locator("#btn-splash-preview").click();
    await expect(page.locator("#splash-preview-result")).toContainText(/"ok"\s*:\s*true/i);
    await expect(page.locator("#btn-splash-apply")).toBeEnabled();
    await page.locator("#btn-splash-apply").click();
    await expect.poll(() => readBuildTargets(projectDir).targets["web-pwa"].splashPlaylistId).toBe("studio-intro");
    expect(readJson(path.join(projectDir, "project.json")).schemaVersion).toBe(5);
    expect(readBuildTargets(projectDir).schemaVersion).toBe(2);
    expect(readSplashes(projectDir).playlists["studio-intro"].items).toHaveLength(1);

    await page.reload();
    await page.locator('[data-tab="splashes"]').click();
    await expect(page.locator("#splash-playlist-picker")).toHaveValue("studio-intro");
    await expect(page.locator("#splash-sprite-id")).toHaveValue("studio_e2e");
    await expect(page.locator("#splash-accessible-label")).toHaveValue("R22 browser studio");

    await page.locator("#btn-splash-item-add").click();
    await expect(page.locator("#splash-timeline [data-splash-item-id]")).toHaveCount(2);
    await page.locator("#splash-sprite-id").selectOption("studio_e2e");
    await page.locator("#splash-accessible-label").fill("R22 publisher");
    await page.locator('[data-splash-item-id="splash"]').dragTo(page.locator('[data-splash-item-id="studio"]'));
    await expect(page.locator("#splash-timeline [data-splash-item-id]").first()).toHaveAttribute("data-splash-item-id", "splash");
    await page.locator("#btn-splash-preview").click();
    await expect(page.locator("#splash-preview-result")).toContainText(/"ok"\s*:\s*true/i);
    await page.locator("#btn-splash-apply").click();
    await expect.poll(() => readSplashes(projectDir).playlists["studio-intro"].items.map((item) => item.id))
      .toEqual(["splash", "studio"]);

    const catalogBeforeDisable = readSplashes(projectDir);
    const visualsBeforeDisable = readJson(path.join(projectDir, "content", "visuals.json"));
    const assetPath = path.join(projectDir, "assets", "splashes", "studio-e2e.png");
    expect(fs.existsSync(assetPath)).toBe(true);
    await page.locator("#btn-splash-disable").click();
    await expect.poll(() => readBuildTargets(projectDir).targets["web-pwa"].splashPlaylistId).toBeUndefined();
    expect(readSplashes(projectDir)).toEqual(catalogBeforeDisable);
    expect(readJson(path.join(projectDir, "content", "visuals.json"))).toEqual(visualsBeforeDisable);
    expect(fs.existsSync(assetPath)).toBe(true);

    await page.locator("#btn-splash-preview").click();
    await expect(page.locator("#splash-preview-result")).toContainText(/"ok"\s*:\s*true/i);
    await page.locator("#btn-splash-apply").click();
    await expect.poll(() => readBuildTargets(projectDir).targets["web-pwa"].splashPlaylistId).toBe("studio-intro");
    expect(readSplashes(projectDir)).toEqual(catalogBeforeDisable);
  });

  test("returns 409 for a stale composite revision before backup or source mutation", async ({ request }) => {
    const firstRead = await request.get(`${studioUrl}/api/splashes/read`);
    expect(firstRead.ok()).toBe(true);
    const staleRevision = (await firstRead.json()).revision;
    const imported = await request.post(`${studioUrl}/api/assets/import`, { data: {
      sourcePath: "assets/backgrounds/frontier-before-battle.png",
      targetPath: "splashes/api-e2e.png",
      id: "api_splash",
      kind: "sprite",
      usage: "splash"
    } });
    expect(imported.ok()).toBe(true);
    const before = ownedSources(projectDir);
    const backupsBefore = listBackups(projectDir);
    const stale = await request.post(`${studioUrl}/api/splashes/apply`, { data: {
      playlistId: "api-intro",
      playlist: {
        schemaVersion: 1,
        label: "API stale revision",
        items: [{
          id: "api",
          spriteId: "api_splash",
          accessibleLabel: "API splash",
          backgroundColor: "#0b0f0d",
          fit: "contain",
          transition: "fade_scale",
          displayMs: 1800,
          minimumMs: 600,
          transitionMs: 220
        }]
      },
      binding: { targetId: "web-pwa", enabled: true },
      ifRevision: staleRevision
    } });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ ok: false, conflict: true, written: false });
    expect(ownedSources(projectDir)).toEqual(before);
    expect(listBackups(projectDir)).toEqual(backupsBefore);
  });
});

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function readBuildTargets(projectDir) { return readJson(path.join(projectDir, "build-targets.json")); }
function readSplashes(projectDir) { return readJson(path.join(projectDir, "content", "splashes.json")); }

function ownedSources(projectDir) {
  const splashesPath = path.join(projectDir, "content", "splashes.json");
  return {
    project: fs.readFileSync(path.join(projectDir, "project.json"), "utf8"),
    targets: fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8"),
    visuals: fs.readFileSync(path.join(projectDir, "content", "visuals.json"), "utf8"),
    splashes: fs.existsSync(splashesPath) ? fs.readFileSync(splashesPath, "utf8") : null
  };
}

function listBackups(projectDir) {
  const root = path.join(projectDir, ".towerforge", "backups");
  return fs.existsSync(root) ? fs.readdirSync(root).sort() : [];
}

async function waitForHttp(url, child, childOutput) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Studio exited.\n${childOutput()}`);
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.\n${childOutput()}`);
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

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port || freePort();
}
