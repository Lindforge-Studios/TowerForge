import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { createProject } from "../../packages/cli/lib/create-project.mjs";
import { readRawProjectFiles } from "../../packages/cli/lib/project-loader.mjs";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../../packages/cli/lib/project-migrations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const combinations = ["hex", "square"].flatMap((grid) => (
  ["canvas", "phaser"].map((renderer) => ({
    grid,
    renderer,
    visual: (grid === "hex") === (renderer === "canvas") ? "sprite" : "fallback"
  }))
));
const activations = ["click", "enter", "space", "tap"];
const mobileInputFamilies = ["mouse", "touch", "keyboard"];

test.use({ hasTouch: true });

test.describe("R5.1A Studio static heroes lifecycle", () => {
  let tempRoot;
  let projectDir;
  let studioProcess;
  let studioUrl;
  let serverOutput = "";

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-heroes-studio-"));
    projectDir = path.join(tempRoot, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
    writeMigratedProjectFiles(projectDir, migrated.files);

    const port = await freeTcpPort();
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
    await waitForHttp(`${studioUrl}/api/project`, studioProcess, () => serverOutput);
  });

  test.afterAll(async () => {
    await stopProcess(studioProcess);
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("keeps malformed authored v2 references lossless and blocks preview instead of repairing them", async ({ page }) => {
    test.setTimeout(120_000);
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const originalBalanceBytes = fs.readFileSync(balancePath, "utf8");
    const originalMechanicsBytes = fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "utf8") : null;
    try {
      const balance = JSON.parse(originalBalanceBytes);
      balance.missions.tutorial_01.mechanics = { profiles: { heroes: "malformed_mobile" } };
      writeJson(balancePath, balance);
      writeJson(mechanicsPath, {
        schemaVersion: 1,
        modules: {
          heroes: {
            schemaVersion: 2,
            enabled: false,
            profiles: {
              malformed_mobile: {
                selectedHeroId: "commander",
                definitions: {
                  commander: {
                    label: "Commander",
                    spawn: "core",
                    movement: { movementProfileId: "ghost", speed: 1 }
                  }
                },
                movementProfiles: {
                  ground: {
                    label: "Ground",
                    terrainMode: "respect_walkable",
                    towerOccupancy: "blocked",
                    defaultTerrainCost: 1_000
                  }
                }
              }
            }
          }
        }
      });
      const authoredBytes = fs.readFileSync(mechanicsPath, "utf8");

      await openStudio(page, studioUrl);
      await openHeroesMechanics(page);
      const reference = page.locator('[data-hero-definition-id="commander"] [data-hero-movement-profile-definition-id]');
      await expect(reference).toHaveValue("ghost");
      await expect(reference.locator('option[value="ghost"]')).toContainText(/unknown|missing|ghost/i);
      await page.locator("#btn-mechanics-preview").click();
      await expect(page.locator("#mechanics-preview-result")).toContainText(/ghost|movement profile|invalid/i);
      await expect(page.locator("#mechanics-preview-result")).not.toContainText('"ok": true');
      expect(fs.readFileSync(mechanicsPath, "utf8")).toBe(authoredBytes);
    } finally {
      fs.writeFileSync(balancePath, originalBalanceBytes, "utf8");
      if (originalMechanicsBytes === null) fs.rmSync(mechanicsPath, { force: true });
      else fs.writeFileSync(mechanicsPath, originalMechanicsBytes, "utf8");
    }
  });

  test("enables, edits, saves, reloads, disables, and re-enables a v2 mobile hero profile", async ({ page }) => {
    test.setTimeout(120_000);
    const balancePath = path.join(projectDir, "content", "balance.json");
    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const originalBalanceBytes = fs.readFileSync(balancePath, "utf8");
    const originalMechanicsBytes = fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "utf8") : null;
    try {
      await openStudio(page, studioUrl);
      await openHeroesMechanics(page);
      await expect(page.locator('#mechanics-recipe-select option[value="basic_mobile_commander_hero"]'))
        .toHaveCount(1);
      await page.locator("#mechanics-recipe-select").selectOption("basic_mobile_commander_hero");
      await page.locator("#btn-mechanics-new-profile").click();
      await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_mobile_commander_hero");
      const commander = page.locator('[data-hero-definition-id="commander"]');
      await expect(commander.locator("[data-hero-movement-profile-definition-id]")).toHaveValue("ground");
      await commander.locator("[data-hero-movement-speed]").fill("1.5");
      await page.locator("#mechanics-heroes-movement summary").click();
      await page.locator('[data-hero-movement-profile-id="ground"] [data-hero-movement-label]').fill("Field Ground");

      const beforePreview = readHeroesState(projectDir);
      await page.locator("#btn-mechanics-preview").click();
      await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
      expect(readHeroesState(projectDir)).toEqual(beforePreview);
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        moduleSchemaVersion: 2,
        enabled: true,
        selectedProfileId: "basic_mobile_commander_hero",
        profile: {
          definitions: {
            commander: { movement: { movementProfileId: "ground", speed: 1.5 } }
          },
          movementProfiles: { ground: { label: "Field Ground" } }
        }
      });

      await page.reload();
      await openHeroesMechanics(page);
      await expect(page.locator('[data-hero-definition-id="commander"] [data-hero-movement-speed]'))
        .toHaveValue("1.5");
      await page.locator('[data-hero-definition-id="commander"] [data-hero-movement-speed]').fill("2");
      await page.locator("#btn-mechanics-save").click();
      await expect.poll(() => readHeroesState(projectDir).profile?.definitions?.commander?.movement?.speed).toBe(2);

      await page.reload();
      await openHeroesMechanics(page);
      await expect(page.locator('[data-hero-definition-id="commander"] [data-hero-movement-speed]'))
        .toHaveValue("2");
      const preservedProfile = structuredClone(readHeroesState(projectDir).profile);
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#btn-mechanics-disable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        enabled: false,
        selectedProfileId: "basic_mobile_commander_hero",
        profile: preservedProfile
      });
      await page.locator("#btn-mechanics-enable").click();
      await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
        enabled: true,
        selectedProfileId: "basic_mobile_commander_hero",
        profile: preservedProfile
      });
    } finally {
      fs.writeFileSync(balancePath, originalBalanceBytes, "utf8");
      if (originalMechanicsBytes === null) fs.rmSync(mechanicsPath, { force: true });
      else fs.writeFileSync(mechanicsPath, originalMechanicsBytes, "utf8");
    }
  });

  test("enables, edits, reloads, disables, re-enables, and preserves future v3 read-only", async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = captureBrowserErrors(page);
    await openStudio(page, studioUrl);
    await openHeroesMechanics(page);

    await expect(page.locator('#mechanics-recipe-select option[value="basic_commander_hero"]'))
      .toHaveCount(1);
    await page.locator("#mechanics-recipe-select").selectOption("basic_commander_hero");
    await page.locator("#btn-mechanics-new-profile").click();
    await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_commander_hero");

    const commander = page.locator('[data-hero-definition-id="commander"]');
    await expect(commander).toBeVisible();
    await commander.locator("[data-hero-label]").fill("Field Commander");
    await page.locator("#btn-mechanics-add-hero").click();
    const generated = page.locator('[data-hero-definition-id="hero_2"]');
    await generated.locator("[data-hero-id]").fill("warden");
    await generated.locator("[data-hero-id]").press("Tab");
    const warden = page.locator('[data-hero-definition-id="warden"]');
    await expect(warden).toBeVisible();
    await warden.locator("[data-hero-label]").fill("Warden");
    await page.locator("#mechanics-heroes-selected-id").selectOption("warden");

    const beforePreview = readHeroesState(projectDir);
    await page.locator("#btn-mechanics-preview").click();
    await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
    expect(readHeroesState(projectDir)).toEqual(beforePreview);

    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
      projectSchemaVersion: 3,
      moduleSchemaVersion: 1,
      enabled: true,
      selectedProfileId: "basic_commander_hero",
      profile: {
        selectedHeroId: "warden",
        definitions: {
          commander: { label: "Field Commander", spawn: "core" },
          warden: { label: "Warden", spawn: "core" }
        }
      }
    });

    await page.reload();
    await openHeroesMechanics(page);
    await expect(page.locator("#mechanics-heroes-selected-id")).toHaveValue("warden");
    await expect(page.locator('[data-hero-definition-id="warden"] [data-hero-label]'))
      .toHaveValue("Warden");
    await page.locator('[data-hero-definition-id="warden"] [data-hero-label]').fill("Prime Warden");
    await page.locator("#btn-mechanics-save").click();
    await expect.poll(() => readHeroesState(projectDir).profile?.definitions?.warden?.label)
      .toBe("Prime Warden");

    await page.reload();
    await openHeroesMechanics(page);
    await expect(page.locator('[data-hero-definition-id="warden"] [data-hero-label]'))
      .toHaveValue("Prime Warden");
    const preservedProfile = structuredClone(readHeroesState(projectDir).profile);

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-mechanics-disable").click();
    await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
      enabled: false,
      selectedProfileId: "basic_commander_hero",
      profile: preservedProfile
    });
    await expect(page.locator("#btn-mechanics-enable")).toBeEnabled();
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readHeroesState(projectDir)).toMatchObject({
      enabled: true,
      selectedProfileId: "basic_commander_hero",
      profile: preservedProfile
    });

    const mechanicsPath = path.join(projectDir, "content", "mechanics.json");
    const future = readJson(mechanicsPath);
    future.modules.heroes.schemaVersion = 3;
    future.modules.heroes.futureModuleRule = { preserve: ["exact", 3] };
    future.modules.heroes.profiles.basic_commander_hero.futureProfileRule = { preserve: true };
    writeJson(mechanicsPath, future);
    const futureBytes = fs.readFileSync(mechanicsPath, "utf8");

    await page.reload();
    await openHeroesMechanics(page);
    await expect(page.locator("#mechanics-heroes-read-only")).toBeVisible();
    await expect(page.locator("#mechanics-heroes-read-only")).toContainText(/future|read-only/i);
    await expect(page.locator("#mechanics-heroes-selected-id")).toBeDisabled();
    const rowControls = page.locator("#mechanics-heroes-definition-rows input, #mechanics-heroes-definition-rows select, #mechanics-heroes-definition-rows button");
    await expect(rowControls).toHaveCount(8);
    expect(await rowControls.evaluateAll((controls) => controls.every((control) => control.disabled))).toBe(true);
    for (const control of [
      "#mechanics-profile-id",
      "#btn-mechanics-new-profile",
      "#btn-mechanics-preview",
      "#btn-mechanics-enable",
      "#btn-mechanics-save",
      "#btn-mechanics-disable",
      "#btn-mechanics-add-hero"
    ]) await expect(page.locator(control)).toBeDisabled();
    expect(fs.readFileSync(mechanicsPath, "utf8")).toBe(futureBytes);
    expect(browserErrors()).toEqual([]);
  });
});

test.describe("R5.1A generated-player static hero presentation", () => {
  let tempRoot;
  let server;
  let port;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-heroes-player-"));
    for (const combination of combinations) {
      buildHeroPlayerFixture(tempRoot, combination);
      buildMobileHeroPlayerFixture(tempRoot, combination);
    }
    buildLegacyPlayerFixture(tempRoot);
    port = await freeHttpPort();
    server = http.createServer((request, response) => {
      const relative = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname)
        .replace(/^\/+/, "");
      const [mode, grid, renderer, ...parts] = relative.split("/");
      if (!(["active", "mobile", "legacy"].includes(mode)
        && ["hex", "square"].includes(grid)
        && ["canvas", "phaser"].includes(renderer))) return respond404(response);
      const fixture = mode === "legacy"
        ? "hero_legacy_hex_canvas"
        : `hero_${mode}_${grid}_${renderer}`;
      const buildDir = path.join(tempRoot, `${fixture}.tdproj`, "dist");
      const filePath = path.resolve(buildDir, parts.join("/") || "index.html");
      const confined = path.relative(buildDir, filePath);
      if (confined.startsWith("..") || path.isAbsolute(confined)
        || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return respond404(response);
      response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
      fs.createReadStream(filePath).pipe(response);
    });
    await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", (error) => (
      error ? reject(error) : resolve()
    )));
  });

  test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("shows the authoritative core hero with sprite/fallback on Canvas/Phaser and hex/square", async ({ page }) => {
    test.setTimeout(180_000);
    const browserErrors = captureBrowserErrors(page);

    for (const [index, { grid, renderer, visual }] of combinations.entries()) {
      await page.goto(playerUrl(port, "active", grid, renderer));
      await waitForPlayerBoot(page);
      const snapshot = await inspectPlayer(page);
      expect(snapshot.heroes, `${grid}/${renderer} heroes snapshot`).toEqual({
        schemaVersion: 1,
        units: [{
          id: "commander",
          definitionId: "commander",
          label: "Sentinel",
          coord: snapshot.coreCoord
        }]
      });
      await expect(page.locator('[id*="hero"], [data-hero]'), `${grid}/${renderer} static slice UI`)
        .toHaveCount(0);
      await expect.poll(() => countHeroPixels(page, renderer, visual, snapshot.coreCoord), {
        message: `${grid}/${renderer} must draw the ${visual} at the core`,
        timeout: 10_000
      }).toBeGreaterThan(20);

      const before = structuredClone(snapshot.heroes);
      await exerciseOrdinaryInput(page, renderer, activations[index]);
      await expect.poll(async () => (await inspectPlayer(page)).heroes).toEqual(before);
      const after = await inspectPlayer(page);
      expect((after.lastEvents ?? []).map((event) => event.type))
        .not.toContain(expect.stringMatching(/moveHero|heroMoved/i));
    }

    expect(browserErrors()).toEqual([]);
  });

  test("keeps the untouched legacy starter free of hero UI and state", async ({ page }) => {
    const browserErrors = captureBrowserErrors(page);
    await page.goto(playerUrl(port, "legacy", "hex", "canvas"));
    await waitForPlayerBoot(page);
    const snapshot = await inspectPlayer(page);
    expect(snapshot).not.toHaveProperty("heroes");
    await expect(page.locator('[id*="hero"], [data-hero]')).toHaveCount(0);
    expect(await countHeroPixels(page, "canvas", "either", snapshot.coreCoord)).toBe(0);
    await exerciseOrdinaryInput(page, "canvas", "click");
    expect(await inspectPlayer(page)).not.toHaveProperty("heroes");
    expect(browserErrors()).toEqual([]);
  });

  for (const { grid, renderer } of combinations) {
    for (const inputFamily of mobileInputFamilies) {
      test(`moves the opt-in v2 hero with ${inputFamily} on ${grid}/${renderer}`, async ({ page }) => {
        test.setTimeout(90_000);
        const browserErrors = captureBrowserErrors(page);
        await page.goto(playerUrl(port, "mobile", grid, renderer));
        await waitForPlayerBoot(page);

        const initial = await inspectPlayer(page);
        expect(initial).not.toHaveProperty("navigation");
        expect(initial.heroes).toEqual({
          schemaVersion: 2,
          units: [{
            id: "commander",
            definitionId: "commander",
            label: "Mobile Sentinel",
            coord: initial.coreCoord,
            movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 }
          }]
        });

        const target = initial.spawnCoord;
        expect(target).not.toEqual(initial.coreCoord);
        if (inputFamily === "keyboard") {
          await assignHeroTargetWithKeyboard(page, initial.coreCoord, target, initial.heroes);
        } else {
          await assignHeroTargetWithPointer(page, inputFamily, initial.coreCoord, target);
        }

        await expect.poll(async () => {
          const unit = (await inspectPlayer(page)).heroes?.units?.[0];
          return Boolean(unit?.movement?.targetCoord
            && unit.movement.nextCoord
            && unit.movement.edgeProgress > 0
            && unit.movement.edgeProgress < 1);
        }, {
          message: `${inputFamily} must dispatch v4 and produce observable interpolated movement`,
          timeout: 10_000
        }).toBe(true);

        await expect.poll(async () => (await inspectPlayer(page)).heroes?.units?.[0]?.coord, {
          message: `${inputFamily} must advance the authoritative hero coordinate`,
          timeout: 15_000
        }).not.toEqual(initial.coreCoord);
        expect(browserErrors()).toEqual([]);
      });
    }
  }
});

function buildHeroPlayerFixture(root, { grid, renderer, visual }) {
  const name = `hero_active_${grid}_${renderer}`;
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { heroes: "commanders" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      heroes: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          commanders: {
            selectedHeroId: "commander",
            definitions: { commander: { label: "Sentinel", spawn: "core" } }
          }
        }
      }
    }
  });

  if (visual === "sprite") {
    const spritePath = path.join(projectDir, "assets", "hero-e2e.png");
    fs.writeFileSync(spritePath, magentaSprite());
    const visualsPath = path.join(projectDir, "content", "visuals.json");
    const visuals = readJson(visualsPath);
    visuals.sprites.hero_e2e = { src: "assets/hero-e2e.png" };
    visuals.bindings.heroes = { commander: "hero_e2e" };
    writeJson(visualsPath, visuals);
  }
  buildPlayer(projectDir, renderer, "heroes");
}

function buildMobileHeroPlayerFixture(root, { grid, renderer }) {
  const name = `hero_mobile_${grid}_${renderer}`;
  const { projectDir } = createProject({ name, parentDir: root, templateName: "classic", gridKind: grid });
  const manifestPath = path.join(projectDir, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(projectDir, "content", "balance.json");
  const balance = readJson(balancePath);
  const missionId = balance.defaultMissionId ?? Object.keys(balance.missions)[0];
  balance.missions[missionId].mechanics = { profiles: { heroes: "mobile_commanders" } };
  writeJson(balancePath, balance);
  writeJson(path.join(projectDir, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      heroes: {
        schemaVersion: 2,
        enabled: true,
        profiles: {
          mobile_commanders: {
            selectedHeroId: "commander",
            definitions: {
              commander: {
                label: "Mobile Sentinel",
                spawn: "core",
                movement: { movementProfileId: "ground", speed: 0.4 }
              }
            },
            movementProfiles: {
              ground: {
                label: "Ground",
                terrainMode: "respect_walkable",
                towerOccupancy: "blocked",
                defaultTerrainCost: 1_000
              }
            }
          }
        }
      }
    }
  });
  buildPlayer(projectDir, renderer, "heroes");
}

function buildLegacyPlayerFixture(root) {
  const { projectDir } = createProject({
    name: "hero_legacy_hex_canvas",
    parentDir: root,
    templateName: "classic",
    gridKind: "hex"
  });
  buildPlayer(projectDir, "canvas", "heroes");
}

function buildPlayer(projectDir, renderer, targetId) {
  const targetsPath = path.join(projectDir, "build-targets.json");
  const targets = readJson(targetsPath);
  targets.targets[targetId] = {
    ...targets.targets["web-pwa"],
    id: targetId,
    renderer,
    webDir: "dist"
  };
  writeJson(targetsPath, targets);
  try {
    execFileSync(process.execPath, [
      path.join(repoRoot, "packages", "cli", "build.mjs"),
      "--project", projectDir,
      "--target", targetId
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    });
  } catch (error) {
    throw new Error(`Failed to build ${path.basename(projectDir)}/${renderer}.\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
  }
}

function magentaSprite() {
  const png = new PNG({ width: 24, height: 24 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 255;
    png.data[index + 1] = 0;
    png.data[index + 2] = 255;
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
}

async function countHeroPixels(page, renderer, visual, coreCoord) {
  const canvas = renderer === "phaser" ? page.locator("#playfield canvas") : page.locator("canvas#playfield");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const [box, point, screenshot] = await Promise.all([
    canvas.boundingBox(),
    page.evaluate((coord) => window.__towerforgeTilePoint(coord), coreCoord),
    canvas.screenshot()
  ]);
  if (!box || !point) return 0;
  const png = PNG.sync.read(screenshot);
  const centerX = Math.round((point.x - box.x) * png.width / box.width);
  const centerY = Math.round((point.y - box.y) * png.height / box.height);
  const radius = Math.max(12, Math.round(32 * png.width / box.width));
  let count = 0;
  for (let y = Math.max(0, centerY - radius); y < Math.min(png.height, centerY + radius); y += 1) {
    for (let x = Math.max(0, centerX - radius); x < Math.min(png.width, centerX + radius); x += 1) {
      const index = (y * png.width + x) * 4;
      const red = png.data[index];
      const green = png.data[index + 1];
      const blue = png.data[index + 2];
      const alpha = png.data[index + 3];
      const sprite = alpha > 128 && red > 235 && green < 35 && blue > 235;
      const fallback = alpha > 128 && red >= 218 && red <= 245
        && green >= 165 && green <= 200 && blue >= 65 && blue <= 120;
      if ((visual === "sprite" && sprite)
        || (visual === "fallback" && fallback)
        || (visual === "either" && (sprite || fallback))) count += 1;
    }
  }
  return count;
}

async function exerciseOrdinaryInput(page, renderer, activation) {
  const point = await page.evaluate(() => {
    const snapshot = window.__towerforgeInspect();
    const tile = snapshot.tiles.find((candidate) => candidate.terrain === "buildable" && !candidate.occupiedBy);
    return window.__towerforgeTilePoint({ q: tile.q, r: tile.r });
  });
  const canvas = renderer === "phaser" ? page.locator("#playfield canvas") : page.locator("canvas#playfield");
  if (activation === "click") await page.mouse.click(point.x, point.y);
  else if (activation === "tap") await page.touchscreen.tap(point.x, point.y);
  else {
    await canvas.focus();
    await page.keyboard.press(activation === "space" ? "Space" : "Enter");
  }
}

async function assignHeroTargetWithPointer(page, inputFamily, heroCoord, targetCoord) {
  const [heroPoint, targetPoint] = await Promise.all([
    page.evaluate((coord) => window.__towerforgeTilePoint(coord), heroCoord),
    page.evaluate((coord) => window.__towerforgeTilePoint(coord), targetCoord)
  ]);
  expect(heroPoint).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  expect(targetPoint).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  const activate = inputFamily === "touch"
    ? (point) => page.touchscreen.tap(point.x, point.y)
    : (point) => page.mouse.click(point.x, point.y);
  await activate(heroPoint);
  await expect(page.locator("#message")).toContainText("Hero selected");
  await activate(targetPoint);
}

async function assignHeroTargetWithKeyboard(page, heroCoord, targetCoord, initialHeroes) {
  const playfield = page.locator("#playfield");
  await playfield.focus();
  await moveKeyboardCursorTo(page, heroCoord);
  await page.keyboard.press("Enter");
  await expect(page.locator("#message")).toContainText("Hero selected");

  // Selection is presentation-only UI state: Escape must cancel without mutating engine state.
  await page.keyboard.press("Escape");
  expect((await inspectPlayer(page)).heroes).toEqual(initialHeroes);

  await page.keyboard.press("Enter");
  await expect(page.locator("#message")).toContainText("Hero selected");
  await moveKeyboardCursorTo(page, targetCoord);
  await page.keyboard.press("Enter");
}

async function moveKeyboardCursorTo(page, targetCoord) {
  const playfield = page.locator("#playfield");
  const label = await playfield.getAttribute("aria-label");
  const match = /Selected tile q (-?\d+), r (-?\d+)/.exec(label ?? "");
  expect(match, `keyboard cursor label: ${label}`).not.toBeNull();
  let q = Number(match[1]);
  let r = Number(match[2]);
  while (q < targetCoord.q) { await page.keyboard.press("ArrowRight"); q += 1; }
  while (q > targetCoord.q) { await page.keyboard.press("ArrowLeft"); q -= 1; }
  while (r < targetCoord.r) { await page.keyboard.press("ArrowDown"); r += 1; }
  while (r > targetCoord.r) { await page.keyboard.press("ArrowUp"); r -= 1; }
  await expect(playfield).toHaveAttribute(
    "aria-label",
    new RegExp(`Selected tile q ${targetCoord.q}, r ${targetCoord.r},`)
  );
}

async function openStudio(page, url) {
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(url);
  await expect(page).toHaveTitle(/TowerForge Editor/);
}

async function openHeroesMechanics(page) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
  const card = page.locator('#mechanics-module-grid [data-mechanics-module="heroes"]');
  await expect(card).toBeEnabled();
  if (!await card.evaluate((element) => element.classList.contains("selected"))) await card.click();
  await expect(page.locator("#mechanics-heroes-editor")).toBeVisible();
}

function readHeroesState(root) {
  const manifest = readJson(path.join(root, "project.json"));
  const balance = readJson(path.join(root, "content", "balance.json"));
  const mechanicsPath = path.join(root, "content", "mechanics.json");
  const mechanics = fs.existsSync(mechanicsPath) ? readJson(mechanicsPath) : undefined;
  const selectedProfileId = balance.missions.tutorial_01.mechanics?.profiles?.heroes;
  return {
    projectSchemaVersion: manifest.schemaVersion,
    moduleSchemaVersion: mechanics?.modules?.heroes?.schemaVersion,
    enabled: mechanics?.modules?.heroes?.enabled === true,
    selectedProfileId,
    profile: mechanics?.modules?.heroes?.profiles?.[selectedProfileId]
  };
}

async function waitForPlayerBoot(page) {
  await page.waitForFunction(() => window.__towerforgeBootOk === true);
  await expect(page.locator("#boot-error")).toBeHidden();
}

async function inspectPlayer(page) {
  return page.evaluate(() => window.__towerforgeInspect());
}

function playerUrl(port, mode, grid, renderer) {
  return `http://127.0.0.1:${port}/${mode}/${grid}/${renderer}/`;
}

function captureBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return () => errors.filter((message) => !(
    message.includes("document is sandboxed") && message.includes("allow-same-origin")
  ));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function freeHttpPort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) return freeHttpPort();
  return port;
}

async function freeTcpPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) return freeTcpPort();
  return port;
}

async function waitForHttp(url, child, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Studio exited before readiness.\n${output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Studio is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.\n${output()}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
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
