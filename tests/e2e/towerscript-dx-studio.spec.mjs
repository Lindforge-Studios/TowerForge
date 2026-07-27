import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let tempRoot;
let projectDir;
let studioProcess;
let studioUrl;
let serverOutput = "";

test.beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-towerscript-dx-e2e-"));
  projectDir = path.join(tempRoot, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
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

test("authors, connects, deletes, positions, saves, and reloads a canonical TowerScript graph", async ({ page }) => {
  test.setTimeout(90_000);
  await initializeStudio(page);
  await openStarterGraph(page);

  await page.locator('[data-node-catalog-group="events"][data-node-catalog-name="towerPlaced"]').click();
  const addedHandler = page.locator('[data-graph-node="10:/handlers/towerPlaced/0"]');
  await expect(addedHandler).toBeVisible();

  const originalHandler = page.locator('[data-graph-node="10:/handlers/waveStarted/0"]');
  await originalHandler.locator(".script-graph-node-drag").click();
  await page.locator('[data-node-catalog-group="actions"][data-node-catalog-name="emitSignal"]').click();
  const addedAction = page.locator('[data-graph-node="10:/handlers/waveStarted/0/actions/1"]');
  await expect(addedAction).toBeVisible();
  await addedAction.locator("[data-graph-parent]").selectOption("/handlers/towerPlaced/0");

  const movedAction = page.locator('[data-graph-node="10:/handlers/towerPlaced/0/actions/1"]');
  await expect(movedAction).toBeVisible();
  await movedAction.locator("[data-graph-delete]").click();
  await expect(page.locator('[data-graph-node="10:/handlers/towerPlaced/0/actions/1"]')).toHaveCount(0);

  const knownActionNode = page.locator('[data-graph-node="10:/handlers/waveStarted/0/actions/0"]');
  await expect(knownActionNode.locator("textarea")).toHaveCount(0);
  const knownActionKey = knownActionNode.locator('[data-graph-field="key"]');
  await expect(knownActionKey).toHaveValue("wavesStarted");
  await knownActionKey.fill("wavesSeen");

  const dragHandle = addedHandler.locator(".script-graph-node-drag");
  const before = await addedHandler.boundingBox();
  const handleBox = await dragHandle.boundingBox();
  expect(before).not.toBeNull();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox.x + 15, handleBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 85, handleBox.y + 62, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await addedHandler.boundingBox())?.x).toBeGreaterThan(before.x + 30);

  await page.locator("#btn-script-save").click();
  await expect(page.locator("#script-editor-state")).toHaveText("Lossless Graph");
  const scriptPath = path.join(projectDir, "scripts", "gameplay", "starter-gameplay.tower.json");
  await expect.poll(() => JSON.parse(fs.readFileSync(scriptPath, "utf8")).handlers.towerPlaced?.length).toBe(1);
  await expect.poll(() => JSON.parse(fs.readFileSync(scriptPath, "utf8")).handlers.waveStarted[0].actions[0].key).toBe("wavesSeen");
  expect(findFiles(path.join(projectDir, ".towerforge", "towerscript-layouts"), ".layout.json").length).toBeGreaterThan(0);

  await page.reload();
  await openStarterGraph(page);
  await expect(page.locator('[data-graph-node="10:/handlers/towerPlaced/0"]')).toBeVisible();
  await expect(page.locator('[data-graph-node="10:/handlers/towerPlaced/0/actions/0"]')).toContainText("action");
  await expect(page.locator('[data-graph-node="10:/handlers/waveStarted/0/actions/0"] [data-graph-field="key"]')).toHaveValue("wavesSeen");
});

test("pauses on a historical debugger frame and resumes only through Resume", async ({ page }) => {
  test.setTimeout(90_000);
  await initializeStudio(page);
  await page.getByRole("tab", { name: /Playtest/ }).click();
  await expect(page.locator("#playtest-canvas")).toBeVisible();
  await page.locator("#script-debug-enabled").check();
  await page.locator("#pt-start").click();
  await expect(page.locator("#script-debug-trace .script-debug-trace-entry").first()).toBeVisible();
  await page.locator("#script-debug-step-mode").selectOption("event");
  await page.locator("#btn-script-debug-step").click();

  await expect(page.locator("#pt-speed")).toHaveValue("0");
  await expect(page.locator("#script-debug-state")).toContainText("Paused preview");
  const pausedState = await page.locator("#script-debug-state").textContent();
  await page.waitForTimeout(350);
  await expect(page.locator("#pt-speed")).toHaveValue("0");
  await expect(page.locator("#script-debug-state")).toHaveText(pausedState);

  await page.locator("#btn-script-debug-resume").click();
  await expect(page.locator("#pt-speed")).toHaveValue("1");
  await expect(page.locator("#script-debug-state")).toContainText("Live");
});

async function initializeStudio(page) {
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(studioUrl);
  await expect(page).toHaveTitle(/TowerForge Editor/);
}

async function openStarterGraph(page) {
  await page.getByRole("tab", { name: /Scripts/ }).click();
  await expect(page.locator("#project-tree")).toContainText("starter-gameplay.tower.json");
  await page.locator(".tree-row").filter({ hasText: "starter-gameplay.tower.json" }).click();
  await page.locator("#script-view-graph").click();
  await expect(page.locator("#script-graph-canvas .script-graph-node").first()).toBeVisible();
}

function findFiles(root, suffix) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? findFiles(absolute, suffix) : entry.name.endsWith(suffix) ? [absolute] : [];
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHttp(url, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Studio exited early.\n${serverOutput}`);
    try {
      const status = await new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
          response.resume();
          resolve(response.statusCode);
        });
        request.on("error", reject);
      });
      if (status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}.\n${serverOutput}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
