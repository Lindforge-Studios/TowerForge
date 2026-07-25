import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { createProject } from "../../packages/cli/lib/create-project.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = 5193;
const combinations = ["hex", "square"].flatMap((grid) =>
  ["canvas", "phaser"].map((renderer) => ({ grid, renderer }))
);
let tempDir;
let server;

test.beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-shield-player-"));
  for (const { grid, renderer } of combinations) {
    const name = `shield_${grid}_${renderer}`;
    const { projectDir } = createProject({ name, parentDir: tempDir, templateName: "classic", gridKind: grid });

    const manifestPath = path.join(projectDir, "project.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.schemaVersion = 3;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    const missionId = balance.defaultMissionId || Object.keys(balance.missions)[0];
    balance.missions[missionId].mechanics = { profiles: { combat: "browser_shields" } };
    fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`);

    const enemyShields = Object.fromEntries(Object.keys(balance.enemies).sort().map((enemyId) => [
      enemyId,
      { capacity: 25, regeneration: { ratePerUnit: 1, delayAfterDamage: 3 } }
    ]));
    const mechanics = {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 1,
          enabled: true,
          profiles: { browser_shields: { shields: { enemies: enemyShields } } }
        }
      }
    };
    fs.writeFileSync(
      path.join(projectDir, "content", "mechanics.json"),
      `${JSON.stringify(mechanics, null, 2)}\n`
    );

    const targetsPath = path.join(projectDir, "build-targets.json");
    const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
    targets.targets.shields = { ...targets.targets["web-pwa"], id: "shields", renderer, webDir: "dist" };
    fs.writeFileSync(targetsPath, `${JSON.stringify(targets, null, 2)}\n`);
    execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", "shields"
    ], {
      cwd: repoRoot,
      stdio: "ignore",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    });
  }

  server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname).replace(/^\/+/, "");
    const [grid, renderer, ...parts] = relative.split("/");
    if (!["hex", "square"].includes(grid) || !["canvas", "phaser"].includes(renderer)) return respond404(response);
    const buildDir = path.join(tempDir, `shield_${grid}_${renderer}.tdproj`, "dist");
    const filePath = path.resolve(buildDir, parts.join("/") || "index.html");
    const confined = path.relative(buildDir, filePath);
    if (confined.startsWith("..") || path.isAbsolute(confined) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return respond404(response);
    }
    response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", (error) => error ? reject(error) : resolve()));
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test("active shields survive the generated-player boundary and render on both grids and renderers", async ({ page }) => {
  test.setTimeout(90_000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  for (const { grid, renderer } of combinations) {
    await page.goto(`http://127.0.0.1:${port}/${grid}/${renderer}/`);
    await page.waitForFunction(() => window.__towerforgeBootOk === true);
    await expect(page.locator("#boot-error")).toBeHidden();

    const initial = await page.evaluate(() => window.__towerforgeInspect());
    expect(initial.combat).toBeUndefined();
    await page.locator("#start-wave").click();
    await expect.poll(() => page.evaluate(() => {
      const snapshot = window.__towerforgeInspect();
      const enemy = snapshot.enemies[0];
      return enemy ? snapshot.combat?.shields?.enemies?.[enemy.id]?.capacity ?? 0 : 0;
    }), { timeout: 10_000 }).toBe(25);

    const canvas = renderer === "phaser" ? page.locator("#playfield canvas") : page.locator("canvas#playfield");
    await expect.poll(async () => {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const png = PNG.sync.read(await canvas.screenshot());
      let cyanPixels = 0;
      for (let index = 0; index < png.data.length; index += 4) {
        const red = png.data[index];
        const green = png.data[index + 1];
        const blue = png.data[index + 2];
        const alpha = png.data[index + 3];
        if (alpha > 64 && red < 175 && green > 145 && blue > 175 && blue > red + 25) cyanPixels += 1;
      }
      return cyanPixels;
    }, { message: `${grid}/${renderer} has no visible shield indicator`, timeout: 5_000 }).toBeGreaterThan(4);
  }

  expect(browserErrors).toEqual([]);
});

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
