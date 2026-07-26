import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { readRawProjectFiles } from "../../packages/cli/lib/project-loader.mjs";
import { migrateProjectFiles, writeMigratedProjectFiles } from "../../packages/cli/lib/project-migrations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let tempRoot;
let projectDir;
let studioProcess;
let studioUrl;
let serverOutput = "";

test.describe("R4.1A Studio rogue-lite synergy lifecycle", () => {
  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-roguelite-studio-"));
    projectDir = path.join(tempRoot, "starter.tdproj");
    fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
    const migrated = migrateProjectFiles(readRawProjectFiles(projectDir));
    writeMigratedProjectFiles(projectDir, migrated.files);

    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = readJson(balancePath);
    balance.towers.arrow_tower.tags = ["sniper"];
    writeJson(balancePath, balance);
    expect(readJson(path.join(projectDir, "project.json")).schemaVersion).toBe(2);
    expect(fs.existsSync(path.join(projectDir, "content", "mechanics.json"))).toBe(false);

    const port = await freePort();
    studioUrl = `http://127.0.0.1:${port}`;
    serverOutput = "";
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

  test.afterEach(async () => {
    await stopProcess(studioProcess);
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("materializes and previews the inert elemental recipe without writing project files", async ({ page }) => {
    const errors = captureBrowserErrors(page);
    const before = authoringBytes(projectDir);
    await openStudio(page);
    await openRogueliteMechanics(page);

    await expect(page.locator('#mechanics-recipe-select option[value="basic_elemental_synergy"]'))
      .toHaveText("Basic Elemental Synergy");
    const materializedResponse = page.waitForResponse((response) => (
      response.url().endsWith("/api/mechanics/recipe") && response.request().method() === "POST"
    ));
    await page.locator("#mechanics-recipe-select").selectOption("basic_elemental_synergy");
    await page.locator("#btn-mechanics-new-profile").click();
    expect((await materializedResponse).status()).toBe(200);

    await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_elemental_synergy");
    await expect(towerTagsInput(page, "arrow_tower")).toHaveValue("elemental, sniper");
    await expect(towerTagsInput(page, "cannon_tower")).toHaveValue("elemental");
    const synergy = synergyRow(page, "elemental_convergence");
    await expect(synergy).toBeVisible();
    await expect(synergy.locator('[data-role="label"]')).toHaveValue("Elemental Convergence");
    await expect(synergy.locator('[data-role="tag"]')).toHaveValue("elemental");
    await expect(synergy.locator('[data-role="tier-mode"]')).toHaveValue("highest");
    await expect(synergy.locator('[data-role="tiers"]')).toHaveValue(
      "2 additive_ratio 0.1\n4 additive_ratio 0.2\n6 additive_ratio 0.3"
    );
    expect(authoringBytes(projectDir)).toEqual(before);

    await page.locator("#btn-mechanics-preview").click();
    await expect(page.locator("#mechanics-preview-result")).toContainText('"ok": true');
    const preview = JSON.parse(await page.locator("#mechanics-preview-result").textContent());
    expect(preview.candidate.balance.towers.arrow_tower.tags).toEqual(["elemental", "sniper"]);
    expect(preview.candidate.balance.towers.cannon_tower.tags).toEqual(["elemental"]);
    expect(authoringBytes(projectDir)).toEqual(before);
    expect(errors()).toEqual([]);
  });

  test("makes a first authored tower tag immediately available for a new synergy", async ({ page }) => {
    const balancePath = path.join(projectDir, "content", "balance.json");
    const balance = readJson(balancePath);
    delete balance.towers.arrow_tower.tags;
    writeJson(balancePath, balance);
    await openStudio(page);
    await openRogueliteMechanics(page);

    await expect(page.locator("#btn-mechanics-add-synergy")).toBeDisabled();
    await towerTagsInput(page, "arrow_tower").fill("nature");
    await expect(page.locator("#btn-mechanics-add-synergy")).toBeEnabled();
    await page.locator("#btn-mechanics-add-synergy").click();
    await expect(synergyRow(page, "synergy_1").locator('[data-role="tag"]')).toHaveValue("nature");
  });

  test("authors, reloads, edits, disables, and re-enables the isolated v2 artifact profile", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = captureBrowserErrors(page);
    await openStudio(page);
    await openRogueliteMechanics(page);

    await page.locator("#mechanics-recipe-select").selectOption("basic_boss_artifact_loot");
    await page.locator("#btn-mechanics-new-profile").click();
    await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_boss_artifact_loot");
    const definitions = page.locator('#mechanics-roguelite-artifact-definition-rows [data-role="artifact-json"]');
    const slots = page.locator('#mechanics-roguelite-tower-slot-rows [data-role="artifact-json"]');
    const loot = page.locator('#mechanics-roguelite-boss-loot-table-rows [data-role="artifact-json"]');
    await expect(definitions).toHaveValue(/Boss Trophy/);
    await expect(slots).toHaveValue(/arrow_tower/);
    await expect(slots).toHaveValue(/cannon_tower/);
    await expect(loot).toHaveValue(/armored_brute/);

    await page.locator("#btn-mechanics-enable").click();
    await expect(page.locator("#mechanics-hub-state")).toHaveText("Rogue-lite active for mission");
    const initialState = {
      projectSchemaVersion: 3,
      moduleSchemaVersion: 2,
      enabled: true,
      selectedProfileId: "basic_boss_artifact_loot",
      towerTagsByTowerId: { arrow_tower: ["sniper"] },
      profile: bossArtifactProfile()
    };
    await expect.poll(() => readRogueliteState(projectDir)).toEqual(initialState);

    await page.reload();
    await openRogueliteMechanics(page);
    const editedProfile = bossArtifactProfile();
    editedProfile.artifacts.definitions.boss_trophy.label = "Boss Trophy Mk II";
    const definitionsAfterReload = page.locator('#mechanics-roguelite-artifact-definition-rows [data-role="artifact-json"]');
    await definitionsAfterReload.fill(JSON.stringify(editedProfile.artifacts.definitions, null, 2));
    await definitionsAfterReload.press("Tab");
    await page.locator("#btn-mechanics-save").click();
    const editedState = { ...initialState, profile: editedProfile };
    await expect.poll(() => readRogueliteState(projectDir)).toEqual(editedState);

    await page.reload();
    await openRogueliteMechanics(page);
    await expect(page.locator('#mechanics-roguelite-artifact-definition-rows [data-role="artifact-json"]'))
      .toHaveValue(/Boss Trophy Mk II/);

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-mechanics-disable").click();
    await expect.poll(() => readRogueliteState(projectDir)).toEqual({ ...editedState, enabled: false });
    await page.locator("#btn-mechanics-enable").click();
    await expect.poll(() => readRogueliteState(projectDir)).toEqual(editedState);
    expect(errors()).toEqual([]);
  });

  test("runs boss loot and socket controls in the Studio Playtest", async ({ page }) => {
    test.setTimeout(120_000);
    writeArtifactRuntimeFixture(projectDir);
    const errors = captureBrowserErrors(page);
    await openStudio(page);
    await page.getByRole("tab", { name: /Playtest/ }).click();
    await expect(page.locator("#playtest-stage")).toBeVisible();
    await expect(page.locator("#pt-artifact-inventory")).toBeVisible();

    await clickHexTile(page, "#playtest-canvas", { q: 12, r: 8 }, { width: 15, height: 20 });
    await expect(page.locator("#pt-towers-count")).toHaveText("1");
    await page.locator("#pt-speed").fill("4");
    await page.locator("#pt-start").click();
    await expect(page.locator("#pt-artifact-inventory"), "Studio must surface deterministic boss loot")
      .toContainText("Browser Scope", { timeout: 20_000 });

    await page.locator("#pt-interaction-mode").selectOption("inspect");
    await clickHexTile(page, "#playtest-canvas", { q: 12, r: 8 }, { width: 15, height: 20 });
    await expect(page.locator("#pt-inspector")).toContainText("Arrow Tower");
    const socket = page.locator('[data-pt-artifact-action="socket"]');
    await expect(socket).toBeEnabled();
    await socket.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#pt-artifact-inventory")).toContainText("tower_1/scope");

    const unsocket = page.locator('[data-pt-artifact-action="unsocket"]');
    await expect(unsocket).toBeEnabled();
    await unsocket.click();
    await expect(page.locator("#pt-artifact-inventory")).not.toContainText("tower_1/scope");
    await expect(page.locator("#pt-msg")).toHaveText("Action completed.");
    expect(errors()).toEqual([]);
  });

  test("enables, reloads, edits, disables, and re-enables while preserving tags, profile, and selection", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = captureBrowserErrors(page);
    await openStudio(page);
    await openRogueliteMechanics(page);
    await materializeElementalRecipe(page);

    await page.locator("#btn-mechanics-enable").click();
    await expect(page.locator("#mechanics-hub-state")).toHaveText("Rogue-lite active for mission");
    await expect.poll(() => readRogueliteState(projectDir)).toEqual({
      projectSchemaVersion: 3,
      moduleSchemaVersion: 1,
      enabled: true,
      selectedProfileId: "basic_elemental_synergy",
      towerTagsByTowerId: {
        arrow_tower: ["elemental", "sniper"],
        cannon_tower: ["elemental"]
      },
      profile: elementalProfile()
    });

    await page.reload();
    await openRogueliteMechanics(page);
    await expect(towerTagsInput(page, "arrow_tower")).toHaveValue("elemental, sniper");
    let synergy = synergyRow(page, "elemental_convergence");
    await expect(synergy.locator('[data-role="tiers"]')).toHaveValue(
      "2 additive_ratio 0.1\n4 additive_ratio 0.2\n6 additive_ratio 0.3"
    );

    await towerTagsInput(page, "arrow_tower").fill("nature, sniper, elemental");
    await towerTagsInput(page, "cannon_tower").fill("tech, elemental");
    await synergy.locator('[data-role="label"]').fill("Elemental Ascendancy");
    await synergy.locator('[data-role="tier-mode"]').selectOption("cumulative");
    await synergy.locator('[data-role="tiers"]').fill(
      "2 additive_ratio 0.15\n4 multiplier 1.2\n6 flat 3"
    );
    await synergy.locator('[data-role="tiers"]').press("Tab");
    await page.locator("#btn-mechanics-save").click();
    const editedState = {
      projectSchemaVersion: 3,
      moduleSchemaVersion: 1,
      enabled: true,
      selectedProfileId: "basic_elemental_synergy",
      towerTagsByTowerId: {
        arrow_tower: ["elemental", "nature", "sniper"],
        cannon_tower: ["elemental", "tech"]
      },
      profile: {
        synergies: {
          elemental_convergence: {
            label: "Elemental Ascendancy",
            tag: "elemental",
            tierMode: "cumulative",
            tiers: [
              { requiredCount: 2, modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.15 }] },
              { requiredCount: 4, modifiers: [{ target: "damage", operation: "multiplier", value: 1.2 }] },
              { requiredCount: 6, modifiers: [{ target: "damage", operation: "flat", value: 3 }] }
            ]
          }
        }
      }
    };
    await expect.poll(() => readRogueliteState(projectDir)).toEqual(editedState);

    await page.reload();
    await openRogueliteMechanics(page);
    await expect(towerTagsInput(page, "arrow_tower")).toHaveValue("elemental, nature, sniper");
    await expect(towerTagsInput(page, "cannon_tower")).toHaveValue("elemental, tech");
    synergy = synergyRow(page, "elemental_convergence");
    await expect(synergy.locator('[data-role="label"]')).toHaveValue("Elemental Ascendancy");
    await expect(synergy.locator('[data-role="tier-mode"]')).toHaveValue("cumulative");
    await expect(synergy.locator('[data-role="tiers"]')).toHaveValue(
      "2 additive_ratio 0.15\n4 multiplier 1.2\n6 flat 3"
    );

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#btn-mechanics-disable").click();
    await expect(page.locator("#mechanics-hub-state")).toHaveText("Opt-in modules");
    await expect.poll(() => readRogueliteState(projectDir)).toEqual({ ...editedState, enabled: false });

    await expect(page.locator("#btn-mechanics-enable")).toBeEnabled();
    await page.locator("#btn-mechanics-enable").click();
    await expect(page.locator("#mechanics-hub-state")).toHaveText("Rogue-lite active for mission");
    await expect.poll(() => readRogueliteState(projectDir)).toEqual(editedState);
    expect(errors()).toEqual([]);
  });

  test("keeps a future roguelite v3 module visible, byte-identical, and read-only", async ({ page }) => {
    writeFutureRogueliteFixture(projectDir);
    const before = authoringBytes(projectDir);
    const errors = captureBrowserErrors(page);
    await openStudio(page);
    await openRogueliteMechanics(page);

    await expect(page.locator("#mechanics-profile-id")).toHaveValue("future_profile");
    await expect(towerTagsInput(page, "arrow_tower")).toHaveValue("future, sniper");
    const synergy = synergyRow(page, "future_synergy");
    await expect(synergy).toBeVisible();
    await expect(synergy.locator('[data-role="label"]')).toHaveValue("Future Synergy");
    for (const selector of [
      "#mechanics-profile-id",
      "#btn-mechanics-new-profile",
      "#btn-mechanics-preview",
      "#btn-mechanics-enable",
      "#btn-mechanics-save",
      "#btn-mechanics-disable",
      "#btn-mechanics-add-synergy"
    ]) await expect(page.locator(selector)).toBeDisabled();
    expect(await page.locator("#mechanics-roguelite-editor input, #mechanics-roguelite-editor select, #mechanics-roguelite-editor textarea, #mechanics-roguelite-editor button")
      .evaluateAll((controls) => controls.every((control) => control.disabled))).toBe(true);
    expect(authoringBytes(projectDir)).toEqual(before);
    expect(errors()).toEqual([]);
  });
});

async function openStudio(page) {
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(studioUrl);
  await expect(page).toHaveTitle(/TowerForge Editor/);
}

async function openRogueliteMechanics(page) {
  await page.locator('[data-tab="mechanics"]').click();
  await expect(page.locator("#mechanics-hub-state")).not.toHaveText("Loading capabilities…");
  const card = page.locator('#mechanics-module-grid [data-mechanics-module="roguelite"]');
  await expect(card).toBeEnabled();
  if (!await card.evaluate((element) => element.classList.contains("selected"))) await card.click();
  await expect(page.locator("#mechanics-roguelite-editor")).toBeVisible();
}

async function materializeElementalRecipe(page) {
  await page.locator("#mechanics-recipe-select").selectOption("basic_elemental_synergy");
  await page.locator("#btn-mechanics-new-profile").click();
  await expect(page.locator("#mechanics-profile-id")).toHaveValue("basic_elemental_synergy");
  await expect(synergyRow(page, "elemental_convergence")).toBeVisible();
}

function towerTagsInput(page, towerId) {
  return page.locator(`[data-roguelite-tower="${towerId}"] [data-role="tower-tags"]`);
}

function synergyRow(page, synergyId) {
  return page.locator(`[data-synergy-id="${synergyId}"]`);
}

function elementalProfile() {
  return {
    synergies: {
      elemental_convergence: {
        label: "Elemental Convergence",
        tag: "elemental",
        tiers: [
          { requiredCount: 2, modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.1 }] },
          { requiredCount: 4, modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.2 }] },
          { requiredCount: 6, modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.3 }] }
        ]
      }
    }
  };
}

function bossArtifactProfile() {
  return {
    synergies: {},
    artifacts: {
      definitions: {
        boss_trophy: {
          label: "Boss Trophy",
          slotType: "core",
          modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.1 }]
        }
      },
      towerSlots: {
        arrow_tower: [{ slotId: "core", slotType: "core" }],
        cannon_tower: [{ slotId: "core", slotType: "core" }]
      },
      bossLootTables: {
        armored_brute: {
          rolls: 1,
          entries: [{ artifactId: "boss_trophy", weight: 1 }]
        }
      }
    }
  };
}

function readRogueliteState(root) {
  const manifest = readJson(path.join(root, "project.json"));
  const balance = readJson(path.join(root, "content", "balance.json"));
  const mechanics = readJson(path.join(root, "content", "mechanics.json"));
  const module = mechanics.modules.roguelite;
  const selectedProfileId = balance.missions.tutorial_01.mechanics?.profiles?.roguelite;
  return {
    projectSchemaVersion: manifest.schemaVersion,
    moduleSchemaVersion: module.schemaVersion,
    enabled: module.enabled,
    selectedProfileId,
    towerTagsByTowerId: Object.fromEntries(Object.entries(balance.towers)
      .filter(([, tower]) => Array.isArray(tower.tags) && tower.tags.length > 0)
      .map(([towerId, tower]) => [towerId, [...tower.tags].sort()])
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
    profile: module.profiles[selectedProfileId]
  };
}

function writeFutureRogueliteFixture(root) {
  const manifestPath = path.join(root, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);
  const balancePath = path.join(root, "content", "balance.json");
  const balance = readJson(balancePath);
  balance.towers.arrow_tower.tags = ["sniper", "future"];
  balance.missions.tutorial_01.mechanics = { profiles: { roguelite: "future_profile" } };
  writeJson(balancePath, balance);
  writeJson(path.join(root, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      roguelite: {
        schemaVersion: 3,
        enabled: true,
        profiles: {
          future_profile: {
            synergies: {
              future_synergy: {
                label: "Future Synergy",
                tag: "future",
                tierMode: "cumulative",
                tiers: [{ requiredCount: 2, modifiers: [{ target: "damage", operation: "multiplier", value: 1.25 }] }],
                futureDefinitionRule: { retain: true }
              }
            },
            futureProfileRule: ["retain", 2]
          }
        },
        futureModuleRule: { retain: true }
      }
    }
  });
}

function writeArtifactRuntimeFixture(root) {
  const manifestPath = path.join(root, "project.json");
  const manifest = readJson(manifestPath);
  manifest.schemaVersion = 3;
  writeJson(manifestPath, manifest);

  const balancePath = path.join(root, "content", "balance.json");
  const balance = readJson(balancePath);
  balance.missions.tutorial_01.mechanics = { profiles: { roguelite: "studio_artifacts" } };
  balance.towers.arrow_tower.range = 32;
  balance.towers.arrow_tower.attack.fireRate = 30;
  balance.enemies.basic_grunt.maxHp = 1;
  balance.enemies.basic_grunt.speed = 0.1;
  balance.waveSets.tutorial_waves = [{
    id: "artifact_boss_wave",
    label: "Artifact boss wave",
    groups: [{ enemyId: "basic_grunt", count: 1, spawnInterval: 0.1, startDelay: 0 }]
  }, {
    id: "pending_wave",
    label: "Pending wave",
    groups: [{ enemyId: "basic_grunt", count: 1, spawnInterval: 0.1, startDelay: 0 }]
  }];
  writeJson(balancePath, balance);
  writeJson(path.join(root, "content", "mechanics.json"), {
    schemaVersion: 1,
    modules: {
      roguelite: {
        schemaVersion: 2,
        enabled: true,
        profiles: {
          studio_artifacts: {
            synergies: {},
            artifacts: {
              definitions: {
                browser_scope: {
                  label: "Browser Scope",
                  slotType: "scope",
                  modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.1 }]
                }
              },
              towerSlots: { arrow_tower: [{ slotId: "scope", slotType: "scope" }] },
              bossLootTables: {
                basic_grunt: { rolls: 1, entries: [{ artifactId: "browser_scope", weight: 1 }] }
              }
            }
          }
        }
      }
    }
  });
}

function authoringBytes(root) {
  const mechanicsPath = path.join(root, "content", "mechanics.json");
  return {
    manifest: fs.readFileSync(path.join(root, "project.json"), "base64"),
    balance: fs.readFileSync(path.join(root, "content", "balance.json"), "base64"),
    mechanics: fs.existsSync(mechanicsPath) ? fs.readFileSync(mechanicsPath, "base64") : null
  };
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

async function clickHexTile(page, selector, coord, mapSize) {
  const canvas = page.locator(selector);
  const position = await canvas.evaluate((element, args) => {
    const radius = Math.min(
      element.width / ((args.mapSize.width + 1) * 1.65),
      element.height / ((args.mapSize.height + 1) * 1.45)
    );
    const x = radius * 1.5 + args.coord.q * radius * 1.48 + (args.coord.r % 2) * radius * 0.74;
    const y = radius * 1.5 + args.coord.r * radius * 1.28;
    const rect = element.getBoundingClientRect();
    return { x: x / (element.width / rect.width), y: y / (element.height / rect.height) };
  }, { coord, mapSize });
  await canvas.click({ position });
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

async function waitForHttp(url, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Studio exited before readiness.\n${serverOutput}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Studio is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.\n${serverOutput}`);
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
