import { spawn } from "node:child_process";
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
});

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
