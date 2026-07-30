import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.describe("R11 Procedural Juice Studio lifecycle", () => {
  let tempRoot;
  let projectDir;
  let studioProcess;
  let studioUrl;
  let serverOutput;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r11-studio-"));
    projectDir = path.join(tempRoot, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const port = await freePort();
    studioUrl = `http://127.0.0.1:${port}`;
    serverOutput = "";
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

  test.afterEach(async () => {
    await stopProcess(studioProcess);
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("enables, edits, previews, reloads, disables, and re-enables through the guarded visuals flow", async ({ page, request }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    await page.addInitScript(() => {
      localStorage.setItem("towerforge:welcomed", "1");
      localStorage.setItem("towerforge:language", "en");
    });
    await page.goto(studioUrl);
    await page.locator('[data-tab="assets"]').click();
    await expect(page.locator("#procedural-juice-state")).toHaveText("Disabled · supported v1");
    expect(readState(projectDir)).toMatchObject({ projectVersion: 1, visualsVersion: 1, authored: false });

    await page.locator("#procedural-juice-recipe").selectOption("impact_feedback");
    await page.locator("#btn-procedural-juice-recipe").click();
    await expect(page.locator("#procedural-juice-editor")).toHaveValue(/impact_sparks/);
    await page.locator("#btn-procedural-juice-preview").click();
    await expect(page.locator("#procedural-juice-result")).toContainText('"ok": true');
    expect(readState(projectDir)).toMatchObject({ projectVersion: 1, visualsVersion: 1, authored: false });
    await expect(page.locator("#btn-procedural-juice-apply")).toBeEnabled();
    await page.locator("#btn-procedural-juice-apply").click();
    await expect(page.locator("#procedural-juice-state")).toHaveText("Enabled · supported v1");
    expect(readState(projectDir)).toMatchObject({
      projectVersion: 3,
      visualsVersion: 3,
      authored: true,
      maxParticles: 12
    });

    const oldRevision = (await (await request.get(`${studioUrl}/api/procedural-juice/read`)).json()).revision;
    await page.reload();
    await page.locator('[data-tab="assets"]').click();
    await expect(page.locator("#procedural-juice-state")).toHaveText("Enabled · supported v1");
    const updated = JSON.parse(await page.locator("#procedural-juice-editor").inputValue());
    updated.particleEmitters.impact_sparks.maxParticles = 8;
    await page.locator("#procedural-juice-editor").fill(JSON.stringify(updated, null, 2));
    await page.locator("#btn-procedural-juice-preview").click();
    await expect(page.locator("#btn-procedural-juice-apply")).toBeEnabled();
    await page.locator("#btn-procedural-juice-apply").click();
    await expect.poll(() => readState(projectDir).maxParticles).toBe(8);

    const stale = await request.post(`${studioUrl}/api/procedural-juice/apply`, {
      data: { proceduralJuice: updated, ifRevision: oldRevision }
    });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "conflict" });
    expect(readState(projectDir).maxParticles).toBe(8);

    await page.locator("#procedural-juice-event-json").fill(JSON.stringify({
      enemyId: "preview_enemy", enemyTypeId: "grunt", damage: 24
    }));
    await page.locator("#btn-procedural-juice-event-preview").click();
    await expect(page.locator("#procedural-juice-result")).toContainText('"active": true');
    await expect(page.locator("#procedural-juice-result")).toContainText('"impact_sparks"');

    await page.locator("#btn-procedural-juice-disable").click();
    await expect(page.locator("#procedural-juice-state")).toHaveText("Disabled · supported v1");
    expect(readState(projectDir)).toMatchObject({ projectVersion: 3, visualsVersion: 3, authored: false });

    await page.locator("#btn-procedural-juice-recipe").click();
    await page.locator("#btn-procedural-juice-preview").click();
    await page.locator("#btn-procedural-juice-apply").click();
    await expect(page.locator("#procedural-juice-state")).toHaveText("Enabled · supported v1");
    expect(readState(projectDir)).toMatchObject({ authored: true, maxParticles: 12 });
    expect(browserErrors()).toEqual([]);
  });
});

function readState(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "project.json"), "utf8"));
  const visuals = JSON.parse(fs.readFileSync(path.join(root, "content", "visuals.json"), "utf8"));
  return {
    projectVersion: manifest.schemaVersion,
    visualsVersion: visuals.schemaVersion,
    authored: visuals.proceduralJuice !== undefined,
    maxParticles: visuals.proceduralJuice?.particleEmitters?.impact_sparks?.maxParticles
  };
}

function captureBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  return () => errors.filter((message) => !(
    message.includes("document is sandboxed") && message.includes("allow-same-origin")
  ));
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

async function waitForHttp(url, child, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Studio exited before readiness.\n${output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
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
