import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.describe("R20 Camera Studio lifecycle", () => {
  let root, projectDir, processHandle, studioUrl;
  test.beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r20-camera-studio-"));
    projectDir = path.join(root, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples/starter.tdproj"), projectDir, { recursive: true });
    const port = await freePort();
    studioUrl = `http://127.0.0.1:${port}`;
    processHandle = spawn(process.execPath, [path.join(repoRoot, "packages/studio/server.mjs"), "--project", projectDir], {
      cwd: repoRoot, env: { ...process.env, PORT: String(port), TOWERFORGE_BUNDLED_RUNTIME: "1" }, stdio: "ignore"
    });
    await waitForHttp(`${studioUrl}/api/project`, processHandle);
  });
  test.afterEach(async () => { await stop(processHandle); fs.rmSync(root, { recursive: true, force: true }); });

  test("previews, guardedly saves and reloads one mission-bound profile", async ({ page, request }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => { localStorage.setItem("towerforge:welcomed", "1"); localStorage.setItem("towerforge:language", "en"); });
    await page.goto(studioUrl);
    await page.locator('[data-tab="assets"]').click();
    await expect(page.locator("#camera-studio-state")).toContainText("visuals v4");
    await page.locator("#camera-profile-id").fill("iso-e2e");
    await page.locator("#camera-projection").selectOption("isometric_2_1");
    await page.locator("#camera-orientation").selectOption("east");
    await page.locator("#camera-binding-scope").selectOption("mission");
    await page.locator("#camera-binding-id").fill("tutorial_01");
    await page.locator("#btn-camera-preview").click();
    await expect(page.locator("#camera-preview-result")).toContainText('"source": "mission"');
    await expect(page.locator("#camera-preview-result")).toContainText("projectedBounds");
    await expect(page.locator("#btn-camera-apply")).toBeEnabled();
    const staleRevision = (await (await request.get(`${studioUrl}/api/camera/read`)).json()).revision;
    await page.locator("#btn-camera-apply").click();
    await expect.poll(() => readVisuals(projectDir).cameraProfiles?.bindings?.missions?.tutorial_01).toBe("iso-e2e");
    await page.locator("#btn-camera-disable").click();
    await expect.poll(() => readVisuals(projectDir).cameraProfiles?.bindings?.missions?.tutorial_01).toBeUndefined();
    expect(readVisuals(projectDir).cameraProfiles.profiles["iso-e2e"]).toBeDefined();
    await page.locator("#btn-camera-preview").click();
    await expect(page.locator("#camera-preview-result")).toContainText('"source": "mission"');
    await page.locator("#btn-camera-apply").click();
    await expect.poll(() => readVisuals(projectDir).cameraProfiles?.bindings?.missions?.tutorial_01).toBe("iso-e2e");
    await page.reload();
    await page.locator('[data-tab="assets"]').click();
    await expect(page.locator("#camera-studio-state")).toContainText("visuals v4");
    await expect(page.locator("#camera-profile-picker")).toHaveValue("iso-e2e");
    await expect(page.locator("#camera-profile-id")).toHaveValue("iso-e2e");
    await expect(page.locator("#camera-projection")).toHaveValue("isometric_2_1");
    await expect(page.locator("#camera-orientation")).toHaveValue("east");
    await expect(page.locator("#camera-binding-scope")).toHaveValue("mission");
    await expect(page.locator("#camera-binding-id")).toHaveValue("tutorial_01");
    const stale = await request.post(`${studioUrl}/api/camera/apply`, { data: {
      profileId: "iso-e2e", profile: readVisuals(projectDir).cameraProfiles.profiles["iso-e2e"],
      binding: { scope: "mission", id: "tutorial_01" }, ifRevision: staleRevision
    } });
    expect(stale.status()).toBe(409);
  });

  test("selects a saved camera profile on a BuildTargets v2 desktop target and persists it", async ({ page, request }) => {
    test.setTimeout(90_000);
    const recipeResponse = await request.get(`${studioUrl}/api/camera/recipes`);
    const recipes = (await recipeResponse.json()).recipes;
    const recipe = recipes.find((entry) => entry.recipeId === "dimetric_oblique" && entry.profile?.orientation === "south");
    const candidate = { profileId: "desktop-camera", profile: recipe.profile };
    const preview = await (await request.post(`${studioUrl}/api/camera/preview`, { data: candidate })).json();
    expect(preview.ok).toBe(true);
    const applied = await request.post(`${studioUrl}/api/camera/apply`, { data: { ...candidate, ifRevision: preview.revision } });
    expect(applied.ok()).toBe(true);

    await page.addInitScript(() => { localStorage.setItem("towerforge:welcomed", "1"); localStorage.setItem("towerforge:language", "en"); });
    await page.goto(studioUrl);
    await page.locator('[data-tab="buildtargets"]').click();
    await page.locator("#btn-add-desktop-target").click();
    const cameraSelect = page.locator('.bt-field[data-f="cameraProfileId"]').last();
    await expect(cameraSelect).toContainText("desktop-camera");
    const targetId = await cameraSelect.getAttribute("data-tid");
    await cameraSelect.selectOption("desktop-camera");
    await page.locator("#btn-save").click();
    await expect.poll(() => readBuildTargets(projectDir).targets[targetId]?.cameraProfileId).toBe("desktop-camera");

    await page.reload();
    await page.locator('[data-tab="buildtargets"]').click();
    await expect(page.locator(`.bt-field[data-f="cameraProfileId"][data-tid="${targetId}"]`)).toHaveValue("desktop-camera");
  });
});

function readVisuals(projectDir) { return JSON.parse(fs.readFileSync(path.join(projectDir, "content/visuals.json"), "utf8")); }
function readBuildTargets(projectDir) { return JSON.parse(fs.readFileSync(path.join(projectDir, "build-targets.json"), "utf8")); }
async function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function waitForHttp(url, child) { for (let i = 0; i < 120; i += 1) { if (child.exitCode !== null) throw new Error("Studio exited before readiness."); try { if ((await fetch(url)).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error("Studio readiness timeout."); }
async function stop(child) { if (!child || child.exitCode !== null) return; child.kill("SIGTERM"); await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))]); if (child.exitCode === null) child.kill("SIGKILL"); }
