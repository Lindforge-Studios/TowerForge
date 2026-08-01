import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.describe("R17 Distribution Hub authoring acceptance (RED)", () => {
  let root;
  let projectDir;
  let studioProcess;
  let studioUrl;
  let output = "";

  test.beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r17-studio-"));
    projectDir = createProject({
      name: "r17_distribution",
      parentDir: root,
      templateName: "classic",
      gridKind: "square"
    }).projectDir;
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

  test("enables, edits, previews, saves, reloads, disables and re-enables Distribution v1", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("towerforge:welcomed", "1");
      localStorage.setItem("towerforge:language", "en");
    });
    await page.goto(studioUrl);
    await expect(page).toHaveTitle(/TowerForge Editor/);
    await page.locator('[data-tab="distribution"]').click();
    await expect(page.locator('[data-tab="distribution"]')).toHaveAttribute("aria-selected", "true");
    expect(fs.existsSync(path.join(projectDir, "content", "distribution.json"))).toBe(false);

    await page.locator("#distribution-project-id").fill("tfp_0123456789abcdef0123456789abcdef");
    await page.locator("#distribution-license").selectOption("CC-BY-4.0");
    await page.locator("#distribution-license-attribution").fill("R17 browser authors");
    await page.locator("#distribution-remix-policy").selectOption("allowed_with_attribution");
    await page.locator("#distribution-remix-source").check();
    await page.locator("#distribution-monetization-placements").fill(JSON.stringify([
      { id: "support_link", kind: "purchase_link", surface: "menu" }
    ], null, 2));

    await page.locator("#distribution-publish-preview").click();
    await expect(page.locator("#distribution-preview-result")).toContainText(/"ok"\s*:\s*true/i);
    expect(fs.existsSync(path.join(projectDir, "content", "distribution.json"))).toBe(false);

    await page.locator("#distribution-enable").click();
    await expect.poll(() => readDistribution(projectDir)).toMatchObject({
      projectId: "tfp_0123456789abcdef0123456789abcdef",
      license: { spdxId: "CC-BY-4.0", attribution: "R17 browser authors" },
      remix: { policy: "allowed_with_attribution", includeSource: true }
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).schemaVersion).toBe(4);

    await page.locator("#distribution-license-attribution").fill("R17 edited authors");
    await page.locator("#distribution-save").click();
    await expect.poll(() => readDistribution(projectDir).license.attribution).toBe("R17 edited authors");

    await page.reload();
    await page.locator('[data-tab="distribution"]').click();
    await expect(page.locator("#distribution-license-attribution")).toHaveValue("R17 edited authors");
    const publishDir = path.join(root, "published-game");
    await page.locator("#distribution-target").fill(JSON.stringify({ directory: publishDir }));
    await page.locator("#distribution-publish-preview").click();
    await expect(page.locator("#distribution-publish-result")).toContainText(/targetDigest/i);
    await page.evaluate(() => {
      const button = document.querySelector("#distribution-publish-prepare");
      button.click();
      button.click();
    });
    await expect(page.locator("#distribution-publish-result")).toContainText(/candidateDigest/i, { timeout: 30_000 });
    const stagingRoot = path.join(projectDir, ".towerforge", "publish-staging");
    expect(fs.readdirSync(stagingRoot).filter((name) => name.startsWith("candidate-")).length).toBe(1);

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#distribution-publish-confirm").click();
    await expect.poll(() => fs.existsSync(path.join(publishDir, "index.html"))).toBe(true);
    await expect(page.locator("#distribution-publish-result")).toContainText(/verified/i);
    expect(fs.readdirSync(stagingRoot).filter((name) => name.startsWith("candidate-")).length).toBe(0);

    await page.locator("#distribution-disable").click();
    await expect.poll(() => fs.existsSync(path.join(projectDir, "content", "distribution.json"))).toBe(false);
    await page.locator("#distribution-enable").click();
    await expect.poll(() => readDistribution(projectDir)?.license?.attribution ?? null).toBe("R17 edited authors");
  }, 120_000);
});

function readDistribution(projectDir) {
  const filePath = path.join(projectDir, "content", "distribution.json");
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null;
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
