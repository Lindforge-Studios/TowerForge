import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = 5210;
const combinations = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
));
let tempDir;
let server;

test.beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r10-player-"));
  for (const mode of ["active", "absent"]) {
    for (const { grid, renderer } of combinations) {
      const name = `r10_${mode}_${grid}_${renderer}`;
      const { projectDir } = createProject({
        name,
        parentDir: tempDir,
        templateName: "classic",
        gridKind: grid
      });
      if (mode === "active") enableQuests(projectDir);
      const targetsPath = path.join(projectDir, "build-targets.json");
      const targets = readJson(targetsPath);
      targets.targets.r10 = { ...targets.targets[targets.defaults.web], id: "r10", renderer, webDir: "dist" };
      writeJson(targetsPath, targets);
      execFileSync(process.execPath, [
        path.join(repoRoot, "packages", "cli", "build.mjs"),
        "--project", projectDir,
        "--target", "r10"
      ], {
        cwd: repoRoot,
        stdio: "ignore",
        env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
      });
    }
  }

  server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname)
      .replace(/^\/+/, "");
    const [mode, grid, renderer, ...parts] = relative.split("/");
    if (!['active', 'absent'].includes(mode)
      || !["hex", "square"].includes(grid)
      || !["canvas", "phaser"].includes(renderer)) return respond404(response);
    const buildDir = path.join(tempDir, `r10_${mode}_${grid}_${renderer}.tdproj`, "dist");
    const filePath = path.resolve(buildDir, parts.join("/") || "index.html");
    const confined = path.relative(buildDir, filePath);
    if (confined.startsWith("..") || path.isAbsolute(confined)
      || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return respond404(response);
    response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => server.listen(
    port,
    "127.0.0.1",
    (error) => error ? reject(error) : resolve()
  ));
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test("shows authoritative quest progress on Canvas/Phaser and hex/square only when active", async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  for (const { grid, renderer } of combinations) {
    await page.goto(playerUrl("active", grid, renderer));
    await page.waitForFunction(() => window.__towerforgeBootOk === true);
    await expect(page.locator("#boot-error")).toBeHidden();
    await expect(page.locator("#quest-status")).toBeVisible();
    await expect(page.locator("#quest-status")).toContainText("Verifier finisher");
    await expect(page.locator("#quest-status")).toContainText("0/1");
    expect(await page.evaluate(() => window.__towerforgeInspect().quests)).toMatchObject({
      schemaVersion: 1,
      profileId: "r10_browser",
      entries: [{
        questId: "tower_finisher",
        label: "Verifier finisher",
        current: 0,
        target: 1,
        status: "active"
      }]
    });
  }

  for (const { grid, renderer } of combinations) {
    await page.goto(playerUrl("absent", grid, renderer));
    await page.waitForFunction(() => window.__towerforgeBootOk === true);
    await expect(page.locator("#boot-error")).toBeHidden();
    await expect(page.locator("#quest-status")).toBeHidden();
    expect(await page.evaluate(() => window.__towerforgeInspect().quests)).toBeUndefined();
  }

  expect(browserErrors).toEqual([]);
});

function enableQuests(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const towerId = balance.missions[missionId].buildTowerIds[0];
  balance.missions[missionId].mechanics = { profiles: { quests: "r10_browser" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      quests: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          r10_browser: {
            selectionCount: 1,
            definitions: {
              tower_finisher: {
                label: "Verifier finisher",
                weight: 1,
                objective: {
                  kind: "kill_with_source",
                  count: 1,
                  source: { kind: "tower", id: towerId }
                }
              }
            }
          }
        }
      }
    }
  });
}

function playerUrl(mode, grid, renderer) {
  return `http://127.0.0.1:${port}/${mode}/${grid}/${renderer}/`;
}

function respond404(response) {
  response.writeHead(404, { "Content-Type": "text/plain" });
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
