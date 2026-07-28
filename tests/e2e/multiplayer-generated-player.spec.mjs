import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject } from "../../packages/cli/lib/create-project.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directorCombinations = [
  { grid: "hex", renderer: "canvas" },
  { grid: "square", renderer: "phaser" }
];
let tempRoot;
let playerServer;
let playerPort;

test.beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-r7-player-"));
  for (const combination of directorCombinations) buildFixture(tempRoot, { mode: "director", ...combination });

  playerServer = http.createServer((request, response) => {
    const relative = decodeURIComponent(
      new URL(request.url, "http://127.0.0.1").pathname
    ).replace(/^\/+/, "");
    const [mode, grid, renderer, ...parts] = relative.split("/");
    if (mode !== "director"
      || !["hex", "square"].includes(grid)
      || !["canvas", "phaser"].includes(renderer)) return respond404(response);
    const root = path.join(tempRoot, fixtureName(mode, grid, renderer), "dist");
    const filePath = path.resolve(root, parts.join("/") || "index.html");
    const confined = path.relative(root, filePath);
    if (confined.startsWith("..") || path.isAbsolute(confined)
      || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return respond404(response);
    response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => playerServer.listen(
    0, "127.0.0.1", (error) => error ? reject(error) : resolve()
  ));
  playerPort = playerServer.address().port;
});

test.afterAll(async () => {
  if (playerServer) await new Promise((resolve) => playerServer.close(resolve));
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("active R7 Director decisions reach the shared Canvas/hex and Phaser/square presentation", async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors = captureBrowserErrors(page);
  for (const { grid, renderer } of directorCombinations) {
    await page.goto(playerUrl("director", grid, renderer));
    await page.waitForFunction(() => window.__towerforgeBootOk === true);
    await page.locator("#start-wave").click();
    await expect.poll(() => page.evaluate(() => window.__towerforgeInspect().director?.decisions?.at(-1)))
      .toMatchObject({ waveIndex: 0, counterId: "acceptance_counter", threatCost: 1 });
    await expect(page.locator("#message")).toContainText("Director: acceptance_counter (+1)");
  }
  expect(browserErrors()).toEqual([]);
});

function buildFixture(root, { mode, grid, renderer }) {
  const name = fixtureName(mode, grid, renderer).replace(/\.tdproj$/, "");
  const { projectDir } = createProject({
    name,
    parentDir: root,
    templateName: "classic",
    gridKind: grid
  });
  if (mode === "director") enableDirector(projectDir);
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets.director_acceptance = {
    ...targets.targets[targets.defaults.web],
    id: "director_acceptance",
    renderer,
    webDir: "dist"
  };
  writeJson(targetsPath, targets);
  execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--target", "director_acceptance"
  ], {
    cwd: repoRoot,
    stdio: "ignore",
    env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
  });
}

function enableDirector(projectDir) {
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  const enemyId = Object.keys(balance.enemies).sort()[0];
  balance.missions[missionId].mechanics = { profiles: { director: "acceptance_director" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      director: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          acceptance_director: {
            counterPool: {
              acceptance_counter: {
                label: "Acceptance counter",
                priority: 1,
                conditions: [{ metric: "damage_share", key: "physical", operator: "gte", threshold: 0 }],
                groups: [{ enemyId, count: 1, spawnInterval: 0, startDelay: 0 }],
                threatCost: 1
              }
            },
            threatBudget: { base: 1, perWave: 0 },
            fairness: { minimumWaveIndex: 0, maxConsecutiveUses: 1, maxAddedGroups: 1, maxAddedEnemies: 1 }
          }
        }
      }
    }
  });
}

function fixtureName(mode, grid, renderer) {
  return `r7_${mode}_${grid}_${renderer}.tdproj`;
}

function playerUrl(mode, grid, renderer) {
  return `http://127.0.0.1:${playerPort}/${mode}/${grid}/${renderer}/`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function captureBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return () => errors;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json" || extension === ".webmanifest") return "application/json; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function respond404(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}
