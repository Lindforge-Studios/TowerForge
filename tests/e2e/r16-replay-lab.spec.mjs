import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";
import {
  loadContentRegistry,
  loadReplayLabEngine
} from "../../packages/cli/lib/project-loader.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.describe("R16 Replay Lab read-only Studio acceptance", () => {
  let root;
  let projectDir;
  let studioProcess;
  let studioUrl;
  let serverOutput = "";
  let validArchive;

  test.beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r16-replay-lab-"));
    projectDir = createProject({
      name: "r16_replay_lab",
      parentDir: root,
      templateName: "classic",
      gridKind: "square"
    }).projectDir;

    const { engine, content } = await loadContentRegistry(projectDir);
    const replayLab = await loadReplayLabEngine();
    const game = new engine.TowerDefenseGame({
      content,
      missionId: content.defaultMissionId,
      seed: "r16-browser"
    });
    const towerTypeId = content.missions[content.defaultMissionId].buildTowerIds[0];
    expect(game.placeTower(towerTypeId, { q: 0, r: 0 }).ok).toBe(true);
    const session = new engine.JournaledGameSession(game);
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" }).ok).toBe(true);
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.25 }).ok).toBe(true);
    validArchive = replayLab.encodeReplayArchiveV1({ content, journal: session.exportJournal() });

    const port = await freePort();
    studioUrl = `http://127.0.0.1:${port}`;
    studioProcess = spawn(process.execPath, [
      path.join(repoRoot, "packages", "studio", "server.mjs"), "--project", projectDir
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

  test("rejects malformed input without dirtying the project, then loads and seeks a detached archive", async ({ page }) => {
    const writes = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.method() !== "HEAD") writes.push(request.url());
    });
    await page.addInitScript(() => {
      localStorage.setItem("towerforge:welcomed", "1");
      localStorage.setItem("towerforge:language", "en");
    });
    await page.goto(studioUrl);
    await expect(page).toHaveTitle(/TowerForge Editor/);

    const before = projectBytes(projectDir);
    await page.locator('[data-tab="replaylab"]').click();
    await expect(page.locator('[data-tab="replaylab"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-replaylab")).toHaveAttribute("data-project-write", "none");
    await expect(page.locator("#replay-lab-seek")).toBeDisabled();
    await expect(page.locator("#replay-lab-ghost-toggle")).toBeDisabled();
    await expect(page.locator("#btn-replay-lab-fork")).toBeDisabled();

    await page.locator("#replay-lab-file").setInputFiles({
      name: "truncated.tfreplay",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([0x54, 0x46, 0x52])
    });
    await page.locator("#btn-replay-lab-import").click();
    await expect(page.locator("#replay-lab-divergence")).toContainText(/truncated|header|invalid/i);
    await expect(page.locator("#replay-lab-timeline")).toHaveText("No archive loaded.");
    await expect(page.locator("#replay-lab-seek")).toBeDisabled();
    await expect(page.locator("#replay-lab-ghost-toggle")).toBeDisabled();
    await expect(page.locator("#btn-replay-lab-fork")).toBeDisabled();
    await expect(page.locator("#btn-save")).toBeDisabled();
    await expect(page.locator("#dirty-badge")).not.toHaveClass(/visible/);
    expect(projectBytes(projectDir)).toEqual(before);
    expect(writes).toEqual([]);

    await page.locator("#replay-lab-file").setInputFiles({
      name: "valid.tfreplay",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(validArchive)
    });
    await page.locator("#btn-replay-lab-import").click();
    await expect(page.locator("#replay-lab-timeline")).toContainText("Sequence 0 / 2");
    await expect(page.locator("#replay-lab-preview")).toBeVisible();
    await expect(page.locator("#replay-lab-ghost-overlay [data-replay-ghost-tower-id]")).toHaveCount(1);
    await page.locator("#replay-lab-ghost-toggle").uncheck();
    await expect(page.locator("#replay-lab-ghost-overlay [data-replay-ghost-tower-id]")).toHaveCount(0);
    await page.locator("#replay-lab-ghost-toggle").check();
    await expect(page.locator("#replay-lab-ghost-overlay [data-replay-ghost-tower-id]")).toHaveCount(1);
    await expect(page.locator("#replay-lab-seek")).toBeEnabled();
    await page.locator("#replay-lab-seek").focus();
    await page.locator("#replay-lab-seek").press("End");
    await expect(page.locator("#replay-lab-timeline")).toContainText("Sequence 2 / 2");
    await expect(page.locator("#btn-save")).toBeDisabled();
    await expect(page.locator("#dirty-badge")).not.toHaveClass(/visible/);
    expect(projectBytes(projectDir)).toEqual(before);
    expect(writes).toEqual([]);
  });

  test("rebuilds current project content before every import and rejects an archive after an unsaved gameplay edit", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("towerforge:welcomed", "1");
      localStorage.setItem("towerforge:language", "en");
    });
    await page.goto(studioUrl);
    await expect(page).toHaveTitle(/TowerForge Editor/);
    await page.locator('[data-tab="replaylab"]').click();
    await page.locator("#replay-lab-file").setInputFiles({
      name: "before-edit.tfreplay",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(validArchive)
    });
    await page.locator("#btn-replay-lab-import").click();
    await expect(page.locator("#replay-lab-timeline")).toContainText("Sequence 0 / 2");

    await page.locator('[data-tab="towers"]').click();
    await page.locator("#tower-list .entity-item").first().click();
    const range = page.locator("#tf-range");
    await range.fill(String(Number(await range.inputValue()) + 1));
    await range.blur();
    await expect(page.locator("#dirty-badge")).toHaveClass(/visible/);

    await page.locator('[data-tab="replaylab"]').click();
    await page.locator("#replay-lab-file").setInputFiles({
      name: "stale-after-edit.tfreplay",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(validArchive)
    });
    await page.locator("#btn-replay-lab-import").click();
    await expect(page.locator("#replay-lab-divergence")).toContainText(/content digest|does not match/i);
    await expect(page.locator("#replay-lab-timeline")).toContainText("Sequence 0 / 2");
    await expect(page.locator("#replay-lab-ghost-overlay [data-replay-ghost-tower-id]")).toHaveCount(1);
    await page.locator("#btn-replay-lab-fork").click();
    await expect(page.locator("#replay-lab-divergence")).toContainText(/branchDigest/);

    await page.locator("#replay-lab-file").setInputFiles({
      name: "malformed-after-valid.tfreplay",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([0x54, 0x46, 0x52])
    });
    await page.locator("#btn-replay-lab-import").click();
    await expect(page.locator("#replay-lab-divergence")).toContainText(/truncated|header|invalid/i);
    await expect(page.locator("#replay-lab-timeline")).toContainText("Sequence 0 / 2");
    await expect(page.locator("#replay-lab-ghost-overlay [data-replay-ghost-tower-id]")).toHaveCount(1);
    await page.locator("#btn-replay-lab-fork").click();
    await expect(page.locator("#replay-lab-divergence")).toContainText(/branchDigest/);
  });
});

function projectBytes(projectDir) {
  return Object.fromEntries([
    "project.json",
    "content/balance.json",
    "content/visuals.json",
    "content/world-map.json"
  ].map((relativePath) => [relativePath, fs.readFileSync(path.join(projectDir, relativePath), "utf8")]));
}

async function waitForHttp(url, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Studio exited.\n${output()}`);
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.\n${output()}`);
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
