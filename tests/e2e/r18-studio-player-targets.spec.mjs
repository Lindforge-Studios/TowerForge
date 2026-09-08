import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";
import {
  applyPlayerTarget,
  getPlayerTargetRecipe,
  readPlayerTargets
} from "../../packages/cli/lib/player-target-authoring.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.describe("R18 Studio large-screen target allocation (RED)", () => {
  let root;
  let projectDir;
  let studioProcess;
  let studioUrl;
  let output = "";

  test.beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r18-studio-target-"));
    projectDir = createProject({
      name: "r18_target_identity",
      parentDir: root,
      templateName: "classic",
      gridKind: "square"
    }).projectDir;
    const read = readPlayerTargets(projectDir);
    const recipe = getPlayerTargetRecipe(projectDir, "desktop_large_screen", "desktop-large");
    const existing = {
      ...recipe.target,
      renderer: "phaser",
      appName: "Existing authored game",
      appTitle: "Existing authored game",
      quality: "high"
    };
    const applied = applyPlayerTarget(projectDir, "desktop-large", existing, { ifRevision: read.revision });
    if (!applied.ok) throw new Error("Could not seed the existing desktop target.");

    const port = await freePort();
    studioUrl = `http://127.0.0.1:${port}`;
    studioProcess = spawn(process.execPath, [
      path.join(repoRoot, "packages", "studio", "server.mjs"), "--project", projectDir
    ], {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(port), TOWERFORGE_BUNDLED_RUNTIME: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const capture = (chunk) => { output = `${output}${chunk}`.slice(-20_000); };
    studioProcess.stdout.on("data", capture);
    studioProcess.stderr.on("data", capture);
    await waitForHttp(`${studioUrl}/api/project`, studioProcess, () => output);
  });

  test.afterAll(async () => {
    await stopProcess(studioProcess);
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  test("adds a distinct desktop target and preserves the authored target", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("towerforge:welcomed", "1");
      localStorage.setItem("towerforge:language", "en");
    });
    await page.goto(studioUrl);
    await page.locator('[data-tab="buildtargets"]').click();
    await page.locator("#btn-add-desktop-target").click();

    await expect.poll(() => readPlayerTargets(projectDir).targets).toMatchObject({
      "desktop-large": {
        renderer: "phaser",
        appName: "Existing authored game",
        appTitle: "Existing authored game",
        quality: "high"
      },
      "desktop-large-2": {
        renderer: "canvas",
        formFactor: "desktop",
        quality: "balanced",
        webDir: "dist-desktop-2"
      }
    });
  });
  test("R23 explicitly adds a responsive target and selects fixed timing in Playtest", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("towerforge:welcomed", "1");
      localStorage.setItem("towerforge:language", "en");
    });
    await page.goto(studioUrl);
    await page.locator('[data-tab="buildtargets"]').click();
    const before = readPlayerTargets(projectDir);
    const balanceFile = path.join(projectDir, "content", "balance.json");
    const externalBalance = JSON.parse(fs.readFileSync(balanceFile, "utf8"));
    const towerId = Object.keys(externalBalance.towers)[0];
    externalBalance.towers[towerId].label = "External author update";
    fs.writeFileSync(balanceFile, JSON.stringify(externalBalance, null, 2));
    await page.locator("#btn-add-responsive-target").click();
    await expect(page.locator("#confirm-body")).toContainText("FPS");
    expect(readPlayerTargets(projectDir)).toEqual(before);
    const response = page.waitForResponse(r => r.url().endsWith("/api/player-targets/apply") && r.ok());
    await page.locator("#confirm-ok").click();
    await response;
    await expect.poll(() => readPlayerTargets(projectDir).targets.responsive?.formFactor).toBe("responsive");
    await page.locator('[data-tab="playtest"]').click();
    await expect(page.locator("#pt-target")).toHaveValue("responsive");
    await expect(page.locator("#pt-target option:checked")).toContainText("Fixed timing");
    await page.locator("#pt-target").selectOption(Object.keys(before.targets).find(id => !before.targets[id].formFactor));
    await expect(page.locator("#pt-target option:checked")).toContainText("Legacy timing");
    await page.locator("#pt-target").selectOption("responsive");
    await page.locator("#pt-start").click();
    await expect(page.locator("#pt-wave")).not.toHaveText("0 / 0");
    expect(readPlayerTargets(projectDir).defaults).toEqual(before.defaults);
    await page.locator('[data-tab="settings"]').click();
    await page.locator("#setting-project-desc").fill("Saved after responsive transition");
    await page.locator("#setting-project-desc").blur();
    const saved = page.waitForResponse(r => r.url().endsWith("/api/project/save") && r.ok());
    await page.locator("#btn-save").click();
    await saved;
    expect(JSON.parse(fs.readFileSync(balanceFile, "utf8")).towers[towerId].label).toBe("External author update");
  });

  test("R23 Studio and exported Canvas run identical commands at every supported FPS and speed", async ({ page, context }) => {
    test.setTimeout(90_000);
    if (!readPlayerTargets(projectDir).targets.responsive) {
      const recipe = getPlayerTargetRecipe(projectDir, "responsive_web_mobile", "responsive");
      expect(applyPlayerTarget(projectDir, "responsive", recipe.target, { ifRevision: readPlayerTargets(projectDir).revision }).ok).toBe(true);
    }
    const out = path.join(projectDir, "parity-player");
    const build = spawnSync(process.execPath, ["packages/cli/build.mjs", "--project", projectDir, "--target", "responsive", "--out", out], { cwd: repoRoot, encoding: "utf8" });
    expect(build.status, build.stderr).toBe(0);
    await page.route("**/app.js", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `\nwindow.__r23Run = ${studioParityHook.toString()};` });
    });
    await page.addInitScript(() => {
      localStorage.setItem("towerforge:welcomed", "1");
      localStorage.setItem("towerforge:language", "en");
    });
    await page.goto(studioUrl);
    await page.locator('[data-tab="playtest"]').click();
    await page.locator("#pt-target").selectOption("responsive");
    const player = await context.newPage();
    await player.route("http://r23-export.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = path.join(out, pathname === "/" ? "index.html" : pathname);
      if (!fs.existsSync(file)) { await route.fulfill({ status: 404 }); return; }
      const contentType = /\.m?js$/.test(file) ? "text/javascript" : /\.css$/.test(file) ? "text/css" : /\.json$/.test(file) ? "application/json" : /\.html$/.test(file) ? "text/html" : "application/octet-stream";
      const body = file.endsWith("/player.mjs") ? fs.readFileSync(file, "utf8") + `\nwindow.__r23Run = ${exportParityHook.toString()};` : fs.readFileSync(file);
      await route.fulfill({ status: 200, contentType, body });
    });
    await player.goto("http://r23-export.test/");
    await player.waitForFunction(() => window.__towerforgeBootOk && window.__r23Run);
    for (const speed of [1, 2, 4]) {
      let baseline;
      for (const fps of [20, 30, 60, 120]) {
        const args = { fps, speed };
        const studioState = await page.evaluate(args => window.__r23Run(args), args);
        const exportState = await player.evaluate(args => window.__r23Run(args), args);
        expect(studioState).toEqual(exportState);
        expect(studioState.elapsed).toBeCloseTo(studioState.expectedElapsed, 8);
        baseline ??= studioState;
        expect(studioState).toEqual(baseline);
      }
    }
    await player.close();
  });

});

// Test-only hooks execute the actual adapter loops; no production inspection API is added.
function studioParityHook({ fps, speed }) {
  document.getElementById("script-debug-enabled").checked = false;
  newPlaytestGame();
  stopPlaytestLoop();
  const originalRaf = window.requestAnimationFrame;
  let frame;
  window.requestAnimationFrame = callback => { frame = callback; return 999999; };
  try {
    startPlaytestLoop();
    PT.lastFrame = 1000;
    document.getElementById("pt-speed").value = String(speed);
    PT.game.startNextWave();
    for (let i = 1; i <= fps * 2; i++) frame(1000 + i * 1000 / fps);
    const s = PT.game.getSnapshot();
    return { elapsed: s.missionElapsed, expectedElapsed: 2 / PT.content.constants.timeUnitSeconds * speed, coreHp: s.coreHp, resources: s.resources, enemies: s.enemies, towers: s.towers, wave: s.waveState, started: s.startedWaveCount, outcome: s.outcome };
  } finally { stopPlaytestLoop(); window.requestAnimationFrame = originalRaf; document.getElementById("pt-speed").value = "0"; }
}

function exportParityHook({ fps, speed }) {
  game.reset();
  resetPlayerSimulationClock();
  const originalRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = () => 999999;
  try {
    lastFrame = 1000;
    document.getElementById("speed").value = String(speed);
    game.startNextWave();
    for (let i = 1; i <= fps * 2; i++) loop(1000 + i * 1000 / fps);
    const s = game.getSnapshot();
    return { elapsed: s.missionElapsed, expectedElapsed: 2 / content.constants.timeUnitSeconds * speed, coreHp: s.coreHp, resources: s.resources, enemies: s.enemies, towers: s.towers, wave: s.waveState, started: s.startedWaveCount, outcome: s.outcome };
  } finally { window.requestAnimationFrame = originalRaf; document.getElementById("speed").value = "0"; }
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
